"""SQL Server access: restore a Holoo backup into a disposable, read-only database and query it."""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field

import pymssql


@dataclass
class ServerConfig:
    host: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_HOST", "localhost"))
    port: int = field(default_factory=lambda: int(os.environ.get("HOLOO_SQL_PORT", "1433")))
    user: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_USER", "sa"))
    password: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_PASSWORD", os.environ.get("MSSQL_SA_PASSWORD", "")))
    # Directory shared with the SQL Server process: host path and the same directory as seen by the server.
    share_host_dir: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_SHARE_HOST", ""))
    share_server_dir: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_SHARE_SERVER", "/bak"))
    data_dir: str = field(default_factory=lambda: os.environ.get("HOLOO_SQL_DATA_DIR", "/var/opt/mssql/data"))


def connect(cfg: ServerConfig, database: str = "master", autocommit: bool = False):
    return pymssql.connect(server=cfg.host, port=cfg.port, user=cfg.user, password=cfg.password,
                           database=database, charset="UTF-8", tds_version="7.4", autocommit=autocommit)


def query(conn, sql: str, params=None):
    cur = conn.cursor()
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description] if cur.description else []
    return cols, cur.fetchall() if cur.description else []


def _server_path(cfg: ServerConfig, bak_path: str, sha256: str) -> str:
    """Make the backup visible to the server via the shared directory (copy if needed)."""
    if not cfg.share_host_dir:
        return bak_path  # caller guarantees the server can read this path
    name = f"{sha256[:16]}.bak"
    dst = os.path.join(cfg.share_host_dir, name)
    if not os.path.exists(dst):
        shutil.copyfile(bak_path, dst)
        os.chmod(dst, 0o644)
    return f"{cfg.share_server_dir.rstrip('/')}/{name}"


def backup_metadata(cfg: ServerConfig, server_path: str) -> dict:
    with connect(cfg, autocommit=True) as c:
        out = {}
        for key, stmt in (("label", "LABELONLY"), ("header", "HEADERONLY"), ("files", "FILELISTONLY")):
            cols, rows = query(c, f"RESTORE {stmt} FROM DISK = %s", (server_path,))
            out[key] = [dict(zip(cols, [str(v) if v is not None else None for v in r])) for r in rows]
        return out


def restore(cfg: ServerConfig, bak_path: str, sha256: str, dbname: str | None = None) -> tuple[str, dict]:
    """Restore into `holoo_<sha12>` (idempotent: an existing DB of that name is reused) and set it READ_ONLY."""
    dbname = dbname or f"holoo_{sha256[:12]}"
    server_path = _server_path(cfg, bak_path, sha256)
    meta = backup_metadata(cfg, server_path)
    with connect(cfg, autocommit=True) as c:
        _, rows = query(c, "SELECT state_desc FROM sys.databases WHERE name = %s", (dbname,))
        if not rows:
            moves = ", ".join(
                f"MOVE N'{f['LogicalName']}' TO N'{cfg.data_dir}/{dbname}_{i}{'.ldf' if f['Type'] == 'L' else '.mdf'}'"
                for i, f in enumerate(meta["files"]))
            c.cursor().execute(f"RESTORE DATABASE [{dbname}] FROM DISK = %s WITH {moves}, RECOVERY", (server_path,))
            c.cursor().execute(f"ALTER DATABASE [{dbname}] SET READ_ONLY WITH NO_WAIT")
        _, chk = query(c, f"DBCC CHECKDB([{dbname}]) WITH NO_INFOMSGS, TABLERESULTS")
        meta["checkdb_errors"] = len(chk)
    return dbname, meta
