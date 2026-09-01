/* ════════════════════════════════════════════════════════════════════
   상권분석 대시보드 — 서울 1,650개 상권
   데이터: window.TRADE_DATA (../data/trade.js) + window.SANGGA_DATA (실거래)
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
  var DOW_LABEL = ["월", "화", "수", "목", "금", "토", "일"];
  var TYPE_COLOR = {
    "골목상권": "#4fada8", "발달상권": "#4f7fe6",
    "전통시장": "#cf9a45", "관광특구": "#9b59d0",
  };

  /* ════════════════ 유틸 ════════════════ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function comma(n) { return (n || 0).toLocaleString(); }

  /* 만원 단위 금액을 사람이 읽는 단위로 */
  function money(man) {
    if (!man) return "-";
    if (man >= 100000000) return (man / 100000000).toFixed(1) + "조원";
    if (man >= 10000) return Math.round(man / 10000).toLocaleString() + "억원";
    return Math.round(man).toLocaleString() + "만원";
  }

  /* 유동인구는 분기 합계라 숫자가 크다. 일평균으로 바꿔야 감이 온다. */
  var QUARTER_DAYS = 91;
  function perDay(n) { return Math.round((n || 0) / QUARTER_DAYS); }

  function qLabel(code) {
    if (!code || code.length < 5) return "-";
    return code.slice(0, 4) + "년 " + code.slice(4) + "분기";
  }

  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  /* ════════════════ 검색 ════════════════ */

  function searchTrade(q, limit) {
    q = (q || "").replace(/\s+/g, "").toLowerCase();
    if (!q) return [];
    var hit = [];
    for (var i = 0; i < TRADES.length; i++) {
      var t = TRADES[i];
      var nm = (t.n + t.gu + t.dong).replace(/\s+/g, "").toLowerCase();
      var at = t.n.replace(/\s+/g, "").toLowerCase().indexOf(q);
      if (at === -1 && nm.indexOf(q) === -1) continue;
      hit.push({ t: t, at: at === -1 ? 99 : at });
    }
    hit.sort(function (a, b) {
      if (a.at !== b.at) return a.at - b.at;
      return (b.t.fp ? b.t.fp.tot : 0) - (a.t.fp ? a.t.fp.tot : 0);
    });
    return hit.slice(0, limit || 12).map(function (x) { return x.t; });
  }

  /* 두 좌표 사이 거리(m) — 서울 안이라 평면 근사로 충분하다 */
  function distM(lat1, lng1, lat2, lng2) {
    var dy = (lat1 - lat2) * 111000;
    var dx = (lng1 - lng2) * 111000 * Math.cos(lat1 * Math.PI / 180);
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  }

  function nearest(lat, lng, n) {
    return TRADES.map(function (t) {
      return { t: t, d: distM(lat, lng, t.lat, t.lng) };
    }).sort(function (a, b) { return a.d - b.d; }).slice(0, n || 5);
  }

  /* ════════════════ 상권 안에서의 자리 ════════════════ */

  var _rank = {};
  function rankIn(scope, key) {
    // scope: "서울" 또는 자치구명 / key: 유동인구·점포·매출 중 하나
    var ck = scope + "|" + key;
    if (_rank[ck]) return _rank[ck];
    var pool = TRADES.filter(function (t) {
      return scope === "서울" ? true : t.gu === scope;
    }).filter(function (t) { return val(t, key); });
    pool.sort(function (a, b) { return val(b, key) - val(a, key); });
    var map = {};
    pool.forEach(function (t, i) { map[t.c] = i + 1; });
    _rank[ck] = { map: map, n: pool.length };
    return _rank[ck];
  }

  function val(t, key) {
    if (key === "fp") return t.fp ? t.fp.tot : 0;
    if (key === "st") return t.st ? t.st.tot : 0;
    if (key === "sl") return t.sl ? t.sl.amt : 0;
    return 0;
  }

  /* ════════════════ 실거래 연동 ════════════════
     상권이 속한 자치구의 상업업무용 실거래를 가져온다. 상권 단위 실거래는
     없으므로(신고가 지번 단위라 상권 경계와 안 맞물린다) 자치구를 쓴다. */

  function nrgOf(gu) {
    if (!SG || !SG.regions) return null;
    var reg = SG.regions[gu];
    if (!reg || !reg.w) return null;
    var w = reg.w[SG.defaultWindow] || reg.w["12"];
    if (!w) return null;
    return {
      cnt: w.nrgCnt, med: w.med,
      label: (SG.windows && SG.windows[SG.defaultWindow] && SG.windows[SG.defaultWindow].label) || "최근 12개월",
    };
  }

  /* ════════════════ 화면 — 상권 찾기 ════════════════ */

  var current = null;

  (function initFinder() {
    document.getElementById("qNote").textContent = qLabel(T.quarter.flpop);
    document.getElementById("trCountNote").textContent =
      "서울 " + comma(T.total) + "개 상권 · " + qLabel(T.quarter.flpop) + " 기준";

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
          '<span class="fi-cnt">일평균 ' + comma(perDay(t.fp ? t.fp.tot : 0)) + "명</span></button>";
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
      else if (e.key === "Enter") { show(hits[cursor < 0 ? 0 : cursor].c); close(); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    drop.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-c]");
      if (!b) return;
      show(b.dataset.c);
      close();
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".finder-input")) close();
    });

    // 자치구 칩
    var chips = document.getElementById("trGuChips");
    chips.innerHTML = T.gus.map(function (g) {
      return '<button data-g="' + esc(g) + '">' + esc(g) + "</button>";
    }).join("");
    chips.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-g]");
      if (!b) return;
      chips.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      listGu(b.dataset.g);
    });
  })();

  /* 자치구 안 상권 목록 — 유동인구 많은 순 */
  function listGu(gu) {
    var rows = TRADES.filter(function (t) { return t.gu === gu; })
      .sort(function (a, b) { return val(b, "fp") - val(a, "fp"); });
    document.getElementById("trGuList").innerHTML =
      '<div class="table-wrap"><table class="rank-table tr-list"><thead><tr>' +
      "<th>순위</th><th>상권</th><th>유형</th><th>행정동</th>" +
      "<th>일평균 유동인구</th><th>점포</th><th>추정 월매출</th></tr></thead><tbody>" +
      rows.map(function (t, i) {
        return '<tr class="tr-row" data-c="' + esc(t.c) + '">' +
          "<td>" + (i + 1) + "</td>" +
          '<td class="tr-name">' + esc(t.n) + "</td>" +
          '<td><span class="tr-tag" style="background:' + (TYPE_COLOR[t.t] || "#8a93a3") + '">' +
            esc(t.t) + "</span></td>" +
          "<td>" + esc(t.dong) + "</td>" +
          '<td class="rt-price">' + comma(perDay(t.fp ? t.fp.tot : 0)) + "명</td>" +
          "<td>" + comma(t.st ? t.st.tot : 0) + "</td>" +
          "<td>" + (t.sl ? money(Math.round(t.sl.amt / 3)) : "-") + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    document.querySelectorAll("#trGuList .tr-row").forEach(function (r) {
      r.addEventListener("click", function () { show(r.dataset.c); });
    });
  }

  /* ════════════════ 주소로 찾기 ════════════════
     카카오 지오코딩은 브라우저에 키를 노출해야 해서 쓰지 않는다.
     대신 이미 구워 둔 실거래 좌표(geo.js)와 상권 이름으로 근사한다. */

  document.getElementById("trAddrBtn").addEventListener("click", findByAddr);
  document.getElementById("trAddr").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { findByAddr(); e.preventDefault(); }
  });

  function findByAddr() {
    var q = (document.getElementById("trAddr").value || "").trim();
    var note = document.getElementById("trAddrNote");
    if (!q) { note.textContent = ""; return; }

    // 주소에서 자치구·동을 뽑아 그 안 상권을 좁힌다
    var gu = (q.match(/([가-힣]+구)/) || [])[1] || "";
    var dong = (q.match(/([가-힣0-9]+동)/) || [])[1] || "";
    var pool = TRADES;
    if (gu) pool = pool.filter(function (t) { return t.gu === gu; });
    if (!pool.length) {
      note.textContent = "자치구를 못 찾았습니다. '서울 서초구 …' 형태로 넣어 주세요.";
      return;
    }
    var picked = null;
    if (dong) {
      var d = pool.filter(function (t) { return t.dong.indexOf(dong.replace(/[0-9]/g, "")) >= 0; });
      if (d.length) pool = d;
    }
    // 도로명·지번은 좌표가 없으면 못 맞춘다. 그 자치구·동에서 가장 큰 상권을 준다.
    picked = pool.sort(function (a, b) { return val(b, "fp") - val(a, "fp"); })[0];
    note.innerHTML = "<b>" + esc(picked.gu) + " " + esc(picked.dong) + "</b>에서 " +
      "유동인구가 가장 많은 상권을 골랐습니다. 아래 목록에서 다른 상권도 고르실 수 있습니다.";
    listGu(picked.gu);
    show(picked.c);
  }

  /* ════════════════ 결론 ════════════════ */

  function conclHtml(tag, tone, lines, advice) {
    return '<div class="cc ' + tone + '">' +
      '<div class="cc-head"><span class="cc-badge">결론</span><b>' + tag + "</b></div>" +
      '<p class="cc-why">' + lines.join(" ") + "</p>" +
      '<p class="cc-do"><span>첨언</span>' + advice + "</p></div>";
  }

  function tradeConcl(t) {
    var fpR = t.fp ? rankIn("서울", "fp") : null;
    var slR = t.sl ? rankIn("서울", "sl") : null;
    var fpRank = fpR ? fpR.map[t.c] : 0;
    var slRank = slR ? slR.map[t.c] : 0;
    var N = fpR ? fpR.n : 0;

    if (!t.fp || !t.st) {
      return conclHtml("자료가 모자란 상권", "flat",
        ["이 상권은 유동인구나 점포 통계가 비어 있습니다."],
        "옆 상권을 함께 보시거나, 아래 <b>실거래</b>와 <b>현장 확인</b>으로 판단하세요.");
    }

    var HI = Math.ceil(N / 3), LO = N - HI + 1;
    var fpBand = fpRank <= HI ? 0 : (fpRank >= LO ? 2 : 1);
    var clr = t.st.clr, opr = t.st.opr;

    // 폐업률이 개업률보다 확연히 높으면 빠져나가는 상권이다
    var churn = clr - opr;
    var tag, tone, advice;
    if (fpBand === 0 && churn <= 0) {
      tag = "사람도 많고 자리도 안정된 상권"; tone = "up";
      advice = "<b>권리금이 붙어 있을 가능성이 큽니다.</b> 매물이 나오면 <b>왜 나왔는지</b>를 반드시 확인하세요.";
    } else if (fpBand === 0 && churn > 0) {
      tag = "사람은 많지만 손바뀜이 잦은 상권"; tone = "warn";
      advice = "유동인구만 보고 들어가면 위험합니다. <b>같은 자리에서 몇 번 바뀌었는지</b>, " +
               "<b>임대료가 매출을 감당하는지</b> 꼭 따져 보세요.";
    } else if (fpBand === 2 && churn > 0) {
      tag = "사람도 적고 빠져나가는 상권"; tone = "down";
      advice = "<b>신중하셔야 합니다.</b> 배후 수요가 확실한 업종이 아니면 권하기 어렵습니다.";
    } else if (fpBand === 2) {
      tag = "조용하지만 자리는 지키는 상권"; tone = "flat";
      advice = "임대료 부담이 적어 <b>단골 장사</b>에는 맞습니다. 대신 <b>지나가는 손님은 기대하지 마세요.</b>";
    } else {
      tag = "서울 평균 근처 상권"; tone = "flat";
      advice = "특별히 앞서지도 뒤처지지도 않습니다. <b>업종 구성</b>과 <b>임대료 수준</b>으로 판단하세요.";
    }

    var why = [];
    why.push("일평균 유동인구 <b>" + comma(perDay(t.fp.tot)) + "명</b>" +
      (fpRank ? "으로 서울 " + comma(N) + "개 상권 중 <b>" + comma(fpRank) + "위</b>" : "") + "입니다.");
    why.push("점포는 <b>" + comma(t.st.tot) + "개</b>, 개업률 <b>" + opr + "%</b> · 폐업률 <b>" + clr + "%</b>" +
      (Math.abs(churn) >= 0.5
        ? "로 <b>" + (churn > 0 ? "폐업이 " + churn.toFixed(1) + "%p 많습니다" : "개업이 " + (-churn).toFixed(1) + "%p 많습니다") + "</b>."
        : "로 <b>들고 나는 수가 비슷합니다</b>."));
    if (t.sl && slRank) {
      why.push("추정 월매출은 <b>" + money(Math.round(t.sl.amt / 3)) + "</b>으로 서울 <b>" + comma(slRank) + "위</b>입니다.");
    }
    return conclHtml(tag, tone, why, advice);
  }

  /* ════════════════ 화면 — 상권 상세 ════════════════ */

  var charts = {};
  function drawBar(id, labels, data, color, horizontal) {
    var el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: color, borderRadius: 3 }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: !horizontal } }, y: { beginAtZero: true } },
      },
    });
  }

  function kpiHtml(t) {
    var fpR = t.fp ? rankIn("서울", "fp") : null;
    var guR = t.fp ? rankIn(t.gu, "fp") : null;
    var peak = t.fp ? TM_LABEL[t.fp.tm.indexOf(Math.max.apply(null, t.fp.tm))] : "-";
    var bestDow = t.fp ? DOW_LABEL[t.fp.dow.indexOf(Math.max.apply(null, t.fp.dow))] : "-";
    var boxes = [
      { label: "일평균 유동인구", value: t.fp ? comma(perDay(t.fp.tot)) + "명" : "-",
        sub: fpR && fpR.map[t.c] ? "서울 " + comma(fpR.map[t.c]) + "위 · " + t.gu + " " + comma(guR.map[t.c]) + "위" : "" },
      { label: "피크 시간대", value: peak + "시", sub: "가장 붐비는 요일 " + bestDow + "요일" },
      { label: "점포 수", value: t.st ? comma(t.st.tot) + "개" : "-",
        sub: t.st ? "프랜차이즈 " + comma(t.st.frc) + "개 (" + pct(t.st.frc, t.st.tot) + "%)" : "" },
      { label: "개업 / 폐업률", value: t.st ? t.st.opr + "% / " + t.st.clr + "%" : "-",
        sub: t.st ? "개업 " + comma(t.st.opn) + " · 폐업 " + comma(t.st.cls) + "개" : "" },
      { label: "추정 월매출", value: t.sl ? money(Math.round(t.sl.amt / 3)) : "-",
        sub: t.sl ? "분기 " + money(t.sl.amt) + " · 건수 " + comma(t.sl.cnt) : "" },
    ];
    return '<div class="stat-row">' + boxes.map(function (b) {
      return '<div class="stat-box"><div class="label">' + b.label + "</div>" +
        '<div class="value">' + b.value + "</div>" +
        '<div class="sub">' + b.sub + "</div></div>";
    }).join("") + "</div>";
  }

  function show(code) {
    var t = BY_CODE[code];
    if (!t) return;
    current = t;

    var nrg = nrgOf(t.gu);
    var host = document.getElementById("trResult");

    host.innerHTML =
      // ── 요약 ──
      '<section class="card-section" id="sec-sum">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> ' +
          esc(t.n) + ' <span class="tr-tag" style="background:' + (TYPE_COLOR[t.t] || "#8a93a3") + '">' + esc(t.t) + "</span></h2>" +
          '<button class="sec-print-btn" onclick="printSection(\'sec-sum\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">' + esc(t.gu) + " " + esc(t.dong) + " · 상권 면적 " + comma(t.ar) + "㎡ · " +
          qLabel(T.quarter.flpop) + " 기준</p>" +
        kpiHtml(t) +
        tradeConcl(t) +
      "</section>" +

      // ── 유동인구 ──
      '<section class="card-section" id="sec-fp">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 유동인구</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-fp\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">분기 합계를 <b>91일로 나눈 일평균</b>입니다. 성별·연령·시간대·요일로 나눠 봅니다.</p>' +
        '<div class="tr-charts">' +
          '<div class="tr-chart"><h4>시간대별</h4><div class="chart-box" style="height:210px"><canvas id="fpTm"></canvas></div></div>' +
          '<div class="tr-chart"><h4>요일별</h4><div class="chart-box" style="height:210px"><canvas id="fpDow"></canvas></div></div>' +
          '<div class="tr-chart"><h4>연령대별</h4><div class="chart-box" style="height:210px"><canvas id="fpAge"></canvas></div></div>' +
        "</div>" +
        '<div id="fpNote"></div>' +
      "</section>" +

      // ── 점포 ──
      '<section class="card-section" id="sec-st">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 점포 · 개폐업</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-st\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">업종별 점포 수와 그 분기의 개업·폐업 건수입니다.</p>' +
        '<div id="stTable"></div>' +
      "</section>" +

      // ── 매출 ──
      '<section class="card-section" id="sec-sl">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 추정 매출</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-sl\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">서울시가 카드 매출 등으로 <b>추정</b>한 값입니다. 실제 매출과 다를 수 있습니다.</p>' +
        '<div id="slBody"></div>' +
      "</section>" +

      // ── 실거래 ──
      '<section class="card-section" id="sec-nrg">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> ' +
          esc(t.gu) + ' 상업업무용 실거래</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-nrg\')">이 섹션 인쇄</button></div>' +
        '<div id="nrgBody"></div>' +
      "</section>" +

      // ── 수익률 ──
      '<section class="card-section" id="sec-yield">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 수익률 계산</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-yield\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">매물 조건을 넣으면 즉시 계산됩니다. <b>취득세 등 4.6%</b>를 투입금에 넣을지 고르실 수 있습니다.</p>' +
        yieldFormHtml() +
        '<div id="yieldOut"></div>' +
      "</section>" +

      // ── 지도 ──
      '<section class="card-section" id="sec-map">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 위치 · 인근 상권</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-map\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">가까운 상권을 함께 표시합니다. 원을 누르면 그 상권으로 넘어갑니다.</p>' +
        '<div class="chart-box" style="height:420px"><div id="trMap" style="height:100%"></div></div>' +
        '<div id="nearList"></div>' +
      "</section>" +

      // ── 비교 ──
      '<section class="card-section" id="sec-cmp">' +
        '<div class="sec-head"><h2><img class="sec-logo-icon" src="../assets/geumjib-logo.png" alt="" onerror="this.style.display=\'none\'"> 상권 비교</h2>' +
          '<button class="sec-print-btn" onclick="printSection(\'sec-cmp\')">이 섹션 인쇄</button></div>' +
        '<p class="sec-desc">비교할 상권을 고르면 나란히 놓고 봅니다. 최대 4곳까지.</p>' +
        '<div class="finder-bar"><label for="cmpSearch">상권 추가</label>' +
          '<div class="finder-input"><input type="text" id="cmpSearch" placeholder="상권 이름" autocomplete="off" />' +
          '<div class="finder-drop" id="cmpDrop" hidden></div></div></div>' +
        '<div id="cmpBody"></div>' +
      "</section>";

    renderFp(t);
    renderStore(t);
    renderSelng(t);
    renderNrg(t, nrg);
    initYield();
    renderMap(t);
    initCompare(t);

    document.getElementById("printBanner").innerHTML =
      "<b>" + esc(t.n) + "</b> 상권분석 · " + esc(t.gu) + " " + esc(t.dong) +
      " · " + qLabel(T.quarter.flpop) + " 기준 · 반포114공인중개사 010-9442-2027";

    document.getElementById("sec-sum").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── 유동인구 ── */
  function renderFp(t) {
    if (!t.fp) {
      document.getElementById("sec-fp").hidden = true;
      return;
    }
    drawBar("fpTm", TM_LABEL, t.fp.tm.map(perDay), "#4f7fe6");
    drawBar("fpDow", DOW_LABEL, t.fp.dow.map(perDay), "#4fada8");
    drawBar("fpAge", AGE_LABEL, t.fp.age.map(perDay), "#cf9a45");

    var tm = t.fp.tm, dow = t.fp.dow, age = t.fp.age;
    var peakI = tm.indexOf(Math.max.apply(null, tm));
    var ageI = age.indexOf(Math.max.apply(null, age));
    var wk = dow.slice(0, 5).reduce(function (a, b) { return a + b; }, 0) / 5;
    var we = (dow[5] + dow[6]) / 2;
    var night = pct(tm[0] + tm[5], t.fp.tot);

    var lines = [];
    lines.push("가장 붐비는 시간대는 <b>" + TM_LABEL[peakI] + "시</b>(일평균 " + comma(perDay(tm[peakI])) + "명)이고, " +
      "가장 많은 연령대는 <b>" + AGE_LABEL[ageI] + "</b>(" + pct(age[ageI], t.fp.tot) + "%)입니다.");
    lines.push("남녀 비율은 <b>" + pct(t.fp.ml, t.fp.tot) + " : " + pct(t.fp.fml, t.fp.tot) + "</b>입니다.");
    if (we > wk * 1.1) {
      lines.push("<b>주말이 평일보다 " + Math.round((we / wk - 1) * 100) + "% 많습니다</b> — 나들이·외식 수요가 붙는 자리입니다.");
    } else if (wk > we * 1.1) {
      lines.push("<b>평일이 주말보다 " + Math.round((wk / we - 1) * 100) + "% 많습니다</b> — 직장·통근 수요가 중심입니다.");
    } else {
      lines.push("평일과 주말이 <b>비슷합니다</b>.");
    }
    if (night >= 25) {
      lines.push("심야·새벽(00~06, 21~24) 비중이 <b>" + night + "%</b>로 높아 <b>야간 업종</b>이 붙을 만합니다.");
    }
    document.getElementById("fpNote").innerHTML =
      '<div class="read-guide" style="margin-top:16px"><h4>금집부쌤이 보는 유동인구</h4><ol>' +
      lines.map(function (x) { return "<li>" + x + "</li>"; }).join("") +
      "</ol></div>";
  }

  /* ── 점포 ── */
  function renderStore(t) {
    if (!t.st || !t.st.top.length) {
      document.getElementById("sec-st").hidden = true;
      return;
    }
    var rows = t.st.top;
    document.getElementById("stTable").innerHTML =
      '<div class="table-wrap"><table class="rank-table"><thead><tr>' +
      "<th>순위</th><th>업종</th><th>점포</th><th>프랜차이즈</th><th>개업</th><th>폐업</th><th>순증감</th>" +
      "</tr></thead><tbody>" +
      rows.map(function (r, i) {
        var net = r.o - r.x;
        return "<tr><td>" + (i + 1) + "</td><td>" + esc(r.n) + "</td>" +
          '<td class="rt-price">' + comma(r.c) + "</td>" +
          "<td>" + (r.f ? comma(r.f) : "-") + "</td>" +
          "<td>" + (r.o ? comma(r.o) : "-") + "</td>" +
          "<td>" + (r.x ? comma(r.x) : "-") + "</td>" +
          '<td class="' + (net > 0 ? "d-up" : net < 0 ? "d-down" : "d-flat") + '">' +
            (net > 0 ? "+" : "") + net + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="dim-note" style="margin-top:8px">점포 수 상위 ' + rows.length +
      "개 업종입니다. <b>순증감</b>이 마이너스면 그 업종이 이 상권에서 빠져나가는 중입니다.</p>";
  }

  /* ── 매출 ── */
  function renderSelng(t) {
    if (!t.sl || !t.sl.top.length) {
      document.getElementById("sec-sl").hidden = true;
      return;
    }
    var s = t.sl;
    var mdwkDay = s.mdwk / 65, weDay = s.wkend / 26;      // 분기 평일 65일 · 주말 26일 근사
    var perStore = t.st && t.st.tot ? Math.round(s.amt / 3 / t.st.tot) : 0;

    document.getElementById("slBody").innerHTML =
      '<div class="stat-row">' +
        '<div class="stat-box"><div class="label">추정 월매출</div><div class="value">' + money(Math.round(s.amt / 3)) +
          '</div><div class="sub">분기 ' + money(s.amt) + "</div></div>" +
        '<div class="stat-box"><div class="label">점포당 월매출</div><div class="value">' +
          (perStore ? money(perStore) : "-") + '</div><div class="sub">상권 전체 ÷ 점포 수</div></div>' +
        '<div class="stat-box"><div class="label">건당 단가</div><div class="value">' +
          (s.cnt ? comma(Math.round(s.amt / s.cnt * 10000)) + "원" : "-") +
          '</div><div class="sub">분기 결제 ' + comma(s.cnt) + "건</div></div>" +
        '<div class="stat-box"><div class="label">평일 : 주말</div><div class="value">' +
          pct(s.mdwk, s.amt) + " : " + pct(s.wkend, s.amt) +
          '</div><div class="sub">일평균 ' + money(Math.round(mdwkDay)) + " vs " + money(Math.round(weDay)) + "</div></div>" +
      "</div>" +
      '<div class="tr-charts" style="margin-top:16px">' +
        '<div class="tr-chart"><h4>업종별 매출</h4><div class="chart-box" style="height:260px"><canvas id="slTop"></canvas></div></div>' +
        '<div class="tr-chart"><h4>시간대별</h4><div class="chart-box" style="height:260px"><canvas id="slTm"></canvas></div></div>' +
      "</div>" +
      '<div class="read-guide" style="margin-top:16px"><h4>금집부쌤이 보는 매출</h4><ol>' +
        "<li>이 상권 <b>추정 월매출은 " + money(Math.round(s.amt / 3)) + "</b>이고, " +
        (perStore ? "점포 하나당 <b>" + money(perStore) + "</b> 꼴입니다. " : "") +
        "다만 <b>업종마다 편차가 큽니다</b> — 아래 업종별 표를 함께 보세요.</li>" +
        "<li>" + (weDay > mdwkDay ? "<b>주말 매출이 평일보다 높습니다.</b> 주말 장사가 되는 자리입니다."
                                   : "<b>평일 매출이 주말보다 높습니다.</b> 주말에 쉬는 업종도 고려해 볼 만합니다.") + "</li>" +
        "<li><b>이 수치는 서울시가 카드 결제 등으로 추정한 값</b>입니다. 실제 매출과 다를 수 있으니 " +
        "<b>매도인 장부와 반드시 대조</b>하시고, 고객께도 추정치임을 밝히세요.</li>" +
      "</ol></div>";

    drawBar("slTop", s.top.slice(0, 8).map(function (r) { return r.n; }),
      s.top.slice(0, 8).map(function (r) { return Math.round(r.a / 3 / 10000); }), "#4f7fe6", true);
    drawBar("slTm", TM_LABEL, s.tm.map(function (v) { return Math.round(v / 3 / 10000); }), "#cf9a45");
  }

  /* ── 실거래 ── */
  function renderNrg(t, nrg) {
    var host = document.getElementById("nrgBody");
    if (!nrg) {
      host.innerHTML = '<p class="placeholder">실거래 자료를 불러오지 못했습니다.</p>';
      return;
    }
    var tot = (nrg.cnt.shop || 0) + (nrg.cnt.office || 0) + (nrg.cnt.etc || 0);
    host.innerHTML =
      '<p class="sec-desc">' + esc(nrg.label) + " · 국토교통부 상업업무용 매매 신고 기준입니다. " +
        "<b>상권 단위 실거래는 없어</b> 자치구 전체로 보여드립니다.</p>" +
      '<div class="stat-row">' +
        '<div class="stat-box"><div class="label">상업업무용 매매</div><div class="value">' + comma(tot) +
          '건</div><div class="sub">일반상가 ' + comma(nrg.cnt.shop || 0) + " · 업무용 " + comma(nrg.cnt.office || 0) + "</div></div>" +
        '<div class="stat-box"><div class="label">중위 거래가</div><div class="value">' +
          (nrg.med.nrg ? money(nrg.med.nrg) : "-") + '</div><div class="sub">' + esc(t.gu) + " 전체</div></div>" +
        '<div class="stat-box"><div class="label">중위 평당가</div><div class="value">' +
          (nrg.med.nrgPy ? comma(nrg.med.nrgPy) + "만원" : "-") + '</div><div class="sub">연면적 기준</div></div>' +
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
    var ids = ["yPrice", "yArea", "yDep", "yRent", "yLoan", "yRate", "yCost", "yVac", "yAcq"];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", calcYield);
      if (el) el.addEventListener("change", calcYield);
    });
    calcYield();
  }

  function calcYield() {
    var n = function (id) { return parseFloat((document.getElementById(id) || {}).value) || 0; };
    var price = n("yPrice"), dep = n("yDep"), rent = n("yRent");
    var loan = n("yLoan"), rate = n("yRate"), cost = n("yCost"), vac = n("yVac");
    var acq = (document.getElementById("yAcq") || {}).checked;
    var out = document.getElementById("yieldOut");
    if (!price || !rent) {
      out.innerHTML = '<p class="placeholder">매매가와 월세를 넣으면 계산됩니다.</p>';
      return;
    }
    var yearRent = rent * 12 * (1 - vac / 100);
    var interest = loan * rate / 100;
    var acqCost = acq ? price * 0.046 : 0;
    var invested = price - dep - loan + acqCost;          // 실제로 들어가는 돈
    var surface = (rent * 12) / (price - dep) * 100;      // 표면수익률
    var net = invested > 0 ? (yearRent - interest - cost) / invested * 100 : 0;
    var monthly = (yearRent - interest - cost) / 12;

    var area = n("yArea");
    var pyRent = area ? rent / (area / 3.3058) : 0;

    out.innerHTML =
      '<div class="stat-row" style="margin-top:14px">' +
        '<div class="stat-box"><div class="label">표면수익률</div><div class="value">' + surface.toFixed(2) +
          '%</div><div class="sub">연 임대료 ÷ (매매가 − 보증금)</div></div>' +
        '<div class="stat-box"><div class="label">실투자 수익률</div><div class="value ' +
          (net >= 0 ? "up" : "down") + '">' + net.toFixed(2) +
          '%</div><div class="sub">공실·이자·경비 반영</div></div>' +
        '<div class="stat-box"><div class="label">실투자금</div><div class="value">' + money(Math.round(invested)) +
          '</div><div class="sub">' + (acq ? "취득비용 " + money(Math.round(acqCost)) + " 포함" : "취득비용 제외") + "</div></div>" +
        '<div class="stat-box"><div class="label">월 순수입</div><div class="value">' +
          Math.round(monthly).toLocaleString() + '만원</div><div class="sub">이자·경비 뺀 값</div></div>' +
        (pyRent ? '<div class="stat-box"><div class="label">평당 월임대료</div><div class="value">' +
          pyRent.toFixed(1) + '만원</div><div class="sub">전용면적 기준</div></div>' : "") +
      "</div>" +
      '<div class="read-guide" style="margin-top:14px"><h4>금집부쌤이 짚어드리는 주의점</h4><ol>' +
        "<li><b>표면수익률만 보시면 안 됩니다.</b> 대출 이자와 공실을 넣은 <b>실투자 수익률</b>이 " +
        "실제로 손에 남는 몫입니다. 지금 계산으로는 <b>" + surface.toFixed(2) + "% → " + net.toFixed(2) + "%</b>입니다.</li>" +
        "<li>상가 취득세는 <b>4.6%</b>로 주택보다 높습니다. 중개보수·법무비까지 넣으면 더 들어갑니다.</li>" +
        "<li><b>공실 " + vac + "%</b>로 잡았습니다. 임차인이 한 번 빠지면 몇 달씩 비는 자리도 있으니, " +
        "위 <b>폐업률</b>을 보고 이 가정이 현실적인지 판단하세요.</li>" +
      "</ol></div>";
  }

  /* ── 지도 ── */
  var map = null, layer = null;
  function renderMap(t) {
    var el = document.getElementById("trMap");
    if (!el || typeof L === "undefined") return;
    if (map) { map.remove(); map = null; }
    map = L.map(el, { scrollWheelZoom: false }).setView([t.lat, t.lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);

    var near = nearest(t.lat, t.lng, 8);
    var pts = [];
    near.forEach(function (x) {
      var me = x.t.c === t.c;
      var m = L.circleMarker([x.t.lat, x.t.lng], {
        radius: me ? 14 : 9,
        color: me ? "#232a38" : "#fff", weight: me ? 3.5 : 2,
        fillColor: TYPE_COLOR[x.t.t] || "#8a93a3", fillOpacity: me ? 1 : 0.85,
      }).addTo(layer).bindTooltip(x.t.n + (me ? " (지금 보는 곳)" : " · " + x.d + "m"),
        { direction: "top", className: "zone-tooltip" });
      if (!me) m.on("click", function () { show(x.t.c); });
      pts.push([x.t.lat, x.t.lng]);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    setTimeout(function () { if (map) map.invalidateSize(); }, 60);

    document.getElementById("nearList").innerHTML =
      '<div class="table-wrap" style="margin-top:12px"><table class="rank-table"><thead><tr>' +
      "<th>거리</th><th>상권</th><th>유형</th><th>일평균 유동인구</th><th>점포</th><th>추정 월매출</th>" +
      "</tr></thead><tbody>" +
      near.filter(function (x) { return x.t.c !== t.c; }).map(function (x) {
        return '<tr class="tr-row" data-c="' + esc(x.t.c) + '">' +
          "<td>" + (x.d < 1000 ? x.d + "m" : (x.d / 1000).toFixed(1) + "km") + "</td>" +
          '<td class="tr-name">' + esc(x.t.n) + "</td>" +
          '<td><span class="tr-tag" style="background:' + (TYPE_COLOR[x.t.t] || "#8a93a3") + '">' + esc(x.t.t) + "</span></td>" +
          '<td class="rt-price">' + comma(perDay(x.t.fp ? x.t.fp.tot : 0)) + "명</td>" +
          "<td>" + comma(x.t.st ? x.t.st.tot : 0) + "</td>" +
          "<td>" + (x.t.sl ? money(Math.round(x.t.sl.amt / 3)) : "-") + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    document.querySelectorAll("#nearList .tr-row").forEach(function (r) {
      r.addEventListener("click", function () { show(r.dataset.c); });
    });
  }

  /* ── 비교 ── */
  var cmpList = [];
  function initCompare(t) {
    cmpList = [t.c];
    var input = document.getElementById("cmpSearch");
    var drop = document.getElementById("cmpDrop");
    var hits = [];

    input.addEventListener("input", function () {
      hits = searchTrade(input.value, 8);
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
    if (rows.length < 2) {
      host.innerHTML = '<p class="placeholder">비교할 상권을 하나 이상 더 고르세요.</p>';
      return;
    }
    var metric = [
      ["일평균 유동인구", function (t) { return t.fp ? comma(perDay(t.fp.tot)) + "명" : "-"; }, function (t) { return t.fp ? t.fp.tot : 0; }],
      ["점포 수", function (t) { return t.st ? comma(t.st.tot) + "개" : "-"; }, function (t) { return t.st ? t.st.tot : 0; }],
      ["개업률", function (t) { return t.st ? t.st.opr + "%" : "-"; }, function (t) { return t.st ? t.st.opr : 0; }],
      ["폐업률", function (t) { return t.st ? t.st.clr + "%" : "-"; }, function (t) { return t.st ? -t.st.clr : 0; }],
      ["추정 월매출", function (t) { return t.sl ? money(Math.round(t.sl.amt / 3)) : "-"; }, function (t) { return t.sl ? t.sl.amt : 0; }],
      ["점포당 월매출", function (t) {
        return (t.sl && t.st && t.st.tot) ? money(Math.round(t.sl.amt / 3 / t.st.tot)) : "-";
      }, function (t) { return (t.sl && t.st && t.st.tot) ? t.sl.amt / t.st.tot : 0; }],
    ];
    host.innerHTML =
      '<div class="table-wrap"><table class="rank-table cmp-table"><thead><tr><th>항목</th>' +
      rows.map(function (t) {
        return "<th>" + esc(t.n) + '<span class="th-sub">' + esc(t.gu) + "</span>" +
          (t.c === cmpList[0] ? "" : ' <button type="button" class="cmp-x" data-c="' + esc(t.c) + '">×</button>') + "</th>";
      }).join("") + "</tr></thead><tbody>" +
      metric.map(function (m) {
        var best = rows.reduce(function (a, b) { return m[2](b) > m[2](a) ? b : a; });
        return "<tr><td>" + m[0] + "</td>" + rows.map(function (t) {
          return '<td class="' + (t === best && rows.length > 1 ? "cmp-best" : "") + '">' + m[1](t) + "</td>";
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

  // 인쇄 직전에 지도가 안 그려진 채로 나가지 않게
  window.addEventListener("beforeprint", function () {
    if (map) map.invalidateSize();
  });
})();
