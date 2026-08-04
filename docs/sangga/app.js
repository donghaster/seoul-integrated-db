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

  var state = { gu: ALL, dong: ALL, nrgGroup: "shop", offiType: "sale" };

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

  function region() { return D.regions[regionKey()] || EMPTY; }

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
        var ca = D.regions[gu + "|" + a], cb = D.regions[gu + "|" + b];
        var sum = function (r) {
          return Object.values(r.nrgCnt).reduce(function (s, x) { return s + x; }, 0) +
                 Object.values(r.offiCnt).reduce(function (s, x) { return s + x; }, 0);
        };
        return sum(cb) - sum(ca);
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

  /* ════════════════ 핵심 요약 ════════════════ */

  function renderKpi() {
    var r = region();
    var nrgTotal = NRG_GROUPS.reduce(function (s, g) { return s + (r.nrgCnt[g] || 0); }, 0);
    var offiRent = (r.offiCnt.jeonse || 0) + (r.offiCnt.wolse || 0);

    document.getElementById("kpiTitle").textContent = regionLabel() + " 핵심 요약";
    document.getElementById("kpiDesc").innerHTML =
      "표본 기간 <b>" + D.period.label + "</b> · 상업·업무용 매매 + 오피스텔 매매·전월세 총 <b>" +
      (nrgTotal + (r.offiCnt.sale || 0) + offiRent).toLocaleString() + "건</b>";

    document.getElementById("kpiRow").innerHTML = [
      { label: "일반상가 매매", value: (r.nrgCnt.shop || 0).toLocaleString() + "건", sub: "근린생활·판매 등" },
      { label: "업무용 매매", value: (r.nrgCnt.office || 0).toLocaleString() + "건", sub: "사무실·오피스" },
      { label: "상가·업무용 중위가", value: eokman(r.med.nrg), sub: "평당 " + (r.med.nrgPy || 0).toLocaleString() + "만원(연면적 기준)" },
      { label: "오피스텔 매매", value: (r.offiCnt.sale || 0).toLocaleString() + "건", sub: "중위 " + eokman(r.med.offiSale) },
      { label: "오피스텔 전월세", value: offiRent.toLocaleString() + "건", sub: "월세 비중 " + pct(r.offiCnt.wolse, offiRent) },
    ].map(function (b) {
      return '<div class="stat-box"><div class="label">' + b.label + '</div><div class="value">' +
        b.value + '</div><div class="sub">' + b.sub + "</div></div>";
    }).join("");

    document.getElementById("periodNote").innerHTML = "표본 기간 <b>" + D.period.label + "</b>";
    document.getElementById("printBanner").innerHTML =
      "<b>" + regionLabel() + "</b> 상가·오피스텔 실거래 리포트 · 표본 기간 " + D.period.label +
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

  /* ════════════════ 오피스텔 TOP10 ════════════════ */

  function offiRowsHtml(rows, type, clickable) {
    if (!rows.length) {
      return '<tr class="empty-row"><td colspan="7">해당 기간 · 지역에 오피스텔 ' + OFFI_LABEL[type] + " 신고가 없습니다.</td></tr>";
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
        "<td>" + areaText(r.a) + "</td>" +
        "<td>" + (r.f ? r.f + "층" : "-") + "</td>" +
        '<td class="rt-price">' + offiPriceText(r, type) + "</td>" +
        "<td>" + pyText(convValue(r, type), r.a) + "</td>" +
        '<td class="rt-sub">' + dateText(r.d) + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderOffi() {
    var r = region();
    var type = state.offiType;
    document.getElementById("offiPriceHead").textContent = type === "wolse" ? "보증금 / 월세" : "거래가";
    document.getElementById("offiBody").innerHTML = offiRowsHtml(r.offiTop[type] || [], type, true);

    document.getElementById("offiPrintAll").innerHTML = OFFI_TYPES
      .filter(function (t) { return t !== type; })
      .map(function (t) {
        return '<h3 style="margin:18px 0 8px; font-size:15px;">' + regionLabel() + " · 오피스텔 " + OFFI_LABEL[t] + " TOP 10</h3>" +
          '<table class="rank-table"><thead><tr><th>순위</th><th>건물명</th><th>전용면적</th><th>층</th><th>' +
          (t === "wolse" ? "보증금 / 월세" : "거래가") + "</th><th>평당가</th><th>거래일</th></tr></thead><tbody>" +
          offiRowsHtml(r.offiTop[t] || [], t, false) + "</tbody></table>";
      }).join("");

    document.querySelectorAll("#offiBody .rt-name-clickable").forEach(function (el) {
      el.addEventListener("click", function () {
        focusBuilding(el.dataset.gu, el.dataset.dong, el.dataset.b);
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
          var rows = r.offiTop[t] || [];
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
    var labels = D.period.labels;

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

    var top = D.rankGu.slice(0, 12);
    if (volGuChart) volGuChart.destroy();
    volGuChart = new Chart(document.getElementById("volGuChart"), {
      type: "bar",
      data: {
        labels: top.map(function (x) { return x.label; }),
        datasets: [
          { label: "상가·업무용 매매", data: top.map(function (x) { return x.nrg; }), backgroundColor: "#4f7fe6" },
          { label: "오피스텔 (매매+전월세)", data: top.map(function (x) { return x.offi; }), backgroundColor: "#4fada8" },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          title: { display: true, text: "서울 자치구별 수익형 부동산 실거래량 TOP 12 (" + D.period.label + ")", font: { size: 13, weight: "bold" } },
        },
        scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: "건" } }, y: { stacked: true } },
      },
    });

    document.getElementById("volGuBody").innerHTML = D.rankGu.slice(0, 10).map(function (x, i) {
      var reg = D.regions[x.k] || EMPTY;
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
    var rows = region().offiTop[state.offiType] || [];
    var pts = [], miss = 0;

    rows.forEach(function (row, i) {
      var c = GEO[row.gu + "|" + row.dg + "|" + row.n];
      if (!c) { miss++; return; }
      var m = L.circleMarker([c.lat, c.lng], {
        radius: 16 - i, color: "#fff", weight: 2.5,
        fillColor: OFFI_COLOR[state.offiType], fillOpacity: 0.92,
      }).addTo(markerLayer).bindTooltip((i + 1) + "위 " + row.n, { direction: "top", className: "zone-tooltip" });
      m.on("click", function () { showDetail(row, i); });
      markers[row.gu + "|" + row.dg + "|" + row.n] = { marker: m, coord: c, row: row, rank: i };
      pts.push([c.lat, c.lng]);
    });

    document.getElementById("mapMissNote").textContent =
      miss ? "좌표 미확인 " + miss + "곳은 표시되지 않습니다" : "";

    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    else map.setView([37.5535, 126.9905], 11);

    document.getElementById("sgDetail").innerHTML =
      '<p class="placeholder">지도의 원 또는 아래 오피스텔 TOP10 표의<br />건물명을 클릭하세요.</p>';
  }

  function showDetail(row, rank) {
    var t = state.offiType;
    document.getElementById("sgDetail").innerHTML =
      '<span class="zone-tag" style="background:' + OFFI_COLOR[t] + '">오피스텔 ' + OFFI_LABEL[t] + " " + (rank + 1) + "위</span>" +
      "<h3>" + esc(row.n) + "</h3>" +
      "<table>" +
      "<tr><td>소재지</td><td>" + esc(row.gu) + " " + esc(row.dg) + "</td></tr>" +
      "<tr><td>전용면적</td><td>" + areaText(row.a) + "</td></tr>" +
      "<tr><td>층</td><td>" + (row.f ? row.f + "층" : "-") + "</td></tr>" +
      "<tr><td>" + (t === "wolse" ? "보증금/월세" : "거래금액") + "</td><td><b>" + offiPriceText(row, t) + "</b></td></tr>" +
      "<tr><td>평당가</td><td>" + pyText(convValue(row, t), row.a) + "</td></tr>" +
      "<tr><td>거래일</td><td>" + dateText(row.d) + "</td></tr>" +
      (row.y ? "<tr><td>준공</td><td>" + row.y + "년</td></tr>" : "") +
      "</table>";
  }

  function focusBuilding(gu, dong, name) {
    var hit = markers[gu + "|" + dong + "|" + name];
    if (!hit) {
      document.getElementById("sgDetail").innerHTML =
        '<p class="placeholder">「' + esc(name) + "」의 좌표를 찾지 못해<br />지도에 표시할 수 없습니다.</p>";
      return;
    }
    map.flyTo([hit.coord.lat, hit.coord.lng], 16, { duration: 0.6 });
    hit.marker.openTooltip();
    showDetail(hit.row, hit.rank);
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
    var seoul = D.regions[ALL] || EMPTY;

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
      var list = (state.gu === ALL ? seoul : (D.regions[state.gu] || EMPTY)).dongCnt || [];
      if (state.gu !== ALL && state.dong !== ALL) list = (D.regions[state.gu] || EMPTY).dongCnt || [];
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

  function renderAll() {
    renderKpi();
    renderNrg();
    renderOffi();
    renderVolume();
    renderLocation();
    renderMap();
  }

  fillDong();
  initMap();
  renderAll();
})();
