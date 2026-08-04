# -*- coding: utf-8 -*-
"""
대시보드 TOP10에 등장하는 단지·건물의 좌표를 모아 docs/data/geo.js를 만든다.

1) 기존 seoul dashboard 프로젝트의 geo-coords.js / .cache/geocode-cache.json을 씨앗으로 재사용
2) 없는 것만 카카오 로컬 API로 지오코딩(지번 주소 → 실패 시 키워드 검색)
3) 결과를 .cache/geocode-cache.json에 누적 저장(다음 실행 때 재사용)

실행:  py tools/build_geo.py
"""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, ".cache")
DATA_DIR = os.path.join(BASE_DIR, "docs", "data")
SIBLING = os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard")

CACHE_PATH = os.path.join(CACHE_DIR, "geocode-cache.json")

_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE


def _load_key() -> str:
    key = os.environ.get("KAKAO_REST_KEY", "").strip()
    if key:
        return key
    for path in (os.path.join(BASE_DIR, ".env"), os.path.join(SIBLING, ".env")):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.strip().startswith("KAKAO_REST_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


KAKAO_KEY = _load_key()


# ---------------------------------------------------------------- 캐시

def load_cache() -> dict:
    cache: dict = {}

    # 1) 이웃 프로젝트의 geo-coords.js (이미 3천여 개 지오코딩 완료)
    seed = os.path.join(SIBLING, "docs", "geo-coords.js")
    if os.path.exists(seed):
        text = open(seed, encoding="utf-8").read()
        for m in re.finditer(r'"([^"]+)":\s*\{\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)\s*\}', text):
            cache[m.group(1)] = {"lat": float(m.group(2)), "lng": float(m.group(3))}
        print(f"  씨앗(geo-coords.js) {len(cache):,}개")

    # 2) 이웃 프로젝트 + 자체 지오코딩 캐시
    for path in (os.path.join(SIBLING, ".cache", "geocode-cache.json"), CACHE_PATH):
        if not os.path.exists(path):
            continue
        try:
            raw = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for k, v in raw.items():
            if v and "lat" in v and "lng" in v:
                cache[k] = {"lat": float(v["lat"]), "lng": float(v["lng"])}
    return cache


def save_cache(cache: dict, misses: set) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    payload = dict(cache)
    for k in misses:
        payload.setdefault(k, None)     # 못 찾은 것도 기록해 재시도를 막는다
    tmp = CACHE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    os.replace(tmp, CACHE_PATH)


# ---------------------------------------------------------------- 카카오

def kakao(url: str, query: str) -> list:
    req = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode({'query': query})}",
        headers={"Authorization": f"KakaoAK {KAKAO_KEY}", "User-Agent": "Mozilla/5.0"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=12, context=_SSL) as resp:
                return json.loads(resp.read().decode("utf-8")).get("documents") or []
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            return []
        except Exception:
            time.sleep(0.5)
    return []


def geocode(gu: str, dong: str, name: str, jibun: str):
    if jibun:
        docs = kakao("https://dapi.kakao.com/v2/local/search/address.json", f"서울 {gu} {dong} {jibun}")
        if docs:
            return {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"])}
    if name:
        docs = kakao("https://dapi.kakao.com/v2/local/search/keyword.json", f"서울 {gu} {dong} {name}")
        if docs:
            return {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"])}
    # 마지막 수단 — 법정동 중심 좌표라도 잡아 지도에 대략 위치는 찍히게 한다
    docs = kakao("https://dapi.kakao.com/v2/local/search/address.json", f"서울 {gu} {dong}")
    if docs:
        return {"lat": float(docs[0]["y"]), "lng": float(docs[0]["x"]), "approx": True}
    return None


# ---------------------------------------------------------------- 대상 수집

def read_window_var(filename: str, varname: str) -> dict | None:
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8").read()
    body = text.split("=", 1)[1].strip().rstrip(";\n")
    return json.loads(body)


def collect_targets() -> list[tuple[str, str, str, str]]:
    """(gu, dong, name, jibun) — TOP10에 나오는 것만."""
    seen, out = set(), []

    def add(rows):
        for r in rows or []:
            gu, dong, name = r.get("gu"), r.get("dg"), r.get("n")
            if not gu or not dong or not name:
                continue
            key = f"{gu}|{dong}|{name}"
            if key in seen:
                continue
            seen.add(key)
            out.append((gu, dong, name, r.get("jb") or ""))

    apt = read_window_var("apt.js", "APT_DATA")
    if apt:
        for reg in apt["regions"].values():
            for t in ("sale", "jeonse", "wolse"):
                add(reg["top"].get(t))

    sangga = read_window_var("sangga.js", "SANGGA_DATA")
    if sangga:
        for reg in sangga["regions"].values():
            for g in ("shop", "office", "etc"):
                add(reg["nrgTop"].get(g))
            for t in ("sale", "jeonse", "wolse"):
                add(reg["offiTop"].get(t))

    return out


def main() -> None:
    print("좌표 캐시 로드…")
    cache = load_cache()
    print(f"  캐시 총 {len(cache):,}개")

    targets = collect_targets()
    print(f"TOP10 등장 대상 {len(targets):,}개")

    known_misses = set()
    if os.path.exists(CACHE_PATH):
        try:
            raw = json.load(open(CACHE_PATH, encoding="utf-8"))
            known_misses = {k for k, v in raw.items() if v is None}
        except (OSError, json.JSONDecodeError):
            pass

    todo = [t for t in targets if f"{t[0]}|{t[1]}|{t[2]}" not in cache and f"{t[0]}|{t[1]}|{t[2]}" not in known_misses]
    print(f"새로 지오코딩할 대상 {len(todo):,}개")

    if todo and not KAKAO_KEY:
        print("  ! KAKAO_REST_KEY가 없어 새 지오코딩은 건너뜁니다(캐시에 있는 것만 사용).")
        todo = []

    misses = set(known_misses)
    for i, (gu, dong, name, jibun) in enumerate(todo, 1):
        key = f"{gu}|{dong}|{name}"
        res = geocode(gu, dong, name, jibun)
        if res:
            cache[key] = res
        else:
            misses.add(key)
        if i % 100 == 0:
            print(f"  {i}/{len(todo)} …", flush=True)
            save_cache(cache, misses)
        time.sleep(0.05)

    save_cache(cache, misses)

    # 이번 대시보드가 실제로 쓰는 키만 골라 geo.js로 내보낸다(파일 크기 절약)
    used = {}
    for gu, dong, name, _ in targets:
        key = f"{gu}|{dong}|{name}"
        if key in cache:
            used[key] = cache[key]

    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "geo.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("// 자동 생성 — tools/build_geo.py (카카오 지오코딩 결과)\n")
        fh.write("window.GEO_COORDS = " + json.dumps(used, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"geo.js  좌표 {len(used):,}개 / {os.path.getsize(path) / 1024:.0f} KB "
          f"(미확인 {len(targets) - len(used):,}개)")


if __name__ == "__main__":
    main()
