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
- Reader upgrades are safe on an existing mirror: a canonical column added by a newer reader (e.g. v0.2 `document_line.unit_last_purchase_cost`) is added to `holoo_mirror` and back-filled from the same import, without being logged as a source change (`added_columns` in the publish result).

## Tests
`python -m pytest -q` (unit). Golden tests against the real FY1404 import: `HOLOO_GOLDEN_WORKDIR=/secure/holoo_work python -m pytest -q`
— they reproduce the proven figures (47,447 vouchers; ledger 80,720,660,543,371; COGS 7,699,284,125,059; profit 3,131,672,245; 14 hidden lines = voided invoices; cheque gap 200,000,000 …).

## Publishing to PostgreSQL (`holoo_mirror`)
`holoo-reader publish --workdir DIR --sha256 SHA --pg "$HOLOO_PG_DSN"` loads a completed import into schema `holoo_mirror`
(one table per canonical entity, key = `source_db` + Holoo natural key, lineage columns `first_run/last_run/removed_run`,
`holoo_mirror.change_log`, `holoo_mirror.import_run`). Re-publishing the same import changes nothing; a newer backup of the
same database records `added / changed / removed_in_source` rows — rows are **never physically deleted**.

## Parity with Holoo's own logic
`holoo-reader parity --workdir DIR --sha256 SHA` runs Holoo's own views on the restored DB and compares them with the canonical model:
P-01 `MandehOfSarfasl` (10,038 account balances), P-02 `W_Calc_Mandeh_Customer` (32,696 person balances),
P-03 `W_ArtKardexWithoutAmani` (item movements), P-04 cheque amounts — **all exact on FY1404**.

## Current profile support
| Profile | Evidence | Status |
|---|---|---|
| `holoo_v1` — Holoo program 1405.06.18, DB version 782, SQL Server 2014 schema (`holoo1_1404`) | reverse_engineering/hesabdari_rasmi | ✅ golden-tested |
