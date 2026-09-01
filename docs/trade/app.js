/* ════════════════════════════════════════════════════════════════════
   상권분석 대시보드 — 서울 1,650개 상권
   데이터: window.TRADE_DATA (../data/trade.js) + window.SANGGA_DATA (실거래)

   자치구 -> 행정동 -> 상권 순으로 좁혀 보고, 고른 범위에 맞춰 아래 분석이
   전부 다시 계산된다. 자치구·행정동을 고르면 그 안 상권을 합산해 보여준다.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var T = window.TRADE_DATA;
  var SG = window.SANGGA_DATA;
  if (!T || !T.trades) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      '<section class="card-section"><h2>데이터를 불러오지 못했습니다</h2>' +
      '<p class="sec-desc">data/trade.js가 없습니다. <code>py tools/fetch_trade.py</code> 후 ' +
      "<code>py tools/build_trade.py</code>를 실행하세요.</p></section>");
    return;
  }
  window.DASH_DATA = T;

  var TRADES = T.trades;
  var BY_CODE = {};
  TRADES.forEach(function (t) { BY_CODE[t.c] = t; });

  var AGE_LABEL = ["10대", "20대", "30대", "40대", "50대", "60대+"];
  var TM_LABEL = ["00~06", "06~11", "11~14", "14~17", "17~21", "21~24"];
  /* 시간대 칸이 6·5·3·3·4·3시간으로 길이가 제각각이다. 합계를 그대로 비교하면
     6시간짜리 00~06이 늘 1등으로 나온다 — 실제로 1,650곳 중 1,139곳이 그랬다.
     새벽에 붐비는 게 아니라 '자는 사람'이 통째로 잡힌 것이라, 시간당으로 펴서 본다. */
  var TM_HOURS = [6, 5, 3, 3, 4, 3];
  var BIZ_TM = [1, 2, 3, 4, 5];          // 장사가 되는 시간대 — 피크는 이 중에서 고른다
  var DOW_LABEL = ["월", "화", "수", "목", "금", "토", "일"];
  var TYPE_COLOR = {
    "골목상권": "#4fada8", "발달상권": "#4f7fe6",
    "전통시장": "#cf9a45", "관광특구": "#8b4ab8",   // 흰 글씨 대비 4.5를 넘기려고 한 단계 낮췄다
  };
  /* 태그 바탕색이 밝으면 흰 글씨가 안 읽힌다 — 전통시장 금색은 대비가 2.67이었다.
     바탕 밝기를 재서 글자를 검게/희게 뒤집는다. */
  function inkOn(hex) {
    var v = [1, 3, 5].map(function (i) {
      var x = parseInt(hex.substr(i, 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    return (L + 0.05) / 0.05 > 4.5 ? "#16191f" : "#ffffff";
  }

  var CATS = T.cats || [];
  var CAT_COLOR = ["#4f7fe6", "#e0708f", "#4fada8", "#cf9a45", "#9b59d0",
                   "#5aa469", "#d4713f", "#6d7fb3", "#8a93a3"];
  var ALL = "all";
  var QUARTER_DAYS = 91;                 // 유동인구는 분기 합계라 일평균으로 바꿔 본다

  /* ════════════════ 유틸 ════════════════ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function comma(n) { return Math.round(n || 0).toLocaleString(); }

  /* 받침에 맞는 조사를 고른다. '변호사사무소이(가)'처럼 적으면 읽기 사납다. */
  function josa(w, withB, noB) {
    var c = String(w || "").charCodeAt(String(w).length - 1);
    if (!(c >= 0xac00 && c <= 0xd7a3)) return noB;   // 한글이 아니면 받침 없는 쪽
    return (c - 0xac00) % 28 ? withB : noB;
  }
  function perDay(n) { return Math.round((n || 0) / QUARTER_DAYS); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function perHour(v, i) { return Math.round((v || 0) / QUARTER_DAYS / TM_HOURS[i]); }

  /* 장사 시간대(06~24) 안에서 시간당이 가장 많은 칸 */
  function peakTm(fp) {
    var best = BIZ_TM[0];
    BIZ_TM.forEach(function (i) {
      if (fp.tm[i] / TM_HOURS[i] > fp.tm[best] / TM_HOURS[best]) best = i;
    });
    return best;
  }

  function money(man) {
    if (!man) return "-";
    if (man >= 100000000) return (man / 100000000).toFixed(1) + "조원";
    if (man >= 10000) return comma(man / 10000) + "억원";
    return comma(man) + "만원";
  }

  function qLabel(code) {
    if (!code || code.length < 5) return "-";
    return code.slice(0, 4) + "년 " + code.slice(4) + "분기";
  }

  /* 차트 눈금·글자를 지금 테마 색으로 — 다크에서 검은 글씨가 안 보인다 */
  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    return {
      txt: cs.getPropertyValue("--txt-dim").trim() || "#667085",
      grid: cs.getPropertyValue("--line-soft").trim() || "#e7eaf1",
    };
  }

  /* ════════════════ 지역 상태 ════════════════ */

  var state = { gu: ALL, dong: ALL, code: ALL };

  function scopeTrades() {
    if (state.code !== ALL) return [BY_CODE[state.code]].filter(Boolean);
    return TRADES.filter(function (t) {
      if (state.gu !== ALL && t.gu !== state.gu) return false;
      if (state.dong !== ALL && t.dong !== state.dong) return false;
      return true;
    });
  }

  function scopeName() {
    if (state.code !== ALL) {
      var t = BY_CODE[state.code];
      return t ? t.n : "";
    }
    if (state.dong !== ALL) return state.gu + " " + state.dong;
    if (state.gu !== ALL) return state.gu + " 전체";
    return "서울시 전체";
  }

  /* 여러 상권을 하나로 합친다. 개폐업률은 합친 뒤 다시 계산해야 뜻이 산다. */
  function aggregate(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];

    var fp = { tot: 0, ml: 0, fml: 0, age: [0, 0, 0, 0, 0, 0], tm: [0, 0, 0, 0, 0, 0], dow: [0, 0, 0, 0, 0, 0, 0] };
    var st = { tot: 0, frc: 0, opn: 0, cls: 0, top: [],
               cat: CATS.map(function () { return [0, 0, 0]; }) };
    var sl = { amt: 0, cnt: 0, mdwk: 0, wkend: 0, dow: [0, 0, 0, 0, 0, 0, 0], tm: [0, 0, 0, 0, 0, 0],
               top: [], cat: CATS.map(function () { return 0; }) };
    var stTop = {}, slTop = {}, area = 0, hasFp = false, hasSt = false, hasSl = false;
    var lat = 0, lng = 0, wsum = 0;

    list.forEach(function (t) {
      area += t.ar || 0;
      var w = (t.fp && t.fp.tot) || 1;
      lat += t.lat * w; lng += t.lng * w; wsum += w;

      if (t.fp) {
        hasFp = true;
        fp.tot += t.fp.tot; fp.ml += t.fp.ml; fp.fml += t.fp.fml;
        t.fp.age.forEach(function (v, i) { fp.age[i] += v; });
        t.fp.tm.forEach(function (v, i) { fp.tm[i] += v; });
        t.fp.dow.forEach(function (v, i) { fp.dow[i] += v; });
      }
      if (t.st) {
        hasSt = true;
        st.tot += t.st.tot; st.frc += t.st.frc; st.opn += t.st.opn; st.cls += t.st.cls;
        if (t.st.cat) t.st.cat.forEach(function (v, i) {
          st.cat[i][0] += v[0]; st.cat[i][1] += v[1]; st.cat[i][2] += v[2];
        });
        t.st.top.forEach(function (r) {
          var e = stTop[r.n] || (stTop[r.n] = { n: r.n, c: 0, f: 0, o: 0, x: 0 });
          e.c += r.c; e.f += r.f; e.o += r.o; e.x += r.x;
        });
      }
      if (t.sl) {
        hasSl = true;
        sl.amt += t.sl.amt; sl.cnt += t.sl.cnt; sl.mdwk += t.sl.mdwk; sl.wkend += t.sl.wkend;
        if (t.sl.cat) t.sl.cat.forEach(function (v, i) { sl.cat[i] += v; });
        t.sl.dow.forEach(function (v, i) { sl.dow[i] += v; });
        t.sl.tm.forEach(function (v, i) { sl.tm[i] += v; });
        t.sl.top.forEach(function (r) {
          var e = slTop[r.n] || (slTop[r.n] = { n: r.n, a: 0, c: 0 });
          e.a += r.a; e.c += r.c;
        });
      }
    });

    st.opr = st.tot ? Math.round(st.opn / st.tot * 1000) / 10 : 0;
    st.clr = st.tot ? Math.round(st.cls / st.tot * 1000) / 10 : 0;
    st.top = Object.keys(stTop).map(function (k) { return stTop[k]; })
      .sort(function (a, b) { return b.c - a.c; }).slice(0, 16);
    sl.top = Object.keys(slTop).map(function (k) { return slTop[k]; })
      .sort(function (a, b) { return b.a - a.a; }).slice(0, 16);

    return {
      c: ALL, n: scopeName(), t: "합산", gu: state.gu === ALL ? "" : state.gu,
      dong: state.dong === ALL ? "" : state.dong, ar: area,
      lat: wsum ? lat / wsum : 37.5535, lng: wsum ? lng / wsum : 126.9905,
      fp: hasFp ? fp : null, st: hasSt ? st : null, sl: hasSl ? sl : null,
      _count: list.length,
    };
  }

  /* ════════════════ 순위 ════════════════ */

  function val(t, key) {
    if (!t) return 0;
    if (key === "fp") return t.fp ? t.fp.tot : 0;
    if (key === "st") return t.st ? t.st.tot : 0;
    if (key === "sl") return t.sl ? t.sl.amt : 0;
    return 0;
  }

  var _rank = {};
  function rankIn(scope, key) {
    var ck = scope + "|" + key;
    if (_rank[ck]) return _rank[ck];
    var pool = TRADES.filter(function (t) {
      return (scope === "서울" || t.gu === scope) && val(t, key);
    }).sort(function (a, b) { return val(b, key) - val(a, key); });
    var map = {};
    pool.forEach(function (t, i) { map[t.c] = i + 1; });
    _rank[ck] = { map: map, n: pool.length };
    return _rank[ck];
  }

  /* 서울 전체 상권의 중앙값 — "평균 대비 몇 %"를 내는 기준 */
  var _seoulMed = null;
  function seoulMedian(key) {
    if (!_seoulMed) _seoulMed = {};
    if (_seoulMed[key] != null) return _seoulMed[key];
    var v = TRADES.map(function (t) { return val(t, key); }).filter(Boolean).sort(function (a, b) { return a - b; });
    _seoulMed[key] = v.length ? v[v.length >> 1] : 0;
    return _seoulMed[key];
  }

  /* 서울 전체 기준선. 개업률 1.9% / 폐업률 2.8% 같은 절대값만 보면
     25개 자치구가 전부 "손바뀜이 잦다"로 나온다 — 서울이 원래 그렇기 때문이다.
     그래서 "서울보다 심한가"로 견준다. */
  var _base = null;
  function seoulBase() {
    if (_base) return _base;
    var opn = 0, cls = 0, tot = 0;
    TRADES.forEach(function (t) {
      if (!t.st) return;
      opn += t.st.opn; cls += t.st.cls; tot += t.st.tot;
    });
    _base = { opr: tot ? opn / tot * 100 : 0, clr: tot ? cls / tot * 100 : 0 };
    _base.churn = _base.clr - _base.opr;
    return _base;
  }

  /* 자치구 25개를 상권 하나당 평균 유동인구로 줄 세운다.
     구를 고르면 "서울 25개 구 중 몇 위"로 말할 수 있어야 브리핑이 된다.
     서울 중앙값과 견주면 25개 구 중 18개가 같은 칸에 몰려 쓸모가 없었다. */
  var _guRank = null;
  function guRank() {
    if (_guRank) return _guRank;
    var agg = {};
    TRADES.forEach(function (t) {
      if (!t.gu || !t.fp) return;
      var e = agg[t.gu] || (agg[t.gu] = { sum: 0, n: 0 });
      e.sum += t.fp.tot; e.n += 1;
    });
    var arr = Object.keys(agg).map(function (g) {
      return { gu: g, avg: agg[g].sum / agg[g].n };
    }).sort(function (a, b) { return b.avg - a.avg; });
    _guRank = { map: {}, n: arr.length };
    arr.forEach(function (x, i) { _guRank.map[x.gu] = i + 1; });
    return _guRank;
  }

  /* ════════════════ 검색 ════════════════ */

  function searchTrade(q, limit) {
    q = (q || "").replace(/\s+/g, "").toLowerCase();
    if (!q) return [];
    var hit = [];
    for (var i = 0; i < TRADES.length; i++) {
      var t = TRADES[i];
      var nm = t.n.replace(/\s+/g, "").toLowerCase();
      var at = nm.indexOf(q);
      var wide = (t.n + t.gu + t.dong).replace(/\s+/g, "").toLowerCase().indexOf(q);
      if (at === -1 && wide === -1) continue;
      hit.push({ t: t, at: at === -1 ? 99 : at });
    }
    hit.sort(function (a, b) {
      if (a.at !== b.at) return a.at - b.at;
      return val(b.t, "fp") - val(a.t, "fp");
    });
    return hit.slice(0, limit || 12).map(function (x) { return x.t; });
  }

  function distM(lat1, lng1, lat2, lng2) {
    var dy = (lat1 - lat2) * 111000;
    var dx = (lng1 - lng2) * 111000 * Math.cos(lat1 * Math.PI / 180);
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }

  /* ════════════════ 지역 고르기 ════════════════ */

  var pickGu = document.getElementById("pickGu");
  var pickDong = document.getElementById("pickDong");
  var pickTrade = document.getElementById("pickTrade");

  function chipHtml(v, label, on, sub) {
    return '<button data-v="' + esc(v) + '"' + (on ? ' class="active"' : "") + ">" +
      esc(label) + (sub ? '<span class="chip-sub">' + esc(sub) + "</span>" : "") + "</button>";
  }

  function fillGu() {
    pickGu.innerHTML = chipHtml(ALL, "서울 전체", state.gu === ALL, comma(TRADES.length) + "곳") +
      T.gus.map(function (g) {
        var n = TRADES.filter(function (t) { return t.gu === g; }).length;
        return chipHtml(g, g, state.gu === g, n + "곳");
      }).join("");
  }

  function fillDong() {
    var row = document.getElementById("pickDongRow");
    if (state.gu === ALL) { row.hidden = true; return; }
    row.hidden = false;
    var dongs = {};
    TRADES.forEach(function (t) {
      if (t.gu === state.gu && t.dong) dongs[t.dong] = (dongs[t.dong] || 0) + 1;
    });
    var keys = Object.keys(dongs).sort();
    pickDong.innerHTML = chipHtml(ALL, "구 전체", state.dong === ALL, comma(
      TRADES.filter(function (t) { return t.gu === state.gu; }).length) + "곳") +
      keys.map(function (d) { return chipHtml(d, d, state.dong === d, dongs[d] + "곳"); }).join("");
  }

  function fillTrade() {
    var row = document.getElementById("pickTradeRow");
    if (state.gu === ALL) { row.hidden = true; return; }
    var list = scopeTradesForPick();
    if (list.length < 2) { row.hidden = true; return; }
    row.hidden = false;
    // 유동인구 많은 순 — 고를 만한 곳이 앞에 온다
    list = list.slice().sort(function (a, b) { return val(b, "fp") - val(a, "fp"); });
    pickTrade.innerHTML = chipHtml(ALL, state.dong === ALL ? "구 전체 합산" : "동 전체 합산", state.code === ALL, list.length + "곳 합산") +
      list.map(function (t) {
        return chipHtml(t.c, t.n, state.code === t.c, comma(perDay(val(t, "fp"))) + "명");
      }).join("");
  }

  function scopeTradesForPick() {
    return TRADES.filter(function (t) {
      if (t.gu !== state.gu) return false;
      if (state.dong !== ALL && t.dong !== state.dong) return false;
      return true;
    });
  }

  pickGu.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    state.gu = b.dataset.v; state.dong = ALL; state.code = ALL;
    refresh();
  });
  pickDong.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    state.dong = b.dataset.v; state.code = ALL;
    refresh();
  });
  pickTrade.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]");
    if (!b) return;
    state.code = b.dataset.v;
    refresh();
  });

  function refresh() {
    fillGu(); fillDong(); fillTrade();
    var list = scopeTrades();
    document.getElementById("pickNote").innerHTML =
      "<b>" + esc(scopeName()) + "</b> — 상권 " + comma(list.length) + "곳" +
      (state.code === ALL && list.length > 1 ? " <b>합산</b> 기준으로 아래를 계산했습니다." : " 기준입니다.");
    render(aggregate(list), list);
  }

  /* 검색·주소로 상권을 직접 고르면 상태도 같이 맞춘다 */
  function gotoTrade(code) {
    var t = BY_CODE[code];
    if (!t) return;
    state.gu = t.gu; state.dong = t.dong; state.code = t.c;
    refresh();
    document.getElementById("sec-sum").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ════════════════ 검색창 ════════════════ */

  (function initSearch() {
    document.getElementById("qNote").textContent = qLabel(T.quarter.flpop);

    var input = document.getElementById("trSearch");
    var drop = document.getElementById("trDrop");
    var hits = [], cursor = -1;

    function close() { drop.hidden = true; cursor = -1; }
    function paint() {
      if (!hits.length) { close(); return; }
      drop.innerHTML = hits.map(function (t, i) {
        return '<button type="button" class="finder-item' + (i === cursor ? " is-on" : "") +
          '" data-c="' + esc(t.c) + '">' +
          '<span class="fi-name">' + esc(t.n) + "</span>" +
          '<span class="fi-where">' + esc(t.gu) + " " + esc(t.dong) + " · " + esc(t.t) + "</span>" +
          '<span class="fi-cnt">일평균 ' + comma(perDay(val(t, "fp"))) + "명</span></button>";
      }).join("");
      drop.hidden = false;
    }
    function run() { hits = searchTrade(input.value, 12); cursor = -1; paint(); }

    input.addEventListener("input", run);
    input.addEventListener("focus", function () { if (input.value) run(); });
    input.addEventListener("keydown", function (e) {
      if (drop.hidden || !hits.length) return;
      if (e.key === "ArrowDown") { cursor = Math.min(cursor + 1, hits.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { cursor = Math.max(cursor - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter") { gotoTrade(hits[cursor < 0 ? 0 : cursor].c); close(); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    drop.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-c]");
      if (!b) return;
      gotoTrade(b.dataset.c);
      close();
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".finder-input")) close();
    });

    document.getElementById("trAddrBtn").addEventListener("click", findByAddr);
    document.getElementById("trAddr").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { findByAddr(); e.preventDefault(); }
    });
  })();

  /* 주소는 카카오 키를 브라우저에 노출하지 않으려고 지오코딩을 쓰지 않는다.
     자치구·동 이름을 뽑아 그 범위로 좁혀 준다. */
  function findByAddr() {
    var q = (document.getElementById("trAddr").value || "").trim();
    var note = document.getElementById("trAddrNote");
    if (!q) { note.textContent = ""; return; }

    var gu = (q.match(/([가-힣]+구)/) || [])[1] || "";
    if (!gu || T.gus.indexOf(gu) === -1) {
      note.innerHTML = "서울 자치구를 못 찾았습니다. <b>'서울 동작구 노량진동'</b>처럼 넣어 주세요.";
      return;
    }
    state.gu = gu; state.dong = ALL; state.code = ALL;

    var dongRaw = (q.match(/([가-힣0-9]+동)/) || [])[1] || "";
    if (dongRaw) {
      // 먼저 행정동 이름이 그대로 있는지 본다 — '상도1동'을 넣었으면 그 동만 잡아야 한다.
      // 없으면 법정동을 넣은 것으로 보고('노량진동') 앞부분이 같은 행정동을 모은다.
      var exact = TRADES.filter(function (t) { return t.gu === gu && t.dong === dongRaw; });
      var stem = dongRaw.replace(/[0-9]+동$/, "").replace(/동$/, "");
      var cands = exact.length ? exact : TRADES.filter(function (t) {
        return t.gu === gu && stem && t.dong.indexOf(stem) === 0;
      });
      var dongs = {};
      cands.forEach(function (t) { dongs[t.dong] = (dongs[t.dong] || 0) + 1; });
      var keys = Object.keys(dongs).sort();
      // 법정동 하나가 행정동 여럿으로 갈리는 경우가 있다(노량진동 -> 노량진1동·2동).
      // 그럴 때 하나를 멋대로 고르면 안 되고, 안내와 실제 범위가 어긋나도 안 된다.
      if (keys.length === 1) {
        state.dong = keys[0];
        note.innerHTML = "<b>" + esc(gu) + " " + esc(keys[0]) + "</b> 범위로 잡았습니다.";
      } else if (keys.length > 1) {
        note.innerHTML = "<b>" + esc(dongRaw) + "</b>은 행정동이 <b>" + esc(keys.join(" · ")) +
          "</b>으로 나뉘어 있어 <b>" + esc(gu) + " 전체</b>로 두었습니다. " +
          "아래 <b>행정동</b>에서 골라 좁히세요.";
      } else {
        note.innerHTML = "<b>" + esc(gu) + "</b>로 잡았습니다. 행정동은 아래에서 고르세요.";
      }
    } else {
      note.innerHTML = "<b>" + esc(gu) + "</b>로 잡았습니다. 행정동·상권은 아래에서 좁히세요.";
    }
    refresh();
    document.getElementById("sec-sum").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ════════════════ 차트 ════════════════ */

  var charts = {};
  function destroyCharts() {
    Object.keys(charts).forEach(function (k) {
      if (charts[k]) { charts[k].destroy(); delete charts[k]; }
    });
  }

  function bar(id, labels, data, color, horizontal, fmt) {
    var el = document.getElementById(id);
    if (!el) return;
    var c = themeColors();
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: color, borderRadius: 4 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (x) { return fmt ? fmt(x.parsed[horizontal ? "x" : "y"]) : comma(x.parsed[horizontal ? "x" : "y"]); } } },
        },
        scales: {
          x: { ticks: { color: c.txt, font: { size: 10.5 } }, grid: { color: c.grid, display: !horizontal } },
          y: { beginAtZero: true, ticks: { color: c.txt, font: { size: 10.5 } }, grid: { color: c.grid } },
        },
      },
    });
  }

  function donut(id, labels, data, colors) {
    var el = document.getElementById(id);
    if (!el) return;
    var c = themeColors();
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: { legend: { position: "right", labels: { color: c.txt, boxWidth: 10, font: { size: 11 } } } },
      },
    });
  }

  /* ════════════════ 결론 ════════════════ */

  function conclHtml(tag, tone, lines, advice) {
    return '<div class="cc ' + tone + '">' +
      '<div class="cc-head"><span class="cc-badge">결론</span><b>' + tag + "</b></div>" +
      '<p class="cc-why">' + lines.join(" ") + "</p>" +
      '<p class="cc-do"><span>첨언</span>' + advice + "</p></div>";
  }

  function concl(t, list) {
    if (!t || !t.fp || !t.st) {
      return conclHtml("자료가 모자란 범위", "flat",
        ["유동인구나 점포 통계가 비어 있습니다."],
        "범위를 <b>자치구 전체</b>로 넓혀 보시거나, 아래 <b>실거래</b>와 현장 확인으로 판단하세요.");
    }
    var single = list.length === 1;
    var med = seoulMedian("fp") || 1;
    var base = seoulBase();
    // 합산 범위는 상권 하나당 평균으로 견줘야 한다. 총합으로 보면 구를 고르는 순간
    // 무조건 서울 중앙값의 몇 배가 되어 25개 구가 전부 같은 결론으로 나왔다.
    var ratio = Math.round(t.fp.tot / list.length / med * 100);
    var churn = t.st.clr - t.st.opr;
    var churnGap = churn - base.churn;          // 서울보다 얼마나 더 빠져나가는가

    var tag, tone, advice;
    var busy, quiet;
    if (single) {
      var R = rankIn("서울", "fp");
      busy = (R.map[t.c] || 9999) <= Math.ceil(R.n / 3);
      quiet = (R.map[t.c] || 0) >= R.n - Math.ceil(R.n / 3);
    } else if (state.gu !== ALL && state.dong === ALL) {
      // 구 전체 — 25개 구 안에서 상위/하위 1/3
      var G = guRank();
      var r = G.map[state.gu] || 99;
      busy = r <= Math.ceil(G.n / 3);
      quiet = r >= G.n - Math.ceil(G.n / 3) + 1;
    } else {
      // 동 단위나 서울 전체 — 상권 하나당 평균으로 견준다
      busy = ratio >= 160;
      quiet = ratio <= 70;
    }
    // 합산에서는 '서울보다 0.4%p 넘게 심한가'를 손바뀜 기준으로 삼는다
    var churnBad = single ? churn > 0 : churnGap > 0.4;
    var churnGood = single ? churn <= 0 : churnGap < -0.4;

    if (busy && churnGood) {
      tag = "사람도 많고 자리도 안정된 " + (single ? "상권" : "범위"); tone = "up";
      advice = "<b>권리금이 붙어 있을 가능성이 큽니다.</b> 매물이 나오면 <b>왜 나왔는지</b>를 반드시 확인하세요.";
    } else if (busy && churnBad) {
      tag = "사람은 많지만 손바뀜이 잦은 " + (single ? "상권" : "범위"); tone = "warn";
      advice = "유동인구만 보고 들어가면 위험합니다. <b>같은 자리에서 몇 번 바뀌었는지</b>, " +
               "<b>임대료가 매출을 감당하는지</b> 꼭 따져 보세요.";
    } else if (busy) {
      tag = "사람이 많이 지나는 " + (single ? "상권" : "범위"); tone = "up";
      advice = "손바뀜은 서울 평균 수준입니다. <b>업종이 이 사람들과 맞는지</b>가 관건입니다.";
    } else if (churnBad) {
      tag = "손바뀜이 서울 평균보다 심한 " + (single ? "상권" : "범위"); tone = "warn";
      advice = "폐업이 서울 평균보다 <b>" + churnGap.toFixed(1) + "%p</b> 많습니다. " +
               "아래 <b>업종별 순증감</b>에서 어떤 업종이 빠져나가는지 꼭 보고 들어가세요.";
    } else if (quiet && churnBad) {
      tag = "사람도 적고 빠져나가는 " + (single ? "상권" : "범위"); tone = "down";
      advice = "<b>신중하셔야 합니다.</b> 배후 수요가 확실한 업종이 아니면 권하기 어렵습니다.";
    } else if (quiet) {
      tag = "조용하지만 자리는 지키는 " + (single ? "상권" : "범위"); tone = "flat";
      advice = "임대료 부담이 적어 <b>단골 장사</b>에는 맞습니다. 대신 <b>지나가는 손님은 기대하지 마세요.</b>";
    } else {
      tag = "서울 평균 근처"; tone = "flat";
      advice = "특별히 앞서지도 뒤처지지도 않습니다. <b>업종 구성</b>과 <b>임대료 수준</b>으로 판단하세요.";
    }

    var why = [];
    if (single) {
      var RK = rankIn("서울", "fp");
      why.push("일평균 유동인구 <b>" + comma(perDay(t.fp.tot)) + "명</b>으로 서울 " +
        comma(RK.n) + "개 상권 중 <b>" + comma(RK.map[t.c] || 0) + "위</b>입니다.");
    } else {
      var head = "상권 <b>" + comma(list.length) + "곳</b>을 합쳐 일평균 유동인구 <b>" +
        comma(perDay(t.fp.tot)) + "명</b>";
      if (state.gu !== ALL && state.dong === ALL) {
        var GR = guRank();
        head += "이고, 상권 하나당으로 보면 <b>서울 " + GR.n + "개 구 중 " +
          (GR.map[state.gu] || "-") + "위</b>입니다.";
      } else {
        head += "이고, 상권 하나당으로 보면 서울 중앙값의 <b>" + ratio + "%</b> 수준입니다.";
      }
      why.push(head);
    }
    why.push("점포는 <b>" + comma(t.st.tot) + "개</b>, 개업률 <b>" + t.st.opr + "%</b> · 폐업률 <b>" + t.st.clr + "%</b>" +
      (Math.abs(churn) >= 0.3
        ? "로 " + (churn > 0 ? "폐업이 " + churn.toFixed(1) + "%p 많습니다" : "개업이 " + (-churn).toFixed(1) + "%p 많습니다")
        : "로 들고 나는 수가 비슷합니다") +
      " — 서울 전체(개업 " + base.opr.toFixed(1) + "% · 폐업 " + base.clr.toFixed(1) + "%)보다 <b>" +
      (Math.abs(churnGap) < 0.2 ? "비슷한 수준" :
        churnGap > 0 ? churnGap.toFixed(1) + "%p 심합니다" : (-churnGap).toFixed(1) + "%p 낫습니다") + "</b>.");
    if (t.sl) {
      why.push("추정 월매출은 <b>" + money(Math.round(t.sl.amt / 3)) + "</b>" +
        (t.st.tot ? ", 점포 하나당 <b>" + money(Math.round(t.sl.amt / 3 / t.st.tot)) + "</b>" : "") + "입니다.");
    }
    return conclHtml(tag, tone, why, advice);
  }

  /* ════════════════ 그리기 ════════════════ */

  function render(t, list) {
    destroyCharts();
    var host = document.getElementById("trResult");
    if (!t) {
      host.innerHTML = '<section class="card-section"><p class="placeholder">이 범위에는 상권이 없습니다.</p></section>';
      return;
    }
    var single = list.length === 1;
    var nrg = nrgOf(state.gu);

    host.innerHTML =
      section("sec-sum", "📊", scopeName() + (single ? "" : " 합산"), "",
        kpiHtml(t, list) + concl(t, list)) +
      (t.fp ? section("sec-fp", "👥", "유동인구", "분기 합계를 91일로 나눈 <b>일평균</b>입니다.",
        fpHtml(t)) : "") +
      (t.st ? section("sec-st", "🏪", "점포 · 개폐업", "업종별 점포 수와 그 분기의 개업·폐업입니다.",
        stHtml(t)) : "") +
      (t.sl ? section("sec-sl", "💳", "추정 매출", "서울시가 카드 결제 등으로 <b>추정</b>한 값입니다.",
        slHtml(t)) : "") +
      section("sec-nrg", "🏢", (state.gu === ALL ? "서울" : state.gu) + " 상업업무용 실거래", "", nrgHtml(nrg)) +
      section("sec-yield", "🧮", "수익률 계산",
        "매물 조건을 넣으면 즉시 계산됩니다. <b>취득세 등 4.6%</b>를 투입금에 넣을지 고르실 수 있습니다.",
        yieldFormHtml() + '<div id="yieldOut"></div>') +
      section("sec-map", "🗺️", single ? "위치 · 인근 상권" : "상권 분포 · 업종 지도",
        single ? "가까운 상권을 함께 표시합니다. 원을 누르면 그 상권으로 넘어갑니다."
               : "원 크기는 유동인구, 색은 상권 유형입니다. 원을 누르면 그 상권만 따로 봅니다.",
        '<div class="map-wrap">' +
          '<div class="map-box"><div id="trMap"></div></div>' +
          '<div id="mapSide"></div>' +
        "</div>" +
        '<div id="nearList"></div>') +
      section("sec-ind", "🔍", "업종별 세부분석",
        "업종을 고르시면 <b>그 업종만</b> 따로 봅니다. 고객이 " +
        "\"여기서 카페 하면 되겠냐\"고 물으실 때 쓰시면 됩니다.",
        '<div class="finder-bar"><label for="indPick">업종</label>' +
        '<select id="indPick" class="ind-sel"></select></div><div id="indBody"></div>') +
      section("sec-cmp", "⚖️", "상권 비교", "비교할 상권을 고르면 나란히 놓고 봅니다. 최대 4곳까지.",
        '<div class="finder-bar"><label for="cmpSearch">상권 추가</label>' +
        '<div class="finder-input"><input type="text" id="cmpSearch" placeholder="상권 이름" autocomplete="off" />' +
        '<div class="finder-drop" id="cmpDrop" hidden></div></div></div><div id="cmpBody"></div>');

    if (t.fp) drawFp(t);
    if (t.st) drawSt(t);
    if (t.sl) drawSl(t);
    initYield();
    drawMap(t, list, single);
    drawMapSide(t);
    initIndustry(t, list);
    initCompare(list);

    document.getElementById("printBanner").innerHTML =
      "<b>" + esc(scopeName()) + "</b> 상권분석 · 상권 " + comma(list.length) + "곳 · " +
      qLabel(T.quarter.flpop) + " 기준 · 반포114공인중개사 010-9442-2027";
  }

  function section(id, ico, title, desc, body) {
    return '<section class="card-section" id="' + id + '">' +
      '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" ' +
      "onerror=\"this.style.display='none'\"> " + ico + " " + esc(title) + "</h2>" +
      '<button class="sec-print-btn" onclick="printSection(\'' + id + '\')">이 섹션 인쇄</button></div>' +
      (desc ? '<p class="sec-desc">' + desc + "</p>" : "") + body + "</section>";
  }

  /* ── 요약 KPI ── */
  function kpiHtml(t, list) {
    var single = list.length === 1;
    var R = single && t.fp ? rankIn("서울", "fp") : null;
    var peak = t.fp ? TM_LABEL[peakTm(t.fp)] : "-";
    var bestDow = t.fp ? DOW_LABEL[t.fp.dow.indexOf(Math.max.apply(null, t.fp.dow))] : "-";
    var perStore = (t.sl && t.st && t.st.tot) ? Math.round(t.sl.amt / 3 / t.st.tot) : 0;

    var boxes = [
      { ico: "👥", label: "일평균 유동인구", value: t.fp ? comma(perDay(t.fp.tot)) + "명" : "-",
        sub: R ? "서울 " + comma(R.map[t.c] || 0) + "위 / " + comma(R.n) + "곳"
               : "상권 " + comma(list.length) + "곳 합산" },
      { ico: "🕐", label: "피크 시간대", value: peak + "시",
        sub: "장사 시간대 기준 · 붐비는 요일 " + bestDow + "요일" },
      { ico: "🏪", label: "점포 수", value: t.st ? comma(t.st.tot) + "개" : "-",
        sub: t.st ? "프랜차이즈 " + comma(t.st.frc) + "개 (" + pct(t.st.frc, t.st.tot) + "%)" : "" },
      { ico: "🔄", label: "개업 / 폐업률", value: t.st ? t.st.opr + "% / " + t.st.clr + "%" : "-",
        sub: t.st ? "개업 " + comma(t.st.opn) + " · 폐업 " + comma(t.st.cls) + "개" : "" },
      { ico: "💳", label: "추정 월매출", value: t.sl ? money(Math.round(t.sl.amt / 3)) : "-",
        sub: perStore ? "점포당 " + money(perStore) : "" },
    ];
    return '<div class="kpi-row">' + boxes.map(function (b) {
      return '<div class="kpi"><div class="kpi-ico">' + b.ico + "</div>" +
        '<div class="kpi-body"><div class="kpi-label">' + b.label + "</div>" +
        '<div class="kpi-value">' + b.value + "</div>" +
        '<div class="kpi-sub">' + b.sub + "</div></div></div>";
    }).join("") + "</div>";
  }

  /* ── 유동인구 ── */
  function fpHtml(t) {
    var med = seoulMedian("fp");
    var ratio = med ? Math.round(t.fp.tot / med * 100) : 0;
    var R = state.code !== ALL ? rankIn("서울", "fp") : null;
    var topPct = R && R.map[t.c] ? Math.max(1, Math.round(R.map[t.c] / R.n * 100)) : 0;
    return '<div class="mini-row">' +
      '<div class="mini"><span>일평균 유동인구</span><b>' + comma(perDay(t.fp.tot)) + "명</b></div>" +
      (topPct ? '<div class="mini"><span>서울 상위</span><b>' + topPct + "%</b></div>" : "") +
      '<div class="mini"><span>서울 상권 중앙값 대비</span><b class="' +
        (ratio >= 100 ? "up" : "down") + '">' + comma(ratio) + "%</b></div>" +
      "</div>" +
      '<div class="tr-charts">' +
        '<div class="tr-chart"><h4>시간대별 <span class="h4-sub">시간당 평균</span></h4><div class="chart-box" style="height:200px"><canvas id="fpTm"></canvas></div></div>' +
        '<div class="tr-chart"><h4>요일별 <span class="h4-sub">일평균</span></h4><div class="chart-box" style="height:200px"><canvas id="fpDow"></canvas></div></div>' +
        '<div class="tr-chart"><h4>연령대별 <span class="h4-sub">일평균</span></h4><div class="chart-box" style="height:200px"><canvas id="fpAge"></canvas></div></div>' +
        '<div class="tr-chart"><h4>성별 구성</h4><div class="chart-box" style="height:200px"><canvas id="fpSex"></canvas></div></div>' +
      "</div>" +
      '<p class="dim-note" style="margin:-4px 0 14px">시간대 칸이 6·5·3·3·4·3시간으로 길이가 달라, ' +
      '<b>시간당 평균</b>으로 펴서 그렸습니다. 합계로 보면 6시간짜리 <b>00~06시</b>가 늘 1등으로 나와 ' +
      '새벽에 붐비는 것처럼 오해하게 됩니다.</p>' +
      '<div id="fpNote"></div>';
  }

  function drawFp(t) {
    var f = t.fp;
    bar("fpTm", TM_LABEL, f.tm.map(perHour), "#4f7fe6", false, function (v) { return comma(v) + "명"; });
    bar("fpDow", DOW_LABEL, f.dow.map(perDay), "#4fada8", false, function (v) { return comma(v) + "명"; });
    bar("fpAge", AGE_LABEL, f.age.map(perDay), "#cf9a45", false, function (v) { return comma(v) + "명"; });
    donut("fpSex", ["남성", "여성"], [f.ml, f.fml], ["#4f7fe6", "#e0708f"]);

    var peakI = peakTm(f);
    var ageI = f.age.indexOf(Math.max.apply(null, f.age));
    var wk = f.dow.slice(0, 5).reduce(function (a, b) { return a + b; }, 0) / 5;
    var we = (f.dow[5] + f.dow[6]) / 2;
    var night = pct(f.tm[0] + f.tm[5], f.tot);

    var lines = [];
    lines.push("장사 시간대 중 가장 붐비는 때는 <b>" + TM_LABEL[peakI] + "시</b>(시간당 " +
      comma(perHour(f.tm[peakI], peakI)) + "명)이고, 가장 많은 연령대는 <b>" + AGE_LABEL[ageI] +
      "</b>(" + pct(f.age[ageI], f.tot) + "%)입니다.");
    lines.push("남녀 비율은 <b>" + pct(f.ml, f.tot) + " : " + pct(f.fml, f.tot) + "</b>입니다.");
    if (we > wk * 1.1) {
      lines.push("<b>주말이 평일보다 " + Math.round((we / wk - 1) * 100) + "% 많습니다</b> — 나들이·외식 수요가 붙는 자리입니다.");
    } else if (wk > we * 1.1) {
      lines.push("<b>평일이 주말보다 " + Math.round((wk / we - 1) * 100) + "% 많습니다</b> — 직장·통근 수요가 중심입니다.");
    } else {
      lines.push("평일과 주말이 <b>비슷합니다</b>.");
    }
    if (night >= 25) lines.push("심야·새벽 비중이 <b>" + night + "%</b>로 높습니다. " +
      "다만 <b>00~06시는 자고 있는 주민이 함께 잡히는 칸</b>이라, 그 자체를 손님으로 보시면 안 됩니다.");

    document.getElementById("fpNote").innerHTML =
      '<div class="read-guide" style="margin-top:16px"><h4>금집부쌤이 보는 유동인구</h4><ol>' +
      lines.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol></div>";
  }

  /* ── 점포 ── */
  /* Chart.js 캔버스 + 아래 표로 두 번 보여 주던 것을, 막대 오른쪽에 숫자를
     같이 적어 하나로 합쳤다. 세로 길이가 절반으로 줄고 눈이 한 번만 움직인다. */
  function stHtml(t) {
    var s = t.st;
    var churn = s.clr - s.opr;
    var base = seoulBase();
    var max = s.top.length ? s.top[0].c : 1;

    var rows = s.top.map(function (r) {
      var net = r.o - r.x;
      var rate = r.c ? Math.round((r.o - r.x) / r.c * 1000) / 10 : 0;
      return '<div class="ib-row">' +
        '<span class="ib-name" title="' + esc(r.n) + '">' + esc(r.n) + "</span>" +
        '<span class="ib-track"><i style="width:' + Math.max(2, r.c / max * 100) + '%"></i></span>' +
        '<span class="ib-num"><b>' + comma(r.c) + "개</b>" +
          '<em class="ib-o">개업 ' + comma(r.o) + "</em>" +
          '<em class="ib-x">폐업 ' + comma(r.x) + "</em>" +
          '<em class="' + (net > 0 ? "ib-up" : net < 0 ? "ib-dn" : "ib-fl") + '">' +
            (net > 0 ? "+" : net < 0 ? "−" : "±") + Math.abs(net) +
            (r.c >= 30 ? " (" + (rate > 0 ? "+" : rate < 0 ? "−" : "±") +
              Math.abs(rate) + "%)" : "") + "</em>" +
        "</span></div>";
    }).join("");

    return '<div class="mini-row">' +
      '<div class="mini"><span>점포 수</span><b>' + comma(s.tot) + "개</b></div>" +
      '<div class="mini"><span>분기 개업률</span><b class="up">' + s.opr + "%</b></div>" +
      '<div class="mini"><span>분기 폐업률</span><b class="down">' + s.clr + "%</b></div>" +
      '<div class="mini"><span>개업 − 폐업</span><b class="' + (churn <= 0 ? "up" : "down") + '">' +
        (churn <= 0 ? "+" : "−") + Math.abs(churn).toFixed(1) + "%p</b>" +
        '<span class="mini-foot">서울 ' + (churn - base.churn > 0 ? "보다 심함" : "보다 나음") + "</span></div>" +
      "</div>" +
      '<h4 class="tr-h4">업종별 점포 수 상위 <span class="h4-sub">막대 오른쪽이 그 분기의 개업·폐업과 순증감</span></h4>' +
      '<div class="ib-list">' + rows + "</div>" +
      '<p class="dim-note" style="margin-top:10px"><b>순증감</b>이 마이너스면 그 업종이 이 범위에서 ' +
      "빠져나가는 중입니다. 괄호 안 %는 그 업종 점포 수 대비이며, <b>점포 30개 미만</b>은 " +
      "숫자가 크게 흔들려 생략했습니다.</p>" +
      stCatHtml(t);
  }

  /* 대분류 구성 — 상위 업종만으로는 전체의 3분의 2밖에 못 덮어 따로 굽는다 */
  function stCatHtml(t) {
    if (!t.st.cat || !CATS.length) return "";
    var tot = t.st.cat.reduce(function (a, v) { return a + v[0]; }, 0);
    if (!tot) return "";
    var idx = CATS.map(function (c, i) { return i; })
      .filter(function (i) { return t.st.cat[i][0]; })
      .sort(function (a, b) { return t.st.cat[b][0] - t.st.cat[a][0]; });
    return '<h4 class="tr-h4">업종 구성 <span class="h4-sub">100개 업종을 8칸으로 묶은 것 · 전체 기준</span></h4>' +
      '<div class="cat-wrap">' +
        '<div class="cat-chart"><canvas id="stCat"></canvas>' +
          '<div class="cat-center"><b>' + comma(tot) + "</b><span>개</span></div></div>" +
        '<div class="cat-legend">' + idx.map(function (i) {
          var v = t.st.cat[i], net = v[1] - v[2];
          return '<div class="cat-item"><i style="background:' + CAT_COLOR[i % CAT_COLOR.length] + '"></i>' +
            '<span class="cat-n">' + esc(CATS[i]) + "</span>" +
            '<span class="cat-p">' + pct(v[0], tot) + "%</span>" +
            '<span class="cat-c">' + comma(v[0]) + "개</span>" +
            '<span class="' + (net > 0 ? "ib-up" : net < 0 ? "ib-dn" : "ib-fl") + '">' +
              (net > 0 ? "+" : net < 0 ? "−" : "±") + Math.abs(net) + "</span></div>";
        }).join("") + "</div>" +
      "</div>";
  }

  function drawSt(t) {
    if (!t.st.cat || !CATS.length) return;
    var idx = CATS.map(function (c, i) { return i; }).filter(function (i) { return t.st.cat[i][0]; })
      .sort(function (a, b) { return t.st.cat[b][0] - t.st.cat[a][0]; });
    var el = document.getElementById("stCat");
    if (!el) return;
    if (charts.stCat) charts.stCat.destroy();
    charts.stCat = new Chart(el, {
      type: "doughnut",
      data: {
        labels: idx.map(function (i) { return CATS[i]; }),
        datasets: [{
          data: idx.map(function (i) { return t.st.cat[i][0]; }),
          backgroundColor: idx.map(function (i) { return CAT_COLOR[i % CAT_COLOR.length]; }),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "66%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (x) { return x.label + " " + comma(x.parsed) + "개"; } } },
        },
      },
    });
  }

  /* ── 매출 ── */
  function slHtml(t) {
    var s = t.sl;
    var perStore = (t.st && t.st.tot) ? Math.round(s.amt / 3 / t.st.tot) : 0;
    var mdwkDay = s.mdwk / 65, weDay = s.wkend / 26;      // 분기 평일 65일 · 주말 26일 근사
    return '<div class="mini-row">' +
      '<div class="mini"><span>추정 월매출</span><b>' + money(Math.round(s.amt / 3)) + "</b></div>" +
      '<div class="mini"><span>점포당 월매출</span><b>' + (perStore ? money(perStore) : "-") + "</b></div>" +
      '<div class="mini"><span>건당 단가</span><b>' +
        (s.cnt ? comma(s.amt / s.cnt * 10000) + "원" : "-") + "</b></div>" +
      '<div class="mini"><span>평일 : 주말</span><b>' + pct(s.mdwk, s.amt) + " : " + pct(s.wkend, s.amt) + "</b></div>" +
      "</div>" +
      '<h4 class="tr-h4">업종별 월매출 <span class="h4-sub">막대 오른쪽이 그 업종의 점포 수와 점포당 월매출</span></h4>' +
      '<div class="ib-list">' + slRows(t) + "</div>" +
      '<h4 class="tr-h4">시간대별 월매출 <span class="h4-sub">시간당 환산</span></h4>' +
      '<div class="chart-box" style="height:220px"><canvas id="slTm"></canvas></div>' +
      '<div class="read-guide" style="margin-top:16px"><h4>금집부쌤이 보는 매출</h4><ol>' +
        "<li>추정 월매출 <b>" + money(Math.round(s.amt / 3)) + "</b>" +
        (perStore ? ", 점포 하나당 <b>" + money(perStore) + "</b> 꼴입니다. " : ". ") +
        "<b>업종마다 편차가 큽니다</b> — 위 업종별 그래프를 함께 보세요.</li>" +
        "<li>" + (weDay > mdwkDay ? "<b>주말 매출이 평일보다 높습니다.</b> 주말 장사가 되는 자리입니다."
                                   : "<b>평일 매출이 주말보다 높습니다.</b> 주말에 쉬는 업종도 고려해 볼 만합니다.") + "</li>" +
        "<li><b>서울시가 카드 결제 등으로 추정한 값</b>입니다. 실제 매출과 다를 수 있으니 " +
        "<b>매도인 장부와 반드시 대조</b>하시고, 고객께도 추정치임을 밝히세요.</li>" +
      "</ol></div>";
  }

  /* 업종별 매출도 막대 오른쪽에 숫자를 같이 적는다.
     점포 수를 붙여야 "매출이 큰 게 아니라 점포가 많은 것"을 구분할 수 있다. */
  function slRows(t) {
    var s = t.sl;
    var stMap = {};
    if (t.st) t.st.top.forEach(function (r) { stMap[r.n] = r.c; });
    var max = s.top.length ? s.top[0].a : 1;
    return s.top.map(function (r) {
      var cnt = stMap[r.n] || 0;
      var per = cnt ? Math.round(r.a / 3 / cnt) : 0;
      return '<div class="ib-row">' +
        '<span class="ib-name" title="' + esc(r.n) + '">' + esc(r.n) + "</span>" +
        '<span class="ib-track"><i class="ib-sl" style="width:' + Math.max(2, r.a / max * 100) + '%"></i></span>' +
        '<span class="ib-num"><b>' + money(Math.round(r.a / 3)) + "</b>" +
          (cnt ? '<em>' + comma(cnt) + "개</em>" : "<em>점포 -</em>") +
          (per ? '<em class="ib-per">점포당 ' + money(per) + "</em>" : "") +
        "</span></div>";
    }).join("");
  }

  function drawSl(t) {
    var s = t.sl;
    // 매출도 칸 길이가 달라 시간당으로 편다 — 안 그러면 00~06이 과장된다
    bar("slTm", TM_LABEL, s.tm.map(function (v, i) { return Math.round(v / 3 / TM_HOURS[i] / 10000 * 10) / 10; }),
      "#cf9a45", false, function (v) { return v + "억원"; });
  }

  /* ── 실거래 ── */
  function nrgOf(gu) {
    if (!SG || !SG.regions || gu === ALL) return null;
    var reg = SG.regions[gu];
    if (!reg || !reg.w) return null;
    var w = reg.w[SG.defaultWindow] || reg.w["12"];
    if (!w) return null;
    return {
      gu: gu, cnt: w.nrgCnt, med: w.med,
      label: (SG.windows && SG.windows[SG.defaultWindow] && SG.windows[SG.defaultWindow].label) || "최근 12개월",
    };
  }

  function nrgHtml(nrg) {
    if (!nrg) {
      return '<p class="placeholder">자치구를 고르시면 그 구의 상업업무용 실거래를 함께 보여드립니다.</p>';
    }
    var tot = (nrg.cnt.shop || 0) + (nrg.cnt.office || 0) + (nrg.cnt.etc || 0);
    return '<p class="sec-desc">' + esc(nrg.label) + " · 국토교통부 상업업무용 매매 신고 기준입니다. " +
      "<b>상권 단위 실거래는 없어</b> 자치구 전체로 보여드립니다.</p>" +
      '<div class="mini-row">' +
        '<div class="mini"><span>상업업무용 매매</span><b>' + comma(tot) + "건</b></div>" +
        '<div class="mini"><span>일반상가</span><b>' + comma(nrg.cnt.shop || 0) + "건</b></div>" +
        '<div class="mini"><span>중위 거래가</span><b>' + (nrg.med.nrg ? money(nrg.med.nrg) : "-") + "</b></div>" +
        '<div class="mini"><span>중위 평당가</span><b>' +
          (nrg.med.nrgPy ? comma(nrg.med.nrgPy) + "만원" : "-") + "</b></div>" +
      "</div>" +
      '<p class="dim-note" style="margin-top:10px">상가 평당가는 <b>연면적 기준</b>이라 아파트 전용면적 평당가와 ' +
      "직접 비교하시면 안 됩니다. 자세한 내용은 <a href='../sangga/index.html'>상가·오피스텔 대시보드</a>에서 보세요.</p>";
  }

  /* ── 수익률 ── */
  function yieldFormHtml() {
    var f = [
      ["yPrice", "매매가 (만원)", "120000"], ["yArea", "전용면적 (㎡)", "66"],
      ["yDep", "보증금 (만원)", "10000"], ["yRent", "월세 (만원)", "400"],
      ["yLoan", "대출금 (만원)", "60000"], ["yRate", "대출 금리 (연 %)", "4.5"],
      ["yCost", "연간 기타경비 (만원)", "300"], ["yVac", "공실률 가정 (%)", "5"],
    ];
    return '<div class="y-grid">' + f.map(function (x) {
      return '<div class="ctl"><label for="' + x[0] + '">' + x[1] + "</label>" +
        '<input type="number" id="' + x[0] + '" placeholder="' + x[2] + '" /></div>';
    }).join("") + "</div>" +
    '<label class="y-check"><input type="checkbox" id="yAcq" checked /> ' +
    "취득비용 포함 <span class='dim-note'>취득세 등 매매가의 4.6%를 투입금에 더합니다</span></label>";
  }

  function initYield() {
    ["yPrice", "yArea", "yDep", "yRent", "yLoan", "yRate", "yCost", "yVac", "yAcq"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", calcYield);
      el.addEventListener("change", calcYield);
    });
    calcYield();
  }

  function calcYield() {
    var n = function (id) { return parseFloat((document.getElementById(id) || {}).value) || 0; };
    var out = document.getElementById("yieldOut");
    if (!out) return;
    var price = n("yPrice"), dep = n("yDep"), rent = n("yRent");
    var loan = n("yLoan"), rate = n("yRate"), cost = n("yCost"), vac = n("yVac");
    var acq = (document.getElementById("yAcq") || {}).checked;
    if (!price || !rent) {
      out.innerHTML = '<p class="placeholder">매매가와 월세를 넣으면 계산됩니다.</p>';
      return;
    }
    var yearRent = rent * 12 * (1 - vac / 100);
    var interest = loan * rate / 100;
    var acqCost = acq ? price * 0.046 : 0;
    var invested = price - dep - loan + acqCost;
    var surface = (rent * 12) / (price - dep) * 100;
    var net = invested > 0 ? (yearRent - interest - cost) / invested * 100 : 0;
    var monthly = (yearRent - interest - cost) / 12;
    var area = n("yArea");
    var pyRent = area ? rent / (area / 3.3058) : 0;

    out.innerHTML =
      '<div class="mini-row" style="margin-top:14px">' +
        '<div class="mini"><span>표면수익률</span><b>' + surface.toFixed(2) + "%</b></div>" +
        '<div class="mini"><span>실투자 수익률</span><b class="' + (net >= 0 ? "up" : "down") + '">' +
          net.toFixed(2) + "%</b></div>" +
        '<div class="mini"><span>실투자금</span><b>' + money(Math.round(invested)) + "</b></div>" +
        '<div class="mini"><span>월 순수입</span><b>' + comma(monthly) + "만원</b></div>" +
        (pyRent ? '<div class="mini"><span>평당 월임대료</span><b>' + pyRent.toFixed(1) + "만원</b></div>" : "") +
      "</div>" +
      '<div class="read-guide" style="margin-top:14px"><h4>금집부쌤이 짚어드리는 주의점</h4><ol>' +
        "<li><b>표면수익률만 보시면 안 됩니다.</b> 대출 이자와 공실을 넣은 <b>실투자 수익률</b>이 " +
        "실제로 손에 남는 몫입니다. 지금 계산으로는 <b>" + surface.toFixed(2) + "% → " + net.toFixed(2) + "%</b>입니다.</li>" +
        "<li>상가 취득세는 <b>4.6%</b>로 주택보다 높습니다. 중개보수·법무비까지 넣으면 더 들어갑니다.</li>" +
        "<li><b>공실 " + vac + "%</b>로 잡았습니다. 위 <b>폐업률</b>을 보고 이 가정이 현실적인지 판단하세요.</li>" +
      "</ol></div>";
  }

  /* ── 지도 ── */
  var map = null, layer = null;
  function drawMap(t, list, single) {
    var el = document.getElementById("trMap");
    if (!el || typeof L === "undefined") return;
    if (map) { map.remove(); map = null; }
    map = L.map(el, { scrollWheelZoom: false }).setView([t.lat, t.lng], 14);
    map.attributionControl.setPrefix("");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);

    var show, near;
    if (single) {
      near = TRADES.map(function (x) { return { t: x, d: distM(t.lat, t.lng, x.lat, x.lng) }; })
        .sort(function (a, b) { return a.d - b.d; }).slice(0, 8);
      show = near;
    } else {
      near = list.map(function (x) { return { t: x, d: distM(t.lat, t.lng, x.lat, x.lng) }; })
        .sort(function (a, b) { return val(b.t, "fp") - val(a.t, "fp"); });
      show = near.slice(0, 60);
    }

    // 원 크기를 유동인구에 비례시킨다 — 목록을 안 봐도 큰 상권이 어디인지 보인다
    var mx = Math.max.apply(null, show.map(function (x) { return val(x.t, "fp") || 0; })) || 1;
    var pts = [];
    show.forEach(function (x) {
      var me = single && x.t.c === state.code;
      L.circleMarker([x.t.lat, x.t.lng], {
        radius: me ? 14 : Math.max(5, Math.min(17, 5 + Math.sqrt(val(x.t, "fp") / mx) * 12)),
        color: me ? "#232a38" : "#fff", weight: me ? 3.5 : 2,
        fillColor: TYPE_COLOR[x.t.t] || "#8a93a3", fillOpacity: me ? 1 : 0.85,
      }).addTo(layer)
        .bindTooltip(x.t.n + (me ? " (지금 보는 곳)" : " · 일평균 " + comma(perDay(val(x.t, "fp"))) + "명"),
          { direction: "top", className: "zone-tooltip" })
        .on("click", function () { if (!me) gotoTrade(x.t.c); });
      pts.push([x.t.lat, x.t.lng]);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 15 });
    setTimeout(function () { if (map) map.invalidateSize(); }, 60);

    var rows = single ? near.filter(function (x) { return x.t.c !== state.code; }) : near.slice(0, 25);
    document.getElementById("nearList").innerHTML =
      '<div class="table-wrap" style="margin-top:12px"><table class="rank-table tr-list"><thead><tr>' +
      (single ? "<th>거리</th>" : "<th>순위</th>") +
      "<th>상권</th><th>유형</th><th>행정동</th><th>일평균 유동인구</th><th>점포</th><th>추정 월매출</th>" +
      "</tr></thead><tbody>" +
      rows.map(function (x, i) {
        return '<tr class="tr-row" data-c="' + esc(x.t.c) + '">' +
          "<td>" + (single ? (x.d < 1000 ? x.d + "m" : (x.d / 1000).toFixed(1) + "km") : (i + 1)) + "</td>" +
          '<td class="tr-name">' + esc(x.t.n) + "</td>" +
          '<td><span class="tr-tag" style="background:' + (TYPE_COLOR[x.t.t] || "#8a93a3") +
            ";color:" + inkOn(TYPE_COLOR[x.t.t] || "#8a93a3") + '">' + esc(x.t.t) + "</span></td>" +
          "<td>" + esc(x.t.dong) + "</td>" +
          '<td class="rt-price">' + comma(perDay(val(x.t, "fp"))) + "명</td>" +
          "<td>" + comma(val(x.t, "st")) + "</td>" +
          "<td>" + (x.t.sl ? money(Math.round(x.t.sl.amt / 3)) : "-") + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      (!single && near.length > 25 ? '<p class="dim-note" style="margin-top:8px">유동인구 상위 25곳만 표시했습니다(전체 ' +
        comma(near.length) + "곳).</p>" : "");

    document.querySelectorAll("#nearList .tr-row").forEach(function (r) {
      r.addEventListener("click", function () { gotoTrade(r.dataset.c); });
    });
  }

  /* ── 지도 옆칸 — 업종 구성 ── */
  function drawMapSide(t) {
    var host = document.getElementById("mapSide");
    if (!host) return;
    if (!t.st || !t.st.cat || !CATS.length) { host.innerHTML = ""; return; }
    var tot = t.st.cat.reduce(function (a, v) { return a + v[0]; }, 0);
    if (!tot) { host.innerHTML = ""; return; }
    var idx = CATS.map(function (c, i) { return i; }).filter(function (i) { return t.st.cat[i][0]; })
      .sort(function (a, b) { return t.st.cat[b][0] - t.st.cat[a][0]; });

    host.innerHTML =
      '<h4 class="tr-h4" style="margin-top:0">업종 분포</h4>' +
      '<div class="cat-chart cat-chart-sm"><canvas id="mapCat"></canvas>' +
        '<div class="cat-center"><b>' + comma(tot) + '</b><span>개</span></div></div>' +
      '<div class="cat-legend cat-legend-sm">' + idx.map(function (i) {
        return '<div class="cat-item"><i style="background:' + CAT_COLOR[i % CAT_COLOR.length] + '"></i>' +
          '<span class="cat-n">' + esc(CATS[i]) + '</span>' +
          '<span class="cat-p">' + pct(t.st.cat[i][0], tot) + '%</span>' +
          '<span class="cat-c">' + comma(t.st.cat[i][0]) + '</span></div>';
      }).join("") + '</div>' +
      (t.st.top.length
        ? '<h4 class="tr-h4">주요 업종</h4><div class="cat-legend cat-legend-sm">' +
          t.st.top.slice(0, 5).map(function (r) {
            return '<div class="cat-item"><span class="cat-n">' + esc(r.n) + '</span>' +
              '<span class="cat-c">' + comma(r.c) + '개</span></div>';
          }).join("") + '</div>'
        : "");

    var el = document.getElementById("mapCat");
    if (!el) return;
    if (charts.mapCat) charts.mapCat.destroy();
    charts.mapCat = new Chart(el, {
      type: "doughnut",
      data: {
        labels: idx.map(function (i) { return CATS[i]; }),
        datasets: [{
          data: idx.map(function (i) { return t.st.cat[i][0]; }),
          backgroundColor: idx.map(function (i) { return CAT_COLOR[i % CAT_COLOR.length]; }),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (x) { return x.label + " " + comma(x.parsed) + "개"; } } },
        },
      },
    });
  }

  /* ── 업종별 세부분석 ──
     "여기서 카페 하면 되겠냐"는 물음에 상권 전체 숫자로는 답이 안 된다.
     그 업종만 떼어 내 점포 수·개폐업·점포당 매출을 보고 서울 같은 업종과 견준다. */
  var _indBase = null;
  function industryBase() {
    if (_indBase) return _indBase;
    _indBase = {};
    TRADES.forEach(function (t) {
      if (!t.st) return;
      var sl = {};
      if (t.sl) t.sl.top.forEach(function (r) { sl[r.n] = r; });
      t.st.top.forEach(function (r) {
        var e = _indBase[r.n] || (_indBase[r.n] = { c: 0, o: 0, x: 0, amt: 0, amtC: 0, n: 0 });
        e.c += r.c; e.o += r.o; e.x += r.x; e.n += 1;
        if (sl[r.n]) { e.amt += sl[r.n].a; e.amtC += r.c; }
      });
    });
    return _indBase;
  }

  function initIndustry(t, list) {
    var sel = document.getElementById("indPick");
    if (!sel) return;
    var host = document.getElementById("indBody");
    if (!t.st || !t.st.top.length) {
      if (host) host.innerHTML = '<p class="placeholder">업종 자료가 없습니다.</p>';
      return;
    }
    sel.innerHTML = t.st.top.map(function (r) {
      return '<option value="' + esc(r.n) + '">' + esc(r.n) + " — " + comma(r.c) + "개</option>";
    }).join("");
    sel.onchange = function () { renderIndustry(t, list, sel.value); };
    renderIndustry(t, list, t.st.top[0].n);
  }

  function renderIndustry(t, list, name) {
    var host = document.getElementById("indBody");
    if (!host) return;
    var r = t.st.top.filter(function (x) { return x.n === name; })[0];
    if (!r) { host.innerHTML = '<p class="placeholder">고른 업종 자료가 없습니다.</p>'; return; }
    var sr = (t.sl && t.sl.top.filter(function (x) { return x.n === name; })[0]) || null;
    var net = r.o - r.x;
    var per = (sr && r.c) ? Math.round(sr.a / 3 / r.c) : 0;

    var B = industryBase()[name];
    var bPer = (B && B.amtC) ? Math.round(B.amt / 3 / B.amtC) : 0;
    var gap = (per && bPer) ? Math.round(per / bPer * 100) : 0;

    var byTrade = list.map(function (x) {
      var q = x.st && x.st.top.filter(function (y) { return y.n === name; })[0];
      return q ? { t: x, c: q.c, o: q.o, cl: q.x } : null;
    }).filter(Boolean).sort(function (a, b) { return b.c - a.c; }).slice(0, 8);

    host.innerHTML =
      '<div class="mini-row" style="margin-top:14px">' +
        '<div class="mini"><span>' + esc(name) + ' 점포</span><b>' + comma(r.c) + '개</b>' +
          '<span class="mini-foot">이 범위 점포의 ' + pct(r.c, t.st.tot) + '%</span></div>' +
        '<div class="mini"><span>개업 / 폐업</span><b>' + comma(r.o) + ' / ' + comma(r.x) + '</b>' +
          '<span class="mini-foot ' + (net > 0 ? "ib-up" : net < 0 ? "ib-dn" : "ib-fl") + '">순증감 ' +
          (net > 0 ? "+" : net < 0 ? "−" : "±") + Math.abs(net) + '개</span></div>' +
        '<div class="mini"><span>프랜차이즈</span><b>' + comma(r.f) + '개</b>' +
          '<span class="mini-foot">' + pct(r.f, r.c) + '%</span></div>' +
        (per ? '<div class="mini"><span>점포당 월매출</span><b>' + money(per) + '</b>' +
          (gap ? '<span class="mini-foot ' + (gap >= 100 ? "ib-up" : "ib-dn") + '">서울 같은 업종의 ' +
            gap + '%</span>' : "") + '</div>' : "") +
      '</div>' +
      (byTrade.length > 1
        ? '<h4 class="tr-h4">' + esc(name) + ' 점포가 많은 상권</h4>' +
          '<div class="ib-list">' + (function () {
            var mx = byTrade[0].c || 1;
            return byTrade.map(function (b) {
              var n2 = b.o - b.cl;
              return '<div class="ib-row ib-row-click" data-c="' + esc(b.t.c) + '">' +
                '<span class="ib-name" title="' + esc(b.t.n) + '">' + esc(b.t.n) + '</span>' +
                '<span class="ib-track"><i style="width:' + Math.max(2, b.c / mx * 100) + '%"></i></span>' +
                '<span class="ib-num"><b>' + comma(b.c) + '개</b>' +
                  '<em class="ib-o">개업 ' + comma(b.o) + '</em>' +
                  '<em class="ib-x">폐업 ' + comma(b.cl) + '</em>' +
                  '<em class="' + (n2 > 0 ? "ib-up" : n2 < 0 ? "ib-dn" : "ib-fl") + '">' +
                    (n2 > 0 ? "+" : n2 < 0 ? "−" : "±") + Math.abs(n2) + '</em></span></div>';
            }).join("");
          })() + '</div>'
        : "") +
      indBrief(name, r, net, per, bPer, gap, t);

    host.querySelectorAll(".ib-row-click").forEach(function (el) {
      el.addEventListener("click", function () { gotoTrade(el.dataset.c); });
    });
  }

  function indBrief(name, r, net, per, bPer, gap, t) {
    var lines = [];
    var share = pct(r.c, t.st.tot);
    lines.push("이 범위에 <b>" + esc(name) + "</b>" + josa(name, "이", "가") + " <b>" + comma(r.c) + "개</b> 있고, " +
      "전체 점포의 <b>" + share + "%</b>를 차지합니다." +
      (share >= 15 ? " <b>이미 포화에 가깝습니다.</b>" : share <= 2 ? " 아직 드문 업종입니다." : ""));
    if (r.c >= 20) {
      lines.push(net > 0
        ? "그 분기에 <b>" + comma(r.o) + "곳이 열고 " + comma(r.x) + "곳이 닫아 " + net +
          "곳 늘었습니다.</b> 들어오는 업종입니다."
        : net < 0
          ? "그 분기에 <b>" + comma(r.o) + "곳이 열고 " + comma(r.x) + "곳이 닫아 " + (-net) +
            "곳 줄었습니다.</b> <b>빠져나가는 중이니 이유를 꼭 확인하세요.</b>"
          : "그 분기에 <b>연 곳과 닫은 곳이 같습니다.</b> 자리는 유지되고 있습니다.");
    } else {
      lines.push("<b>점포가 " + comma(r.c) + "개뿐이라</b> 개업·폐업 숫자를 흐름으로 읽으시면 안 됩니다.");
    }
    if (per && bPer) {
      lines.push("점포당 월매출은 <b>" + money(per) + "</b>으로 서울 같은 업종(" + money(bPer) +
        ")의 <b>" + gap + "%</b>입니다." +
        (gap >= 130 ? " <b>잘되는 자리입니다.</b>" : gap <= 70 ? " <b>기대보다 낮습니다.</b>" : ""));
    }
    lines.push("<b>임대료를 반드시 같이 보세요.</b> 매출이 높아도 임대료가 더 오르면 남는 게 없습니다. " +
      "위 <b>수익률 계산</b>에 실제 조건을 넣어 확인하시면 됩니다.");
    return '<div class="read-guide" style="margin-top:16px"><h4>금집부쌤이 보는 ' + esc(name) +
      '</h4><ol>' + lines.map(function (x) { return "<li>" + x + "</li>"; }).join("") + '</ol></div>';
  }

  /* ── 비교 ── */
  var cmpList = [];
  function initCompare(list) {
    cmpList = state.code !== ALL ? [state.code]
      : list.slice().sort(function (a, b) { return val(b, "fp") - val(a, "fp"); })
          .slice(0, 3).map(function (t) { return t.c; });

    var input = document.getElementById("cmpSearch");
    var drop = document.getElementById("cmpDrop");
    if (!input) return;
    input.addEventListener("input", function () {
      var hits = searchTrade(input.value, 8);
      if (!hits.length) { drop.hidden = true; return; }
      drop.innerHTML = hits.map(function (x) {
        return '<button type="button" class="finder-item" data-c="' + esc(x.c) + '">' +
          '<span class="fi-name">' + esc(x.n) + "</span>" +
          '<span class="fi-where">' + esc(x.gu) + " " + esc(x.dong) + "</span></button>";
      }).join("");
      drop.hidden = false;
    });
    drop.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-c]");
      if (!b) return;
      if (cmpList.indexOf(b.dataset.c) === -1 && cmpList.length < 4) cmpList.push(b.dataset.c);
      input.value = ""; drop.hidden = true;
      renderCompare();
    });
    renderCompare();
  }

  function renderCompare() {
    var rows = cmpList.map(function (c) { return BY_CODE[c]; }).filter(Boolean);
    var host = document.getElementById("cmpBody");
    if (!host) return;
    if (rows.length < 2) {
      host.innerHTML = '<p class="placeholder">비교할 상권을 하나 이상 더 고르세요.</p>';
      return;
    }
    var metric = [
      ["일평균 유동인구", function (t) { return comma(perDay(val(t, "fp"))) + "명"; }, function (t) { return val(t, "fp"); }],
      ["점포 수", function (t) { return comma(val(t, "st")) + "개"; }, function (t) { return val(t, "st"); }],
      ["개업률", function (t) { return t.st ? t.st.opr + "%" : "-"; }, function (t) { return t.st ? t.st.opr : 0; }],
      ["폐업률", function (t) { return t.st ? t.st.clr + "%" : "-"; }, function (t) { return t.st ? -t.st.clr : 0; }],
      ["추정 월매출", function (t) { return t.sl ? money(Math.round(t.sl.amt / 3)) : "-"; }, function (t) { return val(t, "sl"); }],
      ["점포당 월매출", function (t) {
        return (t.sl && t.st && t.st.tot) ? money(Math.round(t.sl.amt / 3 / t.st.tot)) : "-";
      }, function (t) { return (t.sl && t.st && t.st.tot) ? t.sl.amt / t.st.tot : 0; }],
    ];
    host.innerHTML =
      '<div class="table-wrap"><table class="rank-table cmp-table"><thead><tr><th>항목</th>' +
      rows.map(function (t) {
        return "<th>" + esc(t.n) + '<span class="th-sub">' + esc(t.gu) + "</span>" +
          ' <button type="button" class="cmp-x" data-c="' + esc(t.c) + '">×</button></th>';
      }).join("") + "</tr></thead><tbody>" +
      metric.map(function (m) {
        var best = rows.reduce(function (a, b) { return m[2](b) > m[2](a) ? b : a; });
        return "<tr><td>" + m[0] + "</td>" + rows.map(function (t) {
          return '<td class="' + (t === best ? "cmp-best" : "") + '">' + m[1](t) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="dim-note" style="margin-top:8px">진하게 표시된 칸이 그 항목에서 가장 나은 상권입니다. ' +
      "<b>폐업률은 낮을수록</b> 좋은 것으로 봤습니다.</p>";

    host.querySelectorAll(".cmp-x").forEach(function (b) {
      b.addEventListener("click", function () {
        cmpList = cmpList.filter(function (c) { return c !== b.dataset.c; });
        renderCompare();
      });
    });
  }

  /* 테마가 바뀌면 차트 눈금 색이 안 맞으므로 다시 그린다 */
  window.addEventListener("themechange", function () { refresh(); });
  window.addEventListener("beforeprint", function () { if (map) map.invalidateSize(); });

  refresh();
})();
