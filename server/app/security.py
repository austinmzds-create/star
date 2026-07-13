"""密码哈希:直接用 bcrypt(passlib 已停止维护且与 bcrypt>=4.1 不兼容)"""
import bcrypt

# 手机号后 6 位不是独立秘密：知道登录手机号就已知道唯一候选密码，提高 bcrypt cost
# 不会减少攻击所需猜测次数，只会拖慢批量导入和启动补齐；因此使用允许的最低 cost。
# 用户显式设置的密码仍由 hash_password 使用 bcrypt 默认高 cost。
DEFAULT_PASSWORD_BCRYPT_ROUNDS = 4
STANDARD_PASSWORD_BCRYPT_ROUNDS = 12

# 固定的标准 cost bcrypt hash，仅用于不存在账号、无 hash 和低 cost 密码错误时
# 消耗与正常登录相当的计算量。不要在请求路径中动态生成 dummy hash。
_LOGIN_DUMMY_HASH = (
    "$2b$12$jxucSBC1vTSx/Xw3NHsIuONDwacNEU/B/h2hqmrFLI6ymb6zAzkoa"
)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(
        plain.encode()[:72],
        bcrypt.gensalt(rounds=STANDARD_PASSWORD_BCRYPT_ROUNDS),
    ).decode()


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


def verify_login_password(plain: str, hashed: str | None) -> tuple[bool, str | None]:
    """校验登录密码，并用标准 cost 补齐未知账号和低 cost 路径的计算量。

    返回 ``(是否匹配, 升级后的hash)``。第二项仅在低 cost 密码匹配时提供，
    调用方应将它持久化，从而不改变凭证地完成首次登录升级。
    """
    plain_bytes = plain.encode()[:72]
    if not hashed:
        bcrypt.checkpw(plain_bytes, _LOGIN_DUMMY_HASH.encode())
        return False, None

    try:
        matched = bcrypt.checkpw(plain_bytes, hashed.encode())
        rounds = int(hashed.split("$")[2])
    except (ValueError, IndexError):
        bcrypt.checkpw(plain_bytes, _LOGIN_DUMMY_HASH.encode())
        return False, None

    if rounds < STANDARD_PASSWORD_BCRYPT_ROUNDS:
        if matched:
            return True, hash_password(plain)
        bcrypt.checkpw(plain_bytes, _LOGIN_DUMMY_HASH.encode())
    return matched, None
