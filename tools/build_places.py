"""서울 시설 지도 — 어느 지점에서든 둘레를 말할 수 있게.

주변 입지는 그동안 아파트 단지마다 따로 받아 두었다(fetch_around). 그런데 그
자료에는 시설마다 좌표가 함께 들어 있어서, 8,321개 단지 둘레에서 모은 것을
겹치는 것만 걷어 내면 그대로 '서울 시설 지도'가 된다 — 지하철·공원·병원·은행·
마트·우체국·소방서·체육시설 5천여 곳.

이것이 있으면 빌라처럼 따로 받아 두지 않은 곳에서도, 지도에서 누른 아무
자리에서도, 그 자리 기준으로 거리를 다시 재어 둘레를 보여 줄 수 있다.
카카오를 새로 부르지 않는다 — 있는 자료를 다시 쓰는 것뿐이다.

한계도 분명하다. 아파트 단지 둘레에서 모은 것이라, 아파트가 드문 동네는
시설이 덜 잡힐 수 있다. 화면에서 그 사정을 밝혀 둔다.

    py tools/build_places.py

학교는 여기 없다 — 학군 자료(schoolgeo)가 사립·공립·남녀공학까지 알려 주어
그쪽이 낫고, 이미 서울 전역을 담고 있다.
"""
from __future__ import annotations

import collections
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(BASE_DIR, ".cache", "around-v1.json")
OUT = os.path.join(BASE_DIR, "docs", "data", "places.js")
NL = chr(10)


def main() -> None:
    store = json.load(open(STORE, encoding="utf-8"))

    kinds: list[str] = []
    seen: dict[tuple, int] = {}
    rows: list[list] = []
    for _key, got in store.items():
        for kind, places in got.items():
            if kind.startswith("_"):            # _r(받아 둔 반경) 같은 표시는 시설이 아니다
                continue
            if kind not in kinds:
                kinds.append(kind)
            ki = kinds.index(kind)
            for p in places:
                # 같은 곳이 여러 단지에서 잡힌다. 100m 칸으로 묶어 한 번만 담되,
                # 이름이 같아도 자리가 다르면(파랑새공원처럼) 따로 둔다.
                k = (ki, p["n"], round(p["y"], 3), round(p["x"], 3))
                if k in seen:
                    continue
                seen[k] = 1
                rows.append([ki, p["n"], round(p["y"], 5), round(p["x"], 5)])

    rows.sort(key=lambda r: (r[0], r[1]))
    body = json.dumps({"kinds": kinds, "rows": rows}, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline=NL) as fh:
        fh.write("// 자동 생성 — tools/build_places.py (아파트 주변 입지 자료를 합친 것)" + NL)
        fh.write("window.PLACES = " + body + ";" + NL)

    cnt = collections.Counter(kinds[r[0]] for r in rows)
    print("places.js — 시설 %d곳 · %.1fKB" % (len(rows), len(body.encode("utf-8")) / 1024))
    for kind, n in cnt.most_common():
        print("   %-10s %5d" % (kind, n))


if __name__ == "__main__":
    main()
