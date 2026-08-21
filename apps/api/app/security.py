import hashlib
import hmac
import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import get_settings

settings = get_settings()
password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)
dummy_password_hash = password_hasher.hash("not-a-valid-password")


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hmac.new(settings.secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def hash_identifier(identifier: str) -> str:
    return hmac.new(
        settings.secret_key.encode(), identifier.casefold().encode(), hashlib.sha256
    ).hexdigest()


def derive_csrf_token(session_token_hash: str) -> str:
    return hmac.new(
        settings.secret_key.encode(),
        f"csrf:{session_token_hash}".encode(),
        hashlib.sha256,
    ).hexdigest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    candidate_hash = password_hash or dummy_password_hash
    try:
        return password_hasher.verify(candidate_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return password_hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def compare_token(raw_token: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_token(raw_token), expected_hash)
