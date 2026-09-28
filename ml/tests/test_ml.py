import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from artifact import ArtifactIntegrityError, load_artifact, save_artifact  # noqa: E402
from config import LABELS  # noqa: E402
from predict import aggregate_toxicity, predict_texts  # noqa: E402
from preprocessing import MAX_CHARS, normalize_text  # noqa: E402
from train_baseline import build_pipeline, load_dataset, split_dataset  # noqa: E402


def test_normalize_basics():
    assert normalize_text("  Hello \n\t  World  ") == "Hello World"
    assert normalize_text("ｆｕｌｌ") == "full"  # NFKC
    assert normalize_text("i\u200bd\u200bi\u200bo\u200bt") == "idiot"  # zero-width removed
    assert normalize_text("see https://evil.example/x?y=1 now") == "see urltoken now"
    assert normalize_text(None) == "" and normalize_text(42) == ""
    assert len(normalize_text("a" * 10_000)) == MAX_CHARS
    once = normalize_text("  Mixed   CASE!!  ")
    assert normalize_text(once) == once  # idempotent; punctuation and case kept
    assert "!!" in once


def _write_csv(path: Path, rows: list[list]) -> Path:
    header = ["id", "comment_text", *LABELS]
    lines = [",".join(header)] + [",".join(str(c) for c in r) for r in rows]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_load_dataset_filters_invalid_rows(tmp_path):
    zeros = [0] * 6
    csv = _write_csv(tmp_path / "d.csv", [
        [1, "good comment", *zeros],
        [2, "", *zeros],                       # empty text -> dropped
        [3, "bad label", 2, 0, 0, 0, 0, 0],    # label not 0/1 -> dropped
        [4, "another fine one", 1, 0, 0, 0, 0, 0],
    ])
    df = load_dataset(csv)
    assert list(df["text"]) == ["good comment", "another fine one"]


def test_load_dataset_missing_column(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("id,comment_text\n1,hello\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_dataset(bad)
    with pytest.raises(FileNotFoundError):
        load_dataset(tmp_path / "nope.csv")


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    import pandas as pd
    rows = []
    for i in range(60):
        toxic = i % 2 == 0
        text = "you are a stupid idiot hate" if toxic else "great video thanks for sharing lovely"
        rows.append({"text": f"{text} {i % 5}", **{l: int(toxic) for l in LABELS}})
    df = pd.DataFrame(rows)
    pipe = build_pipeline().fit(df["text"], df[list(LABELS)].to_numpy())
    out = tmp_path_factory.mktemp("art")
    manifest = save_artifact(pipe, out, {"test_rows": 1})
    return pipe, out, manifest


def test_roundtrip_and_prediction(trained):
    _, out, manifest = trained
    pipe, _ = load_artifact(out, expected_sha256=manifest["sha256"])
    res = predict_texts(pipe, ["you are a stupid idiot", "great video thanks"])
    assert res[0]["toxicity"] > res[1]["toxicity"]
    assert set(res[0]["categories"]) == set(LABELS)
    assert res[0]["toxicity"] == max(res[0]["categories"].values())


def test_tampered_artifact_is_rejected(trained, tmp_path):
    import shutil
    _, out, _ = trained
    copy = tmp_path / "copy"
    shutil.copytree(out, copy)
    model = copy / "toxicity_baseline.joblib"
    model.write_bytes(model.read_bytes() + b"\x00")
    with pytest.raises(ArtifactIntegrityError):
        load_artifact(copy)


def test_wrong_pinned_hash_is_rejected(trained):
    _, out, _ = trained
    with pytest.raises(ArtifactIntegrityError):
        load_artifact(out, expected_sha256="0" * 64)


def test_changed_preprocessing_hash_is_rejected(trained, tmp_path):
    import shutil
    _, out, _ = trained
    copy = tmp_path / "copy2"
    shutil.copytree(out, copy)
    manifest_path = copy / "manifest.json"
    data = json.loads(manifest_path.read_text())
    data["preprocessing_sha256"] = "f" * 64
    manifest_path.write_text(json.dumps(data))
    with pytest.raises(ArtifactIntegrityError):
        load_artifact(copy)


def test_split_is_deterministic(tmp_path):
    zeros = [0] * 6
    rows = [[i, f"comment number {i}", 1 if i % 4 == 0 else 0, *zeros[1:]] for i in range(40)]
    df = load_dataset(_write_csv(tmp_path / "s.csv", rows))
    a, b = split_dataset(df), split_dataset(df)
    assert list(a[1]["text"]) == list(b[1]["text"])


def test_aggregate():
    assert aggregate_toxicity([0.1, 0.9, 0.3]) == 0.9 