/* 공통 소소한 동작 — 조회시각 표시, 섹션 내비게이션, 섹션별 인쇄, TOP10 탭 전환 */
(function () {
  "use strict";

  /* ── 라이트·다크 ──
     고른 값은 이 기기에 남는다. 안 골랐으면 기기 설정을 따라가고,
     설정이 바뀌면 같이 따라간다. 인쇄는 CSS에서 늘 밝은 색으로 돌린다. */
  var THEME_KEY = "geumjib-theme";

  /* '자동'일 때 data-theme을 지우고 기기 설정에 맡기려 했는데, 어두운 색은
     전부 html[data-theme="dark"]에만 걸려 있어(64군데) 딸려 오지 않았다.
     다크로 맞춰 둔 폰에서도 화면이 계속 밝았던 까닭이다.
     기기 설정을 여기서 읽어 dark/light 중 하나로 찍어 준다 — 기억하는 값은
     그대로 'auto'라, 설정이 바뀌면 아래 listener가 다시 따라간다. */
  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function applyTheme(mode) {
    var root = document.documentElement;
    var real = (mode === "dark" || mode === "light") ? mode : (prefersDark() ? "dark" : "light");
    root.setAttribute("data-theme", real);
    document.querySelectorAll(".theme-toggle button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.theme === (mode || "auto"));
    });
    var face = { light: "☀️", dark: "🌙" }[mode] || "🌗";
    var word = { light: "라이트", dark: "다크" }[mode] || "자동";
    document.querySelectorAll(".theme-cycle").forEach(function (b) {
      b.textContent = face;
      b.title = "테마: " + word + " (눌러서 바꾸기)";
      b.setAttribute("aria-label", b.title);
    });
  }

  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  }

  (function initTheme() {
    var host = document.getElementById("themeToggle");
    if (host) {
      host.className = "theme-toggle";
      /* 폰에서는 세 단추가 173px을 먹어 상호·전화번호를 밀어낸다. 그래서
         눌러서 돌아가는 한 개짜리를 함께 두고, 좁은 화면에서는 이것만 보인다.
         자동 → 라이트 → 다크 → 자동 순으로 돈다. */
      host.innerHTML =
        '<button type="button" class="theme-cycle" title="테마 바꾸기" aria-label="테마 바꾸기"></button>' +
        '<button type="button" data-theme="light" title="밝게">☀️ 라이트</button>' +
        '<button type="button" data-theme="dark" title="어둡게">🌙 다크</button>' +
        '<button type="button" data-theme="auto" title="기기 설정 따라가기">자동</button>';
      host.addEventListener("click", function (e) {
        var cyc = e.target.closest(".theme-cycle");
        var b = cyc || e.target.closest("button[data-theme]");
        if (!b) return;
        var ORDER = ["auto", "light", "dark"];
        var m = cyc ? ORDER[(ORDER.indexOf(savedTheme()) + 1) % ORDER.length] : b.dataset.theme;
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

  /* ── OSM 바탕 타일 ──
     예전에는 'https://{s}.tile.openstreetmap.org/...'를 썼다. {s}는 Leaflet이
     a·b·c 세 갈래로 나눠 부르는 자리인데, 어느 타일이 어느 갈래로 갈지는
     좌표로 정해진다(abs(x+y) % 3). 그래서 세 갈래 중 하나가 안 열리는 망에서는
     늘 같은 자리의 타일만 까맣게 남는다 — 지도 오른쪽 한 칸이 매번 같은 자리에
     비던 게 이것으로 설명된다. OSM도 요즘은 갈래 없는 주소를 권한다.

     타일이 하나 실패해도 그 자리는 그냥 빈 칸으로 남으므로, 한 번은 다시
     불러 본다. 두 번째도 실패하면 더 조르지 않는다 — 지도가 목적이 아니라
     위치를 짚어 주는 화면이라 한 칸이 비어도 브리핑은 이어진다. */
  /* ── 지도 단추를 누르면 페이지가 튀던 것 ──
     Leaflet은 +·− 같은 단추를 누르면 키보드로도 움직일 수 있게 지도 칸에
     초점을 옮긴다(focus). 그런데 브라우저는 초점 받은 칸을 화면에 다 보이려고
     페이지를 스크롤한다. 지도가 화면 아래로 삐져나와 있으면 한 번 누를 때마다
     페이지가 올라가(주변 입지 지도 180px) −단추가 고정 막대 밑으로 숨고, 제자리의
     마우스는 단추가 아니라 지도 위(손바닥 모양)에 놓인다 — 그 뒤로는 눌러도
     지도만 눌려 먹통처럼 보이다가, 밖에 나갔다 들어와 단추를 다시 짚으면 되던
     것이다. Leaflet도 지도를 직접 누를 때는 스크롤을 되돌리는데 단추 쪽만
     빠뜨렸다. 초점은 옮기되 스크롤은 하지 않게 한다. */
  if (window.L && L.Control && L.Control.prototype._refocusOnMap) {
    L.Control.prototype._refocusOnMap = function (e) {
      if (!this._map || !e || !(e.screenX > 0 && e.screenY > 0)) return;
      var box = this._map.getContainer();
      try { box.focus({ preventScroll: true }); }
      catch (err) {
        var x = window.scrollX, y = window.scrollY;
        box.focus(); window.scrollTo(x, y);
      }
    };
  }

  window.osmTiles = function (map) {
    var layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", maxZoom: 19,
    });
    layer.on("tileerror", function (e) {
      var img = e.tile;
      if (!img || img.dataset.retried) return;
      img.dataset.retried = "1";
      var src = img.src;
      setTimeout(function () { img.src = src.split("?")[0] + "?r=1"; }, 600);
    });
    steadyZoom(map);     // 모든 지도가 여기를 지나므로 +·− 단추도 여기서 다잡는다
    return layer.addTo(map);
  };

  /* ── +·− 단추가 눌린 만큼 움직이게 ──
     1) Leaflet은 확대·축소 움직임(0.25초)이 도는 동안 들어온 클릭을 조용히
        버린다. 연달아 누르면 두 번에 한 번꼴로 씹혀 "안 먹힌다"가 된다.
        움직이는 중에 들어온 클릭은 적어 두었다가 움직임이 끝나면 마저 한다.
     2) 단추가 링크(<a href="#">)라 누른 채 손이 조금 움직이면 끌어 옮기기가
        시작돼 클릭이 사라진다. 끌리지 않게 막는다(글자 선택은 app.css). */
  function steadyZoom(map) {
    var box = map.getContainer();
    if (box.dataset.steadyZoom) return;
    box.dataset.steadyZoom = "1";
    box.querySelectorAll(".leaflet-control-zoom a").forEach(function (a) {
      a.draggable = false;
    });
    var owed = 0;
    // 잡는 단계에서 본다 — Leaflet이 단추에서 클릭을 버리기 전에 먼저 적어 둔다
    box.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".leaflet-control-zoom a");
      if (!a || !map._animatingZoom) return;
      owed += a.classList.contains("leaflet-control-zoom-in") ? 1 : -1;
    }, true);
    map.on("zoomend", function () {
      if (!owed) return;
      var d = owed * (map.options.zoomDelta || 1);
      owed = 0;
      map.setZoom(map.getZoom() + d);   // 최대·최소를 넘으면 Leaflet이 알아서 멈춘다
    });
  }

  /* ── 지도 칸이 바뀌면 지도에게 알려 준다 ──
     Leaflet은 창 크기가 바뀔 때만 스스로 다시 잰다. 칸만 넓어지는 경우
     — 옆 상세칸이 채워지거나, 고정 막대 높이가 달라지거나, 인쇄용으로
     펼쳐지거나 — 예전 크기를 그대로 들고 있어 타일이 칸을 다 못 덮는다.
     서울 전체로 줌아웃했을 때 지도 오른쪽이 검게 남던 게 이것이다
     (칸 606→1114px인데 타일은 704px까지만 그려졌다).
     칸을 지켜보다 바뀌면 다시 재라고 시킨다. */
  window.watchMapSize = function (map, el) {
    if (!map || !el || typeof ResizeObserver === "undefined") return;
    if (el.dataset.sizeWatched) return;
    el.dataset.sizeWatched = "1";
    el._leafletMap = map;              // 칸에서 지도를 되짚을 수 있게 — 확인할 때 쓴다
    var t = null;
    new ResizeObserver(function () {
      // 잇달아 들어오는 변화는 한 번으로 묶는다. 다시 재는 일이 무겁다.
      clearTimeout(t);
      t = setTimeout(function () {
        /* 단지 카드를 다시 그리면 옛 지도는 걷히고 칸도 문서에서 빠진다. 그때도
           감시는 "크기가 0이 됐다"고 알려 오는데, 걷힌 지도에 다시 재라고 하면
           오류가 난다(_leaflet_pos). 문서에 붙어 있을 때만 잰다. */
        if (!el.isConnected) return;
        try { map.invalidateSize({ animate: false }); } catch (e) { /* 이미 걷힌 지도 */ }
      }, 80);
    }).observe(el);
  };

  /* ── 긴 표 접기 ──
     표를 10행쯤만 보이게 두고 나머지는 안에서 스크롤한다. 다만 한눈에
     훑거나 인쇄할 때가 있어, 넘치는 표에는 펼치기 단추를 자동으로 붙인다.
     .deal-scroll 를 두른 표면 어느 대시보드에서든 그대로 동작한다.
     표를 다시 그리면 요소가 새로 생기므로 표시가 자연히 초기화된다. */
  window.wireScrollBoxes = function () {
    document.querySelectorAll(".deal-scroll").forEach(function (box) {
      // 숨은 탭 안에 있으면 높이가 0이라 아무것도 잴 수 없다. 그냥 두었다가
      // 그 탭이 켜질 때 다시 온다(top10tabchange, load).
      if (!box.offsetParent && box.offsetHeight === 0) return;

      // 행 높이가 표마다 다르다(36·44·54px). 픽셀을 손으로 정하면 어떤 표는
      // 7행, 어떤 표는 11행이 보인다. 실제로 재서 10행에 맞춘다.
      var head = box.querySelector("thead tr");
      var one = box.querySelector("tbody tr");
      if (head && one) {
        var want = parseInt(box.dataset.rows || "10", 10);
        var rowH = one.getBoundingClientRect().height;
        if (rowH > 0) {
          box.style.setProperty("--tbl-h",
            Math.round(head.getBoundingClientRect().height + rowH * want) + "px");
        }
      }

      var next = box.nextElementSibling;
      var btn = (next && next.classList.contains("expand-btn")) ? next : null;
      var open = box.classList.contains("is-open");
      var n = box.querySelectorAll("tbody tr").length;

      // 펼쳐 둔 상태면 max-height가 풀려 clientHeight가 곧 전체 높이가 된다.
      // 그래서 "접었을 때 높이"를 기준으로 넘치는지 본다 — 펼친 채 범위를
      // 좁혀 두 줄만 남았는데 접기 단추가 남아 있는 일을 막는다.
      var limit = parseFloat(box.style.getPropertyValue("--tbl-h")) || box.clientHeight;
      var overflows = box.scrollHeight > limit + 4;
      if (!overflows) {
        // 필터를 좁혀 행이 줄면 단추가 남아 "전체 27행"처럼 낡은 숫자를 말한다
        if (btn) btn.remove();
        box.classList.remove("is-open");
        return;
      }

      var shut = "▾ 전체 " + n.toLocaleString() + "행 펼치기";
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "expand-btn";
        btn.addEventListener("click", function () {
          var nowOpen = box.classList.toggle("is-open");
          btn.innerHTML = nowOpen ? "▴ 접기" : btn.dataset.shut;
          if (!nowOpen) {
            box.scrollTop = 0;
            box.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        });
        box.parentNode.insertBefore(btn, box.nextSibling);
      }
      btn.dataset.shut = shut;                 // 행 수가 바뀌면 문구도 따라간다
      btn.innerHTML = open ? "▴ 접기" : shut;
    });
  };

  /* 처음 그릴 때는 아직 자리가 안 잡혀 높이를 못 재는 표가 있다.
     탭 안에 든 표, 늦게 켜지는 섹션이 그렇다. 한 박자 뒤 한 번 더 훑는다. */
  window.addEventListener("load", function () {
    requestAnimationFrame(function () { window.wireScrollBoxes(); });
  });

  /* ── 조회시각 ── */
  var fetched = document.getElementById("fetchedAt");
  if (fetched) {
    var built = (window.DASH_DATA && window.DASH_DATA.builtAt) || "";
    var now = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
    fetched.innerHTML = built
      ? "실거래 자료 기준: <b>" + built + "</b><br />화면 열람: " + now
      : "화면 열람: " + now;
  }

  /* 손가락으로 쓰는 화면에서는 그래프 설명을 '탭했을 때만' 띄운다.

     Chart.js는 기본으로 touchmove에도 반응한다. 그래서 그래프 위를 지나
     화면을 넘기기만 해도 설명 상자가 떠서 그래프를 덮어 버렸다(폰 가로보기).
     마우스가 있는 화면은 그대로 둔다 — 거기서는 올려 보는 것이 자연스럽다. */
  window.chartEvents = function () {
    var coarse = window.matchMedia && window.matchMedia("(hover: none)").matches;
    return coarse ? ["click"] : ["mousemove", "mouseout", "click", "touchstart"];
  };

  /* ── 상단 고정 막대 ── */
  var sticky = document.getElementById("stickyTop");

  function stickyH() { return sticky ? sticky.getBoundingClientRect().height : 90; }
  window.stickyH = stickyH;        // 대시보드 쪽에서도 이 높이를 피해 스크롤한다

  /* ── 좁은 화면에서 아래로 내리면 막대를 한 줄로 접는다 ──────────────────
     폰을 눕히면 화면 높이가 375px뿐인데 막대가 168px을 먹어, 정작 보려는
     표는 늘 반쪽만 보였다. 조건은 한 번 맞춰 두고 한참 읽는 것이므로,
     읽기 시작하면(= 아래로 내리면) 접어 두고 자리를 내준다.

     접힌 줄에는 지금 무엇을 보고 있는지만 남긴다 — '서초구 반포동 · 최근
     3개월'. 이게 없으면 한참 내려간 뒤 무슨 조건이었는지 알 수 없다.
     그 줄을 누르면 다시 펴진다. 위로 끝까지 올려도 펴진다. */
  var mini = null;

  function buildMini() {
    if (!sticky || mini) return;
    mini = document.createElement("button");
    mini.type = "button";
    mini.className = "sticky-mini";
    mini.innerHTML = '<span class="mini-what"></span><span class="mini-more">조건 펼치기 ▾</span>';
    mini.addEventListener("click", function () {
      sticky.classList.toggle("mini-open");
    });
    sticky.insertBefore(mini, sticky.firstChild);
  }

  /* 대시보드가 자기 상태를 한 줄로 적어 보낸다. 안 보내면 접기를 안 쓴다 —
     무엇을 보고 있는지 모르는 채로 접으면 길을 잃는다. */
  window.setStickyMini = function (text) {
    buildMini();
    if (!mini) return;
    mini.querySelector(".mini-what").textContent = text || "";
    sticky.classList.toggle("has-mini", !!text);
  };

  if (sticky) {
    // 조금만 내려가도 부제와 로고를 접어 막대를 한 단 낮춘다.
    // 고정 막대가 두꺼우면 정작 볼 내용이 좁아진다.
    var shrink = function () {
      sticky.classList.toggle("is-scrolled", window.scrollY > 40);
      // 맨 위로 돌아오면 손으로 펴 둔 것도 함께 닫는다 — 이제 원래 막대가 보인다
      if (window.scrollY <= 40) sticky.classList.remove("mini-open");
    };
    window.addEventListener("scroll", shrink, { passive: true });
    shrink();
  }

  /* ── 섹션 내비게이션(부드러운 스크롤 + 현재 위치 표시) ──

     상권분석은 섹션을 JS로 그리므로 탭도 그릴 때마다 다시 채운다. 그래서
     배선을 함수로 빼 두고 밖에서도 부를 수 있게 했다(wireSectionNav). */
  var navScroll = null;

  window.wireSectionNav = function () {
    var nav = document.querySelector("nav.section-nav");
    if (!nav) return;
    var btns = Array.prototype.slice.call(nav.querySelectorAll("button[data-target]"));
    if (!btns.length) return;

    btns.forEach(function (b) {
      if (b.dataset.wired) return;          // 다시 그린 탭만 새로 배선한다
      b.dataset.wired = "1";
      b.addEventListener("click", function () {
        var el = document.getElementById(b.dataset.target);
        if (!el) return;
        // 탭으로 숨겨진 섹션이면 해당 탭을 먼저 켠다
        if (el.hasAttribute("data-tabpanel") && !el.classList.contains("is-on")) {
          var tab = document.querySelector('.top-tab[data-tab="' + el.dataset.tabpanel + '"]');
          if (tab) tab.click();
        }
        // 고정 막대에 가려지지 않게 그 높이만큼 덜 내려간다. 90px로 못박아
        // 두면 막대가 두세 줄일 때 섹션 제목이 막대 뒤로 숨는다.
        var top = el.getBoundingClientRect().top + window.scrollY - stickyH() - 12;
        var was = window.scrollY;
        window.scrollTo({ top: top, behavior: "smooth" });
        // 부드러운 스크롤이 먹지 않는 화면이 있다(상권분석에서 확인). 눌러도
        // 아무 일이 없으면 고장으로 보이므로, 안 움직였으면 그냥 건너뛴다.
        setTimeout(function () {
          if (Math.abs(window.scrollY - was) < 4 && Math.abs(top - was) > 8) {
            window.scrollTo(0, top);
          }
        }, 350);

        /* 내려가는 동안 막대가 접히면 본문이 그만큼 위로 올라와, 미리 셈해 둔
           자리가 어긋난다. 멀리 갈수록 부드러운 스크롤이 오래 걸리므로 시간을
           못박지 않고 멎을 때까지 지켜보다가 한 번 맞춘다. */
        var last = -1, tries = 0;
        var settle = setInterval(function () {
          var now = Math.round(window.scrollY);
          if (now === last || ++tries > 20) {
            clearInterval(settle);
            var gap = el.getBoundingClientRect().top - stickyH() - 12;
            if (Math.abs(gap) > 8) window.scrollBy(0, gap);
            if (navScroll) navScroll();
          }
          last = now;
        }, 100);
      });
    });

    /* 지금 보는 칸에 불을 켠다.

       단추와 섹션을 미리 담아 두지 않고 그때그때 다시 찾는다. 화면이 다시
       그려지면 단추가 새것으로 바뀌는데, 담아 둔 옛 단추에 불을 켜 봐야
       화면에는 아무 일도 안 일어난다 — 눌러도 엉뚱한 칸에 불이 켜져 있던
       까닭이 이것이었다.

       위치도 offsetTop이 아니라 화면 기준(getBoundingClientRect)으로 잰다.
       offsetTop은 기준이 되는 조상이 무엇이냐에 따라 달라지고, 막대가 접혀
       본문이 위로 올라오면 값이 어긋난다. */
    if (navScroll) window.removeEventListener("scroll", navScroll);
    navScroll = function () {
      var live = document.querySelectorAll("nav.section-nav button[data-target]");
      if (!live.length) return;

      /* 막대 바로 아래 선을 긋고, 그 선에 제목이 가장 가까운 칸에 불을 켠다.

         두 번 헤맸다. '선을 지나간 마지막 칸'으로 하면, 막대가 접히며 본문이
         내려앉았을 때 이미 다 지나간 앞 칸에 불이 남는다(가격비교를 보는데
         월별 브리핑에 불이 켜졌다). '보이는 넓이가 가장 큰 칸'으로 하면 칸마다
         길이가 달라 긴 칸이 늘 이긴다(핵심 요약으로 갔는데 아래 실거래 지도에
         불이 켜졌다). 제목이 선에 가장 가까운 칸이 셋 다 맞는다 — 방금 옮겨 간
         칸은 제목이 선에 붙어 있고, 지나쳐 버린 칸은 제목이 멀리 위에 있다.

         재는 법은 화면 기준(getBoundingClientRect)으로 바꿨다. offsetTop은
         기준이 되는 조상에 따라 달라지고, 막대가 접혀 본문이 올라오면
         어긋난다. 단추도 그때그때 다시 찾는다 — 화면이 다시 그려지면 단추가
         새것으로 바뀌는데, 담아 둔 옛 단추에 불을 켜 봐야 소용이 없다. */
      var line = stickyH() + 24;
      var best = null, bestGap = Infinity;
      live.forEach(function (b) {
        if (b.hidden) return;                       // 아직 갈 곳이 없는 단추
        var s = document.getElementById(b.dataset.target);
        if (!s || s.offsetParent === null) return;
        var r = s.getBoundingClientRect();
        if (r.bottom <= line || r.top >= window.innerHeight) return;   // 화면 밖
        var gap = Math.abs(r.top - line);
        if (gap < bestGap) { bestGap = gap; best = b.dataset.target; }
      });
      live.forEach(function (b) { b.classList.toggle("active", b.dataset.target === best); });
    };
    window.addEventListener("scroll", navScroll, { passive: true });

    /* 위쪽 탭으로 칸을 갈아 끼우면 스크롤이 안 움직여도 보이는 것이 바뀐다.
       그때도 불을 다시 켜야 한다. */
    document.querySelectorAll(".top-tab").forEach(function (t) {
      if (t.dataset.navWired) return;
      t.dataset.navWired = "1";
      t.addEventListener("click", function () { setTimeout(navScroll, 60); });
    });

    navScroll();
  };

  window.wireSectionNav();

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
  /* 화면 쪽에서 인쇄 채비(지도 줄이기·타일 기다리기 등)를 할 수 있게 한 박자 준다.
     채비가 없는 대시보드는 그대로 바로 인쇄한다. */
  if (printAll) printAll.addEventListener("click", function () {
    Promise.resolve(window.preparePrint ? window.preparePrint() : null)
      .then(function () { window.print(); });
  });

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
      // 숨어 있던 표는 높이를 못 재 단추가 안 붙었다. 켜진 지금 다시 본다.
      if (window.wireScrollBoxes) window.wireScrollBoxes();
    };
    tabs.forEach(function (t) { t.addEventListener("click", function () { show(t.dataset.tab); }); });
    show((tabs.find(function (t) { return t.classList.contains("is-on"); }) || tabs[0]).dataset.tab);
  }
})();
