/* 공통 소소한 동작 — 조회시각 표시, 섹션 내비게이션, 섹션별 인쇄, TOP10 탭 전환 */
(function () {
  "use strict";

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
