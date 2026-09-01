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



def encode_deals(deals: list[dict], yms: list[str]) -> dict:
    """실거래 원본을 사전+배열로 접어 화면으로 내려보낸다.
    이걸 내려야 화면에서 아무 기간이나, 주/월 아무 단위로나 다시 계산할 수 있다.
    (집계본만 내리면 미리 정한 3·6·12개월 말고는 볼 수가 없다)"""
    types = ["sale", "jeonse", "wolse"]
    t_idx = {t: i for i, t in enumerate(types)}
    regions, names = [], []
    r_idx, n_idx = {}, {}

    def put(table, index, value):
        v = value or ""
        if v not in index:
            index[v] = len(table)
            table.append(v)
        return index[v]

    base = date.fromisoformat(f"{yms[0][:4]}-{yms[0][4:]}-01")
    rows = []
    for d in deals:
        dong = (d.get("dong") or "").strip()
        # 매매는 금액, 전세는 보증금 — 어차피 하나만 쓰므로 한 칸에 담고,
        # 월세일 때만 월세액을 뒤에 덧붙인다(빈 0을 줄여 파일을 가볍게).
        # 지번은 좌표를 굽는 데만 쓰고 화면에서는 안 쓰므로 빼둔다.
        v = int(d["amount"]) if d["t"] == "sale" else int(d["deposit"])
        row = [
            t_idx[d["t"]],
            put(regions, r_idx, d["gu"] + "|" + dong),
            put(names, n_idx, d.get("name") or ""),
            (date.fromisoformat(d["date"]) - base).days,
            round(d["area"], 3),   # 전용면적은 신고된 소수 자리를 그대로 — 접으면 평당가가 몇만원 어긋난다
            d["floor"],
            d.get("build") or 0,
            v,
        ]
        if d["t"] == "wolse":
            row.append(int(d["rent"]))
        rows.append(row)
    return {"types": types, "regions": regions, "names": names,
            "base": base.isoformat(), "rows": rows}


