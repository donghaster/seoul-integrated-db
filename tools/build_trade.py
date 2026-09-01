# -*- coding: utf-8 -*-
"""상권 원본을 상권분석 대시보드용 docs/data/trade.js로 굽는다.

상권 1,650개에 대해 유동인구·점포·매출을 한 덩어리로 묶는다.
업종은 상권마다 수십 개씩 붙는데 전부 담으면 파일이 너무 커지므로,
점포수/매출액 상위만 남긴다.

좌표는 원본이 EPSG:5181(Korea 2000 중부원점) TM이라 지도에 쓰려면
WGS84로 돌려야 한다. pyproj 없이 역투영을 직접 계산한다.

실행:  py tools/build_trade.py
"""
from __future__ import annotations

import json
import math
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, ".cache")
OUT_DIR = os.path.join(BASE_DIR, "docs", "data")
CACHE_VER = "v1"

TOP_INDUSTRY = 12          # 상권당 남길 업종 수


# ---------------------------------------------------------------- 좌표

def tm_to_wgs84(x: float, y: float,
                lon0: float = 127.0, lat0: float = 38.0,
                k0: float = 1.0, fe: float = 200000.0, fn: float = 500000.0):
    """EPSG:5181 역투영. 염곡동 구룡사(204060, 441129) -> 37.4696, 127.0459로 검증."""
    a = 6378137.0
    f = 1 / 298.257222101
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    x -= fe
    y -= fn
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))

    def meridian(lat: float) -> float:
        return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat
                    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * lat)
                    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * lat)
                    - (35 * e2 ** 3 / 3072) * math.sin(6 * lat))

    m = meridian(math.radians(lat0)) + y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    c1 = ep2 * math.cos(phi1) ** 2
    t1 = math.tan(phi1) ** 2
    n1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    r1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d ** 2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = math.radians(lon0) + (
        d - (1 + 2 * t1 + c1) * d ** 3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(phi1)
    return round(math.degrees(lat), 5), round(math.degrees(lon), 5)


# ---------------------------------------------------------------- 읽기

def load(name: str) -> list:
    path = os.path.join(CACHE_DIR, f"trade-{name}-{CACHE_VER}.json")
    if not os.path.exists(path):
        raise SystemExit(f"{path} 가 없습니다. py tools/fetch_trade.py 를 먼저 실행하세요.")
    return json.load(open(path, encoding="utf-8"))


def num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def i(v) -> int:
    return int(round(num(v)))


# ---------------------------------------------------------------- 굽기

def build() -> dict:
    area = load("area")
    flpop = load("flpop")
    store = load("store")
    selng = load("selng")

    # ── 상권 기본 ──
    trades: dict[str, dict] = {}
    for r in area:
        code = r.get("TRDAR_CD")
        if not code:
            continue
        lat, lng = tm_to_wgs84(num(r.get("XCNTS_VALUE")), num(r.get("YDNTS_VALUE")))
        trades[code] = {
            "c": code,
            "n": (r.get("TRDAR_CD_NM") or "").strip(),
            "t": (r.get("TRDAR_SE_CD_NM") or "").strip(),      # 골목상권/발달상권/전통시장/관광특구
            "gu": (r.get("SIGNGU_CD_NM") or "").strip(),
            "dong": (r.get("ADSTRD_CD_NM") or "").strip(),
            "ar": i(r.get("RELM_AR")),
            "lat": lat, "lng": lng,
        }

    # ── 유동인구 ──
    fq = ""
    for r in flpop:
        t = trades.get(r.get("TRDAR_CD"))
        if not t:
            continue
        fq = r.get("STDR_YYQU_CD") or fq
        t["fp"] = {
            "tot": i(r.get("TOT_FLPOP_CO")),
            "ml": i(r.get("ML_FLPOP_CO")), "fml": i(r.get("FML_FLPOP_CO")),
            "age": [i(r.get(f"AGRDE_{k}_FLPOP_CO")) for k in ("10", "20", "30", "40", "50")]
                   + [i(r.get("AGRDE_60_ABOVE_FLPOP_CO"))],
            "tm": [i(r.get(f"TMZON_{k}_FLPOP_CO")) for k in
                   ("00_06", "06_11", "11_14", "14_17", "17_21", "21_24")],
            "dow": [i(r.get(f"{k}_FLPOP_CO")) for k in
                    ("MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN")],
        }

    # ── 점포 ── 업종별로 오므로 상권 단위로 합치고 상위 업종만 남긴다
    sq = ""
    by_store: dict[str, list] = {}
    for r in store:
        code = r.get("TRDAR_CD")
        if code not in trades:
            continue
        sq = r.get("STDR_YYQU_CD") or sq
        by_store.setdefault(code, []).append(r)

    for code, rows in by_store.items():
        tot = sum(i(r.get("STOR_CO")) for r in rows)
        frc = sum(i(r.get("FRC_STOR_CO")) for r in rows)
        opn = sum(i(r.get("OPBIZ_STOR_CO")) for r in rows)
        cls = sum(i(r.get("CLSBIZ_STOR_CO")) for r in rows)
        rows.sort(key=lambda r: i(r.get("STOR_CO")), reverse=True)
        trades[code]["st"] = {
            "tot": tot, "frc": frc, "opn": opn, "cls": cls,
            # 개업률·폐업률은 상권 전체 점포 대비로 다시 계산한다.
            # 원본의 업종별 비율을 그냥 더하거나 평균 내면 뜻이 없어진다.
            "opr": round(opn / tot * 100, 1) if tot else 0,
            "clr": round(cls / tot * 100, 1) if tot else 0,
            "top": [{
                "n": (r.get("SVC_INDUTY_CD_NM") or "").strip(),
                "c": i(r.get("STOR_CO")),
                "f": i(r.get("FRC_STOR_CO")),
                "o": i(r.get("OPBIZ_STOR_CO")),
                "x": i(r.get("CLSBIZ_STOR_CO")),
            } for r in rows[:TOP_INDUSTRY] if i(r.get("STOR_CO"))],
        }

    # ── 매출 ── 금액은 원 단위라 만원으로 줄여 담는다
    eq = ""
    by_sel: dict[str, list] = {}
    for r in selng:
        code = r.get("TRDAR_CD")
        if code not in trades:
            continue
        eq = r.get("STDR_YYQU_CD") or eq
        by_sel.setdefault(code, []).append(r)

    man = lambda v: int(round(num(v) / 10000))          # 원 -> 만원

    for code, rows in by_sel.items():
        tot = sum(num(r.get("THSMON_SELNG_AMT")) for r in rows)
        cnt = sum(num(r.get("THSMON_SELNG_CO")) for r in rows)
        rows.sort(key=lambda r: num(r.get("THSMON_SELNG_AMT")), reverse=True)
        dow_keys = ("MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN")
        tm_keys = ("00_06", "06_11", "11_14", "14_17", "17_21", "21_24")
        trades[code]["sl"] = {
            "amt": man(tot), "cnt": int(round(cnt)),
            "mdwk": man(sum(num(r.get("MDWK_SELNG_AMT")) for r in rows)),
            "wkend": man(sum(num(r.get("WKEND_SELNG_AMT")) for r in rows)),
            "dow": [man(sum(num(r.get(f"{k}_SELNG_AMT")) for r in rows)) for k in dow_keys],
            "tm": [man(sum(num(r.get(f"TMZON_{k}_SELNG_AMT")) for r in rows)) for k in tm_keys],
            "top": [{
                "n": (r.get("SVC_INDUTY_CD_NM") or "").strip(),
                "a": man(r.get("THSMON_SELNG_AMT")),
                "c": int(round(num(r.get("THSMON_SELNG_CO")))),
            } for r in rows[:TOP_INDUSTRY] if num(r.get("THSMON_SELNG_AMT"))],
        }

    # 유동인구가 없는 상권은 화면에서 쓸 게 거의 없다 — 목록에는 두되 표시로 남긴다
    out = [t for t in trades.values() if t.get("fp") or t.get("st") or t.get("sl")]
    out.sort(key=lambda t: (t["gu"], t["n"]))

    gus = sorted({t["gu"] for t in out if t["gu"]})
    return {
        "quarter": {"flpop": fq, "store": sq, "selng": eq},
        "gus": gus,
        "trades": out,
        "total": len(out),
    }


def main() -> None:
    data = build()
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "trade.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("// 자동 생성 — tools/build_trade.py (서울시 상권분석서비스)\n")
        fh.write("window.TRADE_DATA = "
                 + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    size = os.path.getsize(path) / 1024
    q = data["quarter"]
    print(f"trade.js  상권 {data['total']:,}개 / {size:,.0f} KB")
    print(f"  분기 — 유동인구 {q['flpop']} · 점포 {q['store']} · 매출 {q['selng']}")


if __name__ == "__main__":
    main()
