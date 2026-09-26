"""Decode Process blobs into canonical tables.

Process.Blob    — ADO ADTG recordset: AFTER-image of the document at the logged event (see adtg.py).
                  Proven in evidence E12: for 97% of vouchers the last snapshot equals the current voucher.
Process.WEBBLOB — raw JSON payload received from the web-service channel ({"invoiceinfo": {...}}), cp1256 text.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re

import pyarrow as pa
import pyarrow.parquet as pq

from . import adtg

_NUM = r"(-?\d+(?:\.\d+)?)"


def _json_default(o):
    if isinstance(o, (_dt.datetime, _dt.date)):
        return o.isoformat()
    return str(o)


def parse_web_payload(raw: bytes) -> tuple[dict, bool]:
    """Return (invoiceinfo, strict_json_ok). Falls back to field-wise regex for malformed payloads
    (e.g. unescaped quotes inside the comment)."""
    text = raw.decode("cp1256", errors="replace")
    try:
        return json.loads(text)["invoiceinfo"], True
    except Exception:
        pass
    info = {}
    for key in ("id", "customererpcode", "date", "time", "CashSarfasl", "BankSarfasl"):
        m = re.search(rf'"{key}"\s*:\s*"([^"]*)"', text)
        if m:
            info[key] = m.group(1)
    for key in ("Type", "Cash", "Nesiyeh", "Bank", "Discount"):
        m = re.search(rf'"{key}"\s*:\s*{_NUM}', text)
        if m:
            info[key] = float(m.group(1))
    m = re.search(r'"comment"\s*:\s*"(.*?)",\s*\r?\n', text, re.S)
    if m:
        info["comment"] = m.group(1)
    info["detailinfo"] = [
        {"ProductErpCode": a, "few": float(b), "price": float(c)}
        for a, b, c in re.findall(r'"ProductErpCode"\s*:\s*"([^"]+)"\s*,\s*"few"\s*:\s*' + _NUM + r'\s*,\s*"price"\s*:\s*' + _NUM, text)]
    return info, False


def decode(bronze_dir: str, out_dir: str) -> dict:
    """Write audit_snapshot.parquet, web_payload.parquet, web_payload_line.parquet into out_dir."""
    src = os.path.join(bronze_dir, "Process__blobs.parquet")
    proc = os.path.join(bronze_dir, "Process.parquet")
    if not (os.path.exists(src) and os.path.exists(proc)):
        return {}
    ids = dict(zip(*[pq.read_table(proc, columns=["_row_hash", "ID"]).column(c).to_pylist() for c in ("_row_hash", "ID")]))
    snap = {"process_id": [], "row_no": [], "tables": [], "data": []}
    web = {k: [] for k in ("process_id", "strict_json", "payload_id", "order_no", "doc_type", "doc_date", "doc_time", "customer_erpcode",
                           "cash", "cash_account", "bank", "bank_account", "credit", "discount", "comment", "line_count", "lines_total")}
    wl = {"process_id": [], "line_no": [], "product_erpcode": [], "qty": [], "price": []}
    errors = {"adtg": 0, "web": 0}
    pf = pq.ParquetFile(src)
    for batch in pf.iter_batches(batch_size=2000):
        b = batch.to_pydict()
        for h, col, data in zip(b["_row_hash"], b["column"], b["data"]):
            pid = ids[h]
            if col == "Blob":
                try:
                    r = adtg.parse(data)
                except adtg.ADTGError:
                    errors["adtg"] += 1
                    continue
                tabs = ",".join(sorted(t["name"] for t in r["tables"] if t["name"]))
                for n, row in enumerate(r["rows"]):
                    snap["process_id"].append(pid); snap["row_no"].append(n); snap["tables"].append(tabs)
                    snap["data"].append(json.dumps(row, ensure_ascii=False, default=_json_default))
            elif col == "WEBBLOB":
                try:
                    info, strict = parse_web_payload(data)
                except Exception:
                    errors["web"] += 1
                    continue
                lines = info.get("detailinfo") or []
                pid_s = str(info.get("id") or "")
                m = re.fullmatch(r"9298(\d+)999", pid_s)
                web["process_id"].append(pid); web["strict_json"].append(strict); web["payload_id"].append(pid_s)
                web["order_no"].append(m.group(1) if m else None)
                web["doc_type"].append(int(info["Type"]) if info.get("Type") is not None else None)
                web["doc_date"].append(info.get("date")); web["doc_time"].append(info.get("time"))
                web["customer_erpcode"].append(info.get("customererpcode"))
                for k, src_k in (("cash", "Cash"), ("bank", "Bank"), ("credit", "Nesiyeh"), ("discount", "Discount")):
                    web[k].append(float(info[src_k]) if info.get(src_k) not in (None, "") else None)
                web["cash_account"].append(info.get("CashSarfasl") or None); web["bank_account"].append(info.get("BankSarfasl") or None)
                web["comment"].append(info.get("comment"))
                web["line_count"].append(len(lines))
                web["lines_total"].append(float(sum((l.get("few") or 0) * (l.get("price") or 0) for l in lines)))
                for n, l in enumerate(lines):
                    wl["process_id"].append(pid); wl["line_no"].append(n); wl["product_erpcode"].append(l.get("ProductErpCode"))
                    wl["qty"].append(float(l.get("few") or 0)); wl["price"].append(float(l.get("price") or 0))
    os.makedirs(out_dir, exist_ok=True)
    pq.write_table(pa.table(snap, schema=pa.schema([("process_id", pa.int64()), ("row_no", pa.int32()), ("tables", pa.string()), ("data", pa.string())])),
                   os.path.join(out_dir, "audit_snapshot.parquet"))
    pq.write_table(pa.table(web), os.path.join(out_dir, "web_payload.parquet"))
    pq.write_table(pa.table(wl, schema=pa.schema([("process_id", pa.int64()), ("line_no", pa.int32()), ("product_erpcode", pa.string()),
                                                  ("qty", pa.float64()), ("price", pa.float64())])), os.path.join(out_dir, "web_payload_line.parquet"))
    return {"audit_snapshot_rows": len(snap["data"]), "web_payloads": len(web["process_id"]), "web_payload_lines": len(wl["process_id"]),
            "errors": errors}
