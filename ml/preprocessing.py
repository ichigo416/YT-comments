"""Text normalisation shared by training and inference.

This file is copied byte-for-byte to inference/app/preprocessing.py. The training
manifest stores its SHA-256, and the inference service refuses to start if its copy
differs, which guarantees identical preprocessing on both sides.

Choices (all deliberate):
- NFKC normalisation folds look-alike / full-width characters.
- Control and zero-width (format) characters are removed; they are used to evade filters.
- URLs become one token; the exact address carries no toxicity signal.
- Case, punctuation and stop words are kept (TF-IDF lowercases; phrasing matters).
- Input is length-bounded before any regex work, so oversized input cannot burn CPU.
"""
from __future__ import annotations

import re
import unicodedata

MAX_CHARS = 2000

_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")
_DROPPED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn"})


def normalize_text(text: object) -> str:
    """Return a cleaned, length-bounded string. Non-strings yield an empty string."""
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKC", text[: MAX_CHARS * 4])
    kept: list[str] = []
    for ch in text:
        if ch in "\n\r\t":
            kept.append(" ")
        elif unicodedata.category(ch) in _DROPPED_CATEGORIES:
            continue
        else:
            kept.append(ch)
    text = _URL_RE.sub(" urltoken ", "".join(kept))
    text = _WS_RE.sub(" ", text).strip()
    return text[:MAX_CHARS] 