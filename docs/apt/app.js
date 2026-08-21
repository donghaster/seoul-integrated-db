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
    for (var j = 0; j < best.length && picked.length < 10; j++) {
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
    return out.slice(0, 10);
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
      if (!g) return { v: null, n: 0, names: [] };
      var seen = {}, names = [];
      g.forEach(function (x) { if (!seen[x.n]) { seen[x.n] = 1; names.push(x.n); } });
      return {
        v: median(g.map(pyOf)),
        n: g.length,
        names: names,
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

    // 인쇄용 — 화면에 보이는 표 말고 나머지 두 유형도 함께 출력
    document.getElementById("dealPrintAll").innerHTML = TYPES.filter(function (t) { return t !== type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · " + TYPE_LABEL[t] + " 실거래가 TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>단지명</th><th>전용면적</th><th>층</th><th>' +
          (t === "wolse" ? "보증금 / 월세" : "거래가") + "</th><th>평당가</th><th>거래일</th></tr></thead><tbody>" +
          dealRowsHtml(r.top[t] || [], t, false) + "</tbody></table>";
      }).join("");

    document.querySelectorAll("#dealBody .rt-name-clickable").forEach(function (el) {
      el.addEventListener("click", function () {
        focusApt(el.dataset.gu, el.dataset.dong, el.dataset.apt);
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
      var rows = r.top[t] || [];
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
    return keys.slice(0, 10);
  }

  function renderVolRank() {
    var list = volRankList();
    var isGu = state.volRank === "gu";
    document.getElementById("volRankHead").textContent = isGu ? "자치구" : "법정동";

    if (volRankChart) volRankChart.destroy();
    volRankChart = new Chart(document.getElementById("volRankChart"), {
      type: "bar",
      data: {
        labels: list.map(function (x) { return isGu ? x.label : (x.gu ? x.gu + " " + x.label : x.label); }),
        datasets: TYPES.map(function (t) {
          return {
            label: TYPE_LABEL[t] === "월세(환산)" ? "월세" : TYPE_LABEL[t],
            data: list.map(function (x) { return regionOf(x.k).cnt[t] || 0; }),
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

  function renderMap() {
    if (!map) return;
    markerLayer.clearLayers();
    markers = {};

    var rows = region().top[state.dealType] || [];
    var pts = [], miss = 0;

    rows.forEach(function (row, i) {
      var c = coordOf(row.gu, row.dg, row.n);
      if (!c) { miss++; return; }
      var radius = 16 - i;
      var m = L.circleMarker([c.lat, c.lng], {
        radius: radius, color: "#fff", weight: 2.5,
        fillColor: TYPE_COLOR[state.dealType], fillOpacity: 0.92,
      }).addTo(markerLayer).bindTooltip((i + 1) + "위 " + row.n, { direction: "top", className: "zone-tooltip" });
      m.on("click", function () { showDetail(row, i); });
      markers[row.gu + "|" + row.dg + "|" + row.n] = { marker: m, coord: c, row: row, rank: i };
      pts.push([c.lat, c.lng]);
    });

    document.getElementById("mapMissNote").textContent =
      miss ? "좌표 미확인 " + miss + "곳은 지도에 표시되지 않습니다" : "";

    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    else map.setView([37.5535, 126.9905], 11);

    document.getElementById("aptDetail").innerHTML =
      '<p class="placeholder">지도의 원 또는 아래 TOP10 표의 단지명을 클릭하면<br />단지 정보가 여기에 표시됩니다.</p>';
  }

  function showDetail(row, rank) {
    var t = state.dealType;
    document.getElementById("aptDetail").innerHTML =
      '<span class="zone-tag" style="background:' + TYPE_COLOR[t] + '">' + TYPE_LABEL[t] + " " + (rank + 1) + "위</span>" +
      "<h3>" + esc(row.n) + "</h3>" +
      "<table>" +
      "<tr><td>소재지</td><td>" + esc(row.gu) + " " + esc(row.dg) + "</td></tr>" +
      "<tr><td>전용면적</td><td>" + areaText(row.a) + "</td></tr>" +
      "<tr><td>층</td><td>" + (row.f ? row.f + "층" : "-") + "</td></tr>" +
      "<tr><td>" + (t === "wolse" ? "보증금/월세" : "거래금액") + "</td><td><b>" + priceText(row, t) + "</b></td></tr>" +
      "<tr><td>평당가</td><td>" + pyText(row, t) + "</td></tr>" +
      "<tr><td>거래일</td><td>" + dateText(row.d) + "</td></tr>" +
      (row.y ? "<tr><td>준공</td><td>" + row.y + "년</td></tr>" : "") +
      "</table>";
  }

  function focusApt(gu, dong, name) {
    var hit = markers[gu + "|" + dong + "|" + name];
    if (!hit) {
      document.getElementById("aptDetail").innerHTML =
        '<p class="placeholder">「' + esc(name) + "」의 좌표를 찾지 못해<br />지도에 표시할 수 없습니다.</p>";
      return;
    }
    map.flyTo([hit.coord.lat, hit.coord.lng], 16, { duration: 0.6 });
    hit.marker.openTooltip();
    showDetail(hit.row, hit.rank);
    document.getElementById("sec-map").scrollIntoView({ behavior: "smooth", block: "center" });
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
        (state.gu === ALL ? "서울 자치구" : state.gu + " 법정동") + " 중위 매매 평당가 순위</h3>" +
        '<table class="rank-table"><thead><tr><th>순위</th><th>' +
        (state.gu === ALL ? "자치구" : "법정동") + "</th><th>중위 평당가</th><th>매매 건수</th></tr></thead><tbody>" +
        rows.map(function (x, i) {
          return "<tr><td>" + (i + 1) + "</td><td>" + esc(x.d) + "</td>" +
            '<td class="rt-price">' + x.py.toLocaleString() + "만원</td><td>" + x.c.toLocaleString() + "건</td></tr>";
        }).join("") + "</tbody></table>" : "") +
      priceIndexHtml() +
      "<p style='margin-top:10px;color:var(--txt-mute);font-size:12.5px'>" +
      "※ 평당가 = 거래금액 ÷ (전용면적 ÷ 3.3058). 매매 신고 3건 이상인 지역만 순위에 넣습니다.</p>";
  }

  /* 한국부동산원 공동주택 매매 실거래가격지수 — 구 단위 공식 통계.
     우리가 직접 계산한 중위 평당가와 방향이 맞는지 대조하는 용도. */
  function priceIndexHtml() {
    var gu = state.gu === ALL ? null : state.gu;
    var pi = gu && LOC[gu] && LOC[gu].priceIndex;
    if (!pi || !pi.points || !pi.points.length) return "";

    var pts = pi.points;
    var last = pts[pts.length - 1];
    var first = pts[0];
    var yoy = null;
    if (pts.length >= 5) {
      var y = pts[pts.length - 5];
      if (y && y.value) yoy = ((last.value - y.value) / y.value * 100);
    }
    var total = first.value ? ((last.value - first.value) / first.value * 100) : 0;
    var fmtQ = function (p) { return p.period.replace(/(\d{4})Q0?(\d)/, "$1년 $2분기"); };
    var sign = function (v) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; };
    var cls = function (v) { return v >= 0 ? "var(--up)" : "var(--down)"; };

    // 막대 하나짜리 간이 추세 — 별도 차트 없이 흐름만 읽히게
    var vals = pts.map(function (p) { return p.value; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    var spark = '<div class="pi-spark">' + pts.map(function (p) {
      var h = 12 + Math.round((p.value - lo) / span * 34);
      return '<i style="height:' + h + 'px" title="' + fmtQ(p) + " " + p.value + '"></i>';
    }).join("") + "</div>";

    return "<h3 style='margin-top:18px;font-size:14.5px'>🏛️ " + esc(gu) +
      " 공식 실거래가격지수 <span class='rt-sub'>한국부동산원</span></h3>" +
      "<ul>" +
      "<li>최근 <b>" + fmtQ(last) + " " + last.value + "</b> " +
      "<span class='rt-sub'>(" + esc(pi.unit) + ")</span></li>" +
      (yoy !== null ? "<li>전년 동기 대비 <b style='color:" + cls(yoy) + "'>" + sign(yoy) + "</b></li>" : "") +
      "<li>" + fmtQ(first) + " 이후 누적 <b style='color:" + cls(total) + "'>" + sign(total) + "</b></li>" +
      "</ul>" + spark +
      "<p style='margin-top:8px;color:var(--txt-mute);font-size:12px'>" +
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

  // 표본이 얇은 구간은 속 빈 작은 점으로 — 꽉 찬 점만 믿고 읽으시면 된다
  function pointStyleOf(stats, color) {
    return {
      pointRadius: stats.map(function (x) { return x.n ? (x.n < THIN ? 3 : 5) : 0; }),
      pointHoverRadius: stats.map(function (x) { return x.n ? (x.n < THIN ? 5 : 7) : 0; }),
      pointBackgroundColor: stats.map(function (x) { return x.n < THIN ? "#ffffff" : color; }),
      pointBorderColor: color,
      pointBorderWidth: stats.map(function (x) { return x.n < THIN ? 2 : 1.5; }),
    };
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
    var thin = 0, drawn = 0;
    sets.forEach(function (d) {
      (d._stats || []).forEach(function (x) {
        if (!x.n) return;
        drawn++;
        if (x.n < THIN) thin++;
      });
    });
    var notes = [];
    if (thin) {
      notes.push("<b>표본 " + THIN + "건 미만 구간이 " + thin + "곳</b> 있습니다(전체 " + drawn + "곳). " +
        "속이 빈 작은 점이 그 구간이고, <b>한두 건에 지수가 크게 출렁이니 시세 흐름으로 읽지 마세요.</b> " +
        thinAdvice());
    }
    if (offMiss) notes.push(offMiss);
    var warn = document.getElementById("idxThinNote");
    warn.hidden = !notes.length;
    warn.innerHTML = notes.map(function (t) { return "<span>" + t + "</span>"; }).join("");

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

  function briefTable(title, cols, rows) {
    return '<div class="brief-card"><h4>' + title + "</h4>" +
      '<div class="table-wrap"><table class="brief-table"><thead><tr>' +
      cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div></div>";
  }

  function renderBrief() {
    var mo = monthlyBrief(regionKey());
    document.getElementById("briefTitle").textContent = regionLabel();
    document.getElementById("briefDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b>을 <b>달 단위</b>로 끊어 정리했습니다. " +
      "주간 그래프는 표본이 얇아 출렁이니, <b>고객께 말씀하실 숫자는 이 표에서</b> 가져가세요.";

    var grid = document.getElementById("briefGrid");
    if (!mo.length) {
      grid.innerHTML = '<p class="empty">조회 기간에 거래가 없습니다.</p>';
      document.getElementById("briefScript").innerHTML = "";
      return;
    }

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
      briefTable("매매", ["월", "건수", "중위 평당가", "중위 거래가", "전월비"], saleRows) +
      briefTable("전세", ["월", "건수", "중위 보증금", "중위 평당가", "전월비"], jeonseRows) +
      briefTable("월세", ["월", "건수", "중위 보증금", "중위 월세", "준전세 비중"], wolseRows);

    renderBriefScript(mo);
  }

  /* 표에서 바로 읽어 드릴 수 있게 문장으로 풀어 준다.
     예측은 하지 않는다 — 확인된 수치와 그 한계만 적는다.
     "집계중"인 달도 흐름에는 넣되, 미확정이라는 사실을 반드시 함께 말한다. */
  function renderBriefScript(mo) {
    var out = [];

    function trend(get, label) {
      // 한 단지가 30% 넘게 차지한 달은 중위값이 그 단지 값이라 흐름에서 뺀다
      var pts = mo.filter(function (x) { return get(x).n >= MIN_N && get(x).py && !get(x).hot; });
      var any = mo.filter(function (x) { return get(x).n > 0; });
      var total = any.reduce(function (a, x) { return a + get(x).n; }, 0);

      if (!total) return "<b>" + label + "</b>는 조회 기간에 거래가 없습니다.";

      if (pts.length < 2) {
        // 왜 못 내는지를 정확히 적는다 — 표본이 얇아서인지, 한 단지 쏠림 때문인지
        var enough = mo.filter(function (x) { return get(x).n >= MIN_N && get(x).py; });
        var hotOnly = enough.filter(function (x) { return get(x).hot; });
        var last1 = any[any.length - 1];
        var head = "<b>" + label + "</b>는 조회 기간 <b>" + total.toLocaleString() + "건</b>이지만, ";
        var why, how;
        if (hotOnly.length) {
          why = "값이 쓸 만한 달 대부분이 <b>" +
                hotOnly.map(function (x) { return moLabel(x.m) + " " + esc(get(x).hot[0]); }).join(", ") +
                "</b>처럼 <b>한 단지에 쏠려</b> 있어 <b>월별 흐름을 말씀드리기 어렵습니다</b>. ";
          how = "<b>자치구 단위로 넓혀</b> 보시거나, 아래 TOP10에서 <b>개별 단지</b>로 설명하세요.";
        } else if (enough.length) {
          why = "값을 쓸 만한 달이 <b>" + moLabel(enough[0].m) + " 한 달뿐</b>이라 " +
                "<b>비교할 대상이 없습니다</b>. ";
          how = "<b>조회 기간을 6개월 이상으로 넓혀</b> 보시길 권합니다.";
        } else {
          why = "달마다 " + MIN_N + "건이 안 돼 <b>월별 흐름을 말씀드리기 어렵습니다</b>. ";
          how = "<b>조회 기간을 6개월 이상으로 넓혀</b> 보시길 권합니다.";
        }
        return head + why +
          "가장 최근은 " + moLabel(last1.m) + " " + get(last1).n + "건" +
          (get(last1).py ? ", 중위 평당가 " + Math.round(get(last1).py).toLocaleString() + "만원" : "") +
          "입니다. " + how;
      }

      var a2 = pts[0], b2 = pts[pts.length - 1];
      var r = (get(b2).py - get(a2).py) / get(a2).py * 100;
      var word = Math.abs(r) < 1.5 ? "사실상 보합" : (r > 0 ? "상승" : "약세");
      var t = "<b>" + label + "</b>는 " + moLabel(a2.m) + " 평당 " +
        Math.round(get(a2).py).toLocaleString() + "만원(" + get(a2).n + "건)에서 " +
        moLabel(b2.m) + " " + Math.round(get(b2).py).toLocaleString() + "만원(" + get(b2).n + "건)으로 <b>" +
        (r > 0 ? "+" : "") + r.toFixed(1) + "% — " + word + "</b>입니다.";
      if (isPending(b2.m)) t += " 다만 " + moLabel(b2.m) + "은 <b>아직 집계 중</b>이라 확정치가 아닙니다.";

      // 첫 달과 마지막 달만 비교하면 중간의 큰 출렁임이 가려진다.
      // 고점·저점이 15% 넘게 벌어지면 "단일 추세"로 말하지 않도록 붙여 준다.
      if (pts.length >= 3) {
        var vals = pts.map(function (x) { return get(x).py; });
        var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
        if (lo && (hi - lo) / lo * 100 >= 15) {
          var hiM = pts[vals.indexOf(hi)], loM = pts[vals.indexOf(lo)];
          t += " <b>그런데 한 방향으로 움직인 게 아닙니다</b> — " +
               "고점은 " + moLabel(hiM.m) + " " + Math.round(hi).toLocaleString() + "만원, " +
               "저점은 " + moLabel(loM.m) + " " + Math.round(lo).toLocaleString() + "만원으로 " +
               "<b>" + Math.round((hi - lo) / lo * 100) + "%</b> 벌어집니다. " +
               "<b>달마다 어느 단지가 팔렸는지에 따라 중위값이 흔들린 것</b>이니, " +
               "고객께는 “상승”보다 <b>“단지별로 확인이 필요하다”</b>고 말씀하시는 편이 안전합니다.";
        }
      }

      var skipped = mo.filter(function (x) { return get(x).n > 0 && get(x).n < MIN_N; });
      if (skipped.length) {
        t += " (" + skipped.map(function (x) { return moLabel(x.m); }).join("·") +
             "은 표본 " + MIN_N + "건 미만이라 흐름에서 뺐습니다.)";
      }
      var hots = mo.filter(function (x) { return get(x).hot && get(x).n >= MIN_N; });
      if (hots.length) {
        t += " (" + hots.map(function (x) {
          return moLabel(x.m) + "은 <b>" + esc(get(x).hot[0]) + "</b> 한 단지가 " + get(x).hot[1] + "건";
        }).join(", ") + "이라 흐름에서 뺐습니다. <b>한 단지 물량이 통째로 신고되면 " +
        "그 달 중위값은 그 단지 값</b>이 됩니다.)";
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
      var t3 = "<b>월세</b>는 중위 월세가 " + Math.round(wa.wolse.rent).toLocaleString() + "만원 → " +
        Math.round(wb.wolse.rent).toLocaleString() + "만원(" + (rentGap > 0 ? "+" : "") +
        rentGap.toFixed(0) + "%), 중위 보증금이 " + eokman(wa.wolse.dep) + " → " + eokman(wb.wolse.dep) +
        ", 준전세 비중이 " + jrA + "% → " + jrB + "%입니다.";
      if (jrB - jrA >= 8 && rentGap < 0) {
        t3 += " <b>보증금을 올리고 월세를 낮추는 준전세로 옮겨가는 중</b>입니다. " +
              "위 지수 그래프의 월세선은 환산보증금 기준이라 <b>반대로 오르게 보이니</b> 주의하세요.";
      } else if (jrA - jrB >= 8 && rentGap > 0) {
        t3 += " <b>보증금을 낮추고 월세를 늘리는 쪽</b>으로 움직였습니다.";
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
      out.push("<b>거래량</b>은 " + moLabel(va.m) + " " + na.toLocaleString() + "건 → " +
        moLabel(vb.m) + " " + nb.toLocaleString() + "건입니다. (신고가 마감된 달끼리만 비교)");
    }

    var pend = mo.filter(function (x) { return isPending(x.m); });
    if (pend.length) {
      out.push("<b>" + pend.map(function (x) { return moLabel(x.m); }).join("·") +
        "은 아직 집계 중입니다.</b> 실거래 신고 기한이 계약일로부터 30일이라 앞으로 건수가 더 늘어납니다. " +
        "<b>“거래가 끊겼다”고 말씀하시면 안 됩니다.</b>");
    }

    out.push("모든 수치는 <b>국토교통부 실거래 신고 원본</b> 기준이며, " +
      regionLabel() + " " + win().label + " 구간입니다. 표의 <b>*</b> 표시는 표본 " + MIN_N +
      "건 미만이라 시세 변동으로 보기 어려운 등락률입니다.");

    document.getElementById("briefScript").innerHTML =
      out.map(function (t) { return "<li>" + t + "</li>"; }).join("");
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
