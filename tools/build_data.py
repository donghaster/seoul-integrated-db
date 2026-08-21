# -*- coding: utf-8 -*-
"""
.cache에 쌓인 국토부 실거래 원본을 대시보드용 JS 데이터로 집계한다.

출력
  docs/data/apt.js     -> window.APT_DATA     (아파트 대시보드)
  docs/data/sangga.js  -> window.SANGGA_DATA  (상가·오피스텔 대시보드)

지역 키
  "all"          서울 전체
  "종로구"        자치구 전체
  "종로구|숭인동"  법정동

실행:  py tools/build_data.py
"""
from __future__ import annotations

import json
import os
import statistics
from datetime import date
from collections import defaultdict

from fetch_molit import SEOUL_GU, CACHE_VER, month_range  # 같은 폴더

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, ".cache")
OUT_DIR = os.path.join(BASE_DIR, "docs", "data")

PYEONG = 3.3058          # 1평 = 3.3058㎡
TOP_N = 10
ALL = "all"

# 화면에서 고를 수 있는 조회 기간(개월). 전부 "오늘이 속한 달"에서 거꾸로 센다.
WINDOWS = [3, 6, 12]
MAX_WINDOW = max(WINDOWS)

TODAY = date.today().isoformat()


def ym_of(row: dict) -> str:
    """거래일(2026-08-05) -> '202608'"""
    return row["date"][:4] + row["date"][5:7]


def windows_meta(yms: list[str]) -> dict:
    """각 기간의 시작·종료월과 화면에 쓸 이름."""
    out = {}
    for w in WINDOWS:
        sub = yms[-w:]
        s, e = sub[0], sub[-1]
        out[str(w)] = {
            "months": w,
            "start": s,
            "end": e,
            "labels": [f"{y[2:4]}.{y[4:]}" for y in sub],
            "name": f"최근 {w}개월",
            "label": f"{s[:4]}.{s[4:]} ~ {e[:4]}.{e[4:]} ({w}개월)",
        }
    return out


# ---------------------------------------------------------------- 로드

