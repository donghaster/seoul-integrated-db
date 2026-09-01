/* ════════════════════════════════════════════════════════════════════
   아파트 대시보드 — 서울 25개 자치구 전역
   데이터: window.APT_DATA (../data/apt.js), window.GEO_COORDS (../data/geo.js)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var D = window.APT_DATA;
  var GEO = window.GEO_COORDS || {};
  if (!D) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      '<section class="card-section"><h2>데이터를 불러오지 못했습니다</h2>' +
      '<p class="sec-desc">data/apt.js가 없습니다. <code>py tools/fetch_molit.py</code> 후 <code>py tools/build_data.py</code>를 실행하세요.</p></section>');
    return;
  }
  window.DASH_DATA = D;   // brand.js가 조회시각 표시에 쓴다

  var ALL = "all";
  var TYPES = ["sale", "jeonse", "wolse"];
  var TYPE_LABEL = { sale: "매매", jeonse: "전세", wolse: "월세(환산)" };
  var TYPE_COLOR = { sale: "#4f7fe6", jeonse: "#4fada8", wolse: "#cf9a45" };
  var PYEONG = 3.3058;

  /* ── 상태 ── */
  var state = {
    gu: ALL, dong: ALL,
    start: "", end: "",            // 조회 시작·종료일(자유 선택)
    gran: "month",                 // 집계 단위: week | month
    dealType: "sale",
    cmpOn: { sale: true, jeonse: true, wolse: true },
    volRank: "gu",
  };

  /* ════════════════ 원본 실거래 풀기 ════════════════
     apt.js는 이제 집계본이 아니라 원본을 담고 있다. 한 번 풀어 두고
     지역별 색인을 만들어, 아무 기간·아무 단위로나 그때그때 계산한다. */

  var DEALS = [];                  // {t, gu, dg, n, d, a, f, y, v, r}
  var BY_REGION = {};              // "all" / "구" / "구|동" -> 거래 배열
  var DATA_START = "", DATA_END = "";

  (function decodeDeals() {
    var enc = D.deals;
    if (!enc) return;
    var base = new Date(enc.base + "T00:00:00").getTime();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    var regionOfIdx = enc.regions.map(function (k) {
      var p = k.split("|");
      return { gu: p[0], dg: p[1] || "" };
    });

    for (var i = 0; i < enc.rows.length; i++) {
      var r = enc.rows[i];
      var dt = new Date(base + r[3] * 86400000);
      var ds = dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
      var reg = regionOfIdx[r[1]];
      var row = {
        t: enc.types[r[0]], gu: reg.gu, dg: reg.dg, n: enc.names[r[2]] || "(단지명 미상)",
        d: ds, a: r[4], f: r[5], y: r[6] || 0, v: r[7], r: r.length > 8 ? r[8] : 0,
      };
      DEALS.push(row);
      if (!DATA_START || ds < DATA_START) DATA_START = ds;
      if (!DATA_END || ds > DATA_END) DATA_END = ds;

      (BY_REGION[ALL] = BY_REGION[ALL] || []).push(row);
      (BY_REGION[reg.gu] = BY_REGION[reg.gu] || []).push(row);
      if (reg.dg) {
        var k2 = reg.gu + "|" + reg.dg;
        (BY_REGION[k2] = BY_REGION[k2] || []).push(row);
      }
    }
  })();

  // 조회 가능한 마지막 날은 "자료를 받은 날"로 둔다. 마지막 거래일로 잡으면
  // 신고가 며칠 밀린 만큼 기간이 짧아져 다른 대시보드와 건수가 어긋난다.
  if (D.today && D.today > DATA_END) DATA_END = D.today;


  /* ════════════════ 단지 찾아보기 ════════════════
     TOP10에 없는 단지를 고객이 물어볼 때를 위한 계층.
     조회 기간과 무관하게 자료 전체(12개월)를 쓴다 — 기간을 좁히면
     대부분의 단지가 표본 부족이 돼 아무 말도 못 하게 된다. */

  var APT_KEYS = [];               // "구|동|단지" 목록
  var BY_APT = {};                 // "구|동|단지" -> { gu, dg, n, y, deals[] }

  (function buildAptIndex() {
    for (var i = 0; i < DEALS.length; i++) {
      var x = DEALS[i];
      if (!x.dg || !x.n) continue;
      var k = x.gu + "|" + x.dg + "|" + x.n;
      var a = BY_APT[k];
      if (!a) {
        a = BY_APT[k] = { key: k, gu: x.gu, dg: x.dg, n: x.n, y: 0, deals: [] };
        APT_KEYS.push(k);
      }
      if (x.y && x.y > a.y) a.y = x.y;
      a.deals.push(x);
    }
    APT_KEYS.sort();
  })();

  /* 검색 — 이름에 들어가면 잡고, 앞에서 맞을수록 위로 */
  function searchApt(q, limit) {
    q = (q || "").replace(/\s+/g, "").toLowerCase();
    if (q.length < 1) return [];
    var hit = [];
    for (var i = 0; i < APT_KEYS.length; i++) {
      var a = BY_APT[APT_KEYS[i]];
      var nm = a.n.replace(/\s+/g, "").toLowerCase();
      var at = nm.indexOf(q);
      if (at === -1) continue;
      hit.push({ a: a, at: at, cnt: a.deals.length });
      if (hit.length > 400) break;
    }
    hit.sort(function (x, y) {
      if (x.at !== y.at) return x.at - y.at;          // 앞에서 맞은 것 먼저
      return y.cnt - x.cnt;                            // 그다음 거래 많은 순
    });
    return hit.slice(0, limit || 12).map(function (x) { return x.a; });
  }

  /* 평형(전용면적)을 사람이 쓰는 단위로 묶는다. 84.97과 84.99는 같은 평형이다. */
  function areaBand(a) { return Math.round(a); }

  function bandLabel(b) {
    return b + "㎡ (" + (b / PYEONG).toFixed(0) + "평)";
  }

  /* 단지 요약 — 평형별로 나눠야 의미가 있다 */
  function aptSummary(key) {
    var a = BY_APT[key];
    if (!a) return null;
    var bands = {};
    a.deals.forEach(function (x) {
      if (!x.a) return;
      var b = areaBand(x.a);
      var g = bands[b] || (bands[b] = { b: b, sale: [], jeonse: [], wolse: [], last: "" });
      g[x.t].push(x);
      if (x.d > g.last) g.last = x.d;
    });
    var list = Object.keys(bands).map(function (k) { return bands[k]; });
    list.forEach(function (g) {
      g.n = g.sale.length + g.jeonse.length + g.wolse.length;
      g.medSale = median(g.sale.map(function (x) { return x.v; }));
      g.medJeonse = median(g.jeonse.map(function (x) { return x.v; }));
      g.medWolse = median(g.wolse.map(function (x) { return x.r; }));
      g.medDep = median(g.wolse.map(function (x) { return x.v; }));
      g.py = median(g.sale.map(pyOf).filter(Boolean));
      // 전세가율 — 같은 평형끼리 비교해야 뜻이 있다
      g.ratio = (g.medSale && g.medJeonse) ? Math.round(g.medJeonse / g.medSale * 100) : 0;
    });
    list.sort(function (x, y) { return y.n - x.n; });
    return {
      apt: a,
      bands: list,
      cnt: {
        sale: a.deals.filter(function (x) { return x.t === "sale"; }).length,
        jeonse: a.deals.filter(function (x) { return x.t === "jeonse"; }).length,
        wolse: a.deals.filter(function (x) { return x.t === "wolse"; }).length,
      },
      last: a.deals.reduce(function (m, x) { return x.d > m ? x.d : m; }, ""),
    };
  }


  /* ── 전세가율 ──
     전세 신고가 없는 평형에 "얼마쯤 하느냐"를 답하려면 기준이 필요하다.
     같은 단지·같은 평형에서 매매·전세가 각 3건 이상인 곳만 모아 비율을 구하고,
     동 -> 구 -> 서울 순으로 표본이 찰 때까지 넓힌다.

     연식으로 나누는 이유: 재건축을 앞둔 구축은 매매가가 앞서가 전세가율이
     눌리고, 신축은 전세가 함께 높다. 섞으면 둘 다 틀린다. */

  var RATIO_MIN = 8;               // 이 표본은 넘어야 범위를 말한다

  function eraOf(y) {
    if (!y) return "?";
    return y >= 2020 ? "신축" : (y >= 2010 ? "준신축" : "구축");
  }

  var RATIOS = {};                 // "동|연식" / "구|연식" / "구" / "서울|연식" -> [비율…]

  (function buildRatios() {
    var bag = {};
    for (var i = 0; i < DEALS.length; i++) {
      var x = DEALS[i];
      if (x.t === "wolse" || !x.a || !x.dg) continue;
      var k = x.gu + "|" + x.dg + "|" + x.n + "|" + Math.round(x.a);
      var b = bag[k] || (bag[k] = { s: [], j: [], gu: x.gu, dg: x.dg, y: 0 });
      (x.t === "sale" ? b.s : b.j).push(x.v);
      if (x.y > b.y) b.y = x.y;
    }
    var push = function (k, v) { (RATIOS[k] = RATIOS[k] || []).push(v); };
    Object.keys(bag).forEach(function (k) {
      var b = bag[k];
      if (b.s.length < 3 || b.j.length < 3) return;
      var ms = median(b.s), mj = median(b.j);
      if (!ms || !mj) return;
      var r = mj / ms * 100;
      var e = eraOf(b.y);
      push(b.gu + "|" + b.dg + "|" + e, r);
      push(b.gu + "|" + e, r);
      push(b.gu, r);
      push("서울|" + e, r);
      push("서울", r);
    });
    Object.keys(RATIOS).forEach(function (k) {
      RATIOS[k].sort(function (a, b2) { return a - b2; });
    });
  })();

  function quart(v, p) { return v[Math.min(v.length - 1, Math.floor(v.length * p))]; }

  /* 가장 좁으면서 표본이 찬 기준을 고른다 */
  function jeonseRatio(gu, dg, y) {
    var e = eraOf(y);
    var tries = [
      { k: gu + "|" + dg + "|" + e, basis: dg + " " + e },
      { k: gu + "|" + e, basis: gu + " " + e },
      { k: gu, basis: gu + " 전체" },
      { k: "서울|" + e, basis: "서울 " + e },
      { k: "서울", basis: "서울 전체" },
    ];
    for (var i = 0; i < tries.length; i++) {
      var v = RATIOS[tries[i].k];
      if (v && v.length >= RATIO_MIN) {
        return {
          lo: Math.round(quart(v, 0.25)), mid: Math.round(quart(v, 0.5)),
          hi: Math.round(quart(v, 0.75)), n: v.length, basis: tries[i].basis,
        };
      }
    }
    return null;
  }

  /* 두 좌표 사이 거리(m) — 서울 안이라 평면 근사로 충분하다 */
  function distM(c1, c2) {
    var dy = (c1.lat - c2.lat) * 111000;
    var dx = (c1.lng - c2.lng) * 111000 * Math.cos(c1.lat * Math.PI / 180);
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }

  /* 유사 단지 — "가까이 · 비슷한 연식 · 같은 평형" 순으로 점수를 매긴다.
     고객께 "이 단지는 자료가 없으니 옆 단지로 보시죠"라고 말할 근거가 돼야
     하므로, 왜 비슷한지를 함께 돌려준다. */
  function similarApts(key, band, want) {
    var me = BY_APT[key];
    if (!me) return [];
    var myC = coordOf(me.gu, me.dg, me.n);
    var out = [];

    for (var i = 0; i < APT_KEYS.length; i++) {
      var k = APT_KEYS[i];
      if (k === key) continue;
      var o = BY_APT[k];
      if (o.gu !== me.gu) continue;                    // 같은 자치구 안에서만

      // 같은 평형대 거래가 있어야 비교가 된다 (±2㎡)
      var sameBand = o.deals.filter(function (x) {
        return x.a && Math.abs(areaBand(x.a) - band) <= 2;
      });
      var saleN = sameBand.filter(function (x) { return x.t === "sale"; }).length;
      if (sameBand.length < 3) continue;

      var oc = coordOf(o.gu, o.dg, o.n);
      var dist = (myC && oc) ? distM(myC, oc) : null;
      if (dist != null && dist > 2000) continue;       // 2km 넘으면 "인근"이 아니다

      var ageGap = (me.y && o.y) ? Math.abs(me.y - o.y) : null;

      // 점수: 가까울수록 · 연식 비슷할수록 · 같은 평형 표본 많을수록
      var sc = 0;
      sc += dist == null ? 30 : Math.max(0, 60 - dist / 40);       // 0~60
      sc += ageGap == null ? 10 : Math.max(0, 25 - ageGap * 2.5);  // 0~25
      sc += Math.min(15, saleN * 2);                                // 0~15
      if (o.dg === me.dg) sc += 12;                                 // 같은 법정동 가산

      out.push({
        apt: o, dist: dist, ageGap: ageGap, score: sc,
        rows: sameBand, saleN: saleN,
        py: median(sameBand.filter(function (x) { return x.t === "sale"; }).map(pyOf).filter(Boolean)),
        medSale: median(sameBand.filter(function (x) { return x.t === "sale"; }).map(function (x) { return x.v; })),
        medJeonse: median(sameBand.filter(function (x) { return x.t === "jeonse"; }).map(function (x) { return x.v; })),
      });
    }

    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, want || 4);
  }

  /* ════════════════ 포맷 유틸 ════════════════ */

  function eokman(man) {
    // 32000(만원) -> "3억 2,000만원"
    if (!man && man !== 0) return "-";
    var eok = Math.floor(man / 10000);
    var rest = Math.round(man % 10000);
    if (eok && rest) return eok + "억 " + rest.toLocaleString() + "만원";
    if (eok) return eok + "억";
    return rest.toLocaleString() + "만원";
  }

  function eokShort(man) { return (man / 10000).toFixed(1) + "억"; }

  function priceText(row, type) {
    if (type === "wolse") return "보 " + eokman(row.v) + " / 월 " + (row.r || 0).toLocaleString() + "만원";
    return eokman(row.v);
  }

  function convValue(row, type) {
    return type === "wolse" ? row.v + (row.r || 0) * 100 : row.v;
  }

  function areaText(a) {
    return a.toFixed(2) + "㎡ (" + (a / PYEONG).toFixed(1) + "평)";
  }

  function pyText(row, type) {
    if (!row.a) return "-";
    return Math.round(convValue(row, type) / (row.a / PYEONG)).toLocaleString() + "만원";
  }

  function dateText(d) { return d.replace(/-/g, "."); }

  /* esc() / pctText()는 아래 렌더 구역에 이미 정의되어 있다(함수 선언은 끌어올려짐) */

  /* ════════════════ 기간 ════════════════ */

  function clampDate(v) {
    if (!v) return DATA_END;
    return v < DATA_START ? DATA_START : (v > DATA_END ? DATA_END : v);
  }

  function periodLabel() {
    return state.start.replace(/-/g, ".") + " ~ " + state.end.replace(/-/g, ".");
  }

  function win() { return { label: periodLabel() }; }

  /* 거래가 속할 구간 키 (주간은 월요일 시작) */
  function bucketKey(dateStr) {
    if (state.gran === "month") return dateStr.slice(0, 7);
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function bucketList() {
    var out = [], p = function (n) { return n < 10 ? "0" + n : "" + n; };
    var last = new Date(state.end + "T00:00:00");
    if (state.gran === "month") {
      var cur = new Date(state.start + "T00:00:00");
      cur.setDate(1);
      while (cur <= last) {
        out.push(cur.getFullYear() + "-" + p(cur.getMonth() + 1));
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      var c2 = new Date(bucketKey(state.start) + "T00:00:00");
      while (c2 <= last) {
        out.push(c2.getFullYear() + "-" + p(c2.getMonth() + 1) + "-" + p(c2.getDate()));
        c2.setDate(c2.getDate() + 7);
      }
    }
    return out;
  }

  function bucketLabels() {
    return bucketList().map(function (k) {
      return state.gran === "month" ? k.slice(2).replace("-", ".") : k.slice(5).replace("-", "/");
    });
  }

  /* ════════════════ 집계 ════════════════ */

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  }

  function convOf(x) { return x.t === "wolse" ? x.v + (x.r || 0) * 100 : x.v; }
  function pyOf(x) { return x.a ? convOf(x) / (x.a / PYEONG) : null; }

  /* 지역별 배열을 날짜순으로 한 번만 정렬해 두면, 기간 자르기를 이진 탐색으로 끝낼 수 있다.
     서울 전체(30만 건)를 매번 훑으면 조작할 때마다 1초씩 걸린다. */
  var _sorted = {};

  function sortedOf(key) {
    if (_sorted[key]) return _sorted[key];
    var arr = (BY_REGION[key] || []).slice().sort(function (a, b) {
      return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0);
    });
    _sorted[key] = arr;
    return arr;
  }

  function lowerBound(arr, d) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var m = (lo + hi) >> 1;
      if (arr[m].d < d) lo = m + 1; else hi = m;
    }
    return lo;
  }

  function dealsIn(key) {
    var arr = sortedOf(key);
    var from = lowerBound(arr, state.start);
    var to = lowerBound(arr, state.end + "~");   // end 당일까지 포함
    return arr.slice(from, to);
  }

  /* 같은 단지·평형이 표를 다 잡아먹지 않도록 최대 3건까지만.
     30만 건을 통째로 정렬하면 조작할 때마다 몇 초씩 걸리므로,
     한 번만 훑으면서 상위 후보 CAND개만 들고 간다(전체 정렬 없이). */
  var CAND = 200;
  /* 표에 담는 순위 수. 화면에는 10행만 보이고 나머지는 펼쳐서 본다.
     차트는 여전히 10위까지만 쓴다 — 막대 30개는 읽을 수 없다. */
  var TOP_N = 30;

  function pickTop(rows, score) {
    var best = [];                 // 점수 내림차순으로 유지되는 짧은 배열
    var floor = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      var sc = score(rows[i]);
      if (sc == null) continue;
      if (best.length >= CAND && sc <= floor) continue;
      var lo = 0, hi = best.length;
      while (lo < hi) {            // 삽입 위치를 이진 탐색
        var m = (lo + hi) >> 1;
        if (best[m].s > sc) lo = m + 1; else hi = m;
      }
      best.splice(lo, 0, { s: sc, r: rows[i] });
      if (best.length > CAND) best.pop();
      floor = best[best.length - 1].s;
    }
    var picked = [], seen = {};
    for (var j = 0; j < best.length && picked.length < TOP_N; j++) {
      var r = best[j].r, k = r.n + "|" + Math.round(r.a);
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 3) continue;
      picked.push(r);
    }
    return picked;
  }

  var _cache = {};
  var _countCache = {};

  /* 순위표·법정동 칩처럼 "건수와 중위값만" 필요한 곳에서 쓴다.
     여기서 전체 집계(TOP10·상승률)를 돌리면 지역 수만큼 곱해져 몇 초씩 걸린다. */
  function countRegion(key) {
    var ck = key + "@" + state.start + "~" + state.end;
    if (_countCache[ck]) return _countCache[ck];
    var rows = dealsIn(key);
    var cnt = { sale: 0, jeonse: 0, wolse: 0 };
    var saleP = [];
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i];
      cnt[x.t]++;
      if (x.t === "sale" && x.a) saleP.push(pyOf(x));
    }
    var res = { cnt: cnt, med: { pyeong: median(saleP) } };
    _countCache[ck] = res;
    return res;
  }

  function computeRegion(key) {
    var ck = key + "@" + state.start + "~" + state.end;
    if (_cache[ck]) return _cache[ck];

    var rows = dealsIn(key);
    var by = { sale: [], jeonse: [], wolse: [] };
    for (var i = 0; i < rows.length; i++) by[rows[i].t].push(rows[i]);

    var saleP = [];
    for (var j = 0; j < by.sale.length; j++) {
      var p = pyOf(by.sale[j]);
      if (p) saleP.push(p);
    }

    var res = {
      top: {}, topPy: {},
      cnt: { sale: by.sale.length, jeonse: by.jeonse.length, wolse: by.wolse.length },
      med: {
        sale: median(by.sale.map(function (x) { return x.v; })),
        jeonse: median(by.jeonse.map(function (x) { return x.v; })),
        wolse: median(by.wolse.map(function (x) { return x.r; })),
        pyeong: median(saleP),
      },
    };
    TYPES.forEach(function (t) {
      res.top[t] = pickTop(by[t], convOf);
      res.topPy[t] = pickTop(by[t].filter(function (x) { return x.a; }), pyOf)
        .map(function (x) {
          return { t: x.t, gu: x.gu, dg: x.dg, n: x.n, d: x.d, a: x.a, f: x.f,
                   y: x.y, v: x.v, r: x.r, py: Math.round(pyOf(x)) };
        });

    });

    _cache[ck] = res;
    return res;
  }

  var _riseCache = {};

  /* 상승률은 단지별로 묶어야 해서 무겁다 — 실제로 볼 때만 계산한다 */
  function riseOf(key, type) {
    var ck = key + "|" + type + "@" + state.start + "~" + state.end;
    if (_riseCache[ck]) return _riseCache[ck];
    var rows = dealsIn(key).filter(function (x) { return x.t === type; });
    var out = computeRise(rows);
    _riseCache[ck] = out;
    return out;
  }

  function computeRise(rows) {
    if (!rows.length) return [];
    var lo = new Date(state.start + "T00:00:00").getTime();
    var hi = new Date(state.end + "T00:00:00").getTime();
    var mid = new Date(lo + (hi - lo) / 2);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    var midStr = mid.getFullYear() + "-" + p(mid.getMonth() + 1) + "-" + p(mid.getDate());

    var early = {}, late = {};
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i], v = pyOf(x);
      if (!v) continue;
      var bag = x.d < midStr ? early : late;
      (bag[x.n] = bag[x.n] || []).push(v);
    }
    var out = [];
    Object.keys(early).forEach(function (n) {
      if (!late[n]) return;
      var a = median(early[n]), b = median(late[n]);
      if (!a || !b) return;
      out.push({ n: n, before: a, after: b, rate: (b - a) / a * 100,
                 cnt: early[n].length + late[n].length });
    });
    out.sort(function (x, y) { return y.rate - x.rate; });
    return out.slice(0, TOP_N);
  }

  /* 구간별 중위 평당가 시계열 — 가격지수용.
     값만이 아니라 "그 구간에 몇 건이, 어느 단지가" 있었는지도 함께 돌려준다.
     한두 건짜리 구간이 지수를 50%씩 흔들기 때문에, 이 정보 없이는 그래프를
     시세 흐름으로 잘못 읽게 된다. */
  function pyStats(key, type) {
    var rows = dealsIn(key), bag = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].t !== type) continue;
      var v = pyOf(rows[i]);
      if (!v) continue;
      var k = bucketKey(rows[i].d);
      (bag[k] = bag[k] || []).push(rows[i]);
    }
    return bucketList().map(function (k) {
      var g = bag[k];
      if (!g) return { v: null, n: 0, names: [], hot: null };
      var cnt = {}, names = [];
      g.forEach(function (x) {
        if (!cnt[x.n]) names.push(x.n);
        cnt[x.n] = (cnt[x.n] || 0) + 1;
      });
      // 한 단지가 그 구간을 좌우하면 중위값은 사실상 그 단지 값이 된다
      var best = null;
      names.forEach(function (nm) { if (!best || cnt[nm] > best[1]) best = [nm, cnt[nm]]; });
      names.sort(function (a, b) { return cnt[b] - cnt[a]; });
      return {
        v: median(g.map(pyOf)),
        n: g.length,
        names: names,
        hot: (best && g.length >= MIN_N && best[1] / g.length >= 0.3) ? best : null,
      };
    });
  }

  function pySeries(key, type) {
    return pyStats(key, type).map(function (x) { return x.v; });
  }

  var MIN_N = 10;   // 이 건수는 넘어야 "흐름"을 말할 수 있다

  /* ── 전월세 구조 ──
     환산보증금만 보면 "월세가 올랐다"고 잘못 읽는다. 보증금을 올리고 월세를
     낮춘 준전세로 옮겨간 것도 환산보증금은 똑같이 올려 놓기 때문이다.
     구분은 한국부동산원 공식 기준을 따른다. */
  function rentKind(x) {
    if (!x.r) return "junjeonse";                 // 월세 0 = 사실상 전세
    if (x.v <= x.r * 12) return "wolse";          // 순수 월세
    if (x.v <= x.r * 240) return "junwolse";      // 준월세
    return "junjeonse";                            // 준전세(반전세)
  }

  /* 월 단위 상담 브리핑 — 조회 기간을 달로 잘라 유형별 핵심 수치를 낸다 */
  function monthlyBrief(key) {
    var rows = dealsIn(key), bag = {};
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i].d.slice(0, 7);
      (bag[m] = bag[m] || []).push(rows[i]);
    }
    return Object.keys(bag).sort().map(function (m) {
      var g = bag[m];
      var by = { sale: [], jeonse: [], wolse: [] };
      g.forEach(function (x) { by[x.t].push(x); });
      var jun = by.wolse.filter(function (x) { return rentKind(x) === "junjeonse"; }).length;
      // 한 단지의 물량이 통째로 신고되면 그 달 중위값은 그 단지 값이 된다
      var hotOf = function (arr) {
        if (arr.length < MIN_N) return null;
        var c = {}, best = null;
        arr.forEach(function (x) { c[x.n] = (c[x.n] || 0) + 1; });
        Object.keys(c).forEach(function (k) {
          if (!best || c[k] > best[1]) best = [k, c[k]];
        });
        return best && best[1] / arr.length >= 0.3 ? best : null;
      };
      var pyOfList = function (arr) {
        var v = [];
        arr.forEach(function (x) { var p = pyOf(x); if (p) v.push(p); });
        return median(v);
      };
      return {
        m: m,
        sale: { n: by.sale.length, py: pyOfList(by.sale), hot: hotOf(by.sale),
                amt: median(by.sale.map(function (x) { return x.v; })) },
        jeonse: { n: by.jeonse.length, py: pyOfList(by.jeonse), hot: hotOf(by.jeonse),
                  dep: median(by.jeonse.map(function (x) { return x.v; })) },
        wolse: { n: by.wolse.length, py: pyOfList(by.wolse), hot: hotOf(by.wolse),
                 dep: median(by.wolse.map(function (x) { return x.v; })),
                 rent: median(by.wolse.map(function (x) { return x.r; })),
                 junRate: by.wolse.length ? jun / by.wolse.length : 0 },
      };
    });
  }

  /* 구간별 거래 건수 */
  function volSeries(key) {
    var rows = dealsIn(key), bag = {};
    for (var i = 0; i < rows.length; i++) {
      var k = bucketKey(rows[i].d);
      bag[k] = bag[k] || { sale: 0, jeonse: 0, wolse: 0 };
      bag[k][rows[i].t]++;
    }
    var ks = bucketList();
    return {
      sale: ks.map(function (k) { return bag[k] ? bag[k].sale : 0; }),
      jeonse: ks.map(function (k) { return bag[k] ? bag[k].jeonse : 0; }),
      wolse: ks.map(function (k) { return bag[k] ? bag[k].wolse : 0; }),
    };
  }

  /* ════════════════ 지역 ════════════════ */

  function regionKey() {
    if (state.gu === ALL) return ALL;
    if (state.dong === ALL) return state.gu;
    return state.gu + "|" + state.dong;
  }

  function regionLabel() {
    if (state.gu === ALL) return "서울시 전체";
    if (state.dong === ALL) return state.gu + " 전체";
    return state.gu + " " + state.dong;
  }

  function region() {
    var r = computeRegion(regionKey());
    r.vol = volSeries(regionKey());
    return r;
  }

  /* 순위표에서 다른 지역의 건수·중위값만 꺼낼 때 — 가벼운 쪽을 쓴다 */
  function regionOf(key) { return countRegion(key); }

  /* ════════════════ 조회 조건 ════════════════ */

  var guSelect = document.getElementById("guSelect");
  var dongChips = document.getElementById("dongChips");
  var startInput = document.getElementById("startDate");
  var endInput = document.getElementById("endDate");

  /* 빠른 기간 — "최근 N개월"은 달 단위로 센다(3개월 = 이번 달 포함 3개 달의 1일부터) */
  var PRESETS = [
    { k: "4w", name: "최근 4주", days: 28 },
    { k: "3m", name: "최근 3개월", months: 3 },
    { k: "6m", name: "최근 6개월", months: 6 },
    { k: "12m", name: "최근 12개월", months: 12 },
    { k: "all", name: "전체 기간" },
  ];

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  function applyPreset(k) {
    var end = new Date(DATA_END + "T00:00:00");
    var p = PRESETS.filter(function (x) { return x.k === k; })[0] || PRESETS[1];
    var start;
    if (p.k === "all") start = new Date(DATA_START + "T00:00:00");
    else if (p.days) { start = new Date(end); start.setDate(start.getDate() - p.days); }
    else start = new Date(end.getFullYear(), end.getMonth() - (p.months - 1), 1);
    state.start = clampDate(iso(start));
    state.end = clampDate(iso(end));
    state.gran = (p.k === "4w") ? "week" : "month";
    syncControls();
  }

  function syncControls() {
    startInput.value = state.start;
    endInput.value = state.end;
    startInput.min = DATA_START; startInput.max = DATA_END;
    endInput.min = DATA_START; endInput.max = DATA_END;
    document.querySelectorAll("#granTabs button").forEach(function (b2) {
      b2.classList.toggle("active", b2.dataset.g === state.gran);
    });
  }

  var windowTabs = document.getElementById("windowTabs");
  windowTabs.innerHTML = PRESETS.map(function (p) {
    return '<button data-p="' + p.k + '"' + (p.k === "3m" ? ' class="active"' : "") + ">" + p.name + "</button>";
  }).join("");
  windowTabs.addEventListener("click", function (e) {
    var b2 = e.target.closest("button[data-p]");
    if (!b2) return;
    windowTabs.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
    b2.classList.add("active");
    applyPreset(b2.dataset.p);
    renderAll();
  });

  document.querySelectorAll("#granTabs button").forEach(function (b2) {
    b2.addEventListener("click", function () {
      state.gran = b2.dataset.g;
      syncControls();
      renderAll();
    });
  });

  function onDateChange() {
    var lo = clampDate(startInput.value), hi = clampDate(endInput.value);
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    state.start = lo; state.end = hi;
    windowTabs.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
    syncControls();
    renderAll();
  }
  startInput.addEventListener("change", onDateChange);
  endInput.addEventListener("change", onDateChange);

  function fillGu() {
    guSelect.innerHTML = '<option value="all">서울시 전체</option>' +
      D.gus.map(function (g) { return '<option value="' + g + '">' + g + "</option>"; }).join("");
    guSelect.value = state.gu;
  }

  /* 법정동은 칩으로 펼친다 — 선택한 구 안에서만 */
  function fillDong() {
    if (state.gu === ALL) {
      state.dong = ALL;
      dongChips.innerHTML = '<button class="active" data-d="all">전체</button>' +
        '<span class="dim-note" style="align-self:center;margin-left:8px">자치구를 선택하면 법정동이 나옵니다</span>';
      bindDongChips();
      return;
    }
    var list = D.dongs[state.gu] || [];
    if (list.indexOf(state.dong) === -1) state.dong = ALL;
    dongChips.innerHTML = '<button' + (state.dong === ALL ? ' class="active"' : "") + ' data-d="all">전체</button>' +
      list.map(function (d) {
        return '<button' + (d === state.dong ? ' class="active"' : "") + ' data-d="' + esc(d) + '">' + esc(d) + "</button>";
      }).join("");
    bindDongChips();
  }

  function bindDongChips() {
    dongChips.querySelectorAll("button[data-d]").forEach(function (b2) {
      b2.addEventListener("click", function () {
        state.dong = b2.dataset.d;
        dongChips.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
        b2.classList.add("active");
        renderAll();
      });
    });
  }

  guSelect.addEventListener("change", function () {
    state.gu = guSelect.value;
    state.dong = ALL;
    fillDong();
    renderAll();
  });

  /* ════════════════ 핵심 요약 ════════════════ */

  function renderKpi() {
    var r = region();
    var total = r.cnt.sale + r.cnt.jeonse + r.cnt.wolse;
    document.getElementById("kpiTitle").textContent = regionLabel() + " 핵심 요약";
    document.getElementById("kpiDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b> · 국토교통부 실거래 신고 기준 총 <b>" +
      total.toLocaleString() + "건</b>";

    var box = [
      { label: "매매 거래", value: r.cnt.sale.toLocaleString() + "건", sub: "중위 매매가 " + eokman(r.med.sale) },
      { label: "전세 거래", value: r.cnt.jeonse.toLocaleString() + "건", sub: "중위 보증금 " + eokman(r.med.jeonse) },
      { label: "월세 거래", value: r.cnt.wolse.toLocaleString() + "건", sub: "중위 월세 " + (r.med.wolse || 0).toLocaleString() + "만원" },
      { label: "중위 매매 평당가", value: (r.med.pyeong || 0).toLocaleString() + "만원", sub: "매매가 ÷ (전용면적 ÷ 3.3058)" },
      { label: "전월세 중 월세 비중", value: pctText(r.cnt.wolse, r.cnt.jeonse + r.cnt.wolse), sub: "전세 " + pctText(r.cnt.jeonse, r.cnt.jeonse + r.cnt.wolse) },
    ];
    document.getElementById("kpiRow").innerHTML = box.map(function (b) {
      return '<div class="stat-box"><div class="label">' + b.label + '</div>' +
        '<div class="value">' + b.value + '</div>' +
        '<div class="sub">' + b.sub + "</div></div>";
    }).join("");

    document.getElementById("periodNote").innerHTML =
      win().label + " 기준<br />자료 갱신 <b>" + (D.today || D.builtAt || "") + "</b>";
    document.getElementById("printBanner").innerHTML =
      "<b>" + regionLabel() + "</b> 아파트 실거래 리포트 · 조회 기간 " + win().label +
      " · 자료 기준 " + (D.builtAt || "") + " · 반포114공인중개사 010-9442-2027";
  }

  function pctText(a, b) {
    if (!b) return "-";
    return Math.round((a / b) * 100) + "%";
  }

  /* ════════════════ ① 실거래가 TOP 10 ════════════════ */

  function dealRowsHtml(rows, type, clickable) {
    if (!rows.length) {
      return '<tr class="empty-row"><td colspan="7">해당 기간 · 지역에 ' + TYPE_LABEL[type] + " 실거래 신고가 없습니다.</td></tr>";
    }
    return rows.map(function (r, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      var where = (state.gu === ALL || state.dong === ALL)
        ? '<div class="rt-sub">' + r.gu + " " + r.dg + "</div>" : "";
      var name = clickable
        ? '<div class="rt-name rt-name-clickable" data-apt="' + esc(r.n) + '" data-gu="' + esc(r.gu) + '" data-dong="' + esc(r.dg) + '">📍 ' + esc(r.n) + "</div>"
        : '<div class="rt-name">' + esc(r.n) + "</div>";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        "<td>" + name + where + "</td>" +
        "<td>" + areaText(r.a) + "</td>" +
        "<td>" + (r.f ? r.f + "층" : "-") + "</td>" +
        '<td class="rt-price">' + priceText(r, type) + "</td>" +
        "<td>" + pyText(r, type) + "</td>" +
        '<td class="rt-sub">' + dateText(r.d) + "</td>" +
        "</tr>";
    }).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderDeal() {
    var r = region();
    var type = state.dealType;
    document.getElementById("dealPriceHead").textContent = type === "wolse" ? "보증금 / 월세" : "거래가";
    document.getElementById("dealBody").innerHTML = dealRowsHtml(r.top[type] || [], type, true);
    if (window.wireScrollBoxes) window.wireScrollBoxes();

    // 인쇄용 — 화면에 보이는 표 말고 나머지 두 유형도 함께 출력
    document.getElementById("dealPrintAll").innerHTML = TYPES.filter(function (t) { return t !== type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · " + TYPE_LABEL[t] + " 실거래가 TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>단지명</th><th>전용면적</th><th>층</th><th>' +
          (t === "wolse" ? "보증금 / 월세" : "거래가") + "</th><th>평당가</th><th>거래일</th></tr></thead><tbody>" +
          dealRowsHtml(r.top[t] || [], t, false) + "</tbody></table>";
      }).join("");

    document.querySelectorAll("#dealBody .rt-name-clickable").forEach(function (el, i) {
      el.addEventListener("click", function () {
        focusApt(el.dataset.gu, el.dataset.dong, el.dataset.apt, i);
      });
    });
  }

  document.querySelectorAll("#dealTypeTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#dealTypeTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.dealType = b.dataset.t;
      renderDeal();
      renderMap();
    });
  });

  /* ════════════════ ② 매매·전세·월세 가격비교 ════════════════ */

  var cmpRankChart = null, cmpMonthChart = null;

  function renderCompare() {
    var r = region();
    var labels = ["1위", "2위", "3위", "4위", "5위", "6위", "7위", "8위", "9위", "10위"];

    var rankSets = TYPES.map(function (t) {
      var rows = r.top[t] || [];
      return {
        label: TYPE_LABEL[t],
        _type: t,
        data: labels.map(function (_, i) {
          return rows[i] ? +(convValue(rows[i], t) / 10000).toFixed(2) : null;
        }),
        borderColor: TYPE_COLOR[t],
        backgroundColor: TYPE_COLOR[t] + "33",
        borderWidth: 2.5,
        pointRadius: 3.5,
        tension: 0.3,
        spanGaps: true,
        hidden: !state.cmpOn[t],
      };
    });

    var opts = {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
        title: { display: true, text: regionLabel() + " · TOP10 순위별 가격 (억원)", font: { size: 13, weight: "bold" } },
        tooltip: {
          callbacks: {
            label: function (c) {
              var t = c.dataset._type;
              var row = (r.top[t] || [])[c.dataIndex];
              if (!row) return c.dataset.label + ": -";
              return c.dataset.label + " " + c.parsed.y + "억 — " + row.n + " " + row.a + "㎡";
            },
          },
        },
      },
      scales: { y: { beginAtZero: true, title: { display: true, text: "억원" } } },
    };

    if (cmpRankChart) cmpRankChart.destroy();
    cmpRankChart = new Chart(document.getElementById("cmpRankChart"), {
      type: "line", data: { labels: labels, datasets: rankSets }, options: opts,
    });

    // 거래 구간 재배치 — TOP10 거래가 실제로 어느 구간에 있었는지
    var months = bucketList();
    var monthLabels = bucketLabels();
    var monthSets = TYPES.map(function (t) {
      var rows = (r.top[t] || []).slice(0, 10);   // 차트는 TOP10만
      var bucket = {};
      rows.forEach(function (row) {
        var ym = bucketKey(row.d);
        var v = convValue(row, t) / 10000;
        if (!bucket[ym] || v > bucket[ym]) bucket[ym] = v;   // 같은 구간이면 최고가
      });
      return {
        label: TYPE_LABEL[t],
        data: months.map(function (m) { return bucket[m] != null ? +bucket[m].toFixed(2) : null; }),
        backgroundColor: TYPE_COLOR[t],
        borderColor: TYPE_COLOR[t],
        borderWidth: 1,
        hidden: !state.cmpOn[t],
      };
    });

    if (cmpMonthChart) cmpMonthChart.destroy();
    cmpMonthChart = new Chart(document.getElementById("cmpMonthChart"), {
      type: "bar",
      data: { labels: monthLabels, datasets: monthSets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: "TOP10 거래를 실제 거래월에 재배치 (그 달의 최고가, 억원)", font: { size: 13, weight: "bold" } },
        },
        scales: { y: { beginAtZero: true, title: { display: true, text: "억원" } } },
      },
    });

    // 요약 카드
    document.getElementById("cmpSummary").innerHTML = TYPES.map(function (t) {
      var rows = r.top[t] || [];
      if (!rows.length) {
        return '<div class="stat-box"><div class="label">' + TYPE_LABEL[t] + " TOP10</div>" +
          '<div class="value">-</div><div class="sub">실거래 없음</div></div>';
      }
      var top = rows[0], last = rows[rows.length - 1];
      var gap = convValue(top, t) - convValue(last, t);
      return '<div class="stat-box">' +
        '<div class="label">' + TYPE_LABEL[t] + " TOP10 최고가</div>" +
        '<div class="value" style="color:' + TYPE_COLOR[t] + '">' + eokShort(convValue(top, t)) + "</div>" +
        '<div class="sub">' + esc(top.n) + " " + top.a + "㎡ · " + dateText(top.d) + "<br />" +
        "1위–10위 격차 " + eokShort(gap) + "</div></div>";
    }).join("");
  }

  document.querySelectorAll("#compareToggle button").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.dataset.type;
      state.cmpOn[t] = !state.cmpOn[t];
      b.classList.toggle("active", state.cmpOn[t]);
      renderCompare();
    });
  });

  /* ════════════════ ③ 실거래량 ════════════════ */

  var volMonthChart = null, volDonutChart = null, volRankChart = null;

  function renderVolume() {
    var r = region();
    var labels = bucketLabels();

    if (volMonthChart) volMonthChart.destroy();
    volMonthChart = new Chart(document.getElementById("volMonthChart"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: TYPES.map(function (t) {
          return {
            label: TYPE_LABEL[t] === "월세(환산)" ? "월세" : TYPE_LABEL[t],
            data: (r.vol[t] || []).slice(),
            backgroundColor: TYPE_COLOR[t],
            borderWidth: 0,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: regionLabel() + " · 월별 실거래 건수", font: { size: 13, weight: "bold" } },
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "건" } } },
      },
    });

    if (volDonutChart) volDonutChart.destroy();
    volDonutChart = new Chart(document.getElementById("volDonutChart"), {
      type: "doughnut",
      data: {
        labels: ["매매", "전세", "월세"],
        datasets: [{ data: TYPES.map(function (t) { return r.cnt[t] || 0; }),
                     backgroundColor: TYPES.map(function (t) { return TYPE_COLOR[t]; }) }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: "거래유형 구성비", font: { size: 13, weight: "bold" } },
        },
      },
    });

    renderVolRank();
  }

  function volRankList() {
    // 선택 기간 기준으로 매번 센다(미리 구운 순위가 없으므로)
    var keys;
    if (state.volRank === "gu") {
      keys = D.gus.map(function (g) { return { k: g, label: g }; });
    } else if (state.gu === ALL) {
      keys = [];
      D.gus.forEach(function (g) {
        (D.dongs[g] || []).forEach(function (d) { keys.push({ k: g + "|" + d, label: d, gu: g }); });
      });
    } else {
      keys = (D.dongs[state.gu] || []).map(function (d) {
        return { k: state.gu + "|" + d, label: d, gu: state.gu };
      });
    }
    keys.forEach(function (x) {
      var c = countRegion(x.k).cnt;
      x.c = c.sale + c.jeonse + c.wolse;
    });
    keys.sort(function (a2, b2) { return b2.c - a2.c; });
    return keys.slice(0, TOP_N);
  }

  function renderVolRank() {
    var list = volRankList();
    var chartList = list.slice(0, 10);           // 막대는 10개까지만
    var isGu = state.volRank === "gu";
    document.getElementById("volRankHead").textContent = isGu ? "자치구" : "법정동";

    if (volRankChart) volRankChart.destroy();
    volRankChart = new Chart(document.getElementById("volRankChart"), {
      type: "bar",
      data: {
        labels: chartList.map(function (x) { return isGu ? x.label : (x.gu ? x.gu + " " + x.label : x.label); }),
        datasets: TYPES.map(function (t) {
          return {
            label: TYPE_LABEL[t] === "월세(환산)" ? "월세" : TYPE_LABEL[t],
            data: chartList.map(function (x) { return regionOf(x.k).cnt[t] || 0; }),
            backgroundColor: TYPE_COLOR[t],
            borderWidth: 0,
          };
        }),
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: {
            display: true,
            text: (isGu ? "서울 자치구별" : (state.gu === ALL ? "서울 법정동별" : state.gu + " 법정동별")) +
                  " 아파트 실거래량 TOP 10 (" + win().label + ")",
            font: { size: 13, weight: "bold" },
          },
        },
        scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: "건" } }, y: { stacked: true } },
      },
    });

    document.getElementById("volRankBody").innerHTML = list.length ? list.map(function (x, i) {
      var reg = regionOf(x.k);
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      var name = isGu ? x.label : (x.gu ? x.gu + " " + x.label : x.label);
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td class="rt-name">' + esc(name) + "</td>" +
        '<td class="rt-price">' + (x.c || 0).toLocaleString() + "건</td>" +
        "<td>" + (reg.cnt.sale || 0).toLocaleString() + "</td>" +
        "<td>" + (reg.cnt.jeonse || 0).toLocaleString() + "</td>" +
        "<td>" + (reg.cnt.wolse || 0).toLocaleString() + "</td>" +
        "<td>" + (reg.med.pyeong || 0).toLocaleString() + "만원</td>" +
        "</tr>";
    }).join("") : '<tr class="empty-row"><td colspan="7">표시할 지역이 없습니다.</td></tr>';
    if (window.wireScrollBoxes) window.wireScrollBoxes();
  }

  document.querySelectorAll("#volRankTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#volRankTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.volRank = b.dataset.r;
      renderVolRank();
    });
  });

  /* ════════════════ 지도 ════════════════ */

  var map = null, markerLayer = null, markers = {};

  function initMap() {
    map = L.map("aptMap", { scrollWheelZoom: true }).setView([37.5535, 126.9905], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  function coordOf(gu, dong, name) {
    return GEO[gu + "|" + dong + "|" + name] || null;
  }

  var nameIndex = {};          // "구|동|단지" -> 좌표키

  // 한 지점에 단지가 여럿이면 이름을 이어 붙인다
  function mapTitle(g) {
    if (g.names.length === 1) return g.names[0];
    if (g.names.length === 2) return g.names.join(" · ");
    return g.names[0] + " 외 " + (g.names.length - 1) + "곳";
  }

  var selectedKey = null;

  function markerStyle(g, on) {
    return {
      radius: (16 - g.rank) + (on ? 3 : 0),
      color: on ? "#232a38" : "#fff",
      weight: on ? 3.5 : 2.5,
      fillColor: TYPE_COLOR[state.dealType],
      fillOpacity: on ? 1 : 0.92,
    };
  }

  function selectMarker(key) {
    // 눌린 곳이 눈에 보여야 "바뀌었나?" 하지 않는다
    if (selectedKey && markers[selectedKey]) {
      markers[selectedKey].marker.setStyle(markerStyle(markers[selectedKey], false));
    }
    selectedKey = key;
    if (key && markers[key]) {
      var g = markers[key];
      g.marker.setStyle(markerStyle(g, true)).bringToFront();
    }
  }

  function renderMap() {
    if (!map) return;
    markerLayer.clearLayers();
    markers = {};
    selectedKey = null;

    var rows = (region().top[state.dealType] || []).slice(0, 10);   // 지도는 TOP10만
    var pts = [], miss = 0;

    // 같은 단지가 평형·층만 달리해 여러 번 오르면 좌표가 똑같아 마커가 겹친다.
    // 단지 단위로 묶어 하나만 찍고, 그 단지의 거래는 오른쪽에 모아 보여준다.
    var order = [];
    nameIndex = {};
    rows.forEach(function (row, i) {
      var c = coordOf(row.gu, row.dg, row.n);
      if (!c) { miss++; return; }
      // 좌표가 같으면 화면에서 겹쳐 클릭이 안 되므로 한 지점으로 묶는다
      var key = c.lat.toFixed(5) + "," + c.lng.toFixed(5);
      nameIndex[row.gu + "|" + row.dg + "|" + row.n] = key;
      if (markers[key]) {
        var g0 = markers[key];
        g0.rows.push({ row: row, rank: i });
        if (g0.names.indexOf(row.n) === -1) g0.names.push(row.n);
        return;
      }
      markers[key] = { marker: null, coord: c, rows: [{ row: row, rank: i }],
                       rank: i, name: row.n, names: [row.n] };
      order.push(key);
      pts.push([c.lat, c.lng]);
    });

    order.forEach(function (key) {
      var g = markers[key];
      var label = (g.rows.length > 1)
        ? mapTitle(g) + " (TOP10 " + g.rows.length + "건)"
        : (g.rank + 1) + "위 " + g.name;
      g.marker = L.circleMarker([g.coord.lat, g.coord.lng], markerStyle(g, false))
        .addTo(markerLayer)
        .bindTooltip(label, { direction: "top", className: "zone-tooltip" });
      g.marker.on("click", function () { selectMarker(key); showDetail(key); });
    });

    document.getElementById("mapMissNote").textContent =
      miss ? "좌표 미확인 " + miss + "곳은 지도에 표시되지 않습니다" : "";

    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    else map.setView([37.5535, 126.9905], 11);

    document.getElementById("aptDetail").innerHTML =
      '<p class="placeholder">지도의 원 또는 아래 TOP10 표의 단지명을 클릭하면<br />단지 정보가 여기에 표시됩니다.</p>';
  }

  function showDetail(key, focusRank) {
    var g = markers[key];
    if (!g) return;
    var t = state.dealType;
    var first = g.rows[0].row;

    var multi = g.names.length > 1;
    var list = g.rows.map(function (x) {
      var on = (focusRank != null && x.rank === focusRank);
      return '<tr' + (on ? ' class="is-on"' : "") + ">" +
        '<td><span class="rank-chip ' + (x.rank === 0 ? "r1" : x.rank === 1 ? "r2" : x.rank === 2 ? "r3" : "") +
          '">' + (x.rank + 1) + "</span></td>" +
        (multi ? '<td class="dl-name">' + esc(x.row.n) + "</td>" : "") +
        "<td>" + areaText(x.row.a) + "</td>" +
        "<td>" + (x.row.f ? x.row.f + "층" : "-") + "</td>" +
        '<td class="rt-price">' + priceText(x.row, t) + "</td>" +
        "<td>" + pyText(x.row, t) + "</td>" +
        '<td class="rt-sub">' + dateText(x.row.d) + "</td></tr>";
    }).join("");

    document.getElementById("aptDetail").innerHTML =
      '<span class="zone-tag" style="background:' + TYPE_COLOR[t] + '">' + TYPE_LABEL[t] +
        (g.rows.length > 1 ? " TOP10 " + g.rows.length + "건" : " " + (g.rank + 1) + "위") + "</span>" +
      "<h3>" + esc(mapTitle(g)) + "</h3>" +
      '<p class="detail-where">' + esc(first.gu) + " " + esc(first.dg) +
        (first.y ? " · " + first.y + "년 준공" : "") + "</p>" +
      '<div class="table-wrap"><table class="detail-deals"><thead><tr>' +
      "<th>순위</th>" + (multi ? "<th>단지</th>" : "") + "<th>전용면적</th><th>층</th><th>" +
      (t === "wolse" ? "보증금/월세" : "거래금액") + "</th><th>평당가</th><th>거래일</th>" +
      "</tr></thead><tbody>" + list + "</tbody></table></div>";
  }

  function focusApt(gu, dong, name, rank) {
    var key = nameIndex[gu + "|" + dong + "|" + name];
    var hit = key && markers[key];
    if (!hit) {
      document.getElementById("aptDetail").innerHTML =
        '<p class="placeholder">「' + esc(name) + "」의 좌표를 찾지 못해<br />지도에 표시할 수 없습니다.</p>";
      return;
    }
    map.flyTo([hit.coord.lat, hit.coord.lng], 16, { duration: 0.6 });
    hit.marker.openTooltip();
    selectMarker(key);
    showDetail(key, rank);
    document.getElementById("sec-map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ════════════════ 단지 찾아보기 — 화면 ════════════════ */

  var APT_MIN = 3;      // 이 건수는 넘어야 그 평형만으로 말할 수 있다

  /* 같은 자리에 이름만 조금 다른 단지가 있으면 한 단지를 나눠 신고한 것이다.
     (예: 호반써밋서초파크뷰 / 호반써밋서초파크뷰(토지임대부아파트))
     한쪽만 보고 "매매가 안 된다"고 하면 틀린 말이 된다. */
  function siblingApts(key) {
    var me = BY_APT[key];
    if (!me) return [];
    var myC = coordOf(me.gu, me.dg, me.n);
    var strip = function (x) { return x.replace(/[\s()（）]/g, "").replace(/[0-9]+동$/, ""); };
    var mine = strip(me.n);
    var out = [];
    for (var i = 0; i < APT_KEYS.length; i++) {
      var k = APT_KEYS[i];
      if (k === key) continue;
      var o = BY_APT[k];
      if (o.gu !== me.gu || o.dg !== me.dg) continue;
      var on = strip(o.n);
      if (on.indexOf(mine) !== 0 && mine.indexOf(on) !== 0) continue;
      var oc = coordOf(o.gu, o.dg, o.n);
      if (myC && oc && distM(myC, oc) > 150) continue;
      out.push({ apt: o, sale: o.deals.filter(function (x) { return x.t === "sale"; }).length });
    }
    return out;
  }

  /* 매매가 안 되거나 시세 비교가 다른 유형인지 본다.
     여기에 인근 일반단지 시세를 붙이면 고객께 틀린 값을 드리게 된다. */
  function specialKind(sum) {
    var n = sum.apt.n;
    if (/토지임대부/.test(n)) {
      return { tag: "토지임대부", why: "<b>토지임대부 주택</b>입니다. 건물만 사고 대지는 빌리는 구조라 " +
        "<b>일반 아파트 시세와 직접 비교할 수 없습니다.</b> 인근 단지 값을 그대로 갖다 붙이지 마세요." };
    }
    if (/임대|행복주택|청년주택|공공지원/.test(n)) {
      return { tag: "임대주택", why: "이름에 <b>임대</b> 표기가 있습니다. 분양이 아닌 임대 물량이면 " +
        "<b>매매 자체가 안 되는 것이 정상</b>이라, 인근 단지 매매 시세를 이 단지 시세로 말씀하시면 안 됩니다." };
    }
    var rent = sum.cnt.jeonse + sum.cnt.wolse;
    if (sum.cnt.sale === 0 && rent >= 30) {
      // 같은 자리의 다른 표기 쪽에 매매가 있으면 "매매가 안 된다"가 아니다
      var sib = siblingApts(sum.apt.key).filter(function (x) { return x.sale > 0; });
      if (sib.length) {
        return { tag: "표기 분리", why: "이 이름으로는 매매 신고가 없지만, 같은 자리에 <b>" +
          sib.map(function (x) { return esc(x.apt.n) + "(매매 " + x.sale + "건)"; }).join(", ") +
          "</b>으로 따로 신고된 거래가 있습니다. <b>한 단지를 표기만 나눠 신고한 것</b>이니 " +
          "그쪽도 함께 보셔야 합니다." };
      }
      return { tag: "매매 없음", why: "전월세는 <b>" + rent.toLocaleString() + "건</b>인데 " +
        "<b>매매 신고가 한 건도 없습니다.</b> 임대주택·공공지원 민간임대처럼 " +
        "<b>매매가 안 되는 유형일 수 있으니</b> 등기부·모집공고로 반드시 확인하세요." };
    }
    return null;
  }

  (function initFinder() {
    var input = document.getElementById("aptSearch");
    var drop = document.getElementById("aptDrop");
    if (!input) return;

    document.getElementById("aptCountNote").textContent =
      "서울 " + APT_KEYS.length.toLocaleString() + "개 단지 · 자료 " +
      DATA_START.replace(/-/g, ".") + " ~ " + DATA_END.replace(/-/g, ".");

    var hits = [], cursor = -1;

    function closeDrop() { drop.hidden = true; cursor = -1; }

    function paint() {
      if (!hits.length) {
        // 조용히 닫히면 "검색이 되긴 한 건가?" 하시게 된다.
        // 입력이 있는데 결과가 없을 때만 안내를 띄우고, 지우면 닫는다.
        if (input.value.trim()) {
          drop.innerHTML = '<div class="finder-empty">' +
            "「" + esc(input.value.trim()) + "」와 일치하는 단지가 없습니다. " +
            "<b>띄어쓰기를 빼고</b> 이름의 일부만 넣어 보세요 (예: 래미안, 자이, 힐스테이트).</div>";
          drop.hidden = false;
        } else {
          closeDrop();
        }
        return;
      }
      drop.innerHTML = hits.map(function (a, i) {
        var c = { sale: 0, jeonse: 0, wolse: 0 };
        a.deals.forEach(function (x) { c[x.t]++; });
        return '<button type="button" class="finder-item' + (i === cursor ? " is-on" : "") +
          '" data-k="' + esc(a.key) + '">' +
          '<span class="fi-name">' + esc(a.n) + "</span>" +
          '<span class="fi-where">' + esc(a.gu) + " " + esc(a.dg) +
            (a.y ? " · " + a.y + "년" : "") + "</span>" +
          '<span class="fi-cnt">매매 ' + c.sale + " · 전월세 " + (c.jeonse + c.wolse) + "</span></button>";
      }).join("");
      drop.hidden = false;
    }

    function run() {
      hits = searchApt(input.value, 12);
      cursor = -1;
      paint();
    }

    input.addEventListener("input", run);
    input.addEventListener("focus", function () { if (input.value) run(); });

    input.addEventListener("keydown", function (e) {
      if (drop.hidden || !hits.length) return;
      if (e.key === "ArrowDown") { cursor = Math.min(cursor + 1, hits.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cursor = Math.max(cursor - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter") { showApt(hits[cursor < 0 ? 0 : cursor].key); closeDrop(); e.preventDefault(); }
      else if (e.key === "Escape") closeDrop();
    });

    drop.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-k]");
      if (!b) return;
      showApt(b.dataset.k);
      closeDrop();
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".finder-input")) closeDrop();
    });

    // 표·지도에서 단지를 눌렀을 때도 여기로 끌어올 수 있게 열어 둔다
    window.__showApt = showApt;
  })();

  function bandRowsHtml(sum) {
    return sum.bands.map(function (g) {
      var thin = g.sale.length < APT_MIN;
      return "<tr>" +
        "<td><b>" + bandLabel(g.b) + "</b></td>" +
        "<td>" + (g.sale.length ? g.sale.length + "건" : "-") +
          (thin && g.sale.length ? ' <span class="brief-thin">적음</span>' : "") + "</td>" +
        "<td>" + (g.medSale ? eokman(g.medSale) : "-") + "</td>" +
        "<td>" + (g.py ? Math.round(g.py).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + (g.jeonse.length ? g.jeonse.length + "건" : "-") + "</td>" +
        "<td>" + (g.medJeonse ? eokman(g.medJeonse) : "-") + "</td>" +
        "<td>" + (g.ratio ? g.ratio + "%" : "-") + "</td>" +
        "<td>" + (g.wolse.length ? g.wolse.length + "건" : "-") + "</td>" +
        "<td>" + (g.medWolse ? eokman(g.medDep) + " / " + Math.round(g.medWolse).toLocaleString() + "만원" : "-") + "</td>" +
        "</tr>";
    }).join("");
  }

  function dealListHtml(rows, type, cap) {
    var v = rows.filter(function (x) { return x.t === type; })
      .sort(function (a, b) { return a.d < b.d ? 1 : -1; }).slice(0, cap || 6);
    if (!v.length) return '<p class="placeholder">신고된 거래가 없습니다.</p>';
    return '<div class="table-wrap"><table class="detail-deals"><thead><tr>' +
      "<th>거래일</th><th>전용면적</th><th>층</th><th>" +
      (type === "wolse" ? "보증금/월세" : "금액") + "</th><th>평당가</th></tr></thead><tbody>" +
      v.map(function (x) {
        return "<tr><td>" + dateText(x.d) + "</td><td>" + areaText(x.a) + "</td>" +
          "<td>" + (x.f ? x.f + "층" : "-") + "</td>" +
          '<td class="rt-price">' + priceText(x, type) + "</td>" +
          "<td>" + pyText(x, type) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }


  /* 전세 신고가 없을 때 — 매매가에 그 지역 전세가율을 곱해 범위를 낸다 */
  function jeonseGuessHtml(sum, band) {
    var a = sum.apt;
    var q = jeonseRatio(a.gu, a.dg, a.y);
    var base = "<p class=\"placeholder\">신고된 전세 거래가 없습니다.";

    if (!q) return base + "</p>";

    var head = base + "</p>" +
      '<div class="calc-head"><span class="calc-badge">계산값</span>' +
      "실거래가 아니라 <b>유사 실거래로 계산한 값</b>입니다</div>" +
      "<p>" + esc(q.basis) + "의 실제 전세가율은 <b>" + q.lo + "~" + q.hi + "%</b>" +
      "(중위 " + q.mid + "% · 같은 단지·같은 평형에서 매매·전세가 각 3건 이상인 <b>" +
      q.n.toLocaleString() + "개 평형</b>을 짝지어 계산)입니다. 이 비율을 아래 매매가에 대본 값입니다.</p>";

    var rows = sum.bands.filter(function (g) { return g.medSale; });
    if (!rows.length) {
      return base + " 매매도 없어 계산할 기준이 없습니다. 아래 <b>인근 유사 단지</b>를 보세요.</p>";
    }

    return '<div class="calc-box">' + head + '<div class="table-wrap"><table class="detail-deals"><thead><tr>' +
      "<th>전용면적</th><th>중위 매매가</th><th>추정 전세</th><th>중위 기준</th></tr></thead><tbody>" +
      rows.map(function (g) {
        return "<tr><td>" + bandLabel(g.b) + "</td>" +
          '<td class="rt-price">' + eokman(g.medSale) + "</td>" +
          "<td><b>" + eokman(Math.round(g.medSale * q.lo / 100)) + " ~ " +
            eokman(Math.round(g.medSale * q.hi / 100)) + "</b></td>" +
          "<td>" + eokman(Math.round(g.medSale * q.mid / 100)) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "</div>" +
      '<p class="calc-foot">매매 중위값 × 전세가율입니다. 동·향·층·수리 상태에 따라 이 범위를 벗어납니다. ' +
      "<b>실거래로 확인된 값이 아니니</b> 반드시 <b>참고 범위</b>로만 말씀하세요.</p></div>";
  }

  function similarHtml(key, band) {
    var sim = similarApts(key, band, 4);
    if (!sim.length) {
      return '<p class="placeholder">같은 자치구 2km 안에 비교할 만한 단지를 찾지 못했습니다.</p>';
    }
    var me = BY_APT[key];
    return '<div class="table-wrap"><table class="detail-deals"><thead><tr>' +
      "<th>단지</th><th>거리</th><th>준공</th><th>매매</th><th>중위 매매가</th>" +
      "<th>평당가</th><th>전세</th><th>중위 보증금</th></tr></thead><tbody>" +
      sim.map(function (x) {
        return "<tr>" +
          '<td class="dl-name">' + esc(x.apt.n) +
            (x.apt.dg !== me.dg ? ' <span class="dim-note">' + esc(x.apt.dg) + "</span>" : "") + "</td>" +
          "<td>" + (x.dist == null ? "-" : (x.dist < 1000 ? x.dist + "m" : (x.dist / 1000).toFixed(1) + "km")) + "</td>" +
          "<td>" + (x.apt.y ? x.apt.y + "년" : "-") + "</td>" +
          "<td>" + (x.saleN || "-") + "</td>" +
          "<td>" + (x.medSale ? eokman(x.medSale) : "-") + "</td>" +
          "<td>" + (x.py ? Math.round(x.py).toLocaleString() + "만원" : "-") + "</td>" +
          "<td>" + x.rows.filter(function (r) { return r.t === "jeonse"; }).length + "</td>" +
          "<td>" + (x.medJeonse ? eokman(x.medJeonse) : "-") + "</td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* 금집부쌤이 고객께 바로 읽어 드릴 문장 */
  function aptScript(sum, mainBand) {
    var a = sum.apt, out = [];
    var total = sum.cnt.sale + sum.cnt.jeonse + sum.cnt.wolse;

    out.push("<b>" + esc(a.n) + "</b>는 " + esc(a.gu) + " " + esc(a.dg) + "에 있고" +
      (a.y ? " <b>" + a.y + "년 준공</b>" : "") + "입니다. " +
      "자료 기간(" + DATA_START.slice(2).replace(/-/g, ".") + "~" + DATA_END.slice(2).replace(/-/g, ".") + ") 신고된 거래는 " +
      "<b>매매 " + sum.cnt.sale + "건 · 전세 " + sum.cnt.jeonse + "건 · 월세 " + sum.cnt.wolse + "건</b>, " +
      "모두 " + total.toLocaleString() + "건입니다.");

    var sp = specialKind(sum);
    if (sp) out.push("⚠ " + sp.why);

    if (!mainBand) {
      out.push("면적이 확인되는 거래가 없어 시세를 말씀드리기 어렵습니다.");
      return out;
    }

    var g = mainBand;
    if (g.sale.length >= APT_MIN) {
      out.push("가장 거래가 많은 <b>" + bandLabel(g.b) + "</b>는 매매 " + g.sale.length + "건, " +
        "<b>중위 " + eokman(g.medSale) + "</b>(평당 " + Math.round(g.py).toLocaleString() + "만원)입니다." +
        (g.ratio ? " 전세는 중위 " + eokman(g.medJeonse) + "로 <b>전세가율 " + g.ratio + "%</b>입니다." : ""));
    } else if (g.sale.length) {
      out.push("<b>" + bandLabel(g.b) + "</b> 매매는 <b>" + g.sale.length + "건뿐</b>이라 " +
        "이것만으로 시세를 말씀드리기 어렵습니다. " +
        "가장 최근 거래는 " + dateText(g.sale[g.sale.length - 1].d) + " " +
        eokman(g.sale[g.sale.length - 1].v) + "입니다. <b>아래 인근 유사 단지</b>를 함께 보고 말씀드리겠습니다.");
    } else {
      out.push("<b>" + bandLabel(g.b) + "</b>는 <b>매매 신고가 없습니다</b>. " +
        (g.jeonse.length ? "전세는 " + g.jeonse.length + "건, 중위 " + eokman(g.medJeonse) + "입니다. " : "") +
        ((sp && sp.tag !== "표기 분리") ? "매매가 되는 물건인지부터 확인하셔야 합니다."
            : "매매 시세는 <b>아래 인근 유사 단지</b>로 가늠하셔야 합니다."));
    }

    if (!sum.cnt.jeonse && g.medSale) {
      var q = jeonseRatio(a.gu, a.dg, a.y);
      if (q) {
        out.push("<b>전세는 신고된 거래가 없습니다.</b> 아래는 실거래가 아니라 " +
          "<b>유사 실거래로 계산한 값</b>입니다 — " +
          esc(q.basis) + "에서 같은 단지·같은 평형의 매매와 전세를 짝지어 낸 전세가율이 " +
          "<b>" + q.lo + "~" + q.hi + "%</b>(중위 " + q.mid + "%, 표본 " + q.n.toLocaleString() + "개 평형)라, " +
          bandLabel(g.b) + " 매매 중위 " + eokman(g.medSale) + "에 대보면 " +
          "<b>" + eokman(Math.round(g.medSale * q.lo / 100)) + " ~ " +
          eokman(Math.round(g.medSale * q.hi / 100)) + "</b> 정도가 됩니다. " +
          "<b>실거래로 확인된 값이 아니라는 점</b>을 고객께 꼭 함께 말씀하세요.");
      }
    }

    var sim = similarApts(a.key, g.b, 4);
    if (sim.length) {
      var pys = sim.map(function (x) { return x.py; }).filter(Boolean);
      var band = pys.length ? median(pys) : 0;
      out.push("인근 <b>" + sim.length + "곳</b>(" +
        sim.map(function (x) { return esc(x.apt.n) + (x.dist != null ? " " + (x.dist < 1000 ? x.dist + "m" : (x.dist / 1000).toFixed(1) + "km") : ""); }).join(", ") +
        ")의 같은 평형대 기준으로는 " +
        (band ? "<b>평당 " + Math.round(band).toLocaleString() + "만원</b> 수준입니다. " : "매매 표본이 없습니다. ") +
        ((sp && sp.tag !== "표기 분리")
            ? "<b>다만 이 값은 일반 분양 단지 기준</b>이라 " + esc(a.n) + "에 그대로 적용하시면 안 됩니다."
            : "연식·동·향·층에 따라 차이가 나므로 <b>참고 범위</b>로만 말씀하세요."));
    }

    if (sum.cnt.sale < APT_MIN * 2) {
      out.push("<b>이 단지는 원래 손바뀜이 드뭅니다.</b> 매물이 나오면 비교 대상이 적어 " +
        "<b>호가와 실거래가 벌어지기 쉽습니다.</b> 계약 전 인근 시세를 꼭 함께 보세요.");
    }
    return out;
  }

  function showApt(key) {
    var sum = aptSummary(key);
    var host = document.getElementById("aptResult");
    if (!sum) { host.innerHTML = ""; return; }

    var a = sum.apt;
    var mainBand = sum.bands[0] || null;
    var c = coordOf(a.gu, a.dg, a.n);
    var special = specialKind(sum);

    host.innerHTML =
      '<div class="apt-card">' +
        '<div class="apt-head">' +
          "<h3>" + esc(a.n) +
            (special ? ' <span class="apt-flag">' + special.tag + "</span>" : "") + "</h3>" +
          '<p class="detail-where">' + esc(a.gu) + " " + esc(a.dg) +
            (a.y ? " · " + a.y + "년 준공" : "") +
            " · 신고 " + (sum.cnt.sale + sum.cnt.jeonse + sum.cnt.wolse).toLocaleString() + "건" +
            (sum.last ? " · 최근 " + dateText(sum.last) : "") + "</p>" +
        "</div>" +

        "<h4>평형별 시세</h4>" +
        '<div class="table-wrap"><table class="detail-deals apt-bands"><thead><tr>' +
          '<th>전용면적</th><th>매매</th><th>중위 매매가</th><th>평당가</th>' +
          '<th>전세</th><th>중위 보증금</th><th>전세가율</th><th>월세</th><th>보증금 / 월세</th>' +
        "</tr></thead><tbody>" + bandRowsHtml(sum) + "</tbody></table></div>" +

        "<h4>최근 매매</h4>" + dealListHtml(a.deals, "sale") +
        "<h4>최근 전세</h4>" +
        (sum.cnt.jeonse ? dealListHtml(a.deals, "jeonse") : jeonseGuessHtml(sum, mainBand)) +

        (special ? '<p class="thin-note"><span>' + special.why + "</span></p>" : "") +

        (mainBand ? "<h4>인근 유사 단지 <span class=\"dim-note\">" + bandLabel(mainBand.b) +
          " 기준 · 같은 자치구 2km 이내</span></h4>" + similarHtml(key, mainBand.b) : "") +

        '<div class="read-guide" style="margin-top:18px;">' +
          "<h4>금집부쌤이 보는 " + esc(a.n) + "</h4><ol>" +
          aptScript(sum, mainBand).map(function (t) { return "<li>" + t + "</li>"; }).join("") +
          "</ol></div>" +

        (c ? '<p class="dim-note">지도에서 보기: <button type="button" class="mini-btn" id="aptGoMap">' +
             "TOP10 지도로 이동</button></p>" : "") +
      "</div>";

    var go = document.getElementById("aptGoMap");
    if (go) {
      go.addEventListener("click", function () {
        focusApt(a.gu, a.dg, a.n);
      });
    }
  }

  /* ════════════════ 입지분석 ════════════════ */

  var LOC = window.APT_LOCATION || {};

  var LOC_ITEMS = [
    { k: "traffic", ico: "🚇", title: "교통·역세권", summary: "지하철 노선·환승 접근성" },
    { k: "school", ico: "🎓", title: "학군·교육", summary: "학군지·학원가 분포" },
    { k: "life", ico: "🏬", title: "생활권", summary: "상권·공원·대형마트" },
    { k: "develop", ico: "🏗️", title: "개발 호재", summary: "정비사업·광역교통" },
    { k: "data", ico: "📊", title: "데이터로 본 입지", summary: "실거래 기반 지표" },
  ];

  function renderLocation() {
    var gu = state.gu === ALL ? null : state.gu;
    document.getElementById("locTitle").textContent = (gu || "서울시 전체") + " 입지분석";
    document.getElementById("locGrid").innerHTML = LOC_ITEMS.map(function (it) {
      return '<button class="loc-card" data-k="' + it.k + '">' +
        '<div class="ico">' + it.ico + "</div>" +
        '<div class="title">' + it.title + "</div>" +
        '<div class="summary">' + it.summary + "</div></button>";
    }).join("");

    document.querySelectorAll("#locGrid .loc-card").forEach(function (b) {
      b.addEventListener("click", function () {
        var on = b.classList.contains("active");
        document.querySelectorAll("#locGrid .loc-card").forEach(function (x) { x.classList.remove("active"); });
        var box = document.getElementById("locDetail");
        if (on) { box.classList.remove("show"); return; }
        b.classList.add("active");
        box.innerHTML = locHtml(b.dataset.k);
        box.classList.add("show");
      });
    });

    var box = document.getElementById("locDetail");
    box.innerHTML = locHtml(LOC_ITEMS[0].k);
    box.classList.remove("show");
    // 인쇄용 전체 묶음은 미리 만들어 두지 않는다(학교 목록이 커서 무겁다) — 인쇄 직전에 만든다
  }

  /* 인쇄에서는 5개 항목을 모두 펼친다 — 화면에서 무엇을 열어 뒀든 상관없이 */
  function locPrintAllHtml() {
    return LOC_ITEMS.map(function (it) {
      return "<div class='loc-print-block'>" + locHtml(it.k) + "</div>";
    }).join("");
  }

  function chips(arr) {
    return '<div class="loc-chips">' + arr.map(function (t) {
      return "<span>" + t + "</span>";
    }).join("") + "</div>";
  }

  function srcNote(txt) {
    return "<p class='loc-src'>자료: " + txt + "</p>";
  }

  function locHtml(k) {
    var gu = state.gu === ALL ? null : state.gu;
    if (k === "data") return locDataHtml();

    var item = LOC_ITEMS.filter(function (x) { return x.k === k; })[0];
    if (k === "develop") return locDevelopHtml(gu, item);

    var info = (gu && LOC[gu] && LOC[gu][k]) || null;
    if (!info) {
      return "<h3>" + item.ico + " " + item.title + "</h3>" +
        "<p><b>자치구를 선택</b>하시면 그 구의 " + item.title + " 자료가 나옵니다. " +
        "(현재 선택: <b>" + (gu || "서울시 전체") + "</b>)</p>";
    }

    /* ── 교통·역세권 ── */
    if (k === "traffic") {
      var t = info;
      return "<h3>" + item.ico + " " + gu + " 교통·역세권</h3><ul>" +
        "<li>지하철역 <b>" + t.stationCount + "개</b>" +
        (t.lines.length ? " · 지나는 노선 <b>" + t.lines.length + "개</b>" : "") + "</li>" +
        (t.lines.length ? "<li>노선별 역 수 " +
          t.lines.map(function (l) { return esc(l.name) + " " + l.stations; }).join(" · ") + "</li>" : "") +
        (t.top.length ? "<li>주요 역(환승 많은 순)</li>" : "") +
        "</ul>" +
        (t.top.length ? chips(t.top.map(function (s) {
          return esc(s.name) + (s.lines.length > 1 ? " <b>환승 " + s.lines.length + "</b>" : "") +
            " <em>" + s.lines.map(esc).join("·") + "</em>";
        })) : "") +
        (t.hotspots.length
          ? "<p style='margin-top:12px'><b>실시간 혼잡도</b>(서울시 주요 장소) — " +
            t.hotspots.map(function (h) { return esc(h.name) + " " + esc(h.lvl); }).join(" · ") + "</p>"
          : "") +
        srcNote("카카오맵 지하철역 · 서울시 실시간 도시데이터");
    }

    /* ── 학군·교육 ── 소재지 기준 학교 목록. 법정동을 고르면 그 동 것만 보여준다 */
    if (k === "school") return locSchoolHtml(gu, info, item);

    /* ── 생활권 ── */
    var L = info;
    var perHouse = L.households && L.pop ? (L.pop / L.households).toFixed(2) : null;
    return "<h3>" + item.ico + " " + gu + " 생활권</h3><ul>" +
      (L.pop ? "<li>인구 <b>" + L.pop.toLocaleString() + "명</b> · 세대 <b>" +
        L.households.toLocaleString() + "세대</b>" +
        (perHouse ? " (세대당 " + perHouse + "명)" : "") +
        (L.seniorRatio ? " · 65세 이상 <b>" + L.seniorRatio + "%</b>" : "") +
        " <span class='rt-sub'>" + esc(L.popYear) + "년</span></li>" : "") +
      "<li>도시공원 <b>" + L.parkCount + "개소</b> · 상권 <b>" + L.tradeCount + "곳</b></li>" +
      "</ul>" +
      (L.parks.length ? "<p style='margin-top:10px'><b>주요 공원</b></p>" +
        chips(L.parks.map(function (p) { return esc(p.name); })) : "") +
      (L.trades.length ? "<p style='margin-top:10px'><b>주요 상권</b></p>" +
        chips(L.trades.map(function (t2) { return esc(t2.name) + " <em>" + esc(t2.cat) + "</em>"; })) : "") +
      srcNote("서울 열린데이터광장(공원·상권) · KOSIS 인구·세대");
  }

  /* ── 학군·교육 ──
     seoul dashboard의 학군 화면과 같은 방식: 법정동 필터를 그대로 따르고,
     학교 이름을 누르면 주소·전화·유형이 펼쳐진다. 배정 관련 주의도 함께 붙인다. */
  var SCHOOL_ORDER = ["초등학교", "중학교", "고등학교"];

  function schoolTag(sc) {
    var bits = [];
    if (sc.founded === "사립") bits.push("사립");
    if (sc.hsType) bits.push(sc.hsType);
    if (sc.coedu && sc.coedu !== "남여공학") bits.push(sc.coedu);
    return bits.length ? " <em>" + esc(bits.join("·")) + "</em>" : "";
  }

  function schoolDetail(sc) {
    var row = function (k, v) {
      return v ? "<div class='sd-row'><span>" + k + "</span><b>" + v + "</b></div>" : "";
    };
    var hp = sc.homepage
      ? "<a href='" + esc(sc.homepage.indexOf("http") === 0 ? sc.homepage : "http://" + sc.homepage) +
        "' target='_blank' rel='noopener'>" + esc(sc.homepage) + "</a>"
      : "";
    return row("주소", esc(sc.addr)) + row("전화", esc(sc.tel)) +
      row("고교 유형", esc(sc.hsType)) +
      row("구분", esc([sc.founded, sc.coedu].filter(Boolean).join(" · "))) +
      row("개교", sc.foundYear ? esc(sc.foundYear) + "년" : "") +
      row("홈페이지", hp) || "<div class='sd-row'><span>상세정보 없음</span></div>";
  }

  function locSchoolHtml(gu, s, item) {
    if (!s.total) {
      return "<h3>" + item.ico + " " + gu + " 학군·교육</h3><p>학교 정보를 찾지 못했습니다.</p>";
    }
    var dong = state.dong;                      // 'all' 또는 특정 법정동
    var kinds = SCHOOL_ORDER.concat(Object.keys(s.byKind).filter(function (k) {
      return SCHOOL_ORDER.indexOf(k) === -1;
    })).filter(function (k) { return s.byKind[k]; });

    var shown = 0;
    var blocks = kinds.map(function (kind) {
      var full = s.byKind[kind] || [];
      var list = dong === ALL ? full : full.filter(function (sc) { return sc.dong === dong; });
      shown += list.length;
      if (!list.length) return "";
      return "<h4 class='loc-sub'>" + esc(kind) + " (" + list.length + "개)</h4>" +
        "<div class='loc-chips school-chips'>" + list.map(function (sc) {
          return "<span class='school-item'>" +
            "<button type='button' class='school-chip'>" + esc(sc.name) + schoolTag(sc) + "</button>" +
            "<span class='school-detail' hidden>" + schoolDetail(sc) + "</span></span>";
        }).join("") + "</div>";
    }).join("");

    var scope = dong === ALL
      ? esc(gu) + " 전체 소재 학교 <b>" + s.total + "개</b>"
      : esc(gu) + " " + esc(dong) + " 소재 학교 <b>" + shown + "개</b>";
    var emptyMsg = (dong !== ALL && !shown)
      ? "<p>" + esc(dong) + "에 소재지 주소가 일치하는 학교가 없습니다(인접 동 학교를 이용할 수 있습니다).</p>" : "";

    return "<h3>" + item.ico + " " + gu + " 학군·교육</h3>" +
      "<p>" + scope + " · 학교 이름을 클릭하면 상세정보가 열립니다.</p>" +
      emptyMsg + blocks +
      "<div class='loc-caveat'>⚠️ 이 목록은 <b>학교 소재지(주소) 기준</b>이며 <b>실제 배정을 보장하지 않습니다.</b> " +
      "초등학교는 통학구역, 중·고등학교는 서울 상당수 지역에서 근거리 배정+추첨이 혼합되어 있어 " +
      "동 하나에 특정 학교가 1:1로 매칭되지 않습니다. 정확한 배정은 반드시 " +
      "<a href='https://schoolzone.emac.kr' target='_blank' rel='noopener'>학구도안내서비스</a>에서 " +
      "실제 주소로 확인하세요.</div>" +
      srcNote("NEIS 교육정보 개방포털 학교 기본정보");
  }

  /* 학교 칩 클릭 → 상세 펼치기 (목록이 매번 다시 그려지므로 위임으로 처리) */
  document.getElementById("locDetail").addEventListener("click", function (e) {
    var chip = e.target.closest(".school-chip");
    if (!chip) return;
    var item = chip.closest(".school-item");
    var detail = item.querySelector(".school-detail");
    var willOpen = detail.hidden;
    document.querySelectorAll("#locDetail .school-detail").forEach(function (d) { d.hidden = true; });
    document.querySelectorAll("#locDetail .school-chip").forEach(function (c) { c.classList.remove("is-on"); });
    detail.hidden = !willOpen;
    chip.classList.toggle("is-on", willOpen);
  });

  /* ── 개발 호재: 뉴타운 대시보드와 같은 정비사업 자료를 자치구로 걸러 보여준다 ── */
  function locDevelopHtml(gu, item) {
    var N = window.NEWTOWN_DATA;
    if (!N) return "<h3>" + item.ico + " 개발 호재</h3><p>정비사업 자료를 불러오지 못했습니다.</p>";
    if (!gu) {
      return "<h3>" + item.ico + " 개발 호재</h3>" +
        "<p><b>자치구를 선택</b>하시면 그 구의 재정비촉진지구(뉴타운)·정비사업이 나옵니다. " +
        "서울 전체에는 <b>" + N.districts.length + "개 지구</b>가 있습니다.</p>";
    }
    var list = N.districts.filter(function (d) { return d.gu === gu; });
    if (!list.length) {
      return "<h3>" + item.ico + " " + gu + " 개발 호재</h3>" +
        "<p><b>" + esc(gu) + "</b>에는 서울시가 지정한 <b>재정비촉진지구(뉴타운)가 없습니다.</b> " +
        "개별 재건축·재개발 구역은 별도 확인이 필요합니다.</p>";
    }
    var ing = list.filter(function (d) { return d.stage < 6; });
    return "<h3>" + item.ico + " " + gu + " 개발 호재</h3><ul>" +
      "<li>재정비촉진지구 <b>" + list.length + "곳</b> (사업 진행 중 <b>" + ing.length + "곳</b>)</li>" +
      "</ul>" +
      '<table class="rank-table" style="margin-top:10px">' +
      "<thead><tr><th>뉴타운</th><th>진행단계</th><th>구역</th><th>요약</th></tr></thead><tbody>" +
      list.map(function (d) {
        return "<tr><td class='rt-name'>" + esc(d.name) + "</td>" +
          "<td><span class='stage-dot' style='background:" + ntStageColor(d.stage) + "'></span>" +
          N.stages[d.stage] + "</td>" +
          "<td class='rt-sub'>" + esc(d.zones) + "</td>" +
          "<td class='rt-sub'>" + esc(d.summary) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "<p class='loc-src'>자료: 서울시 재정비촉진지구 공개자료 정리 — 자세한 구역별 진행은 " +
      "<a href='../newtown/index.html'>뉴타운 대시보드</a>에서 보실 수 있습니다. 계약 전 조합·구청 고시 확인이 필요합니다.</p>";
  }

  function ntStageColor(stage) {
    if (stage >= 6) return "#4fada8";
    if (stage >= 5) return "#4f7fe6";
    if (stage >= 2) return "#cf9a45";
    return "#bc3d3d";
  }

  /* ── 구 안에서 동의 자리 ──
     분기별 (동 중위 평당가 / 구 중위 평당가)로 낸다. 표본이 얇은 분기는 뺀다. */

  var DONG_MIN_Q = 5;              // 분기당 이 건수는 넘어야 값을 쓴다

  function quarterOf(dateStr) {
    var y = dateStr.slice(0, 4), m = parseInt(dateStr.slice(5, 7), 10);
    return y + "Q" + Math.ceil(m / 3);
  }

  function qLabel(q) { return q.slice(2, 4) + "." + q.slice(5) + "Q"; }

  // 자료가 걸쳐 있는 분기 목록(오래된 것부터)
  function quarterList() {
    var qs = {}, out = [];
    var cur = new Date(DATA_START + "T00:00:00"), last = new Date(DATA_END + "T00:00:00");
    while (cur <= last) {
      var q = cur.getFullYear() + "Q" + Math.ceil((cur.getMonth() + 1) / 3);
      if (!qs[q]) { qs[q] = 1; out.push(q); }
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  // 그 분기가 아직 진행 중인가(자료 기준일이 분기 안에 있으면)
  function isPartialQ(q) {
    var y = parseInt(q.slice(0, 4), 10), n = parseInt(q.slice(5), 10);
    var end = new Date(y, n * 3, 0);                       // 분기 마지막 날
    return end > new Date(DATA_END + "T00:00:00");
  }

  /* 지역(구 또는 구|동)의 분기별 매매 중위 평당가.
     같은 구의 동을 줄 세울 때 구 안 모든 동을 훑으므로 한 번 구한 건 남겨 둔다. */
  var _qPy = {};
  function quarterPy(key) {
    if (_qPy[key]) return _qPy[key];
    var rows = BY_REGION[key] || [], bag = {};
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i];
      if (x.t !== "sale" || !x.a) continue;
      var q = quarterOf(x.d);
      (bag[q] = bag[q] || []).push(pyOf(x));
    }
    var out = {};
    Object.keys(bag).forEach(function (q) {
      out[q] = { n: bag[q].length, py: median(bag[q]) };
    });
    _qPy[key] = out;
    return out;
  }

  var _dongCmp = {};
  function dongVsGu(gu, dong) {
    var ck = gu + "|" + dong;
    if (_dongCmp[ck]) return _dongCmp[ck];
    var guQ = quarterPy(gu), myQ = quarterPy(ck);
    var qs = quarterList();
    var series = qs.map(function (q) {
      var g = guQ[q], d = myQ[q];
      var ok = g && d && g.py && d.n >= DONG_MIN_Q;
      return { q: q, partial: isPartialQ(q), n: d ? d.n : 0,
               py: d ? d.py : 0, guPy: g ? g.py : 0,
               pct: ok ? Math.round(d.py / g.py * 100) : null };
    });
    // 같은 구의 다른 동들 — 가장 최근 '확정' 분기 기준으로 줄 세운다
    var solid = series.filter(function (x) { return x.pct != null && !x.partial; });
    var baseQ = solid.length ? solid[solid.length - 1].q : null;
    var peers = [];
    if (baseQ) {
      (D.dongs[gu] || []).forEach(function (d2) {
        var qq = quarterPy(gu + "|" + d2)[baseQ];
        var g = guQ[baseQ];
        if (!qq || !g || !g.py || qq.n < DONG_MIN_Q) return;
        peers.push({ dong: d2, pct: Math.round(qq.py / g.py * 100), n: qq.n, py: qq.py });
      });
      peers.sort(function (a, b) { return b.pct - a.pct; });
    }
    _dongCmp[ck] = { series: series, peers: peers, baseQ: baseQ };
    return _dongCmp[ck];
  }

  function dongVsGuHtml() {
    if (state.gu === ALL || state.dong === ALL) return "";
    var gu = state.gu, dong = state.dong;
    var C = dongVsGu(gu, dong);
    var usable = C.series.filter(function (x) { return x.pct != null; });
    if (usable.length < 2) {
      return '<div class="dv-box"><h3>📍 ' + esc(gu) + " 안에서 " + esc(dong) + "</h3>" +
        '<p class="placeholder">분기마다 매매 ' + DONG_MIN_Q +
        "건이 안 돼 구 안 위치를 흐름으로 보여드리기 어렵습니다. 위 <b>평당가 순위</b> 표를 쓰세요.</p></div>";
    }

    var last = usable.filter(function (x) { return !x.partial; }).pop() || usable[usable.length - 1];
    var rank = -1;
    for (var i = 0; i < C.peers.length; i++) if (C.peers[i].dong === dong) { rank = i + 1; break; }

    // 막대 — 100%가 기준선이라 위/아래가 곧 구 평균 대비다
    var peak = usable.reduce(function (m, x) { return Math.max(m, Math.abs(x.pct - 100)); }, 0) || 1;
    var bars = '<div class="dv-chart"><div class="dv-bars">' + C.series.map(function (x) {
      if (x.pct == null) {
        return '<div class="dv-col dim" title="표본 ' + x.n + '건 — 계산에서 뺐습니다">' +
          '<span class="dv-val">-</span><span class="dv-gap"></span>' +
          '<span class="dv-q">' + qLabel(x.q) + "</span></div>";
      }
      var d = x.pct - 100;
      var h = Math.max(3, Math.round(Math.abs(d) / peak * 40));
      var up = d >= 0;
      return '<div class="dv-col' + (x.partial ? " partial" : "") + '" title="' + qLabel(x.q) +
        " 매매 " + x.n + "건 · 동 " + x.py.toLocaleString() + "만원 / 구 " + x.guPy.toLocaleString() + '만원">' +
        '<span class="dv-val">' + x.pct + "%</span>" +
        '<span class="dv-bar ' + (up ? "up" : "down") + '" style="height:' + h + 'px"></span>' +
        '<span class="dv-q">' + qLabel(x.q) + (x.partial ? " *" : "") + "</span></div>";
    }).join("") + '</div><div class="dv-zero"><span>구 평균 100%</span></div></div>';

    // 흐름 한 줄 — 확정 분기만 써서 처음과 끝을 비교한다
    var solid = usable.filter(function (x) { return !x.partial; });
    var trend = "";
    if (solid.length >= 2) {
      var a = solid[0], b = solid[solid.length - 1];
      var move = b.pct - a.pct;                 // 비율 자체의 변화
      var word;
      if (Math.abs(move) < 5) {
        word = "<b>거의 그대로</b>입니다";
      } else if (b.pct >= 100) {
        // 구 평균 위에 있는 동 — 비율이 오르면 프리미엄이 커진 것
        word = move > 0 ? "<b>구 평균 대비 프리미엄이 " + move + "%p 커졌습니다</b>"
                        : "<b>구 평균 대비 프리미엄이 " + Math.abs(move) + "%p 줄었습니다</b>";
      } else {
        // 구 평균 아래 동 — 비율이 내리면 오히려 더 벌어진 것이다
        word = move > 0 ? "<b>구 평균에 " + move + "%p 다가섰습니다</b>"
                        : "<b>구 평균과의 거리가 " + Math.abs(move) + "%p 더 벌어졌습니다</b>";
      }
      trend = qLabel(a.q) + " " + a.pct + "% → " + qLabel(b.q) + " " + b.pct + "%로 " + word;
    }

    var peerLine = C.peers.length > 1
      ? '<p class="dv-peers"><b>' + qLabel(C.baseQ) + " 기준 " + esc(gu) + " 동별</b> " +
        C.peers.map(function (x) {
          return '<span class="dv-peer' + (x.dong === dong ? " me" : "") + '">' +
            esc(x.dong) + " " + x.pct + "%</span>";
        }).join("") + "</p>"
      : "";

    var speak = esc(dong) + "은 " + esc(gu) + " 평균의 <b>" + last.pct + "%</b> 수준" +
      (rank > 0 ? "으로, 구 안 " + C.peers.length + "개 동 가운데 <b>" + rank + "위</b>" : "") + "입니다. " +
      (trend ? trend + ". " : "") +
      "구 전체가 오르내려도 이 비율은 <b>동의 상대적 자리</b>를 보여줍니다.";

    return '<div class="dv-box">' +
      "<h3>📍 " + esc(gu) + " 안에서 " + esc(dong) +
        " <span class='rt-sub'>분기별 구 평균 대비</span></h3>" +
      '<div class="dv-top">' +
        '<div class="dv-kpi"><span>최근 확정 분기</span><b>' + last.pct + "%</b>" +
          '<span class="dim-note">' + qLabel(last.q) + " · 매매 " + last.n + "건</span></div>" +
        (rank > 0 ? '<div class="dv-kpi"><span>구 안 순위</span><b>' + rank + "위</b>" +
          '<span class="dim-note">' + C.peers.length + "개 동 중</span></div>" : "") +
      "</div>" + bars + peerLine +
      '<div class="lb-speak"><span class="lb-quote">첨언</span><p>&ldquo;' + speak + '&rdquo;</p></div>' +
      '<p class="lb-foot">공식 실거래가격지수는 <b>자치구 단위까지만</b> 나옵니다. ' +
        "이 표는 <b>우리 실거래로 계산</b>한 값이라 위 공식지수와 산출 방식이 다릅니다. " +
        "분기 매매 " + DONG_MIN_Q + "건 미만은 뺐고, <b>*</b>는 아직 진행 중인 분기입니다.</p>" +
      "</div>";
  }

  /* 값(중위 평당가) 순위 — 화면 표와 같은 조회 기간으로 매긴다 */
  function priceRankOf(gu) {
    var rows = D.gus.map(function (g) {
      return { g: g, py: regionOf(g).med.pyeong || 0 };
    }).filter(function (x) { return x.py; }).sort(function (a, b) { return b.py - a.py; });
    for (var i = 0; i < rows.length; i++) if (rows[i].g === gu) return { rank: i + 1, n: rows.length, py: rows[i].py };
    return null;
  }

  /* 두 순위의 조합이 곧 브리핑이다.
       비싸고 계속 오른다 / 비싼데 쉬어간다 / 저평가인데 따라붙는다 / 둘 다 조용하다 */
  function locBriefHtml() {
    var gu = state.gu === ALL ? null : state.gu;
    var pi = gu && LOC[gu] && LOC[gu].priceIndex;
    if (!pi || !pi.points || pi.points.length < 5) return "";

    var pr = priceRankOf(gu);
    if (!pr) return "";

    var R = priceIndexRank();
    var ri = -1;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].gu === gu) { ri = i; break; }
    if (ri < 0) return "";

    var yoy = R.rows[ri].yoy;
    var rRank = ri + 1, pRank = pr.rank, N = R.n;
    var gap = yoy - R.avg;
    var HI = Math.ceil(N / 3), LO = N - HI + 1;      // 상위/하위 3분의 1

    var pBand = pRank <= HI ? 0 : (pRank >= LO ? 2 : 1);      // 0 비쌈 · 1 중간 · 2 저렴
    var rBand = rRank <= HI ? 0 : (rRank >= LO ? 2 : 1);      // 0 빠름 · 1 보통 · 2 느림
    var pWord = ["비싼 편", "중간", "저렴한 편"][pBand];
    var rWord = ["빠른 편", "평균 수준", "느린 편"][rBand];

    // 값 3구간 x 상승률 3구간 — 아홉 칸을 모두 채운다
    var GRID = [
      [ // 값 상위
        ["비싸고 계속 오르는 곳",
         "이미 서울 상위권 값인데 <b>오르는 속도도 상위권</b>입니다. 수요가 계속 붙고 있다는 뜻이라, 매수를 미루실수록 부담이 커질 수 있습니다."],
        ["비싼 값을 지키는 곳",
         "서울 <b>최상위권 값</b>을 유지하면서 상승 속도는 <b>평균 수준</b>입니다. 이미 높은 자리라 급등은 어렵지만, <b>값이 잘 안 빠지는</b> 자리로 보시면 됩니다."],
        ["비싸지만 쉬어가는 곳",
         "값은 서울 상위권인데 <b>오르는 속도는 하위권</b>입니다. 이미 높은 자리에 올라와 <b>상승 여력이 제한적</b>이거나 잠시 쉬어가는 구간입니다."],
      ],
      [ // 값 중간
        ["중간값에서 빠르게 오르는 곳",
         "값은 서울 중간권인데 <b>오르는 속도는 상위권</b>입니다. <b>격차를 좁히는 중</b>이라 눈여겨보실 만합니다."],
        ["서울 평균 근처",
         "값과 상승 속도가 모두 <b>서울 중간권</b>입니다. 특별히 앞서지도 뒤처지지도 않는 흐름입니다."],
        ["중간값에서 쉬어가는 곳",
         "값은 서울 중간권인데 <b>오르는 속도는 하위권</b>입니다. 당분간 <b>큰 움직임을 기대하기 어려운</b> 구간입니다."],
      ],
      [ // 값 하위
        ["저평가에서 따라붙는 곳",
         "값은 아직 서울 하위권인데 <b>오르는 속도는 상위권</b>입니다. <b>뒤늦게 따라붙는 구간</b>이라 지금이 관심 가질 시점일 수 있습니다."],
        ["값이 낮고 완만한 곳",
         "값은 서울 하위권이고 상승 속도는 <b>평균 수준</b>입니다. <b>실거주 부담이 적으면서</b> 시세는 서울 흐름을 따라가는 자리입니다."],
        ["값도 움직임도 조용한 곳",
         "값도 서울 하위권이고 <b>오르는 속도도 하위권</b>입니다. 실거주 부담은 적지만 <b>시세 차익은 기대하기 어려운</b> 구간입니다."],
      ],
    ];
    var tag = GRID[pBand][rBand][0], story = GRID[pBand][rBand][1];

    var sign = function (v) { return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(1) + "%"; };
    var speak =
      esc(gu) + "는 서울 " + N + "개 구 가운데 <b>값은 " + pRank + "위</b>(평당 " +
      pr.py.toLocaleString() + "만원)로 " + pWord + "인데, <b>오르는 속도는 " + rRank + "위</b>(전년 대비 " +
      sign(yoy) + ")로 " + rWord + "입니다. " +
      (Math.abs(gap) < 0.5 ? "서울 평균과 비슷합니다. "
        : "25개구 평균(" + sign(R.avg) + ")보다 <b>" + Math.abs(gap).toFixed(1) + "%p " +
          (gap > 0 ? "높습니다" : "낮습니다") + "</b>. ") +
      story.replace(/<\/?b>/g, "");

    return '<div class="loc-brief">' +
      '<div class="lb-head"><span class="lb-badge">한 줄 요약</span>' + esc(gu) + " &mdash; <b>" + tag + "</b></div>" +
      '<div class="lb-grid">' +
        '<div class="lb-cell"><span class="lb-k">값 (중위 평당가)</span>' +
          '<span class="lb-v">서울 <b>' + pRank + "위</b></span>" +
          '<span class="lb-s">' + pr.py.toLocaleString() + "만원 · " + pWord + "</span></div>" +
        '<div class="lb-cell"><span class="lb-k">상승률 (공식지수)</span>' +
          '<span class="lb-v">서울 <b>' + rRank + "위</b></span>" +
          '<span class="lb-s">전년 대비 ' + sign(yoy) + " · " + rWord + "</span></div>" +
      "</div>" +
      '<p class="lb-story">' + story + "</p>" +
      '<div class="lb-speak"><span class="lb-quote">첨언</span><p>&ldquo;' + speak + '&rdquo;</p></div>' +
      '<p class="lb-foot">값 순위는 <b>선택한 조회 기간</b>의 실거래로 이 대시보드가 계산했고, ' +
        "상승률 순위는 <b>한국부동산원 공식지수</b>의 전년 동기 대비입니다. " +
        "<b>재는 것이 달라 두 순위가 어긋나는 것이 정상</b>입니다.</p>" +
      "</div>";
  }

  function locDataHtml() {
    var r = region();
    var seoul = regionOf(ALL);
    var ratio = seoul.med.pyeong ? Math.round((r.med.pyeong / seoul.med.pyeong) * 100) : 0;

    // 선택 구 안에서 평당가 상위 동
    var rows = [];
    if (state.gu !== ALL) {
      rows = (D.dongs[state.gu] || []).map(function (d) {
        var reg = regionOf(state.gu + "|" + d);
        return { d: d, py: reg.med.pyeong || 0, c: (reg.cnt.sale || 0) };
      }).filter(function (x) { return x.c >= 3; }).sort(function (a, b) { return b.py - a.py; }).slice(0, 8);
    } else {
      rows = D.gus.map(function (g) {
        var reg = regionOf(g);
        return { d: g, py: reg.med.pyeong || 0, c: (reg.cnt.sale || 0) };
      }).sort(function (a, b) { return b.py - a.py; }).slice(0, 10);
    }

    return "<h3>📊 데이터로 본 입지 — " + regionLabel() + "</h3>" +
      "<ul>" +
      "<li>중위 매매 평당가 <b>" + (r.med.pyeong || 0).toLocaleString() + "만원</b> — 서울 전체 중위(" +
      (seoul.med.pyeong || 0).toLocaleString() + "만원) 대비 <b>" + ratio + "%</b></li>" +
      "<li>중위 매매가 <b>" + eokman(r.med.sale) + "</b> · 중위 전세보증금 <b>" + eokman(r.med.jeonse) + "</b>" +
      (r.med.sale ? " (전세가율 약 <b>" + Math.round((r.med.jeonse / r.med.sale) * 100) + "%</b>)" : "") + "</li>" +
      "<li>표본 기간 총 <b>" + (r.cnt.sale + r.cnt.jeonse + r.cnt.wolse).toLocaleString() + "건</b> 신고 " +
      "(매매 " + r.cnt.sale.toLocaleString() + " · 전세 " + r.cnt.jeonse.toLocaleString() +
      " · 월세 " + r.cnt.wolse.toLocaleString() + ")</li>" +
      "</ul>" +
      (rows.length ? "<h3 style='margin-top:16px;font-size:14.5px'>" +
        (state.gu === ALL ? "서울 자치구" : state.gu + " 법정동") +
        " 중위 매매 평당가 순위 <span class='rt-sub'>어디가 비싼가</span></h3>" +
        '<table class="rank-table"><thead><tr><th>순위</th><th>' +
        (state.gu === ALL ? "자치구" : "법정동") + "</th><th>중위 평당가</th><th>매매 건수</th></tr></thead><tbody>" +
        rows.map(function (x, i) {
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(x.d) + "</td>" +
            '<td class="rt-price">' + x.py.toLocaleString() + "만원</td><td>" + x.c.toLocaleString() + "건</td></tr>";
        }).join("") + "</tbody></table>" : "") +
      locBriefHtml() +
      priceIndexHtml() +
      dongVsGuHtml() +
      "<p style='margin-top:10px;color:var(--txt-mute);font-size:12.5px'>" +
      "※ 평당가 = 거래금액 ÷ (전용면적 ÷ 3.3058). 매매 신고 3건 이상인 지역만 순위에 넣습니다.</p>";
  }

  /* 한국부동산원 공동주택 매매 실거래가격지수 — 구 단위 공식 통계.
     우리가 직접 계산한 중위 평당가와 방향이 맞는지 대조하는 용도. */
  /* 자치구별 전년 동기 대비 상승률 순위 — "우리 동네가 더 오르나"에 답한다 */
  var _piRank = null;
  function priceIndexRank() {
    if (_piRank) return _piRank;
    var rows = [];
    Object.keys(LOC).forEach(function (g) {
      var pi = LOC[g] && LOC[g].priceIndex;
      if (!pi || !pi.points || pi.points.length < 5) return;
      var p = pi.points, last = p[p.length - 1], y = p[p.length - 5];
      if (!y || !y.value) return;
      rows.push({ gu: g, yoy: (last.value - y.value) / y.value * 100 });
    });
    rows.sort(function (x, y2) { return y2.yoy - x.yoy; });
    var avg = rows.reduce(function (t, r) { return t + r.yoy; }, 0) / (rows.length || 1);
    _piRank = { rows: rows, avg: avg, n: rows.length };
    return _piRank;
  }

  function priceIndexHtml() {
    var gu = state.gu === ALL ? null : state.gu;
    var pi = gu && LOC[gu] && LOC[gu].priceIndex;
    if (!pi || !pi.points || pi.points.length < 2) return "";

    var pts = pi.points;
    var last = pts[pts.length - 1], first = pts[0];
    var fmtQ = function (p) { return p.period.replace(/(\d{4})Q0?(\d)/, "$1년 $2분기"); };
    var shortQ = function (p) { return p.period.replace(/(\d{2})(\d{2})Q0?(\d)/, "$2.$3Q"); };
    var sign = function (v) { return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(1) + "%"; };
    var cls = function (v) { return v >= 0 ? "up" : "down"; };

    var yoy = null;
    if (pts.length >= 5) {
      var y0 = pts[pts.length - 5];
      if (y0 && y0.value) yoy = (last.value - y0.value) / y0.value * 100;
    }
    var total = first.value ? (last.value - first.value) / first.value * 100 : 0;

    // 분기 변동률 — 0을 기준선으로 두므로 크기를 그대로 비교할 수 있다
    var qoq = [];
    for (var i = 1; i < pts.length; i++) {
      var prev = pts[i - 1].value;
      qoq.push({ p: pts[i], v: prev ? (pts[i].value - prev) / prev * 100 : 0 });
    }
    var peak = qoq.reduce(function (m, x) { return Math.max(m, Math.abs(x.v)); }, 0) || 1;

    var bars = '<div class="pi-chart"><div class="pi-bars">' + qoq.map(function (x) {
      var h = Math.max(3, Math.round(Math.abs(x.v) / peak * 46));
      return '<div class="pi-col" title="' + fmtQ(x.p) + " " + x.p.value + " (" + sign(x.v) + ')">' +
        '<span class="pi-val ' + cls(x.v) + '">' + sign(x.v) + "</span>" +
        '<span class="pi-bar ' + cls(x.v) + (x.v < 0 ? " neg" : "") + '" style="height:' + h + 'px"></span>' +
        '<span class="pi-q">' + shortQ(x.p) + "</span></div>";
    }).join("") + '</div><div class="pi-zero"><span>0%</span></div></div>';

    // 서울 안에서 어디쯤인지
    var rankLine = "";
    if (yoy !== null) {
      var R = priceIndexRank();
      var idx = -1;
      for (var j = 0; j < R.rows.length; j++) if (R.rows[j].gu === gu) { idx = j; break; }
      if (idx >= 0) {
        var gap = yoy - R.avg;
        rankLine = '<div class="pi-rank">' +
          "<b>상승률 서울 " + R.n + "개 구 중 " + (idx + 1) + "위</b>" +
          '<span class="dim-note">전년 동기 대비 기준 · 25개구 평균 ' + sign(R.avg) + " · " +
          esc(gu) + "가 " + (Math.abs(gap) < 0.5 ? "평균 수준" :
            (gap > 0 ? "<b class='up'>" + gap.toFixed(1) + "%p 높음</b>"
                     : "<b class='down'>" + Math.abs(gap).toFixed(1) + "%p 낮음</b>")) + "</span></div>" +
          "";
      }
    }

    return "<h3 style='margin-top:18px;font-size:14.5px'>🏛️ " + esc(gu) +
      " 공식 실거래가격지수 <span class='rt-sub'>한국부동산원</span></h3>" +
      '<div class="pi-top">' +
        '<div class="pi-now"><span class="pi-now-q">' + fmtQ(last) + "</span>" +
          '<span class="pi-now-v">' + last.value + "</span>" +
          '<span class="dim-note">' + esc(pi.unit) + "</span></div>" +
        (yoy !== null ? '<div class="pi-kpi"><span>전년 동기 대비</span><b class="' + cls(yoy) + '">' +
          sign(yoy) + "</b></div>" : "") +
        '<div class="pi-kpi"><span>' + fmtQ(first) + " 이후</span><b class=\"" + cls(total) + '">' +
          sign(total) + "</b></div>" +
      "</div>" + rankLine +
      '<p class="pi-cap">분기별 변동률 <span class="dim-note">막대는 0%가 기준선이라 길이를 그대로 비교하셔도 됩니다</span></p>' +
      bars +
      "<p style='margin-top:10px;color:var(--txt-mute);font-size:12px'>" +
      "위 중위 평당가는 <b>이 대시보드가 직접 계산</b>한 값이고, 이 지수는 <b>한국부동산원 공식 통계</b>입니다. " +
      "산출 방식이 달라 숫자는 다르지만 <b>방향(오름/내림)이 어긋나면</b> 표본이 치우쳤다는 신호로 보시면 됩니다. " +
      "분기 단위라 최신 분기는 늦게 반영됩니다.</p>";
  }

  // 인쇄 직전에 입지분석 5개 항목을 전부 펼친다(화면에서 무엇을 열어 뒀든 동일하게)
  window.addEventListener("beforeprint", function () {
    var box = document.getElementById("locDetail");
    if (!box || box.dataset.expanded === "1") return;
    box.dataset.screenHtml = box.innerHTML;
    box.dataset.wasShown = box.classList.contains("show") ? "1" : "";
    box.innerHTML = locPrintAllHtml();
    box.classList.add("show");
    box.dataset.expanded = "1";
  });
  window.addEventListener("afterprint", function () {
    var box = document.getElementById("locDetail");
    if (!box || box.dataset.expanded !== "1") return;
    box.innerHTML = box.dataset.screenHtml || "";
    box.classList.toggle("show", box.dataset.wasShown === "1");
    box.dataset.expanded = "";
  });

  /* ════════════════ 정책 ════════════════ */

  var POLICY = [
    { date: "규제지역", title: "투기과열지구·조정대상지역", body: "서울 전역이 규제지역으로 지정되면 <b>LTV·DTI 한도</b>와 <b>전매제한</b>, <b>자금조달계획서</b> 제출 의무가 달라집니다. 지정 현황은 수시로 바뀌므로 계약 전 국토부 고시를 확인하세요.", tag: "대출·전매" },
    { date: "세금", title: "취득세·양도세 중과", body: "다주택자의 <b>취득세 중과(8~12%)</b>와 조정대상지역 <b>양도세 중과</b>는 주택 수·보유기간·지역에 따라 크게 달라집니다. 1세대 1주택 비과세 요건(2년 보유·거주)도 지역에 따라 다릅니다.", tag: "세제" },
    { date: "임대차", title: "임대차 2법 · 전월세신고제", body: "<b>계약갱신요구권(2+2)</b>과 <b>전월세상한제(5%)</b>, 보증금 6천만원 또는 월세 30만원 초과 계약의 <b>전월세신고 의무</b>가 적용됩니다. 신고는 계약 후 30일 이내입니다.", tag: "임대차" },
    { date: "정비사업", title: "재건축·재개발 조합원 지위 양도", body: "투기과열지구 내 재건축은 <b>조합설립인가 후</b>, 재개발은 <b>관리처분인가 후</b> 조합원 지위 양도가 제한됩니다. 예외 요건(10년 보유·5년 거주 등)이 있으니 개별 확인이 필요합니다.", tag: "정비사업" },
    { date: "청약", title: "청약 가점·특별공급", body: "무주택기간·부양가족·청약통장 가입기간으로 <b>가점 84점</b>이 구성됩니다. 신혼부부·생애최초·다자녀 등 <b>특별공급</b> 물량과 소득·자산 요건을 함께 확인하세요.", tag: "청약" },
    { date: "보증금", title: "전세보증금 반환보증", body: "HUG·SGI의 <b>전세보증금 반환보증</b> 가입 요건(주택가격 대비 보증금 비율 등)이 강화되는 추세입니다. 계약 전 <b>등기부 확인 + 보증 가입 가능 여부</b>를 함께 점검하세요.", tag: "전세안전" },
  ];

  document.getElementById("policyGrid").innerHTML = POLICY.map(function (p) {
    return '<div class="policy-card"><span class="date-chip">' + p.date + "</span>" +
      "<h4>" + p.title + "</h4><p>" + p.body + "</p>" +
      '<span class="tag">' + p.tag + "</span></div>";
  }).join("");


  /* ════════════════ 아파트 실거래 가격지수 ════════════════
     월별 중위 평당가(apt.js의 idx)를 첫 달=100으로 지수화해 흐름을 본다.
     자치구를 골랐으면 한국부동산원 공식 지수(분기)를 겹쳐 방향을 대조할 수 있다. */

  var idxChart = null;
  var idxState = { view: "type", mode: "index", official: false };

  function idxSeries(key) {
    if (!BY_REGION[key]) return null;
    return { sale: pySeries(key, "sale"), jeonse: pySeries(key, "jeonse"), wolse: pySeries(key, "wolse") };
  }

  function toIndex(arr) {
    // 값이 있는 첫 달을 100으로. 빈 달은 null 그대로 두어 점을 찍지 않는다.
    var base = null;
    for (var i = 0; i < arr.length; i++) { if (arr[i]) { base = arr[i]; break; } }
    if (!base) return arr.map(function () { return null; });
    return arr.map(function (v) { return v ? +(v / base * 100).toFixed(1) : null; });
  }

  function officialSeries(labels) {
    // 분기 지수를 월 눈금에 맞춰 편다(해당 분기의 값을 그 분기 달들에 반복).
    var gu = state.gu === ALL ? null : state.gu;
    var pi = gu && (window.APT_LOCATION || {})[gu] && window.APT_LOCATION[gu].priceIndex;
    if (!pi || !pi.points) return null;
    var byQ = {};
    pi.points.forEach(function (p) { byQ[p.period] = p.value; });
    var vals = bucketList().map(function (k) {
      var yy = k.slice(0, 4), mm = parseInt(k.slice(5, 7), 10);
      var q = yy + "Q" + (Math.ceil(mm / 3) < 10 ? "0" : "") + Math.ceil(mm / 3);
      return byQ[q] != null ? byQ[q] : null;
    });
    if (!vals.some(function (v) { return v != null; })) return null;
    return idxState.mode === "index" ? toIndex(vals) : vals;
  }

  var THIN = 5;   // 이 건수 미만이면 "표본 적음"으로 본다

  // 표본이 얇을 때 "그래서 뭘 하면 되는지"는 지금 상태에 따라 다르다
  function thinAdvice() {
    if (state.gran === "week") return "매매는 <b>월간</b>으로 바꾸시면 훨씬 안정적으로 보입니다.";
    var days = (new Date(state.end) - new Date(state.start)) / 86400000;
    if (days < 175) return "조회 기간을 <b>6개월 이상</b>으로 넓히시면 표본이 늘어납니다.";
    if (state.dong !== ALL) return "이 법정동은 원래 거래가 드뭅니다. <b>법정동을 ‘전체’로</b> 놓고 자치구 단위로 보시거나, 아래 <b>월별 브리핑 표</b>의 숫자를 쓰세요.";
    return "이 지역은 원래 거래가 드뭅니다. 아래 <b>월별 브리핑 표</b>의 건수를 함께 보고 말씀하세요.";
  }

  var HOT_COLOR = "#bc3d3d";

  /* 점 모양으로 "이 값을 믿어도 되는지"를 알린다.
       꽉 찬 동그라미  = 표본 넉넉, 그대로 읽으셔도 된다
       속 빈 동그라미  = 표본 5건 미만, 한두 건에 출렁인다
       붉은 세모      = 한 단지가 30% 넘게 차지, 그 단지 값에 끌려간 구간 */
  function pointStyleOf(stats, color) {
    return {
      pointStyle: stats.map(function (x) { return x.hot ? "triangle" : "circle"; }),
      pointRadius: stats.map(function (x) {
        return x.n ? (x.hot ? 8 : (x.n < THIN ? 3 : 5)) : 0;
      }),
      pointHoverRadius: stats.map(function (x) {
        return x.n ? (x.hot ? 10 : (x.n < THIN ? 5 : 7)) : 0;
      }),
      pointBackgroundColor: stats.map(function (x) {
        return x.hot ? color : (x.n < THIN ? "#ffffff" : color);
      }),
      pointBorderColor: stats.map(function (x) { return x.hot ? HOT_COLOR : color; }),
      pointBorderWidth: stats.map(function (x) { return x.hot ? 3 : (x.n < THIN ? 2 : 1.5); }),
    };
  }

  /* 그래프를 읽어 고객께 그대로 드릴 문장으로 푼다.
     월별 브리핑과 같은 규칙 — 표본이 얇거나 한 단지에 쏠린 구간은 빼고,
     뺐다는 사실을 함께 말한다. */
  /* ── 결론 ──
     "지금 어떤 국면인가"까지만 말한다. 앞으로 어떻게 될지는 말하지 않는다.
     추세(첫->끝) · 기울기 변화(뒤 절반 vs 앞 절반) · 흔들림(고저 격차) 세 가지로 가른다. */
  /* 그 구간이 아직 신고를 받는 중인가.
     실거래 신고 기한이 계약일로부터 30일이라, 구간 끝이 자료 기준일에서
     30일 안쪽이면 아직 덜 들어온 것으로 본다. 월별 브리핑과 같은 잣대다. */
  function bucketPending(key) {
    var end;
    if (key.length === 7) {                       // "2026-08"
      end = new Date(parseInt(key.slice(0, 4), 10), parseInt(key.slice(5), 10), 0);
    } else {                                      // "2026-08-17" (주 시작)
      end = new Date(key + "T00:00:00");
      end.setDate(end.getDate() + 6);
    }
    var cut = new Date(DATA_END + "T00:00:00");
    cut.setDate(cut.getDate() - 30);
    return end > cut;
  }

  function phaseOf(vals) {
    if (!vals || vals.length < 2) return null;
    var a = vals[0], b = vals[vals.length - 1];
    if (!a) return null;
    var r = (b - a) / a * 100;

    // 뒤 절반이 앞 절반보다 빨라졌는지 느려졌는지
    var accel = null;
    if (vals.length >= 4) {
      var h = Math.floor(vals.length / 2);
      var e1 = (vals[h - 1] - vals[0]) / vals[0] * 100;
      var e2 = (vals[vals.length - 1] - vals[h]) / vals[h] * 100;
      accel = e2 - e1;
    }
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    var swing = lo ? (hi - lo) / lo * 100 : 0;

    var tag, tone;
    if (swing >= 25) { tag = "흔들림이 큰 국면"; tone = "warn"; }
    else if (r >= 5) { tag = (accel !== null && accel < -2) ? "오름세가 둔화되는 국면" : "오름세 국면"; tone = "up"; }
    else if (r <= -5) { tag = (accel !== null && accel > 2) ? "내림세가 진정되는 국면" : "약세 국면"; tone = "down"; }
    else { tag = "보합 국면"; tone = "flat"; }
    return { tag: tag, tone: tone, r: r, accel: accel, swing: swing };
  }

  function conclHtml(tag, tone, lines, advice) {
    return '<li class="cc-li"><div class="cc ' + tone + '">' +
      '<div class="cc-head"><span class="cc-badge">결론</span><b>' + tag + "</b></div>" +
      '<p class="cc-why">' + lines.join(" ") + "</p>" +
      '<p class="cc-do"><span>첨언</span>' + advice + "</p>" +
      "</div></li>";
  }

  function renderIndexScript(sets, labels, isIdx) {
    var host = document.getElementById("idxScript");
    if (!host) return;
    document.getElementById("idxScriptTitle").textContent =
      "금집부쌤이 보는 " + regionLabel() + " 가격 흐름";

    var unit = state.gran === "week" ? "주" : "달";
    var unitEun = state.gran === "week" ? "주는" : "달은";      // 받침 유무로 조사가 갈린다
    var out = [];
    var concl = null;                       // 맨 앞에 붙일 결론

    // 쓸 만한 구간만 남긴다
    function usable(d) {
      var st = d._stats || [];
      var v = [];
      for (var i = 0; i < st.length; i++) {
        if (st[i].n >= THIN && !st[i].hot && st[i].v) v.push({ i: i, s: st[i] });
      }
      return v;
    }

    // 매매 흐름으로 국면을 가른다(없으면 전세)
    (function () {
      var lead = sets.filter(function (d) { return d._stats && d.label.indexOf("매매") >= 0; })[0]
              || sets.filter(function (d) { return d._stats; })[0];
      if (!lead) return;
      var keys = bucketList();
      var solid = usable(lead).filter(function (x) { return !bucketPending(keys[x.i]); });
      var v = solid.map(function (x) { return x.s.v; });
      var ph = phaseOf(v);
      var thin = (lead._stats || []).filter(function (x) { return x.n && x.n < THIN; }).length;
      var drawn = (lead._stats || []).filter(function (x) { return x.n; }).length;

      if (!ph || v.length < 3) {
        var all2 = usable(lead);
        var cut = all2.filter(function (x) { return bucketPending(keys[x.i]); });
        var why0 = [];
        if (cut.length) {
          why0.push("<b>" + cut.map(function (x) { return labels[x.i]; }).join("·") +
            "은 아직 신고를 받는 중</b>이라 뺐습니다(신고 기한 계약일+30일).");
        }
        why0.push("남은 " + unit + "이 <b>" + v.length + "곳뿐</b>이라 " +
          "이 표본으로 흐름을 말씀드리면 <b>틀릴 가능성이 큽니다</b>.");
        concl = conclHtml("아직 흐름을 말하기 이른 구간", "flat", why0,
          "<b>조회 기간을 12개월</b>로 놓으시면 확정된 달이 늘어 제대로 보입니다. " +
          "그전에는 위 <b>표의 건수</b>와 <b>개별 단지</b>로 설명하세요.");
        return;
      }

      var why = [];
      why.push("<b>" + esc(lead.label) + "</b>가 조회 구간에서 <b>" +
        (ph.r >= 0 ? "+" : "\u2212") + Math.abs(ph.r).toFixed(1) + "%</b>입니다.");
      if (ph.accel !== null && Math.abs(ph.accel) >= 2) {
        why.push("뒤 절반이 앞 절반보다 <b>" + Math.abs(ph.accel).toFixed(1) + "%p " +
          (ph.accel > 0 ? "빨라졌습니다" : "느려졌습니다") + "</b>.");
      }
      if (ph.swing >= 15) {
        why.push("다만 고점과 저점이 <b>" + Math.round(ph.swing) + "%</b> 벌어져 <b>" + unit +
          "마다 크게 출렁입니다</b>.");
      }
      if (thin) why.push("표본이 얇은 " + unit + "이 " + thin + "/" + drawn + "곳 있습니다.");
      var pend = usable(lead).filter(function (x) { return bucketPending(keys[x.i]); });
      if (pend.length) {
        why.push("<b>" + pend.map(function (x) { return labels[x.i]; }).join("·") +
          "은 신고가 덜 들어와 결론에서 뺐습니다.</b>");
      }

      var advice;
      if (ph.tone === "warn") {
        advice = "<b>지금 수치 하나로 시세를 못박지 마세요.</b> 관심 단지의 <b>같은 평형 최근 거래</b>를 직접 확인해 드리는 편이 안전합니다.";
      } else if (ph.tone === "up") {
        advice = ph.tag.indexOf("둔화") >= 0
          ? "<b>오르고는 있지만 속도는 줄었습니다.</b> 급하게 결정하실 상황은 아니되, 방향이 꺾인 것도 아니라고 말씀하세요."
          : "<b>수요가 붙어 있는 구간</b>입니다. 매수 쪽이면 미루실수록 부담이 커질 수 있다고 짚어 주세요.";
      } else if (ph.tone === "down") {
        advice = ph.tag.indexOf("진정") >= 0
          ? "<b>내림폭이 줄고 있습니다.</b> 바닥을 단정하지 마시고 <b>거래량이 함께 도는지</b> 확인하시라고 하세요."
          : "<b>매도 쪽이면 서두르실 이유</b>가, 매수 쪽이면 <b>기다리실 여유</b>가 있는 구간입니다.";
      } else {
        advice = "<b>값이 크게 움직이지 않는 구간</b>입니다. 시세보다 <b>매물 상태·층·향</b>으로 협상하시는 편이 낫습니다.";
      }
      concl = conclHtml(ph.tag, ph.tone, why, advice);
    })();

    sets.forEach(function (d) {
      if (!d._stats) return;                       // 공식지수 선은 건너뛴다
      var all = d._stats.filter(function (x) { return x.n; });
      var total = all.reduce(function (t, x) { return t + x.n; }, 0);
      if (!total) {
        out.push("<b>" + esc(d.label) + "</b>는 이 기간에 거래가 없었습니다.");
        return;
      }
      var v = usable(d);
      if (v.length < 2) {
        out.push("<b>" + esc(d.label) + "</b>는 " + total.toLocaleString() + "건인데, " +
          "쓸 만한 " + unit + "이 " + v.length + "곳뿐이라 <b>흐름을 말씀드리기 어렵습니다</b>. " +
          (state.gran === "week" ? "<b>월간</b>으로 바꾸시면" : "<b>기간을 넓히시면</b>") + " 나아집니다.");
        return;
      }
      var a = v[0], b = v[v.length - 1];
      var r = (b.s.v - a.s.v) / a.s.v * 100;
      var word = Math.abs(r) < 1.5 ? "거의 그대로입니다"
        : (r > 0 ? "<b>" + r.toFixed(1) + "% 올랐습니다</b>"
                 : "<b>" + Math.abs(r).toFixed(1) + "% 내렸습니다</b>");
      var t = "<b>" + esc(d.label) + "</b>는 " + labels[a.i] + " 평당 " +
        Math.round(a.s.v).toLocaleString() + "만원(" + a.s.n + "건)에서 " +
        labels[b.i] + " " + Math.round(b.s.v).toLocaleString() + "만원(" + b.s.n + "건)으로 " + word + ".";

      // 중간에 크게 출렁였으면 단일 추세로 말하지 않는다
      if (v.length >= 3) {
        var vals = v.map(function (x) { return x.s.v; });
        var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
        if (lo && (hi - lo) / lo * 100 >= 15) {
          t += " 그런데 <b>쭉 한 방향으로 움직인 건 아닙니다</b> \u2014 가장 높았던 " + unitEun + " " +
            labels[v[vals.indexOf(hi)].i] + " " + Math.round(hi).toLocaleString() + "만원, 낮았던 " + unitEun + " " +
            labels[v[vals.indexOf(lo)].i] + " " + Math.round(lo).toLocaleString() + "만원으로 <b>" +
            Math.round((hi - lo) / lo * 100) + "%</b>나 차이가 납니다.";
        }
      }

      var thin = d._stats.filter(function (x) { return x.n && x.n < THIN; }).length;
      var hots = [];
      d._stats.forEach(function (x, i) { if (x.hot) hots.push({ i: i, h: x.hot, n: x.n }); });
      if (thin || hots.length) {
        var why = [];
        if (thin) why.push("표본 " + THIN + "건 미만 " + thin + "곳");
        if (hots.length) {
          why.push(hots.map(function (x) {
            return labels[x.i] + " <b>" + esc(x.h[0]) + "</b> " + x.h[1] + "/" + x.n + "건";
          }).join(", "));
        }
        t += " (" + why.join(", ") + "은 계산에서 뺐습니다.)";
      }
      out.push(t);
    });

    // 월세는 환산보증금이라 오해하기 쉽다
    var w = sets.filter(function (d) { return d.label === TYPE_LABEL.wolse && d._stats; })[0];
    if (w && usable(w).length >= 2) {
      out.push("<b>월세선은 환산보증금(보증금 + 월세\u00d7100)</b> 기준입니다. " +
        "보증금을 올리고 월세를 낮춘 준전세로 옮겨가도 이 선은 <b>똑같이 올라갑니다</b>. " +
        "월세가 올랐는지는 <b>아래 월별 브리핑의 중위 월세</b> 칸에서 확인하세요.");
    }

    // 공식지수를 켰으면 방향이 맞는지 짚는다
    if (idxState.official && state.gu !== ALL) {
      var pi = (window.APT_LOCATION || {})[state.gu];
      var pts = pi && pi.priceIndex && pi.priceIndex.points;
      if (pts && pts.length >= 2) {
        var pl = pts[pts.length - 1], pf = pts[0];
        var pr = pf.value ? (pl.value - pf.value) / pf.value * 100 : 0;
        var sale = sets.filter(function (d) { return d.label === TYPE_LABEL.sale && d._stats; })[0];
        var su = sale ? usable(sale) : [];
        var mine = su.length >= 2 ? (su[su.length - 1].s.v - su[0].s.v) / su[0].s.v * 100 : null;
        var qTxt = function (q) { return q.replace(/(\d{4})Q0?(\d)/, "$1년 $2분기"); };
        var line = "<b>공식(부동산원) 지수</b>는 " + qTxt(pf.period) + "부터 " + qTxt(pl.period) + "까지 <b>" +
          (pr >= 0 ? "+" : "\u2212") + Math.abs(pr).toFixed(1) + "%</b>입니다. <b>분기 단위라 우리 조회 기간과 구간이 다르니</b> 값을 직접 견주지 마시고 <b>방향만</b> 보세요.";
        if (mine !== null) {
          line += (mine >= 0) === (pr >= 0)
            ? " 우리 표본과 <b>방향이 같습니다</b> \u2014 믿고 말씀하셔도 됩니다."
            : " 우리 표본과 <b>방향이 엇갈립니다</b>. 이럴 땐 <b>공식지수를 앞세우고</b>, 우리 수치는 참고로만 쓰세요.";
        }
        out.push(line);
      }
    }

    out.push("이 그래프는 <b>국토교통부 실거래 신고</b>를 " + unit + " 단위로 모아 " +
      (isIdx ? "<b>첫 구간 100</b> 기준으로 지수화" : "<b>만원/평</b> 그대로") + "한 것입니다. " +
      regionLabel() + " " + win().label + " 구간입니다.");

    host.innerHTML = (concl || "") + out.map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }

  function renderIndex() {
    var labels = bucketLabels();
    var isIdx = idxState.mode === "index";
    var sets = [];

    document.getElementById("idxSecTitle").textContent =
      (state.gu === ALL ? "서울시 전체" : regionLabel()) + " 아파트";

    if (idxState.view === "type") {
      TYPES.forEach(function (t) {
        var stats = pyStats(regionKey(), t);
        var raw = stats.map(function (x) { return x.v; });
        sets.push(Object.assign({
          label: TYPE_LABEL[t],
          data: isIdx ? toIndex(raw) : raw,
          _stats: stats,
          borderColor: TYPE_COLOR[t], backgroundColor: TYPE_COLOR[t] + "22",
          borderWidth: 2.5, tension: 0.3, spanGaps: true,
        }, pointStyleOf(stats, TYPE_COLOR[t])));
      });
    } else {
      // 지역 비교 — 지금 보는 곳 / 그 자치구 / 서울 전체를 매매 기준으로 겹친다
      var targets = [];
      if (state.gu !== ALL && state.dong !== ALL) {
        targets.push({ key: state.gu + "|" + state.dong, name: state.dong, color: "#4f7fe6" });
      }
      if (state.gu !== ALL) targets.push({ key: state.gu, name: state.gu, color: "#cf9a45" });
      targets.push({ key: ALL, name: "서울 전체", color: "#8a93a3" });

      targets.forEach(function (tg) {
        if (!BY_REGION[tg.key]) return;
        var stats = pyStats(tg.key, "sale");
        var raw = stats.map(function (x) { return x.v; });
        sets.push(Object.assign({
          label: tg.name + " (매매)",
          data: isIdx ? toIndex(raw) : raw,
          _stats: stats,
          borderColor: tg.color, backgroundColor: tg.color + "22",
          borderWidth: tg.key === ALL ? 2 : 2.8,
          borderDash: tg.key === ALL ? [6, 4] : [],
          tension: 0.3, spanGaps: true,
        }, pointStyleOf(stats, tg.color)));
      });
    }

    var offMiss = "";
    if (idxState.official) {
      var off = officialSeries(labels);
      if (!off) {
        // 조용히 넘어가면 버튼이 고장 난 줄 아신다 — 왜 안 겹치는지 알려 준다
        var pi0 = (window.APT_LOCATION || {})[state.gu];
        var last = pi0 && pi0.priceIndex && pi0.priceIndex.points.length
          ? pi0.priceIndex.points[pi0.priceIndex.points.length - 1].period : "";
        offMiss = last
          ? "공식(부동산원) 지수는 <b>" + last.replace("Q0", "년 ").replace("Q", "년 ") +
            "분기</b>까지 나와 있어 지금 조회 기간과 겹치지 않습니다. " +
            "<b>조회 기간을 그 분기까지 넓히시면</b> 겹쳐 볼 수 있습니다."
          : state.gu + "의 공식(부동산원) 지수 자료가 없습니다.";
      }
      if (off) {
        sets.push({
          label: "공식(부동산원) " + (isIdx ? "지수" : "지수값"),
          data: off, borderColor: "#bc3d3d", backgroundColor: "transparent",
          borderWidth: 2, borderDash: [3, 3], pointRadius: 2, tension: 0,
          spanGaps: true,
        });
      }
    }

    if (idxChart) idxChart.destroy();
    idxChart = new Chart(document.getElementById("idxChart"), {
      type: "line",
      data: { labels: labels, datasets: sets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: {
            display: true,
            text: regionLabel() + " · " + (state.gran === "week" ? "주별" : "월별") + " 중위 평당가 " +
                  (isIdx ? "지수 (첫 구간=100)" : "(만원/평)"),
            font: { size: 13, weight: "bold" },
          },
          tooltip: {
            // 값만 보여주면 "3건짜리 봉우리"를 시세 급등으로 읽게 된다.
            // 표본 수와 실제 거래된 단지를 같이 띄운다.
            callbacks: {
              label: function (c) {
                var st = (c.dataset._stats || [])[c.dataIndex];
                if (c.parsed.y == null) return c.dataset.label + ": 거래 없음";
                var t = c.dataset.label + ": " + c.parsed.y.toLocaleString() + (isIdx ? "" : "만원");
                if (st) t += "  (표본 " + st.n + "건" + (st.n < THIN ? " — 적음" : "") + ")";
                return t;
              },
              afterBody: function (items) {
                var out = [];
                items.forEach(function (c) {
                  var st = (c.dataset._stats || [])[c.dataIndex];
                  if (!st || !st.n) return;
                  if (st.hot) {
                    // 이 구간의 중위값은 사실상 이 단지 값이다. 가장 먼저 알린다.
                    out.push("△ " + c.dataset.label + ": " + st.hot[0] + " 한 단지가 " +
                             st.hot[1] + "건(" + Math.round(st.hot[1] / st.n * 100) + "%)");
                  }
                  var ns = st.names.slice(0, 4).join(", ") +
                           (st.names.length > 4 ? " 외 " + (st.names.length - 4) + "곳" : "");
                  out.push("· " + c.dataset.label + " 거래단지: " + ns);
                });
                if (!out.length) return "";
                out.unshift("");
                return out;
              },
            },
          },
        },
        scales: {
          y: { title: { display: true, text: isIdx ? "지수" : "만원/평" } },
        },
      },
    });

    // 표본이 얇은 구간이 몇 개나 되는지 세어 그래프 위에 미리 알린다
    var thin = 0, drawn = 0, hots = [];
    sets.forEach(function (d) {
      (d._stats || []).forEach(function (x, i) {
        if (!x.n) return;
        drawn++;
        if (x.n < THIN) thin++;
        if (x.hot) {
          hots.push({ label: d.label, when: labels[i], name: x.hot[0],
                      c: x.hot[1], n: x.n, pct: Math.round(x.hot[1] / x.n * 100) });
        }
      });
    });

    var notes = [];
    if (hots.length) {
      // 표본이 많아도 한 단지에 몰리면 지수가 그 단지 값으로 끌려간다.
      // 서초구 2026-08 전세가 그랬다(양재리본타워2단지 105/336건).
      hots.sort(function (a, b) { return b.pct - a.pct; });
      notes.push("<b>붉은 세모(△)는 한 단지가 30% 넘게 차지한 구간</b>입니다. " +
        hots.slice(0, 3).map(function (h) {
          return h.when + " " + h.label + " <b>" + esc(h.name) + " " + h.c + "/" + h.n + "건(" + h.pct + "%)</b>";
        }).join(", ") +
        (hots.length > 3 ? " 외 " + (hots.length - 3) + "곳" : "") + ". " +
        "<b>그 구간의 중위값은 사실상 그 단지 값</b>이라, 신축 입주장처럼 싼(또는 비싼) 물량이 " +
        "한꺼번에 신고되면 시세가 급변한 것처럼 보입니다. <b>시세 변동으로 읽지 마세요.</b>");
    }
    if (thin) {
      notes.push("<b>표본 " + THIN + "건 미만 구간이 " + thin + "곳</b> 있습니다(전체 " + drawn + "곳). " +
        "속이 빈 작은 점이 그 구간이고, <b>한두 건에 지수가 크게 출렁이니 시세 흐름으로 읽지 마세요.</b> " +
        thinAdvice());
    }
    if (offMiss) notes.push(offMiss);
    var warn = document.getElementById("idxThinNote");
    warn.hidden = !notes.length;
    warn.innerHTML = notes.map(function (t) { return "<span>" + t + "</span>"; }).join("");

    renderIndexScript(sets, labels, isIdx);

    document.getElementById("idxDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b> · " + (state.gran === "week" ? "주별" : "월별") + " 중위 평당가를 " +
      (isIdx ? "첫 구간 100 기준으로 지수화" : "만원/평 그대로") + "했습니다. " +
      "<b>점 위에 마우스를 올리면</b> 그 구간의 표본 건수와 실제 거래된 단지가 나옵니다." +
      (state.gu === ALL ? " 자치구를 고르면 <b>공식(부동산원) 지수</b>와 겹쳐 볼 수 있습니다." : "");
    var btn = document.getElementById("idxOfficialBtn");
    btn.classList.toggle("is-on", idxState.official);
    btn.disabled = state.gu === ALL;
    btn.title = state.gu === ALL ? "자치구를 선택하면 공식 지수를 겹쳐 볼 수 있습니다" : "";
  }

  document.querySelectorAll("#idxViewTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#idxViewTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      idxState.view = b.dataset.v;
      renderIndex();
    });
  });
  document.querySelectorAll("#idxModeTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#idxModeTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      idxState.mode = b.dataset.m;
      renderIndex();
    });
  });
  document.getElementById("idxOfficialBtn").addEventListener("click", function () {
    idxState.official = !idxState.official;
    renderIndex();
  });


  /* ════════════════ 평당가격 TOP 10 ════════════════ */

  var pyState = { type: "sale" };

  function pyRowsHtml(rows, type) {
    if (!rows || !rows.length) {
      return '<tr class="empty-row"><td colspan="7">해당 기간 · 지역에 ' + TYPE_LABEL[type] + " 실거래가 없습니다.</td></tr>";
    }
    return rows.map(function (r, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      var where = (state.gu === ALL || state.dong === ALL)
        ? '<div class="rt-sub">' + esc(r.gu) + " " + esc(r.dg) + "</div>" : "";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td><div class="rt-name">' + esc(r.n) + "</div>" + where + "</td>" +
        "<td>" + areaText(r.a) + "</td>" +
        "<td>" + (r.f ? r.f + "층" : "-") + "</td>" +
        '<td class="rt-price">' + priceText(r, type) + "</td>" +
        '<td class="rt-price">' + (r.py || 0).toLocaleString() + "만원</td>" +
        '<td class="rt-sub">' + dateText(r.d) + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderPy() {
    var tops = computeRegion(regionKey()).topPy;
    document.getElementById("pyBody").innerHTML = pyRowsHtml(tops[pyState.type], pyState.type);
    if (window.wireScrollBoxes) window.wireScrollBoxes();
    document.getElementById("pyPrintAll").innerHTML = TYPES
      .filter(function (t) { return t !== pyState.type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · " + TYPE_LABEL[t] + " 평당가격 TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>단지명</th><th>전용면적</th><th>층</th><th>거래가</th><th>평당가</th><th>거래일</th></tr></thead><tbody>' +
          pyRowsHtml(tops[t], t) + "</tbody></table>";
      }).join("");
  }

  document.querySelectorAll("#pyTypeTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#pyTypeTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      pyState.type = b.dataset.t;
      renderPy();
    });
  });

  /* ════════════════ 평당가 상승률 TOP 10 ════════════════ */

  var riseState = { type: "sale" };

  function riseRowsHtml(rows) {
    if (!rows || !rows.length) {
      return '<tr class="empty-row"><td colspan="6">전·후반부 모두 거래가 있는 단지가 없습니다. ' +
        "조회 기간을 늘려 보세요.</td></tr>";
    }
    return rows.map(function (r, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      var up = r.rate >= 0;
      var few = r.cnt <= 3;
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td class="rt-name">' + esc(r.n) + "</td>" +
        "<td>" + r.before.toLocaleString() + "만원</td>" +
        "<td>" + r.after.toLocaleString() + "만원</td>" +
        '<td style="font-weight:800;color:' + (up ? "var(--up)" : "var(--down)") + '">' +
          (up ? "+" : "") + r.rate.toFixed(1) + "%</td>" +
        "<td>" + r.cnt + (few ? ' <span class="spread-warn" title="표본이 적어 등락이 과장될 수 있습니다">표본 적음</span>' : "") + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderRise() {
    document.getElementById("riseBody").innerHTML = riseRowsHtml(riseOf(regionKey(), riseState.type));
    if (window.wireScrollBoxes) window.wireScrollBoxes();

    document.getElementById("riseDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b>을 <b>정확히 반으로 나눠</b> " +
      "단지별 전반부 → 후반부 중위 평당가 변동률이 큰 순서입니다.";

    // 나머지 유형은 무거우므로 인쇄 직전에만 만든다(buildRisePrintAll)
    document.getElementById("risePrintAll").innerHTML = "";
  }

  function buildRisePrintAll() {
    document.getElementById("risePrintAll").innerHTML = TYPES
      .filter(function (t) { return t !== riseState.type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · " + TYPE_LABEL[t] + " 평당가 상승률 TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>단지명</th><th>전반부</th><th>후반부</th><th>변동률</th><th>거래</th></tr></thead><tbody>' +
          riseRowsHtml(riseOf(regionKey(), t)) + "</tbody></table>";
      }).join("");
  }

  document.querySelectorAll("#riseTypeTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#riseTypeTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      riseState.type = b.dataset.t;
      renderRise();
    });
  });

  /* ════════════════ 렌더 ════════════════ */

  /* ════════════════ 상담용 월별 브리핑 ════════════════ */

  function moLabel(m) { return m.slice(2, 4) + "년 " + parseInt(m.slice(5), 10) + "월"; }

  // 신고 기한이 30일이라 최근 달은 아직 다 안 들어와 있다.
  // 그 달 말일에 계약해도 30일 뒤까지 신고할 수 있으므로, 말일+30일이
  // 자료 기준일을 넘는 달은 "집계중"이다.
  function isPending(m) {
    var today = (D.today || D.builtAt || "").slice(0, 10);
    if (!today) return false;
    var y = parseInt(m.slice(0, 4), 10), mm = parseInt(m.slice(5), 10);
    var due = new Date(y, mm, 0);              // 그 달 말일
    due.setDate(due.getDate() + 30);
    return due > new Date(today + "T00:00:00");
  }



  function deltaHtml(cur, prev, nCur, nPrev, hot) {
    if (!cur || !prev) return '<span class="dim-note">-</span>';
    var r = (cur - prev) / prev * 100;
    var sign = r > 0 ? "+" : "";
    // 표본이 얇거나 한 단지에 쏠린 달이면, 등락률은 시세가 아니라
    // "어느 단지가 팔렸나"를 보여줄 뿐이다
    if (nCur < MIN_N || nPrev < MIN_N || hot) {
      return '<span class="d-weak" title="표본이 적어 시세 변동으로 보기 어렵습니다">' +
             sign + r.toFixed(1) + "%<sup>*</sup></span>";
    }
    var cls = Math.abs(r) < 1 ? "d-flat" : (r > 0 ? "d-up" : "d-down");
    return '<span class="' + cls + '">' + sign + r.toFixed(1) + "%</span>";
  }

  // 머리글을 두 줄로 — "중위 평당 / 가"처럼 단어 중간에서 끊기는 걸 막는다
  function th2(a, b) { return '<span class="th2">' + a + "</span><span class=\"th2\">" + b + "</span>"; }

  function briefTable(title, cols, rows) {
    return '<div class="brief-card"><h4>' + title + "</h4>" +
      '<div class="table-wrap"><table class="brief-table"><thead><tr>' +
      cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div></div>";
  }

  // 섹션과 목차 버튼을 함께 감춘다 — 목차만 남으면 눌러도 안 움직인다
  function showBrief(on) {
    var sec = document.getElementById("sec-brief");
    if (sec) sec.hidden = !on;
    var nav = document.querySelector('nav.section-nav button[data-target="sec-brief"]');
    if (nav) nav.hidden = !on;
  }

  function renderBrief() {
    var mo = monthlyBrief(regionKey());
    document.getElementById("briefTitle").textContent = regionLabel();
    document.getElementById("briefDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b>을 <b>달 단위</b>로 끊어 정리했습니다. " +
      "주간 그래프는 표본이 얇아 출렁이니, <b>고객께 말씀하실 숫자는 이 표에서</b> 가져가세요.";

    var grid = document.getElementById("briefGrid");
    // 거래가 없으면 "없습니다" 한 줄로 자리를 차지하지 말고 섹션째 감춘다
    if (!mo.length) {
      showBrief(false);
      grid.innerHTML = "";
      document.getElementById("briefScript").innerHTML = "";
      return;
    }
    showBrief(true);

    var flag = function (m, n, hot) {
      var t = "";
      if (isPending(m)) t += ' <span class="brief-flag">집계중</span>';
      if (n > 0 && n < MIN_N) t += ' <span class="brief-thin">표본 적음</span>';
      if (hot && n) {
        t += ' <span class="brief-hot" title="' + esc(hot[0]) + ' 한 곳이 ' + hot[1] +
             '건(' + Math.round(hot[1] / n * 100) + '%) — 중위값이 그 단지 값에 끌려갑니다">한 곳 ' +
             Math.round(hot[1] / n * 100) + '%</span>';
      }
      return t;
    };

    var saleRows = mo.map(function (x, i) {
      var pv = i ? mo[i - 1].sale.py : 0, pn = i ? mo[i - 1].sale.n : 0;
      return "<tr><td>" + moLabel(x.m) + flag(x.m, x.sale.n, x.sale.hot) + "</td>" +
        "<td>" + x.sale.n.toLocaleString() + "건</td>" +
        "<td>" + (x.sale.py ? Math.round(x.sale.py).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + (x.sale.amt ? eokman(x.sale.amt) : "-") + "</td>" +
        "<td>" + deltaHtml(x.sale.py, pv, x.sale.n, pn, x.sale.hot) + "</td></tr>";
    });

    var jeonseRows = mo.map(function (x, i) {
      var pv = i ? mo[i - 1].jeonse.py : 0, pn = i ? mo[i - 1].jeonse.n : 0;
      return "<tr><td>" + moLabel(x.m) + flag(x.m, x.jeonse.n, x.jeonse.hot) + "</td>" +
        "<td>" + x.jeonse.n.toLocaleString() + "건</td>" +
        "<td>" + (x.jeonse.dep ? eokman(x.jeonse.dep) : "-") + "</td>" +
        "<td>" + (x.jeonse.py ? Math.round(x.jeonse.py).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + deltaHtml(x.jeonse.py, pv, x.jeonse.n, pn, x.jeonse.hot) + "</td></tr>";
    });

    var wolseRows = mo.map(function (x) {
      return "<tr><td>" + moLabel(x.m) + flag(x.m, x.wolse.n, x.wolse.hot) + "</td>" +
        "<td>" + x.wolse.n.toLocaleString() + "건</td>" +
        "<td>" + (x.wolse.dep ? eokman(x.wolse.dep) : "-") + "</td>" +
        "<td>" + (x.wolse.rent ? Math.round(x.wolse.rent).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + Math.round(x.wolse.junRate * 100) + "%</td></tr>";
    });

    grid.innerHTML =
      briefTable("매매", ["월", "건수", th2("중위", "평당가"), th2("중위", "거래가"), "전월비"], saleRows) +
      briefTable("전세", ["월", "건수", th2("중위", "보증금"), th2("중위", "평당가"), "전월비"], jeonseRows) +
      briefTable("월세", ["월", "건수", th2("중위", "보증금"), th2("중위", "월세"), th2("준전세", "비중")], wolseRows);

    renderBriefScript(mo);
  }

  /* 고객 앞에서 그대로 읽어 드릴 수 있게 금집부쌤 1인칭으로 풀어 준다.
     예측은 하지 않는다 — 확인된 수치와 그 한계만 말한다.
     "집계중"인 달도 흐름에는 넣되, 미확정이라는 사실을 반드시 함께 말한다. */
  /* 월별 브리핑 결론 — 값·거래량·전월세 구조를 묶어 국면을 잡는다.
     집계중인 달은 빼고 본다. 안 그러면 신고가 덜 들어온 걸 '급감'으로 읽는다. */
  function briefConcl(mo) {
    var solid = mo.filter(function (x) { return !isPending(x.m); });
    var use = solid.filter(function (x) { return x.sale.n >= MIN_N && x.sale.py && !x.sale.hot; });

    if (use.length < 2) {
      var tot = mo.reduce(function (t, x) { return t + x.sale.n; }, 0);
      return conclHtml("매매로는 판단이 어려운 국면", "flat",
        ["신고가 마감된 달 가운데 매매 " + MIN_N + "건을 넘긴 달이 " + use.length + "곳뿐입니다.",
         "조회 기간 매매는 모두 " + tot.toLocaleString() + "건입니다."],
        "매매 흐름 대신 <b>전월세 표</b>와 <b>개별 단지</b>로 설명하시고, " +
        "기간을 <b>6개월 이상</b>으로 넓혀 다시 보세요.");
    }

    var vals = use.map(function (x) { return x.sale.py; });
    var ph = phaseOf(vals);
    var a = use[0], b = use[use.length - 1];

    var why = ["<b>매매 중위 평당가</b>가 " + moLabel(a.m) + " " + Math.round(a.sale.py).toLocaleString() +
      "만원에서 " + moLabel(b.m) + " " + Math.round(b.sale.py).toLocaleString() + "만원으로 <b>" +
      (ph.r >= 0 ? "+" : "\u2212") + Math.abs(ph.r).toFixed(1) + "%</b>입니다."];

    // 거래량 — 마감된 달끼리만
    var volWord = "";
    if (solid.length >= 2) {
      var v1 = solid[0], v2 = solid[solid.length - 1];
      var n1 = v1.sale.n + v1.jeonse.n + v1.wolse.n, n2 = v2.sale.n + v2.jeonse.n + v2.wolse.n;
      if (n1) {
        var vr = (n2 - n1) / n1 * 100;
        volWord = Math.abs(vr) < 10 ? "거래량은 비슷합니다"
          : (vr > 0 ? "거래량이 <b>" + Math.round(vr) + "% 늘었습니다</b>"
                    : "거래량이 <b>" + Math.round(-vr) + "% 줄었습니다</b>");
        why.push(moLabel(v1.m) + " " + n1.toLocaleString() + "건 → " + moLabel(v2.m) + " " +
          n2.toLocaleString() + "건으로 " + volWord + ".");
      }
    }

    // 전월세 구조
    var w = solid.filter(function (x) { return x.wolse.n >= MIN_N && x.wolse.rent; });
    if (w.length >= 2) {
      var jrA = Math.round(w[0].wolse.junRate * 100), jrB = Math.round(w[w.length - 1].wolse.junRate * 100);
      if (jrB - jrA >= 8) {
        why.push("전월세는 <b>준전세 비중이 " + jrA + "% → " + jrB + "%</b>로 늘어, " +
          "<b>보증금을 올리고 월세를 낮추는 쪽</b>으로 움직였습니다.");
      } else if (jrA - jrB >= 8) {
        why.push("전월세는 <b>준전세 비중이 " + jrA + "% → " + jrB + "%</b>로 줄어, " +
          "<b>월세를 늘리는 쪽</b>으로 움직였습니다.");
      }
    }

    var pend = mo.filter(function (x) { return isPending(x.m); });
    if (pend.length) {
      why.push("<b>" + pend.map(function (x) { return moLabel(x.m); }).join("·") +
        "은 신고가 덜 들어와 결론에서 뺐습니다.</b>");
    }

    var advice;
    if (ph.tone === "warn") {
      advice = "<b>달마다 크게 출렁여 한 숫자로 못박기 어렵습니다.</b> 관심 단지의 <b>같은 평형 최근 거래</b>를 직접 짚어 드리세요.";
    } else if (ph.tone === "up") {
      advice = (volWord.indexOf("줄었") >= 0)
        ? "<b>값은 오르는데 거래는 줄었습니다.</b> 호가만 오른 것일 수 있으니 <b>실제 성사가</b>를 꼭 확인하시라고 하세요."
        : "<b>값과 거래가 함께 도는 구간</b>입니다. 매수 쪽이면 결정을 미루실수록 선택지가 줄어든다고 짚어 주세요.";
    } else if (ph.tone === "down") {
      advice = (volWord.indexOf("늘었") >= 0)
        ? "<b>값은 내렸지만 거래는 늘었습니다.</b> 저가 매물이 소화되는 구간이라 <b>급매 위주로</b> 보시라고 권하세요."
        : "<b>값도 거래도 식은 구간</b>입니다. 매도 쪽이면 가격 조정을, 매수 쪽이면 여유를 두시라고 말씀하세요.";
    } else {
      advice = "<b>값이 크게 움직이지 않는 구간</b>입니다. 시세 협상보다 <b>층·향·수리 상태</b>로 조건을 맞추시는 편이 낫습니다.";
    }
    return conclHtml(ph.tag, ph.tone, why, advice);
  }

  function renderBriefScript(mo) {
    var out = [];
    document.getElementById("briefScriptTitle").textContent =
      "금집부쌤이 보는 " + regionLabel();

    function trend(get, label) {
      // 한 단지가 30% 넘게 차지한 달은 중위값이 그 단지 값이라 흐름에서 뺀다
      var pts = mo.filter(function (x) { return get(x).n >= MIN_N && get(x).py && !get(x).hot; });
      var any = mo.filter(function (x) { return get(x).n > 0; });
      var total = any.reduce(function (a, x) { return a + get(x).n; }, 0);

      if (!total) return "<b>" + label + "</b>는 이 기간에 거래가 없었습니다.";

      if (pts.length < 2) {
        var enough = mo.filter(function (x) { return get(x).n >= MIN_N && get(x).py; });
        var hotOnly = enough.filter(function (x) { return get(x).hot; });
        var last1 = any[any.length - 1];
        var head = "<b>" + label + "</b>는 이 기간 <b>" + total.toLocaleString() + "건</b>인데, ";
        var why, how;
        if (hotOnly.length) {
          why = "값을 쓸 만한 달이 " +
                hotOnly.map(function (x) { return moLabel(x.m) + " <b>" + esc(get(x).hot[0]) + "</b>"; }).join(", ") +
                "처럼 <b>한 단지에 몰려</b> 있어서 <b>달별 흐름을 말씀드리기 어렵습니다</b>. ";
          how = "제가 <b>구 전체로 넓혀</b> 보여드리거나, 아래 TOP10에서 <b>관심 단지를 직접</b> 짚어 드리겠습니다.";
        } else if (enough.length) {
          why = "값을 쓸 만한 달이 <b>" + moLabel(enough[0].m) + " 한 달뿐</b>이라 " +
                "<b>비교해 드릴 대상이 없습니다</b>. ";
          how = "<b>기간을 6개월 이상으로</b> 넓혀서 보시는 편이 낫습니다.";
        } else {
          why = "달마다 " + MIN_N + "건이 안 돼 <b>달별 흐름을 말씀드리기 어렵습니다</b>. ";
          how = "<b>기간을 6개월 이상으로</b> 넓혀서 보시는 편이 낫습니다.";
        }
        return head + why +
          "가장 최근은 " + moLabel(last1.m) + " " + get(last1).n + "건" +
          (get(last1).py ? ", 중위 평당가 " + Math.round(get(last1).py).toLocaleString() + "만원" : "") +
          "입니다. " + how;
      }

      var a2 = pts[0], b2 = pts[pts.length - 1];
      var r = (get(b2).py - get(a2).py) / get(a2).py * 100;
      var word = Math.abs(r) < 1.5 ? "거의 그대로입니다"
               : (r > 0 ? "<b>" + r.toFixed(1) + "% 올랐습니다</b>"
                        : "<b>" + Math.abs(r).toFixed(1) + "% 내렸습니다</b>");
      var t = "<b>" + label + "</b>는 " + moLabel(a2.m) + " 평당 " +
        Math.round(get(a2).py).toLocaleString() + "만원(" + get(a2).n + "건)에서 " +
        moLabel(b2.m) + " " + Math.round(get(b2).py).toLocaleString() + "만원(" + get(b2).n + "건)으로 " +
        word + ".";
      if (isPending(b2.m)) {
        t += " 다만 " + moLabel(b2.m) + "은 <b>신고가 아직 다 안 들어와</b> 확정된 숫자가 아닙니다.";
      }

      // 첫 달과 마지막 달만 비교하면 중간의 큰 출렁임이 가려진다
      if (pts.length >= 3) {
        var vals = pts.map(function (x) { return get(x).py; });
        var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
        if (lo && (hi - lo) / lo * 100 >= 15) {
          var hiM = pts[vals.indexOf(hi)], loM = pts[vals.indexOf(lo)];
          t += " 그런데 <b>쭉 한 방향으로 움직인 건 아닙니다</b> \u2014 가장 높았던 달은 " +
               moLabel(hiM.m) + " " + Math.round(hi).toLocaleString() + "만원, 낮았던 달은 " +
               moLabel(loM.m) + " " + Math.round(lo).toLocaleString() + "만원으로 <b>" +
               Math.round((hi - lo) / lo * 100) + "%</b>나 차이가 납니다. " +
               "달마다 <b>어느 단지가 팔렸느냐</b>에 따라 중위값이 흔들린 것이라, " +
               "저는 오르내림보다 <b>관심 있는 단지를 직접 보시길</b> 권해 드립니다.";
        }
      }

      var skipped = mo.filter(function (x) { return get(x).n > 0 && get(x).n < MIN_N; });
      if (skipped.length) {
        t += " (" + skipped.map(function (x) { return moLabel(x.m); }).join("·") +
             "은 표본이 " + MIN_N + "건이 안 돼 이 계산에서 뺐습니다.)";
      }
      var hots = mo.filter(function (x) { return get(x).hot && get(x).n >= MIN_N; });
      if (hots.length) {
        t += " (" + hots.map(function (x) {
          return moLabel(x.m) + "은 <b>" + esc(get(x).hot[0]) + "</b> 한 단지가 " + get(x).hot[1] + "건";
        }).join(", ") + "이라 뺐습니다. 한 단지 물량이 통째로 신고되면 " +
        "<b>그 달 중위값은 사실상 그 단지 값</b>이 됩니다.)";
      }
      return t;
    }

    out.push(trend(function (x) { return x.sale; }, "매매"));
    out.push(trend(function (x) { return x.jeonse; }, "전세"));

    // 월세는 값이 아니라 계약 구조가 핵심이다
    var w = mo.filter(function (x) { return x.wolse.n >= MIN_N && x.wolse.rent; });
    if (w.length >= 2) {
      var wa = w[0], wb = w[w.length - 1];
      var jrA = Math.round(wa.wolse.junRate * 100), jrB = Math.round(wb.wolse.junRate * 100);
      var rentGap = (wb.wolse.rent - wa.wolse.rent) / wa.wolse.rent * 100;
      var t3 = "<b>월세</b>는 중위 월세가 " + Math.round(wa.wolse.rent).toLocaleString() + "만원에서 " +
        Math.round(wb.wolse.rent).toLocaleString() + "만원으로 " +
        (Math.abs(rentGap) < 1 ? "거의 그대로고" : (rentGap > 0 ? "<b>" + rentGap.toFixed(0) + "% 올랐고</b>"
                                                              : "<b>" + Math.abs(rentGap).toFixed(0) + "% 내렸고</b>")) +
        ", 보증금은 " + eokman(wa.wolse.dep) + "에서 " + eokman(wb.wolse.dep) + ", " +
        "준전세 비중은 " + jrA + "%에서 " + jrB + "%입니다.";
      if (jrB - jrA >= 8 && rentGap < 0) {
        t3 += " <b>보증금을 올리고 월세를 낮추는 쪽</b>으로 옮겨가고 있습니다. " +
              "위 가격지수 그래프의 월세선은 환산보증금 기준이라 <b>거꾸로 올라 보이는데, 월세가 오른 게 아닙니다.</b>";
      } else if (jrA - jrB >= 8 && rentGap > 0) {
        t3 += " <b>보증금을 낮추고 월세를 늘리는 쪽</b>으로 옮겨가고 있습니다.";
      }
      out.push(t3);
    } else if (mo.some(function (x) { return x.wolse.n; })) {
      out.push("<b>월세</b>는 달마다 " + MIN_N + "건이 안 돼 구조 변화를 말씀드리기 어렵습니다.");
    }

    // 거래량 — 집계중인 달은 비교에서 빼야 "급감"으로 잘못 읽지 않는다
    var solid = mo.filter(function (x) { return !isPending(x.m); });
    if (solid.length >= 2) {
      var va = solid[0], vb = solid[solid.length - 1];
      var na = va.sale.n + va.jeonse.n + va.wolse.n;
      var nb = vb.sale.n + vb.jeonse.n + vb.wolse.n;
      out.push("<b>거래량</b>은 " + moLabel(va.m) + " " + na.toLocaleString() + "건에서 " +
        moLabel(vb.m) + " " + nb.toLocaleString() + "건입니다. " +
        "(신고가 마감된 달끼리만 비교했습니다.)");
    }

    var pend = mo.filter(function (x) { return isPending(x.m); });
    if (pend.length) {
      out.push("<b>" + pend.map(function (x) { return moLabel(x.m); }).join("·") +
        " 숫자는 아직 확정이 아닙니다.</b> 실거래 신고 기한이 계약일로부터 30일이라 " +
        "앞으로 건수가 더 늘어납니다. <b>지금 수치만 보고 거래가 끊겼다고 보시면 안 됩니다.</b>");
    }

    out.push("여기 숫자는 모두 <b>국토교통부 실거래 신고 원본</b>이고, " +
      regionLabel() + " " + win().label + " 구간입니다. 표의 <b>*</b>는 표본이 " + MIN_N +
      "건이 안 돼 시세 변동으로 보기 어려운 등락률입니다.");

    document.getElementById("briefScript").innerHTML =
      briefConcl(mo) + out.map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }

  function renderAll() {
    renderKpi();
    renderIndex();
    renderBrief();
    renderPy();
    renderRise();
    renderDeal();
    renderCompare();
    renderVolume();
    renderLocation();
    renderMap();
  }

  // 탭이 바뀌면 숨어 있던 캔버스가 0px로 잡혀 있으므로 해당 차트를 다시 그린다
  document.addEventListener("top10tabchange", function (e) {
    if (e.detail.tab === "price") renderCompare();
    if (e.detail.tab === "vol") renderVolume();
  });

  // 인쇄 시에는 세 섹션이 모두 펼쳐지므로 숨어 있던 차트를 미리 그려 둔다
  window.addEventListener("beforeprint", function () {
    renderCompare();
    renderVolume();
    renderIndex();
    buildRisePrintAll();
  });

  fillGu();
  fillDong();
  applyPreset("3m");     // 기본 조회 기간 — 최근 3개월(달 단위)
  initMap();
  renderAll();
})();
