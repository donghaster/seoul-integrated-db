/* ════════════════════════════════════════════════════════════════════
   비아파트 대시보드 — 연립·다세대 / 단독·다가구

   그리는 일은 아파트 대시보드(../apt/app.js)가 그대로 한다. 집계가 셋이
   똑같기 때문이다 — 거래 하나가 '지역·이름·면적·금액'인 것은 주택 종류를
   가리지 않는다. 자료의 사정만 window.DASH_CFG로 알려 주면 된다.

   여기서는 그 화면에 없는 것만 맡는다 — 주택 종류를 고르는 줄과,
   종류마다 다른 안내 문구.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var KIND = window.DASH_KIND === "sh" ? "sh" : "rh";

  var INFO = {
    rh: {
      name: "연립·다세대",
      sub: "국토교통부 연립·다세대 매매·전월세 실거래가 · 서울시 25개 자치구 전역 · 구/법정동 단위 조회",
      note: "전용면적 기준 · 건물 이름으로 찾기 가능",
    },
    sh: {
      name: "단독·다가구",
      sub: "국토교통부 단독·다가구 매매·전월세 실거래가 · 서울시 25개 자치구 전역 · 자치구 단위 조회",
      /* 자료가 무엇을 못 하는지를 먼저 말해 둔다. 화면에 단지 찾기와 지도가
         없는 까닭을 모르면 "왜 아파트보다 부실하지" 하고 넘겨짚게 된다. */
      note: "연면적 기준 · 단지명·지번이 공개되지 않아 자치구 단위까지만",
    },
  };

  var me = INFO[KIND];

  var nameEl = document.getElementById("kindName");
  if (nameEl) nameEl.textContent = me.name;
  var subEl = document.getElementById("kindSub");
  if (subEl) subEl.textContent = me.sub;
  var idxEl = document.getElementById("idxSecTitle");
  if (idxEl) idxEl.textContent = me.name;
  var noteEl = document.getElementById("kindNote");
  if (noteEl) noteEl.textContent = me.note;

  /* 종류를 바꾸면 화면을 새로 연다.

     자료가 6MB짜리라 둘을 한꺼번에 들고 있을 수 없고, 그리는 쪽(apt/app.js)도
     한 번만 도는 함수 묶음이라 자료만 바꿔 끼울 수가 없다. 그래서 주소를 바꿔
     다시 연다 — 보고 있던 자치구·기간은 주소에 담겨 있으므로 그대로 따라간다. */
  var tabs = document.getElementById("kindTabs");
  if (tabs) {
    tabs.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.k === KIND);
      b.addEventListener("click", function () {
        if (b.dataset.k === KIND) return;
        var q = new URLSearchParams(location.search);
        if (b.dataset.k === "sh") {
          q.set("type", "sh");
          q.delete("dong");      // 단독은 법정동까지 못 내려간다
          q.delete("apt");       // 단지도 없다
        } else {
          q.delete("type");
        }
        location.search = q.toString();
      });
    });
  }
})();
