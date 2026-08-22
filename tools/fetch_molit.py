# -*- coding: utf-8 -*-
"""
국토교통부 실거래가(RTMS) — 서울시 25개 자치구 전체를 12개월치 내려받아 .cache에 원본으로 쌓는다.

- 아파트 매매 / 아파트 전월세 / 오피스텔 매매 / 오피스텔 전월세 / 상업업무용 매매
- 월 단위로 캐시하므로 중간에 끊겨도 다시 실행하면 이어받는다.
- 집계(대시보드용 JS 생성)는 build_data.py가 담당한다.

실행:  py tools/fetch_molit.py
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, ".cache")

# 키는 기존 seoul dashboard 프로젝트의 .env를 재사용한다(없으면 환경변수).
SIBLING_ENV = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard", ".env")


def _load_key() -> str:
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if key:
        return key
    for path in (os.path.join(BASE_DIR, ".env"), SIBLING_ENV):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("DATA_GO_KR_KEY=") :
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATA_GO_KR_KEY를 찾을 수 없습니다 (.env 또는 환경변수에 설정하세요).")


SERVICE_KEY = _load_key()

# 서울시 25개 자치구 -> 법정동코드(LAWD_CD)
SEOUL_GU = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215",
    "동대문구": "11230", "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320",
    "노원구": "11350", "은평구": "11380", "서대문구": "11410", "마포구": "11440", "양천구": "11470",
    "강서구": "11500", "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710", "강동구": "11740",
}

KINDS = {
    "aptSale":   "1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    "aptRent":   "1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    "offiSale":  "1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
    "offiRent":  "1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
    "nrgSale":   "1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
}

PAGE_SIZE = 1000
CACHE_VER = "v1"
CURRENT_MONTH_TTL = 60 * 60 * 6      # 최근 달은 신고가 계속 들어오므로 6시간
# 실거래 신고 기한이 계약일로부터 30일이라, 지난달·지지난달 거래도 이번 달까지 계속 접수된다.
# 최근 N개월은 캐시를 믿지 말고 다시 받는다(안 그러면 처음 받은 수치로 영영 굳는다).
RECENT_REFRESH_MONTHS = int(os.environ.get("RECENT_MONTHS", "3"))
# 최근 N개월만 다시 받으면, 그보다 오래된 달은 처음 받은 값으로 영영 굳는다.
# 실제로 로컬 캐시의 과거 9개월이 18일 동안 굳어 지연 신고 1,500건이 빠졌었다.
# CI가 며칠 실패해도 같은 일이 생기므로, 오래된 파일은 무조건 다시 받는다.
MAX_CACHE_DAYS = int(os.environ.get("MAX_CACHE_DAYS", "10"))

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


# ---------------------------------------------------------------- 유틸

def month_range(months: int, end_ym: str) -> list[str]:
    """end_ym에서 거꾸로 months개월치 연월 리스트(오름차순)."""
    y, m = int(end_ym[:4]), int(end_ym[4:])
    out = []
    for _ in range(months):
        out.append(f"{y:04d}{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return sorted(out)


def _num(text):
    if text is None:
        return None
    t = text.strip().replace(",", "")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _txt(item, tag) -> str:
    v = item.findtext(tag)
    return v.strip() if v else ""


# ---------------------------------------------------------------- HTTP

# 공공데이터포털은 짧은 시간에 요청이 몰리면 429를 돌려준다.
# 전역으로 요청 간 최소 간격을 두고, 429를 만나면 길게 물러선다.
_throttle_lock = threading.Lock()
_last_call = [0.0]
MIN_INTERVAL = float(os.environ.get("MIN_INTERVAL", "0.35"))   # 초


def _throttle() -> None:
    with _throttle_lock:
        wait = _last_call[0] + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.monotonic()


def _request(api: str, lawd: str, ym: str, page: int) -> ET.Element:
    qs = urllib.parse.urlencode({
        "serviceKey": SERVICE_KEY, "LAWD_CD": lawd, "DEAL_YMD": ym,
        "pageNo": page, "numOfRows": PAGE_SIZE,
    })
    req = urllib.request.Request(f"https://apis.data.go.kr/{api}?{qs}",
                                 headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
    last = None
    for attempt in range(6):
        _throttle()
        try:
            with urllib.request.urlopen(req, timeout=45, context=_SSL) as resp:
                return ET.fromstring(resp.read())
        except urllib.error.HTTPError as exc:
            last = exc
            # 429(요청 과다)는 잠깐 쉬면 풀리므로 넉넉히 기다렸다 다시 시도한다
            time.sleep((4.0 * (2 ** attempt)) if exc.code == 429 else (0.8 * (attempt + 1)))
        except (urllib.error.URLError, ET.ParseError, TimeoutError, OSError) as exc:
            last = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"{api} {lawd} {ym} p{page}: {last}")


def _fetch_items(api: str, lawd: str, ym: str) -> list[ET.Element]:
    root = _request(api, lawd, ym, 1)
    code = root.findtext(".//resultCode") or ""
    if code not in ("000", "00"):
        msg = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or "unknown"
        raise RuntimeError(f"공공데이터포털 오류 [{code}] {msg}")
    items = root.findall(".//item")
    total = int(root.findtext(".//totalCount") or len(items))
    page = 2
    while len(items) < total and page <= 40:
        more = _request(api, lawd, ym, page).findall(".//item")
        if not more:
            break
        items.extend(more)
        page += 1
    return items


# ---------------------------------------------------------------- 파서

def _parse_sale(item, gu, ym, name_tag):
    """매매(아파트·오피스텔 공통). 계약해제 건은 버린다."""
    amount = _num(item.findtext("dealAmount"))
    area = _num(item.findtext("excluUseAr"))
    day = _num(item.findtext("dealDay"))
    if not amount or not area or not day:
        return None
    if _txt(item, "cdealType") == "O":
        return None
    return {
        "t": "sale", "gu": gu, "dong": _txt(item, "umdNm"), "name": _txt(item, name_tag),
        "jibun": _txt(item, "jibun"),
        "date": f"{ym[:4]}-{ym[4:]}-{int(day):02d}",
        "area": area, "floor": int(_num(item.findtext("floor")) or 0),
        "build": int(_num(item.findtext("buildYear")) or 0),
        "amount": amount, "deposit": 0.0, "rent": 0.0,
    }


def _parse_rent(item, gu, ym, name_tag):
    """전월세(아파트·오피스텔 공통). 월세 0이면 전세."""
    deposit = _num(item.findtext("deposit"))
    rent = _num(item.findtext("monthlyRent")) or 0.0
    area = _num(item.findtext("excluUseAr"))
    day = _num(item.findtext("dealDay"))
    if deposit is None or not area or not day:
        return None
    return {
        "t": "jeonse" if rent == 0 else "wolse", "gu": gu, "dong": _txt(item, "umdNm"),
        "name": _txt(item, name_tag), "jibun": _txt(item, "jibun"),
        "date": f"{ym[:4]}-{ym[4:]}-{int(day):02d}",
        "area": area, "floor": int(_num(item.findtext("floor")) or 0),
        "build": int(_num(item.findtext("buildYear")) or 0),
        "amount": 0.0, "deposit": deposit, "rent": rent,
    }


def _parse_nrg(item, gu, ym):
    """상업업무용(상가·사무실 등) 매매. 전용면적 대신 건축물 연면적(buildingAr)을 쓴다."""
    amount = _num(item.findtext("dealAmount"))
    area = _num(item.findtext("buildingAr"))
    day = _num(item.findtext("dealDay"))
    if not amount or not area or not day:
        return None
    if _txt(item, "cdealType") == "O":
        return None
    floor_raw = _txt(item, "floor")
    return {
        "t": "sale", "gu": gu, "dong": _txt(item, "umdNm"),
        "name": _txt(item, "buildingUse") or "기타",          # 상업용은 건물명이 없어 용도를 이름 대신 쓴다
        "use": _txt(item, "buildingUse"), "btype": _txt(item, "buildingType"),
        "landUse": _txt(item, "landUse"), "jibun": _txt(item, "jibun"),
        "date": f"{ym[:4]}-{ym[4:]}-{int(day):02d}",
        "area": area, "land": _num(item.findtext("plottageAr")) or 0.0,
        "floor": floor_raw, "build": int(_num(item.findtext("buildYear")) or 0),
        "amount": amount,
    }


PARSERS = {
    "aptSale":  lambda it, gu, ym: _parse_sale(it, gu, ym, "aptNm"),
    "aptRent":  lambda it, gu, ym: _parse_rent(it, gu, ym, "aptNm"),
    "offiSale": lambda it, gu, ym: _parse_sale(it, gu, ym, "offiNm"),
    "offiRent": lambda it, gu, ym: _parse_rent(it, gu, ym, "offiNm"),
    "nrgSale":  lambda it, gu, ym: _parse_nrg(it, gu, ym),
}


# ---------------------------------------------------------------- 캐시

def _path(kind: str, lawd: str, ym: str) -> str:
    return os.path.join(CACHE_DIR, f"{kind}-{lawd}-{ym}-{CACHE_VER}.json")


def _is_current(ym: str) -> bool:
    t = date.today()
    return ym >= f"{t.year:04d}{t.month:02d}"


def _is_recent(ym: str) -> bool:
    """오늘이 속한 달부터 거꾸로 RECENT_REFRESH_MONTHS개월 안에 드는가."""
    t = date.today()
    y, m = t.year, t.month
    for _ in range(max(1, RECENT_REFRESH_MONTHS)):
        if ym == f"{y:04d}{m:02d}":
            return True
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return ym > f"{y:04d}{m:02d}"


def load_month(kind: str, gu: str, ym: str) -> list[dict]:
    lawd = SEOUL_GU[gu]
    path = _path(kind, lawd, ym)
    if os.path.exists(path):
        age = time.time() - os.path.getmtime(path)
        # 최근 몇 달은 신고가 계속 들어오므로 캐시를 짧게만 믿는다
        fresh = (not _is_recent(ym)) or (age < CURRENT_MONTH_TTL)
        # 오래된 달이라도 캐시가 묵으면 그동안 들어온 지연 신고를 놓친다
        if age > MAX_CACHE_DAYS * 86400:
            fresh = False
        if fresh:
            try:
                with open(path, encoding="utf-8") as fh:
                    return json.load(fh)
            except (OSError, json.JSONDecodeError):
                pass
    parse = PARSERS[kind]
    rows = [r for r in (parse(it, gu, ym) for it in _fetch_items(KINDS[kind], lawd, ym)) if r]
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return rows


# ---------------------------------------------------------------- 실행

def main() -> None:
    months = int(os.environ.get("MONTHS", "12"))
    # 기본 종료월은 "이번 달". 진행 중인 달이라 건수는 적지만, 대시보드가 오늘까지를
    # 다루려면 반드시 있어야 한다(캐시 TTL이 짧아 다시 받을 때마다 최신화된다).
    end_ym = os.environ.get("END_YM") or f"{date.today().year:04d}{date.today().month:02d}"

    yms = month_range(months, end_ym)
    jobs = [(kind, gu, ym) for kind in KINDS for gu in SEOUL_GU for ym in yms]
    print(f"기간 {yms[0]} ~ {yms[-1]} · {len(SEOUL_GU)}개 구 · {len(KINDS)}종 = {len(jobs)}개 요청", flush=True)

    done = {"n": 0}
    errors: list[str] = []

    def work(job):
        kind, gu, ym = job
        try:
            rows = load_month(kind, gu, ym)
        except Exception as exc:
            errors.append(f"{kind} {gu} {ym}: {exc}")
            rows = []
        done["n"] += 1
        if done["n"] % 50 == 0:
            print(f"  {done['n']}/{len(jobs)} …", flush=True)
        return len(rows)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", "4"))) as pool:
        counts = list(pool.map(work, jobs))

    print(f"완료: {sum(counts):,}건 / {time.time() - t0:.0f}초", flush=True)
    if errors:
        print(f"실패 {len(errors)}건:", flush=True)
        for e in errors[:20]:
            print("  -", e, flush=True)
        sys.exit(1 if len(errors) > len(jobs) * 0.05 else 0)


if __name__ == "__main__":
    main()
