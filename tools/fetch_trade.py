# -*- coding: utf-8 -*-
"""서울시 상권분석서비스 원본을 받아 .cache에 쌓는다.

상권분석 대시보드(docs/trade)의 재료다. 네 가지를 받는다.

  영역   TbgisTrdarRelm     상권 1,650개의 이름·자치구·행정동·좌표·면적
  유동인구 VwsmTrdarFlpopQq   성별·연령·시간대·요일별 분기 유동인구
  점포   VwsmTrdarStorQq    업종별 점포수·프랜차이즈·개업률·폐업률
  매출   VwsmTrdarSelngQq   업종별 추정매출액·건수·요일·시간대

점포는 전체가 160만 건이라 통째로 받으면 1,600페이지가 넘는다.
분기 코드로 걸러 최신 분기(약 7.6만 건)만 받는다.

실행:  py tools/fetch_trade.py
"""
from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, ".cache")
SIBLING = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard")

PAGE = 1000                       # 이 API의 1회 최대 건수
CACHE_VER = "v1"

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


def _load_key() -> str:
    key = os.environ.get("SEOUL_OPEN_DATA_KEY", "").strip()
    if key:
        return key
    for path in (os.path.join(BASE_DIR, ".env"), os.path.join(SIBLING, ".env")):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.strip().startswith("SEOUL_OPEN_DATA_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


KEY = _load_key()


def _get(svc: str, start: int, end: int, extra: str = "") -> dict:
    """열린데이터광장 한 페이지. 서버가 가끔 흔들려 몇 번 다시 걸어 본다."""
    url = f"http://openapi.seoul.go.kr:8088/{KEY}/json/{svc}/{start}/{end}/{extra}"
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60, context=_SSL) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            return body[next(iter(body))]
        except Exception as exc:                      # noqa: BLE001 - 어떤 오류든 재시도
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"{svc} {start}~{end}: {last}")


def fetch_all(svc: str, extra: str = "", label: str = "") -> list[dict]:
    """전체 페이지를 훑는다. 총 건수는 첫 페이지가 알려 준다."""
    head = _get(svc, 1, 1, extra)
    total = int(head.get("list_total_count") or 0)
    if not total:
        return []
    rows: list[dict] = []
    for start in range(1, total + 1, PAGE):
        end = min(start + PAGE - 1, total)
        rows.extend(_get(svc, start, end, extra).get("row") or [])
        if label and (start // PAGE) % 10 == 0:
            print(f"  {label} {len(rows):,}/{total:,} …", flush=True)
    return rows


def latest_quarter(svc: str) -> str:
    """이 서비스가 가진 가장 최근 분기 코드.

    앞쪽 페이지를 훑어 최댓값을 고르는 방식은 못 믿는다 — 열린데이터광장은
    정렬을 보장하지 않아, 매출에서 실제로는 20261이 있는데 20231을 최신으로
    잘못 골랐다. 오늘부터 분기를 거꾸로 짚어 건수가 잡히는 첫 분기를 쓴다.
    """
    from datetime import date

    t = date.today()
    y, q = t.year, (t.month - 1) // 3 + 1
    for _ in range(12):                              # 3년치까지만 거슬러 본다
        code = f"{y}{q}"
        try:
            if int(_get(svc, 1, 1, f"{code}/").get("list_total_count") or 0) > 0:
                return code
        except RuntimeError:
            pass
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return ""


def save(name: str, rows: list) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"trade-{name}-{CACHE_VER}.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return path


def main() -> None:
    if not KEY:
        raise SystemExit("SEOUL_OPEN_DATA_KEY가 없습니다. .env에 넣어 주세요.")

    t0 = time.time()

    print("상권 영역…", flush=True)
    area = fetch_all("TbgisTrdarRelm", label="영역")
    print(f"  상권 {len(area):,}개")
    save("area", area)

    for svc, name, ko in (
        ("VwsmTrdarFlpopQq", "flpop", "유동인구"),
        ("VwsmTrdarStorQq", "store", "점포"),
        ("VwsmTrdarSelngQq", "selng", "매출"),
    ):
        q = latest_quarter(svc)
        print(f"{ko} (최신 분기 {q})…", flush=True)
        rows = fetch_all(svc, extra=f"{q}/", label=ko)
        print(f"  {len(rows):,}건")
        save(name, rows)

    print(f"완료 / {time.time() - t0:.0f}초", flush=True)


if __name__ == "__main__":
    main()