def build_apt(yms: list[str]) -> dict:
    sale = load_all("aptSale", yms)
    rent = load_all("aptRent", yms)
    # 분양권·입주권 전매 — 소유권보존등기 전이라 일반 매매 API엔 안 잡히는 거래.
    # 준공 직후 단지가 "실거래가 없다"고 나오는 사례의 원인이라 합쳐 둔다.
    presale = load_all("aptPresale", yms)
    deals = sale + rent + presale
    deals = [d for d in deals if d["date"] <= TODAY]     # 미래 날짜 오신고 제외

    by_region: dict[str, dict[str, list]] = defaultdict(lambda: {"sale": [], "jeonse": [], "wolse": []})
    for d in deals:
        for key in region_keys(d):
            by_region[key][d["t"]].append(d)

    ym_index = {y: i for i, y in enumerate(yms)}
    regions: dict[str, dict] = {}

    # 지역별 집계는 더 이상 굽지 않는다.
    # 원본(deals)을 화면으로 내려 아무 기간·아무 단위(주/월)로나 그때그때 계산한다.
    # 여기서는 법정동 목록을 만들기 위한 건수만 세어 둔다.
    for key, buckets in by_region.items():
        regions[key] = {"n": sum(len(v) for v in buckets.values())}

    # 자치구별 법정동 목록 — 12개월 거래량 많은 순
    dongs: dict[str, list[str]] = {}
    for gu in SEOUL_GU:
        found = [(regions[k]["n"], k.split("|", 1)[1]) for k in by_region if k.startswith(gu + "|")]
        dongs[gu] = [d for _, d in sorted(found, reverse=True)]

    return {
        "windows": windows_meta(yms),
        "defaultWindow": str(MAX_WINDOW),
        "months": yms,
        "labels": [f"{y[2:4]}.{y[4:]}" for y in yms],
        "gus": list(SEOUL_GU),
        "dongs": dongs,
        "deals": encode_deals(deals, yms),
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


def monthly_stats(nrg_rows: dict, offi_rows: dict, yms: list[str]) -> dict:
    """달 단위 건수·중위값. 고정 3/6/12개월 집계만으로는 "6월 대비 7월"을
    말할 수 없어, 상담용 브리핑에 쓸 값만 따로 구워 둔다.

    월세는 환산보증금만 보면 준전세로 옮겨간 것을 "월세 상승"으로 읽게 되므로
    중위 보증금·중위 월세·준전세 건수를 나눠 담는다.
    준전세 구분은 한국부동산원 기준(보증금 > 월세 × 240)을 따른다.
    """
    def bucket(rows):
        by: dict[str, list] = {y: [] for y in yms}
        for r in rows:
            k = r["date"][:4] + r["date"][5:7]
            if k in by:
                by[k].append(r)
        return by

    def py_of(r):
        return r["amount"] / (r["area"] / PYEONG) if r.get("area") else None

    out: dict[str, list] = {}
    hot: dict[str, dict] = {}       # 한 건물이 그 달을 좌우한 경우만 따로

    def mark_hot(kind: str, by: dict, label):
        """한 건물의 분양 물량이 통째로 신고되면 중위값이 그 건물 값이 돼 버린다.
        (예: 서초구 2026-06 오피스텔 매매 173건 중 'LENID' 한 곳이 124건)
        비중이 큰 달만 짚어 두고 화면에서 경고한다."""
        for ym, rows in by.items():
            if len(rows) < 10:
                continue
            cnt: dict[str, int] = {}
            for r in rows:
                k = label(r)
                if k:
                    cnt[k] = cnt.get(k, 0) + 1
            if not cnt:
                continue
            name, c = max(cnt.items(), key=lambda kv: kv[1])
            if c / len(rows) >= 0.3:
                hot.setdefault(kind, {})[ym] = [name, c]

    for g in ("shop", "office", "etc"):
        by = bucket(nrg_rows[g])
        # 상업용은 단지명이 없다 — 같은 건물(동·지번)에서 여러 호실이 한꺼번에 나온 경우를 본다
        mark_hot(g, by, lambda r: ((r.get("dong") or "") + " " + (r.get("jibun") or "")).strip())
        out[g] = [[
            len(by[y]),
            med([r["amount"] for r in by[y]]),
            med([v for v in (py_of(r) for r in by[y]) if v]),
        ] for y in yms]

    by = bucket(offi_rows["sale"])
    mark_hot("sale", by, lambda r: r.get("name"))
    out["sale"] = [[
        len(by[y]),
        med([r["amount"] for r in by[y]]),
        med([v for v in (py_of(r) for r in by[y]) if v]),
    ] for y in yms]

    by = bucket(offi_rows["jeonse"])
    mark_hot("jeonse", by, lambda r: r.get("name"))
    out["jeonse"] = [[
        len(by[y]),
        med([r["deposit"] for r in by[y]]),
        med([r["deposit"] / (r["area"] / PYEONG) for r in by[y] if r.get("area")]),
    ] for y in yms]

    by = bucket(offi_rows["wolse"])
    mark_hot("wolse", by, lambda r: r.get("name"))
    out["wolse"] = [[
        len(by[y]),
        med([r["deposit"] for r in by[y]]),
        med([r["rent"] for r in by[y]]),
        sum(1 for r in by[y] if not r.get("rent") or r["deposit"] > r["rent"] * 240),
    ] for y in yms]

    if hot:
        out["hot"] = hot
    return out


def offi_jeonse_ratio(sale: list, rent: list) -> dict:
    """오피스텔 전세가율 — 전세 신고가 없는 지역에서 "얼마쯤 하느냐"를 답하는 기준.

    같은 건물·같은 평형에서 매매·전세가 각 3건 이상인 곳만 짝지어 비율을 낸다.
    지역 전체 중위끼리 나누면 평형 구성이 달라 엉뚱한 값이 나온다.

    오피스텔은 아파트와 값이 전혀 다르다(아파트 42~60% / 오피스텔 81~96%).
    90% 안팎은 깡통전세 위험 구간이라 화면에서 따로 짚어 준다.
    """
    from statistics import median as _med

    def era(y):
        if not y:
            return "?"
        return "신축" if y >= 2020 else ("준신축" if y >= 2010 else "구축")

    bag: dict = {}
    for r in sale:
        k = (r["gu"], r.get("dong") or "", r.get("name") or "", round(r["area"]))
        b = bag.setdefault(k, {"s": [], "j": [], "y": 0})
        b["s"].append(r["amount"])
        b["y"] = max(b["y"], r.get("build") or 0)
    for r in rent:
        if r["t"] != "jeonse":
            continue
        k = (r["gu"], r.get("dong") or "", r.get("name") or "", round(r["area"]))
        b = bag.setdefault(k, {"s": [], "j": [], "y": 0})
        b["j"].append(r["deposit"])
        b["y"] = max(b["y"], r.get("build") or 0)

    buckets: dict[str, list] = {}
    for (gu, _dong, _nm, _a), b in bag.items():
        if len(b["s"]) < 3 or len(b["j"]) < 3:
            continue
        ms, mj = _med(b["s"]), _med(b["j"])
        if not ms or not mj:
            continue
        v = mj / ms * 100
        e = era(b["y"])
        for k in (f"{gu}|{e}", gu, f"서울|{e}", "서울"):
            buckets.setdefault(k, []).append(v)

    out = {}
    for k, v in buckets.items():
        if len(v) < 8:                      # 이 표본은 넘어야 범위를 말한다
            continue
        v.sort()
        q = lambda p: round(v[min(len(v) - 1, int(len(v) * p))])
        out[k] = [q(0.25), q(0.5), q(0.75), len(v)]
    return out


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
            "mo": monthly_stats(nrg_rows, offi_rows, yms),
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
        "jeonseRatio": offi_jeonse_ratio(offi_sale, offi_rent),
        "total": len(nrg) + len(offi_sale) + len(offi_rent),
        "deals": pack_nrg_deals(nrg),
    }


