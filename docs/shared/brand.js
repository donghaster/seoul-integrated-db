/* 공통 소소한 동작 — 조회시각 표시, 섹션 내비게이션, 섹션별 인쇄, TOP10 탭 전환 */
(function () {
  "use strict";

  /* ── 라이트·다크 ──
     고른 값은 이 기기에 남는다. 안 골랐으면 기기 설정을 따라가고,
     설정이 바뀌면 같이 따라간다. 인쇄는 CSS에서 늘 밝은 색으로 돌린다. */
  var THEME_KEY = "geumjib-theme";

  function applyTheme(mode) {
    var root = document.documentElement;
    if (mode === "dark" || mode === "light") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");           // auto — 기기 설정을 따른다
    document.querySelectorAll(".theme-toggle button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.theme === (mode || "auto"));
    });
  }

  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  }

  (function initTheme() {
    var host = document.getElementById("themeToggle");
    if (host) {
      host.className = "theme-toggle";
      host.innerHTML =
        '<button type="button" data-theme="light" title="밝게">☀️ 라이트</button>' +
        '<button type="button" data-theme="dark" title="어둡게">🌙 다크</button>' +
        '<button type="button" data-theme="auto" title="기기 설정 따라가기">자동</button>';
      host.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-theme]");
        if (!b) return;
        var m = b.dataset.theme;
        try { localStorage.setItem(THEME_KEY, m); } catch (err) { /* 저장 못 해도 화면은 바뀐다 */ }
        applyTheme(m === "auto" ? "" : m);
        document.querySelectorAll(".theme-toggle button").forEach(function (x) {
          x.classList.toggle("is-on", x.dataset.theme === m);
        });
        window.dispatchEvent(new Event("themechange"));
      });
    }
    var mode = savedTheme();
    applyTheme(mode === "auto" ? "" : mode);
    // 자동일 때만 기기 설정 변화를 따라간다
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (savedTheme() === "auto") { applyTheme(""); window.dispatchEvent(new Event("themechange")); }
      });
    }
  })();

  /* Chart.js 기본 눈금색은 회색 고정이라 다크에서 흐릿해진다.
     테마 변수에서 색을 읽어 기본값으로 깔고, 테마가 바뀌면 살아 있는
     차트를 전부 다시 그린다. 차트를 만들 때 색을 직접 준 대시보드는
     그쪽 값이 이긴다 — 여기서는 기본값만 손댄다. */
  function syncChartTheme() {
    if (typeof Chart === "undefined") return;
    var cs = getComputedStyle(document.documentElement);
    Chart.defaults.color = cs.getPropertyValue("--txt-dim").trim() || "#667085";
    Chart.defaults.borderColor = cs.getPropertyValue("--line-soft").trim() || "#e7eaf1";
    document.querySelectorAll("canvas").forEach(function (cv) {
      var c = Chart.getChart(cv);
      if (!c) return;
      // 만들 때 색을 못 박아 둔 축은 그대로 두고, 안 준 축만 따라오게 한다
      ["x", "y"].forEach(function (ax) {
        var sc = c.options.scales && c.options.scales[ax];
        if (!sc) return;
        if (sc.ticks && sc.ticks.color) sc.ticks.color = Chart.defaults.color;
        if (sc.grid && sc.grid.color) sc.grid.color = Chart.defaults.borderColor;
      });
      var lg = c.options.plugins && c.options.plugins.legend;
      if (lg && lg.labels && lg.labels.color) lg.labels.color = Chart.defaults.color;
      c.update("none");
    });
  }
  syncChartTheme();
  window.addEventListener("themechange", syncChartTheme);

  /* ── 긴 표 접기 ──
     표를 10행쯤만 보이게 두고 나머지는 안에서 스크롤한다. 다만 한눈에
     훑거나 인쇄할 때가 있어, 넘치는 표에는 펼치기 단추를 자동으로 붙인다.
     .deal-scroll 를 두른 표면 어느 대시보드에서든 그대로 동작한다.
     표를 다시 그리면 요소가 새로 생기므로 표시가 자연히 초기화된다. */
  window.wireScrollBoxes = function () {
    document.querySelectorAll(".deal-scroll").forEach(function (box) {
      if (box.dataset.wired) return;
      // 다 보이면 단추가 필요 없다. 다만 여기서 표시를 남기면 안 된다 —
      // 표가 아직 비어 있을 때 한 번 불리면 그대로 잠겨, 나중에 행이
      // 채워져도 단추가 안 붙는다. 실제로 붙일 때만 표시한다.
      if (box.scrollHeight <= box.clientHeight + 4) return;
      box.dataset.wired = "1";
      var n = box.querySelectorAll("tbody tr").length;
      var shut = "▾ 전체 " + n.toLocaleString() + "행 펼치기";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "expand-btn";
      btn.innerHTML = shut;
      btn.addEventListener("click", function () {
        var open = box.classList.toggle("is-open");
        btn.innerHTML = open ? "▴ 접기" : shut;
        if (!open) {
          box.scrollTop = 0;
          box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      box.parentNode.insertBefore(btn, box.nextSibling);
    });
  };

  /* ── 조회시각 ── */
  var fetched = document.getElementById("fetchedAt");
  if (fetched) {
    var built = (window.DASH_DATA && window.DASH_DATA.builtAt) || "";
    var now = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
    fetched.innerHTML = built
      ? "실거래 자료 기준: <b>" + built + "</b><br />화면 열람: " + now
      : "화면 열람: " + now;
  }

  /* ── 섹션 내비게이션(부드러운 스크롤 + 현재 위치 표시) ── */
  var nav = document.querySelector("nav.section-nav");
  if (nav) {
    var btns = Array.prototype.slice.call(nav.querySelectorAll("button[data-target]"));
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var el = document.getElementById(b.dataset.target);
        if (!el) return;
        // 탭으로 숨겨진 섹션이면 해당 탭을 먼저 켠다
        if (el.hasAttribute("data-tabpanel") && !el.classList.contains("is-on")) {
          var tab = document.querySelector('.top-tab[data-tab="' + el.dataset.tabpanel + '"]');
          if (tab) tab.click();
        }
        var top = el.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: top, behavior: "smooth" });
      });
    });

    var sections = btns
      .map(function (b) { return document.getElementById(b.dataset.target); })
      .filter(Boolean);
    var onScroll = function () {
      var y = window.scrollY + 140, cur = null;
      sections.forEach(function (s) {
        if (s.offsetParent !== null && s.offsetTop <= y) cur = s.id;
      });
      btns.forEach(function (b) { b.classList.toggle("active", b.dataset.target === cur); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ── 섹션별 인쇄 ── */
  window.printSection = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("print-target");
    document.body.classList.add("printing-one");
    var cleanup = function () {
      document.body.classList.remove("printing-one");
      el.classList.remove("print-target");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1500);   // afterprint를 안 쏘는 브라우저 대비
  };

  /* ── 전체 인쇄 ── */
  var printAll = document.getElementById("printAllBtn");
  if (printAll) printAll.addEventListener("click", function () { window.print(); });

  /* ── TOP 10 3종 전환 탭 ──
     화면에서는 한 번에 한 섹션만 보여주고, 인쇄(@media print)에서는 CSS가 셋 다 편다. */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".top-tab[data-tab]"));
  if (tabs.length) {
    var panels = Array.prototype.slice.call(document.querySelectorAll("section[data-tabpanel]"));
    var show = function (key) {
      tabs.forEach(function (t) {
        var on = t.dataset.tab === key;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach(function (p) { p.classList.toggle("is-on", p.dataset.tabpanel === key); });
      // 탭이 바뀌면 그동안 숨어 있던 캔버스가 0px로 잡혀 있을 수 있으니 차트를 다시 재운다
      if (window.Chart && window.Chart.instances) {
        Object.keys(window.Chart.instances).forEach(function (k) {
          try { window.Chart.instances[k].resize(); } catch (e) { /* noop */ }
        });
      }
      document.dispatchEvent(new CustomEvent("top10tabchange", { detail: { tab: key } }));
    };
    tabs.forEach(function (t) { t.addEventListener("click", function () { show(t.dataset.tab); }); });
    show((tabs.find(function (t) { return t.classList.contains("is-on"); }) || tabs[0]).dataset.tab);
  }
})();
