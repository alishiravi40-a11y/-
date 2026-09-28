"""Automatic bank reconciliation (core 010). Rules, strictest first; a rule only fires when the match is UNAMBIGUOUS
(exactly one candidate on both sides), everything else is left for a person:

  1. exact        — same direction, same amount, same date;
  2. window       — same direction, same amount, dates within `bank_recon_date_window_days` (default 3);
  3. same_day_sum — all still-open book lines of one date and direction add up exactly to one statement line of
                    that date (e.g. several POS receipts settled as one bank credit), or the reverse (several bank fee
                    lines booked as one entry).
Every group goes through core.reconcile (balance check, permission, one live group per line).
"""
from __future__ import annotations


def auto_match(conn, account: int, user: str) -> dict:
    """The rules run in the database (core.bank_auto_reconcile, catalogued as bank.auto_reconcile) — the screen, the API
    and this function use the same implementation."""
    return conn.execute("SELECT core.bank_auto_reconcile(%s, %s)", (account, user)).fetchone()[0]
