"""Refah Bank Beta services — HTTP client that records EVERY call as immutable evidence (core.beta_api_call, core 021).

Source: «مستندات راهبری بانکداری باز بانک رفاه – سرویس‌های بستر تامین اعتبار (بتا)», revision 1.3, Farvardin 1402.
NOT VERIFIED FOR TODAY (D-23): the endpoints, authentication and contract below are those of a 1402 document. The client
refuses to run while the setting beta_api_mode is 'disabled' (the default), and in 'simulated' mode it only accepts an
explicit in-process transport (beta.api_simulator). Only a person can switch to 'production' (settings.change).

Design rules:
  * The bank is evidence, not the source of truth: this module never writes money or accounting. It records the call and
    the database derives observations (core.beta_ingest_call) inside the same transaction.
  * No secrets are stored: api-key, token and client secret stay in memory; the OTP is masked before storage.
  * Idempotency: a sale is registered with the sale request's own requestId (uuid, generated once). An unclear consume
    result is resolved by order/{requestId}; it is never "retried" as a new sale.
"""
from __future__ import annotations

import datetime as dt
import json
import os

import httpx
from psycopg.types.json import Jsonb

DOC_BASE_URL = "https://api.rb24.ir/beta/1.0"          # revision 1.3 (1402/01); cURL samples also show /beta/1/ (U-B7)
DOC_TOKEN_URL = "https://api.rb24.ir/connect/token"    # OAuth2; table says JSON body, cURL sample says form-encoded (U-B7)

# endpoint → (HTTP method, path template) exactly as in the document's tables
ENDPOINTS = {
    "credit_inquiry": ("POST", "credit/{nationalCode}/inquiry"),
    "otp_request": ("POST", "credit/{nationalCode}/request"),
    "consume": ("POST", "credit/{nationalCode}/consume"),
    "order_list": ("GET", "order/{yearMonth}/all"),
    "order_installments": ("GET", "order/{id}/installments"),
    "order_delete": ("DELETE", "order/{id}/delete"),
    "installment_delete": ("DELETE", "order/{id}/installments/{installmentId}/delete"),
    "edit_request": ("POST", "order/{id}/request"),
    "edit": ("PUT", "order/{id}"),
    "order_by_request_id": ("GET", "order/{requestId}"),
    "valid_months": ("GET", "date/validate"),
}


class BetaApiDisabled(RuntimeError):
    pass


class BetaApi:
    def __init__(self, conn, scheme_id: int, user: str, *, transport: httpx.BaseTransport | None = None,
                 base_url: str | None = None, api_key: str | None = None, token: str | None = None,
                 terminal_name: str | None = None, timeout: float = 20.0):
        self.conn, self.scheme_id, self.user = conn, scheme_id, user
        mode = conn.execute("SELECT core.setting_value('beta_api_mode')").fetchone()[0]
        if mode == "disabled":
            raise BetaApiDisabled("Beta API is disabled (setting beta_api_mode; the 1402 document must be verified first — D-23)")
        if mode == "simulated" and transport is None:
            raise BetaApiDisabled("simulated mode needs an in-process transport (beta.api_simulator); no network is used")
        if mode == "production" and transport is not None:
            raise BetaApiDisabled("production mode talks to the bank only")
        self.mode = mode
        headers = {"Content-Type": "application/json"}
        key = api_key or os.environ.get("BETA_API_KEY")
        if key:
            headers["apikey"] = key
        tok = token or os.environ.get("BETA_API_TOKEN")
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        if terminal_name:
            headers["TerminalName"] = terminal_name      # «Token و TerminalName (= ClientId) در هدر» — meaning unclear (U-B7)
        self.http = httpx.Client(base_url=(base_url or DOC_BASE_URL).rstrip("/") + "/", headers=headers, timeout=timeout, transport=transport)

    def call(self, endpoint: str, *, path_args: dict | None = None, body: dict | None = None,
             sale_request: int | None = None, order_ref: int | None = None) -> dict:
        """Run one documented service; record it; return {call_id, outcome, http_status, status, message, data}."""
        method, tmpl = ENDPOINTS[endpoint]
        path = tmpl.format(**(path_args or {}))
        started = dt.datetime.now(dt.timezone.utc)
        http_status = response = error = None
        # authorise BEFORE anything leaves the building (agent scope, people-only operations, mode)
        self.conn.execute("SELECT core.beta_authorize_call(%s, %s, %s)", (self.user, endpoint, sale_request))
        try:
            r = self.http.request(method, path, json=body if body is not None else None)
            http_status = r.status_code
            try:
                response = r.json()
            except ValueError:
                response = {"_raw": r.text[:4000]}
        except httpx.HTTPError as e:                  # timeout / connection: the outcome at the bank is UNKNOWN
            error = f"{type(e).__name__}: {e}"[:500]
        stored = dict(body) if body else None
        if stored and "otp" in stored:
            stored["otp"] = "***"
        with self.conn.transaction():
            cid = self.conn.execute(
                "SELECT core.beta_record_call(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (self.user, self.scheme_id, endpoint, method, path, Jsonb(stored) if stored is not None else None, http_status,
                 Jsonb(response) if response is not None else None, error, started, sale_request, order_ref)).fetchone()[0]
        row = self.conn.execute("SELECT outcome, business_status, message FROM core.beta_api_call WHERE id = %s", (cid,)).fetchone()
        data = response.get("data", response.get("Data")) if isinstance(response, dict) else None
        return {"call_id": cid, "outcome": row[0], "http_status": http_status, "status": row[1], "message": row[2], "data": data}

    # ---- documented services ----
    def credit_inquiry(self, national_code: str, sale_request: int | None = None):
        return self.call("credit_inquiry", path_args={"nationalCode": national_code}, sale_request=sale_request)

    def valid_months(self):
        return self.call("valid_months")

    def order_list(self, year_month: str):
        if not (len(year_month) == 6 and year_month.isdigit()):
            raise ValueError("yearMonth is YYYYMM, e.g. 140501")
        return self.call("order_list", path_args={"yearMonth": year_month})

    def order_installments(self, order_id: int):
        return self.call("order_installments", path_args={"id": order_id}, order_ref=order_id)

    def order_by_request_id(self, request_id: str, sale_request: int | None = None):
        return self.call("order_by_request_id", path_args={"requestId": request_id}, sale_request=sale_request)

    def order_delete(self, order_id: int):
        return self.call("order_delete", path_args={"id": order_id}, order_ref=order_id)

    def installment_delete(self, order_id: int, installment_id: int):
        return self.call("installment_delete", path_args={"id": order_id, "installmentId": installment_id}, order_ref=order_id)

    def close(self):
        self.http.close()


def dumps(o) -> str:
    return json.dumps(o, ensure_ascii=False, default=str)
