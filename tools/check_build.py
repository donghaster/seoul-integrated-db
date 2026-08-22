# -*- coding: utf-8 -*-
"""빌드 결과가 멀쩡한지 확인한다. 하나라도 어긋나면 0이 아닌 값으로 끝난다.

자동 갱신이 깨진 데이터를 커밋해 사이트를 죽이는 일을 막는 것이 목적이다.
실제로 apt.js 구조를 바꾼 뒤 뉴타운 대시보드와 좌표 갱신이 조용히 깨진 적이 있다.

실행:  py tools/check_build.py
"""
from __future__ import annotations

import json
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "docs", "data")

problems: list[str] = []


def load(name: str, var: str):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        problems.append(f"{name} 이 없습니다")
        return None
    text = open(path, encoding="utf-8").read()
    # 파일 맨 앞에 생성 안내 주석이 붙어 있으므로 대입문을 찾아서 그 뒤를 읽는다
    m = re.search(r"window\.%s\s*=\s*" % re.escape(var), text)
    if not m:
        problems.append(f"{name} 에 window.{var} 대입이 없습니다")
        return None
    body = text[m.end():].rstrip().rstrip(";")
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        problems.append(f"{name} JSON 파싱 실패: {e}")
        return None


def need(cond: bool, msg: str) -> None:
    if not cond:
        problems.append(msg)


# ── 아파트 ── 화면이 원본 실거래를 직접 집계하므로 deals 구조가 핵심이다
apt = load("apt.js", "APT_DATA")
if apt:
    need("deals" in apt, "apt.js 에 deals 가 없습니다 (화면이 원본을 직접 집계합니다)")
    d = apt.get("deals") or {}
    rows = d.get("rows") or []
    need(len(rows) > 100_000, f"apt.js 거래가 {len(rows):,}건뿐입니다 (30만건 안팎이어야 정상)")
    need(len(apt.get("gus") or []) == 25, f"apt.js 자치구가 {len(apt.get('gus') or [])}개입니다 (25개여야 정상)")
    need(bool(apt.get("today")), "apt.js 에 today(자료 기준일)가 없습니다")
    for k in ("types", "regions", "names", "base"):
        need(k in d, f"apt.js deals 에 {k} 가 없습니다")
    if rows:
        need(all(len(r) >= 8 for r in rows[:1000]), "apt.js 거래 행의 칸 수가 모자랍니다")

# ── 상가·오피스텔 ── 고정 기간 집계 + 상담용 월별 통계
sg = load("sangga.js", "SANGGA_DATA")
if sg:
    regions = sg.get("regions") or {}
    need(len(regions) > 300, f"sangga.js 지역이 {len(regions)}개뿐입니다 (400개 안팎이어야 정상)")
    need(sg.get("total", 0) > 50_000, f"sangga.js 총 거래가 {sg.get('total', 0):,}건뿐입니다")
    seoul = regions.get("서초구") or {}
    need("mo" in seoul, "sangga.js 에 월별 통계(mo)가 없습니다 — 상담용 브리핑이 빕니다")
    need("w" in seoul, "sangga.js 에 기간별 집계(w)가 없습니다")

# ── 뉴타운 ── 아파트 원본에서 실거래를 끌어다 쓰므로 법정동이 맞물려야 한다.
#    newtown.js는 손으로 관리하는 JS(키에 따옴표가 없다)라 JSON으로 못 읽는다.
nt_path = os.path.join(DATA_DIR, "newtown.js")
if not os.path.exists(nt_path):
    problems.append("newtown.js 가 없습니다")
elif apt:
    nt_text = open(nt_path, encoding="utf-8").read()
    pairs = re.findall(r'gu:\s*"([^"]+)"\s*,\s*dongs:\s*\[([^\]]*)\]', nt_text)
    need(len(pairs) > 20, f"newtown.js 지구가 {len(pairs)}개뿐입니다 (27개 안팎이어야 정상)")
    keys = set((apt.get("deals") or {}).get("regions") or [])
    missing = []
    for gu, raw in pairs:
        for g in re.findall(r'"([^"]+)"', raw):
            if f"{gu}|{g}" not in keys:
                missing.append(f"{gu}|{g}")
    # 거래가 원래 없는 동도 있으므로 절반 넘게 안 맞을 때만 문제로 본다
    total_dongs = sum(len(re.findall(r'"[^"]+"', raw)) for _, raw in pairs)
    need(total_dongs and len(missing) * 2 < total_dongs,
         f"뉴타운 법정동 {len(missing)}/{total_dongs}곳이 아파트 실거래와 안 맞물립니다: {missing[:5]}")

# ── 좌표 ── 지도가 비지 않을 만큼은 있어야 한다
geo = load("geo.js", "GEO_COORDS")
if geo is not None:
    need(len(geo) > 4_000, f"geo.js 좌표가 {len(geo):,}개뿐입니다 (5천개 이상이어야 정상)")

if problems:
    print("빌드 점검 실패:")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)

print(f"빌드 점검 통과: 아파트 {len((apt or {}).get('deals', {}).get('rows', [])):,}건 / "
      f"상가 {(sg or {}).get('total', 0):,}건 / 좌표 {len(geo or {}):,}개")
