"""Authentication for the Almas API (W-14, W-15). The database (core/schema/025_auth.sql) keeps the rules and the history;
this module does the cryptography the database must never see in clear:
  * passwords → Argon2id hashes (argon2-cffi); a password is never stored, logged or returned;
  * session tokens and API keys → random 256-bit secrets given to the caller ONCE; only their SHA-256 is stored;
  * TOTP second factor (RFC 6238, 30 s, 6 digits) with its secret encrypted by ALMAS_SECRET_KEY (Fernet), which lives
    outside the database; a used code cannot be replayed.
Operator bootstrap (first administrator), run with direct database access:
    ALMAS_PG_DSN=... python -m api.auth set-password <username>
"""
from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import os
import secrets
import struct
import sys
import time
import urllib.parse

import psycopg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet

PH = PasswordHasher()                      # Argon2id, library defaults (RFC 9106 recommended parameters)
_DUMMY = PH.hash("not a password")         # equal work when the user does not exist (no user enumeration by timing)
MIN_LENGTH = 10


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(pw: str, username: str) -> str:
    if len(pw) < MIN_LENGTH:
        raise ValueError(f"رمز باید دست‌کم {MIN_LENGTH} نویسه باشد")
    if pw.strip().lower() == username.strip().lower():
        raise ValueError("رمز نباید همان نام کاربری باشد")
    return PH.hash(pw)


def verify_password(stored: str | None, pw: str) -> bool:
    try:
        return PH.verify(stored or _DUMMY, pw) and stored is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ---- TOTP (RFC 6238) ----
def _fernet() -> Fernet:
    key = os.environ.get("ALMAS_SECRET_KEY")
    if not key:
        raise RuntimeError("ALMAS_SECRET_KEY is not configured (needed for the second factor)")
    return Fernet(key.encode())


def encrypt_secret(b32: str) -> str:
    return _fernet().encrypt(b32.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp(b32: str, step: int) -> str:
    key = base64.b32decode(b32 + "=" * (-len(b32) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def totp_match(b32: str, code: str, now: float | None = None) -> int | None:
    """The matching time step (±1 step of clock drift), or None."""
    code = (code or "").strip()
    step = int((now or time.time()) // 30)
    for s in (step - 1, step, step + 1):
        if hmac.compare_digest(totp(b32, s), code):
            return s
    return None


def otpauth_uri(b32: str, username: str) -> str:
    return f"otpauth://totp/{urllib.parse.quote('Almas:' + username)}?secret={b32}&issuer=Almas&digits=6&period=30"


def _cli():
    if len(sys.argv) != 3 or sys.argv[1] != "set-password":
        sys.exit("usage: python -m api.auth set-password <username>")
    user = sys.argv[2]
    pw = getpass.getpass("new password: ")
    if pw != getpass.getpass("again: "):
        sys.exit("passwords differ")
    with psycopg.connect(os.environ["ALMAS_PG_DSN"], autocommit=True) as c:
        c.execute("SELECT set_config('almas.operator_cli', 'on', false)")
        c.execute("SELECT core.auth_set_password(%s, %s, %s, true, 'operator cli')", (user, hash_password(pw, user), f"system:{getpass.getuser()}"))
    print(f"password set for {user}; it must be changed at first sign-in")


if __name__ == "__main__":
    _cli()
