"""Text normalization for Holoo data.

Holoo stores Persian text in varchar (cp1256 via Arabic_CI_AS collation) and nvarchar. Some rows were
written through a wrong code page and come back as mojibake such as 'ÚäæÇä ÍÓÇÈ' instead of 'عنوان حساب'.
`repair_mojibake` reverses that when (and only when) the result is clearly Persian/Arabic text.
`search_key` builds a comparison key (Arabic ي/ك → Persian ی/ک, ZWNJ/whitespace folding) without altering
the stored value.
"""
from __future__ import annotations

import re

_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN1_HI = re.compile(r"[À-ÿ]")


def _arabic_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if _ARABIC.match(c)) / len(letters)


def looks_mojibake(s: str | None) -> bool:
    if not s:
        return False
    return not _ARABIC.search(s) and len(_LATIN1_HI.findall(s)) >= max(3, len(s.replace(" ", "")) // 3)


def repair_mojibake(s: str | None) -> str | None:
    if not looks_mojibake(s):
        return s
    try:
        fixed = s.encode("latin-1").decode("cp1256")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
    return fixed if _arabic_ratio(fixed) >= 0.6 else s


_FOLD = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "‌": " ", "أ": "ا", "إ": "ا", "آ": "ا"})
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def search_key(s: str | None) -> str | None:
    if s is None:
        return None
    s = s.translate(_FOLD).translate(_DIGITS)
    return re.sub(r"\s+", " ", s).strip().lower()


def clean(s: str | None) -> str | None:
    """Stored-value cleaning: mojibake repair + trim. Does NOT fold letters."""
    if s is None:
        return None
    r = repair_mojibake(s)
    return r.strip() if isinstance(r, str) else r


_ORDER_RE = re.compile(r"/\s*(\d{5,9})\s*$")


def web_order_number(comment: str | None) -> str | None:
    """Web-shop order number embedded at the end of the invoice comment: '<operator>/<digits>'."""
    if not comment:
        return None
    m = _ORDER_RE.search(comment.strip())
    return m.group(1) if m else None
