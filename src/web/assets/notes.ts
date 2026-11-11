// /assets/notifications.js — the notifications page (the bell in the main menu leads here) and /assets/share.js —
// the share button of the public profile page. textContent only. Needs /assets/common.js for the notifications page.
export const NOTES_JS = String.raw`
(function () {
  "use strict";
  var HG = window.HG, el = HG.el, api = HG.api, root = document.getElementById("app");
  function when(iso) { return (iso || "").slice(0, 16).replace("T", " "); }
  function load() {
    api("GET", "/v1/me/notifications").then(function (r) {
      if (r.status === 401) { location.href = "/login?return_to=%2Fnotifications"; return; }
      var list = r.body.notifications, unread = r.body.unread, m = HG.msg();
      root.textContent = "";
      root.appendChild(el("div", { class: "pagebar" }, [el("h1", { text: "站內通知" }), unread ? el("button", { type: "button", class: "small", text: "全部標示已讀", onclick: function () {
        api("POST", "/v1/me/notifications/read-all").then(function (x) { if (x.status === 200) load(); else HG.say(m, false, HG.errText(x)); });
      } }) : null]));
      root.appendChild(m);
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
  btn.addEventListener("click", function () {
    var data = { title: document.title, url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    var done = function (t) { var old = btn.getAttribute("data-label") || ""; btn.lastChild.textContent = t; setTimeout(function () { btn.lastChild.textContent = old; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(function () { done("已複製連結"); }, function () { done("請手動複製網址"); });
    else done("請手動複製網址");
  });
})();
`;
