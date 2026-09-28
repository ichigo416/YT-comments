"""Train the TF-IDF + one-vs-rest Logistic Regression baseline.

Usage:  python train_baseline.py --data data/train.csv
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import FeatureUnion, Pipeline

from artifact import save_artifact
from config import ARTIFACT_DIR, DATA_PATH, LABELS, RANDOM_SEED, TEST_SIZE, TEXT_COLUMN
from preprocessing import normalize_text


def load_dataset(path: Path, max_rows: int | None = None) -> pd.DataFrame:
    """Load and validate the Jigsaw CSV. Adds a normalised `text` column."""
    if not path.is_file():
        raise FileNotFoundError(f"Dataset not found: {path}")
    df = pd.read_csv(path, usecols=[TEXT_COLUMN, *LABELS], nrows=max_rows)  # ValueError if a column is missing

    df = df[df[TEXT_COLUMN].map(lambda v: isinstance(v, str))]
    for label in LABELS:
        df[label] = pd.to_numeric(df[label], errors="coerce")
    df = df.dropna(subset=list(LABELS))
    df = df[df[list(LABELS)].isin([0, 1]).all(axis=1)].copy()
    df[list(LABELS)] = df[list(LABELS)].astype(int)

    df["text"] = df[TEXT_COLUMN].map(normalize_text)
    df = df[df["text"].str.len() > 0]
    if df.empty:
        raise ValueError("No valid rows remain after validation.")
    return df.reset_index(drop=True)


def split_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Deterministic split, reused by evaluate.py so both use the same test set."""
    return train_test_split(df, test_size=TEST_SIZE, random_state=RANDOM_SEED, stratify=df[LABELS[0]])


def build_pipeline() -> Pipeline:
    features = FeatureUnion(
        [
            ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=100_000,
                                     sublinear_tf=True, strip_accents="unicode")),
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, max_features=100_000,
                                     sublinear_tf=True)),
        ]
    )
    classifier = OneVsRestClassifier(LogisticRegression(C=4.0, solver="liblinear", max_iter=200), n_jobs=-1)
    return Pipeline([("tfidf", features), ("clf", classifier)])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA_PATH)
    parser.add_argument("--out", type=Path, default=ARTIFACT_DIR)
    parser.add_argument("--max-rows", type=int, default=None, help="Smoke-test on the first N rows.")
    args = parser.parse_args()

    df = load_dataset(args.data, args.max_rows)
    train_df, test_df = split_dataset(df)
    print(f"Rows: total={len(df)} train={len(train_df)} test={len(test_df)}")

    pipeline = build_pipeline()
    pipeline.fit(train_df["text"], train_df[list(LABELS)].to_numpy())

    manifest = save_artifact(
        pipeline,
        args.out,
        {
            "random_seed": RANDOM_SEED,
            "test_size": TEST_SIZE,
            "train_rows": len(train_df),
            "test_rows": len(test_df),
            "aggregation": "toxicity = max(label probabilities)",
        },
    )
    print(f"Saved model to {args.out} (sha256={manifest['sha256']})")


if __name__ == "__main__":
    main()