"""Train the baseline toxicity model (TF-IDF + logistic regression).

Usage:
    python train_baseline.py --train-csv data/train.csv

Expects the Jigsaw Toxic Comment Classification `train.csv`
(columns: comment_text, toxic, severe_toxic, obscene, threat, insult, identity_hate).
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

LABELS = ["toxic", "severe_toxic", "obscene", "threat", "insult", "identity_hate"]
TEXT_COLUMN = "comment_text"
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"


def build_pipeline() -> Pipeline:
    return Pipeline(
        steps=[
            (
                "tfidf",
                TfidfVectorizer(
                    lowercase=True,
                    strip_accents="unicode",
                    ngram_range=(1, 2),
                    min_df=3,
                    max_features=200_000,
                    sublinear_tf=True,
                ),
            ),
            (
                "clf",
                OneVsRestClassifier(
                    LogisticRegression(C=4.0, solver="liblinear", class_weight="balanced"),
                    n_jobs=-1,
                ),
            ),
        ]
    )


def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in [TEXT_COLUMN, *LABELS] if c not in df.columns]
    if missing:
        raise SystemExit(f"{path} is missing required columns: {missing}")
    df[TEXT_COLUMN] = df[TEXT_COLUMN].fillna("").astype(str)
    return df


def evaluate(model: Pipeline, x_test: pd.Series, y_test: pd.DataFrame) -> None:
    probs = model.predict_proba(x_test)
    print(f"{'label':<15}{'ROC-AUC':>9}{'PR-AUC':>9}")
    for i, label in enumerate(LABELS):
        y_true = y_test[label].to_numpy()
        if y_true.min() == y_true.max():
            print(f"{label:<15}{'n/a':>9}{'n/a':>9}")
            continue
        roc = roc_auc_score(y_true, probs[:, i])
        pr = average_precision_score(y_true, probs[:, i])
        print(f"{label:<15}{roc:>9.4f}{pr:>9.4f}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-csv", type=Path, required=True)
    parser.add_argument("--test-size", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    df = load_data(args.train_csv)
    x_train, x_test, y_train, y_test = train_test_split(
        df[TEXT_COLUMN],
        df[LABELS],
        test_size=args.test_size,
        random_state=args.seed,
        stratify=df["toxic"],
    )

    model = build_pipeline()
    model.fit(x_train, y_train)
    evaluate(model, x_test, y_test)

    ARTIFACT_DIR.mkdir(exist_ok=True)
    out_path = ARTIFACT_DIR / "toxicity_baseline.joblib"
    joblib.dump({"pipeline": model, "labels": LABELS}, out_path)
    print(f"Saved model to {out_path}")


if __name__ == "__main__":
    main()
