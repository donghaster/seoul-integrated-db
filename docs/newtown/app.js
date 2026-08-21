/* ════════════════════════════════════════════════════════════════════
   뉴타운 대시보드 — 서울시 재정비촉진지구 전역
   데이터: window.NEWTOWN_DATA (../data/newtown.js) + window.APT_DATA (실거래)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var N = window.NEWTOWN_DATA;
  var A = window.APT_DATA;
  if (!N) return;
  window.DASH_DATA = A || {};

  var STAGES = N.stages;
  var ALL = "all";

  // 진행 단계별 색 — 지도 원과 카드 배지에 함께 쓴다
  function stageColor(stage) {
    if (stage >= 6) return "#4fada8";   // 준공·입주
    if (stage >= 5) return "#4f7fe6";   // 착공
    if (stage >= 2) return "#cf9a45";   // 인가·이주·철거
    return "#bc3d3d";                    // 초기
  }

  var state = { gu: ALL, wave: ALL, status: ALL, zone: "noryangjin",
                group: "stage", view: "card", openKeys: null };

  /* ── 서울 5개 권역 ── */
  var AREA = {
    "도심권": ["종로구", "중구", "용산구"],
    "동북권": ["성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구", "노원구"],
    "서북권": ["은평구", "서대문구", "마포구"],
    "서남권": ["양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구"],
    "동남권": ["서초구", "강남구", "송파구", "강동구"],
  };
  var AREA_ORDER = Object.keys(AREA);

  function areaOf(gu) {
    for (var i = 0; i < AREA_ORDER.length; i++) {
      if (AREA[AREA_ORDER[i]].indexOf(gu) !== -1) return AREA_ORDER[i];
    }
    return "기타";
  }

  /* ── 진행단계 묶음 — 중개 상담에서 실제로 구분해서 쓰는 4단계 ── */
  var STAGE_BUCKETS = [
    { key: "build", name: "착공 — 곧 입주", color: "#4f7fe6",
      hint: "실물이 올라가는 중 · 분양권 상담 대상", test: function (s) { return s === 5; } },
    { key: "move",  name: "이주·철거 중", color: "#7a9fe0",
      hint: "이주비·철거 일정이 관건 · 입주권 매물", test: function (s) { return s === 4; } },
    { key: "auth",  name: "인가 단계 (사업시행·관리처분)", color: "#cf9a45",
      hint: "사업이 확정돼 가는 구간 · 조합원 지위 양도 제한 확인", test: function (s) { return s === 2 || s === 3; } },
    { key: "early", name: "초기 (구역지정·조합설립)", color: "#bc3d3d",
      hint: "변수가 가장 큰 구간 · 장기 투자 관점", test: function (s) { return s <= 1; } },
    { key: "done",  name: "준공·입주 완료", color: "#4fada8",
      hint: "이미 아파트가 된 곳 · 실거래 시세 비교용", test: function (s) { return s >= 6; } },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function eokman(man) {
    if (!man) return "-";
    var eok = Math.floor(man / 10000), rest = Math.round(man % 10000);
    if (eok && rest) return eok + "억 " + rest.toLocaleString() + "만원";
    if (eok) return eok + "억";
    return rest.toLocaleString() + "만원";
  }

  /* ── 아파트 실거래(apt.js)는 기간별로 나뉘어 있다. 뉴타운 화면은 기본 기간(12개월)을 쓴다 ── */
  function aptWin() {
    return (A && A.windows[A.defaultWindow]) || { label: "-" };
  }

  function aptRegion(key) {
    if (!A) return null;
    var reg = A.regions[key];
    return reg ? reg.w[A.defaultWindow] : null;
  }

  /* ── 뉴타운이 걸친 법정동들의 실거래를 합산 ── */
  function dealStat(d) {
    if (!A) return null;
    var acc = { sale: 0, jeonse: 0, wolse: 0, medSale: [], medPy: [] };
    d.dongs.forEach(function (dong) {
      var reg = aptRegion(d.gu + "|" + dong);
      if (!reg) return;
      acc.sale += reg.cnt.sale; acc.jeonse += reg.cnt.jeonse; acc.wolse += reg.cnt.wolse;
      if (reg.med.sale) acc.medSale.push({ v: reg.med.sale, w: reg.cnt.sale });
      if (reg.med.pyeong) acc.medPy.push({ v: reg.med.pyeong, w: reg.cnt.sale });
    });
    // 동이 여러 개면 매매 건수로 가중평균
    var wavg = function (arr) {
      var tw = arr.reduce(function (s, x) { return s + x.w; }, 0);
      if (!tw) return 0;
      return Math.round(arr.reduce(function (s, x) { return s + x.v * x.w; }, 0) / tw);
    };
    return { sale: acc.sale, jeonse: acc.jeonse, wolse: acc.wolse,
             medSale: wavg(acc.medSale), medPy: wavg(acc.medPy) };
  }

  /* ── 필터 ── */
  function filtered() {
    return N.districts.filter(function (d) {
      if (state.gu !== ALL && d.gu !== state.gu) return false;
      if (state.wave !== ALL && d.wave.indexOf(state.wave) === -1) return false;
      if (state.status === "ing" && d.stage >= 6) return false;
      if (state.status === "done" && d.stage < 6) return false;
      return true;
    });
  }

  var guSelect = document.getElementById("guSelect");
  guSelect.innerHTML = '<option value="all">서울시 전체</option>' +
    (A ? A.gus : []).filter(function (g) {
      return N.districts.some(function (d) { return d.gu === g; });
    }).map(function (g) {
      var n = N.districts.filter(function (d) { return d.gu === g; }).length;
      return '<option value="' + g + '">' + g + " (" + n + "개 지구)</option>";
    }).join("");

  ["guSelect", "waveSelect", "statusSelect"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      state.gu = guSelect.value;
      state.wave = document.getElementById("waveSelect").value;
      state.status = document.getElementById("statusSelect").value;
      renderAll();
    });
  });

  /* ════════════════ 핵심 요약 ════════════════ */

  function renderKpi() {
    var list = filtered();
    var ing = list.filter(function (d) { return d.stage < 6; }).length;
    var done = list.length - ing;
    var gus = {};
    list.forEach(function (d) { gus[d.gu] = 1; });

    var totalDeal = list.reduce(function (s, d) {
      var st = dealStat(d);
      return s + (st ? st.sale + st.jeonse + st.wolse : 0);
    }, 0);

    document.getElementById("kpiRow").innerHTML = [
      { label: "표시 중인 뉴타운", value: list.length + "개 지구", sub: "서울 전체 " + N.districts.length + "개 지구 중" },
      { label: "사업 진행 중", value: ing + "개 지구", sub: "구역지정~착공 단계" },
      { label: "대부분 완료", value: done + "개 지구", sub: "준공·입주 완료" },
      { label: "해당 자치구", value: Object.keys(gus).length + "개 구", sub: Object.keys(gus).slice(0, 6).join(" · ") },
      { label: "해당 법정동 실거래", value: totalDeal.toLocaleString() + "건", sub: A ? aptWin().label : "-" },
    ].map(function (b) {
      return '<div class="stat-box"><div class="label">' + b.label + '</div><div class="value">' +
        b.value + '</div><div class="sub">' + esc(b.sub) + "</div></div>";
    }).join("");

    document.getElementById("countNote").innerHTML =
      "표시 중 <b>" + list.length + "개 지구</b>" + (A ? " · 실거래 표본 " + aptWin().label : "");
    document.getElementById("printBanner").innerHTML =
      "<b>서울 뉴타운(재정비촉진지구) 리포트</b> · " +
      (state.gu === ALL ? "서울시 전체" : state.gu) + " · " + list.length + "개 지구" +
      (A ? " · 실거래 표본 " + aptWin().label : "") +
      " · 반포114공인중개사 010-9442-2027";
  }

  /* ════════════════ 지도 ════════════════ */

  var map = null, layer = null, ntMarkers = {};

  function initMap() {
    map = L.map("ntMap", { scrollWheelZoom: true }).setView([37.5535, 126.9905], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function renderMap() {
    layer.clearLayers();
    ntMarkers = {};
    var list = filtered(), pts = [];
    list.forEach(function (d) {
      var m = L.circleMarker(d.coord, {
        radius: 13, color: "#fff", weight: 2.5,
        fillColor: stageColor(d.stage), fillOpacity: 0.92,
      }).addTo(layer).bindTooltip(d.name, { direction: "top", className: "zone-tooltip" });
      m.on("click", function () { showDetail(d); });
      ntMarkers[d.id] = m;
      pts.push(d.coord);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 });
    document.getElementById("ntDetail").innerHTML =
      '<p class="placeholder">지도의 원 또는 아래 목록에서<br />뉴타운을 클릭하세요.</p>';
  }

  function showDetail(d) {
    var st = dealStat(d);
    document.getElementById("ntDetail").innerHTML =
      '<span class="zone-tag" style="background:' + stageColor(d.stage) + '">' + esc(d.status) + "</span>" +
      "<h3>" + esc(d.name) + "</h3>" +
      "<table>" +
      "<tr><td>자치구</td><td>" + esc(d.gu) + "</td></tr>" +
      "<tr><td>법정동</td><td>" + d.dongs.map(esc).join(" · ") + "</td></tr>" +
      "<tr><td>지정</td><td>" + esc(d.wave) + "</td></tr>" +
      "<tr><td>구역</td><td>" + esc(d.zones) + "</td></tr>" +
      "<tr><td>진행단계</td><td><b>" + STAGES[d.stage] + "</b></td></tr>" +
      "<tr><td>요약</td><td>" + esc(d.summary) + "</td></tr>" +
      "<tr><td>특징</td><td>" + esc(d.detail) + "</td></tr>" +
      (st && st.medSale ? "<tr><td>해당 동 중위 매매가</td><td><b>" + eokman(st.medSale) +
        "</b> (평당 " + st.medPy.toLocaleString() + "만원)</td></tr>" : "") +
      "</table>" +
      '<div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">' +
      d.highlight.map(function (h) {
        return '<span class="chip" style="font-size:11px;font-weight:700;color:var(--accent-2);background:var(--accent-light);padding:3px 10px;border-radius:999px;">' +
          esc(h) + "</span>";
      }).join("") + "</div>";
  }

  /* ════════════════ 지구 카드 ════════════════ */

  function cardHtml(d) {
    var pct = Math.round((d.stage / (STAGES.length - 1)) * 100);
    var st = dealStat(d);
    return '<div class="zone-mini-card" data-id="' + d.id + '" style="cursor:pointer">' +
      '<div class="zn-head"><b>' + esc(d.name) + "</b>" +
      '<span style="font-size:12px;color:' + stageColor(d.stage) + ';font-weight:800;">' + pct + "%</span></div>" +
      '<div class="zn-sub">' + esc(d.gu) + " · " + esc(d.wave) + " · " + esc(d.zones) + "</div>" +
      '<div class="milestone-bar">' + STAGES.slice(1).map(function (_, i) {
        return '<div class="seg ' + (i < d.stage ? "done" : (i === d.stage ? "current" : "")) + '"></div>';
      }).join("") + "</div>" +
      '<div class="milestone-label"><span>' + STAGES[1] + "</span><span>" + STAGES[STAGES.length - 1] + "</span></div>" +
      '<div style="margin-top:8px; font-size:12.5px; color:var(--txt-mute); line-height:1.6;">' + esc(d.summary) + "</div>" +
      (st && st.medSale
        ? '<div style="margin-top:8px; font-size:12px; color:var(--accent-2); font-weight:700;">' +
          esc(d.dongs[0]) + " 중위 매매 " + eokman(st.medSale) + " · 평당 " + st.medPy.toLocaleString() + "만원</div>"
        : "") +
      "</div>";
  }

  /* 목록(표) 보기 — 카드보다 훨씬 조밀해 한눈에 훑기 좋다 */
  function listHtml(list) {
    return '<div class="table-wrap"><table class="rank-table">' +
      "<thead><tr><th>뉴타운</th><th>자치구</th><th>지정</th><th>진행단계</th><th>구역</th><th>중위 매매가</th><th>평당가</th></tr></thead><tbody>" +
      list.map(function (d) {
        var st = dealStat(d);
        return '<tr class="nt-list-row" data-id="' + d.id + '">' +
          '<td><div class="rt-name">' + esc(d.name) + "</div></td>" +
          "<td>" + esc(d.gu) + "</td>" +
          '<td class="rt-sub">' + esc(d.wave) + "</td>" +
          '<td><span class="nt-bar">' + STAGES.slice(1).map(function (_, i) {
            return '<i style="background:' + (i <= d.stage - 1 ? stageColor(d.stage) : "") + '"></i>';
          }).join("") + "</span>" +
          '<div class="rt-sub">' + STAGES[d.stage] + "</div></td>" +
          '<td class="rt-sub">' + esc(d.zones) + "</td>" +
          '<td class="rt-price">' + (st && st.medSale ? eokman(st.medSale) : "-") + "</td>" +
          "<td>" + (st && st.medPy ? st.medPy.toLocaleString() + "만원" : "-") + "</td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* 선택한 기준으로 지구를 묶는다 → [{key, name, color, hint, open, items}] */
  function buildGroups(list) {
    if (state.group === "none") {
      return [{ key: "all", name: "전체", color: "#4670ca", hint: "", open: true, items: list }];
    }
    if (state.group === "stage") {
      // 기본은 맨 앞(가장 임박한) 묶음만 펼치고 나머지는 접어 둔다 — 27개가 한꺼번에 쏟아지지 않게
      return STAGE_BUCKETS.map(function (b) {
        return { key: b.key, name: b.name, color: b.color, hint: b.hint,
                 items: list.filter(function (d) { return b.test(d.stage); }) };
      }).filter(function (g) { return g.items.length; })
        .map(function (g, i) { g.open = i === 0; return g; });
    }
    var keyOf = state.group === "area" ? function (d) { return areaOf(d.gu); } : function (d) { return d.gu; };
    var order = state.group === "area" ? AREA_ORDER : (A ? A.gus : []);
    var bag = {};
    list.forEach(function (d) {
      var k = keyOf(d);
      (bag[k] = bag[k] || []).push(d);
    });
    var keys = Object.keys(bag).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return keys.map(function (k) {
      var items = bag[k];
      var ing = items.filter(function (d) { return d.stage < 6; }).length;
      // 권역·자치구별은 묶음 수가 많으므로 전부 접은 채로 시작한다(이름은 아래 칩으로 다 보인다)
      return {
        key: k, name: k, color: "#4670ca", open: false,
        hint: ing ? "진행 중 " + ing + "개" : "모두 완료",
        items: items,
      };
    });
  }

  function renderGrid() {
    var list = filtered();
    var box = document.getElementById("ntGroups");

    if (!list.length) {
      box.innerHTML = '<p class="sec-desc">조건에 맞는 뉴타운이 없습니다. 필터를 바꿔보세요.</p>';
      return;
    }

    var groups = buildGroups(list);
    // 사용자가 직접 접었다 편 상태는 묶음 기준이 바뀔 때까지 유지한다
    if (!state.openKeys) {
      state.openKeys = {};
      groups.forEach(function (g) { state.openKeys[g.key] = g.open; });
    }

    box.innerHTML = groups.map(function (g) {
      var open = state.openKeys[g.key];
      return '<details class="nt-group" data-key="' + esc(g.key) + '"' + (open ? " open" : "") + ">" +
        "<summary>" +
        '<span class="g-caret">▶</span>' +
        '<span class="g-dot" style="background:' + g.color + '"></span>' +
        '<span class="g-name">' + esc(g.name) + "</span>" +
        '<span class="g-count">' + g.items.length + "개 지구</span>" +
        (g.hint ? '<span class="g-hint">' + esc(g.hint) + "</span>" : "") +
        "</summary>" +
        '<div class="g-peek">' + g.items.map(function (d) {
          return "<span>" + esc(d.name) + "</span>";
        }).join("") + "</div>" +
        '<div class="g-body">' +
        (state.view === "list" ? listHtml(g.items)
          : '<div class="zone-grid">' + g.items.map(cardHtml).join("") + "</div>") +
        "</div></details>";
    }).join("");

    // 접기/펴기 상태 기억
    box.querySelectorAll("details.nt-group").forEach(function (el) {
      el.addEventListener("toggle", function () { state.openKeys[el.dataset.key] = el.open; });
    });

    // 카드·표 어느 쪽이든 클릭하면 지도로 이동
    box.querySelectorAll("[data-id]").forEach(function (el) {
      el.addEventListener("click", function () {
        var d = N.districts.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!d) return;
        map.flyTo(d.coord, 14, { duration: 0.6 });
        if (ntMarkers[d.id]) ntMarkers[d.id].openTooltip();
        showDetail(d);
        document.getElementById("sec-map").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  /* ── 묶어보기 / 보기 전환 ── */
  document.querySelectorAll("#ntGroupTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#ntGroupTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.group = b.dataset.g;
      state.openKeys = null;      // 기준이 바뀌면 기본 펼침 상태로 리셋
      renderGrid();
    });
  });

  document.querySelectorAll("#ntViewTabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#ntViewTabs button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state.view = b.dataset.v;
      renderGrid();
    });
  });

  function setAllGroups(open) {
    Object.keys(state.openKeys || {}).forEach(function (k) { state.openKeys[k] = open; });
    document.querySelectorAll("#ntGroups details.nt-group").forEach(function (el) {
      el.open = open;
      state.openKeys[el.dataset.key] = open;
    });
  }
  document.getElementById("ntExpandAll").addEventListener("click", function () { setAllGroups(true); });
  document.getElementById("ntCollapseAll").addEventListener("click", function () { setAllGroups(false); });

  // 인쇄할 때는 접힌 그룹도 모두 펴서 빠짐없이 출력한다
  window.addEventListener("beforeprint", function () {
    document.querySelectorAll("#ntGroups details.nt-group").forEach(function (el) {
      if (!el.open) { el.dataset.wasClosed = "1"; el.open = true; }
    });
  });
  window.addEventListener("afterprint", function () {
    document.querySelectorAll("#ntGroups details.nt-group").forEach(function (el) {
      if (el.dataset.wasClosed === "1") { el.open = false; el.dataset.wasClosed = ""; }
    });
  });

  /* ════════════════ 구역별 상세 ════════════════ */

  var zoneMap = null, zoneLayer = null, zoneMarkers = {};

  function initZoneMap() {
    zoneMap = L.map("zoneMap", { scrollWheelZoom: true }).setView(N.zoneDetail.noryangjin.center, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    }).addTo(zoneMap);
    zoneLayer = L.layerGroup().addTo(zoneMap);
  }

  /* 구역 단위 상세가 있는 뉴타운만 추려 온다. 위 필터(자치구·차수·상태)에 걸리는 것만 남긴다. */
  function zonePacks() {
    var shown = filtered();
    return Object.keys(N.zoneDetail).map(function (id) {
      var d = N.districts.filter(function (x) { return x.id === id; })[0];
      return d ? { id: id, name: d.name, gu: d.gu, pack: N.zoneDetail[id] } : null;
    }).filter(function (x) {
      return x && shown.some(function (d) { return d.id === x.id; });
    });
  }

  /* 상세가 있는 뉴타운 전체 목록 — 안내 문구에 쓴다 */
  function zonePackLabels() {
    return Object.keys(N.zoneDetail).map(function (id) {
      var d = N.districts.filter(function (x) { return x.id === id; })[0];
      return d ? d.name + "(" + d.gu + ")" : id;
    }).join(" · ");
  }

  function renderZones() {
    var avail = zonePacks();
    var sec = document.getElementById("sec-zones");
    var title = document.getElementById("zoneSecTitle");
    var tabs = document.getElementById("zoneTabs");
    var body = document.getElementById("zoneBody");
    var empty = document.getElementById("zoneEmpty");

    // 지금 필터에 맞는 상세가 하나도 없으면, 엉뚱한 구의 구역을 보여주지 않고 이유를 알린다
    if (!avail.length) {
      title.textContent = "구역별 상세";
      tabs.innerHTML = "";
      tabs.hidden = true;
      body.hidden = true;
      empty.hidden = false;
      empty.innerHTML =
        "<b>" + esc(state.gu === ALL ? "선택한 조건" : state.gu) + "</b>에는 구역 단위까지 확인된 뉴타운이 없습니다.<br />" +
        "구역별 시공사·세대수까지 제공하는 곳은 <b>" + esc(zonePackLabels()) + "</b> 입니다. " +
        "위 <b>지구별 진행상황</b>에서는 선택하신 지역의 지구 단위 요약을 보실 수 있습니다.";
      return;
    }

    // 현재 선택이 목록에 없으면 첫 번째로 옮긴다
    if (!avail.some(function (x) { return x.id === state.zone; })) state.zone = avail[0].id;

    title.textContent = "구역별 상세 (" + avail.map(function (x) { return x.name.replace("뉴타운", ""); }).join(" · ") + ")";
    tabs.hidden = false;
    body.hidden = false;
    empty.hidden = true;
    tabs.innerHTML = avail.map(function (x) {
      return '<button class="' + (x.id === state.zone ? "active" : "") + '" data-z="' + x.id + '">' +
        esc(x.name) + ' <span style="opacity:.7;font-weight:600">' + esc(x.gu) + "</span></button>";
    }).join("");
    tabs.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.zone = b.dataset.z;
        renderZones();
      });
    });

    var pack = N.zoneDetail[state.zone];
    if (!pack) return;
    zoneMap.invalidateSize();
    zoneLayer.clearLayers();
    zoneMarkers = {};
    var pts = [];

    pack.zones.forEach(function (z, i) {
      var m = L.circleMarker(z.coord, {
        radius: 15, color: "#fff", weight: 3,
        fillColor: stageColor(z.stage), fillOpacity: 0.95,
      }).addTo(zoneLayer).bindTooltip(z.name, { permanent: true, direction: "top", className: "zone-tooltip", interactive: true });
      var onClick = function () { showZone(z); };
      m.on("click", onClick);
      m.on("tooltipopen", function () {
        var el = m.getTooltip().getElement();
        if (el) el.addEventListener("click", onClick);
      });
      zoneMarkers[i] = m;
      pts.push(z.coord);
    });
    if (pts.length) zoneMap.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 16 });

    document.getElementById("zoneGrid").innerHTML = pack.zones.map(function (z, i) {
      var pct = Math.round((z.stage / (STAGES.length - 1)) * 100);
      return '<div class="zone-mini-card" data-i="' + i + '" style="cursor:pointer">' +
        '<div class="zn-head"><b>' + esc(z.name) + " · " + esc(z.brand) + "</b>" +
        '<span style="font-size:12px;color:' + stageColor(z.stage) + ';font-weight:800;">' + pct + "%</span></div>" +
        '<div class="zn-sub">' + esc(z.builder) + " · " + esc(z.units) + "</div>" +
        '<div class="milestone-bar">' + STAGES.slice(1).map(function (_, k) {
          return '<div class="seg ' + (k < z.stage ? "done" : (k === z.stage ? "current" : "")) + '"></div>';
        }).join("") + "</div>" +
        '<div style="margin-top:8px; font-size:12.5px; color:var(--txt-mute);">' + esc(z.status) + "</div></div>";
    }).join("");

    document.querySelectorAll("#zoneGrid .zone-mini-card").forEach(function (el) {
      el.addEventListener("click", function () {
        var z = pack.zones[+el.dataset.i];
        zoneMap.flyTo(z.coord, 16, { duration: 0.5 });
        showZone(z);
      });
    });

    document.getElementById("zoneDetail").innerHTML =
      '<p class="placeholder">지도의 구역 또는 아래 카드를 클릭하세요.</p>';
  }

  function showZone(z) {
    document.getElementById("zoneDetail").innerHTML =
      '<span class="zone-tag" style="background:' + stageColor(z.stage) + '">' + STAGES[z.stage] + "</span>" +
      "<h3>" + esc(z.name) + " · " + esc(z.brand) + "</h3>" +
      "<table>" +
      "<tr><td>시공사</td><td>" + esc(z.builder) + "</td></tr>" +
      "<tr><td>세대수</td><td>" + esc(z.units) + "</td></tr>" +
      "<tr><td>진행상황</td><td><b>" + esc(z.status) + "</b></td></tr>" +
      "</table>" +
      '<p style="margin-top:10px;font-size:12px;color:var(--txt-mute);line-height:1.6">' +
      "※ 인가일·세대수·시공사는 변경될 수 있습니다. 계약 전 조합·구청 고시 원문을 확인하세요.</p>";
  }

  /* ════════════════ 뉴타운 실거래 ════════════════ */

  var pyChart = null;

  function renderDeal() {
    if (!A) {
      document.getElementById("dealBody").innerHTML =
        '<tr class="empty-row"><td colspan="8">실거래 데이터(apt.js)를 불러오지 못했습니다.</td></tr>';
      return;
    }
    var rows = filtered().map(function (d) {
      return { d: d, st: dealStat(d) };
    }).filter(function (x) { return x.st && x.st.medPy; })
      .sort(function (a, b) { return b.st.medPy - a.st.medPy; });

    document.getElementById("dealBody").innerHTML = rows.length ? rows.map(function (x, i) {
      var rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "";
      return "<tr>" +
        '<td><span class="rank-chip ' + rc + '">' + (i + 1) + "</span></td>" +
        '<td class="rt-name">' + esc(x.d.name) + '<div class="rt-sub">' + x.d.dongs.map(esc).join(" · ") + "</div></td>" +
        "<td>" + esc(x.d.gu) + "</td>" +
        '<td class="rt-price">' + eokman(x.st.medSale) + "</td>" +
        '<td class="rt-price">' + x.st.medPy.toLocaleString() + "만원</td>" +
        "<td>" + x.st.sale.toLocaleString() + "</td>" +
        "<td>" + x.st.jeonse.toLocaleString() + "</td>" +
        "<td>" + x.st.wolse.toLocaleString() + "</td>" +
        "</tr>";
    }).join("") : '<tr class="empty-row"><td colspan="8">조건에 맞는 뉴타운이 없습니다.</td></tr>';

    document.getElementById("dealDesc").innerHTML =
      "각 뉴타운이 속한 <b>법정동</b>의 국토교통부 아파트 실거래를 붙였습니다(표본 " + aptWin().label +
      "). 뉴타운 구역 내 거래만 골라낸 것이 아니라 <b>해당 동 전체</b> 기준입니다.";

    var top = rows.slice(0, 20);
    var canvas = document.getElementById("ntPyeongChart");

    if (!top.length) {
      canvas.parentElement.hidden = true;
      if (pyChart) { pyChart.destroy(); pyChart = null; }
      return;
    }
    canvas.parentElement.hidden = false;

    // 막대 개수에 맞춰 높이를 늘린다. 340px에 27개를 밀어 넣으면 이름이 겹쳐 읽을 수 없다.
    canvas.parentElement.style.height = Math.max(220, top.length * 30 + 96) + "px";

    if (pyChart) pyChart.destroy();
    pyChart = new Chart(canvas, {
      type: "bar",
      data: {
        // 이름이 길어 두 줄로 접히지 않게 "뉴타운"은 떼고 자치구를 붙여 어디인지 알 수 있게 한다
        labels: top.map(function (x) { return [x.d.name.replace("뉴타운", ""), x.d.gu]; }),
        datasets: [{
          label: "중위 매매 평당가 (만원)",
          data: top.map(function (x) { return x.st.medPy; }),
          backgroundColor: top.map(function (x) { return stageColor(x.d.stage); }),
          borderRadius: 5,
          barThickness: 18,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 16 } },
        plugins: {
          legend: { display: false },
          title: { display: true, text: "뉴타운 소재 법정동 중위 매매 평당가 (만원)", font: { size: 13, weight: "bold" } },
          tooltip: {
            callbacks: {
              title: function (c) { return top[c[0].dataIndex].d.name; },
              label: function (c) {
                var x = top[c.dataIndex];
                return [x.d.gu + " " + x.d.dongs[0],
                        "평당 " + x.st.medPy.toLocaleString() + "만원",
                        "중위 매매 " + eokman(x.st.medSale)];
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: "만원/평" },
               ticks: { callback: function (v) { return v.toLocaleString(); } } },
          y: { ticks: { font: { size: 11 }, autoSkip: false } },
        },
      },
    });
  }

  /* ════════════════ 체크포인트 ════════════════ */

  var POLICY = [
    { date: "지위양도", title: "조합원 지위 양도 제한", body: "투기과열지구에서 <b>재개발은 관리처분인가 후</b>, 재건축은 조합설립인가 후 조합원 지위 양도가 제한됩니다. 10년 보유·5년 거주 등 예외 요건이 있으니 물건별로 반드시 확인하세요.", tag: "필수 확인" },
    { date: "분양자격", title: "입주권 자격 · 현금청산", body: "권리산정기준일 이후 <b>지분 쪼개기</b>나 무허가건축물 등은 입주권이 나오지 않고 <b>현금청산</b> 대상이 될 수 있습니다. 구청 고시의 권리산정기준일을 먼저 확인해야 합니다.", tag: "필수 확인" },
    { date: "추가분담금", title: "감정평가액과 추가분담금", body: "매입가가 아니라 <b>감정평가액(권리가액)</b>이 기준입니다. 조합원분양가와의 차액이 추가분담금이며, 공사비 상승으로 <b>관리처분 이후에도 늘어날 수 있습니다</b>.", tag: "자금계획" },
    { date: "이주비", title: "이주비 대출과 이자", body: "이주 단계에서 <b>이주비 대출</b>이 나오지만 한도·이자 부담 주체가 사업장마다 다릅니다. 규제지역 여부에 따라 LTV가 달라지는 점도 확인하세요.", tag: "자금계획" },
    { date: "기간", title: "사업 지연 리스크", body: "관리처분인가 이후에도 <b>이주 지연·공사비 갈등·시공사 교체</b>로 수년이 늦어지는 사례가 많습니다. 단계별 소요기간을 보수적으로 잡아야 합니다.", tag: "리스크" },
    { date: "세금", title: "취득세·양도세", body: "입주권·분양권은 주택 수 산정과 <b>취득세율</b>이 일반 주택과 다릅니다. 멸실 전후 취득 시점에 따라 세율이 크게 달라지므로 세무 상담을 권합니다.", tag: "세제" },
  ];

  document.getElementById("policyGrid").innerHTML = POLICY.map(function (p) {
    return '<div class="policy-card"><span class="date-chip">' + p.date + "</span>" +
      "<h4>" + p.title + "</h4><p>" + p.body + "</p>" +
      '<span class="tag">' + p.tag + "</span></div>";
  }).join("");

  /* ════════════════ 렌더 ════════════════ */

  function renderAll() {
    renderKpi();
    renderMap();
    renderGrid();
    renderZones();   // 자치구를 바꾸면 구역별 상세도 그 구의 것만 남아야 한다
    renderDeal();
  }

  initMap();
  initZoneMap();
  renderAll();
})();