def load(kind: str, gu: str, ym: str) -> list[dict]:
    path = os.path.join(CACHE_DIR, f"{kind}-{SEOUL_GU[gu]}-{ym}-{CACHE_VER}.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def load_all(kind: str, yms: list[str]) -> list[dict]:
    out = []
    for gu in SEOUL_GU:
        for ym in yms:
            out.extend(load(kind, gu, ym))
    return out


# ---------------------------------------------------------------- 공통 헬퍼

def region_keys(row: dict) -> list[str]:
    """한 거래가 속하는 지역 키들 — 서울 전체 / 구 / 구|동."""
    gu, dong = row["gu"], (row.get("dong") or "").strip()
    keys = [ALL, gu]
    if dong:
        keys.append(f"{gu}|{dong}")
    return keys


def value_of(row: dict) -> float:
    """정렬·비교용 대표 금액(만원). 월세는 환산보증금 = 보증금 + 월세×100."""
    t = row["t"]
    if t == "sale":
        return row["amount"]
    if t == "jeonse":
        return row["deposit"]
    return row["deposit"] + row["rent"] * 100


def slim(row: dict) -> dict:
    """JS로 넘길 거래 1건 — 키를 짧게 줄여 파일 크기를 아낀다."""
    out = {
        "n": row["name"] or "(단지명 미상)",
        "a": round(row["area"], 2),
        "f": row["floor"],
        "d": row["date"],
        "gu": row["gu"],
        "dg": row.get("dong") or "",
        "jb": row.get("jibun") or "",       # 지오코딩(지번 주소 → 좌표)에 쓴다
    }
    t = row["t"]
    if t == "sale":
        out["v"] = int(row["amount"])
    elif t == "jeonse":
        out["v"] = int(row["deposit"])
    else:
        out["v"] = int(row["deposit"])
        out["r"] = int(row["rent"])
    if row.get("build"):
        out["y"] = row["build"]
    return out


def top_rows(rows: list[dict], n: int = TOP_N) -> list[dict]:
    """금액 상위 n건. 같은 단지·같은 면적의 중복 신고가 표를 다 잡아먹지 않도록 살짝 눌러준다."""
    ranked = sorted(rows, key=value_of, reverse=True)
    picked, seen = [], defaultdict(int)
    for r in ranked:
        key = (r["name"], round(r["area"]))
        if seen[key] >= 3:          # 같은 단지·평형은 최대 3건까지만
            continue
        seen[key] += 1
        picked.append(slim(r))
        if len(picked) >= n:
            break
    if len(picked) < n:             # 표본이 적으면 중복 제한을 풀고 채운다
        have = {(p["n"], p["a"], p["d"], p["v"]) for p in picked}
        for r in ranked:
            s = slim(r)
            if (s["n"], s["a"], s["d"], s["v"]) in have:
                continue
            picked.append(s)
            have.add((s["n"], s["a"], s["d"], s["v"]))
            if len(picked) >= n:
                break
    return picked


def pyeong_price(row: dict) -> float | None:
    """평당가(만원). 면적이 없으면 None."""
    if not row.get("area"):
        return None
    return value_of(row) / (row["area"] / PYEONG)


def med(vals: list[float]) -> int:
    return int(round(statistics.median(vals))) if vals else 0


# ---------------------------------------------------------------- 아파트

def py_top_rows(rows: list[dict], n: int = TOP_N) -> list[dict]:
    """평당가 상위 n건. 금액 상위(top_rows)와 달리 단위면적 가격으로 줄을 세운다."""
    scored = [(pyeong_price(r), r) for r in rows]
    scored = [(p, r) for p, r in scored if p]
    scored.sort(key=lambda x: x[0], reverse=True)
    picked, seen = [], defaultdict(int)
    for p, r in scored:
        k = (r["name"], round(r["area"]))
        if seen[k] >= 3:
            continue
        seen[k] += 1
        row = slim(r)
        row["py"] = int(round(p))
        picked.append(row)
        if len(picked) >= n:
            break
    return picked


def rise_rows(rows: list[dict], yms: list[str], n: int = TOP_N) -> list[dict]:
    """기간을 반으로 갈라 단지별 '전반부 -> 후반부 중위 평당가' 변동률 상위 n곳.
    두 구간 모두 거래가 있는 단지만 계산되므로 기간이 짧으면 후보가 적다."""
    if len(yms) < 2:
        return []
    half = set(yms[: len(yms) // 2])
    early, late = defaultdict(list), defaultdict(list)
    for r in rows:
        p = pyeong_price(r)
        if not p:
            continue
        (early if ym_of(r) in half else late)[r["name"]].append(p)

    out = []
    for name in early.keys() & late.keys():
        a, b = med(early[name]), med(late[name])
        if not a or not b:
            continue
        out.append({
            "n": name, "before": a, "after": b,
            "rate": round((b - a) / a * 100, 1),
            "cnt": len(early[name]) + len(late[name]),
        })
    out.sort(key=lambda x: x["rate"], reverse=True)
    return out[:n]


def month_median_py(rows: list[dict], yms: list[str], value) -> list:
    """월별 중위 평당가 시계열. 거래가 없는 달은 None(그래프에서 점을 찍지 않는다)."""
    bucket = defaultdict(list)
    for r in rows:
        area = r.get("area")
        if not area:
            continue
        bucket[ym_of(r)].append(value(r) / (area / PYEONG))
    return [med(bucket[y]) if bucket.get(y) else None for y in yms]


def build_apt(yms: list[str]) -> dict:
    sale = load_all("aptSale", yms)
    rent = load_all("aptRent", yms)
    deals = sale + rent
    deals = [d for d in deals if d["date"] <= TODAY]     # 미래 날짜 오신고 제외

    by_region: dict[str, dict[str, list]] = defaultdict(lambda: {"sale": [], "jeonse": [], "wolse": []})
    for d in deals:
        for key in region_keys(d):
            by_region[key][d["t"]].append(d)

    ym_index = {y: i for i, y in enumerate(yms)}
    regions: dict[str, dict] = {}

    for key, buckets in by_region.items():
        # 월별 거래량은 전체 기간(12개월)으로 한 번만 만들고, 화면에서 기간에 맞게 잘라 쓴다
        vol = {t: [0] * len(yms) for t in ("sale", "jeonse", "wolse")}
        for t, rows in buckets.items():
            for r in rows:
                i = ym_index.get(ym_of(r))
                if i is not None:
                    vol[t][i] += 1

        # 최근 3 / 6 / 12개월 각각의 TOP10·건수·중위값
        per_window = {}
        for w in WINDOWS:
            wset = set(yms[-w:])
            sub = {t: [r for r in buckets[t] if ym_of(r) in wset] for t in ("sale", "jeonse", "wolse")}
            per_window[str(w)] = {
                "top": {t: top_rows(sub[t]) for t in ("sale", "jeonse", "wolse")},
                "topPy": {t: py_top_rows(sub[t]) for t in ("sale", "jeonse", "wolse")},
                "rise": {t: rise_rows(sub[t], yms[-w:]) for t in ("sale", "jeonse", "wolse")},
                "cnt": {t: len(sub[t]) for t in ("sale", "jeonse", "wolse")},
                "med": {
                    "sale": med([r["amount"] for r in sub["sale"]]),
                    "jeonse": med([r["deposit"] for r in sub["jeonse"]]),
                    "wolse": med([r["rent"] for r in sub["wolse"]]),
                    "pyeong": med([p for p in (pyeong_price(r) for r in sub["sale"]) if p]),
                },
            }

        # 가격지수용 월별 중위 평당가 — 전체 기간으로 한 번만 만들고 화면에서 잘라 쓴다.
        # 월세는 환산보증금(보증금 + 월세×100) 기준.
        idx = {
            "sale":   month_median_py(buckets["sale"], yms, lambda r: r["amount"]),
            "jeonse": month_median_py(buckets["jeonse"], yms, lambda r: r["deposit"]),
            "wolse":  month_median_py(buckets["wolse"], yms, lambda r: r["deposit"] + r["rent"] * 100),
        }

        regions[key] = {"w": per_window, "vol": vol, "idx": idx}

    def total_cnt(key: str, w: int) -> int:
        return sum(regions[key]["w"][str(w)]["cnt"].values())

    # 자치구별 법정동 목록 — 거래가 있는 동만, 12개월 거래량 많은 순
    dongs: dict[str, list[str]] = {}
    for gu in SEOUL_GU:
        found = [(total_cnt(k, MAX_WINDOW), k.split("|", 1)[1])
                 for k in by_region if k.startswith(gu + "|")]
        dongs[gu] = [d for _, d in sorted(found, reverse=True)]

    # 거래량 순위 — 기간별로 따로 만든다(최근 3개월 순위와 12개월 순위가 다르므로)
    rank_gu, rank_dong, rank_dong_by_gu = {}, {}, {}
    for w in WINDOWS:
        sw = str(w)
        rank_gu[sw] = sorted(
            ({"k": gu, "label": gu, "c": total_cnt(gu, w) if gu in regions else 0} for gu in SEOUL_GU),
            key=lambda x: x["c"], reverse=True,
        )
        rank_dong[sw] = sorted(
            ({"k": k, "label": k.split("|")[1], "gu": k.split("|")[0], "c": total_cnt(k, w)}
             for k in regions if "|" in k),
            key=lambda x: x["c"], reverse=True,
        )[:30]
        rank_dong_by_gu[sw] = {
            gu: sorted(
                ({"k": f"{gu}|{d}", "label": d, "c": total_cnt(f"{gu}|{d}", w)} for d in dongs[gu]),
                key=lambda x: x["c"], reverse=True,
            )[:15]
            for gu in SEOUL_GU
        }

    return {
        "windows": windows_meta(yms),
        "defaultWindow": str(MAX_WINDOW),
        "months": yms,
        "labels": [f"{y[2:4]}.{y[4:]}" for y in yms],
        "gus": list(SEOUL_GU),
        "dongs": dongs,
        "regions": regions,
        "rankGu": rank_gu,
        "rankDong": rank_dong,
        "rankDongByGu": rank_dong_by_gu,
        "total": len(deals),
    }


# ---------------------------------------------------------------- 상가·오피스텔

# 상업업무용 buildingUse -> 화면에 쓸 분류
def nrg_group(use: str) -> str:
    u = use or ""
    if "근린생활" in u or "판매" in u or "위락" in u or "숙박" in u:
        return "shop"       # 일반상가(근린생활·판매 등)
    if "업무" in u or "오피스" in u:
        return "office"     # 업무용(사무실 등)
    return "etc"            # 그 밖(공장·창고·교육연구 등)


NRG_GROUP_LABEL = {"shop": "일반상가", "office": "업무용", "etc": "기타 상업·업무용"}


def build_sangga(yms: list[str]) -> dict:
    nrg = [r for r in load_all("nrgSale", yms) if r["date"] <= TODAY]
    offi_sale = [r for r in load_all("offiSale", yms) if r["date"] <= TODAY]
    offi_rent = [r for r in load_all("offiRent", yms) if r["date"] <= TODAY]

    ym_index = {y: i for i, y in enumerate(yms)}
    n = len(yms)

    regions: dict[str, dict] = {}

    def ensure(key: str) -> dict:
        if key not in regions:
            regions[key] = {
                "nrg": {"shop": [], "office": [], "etc": []},
                "offi": {"sale": [], "jeonse": [], "wolse": []},
                "nrgVol": {"shop": [0] * n, "office": [0] * n, "etc": [0] * n},
                "offiVol": {"sale": [0] * n, "jeonse": [0] * n, "wolse": [0] * n},
                "dongCnt": defaultdict(int),
            }
        return regions[key]

    for r in nrg:
        g = nrg_group(r.get("use"))
        i = ym_index.get(r["date"][:4] + r["date"][5:7])
        for key in region_keys(r):
            reg = ensure(key)
            reg["nrg"][g].append(r)
            if i is not None:
                reg["nrgVol"][g][i] += 1
            if "|" not in key:
                reg["dongCnt"][r.get("dong") or "기타"] += 1

    for r in offi_sale + offi_rent:
        t = r["t"]
        i = ym_index.get(r["date"][:4] + r["date"][5:7])
        for key in region_keys(r):
            reg = ensure(key)
            reg["offi"][t].append(r)
            if i is not None:
                reg["offiVol"][t][i] += 1

    out_regions = {}
    for key, reg in regions.items():
        nrg_rows = {g: reg["nrg"][g] for g in ("shop", "office", "etc")}
        offi_rows = reg["offi"]

        def nrg_slim(rows):
            """상업용은 단지명이 없어 용도·지번으로 표시한다."""
            ranked = sorted(rows, key=lambda r: r["amount"], reverse=True)[:TOP_N]
            return [{
                "n": r.get("use") or "상업·업무용",
                "bt": r.get("btype") or "",
                "lu": r.get("landUse") or "",
                "a": round(r["area"], 2),
                "la": round(r.get("land") or 0, 2),
                "f": r.get("floor") or "",
                "d": r["date"],
                "v": int(r["amount"]),
                "gu": r["gu"], "dg": r.get("dong") or "",
                "y": r.get("build") or 0,
            } for r in ranked]

        # 최근 3 / 6 / 12개월 각각의 TOP10·건수·중위값
        per_window = {}
        for w in WINDOWS:
            wset = set(yms[-w:])
            sub_nrg = {g: [r for r in nrg_rows[g] if ym_of(r) in wset] for g in ("shop", "office", "etc")}
            sub_offi = {t: [r for r in offi_rows[t] if ym_of(r) in wset] for t in ("sale", "jeonse", "wolse")}
            flat = [r for g in ("shop", "office", "etc") for r in sub_nrg[g]]
            per_window[str(w)] = {
                "nrgTop": {g: nrg_slim(sub_nrg[g]) for g in ("shop", "office", "etc")},
                "offiTop": {t: top_rows(sub_offi[t]) for t in ("sale", "jeonse", "wolse")},
                "nrgCnt": {g: len(sub_nrg[g]) for g in ("shop", "office", "etc")},
                "offiCnt": {t: len(sub_offi[t]) for t in ("sale", "jeonse", "wolse")},
                "med": {
                    "nrg": med([r["amount"] for r in flat]),
                    "nrgPy": med([r["amount"] / (r["area"] / PYEONG) for r in flat if r.get("area")]),
                    "offiSale": med([r["amount"] for r in sub_offi["sale"]]),
                    "offiJeonse": med([r["deposit"] for r in sub_offi["jeonse"]]),
                    "offiWolse": med([r["rent"] for r in sub_offi["wolse"]]),
                },
            }

        out_regions[key] = {
            "w": per_window,
            "nrgVol": reg["nrgVol"],
            "offiVol": reg["offiVol"],
            "dongCnt": sorted(
                ({"label": d, "c": c} for d, c in reg["dongCnt"].items()),
                key=lambda x: x["c"], reverse=True,
            )[:12] if "|" not in key else [],
        }

    rank_gu = {}
    for w in WINDOWS:
        sw = str(w)
        rank_gu[sw] = sorted(
            ({"k": gu, "label": gu,
              "nrg": sum(out_regions[gu]["w"][sw]["nrgCnt"].values()) if gu in out_regions else 0,
              "offi": sum(out_regions[gu]["w"][sw]["offiCnt"].values()) if gu in out_regions else 0}
             for gu in SEOUL_GU),
            key=lambda x: x["nrg"] + x["offi"], reverse=True,
        )

    return {
        "windows": windows_meta(yms),
        "defaultWindow": str(MAX_WINDOW),
        "months": yms,
        "labels": [f"{y[2:4]}.{y[4:]}" for y in yms],
        "gus": list(SEOUL_GU),
        "regions": out_regions,
        "rankGu": rank_gu,
        "groupLabel": NRG_GROUP_LABEL,
        "total": len(nrg) + len(offi_sale) + len(offi_rent),
    }


# ---------------------------------------------------------------- 출력

def bump_cache_version(stamp: str) -> None:
    """HTML의 data/*.js?v=... 를 빌드 스탬프로 바꾼다.

    이걸 안 하면 데이터를 갱신해도 방문자 브라우저가 예전 사본을 계속 쓴다
    (file://로 열 때는 Cache-Control 헤더가 없어 특히 문제가 된다).
    """
    import re
    docs = os.path.join(BASE_DIR, "docs")
    pattern = re.compile(r'(src="\.\./data/[a-z]+\.js\?v=)[^"]*(")')
    for page in ("apt", "newtown", "sangga"):
        path = os.path.join(docs, page, "index.html")
        if not os.path.exists(path):
            continue
        html = open(path, encoding="utf-8").read()
        new = pattern.sub(rf"\g<1>{stamp}\g<2>", html)
        if new != html:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            print(f"  {page}/index.html  캐시 버전 -> {stamp}")


def write_js(name: str, varname: str, payload: dict) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"window.{varname} = {body};\n")
    print(f"  {name}  {os.path.getsize(path) / 1024 / 1024:.2f} MB")


def main() -> None:
    import time

    # 기본 종료월은 "이번 달" — 대시보드가 오늘까지를 다루도록.
    t = date.today()
    end_ym = os.environ.get("END_YM") or f"{t.year:04d}{t.month:02d}"
    yms = month_range(int(os.environ.get("MONTHS", str(MAX_WINDOW))), end_ym)
    built = time.strftime("%Y-%m-%d %H:%M")

    print(f"집계 기간 {yms[0]} ~ {yms[-1]} (오늘 {TODAY} 기준)")
    apt = build_apt(yms)
    apt["builtAt"] = built
    apt["today"] = TODAY
    print(f"  아파트 실거래 {apt['total']:,}건 · 지역 {len(apt['regions']):,}개")

    sangga = build_sangga(yms)
    sangga["builtAt"] = built
    sangga["today"] = TODAY
    print(f"  상가·오피스텔 실거래 {sangga['total']:,}건 · 지역 {len(sangga['regions']):,}개")

    write_js("apt.js", "APT_DATA", apt)
    write_js("sangga.js", "SANGGA_DATA", sangga)
    bump_cache_version(time.strftime("%Y%m%d%H%M"))


if __name__ == "__main__":
    main()
