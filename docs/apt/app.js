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
    gu: ALL,
    dong: ALL,
    win: D.defaultWindow,          // "3" | "6" | "12" — 조회 기간(개월)
    dealType: "sale",
    cmpOn: { sale: true, jeonse: true, wolse: true },
    volRank: "gu",
  };

  /* 선택한 기간의 메타(시작·종료월, 이름) */
  function win() { return D.windows[state.win]; }

  /* 전체 12개월 월별 배열에서 선택 기간만큼 잘라낸다 */
  function sliceMonths(arr) {
    var w = parseInt(state.win, 10);
    return (arr || []).slice(-w);
  }

  /* ════════════════ 포맷 유틸 ════════════════ */

  function eokman(man) {
    // 32000(만원) -> "3억 2,000"
    if (!man && man !== 0) return "-";
    var eok = Math.floor(man / 10000);
    var rest = Math.round(man % 10000);
    if (eok && rest) return eok + "억 " + rest.toLocaleString() + "만원";
    if (eok) return eok + "억";
    return rest.toLocaleString() + "만원";
  }

  function eokShort(man) {
    return (man / 10000).toFixed(1) + "억";
  }

  function priceText(row, type) {
    if (type === "wolse") return "보 " + eokman(row.v) + " / 월 " + (row.r || 0).toLocaleString() + "만원";
    return eokman(row.v);
  }

  function convValue(row, type) {
    // 비교·평당가 계산용 대표 금액(만원)
    return type === "wolse" ? row.v + (row.r || 0) * 100 : row.v;
  }

  function areaText(a) {
    return a.toFixed(2) + "㎡ (" + (a / PYEONG).toFixed(1) + "평)";
  }

  function pyText(row, type) {
    if (!row.a) return "-";
    var p = convValue(row, type) / (row.a / PYEONG);
    return Math.round(p).toLocaleString() + "만원";
  }

  function dateText(d) { return d.replace(/-/g, "."); }

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

  var EMPTY_REGION = {
    top: { sale: [], jeonse: [], wolse: [] },
    cnt: { sale: 0, jeonse: 0, wolse: 0 },
    med: { sale: 0, jeonse: 0, wolse: 0, pyeong: 0 },
    vol: { sale: [], jeonse: [], wolse: [] },
  };

  /* 선택한 지역 + 선택한 기간의 집계 */
  function region() {
    var reg = D.regions[regionKey()];
    if (!reg) return EMPTY_REGION;
    var w = reg.w[state.win] || EMPTY_REGION;
    return {
      top: w.top, cnt: w.cnt, med: w.med,
      vol: {
        sale: sliceMonths(reg.vol.sale),
        jeonse: sliceMonths(reg.vol.jeonse),
        wolse: sliceMonths(reg.vol.wolse),
      },
    };
  }

  /* 순위표에서 다른 지역의 건수를 꺼낼 때 쓴다 */
  function regionOf(key) {
    var reg = D.regions[key];
    return (reg && reg.w[state.win]) || EMPTY_REGION;
  }

  /* ════════════════ 조회 조건 ════════════════ */

  var guSelect = document.getElementById("guSelect");
  var dongSelect = document.getElementById("dongSelect");

  function fillGu() {
    guSelect.innerHTML = '<option value="all">서울시 전체</option>' +
      D.gus.map(function (g) { return '<option value="' + g + '">' + g + "</option>"; }).join("");
    guSelect.value = state.gu;
  }

  function fillDong() {
    if (state.gu === ALL) {
      dongSelect.innerHTML = '<option value="all">전체</option>';
      dongSelect.disabled = true;
      state.dong = ALL;
      return;
    }
    dongSelect.disabled = false;
    var list = D.dongs[state.gu] || [];
    dongSelect.innerHTML = '<option value="all">' + state.gu + " 전체</option>" +
      list.map(function (d) {
        var c = regionOf(state.gu + "|" + d).cnt;
        var total = (c.sale || 0) + (c.jeonse || 0) + (c.wolse || 0);
        return '<option value="' + d + '">' + d + " (" + total.toLocaleString() + "건)</option>";
      }).join("");
    if (list.indexOf(state.dong) === -1) state.dong = ALL;
    dongSelect.value = state.dong;
  }

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
    fillDong();               // 동 목록의 건수 표기도 기간에 맞춰 갱신
    renderAll();
  });

  guSelect.addEventListener("change", function () {
    state.gu = guSelect.value;
    state.dong = ALL;
    fillDong();
    renderAll();
  });
  dongSelect.addEventListener("change", function () {
    state.dong = dongSelect.value;
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

    // 거래월 재배치 — TOP10 거래가 실제로 어느 달에 있었는지
    var months = sliceMonths(D.months);
    var monthLabels = win().labels;
    var monthSets = TYPES.map(function (t) {
      var rows = r.top[t] || [];
      var bucket = {};
      rows.forEach(function (row) {
        var ym = row.d.slice(0, 4) + row.d.slice(5, 7);
        var v = convValue(row, t) / 10000;
        if (!bucket[ym] || v > bucket[ym]) bucket[ym] = v;   // 같은 달이면 최고가
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
    var labels = win().labels;

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
    if (state.volRank === "gu") return D.rankGu[state.win].slice(0, 10);
    if (state.gu === ALL) return D.rankDong[state.win].slice(0, 10);
    return ((D.rankDongByGu[state.win] || {})[state.gu] || []).slice(0, 10);
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
      "<p style='margin-top:10px;color:var(--txt-mute);font-size:12.5px'>" +
      "※ 평당가 = 거래금액 ÷ (전용면적 ÷ 3.3058). 매매 신고 3건 이상인 지역만 순위에 넣습니다.</p>";
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

  /* ════════════════ 렌더 ════════════════ */

  function renderAll() {
    renderKpi();
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
  });

  fillGu();
  fillDong();
  initMap();
  renderAll();
})();
