"""Central configuration for the ML pipeline. Contains no secrets."""
from __future__ import annotations

import os
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent

LABELS: tuple[str, ...] = (
    "toxic",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
)
TEXT_COLUMN = "comment_text"

# Overridable through environment variables or CLI flags; never taken from request data.
DATA_PATH = Path(os.environ.get("ML_DATA_PATH", ML_DIR / "data" / "train.csv"))
ARTIFACT_DIR = Path(os.environ.get("ML_ARTIFACT_DIR", ML_DIR / "artifacts"))

# Fixed file names: the loader never reads a model path from the manifest or user input.
MODEL_FILENAME = "toxicity_baseline.joblib"
MANIFEST_FILENAME = "manifest.json"
METRICS_FILENAME = "metrics.json"

RANDOM_SEED = 42
TEST_SIZE = 0.2
DEFAULT_THRESHOLD = 0.5