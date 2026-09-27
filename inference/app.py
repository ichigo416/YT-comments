"""Internal inference service. Never expose this directly to the internet:
bind to 127.0.0.1 (or a private network) and let the Express gateway call it.
"""
from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import joblib
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints

MAX_BATCH = 50
MAX_TEXT_LENGTH = 1000
MIN_TOKEN_LENGTH = 32

logger = logging.getLogger("inference")
logging.basicConfig(level=logging.INFO)

CommentText = Annotated[str, StringConstraints(min_length=1, max_length=MAX_TEXT_LENGTH)]


class PredictRequest(BaseModel):
    texts: list[CommentText] = Field(min_length=1, max_length=MAX_BATCH)


class Score(BaseModel):
    toxicity: float = Field(ge=0.0, le=1.0)
    labels: dict[str, float]


class PredictResponse(BaseModel):
    scores: list[Score]


def _load_internal_token() -> str:
    token = os.environ.get("INTERNAL_TOKEN", "")
    if len(token) < MIN_TOKEN_LENGTH:
        raise RuntimeError(f"INTERNAL_TOKEN must be set and at least {MIN_TOKEN_LENGTH} characters long")
    return token


def _load_model(path: Path) -> dict:
    # joblib uses pickle: only ever load a file you trained yourself.
    if not path.is_file():
        raise RuntimeError(f"Model file not found: {path}")
    bundle = joblib.load(path)
    if not isinstance(bundle, dict) or "pipeline" not in bundle or "labels" not in bundle:
        raise RuntimeError("Model file has an unexpected format")
    return bundle


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.token = _load_internal_token()
    model_path = Path(os.environ.get("MODEL_PATH", "../ml/artifacts/toxicity_baseline.joblib")).resolve()
    app.state.model = _load_model(model_path)
    logger.info("Model loaded from %s", model_path)
    yield


# Interactive docs are disabled: this is an internal service.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def require_internal_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    expected: str = app.state.token
    provided = x_internal_token or ""
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# A plain `def` endpoint runs in FastAPI's threadpool, so CPU-bound
# scikit-learn inference does not block the event loop.
@app.post("/predict/batch", response_model=PredictResponse, dependencies=[Depends(require_internal_token)])
def predict_batch(payload: PredictRequest) -> PredictResponse:
    bundle = app.state.model
    labels: list[str] = bundle["labels"]
    probabilities = bundle["pipeline"].predict_proba(payload.texts)

    scores = []
    for row in probabilities:
        by_label = {label: round(float(p), 4) for label, p in zip(labels, row)}
        scores.append(Score(toxicity=by_label["toxic"], labels=by_label))
    return PredictResponse(scores=scores)
