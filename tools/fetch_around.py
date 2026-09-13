"""단지 주변 시설을 모은다 — 상담용 '입지 한 장'의 재료.

반포에서 집을 고르는 사람은 아파트만 보지 않는다. 어느 초등학교로 배정되는지,
지하철까지 몇 분인지, 병원·은행이 가까운지가 값만큼 무겁다. 그래서 단지를
소개할 때 반경 500m·1km 동심원을 그리고 그 안의 시설을 한 장에 펼쳐 보여 준다.

카카오 로컬(카테고리·키워드 검색)로 단지 좌표 1km 안을 훑어 가장 가까운 것만
남긴다. 받아 둔 것은 .cache에 쌓이므로 다음 실행이 이어받는다.

    py tools/fetch_around.py --gu 서초구 --minutes 40
    py tools/fetch_around.py --write        # 받지 않고 around.js만 다시 굽는다
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_geo as G                                   # 카카오 키·캐시를 그대로 쓴다

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE_DIR, ".cache")
STORE = os.path.join(CACHE, "around-v1.json")
OUT = os.path.join(BASE_DIR, "docs", "data", "around.js")

RADIUS = 1000          # 1km — 걸어서 15분. 그보다 멀면 '주변'이라 부르기 어렵다
KEEP = 5               # 갈래마다 가까운 다섯 곳. 더 담으면 지도가 글자로 덮인다
GAP = 0.12             # 카카오는 넉넉하지만 예의는 지킨다(초당 8회쯤)

GU_ORDER = ["서초구", "강남구", "동작구", "송파구", "용산구", "마포구", "성동구"]

# 갈래마다 어떻게 찾을지. code가 있으면 카테고리 검색, 없으면 키워드 검색.
# 한 갈래를 여러 말로 찾아야 하는 것들이 있다 — 소방서는 '119안전센터'로도 나온다.
# 학교는 여기서 안 받는다. 입지분석의 학군 자료(locinfo, NEIS)가 훨씬 낫다 —
# 이름과 거리뿐인 카카오와 달리 사립·공립, 남녀공학, 자율고까지 들어 있다.
# 그 주소를 지오코딩해 쓰면 되므로(build_school_geo) 여기서는 나머지만 모은다.
#
# 갈래마다 (찾을 말, 카테고리 꼴). 이름이 아니라 카카오가 붙여 준 분류로 거른다.
#
# 이름으로 거르면 '반포골프백화점'(골프용품점)이 백화점으로 들어오고,
# '로로피아나 신세계백화점강남점 여성'(백화점 안 옷가게)까지 딸려 온다.
# 분류를 보면 앞은 '스포츠용품 > 골프용품', 뒤는 '패션 > 의류판매'라 한눈에 갈린다.
KINDS = [
    ("지하철",   "SW8", None,        r"지하철|전철"),
    ("공원",     None, ["공원", "근린공원"], r"여행 > 공원 > "),
    ("종합병원", None, ["종합병원"], r"병원 > (대학병원|종합병원)"),
    ("은행",     "BK9", None,        r"은행(?! > ATM)(?!.*ATM)"),
    ("마트·백화점", None, ["백화점", "대형마트"], r"백화점|대형마트|대형슈퍼"),
    ("우체국",   None, ["우체국"],   r"우체국"),
    ("소방서",   None, ["소방서", "119안전센터"], r"소방서"),
    ("체육시설", None, ["체육센터", "수영장", "종합운동장"],
                 r"스포츠시설|수영장|종합운동장|체육관"),
]

_LAST = [0.0]
STATE = {"calls": 0}


def call(url: str, params: dict) -> list:
    """한 번 부른다. 실패하면 빈 목록 — 시설 하나 못 받았다고 멈출 일은 아니다."""
    gap = GAP - (time.time() - _LAST[0])
    if gap > 0:
        time.sleep(gap)
    _LAST[0] = time.time()
    STATE["calls"] += 1
    req = urllib.request.Request(
        url + "?" + urllib.parse.urlencode(params),
        headers={"Authorization": "KakaoAK " + G.KAKAO_KEY, "User-Agent": "Mozilla/5.0"},
    )
    for att in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r).get("documents", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + att * 2)
                continue
            return []
        except Exception:                                # noqa: BLE001
            time.sleep(1 + att)
    return []


CAT_URL = "https://dapi.kakao.com/v2/local/search/category.json"
KEY_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

# 어느 갈래든 이런 말이 들어가면 본 시설이 아니다. 곁가지·간판 가게들이다.
DROP = re.compile(r"(학원|교습|공인중개|부동산|분식|식당|카페|편의점|주차장|"
                  r"교무실|행정실|충전소|진출입로|화장실|체험|매표|안내센터|"
                  r"ATM|365|출장소|무인|대리점|취급국)")

# 이름 뒤에 붙는 군더더기는 떼고 본다 — '반포중학교 (휴교)'는 '반포중학교'로 본다.
TAIL = re.compile(r"\s*\((휴교|폐교|분교|본점|지하|신관|별관)[^)]*\)\s*$")


def around(lat: float, lng: float) -> dict:
    """한 단지 둘레를 훑는다. 갈래마다 가까운 것 몇 곳만 남긴다."""
    out = {}
    for name, code, words, want in KINDS:
        keep = re.compile(want)
        found = {}
        if code:
            docs = call(CAT_URL, {"category_group_code": code, "x": lng, "y": lat,
                                  "radius": RADIUS, "size": 15, "sort": "distance"})
        else:
            docs = []
            for w in words:
                docs += call(KEY_URL, {"query": w, "x": lng, "y": lat,
                                       "radius": RADIUS, "size": 15, "sort": "distance"})
        for d in docs:
            nm = (d.get("place_name") or "").strip()
            if not nm or DROP.search(nm):
                continue
            if not keep.search(d.get("category_name") or ""):
                continue
            nm = TAIL.sub("", nm).strip()      # '(휴교)' 같은 군더더기는 뗀다
            try:
                dist = int(d.get("distance") or 0)
            except ValueError:
                continue
            if not dist or dist > RADIUS:
                continue
            # 같은 곳이 여러 말로 잡힌다. 이름으로 한 번 접는다.
            if nm in found and found[nm][0] <= dist:
                continue
            found[nm] = (dist, round(float(d["y"]), 6), round(float(d["x"]), 6))
        # 딸린 시설은 본 시설에 접는다 — '반포종합운동장'과 '반포종합운동장
        # 배드민턴장'이 나란히 서면 같은 곳을 두 번 찍는 셈이다. 이름이 다른
        # 이름으로 시작하면 짧은 쪽(본 시설)만 남긴다.
        names = sorted(found, key=len)
        for nm2 in list(found):
            for short in names:
                if short != nm2 and nm2.startswith(short) and short in found:
                    found.pop(nm2, None)
                    break

        best = sorted(found.items(), key=lambda kv: kv[1][0])[:KEEP]
        if best:
            out[name] = [{"n": nm, "d": v[0], "y": v[1], "x": v[2]} for nm, v in best]
    return out


def gu_rank(gu: str) -> int:
    return GU_ORDER.index(gu) if gu in GU_ORDER else len(GU_ORDER)


def presale():
    """분양권만 거래되는 단지 — 아직 준공 전이라 매매·전월세 자료에 없다.

    반포 래미안 트리니원, 청담 르엘처럼 상담에 가장 자주 오르는 단지가 여기
    들어 있다. 입주 전일수록 "주변에 뭐가 있느냐"를 더 많이 묻는데, 거래
    캐시만 보면 이 단지들이 통째로 빠진다.
    """
    n = {}
    for f in glob.glob(os.path.join(CACHE, "aptPresale-*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:                                # noqa: BLE001
            continue
        for r in d if isinstance(d, list) else []:
            k = (r.get("gu"), r.get("dong"), r.get("name"))
            if all(k):
                n[k] = n.get(k, 0) + 1
    return n


def targets():
    """좌표를 아는 단지. 거래가 많은 곳부터 — 상담에 자주 오르는 순서다."""
    import fetch_supply as F
    raw = open(os.path.join(BASE_DIR, "docs", "data", "geo.js"), encoding="utf-8").read()
    geo = json.loads(re.search(r"=\s*(\{.*\});?\s*$", raw, re.S).group(1))
    cnt = {(c["gu"], c["dong"], c["name"]): c["n"] for c in F.complexes()}
    for k, v in presale().items():
        cnt[k] = cnt.get(k, 0) + v
    out = []
    for (gu, dong, name), n in cnt.items():
        k = "%s|%s|%s" % (gu, dong, name)
        if k in geo:
            out.append((k, gu, n, geo[k]))
    out.sort(key=lambda t: (gu_rank(t[1]), -t[2]))
    return out


def collect(only, minutes):
    store = json.load(open(STORE, encoding="utf-8")) if os.path.exists(STORE) else {}
    todo = targets()
    if only:
        todo = [t for t in todo if t[1] in only]
    left = [t for t in todo if t[0] not in store]
    print("단지 %d곳 · 이미 받아 둔 것 %d곳 · 남은 것 %d곳"
          % (len(todo), len(todo) - len(left), len(left)), flush=True)

    t0 = time.time()
    got = 0
    for key, gu, _n, c in left:
        if minutes and time.time() - t0 > minutes * 60:
            print("\n※ 정해 둔 %d분을 다 썼다. 다음에 이어받는다." % minutes)
            break
        store[key] = around(c["lat"], c["lng"])
        got += 1
        if got % 20 == 0:
            json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False)
            print("   %4d곳 · 호출 %d번 · %.0f분" % (got, STATE["calls"], (time.time() - t0) / 60),
                  flush=True)
    json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False)
    print("\n이번에 %d곳 · 호출 %d번 · %.0f분" % (got, STATE["calls"], (time.time() - t0) / 60))
    return store


def write(store):
    body = json.dumps(store, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("// 자동 생성 — tools/fetch_around.py (카카오 로컬)\n")
        fh.write("window.AROUND = %s;\n" % body)
    n = sum(len(v) for v in store.values())
    print("around.js — 단지 %d곳 · 갈래 %d개 · %.1fMB"
          % (len(store), n, len(body.encode("utf-8")) / 1024 / 1024))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="", help="이 자치구만(쉼표로 여럿)")
    ap.add_argument("--minutes", type=int, default=None, help="이번에 쓸 시간(분)")
    ap.add_argument("--write", action="store_true", help="받지 않고 around.js만 다시 굽는다")
    a = ap.parse_args()
    if a.write:
        write(json.load(open(STORE, encoding="utf-8")))
        return
    only = [g.strip() for g in a.gu.split(",") if g.strip()]
    write(collect(only, a.minutes))


if __name__ == "__main__":
    main()
