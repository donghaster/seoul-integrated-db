# -*- coding: utf-8 -*-
"""가지고 있는 API 키가 실제로 먹히는지 한 번씩 걸어 본다.

키 값은 .env에서 읽어 요청에만 쓰고, 화면에는 앞 4자리와 길이만 보여 준다.
어느 키가 어느 파일에 있는지, 살아 있는지만 확인하는 것이 목적이다.

실행:  py tools/check_keys.py
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIBLING = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard")

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


def read_env() -> tuple[dict, str]:
    for path in (os.path.join(BASE_DIR, ".env"), os.path.join(SIBLING, ".env")):
        if not os.path.exists(path):
            continue
        found = {}
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if v.strip():
                found[k.strip()] = v.strip()
        if found:
            return found, path
    return {}, ""


def mask(v: str) -> str:
    return f"{v[:4]}…({len(v)}자)"


def get(url: str, timeout: int = 30) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=_SSL) as r:
            return True, r.read(4000).decode("utf-8", "replace")
    except Exception as exc:                       # noqa: BLE001
        return False, str(exc)


def check_seoul(key: str) -> str:
    ok, body = get(f"http://openapi.seoul.go.kr:8088/{key}/json/TbgisTrdarRelm/1/1/")
    if not ok:
        return f"연결 실패 — {body[:70]}"
    try:
        head = json.loads(body)
        node = head[next(iter(head))]
        res = (node.get("RESULT") or {})
        if res.get("CODE") not in (None, "INFO-000"):
            return f"거부됨 — {res.get('CODE')} {res.get('MESSAGE')}"
        return f"정상 (상권 {int(node.get('list_total_count') or 0):,}개 조회됨)"
    except Exception:
        return "응답을 못 읽음 — 키가 틀렸을 수 있습니다"


def check_molit(key: str) -> str:
    q = urllib.parse.urlencode({
        "serviceKey": key, "LAWD_CD": "11650", "DEAL_YMD": "202606", "numOfRows": "1",
    })
    ok, body = get("https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?" + q)
    if not ok:
        return f"연결 실패 — {body[:70]}"
    if "<resultCode>00" in body or "NORMAL SERVICE" in body:
        return "정상"
    if "SERVICE_KEY_IS_NOT_REGISTERED" in body or "30" in body[:400] and "SERVICE" in body:
        return "키가 등록되지 않았습니다 — 활용신청 승인을 확인하세요"
    return "응답이 예상과 다릅니다 — " + body[:90].replace("\n", " ")


def check_kakao(key: str) -> str:
    req = urllib.request.Request(
        "https://dapi.kakao.com/v2/local/search/address.json?query=" + urllib.parse.quote("서초구 반포동"),
        headers={"Authorization": "KakaoAK " + key})
    try:
        with urllib.request.urlopen(req, timeout=20, context=_SSL) as r:
            json.loads(r.read().decode("utf-8"))
        return "정상"
    except Exception as exc:                       # noqa: BLE001
        return f"실패 — {str(exc)[:70]}"


def main() -> None:
    keys, path = read_env()
    if not keys:
        raise SystemExit(".env를 찾지 못했습니다.")
    print(f"키 파일: {path}\n")
    checks = [
        ("DATA_GO_KR_KEY", "국토교통부 실거래가", check_molit),
        ("KAKAO_REST_KEY", "카카오 지오코딩", check_kakao),
        ("SEOUL_OPEN_DATA_KEY", "서울 열린데이터광장", check_seoul),
        ("REB_ONE_KEY", "한국부동산원 R-ONE(임대시세)", None),
    ]
    for name, ko, fn in checks:
        v = keys.get(name)
        if not v:
            print(f"  {ko:<26} 없음")
            continue
        if fn is None:
            print(f"  {ko:<26} {mask(v)} — 아직 연결한 곳이 없습니다")
            continue
        print(f"  {ko:<26} {mask(v)} … ", end="", flush=True)
        print(fn(v))


if __name__ == "__main__":
    main()
