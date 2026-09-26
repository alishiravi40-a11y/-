"""Parser for ADO "Advanced Data TableGram" (ADTG) recordsets stored by Holoo in Process.Blob.

Layout (reverse-engineered from holoo1_1404; see reverse_engineering/hesabdari_rasmi/evidence/E12):
  header ... then tokens:
    0x05 <u16 len> table descriptor
    0x06 <u16 len> column descriptor: mask(3) ordinal(u16) name(u16 nchars + UTF-16LE)
                   [if mask & 0x02: base_table(u16) base_col(u16) base_name(u16 nchars + UTF-16LE)]
                   dbtype(u16) maxlen(u32) precision(u32) scale(u32) flags(u32) ...
    0x07 row: presence bitmap over the NULLABLE columns only (flags & 0x60), ceil(n_nullable/8) bytes, MSB first (first nullable column = high bit of byte 0),
         bit=1 → value present; non-nullable columns are always present. Then values in column order.
    0x0F end of rowset
Value encoding by OLE DB type: fixed-size numerics; DBTIMESTAMP = 16 bytes; strings: fixed-length columns
(flag 0x10) take maxlen units, otherwise a length prefix of 1 byte (max byte length ≤ 255) or 4 bytes.
varchar data is cp1256 (Arabic_CI_AS), nvarchar UTF-16LE.
Columns whose name looks like a password are parsed but never returned.
"""
from __future__ import annotations

import datetime as _dt
import re
import struct

SECRET = re.compile(r"pas+word|pwd", re.I)
FIXED = {2: "<h", 3: "<i", 4: "<f", 5: "<d", 6: "<q", 7: "<d", 11: "<h", 16: "<b", 17: "<B", 18: "<H", 19: "<I", 20: "<q", 21: "<Q"}
FLAG_FIXEDLEN, FLAG_LONG, FLAG_NULLABLE = 0x10, 0x80, 0x60


class ADTGError(ValueError):
    pass


def _u16(b, i):
    return struct.unpack_from("<H", b, i)[0]


def _u32(b, i):
    return struct.unpack_from("<I", b, i)[0]


def _wstr(b, i):
    n = _u16(b, i)
    if n == 0xFFFF:
        return None, i + 2
    return b[i + 2:i + 2 + 2 * n].decode("utf-16-le"), i + 2 + 2 * n


def parse_column(d: bytes) -> dict:
    mask = d[0] | (d[1] << 8) | (d[2] << 16)
    i = 3
    ordinal = _u16(d, i); i += 2
    name, i = _wstr(d, i)
    base_table = base_col = base_name = None
    if mask & 0x02:
        base_table = _u16(d, i); base_col = _u16(d, i + 2); i += 4
        base_name, i = _wstr(d, i)
    dbtype = _u16(d, i); maxlen = _u32(d, i + 2); precision = _u32(d, i + 6); scale = _u32(d, i + 10); flags = _u32(d, i + 14)
    return {"ordinal": ordinal, "name": name, "base_table": base_table, "base_column": base_name, "dbtype": dbtype,
            "maxlen": maxlen, "precision": precision, "scale": scale, "flags": flags}


def parse_table(d: bytes) -> dict:
    ordinal = _u16(d, 0)
    qualified, i = _wstr(d, 2)
    name, i = _wstr(d, i)
    return {"ordinal": ordinal, "qualified": qualified, "name": name}


