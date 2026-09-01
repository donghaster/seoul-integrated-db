# -*- coding: utf-8 -*-
"""한국부동산원 상업용부동산 임대동향조사를 받아 docs/data/rent.js로 굽는다.

R-ONE에 따로 신청할 필요가 없다. 같은 자료가 KOSIS를 통해 유통되고(ORG_ID=408),
이미 가진 KOSIS_KEY로 그대로 읽힌다. 오히려 R-ONE보다 한 분기 빠르다.

KOSIS는 GitHub 러너에서 막혀 자동 갱신에 넣을 수 없다. 분기마다(1·4·7·10월)
손으로 한 번 돌리고 커밋한다 — 아파트 실거래가격지수와 같은 방식이다.

받는 것: 소규모·중대형 상가의 공실률·임대료·임대가격지수·수익률 (서울 59개 상권)

실행:  py tools/fetch_rent.py
"""
from __future__ import annotations

import json
import os
import ssl
import time
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIBLING = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard")
OUT = os.path.join(BASE_DIR, "docs", "data", "rent.js")

QUARTERS = 9                 # 최근 9분기 — 2년치 흐름을 보여 주기에 충분하다

# (키, 통계표, 규모, 항목, 항목이름)
# 수익률 표에는 소득·자본·투자 세 항목이 한꺼번에 들어 있다. 걸러내지 않으면
# 같은 시점에 세 벌이 이어 붙어 "서울 다음 줄부터 상권"이라는 가정이 깨진다.
TABLES = [
    ("smVac",  "DT_40801_N420201_06", "소규모", "공실률", None),
    ("smRent", "DT_40801_N4203_06",   "소규모", "임대료", None),
    ("smIdx",  "DT_40801_N4201_06",   "소규모", "임대가격지수", None),
    ("smYld",  "DT_40801_N4301_06",   "소규모", "수익률", "투자수익률"),
    ("mdVac",  "DT_40801_N220201_06", "중대형", "공실률", None),
    ("mdRent", "DT_40801_N2203_06",   "중대형", "임대료", None),
    ("mdIdx",  "DT_40801_N2201_06",   "중대형", "임대가격지수", None),
    ("mdYld",  "DT_40801_N2301_06",   "중대형", "수익률", "투자수익률"),
]

SIDO = ("전국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
        "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주")

# 부동산원 상권 59곳을 자치구에 붙인다. 경계에 걸친 곳은 여러 구에 붙였다.
# 이 표가 있어야 "서초구를 골랐을 때 어느 상권을 보여줄지"가 정해진다.
GU_OF = {
    "광화문": ["종로구"], "남대문": ["중구"], "동대문": ["중구", "종로구"],
    "명동": ["중구"], "방산시장": ["중구"], "북촌": ["종로구"], "서촌": ["종로구"],
    "시청": ["중구"], "을지로": ["중구"], "종로": ["종로구"], "충무로": ["중구"],
    "강남대로": ["강남구", "서초구"], "교대역": ["서초구"], "남부터미널": ["서초구"],
    "논현역": ["강남구"], "도산대로": ["강남구"], "신사역": ["강남구"],
    "압구정": ["강남구"], "청담": ["강남구"], "테헤란로": ["강남구"],
    "공덕역": ["마포구"], "당산역": ["영등포구"], "동교/연남": ["마포구"],
    "망원역": ["마포구"], "신촌/이대": ["서대문구", "마포구"],
    "영등포역": ["영등포구"], "홍대/합정": ["마포구"],
    "가락시장": ["송파구"], "건대입구": ["광진구"], "경희대": ["동대문구"],
    "군자": ["광진구"], "까치산역": ["강서구", "양천구"], "노량진": ["동작구"],
    "독산/시흥": ["금천구"], "뚝섬": ["성동구"], "목동": ["양천구"],
    "미아사거리": ["강북구"], "불광역": ["은평구"], "사당": ["동작구", "관악구"],
    "상계역": ["노원구"], "상봉역": ["중랑구"], "서울대입구역": ["관악구"],
    "성신여대": ["성북구"], "수유": ["강북구"], "숙명여대": ["용산구"],
    "신림역": ["관악구"], "약수역": ["중구"], "연신내": ["은평구"],
    "오류동역": ["구로구"], "왕십리": ["성동구"], "용산역": ["용산구"],
    "이태원": ["용산구"], "잠실/송파": ["송파구"], "잠실새내역": ["송파구"],
    "장안동": ["동대문구"], "천호": ["강동구"], "청량리": ["동대문구"],
    "혜화동": ["종로구"], "화곡": ["강서구"],
    # 중대형 상가에만 있는 9곳 — 이걸 넣어야 25개 자치구가 모두 덮인다(쌍문역=도봉구)
    "방배역/내방역": ["서초구"], "서래마을": ["서초구"], "양재말죽거리": ["서초구"],
    "양재역": ["서초구"], "학동/강남구청역": ["강남구"], "구로디지털단지역": ["구로구"],
    "구의역": ["광진구"], "낙성대": ["관악구"], "쌍문역": ["도봉구"],
}

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


