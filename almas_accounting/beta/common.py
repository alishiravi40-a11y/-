from __future__ import annotations

import hashlib
import re

FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def norm(s) -> str:
    s = "" if s is None else str(s)
    s = re.sub(r"[‎‏‪-‮]", "", s)               # bidi marks (bank exports)
    return re.sub(r"\s+", " ", s.translate(FA).replace("ي", "ی").replace("ك", "ک").replace("‌", " ")).strip()


def name_key(s) -> str:
    s = re.sub(r"\(\s*بتا\s*\)|بتا\s*\)|\(\s*بتا", "", norm(s))
    return re.sub(r"[\s()\-_.]+", "", s)


def amount(x) -> int:
    if isinstance(x, (int, float)):
        return int(round(x))
    s = norm(x).replace(",", "")
    return int(round(float(s))) if s else 0


def national_code(x) -> str | None:
    s = norm(x)
    return s.zfill(10) if re.fullmatch(r"\d{8,10}", s) else None


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def find_party(conn, nc: str | None):
    """Party by national code: verified id, then claim, then Holoo legacy code; follows merges."""
    if not nc:
        return None
    row = conn.execute("""
      SELECT id FROM (
        SELECT id, 1 k FROM core.party WHERE national_id = %(nc)s
        UNION ALL SELECT id, 2 FROM core.party WHERE national_id_claim = %(nc)s
        UNION ALL SELECT party_id, 3 FROM core.party_legacy_code WHERE lpad(legacy_national_code, 10, '0') = %(nc)s) z
      ORDER BY k, id LIMIT 1""", {"nc": nc}).fetchone()
    pid = row[0] if row else None
    while pid is not None:
        nxt = conn.execute("SELECT merged_into_id FROM core.party WHERE id = %s", (pid,)).fetchone()[0]
        if nxt is None:
            return pid
        pid = nxt
    return None


def make_national_id(prefix9: str) -> str:
    """A checksum-valid Iranian national id from a 9-digit prefix (used by tests and synthetic data)."""
    s = sum(int(prefix9[i]) * (10 - i) for i in range(9)) % 11
    return prefix9 + str(s if s < 2 else 11 - s)
