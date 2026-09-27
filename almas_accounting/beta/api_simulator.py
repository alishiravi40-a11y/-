"""In-process SIMULATOR of the Refah Bank Beta services, written from BetaApiDoc revision 1.3 (1402/01) only.

For tests, training and demos (setting beta_api_mode = 'simulated'). It is NOT the bank: where the document is silent,
the simulator's choice is marked "assumption" and must never be read as bank behaviour (see docs/BETA_API_FA.md, U-B*).
Behaviour taken from the document:
  * inquiry returns the customer's monthly repayment capacity («توان بازپرداخت ماهانه»); errors 4443/4450/4451/4452/4455;
  * OTP valid 2 minutes, no new OTP while one is valid (4444); the OTP is bound to the request data (4446 otherwise);
  * at most 36 installments (4462); at most 8 purchases a month per customer per acceptor (4463); over credit (4461);
  * duplicate requestId → 4406; order list per Jalali month YYYYMM (4447); installment table per order (4460);
  * deleting an order only before any installment was processed (4464); business errors come with HTTP 200.
"""
from __future__ import annotations

import datetime as dt
import itertools
import json
import random
import re

import httpx
import jdatetime

from beta.schedule import jalali_month_end


class BetaSimulator:
    def __init__(self, clock=None, acceptor_state: str = "active", seed: int = 7):
        self.clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.acceptor_state = acceptor_state                 # active | inactive (4473) | no_agreement (4775) | fee_undefined (4476)
        self.customers: dict[str, dict] = {}                 # national code → {credit, profile, signed, validated, other_scheme}
        self.otps: dict[str, dict] = {}                      # national code → {code, fingerprint, expires}
        self.orders: dict[int, dict] = {}
        self.by_request: dict[str, int] = {}
        self._order_ids = itertools.count(22401)
        self._inst_ids = itertools.count(900001)
        self.rng = random.Random(seed)
        self.fail_next: str | None = None                    # 'timeout' | 'http500' | 'lost_response' (registered, answer lost)
        self.sent_otps: list[tuple[str, str]] = []           # what "the customer's phone" received (tests read it)

    # ---- scenario helpers ----
    def add_customer(self, national_code: str, credit: int, **flags):
        self.customers[national_code] = {"credit": credit, "profile": True, "signed": True, "validated": True, "other_scheme": False, **flags}

    def process_installment(self, order_id: int, seq: int, success: bool, when: dt.date | None = None):
        inst = self.orders[order_id]["installments"][seq - 1]
        inst["status"], inst["settled"] = ("Success", True) if success else ("Rejected", False)
        inst["settle"] = (when or self.clock().date()) if success else None

    def last_otp(self, national_code: str) -> str:
        return next(code for nc, code in reversed(self.sent_otps) if nc == national_code)

    # ---- transport ----
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if self.fail_next == "timeout":
            self.fail_next = None
            raise httpx.ReadTimeout("simulated timeout", request=request)
        if self.fail_next == "http500":
            self.fail_next = None
            return httpx.Response(500, json={"result": [{"code": 500, "message": "خطای سیستمی"}]})
        if "apikey" not in request.headers:
            return self._ok(4403, "api-key را به درستی وارد کنید")
        path = request.url.path.split("/beta/1.0/", 1)[-1]
        body = json.loads(request.content) if request.content else {}
        m = request.method
        routes = [
            ("POST", r"credit/(\d+)/inquiry", self._inquiry), ("POST", r"credit/(\d+)/request", self._otp_request),
            ("POST", r"credit/(\d+)/consume", self._consume), ("GET", r"order/(\d{6})/all", self._list),
            ("GET", r"order/(\d+)/installments", self._installments), ("DELETE", r"order/(\d+)/delete", self._delete),
            ("GET", r"order/([0-9a-fA-F-]{36})", self._by_request), ("GET", r"date/validate", self._valid_months),
        ]
        for meth, pat, fn in routes:
            mm = re.fullmatch(pat, path)
            if meth == m and mm:
                return fn(*mm.groups(), body=body)
        return httpx.Response(404, json={"message": "not in the 1.3 document"})

    @staticmethod
    def _ok(status: int, message: str = "", data=None) -> httpx.Response:
        return httpx.Response(200, json={"message": message, "status": status, "data": data})

    def _acceptor_error(self):
        return {"inactive": (4473, "پذیرنده غیرفعال است."), "no_agreement": (4775, "پذیرنده تفاهم نامه فعالی ندارد."),
                "fee_undefined": (4476, "کارمزد شما به درستی تعریف نشده است")}.get(self.acceptor_state)

    def _customer_error(self, nc: str, for_sale: bool):
        c = self.customers.get(nc)
        if not re.fullmatch(r"\d{10}", nc):
            return 4443, "کد ملی اشتباه است."
        if c is None:
            return 4455, "مشتری با این مشخصات یافت نشد."
        if not c["signed"]:
            return 4450, "مشتری اجازه نامه استعلام و کسراقساط را امضا نکرده است."
        if not c["profile"]:
            return 4451, "مشتری پروفایل خود را تکمیل نکرده است."
        if not c["validated"]:
            return 4452, "مشتری اعتبارسنجی نشده یا نیاز به اعتبارسنجی مجدد دارد."
        if for_sale and c["other_scheme"]:
            return 4455, "مشتری در طرح دیگری ثبت نام کرده است"
        return None

    def _inquiry(self, nc, body):
        err = self._customer_error(nc, False)
        if err:
            return self._ok(*err)
        return self._ok(200, "", {"nationalCode": nc, "credit": self.customers[nc]["credit"], "cellphone": "09*********"})

    @staticmethod
    def _fingerprint(nc, b):
        return (nc, b.get("title"), int(b.get("amount") or 0), int(b.get("numberOfInstallments") or 0), b.get("startDateYearMonth"))

    def _sale_input_error(self, nc, b):
        err = self._acceptor_error() or self._customer_error(nc, True)
        if err:
            return err
        if not (b.get("title") or "").strip():
            return 4442, "عنوان اشتباه است."
        n, amount = int(b.get("numberOfInstallments") or 0), int(b.get("amount") or 0)
        if n > 36:
            return 4462, "امکان ایجاد اقساط بیشتر از 36 ماه وجود ندارد."
        if n < 1 or amount < n:
            return 4441, "اطلاعات مبلغ یا تعداد اقساط اشتباه است."
        return None

    def _otp_request(self, nc, body):
        err = self._sale_input_error(nc, body)
        if err:
            return self._ok(*err)
        now = self.clock()
        cur = self.otps.get(nc)
        if cur and cur["expires"] > now:
            return self._ok(4444, "رمز یکبار مصرف برای شما ارسال شده است، لطفاً کمی منتظر بمانید.")
        code = f"{self.rng.randint(0, 999999):06d}"
        self.otps[nc] = {"code": code, "fingerprint": self._fingerprint(nc, body), "expires": now + dt.timedelta(minutes=2)}
        self.sent_otps.append((nc, code))
        return self._ok(200)

    def _consume(self, nc, body):
        rid = body.get("requestId")
        if rid and rid in self.by_request:
            return self._ok(4406, "تکراری است.")
        err = self._sale_input_error(nc, body)
        if err:
            return self._ok(*err)
        otp, now = self.otps.get(nc), self.clock()
        if not otp or otp["expires"] <= now or otp["code"] != body.get("otp") or otp["fingerprint"] != self._fingerprint(nc, body):
            return self._ok(4446, "رمز یکبار مصرف اشتباه است")
        n, amount = int(body["numberOfInstallments"]), int(body["amount"])
        if -(-amount // n) > self.customers[nc]["credit"]:                   # assumption: credit is MONTHLY (U-B1)
            return self._ok(4461, "مبلغ درخواستی بیشتر از اعتبار است.")
        month = jdatetime.date.fromgregorian(date=now.date())
        same_month = [o for o in self.orders.values() if o["nc"] == nc and (o["jy"], o["jm"]) == (month.year, month.month)]
        if len(same_month) >= 8:
            return self._ok(4463, "امکان ثبت بیش از 8 خرید در ماه برای یک مشتری از طرف یک پذیرنده امکان پذیر نیست.")
        del self.otps[nc]
        oid = next(self._order_ids)
        y, m = (int(x) for x in body["startDateYearMonth"].split("/"))
        base, rem = divmod(amount, n)
        insts = []
        for i in range(n):
            yy, mm = y + (m - 1 + i) // 12, (m - 1 + i) % 12 + 1
            insts.append({"id": next(self._inst_ids), "amount": base + (rem if i == n - 1 else 0),   # assumption: remainder on the last (E15 unproven)
                          "due": jalali_month_end(yy, mm).togregorian(), "status": "Created", "settled": False, "settle": None, "deleted": False})
        self.orders[oid] = {"id": oid, "nc": nc, "title": body["title"], "amount": amount, "description": body.get("title"), "request_id": rid,
                            "jy": month.year, "jm": month.month, "installments": insts}
        self.customers[nc]["credit"] -= insts[0]["amount"]                  # assumption: capacity drops by the installment
        if rid:
            self.by_request[rid] = oid
        if self.fail_next == "lost_response":                              # registered at the bank, answer never arrives
            self.fail_next = None
            raise httpx.ReadTimeout("simulated lost response", request=None)
        return self._ok(200, "", oid)

    def _order_json(self, o):
        return {"id": o["id"], "title": o["title"], "amount": o["amount"], "customerNationalCode": o["nc"], "description": o["description"], "projectType": 1}

    def _list(self, ym, body):
        if self._acceptor_error() and self._acceptor_error()[0] == 4473:
            return self._ok(4473, "پذیرنده غیرفعال است.")
        y, m = int(ym[:4]), int(ym[4:])
        if not 1 <= m <= 12:
            return self._ok(4447, "اطلاعات سال ماه جهت دریافت گزارش معتبر نیست")
        rows = [self._order_json(o) for o in self.orders.values() if (o["jy"], o["jm"]) == (y, m)]
        return self._ok(200, "", {"totalRecords": len(rows), "data": rows})

    def _installments(self, oid, body):
        o = self.orders.get(int(oid))
        if not o:
            return self._ok(4460, "شناسه فروش نامعتبر است")
        rows = [{"id": i["id"], "amount": i["amount"], "overdueDate": f"{i['due']}T00:00:00", "settelDate": f"{i['settle']}T10:00:00" if i["settle"] else None,
                 "isSetteled": i["settled"], "orderId": o["id"], "status": i["status"], "statusTitle": i["status"], "isDeleted": i["deleted"]}
                for i in o["installments"]]
        return self._ok(200, "", {"totalRecords": len(rows), "data": rows})

    def _delete(self, oid, body):
        o = self.orders.get(int(oid))
        if not o:
            return self._ok(4460, "شناسه فروش نامعتبر است")
        if any(i["status"] != "Created" for i in o["installments"]):
            return self._ok(4464, "به دلیل پردازش رکوردهای اقساط امکان حذف این فروش وجود ندارد")
        for i in o["installments"]:
            i["deleted"] = True
        return self._ok(200)

    def _by_request(self, rid, body):
        oid = self.by_request.get(rid)
        return self._ok(200, "", self._order_json(self.orders[oid]) if oid else None)   # assumption: not found = 200 with null data (U-B8)

    def _valid_months(self, body):
        today = jdatetime.date.fromgregorian(date=self.clock().date())
        months = {}
        for k in range(4):
            y, m = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
            months[f"{y}/{m:02d}"] = f"{y} - {m:02d}"
        return httpx.Response(200, json={"data": {"data": months}})
