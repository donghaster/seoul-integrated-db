# -*- coding: utf-8 -*-
"""
입지분석(교통·학군·생활권) 데이터를 docs/data/locinfo.js로 만든다.

옆 프로젝트 seoul dashboard가 이미 25개 구를 API로 받아 .cache/locinfo-*.json에
쌓아 두었으므로 그것을 재료로 쓴다. 실거래처럼 매일 바뀌는 자료가 아니라
(지하철역·학교·공원·상권) 가끔 다시 만들면 된다.

출처: 카카오맵(지하철) · NEIS(학교) · 서울 열린데이터광장(공원·상권) · KOSIS(인구·세대)

실행:  py tools/build_locinfo.py
"""
from __future__ import annotations

import json
import os
from collections import Counter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "docs", "data")
SIBLING_CACHE = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard", ".cache")

SEOUL_GU = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215",
    "동대문구": "11230", "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320",
    "노원구": "11350", "은평구": "11380", "서대문구": "11410", "마포구": "11440", "양천구": "11470",
    "강서구": "11500", "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710", "강동구": "11740",
}

# 노선 이름을 짧게 ("수도권3호선" -> "3호선")
def short_line(name: str) -> str:
    n = (name or "").replace("수도권", "").strip()
    return n or name


def build_gu(gu: str, raw: dict) -> dict:
    # ── 교통: 지하철역과 지나는 노선 ──
    subway = raw.get("subway") or []
    lines = Counter()
    for st in subway:
        for ln in st.get("lines") or []:
            lines[short_line(ln)] += 1
    stations = [{
        "name": st.get("name", ""),
        "lines": [short_line(l) for l in (st.get("lines") or [])],
    } for st in subway if st.get("name")]
    # 환승역(노선 2개 이상)을 앞으로
    stations.sort(key=lambda s: (-len(s["lines"]), s["name"]))

    # ── 학군: 종류별 학교 수 + 고등학교 유형 ──
    by_kind = (raw.get("schools") or {}).get("byKind") or {}
    kinds = {k: len(v) for k, v in by_kind.items()}
    highs = by_kind.get("고등학교") or []
    hs_type = Counter(h.get("hsType") or "기타" for h in highs)
    hs_founded = Counter(h.get("founded") or "-" for h in highs)
    # 동별 학교 수 — 어느 동에 학교가 몰려 있는지
    dong_cnt = Counter()
    for kind in ("초등학교", "중학교", "고등학교"):
        for s in by_kind.get(kind) or []:
            if s.get("dong"):
                dong_cnt[s["dong"]] += 1

    # ── 생활권: 공원·상권·인구 ──
    parks = raw.get("parks") or {}
    trade = raw.get("tradeAreas") or {}
    pop = raw.get("population") or {}
    house = raw.get("household") or {}

    return {
        "traffic": {
            "stationCount": len(stations),
            "lines": [{"name": n, "stations": c} for n, c in lines.most_common()],
            "top": stations[:8],
            "hotspots": [{"name": h.get("name", ""), "lvl": h.get("congestLvl", "")}
                         for h in (raw.get("hotspots") or [])][:6],
        },
        "school": {
            "total": (raw.get("schools") or {}).get("count", 0),
            "kinds": kinds,
            "hsType": dict(hs_type),
            "hsFounded": dict(hs_founded),
            "topDong": [{"dong": d, "n": c} for d, c in dong_cnt.most_common(6)],
            # 학교별 상세 — 이름을 누르면 주소·전화·유형까지 펼쳐 볼 수 있게 전부 담는다
            # (seoul dashboard의 학군 화면과 같은 방식)
            "byKind": {
                kind: [{
                    "name": s.get("name", ""),
                    "dong": s.get("dong", ""),
                    "addr": s.get("addr", ""),
                    "tel": s.get("tel", ""),
                    "hsType": s.get("hsType", ""),
                    "founded": s.get("founded", ""),
                    "coedu": s.get("coedu", ""),
                    "foundYear": s.get("foundYear", ""),
                    "homepage": s.get("homepage", ""),
                } for s in lst]
                for kind, lst in by_kind.items() if lst
            },
        },
        "life": {
            "parkCount": parks.get("count", 0),
            "parks": [{"name": p.get("name", ""), "addr": p.get("addr", "")}
                      for p in (parks.get("sample") or [])][:6],
            "tradeCount": trade.get("count", 0),
            "trades": [{"name": t.get("name", ""), "cat": t.get("category", "")}
                       for t in (trade.get("sample") or [])][:8],
            "popYear": pop.get("year", ""),
            "pop": pop.get("total", 0),
            "seniorRatio": pop.get("seniorRatio", 0),
            "households": house.get("households", 0),
        },
    }


def main() -> None:
    if not os.path.isdir(SIBLING_CACHE):
        raise SystemExit(f"[오류] 재료 폴더를 찾을 수 없습니다: {SIBLING_CACHE}\n"
                         "  seoul dashboard 프로젝트에서 먼저 py build_static.py를 한 번 돌려 주세요.")

    out, missing = {}, []
    for gu, lawd in SEOUL_GU.items():
        path = os.path.join(SIBLING_CACHE, f"locinfo-{lawd}.json")
        if not os.path.exists(path):
            missing.append(gu)
            continue
        try:
            raw = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            missing.append(gu)
            continue
        out[gu] = build_gu(gu, raw)

    print(f"입지 데이터 생성: {len(out)}/25개 구" + (f" · 빠짐: {', '.join(missing)}" if missing else ""))

    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "locinfo.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("// 자동 생성 — tools/build_locinfo.py\n")
        fh.write("// 출처: 카카오맵(지하철) · NEIS(학교) · 서울 열린데이터광장(공원·상권) · KOSIS(인구·세대)\n")
        fh.write("window.APT_LOCATION = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"  docs/data/locinfo.js  {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
