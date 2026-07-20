"""身份字段规范化:手机号等唯一标识入库/匹配前统一口径,避免同一个人产生多条档案。

背景:商务建档填的手机号,和达人短信登录输入的手机号,只有"完全相等"才能匹配到
同一条档案。若不统一格式(空格/连字符/+86/全角数字),达人登录就会新建一条空号,
拿不到商务已准备好的抖音号/寄样地址等资料。这里把口径收敛到一处。
"""
import re

# 去掉空格、连字符、中英文括号、点(常见复制粘贴噪声)
_PHONE_NOISE = re.compile(r"[\s\-().（）]")
_CN_MOBILE = re.compile(r"1\d{10}")


def _to_halfwidth(value: str) -> str:
    """全角数字/加号 → 半角(输入法常见)。"""
    out = []
    for ch in value:
        code = ord(ch)
        if 0xFF10 <= code <= 0xFF19:      # 全角 ０-９
            out.append(chr(code - 0xFEE0))
        elif code == 0xFF0B:              # 全角 ＋
            out.append("+")
        else:
            out.append(ch)
    return "".join(out)


def normalize_phone(value) -> str | None:
    """中国大陆手机号规范化 → 裸 11 位;空或格式非法返回 None。

    统一处理:全角转半角、去空格/连字符/括号、去 +86 / 86 前缀。
    仅接受 1 开头的 11 位号(与短信登录入口口径一致)。
    """
    if value is None:
        return None
    s = _PHONE_NOISE.sub("", _to_halfwidth(str(value)).strip())
    if not s:
        return None
    if s.startswith("+86"):
        s = s[3:]
    elif s.startswith("86") and len(s) == 13:
        s = s[2:]
    return s if _CN_MOBILE.fullmatch(s) else None
