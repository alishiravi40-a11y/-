"""Installment schedules (E15): amount = floor(total / count); the remainder (< count rials) goes to one installment
(setting beta_schedule_remainder: 'last' default — NOT proven from Beta data); due dates = end of consecutive Jalali months."""
from __future__ import annotations

import datetime as dt

import jdatetime


def jalali_month_end(y: int, m: int) -> jdatetime.date:
    return jdatetime.date(y, m, 31 if m <= 6 else 30 if m <= 11 else (30 if jdatetime.date(y, 1, 1).isleap() else 29))


def to_jalali(d) -> jdatetime.date:
    if isinstance(d, jdatetime.date):
        return d
    if isinstance(d, str):
        y, m, day = (int(x) for x in d.replace("-", "/").split("/"))
        return jdatetime.date(y, m, day)
    return jdatetime.date.fromgregorian(date=d)


def build(total: int, count: int, first_due, remainder: str = "last") -> list[tuple[int, dt.date, int]]:
    """[(seq, gregorian due date, amount)]; first_due is taken from the source (7 exceptions to any cutoff rule, E15)."""
    if count < 1 or total < count:
        raise ValueError("invalid total/count")
    base, rem = divmod(int(total), int(count))
    f = to_jalali(first_due)
    out = []
    for i in range(count):
        y, m = f.year + (f.month - 1 + i) // 12, (f.month - 1 + i) % 12 + 1
        due = f if i == 0 else jalali_month_end(y, m)
        extra = rem if (remainder == "last" and i == count - 1) or (remainder == "first" and i == 0) else 0
        out.append((i + 1, due.togregorian(), base + extra))
    return out


def split_components(schedule, goods: int, bank_share: int, store_fee: int):
    """Split each installment into goods / bank-share / store-fee parts proportionally; rounding goes to the last one."""
    total = goods + bank_share + store_fee
    parts, acc = [], [0, 0, 0]
    for k, (seq, due, amt) in enumerate(schedule):
        if k == len(schedule) - 1:
            g, b = goods - acc[0], bank_share - acc[1]
        else:
            g, b = amt * goods // total, amt * bank_share // total
        f = amt - g - b
        acc = [acc[0] + g, acc[1] + b, acc[2] + f]
        parts.append((seq, due, amt, g, b, f))
    return parts
