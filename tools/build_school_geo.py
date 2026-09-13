"""학군 자료(locinfo)의 학교 주소를 좌표로 옮긴다.

입지분석에 이미 서울 학교 1,415곳이 정리돼 있다 — NEIS 자료라 이름·주소만이
아니라 사립/공립, 남녀공학, 자율고 여부, 개교연도까지 들어 있다. 지도에 찍으려면
좌표만 있으면 되므로, 주소를 카카오로 한 번 옮겨 붙여 둔다.

지도 서비스에서 학교를 따로 검색해 오는 편이 쉽지만 그렇게 하지 않는다.
거기서는 '서울반포초등학교 교무실' 같은 곁가지가 섞이고, 무엇보다 사립인지
자율고인지를 알 수 없다. 상담에서 정작 중요한 것은 그쪽이다.

    py tools/build_school_geo.py
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_geo as G

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCINFO = os.path.join(BASE_DIR, "docs", "data", "locinfo.js")
OUT = os.path.join(BASE_DIR, "docs", "data", "schoolgeo.js")
CACHE = os.path.join(BASE_DIR, ".cache", "schoolgeo-v1.json")

# 상담에서 쓰는 갈래만. 평생학교·방송통신·공동실습소까지 지도에 찍으면
# 정작 봐야 할 초·중·고가 묻힌다.
KEEP_KINDS = ("초등학교", "중학교", "고등학교", "외국인학교", "특수학교")


def load_locinfo() -> dict:
    s = io.open(LOCINFO, encoding="utf-8").read()
    return json.loads(re.search(r"=\s*(\{.*\});?\s*$", s, re.S).group(1))


def main() -> None:
    d = load_locinfo()
    cache = json.load(io.open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

    rows, miss, hit, asked = [], 0, 0, 0
    t0 = time.time()
    for gu, v in d.items():
        for kind, lst in (v.get("school", {}).get("byKind") or {}).items():
            if kind not in KEEP_KINDS:
                continue
            for x in lst:
                name, addr = x.get("name"), x.get("addr")
                if not name or not addr:
                    miss += 1
                    continue
                key = gu + "|" + name
                if key in cache:
                    hit += 1
                else:
                    asked += 1
                    docs = G.kakao("https://dapi.kakao.com/v2/local/search/address.json", addr)
                    if not docs:
                        docs = G.kakao("https://dapi.kakao.com/v2/local/search/keyword.json",
                                       "서울 " + gu + " " + name)
                    cache[key] = ({"lat": round(float(docs[0]["y"]), 6),
                                   "lng": round(float(docs[0]["x"]), 6)} if docs else None)
                    if asked % 50 == 0:
                        json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
                        print("   %d곳 물어봄 · %.0f분" % (asked, (time.time() - t0) / 60), flush=True)
                c = cache[key]
                if not c:
                    miss += 1
                    continue
                rows.append({
                    "gu": gu, "dong": x.get("dong") or "", "n": name, "k": kind,
                    "y": c["lat"], "x": c["lng"],
                    # 상담에서 꺼내는 것들 — 사립인지, 남녀공학인지, 자율고인지
                    "f": x.get("founded") or "", "c": x.get("coedu") or "",
                    "t": x.get("hsType") or "", "h": x.get("homepage") or "",
                })
    json.dump(cache, io.open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        "// 자동 생성 — tools/build_school_geo.py (입지분석 학군 자료 + 카카오 지오코딩)\n"
        "window.SCHOOL_GEO = %s;\n" % body)
    print("schoolgeo.js — 학교 %d곳 (캐시 %d · 새로 물어봄 %d · 좌표 못 찾음 %d) · %.0fKB"
          % (len(rows), hit, asked, miss, len(body.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()