def pack_nrg_deals(rows: list[dict]) -> dict:
    """상업업무용 매매 원본을 화면이 표로 그릴 수 있게 눌러 담는다.

    12개월치가 1만 2천 건뿐이라 통째로 실어도 부담이 없다. 같은 문자열이
    수없이 반복되므로(자치구·법정동·용도) 사전을 따로 두고 번호만 담는다.
    """
    dongs: list[str] = []
    uses: list[str] = []
    di: dict[str, int] = {}
    ui: dict[str, int] = {}

    def idx(v: str, arr: list, m: dict) -> int:
        if v not in m:
            m[v] = len(arr)
            arr.append(v)
        return m[v]

    out = []
    for r in sorted(rows, key=lambda x: x["date"], reverse=True):
        gu = r.get("gu") or ""
        dong = r.get("dong") or ""
        area = float(r.get("area") or 0)
        amt = float(r.get("amount") or 0)          # 만원
        py = round(amt / (area / 3.3058)) if area else 0   # 연면적 기준 평당가
        out.append([
            idx(gu + "|" + dong, dongs, di),
            r.get("date") or "",
            idx(r.get("use") or r.get("name") or "-", uses, ui),
            idx(r.get("btype") or "-", uses, ui),
            round(area, 1),
            (r.get("floor") or "").strip(),
            round(amt),
            py,
            (r.get("jibun") or "").strip(),
            int(r.get("build") or 0),
        ])
    return {"dongs": dongs, "uses": uses, "rows": out,
            "cols": ["dong", "date", "use", "btype", "area", "floor", "amount", "py", "jibun", "build"]}


# ---------------------------------------------------------------- 출력

def bump_cache_version(stamp: str) -> None:
    """HTML이 부르는 js/css의 ?v= 를 그 파일 내용의 해시로 바꾼다.

    빌드 시각을 쓰면 데이터가 안 바뀐 날에도 방문자가 11MB를 다시 받고,
    반대로 app.js만 고친 날에는 버전이 그대로라 예전 사본을 계속 쓴다.
    내용 해시를 쓰면 "바뀐 파일만" 다시 받는다.
    """
    import re, hashlib

    docs = os.path.join(BASE_DIR, "docs")
    pattern = re.compile(r'((?:src|href)="([^"?]+\.(?:js|css))\?v=)[^"]*(")')
    digests: dict[str, str] = {}

    def digest(path: str) -> str:
        if path not in digests:
            with open(path, "rb") as fh:
                digests[path] = hashlib.md5(fh.read()).hexdigest()[:10]
        return digests[path]

    pages = [os.path.join(docs, "index.html")]
    pages += [os.path.join(docs, p, "index.html") for p in ("apt", "newtown", "sangga", "trade")]

    for path in pages:
        if not os.path.exists(path):
            continue
        base = os.path.dirname(path)
        changed = []

        def sub(m: "re.Match[str]") -> str:
            target = os.path.normpath(os.path.join(base, m.group(2)))
            if not os.path.exists(target):
                return m.group(0)
            changed.append(m.group(2))
            return m.group(1) + digest(target) + m.group(3)

        html = open(path, encoding="utf-8").read()
        new_html = pattern.sub(sub, html)
        if new_html != html:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new_html)
            rel = os.path.relpath(path, docs).replace("\\", "/")
            print(f"  {rel}  캐시 버전 갱신 {len(changed)}개")


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
    print(f"  아파트 실거래 {apt['total']:,}건 · 원본 {len(apt['deals']['rows']):,}행 · 법정동 {sum(len(v) for v in apt['dongs'].values()):,}개")

    sangga = build_sangga(yms)
    sangga["builtAt"] = built
    sangga["today"] = TODAY
    print(f"  상가·오피스텔 실거래 {sangga['total']:,}건 · 지역 {len(sangga['regions']):,}개")

    write_js("apt.js", "APT_DATA", apt)
    write_js("sangga.js", "SANGGA_DATA", sangga)
    bump_cache_version(time.strftime("%Y%m%d%H%M"))


if __name__ == "__main__":
    main()
