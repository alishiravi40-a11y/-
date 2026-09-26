"""Command line: holoo-reader ingest <files...> --workdir DIR"""
from __future__ import annotations

import argparse
import json
import sys

from . import pipeline, sqlserver


def main(argv=None):
    ap = argparse.ArgumentParser(prog="holoo-reader")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ing = sub.add_parser("ingest", help="import a Holoo backup (.bak, .zip, or ordered zip parts)")
    ing.add_argument("files", nargs="+")
    ing.add_argument("--workdir", required=True, help="directory for staging, bronze/silver and the registry (outside the repo)")
    ing.add_argument("--force", action="store_true", help="re-process even if this backup was already imported")
    ing.add_argument("--operator")
    par = sub.add_parser("parity", help="compare Holoo's own views (restored DB) with the canonical model of a completed import")
    par.add_argument("--workdir", required=True)
    par.add_argument("--sha256", required=True, help="backup SHA-256 of the import")
    a = ap.parse_args(argv)
    if a.cmd == "parity":
        import os
        from . import parity, transform
        cfg = sqlserver.ServerConfig()
        silver = transform.open_silver(os.path.join(a.workdir, "imports", a.sha256, "silver.duckdb"))
        with sqlserver.connect(cfg, f"holoo_{a.sha256[:12]}") as sql:
            res = parity.run(sql, silver)
        json.dump(res, sys.stdout, ensure_ascii=False, indent=1, default=str); print()
        return 0 if all(r["status"] == "pass" for r in res) else 3
    if a.cmd == "ingest":
        res = pipeline.ingest(a.files, a.workdir, sqlserver.ServerConfig(), operator=a.operator, force=a.force)
        summary = {k: v for k, v in res.items() if k != "checks"}
        if "checks" in res:
            summary["checks"] = [f"{c['code']} [{c['level']}] {c['status']}: {c['title']}" for c in res["checks"]]
        json.dump(summary, sys.stdout, ensure_ascii=False, indent=1, default=str)
        print()
        return 0 if res.get("gate_passed", True) else 2


if __name__ == "__main__":
    sys.exit(main())
