"""密码哈希:直接用 bcrypt(passlib 已停止维护且与 bcrypt>=4.1 不兼容)"""
import bcrypt


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode()[:72], bcrypt.gensalt()).decode()


def default_password_from_phone(phone: str) -> str:
    return phone[-6:]


def assign_default_password_if_missing(account) -> bool:
    if not account.phone or account.password_hash:
        return False
    account.password_hash = hash_password(default_password_from_phone(account.phone))
    return True


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode()[:72], hashed.encode())
    except ValueError:
        return False
