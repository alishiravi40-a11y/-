"""Run evidence SQL files against the restored Holoo DB and write Markdown results.

Each file in sql/ holds one or more queries, each introduced by a line
`-- @name: <id> | <description>`. Queries are read-only (SELECT/WITH).
Usage: MSSQL_SA_PASSWORD=... python3 run_evidence.py [pattern]
"""
import os, re, sys, glob, datetime, hashlib
import pymssql

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("HOLOO_DB", "holoo1_1404")
BACKUP_SHA = os.environ.get("HOLOO_BACKUP_SHA256", "c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2")
MAXROWS = 60

def conn():
    return pymssql.connect(os.environ.get("MSSQL_HOST", "localhost"), "sa",
                           os.environ["MSSQL_SA_PASSWORD"], DB, charset="UTF-8", tds_version="7.4")

def split(sql):
    parts = re.split(r"^-- @name:\s*(.+)$", sql, flags=re.M)
    for i in range(1, len(parts), 2):
        head = parts[i].strip(); body = parts[i + 1].strip()
        name, _, desc = head.partition("|")
        yield name.strip(), desc.strip(), body

def fmt(v):
    if v is None: return "NULL"
    if isinstance(v, float): return f"{v:,.0f}" if abs(v) >= 1000 else f"{v:g}"
    if isinstance(v, datetime.datetime): return v.strftime("%Y-%m-%d %H:%M:%S").replace(" 00:00:00", "")
    return str(v).replace("|", "¦").replace("\n", " ")[:120]

def run(path):
    sql = open(path, encoding="utf-8").read()
    base = os.path.splitext(os.path.basename(path))[0]
    out = [f"# {base}", "", f"- DB: `{DB}` — backup SHA-256 `{BACKUP_SHA}`",
           f"- source: `evidence/sql/{os.path.basename(path)}` (sha1 {hashlib.sha1(sql.encode()).hexdigest()[:10]})", ""]
    c = conn(); cur = c.cursor()
    for name, desc, body in split(sql):
        if not re.match(r"^\s*(select|with)\b", re.sub(r"^--.*$", "", body, flags=re.M).strip(), re.I):
            raise SystemExit(f"{name}: only SELECT/WITH allowed")
        try:
            cur.execute(body)
        except Exception as e:
            raise SystemExit(f"{base}/{name}: {e}")
        rows = cur.fetchall(); cols = [d[0] or f"c{i}" for i, d in enumerate(cur.description)]
        out += [f"## {name} — {desc}", "", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
        out += ["| " + " | ".join(fmt(v) for v in r) + " |" for r in rows[:MAXROWS]]
        out += [f"", f"_{len(rows)} row(s){' (truncated)' if len(rows) > MAXROWS else ''}_", ""]
    c.close()
    open(os.path.join(HERE, "results", base + ".md"), "w", encoding="utf-8").write("\n".join(out))
    print("ok", base)

if __name__ == "__main__":
    pat = sys.argv[1] if len(sys.argv) > 1 else "*"
    for p in sorted(glob.glob(os.path.join(HERE, "sql", f"{pat}.sql"))):
        run(p)
