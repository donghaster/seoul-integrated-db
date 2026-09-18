"""연립·다세대 건물 좌표 — 비아파트 지도에 원을 찍고, 지도에서 눌러 찾기 위한 재료.

빌라는 거래 신고에 지번이 함께 온다(아파트는 안 온다). 그 지번을 카카오
주소검색으로 좌표로 바꿔 두면, 아파트에서 하던 것을 빌라에서도 할 수 있다 —
지도에 건물을 찍고, 빈 자리를 눌러 둘레 건물을 모으고, 건물을 눌러 실거래와
주변 입지를 펼치는 일이다.

받은 좌표는 아파트와 같은 캐시(.cache/geocode-cache.json)에 쌓이고, 화면이
쓰는 파일은 자치구별로 나눠 굽는다 — 서울 5만 7천 곳을 한 파일에 담으면
2.8MB라, 자기 구만 보는 사람까지 그 무게를 지게 된다.

    py tools/build_rhgeo.py --minutes 120     # 두 시간만 받고 멈춘다
    py tools/build_rhgeo.py --gu 송파구       # 이 구만
    py tools/build_rhgeo.py --write           # 받지 않고 파일만 다시 굽는다

카카오 키는 build_geo가 .env에서 스스로 읽는다(여기서는 값을 다루지 않는다).
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_geo as G                                  # 카카오 키·좌표 캐시를 그대로 쓴다
import fetch_supply as F                               # 법정동코드(파일 이름)
import fetch_around as A                               # 자치구 순서

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE_DIR, ".cache")
CACHE_PATH = os.path.join(CACHE, "geocode-cache.json")
OUT_DIR = os.path.join(BASE_DIR, "docs", "data", "rhgeo")

NL = chr(10)
GAP = 0.12                     # 초당 여덟 번쯤. 카카오는 넉넉하지만 예의는 지킨다
ADDR_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KEY_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

_LAST = [0.0]
STATE = {"calls": 0, "fail": 0}


def ask(url: str, query: str):
    """한 번 묻는다. 못 받으면 None — 빈 결과와 구분해야 한다.

    하루 한도에 닿으면 카카오가 오류를 돌려주는데, 그것을 "그런 주소는 없다"로
    믿고 캐시에 적어 두면 그 건물은 영영 좌표를 못 갖는다.
    """
    gap = GAP - (time.time() - _LAST[0])
    if gap > 0:
        time.sleep(gap)
    _LAST[0] = time.time()
    STATE["calls"] += 1
    req = urllib.request.Request(
        url + "?" + urllib.parse.urlencode({"query": query}),
        headers={"Authorization": "KakaoAK " + G.KAKAO_KEY, "User-Agent": "Mozilla/5.0"},
    )
    for att in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r).get("documents", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + att * 2)
                continue
            STATE["fail"] += 1
            return None
        except Exception:                               # noqa: BLE001
            time.sleep(1 + att)
    STATE["fail"] += 1
    return None


def locate(gu: str, dong: str, name: str, jibun: str):
    """지번으로 먼저, 안 되면 건물 이름으로. (좌표, 실패했나)를 돌려준다."""
    if jibun:
        docs = ask(ADDR_URL, "서울 %s %s %s" % (gu, dong, jibun))
        if docs is None:
            return None, True
        if docs:
            return {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"])}, False
    docs = ask(KEY_URL, "서울 %s %s %s" % (gu, dong, name))
    if docs is None:
        return None, True
    if docs:
        return {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"])}, False
    return None, False          # 정말 못 찾은 것 — 캐시에 적어 두어 다시 묻지 않는다


def targets():
    """(키, 구, 동, 이름, 지번) — 거래가 있었던 빌라 전부. 자치구 순서대로."""
    seen = {}
    for f in sorted(glob.glob(os.path.join(CACHE, "rh*.json"))):
        try:
            rows = json.load(open(f, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for r in rows:
            gu, dong, name = r.get("gu"), r.get("dong"), r.get("name")
            if not gu or not dong or not name:
                continue
            k = "%s|%s|%s" % (gu, dong, name)
            if k not in seen:
                seen[k] = (k, gu, dong, name, r.get("jibun") or "")
    out = list(seen.values())
    out.sort(key=lambda t: (A.gu_rank(t[1]), t[1], t[2], t[3]))
    return out


def load_cache() -> dict:
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        return json.load(open(CACHE_PATH, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_cache(cache: dict) -> None:
    os.makedirs(CACHE, exist_ok=True)
    tmp = CACHE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False)
    os.replace(tmp, CACHE_PATH)


def collect(only, minutes):
    cache = load_cache()
    todo = targets()
    if only:
        todo = [t for t in todo if t[1] in only]
    left = [t for t in todo if t[0] not in cache]
    print("빌라 %d곳 · 이미 아는 것 %d곳 · 남은 것 %d곳"
          % (len(todo), len(todo) - len(left), len(left)), flush=True)

    t0 = time.time()
    got = miss = bad = 0
    for i, (k, gu, dong, name, jibun) in enumerate(left, 1):
        if minutes and time.time() - t0 > minutes * 60:
            print(NL + "※ 정해 둔 %d분을 다 썼다. 다음에 이어받는다." % minutes)
            break
        res, failed = locate(gu, dong, name, jibun)
        if failed:
            bad += 1
            if bad >= 3:
                print(NL + "※ 카카오 호출이 잇달아 실패 — 하루 한도에 닿았을 수 있다. "
                      "받은 데까지 저장하고 멈춘다.")
                break
            continue
        bad = 0
        cache[k] = res          # 못 찾은 것은 None으로 적어 두어 다시 묻지 않는다
        if res:
            got += 1
        else:
            miss += 1
        if i % 500 == 0:
            save_cache(cache)
            print("   %5d곳 · 찾음 %d · 못 찾음 %d · 호출 %d번 · %.0f분"
                  % (i, got, miss, STATE["calls"], (time.time() - t0) / 60), flush=True)
    save_cache(cache)
    print(NL + "이번에 찾음 %d곳 · 못 찾음 %d곳 · 호출 %d번 · %.0f분"
          % (got, miss, STATE["calls"], (time.time() - t0) / 60))
    return cache


def write(cache: dict) -> None:
    """자치구별 파일로 굽는다. 파일마다 내용 해시로 버전을 매긴다."""
    os.makedirs(OUT_DIR, exist_ok=True)
    by_gu = {}
    for k, gu, dong, name, _jb in targets():
        c = cache.get(k)
        if not c:
            continue
        by_gu.setdefault(gu, {})[k] = [round(c["lat"], 5), round(c["lng"], 5)]

    files, vers, total = {}, {}, 0
    for gu, part in sorted(by_gu.items()):
        cd = F.GU_CD.get(gu)
        if not cd:
            print("   ※ %s — 법정동코드를 몰라 건너뜀" % gu)
            continue
        body = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
        total += len(body.encode("utf-8"))
        vers[cd] = hashlib.md5(body.encode("utf-8")).hexdigest()[:10]
        with open(os.path.join(OUT_DIR, cd + ".js"), "w", encoding="utf-8", newline=NL) as fh:
            fh.write("// 자동 생성 — tools/build_rhgeo.py (카카오 주소검색) · %s" % gu + NL)
            fh.write("Object.assign(window.RHGEO = window.RHGEO || {}, %s);" % body + NL)
        files[gu] = cd

    stamp = hashlib.md5(json.dumps(vers, sort_keys=True).encode()).hexdigest()[:10]
    with open(os.path.join(OUT_DIR, "index.js"), "w", encoding="utf-8", newline=NL) as fh:
        fh.write("// 자동 생성 — tools/build_rhgeo.py · 어느 구가 어느 파일인지" + NL)
        fh.write("window.RHGEO_FILES = %s;" % json.dumps(files, ensure_ascii=False) + NL)
        fh.write("window.RHGEO_VS = %s;" % json.dumps(vers, sort_keys=True) + NL)
        fh.write('window.RHGEO_V = "%s";' % stamp + NL)

    n = sum(len(v) for v in by_gu.values())
    print("rhgeo/ — 자치구 %d개 · 건물 %d곳 · 합계 %.1fMB (한 구 평균 %.0fKB)"
          % (len(files), n, total / 1024 / 1024, total / 1024 / max(len(files), 1)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gu", default="", help="이 자치구만(쉼표로 여럿)")
    ap.add_argument("--minutes", type=int, default=None, help="이번에 쓸 시간(분)")
    ap.add_argument("--write", action="store_true", help="받지 않고 자치구 파일만 다시 굽는다")
    a = ap.parse_args()
    if a.write:
        write(load_cache())
        return
    only = [g.strip() for g in a.gu.split(",") if g.strip()]
    write(collect(only, a.minutes))


if __name__ == "__main__":
    main()
