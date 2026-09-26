"""Acquire: assemble split/zip inputs into a single .bak file and fingerprint it (never modifies inputs)."""
from __future__ import annotations

import hashlib
import os
import shutil
import zipfile
from dataclasses import dataclass

CHUNK = 8 * 1024 * 1024
MTF_MAGIC = b"TAPE"  # Microsoft Tape Format header of SQL Server native backups


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


@dataclass
class SourceFile:
    path: str
    size: int
    sha256: str


@dataclass
class AcquiredBackup:
    inputs: list[SourceFile]
    backup_path: str
    backup_sha256: str
    backup_size: int
    inner_name: str


def _is_mtf(path: str) -> bool:
    with open(path, "rb") as f:
        return f.read(4) == MTF_MAGIC


def acquire(inputs: list[str], workdir: str) -> AcquiredBackup:
    """Accept: one .bak; one .zip; or ordered zip parts (part0, part1, ...) that concatenate into a zip."""
    if not inputs:
        raise ValueError("no input files")
    os.makedirs(workdir, exist_ok=True)
    srcs = [SourceFile(p, os.path.getsize(p), sha256_file(p)) for p in inputs]
    if len(inputs) == 1 and _is_mtf(inputs[0]):
        bak = inputs[0]
        inner = os.path.basename(bak)
    else:
        zpath = inputs[0]
        if len(inputs) > 1:  # binary concatenation of split parts, in the given order
            zpath = os.path.join(workdir, "joined.zip")
            with open(zpath, "wb") as out:
                for p in inputs:
                    with open(p, "rb") as f:
                        shutil.copyfileobj(f, out, CHUNK)
        if not zipfile.is_zipfile(zpath):
            raise ValueError("input is neither a SQL Server backup nor a (split) zip archive")
        with zipfile.ZipFile(zpath) as z:
            bad = z.testzip()
            if bad:
                raise ValueError(f"corrupt zip member: {bad}")
            members = [m for m in z.infolist() if not m.is_dir()]
            if len(members) != 1:
                raise ValueError(f"expected exactly one backup inside the zip, found {len(members)}")
            inner = members[0].filename
            bak = os.path.join(workdir, os.path.basename(inner) + ".bak")
            with z.open(members[0]) as src, open(bak, "wb") as dst:
                shutil.copyfileobj(src, dst, CHUNK)
        if not _is_mtf(bak):
            raise ValueError("extracted file is not a SQL Server native backup (missing MTF header)")
    return AcquiredBackup(srcs, bak, sha256_file(bak), os.path.getsize(bak), inner)
