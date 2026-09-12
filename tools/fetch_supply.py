# -*- coding: utf-8 -*-
"""건축물대장에서 단지별 '전용면적 → 공급(분양)면적' 표를 받아 docs/data/supply.js로 굽는다.

왜 필요한가
    실거래 자료에는 전용면적만 온다. 그런데 고객이 말하는 "34평"은 분양 평수라,
    대시보드는 전용면적을 전용률로 나눠 분양면적을 어림해 왔다. 문제는 전용률이
    단지마다 71~77%로 갈린다는 것이다. 고정값 0.769를 쓰면 아크로리버파크
    84.97㎡가 33.4평으로 나오는데, 시장에서 부르는 이름은 34평이다. 한 평이 틀린다.

    건축물대장 전유공용면적부는 호마다 전유면적과 공용면적을 따로 적어 두므로,
    어림하지 않고 그대로 더해서 얻을 수 있다.

        공급면적 = 전유면적 + 주거공용면적

    대장에서 '공용'이면서 '주건축물'인 것이 주거공용(계단·복도·엘리베이터홀)이고,
    '부속건축물'인 것은 기타공용(지하주차장·관리사무소·복리시설)이다. 기타공용은
    계약면적에는 들어가도 공급면적에는 들어가지 않으므로 반드시 빼야 한다.

한도가 빡빡하다
    하루 1만 번이고, numOfRows를 아무리 크게 줘도 한 번에 100행만 온다.
    헬리오시티 한 단지가 106,959행이라 전부 받으면 1,070번이다. 서울 전체를
    다 받으려면 2주가 걸린다.

    그래서 단지당 쪽수를 끊는다. 같은 단지 같은 전용면적이면 공급면적이 사실상
    일정하고(아크로리버파크에서 호별 편차 1% 미만), 거래가 많은 주력 평형일수록
    앞쪽에서 일찍 나온다. 10쪽(약 110호)이면 주력 평형은 다 걸린다.

    거래 많은 단지부터 받고, 받은 것은 곧바로 적어 둔다. 하루 한도에 걸리면
    멈췄다가, 다음 날 다시 돌리면 못 받은 것부터 잇는다.

급하지 않은 일이다
    하루 한도(1만 번)를 다 태우면 그날 다른 볼일을 못 본다. 그래서 기본으로
    절반만 쓰고 멈춘다(SUPPLY_QUOTA_SHARE로 바꿀 수 있다). 매일 조금씩
    채우면 되는 일이라 서두를 이유가 없다.

실행
    py tools/fetch_supply.py                 # 하루 한도의 절반까지
    py tools/fetch_supply.py --minutes 20    # 20분만 쓰고 멈춘다
    py tools/fetch_supply.py --budget 3000   # 3,000번만 쓴다
    py tools/fetch_supply.py --write         # 받지 않고 supply.js만 다시 굽는다
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE_DIR, ".cache")
STORE = os.path.join(CACHE, "supply-raw-v1.json")
BJDCD = os.path.join(CACHE, "bjdongcd-v1.json")
OUT = os.path.join(BASE_DIR, "docs", "data", "supply.js")
HAND = os.path.join(BASE_DIR, "tools", "supply_manual.json")

HOST = "https://apis.data.go.kr/1613000/BldRgstHubService/"
PAGE_CAP = 12                # 단지당 최대 쪽수 (한 쪽 100행)
MIN_PAGES = 4                # 새 평형이 안 나와도 이만큼은 본다
QUOTA_FLOOR = 150            # 이만큼은 남겨 둔다
# 이 일은 급하지 않다. 하루 한도를 다 태우면 그날 다른 볼일(단지 하나 확인,
# 새 기능 시험)을 못 본다. 절반만 쓰고 나머지는 남겨 둔다.
QUOTA_SHARE = float(os.environ.get("SUPPLY_QUOTA_SHARE", "0.5"))
SPREAD_MAX = 0.03            # 같은 전용면적인데 호별 공급면적이 3% 넘게 흩어지면 버린다
RATIO_LO, RATIO_HI = 0.60, 0.86   # 이 범위를 벗어난 전용률은 대장 등재가 부실한 것
MIN_DWELL = 26.0             # 이보다 작은 전유면적은 주택이 아니라 상가·창고다

# 전유부 주용도가 이 가운데 하나여야 사람이 사는 호로 친다.
DWELL = ("아파트", "공동주택", "연립주택", "다세대주택", "주택")

GU_CD = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200",
    "광진구": "11215", "동대문구": "11230", "중랑구": "11260", "성북구": "11290",
    "강북구": "11305", "도봉구": "11320", "노원구": "11350", "은평구": "11380",
    "서대문구": "11410", "마포구": "11440", "양천구": "11470", "강서구": "11500",
    "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710",
    "강동구": "11740",
}

# ── API ────────────────────────────────────────────────────────────────────
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE
_LOCK = threading.Lock()
_LAST = [0.0]

STATE = {"gap": 0.9, "remain": None, "limit": None, "calls": 0, "throttled": 0}
GAP_MIN, GAP_MAX = 0.8, 8.0


def _key():
    for p in (os.path.join(BASE_DIR, ".env"),
              os.path.join(os.path.dirname(BASE_DIR), "seoul dashboard", ".env")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                if line.strip().startswith("DATA_GO_KR_KEY="):
                    v = line.split("=", 1)[1].strip()
                    if v:
                        return urllib.parse.unquote(v)
    v = os.environ.get("DATA_GO_KR_KEY", "")
    if not v:
        sys.exit("DATA_GO_KR_KEY가 없다. .env에 넣거나 환경변수로 준다.")
    return urllib.parse.unquote(v)


KEY = _key()


def _note(h):
    for name, slot in (("X-RateLimit-Remaining", "remain"),
                       ("X-RateLimit-Limit", "limit")):
        v = h.get(name)
        if v and str(v).isdigit():
            STATE[slot] = int(v)


def call(op, tries=6, **args):
    """한 번 부른다.

    429(순간 폭주 제한)도 하루 한도를 깎는다. 맞고 나서 물러서는 것보다 처음부터
    천천히 가는 게 싸므로, 잘 되면 조금씩 빨라지고 막히면 확 느려지게 했다.
    """
    args.setdefault("_type", "json")
    args.setdefault("numOfRows", "100")
    args.setdefault("pageNo", "1")
    args["serviceKey"] = KEY
    url = HOST + op + "?" + urllib.parse.urlencode(args)
    last = ""
    for att in range(tries):
        with _LOCK:
            gap = STATE["gap"] - (time.time() - _LAST[0])
            if gap > 0:
                time.sleep(gap)
            _LAST[0] = time.time()
        STATE["calls"] += 1
        try:
            with urllib.request.urlopen(url, timeout=90, context=_CTX) as r:
                raw = r.read().decode("utf-8", "replace").strip()
                _note(r.headers)
            if not raw:
                raise ValueError("빈 본문")
            d = json.loads(raw)
            head = d["response"]["header"]
            if head.get("resultCode") not in ("00", "0"):
                raise ValueError("%s %s" % (head.get("resultCode"), head.get("resultMsg")))
            STATE["gap"] = max(GAP_MIN, STATE["gap"] * 0.97)
            return d["response"]["body"]
        except urllib.error.HTTPError as e:
            _note(e.headers)
            last = "HTTP %s" % e.code
            if e.code == 429:
                STATE["throttled"] += 1
                STATE["gap"] = min(GAP_MAX, STATE["gap"] * 1.8 + 0.3)
                time.sleep(3 + att * 2)
            else:
                time.sleep(1 + att)
        except Exception as exc:                     # noqa: BLE001
            last = str(exc)[:60]
            time.sleep(1 + att)
    raise RuntimeError(last)


def rows(body):
    it = (body.get("items") or {})
    if not it:
        return []
    it = it.get("item") or []
    return it if isinstance(it, list) else [it]


# ── 어떤 단지를 받을 것인가 ────────────────────────────────────────────────
def complexes():
    """실거래 캐시에서 (자치구, 법정동, 단지명, 지번, 거래건수)를 모은다."""
    n = Counter()
    jb = defaultdict(Counter)
    for f in (glob.glob(os.path.join(CACHE, "aptSale-*.json"))
              + glob.glob(os.path.join(CACHE, "aptRent-*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:                            # noqa: BLE001
            continue
        for r in d if isinstance(d, list) else []:
            k = (r.get("gu"), r.get("dong"), r.get("name"))
            if not all(k) or k[0] not in GU_CD:
                continue
            n[k] += 1
            v = (r.get("jibun") or "").strip()
            if v:
                jb[k][v] += 1
    return [{"gu": k[0], "dong": k[1], "name": k[2],
             "jibun": jb[k].most_common(1)[0][0], "n": c}
            for k, c in n.most_common() if jb[k]]


def bjdong_codes(want):
    """법정동코드 표. 없으면 대장 응답에서 역으로 캐낸다.

    서울 법정동코드는 구마다 10100, 10200 … 백 단위로 올라간다. 그 코드로 표제부를
    한 건 불러오면 platPlc에 '서울특별시 서초구 반포동 …'이 적혀 오니, 그 코드가
    어느 동인지 응답이 스스로 알려준다. 추측이 아니다.

    끝까지 훑어도 안 나오는 동이 몇 개 있다. 실거래 자료의 구-동 조합이 실제와
    다른 것들이다(성동구 신당동은 중구, 성북구 청량리동은 동대문구, 강북구
    도봉동은 도봉구 소속이다). 그런 구를 매번 99번씩 다시 훑으면 하루 한도를
    그냥 태우므로, 한 번 다 훑었다는 표시를 남겨 두고 다시 훑지 않는다.
    """
    got = json.load(open(BJDCD, encoding="utf-8")) if os.path.exists(BJDCD) else {}
    for gu, sig in GU_CD.items():
        need = want.get(sig, set())
        found = got.get(sig, {})
        if set(found) >= need or found.get("_done"):
            continue
        for i in range(101, 200):
            if set(found) >= need:
                break
            cd = "%05d" % (i * 100)
            if cd in found.values():
                continue
            try:
                r = rows(call("getBrTitleInfo", tries=3, sigunguCd=sig,
                              bjdongCd=cd, numOfRows="1"))
            except Exception:                        # noqa: BLE001
                continue
            if not r:
                continue
            m = re.match(r"서울특별시\s+(\S+)\s+(\S+)", (r[0].get("platPlc") or "").strip())
            if m and m.group(1) == gu:
                found[m.group(2)] = cd
        got[sig] = found
        os.makedirs(CACHE, exist_ok=True)
        json.dump(got, open(BJDCD, "w", encoding="utf-8"), ensure_ascii=False)
        print("   법정동코드 %-7s %2d/%2d" % (gu, len(need & set(found)), len(need)), flush=True)
    return got


# 먼저 채울 자치구 순서. 상담이 실제로 일어나는 곳부터 끝낸다 —
# 서울 25개 구를 고르게 훑으면 어느 구도 "다 됐다"고 말할 수 없다.
# 여기 없는 구는 뒤에 붙고, 그 안에서는 지금처럼 거래 많은 지번부터 간다.
GU_ORDER = ["서초구", "강남구", "동작구", "송파구", "용산구", "마포구", "성동구"]


def gu_rank(gu):
    return GU_ORDER.index(gu) if gu in GU_ORDER else len(GU_ORDER)


def sites(cs, codes):
    """지번 한 곳 = 요청 한 묶음. 같은 지번의 여러 단지를 한 번에 채운다."""
    grp = defaultdict(list)
    for c in cs:
        cd = (codes.get(GU_CD[c["gu"]]) or {}).get(c["dong"])
        if not cd:
            continue
        p = c["jibun"].split("-")
        try:
            bun = "%04d" % int(p[0])
            ji = "%04d" % int(p[1]) if len(p) > 1 and p[1].isdigit() else "0000"
        except ValueError:
            continue
        grp[(GU_CD[c["gu"]], cd, bun, ji)].append(c)
    out = list(grp.items())
    # 우선순위 구 먼저, 그 안에서는 거래 많은 지번 먼저
    out.sort(key=lambda kv: (gu_rank(kv[1][0]["gu"]), -sum(c["n"] for c in kv[1])))
    return out


# ── 면적 계산 ──────────────────────────────────────────────────────────────
def by_building(raw):
    """대장 명칭별 {전용면적: [호별 공급면적…]}."""
    ho = defaultdict(lambda: [0.0, 0.0])             # [전유, 주거공용]
    for it in raw:
        k = ((it.get("bldNm") or "").strip(), it.get("dongNm", ""), it.get("hoNm", ""))
        a = float(it.get("area") or 0)
        if it.get("exposPubuseGbCdNm") == "전유":
            # 단지 안에는 상가·창고 호실도 같이 등재돼 있다. 전용 2.88㎡짜리가
            # 평형표에 섞이면 그 단지 전용률까지 망가진다. 주용도로 가른다.
            if not any(w in (it.get("mainPurpsCdNm") or "") for w in DWELL):
                continue
            ho[k][0] += a
        elif it.get("mainAtchGbCdNm") == "주건축물":
            ho[k][1] += a
    out = defaultdict(lambda: defaultdict(list))
    for (bld, _d, _h), (ex, pub) in ho.items():
        if ex > 0 and pub > 0:
            out[bld]["%.2f" % round(ex, 2)].append(ex + pub)
    return out


def norm(s):
    return "".join(ch for ch in (s or "") if ch.isalnum())


def pick(names, want):
    """대장 명칭 중 실거래 단지명과 맞는 것. 애매하면 고르지 않는다."""
    n = norm(want)
    for b in names:
        nb = norm(b)
        if nb and n and (nb == n or nb in n or n in nb):
            return b
    return next(iter(names)) if len(names) == 1 else None


def believable(ex, sup):
    """이 한 쌍을 '실제값'이라고 내세워도 되는가.

    옛날 집합건축물대장은 주거공용 등재가 부실하다. 여의도 대교(1975년)는
    전유 117.36㎡에 주거공용이 '대피호' 9.02㎡뿐이라 전용률이 92.9%로 나온다.
    계단·복도·승강기가 아예 안 올라가 있는 것이다. 계산은 맞지만 공급면적이
    아니다. 아파트 전용률은 복도식 68~75%, 계단식 75~83%, 타워형 주상복합
    62~72% 어름이니, 이 범위를 크게 벗어나면 등재가 성한 게 아니라고 본다.

    작은 면적은 상가·창고 호실이다. 주용도로도 거르지만, 예전에 받아 둔
    자료에는 그 정보가 없으므로 면적으로 한 번 더 막는다.
    """
    if ex < MIN_DWELL or sup <= 0:
        return False
    return RATIO_LO <= ex / sup <= RATIO_HI


def tidy(area_lists):
    """대표값을 낸다. 못 믿을 것은 버린다.

    같은 지번에 다른 단지가 묶여 있으면(상계주공15·16처럼) 같은 전용면적에 서로
    다른 공급면적이 섞인다. 이름으로는 못 가르지만 흩어짐으로는 가른다. 멀쩡한
    단지는 편차가 1%를 넘지 않는다.
    """
    out, dropped = {}, 0
    for ex, sup in area_lists.items():
        avg = sum(sup) / len(sup)
        if avg <= 0:
            continue
        if (max(sup) - min(sup)) / avg > SPREAD_MAX:
            dropped += 1
            continue
        if not believable(float(ex), avg):
            dropped += 1
            continue
        out[ex] = round(avg, 2)
    return out, dropped


def fetch_site(sig, cd, bun, ji, cap=PAGE_CAP):
    """한 지번을 받는다. 새 평형이 안 나오면 일찍 끊는다.

    쪽수를 고정으로 끊으면 평형이 서너 개뿐인 단지에도 열 번을 쓴다. 서울 전체가
    8,242곳이라 그 낭비가 며칠치다. 그래서 연달아 두 쪽 동안 새 전용면적이 하나도
    안 나오면 그 단지는 다 본 것으로 치고 넘어간다. 다만 앞 몇 쪽은 한 동에
    몰려 있을 수 있으므로 최소 네 쪽은 본다.
    """
    got, page, total = [], 1, 0
    seen, quiet = set(), 0
    while page <= cap:
        b = call("getBrExposPubuseAreaInfo", sigunguCd=sig, bjdongCd=cd,
                 bun=bun, ji=ji, pageNo=str(page))
        r = rows(b)
        got += r
        total = int(b.get("totalCount") or 0)
        if not r or len(got) >= total:
            break
        fresh = {it.get("area") for it in r if it.get("exposPubuseGbCdNm") == "전유"}
        quiet = 0 if fresh - seen else quiet + 1
        seen |= fresh
        if page >= MIN_PAGES and quiet >= 2:
            break
        page += 1
    return got, total


# ── 받기 ───────────────────────────────────────────────────────────────────
def progress(cs, store):
    """우선순위 구가 얼마나 찼는지 한눈에. '서초구 다 됐다'를 말할 수 있어야 한다."""
    tot, got = defaultdict(int), defaultdict(int)
    for c in cs:
        tot[c["gu"]] += 1
        if "%s|%s|%s" % (c["gu"], c["dong"], c["name"]) in store:
            got[c["gu"]] += 1
    line = []
    for g in GU_ORDER:
        if not tot[g]:
            continue
        line.append("%s %d/%d(%.0f%%)" % (g, got[g], tot[g], got[g] / tot[g] * 100))
    rest_t = sum(v for k, v in tot.items() if k not in GU_ORDER)
    rest_g = sum(v for k, v in got.items() if k not in GU_ORDER)
    if rest_t:
        line.append("나머지 %d/%d" % (rest_g, rest_t))
    print("  진행 " + " · ".join(line), flush=True)


def collect(budget=None, minutes=None, only=None):
    store = json.load(open(STORE, encoding="utf-8")) if os.path.exists(STORE) else {}
    cs = complexes()
    if only:
        cs = [c for c in cs if c["gu"] in only]
    want = defaultdict(set)
    for c in cs:
        want[GU_CD[c["gu"]]].add(c["dong"])
    codes = bjdong_codes(want)
    todo = sites(cs, codes)
    print("단지 %d개 → 지번 %d곳, 이미 받아 둔 단지 %d개\n" % (len(cs), len(todo), len(store)))
    progress(cs, store)
    print()

    ok = bad = later = 0
    t0 = time.time()
    start = STATE["calls"]
    for (sig, cd, bun, ji), group in todo:
        if all("%s|%s|%s" % (c["gu"], c["dong"], c["name"]) in store for c in group):
            continue
        if STATE["remain"] is not None and STATE["remain"] < QUOTA_FLOOR:
            print("\n※ 오늘 한도가 바닥이라 멈춘다 (남은 %d번). 내일 다시 돌리면 이어받는다."
                  % STATE["remain"])
            break
        if STATE["limit"] and STATE["calls"] - start >= STATE["limit"] * QUOTA_SHARE:
            print("\n※ 하루 한도의 %.0f%%(%d번)를 썼다. 나머지는 다른 일에 남겨 둔다."
                  % (QUOTA_SHARE * 100, STATE["limit"] * QUOTA_SHARE))
            break
        if minutes and time.time() - t0 > minutes * 60:
            # 서버가 느린 날엔 호출 수로만 끊으면 한없이 늘어진다. 시간으로도 끊는다.
            print("\n※ 정해 둔 %d분을 다 썼다. 다음에 이어받는다." % minutes)
            break
        if budget and STATE["calls"] - start >= budget:
            print("\n※ 이번에 쓰기로 한 %d번을 다 썼다. 다시 돌리면 이어받는다." % budget)
            break
        try:
            raw, total = fetch_site(sig, cd, bun, ji)
        except Exception as exc:                     # noqa: BLE001
            # 서버가 잠깐 안 준 것(빈 본문·503·429)을 '이 단지는 자료가 없다'로
            # 적어 두면 영영 다시 묻지 않는다. 그런 건 아무것도 안 적고 넘긴다 —
            # 다음에 돌릴 때 자연히 다시 시도된다.
            later += len(group)
            continue

        blds = by_building(raw)
        for c in group:
            k = "%s|%s|%s" % (c["gu"], c["dong"], c["name"])
            if k in store:
                continue
            b = pick(list(blds), c["name"])
            if b is None:
                store[k] = {"skip": "이름 못 맞춤"}
                bad += 1
                continue
            area, dropped = tidy(blds[b])
            if not area:
                store[k] = {"skip": "쓸 만한 면적 없음"}
                bad += 1
                continue
            store[k] = {"bld": b, "area": area, "rows": total,
                        "partial": len(raw) < total, "dropped": dropped,
                        "ho": sum(len(v) for v in blds[b].values())}
            ok += 1
        json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False)
        if ok and ok % 50 == 0:
            print("   %5d단지 · 못 맞춤 %d · 남은 호출 %s · 간격 %.2f초 · %.0f분"
                  % (ok, bad, STATE["remain"], STATE["gap"], (time.time() - t0) / 60),
                  flush=True)

    print("\n이번에 %d단지 확보 · %d단지 제외 · %d단지 미룸(서버가 안 줬다)"
          % (ok, bad, later))
    progress(cs, store)
    print("호출 %d번 · 429 %d번 · 오늘 남은 %s/%s · %.0f분"
          % (STATE["calls"] - start, STATE["throttled"], STATE["remain"],
             STATE["limit"], (time.time() - t0) / 60))
    return store


# ── 굽기 ───────────────────────────────────────────────────────────────────
HEADER = """// 단지별 전용면적 -> 공급(분양)면적. tools/fetch_supply.py가 굽는다 — 손대지 마라.
//
// 실거래 자료에는 전용면적만 온다. 그런데 고객이 말하는 "34평"은 분양 평수라,
// 대시보드는 전용면적을 전용률로 나눠 분양면적을 어림한다. 전용률은 단지마다
// 71~77%%로 갈려서 고정값을 쓰면 한 평씩 틀린다. 그래서 건축물대장에서 호별
// 전유면적과 주거공용면적을 받아 더한 값을 여기 적어 두고 그대로 쓴다.
// 화면에도 '실제'라고 밝힌다.
//
//     공급면적 = 전유면적 + 주거공용면적
//
// 키는 "자치구|법정동|단지명"(실거래 표기 그대로), 값은 { 전용면적: 공급면적 }.
// 전용면적은 0.06㎡ 안에서 가장 가까운 것을 찾으므로 소수점을 딱 맞출 필요는 없다.
// "_ratio": 0.76 처럼 적으면 그 단지 전용률로 어림한다(이때는 '실제'를 안 붙인다).
//
// 옛날 대장은 주거공용 등재가 부실해서(여의도 대교 1975년은 전유 117.36㎡에
// 주거공용이 '대피호' 9.02㎡뿐이다) 전용률이 90%%대로 나오기도 한다. 계산은
// 맞지만 공급면적이 아니다. 그런 값은 여기 안 적고 평균 전용률로 어림한다.
//
// 손으로 확인한 값은 tools/supply_manual.json에 두면 대장값보다 우선한다.
//
// %(when)s 기준 — %(n)d개 단지, %(t)d개 평형.
"""


def write(store):
    """supply.js를 굽는다.

    손으로 확인한 값(tools/supply_manual.json)은 대장값을 덮어쓴다. 그 값이 왜
    그런지는 _note에 적혀 있고, 여기서 주석으로 옮겨 적는다 — 근거가 자료와
    떨어져 굴러다니면 다음 사람이 되짚을 수가 없다.

    믿을 만한지는 받을 때가 아니라 여기서 다시 가린다. 걸러내는 기준이 바뀌어도
    받아 둔 자료(.cache/supply-raw-v1.json)는 그대로 두고 다시 구우면 되기
    때문이다. 하루 1만 번짜리 한도를 다시 쓸 일이 없다.
    """
    hand = json.load(open(HAND, encoding="utf-8")) if os.path.exists(HAND) else {}
    out, notes = {}, {}
    cut = 0
    for k, v in store.items():
        if v.get("skip") or not v.get("area"):
            continue
        good = {a: s for a, s in v["area"].items() if believable(float(a), s)}
        cut += len(v["area"]) - len(good)
        if good:
            out[k] = good
    for k, v in hand.items():                        # 손으로 확인한 값이 언제나 이긴다
        out[k] = dict(v.get("area") or v)
        if v.get("_note"):
            notes[k] = v["_note"]

    body = ["window.APT_SUPPLY = {"]
    keys = sorted(out)
    for i, k in enumerate(keys):
        for line in notes.get(k, []):
            body.append("  // " + line)
        ks = sorted(out[k], key=lambda x: (x.startswith("_"),
                                           0 if x.startswith("_") else float(x)))
        pairs = ", ".join('"%s": %s' % (a, out[k][a]) for a in ks)
        body.append('  "%s": {%s}%s' % (k, pairs, "" if i == len(keys) - 1 else ","))
    body.append("};")
    txt = (HEADER % {"when": time.strftime("%Y-%m-%d"), "n": len(out),
                     "t": sum(len(v) for v in out.values())}) + "\n".join(body) + "\n"
    open(OUT, "w", encoding="utf-8", newline="\n").write(txt)
    print("supply.js — %d개 단지, %d개 평형, %.0fKB (못 믿을 평형 %d개는 뺐다)"
          % (len(out), sum(len(v) for v in out.values()),
             len(txt.encode("utf-8")) / 1024, cut))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=None, help="이번에 쓸 호출 수")
    ap.add_argument("--minutes", type=int, default=None, help="이번에 쓸 시간(분)")
    ap.add_argument("--write", action="store_true", help="받지 않고 supply.js만 다시 굽는다")
    ap.add_argument("--gu", default="", help="이 자치구만 받는다(쉼표로 여럿)")
    a = ap.parse_args()
    if a.write:
        write(json.load(open(STORE, encoding="utf-8")))
        return
    only = [g.strip() for g in a.gu.split(",") if g.strip()]
    write(collect(a.budget, a.minutes, only))


if __name__ == "__main__":
    main()
