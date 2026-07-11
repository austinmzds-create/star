"""标注格式("字段名:值")样本解析回归测试。

从 server 目录运行:
    python -m pytest tests/test_parse_labeled.py
或直接执行(无 pytest 时):
    python tests/test_parse_labeled.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.parser import parse_regex  # noqa: E402

SAMPLE = """宝子你好👋这是我的账号信息，
达人昵称：二宝妈妈😇
抖音号：53341363
Uid: 64554857595
合作码：52439335531
收件人：淳如意
收件电话：15095037973
收件地址：山东省聊城市临清市大辛庄街道御龙湾小区
等级  1级
主页链接 二宝妈妈😇的抖音 - 抖音 1@0.com :4pm"""


def test_parse_labeled():
    out = parse_regex(SAMPLE)
    assert out.get("nickname") == "二宝妈妈😇", out.get("nickname")
    assert out.get("douyin_id") == "53341363", out.get("douyin_id")
    assert out.get("douyin_uid") == "64554857595", out.get("douyin_uid")
    assert out.get("cooperation_code") == "52439335531", out.get("cooperation_code")
    assert out.get("real_name") == "淳如意", out.get("real_name")
    assert out.get("phone") == "15095037973", out.get("phone")
    assert "山东省聊城市临清市大辛庄街道御龙湾小区" in (out.get("default_address") or "")
    assert out.get("level") == "L1", out.get("level")
    assert out.get("homepage_url") in (None, ""), out.get("homepage_url")
    assert "1@0.com" in (out.get("homepage_raw") or ""), out.get("homepage_raw")
    # 回归:合作码不能被当成手机号
    assert out.get("phone") != out.get("cooperation_code")


if __name__ == "__main__":
    try:
        test_parse_labeled()
        print("PASS")
    except AssertionError as e:
        print("FAIL:", e)
        sys.exit(1)
