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
    a = ap.parse_args(argv)
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
