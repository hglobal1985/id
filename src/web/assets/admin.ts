// /assets/admin.js — staff back office (審核、會員、選項、合併頁、刪除申請、管理人員、稽核).
// Tabs appear only for the permissions the server reports; the server enforces every action anyway.
// textContent only; no template literals (lives in String.raw).
export const ADMIN_JS = String.raw`
(function () {
  "use strict";
  var root = document.getElementById("app");
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function api(method, path, body) {
    var opt = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) { return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; } return { status: r.status, body: j }; }); });
  }
  function errText(r) {
    if (r.body && r.body.error) {
      if (r.body.error.code === "reauth_required") return "此操作需要重新登入（10 分鐘內）。";
      return r.body.error.message || "失敗";
    }
    return "發生錯誤";
  }
  var labels = {};
  function show(v, key) {
    if (v === null || v === undefined) return "—";
    var code = typeof v === "string" ? v : v.option;
    if (typeof v !== "string" && v.option === "other") return "其他：" + (v.custom_text || "");
    var l = key && labels[key] && labels[key][code];
    if (l) return l;
    if (typeof v === "string") return v;
    if (v.option) return v.option;
    return JSON.stringify(v);
  }
  var me = null, pane = el("div"), tabsBox = el("div", { class: "tabs" });
  var TABS = [
    ["review", "審核", reviews], ["members.read", "會員", members], ["options.manage", "選項", options],
    ["uplines.merge", "合併頁", merge], ["deletion.execute", "刪除申請", deletions], ["staff.manage", "管理人員", staff], ["audit.read", "稽核", audit]
  ];
  function tab(i) {
    Array.prototype.forEach.call(tabsBox.children, function (b, j) { b.className = j === i ? "on" : ""; });
    pane.textContent = "";
    TABS.filter(function (t) { return me.permissions.indexOf(t[0]) >= 0; })[i][2]();
  }
  function card(title, kids) { return el("section", { class: "card" }, [el("h2", { text: title })].concat(kids)); }
  function m() { return el("div", { class: "msg" }); }
  function say(box, ok, t) { box.className = "msg " + (ok ? "ok" : "bad"); box.textContent = t; }

  function reviews() {
    api("GET", "/v1/admin/reviews").then(function (r) {
      var list = r.body.reviews;
      pane.appendChild(card("待審核（" + list.length + "）", list.length ? list.map(function (x) {
        var box = m();
        function decide(d) { return function () { api("POST", "/v1/admin/reviews/" + x.id + "/decision", { decision: d }).then(function (res) { if (res.status === 200) { pane.textContent = ""; reviews(); } else say(box, false, errText(res)); }); }; }
        return el("div", { class: "row" }, [
          el("strong", { text: (x.display_name || "會員") + (x.member_number ? "（" + x.member_number.number + "）" : "") }),
          el("div", { text: x.field_label + "：" + show(x.current_value, x.field_key) + " → " + show(x.requested_value, x.field_key) }),
          el("div", { class: "help", text: x.created_at }),
          el("div", { class: "inline" }, [el("button", { class: "primary", text: "核准", onclick: decide("approve") }), el("button", { class: "danger", text: "駁回", onclick: decide("reject") }), box])]);
      }) : [el("p", { class: "help", text: "目前沒有待審核的申請。" })]));
    });
  }

  function members() {
    var q = el("input", { type: "text", placeholder: "會員編號、姓名或會員識別碼" }), out = el("div");
    pane.appendChild(card("查詢會員", [el("div", { class: "inline" }, [q, el("button", { class: "primary", text: "查詢", onclick: function () {
      api("GET", "/v1/admin/members?q=" + encodeURIComponent(q.value)).then(function (r) {
        out.textContent = "";
        (r.body.members || []).forEach(function (x) { out.appendChild(el("div", { class: "row" }, [el("button", { text: (x.display_name || "會員") + (x.member_number ? "（" + x.member_number.number + "）" : ""), onclick: function () { detail(x.member_id); } })])); });
      });
    } })]), out]));
  }
  function detail(id) {
    Promise.all([api("GET", "/v1/admin/members/" + id), api("GET", "/v1/amway/field-definitions")]).then(function (r) {
      var d = r[0].body, defs = r[1].body ? r[1].body.fields : [];
      var adjustable = ["education_system", "education_center", "rank", "upline_diamond", "upline_platinum", "upline_crown_ambassador"];
      var rows = defs.filter(function (f) { return adjustable.indexOf(f.key) >= 0; }).map(function (f) {
        var st = d.amway[f.key], box = m();
        var sel = el("select", {}, [el("option", { value: "", text: "（無）" })].concat((f.options || []).map(function (o) { return el("option", { value: o.value, text: o.label }); })));
        var cur = st ? st.value : null; sel.value = cur ? (typeof cur === "string" ? cur : cur.option) : "";
        var custom = el("input", { type: "text", placeholder: "其他：請填寫" }); custom.value = cur && cur.custom_text ? cur.custom_text : "";
        return el("div", { class: "row" }, [el("label", { text: f.label + "：" + show(cur) + (st && st.pending_value ? "（待審：" + show(st.pending_value) + "）" : "") }),
          el("div", { class: "inline" }, [sel, f.type === "select_or_custom" ? custom : null, el("button", { text: "代調整", onclick: function () {
            var v = sel.value === "" ? null : (f.type === "select_or_custom" ? { option: sel.value, custom_text: sel.value === "other" ? custom.value : null } : sel.value);
            api("PUT", "/v1/admin/members/" + id + "/amway/" + f.key, { value: v }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已調整並通知會員" : errText(res)); });
          } }), box])]);
      });
      pane.appendChild(card(d.display_name || "會員", [
        el("p", { class: "mono", text: d.member_id }),
        el("p", { text: "編號：" + d.member_numbers.map(function (n) { return n.country + " " + n.number; }).join("、") }),
        el("p", { text: "Amway：" + (d.amway_enabled ? "已勾選" : "未勾選") + (d.spouse ? "；夫妻：" + (d.spouse.display_name || "會員") : "") })
      ].concat(rows)));
    });
  }

  function options() {
    api("GET", "/v1/admin/amway/options").then(function (r) {
      var b = r.body;
      b.fields.forEach(function (f) {
        var list = b.options.filter(function (o) { return o.field_key === f.key; });
        var v = el("input", { type: "text", placeholder: "代碼" }), l = el("input", { type: "text", placeholder: "顯示名稱" }), s = el("input", { type: "text", placeholder: "排序（數字）" }), box = m();
        pane.appendChild(card(f.label, [el("table", {}, [el("tr", {}, [el("th", { text: "代碼" }), el("th", { text: "名稱" }), el("th", { text: "排序" }), el("th", { text: "狀態" })])].concat(list.map(function (o) {
          return el("tr", {}, [el("td", { class: "mono", text: o.value }), el("td", { text: o.label }), el("td", { text: String(o.sort_order) }), el("td", {}, [el("button", { text: o.active ? "停用" : "啟用", onclick: function () {
            api("PUT", "/v1/admin/amway/options", { field_key: f.key, value: o.value, label: o.label, sort_order: o.sort_order, active: !o.active }).then(function (res) { if (res.status === 200) { pane.textContent = ""; options(); } else say(box, false, errText(res)); });
          } })])]);
        }))), f.key === "rank" ? el("p", { class: "help", text: "排序即獎銜階梯，由低到高。" }) : null,
        el("div", { class: "inline" }, [v, l, s, el("button", { class: "primary", text: "新增或更新", onclick: function () {
          api("PUT", "/v1/admin/amway/options", { field_key: f.key, value: v.value, label: l.value, sort_order: Number(s.value), active: true }).then(function (res) { if (res.status === 200) { pane.textContent = ""; options(); } else say(box, false, errText(res)); });
        } }), box])]));
      });
    });
  }

  function merge() {
    Promise.all([api("GET", "/v1/admin/amway/uplines/custom"), api("GET", "/v1/amway/field-definitions")]).then(function (r) {
      var defs = r[1].body.fields;
      var rows = r[0].body.custom.map(function (x) {
        var f = defs.filter(function (d) { return d.key === x.field_key; })[0], box = m();
        var sel = el("select", {}, f.options.filter(function (o) { return o.value !== "other"; }).map(function (o) { return el("option", { value: o.value, text: o.label }); }));
        return el("div", { class: "row" }, [el("strong", { text: f.label + "：「" + x.custom_text + "」（" + x.members + " 人）" }),
          el("div", { class: "inline" }, [sel, el("button", { class: "primary", text: "合併", onclick: function () {
            api("POST", "/v1/admin/amway/uplines/merge", { field_key: x.field_key, custom_text: x.custom_text, into: sel.value }).then(function (res) { if (res.status === 200) { pane.textContent = ""; merge(); } else say(box, false, errText(res)); });
          } }), box])]);
      });
      pane.appendChild(card("合併頁：會員自填的上手名稱", rows.length ? [el("p", { class: "help", text: "請先在「選項」新增正式名稱，再合併。" })].concat(rows) : [el("p", { class: "help", text: "目前沒有自填的上手名稱。" })]));
    });
  }

  function deletions() {
    api("GET", "/v1/admin/deletion-requests").then(function (r) {
      var list = r.body.requests;
      pane.appendChild(card("資料刪除申請（" + list.length + "）", list.length ? list.map(function (x) {
        var box = m();
        return el("div", { class: "row" }, [el("strong", { text: (x.display_name || "會員") + "：" + (x.scope === "account" ? "刪除帳號" : "刪除 Amway 資料") }),
          el("div", { class: "help", text: "申請 " + x.requested_at.slice(0, 10) + "，期限 " + x.due_at.slice(0, 10) }),
          el("div", { class: "inline" }, [el("button", { class: "danger", text: "執行刪除", onclick: function () {
            if (!confirm("刪除後無法復原。確定執行嗎？")) return;
            api("POST", "/v1/admin/deletion-requests/" + x.id + "/complete").then(function (res) { if (res.status === 200) { pane.textContent = ""; deletions(); } else say(box, false, errText(res)); });
          } }), box])]);
      }) : [el("p", { class: "help", text: "目前沒有待處理的申請。" })]));
    });
  }

  function staff() {
    api("GET", "/v1/admin/staff").then(function (r) {
      var b = r.body, id = el("input", { type: "text", placeholder: "會員識別碼" }), box = m();
      var checks = b.roles.map(function (x) { var c = el("input", { type: "checkbox", value: x.role }); return [c, el("label", { text: x.label })]; });
      pane.appendChild(card("管理人員", b.staff.map(function (s) { return el("div", { class: "row" }, [el("strong", { text: s.display_name || s.member_id }), el("div", { class: "help", text: s.roles.join("、") }), el("div", { class: "mono help", text: s.member_id })]); })
        .concat([el("div", { class: "inline" }, [id].concat([].concat.apply([], checks)).concat([el("button", { class: "primary", text: "設定角色", onclick: function () {
          var roles = checks.filter(function (c) { return c[0].checked; }).map(function (c) { return c[0].value; });
          api("PUT", "/v1/admin/staff/" + encodeURIComponent(id.value.trim()), { roles: roles }).then(function (res) {
            if (res.status === 200) { pane.textContent = ""; staff(); return; }
            if (res.body && res.body.error && res.body.error.code === "reauth_required") { location.href = "/login?return_to=%2Fadmin"; return; }
            say(box, false, errText(res));
          });
        } }), box]))])));
    });
  }

  function audit() {
    var t = el("input", { type: "text", placeholder: "對象（會員識別碼）" }), out = el("div");
    function run() { api("GET", "/v1/admin/audit?limit=100" + (t.value ? "&target_id=" + encodeURIComponent(t.value) : "")).then(function (r) {
      out.textContent = "";
      out.appendChild(el("table", {}, [el("tr", {}, ["時間", "操作人", "動作", "對象", "結果", "app"].map(function (h) { return el("th", { text: h }); }))].concat(r.body.entries.map(function (e) {
        return el("tr", {}, [e.occurred_at, e.actor_type + (e.actor_id ? " " + e.actor_id.slice(0, 8) : ""), e.action, e.target_id ? e.target_id.slice(0, 8) : "", e.result, e.app_id || ""].map(function (v) { return el("td", { text: v }); }));
      }))));
    }); }
    pane.appendChild(card("稽核紀錄", [el("div", { class: "inline" }, [t, el("button", { text: "查詢", onclick: run })]), out]));
    run();
  }

  api("GET", "/v1/admin/me").then(function (r) {
    if (r.status === 401) { location.href = "/login?return_to=%2Fadmin"; return; }
    if (r.status !== 200) { root.appendChild(el("p", { text: "您沒有後台權限。" })); return; }
    me = r.body;
    root.textContent = "";
    root.appendChild(el("p", { class: "help", text: "身分：" + me.roles.map(function (x) { return x.label; }).join("、") }));
    TABS.filter(function (t) { return me.permissions.indexOf(t[0]) >= 0; }).forEach(function (t, i) { tabsBox.appendChild(el("button", { text: t[1], onclick: function () { tab(i); } })); });
    root.appendChild(tabsBox); root.appendChild(pane);
    api("GET", "/v1/amway/field-definitions").then(function (d) {
      ((d.body && d.body.fields) || []).forEach(function (f) { labels[f.key] = {}; (f.options || []).forEach(function (o) { labels[f.key][o.value] = o.label; }); });
      tab(0);
    });
  });
})();
`;
