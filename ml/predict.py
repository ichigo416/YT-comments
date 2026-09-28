"""Predict from the command line.

Usage:  python predict.py "This movie was amazing!" "You are an idiot."
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from artifact import load_artifact
from config import ARTIFACT_DIR, LABELS
from preprocessing import normalize_text

MAX_TEXTS = 100


def aggregate_toxicity(probabilities: list[float]) -> float:
    """Documented rule: overall toxicity is the highest label probability."""
    return max(probabilities)


def predict_texts(pipeline: Any, texts: list[str]) -> list[dict[str, Any]]:
    cleaned = [normalize_text(t) for t in texts]
    probs = pipeline.predict_proba(cleaned)
    results = []
    for row in probs:
        categories = {label: round(float(p), 4) for label, p in zip(LABELS, row)}
        results.append({"toxicity": round(aggregate_toxicity(list(categories.values())), 4), "categories": categories})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("texts", nargs="+")
    parser.add_argument("--artifacts", type=Path, default=ARTIFACT_DIR)
    args = parser.parse_args()
    if len(args.texts) > MAX_TEXTS:
        raise SystemExit(f"At most {MAX_TEXTS} texts per call.")
    pipeline, _ = load_artifact(args.artifacts)
    print(json.dumps(predict_texts(pipeline, args.texts), indent=2))


if __name__ == "__main__":
    main() 