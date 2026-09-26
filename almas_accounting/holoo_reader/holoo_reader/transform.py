"""Map + Normalize: Bronze Parquet → Silver canonical DuckDB (schema: canonical/schema.sql)."""
from __future__ import annotations

import datetime as _dt
import os
from importlib import resources

import duckdb
import jdatetime

from . import textfix
from .adapters import holoo_v1 as A


def _jdate(d):
    if d is None:
        return None
    if isinstance(d, _dt.datetime):
        d = d.date()
    j = jdatetime.date.fromgregorian(date=d)
    return f"{j.year:04d}/{j.month:02d}/{j.day:02d}"


def _case(expr: str, mapping: dict, idx: int | None = None, default="NULL") -> str:
    parts = []
    for k, v in mapping.items():
        val = v[idx] if idx is not None else v
        if val is None:
            val_sql = "NULL"
        elif isinstance(val, str):
            val_sql = "'" + val.replace("'", "''") + "'"
        else:
            val_sql = str(val)
        key_sql = "NULL" if k is None else (f"'{k}'" if isinstance(k, str) else str(k))
        parts.append(f"WHEN {expr} IS NULL THEN {val_sql}" if k is None else f"WHEN {expr} = {key_sql} THEN {val_sql}")
    return "CASE " + " ".join(parts) + f" ELSE {default} END"


