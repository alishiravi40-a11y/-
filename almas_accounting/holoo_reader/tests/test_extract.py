import datetime

from holoo_reader.extract import row_hash


def test_row_hash_is_stable_and_sensitive():
    r = (1, "علی", 2.5, datetime.datetime(2025, 3, 21), None, True, b"\x01")
    assert row_hash(r) == row_hash(tuple(r))
    assert row_hash(r) != row_hash((1, "علی", 2.5, datetime.datetime(2025, 3, 21), None, False, b"\x01"))
    assert row_hash((None,)) != row_hash(("",))
