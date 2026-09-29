"""Private toxicity inference service (FastAPI).

Trust model
- Reachable ONLY from the Express gateway over a private network; never exposed publicly.
- Every route except /health requires the shared secret in `X-Internal-Token`,
  checked in constant time BEFORE the request body is read.
- The model is loaded once at startup after SHA-256 verification (pickle safety) and a
  preprocessing/scikit-learn version check. Startup fails closed on any mismatch.
- Comment text is never logged, and validation errors never echo request input.

Run:  uvicorn app:create_app --factory --host 127.0.0.1 --port 8000 --no-server-header
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

import joblib
import sklearn
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

import preprocessing
from preprocessing import MAX_CHARS, normalize_text

logger = logging.getLogger("inference")

LABELS = ("toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate")
MODEL_FILENAME = "toxicity_baseline.joblib"  # fixed name; never taken from config or requests
MANIFEST_FILENAME = "manifest.json"
MAX_BATCH_SIZE = 100
MAX_BODY_BYTES = 1_048_576  # 1 MiB
PUBLIC_PATHS = frozenset({"/health"})


# --------------------------------------------------------------------------- settings
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "production"] = "development"
    internal_api_token: str
    model_dir: Path = Path("artifacts")
    model_sha256: str | None = None
    allowed_hosts: str = "localhost,127.0.0.1"

    @field_validator("internal_api_token")
    @classmethod
    def _strong_token(cls, v: str) -> str:
        if len(v) < 32 or v.lower().startswith("change"):
            raise ValueError("INTERNAL_API_TOKEN must be a random string of at least 32 characters")
        return v

    @field_validator("model_sha256")
    @classmethod
    def _hex_hash(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if len(v) != 64 or any(c not in "0123456789abcdefABCDEF" for c in v):
            raise ValueError("MODEL_SHA256 must be a 64-character hex SHA-256")
        return v.lower()

    @model_validator(mode="after")
    def _production_requires_pin(self) -> "Settings":
        if self.environment == "production" and not self.model_sha256:
            raise ValueError("MODEL_SHA256 is required when ENVIRONMENT=production")
        return self

    @property
    def host_list(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]


# --------------------------------------------------------------------------- model loading
class ModelBundle:
    def __init__(self, pipeline: Any, version: str) -> None:
        self.pipeline = pipeline
        self.version = version


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_source(path: Path) -> str:
    """Line-ending-insensitive hash; must match ml/artifact.py::sha256_source."""
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def load_model(settings: Settings) -> ModelBundle:
    """Verify, then load. Raises RuntimeError on any mismatch (fail closed)."""
    manifest_path = settings.model_dir / MANIFEST_FILENAME
    model_path = settings.model_dir / MODEL_FILENAME
    if not manifest_path.is_file() or not model_path.is_file():
        raise RuntimeError("Model artifact or manifest is missing")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pinned = settings.model_sha256 or str(manifest.get("sha256", "")).lower()
    actual = _sha256_file(model_path)
    if not hmac.compare_digest(actual, pinned):
        raise RuntimeError("Model artifact hash mismatch; refusing to load")

    local_pre = _sha256_source(Path(preprocessing.__file__))
    if not hmac.compare_digest(local_pre, str(manifest.get("preprocessing_sha256", ""))):
        raise RuntimeError("preprocessing.py differs from the copy used in training")
    if manifest.get("labels") != list(LABELS):
        raise RuntimeError("Model label set mismatch")
    if manifest.get("sklearn_version") != sklearn.__version__:
        raise RuntimeError(
            f"scikit-learn {sklearn.__version__} installed but model was trained with {manifest.get('sklearn_version')}"
        )

    pipeline = joblib.load(model_path)  # safe only because the hash was verified above
    warm = pipeline.predict_proba(["warm up"])
    if warm.shape != (1, len(LABELS)):
        raise RuntimeError("Unexpected model output shape")
    return ModelBundle(pipeline, actual[:12])


# --------------------------------------------------------------------------- schemas
class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    text: str = Field(min_length=1, max_length=MAX_CHARS)


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    comments: list[CommentIn] = Field(min_length=1, max_length=MAX_BATCH_SIZE)

    @field_validator("comments")
    @classmethod
    def _unique_ids(cls, v: list[CommentIn]) -> list[CommentIn]:
        if len({c.id for c in v}) != len(v):
            raise ValueError("comment ids must be unique")
        return v


class CommentOut(BaseModel):
    id: str
    toxicity: float
    categories: dict[str, float]


class BatchResponse(BaseModel):
    results: list[CommentOut]
    model_version: str


def aggregate_toxicity(probabilities: list[float]) -> float:
    """Documented rule (same as ml/predict.py): overall toxicity = highest label probability."""
    return max(probabilities)


# --------------------------------------------------------------------------- ASGI middleware
def _json(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")]
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


class InternalAuthMiddleware:
    """Constant-time shared-secret check that runs before the body is read."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self._digest = hashlib.sha256(token.encode("utf-8")).digest()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return
        provided = b""
        for name, value in scope["headers"]:
            if name == b"x-internal-token":
                provided = value
                break
        if not hmac.compare_digest(hashlib.sha256(provided).digest(), self._digest):
            await _json(401, "Unauthorized")(scope, receive, send)
            return
        await self.app(scope, receive, send)


class BodyTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    """Rejects oversized bodies by Content-Length and while streaming (chunked)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"content-length":
                try:
                    too_big = int(value) > self.max_bytes
                except ValueError:
                    await _json(400, "Invalid Content-Length")(scope, receive, send)
                    return
                if too_big:
                    await _json(413, "Request body too large")(scope, receive, send)
                    return
        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if exceeded:  # drop whatever error the framework produced; we answer 413 ourselves
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except BodyTooLarge:
            pass
        if exceeded and not response_started:
            await _json(413, "Request body too large")(scope, receive, send)


# --------------------------------------------------------------------------- app factory
def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()  # fails fast on missing/weak configuration
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.model = load_model(settings)
        logger.info("Model loaded (version %s)", app.state.model.version)
        yield

    # No interactive docs / OpenAPI schema: smaller attack surface.
    app = FastAPI(title="commentlens-inference", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    # Innermost first; the last one added is outermost.
    app.add_middleware(BodyLimitMiddleware, max_bytes=MAX_BODY_BYTES)
    app.add_middleware(InternalAuthMiddleware, token=settings.internal_api_token)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.host_list)
    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Deliberately omit `input`/`ctx`: never reflect (or log) comment text.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse({"detail": "Invalid request", "errors": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.error("Unhandled error: %s", type(exc).__name__)  # type only, never request content
        return _json(500, "Internal error")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/predict/batch", response_model=BatchResponse)
    def predict_batch(payload: BatchRequest, request: Request) -> BatchResponse:
        bundle: ModelBundle = request.app.state.model
        cleaned = [normalize_text(c.text) for c in payload.comments]
        keep = [i for i, t in enumerate(cleaned) if t]
        rows: dict[int, list[float]] = {}
        if keep:
            probs = bundle.pipeline.predict_proba([cleaned[i] for i in keep])
            rows = {i: [float(p) for p in row] for i, row in zip(keep, probs)}

        results = []
        for i, comment in enumerate(payload.comments):
            row = rows.get(i, [0.0] * len(LABELS))  # nothing to score after normalisation
            categories = {label: round(p, 4) for label, p in zip(LABELS, row)}
            results.append(CommentOut(id=comment.id,
                                      toxicity=round(aggregate_toxicity(list(categories.values())), 4),
                                      categories=categories))
        return BatchResponse(results=results, model_version=bundle.version)

    return app