def load_key() -> str:
    key = os.environ.get("KOSIS_KEY", "").strip()
    if key:
        return key
    for path in (os.path.join(BASE_DIR, ".env"), os.path.join(SIBLING, ".env")):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.strip().startswith("KOSIS_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


KEY = load_key()


def fetch(tbl: str) -> list:
    q = urllib.parse.urlencode({
        "method": "getList", "apiKey": KEY, "orgId": "408", "tblId": tbl,
        "itmId": "ALL", "objL1": "ALL", "prdSe": "Q", "newEstPrdCnt": str(QUARTERS),
        "format": "json", "jsonVD": "Y",
    })
    url = "https://kosis.kr/openapi/Param/statisticsParameterData.do?" + q
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60, context=_SSL) as r:
                d = json.loads(r.read().decode("utf-8", "replace"))
            if isinstance(d, dict):
                raise RuntimeError(json.dumps(d, ensure_ascii=False)[:120])
            return d
        except Exception as exc:                      # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{tbl}: {last}")


def seoul_slice(rows: list) -> tuple[dict, dict, dict]:
    """서울 구간만 잘라 (상권값, 권역값, 서울값)을 시점별로 모은다."""
    areas: dict = {}
    groups: dict = {}
    seoul: dict = {}

    by_prd: dict = {}
    for r in rows:
        by_prd.setdefault(r.get("PRD_DE"), []).append(r)

    for prd, rs in by_prd.items():
        names = [(x.get("C1_NM") or "", x.get("DT")) for x in rs]
        try:
            start = next(i for i, x in enumerate(names) if x[0] == "서울")
        except StopIteration:
            continue
        end = next((i for i in range(start + 1, len(names)) if names[i][0] in SIDO), len(names))
        seoul[prd] = names[start][1]
        cur = ""
        for n, v in names[start + 1:end]:
            if n.startswith("소계"):
                cur = n.replace("소계(", "").replace(")", "")
                groups.setdefault(cur, {})[prd] = v
                continue
            areas.setdefault(n, {"g": cur})[prd] = v
    return areas, groups, seoul


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2)


def main() -> None:
    if not KEY:
        raise SystemExit("KOSIS_KEY가 없습니다. .env에 넣어 주세요.")

    # 표마다 분기 수가 다르다(공실률 8개 · 지수 9개). 받으면서 바로 배열로 만들면
    # 나중에 더 긴 표가 나왔을 때 앞서 만든 배열이 한 칸씩 밀린다.
    # 그래서 전부 받아 두고, 분기 목록을 확정한 다음에 배열을 만든다.
    fetched = []
    all_prd: set = set()
    for key, tbl, size, item, itm in TABLES:
        print(f"{size} {item}…", flush=True)
        rows = fetch(tbl)
        if itm:
            rows = [r for r in rows if (r.get("ITM_NM") or "") == itm]
        areas, groups, seoul = seoul_slice(rows)
        prds = {p for v in areas.values() for p in v if p != "g"}
        all_prd |= prds
        fetched.append((key, areas, groups, seoul))
        print(f"   상권 {len(areas)}곳 · 분기 {len(prds)}개", flush=True)

    quarters = sorted(all_prd)
    data: dict = {"areas": {}, "groups": {}, "seoul": {}, "quarters": quarters}

    for key, areas, groups, seoul in fetched:
        for name, vals in areas.items():
            e = data["areas"].setdefault(name, {"g": vals.get("g", ""), "gu": GU_OF.get(name, [])})
            e[key] = [num(vals.get(p)) for p in quarters]
        for name, vals in groups.items():
            data["groups"].setdefault(name, {})[key] = [num(vals.get(p)) for p in quarters]
        data["seoul"][key] = [num(seoul.get(p)) for p in quarters]

    unmapped = [n for n in data["areas"] if not data["areas"][n]["gu"]]
    if unmapped:
        print(f"\n[주의] 자치구를 못 붙인 상권: {unmapped}")

    # 길이가 안 맞으면 화면에서 엉뚱한 분기 값을 읽게 된다 — 여기서 걸러 낸다
    n = len(quarters)
    for name, e in data["areas"].items():
        for k, v in e.items():
            if k in ("g", "gu"):          # 권역 이름과 자치구 목록은 분기 배열이 아니다
                continue
            if isinstance(v, list) and len(v) != n:
                raise SystemExit(f"{name}.{k} 길이 {len(v)} != 분기 {n}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// 자동 생성 — tools/fetch_rent.py (한국부동산원 상업용부동산 임대동향조사 / KOSIS 경유)\n")
        fh.write("window.RENT_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    size = os.path.getsize(OUT) / 1024
    print(f"\nrent.js  상권 {len(data['areas'])}곳 / 분기 {quarters[0]}~{quarters[-1]} ({n}개) / {size:,.0f} KB")


if __name__ == "__main__":
    main()