def open_silver(path: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(path)
    con.create_function("clean", textfix.clean, ["VARCHAR"], "VARCHAR", null_handling="special")
    con.create_function("skey", textfix.search_key, ["VARCHAR"], "VARCHAR", null_handling="special")
    con.create_function("order_no", textfix.web_order_number, ["VARCHAR"], "VARCHAR", null_handling="special")
    con.create_function("jdate", _jdate, ["DATE"], "VARCHAR", null_handling="special")
    return con


def build_silver(bronze_dir: str, silver_path: str, meta: dict) -> dict:
    if os.path.exists(silver_path):
        os.remove(silver_path)
    con = open_silver(silver_path)
    con.execute(resources.files("holoo_reader.canonical").joinpath("schema.sql").read_text(encoding="utf-8"))

    def src(t):
        p = os.path.join(bronze_dir, f"{t}.parquet")
        return f"read_parquet('{p}')" if os.path.exists(p) else None

    def load(sql: str, *tables):
        if all(src(t) for t in tables):
            con.execute(sql.format(**{t: src(t) for t in tables}))

    for k, v in meta.items():
        con.execute("INSERT INTO meta VALUES (?, ?)", [k, str(v)])

    load("""INSERT INTO account SELECT Sarfasl_Code, CASE length(Sarfasl_Code) WHEN 3 THEN 1 WHEN 7 THEN 2 ELSE 3 END,
            Col_Code, NULLIF(Moien_Code,''), NULLIF(Tafzili_Code,''), clean(Sarfasl_Name), skey(clean(Sarfasl_Name)),
            CASE length(Sarfasl_Code) WHEN 11 THEN Col_Code || Moien_Code WHEN 7 THEN Col_Code ELSE NULL END,
            Mahiat, "Group", "Type", Mandeh, _row_hash FROM {SARFASL}""", "SARFASL")
    load("INSERT INTO warehouse SELECT M_groupcode, clean(M_groupname), _row_hash FROM {M_GROUP}", "M_GROUP")
    load(f"""INSERT INTO item SELECT A_Code, clean(A_Name), skey(clean(A_Name)), substr(A_Code,1,2), substr(A_Code,3,2),
            substr(A_Code,1,2) = '{A.SERVICE_ITEM_PREFIX}', NULLIF(A_Code_C,''), NULLIF(A_codeIdTax,''),
            coalesce(First_exist,0), coalesce(FirstBuy_Price,0), coalesce(Exist,0), coalesce(Buy_Price,0), _row_hash FROM {{ARTICLE}}""", "ARTICLE")
    load("""INSERT INTO person SELECT C_Code, NULLIF(C_Code_C,''), clean(C_Name), skey(clean(C_Name)), C_type,
            NULLIF(National_Code,''), NULLIF(Economic_Code,''), NULLIF(C_Mobile,''), City_Code,
            NULLIF(Col_Code_Bed || Moien_Code_Bed || coalesce(Tafzili_Code_Bed,''),''),
            NULLIF(Col_Code_Bes || Moien_Code_Bes || coalesce(Tafzili_Code_Bes,''),''),
            coalesce(InListSiah,false), (C_Name LIKE '%بد حساب%' OR C_Name LIKE '%بدحساب%' OR C_Name LIKE '%به هيچ عنوان%'),
            Creation_Date, _row_hash FROM {CUSTOMER}""", "CUSTOMER")
    load(f"""INSERT INTO voucher SELECT Sanad_Code, Sanad_Code_C, Sanad_Code_C2, CAST(Sanad_Date AS DATE), jdate(CAST(Sanad_Date AS DATE)),
            Sanad_Type, {_case('Sanad_Type', A.VOUCHER_TYPES)}, {_case('sanad_state', A.VOUCHER_STATES)}, UserCodeInc,
            TRY_CAST(replace(DateUser,'/','-') AS DATE), Endeditdate, coalesce(SaveFromFacture,false), coalesce(SaveFromAuto,false),
            clean(Comment), _row_hash FROM {{SANAD}}""", "SANAD")
    load(f"""INSERT INTO voucher_line SELECT Sanad_Code, "Index", Col_Code || Moien_Code || Tafzili_Code, coalesce(Bed,0), coalesce(Bes,0),
            {_case("coalesce(Type_Line,'')", A.LINE_ROLES, default="'manual'")}, clean(Comment_Line), coalesce(Show_Daftar,true), _row_hash FROM {{SND_LIST}}""", "SND_LIST")
    load(f"""INSERT INTO document SELECT Fac_Type, Fac_Code, Fac_Code_C, {_case('Fac_Type', A.DOC_KINDS, 0, "'unknown'")},
            {_case('Fac_Type', A.DOC_KINDS, 1, "'نامشخص'")}, CAST(Fac_Date AS DATE), jdate(CAST(Fac_Date AS DATE)), C_Code,
            coalesce(Sum_Price,0), coalesce(FNaghd,0), coalesce(Card,0), coalesce(FCheck,0), coalesce(FNesieh,0), coalesce(Takhfif,0),
            NULLIF(Sanad_Code,0), UserCode, CASE WHEN UserCode = {A.WEB_SERVICE_USER} THEN 'web_service' ELSE 'holoo_ui' END,
            order_no(Fac_Comment), StateTax, NULLIF(FTaxId,''), TRY_CAST(replace(DateUser,'/','-') AS DATE), clean(Fac_Comment), _row_hash FROM {{FACTURE}}""", "FACTURE")
    load("""INSERT INTO document_line SELECT Fac_Type, Fac_Code, A_Code, A_Index, coalesce(Few_Article,0), coalesce(Price_BS,0),
            coalesce(Buy_Price,0), coalesce(TakhfifSatriR,0), _row_hash FROM {FACTART}""", "FACTART")
    load("INSERT INTO voucher_link SELECT Sanad_Code, NULLIF(Fac_Type,''), NULLIF(Fac_Code,''), NULLIF(Check_Code,0), _row_hash FROM {SND_INDX}", "SND_INDX")
    load("INSERT INTO cashbox SELECT Id, Parent_Id, S_Type, clean(S_Name), NULLIF(Sarfasl_Code,''), NULLIF(Sarfasl_Code2,''), _row_hash FROM {Cash}", "Cash")
    load("""INSERT INTO bank_account SELECT Id, C_Code, Bank_Code, Account_N, clean(Branch_Name), Col_Code || Moien_Code || Tafzili_Code,
            coalesce(Pos,false), coalesce(IsActive,true), _row_hash FROM {ACOUND_N}""", "ACOUND_N")
    load("INSERT INTO bank SELECT Bank_Code, clean(Bank_Name), _row_hash FROM {NEWBANK}", "NEWBANK")
    load("""INSERT INTO cheque SELECT Check_Code, CASE WHEN Daryaft_Pardakht THEN 'in' ELSE 'out' END, Check_Number, NULLIF(Sayad_Number,''),
            Cust, Bank_Code, Account_Number, clean(Branch), CAST(Export_Date AS DATE), CAST(Receive_Date AS DATE), C_Code_Source,
            NULLIF(Cash_Id,0), _row_hash FROM {Check}""", "Check")
    load(f"""INSERT INTO cheque_event SELECT Id, Check_Code, State, {_case('State', A.CHEQUE_STATES)}, CAST(Date_Time AS DATE),
            NULLIF(Sanad_Code,0), NULLIF(SarFasl_Code,''), NULLIF(Cash_ID,0), _row_hash FROM {{Check_Event}}""", "Check_Event")
    load("""INSERT INTO tax_submission SELECT Id, Fac_Type, Fac_Code, SendType, StateTax, NULLIF(FTaxId,''), SerialFact, SendDateTax, _row_hash FROM {TaxLog}""", "TaxLog")
    load(f"""INSERT INTO audit_event SELECT ID, TRY_CAST(replace(DateProc,'/','-') AS DATE), TimeProc, User_Code,
            {_case('trim(KindProc)', A.AUDIT_KINDS, default='trim(KindProc)')}, {_case('trim(NameProc)', A.AUDIT_OBJECTS, default='trim(NameProc)')},
            clean(Comment), NULLIF(trim(Number),''), NULLIF(trim(C_Code),''), Comment LIKE '%وب سرویس%', Blob__sha256, Blob__len, _row_hash FROM {{Process}}""", "Process")
    load("""INSERT INTO app_user SELECT UserCodeInc, clean(Name), coalesce(SuperVizor,false), coalesce(DeActive,false), coalesce(EnterPriorDate,false), _row_hash FROM {USERDB}""", "USERDB")
    load("""INSERT INTO opening_version SELECT Id, UserCodeInc, Endeditdate, _row_hash FROM {Sanad_Edit}""", "Sanad_Edit")
    load("""INSERT INTO opening_version_line SELECT id, Col_Code || Moien_Code || Tafzili_Code, coalesce(Bed,0), coalesce(Bes,0), "index", _row_hash FROM {snd_list_Edit}""", "snd_list_Edit")

    for t in ("audit_snapshot", "web_payload", "web_payload_line"):
        pth = os.path.join(bronze_dir, "..", "decoded", f"{t}.parquet")
        if os.path.exists(pth):
            con.execute(f"INSERT INTO {t} SELECT * FROM read_parquet('{pth}')")

    counts = {t: con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for (t,) in con.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' ORDER BY 1").fetchall()}
    con.close()
    return counts
