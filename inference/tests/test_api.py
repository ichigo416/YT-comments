import hashlib
import json
import sys
from pathlib import Path

import joblib
import pytest
import sklearn
from fastapi.testclient import TestClient
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import preprocessing  # noqa: E402
from app import (LABELS, MAX_BATCH_SIZE, MAX_BODY_BYTES, MODEL_FILENAME, Settings,  # noqa: E402
                 create_app, load_model)

TOKEN = "t" * 40
HEADERS = {"X-Internal-Token": TOKEN}


def _sha(path: Path, normalise: bool = False) -> str:
    data = path.read_bytes()
    if normalise:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


@pytest.fixture(scope="module")
def model_dir(tmp_path_factory) -> Path:
    texts = ["you are a stupid idiot", "hate you moron", "great video thanks", "lovely music, subscribed"] * 10
    y = [[1] * 6, [1] * 6, [0] * 6, [0] * 6] * 10
    pipe = Pipeline([("tfidf", TfidfVectorizer()), ("clf", OneVsRestClassifier(LogisticRegression()))]).fit(texts, y)
    out = tmp_path_factory.mktemp("model")
    joblib.dump(pipe, out / MODEL_FILENAME)
    (out / "manifest.json").write_text(json.dumps({
        "sha256": _sha(out / MODEL_FILENAME),
        "labels": list(LABELS),
        "sklearn_version": sklearn.__version__,
        "preprocessing_sha256": _sha(Path(preprocessing.__file__), normalise=True),
    }))
    return out


def make_settings(model_dir: Path, **kw) -> Settings:
    base = dict(internal_api_token=TOKEN, model_dir=model_dir, allowed_hosts="testserver,localhost")
    base.update(kw)
    return Settings(_env_file=None, **base)


@pytest.fixture()
def client(model_dir):
    with TestClient(create_app(make_settings(model_dir))) as c:
        yield c


def body(*texts):
    return {"comments": [{"id": f"c{i}", "text": t} for i, t in enumerate(texts)]}


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "wrong"}, {"X-Internal-Token": TOKEN + "x"}])
def test_auth_required(client, headers):
    assert client.post("/predict/batch", json=body("hi"), headers=headers).status_code == 401


def test_predict_ok_and_aggregation(client):
    r = client.post("/predict/batch", json=body("you are a stupid idiot", "great video thanks"), headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert [x["id"] for x in data["results"]] == ["c0", "c1"]
    first = data["results"][0]
    assert first["toxicity"] == max(first["categories"].values())
    assert first["toxicity"] > data["results"][1]["toxicity"]
    assert set(first["categories"]) == set(LABELS) and len(data["model_version"]) == 12


def test_text_empty_after_normalisation_scores_zero(client):
    r = client.post("/predict/batch", json=body("\u200b\u200b"), headers=HEADERS)
    assert r.status_code == 200 and r.json()["results"][0]["toxicity"] == 0.0


@pytest.mark.parametrize("payload", [
    {"comments": []},
    {"comments": [{"id": f"c{i}", "text": "x"} for i in range(MAX_BATCH_SIZE + 1)]},
    {"comments": [{"id": "a", "text": "x"}, {"id": "a", "text": "y"}]},
    {"comments": [{"id": "bad id!", "text": "x"}]},
    {"comments": [{"id": "a", "text": ""}]},
    {"comments": [{"id": "a", "text": "x" * 2001}]},
    {"comments": [{"id": "a", "text": "x", "extra": 1}]},
    {"comments": [{"id": 1, "text": "x"}]},
    {"comments": [{"id": "a", "text": 5}]},
    {"comments": "nope"},
])
def test_validation_rejects(client, payload):
    r = client.post("/predict/batch", json=payload, headers=HEADERS)
    assert r.status_code == 422


def test_validation_error_does_not_echo_input(client):
    secret = "SECRET-COMMENT-TEXT-" + "x" * 2100
    r = client.post("/predict/batch", json={"comments": [{"id": "a", "text": secret}]}, headers=HEADERS)
    assert r.status_code == 422 and "SECRET-COMMENT-TEXT" not in r.text


def test_body_limit_content_length(client):
    big = b"{" + b" " * (MAX_BODY_BYTES + 10) + b"}"
    r = client.post("/predict/batch", content=big, headers={**HEADERS, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_body_limit_chunked(client):
    def chunks():
        for _ in range(MAX_BODY_BYTES // 65536 + 3):
            yield b" " * 65536
    r = client.post("/predict/batch", content=chunks(), headers={**HEADERS, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_docs_disabled(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path, headers=HEADERS).status_code == 404


def test_unknown_host_rejected(client):
    assert client.get("/health", headers={"Host": "evil.example"}).status_code == 400


def test_wrong_method_and_path(client):
    assert client.get("/predict/batch", headers=HEADERS).status_code == 405
    assert client.post("/nope", headers=HEADERS).status_code == 404


def test_weak_or_missing_token_rejected(model_dir):
    for bad in ("short", "change-me-" + "x" * 40):
        with pytest.raises(Exception):
            make_settings(model_dir, internal_api_token=bad)
    with pytest.raises(Exception):
        Settings(_env_file=None, model_dir=model_dir)


def test_production_requires_hash_pin(model_dir):
    with pytest.raises(Exception):
        make_settings(model_dir, environment="production")


def test_pinned_hash_mismatch_fails_closed(model_dir):
    with pytest.raises(RuntimeError, match="hash mismatch"):
        load_model(make_settings(model_dir, model_sha256="0" * 64))


def test_tampered_model_fails_closed(model_dir, tmp_path):
    import shutil
    copy = tmp_path / "m"
    shutil.copytree(model_dir, copy)
    (copy / MODEL_FILENAME).write_bytes((copy / MODEL_FILENAME).read_bytes() + b"\x00")
    with pytest.raises(RuntimeError, match="hash mismatch"):
        load_model(make_settings(copy))


def test_preprocessing_mismatch_fails_closed(model_dir, tmp_path):
    import shutil
    copy = tmp_path / "p"
    shutil.copytree(model_dir, copy)
    manifest = json.loads((copy / "manifest.json").read_text())
    manifest["preprocessing_sha256"] = "f" * 64
    (copy / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(RuntimeError, match="preprocessing"):
        load_model(make_settings(copy))


def test_sklearn_version_mismatch_fails_closed(model_dir, tmp_path):
    import shutil
    copy = tmp_path / "v"
    shutil.copytree(model_dir, copy)
    manifest = json.loads((copy / "manifest.json").read_text())
    manifest["sklearn_version"] = "0.0.1"
    (copy / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(RuntimeError, match="scikit-learn"):
        load_model(make_settings(copy))


def test_preprocessing_identical_to_ml_copy():
    ml_copy = ROOT.parent / "ml" / "preprocessing.py"
    if not ml_copy.exists():
        pytest.skip("ml/ not present (e.g. inside Docker)")
    norm = lambda p: p.read_bytes().replace(b"\r\n", b"\n")
    assert norm(ml_copy) == norm(Path(preprocessing.__file__)) 