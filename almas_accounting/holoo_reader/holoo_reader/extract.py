"""Extract (Bronze): every non-empty table → Parquet with a per-row SHA-256; secrets excluded; blobs split out."""
from __future__ import annotations

import datetime as _dt
import decimal
import hashlib
import os
import re

import pyarrow as pa
import pyarrow.parquet as pq

from .sqlserver import query

SECRET_COL = re.compile(r"pas+word|pwd", re.I)
BLOB_TYPES = {"image", "varbinary", "binary", "timestamp", "rowversion"}
FETCH = 20000
_INT = {"int", "smallint", "tinyint", "bigint"}
_FLOAT = {"float", "real", "decimal", "numeric", "money", "smallmoney"}
_TIME = {"datetime", "smalldatetime", "datetime2", "date"}


def arrow_type(sqltype: str):
    if sqltype in _INT:
        return pa.int64()
    if sqltype == "bit":
        return pa.bool_()
    if sqltype in _FLOAT:
        return pa.float64()
    if sqltype in _TIME:
        return pa.timestamp("ms")
    return pa.string()


def _coerce(v, typ):
    if v is None:
        return None
    if typ == pa.string() and not isinstance(v, str):
        return str(v)
    if typ == pa.float64() and isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, _dt.date) and not isinstance(v, _dt.datetime):
        return _dt.datetime(v.year, v.month, v.day)
    return v


def _norm(v) -> str:
    if v is None:
        return "\x00"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, float):
        return repr(round(v, 6))
    if isinstance(v, decimal.Decimal):
        return format(v.normalize(), "f")
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return hashlib.sha256(v).hexdigest()
    return str(v)


def row_hash(values) -> str:
    return hashlib.sha256("\x1f".join(_norm(v) for v in values).encode("utf-8")).hexdigest()


def _columns(conn, table: str):
    _, rows = query(conn, """SELECT c.name, ty.name FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                             WHERE c.object_id = OBJECT_ID(%s) ORDER BY c.column_id""", (f"dbo.[{table}]",))
    return rows


def nonempty_tables(conn) -> list[tuple[str, int]]:
    _, rows = query(conn, """SELECT t.name, SUM(p.rows) FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
                             GROUP BY t.name HAVING SUM(p.rows) > 0 ORDER BY t.name""")
    return [(t, int(n)) for t, n in rows]


def extract_table(conn, table: str, out_dir: str) -> dict:
    cols = _columns(conn, table)
    keep = [(c, t) for c, t in cols if not SECRET_COL.search(c)]
    dropped = [c for c, _ in cols if SECRET_COL.search(c)]
    blob_cols = [c for c, t in keep if t in BLOB_TYPES]
    select = ", ".join(f"[{c}]" for c, _ in keep)
    cur = conn.cursor()
    cur.execute(f"SELECT {select} FROM dbo.[{table}]")
    names = [c for c, _ in keep]
    types = {c: arrow_type(t) for c, t in keep}
    fields = [pa.field(c, types[c]) for c in names if c not in blob_cols]
    fields += [pa.field(f"{b}__sha256", pa.string()) for b in blob_cols] + [pa.field(f"{b}__len", pa.int64()) for b in blob_cols]
    fields += [pa.field("_row_hash", pa.string())]
    schema = pa.schema(fields)
    blob_schema = pa.schema([("_row_hash", pa.string()), ("column", pa.string()), ("sha256", pa.string()), ("data", pa.binary())])
    path = os.path.join(out_dir, f"{table}.parquet")
    writer = pq.ParquetWriter(path, schema)
    blob_writer = None
    n = 0
    while True:
        batch = cur.fetchmany(FETCH)
        if not batch:
            break
        data = {f.name: [] for f in fields}
        blobs = {"_row_hash": [], "column": [], "sha256": [], "data": []}
        for r in batch:
            rec = dict(zip(names, r))
            h = row_hash(r)
            for c in names:
                if c not in blob_cols:
                    data[c].append(_coerce(rec[c], types[c]))
            for b in blob_cols:
                v = rec[b]
                sha = hashlib.sha256(v).hexdigest() if v is not None else None
                data[f"{b}__sha256"].append(sha)
                data[f"{b}__len"].append(len(v) if v is not None else None)
                if v is not None:
                    blobs["_row_hash"].append(h); blobs["column"].append(b); blobs["sha256"].append(sha); blobs["data"].append(bytes(v))
            data["_row_hash"].append(h)
        writer.write_table(pa.table({f.name: pa.array(data[f.name], type=f.type) for f in fields}, schema=schema))
        if blobs["data"]:
            if blob_writer is None:
                blob_writer = pq.ParquetWriter(os.path.join(out_dir, f"{table}__blobs.parquet"), blob_schema)
            blob_writer.write_table(pa.table(blobs, schema=blob_schema))
        n += len(batch)
    writer.close()
    if blob_writer:
        blob_writer.close()
    return {"table": table, "rows": n, "dropped_secret_columns": dropped, "blob_columns": blob_cols}


def extract_all(conn, out_dir: str) -> list[dict]:
    os.makedirs(out_dir, exist_ok=True)
    return [extract_table(conn, t, out_dir) for t, _ in nonempty_tables(conn)]
