"""ADTG parser tests on synthetic streams built with the same layout observed in Holoo blobs (no real data)."""
import struct

import pytest

from holoo_reader import adtg
from holoo_reader.blobs import parse_web_payload

HEADER = b"\x01\x07TG!\x00\x00\x00\x00" + b"\x00" * 40


def wstr(s):
    return struct.pack("<H", len(s)) + s.encode("utf-16-le")


def table(ordinal, name):
    body = struct.pack("<H", ordinal) + wstr(f'"holoo1".."{name}"') + wstr(name) + b"\x00\x00"
    return b"\x05" + struct.pack("<H", len(body)) + body


def column(ordinal, name, dbtype, maxlen, flags, base_table=1):
    body = b"\xf2\x01\x00" + struct.pack("<H", ordinal) + wstr(name) + struct.pack("<HH", base_table, ordinal) + wstr(name)
    body += struct.pack("<HIIII", dbtype, maxlen, 10, 255, flags) + wstr("holoo1") + b"\xff\xff"
    return b"\x06" + struct.pack("<H", len(body)) + body


COLS = [  # name, type, maxlen, flags
    ("Sanad_Code", 3, 4, 0x8010),        # int, NOT NULL
    ("Comment", 130, 500, 0x68),         # nvarchar, nullable, 4-byte length
    ("Name", 129, 30, 0x68),             # varchar(cp1256), nullable, 1-byte length
    ("Fac_Date", 129, 10, 0x70),         # fixed-length varchar, nullable
    ("Bed", 5, 8, 0x78),                 # float, nullable
    ("PasWord", 129, 80, 0x8068),        # secret — must never be returned
]


def stream(rows):
    b = HEADER + table(1, "SND_LIST") + b"".join(column(i + 1, *c) for i, c in enumerate(COLS))
    nullable = [c for c in COLS if c[3] & 0x60]
    for r in rows:
        bits = 0
        for k, c in enumerate(nullable):
            if r.get(c[0]) is not None:
                bits |= 1 << (len(nullable) * 0 + (((len(nullable) + 7) // 8) * 8 - 1 - k))
        b += b"\x07" + bits.to_bytes((len(nullable) + 7) // 8, "big")
        for name, t, ml, fl in COLS:
            v = r.get(name)
            if v is None and fl & 0x60:
                continue
            if t == 3:
                b += struct.pack("<i", v)
            elif t == 5:
                b += struct.pack("<d", v)
            elif t == 130:
                e = v.encode("utf-16-le"); b += struct.pack("<I", len(e)) + e
            elif t == 129 and fl & 0x10:
                b += v.encode("cp1256")
            else:
                e = v.encode("cp1256"); b += bytes([len(e)]) + e
    return b + b"\x0f"


def test_roundtrip_with_nulls_and_secret_column():
    rows = [{"Sanad_Code": 311850, "Comment": "واريزي از بانک", "Name": "مهرابي", "Fac_Date": "1403/12/26", "Bed": 231485600.0, "PasWord": "x"},
            {"Sanad_Code": 311851, "Comment": None, "Name": "web", "Fac_Date": None, "Bed": 0.0, "PasWord": None}]
    r = adtg.parse(stream(rows))
    assert [t["name"] for t in r["tables"]] == ["SND_LIST"]
    assert "PasWord" not in [c["name"] for c in r["columns"]]
    got = r["rows"]
    assert got[0] == {"Sanad_Code": 311850, "Comment": "واريزي از بانک", "Name": "مهرابي", "Fac_Date": "1403/12/26", "Bed": 231485600.0}
    assert got[1] == {"Sanad_Code": 311851, "Comment": None, "Name": "web", "Fac_Date": None, "Bed": 0.0}


def test_truncated_stream_is_rejected():
    s = stream([{"Sanad_Code": 1, "Comment": "a", "Name": "b", "Fac_Date": "1404/01/01", "Bed": 1.0}])
    with pytest.raises(Exception):
        adtg.parse(s[:-5] + b"\x0f")


def test_header_only_stream_is_empty():
    assert adtg.parse(b"\x01\x07TG!\x00\x00\x00\x00\x02\x19\x00" + b"\x00" * 12)["rows"] == []


def test_web_payload_strict_and_malformed():
    ok = '{"invoiceinfo":{"id":"9298217708999","Type":1,"customererpcode":"bD4=","date":"2025-03-20","time":"23:46","comment":"web/217708",' \
         '"Cash":0,"CashSarfasl":"","Nesiyeh":0,"Bank":163800000,"BankSarfasl":"10200020061","Discount":0,' \
         '"detailinfo":[{"ProductErpCode":"bBA=","few":2,"price":81900000}]}}'
    info, strict = parse_web_payload(ok.encode("cp1256"))
    assert strict and info["Bank"] == 163800000 and info["detailinfo"][0]["few"] == 2
    bad = ok.replace('"comment":"web/217708"', '"comment":"he said "hi"/217708"').replace(",\"Cash\"", ",\r\n\"Cash\"")
    info, strict = parse_web_payload(bad.encode("cp1256"))
    assert not strict and info["date"] == "2025-03-20" and info["Bank"] == 163800000
    assert info["detailinfo"] == [{"ProductErpCode": "bBA=", "few": 2.0, "price": 81900000.0}]
