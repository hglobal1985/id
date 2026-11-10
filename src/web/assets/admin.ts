// /assets/admin.js — staff back office (審核、會員、選項、合併頁、刪除申請、App、管理人員、稽核).
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
    ["uplines.merge", "合併頁", merge], ["deletion.execute", "刪除申請", deletions], ["apps.operate", "App", apps], ["staff.manage", "管理人員", staff], ["audit.read", "稽核", audit]
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

  function apps() {
    var STATUS = { active: "正常", paused: "暫停（維護中）", killed: "停用" };
    function lines(t) { return t.value.split(/[\s,]+/).filter(function (x) { return x; }); }
    function field(label, input, help) { return el("div", { class: "row" }, [el("label", { text: label }), input, help ? el("div", { class: "help", text: help }) : null]); }
    function reauth(res) { if (res.body && res.body.error && res.body.error.code === "reauth_required") { location.href = "/login?return_to=%2Fadmin"; return true; } return false; }
    function reload() { pane.textContent = ""; apps(); }
    function form(b, a) {
      var box = m();
      var id = el("input", { type: "text", placeholder: "例如 learn", value: a ? a.app_id : null, disabled: !!a });
      var name = el("input", { type: "text", value: a ? a.name : null });
      var ios = el("input", { type: "text", value: a ? a.ios_bundle_id : null, placeholder: "留空自動產生 com.hglobal1985.<app_id>" });
      var android = el("input", { type: "text", value: a ? a.android_package : null, placeholder: "留空自動產生 com.hglobal1985.<app_id>" });
      var web = el("textarea", { placeholder: "留空自動產生 https://<app_id>.hglobal1985.com" }); web.value = a ? a.web_origins.join("\n") : "";
      var ret = el("textarea", { placeholder: "留空自動產生 <app_id>://auth/google" }); ret.value = a ? a.return_urls.join("\n") : "";
      var aud = el("textarea", { placeholder: "一般留空（只有改用原生 Google 登入才需要）" }); aud.value = a ? a.auth.google_audiences.join("\n") : "";
      var min = el("input", { type: "text", value: a ? a.min_version : "0.0.0" });
      var checks = b.scopes.map(function (sc) { var c = el("input", { type: "checkbox", value: sc }); c.checked = a ? a.scopes.indexOf(sc) >= 0 : (sc === "profile.read" || sc === "amway.read"); return [c, el("label", { text: sc })]; });
      function save() {
        var body = { name: name.value, ios_bundle_id: ios.value, android_package: android.value, web_origins: lines(web), return_urls: lines(ret), extra_google_audiences: lines(aud), min_version: min.value,
          scopes: checks.filter(function (c) { return c[0].checked; }).map(function (c) { return c[0].value; }) };
        if (!a) body.app_id = id.value.trim();
        api(a ? "PUT" : "POST", "/v1/admin/apps" + (a ? "/" + encodeURIComponent(a.app_id) : ""), body).then(function (res) {
          if (res.status === 200 || res.status === 201) { reload(); return; }
          if (!reauth(res)) say(box, false, errText(res));
        });
      }
      return card(a ? "編輯登記資料：" + a.app_id : "新增 App", [
        field("app_id", id, "小寫英文、數字、連字號；iOS、Android、網頁共用這一個，建立後不能修改。"),
        field("名稱", name), field("iOS Bundle ID", ios), field("Android 套件名稱", android),
        field("網頁版來源（一行一個）", web, "只填 https://網域，不含路徑。"), field("App 回傳網址（一行一個）", ret),
        field("額外的 Google 用戶端 ID", aud), field("最低版本", min, "低於這個版本的 App 會被要求更新。"),
        el("div", { class: "row" }, [el("label", { text: "權限範圍" }), el("div", { class: "inline" }, [].concat.apply([], checks))]),
        el("div", { class: "inline" }, [el("button", { class: "primary", text: a ? "儲存" : "建立", onclick: save }), el("button", { text: "取消", onclick: reload }), box]),
        a ? el("div", { class: "help", text: "儲存需要 10 分鐘內登入過；會跳到登入頁再回來。" }) : null
      ]);
    }
    function showVal(v) { return typeof v === "string" && (/^(true|false|null|-?\d+(\.\d+)?|".*")$/.test(v) || v !== v.trim()) ? JSON.stringify(v) : (typeof v === "string" ? v : JSON.stringify(v)); }
    function readVal(t) {
      if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(t)) return JSON.parse(t);
      if (/^".*"$/.test(t)) { try { return JSON.parse(t); } catch (e) { return t; } }
      return t;
    }
    function configForm(a) {
      var box = m(), t = el("textarea", { rows: "12", placeholder: "一行一項，例如：\nmaintenance_note = 週日凌晨維護\nshow_banner = true\nmax_items = 20" });
      t.value = Object.keys(a.config || {}).map(function (k) { return k + " = " + showVal(a.config[k]); }).join("\n");
      function save() {
        var cfg = {}, bad = null;
        t.value.split("\n").forEach(function (line, i) {
          if (!line.trim()) return;
          var at = line.indexOf("=");
          if (at < 1) { bad = bad || ("第 " + (i + 1) + " 行要寫成「名稱 = 值」。"); return; }
          cfg[line.slice(0, at).trim()] = readVal(line.slice(at + 1).trim());
        });
        if (bad) { say(box, false, bad); return; }
        api("PUT", "/v1/admin/apps/" + encodeURIComponent(a.app_id) + "/config", { config: cfg }).then(function (res) { if (res.status === 200) reload(); else say(box, false, errText(res)); });
      }
      pane.textContent = "";
      pane.appendChild(card("公開設定：" + a.name, [
        el("p", { class: "help", text: "App 啟動時會讀到這些設定（公開資料，任何人都看得到），所以不可以放密碼、金鑰或任何機密。一行一項，格式「名稱 = 值」；值可以是文字、數字、true／false 或 null；想把 true、123 當成文字，請用雙引號包起來。儲存後 30 秒內生效。" }),
        t,
        el("div", { class: "inline" }, [el("button", { class: "primary", text: "儲存", onclick: save }), el("button", { text: "取消", onclick: reload }), box])
      ]));
    }
    function handoff(a) {
      api("GET", "/v1/admin/apps/" + encodeURIComponent(a.app_id) + "/handoff").then(function (r) {
        if (r.status !== 200) return;
        var box = m(), t = el("textarea", { readonly: true, rows: "18" }); t.value = r.body.text;
        pane.textContent = "";
        pane.appendChild(card("給開發 AI 的串接指令：" + a.name, [
          el("p", { class: "help", text: "版本 " + r.body.version + "｜更新時間 " + r.body.updated + "。整段貼給負責開發這款 App 的 AI；內容只有公開資料，沒有金鑰。更新時請 AI 只補差異，不要整份重做。" }),
          t,
          el("div", { class: "inline" }, [el("button", { class: "primary", text: "複製串接指令", onclick: function () {
            t.select();
            if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(function () { say(box, true, "已複製"); }, function () { say(box, false, "請手動全選複製"); });
            else say(box, false, "請手動全選複製");
          } }), el("button", { text: "返回", onclick: reload }), box])
        ]));
      });
    }
    api("GET", "/v1/admin/apps").then(function (r) {
      var b = r.body, box = m();
      function setStatus(a, st) { return function () {
        if (st === "killed" && !confirm("確定要停用「" + a.name + "」嗎？所有人都會無法登入這款 App。")) return;
        api("PUT", "/v1/admin/apps/" + encodeURIComponent(a.app_id) + "/status", { status: st }).then(function (res) { if (res.status === 200) reload(); else say(box, false, errText(res)); });
      }; }
      var rows = b.apps.map(function (a) {
        var ver = a.integrated_version ? ("App 回報採用版本 " + a.integrated_version + (a.up_to_date ? "（已是最新）" : "（有新版 " + b.handoff_version + "，請把最新串接指令交給開發 AI）")) : "App 尚未回報採用的串接指令版本";
        return el("div", { class: "row" }, [
          el("div", { class: "inline" }, [el("strong", { text: a.name }), el("span", { class: "mono help", text: a.app_id }), el("span", { class: "badge " + (a.status === "active" ? "approved" : a.status === "paused" ? "pending" : "rejected"), text: STATUS[a.status] })]),
          el("div", { class: "help", text: "會員 " + a.members + " 位｜目前登入 " + a.active_sessions + " 個｜最近登入 " + (a.last_sign_in_at ? a.last_sign_in_at.slice(0, 16).replace("T", " ") : "—") + "｜最低版本 " + a.min_version }),
          el("div", { class: "help", text: ver }),
          el("div", { class: "inline" }, [
            el("button", { text: "給開發 AI 的串接指令", onclick: function () { handoff(a); } }),
            b.can_manage ? el("button", { text: "公開設定", onclick: function () { configForm(a); } }) : null,
            b.can_manage ? el("button", { text: "編輯登記資料", onclick: function () { pane.textContent = ""; pane.appendChild(form(b, a)); } }) : null,
            a.status !== "active" ? el("button", { text: "恢復正常", onclick: setStatus(a, "active") }) : null,
            a.status !== "paused" ? el("button", { text: "一鍵暫停", onclick: setStatus(a, "paused") }) : null,
            a.status !== "killed" ? el("button", { class: "danger", text: "停用", onclick: setStatus(a, "killed") }) : null
          ])
        ]);
      });
      pane.appendChild(card("App 管理", [el("p", { class: "help", text: "串接指令最新版本 " + b.handoff_version + "（" + b.handoff_updated + "）。狀態變更 30 秒內生效。App 不能刪除，不再使用時按「停用」。" })]
        .concat(b.invalid.length ? [el("p", { class: "msg bad", text: "登記資料損壞、目前無法使用的 App：" + b.invalid.join("、") })] : [])
        .concat(rows.length ? rows : [el("p", { class: "help", text: "尚未登記任何 App。" })])
        .concat([el("div", { class: "inline" }, [b.can_manage ? el("button", { class: "primary", text: "新增 App", onclick: function () { pane.textContent = ""; pane.appendChild(form(b, null)); } }) : null, box])])));
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
