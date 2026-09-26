# holoo-reader

Independent ingestion layer for **Holoo (TNC) SQL Server backups** — permanent input format of the Almas Shahr accounting system
(principle 1, `../docs/PRINCIPLES_FA.md`; design: `../docs/HOLOO_READER_FA.md`).

```
Acquire (zip parts/.bak, SHA-256) → Restore (disposable, READ_ONLY) → Profile (schema fingerprint, Holoo version, fiscal year)
→ Extract (Bronze Parquet, row hash, secrets dropped, blobs split) → Map+Normalize (Silver canonical DuckDB)
→ Validate + Reconcile (R-01…R-09, gate) → Registry (audit, idempotency, source-change diff)
```

## Usage
```bash
pip install -e '.[test]'
export HOLOO_SQL_PASSWORD=...                  # SQL Server (2014+) reachable at HOLOO_SQL_HOST:HOLOO_SQL_PORT
export HOLOO_SQL_SHARE_HOST=/path/shared/with/server HOLOO_SQL_SHARE_SERVER=/bak   # where the server can read the .bak
holoo-reader ingest backup.zip.part0 backup.zip.part1 --workdir /secure/holoo_work
```
A throw-away server: `docker run -d -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=... -e MSSQL_COLLATION=Arabic_CI_AS -p 1433:1433 -v /path/shared:/bak mcr.microsoft.com/mssql/server:2022-latest`

Outputs in `--workdir` (keep **outside** the repository — contains personal and financial data):
`registry.duckdb` (every run, checks, changes), `imports/<sha256>/bronze/*.parquet`, `imports/<sha256>/silver.duckdb`, `imports/<sha256>/report.json`.

## Guarantees
- Inputs are never modified; the restored DB is set READ_ONLY; only `SELECT` is used for extraction.
- Re-importing the same backup (same SHA-256, any packaging) is a no-op (`status=duplicate`).
- A newer backup of the same `source_db`/fiscal year produces a `source_change` diff (added / changed / removed_in_source) by stable Holoo keys.
- Password columns are never extracted.

## Tests
`python -m pytest -q` (unit). Golden tests against the real FY1404 import: `HOLOO_GOLDEN_WORKDIR=/secure/holoo_work python -m pytest -q`
— they reproduce the proven figures (47,447 vouchers; ledger 80,720,660,543,371; COGS 7,699,284,125,059; profit 3,131,672,245; 14 hidden lines = voided invoices; cheque gap 200,000,000 …).

## Current profile support
| Profile | Evidence | Status |
|---|---|---|
| `holoo_v1` — Holoo program 1405.06.18, DB version 782, SQL Server 2014 schema (`holoo1_1404`) | reverse_engineering/hesabdari_rasmi | ✅ golden-tested |
