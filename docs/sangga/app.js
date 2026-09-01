/* ════════════════════════════════════════════════════════════════════
   상가·오피스텔 대시보드 — 서울 25개 자치구 전역
   데이터: window.SANGGA_DATA (../data/sangga.js), window.GEO_COORDS
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var D = window.SANGGA_DATA;
  var GEO = window.GEO_COORDS || {};
  if (!D) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      '<section class="card-section"><h2>데이터를 불러오지 못했습니다</h2>' +
      '<p class="sec-desc">data/sangga.js가 없습니다. <code>py tools/fetch_molit.py</code> 후 <code>py tools/build_data.py</code>를 실행하세요.</p></section>');
    return;
  }
  window.DASH_DATA = D;

  var ALL = "all";
  var PYEONG = 3.3058;
  var NRG_GROUPS = ["shop", "office", "etc"];
  var NRG_LABEL = D.groupLabel || { shop: "일반상가", office: "업무용", etc: "기타 상업·업무용" };
  var NRG_COLOR = { shop: "#4f7fe6", office: "#4fada8", etc: "#cf9a45" };
  var OFFI_TYPES = ["sale", "jeonse", "wolse"];
  var OFFI_LABEL = { sale: "매매", jeonse: "전세", wolse: "월세(환산)" };
  var OFFI_COLOR = { sale: "#4f7fe6", jeonse: "#4fada8", wolse: "#cf9a45" };

  var state = { gu: ALL, dong: ALL, win: D.defaultWindow, nrgGroup: "shop", offiType: "sale",
  };

  function win() { return D.windows[state.win]; }

  /* 전체 12개월 월별 배열에서 선택 기간만큼 잘라낸다 */
  function sliceMonths(arr) { return (arr || []).slice(-parseInt(state.win, 10)); }

  /* ════════════════ 유틸 ════════════════ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function eokman(man) {
    if (!man && man !== 0) return "-";
    var eok = Math.floor(man / 10000), rest = Math.round(man % 10000);
    if (eok && rest) return eok + "억 " + rest.toLocaleString() + "만원";
    if (eok) return eok + "억";
    return rest.toLocaleString() + "만원";
  }

  function areaText(a) { return a.toFixed(2) + "㎡ (" + (a / PYEONG).toFixed(1) + "평)"; }
  function dateText(d) { return d.replace(/-/g, "."); }

  function convValue(row, type) {
    return type === "wolse" ? row.v + (row.r || 0) * 100 : row.v;
  }

  function offiPriceText(row, type) {
    if (type === "wolse") return "보 " + eokman(row.v) + " / 월 " + (row.r || 0).toLocaleString() + "만원";
    return eokman(row.v);
  }

  function pyText(value, area) {
    if (!area) return "-";
    return Math.round(value / (area / PYEONG)).toLocaleString() + "만원";
  }

  /* ── 오피스텔 평당가 기준 ──
     네이버·KB 시세는 공급(분양)면적 기준이라, 전용 기준 그대로 대면 훨씬 비싸 보인다.

     전에 여기에 아파트와 같은 0.74를 쓰고 있었는데 이건 틀렸다. 오피스텔은
     복도·엘리베이터·주차장 같은 공용면적 비중이 아파트보다 훨씬 커서
     전용률이 50% 안팎이다(아파트 70~80%). 0.74로 두면 공급 환산 평당가가
     실제보다 5할 가까이 높게 나와, 그대로 말씀드리면 시세를 과대평가하게 된다.

     소형 원룸은 40%대, 아파텔은 60%대라 편차가 크다. 가운데인 50%를 쓰되
     화면에 가정값임을 밝힌다. */
  var OFFI_SUPPLY_RATIO = 0.50;

  /* 기준을 토글로 갈아 끼우다가, 두 값을 위아래로 같이 적는 쪽으로 바꿨다.
     고객과 화면을 같이 보면서 "공급 기준으로는 이만큼, 전용으로는 이만큼"이라고
     한 번에 말할 수 있어야 상담이 끊기지 않는다. */
  function pyConv(v) { return Math.round(v || 0); }
  function pyBaseWord() { return "전용"; }
  function pyBaseLabel() { return "전용 기준"; }

  /* 분양(공급)면적 ㎡(평)을 크게, 전용 ㎡를 그 아래 옅게 */
  function areaBoth(a) {
    if (!a) return "-";
    var sa = a / OFFI_SUPPLY_RATIO;
    return sa.toFixed(1) + "㎡ (" + (sa / PYEONG).toFixed(1) + "평)" +
      '<div class="rt-sub">전용 ' + a.toFixed(2) + "㎡</div>";
  }

  /* 공급 기준 평당가를 크게, 전용 기준을 그 아래 옅게 */
  function pyTextBoth(value, area) {
    if (!area) return "-";
    var net = Math.round(value / (area / PYEONG));
    return Math.round(net * OFFI_SUPPLY_RATIO).toLocaleString() + "만원" +
      '<div class="rt-sub">전용 ' + net.toLocaleString() + "만원</div>";
  }

  /* 선택한 지역을 섹션 제목에 반영한다 */
  function scopeLabel() {
    if (state.gu === ALL) return "서울";
    return state.dong === ALL ? state.gu : state.gu + " " + state.dong;
  }

  function renderTitles() {
    var s = scopeLabel();
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    var pre = s === "서울" ? "" : s + " ";
    set("mapSecTitle", pre + "오피스텔");
    set("nrgSecTitle", pre + "상가·업무용");
    set("offiSecTitle", pre + "오피스텔");
    set("volSecTitle", pre + "거래량 비교");
  }

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

  var EMPTY = {
    nrgTop: { shop: [], office: [], etc: [] },
    offiTop: { sale: [], jeonse: [], wolse: [] },
    nrgVol: { shop: [], office: [], etc: [] },
    offiVol: { sale: [], jeonse: [], wolse: [] },
    nrgCnt: { shop: 0, office: 0, etc: 0 },
    offiCnt: { sale: 0, jeonse: 0, wolse: 0 },
    med: {}, dongCnt: [],
  };

  /* 선택한 지역 + 선택한 기간의 집계 */
  function region() { return regionOf(regionKey()); }

  function regionOf(key) {
    var reg = D.regions[key];
    if (!reg) return EMPTY;
    var w = reg.w[state.win] || EMPTY;
    return {
      nrgTop: w.nrgTop, offiTop: w.offiTop,
      nrgCnt: w.nrgCnt, offiCnt: w.offiCnt, med: w.med,
      dongCnt: reg.dongCnt || [],
      nrgVol: {
        shop: sliceMonths(reg.nrgVol.shop),
        office: sliceMonths(reg.nrgVol.office),
        etc: sliceMonths(reg.nrgVol.etc),
      },
      offiVol: {
        sale: sliceMonths(reg.offiVol.sale),
        jeonse: sliceMonths(reg.offiVol.jeonse),
        wolse: sliceMonths(reg.offiVol.wolse),
      },
    };
  }

  /* ════════════════ 조회 조건 ════════════════ */

  var guSelect = document.getElementById("guSelect");
  var dongSelect = document.getElementById("dongSelect");

  guSelect.innerHTML = '<option value="all">서울시 전체</option>' +
    D.gus.map(function (g) { return '<option value="' + g + '">' + g + "</option>"; }).join("");

  function dongList(gu) {
    return Object.keys(D.regions)
      .filter(function (k) { return k.indexOf(gu + "|") === 0; })
      .map(function (k) { return k.split("|")[1]; })
      .sort(function (a, b) {
        var sum = function (d) {
          var r = regionOf(gu + "|" + d);
          return Object.values(r.nrgCnt).reduce(function (s, x) { return s + x; }, 0) +
                 Object.values(r.offiCnt).reduce(function (s, x) { return s + x; }, 0);
        };
        return sum(b) - sum(a);
      });
  }

  function fillDong() {
    if (state.gu === ALL) {
      dongSelect.innerHTML = '<option value="all">전체</option>';
      dongSelect.disabled = true;
      state.dong = ALL;
      return;
    }
    dongSelect.disabled = false;
    var list = dongList(state.gu);
    dongSelect.innerHTML = '<option value="all">' + state.gu + " 전체</option>" +
      list.map(function (d) { return '<option value="' + d + '">' + d + "</option>"; }).join("");
    if (list.indexOf(state.dong) === -1) state.dong = ALL;
    dongSelect.value = state.dong;
  }

  guSelect.addEventListener("change", function () {
    state.gu = guSelect.value; state.dong = ALL;
    fillDong(); renderAll();
  });
  dongSelect.addEventListener("change", function () {
    state.dong = dongSelect.value; renderAll();
  });

  /* ── 조회 기간 버튼 (최근 3 / 6 / 12개월) ── */
  var windowTabs = document.getElementById("windowTabs");
  windowTabs.innerHTML = Object.keys(D.windows).sort(function (a, b) { return a - b; })
    .map(function (k) {
      return '<button data-w="' + k + '"' + (k === state.win ? ' class="active"' : "") +
        ">" + D.windows[k].name + "</button>";
    }).join("");

  windowTabs.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-w]");
    if (!b || b.dataset.w === state.win) return;
    windowTabs.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
    b.classList.add("active");
    state.win = b.dataset.w;
    fillDong();
    renderAll();
  });

  /* ════════════════ 핵심 요약 ════════════════ */

  function renderKpi() {
    var r = region();
    var nrgTotal = NRG_GROUPS.reduce(function (s, g) { return s + (r.nrgCnt[g] || 0); }, 0);
    var offiRent = (r.offiCnt.jeonse || 0) + (r.offiCnt.wolse || 0);

    document.getElementById("kpiTitle").textContent = regionLabel() + " 핵심 요약";
    document.getElementById("kpiDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b> · 상업·업무용 매매 + 오피스텔 매매·전월세 총 <b>" +
      (nrgTotal + (r.offiCnt.sale || 0) + offiRent).toLocaleString() + "건</b>";

    document.getElementById("kpiRow").innerHTML = [
      { label: "일반상가 매매", value: (r.nrgCnt.shop || 0).toLocaleString() + "건", sub: "근린생활·판매 등" },
      { label: "업무용 매매", value: (r.nrgCnt.office || 0).toLocaleString() + "건", sub: "사무실·오피스" },
      { label: "상가·업무용 중위가", value: eokman(r.med.nrg), sub: "평당 " + (r.med.nrgPy || 0).toLocaleString() + "만원(연면적 기준)" },
      { label: "오피스텔 매매", value: (r.offiCnt.sale || 0).toLocaleString() + "건",
        sub: "중위 " + eokman(r.med.offiSale) +
             (r.med.offiPy ? " · 평당 " + pyConv(r.med.offiPy).toLocaleString() + "만원(" + pyBaseWord() + ")" : "") },
      { label: "오피스텔 전월세", value: offiRent.toLocaleString() + "건", sub: "월세 비중 " + pct(r.offiCnt.wolse, offiRent) },
    ].map(function (b) {
      return '<div class="stat-box"><div class="label">' + b.label + '</div><div class="value">' +
        b.value + '</div><div class="sub">' + b.sub + "</div></div>";
    }).join("");

    document.getElementById("periodNote").innerHTML = win().label + " 기준<br />자료 갱신 <b>" + (D.today || D.builtAt || "") + "</b>";
    document.getElementById("printBanner").innerHTML =
      "<b>" + regionLabel() + "</b> 상가·오피스텔 실거래 리포트 · 조회 기간 " + win().label +
      " · 자료 기준 " + (D.builtAt || "") + " · 반포114공인중개사 010-9442-2027";
  }

  function pct(a, b) { return b ? Math.round((a / b) * 100) + "%" : "-"; }

  /* ════════════════ 상가·업무용 TOP10 ════════════════ */

  function nrgRowsHtml(rows, group) {
    if (!rows.length) {
      return '<tr class="empty-row"><td colspan="8">해당 기간 · 지역에 ' + NRG_LABEL[group] + " 매매 신고가 없습니다.</td></tr>";
    }
    return rows.map(function (r, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td><div class="rt-name">' + esc(r.n) + "</div>" +
        (r.bt ? '<div class="rt-sub">' + esc(r.bt) + (r.lu ? " · " + esc(r.lu) : "") + "</div>" : "") + "</td>" +
        "<td>" + esc(r.gu) + " " + esc(r.dg) + '<div class="rt-sub">' + esc(r.jb || "") + "</div></td>" +
        "<td>" + areaText(r.a) + (r.la ? '<div class="rt-sub">대지 ' + r.la + "㎡</div>" : "") + "</td>" +
        "<td>" + (r.f ? esc(r.f) + "층" : "-") + "</td>" +
        '<td class="rt-price">' + eokman(r.v) + "</td>" +
        "<td>" + pyText(r.v, r.a) + "</td>" +
        '<td class="rt-sub">' + dateText(r.d) + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderNrg() {
    var r = region();
    document.getElementById("nrgBody").innerHTML = nrgRowsHtml(r.nrgTop[state.nrgGroup] || [], state.nrgGroup);
    if (window.wireScrollBoxes) window.wireScrollBoxes();

    document.getElementById("nrgPrintAll").innerHTML = NRG_GROUPS
      .filter(function (g) { return g !== state.nrgGroup; })
      .map(function (g) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · " + NRG_LABEL[g] + " 실거래가 TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>용도</th><th>소재지</th><th>연면적</th><th>층</th><th>거래가</th><th>평당가</th><th>거래일</th></tr></thead><tbody>' +
          nrgRowsHtml(r.nrgTop[g] || [], g) + "</tbody></table>";
      }).join("");
  }

  document.querySelectorAll("#nrgTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#nrgTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.nrgGroup = b.dataset.g;
      renderNrg();
    });
  });

  /* ── 전세가율 ──
     전세 신고가 없는 지역에서도 "얼마쯤 하느냐"는 답할 수 있어야 한다.
     같은 건물·같은 평형에서 매매·전세가 각 3건 이상인 곳만 짝지어 낸 비율이며
     build_data.py가 구워 둔다. 오피스텔은 아파트와 값이 전혀 다르다
     (아파트 42~60% / 오피스텔 81~96%). */

  var RATIO = D.jeonseRatio || {};

  function eraOf(y) {
    if (!y) return "?";
    return y >= 2020 ? "신축" : (y >= 2010 ? "준신축" : "구축");
  }

  // 지금 보는 지역 오피스텔의 대표 연식 — 매매 TOP10의 중위 준공연도로 잡는다
  function regionEra() {
    var rows = (region().offiTop.sale || []).concat(region().offiTop.jeonse || []);
    var ys = rows.map(function (x) { return x.y; }).filter(Boolean).sort();
    return ys.length ? eraOf(ys[ys.length >> 1]) : "?";
  }

  function jeonseRatio() {
    var gu = state.gu, e = regionEra();
    var tries = [
      { k: gu + "|" + e, basis: gu + " " + e + " 오피스텔" },
      { k: gu, basis: gu + " 오피스텔 전체" },
      { k: "서울|" + e, basis: "서울 " + e + " 오피스텔" },
      { k: "서울", basis: "서울 오피스텔 전체" },
    ];
    for (var i = 0; i < tries.length; i++) {
      var v = RATIO[tries[i].k];
      if (v) return { lo: v[0], mid: v[1], hi: v[2], n: v[3], basis: tries[i].basis };
    }
    return null;
  }

  /* 전세 신고가 없을 때 표 대신 넣을 추정 블록 */
  function jeonseGuessHtml() {
    var r = region();
    var q = jeonseRatio();
    var ms = r.med.offiSale;
    var head = '<p class="placeholder">이 지역·기간에 <b>오피스텔 전세 신고가 없습니다.</b></p>';
    if (!q || !ms) return head;

    var lo = Math.round(ms * q.lo / 100), hi = Math.round(ms * q.hi / 100);
    return head +
      '<div class="calc-box">' +
        '<div class="calc-head"><span class="calc-badge">계산값</span>' +
          "실거래가 아니라 <b>유사 실거래로 계산한 값</b>입니다</div>" +
        "<p>" + esc(q.basis) + "의 실제 전세가율은 <b>" + q.lo + "~" + q.hi + "%</b>" +
          "(중위 " + q.mid + "% · 같은 건물·같은 평형에서 매매·전세가 각 3건 이상인 <b>" +
          q.n.toLocaleString() + "개 평형</b>을 짝지어 계산)입니다. " +
          "이 지역 오피스텔 <b>중위 매매가 " + eokman(ms) + "</b>에 대보면 " +
          "전세는 <b>" + eokman(lo) + " ~ " + eokman(hi) + "</b> 수준이 됩니다.</p>" +
        (q.mid >= 80
          ? '<p class="calc-warn">⚠ 오피스텔 전세가율은 <b>' + q.mid + "%</b>로 아파트(50%대)보다 훨씬 높습니다. " +
            "<b>매매가가 조금만 내려도 보증금이 위태로워지는 구간</b>이라, " +
            "고객께 <b>전세보증금 반환보증 가입</b>과 <b>선순위 근저당 확인</b>을 반드시 안내하세요.</p>"
          : "") +
        '<p class="calc-foot">건물·층·향·관리 상태에 따라 이 범위를 벗어납니다. ' +
          "<b>실거래로 확인된 값이 아니니</b> 반드시 <b>참고 범위</b>로만 말씀하세요.</p>" +
      "</div>";
  }

  /* ════════════════ 오피스텔 TOP10 ════════════════ */

  function offiRowsHtml(rows, type, clickable) {
    if (!rows.length) {
      return '<tr class="empty-row"><td colspan="7">' +
        (type === "jeonse" ? "" : "해당 기간 · 지역에 오피스텔 " + OFFI_LABEL[type] + " 신고가 없습니다.") +
        "</td></tr>";
    }
    return rows.map(function (r, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      var where = (state.gu === ALL || state.dong === ALL)
        ? '<div class="rt-sub">' + esc(r.gu) + " " + esc(r.dg) + "</div>" : "";
      var name = clickable
        ? '<div class="rt-name rt-name-clickable" data-b="' + esc(r.n) + '" data-gu="' + esc(r.gu) + '" data-dong="' + esc(r.dg) + '">📍 ' + esc(r.n) + "</div>"
        : '<div class="rt-name">' + esc(r.n) + "</div>";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        "<td>" + name + where + "</td>" +
        "<td>" + areaBoth(r.a) + "</td>" +
        "<td>" + (r.f ? r.f + "층" : "-") + "</td>" +
        '<td class="rt-price">' + offiPriceText(r, type) + "</td>" +
        '<td class="rt-price">' + pyTextBoth(convValue(r, type), r.a) + "</td>" +
        '<td class="rt-sub">' + dateText(r.d) + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderOffi() {
    var r = region();
    var type = state.offiType;
    document.getElementById("offiPriceHead").textContent = type === "wolse" ? "보증금 / 월세" : "거래가";
    document.getElementById("offiBody").innerHTML = offiRowsHtml(r.offiTop[type] || [], type, true);
    if (window.wireScrollBoxes) window.wireScrollBoxes();

    // 전세만 비어 있으면 "없습니다"로 끝내지 말고 계산 범위를 짚어 준다
    var empty = !(r.offiTop[type] || []).length;
    document.getElementById("offiGuess").innerHTML =
      (empty && type === "jeonse") ? jeonseGuessHtml()
        : (empty ? '<p class="placeholder">해당 기간 · 지역에 오피스텔 ' + OFFI_LABEL[type] + " 신고가 없습니다.</p>" : "");

    document.getElementById("offiPrintAll").innerHTML = OFFI_TYPES
      .filter(function (t) { return t !== type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · 오피스텔 " + OFFI_LABEL[t] + " TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>건물명</th><th>전용면적</th><th>층</th><th>' +
          (t === "wolse" ? "보증금 / 월세" : "거래가") + "</th><th>평당가</th><th>거래일</th></tr></thead><tbody>" +
          offiRowsHtml(r.offiTop[t] || [], t, false) + "</tbody></table>";
      }).join("");

    document.querySelectorAll("#offiBody .rt-name-clickable").forEach(function (el, i) {
      el.addEventListener("click", function () {
        focusBuilding(el.dataset.gu, el.dataset.dong, el.dataset.b, i);
      });
    });

    renderOffiCmp();
  }

  document.querySelectorAll("#offiTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#offiTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.offiType = b.dataset.t;
      renderOffi();
      renderMap();
    });
  });

  var offiCmpChart = null;

  function renderOffiCmp() {
    var r = region();
    var labels = ["1위", "2위", "3위", "4위", "5위", "6위", "7위", "8위", "9위", "10위"];
    if (offiCmpChart) offiCmpChart.destroy();
    offiCmpChart = new Chart(document.getElementById("offiCmpChart"), {
      type: "line",
      data: {
        labels: labels,
        datasets: OFFI_TYPES.map(function (t) {
          var rows = (r.offiTop[t] || []).slice(0, 10);   // 차트는 TOP10만
          return {
            label: OFFI_LABEL[t],
            _type: t,
            data: labels.map(function (_, i) {
              return rows[i] ? +(convValue(rows[i], t) / 10000).toFixed(2) : null;
            }),
            borderColor: OFFI_COLOR[t],
            backgroundColor: OFFI_COLOR[t] + "33",
            borderWidth: 2.5, pointRadius: 3.5, tension: 0.3, spanGaps: true,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: regionLabel() + " · 오피스텔 매매·전세·월세 TOP10 가격 비교 (억원)", font: { size: 13, weight: "bold" } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var rows = r.offiTop[c.dataset._type] || [];
                var row = rows[c.dataIndex];
                return row ? c.dataset.label + " " + c.parsed.y + "억 — " + row.n + " " + row.a + "㎡"
                           : c.dataset.label + ": -";
              },
            },
          },
        },
        scales: { y: { beginAtZero: true, title: { display: true, text: "억원" } } },
      },
    });
  }

  /* ════════════════ 거래량 ════════════════ */

  var volMonthChart = null, volDonutChart = null, volGuChart = null;

  function renderVolume() {
    var r = region();
    var labels = win().labels;

    if (volMonthChart) volMonthChart.destroy();
    volMonthChart = new Chart(document.getElementById("volMonthChart"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          { label: "상가·업무용 매매",
            data: labels.map(function (_, i) {
              return NRG_GROUPS.reduce(function (s, g) { return s + ((r.nrgVol[g] || [])[i] || 0); }, 0);
            }),
            backgroundColor: "#4f7fe6" },
          { label: "오피스텔 매매", data: (r.offiVol.sale || []).slice(), backgroundColor: "#4fada8" },
          { label: "오피스텔 전월세",
            data: labels.map(function (_, i) {
              return ((r.offiVol.jeonse || [])[i] || 0) + ((r.offiVol.wolse || [])[i] || 0);
            }),
            backgroundColor: "#cf9a45" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: regionLabel() + " · 월별 거래건수", font: { size: 13, weight: "bold" } },
        },
        scales: { y: { beginAtZero: true, title: { display: true, text: "건" } } },
      },
    });

    if (volDonutChart) volDonutChart.destroy();
    volDonutChart = new Chart(document.getElementById("volDonutChart"), {
      type: "doughnut",
      data: {
        labels: ["일반상가", "업무용", "기타 상업·업무", "오피스텔 매매", "오피스텔 전세", "오피스텔 월세"],
        datasets: [{
          data: [r.nrgCnt.shop || 0, r.nrgCnt.office || 0, r.nrgCnt.etc || 0,
                 r.offiCnt.sale || 0, r.offiCnt.jeonse || 0, r.offiCnt.wolse || 0],
          backgroundColor: ["#4f7fe6", "#4fada8", "#cf9a45", "#35569e", "#7ec8c3", "#e0b76a"],
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 11, font: { size: 10.5 } } },
          title: { display: true, text: "유형별 구성비", font: { size: 13, weight: "bold" } },
        },
      },
    });

    var top = D.rankGu[state.win].slice(0, 12);
    var guCanvas = document.getElementById("volGuChart");
    // 막대 수에 맞춰 높이를 잡는다(고정 340px이면 자치구 이름이 겹친다)
    guCanvas.parentElement.style.height = Math.max(260, top.length * 34 + 96) + "px";
    if (volGuChart) volGuChart.destroy();
    volGuChart = new Chart(guCanvas, {
      type: "bar",
      data: {
        // 위 표의 순위와 짝이 맞게 번호를 붙인다
        labels: top.map(function (x, i) { return (i + 1) + ". " + x.label; }),
        datasets: [
          { label: "상가·업무용 매매", data: top.map(function (x) { return x.nrg; }), backgroundColor: "#4f7fe6", barThickness: 13 },
          { label: "오피스텔 (매매+전월세)", data: top.map(function (x) { return x.offi; }), backgroundColor: "#4fada8", barThickness: 13 },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: "서울 자치구별 수익형 부동산 실거래량 TOP 12 (" + win().label + ")", font: { size: 13, weight: "bold" } },
        },
        scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: "건" } }, y: { stacked: true } },
      },
    });

    // 25개 자치구를 다 담는다 — 표는 10행만 보이고 나머지는 펼쳐서 본다
    document.getElementById("volGuBody").innerHTML = D.rankGu[state.win].map(function (x, i) {
      var reg = regionOf(x.k);
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td class="rt-name">' + esc(x.label) + "</td>" +
        '<td class="rt-price">' + x.nrg.toLocaleString() + "건</td>" +
        "<td>" + (reg.offiCnt.sale || 0).toLocaleString() + "건</td>" +
        "<td>" + ((reg.offiCnt.jeonse || 0) + (reg.offiCnt.wolse || 0)).toLocaleString() + "건</td>" +
        "<td>" + eokman(reg.med.nrg) + "</td>" +
        "<td>" + eokman(reg.med.offiSale) + "</td>" +
        "</tr>";
    }).join("");
    if (window.wireScrollBoxes) window.wireScrollBoxes();
  }

  /* ════════════════ 지도 ════════════════ */

  var map = null, markerLayer = null, markers = {};

  function initMap() {
    map = L.map("sgMap", { scrollWheelZoom: true }).setView([37.5535, 126.9905], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  function renderMap() {
    if (!map) return;
    markerLayer.clearLayers();
    markers = {};
    var rows = (region().offiTop[state.offiType] || []).slice(0, 10);   // 지도는 TOP10만
    var pts = [], miss = 0;

    // 같은 건물이 호실만 달리해 여러 번 오르면 좌표가 똑같아 마커가 겹친다.
    // 건물 단위로 하나만 찍고, 그 건물의 거래는 오른쪽에 모아 보여준다.
    selectedKey = null;
    var order = [];
    nameIndex = {};
    rows.forEach(function (row, i) {
      var c = GEO[row.gu + "|" + row.dg + "|" + row.n];
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
      miss ? "좌표 미확인 " + miss + "곳은 표시되지 않습니다" : "";

    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    else map.setView([37.5535, 126.9905], 11);

    document.getElementById("sgDetail").innerHTML =
      '<p class="placeholder">지도의 원 또는 아래 오피스텔 TOP10 표의<br />건물명을 클릭하세요.</p>';
  }

  var nameIndex = {};          // "구|동|건물" -> 좌표키

  // 한 지점에 건물이 여럿이면 이름을 이어 붙인다
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
      fillColor: OFFI_COLOR[state.offiType],
      fillOpacity: on ? 1 : 0.92,
    };
  }

  function selectMarker(key) {
    // 눌린 곳이 눈에 보여야 "바뀌었나?" 하지 않는다
    if (selectedKey && markers[selectedKey] && markers[selectedKey].marker) {
      markers[selectedKey].marker.setStyle(markerStyle(markers[selectedKey], false));
    }
    selectedKey = key;
    if (key && markers[key] && markers[key].marker) {
      markers[key].marker.setStyle(markerStyle(markers[key], true)).bringToFront();
    }
  }

  function showDetail(key, focusRank) {
    var g = markers[key];
    if (!g) return;
    var t = state.offiType;
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
        '<td class="rt-price">' + offiPriceText(x.row, t) + "</td>" +
        "<td>" + pyConv(convValue(x.row, t) / (x.row.a / PYEONG)).toLocaleString() + "만원</td>" +
        '<td class="rt-sub">' + dateText(x.row.d) + "</td></tr>";
    }).join("");

    document.getElementById("sgDetail").innerHTML =
      '<span class="zone-tag" style="background:' + OFFI_COLOR[t] + '">오피스텔 ' + OFFI_LABEL[t] +
        (g.rows.length > 1 ? " TOP10 " + g.rows.length + "건" : " " + (g.rank + 1) + "위") + "</span>" +
      "<h3>" + esc(mapTitle(g)) + "</h3>" +
      '<p class="detail-where">' + esc(first.gu) + " " + esc(first.dg) +
        (first.y ? " · " + first.y + "년 준공" : "") + "</p>" +
      '<div class="table-wrap"><table class="detail-deals"><thead><tr>' +
      "<th>순위</th>" + (multi ? "<th>건물</th>" : "") + "<th>전용면적</th><th>층</th><th>" +
      (t === "wolse" ? "보증금/월세" : "거래금액") + "</th><th>평당가</th><th>거래일</th>" +
      "</tr></thead><tbody>" + list + "</tbody></table></div>";
  }

  function focusBuilding(gu, dong, name, rank) {
    var key = nameIndex[gu + "|" + dong + "|" + name];
    var hit = key && markers[key];
    if (!hit) {
      document.getElementById("sgDetail").innerHTML =
        '<p class="placeholder">「' + esc(name) + "」의 좌표를 찾지 못해<br />지도에 표시할 수 없습니다.</p>";
      return;
    }
    map.flyTo([hit.coord.lat, hit.coord.lng], 16, { duration: 0.6 });
    hit.marker.openTooltip();
    selectMarker(key);
    showDetail(key, rank);
    document.getElementById("sec-map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ════════════════ 수익형 입지분석 ════════════════ */

  var LOC_ITEMS = [
    { k: "data", ico: "📊", title: "데이터로 본 수익형", summary: "실거래 기반 지표" },
    { k: "dong", ico: "🗺️", title: "동별 거래 분포", summary: "구 안에서 어디가 활발한가" },
    { k: "yield", ico: "💰", title: "수익률 계산", summary: "월세 → 표면수익률" },
    { k: "risk", ico: "⚠️", title: "체크 리스크", summary: "공실·관리비·업종" },
  ];

  function renderLocation() {
    document.getElementById("locTitle").textContent = regionLabel() + " 수익형 부동산 입지분석";
    document.getElementById("locGrid").innerHTML = LOC_ITEMS.map(function (it) {
      return '<button class="loc-card" data-k="' + it.k + '">' +
        '<div class="ico">' + it.ico + "</div><div class=\"title\">" + it.title +
        '</div><div class="summary">' + it.summary + "</div></button>";
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
    box.innerHTML = locHtml("data");
    box.classList.remove("show");
    box.dataset.printAll = LOC_ITEMS.map(function (it) { return locHtml(it.k); }).join("");
  }

  function locHtml(k) {
    var r = region();
    var seoul = regionOf(ALL);

    if (k === "data") {
      var ratio = seoul.med.nrgPy ? Math.round((r.med.nrgPy / seoul.med.nrgPy) * 100) : 0;
      return "<h3>📊 데이터로 본 수익형 — " + regionLabel() + "</h3><ul>" +
        "<li>상가·업무용 중위 거래가 <b>" + eokman(r.med.nrg) + "</b> · 연면적 평당 <b>" +
        (r.med.nrgPy || 0).toLocaleString() + "만원</b> (서울 중위 대비 <b>" + ratio + "%</b>)</li>" +
        "<li>오피스텔 중위 매매가 <b>" + eokman(r.med.offiSale) + "</b> · 중위 전세보증금 <b>" +
        eokman(r.med.offiJeonse) + "</b> · 중위 월세 <b>" + (r.med.offiWolse || 0).toLocaleString() + "만원</b></li>" +
        "<li>표본 기간 상가·업무용 <b>" + NRG_GROUPS.reduce(function (s, g) { return s + (r.nrgCnt[g] || 0); }, 0).toLocaleString() +
        "건</b>, 오피스텔 <b>" + ((r.offiCnt.sale || 0) + (r.offiCnt.jeonse || 0) + (r.offiCnt.wolse || 0)).toLocaleString() + "건</b> 신고</li>" +
        "<li>오피스텔 전월세 중 <b>월세 비중 " + pct(r.offiCnt.wolse, (r.offiCnt.jeonse || 0) + (r.offiCnt.wolse || 0)) +
        "</b> — 비중이 높을수록 임대수익형 수요가 강한 지역입니다</li></ul>" +
        "<p style='margin-top:10px;color:var(--txt-mute);font-size:12.5px'>※ 상업용 평당가는 <b>건물 연면적</b> 기준이라 아파트 전용면적 평당가와 직접 비교할 수 없습니다.</p>";
    }

    if (k === "dong") {
      var list = (state.gu === ALL ? seoul : regionOf(state.gu)).dongCnt || [];
      if (state.gu !== ALL && state.dong !== ALL) list = regionOf(state.gu).dongCnt || [];
      return "<h3>🗺️ 동별 상가·업무용 거래 분포 — " + (state.gu === ALL ? "서울 전체" : state.gu) + "</h3>" +
        (list.length
          ? '<table class="rank-table"><thead><tr><th>순위</th><th>법정동</th><th>상가·업무용 매매</th></tr></thead><tbody>' +
            list.map(function (x, i) {
              return "<tr><td>" + (i + 1) + "</td><td>" + esc(x.label) + '</td><td class="rt-price">' +
                x.c.toLocaleString() + "건</td></tr>";
            }).join("") + "</tbody></table>"
          : "<p>표시할 자료가 없습니다.</p>");
    }

    if (k === "yield") {
      var dep = r.med.offiJeonse || 0, rent = r.med.offiWolse || 0, price = r.med.offiSale || 0;
      var yieldPct = price ? ((rent * 12) / (price - dep) * 100) : 0;
      return "<h3>💰 오피스텔 표면수익률(참고 계산)</h3><ul>" +
        "<li>중위 매매가 <b>" + eokman(price) + "</b>, 중위 월세보증금 <b>" + eokman(dep) +
        "</b>, 중위 월세 <b>" + rent.toLocaleString() + "만원</b></li>" +
        "<li>표면수익률 ≈ (월세 × 12) ÷ (매매가 − 보증금) = <b>" +
        (isFinite(yieldPct) && yieldPct > 0 ? yieldPct.toFixed(2) + "%" : "계산 불가") + "</b></li>" +
        "</ul><p style='margin-top:10px;color:var(--txt-mute);font-size:12.5px'>" +
        "※ 서로 다른 물건의 <b>중위값을 조합한 참고 수치</b>입니다. 실제 수익률은 관리비·공실·취득세·중개보수·대출이자를 빼야 하며, " +
        "같은 물건 기준으로 다시 계산해야 합니다.</p>";
    }

    return "<h3>⚠️ 수익형 부동산 체크 리스크</h3><ul>" +
      "<li><b>공실 리스크</b> — 상가는 임차인이 빠지면 수익이 0이 됩니다. 현재 임차 상태·잔여 계약기간·업종을 확인하세요.</li>" +
      "<li><b>실투자금</b> — 상가 취득세는 <b>4.6%</b>로 주택보다 높고, 대출 조건도 다릅니다.</li>" +
      "<li><b>관리비·수선</b> — 집합상가는 관리비와 장기수선 부담이 수익률을 크게 깎습니다.</li>" +
      "<li><b>오피스텔 주택 수 산정</b> — 주거용으로 쓰면 <b>주택 수에 포함</b>되어 기존 주택의 세금이 달라질 수 있습니다.</li>" +
      "<li><b>상가임대차보호법</b> — 환산보증금 기준 초과 여부에 따라 보호 범위가 달라집니다. 계약갱신요구권(10년)과 권리금 회수기회 보호도 확인하세요.</li>" +
      "</ul>";
  }

  window.addEventListener("beforeprint", function () {
    var box = document.getElementById("locDetail");
    if (box && box.dataset.printAll && !box.classList.contains("show")) {
      box.dataset.screenHtml = box.innerHTML;
      box.innerHTML = box.dataset.printAll;
      box.dataset.expanded = "1";
    }
  });
  window.addEventListener("afterprint", function () {
    var box = document.getElementById("locDetail");
    if (box && box.dataset.expanded === "1") {
      box.innerHTML = box.dataset.screenHtml || "";
      box.dataset.expanded = "";
    }
  });

  /* ════════════════ 정책 ════════════════ */

  var POLICY = [
    { date: "세금", title: "상가 취득세 4.6%", body: "상가·업무용 부동산은 취득세 <b>4.6%</b>(농특세·지방교육세 포함)로 주택보다 높습니다. 실투자금 계산에 반드시 넣으세요.", tag: "세제" },
    { date: "부가세", title: "부가가치세와 포괄양수도", body: "상가 매매는 건물분에 <b>부가세 10%</b>가 붙습니다. <b>포괄양수도</b> 요건을 갖추면 생략할 수 있으나 요건이 엄격합니다.", tag: "세제" },
    { date: "임대차", title: "상가임대차보호법", body: "<b>환산보증금 = 보증금 + 월세×100</b> 기준을 넘으면 보호 범위가 달라집니다. 계약갱신요구권(최대 10년)과 <b>권리금 회수기회 보호</b>는 환산보증금과 무관하게 적용됩니다.", tag: "임대차" },
    { date: "오피스텔", title: "주거용 오피스텔 주택 수 산정", body: "주거용으로 사용·신고된 오피스텔은 <b>주택 수에 포함</b>되어 기존 주택의 양도세·종부세에 영향을 줍니다. 업무용/주거용 구분이 핵심입니다.", tag: "필수 확인" },
    { date: "대출", title: "임대사업자 대출(RTI)", body: "상가·오피스텔 임대사업자 대출은 <b>임대업이자상환비율(RTI)</b> 심사를 받습니다. 금리 변동 시 한도가 줄어들 수 있습니다.", tag: "자금계획" },
    { date: "수익률", title: "표면수익률 vs 실질수익률", body: "광고의 수익률은 대개 <b>표면수익률</b>입니다. 관리비·공실·재산세·중개보수·대출이자를 뺀 <b>실질수익률</b>로 다시 계산하세요.", tag: "리스크" },
  ];

  document.getElementById("policyGrid").innerHTML = POLICY.map(function (p) {
    return '<div class="policy-card"><span class="date-chip">' + p.date + "</span><h4>" + p.title +
      "</h4><p>" + p.body + '</p><span class="tag">' + p.tag + "</span></div>";
  }).join("");

  /* ════════════════ 렌더 ════════════════ */

  /* 그 지역에 아예 거래가 없는 유형은 섹션을 통째로 감춘다.
     "신고가 없습니다" 한 줄만 남기고 자리를 차지하는 것보다 낫다. */
  function toggleSections() {
    var r = region();
    var nrgTotal = NRG_GROUPS.reduce(function (s, g) { return s + (r.nrgCnt[g] || 0); }, 0);
    var offiTotal = OFFI_TYPES.reduce(function (s, t) { return s + (r.offiCnt[t] || 0); }, 0);

    var set = function (secId, navTarget, on) {
      var sec = document.getElementById(secId);
      if (sec) sec.hidden = !on;
      var nav = document.querySelector('nav.section-nav button[data-target="' + navTarget + '"]');
      if (nav) nav.hidden = !on;
    };
    set("sec-nrg", "sec-nrg", nrgTotal > 0);
    set("sec-offi", "sec-offi", offiTotal > 0);
    // 오피스텔 매매가 없으면 지도에 찍을 게 없다
    set("sec-map", "sec-map", (r.offiCnt.sale || 0) > 0);

    // 어느 쪽도 없으면 그 사실을 한 번만 알린다
    var note = document.getElementById("noDataNote");
    if (note) {
      var none = nrgTotal === 0 && offiTotal === 0;
      note.hidden = !none;
      if (none) {
        note.innerHTML = "<b>" + esc(regionLabel()) + "</b>에는 선택한 기간(" + esc(win().name) +
          ")에 상가·업무용과 오피스텔 실거래 신고가 <b>모두 없습니다</b>. " +
          "기간을 늘리거나 다른 지역을 골라 보세요.";
      }
    }
    return { nrgTotal: nrgTotal, offiTotal: offiTotal };
  }

  /* ════════════════ 상담용 월별 브리핑 ════════════════
     고정 3/6/12개월 집계로는 "6월 대비 7월"을 말할 수 없다.
     달 단위 건수·중위값을 표로 내고, 표본이 얇은 달은 눌러 표시한다. */

  var MIN_N = 10;   // 이 건수는 넘어야 "흐름"을 말할 수 있다

  function moLabel(ym) { return ym.slice(2, 4) + "년 " + parseInt(ym.slice(4), 10) + "월"; }

  // 신고 기한 30일 — 그 달 말일 + 30일이 자료 기준일을 넘으면 아직 집계중
  function isPending(ym) {
    var today = (D.today || D.builtAt || "").slice(0, 10);
    if (!today) return false;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(4), 10);
    var due = new Date(y, m, 0);
    due.setDate(due.getDate() + 30);
    return due > new Date(today + "T00:00:00");
  }

  function moFlag(ym, n, hot) {
    var t = "";
    if (isPending(ym)) t += ' <span class="brief-flag">집계중</span>';
    if (n > 0 && n < MIN_N) t += ' <span class="brief-thin">표본 적음</span>';
    if (hot && n) {
      t += ' <span class="brief-hot" title="' + esc(hot[0]) + ' 한 곳이 ' + hot[1] +
           '건(' + Math.round(hot[1] / n * 100) + '%) — 중위값이 그 건물 값에 끌려갑니다">한 곳 ' +
           Math.round(hot[1] / n * 100) + '%</span>';
    }
    return t;
  }

  function deltaHtml(cur, prev, nCur, nPrev, hot) {
    if (!cur || !prev) return '<span class="dim-note">-</span>';
    var r = (cur - prev) / prev * 100, sign = r > 0 ? "+" : "";
    if (nCur < MIN_N || nPrev < MIN_N || hot) {
      return '<span class="d-weak" title="표본이 적어 시세 변동으로 보기 어렵습니다">' +
             sign + r.toFixed(1) + '%<sup>*</sup></span>';
    }
    var cls = Math.abs(r) < 1 ? "d-flat" : (r > 0 ? "d-up" : "d-down");
    return '<span class="' + cls + '">' + sign + r.toFixed(1) + "%</span>";
  }

  // 머리글을 두 줄로 — 단어 중간에서 끊기는 걸 막는다
  function th2(a, b) { return '<span class="th2">' + a + "</span><span class=\"th2\">" + b + "</span>"; }

  function briefCard(title, cols, rows) {
    return '<div class="brief-card"><h4>' + title + "</h4>" +
      '<div class="table-wrap"><table class="brief-table"><thead><tr>' +
      cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div></div>";
  }

  // 선택한 기간만큼 달을 잘라 [{ym, r, hot}] 형태로.
  // hot = 그 달 거래의 30% 이상을 한 건물이 차지한 경우 [이름, 건수]
  function moSlice(key, field) {
    var reg = D.regions[key];
    var n = parseInt(state.win, 10);
    var yms = D.months.slice(-n);
    var mo = reg && reg.mo;
    var rows = (mo && mo[field]) ? mo[field].slice(-n) : [];
    var hot = (mo && mo.hot && mo.hot[field]) || {};
    return yms.map(function (y, i) {
      return { ym: y, r: rows[i] || [0, 0, 0, 0], hot: hot[y] || null };
    });
  }

  // 섹션과 목차 버튼을 함께 감춘다 — 목차만 남으면 눌러도 안 움직인다
  function showBrief(on) {
    var sec = document.getElementById("sec-brief");
    if (sec) sec.hidden = !on;
    var nav = document.querySelector('nav.section-nav button[data-target="sec-brief"]');
    if (nav) nav.hidden = !on;
  }

  function renderBrief() {
    document.getElementById("briefTitle").textContent = regionLabel();
    document.getElementById("briefDesc").innerHTML =
      "조회 기간 <b>" + win().label + "</b>을 <b>달 단위</b>로 끊어 정리했습니다. " +
      "<b>고객께 말씀하실 숫자는 이 표에서</b> 가져가세요.";

    var key = regionKey();
    var shop = moSlice(key, "shop");
    var office = moSlice(key, "office");
    var sale = moSlice(key, "sale");
    var jeonse = moSlice(key, "jeonse");
    var wolse = moSlice(key, "wolse");

    var grid = document.getElementById("briefGrid");
    var total = [shop, office, sale, jeonse, wolse].reduce(function (a, list) {
      return a + list.reduce(function (b, x) { return b + x.r[0]; }, 0);
    }, 0);

    // 거래가 없으면 "없습니다" 한 줄로 자리를 차지하지 말고 섹션째 감춘다
    if (!total) {
      showBrief(false);
      grid.innerHTML = "";
      document.getElementById("briefScript").innerHTML = "";
      document.getElementById("briefThinNote").hidden = true;
      return;
    }
    showBrief(true);

    // ── 상가·업무용: 건수 / 중위 거래가 / 평당가(연면적) ──
    var nrgRows = shop.map(function (x, i) {
      var o = office[i].r;
      var pv = i ? shop[i - 1].r[2] : 0, pn = i ? shop[i - 1].r[0] : 0;
      return "<tr><td>" + moLabel(x.ym) + moFlag(x.ym, x.r[0], x.hot) + "</td>" +
        "<td>" + x.r[0].toLocaleString() + "건</td>" +
        "<td>" + (x.r[1] ? eokman(x.r[1]) : "-") + "</td>" +
        "<td>" + (x.r[2] ? Math.round(x.r[2]).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + deltaHtml(x.r[2], pv, x.r[0], pn, x.hot) + "</td>" +
        "<td>" + o[0].toLocaleString() + "건</td></tr>";
    });

    // ── 오피스텔 매매·전세 ──
    var saleRows = sale.map(function (x, i) {
      var j = jeonse[i].r;
      var pv = i ? sale[i - 1].r[2] : 0, pn = i ? sale[i - 1].r[0] : 0;
      return "<tr><td>" + moLabel(x.ym) + moFlag(x.ym, x.r[0], x.hot) + "</td>" +
        "<td>" + x.r[0].toLocaleString() + "건</td>" +
        "<td>" + (x.r[1] ? eokman(x.r[1]) : "-") + "</td>" +
        "<td>" + deltaHtml(x.r[2], pv, x.r[0], pn, x.hot) + "</td>" +
        "<td>" + j[0].toLocaleString() + "건</td>" +
        "<td>" + (j[1] ? eokman(j[1]) : "-") + "</td></tr>";
    });

    // ── 오피스텔 월세: 값이 아니라 계약 구조가 핵심 ──
    var wolseRows = wolse.map(function (x) {
      var n = x.r[0];
      return "<tr><td>" + moLabel(x.ym) + moFlag(x.ym, n, x.hot) + "</td>" +
        "<td>" + n.toLocaleString() + "건</td>" +
        "<td>" + (x.r[1] ? eokman(x.r[1]) : "-") + "</td>" +
        "<td>" + (x.r[2] ? Math.round(x.r[2]).toLocaleString() + "만원" : "-") + "</td>" +
        "<td>" + (n ? Math.round(x.r[3] / n * 100) + "%" : "-") + "</td></tr>";
    });

    grid.innerHTML =
      briefCard("상가·업무용 매매",
        ["월", "일반상가", th2("중위", "거래가"), th2("평당가", "연면적 기준"), "전월비", "업무용"], nrgRows) +
      briefCard("오피스텔 매매·전세",
        ["월", "매매", th2("중위", "매매가"), "전월비", "전세", th2("중위", "보증금")], saleRows) +
      briefCard("오피스텔 월세",
        ["월", "건수", th2("중위", "보증금"), th2("중위", "월세"), th2("준전세", "비중")], wolseRows);

    renderBriefThin([
      { name: "일반상가 매매", list: shop },
      { name: "업무용 매매", list: office },
      { name: "오피스텔 매매", list: sale },
      { name: "오피스텔 전세", list: jeonse },
      { name: "오피스텔 월세", list: wolse },
    ]);
    renderBriefScript(shop, office, sale, jeonse, wolse);
  }

  // 달마다 표본이 한 번도 MIN_N을 넘지 못한 유형은 따로 경고한다
  function renderBriefThin(groups) {
    var thin = groups.filter(function (g) {
      var months = g.list.filter(function (x) { return x.r[0] > 0; });
      return months.length && months.every(function (x) { return x.r[0] < MIN_N; });
    });
    var note = document.getElementById("briefThinNote");
    if (!thin.length) { note.hidden = true; return; }
    note.hidden = false;
    note.innerHTML = "<span><b>" + thin.map(function (g) { return g.name; }).join(" · ") +
      "</b>은(는) 달마다 " + MIN_N + "건이 안 됩니다. " +
      "<b>중위값을 시세로 말씀하시면 안 됩니다</b> \u2014 그 달에 어떤 물건이 팔렸는지에 따라 값이 몇 배로 뜁니다. " +
      (state.dong !== ALL
        ? "<b>법정동을 \u2018전체\u2019로</b> 놓고 자치구 단위로 보시길 권합니다."
        : "조회 기간을 <b>12개월</b>로 넓히시거나, 아래 TOP10에서 <b>개별 물건</b>을 직접 보여 주세요.") +
      "</span>";
  }

  /* 고객 앞에서 그대로 읽어 드릴 수 있게 금집부쌤 1인칭으로 풀어 준다.
     예측은 하지 않고 확인된 수치와 한계만 말한다. */
  function renderBriefScript(shop, office, sale, jeonse, wolse) {
    var out = [];
    document.getElementById("briefScriptTitle").textContent =
      "금집부쌤이 보는 " + regionLabel();

    function trend(list, label, idx, unitTxt) {
      // 한 곳이 30% 넘게 차지한 달은 중위값이 그 건물 값이라 흐름에서 뺀다
      var pts = list.filter(function (x) { return x.r[0] >= MIN_N && x.r[idx] && !x.hot; });
      var any = list.filter(function (x) { return x.r[0] > 0; });
      var total = any.reduce(function (a, x) { return a + x.r[0]; }, 0);
      if (!total) return "<b>" + label + "</b>는 이 기간에 거래가 없었습니다.";

      if (pts.length < 2) {
        var enough = list.filter(function (x) { return x.r[0] >= MIN_N && x.r[idx]; });
        var hotOnly = enough.filter(function (x) { return x.hot; });
        var why;
        if (hotOnly.length) {
          why = "값을 쓸 만한 달이 " +
            hotOnly.map(function (x) { return moLabel(x.ym) + " <b>" + esc(x.hot[0]) + "</b>"; }).join(", ") +
            "처럼 <b>한 곳에 몰려</b> 있어서 <b>달별 흐름을 말씀드리기 어렵습니다</b>. ";
        } else if (enough.length) {
          why = "값을 쓸 만한 달이 <b>" + moLabel(enough[0].ym) + " 한 달뿐</b>이라 " +
                "<b>비교해 드릴 대상이 없습니다</b>. ";
        } else {
          why = "달마다 " + MIN_N + "건이 안 돼 <b>달별 흐름을 말씀드리기 어렵습니다</b>. ";
        }
        return "<b>" + label + "</b>는 이 기간 <b>" + total.toLocaleString() + "건</b>인데, " + why +
          "건수만 참고하시고, 값은 제가 <b>물건 하나하나로</b> 짚어 드리겠습니다.";
      }

      var a2 = pts[0], b2 = pts[pts.length - 1];
      var r = (b2.r[idx] - a2.r[idx]) / a2.r[idx] * 100;
      var word = Math.abs(r) < 1.5 ? "거의 그대로입니다"
               : (r > 0 ? "<b>" + r.toFixed(1) + "% 올랐습니다</b>"
                        : "<b>" + Math.abs(r).toFixed(1) + "% 내렸습니다</b>");
      var t = "<b>" + label + "</b>는 " + moLabel(a2.ym) + " " + unitTxt + " " +
        Math.round(a2.r[idx]).toLocaleString() + "만원(" + a2.r[0] + "건)에서 " +
        moLabel(b2.ym) + " " + Math.round(b2.r[idx]).toLocaleString() + "만원(" + b2.r[0] + "건)으로 " +
        word + ".";
      if (isPending(b2.ym)) {
        t += " 다만 " + moLabel(b2.ym) + "은 <b>신고가 아직 다 안 들어와</b> 확정된 숫자가 아닙니다.";
      }
      if (pts.length >= 3) {
        var vals = pts.map(function (x) { return x.r[idx]; });
        var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
        if (lo && (hi - lo) / lo * 100 >= 20) {
          t += " 그런데 <b>쭉 한 방향으로 움직인 건 아닙니다</b> \u2014 가장 높았던 달은 " +
            moLabel(pts[vals.indexOf(hi)].ym) + " " + Math.round(hi).toLocaleString() + "만원, 낮았던 달은 " +
            moLabel(pts[vals.indexOf(lo)].ym) + " " + Math.round(lo).toLocaleString() + "만원으로 <b>" +
            Math.round((hi - lo) / lo * 100) + "%</b>나 차이가 납니다. " +
            "<b>그 달에 어떤 물건이 팔렸느냐</b>에 따라 흔들린 것이라 추세로 보시면 안 됩니다.";
        }
      }
      var hots = list.filter(function (x) { return x.hot && x.r[0] >= MIN_N; });
      if (hots.length) {
        t += " (" + hots.map(function (x) {
          return moLabel(x.ym) + "은 <b>" + esc(x.hot[0]) + "</b> 한 곳이 " + x.hot[1] + "건";
        }).join(", ") + "이라 이 계산에서 뺐습니다. 한 건물 물량이 통째로 신고되면 " +
        "<b>그 달 중위값은 사실상 그 건물 값</b>이 됩니다.)";
      }
      return t;
    }

    out.push(trend(shop, "일반상가 매매", 2, "평당(연면적)"));
    out.push(trend(sale, "오피스텔 매매", 2, "평당"));

    // 월세는 값이 아니라 계약 구조가 핵심이다
    var w = wolse.filter(function (x) { return x.r[0] >= MIN_N && x.r[2]; });
    if (w.length >= 2) {
      var wa = w[0], wb = w[w.length - 1];
      var jrA = Math.round(wa.r[3] / wa.r[0] * 100), jrB = Math.round(wb.r[3] / wb.r[0] * 100);
      var gap = (wb.r[2] - wa.r[2]) / wa.r[2] * 100;
      var t3 = "<b>오피스텔 월세</b>는 중위 월세가 " + Math.round(wa.r[2]).toLocaleString() + "만원에서 " +
        Math.round(wb.r[2]).toLocaleString() + "만원으로 " +
        (Math.abs(gap) < 1 ? "거의 그대로고" : (gap > 0 ? "<b>" + gap.toFixed(0) + "% 올랐고</b>"
                                                        : "<b>" + Math.abs(gap).toFixed(0) + "% 내렸고</b>")) +
        ", 보증금은 " + eokman(wa.r[1]) + "에서 " + eokman(wb.r[1]) + ", " +
        "준전세 비중은 " + jrA + "%에서 " + jrB + "%입니다.";
      if (jrB - jrA >= 8 && gap < 0) {
        t3 += " <b>보증금을 올리고 월세를 낮추는 쪽</b>으로 옮겨가고 있습니다. " +
              "임대수익으로 보고 계시면 <b>월세가 내렸다는 점</b>을 꼭 감안하셔야 합니다.";
      } else if (jrA - jrB >= 8 && gap > 0) {
        t3 += " <b>보증금을 낮추고 월세를 늘리는 쪽</b>으로 옮겨가고 있습니다.";
      }
      out.push(t3);
    } else if (wolse.some(function (x) { return x.r[0]; })) {
      out.push("<b>오피스텔 월세</b>는 달마다 " + MIN_N + "건이 안 돼 구조 변화를 말씀드리기 어렵습니다.");
    }

    // 거래량 — 신고가 마감된 달끼리만 비교해야 "급감"으로 잘못 읽지 않는다
    var solid = shop.map(function (x, i) {
      return { ym: x.ym, n: x.r[0] + office[i].r[0] + sale[i].r[0] + jeonse[i].r[0] + wolse[i].r[0] };
    }).filter(function (x) { return !isPending(x.ym); });
    if (solid.length >= 2) {
      var va = solid[0], vb = solid[solid.length - 1];
      out.push("<b>전체 거래량</b>은 " + moLabel(va.ym) + " " + va.n.toLocaleString() + "건에서 " +
        moLabel(vb.ym) + " " + vb.n.toLocaleString() + "건입니다. " +
        "(신고가 마감된 달끼리만 비교했습니다.)");
    }

    var pend = shop.filter(function (x) { return isPending(x.ym); });
    if (pend.length) {
      out.push("<b>" + pend.map(function (x) { return moLabel(x.ym); }).join("·") +
        " 숫자는 아직 확정이 아닙니다.</b> 신고 기한이 계약일로부터 30일이라 앞으로 건수가 더 늘어납니다. " +
        "<b>지금 수치만 보고 거래가 끊겼다고 보시면 안 됩니다.</b>");
    }

    out.push("상가·업무용 평당가는 <b>연면적 기준</b>이라 아파트 전용면적 평당가와 그대로 비교하시면 안 됩니다. " +
      "표의 <b>*</b>는 표본이 " + MIN_N + "건이 안 돼 시세 변동으로 보기 어려운 등락률입니다.");

    document.getElementById("briefScript").innerHTML =
      out.map(function (t) { return "<li>" + t + "</li>"; }).join("");
  }

  function renderAll() {
    renderTitles();
    var has = toggleSections();
    renderKpi();
    renderBrief();
    if (has.nrgTotal) renderNrg();
    if (has.offiTotal) renderOffi();
    renderVolume();
    renderLocation();
    if (has.offiTotal) renderMap();
  }

  fillDong();
  initMap();
  renderAll();
})();
