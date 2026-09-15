"""분양 예정 단지 — 거래가 아직 없어 대시보드에 안 나오는 단지를 손으로 올린다.

아파트 대시보드는 실거래 신고로 단지 목록을 만든다. 재건축 중이라 일반분양
전인 단지(반포 디에이치 클래스트 같은)는 신고가 한 건도 없어 찾기에도 안
잡힌다. 그런데 소개 자료를 만들 때 가장 먼저 보여 드리는 게 "주변에 뭐가
있느냐"다. 그래서 tools/upcoming.json에 적어 둔 단지만큼은 좌표를 잡고
주변 시설을 받아, 찾기에서 '분양 예정' 카드로 열리게 한다.

    py tools/build_upcoming.py             # 새로 적은 단지만 받는다
    py tools/build_upcoming.py --refresh   # 이미 받은 단지의 주변 시설도 다시 받는다

카카오 키는 build_geo가 .env에서 스스로 읽는다(화면에 찍지 않는다).
일정·설명은 공공데이터가 아니라 중개사가 적어 넣은 값이다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_geo as G                                   # 카카오 키·지오코딩
import fetch_around as A                                # 주변 시설 받기·자치구 파일 굽기

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(BASE_DIR, "tools", "upcoming.json")
OUT = os.path.join(BASE_DIR, "docs", "data", "upcoming.js")
NL = chr(10)


def previous() -> dict:
    """지난번에 잡아 둔 좌표 — 키가 없는 곳에서 돌려도 단지가 빠지지 않게."""
    if not os.path.exists(OUT):
        return {}
    raw = open(OUT, encoding="utf-8").read()
    m = re.search(r"=\s*(\[.*\]);?\s*$", raw, re.S)
    rows = json.loads(m.group(1)) if m else []
    return {"%s|%s|%s" % (r["gu"], r["dong"], r["name"]): r for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="이미 받은 주변 시설도 다시 받는다")
    a = ap.parse_args()

    items = json.load(open(LIST, encoding="utf-8"))
    prev = previous()
    store = json.load(open(A.STORE, encoding="utf-8")) if os.path.exists(A.STORE) else {}

    out = []
    for u in items:
        key = "%s|%s|%s" % (u["gu"], u["dong"], u["name"])
        old = prev.get(key)
        if old and "lat" in old:
            c = {"lat": old["lat"], "lng": old["lng"]}
        else:
            c = G.geocode(u["gu"], u["dong"], u["name"], u.get("jibun", ""))
            # 동 중심으로 대충 잡힌 좌표로는 '주변'을 말할 수 없다
            if not c or c.get("approx"):
                print("  ※ %s — 좌표를 못 잡아 건너뜀(지번을 확인)" % key)
                continue
        radius = int(u.get("radius") or A.WIDE)
        # 받아 둔 반경(_r)과 다르면 그 반경으로 다시 받는다
        if a.refresh or int(store.get(key, {}).get("_r") or A.RADIUS) != radius:
            f0 = A.STATE["fail"]
            res = A.around(c["lat"], c["lng"], radius)
            if A.STATE["fail"] > f0:
                print("  ※ %s — 카카오 호출 실패, 받아 둔 것을 그대로 둠" % key)
            else:
                kinds = [v for k, v in res.items()]
                res["_r"] = radius
                store[key] = res
                print("  %s — 주변 시설 %d갈래 %d곳" % (key, len(kinds), sum(len(v) for v in kinds)))
        row = dict(u)
        row["lat"], row["lng"] = round(c["lat"], 5), round(c["lng"], 5)
        out.append(row)

    os.makedirs(os.path.dirname(A.STORE), exist_ok=True)
    json.dump(store, open(A.STORE, "w", encoding="utf-8"), ensure_ascii=False)

    body = json.dumps(out, ensure_ascii=False, indent=1)
    with open(OUT, "w", encoding="utf-8", newline=NL) as fh:
        fh.write("// 자동 생성 — tools/build_upcoming.py (tools/upcoming.json + 카카오)" + NL)
        fh.write("window.APT_UPCOMING = %s;" % body + NL)
    print("upcoming.js — 분양 예정 단지 %d곳" % len(out))

    A.write(store)                                      # 주변 시설을 자치구 파일에 다시 굽는다


if __name__ == "__main__":
    main()
