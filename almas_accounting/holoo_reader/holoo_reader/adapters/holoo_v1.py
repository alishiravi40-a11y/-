"""Adapter for the Holoo SQL Server schema family observed in holoo1_1404 (program 1405.06.18, DB version 782).

Code maps below are the ones PROVEN in reverse_engineering/hesabdari_rasmi (see evidence E01–E11).
"""

# FACTURE.Fac_Type → (canonical kind, Persian label, stock sign or None if no stock effect)
DOC_KINDS = {
    "F": ("sale", "فاکتور فروش", -1),
    "K": ("purchase", "فاکتور خرید", +1),
    "Y": ("sale_return", "برگشت از فروش", +1),
    "X": ("purchase_return", "برگشت از خرید", -1),
    "Z": ("waste", "ضایعات", -1),
    "S": ("transfer_out", "حواله بین انبار (مبدأ)", -1),
    "D": ("transfer_in", "حواله بین انبار (مقصد)", +1),
    "Q": ("sale_voided", "فاکتور فروش ابطال‌شده", None),   # E01: no stock effect, voucher left in ledger
    "W": ("quick_sale", "فروش فوری", -1),
}

# SANAD.Sanad_Type → label (PROVEN by samples and account patterns)
VOUCHER_TYPES = {
    0: "عملیات خودکار چک / افتتاحیه", 1: "واریز و انتقال بانکی", 2: "واریز به صندوق", 4: "دریافت",
    5: "پرداخت", 7: "کارمزد بانکی", 8: "دریافت چک", 13: "سند فاکتور (فروش، برگشت خرید، ضایعات، ابطال‌شده)",
    14: "سند فاکتور (خرید، برگشت فروش)", 20: "سند دستی/عمومی", None: "بستن حساب‌ها/اختتامیه",
}

VOUCHER_STATES = {0: "normal", 1: "opening", 2: "closing_temporary", 3: "closing"}

# SND_LIST.Type_Line
LINE_ROLES = {"F": "party_invoice", "S": "party_settlement", "Z": "settlement_instrument", " ": "counter", "": "counter"}

# Check_Event.State (RetVazeatCheck + data)
CHEQUE_STATES = {
    "D": "received", "J": "in_collection", "V": "collected_or_spent", "R": "returned_from_bank",
    "B": "returned_to_party", "S": "returned_to_cash", "M": "moved_between_cashboxes",
    "P": "issued", "O": "issued_bounced",
}
IN_HAND = ("D", "S", "M", "R")

# Process.KindProc / NameProc
AUDIT_KINDS = {"A": "add", "E": "edit", "D": "delete", "P": "reprint", "L": "login"}
AUDIT_OBJECTS = {"F": "sale_invoice", "K": "purchase_invoice", "X": "purchase_return", "Y": "sale_return",
                 "Z": "waste", "S": "voucher", "C": "cheque_bank", "H": "stock_transfer", "J": "party",
                 "M": "item", "B": "account", "Q": "installment", "4": "report", "7": "backup", "11": "user_access",
                 "L": "session", "P": "proforma", "V": "opening_balance"}

SERVICE_ITEM_PREFIX = "01"   # items 01xxxxx are services/expenses with synthetic stock
WEB_SERVICE_USER = 3         # USERDB user used by the web-service channel
