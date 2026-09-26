import os
import zipfile

import pytest

from holoo_reader.acquire import acquire, sha256_file

FAKE_BAK = b"TAPE" + os.urandom(4096)


def _make_zip(tmp_path, name="holoo1_1404"):
    z = tmp_path / "in.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
        f.writestr(name, FAKE_BAK)
    return z


def test_split_zip_parts_are_joined_and_hashed(tmp_path):
    z = _make_zip(tmp_path).read_bytes()
    p0, p1 = tmp_path / "a.part0", tmp_path / "a.part1"
    p0.write_bytes(z[: len(z) // 2]); p1.write_bytes(z[len(z) // 2:])
    before = (sha256_file(p0), sha256_file(p1))
    res = acquire([str(p0), str(p1)], str(tmp_path / "w"))
    assert open(res.backup_path, "rb").read() == FAKE_BAK
    assert res.inner_name == "holoo1_1404"
    assert (sha256_file(p0), sha256_file(p1)) == before  # inputs untouched
    assert [s.sha256 for s in res.inputs] == list(before)


def test_plain_bak_is_accepted(tmp_path):
    b = tmp_path / "x.bak"; b.write_bytes(FAKE_BAK)
    res = acquire([str(b)], str(tmp_path / "w"))
    assert res.backup_path == str(b) and res.backup_sha256 == sha256_file(b)


def test_rejects_non_backup(tmp_path):
    b = tmp_path / "x.bin"; b.write_bytes(b"hello")
    with pytest.raises(ValueError):
        acquire([str(b)], str(tmp_path / "w"))
