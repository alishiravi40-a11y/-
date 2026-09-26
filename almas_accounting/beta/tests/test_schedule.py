import datetime as dt

from beta import schedule as S


def test_floor_amount_and_remainder_on_last():
    rows = S.build(600_000_005, 12, "1405/06/31")
    assert [a for _, _, a in rows[:-1]] == [50_000_000] * 11 and rows[-1][2] == 50_000_005
    assert sum(a for _, _, a in rows) == 600_000_005


def test_due_dates_are_consecutive_jalali_month_ends():
    rows = S.build(1200, 12, "1405/06/31")
    import jdatetime
    j = [jdatetime.date.fromgregorian(date=d) for _, d, _ in rows]
    assert [(x.month, x.day) for x in j[:7]] == [(6, 31), (7, 30), (8, 30), (9, 30), (10, 30), (11, 30), (12, 29)]
    assert (j[7].year, j[7].month, j[7].day) == (1406, 1, 31)


def test_first_due_taken_from_source_even_if_not_month_end():
    rows = S.build(300, 3, "1405/06/15")
    assert rows[0][1] == S.to_jalali("1405/06/15").togregorian()


def test_components_split_adds_up():
    rows = S.build(1_000_003, 7, dt.date(2026, 9, 22))
    parts = S.split_components(rows, 900_000, 60_000, 40_003)
    assert sum(p[3] for p in parts) == 900_000 and sum(p[4] for p in parts) == 60_000 and sum(p[5] for p in parts) == 40_003
    assert all(p[3] + p[4] + p[5] == p[2] for p in parts)