def _read_value(b: bytes, i: int, c: dict):
    t, ml, fl = c["dbtype"], c["maxlen"], c["flags"]
    if t in FIXED:
        fmt = FIXED[t]; n = struct.calcsize(fmt)
        v = struct.unpack_from(fmt, b, i)[0]
        return (bool(v) if t == 11 else v), i + n
    if t == 135:  # DBTIMESTAMP
        y, mo, d, h, mi, s, frac = struct.unpack_from("<hHHHHHI", b, i)
        try:
            v = _dt.datetime(y, mo, d, h, mi, s, frac // 1000)
        except ValueError:
            v = None
        return v, i + 16
    if t == 133:  # DBDATE
        y, mo, d = struct.unpack_from("<hHH", b, i)
        return _dt.date(y, mo, d), i + 6
    if t == 72:  # GUID
        return b[i:i + 16].hex(), i + 16
    if t in (128, 129, 130):
        unit = 2 if t == 130 else 1
        if fl & FLAG_FIXEDLEN and not fl & FLAG_LONG:
            n = ml * unit
        elif not fl & FLAG_LONG and ml * unit <= 255:
            n = b[i]; i += 1
        else:
            n = _u32(b, i); i += 4
        raw = b[i:i + n]
        if t == 129:
            v = raw.decode("cp1256", errors="replace")
        elif t == 130:
            v = raw.decode("utf-16-le", errors="replace")
        else:
            v = raw.hex()
        return v, i + n
    raise ADTGError(f"unsupported OLE DB type {t} in column {c['name']}")


def _keys(cols, tables):
    tmap = {t["ordinal"]: t["name"] for t in tables}
    names = [c["name"] for c in cols]
    return [c["name"] if names.count(c["name"]) == 1 else f"{tmap.get(c['base_table'], '?')}.{c['name']}" for c in cols]


def parse(blob: bytes) -> dict:
    """Return {'tables': [...], 'columns': [...], 'rows': [dict, ...]} (secret columns removed)."""
    if blob[1:4] != b"\x07TG" and b"TG!" not in blob[:8]:
        raise ADTGError("not an ADTG stream")
    # locate the first descriptor token: a 0x05 token whose payload decodes as a table descriptor
    i = blob.find(b"\x05", 8)
    tables, cols, rows = [], [], []
    while i != -1:
        try:
            ln = _u16(blob, i + 1)
            t = parse_table(blob[i + 3:i + 3 + ln])
            if t["qualified"] and t["qualified"].startswith('"'):
                break
        except Exception:
            pass
        i = blob.find(b"\x05", i + 1)
    if i == -1:
        if len(blob) < 64:  # header-only stream (e.g. login events): empty recordset
            return {"tables": [], "columns": [], "rows": []}
        raise ADTGError("no table descriptor found")
    while i < len(blob):
        tok = blob[i]
        if tok == 0x05:
            ln = _u16(blob, i + 1); tables.append(parse_table(blob[i + 3:i + 3 + ln])); i += 3 + ln
        elif tok == 0x06:
            ln = _u16(blob, i + 1); cols.append(parse_column(blob[i + 3:i + 3 + ln])); i += 3 + ln
        elif tok == 0x07:
            if not rows:
                keys = _keys(cols, tables)
            nullable = [bool(c["flags"] & FLAG_NULLABLE) for c in cols]
            nb = (sum(nullable) + 7) // 8
            bitmap = int.from_bytes(blob[i + 1:i + 1 + nb], "big")
            top = nb * 8 - 1
            i += 1 + nb
            row = {}
            bit = 0
            for k, c in enumerate(cols):
                v = None
                present = True
                if nullable[k]:
                    present = bool(bitmap >> (top - bit) & 1); bit += 1
                if present:
                    v, i = _read_value(blob, i, c)
                if not SECRET.search(c["name"] or ""):
                    row[keys[k]] = v
            rows.append(row)
        elif tok == 0x0F:
            if i != len(blob) - 1:
                raise ADTGError(f"end marker at {i} but stream length is {len(blob)}")
            break
        else:
            raise ADTGError(f"unexpected token 0x{tok:02x} at offset {i}")
    tmap = {t["ordinal"]: t["name"] for t in tables}
    for c in cols:
        c["table"] = tmap.get(c["base_table"])
    return {"tables": tables, "columns": [c for c in cols if not SECRET.search(c["name"] or "")], "rows": rows}
