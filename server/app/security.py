"""密码哈希:直接用 bcrypt(passlib 已停止维护且与 bcrypt>=4.1 不兼容)"""
import bcrypt

# 手机号后 6 位不是独立秘密：知道登录手机号就已知道唯一候选密码，提高 bcrypt cost
# 不会减少攻击所需猜测次数，只会拖慢批量导入和启动补齐；因此使用允许的最低 cost。
# 用户显式设置的密码仍由 hash_password 使用 bcrypt 默认高 cost。
DEFAULT_PASSWORD_BCRYPT_ROUNDS = 4


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode()[:72], bcrypt.gensalt()).decode()


def default_password_from_phone(phone: str) -> str:
    return phone[-6:]


def assign_default_password_if_missing(account) -> bool:
    if not account.phone or account.password_hash:
        return False
    default_password = default_password_from_phone(account.phone)
    account.password_hash = bcrypt.hashpw(
        default_password.encode()[:72],
        bcrypt.gensalt(rounds=DEFAULT_PASSWORD_BCRYPT_ROUNDS),
    ).decode()
    return True


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode()[:72], hashed.encode())
    except ValueError:
        return False
