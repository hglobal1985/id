// /assets/notifications.js — the notifications page (the bell in the main menu leads here) and /assets/share.js —
// the share button of the public profile page. textContent only. Needs /assets/common.js for the notifications page.
export const NOTES_JS = String.raw`
(function () {
  "use strict";
  var HG = window.HG, el = HG.el, api = HG.api, root = document.getElementById("app");
  function when(iso) { return (iso || "").slice(0, 16).replace("T", " "); }
  // Staff who may review: pending requests are decided right here (no separate back-office page).
  function reviewCard(reload) {
    return api("GET", "/v1/admin/me").then(function (me) {
      if (me.status !== 200 || me.body.permissions.indexOf("review") < 0) return null;
      return Promise.all([api("GET", "/v1/admin/reviews"), api("GET", "/v1/amway/field-definitions")]).then(function (x) {
        if (x[0].status !== 200) return null;
        var labels = {};
        ((x[1].body && x[1].body.fields) || []).forEach(function (f) { labels[f.key] = {}; (f.options || []).forEach(function (o) { labels[f.key][o.value] = o.label; }); });
        function show(v, key) { if (v === null || v === undefined) return "（無）"; return (labels[key] && labels[key][v]) || String(v); }
        var list = x[0].body.reviews;
        var items = list.map(function (r) {
          var box = HG.msg();
          function decide(d) { return function () { api("POST", "/v1/admin/reviews/" + r.id + "/decision", { decision: d }).then(function (res) { if (res.status === 200) reload(); else HG.say(box, false, HG.errText(res)); }); }; }
          var num = r.member_number ? (r.member_number.number.indexOf(r.member_number.country) === 0 ? r.member_number.number : r.member_number.country + r.member_number.number) : "";
          return el("div", { class: "note-item unread" }, [
            el("strong", { text: (r.display_name || "會員") + (num ? "（" + num + "）" : "") + "：" + r.field_label }),
            r.center ? el("div", { class: "help", text: "中心：" + r.center }) : null,
            el("div", { text: "原本：" + show(r.current_value, r.field_key) + " → 申請：" + show(r.requested_value, r.field_key) }),
            el("div", { class: "when", text: when(r.created_at) }),
            el("div", { class: "actions" }, [el("button", { type: "button", class: "small primary", text: "核准", onclick: decide("approve") }), el("button", { type: "button", class: "small danger", text: "駁回", onclick: decide("reject") }), box])
          ]);
        });
        var pending = el("section", { class: "card" }, [el("h2", { text: "待審核（" + list.length + "）" })].concat(items.length ? items : [el("p", { class: "help", text: "目前沒有待審核的申請。" })]));
        // The record of decided requests, with the name of the person who decided each one.
        return api("GET", "/v1/admin/reviews/history").then(function (h) {
          var done = (h.status === 200 && h.body.history) || [];
          var rows = done.map(function (r) {
            var num = r.member_number ? (r.member_number.number.indexOf(r.member_number.country) === 0 ? r.member_number.number : r.member_number.country + r.member_number.number) : "";
            return el("div", { class: "note-item" }, [
              el("strong", { text: (r.display_name || "會員") + (num ? "（" + num + "）" : "") + "：" + r.field_label + " " + (r.status === "approved" ? "已核准" : "已駁回") }),
              r.center ? el("div", { class: "help", text: "中心：" + r.center }) : null,
              el("div", { text: "申請：" + show(r.requested_value, r.field_key) }),
              el("div", { class: "when", text: when(r.decided_at) + " 審核人員：" + (r.decided_by || "（未記錄）") })
            ]);
          });
          return el("div", {}, [pending, el("section", { class: "card" }, [el("h2", { text: "審核紀錄" })].concat(rows.length ? rows : [el("p", { class: "help", text: "還沒有審核紀錄。" })]))]);
        });
      });
    });
  }
  function load() {
    Promise.all([api("GET", "/v1/me/notifications"), reviewCard(load)]).then(function (all) {
      var r = all[0], rc = all[1];
      if (r.status === 401) { location.href = "/login?return_to=%2Fnotifications"; return; }
      var list = r.body.notifications, unread = r.body.unread, m = HG.msg();
      root.textContent = "";
      root.appendChild(el("div", { class: "pagebar" }, [el("h1", { text: "站內通知" }), unread ? el("button", { type: "button", class: "small", text: "全部標示已讀", onclick: function () {
        api("POST", "/v1/me/notifications/read-all").then(function (x) { if (x.status === 200) load(); else HG.say(m, false, HG.errText(x)); });
      } }) : null]));
      root.appendChild(m);
      if (rc) root.appendChild(rc);
      if (!list.length) { root.appendChild(el("section", { class: "card" }, [el("p", { class: "help", text: "目前沒有通知。" })])); return; }
      root.appendChild(el("section", { class: "card" }, list.map(function (x) {
        return el("div", { class: "note-item" + (x.read ? "" : " unread") }, [
          el("strong", { text: x.title }), el("div", { text: x.body }), el("div", { class: "when", text: when(x.created_at) }),
          el("div", { class: "actions" }, [
            x.actions.indexOf("unbind_spouse") >= 0 ? el("button", { type: "button", class: "small danger", text: "一鍵解除夫妻綁定", onclick: function () {
              if (!confirm("確定要解除夫妻綁定嗎？")) return;
              api("DELETE", "/v1/me/spouse").then(load);
            } }) : null,
            x.read ? null : el("button", { type: "button", class: "small", text: "標示已讀", onclick: function () { api("POST", "/v1/me/notifications/" + x.id + "/read").then(load); } })
          ])]);
      })));
    });
  }
  load();
})();
`;

