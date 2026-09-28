"""Profile detection: which Holoo schema family and fiscal year a restored database belongs to."""
from __future__ import annotations

import hashlib
import json
import re

from . import names
from .sqlserver import query

KEY_TABLES = ["SANAD", "SND_LIST", "SND_INDX", "SARFASL", "CUSTOMER", "FACTURE", "FACTART", "ARTICLE",
              "Check", "Check_Event", "Process", "TaxLog", "M_GROUP", "S_GROUP", "Cash", "ACOUND_N", "USERDB"]
# Columns the adapter depends on — the profile is "compatible" when all are present.
REQUIRED = {
    "SANAD": ["Sanad_Code", "Sanad_Code_C", "Sanad_Code_C2", "Sanad_Date", "Sanad_Type", "sanad_state", "UserCodeInc", "DateUser", "Endeditdate"],
    "SND_LIST": ["Sanad_Code", "Index", "Col_Code", "Moien_Code", "Tafzili_Code", "Bed", "Bes", "Type_Line", "Comment_Line", "Show_Daftar"],
    "SARFASL": ["Col_Code", "Moien_Code", "Tafzili_Code", "Sarfasl_Code", "Sarfasl_Name", "Mandeh", "Group", "Mahiat", "Type", "ID", "Parent"],
    "CUSTOMER": ["C_Code", "C_Name", "C_Code_C", "Col_Code_Bed", "Moien_Code_Bed", "Tafzili_Code_Bed", "Col_Code_Bes", "Moien_Code_Bes", "Tafzili_Code_Bes"],
    "FACTURE": ["Fac_Code", "Fac_Type", "Fac_Code_C", "C_Code", "Fac_Date", "Sum_Price", "FNaghd", "FCheck", "FNesieh", "Card", "Sanad_Code", "UserCode", "DateUser"],
    "FACTART": ["Fac_Code", "Fac_Type", "A_Code", "A_Index", "Few_Article", "Price_BS", "Buy_Price"],
    "ARTICLE": ["A_Code", "A_Name", "First_exist", "FirstBuy_Price", "Exist", "Buy_Price"],
    "Check": ["Check_Code", "Daryaft_Pardakht", "Check_Number", "Cust", "Bank_Code", "Export_Date", "Receive_Date", "C_Code_Source", "Cash_Id"],
    "Check_Event": ["Id", "Check_Code", "Sanad_Code", "Date_Time", "Cash_ID", "SarFasl_Code", "State"],
    "Process": ["ID", "C_Code", "Comment", "DateProc", "TimeProc", "KindProc", "NameProc", "Number", "User_Code"],
}


def schema_snapshot(conn, name_map: dict[str, str] | None = None) -> dict[str, list[tuple[str, str]]]:
    """Tables and their columns, keyed by the Reader's table name (names.py: case-only differences under a
    case-insensitive collation). Column names are kept exactly as the database has them."""
    _, rows = query(conn, """SELECT t.name, c.name, ty.name FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
                             JOIN sys.types ty ON ty.user_type_id = c.user_type_id ORDER BY t.name, c.column_id""")
    name_map = name_map or {}
    snap: dict[str, list[tuple[str, str]]] = {}
    for t, c, ty in rows:
        snap.setdefault(name_map.get(t, t), []).append((c, ty))
    return snap


def missing_required(snap: dict) -> dict[str, list[str]]:
    """Required columns absent from the snapshot (exact column names), per table."""
    missing = {t: [c for c in cols if c not in {x[0] for x in snap.get(t, [])}] for t, cols in REQUIRED.items()}
    return {t: m for t, m in missing.items() if m}


def fingerprint(snap: dict) -> str:
    key = {t: sorted(snap.get(t, [])) for t in KEY_TABLES}
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()


def detect(conn, backup_meta: dict | None = None) -> dict:
    name_map, coll = names.table_names(conn)
    snap = schema_snapshot(conn, name_map)
    missing = missing_required(snap)
    _, v = query(conn, "SELECT TOP 1 RTRIM(Number) FROM Process WHERE RTRIM(KindProc) = 'L' AND Number LIKE '1[34]__.__.__%' ORDER BY ID DESC") \
        if "Process" in snap else (None, [])
    holoo_version = v[0][0] if v else None
    _, d = query(conn, "SELECT MIN(Sanad_Date), MAX(Sanad_Date) FROM SANAD") if "SANAD" in snap else (None, [(None, None)])
    first, last = d[0]
    fiscal_year = None
    if first is not None:
        import jdatetime
        fiscal_year = jdatetime.date.fromgregorian(date=first.date()).year
    phys = ""
    if backup_meta and backup_meta.get("files"):
        phys = backup_meta["files"][0].get("PhysicalName") or ""
    m = re.search(r"[\\/](1[34]\d\d)[\\/]", phys)
    header = (backup_meta or {}).get("header", [{}])[0]
    return {
        "family": "holoo-sqlserver",
        "fingerprint": fingerprint(snap),
        "compatible": not missing,
        "missing_required": missing,
        "holoo_version": holoo_version,
        "db_version": header.get("DatabaseVersion"),
        "sql_version": ".".join(filter(None, [header.get("SoftwareVersionMajor"), header.get("SoftwareVersionMinor"), header.get("SoftwareVersionBuild")])),
        "source_db": header.get("DatabaseName"),
        "fiscal_year": fiscal_year,
        "fiscal_year_from_path": int(m.group(1)) if m else None,
        "date_range": [str(first), str(last)],
        "tables_total": len(snap),
        "collation": coll,
        "table_name_case_map": name_map,                            # e.g. {"Check_event": "Check_Event"}: recorded, never silent
        "adapter": "holoo_v1" if not missing else None,
    }
