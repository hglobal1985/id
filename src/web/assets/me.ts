// /assets/me.js — the member's edit page (/me/edit). Built from the field definition APIs (no hard-coded fields,
// labels or options beyond the education rows). textContent only; member input never becomes HTML.
// Every field has a public/hidden switch and an edit button that turns into 「儲存」 while editing.
// Written without template literals so it can live in String.raw. Needs /assets/common.js (window.HG).
export const ME_JS = String.raw`
(function () {
  "use strict";
  var HG = window.HG, el = HG.el, api = HG.api, errText = HG.errText, say = HG.say;
  var root = document.getElementById("app");
  var S = {}, UI = { master: false, doctor: false };

  function msg() { return HG.msg(); }
  function card(title, kids) { return el("section", { class: "card" }, [title ? el("h2", { text: title }) : null].concat(kids)); }
  function fold(title, kids) { return el("details", { class: "card fold" }, [el("summary", { text: title })].concat(kids)); }

  function load() {
    return Promise.all([
      api("GET", "/v1/profile/field-definitions"), api("GET", "/v1/me/profile"),
      api("GET", "/v1/amway/field-definitions"), api("GET", "/v1/me/amway"),
      api("GET", "/v1/me/spouse"), api("GET", "/v1/me/deletion-requests"), api("GET", "/v1/me/sessions")
    ]).then(function (r) {
      if (r[1].status === 401) { location.href = "/login?return_to=%2Fme%2Fedit"; return; }
      S = { defs: r[0].body, profile: r[1].body, adefs: r[2].body, amway: r[3].body, spouse: r[4].body, del: r[5].body, devices: (r[6].body && r[6].body.sessions) || [] };
      S.def = {}; S.defs.fields.forEach(function (d) { S.def[d.key] = d; });
      render();
    });
  }

  // ---- shared bits ----
  function shownName() { var f = S.profile.fields.display_name; return (f && f.value) || ""; }
  function numbers() { return S.profile.fields.member_number.value || []; }
  function isAmway() { return !!S.amway.enabled; }
  function ownPage() { var u = S.profile.fields.member_number.public_url; try { return u ? new URL(u).pathname : "/me"; } catch (e) { return "/me"; } }

  // Public / hidden switch for one or more visibility keys; saves at once.
  function eyeButton(keys, current) {
    var vis = current, b = el("button", { type: "button", class: "eye" });
    function paint() {
      b.textContent = ""; b.className = "eye " + (vis === "public" ? "pub" : "priv");
      b.appendChild(HG.icon(vis === "public" ? "eye" : "eyeoff")); b.appendChild(document.createTextNode(vis === "public" ? "公開" : "隱藏"));
      b.title = vis === "public" ? "目前公開，按一下改為隱藏" : "目前隱藏，按一下改為公開";
    }
    b.addEventListener("click", function () {
      var next = vis === "public" ? "private" : "public", f = {};
      keys.forEach(function (k) { f[k] = next; });
      api("PUT", "/v1/me/profile/visibility", { fields: f }).then(function (r) {
        if (r.status !== 200) { HG.toast(errText(r)); return; }
        vis = next; paint(); HG.toast(next === "public" ? "已改為公開" : "已改為隱藏");
      });
    });
    paint();
    return b;
  }

  // One row: label, public/hidden switch, edit button (becomes 「儲存」 while editing), value or editor.
  // cfg: label, help, note, keys, vis, fixed (text when always public), display(), editor() -> {node,get()}, save(val) -> Promise<res>, reload (full reload after saving)
  function makeRow(cfg) {
    var row = el("div", { class: "row" }), valueBox = el("div"), editing = false, ed = null, m = msg();
    var edit = el("button", { type: "button", class: "small" }), cancel = el("button", { type: "button", class: "small", text: "取消", hidden: true });
    var tools = el("div", { class: "row-tools" });
    function paintBtn() {
      edit.textContent = ""; edit.className = "small" + (editing ? " primary" : "");
      edit.appendChild(HG.icon(editing ? "floppy" : "pencil")); edit.appendChild(document.createTextNode(editing ? "儲存" : "編輯"));
      edit.setAttribute("aria-label", (editing ? "儲存" : "編輯") + cfg.label);
      cancel.hidden = !editing;
    }
    function paintValue() {
      valueBox.textContent = "";
      if (editing) { ed = cfg.editor(); valueBox.appendChild(ed.node); }
      else valueBox.appendChild(cfg.display());
    }
    function stop() { editing = false; ed = null; paintValue(); paintBtn(); if (cfg.onStop) cfg.onStop(); }
    edit.addEventListener("click", function () {
      if (!editing) { editing = true; paintValue(); paintBtn(); m.textContent = ""; return; }
      edit.disabled = true;
      Promise.resolve(cfg.save(ed.get())).then(function (res) {
        edit.disabled = false;
        if (res && res.status === 200) { HG.toast("已儲存"); if (cfg.reload) load(); else { stop(); } }
        else say(m, false, res ? errText(res) : "儲存失敗");
      });
    });
    cancel.addEventListener("click", stop);
    row.appendChild(el("div", { class: "row-head" }, [el("label", { text: cfg.label }), tools]));
    if (cfg.note) row.appendChild(el("div", {}, [el("span", { class: "note", text: cfg.note })]));
    if (cfg.help) row.appendChild(el("div", { class: "help", text: cfg.help }));
    if (cfg.fixed) tools.appendChild(el("span", { class: "fixed", text: cfg.fixed }));
    else if (cfg.keys) tools.appendChild(eyeButton(cfg.keys, cfg.vis));
    if (!cfg.noEdit) { tools.appendChild(cancel); tools.appendChild(edit); }
    row.appendChild(valueBox); row.appendChild(m);
    paintValue(); paintBtn();
    row.refresh = paintValue;
    return row;
  }

  function valueText(t) { return el("p", { class: "value" + (t ? "" : " empty"), text: t || "（未設定）" }); }
  function chipList(list) {
    if (!list || !list.length) return valueText("");
    return el("div", { class: "chips" }, list.map(function (t) { return el("span", { class: "chip", text: t }); }));
  }
  function suggestFetcher(pool) {
    return function (q) { return api("GET", "/v1/vocab/suggestions?pool=" + encodeURIComponent(pool) + "&q=" + encodeURIComponent(q)).then(function (r) { return (r.body && r.body.suggestions) || []; }); };
  }
  function countryFetcher(def) {
    return function (q) {
      var chars = Array.from(q.toLowerCase()).filter(function (c) { return c.trim(); });
      var scored = def.options.map(function (o) {
        var hay = (o.label + " " + o.value).toLowerCase(), s = 0, seen = {};
        chars.forEach(function (c) { if (!seen[c] && hay.indexOf(c) >= 0) { s++; seen[c] = 1; } });
        return { o: o, s: s };
      }).filter(function (x) { return x.s > 0; });
      scored.sort(function (a, b) { return b.s - a.s; });
      return scored.slice(0, 8).map(function (x) { return x.o.label; });
    };
  }

  // ---- profile field rows ----
  function profileField(def) {
    var st = S.profile.fields[def.key] || { value: null, visibility: def.visibility.default };
    function display() {
      var v = S.profile.fields[def.key].value;
      if (def.type === "tags") return chipList(v);
      if (def.type === "select" && def.options) { var f = def.options.filter(function (o) { return o.value === v; })[0]; return valueText(f ? f.label : v); }
      if (def.type === "url" && v) return el("p", { class: "value" }, [el("a", { href: v, target: "_blank", rel: "noopener noreferrer", text: v })]);
      return valueText(v);
    }
    function editor() {
      var v = S.profile.fields[def.key].value, input, node;
      if (def.type === "tags") {
        var t = HG.tags({ value: v || [], max: def.max_items, itemMax: def.item_max_length, label: def.label, fetcher: def.suggest ? suggestFetcher(def.suggest) : null });
        return { node: t.el, get: function () { var a = t.get(); return a.length ? a : null; } };
      }
      if (def.type === "select" && !def.ui) {
        var dd = HG.dropdown({ options: [{ value: "", label: "（未選擇）" }].concat(def.options || []), value: v || "", block: true });
        return { node: dd.el, get: function () { return dd.get() || null; } };
      }
      if (def.type === "textarea") { input = el("textarea", { maxlength: def.max_length, "aria-label": def.label }); input.value = v || ""; return { node: input, get: function () { return input.value.trim() || null; } }; }
      var kind = { url: "url", email: "email", phone: "tel", date: "date" }[def.type] || "text";
      input = el("input", { type: kind, maxlength: def.max_length, "aria-label": def.label });
      if (def.ui === "autocomplete") { var cur = (def.options.filter(function (o) { return o.value === v; })[0] || {}).label; input.value = cur || ""; node = HG.suggestBox(input, countryFetcher(def)); }
      else { input.value = v || ""; node = def.suggest ? HG.suggestBox(input, suggestFetcher(def.suggest)) : input; }
      var kids = [node];
      if (def.key === "motto") {
        var dice = el("button", { type: "button", class: "small", text: "🎲 隨機提案", onclick: function () {
          api("GET", "/v1/profile/suggestions/motto?current=" + encodeURIComponent(input.value)).then(function (r) { if (r.status === 200) { input.value = r.body.motto; input.focus(); } });
        } });
        kids.push(el("div", { class: "actions" }, [dice]));
      }
      return { node: el("div", {}, kids), get: function () { return input.value.trim() || null; } };
    }
    function save(val) {
      return api("PUT", "/v1/me/profile/fields/" + encodeURIComponent(def.key), { value: val }).then(function (r) {
        if (r.status === 200) S.profile.fields[def.key].value = r.body.value;
        return r;
      });
    }
    return makeRow({ label: def.label, help: def.help, keys: [def.key], vis: st.visibility, display: display, editor: editor, save: save, reload: def.key === "birthday" });
  }

  // ---- education: one line per level (school + department) ----
  var LEVELS = [
    { key: "university", label: "大學", school: "university", dept: "university_dept" },
    { key: "master", label: "碩士", school: "grad_school", dept: "grad_dept", after: "university" },
    { key: "doctor", label: "博士", school: "phd_school", dept: "phd_dept", after: "master" }
  ];
  function levelHas(l) { var f = S.profile.fields; return !!(f[l.school].value || f[l.dept].value); }
  function levelShown(l) { return l.key === "university" || levelHas(l) || UI[l.key]; }
  function eduRow(l) {
    var f = S.profile.fields, sd = S.def[l.school], dd = S.def[l.dept];
    var vis = f[l.school].visibility === "public" && f[l.dept].visibility === "public" ? "public" : "private";
    function display() {
      var s = f[l.school].value, d = f[l.dept].value;
      return valueText([s, d].filter(Boolean).join("\u3000"));
    }
    function editor() {
      var si = el("input", { type: "text", maxlength: sd.max_length, placeholder: "校名", "aria-label": l.label + "校名" });
      var di = el("input", { type: "text", maxlength: dd.max_length, placeholder: "系名", "aria-label": l.label + "系名" });
      si.value = f[l.school].value || ""; di.value = f[l.dept].value || "";
      var node = el("div", { class: "edu-line" }, [HG.suggestBox(si, suggestFetcher(sd.suggest)), el("div", { class: "gap" }), HG.suggestBox(di, suggestFetcher(dd.suggest))]);
      return { node: node, get: function () { return { school: si.value.trim() || null, dept: di.value.trim() || null }; } };
    }
    function save(v) {
      return api("PUT", "/v1/me/profile/fields/" + l.school, { value: v.school }).then(function (r1) {
        if (r1.status !== 200) return r1;
        f[l.school].value = r1.body.value;
        return api("PUT", "/v1/me/profile/fields/" + l.dept, { value: v.dept }).then(function (r2) { if (r2.status === 200) f[l.dept].value = r2.body.value; return r2; });
      });
    }
    // A master or doctor line that stays empty disappears again (also when the member cancels).
    function onStop() {
      if (l.key === "university" || levelHas(l)) return;
      UI[l.key] = false;
      if (l.key === "master" && !levelHas(LEVELS[2])) UI.doctor = false;
      render();
    }
    return makeRow({ label: l.label, keys: [l.school, l.dept], vis: vis, display: display, editor: editor, save: save, onStop: onStop });
  }
  function educationCard() {
    var kids = [];
    LEVELS.forEach(function (l, i) {
      if (levelShown(l)) { var r = eduRow(l); kids.push(r); if (UI.justAdded === l.key) { UI.justAdded = null; var b = r.querySelector(".row-tools button:last-child"); if (b) setTimeout(function () { b.click(); }, 0); } }
      var next = LEVELS[i + 1];
      if (next && levelShown(l) && !levelShown(next)) {
        kids.push(el("div", { class: "actions" }, [el("button", { type: "button", class: "small", onclick: function () { UI[next.key] = true; UI.justAdded = next.key; render(); } }, [HG.icon("plus"), document.createTextNode("新增" + next.label + "學歷")])]));
      }
    });
    return card("學歷", kids);
  }

  // ---- avatar ----
  function squareJpeg(file, done) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas"); c.width = 256; c.height = 256;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      var q = 0.88;
      (function attempt() { c.toBlob(function (b) { if (b && b.size > 120 * 1024 && q > 0.4) { q -= 0.12; attempt(); } else done(b); }, "image/jpeg", q); })();
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(null); };
    img.src = url;
  }
  function avatarBlock() {
    var p = S.profile, m = msg(), file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "選擇圖片" });
    function act(method, path) { return function () { api(method, path).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); }); }; }
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; if (!f) return;
      say(m, true, "上傳中…");
      squareJpeg(f, function (blob) {
        if (!blob) { say(m, false, "這個檔案無法讀取，請換一張圖片"); return; }
        api("POST", "/v1/me/profile/avatar", undefined, { type: "image/jpeg", data: blob }).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
      });
    });
    var nums = numbers(), first = nums[0] ? nums[0].number : "";
    return el("section", { class: "card" }, [
      el("div", { class: "hero" }, [HG.bubble("lg", p.avatar.url, shownName()), el("div", {}, [el("h1", { text: shownName() || "我的帳號" }), el("div", { class: "sub" }, [el("span", { class: "help", text: "會員" }), first ? el("span", { class: "badge num", text: first }) : null])])]),
      el("div", { class: "actions" }, [
        el("button", { type: "button", class: "small", text: "上傳圖片", onclick: function () { file.click(); } }),
        el("button", { type: "button", class: "small", text: "使用 Google 頭像", onclick: act("POST", "/v1/me/profile/avatar/google") }),
        p.avatar.url ? el("button", { type: "button", class: "small danger", text: "移除頭像", onclick: act("DELETE", "/v1/me/profile/avatar") }) : null, file
      ]),
      el("div", { class: "help" }, ["頭像一律公開。"]), m
    ]);
  }

  // ---- member number (same logic as starry.phd: random, <country><0 + 6 digits>; Amway members may change it) ----
  function numberRow() {
    var f = S.profile.fields.member_number, def = S.def.member_number, canEdit = isAmway();
    var note = canEdit ? def.help_when_amway : def.help_when_not_amway;
    function display() {
      var list = numbers();
      return el("div", {}, [el("div", { class: "chips" }, list.map(function (e, i) { return el("span", { class: "badge num", text: e.country + " " + e.number + (i === 0 ? "（預設）" : "") }); })),
        f.public_url ? el("div", { class: "help" }, ["公開網址：", el("a", { href: f.public_url, text: f.public_url })]) : null]);
    }
    var cands = el("div");
    function editor() {
      var list = el("div"), max = f.max_items || 1;
      function addRow(e) {
        var dd = HG.dropdown({ options: def.options, value: e.country, searchable: true });
        var num = el("input", { type: "text", maxlength: 20, "aria-label": "會員編號", placeholder: "編號" }); num.value = e.number;
        var row = el("div", { class: "num-line" }, [dd.el, num, list.children.length >= 0 && max > 1 ? el("button", { type: "button", class: "small", text: "移除", onclick: function () { row.remove(); } }) : null]);
        row.getValue = function () { return { country: dd.get(), number: num.value }; };
        list.appendChild(row);
      }
      numbers().forEach(addRow);
      var more = max > 1 ? el("div", { class: "actions" }, [el("button", { type: "button", class: "small", onclick: function () { if (list.children.length < max) addRow({ country: (numbers()[0] || {}).country || "TW", number: "" }); } }, [HG.icon("plus"), document.createTextNode("新增一組")])]) : null;
      return { node: el("div", {}, [el("div", { class: "help", text: def.help }), list, more]), get: function () { return Array.prototype.map.call(list.children, function (r) { return r.getValue(); }); } };
    }
    function save(v) {
      return api("PUT", "/v1/me/profile/fields/member_number", { value: v }).then(function (r) {
        cands.textContent = "";
        if (r.status !== 200) return r;
        S.profile.fields.member_number.value = r.body.value;
        var dups = r.body.duplicate_candidates || [];
        if (dups.length) {
          dups.forEach(function (c) {
            cands.appendChild(el("div", { class: "banner" }, [
              el("div", { class: "hero" }, [HG.bubble("md", c.avatar_url, c.display_name), el("p", { text: "此編號與「" + (c.display_name || "一位會員") + "」" + (c.rank ? "（" + c.rank + "）" : "") + "相同。是否與此會員綁定為夫妻？" })]),
              el("button", { type: "button", class: "primary", text: "綁定為夫妻", onclick: function () { api("POST", "/v1/me/spouse", { candidate_id: c.candidate_id }).then(function (b) { if (b.status === 200) load(); else HG.toast(errText(b)); }); } })]));
          });
          return { status: 0, body: { error: { message: "已儲存；請看下方的夫妻綁定提示" } } };
        }
        return r;
      });
    }
    var row = makeRow({ label: f.label, note: note, fixed: "一律公開", display: display, editor: editor, save: save, noEdit: !canEdit, reload: true });
    row.appendChild(cands);
    return row;
  }

  // ---- Amway block: the switch takes effect at once (no confirmation, no consent step) ----
  function amwayFieldRow(d) {
    var st = S.amway.fields[d.key] || { value: null, pending_value: null, status: "not_required", visibility: "private" };
    var opts = d.options || [];
    function label(v) { var f = opts.filter(function (o) { return o.value === v; })[0]; return f ? f.label : v; }
    function display() {
      var kids = [valueText(st.value === null ? "" : (d.type === "select" ? label(st.value) : st.value))];
      if (st.pending_value !== null && st.pending_value !== undefined) kids.push(el("p", {}, [el("span", { class: "badge pending", text: d.status_labels.pending }), document.createTextNode(" " + (d.type === "select" ? label(st.pending_value) : st.pending_value))]));
      else if (st.status === "approved" && d.status_labels.approved) kids.push(el("span", { class: "badge approved", text: d.status_labels.approved }));
      else if (st.status === "rejected") kids.push(el("span", { class: "badge rejected", text: d.status_labels.rejected }));
      return el("div", {}, kids);
    }
    function editor() {
      var cur = st.pending_value !== null && st.pending_value !== undefined ? st.pending_value : st.value;
      if (d.type === "select") {
        var dd = HG.dropdown({ options: [{ value: "", label: "（未選擇）" }].concat(opts), value: cur || "", block: true });
        return { node: dd.el, get: function () { return dd.get() || null; } };
      }
      var input = el("input", { type: "text", maxlength: d.max_length, "aria-label": d.label }); input.value = cur || "";
      // The regional center offers its own related words only while the training system means H-Global1985.
      var useSuggest = d.suggest && (!d.suggest_when_hglobal || S.amway.hglobal);
      return { node: useSuggest ? HG.suggestBox(input, suggestFetcher(d.suggest)) : input, get: function () { return input.value.trim() || null; } };
    }
    function save(v) { return api("PUT", "/v1/me/amway/fields/" + d.key, { value: v }); }
    return makeRow({ label: d.label, keys: [d.key], vis: st.visibility, display: display, editor: editor, save: save, reload: true });
  }
  function amwayCard() {
    var m = msg();
    var box = HG.checkbox("我是Amway會員", isAmway(), function (on) {
      api("PUT", "/v1/me/amway/enabled", { enabled: on }).then(function (r) { if (r.status === 200) load(); else { say(m, false, errText(r)); box.setChecked(!on); } });
    });
    var kids = [box, m];
    // The member number and the Amway fields in the order the administrator set; the number is always there.
    var items = [{ order: S.def.member_number.order, make: numberRow }];
    if (isAmway()) S.adefs.fields.forEach(function (d) { items.push({ order: d.order, make: function () { return amwayFieldRow(d); } }); });
    items.sort(function (a, b) { return a.order - b.order; }).forEach(function (it) { kids.push(it.make()); });
    return el("section", { class: "card" }, kids);
  }

  // ---- life number chart (same drawing data as the starry.phd member center) ----
  var CHART_ROWS = [[1, 4, 7], [2, 5, 8], [3, 6, 9]];
  function cell(n, r) {
    var rings = [], i;
    for (i = 0; i < r.black; i++) rings.push("rg-black");
    if (r.birthday) rings.push("rg-birthday");
    if (r.zodiac) rings.push("rg-zodiac");
    for (i = 0; i < r.talent; i++) rings.push("rg-talent");
    if (!rings.length && !r.life) return el("td", { class: "ln-cell ln-empty" }, [el("span", { class: "ln-n", text: String(n) })]);
    var inner = el("span", { class: "ln-n" + (rings.length ? "" : " ln-red"), text: String(n) });
    rings.forEach(function (c) { inner = el("span", { class: "ln-ring " + c }, [inner]); });
    if (r.life) {
      var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      s.setAttribute("viewBox", "0 0 100 90"); s.setAttribute("preserveAspectRatio", "none"); s.setAttribute("aria-hidden", "true");
      s.innerHTML = '<polygon points="50,5 96,85 4,85" fill="none" stroke="#e5303a" stroke-width="5" stroke-linejoin="round"/>';
      inner = el("span", { class: "ln-tri" }, [s, inner]);
    }
    return el("td", { class: "ln-cell" }, [inner]);
  }
  function chartCard() {
    var c = S.profile.life_chart; if (!c) return null;
    function item(cls, label, value, badge) { return el("div", { class: "ln-item " + cls }, [el("span", { text: label }), el("span", { class: "ln-badge " + badge, text: String(value) })]); }
    function legend(cls, text) { return el("div", {}, [el("span", { class: "ln-dot " + cls }), el("span", { text: text })]); }
    var rows = CHART_ROWS.map(function (row) { return el("tr", {}, row.map(function (n) { return cell(n, c.rings[n]); })); });
    return el("section", { class: "card" }, [
      el("div", { class: "row-head" }, [el("h2", { text: "生命靈數" }), el("div", { class: "row-tools" }, [eyeButton(["derived"], S.profile.derived.visibility)])]),
      el("div", { class: "ln-card" }, [
        el("div", { class: "ln-head" }, [item("z", "星座：" + c.zodiac_name, c.zodiac_number, "ln-b-zodiac"), item("b", "生日數：", c.birthday_number, "ln-b-birthday"), item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent"), item("l", "加總命數：", c.life_number, "ln-b-life")]),
        el("table", { class: "ln-grid", "aria-label": "彩色九宮格" }, rows),
        el("div", { class: "ln-legend" }, [
          legend("rg-black", "先天數生日數字（黑色線圈，出現幾次畫幾圈）"), legend("rg-birthday", "生日數（黃色圈線，出生日期相加至個位數）"), legend("rg-zodiac", "星座數（紫色圈線）"), legend("rg-talent", "天賦數（亮綠圈線）"),
          el("div", {}, [el("span", { class: "ln-dot-tri", text: "▲" }), el("span", { text: "加總命數（紅色三角形包圍數字）" })])])
      ])
    ]);
  }

  // ---- spouse, devices, deletion ----
  function spouseCard() {
    var s = S.spouse.spouse, m = msg();
    if (!s) return null;
    return card("夫妻綁定", [el("p", { text: "已與「" + (s.display_name || "會員") + "」綁定" + (s.rank ? "，共用獎銜：" + s.rank : "") + "。" }),
      el("button", { type: "button", class: "danger", text: "解除綁定", onclick: function () {
        if (!confirm("確定要解除夫妻綁定嗎？")) return;
        api("DELETE", "/v1/me/spouse").then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
      } }), m]);
  }
  function devicesCard() {
    var m = msg();
    var rows = S.devices.map(function (d) {
      return el("tr", {}, [el("td", { text: d.app_name }), el("td", { text: d.device_label || "—" }), el("td", { text: d.last_used_at.slice(0, 16).replace("T", " ") }),
        el("td", {}, [d.current ? el("span", { class: "badge", text: "此瀏覽器" }) : el("button", { type: "button", class: "small", text: "登出", onclick: function () {
          api("POST", "/v1/me/sessions/" + encodeURIComponent(d.id) + "/revoke").then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
        } })])]);
    });
    return fold("登入紀錄", [
      el("div", { class: "tablewrap" }, [el("table", {}, [el("tr", {}, [el("th", { text: "App" }), el("th", { text: "裝置" }), el("th", { text: "最後使用" }), el("th")])].concat(rows))]),
      el("div", { class: "actions" }, [el("button", { type: "button", class: "danger", text: "登出所有裝置", onclick: function () {
        if (!confirm("會登出所有裝置與所有 App（包含這個瀏覽器）。確定嗎？")) return;
        api("POST", "/v1/me/logout-all").then(function (r) { if (r.status === 200) location.href = "/"; else say(m, false, errText(r)); });
      } }), m])
    ]);
  }
  function deletionCard() {
    var m = msg();
    return fold("刪除帳號", [
      el("p", { class: "help", text: "按下後立即生效：您的資料會被移除、所有裝置登出，無法復原。為避免他人冒用，需要先重新登入確認。" }),
      el("div", { class: "actions" }, [el("button", { type: "button", class: "danger", text: "刪除帳號", onclick: function () {
        if (!confirm("確定要立即刪除帳號嗎？刪除後無法復原。")) return;
        api("POST", "/v1/me/delete-account").then(function (r) {
          if (r.status === 200) { location.href = "/"; return; }
          if (r.body && r.body.error && r.body.error.code === "reauth_required") { location.href = r.body.error.details.login_url; return; }
          say(m, false, errText(r));
        });
      } })]), m]);
  }

  function render() {
    root.textContent = "";
    root.appendChild(el("div", { class: "pagebar" }, [el("a", { class: "button small", href: ownPage(), text: "← 回到我的頁面" })]));
    function basicCard() { return card("基本資料", S.defs.fields.filter(function (d) { return d.group === "basic"; }).sort(function (a, b) { return a.order - b.order; }).map(profileField)); }
    function contactCard() {
      var contact = S.defs.fields.filter(function (d) { return d.group === "contact"; }).sort(function (a, b) { return a.order - b.order; });
      return card("聯絡與地區", [el("p", { class: "help", text: "這個區塊預設全部隱藏，想公開哪一項請按該項的「隱藏」切換。" })].concat(contact.map(profileField)));
    }
    var makers = { avatar: avatarBlock, amway: amwayCard, basic: basicCard, education: educationCard, contact: contactCard, birthday: function () { return card("生日", [profileField(S.def.birthday)]); }, life: chartCard };
    (S.defs.blocks || []).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (blk) {
      var make = makers[blk.key], node = make ? make() : null; if (node) root.appendChild(node);
    });
    var sp = spouseCard(); if (sp) root.appendChild(sp);
    root.appendChild(devicesCard());
    root.appendChild(deletionCard());
    root.appendChild(el("div", { class: "actions" }, [
      el("a", { class: "button", href: "/v1/me/export", download: "my-data.json", text: "下載我的資料" }),
      el("a", { class: "button", href: "/logout", text: "登出" })
    ]));
  }
  load();
})();
`;