export const SHARE_JS = String.raw`
(function () {
  "use strict";
  var btn = document.getElementById("share");
  if (!btn) return;
  // The share symbol follows the device: the box with an up arrow on iPhone, iPad and Mac, three dots on Android.
  var ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)) {
    var svg = btn.querySelector("svg");
    if (svg) svg.innerHTML = '<path d="M12 15V3.5M8 7l4-4 4 4M7.5 10H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18 10h-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  btn.addEventListener("click", function () {
    var link = btn.getAttribute("data-url") || location.href;
    var data = { title: btn.getAttribute("data-title") || document.title, url: link };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    var done = function (t) { var old = btn.getAttribute("data-label") || ""; btn.lastChild.textContent = t; setTimeout(function () { btn.lastChild.textContent = old; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { done("已複製連結"); }, function () { done("請手動複製網址"); });
    else done("請手動複製網址");
  });
})();
`;

// /assets/social.js — the 複製 tag under each social icon on the public page: copies the link.
export const SOCIAL_JS = String.raw`
(function () {
  "use strict";
  // The block title stays on one line: shrink the font until it fits the real width (the lt-N class is only the no-script fallback).
  function fitTitles() {
    Array.prototype.forEach.call(document.querySelectorAll(".life-title"), function (h) {
      h.className = "life-title"; h.style.fontSize = "";
      var f = parseFloat(getComputedStyle(h).fontSize) || 17.6;
      while (h.scrollWidth > h.clientWidth + 1 && f > 8) { f -= 0.5; h.style.fontSize = f + "px"; }
    });
  }
  fitTitles();
  window.addEventListener("resize", fitTitles);
  // The name sits in a box two lines high: a long name takes a smaller font to fit.
  Array.prototype.forEach.call(document.querySelectorAll(".soc-copy"), function (b) {
    var f = parseFloat(getComputedStyle(b).fontSize) || 11;
    while (b.scrollHeight > b.clientHeight + 1 && f > 6) { f -= 0.5; b.style.fontSize = f + "px"; }
  });
  Array.prototype.forEach.call(document.querySelectorAll(".soc-copy"), function (b) {
    b.addEventListener("click", function () {
      var url = b.getAttribute("data-url") || "";
      function done(t) { var old = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = old; }, 1500); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done("已複製"); }, function () { done("請手動複製"); });
      else done("請手動複製");
    });
  });
})();
`;
