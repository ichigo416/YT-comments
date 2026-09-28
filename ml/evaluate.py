"""Evaluate the saved model on the held-out test split.

Usage:  python evaluate.py --data data/train.csv [--show-errors 5]
Writes artifacts/metrics.json (contains no comment text).
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_recall_fscore_support, roc_auc_score)

from artifact import load_artifact
from config import ARTIFACT_DIR, DATA_PATH, DEFAULT_THRESHOLD, LABELS, METRICS_FILENAME
from train_baseline import load_dataset, split_dataset

THRESHOLDS = [round(t, 1) for t in np.arange(0.1, 0.91, 0.1)]
IDENTITY_TERMS = ["muslim", "jewish", "christian", "gay", "lesbian", "black", "white",
                  "asian", "woman", "women", "man", "men", "transgender", "american"]
MIN_TERM_SAMPLES = 30


def _binary_metrics(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    y_pred = (scores >= threshold).astype(int)
    p, r, f, _ = precision_recall_fscore_support(y_true, y_pred, average="binary", zero_division=0)
    out: dict[str, Any] = {
        "precision": float(p), "recall": float(r), "f1": float(f), "support": int(y_true.sum()),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
    }
    if y_true.min() != y_true.max():  # AUC is undefined with a single class
        out["roc_auc"] = float(roc_auc_score(y_true, scores))
        out["pr_auc"] = float(average_precision_score(y_true, scores))
    return out


def evaluate(pipeline: Any, test_df: pd.DataFrame, threshold: float = DEFAULT_THRESHOLD) -> tuple[dict[str, Any], np.ndarray]:
    y_true = test_df[list(LABELS)].to_numpy()
    probs = pipeline.predict_proba(test_df["text"])
    y_pred = (probs >= threshold).astype(int)
    overall = probs.max(axis=1)  # documented aggregation rule
    y_any = y_true.max(axis=1)

    report: dict[str, Any] = {
        "threshold": threshold,
        "micro_f1": float(f1_score(y_true, y_pred, average="micro", zero_division=0)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "per_label": {label: _binary_metrics(y_true[:, i], probs[:, i], threshold) for i, label in enumerate(LABELS)},
        "aggregate_toxicity_vs_any_label": _binary_metrics(y_any, overall, threshold),
    }

    sweep: dict[str, Any] = {}
    for i, label in enumerate(LABELS):
        f1s = {str(t): float(f1_score(y_true[:, i], (probs[:, i] >= t).astype(int), zero_division=0)) for t in THRESHOLDS}
        best = max(f1s, key=f1s.get)
        sweep[label] = {"f1_by_threshold": f1s, "best_threshold": float(best), "best_f1": f1s[best]}
    report["threshold_analysis"] = sweep
    report["threshold_note"] = "Sweep is computed on the test set: descriptive only, optimistic if used to pick thresholds."

    # Bias probe: false-positive rate on NON-toxic comments that merely mention an identity term.
    non_toxic = y_any == 0
    bias: dict[str, Any] = {}
    for term in IDENTITY_TERMS:
        mask = non_toxic & test_df["text"].str.contains(rf"\b{re.escape(term)}\b", case=False, regex=True).to_numpy()
        if mask.sum() >= MIN_TERM_SAMPLES:
            bias[term] = {"n": int(mask.sum()), "false_positive_rate": float((overall[mask] >= threshold).mean())}
    report["identity_term_false_positive_rates"] = bias
    report["baseline_false_positive_rate_non_toxic"] = float((overall[non_toxic] >= threshold).mean())
    return report, probs


def print_errors(test_df: pd.DataFrame, probs: np.ndarray, n: int) -> None:
    """Local-only error inspection (prints dataset text; never used by the services)."""
    overall = probs.max(axis=1)
    any_toxic = test_df[list(LABELS)].to_numpy().max(axis=1) == 1
    fp = np.argsort(-np.where(~any_toxic, overall, -1))[:n]
    fn = np.argsort(np.where(any_toxic, overall, 2))[:n]
    for title, idx in (("Top false positives", fp), ("Top false negatives", fn)):
        print(f"\n{title}:")
        for i in idx:
            print(f"  score={overall[i]:.3f}  {test_df['text'].iloc[i][:100]!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA_PATH)
    parser.add_argument("--artifacts", type=Path, default=ARTIFACT_DIR)
    parser.add_argument("--max-rows", type=int, default=None, help="Must match the value used in training, if any.")
    parser.add_argument("--show-errors", type=int, default=0)
    args = parser.parse_args()

    pipeline, manifest = load_artifact(args.artifacts)
    _, test_df = split_dataset(load_dataset(args.data, args.max_rows))
    if len(test_df) != manifest["test_rows"]:
        raise SystemExit("Test split size differs from training; wrong dataset or --max-rows value.")

    report, probs = evaluate(pipeline, test_df)
    (args.artifacts / METRICS_FILENAME).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"micro F1={report['micro_f1']:.4f}  macro F1={report['macro_f1']:.4f}  (threshold {report['threshold']})")
    for label, m in report["per_label"].items():
        print(f"{label:14s} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f} AUC={m.get('roc_auc', float('nan')):.4f}")
    if args.show_errors:
        print_errors(test_df, probs, args.show_errors)
    print(f"\nFull report: {args.artifacts / METRICS_FILENAME}")


if __name__ == "__main__":
    main() 