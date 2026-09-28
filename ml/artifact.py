"""Saving and loading the model artifact with integrity checks.

joblib files are pickles: loading one can execute code. Therefore only artifacts
produced by train_baseline.py may be loaded, and the SHA-256 is verified BEFORE
joblib.load is called. For deployment, pin the hash out-of-band (environment
variable / secret store) so a tampered artifact and manifest cannot agree.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import sklearn

import preprocessing
from config import LABELS, MANIFEST_FILENAME, MODEL_FILENAME


class ArtifactIntegrityError(RuntimeError):
    """Raised when the artifact, manifest or preprocessing code do not match."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_artifact(pipeline: Any, out_dir: Path, extra: dict[str, Any]) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    model_path = out_dir / MODEL_FILENAME
    joblib.dump(pipeline, model_path, compress=3)
    manifest = {
        "model_file": MODEL_FILENAME,
        "sha256": sha256_file(model_path),
        "labels": list(LABELS),
        "sklearn_version": sklearn.__version__,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "preprocessing_sha256": sha256_file(Path(preprocessing.__file__)),
        **extra,
    }
    (out_dir / MANIFEST_FILENAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def load_artifact(directory: Path, expected_sha256: str | None = None) -> tuple[Any, dict[str, Any]]:
    """Verify integrity, then load. Returns (pipeline, manifest)."""
    manifest_path = directory / MANIFEST_FILENAME
    model_path = directory / MODEL_FILENAME  # fixed name, never read from the manifest
    if not manifest_path.is_file() or not model_path.is_file():
        raise ArtifactIntegrityError("Model artifact or manifest is missing.")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pinned = (expected_sha256 or str(manifest.get("sha256", ""))).lower()
    if not hmac.compare_digest(sha256_file(model_path), pinned):
        raise ArtifactIntegrityError("Model artifact hash mismatch; refusing to load.")

    current_pre = sha256_file(Path(preprocessing.__file__))
    if not hmac.compare_digest(current_pre, str(manifest.get("preprocessing_sha256", ""))):
        raise ArtifactIntegrityError("Preprocessing code changed since training; retrain the model.")
    if manifest.get("labels") != list(LABELS):
        raise ArtifactIntegrityError("Artifact label set does not match configuration.")

    return joblib.load(model_path), manifest