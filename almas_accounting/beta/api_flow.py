"""The Beta sale, as the agent or the salesperson experiences it — three simple steps; the bank details stay behind:

  1. check(request)          → inquiry + valid months; returns what (if anything) blocks the sale, in plain Persian
  2. send_code(request)      → local precheck, then the bank sends the customer a one-time code (valid 2 minutes)
  3. confirm(request, code)  → registers the sale at the bank with the request's own requestId; an unclear answer is
                                resolved by order/{requestId} automatically — never by a second sale
Then, centrally (service user, never the agent): sync(order) → the bank's installment table → the Almas contract.

Every call is evidence in core.beta_api_call; the database decides every state change (core.beta_ingest_call).
"""
from __future__ import annotations

from beta.api_client import BetaApi


class SaleBlocked(Exception):
    def __init__(self, reasons: list[str]):
        super().__init__("؛ ".join(reasons))
        self.reasons = reasons


def _request(conn, rid: int) -> dict:
    cur = conn.execute("SELECT * FROM core.beta_sale_request WHERE id = %s", (rid,))
    cols = [d.name for d in cur.description]
    return dict(zip(cols, cur.fetchone()))


def check(api: BetaApi, rid: int) -> dict:
    r = _request(api.conn, rid)
    inq = api.credit_inquiry(r["national_id"], sale_request=rid)
    api.valid_months()
    pre = api.conn.execute("SELECT ok, blocking, warnings, installment_amount, credit, valid_months FROM core.beta_sale_precheck(%s, %s)",
                           (api.user, rid)).fetchone()
    reasons = list(pre[1])
    if inq["outcome"] != "ok":
        reasons.insert(0, inq["message"] or "استعلام انجام نشد")
    return {"ok": pre[0] and inq["outcome"] == "ok", "blocking": reasons, "warnings": list(pre[2]), "installment": pre[3],
            "credit": pre[4], "valid_months": list(pre[5] or [])}


def send_code(api: BetaApi, rid: int) -> dict:
    pre = api.conn.execute("SELECT ok, blocking FROM core.beta_sale_precheck(%s, %s)", (api.user, rid)).fetchone()
    if not pre[0]:
        raise SaleBlocked(list(pre[1]))
    r = _request(api.conn, rid)
    res = api.call("otp_request", path_args={"nationalCode": r["national_id"]}, sale_request=rid,
                   body={"title": r["title"], "startDate": None, "amount": int(r["amount"]),
                         "numberOfInstallments": r["installment_count"], "startDateYearMonth": r["start_year_month"]})
    if res["outcome"] != "ok":
        raise SaleBlocked([res["message"] or f"خطای {res['status'] or res['http_status']}"])
    return res


def confirm(api: BetaApi, rid: int, code: str) -> dict:
    r = _request(api.conn, rid)
    if r["status"] != "otp_sent":
        raise SaleBlocked([f"ابتدا رمز یکبار مصرف ارسال شود (وضعیت: {r['status']})"])
    fp = api.conn.execute("SELECT core.beta_sale_fingerprint(r) FROM core.beta_sale_request r WHERE id = %s", (rid,)).fetchone()[0]
    if fp != r["otp_fingerprint"]:
        raise SaleBlocked(["اطلاعات فروش پس از ارسال رمز تغییر کرده است؛ رمز جدید لازم است"])
    res = api.call("consume", path_args={"nationalCode": r["national_id"]}, sale_request=rid,
                   body={"title": r["title"], "startDate": None, "amount": int(r["amount"]), "numberOfInstallments": r["installment_count"],
                         "otp": code, "requestId": str(r["request_id"]), "startDateYearMonth": r["start_year_month"]})
    if _request(api.conn, rid)["status"] == "unknown_outcome":
        resolve(api, rid)
    return _request(api.conn, rid) | {"call": res}


def resolve(api: BetaApi, rid: int) -> dict:
    """An unclear registration is resolved by the request's own requestId (idempotency; BA-09)."""
    r = _request(api.conn, rid)
    return api.order_by_request_id(str(r["request_id"]), sale_request=rid)


def sync_order(api: BetaApi, order_id: int, contract_user: str) -> int | None:
    """Fetch the bank's installment table and (idempotently) create / refresh the Almas contract. Central only."""
    res = api.order_installments(order_id)
    if res["outcome"] != "ok":
        return None
    req = api.conn.execute("SELECT request_id FROM core.beta_sale_request WHERE scheme_id = %s AND beta_order_id = %s",
                           (api.scheme_id, order_id)).fetchone()
    if req:                                            # the official order record (title, amount) as the bank holds it
        api.order_by_request_id(str(req[0]))
    return api.conn.execute("SELECT core.beta_contract_from_order(%s, %s, %s)", (api.scheme_id, order_id, contract_user)).fetchone()[0]


def sync_month(api: BetaApi, year_month: str) -> dict:
    """All sales of a Jalali month (panel or API) — the basis of 'bank has / Almas has not' (BA-01)."""
    return api.order_list(year_month)
