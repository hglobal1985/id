// /assets/me.js — the member's 基本資料 page. Built entirely from the field definition APIs (no hard-coded
// fields, labels or options). Uses textContent only (no innerHTML with data), so member input cannot inject HTML.
// Written without template literals so it can live in a String.raw block.
export const ME_JS = String.raw`
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
    return fetch(path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        return { status: r.status, body: j };
      });
    });
  }
  function errText(res) {
    if (res.status === 501) return "目前不提供";
    if (res.body && res.body.error) {
      if (res.body.error.code === "reauth_required") return "為了確認是您本人，請先重新登入。";
      if (res.body.error.code === "rate_limited") return "修改太頻繁，請稍後再試。";
      if (res.body.error.code === "consent_required") return "請先勾選並同意說明。";
      return res.body.error.message || "儲存失敗";
    }
    return "發生錯誤，請稍後再試";
  }
  function msg() { return el("div", { class: "msg" }); }
  function say(m, ok, text) { m.className = "msg " + (ok ? "ok" : "bad"); m.textContent = text; }
  function card(title, kids) { return el("section", { class: "card" }, [el("h2", { text: title })].concat(kids)); }

  var S = {};
  function load() {
    return Promise.all([
      api("GET", "/v1/profile/field-definitions"), api("GET", "/v1/me/profile"),
      api("GET", "/v1/amway/field-definitions"), api("GET", "/v1/me/amway"), api("GET", "/v1/amway/consent"),
      api("GET", "/v1/me/spouse"), api("GET", "/v1/me/notifications"), api("GET", "/v1/me/deletion-requests")
    ]).then(function (r) {
      if (r[1].status === 401) { location.href = "/login?return_to=%2Fme"; return; }
      S = { defs: r[0].body, profile: r[1].body, adefs: r[2].body, amway: r[3].body, consent: r[4].body, spouse: r[5].body, notes: r[6].body, del: r[7].body };
      render();
    });
  }

  function input(def, value) {
    var t = def.type, i;
    if (t === "textarea") { i = el("textarea", { maxlength: def.max_length }); i.value = value || ""; return i; }
    if (t === "select") {
      i = el("select", {}, [el("option", { value: "", text: "（未選擇）" })].concat((def.options || []).map(function (o) { return el("option", { value: o.value, text: o.label }); })));
      i.value = value || ""; return i;
    }
    if (t === "tags") { i = el("input", { type: "text", placeholder: "以逗號分隔" }); i.value = (value || []).join("、"); i.dataset.tags = "1"; return i; }
    var map = { text: "text", url: "url", email: "email", phone: "tel", date: "date" };
    if (!map[t]) return null;
    i = el("input", { type: map[t], maxlength: def.max_length }); i.value = value || ""; return i;
  }
  function readInput(i) {
    if (i.dataset.tags) return i.value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
    return i.value === "" ? null : i.value;
  }

  function fieldRow(def, state) {
    var box = el("div", { class: "row" }, [el("label", { text: def.label })]);
    if (def.help) box.appendChild(el("div", { class: "help", text: def.help }));
    var i = input(def, state ? state.value : null);
    if (!i) { box.appendChild(el("div", { class: "help", text: "請更新 app" })); return box; }
    var m = msg();
    var vis = el("select", {}, [el("option", { value: "public", text: "公開" }), el("option", { value: "private", text: "不公開" })]);
    vis.value = state ? state.visibility : def.visibility.default;
    vis.addEventListener("change", function () {
      var f = {}; f[def.key] = vis.value;
      api("PUT", "/v1/me/profile/visibility", { fields: f }).then(function (r) { say(m, r.status === 200, r.status === 200 ? "已更新公開設定" : errText(r)); });
    });
    var save = el("button", { class: "primary", text: "儲存", onclick: function () {
      api("PUT", "/v1/me/profile/fields/" + encodeURIComponent(def.key), { value: readInput(i) }).then(function (r) { say(m, r.status === 200, r.status === 200 ? "已儲存" : errText(r)); });
    } });
    box.appendChild(i);
    box.appendChild(el("div", { class: "inline" }, [save, def.visibility.configurable ? vis : null, m]));
    return box;
  }

  function avatarCard() {
    var p = S.profile, m = msg();
    var img = p.avatar.url ? el("img", { class: "avatar", src: p.avatar.url, alt: "頭像" }) : el("div", { class: "avatar" });
    function act(method, path) { return function () { api(method, path).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); }); }; }
    return card("頭像", [img, el("p", { class: "help", text: "頭像永遠公開。" }), el("div", { class: "inline" }, [
      el("button", { text: "上傳並裁切", onclick: function () { say(m, false, "目前不提供"); } }),
      el("button", { text: "使用我的 Google 頭像", onclick: act("POST", "/v1/me/profile/avatar/google") }),
      el("button", { class: "danger", text: "移除頭像", onclick: act("DELETE", "/v1/me/profile/avatar") }), m])]);
  }

  function numberCard() {
    var f = S.profile.fields.member_number, m = msg(), list = el("div");
    var countries = (S.defs.fields.filter(function (d) { return d.key === "country"; })[0] || {}).options || [];
    function addRow(e) {
      var sel = el("select", {}, countries.map(function (o) { return el("option", { value: o.value, text: o.label }); }));
      sel.value = e.country; var num = el("input", { type: "text", maxlength: 20 }); num.value = e.number;
      var row = el("div", { class: "inline" }, [sel, num, el("button", { text: "移除", onclick: function () { row.remove(); } })]);
      list.appendChild(row);
    }
    f.value.forEach(addRow);
    var cands = el("div");
    var save = el("button", { class: "primary", text: "儲存編號", onclick: function () {
      var v = Array.prototype.map.call(list.children, function (r) { return { country: r.children[0].value, number: r.children[1].value }; });
      api("PUT", "/v1/me/profile/fields/member_number", { value: v }).then(function (r) {
        if (r.status !== 200) return say(m, false, errText(r));
        say(m, true, "已儲存");
        cands.textContent = "";
        (r.body.duplicate_candidates || []).forEach(function (c) {
          cands.appendChild(el("div", { class: "card" }, [
            c.avatar_url ? el("img", { class: "avatar", src: c.avatar_url, alt: "" }) : null,
            el("p", { text: "此編號與「" + (c.display_name || "一位會員") + "」" + (c.rank ? "（" + c.rank + "）" : "") + "相同。是否與此會員綁定為夫妻？" }),
            el("button", { class: "primary", text: "綁定為夫妻", onclick: function () {
              api("POST", "/v1/me/spouse", { candidate_id: c.candidate_id }).then(function (b) { if (b.status === 200) load(); else say(m, false, errText(b)); });
            } })]));
        });
      });
    } });
    return card(f.label, [
      el("p", { class: "help", text: "第一組為預設編號，用於公開網址與客服查詢。修改後舊網址會失效。" }),
      f.public_url ? el("p", {}, ["公開網址：", el("a", { href: f.public_url, text: f.public_url })]) : null,
      list,
      f.max_items > 1 ? el("button", { text: "新增一組", onclick: function () { if (list.children.length < f.max_items) addRow({ country: "TW", number: "" }); } }) : null,
      el("div", { class: "inline" }, [save, m]), cands,
      el("details", {}, [el("summary", { text: "會員識別碼" }), el("p", { class: "mono", text: S.profile.member_id })])
    ]);
  }

  function infoCard() {
    var i = S.profile.info;
    return card("帳號資訊", [el("ul", { class: "plain" }, [
      el("li", { text: "註冊國家：" + i.registration_country }),
      el("li", { text: "星座：" + (i.zodiac || "—") }),
      el("li", { text: "生命靈數：" + (i.life_path_number === null ? "—" : i.life_path_number) })])]);
  }

  function amwayCard() {
    var a = S.amway, c = S.consent, m = msg();
    var box = card(S.adefs.enabled_label, []);
    var check = el("input", { type: "checkbox", id: "amw" }); check.checked = a.enabled;
    box.appendChild(el("div", { class: "inline" }, [check, el("label", { for: "amw", text: S.adefs.enabled_label })]));
    var consentBox = el("div");
    function showConsent() {
      consentBox.textContent = "";
      var agree = el("input", { type: "checkbox", id: "agree" });
      consentBox.appendChild(el("div", { class: "card" }, [el("h2", { text: c.title }), el("p", { text: c.intro }),
        el("ul", { class: "plain" }, c.items.map(function (t) { return el("li", { text: t }); })),
        el("div", { class: "inline" }, [agree, el("label", { for: "agree", text: c.checkbox_label })]),
        el("p", {}, [el("a", { href: c.full_privacy_url, target: "_blank", rel: "noopener", text: c.full_privacy_label })]),
        el("button", { class: "primary", text: "儲存", onclick: function () {
          if (!agree.checked) return say(m, false, "請先勾選「" + c.checkbox_label + "」");
          api("PUT", "/v1/me/amway/enabled", { enabled: true, consent_version: c.version }).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
        } })]));
    }
    check.addEventListener("change", function () {
      if (check.checked) { showConsent(); return; }
      if (!confirm("取消勾選後，相關資格會暫停（資料會保留）。確定嗎？")) { check.checked = true; return; }
      api("PUT", "/v1/me/amway/enabled", { enabled: false }).then(function () { load(); });
    });
    box.appendChild(consentBox);
    if (a.enabled && a.consent && !a.consent.current) showConsent();
    if (a.enabled) {
      var sysState = a.fields.education_system;
      var sys = (sysState.pending_value || sysState.value || {}).option;
      S.adefs.fields.forEach(function (d) {
        if (d.visible_when && sys !== d.visible_when.equals) return;
        var st = a.fields[d.key], row = el("div", { class: "row" }, [el("label", { text: d.label })]), fm = msg(), i, custom = null;
        if (d.type === "text") { i = el("input", { type: "text", maxlength: d.max_length }); i.value = st.value || ""; }
        else if (d.type === "select" || d.type === "select_or_custom") {
          i = el("select", {}, [el("option", { value: "", text: "（未選擇）" })].concat(d.options.map(function (o) { return el("option", { value: o.value, text: o.label }); })));
          var cur = st.pending_value !== null ? st.pending_value : st.value;
          i.value = cur ? (typeof cur === "string" ? cur : cur.option) : "";
          if (d.type === "select_or_custom") {
            custom = el("input", { type: "text", maxlength: d.max_length, placeholder: "請填寫" });
            custom.value = cur && cur.custom_text ? cur.custom_text : "";
            custom.hidden = i.value !== "other";
            i.addEventListener("change", function () { custom.hidden = i.value !== "other"; });
          }
        } else { row.appendChild(el("div", { class: "help", text: "請更新 app" })); box.appendChild(row); return; }
        var label = d.status_labels[st.status];
        row.appendChild(el("div", { class: "inline" }, [i, custom, label ? el("span", { class: "badge " + st.status, text: label }) : null]));
        row.appendChild(el("div", { class: "inline" }, [el("button", { class: "primary", text: "儲存", onclick: function () {
          var v = i.value === "" ? null : (d.type === "select_or_custom" ? { option: i.value, custom_text: i.value === "other" ? custom.value : null } : i.value);
          api("PUT", "/v1/me/amway/fields/" + d.key, { value: v }).then(function (r) { if (r.status === 200) load(); else say(fm, false, errText(r)); });
        } }), fm]));
        box.appendChild(row);
      });
    }
    box.appendChild(m);
    return box;
  }

  function spouseCard() {
    var s = S.spouse.spouse, m = msg();
    if (!s) return null;
    return card("夫妻綁定", [el("p", { text: "已與「" + (s.display_name || "會員") + "」綁定" + (s.rank ? "，共用獎銜：" + s.rank : "") + "。" }),
      el("button", { class: "danger", text: "解除綁定", onclick: function () {
        if (!confirm("確定要解除夫妻綁定嗎？")) return;
        api("DELETE", "/v1/me/spouse").then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
      } }), m]);
  }

  function notesCard() {
    var n = S.notes.notifications;
    if (!n.length) return null;
    return card("通知（未讀 " + S.notes.unread + "）", n.map(function (x) {
      return el("div", { class: "row" }, [el("strong", { text: x.title + (x.read ? "" : "（未讀）") }), el("div", { text: x.body }),
        el("div", { class: "inline" }, [
          x.actions.indexOf("unbind_spouse") >= 0 ? el("button", { class: "danger", text: "一鍵解除", onclick: function () { api("DELETE", "/v1/me/spouse").then(load); } }) : null,
          x.read ? null : el("button", { text: "標示已讀", onclick: function () { api("POST", "/v1/me/notifications/" + x.id + "/read").then(load); } })])]);
    }));
  }

  function deletionCard() {
    var m = msg(), open = S.del.requests.filter(function (r) { return r.status === "requested"; });
    function ask(scope, text) { return el("button", { class: "danger", text: text, onclick: function () {
      if (!confirm("送出後，管理人員會在 " + S.del.processing_days + " 日內處理。確定送出嗎？")) return;
      api("POST", "/v1/me/deletion-requests", { scope: scope }).then(function (r) {
        if (r.status === 200) return load();
        if (r.body && r.body.error && r.body.error.code === "reauth_required") { location.href = r.body.error.details.login_url; return; }
        say(m, false, errText(r));
      });
    } }); }
    return card("資料刪除", [el("p", { class: "help", text: "為避免他人冒用，送出前需要重新登入確認。" }),
      open.map(function (r) { return el("div", { class: "inline" }, [el("span", { text: (r.scope === "account" ? "刪除帳號" : "刪除 Amway 資料") + "：處理中，預計 " + r.due_at.slice(0, 10) + " 前完成" }),
        el("button", { text: "取消申請", onclick: function () { api("POST", "/v1/me/deletion-requests/" + r.id + "/cancel").then(load); } })]); }),
      el("div", { class: "inline" }, [ask("amway", "申請刪除 Amway 資料"), ask("account", "申請刪除帳號"), m])].flat());
  }

  function render() {
    root.textContent = "";
    root.appendChild(avatarCard());
    root.appendChild(numberCard());
    var groups = S.defs.groups.slice().sort(function (a, b) { return a.order - b.order; });
    groups.forEach(function (g) {
      var defs = S.defs.fields.filter(function (d) { return d.group === g.key && d.key !== "member_number"; }).sort(function (a, b) { return a.order - b.order; });
      if (!defs.length) return;
      root.appendChild(card(g.label, defs.map(function (d) { return fieldRow(d, S.profile.fields[d.key]); })));
    });
    root.appendChild(infoCard());
    root.appendChild(amwayCard());
    var sp = spouseCard(); if (sp) root.appendChild(sp);
    var nc = notesCard(); if (nc) root.appendChild(nc);
    root.appendChild(deletionCard());
  }
  load();
})();
`;
