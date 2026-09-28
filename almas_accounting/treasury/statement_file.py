"""Read a bank statement file (bank .xls / .xlsx export, or CSV / tab-separated text) into statement lines for
core.bank_statement_import. The header row is found by its Persian column names; nothing is guessed about a column
whose header is not recognised. Dates: Jalali (1405/07/05) or Gregorian (2026-09-27). Amounts: Persian or Latin
digits, with or without thousands separators.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re

import jdatetime

from beta.common import norm

COLUMNS = {                                   # canonical field ← header texts seen in bank exports
    "date": ("تاریخ", "تاریخ تراکنش", "تاریخ سند"),
    "time": ("زمان", "ساعت"),
    "doc_no": ("شماره سند", "شماره پیگیری", "سریال", "شماره مرجع", "کد پیگیری"),
    "branch": ("شعبه", "کد شعبه"),
    "deposit": ("واریز", "واریزی", "بستانکار", "مبلغ واریز"),
    "withdrawal": ("برداشت", "برداشتی", "بدهکار", "مبلغ برداشت"),
    "balance": ("موجودی", "مانده"),
    "deposit_id": ("شناسه واریز",),
    "description": ("توضیحات", "شرح", "شرح تراکنش", "بابت"),
}
REQUIRED = {"date", "deposit", "withdrawal"}


class StatementError(ValueError):
    pass


def _amount(v) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(round(v))
    s = norm(v).replace(",", "").replace("٬", "").replace("،", "").replace(" ", "")
    if s in ("", "-"):
        return None
    neg = s.startswith("(") and s.endswith(")") or s.endswith("-")
    s = s.strip("()-")
    try:
        n = int(round(float(s)))
    except ValueError:
        raise StatementError(f"مبلغ «{v}» عدد نیست")
    return -n if neg else n


def _date(v) -> tuple[dt.date, str] | None:
    if isinstance(v, dt.datetime):
        v = v.date()
    if isinstance(v, dt.date):
        return v, jdatetime.date.fromgregorian(date=v).strftime("%Y/%m/%d")
    s = norm(v)
    m = re.fullmatch(r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:\s.*)?", s)
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    if y > 1700:
        g = dt.date(y, mo, d)
        return g, jdatetime.date.fromgregorian(date=g).strftime("%Y/%m/%d")
    return jdatetime.date(y, mo, d).togregorian(), f"{y:04d}/{mo:02d}/{d:02d}"


def _rows(data: bytes, name: str) -> list[list]:
    low = name.lower()
    if low.endswith(".xls"):
        import xlrd
        sh = xlrd.open_workbook(file_contents=data).sheets()[0]
        return [sh.row_values(r) for r in range(sh.nrows)]
    if low.endswith(".xlsx"):
        import openpyxl
        ws = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True).worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    for enc in ("utf-8-sig", "cp1256", "utf-16"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise StatementError("کدگذاری متن فایل شناخته نشد؛ فایل Excel یا CSV با UTF-8 بفرستید")
    sample = text[:4000]
    delim = "\t" if sample.count("\t") >= sample.count(",") and "\t" in sample else ("؛" if "؛" in sample else (";" if sample.count(";") > sample.count(",") else ","))
    return list(csv.reader(io.StringIO(text), delimiter=delim))


def read_statement(data: bytes, name: str) -> list[dict]:
    rows = _rows(data, name)
    header, cols = None, {}
    for i, r in enumerate(rows[:30]):
        cells = [norm(c) for c in r]
        found = {f: cells.index(t) for f, texts in COLUMNS.items() for t in texts if t in cells}
        if REQUIRED <= set(found):
            header, cols = i, found
            break
    if header is None:
        raise StatementError("سطر عنوان ستون‌ها پیدا نشد؛ فایل باید ستون‌های «تاریخ»، «واریز» و «برداشت» داشته باشد")
    out = []
    for r in rows[header + 1:]:
        get = lambda f: r[cols[f]] if f in cols and cols[f] < len(r) else None
        d = _date(get("date"))
        if d is None:
            continue                                                  # totals, blank and footer rows
        dep, wd = _amount(get("deposit")) or 0, _amount(get("withdrawal")) or 0
        if dep < 0 or wd < 0:
            raise StatementError(f"مبلغ منفی در ردیف تاریخ {d[1]}")
        if dep == 0 and wd == 0:
            continue
        line = {"date": d[0].isoformat(), "jdate": d[1], "time": norm(get("time")), "doc_no": norm(get("doc_no")), "branch": norm(get("branch")),
                "deposit": dep, "withdrawal": wd, "balance": _amount(get("balance")), "deposit_id": norm(get("deposit_id")),
                "description": norm(get("description"))}
        # the same natural key as beta/statement_import (overlapping statements of one account add only new lines)
        line["natural_key"] = "|".join(str(line[k]) for k in ("doc_no", "jdate", "time", "deposit", "withdrawal", "balance"))
        out.append(line)
    if not out:
        raise StatementError("در فایل هیچ ردیف واریز یا برداشت پیدا نشد")
    return out


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
