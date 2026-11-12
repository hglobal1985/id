// /assets/me.js — the member's edit page (/my/edit). Built from the field definition APIs (no hard-coded fields,
// labels or options beyond the education rows). textContent only; member input never becomes HTML.
// Every field has a public/hidden switch and is always in editing state: no edit or save buttons, every change is saved by itself.
// Written without template literals so it can live in String.raw. Needs /assets/common.js (window.HG).
export const ME_JS = String.raw`
(function () {
  "use strict";
  var HG = window.HG, el = HG.el, api = HG.api, errText = HG.errText, say = HG.say;
  var root = document.getElementById("app");
  var S = {}, UI = { master: false, doctor: false };

  function msg() { return HG.msg(); }
  function card(title, kids, titleClass) { return el("section", { class: "card" }, [title ? el("h2", { text: title, class: titleClass || "" }) : null].concat(kids)); }
  function fold(title, kids) { return el("details", { class: "card fold" }, [el("summary", { text: title })].concat(kids)); }

  function load() {
    return Promise.all([
      api("GET", "/v1/profile/field-definitions"), api("GET", "/v1/me/profile"),
      api("GET", "/v1/amway/field-definitions"), api("GET", "/v1/me/amway"),
      api("GET", "/v1/me/spouse"), api("GET", "/v1/me/sessions"), api("GET", "/v1/me/social-links"), api("GET", "/v1/social/platforms"), api("GET", "/v1/me/search-indexing")
    ]).then(function (r) {
      if (r[1].status === 401) { location.href = "/login?return_to=%2Fmy%2Fedit"; return; }
      S = { defs: r[0].body, profile: r[1].body, adefs: r[2].body, amway: r[3].body, spouse: r[4].body, devices: (r[5].body && r[5].body.sessions) || [], social: (r[6].body && r[6].body.links) || [], platforms: (r[7].body && r[7].body.platforms) || [], indexing: !!(r[8].body && r[8].body.allowed) };
      S.def = {}; S.defs.fields.forEach(function (d) { S.def[d.key] = d; });
      render();
    });
  }

  // ---- shared bits ----
  function shownName() { var f = S.profile.fields.display_name; return (f && f.value) || ""; }
  function numbers() { return S.profile.fields.member_number.value || []; }
  function isAmway() { return !!S.amway.enabled; }
  function publicPath() { var u = S.profile.fields.member_number.public_url; try { return u ? new URL(u).pathname : "/"; } catch (e) { return "/"; } }
  function ownPage() { var u = S.profile.fields.member_number.public_url; try { return u ? "/my" + new URL(u).pathname : "/my"; } catch (e) { return "/my"; } }

  // Public / hidden switch for one or more visibility keys; saves at once.
  function eyeButton(keys, current) {
    var vis = current, b = el("button", { type: "button", class: "eye" });
    function paint() {
      b.textContent = ""; b.className = "eye " + (vis === "public" ? "pub" : "priv");
      b.appendChild(HG.icon(vis === "public" ? "eye" : "eyeoff")); b.appendChild(document.createTextNode(vis === "public" ? "公開" : "隱藏"));
      b.title = vis === "public" ? "目前公開，按一下改為隱藏（隱藏＝不在公開頁顯示，寰宇生態系內的服務仍可能使用）" : "目前隱藏（不在公開頁顯示，寰宇生態系內的服務仍可能使用），按一下改為公開";
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

  // One row: label, public/hidden switch and the editor, always open. Every change saves by itself (no edit or save button):
  // dropdowns, ticks and chips right away, plain text after a short pause, text with related words / countries / numbers when the
  // box is left or a suggestion is picked (so half-typed words never reach the vocabulary or burn the member-number quota).
  // cfg: label, help, note, keys, vis, forced (always public), editor() -> {node, get(), typing?, watch?}, valid(val) -> bool,
  // save(val) -> Promise<res>, after(val, res) (no re-render of this row), status() -> node shown under the editor,
  // noEdit + display() (read-only), below() -> node under the row
  function makeRow(cfg) {
    var row = el("div", { class: "row" }), valueBox = el("div"), m = msg(), tools = el("div", { class: "row-tools" });
    var saved = el("span", { class: "saved", "aria-live": "polite" }), statusBox = el("div"), ed = null, last = "", timer = null, busy = false, again = false, fade = null;
    function key(v) { return JSON.stringify(v); }
    function paintStatus() { statusBox.textContent = ""; if (cfg.status) { var n = cfg.status(); if (n) statusBox.appendChild(n); } }
    function mark(text, ok) { saved.textContent = text; saved.className = "saved" + (ok ? " ok" : ""); clearTimeout(fade); if (ok) fade = setTimeout(function () { saved.textContent = ""; }, 2500); }
    function flush() {
      clearTimeout(timer);
      if (!ed) return;
      var v = ed.get();
      if (key(v) === last || (cfg.valid && !cfg.valid(v))) return;
      if (busy) { again = true; return; }
      busy = true; mark("儲存中…", false); m.textContent = "";
      Promise.resolve(cfg.save(v)).then(function (res) {
        busy = false;
        if (res && res.status === 200) { last = key(v); mark("已儲存", true); if (cfg.after) cfg.after(v, res); paintStatus(); }
        else { mark("", false); say(m, false, res ? errText(res) : "儲存失敗"); }
        if (again) { again = false; flush(); }
      });
    }
    function later(ms) { clearTimeout(timer); timer = setTimeout(flush, ms); }
    row.appendChild(el("div", { class: "row-head" }, [el("label", { text: cfg.label }), saved, tools]));
    if (cfg.note) row.appendChild(el("div", {}, [el("span", { class: "note", text: cfg.note })]));
    if (cfg.help) row.appendChild(el("div", { class: "help", text: cfg.help }));
    if (cfg.forced) tools.appendChild(lockedPill());
    else if (cfg.keys) tools.appendChild(eyeButton(cfg.keys, cfg.vis));
    row.appendChild(valueBox);
    if (cfg.noEdit) valueBox.appendChild(cfg.display());
    else {
      ed = cfg.editor(); valueBox.appendChild(ed.node); last = key(ed.get());
      var watch = ed.watch === undefined ? valueBox : ed.watch;
      if (watch && window.MutationObserver) new MutationObserver(function () { later(350); }).observe(watch, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-checked"] });
      if (ed.typing !== false) valueBox.addEventListener("input", function () { later(900); });
      valueBox.addEventListener("change", function () { later(200); });
      valueBox.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".sg-list, .dd-list")) later(250); });
      valueBox.addEventListener("focusout", function () { setTimeout(flush, 180); });
    }
    row.appendChild(statusBox); row.appendChild(m);
    if (cfg.below) row.appendChild(cfg.below());
    paintStatus();
    row.flush = flush; row.refreshStatus = paintStatus;
    return row;
  }

  function pid(e) { return e.number.indexOf(e.country) === 0 ? e.number : e.country + e.number; }
  // Fields that are always public look like the others (rounded box, eye, 公開) but have no switch.
  function lockedPill() { var b = el("span", { class: "eye pub locked", title: "這個欄位一律公開" }); b.appendChild(HG.icon("eye")); b.appendChild(document.createTextNode("公開")); return b; }
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
        // Only the chips are watched and typing does not save: leaving the box (or a separator) turns the text into a chip first.
        return { node: t.el, typing: false, watch: t.el.querySelector(".chips-in"), get: function () { var a = t.get(); return a.length ? a : null; } };
      }
      if (def.type === "select" && !def.ui) {
        var dd = HG.dropdown({ options: [{ value: "", label: "（未選擇）" }].concat(def.options || []), value: v || "", block: true });
        return { node: dd.el, get: function () { return dd.get() || null; } };
      }
      if (def.type === "textarea") { input = el("textarea", { maxlength: def.max_length, "aria-label": def.label }); input.value = v || ""; return { node: input, get: function () { return input.value.trim() || null; } }; }
      if (def.type === "date") {
        // Year / month / day in three separate drop-downs (no calendar); the month shows the number and the English short name.
        var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        function pad(n) { return n < 10 ? "0" + n : String(n); }
        var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "") || [];
        var yOpts = [{ value: "", label: "年" }], mOpts = [{ value: "", label: "月" }], dOpts = [{ value: "", label: "日" }], i;
        for (i = new Date().getFullYear(); i >= 1900; i--) yOpts.push({ value: String(i), label: String(i) });
        MON.forEach(function (n, k) { mOpts.push({ value: pad(k + 1), label: (k + 1) + " " + n }); });
        for (i = 1; i <= 31; i++) dOpts.push({ value: pad(i), label: String(i) });
        var yy = HG.dropdown({ options: yOpts, value: parts[1] || "", searchable: true, placeholder: "年" });
        var mm = HG.dropdown({ options: mOpts, value: parts[2] || "", placeholder: "月" });
        var dd3 = HG.dropdown({ options: dOpts, value: parts[3] || "", placeholder: "日" });
        return { node: el("div", { class: "dateparts" }, [yy.el, mm.el, dd3.el]), get: function () {
          var a = yy.get(), b = mm.get(), c = dd3.get();
          return !a && !b && !c ? null : (a || "") + "-" + (b || "") + "-" + (c || "");
        } };
      }
      var kind = { url: "url", email: "email", phone: "tel" }[def.type] || "text";
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
      return { node: el("div", {}, kids), typing: !(def.suggest || def.ui), get: function () { return input.value.trim() || null; } };
    }
    function save(val) {
      return api("PUT", "/v1/me/profile/fields/" + encodeURIComponent(def.key), { value: val }).then(function (r) {
        if (r.status === 200) S.profile.fields[def.key].value = r.body.value;
        return r;
      });
    }
    // The date is saved as soon as year, month and day are all chosen (or all cleared); then the chart is drawn again at once.
    function valid(val) { return def.type !== "date" || val === null || /^\d{4}-\d{2}-\d{2}$/.test(val); }
    function after() {
      if (def.key === "birthday") refreshBirthday();
      else if (def.key === "display_name") { swap("avatar"); retitleLife(); }
    }
    return makeRow({ label: def.label, help: def.help, keys: [def.key], vis: st.visibility, forced: def.visibility.configurable === false, display: display, editor: editor, save: save, valid: valid, after: after });
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
      return { node: node, typing: false, get: function () { return { school: si.value.trim() || null, dept: di.value.trim() || null }; } };
    }
    function save(v) {
      return api("PUT", "/v1/me/profile/fields/" + l.school, { value: v.school }).then(function (r1) {
        if (r1.status !== 200) return r1;
        f[l.school].value = r1.body.value;
        return api("PUT", "/v1/me/profile/fields/" + l.dept, { value: v.dept }).then(function (r2) { if (r2.status === 200) f[l.dept].value = r2.body.value; return r2; });
      });
    }
    return makeRow({ label: l.label, keys: [l.school, l.dept], vis: vis, display: display, editor: editor, save: save });
  }
  function educationCard() {
    var kids = [];
    LEVELS.forEach(function (l, i) {
      if (levelShown(l)) kids.push(eduRow(l));
      var next = LEVELS[i + 1];
      if (next && levelShown(l) && !levelShown(next)) {
        kids.push(el("div", { class: "actions" }, [el("button", { type: "button", class: "small", onclick: function () { UI[next.key] = true; render(); } }, [HG.icon("plus"), document.createTextNode("新增" + next.label + "學歷")])]));
      }
    });
    return card("學歷", kids);
  }

  // ---- social links: icons under the name; the + adds one (LINE, IG, Facebook ... or a custom one) ----
  function smallImage(file, size, limit, done) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas"); c.width = size; c.height = size;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      var tries = [["image/png", undefined], ["image/webp", 0.8], ["image/jpeg", 0.7]];
      (function next(i) { c.toBlob(function (b) { if (b && (b.size <= limit || i === tries.length - 1)) done(b); else next(i + 1); }, tries[i][0], tries[i][1]); })(0);
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(null); };
    img.src = url;
  }
  function socialBlock() {
    var box = el("div"), links = S.social, panel = null, draft = null;
    var total = links.length + 1, dense = total > 10;
    var row = el("div", { class: "socials" + (dense ? " dense" : "") });
    var plusTile = null;
    // Live preview: while the add form is open, the new link shows in its real place (before the + button) as it is typed.
    function setDraft(d) {
      if (!d) { if (draft) { draft.remove(); draft = null; } row.className = "socials" + (links.length + 1 > 10 ? " dense" : ""); return; }
      row.className = "socials" + (links.length + 2 > 10 ? " dense" : "");
      var tile = el("div", { class: "soc draft" }, [
        d.icon ? el("span", { class: "soc-link" }, [el("img", { class: "soc-ico", src: d.icon, alt: "" })]) : el("span", { class: "soc-link" }, [el("span", { class: "soc-ico soc-blank" })]),
        el("span", { class: "soc-tag soc-draft-name", text: d.name })]);
      if (draft) draft.replaceWith(tile); else row.insertBefore(tile, plusTile);
      draft = tile; HG.fitLabels(tile);
    }
    links.forEach(function (l) {
      var name = l.label || l.platform_name || "連結";
      // In edit mode the name under the icon opens this link for editing (copying is on the public page).
      var copy = el("button", { type: "button", class: "soc-copy", title: "點一下編輯這個連結", text: name, onclick: function () {
        if (panel) { panel.remove(); panel = null; setDraft(null); }
        panel = editPanel(l, function () { panel = null; }); box.appendChild(panel); panel.scrollIntoView({ block: "nearest" });
      } });
      row.appendChild(el("div", { class: "soc" }, [
        el("a", { class: "soc-link", href: l.url, target: "_blank", rel: "noopener noreferrer nofollow", title: name }, [el("img", { class: "soc-ico", src: l.icon_url, alt: name })]), copy,
        el("button", { type: "button", class: "soc-x", "aria-label": "移除 " + name, text: "×", onclick: function () {
          if (!confirm("移除「" + name + "」？")) return;
          api("DELETE", "/v1/me/social-links/" + encodeURIComponent(l.id)).then(function (r) { if (r.status === 200) refreshSocial(); else HG.toast(errText(r)); });
        } })]));
    });
    plusTile = el("div", { class: "soc" }, [el("button", { type: "button", class: "soc-plus", "aria-label": "新增連結", onclick: function () { if (panel) { panel.remove(); panel = null; setDraft(null); } else { panel = addPanel(function () { panel = null; setDraft(null); }, setDraft); box.appendChild(panel); } } }, [HG.icon("plus")]), el("span", { class: "soc-tag", text: "新增連結" })]);
    row.appendChild(plusTile);
    box.appendChild(row);
    HG.fitLabels(row);
    return box;
  }
  // Edit one link: the address and the shown name (the platform stays; remove and add again to change it).
  function editPanel(l, onClose) {
    var m = msg();
    var url = el("input", { type: "url", value: l.url, "aria-label": "網址" });
    var label = el("input", { type: "text", maxlength: 30, value: l.label || "", placeholder: "顯示名稱（不填就顯示：" + (l.platform_name || "平台名稱") + "）", "aria-label": "名稱" });
    var panel = el("div", { class: "soc-panel" }, [
      el("label", { text: "編輯連結：" + (l.platform_name || "") }), url, el("div", { class: "gap" }), label, el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", text: "儲存", onclick: function () {
          api("PUT", "/v1/me/social-links/" + encodeURIComponent(l.id), { url: url.value.trim(), label: label.value.trim() }).then(function (r) {
            if (r.status !== 200) { say(m, false, errText(r)); return; }
            refreshSocial();
          });
        } }),
        el("button", { type: "button", text: "取消", onclick: function () { panel.remove(); onClose(); } }), m])
    ]);
    return panel;
  }
  function addPanel(onClose, onDraft) {
    var m = msg(), key = S.platforms.length ? S.platforms[0].key : "", iconBlob = null, ownIcon = null;
    var dd = HG.dropdown({ options: S.platforms.map(function (p) { return { value: p.key, label: p.name }; }), value: key, block: true, searchable: true, onchange: function (v) { key = v; paintCustom(); sync(); } });
    var url = el("input", { type: "url", placeholder: "貼上你的個人頁網址（https://…）", "aria-label": "網址" });
    var label = el("input", { type: "text", maxlength: 30, placeholder: "顯示名稱（選填，例如：健管、XS系列；不填就顯示平台名稱）", "aria-label": "名稱" });
    var file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "選擇圖示" });
    var preview = el("img", { class: "soc-preview", alt: "", hidden: true });
    var custom = el("div");
    function platform() { return S.platforms.filter(function (p) { return p.key === key; })[0] || null; }
    function sync() {
      var p = platform();
      var name = label.value.trim() || (p ? p.name : "") || "連結";
      onDraft({ icon: (isCustom() && ownIcon) || (p ? p.icon_url : ""), name: name });
    }
    label.addEventListener("input", sync);
    function isCustom() { return S.platforms.filter(function (p) { return p.key === key; }).map(function (p) { return p.custom; })[0] === true; }
    function paintCustom() {
      custom.textContent = "";
      if (!isCustom()) { iconBlob = null; ownIcon = null; return; }
      custom.appendChild(el("div", { class: "gap" }));
      custom.appendChild(el("div", { class: "inline" }, [el("button", { type: "button", class: "small", text: "上傳圖示（選填）", onclick: function () { file.click(); } }), preview, file]));
    }
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; if (!f) return;
      smallImage(f, 64, 16 * 1024, function (b) { if (!b) { say(m, false, "這個檔案無法讀取"); return; } iconBlob = b;
        // A data: address (the page's CSP allows images from data:, not from blob:).
        var reader = new FileReader(); reader.onload = function () { preview.src = reader.result; preview.hidden = false; ownIcon = reader.result; sync(); }; reader.readAsDataURL(b);
      });
    });
    paintCustom();
    sync();
    var panel = el("div", { class: "soc-panel" }, [
      el("label", { text: "選擇平台" }), dd.el, el("div", { class: "gap" }), url, el("div", { class: "gap" }), label, custom, el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", text: "新增", onclick: function () {
          var body = { platform_key: key, url: url.value.trim() }; if (label.value.trim()) body.label = label.value.trim();
          api("POST", "/v1/me/social-links", body).then(function (r) {
            if (r.status !== 200) { say(m, false, errText(r)); return; }
            if (iconBlob && isCustom()) api("PUT", "/v1/me/social-links/" + encodeURIComponent(r.body.id) + "/icon", undefined, { type: iconBlob.type, data: iconBlob }).then(function () { refreshSocial(); });
            else refreshSocial();
          });
        } }),
        el("button", { type: "button", text: "取消", onclick: function () { panel.remove(); onClose(); } }), m])
    ]);
    return panel;
  }
  function refreshSocial() { return api("GET", "/v1/me/social-links").then(function (r) { if (r.status === 200) { S.social = r.body.links; swap("avatar"); } }); }

  // ---- avatar ----
  // After a picture is chosen the member frames it: drag to move, slide (or wheel) to zoom; the circle is what is kept.
  function cropDialog(file, done) {
    var V = 300, img = new Image(), url = URL.createObjectURL(file);
    img.onerror = function () { URL.revokeObjectURL(url); done(null, "這個檔案瀏覽器無法讀取（例如 HEIC 格式），請改選 JPEG、PNG 或 WebP 圖片"); };
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight, base = V / Math.min(w, h), zoom = 1, cx = w / 2, cy = h / 2;
      var cv = el("canvas", { class: "crop-cv", width: V, height: V }), ctx = cv.getContext("2d");
      var range = el("input", { type: "range", class: "crop-zoom", min: "1", max: "4", step: "0.01", value: "1", "aria-label": "縮放" });
      function scale() { return base * zoom; }
      function clamp() { var half = V / scale() / 2; cx = Math.min(Math.max(cx, half), w - half); cy = Math.min(Math.max(cy, half), h - half); }
      function paint(c, size) { var sw = V / scale(); c.drawImage(img, cx - sw / 2, cy - sw / 2, sw, sw, 0, 0, size, size); }
      function draw() {
        clamp(); ctx.clearRect(0, 0, V, V); paint(ctx, V);
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.beginPath(); ctx.rect(0, 0, V, V); ctx.arc(V / 2, V / 2, V / 2 - 3, 0, Math.PI * 2, true); ctx.fill("evenodd"); ctx.restore();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(V / 2, V / 2, V / 2 - 3, 0, Math.PI * 2); ctx.stroke();
      }
      var drag = null;
      cv.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", function (e) {
        if (!drag) return; var r = cv.getBoundingClientRect(), f = V / r.width;
        cx -= (e.clientX - drag.x) * f / scale(); cy -= (e.clientY - drag.y) * f / scale(); drag = { x: e.clientX, y: e.clientY }; draw();
      });
      function end() { drag = null; }
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
      cv.addEventListener("wheel", function (e) { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom - e.deltaY / 400)); range.value = String(zoom); draw(); }, { passive: false });
      range.addEventListener("input", function () { zoom = Number(range.value); draw(); });
      function close(blob, err) { URL.revokeObjectURL(url); back.remove(); done(blob, err); }
      var ok = el("button", { type: "button", class: "primary", text: "使用這張", onclick: function () {
        var out = document.createElement("canvas"); out.width = 256; out.height = 256; paint(out.getContext("2d"), 256);
        var q = 0.88; (function attempt() { out.toBlob(function (b) { if (b && b.size > 120 * 1024 && q > 0.4) { q -= 0.12; attempt(); } else close(b, b ? null : "圖片處理失敗，請換一張"); }, "image/jpeg", q); })();
      } });
      var back = el("div", { class: "crop-back", role: "dialog", "aria-modal": "true" }, [el("div", { class: "crop-box" }, [
        el("h2", { text: "調整頭像" }), cv, range, el("p", { class: "help", text: "拖曳移動位置，滑桿縮放；圓圈內是會顯示的範圍。" }),
        el("div", { class: "actions" }, [ok, el("button", { type: "button", text: "取消", onclick: function () { close(null, null); } })])
      ])]);
      document.body.appendChild(back); draw();
    };
    img.src = url;
  }
  function avatarBlock() {
    var p = S.profile, m = msg(), file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "選擇圖片" });
    function act(method, path) { return function () { api(method, path).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); }); }; }
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; file.value = ""; if (!f) return;
      cropDialog(f, function (blob, err) {
        if (!blob) { if (err) say(m, false, err); return; }
        say(m, true, "上傳中…");
        api("POST", "/v1/me/profile/avatar", undefined, { type: "image/jpeg", data: blob }).then(function (r) { if (r.status === 200) load(); else say(m, false, errText(r)); });
      });
    });
    var nums = numbers(), first = nums[0] ? pid(nums[0]) : "";
    var KIND = { system: "系統", center: "中心", rank: "獎銜" };
    var badges = (p.badges || []).length ? el("span", { class: "badges" }, p.badges.map(function (b) { return el("span", { class: "rank k-" + b.kind + " rk" + b.size, title: KIND[b.kind] + "：" + b.text, text: b.text }); })) : null;
    // The name always stays on one line: a long name takes a smaller font step.
    var units = 0; Array.from(shownName() || "我的帳號").forEach(function (ch) { units += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.55; });
    var nm = units <= 6 ? 0 : units <= 8 ? 1 : units <= 10 ? 2 : 3;
    return el("section", { class: "card" }, [
      el("div", { class: "hero" }, [HG.bubble("lg", p.avatar.url, shownName()), el("div", { class: "hero-main" }, [el("div", { class: "nameline" }, [el("h1", { class: "nm nm-" + nm, text: shownName() || "我的帳號" }), badges]), el("div", { class: "sub" }, [el("span", { class: "help", text: "會員編號" }), first ? el("span", { class: "help", text: first }) : null])])]),
      // The three picture buttons sit in one full-width row under the picture.
      el("div", { class: "avbtns" }, [
        el("button", { type: "button", text: "上傳圖片", onclick: function () { file.click(); } }),
        el("button", { type: "button", text: "Google頭像", onclick: act("POST", "/v1/me/profile/avatar/google") }),
        el("button", { type: "button", class: "danger", text: "移除頭像", disabled: !p.avatar.url, onclick: act("DELETE", "/v1/me/profile/avatar") }), file
      ]),
      el("div", { class: "help" }, ["頭像一律公開。"]), m,
      socialBlock()
    ]);
  }

  // The public address with a big share button at its left (the phone's own share sheet; the symbol follows the device).
  function publicUrlRow(url) {
    var btn = el("button", { type: "button", class: "share-big", "aria-label": "分享我的公開網址", title: "分享", onclick: function () {
      if (navigator.share) { navigator.share({ title: shownName() ? shownName() + "｜會員中心" : "會員中心", url: url }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { HG.toast("已複製連結"); }, function () { HG.toast("請手動複製網址"); });
      else HG.toast("請手動複製網址");
    } }, [HG.shareIcon()]);
    return el("div", { class: "pubrow" }, [btn, el("div", { class: "pubtext" }, [el("span", { class: "help", text: "公開網址" }), el("a", { href: url, text: url })])]);
  }

  // ---- member number (same logic as starry.phd: random, <country><0 + 6 digits>; Amway members may change it) ----
  function numberRow() {
    var f = S.profile.fields.member_number, def = S.def.member_number, canEdit = isAmway();
    // The note comes from the server: it also knows whether the "recommended to change" reminder is already done for good.
    var note = canEdit ? f.note : (f.note || def.help_when_not_amway);
    function display() {
      var list = numbers();
      return el("div", {}, [el("div", { class: "chips" }, list.map(function (e, i) { return el("span", { class: "badge num", text: pid(e) + (i === 0 ? "（預設）" : "") }); })),
        f.public_url ? publicUrlRow(f.public_url) : null]);
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
      return { node: el("div", {}, [el("div", { class: "help", text: def.help }), list, more]), typing: false, get: function () { return Array.prototype.map.call(list.children, function (r) { return r.getValue(); }); } };
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
        }
        return r;
      });
    }
    // The public address stays visible under the numbers and follows every change.
    var urlBox = el("div");
    function paintUrl() { urlBox.textContent = ""; var u = S.profile.fields.member_number.public_url; if (u) urlBox.appendChild(publicUrlRow(u)); }
    function valid(list) { return list.length > 0 && list.every(function (e) { return e.number.trim(); }); }
    function after() {
      api("GET", "/v1/me/profile").then(function (r) { if (r.status === 200) { S.profile = r.body; paintUrl(); swap("avatar"); } });
    }
    var row = makeRow({ label: f.label, note: note, forced: true, display: display, editor: editor, save: save, valid: valid, after: after, noEdit: !canEdit, below: canEdit ? function () { paintUrl(); return urlBox; } : null });
    row.appendChild(cands);
    return row;
  }

  // ---- Amway block: the switch takes effect at once (no confirmation, no consent step) ----
  var REQUIRED = ["education_system", "education_center", "rank"];
  function amwayMissing() {
    return S.adefs.fields.filter(function (d) {
      if (REQUIRED.indexOf(d.key) < 0) return false;
      var st = S.amway.fields[d.key];
      return !st || ((st.value === null || st.value === undefined) && (st.pending_value === null || st.pending_value === undefined));
    }).map(function (d) { return d.label; });
  }
  function amwayFieldRow(d) {
    var st = S.amway.fields[d.key] || { value: null, pending_value: null, status: "not_required", visibility: "private" };
    var opts = d.options || [];
    function label(v) { var f = opts.filter(function (o) { return o.value === v; })[0]; return f ? f.label : v; }
    // The review state shown under the editor (updated after every save, without redrawing the editor).
    function status() {
      var cur = S.amway.fields[d.key] || st;
      if (cur.pending_value !== null && cur.pending_value !== undefined) return el("p", {}, [el("span", { class: "badge pending", text: d.status_labels.pending }), document.createTextNode(" " + (d.type === "select" ? label(cur.pending_value) : cur.pending_value))]);
      if (cur.status === "approved" && d.status_labels.approved) return el("span", { class: "badge approved", text: d.status_labels.approved });
      if (cur.status === "rejected") return el("span", { class: "badge rejected", text: d.status_labels.rejected });
      return null;
    }
    function editor() {
      var cur = st.pending_value !== null && st.pending_value !== undefined ? st.pending_value : st.value;
      if (d.type === "select") {
        var dd = HG.dropdown({ options: [{ value: "", label: "（未選擇）" }].concat(opts), value: cur || "", block: true });
        return { node: dd.el, get: function () { return dd.get() || null; } };
      }
      var input = el("input", { type: "text", maxlength: d.max_length, "aria-label": d.label }); input.value = cur || "";
      var typingSaves = !d.suggest;
      // Training system and regional center: a tick for 無 (none) next to the box; the field is required, 無 counts as filled in.
      var canNone = d.key === "education_system" || d.key === "education_center", none = canNone && cur === "無";
      if (none) { input.value = ""; input.disabled = true; }
      // The regional center offers its own related words only while the training system means H-Global1985.
      var useSuggest = d.suggest && (!d.suggest_when_hglobal || S.amway.hglobal);
      var field = useSuggest ? HG.suggestBox(input, suggestFetcher(d.suggest), undefined, { openOnFocus: d.key === "education_center" }) : input;
      if (!canNone) return { node: field, typing: typingSaves, get: function () { return input.value.trim() || null; } };
      var noneBox = HG.checkbox("無", none, function (on) { none = on; input.disabled = on; if (on) input.value = ""; });
      return { node: el("div", {}, [field, noneBox]), typing: false, get: function () { return none ? "無" : (input.value.trim() || null); } };
    }
    function save(v) { return api("PUT", "/v1/me/amway/fields/" + d.key, { value: v }); }
    function after() { refreshAmwayData(d.key); }
    var r = makeRow({ label: REQUIRED.indexOf(d.key) >= 0 ? d.label + "（必填）" : d.label, keys: [d.key], vis: st.visibility, forced: !!(d.visibility && d.visibility.configurable === false), editor: editor, status: status, save: save, after: after });
    AROWS[d.key] = r;
    return r;
  }
  // Replace one block in place (no page reload): used after the Amway switch and Amway field saves.
  var NODES = {}, MAKERS = {};
  function swap(key) {
    var old = NODES[key], make = MAKERS[key]; if (!old || !make) return;
    var neu = make(); if (!neu) return;
    old.replaceWith(neu); NODES[key] = neu;
  }
  function refreshAmway() {
    return Promise.all([api("GET", "/v1/me/amway"), api("GET", "/v1/me/profile")]).then(function (r) {
      if (r[0].status === 200 && r[1].status === 200) { S.amway = r[0].body; S.profile = r[1].body; swap("avatar"); swap("amway"); }
    });
  }
  // After one Amway field was saved: refresh the data and only the bits that depend on it (the editors stay as they are).
  var AROWS = {};
  function refreshAmwayData(savedKey) {
    var wasHglobal = !!S.amway.hglobal;
    return Promise.all([api("GET", "/v1/me/amway"), api("GET", "/v1/me/profile")]).then(function (r) {
      if (r[0].status !== 200 || r[1].status !== 200) return;
      S.amway = r[0].body; S.profile = r[1].body; swap("avatar");
      Object.keys(AROWS).forEach(function (k) { AROWS[k].refreshStatus(); });
      var note = document.getElementById("amway-missing"); if (note) { var miss = amwayMissing(); note.textContent = miss.length ? "請填寫：" + miss.join("、") + "（必填；系統、中心沒有的話請勾選「無」）。" : ""; note.hidden = !miss.length; }
      // The related words of the center depend on the training system: that one row is rebuilt when it changes meaning.
      if (savedKey === "education_system" && wasHglobal !== !!S.amway.hglobal && AROWS.education_center) {
        var cd = S.adefs.fields.filter(function (x) { return x.key === "education_center"; })[0], old = AROWS.education_center;
        if (cd) { var neu = amwayFieldRow(cd); old.replaceWith(neu); }
      }
      // The rank waits for the system and the center: once they are filled in, a rank chosen earlier is sent.
      if ((savedKey === "education_system" || savedKey === "education_center") && AROWS.rank) AROWS.rank.flush();
    });
  }

  function amwayCard() {
    var m = msg();
    // The switch takes effect on screen at once; the server call runs in the background and the page is corrected if it fails.
    var box = HG.checkbox("我是Amway會員", isAmway(), function (on) {
      S.amway.enabled = on; swap("amway");
      api("PUT", "/v1/me/amway/enabled", { enabled: on }).then(function (r) {
        if (r.status === 200) { if (r.body.member_number) S.profile.fields.member_number.value = r.body.member_number; refreshAmway(); }
        else { S.amway.enabled = !on; swap("amway"); HG.toast(errText(r)); }
      });
    });
    var kids = [box, m];
    AROWS = {};
    if (isAmway()) { var miss = amwayMissing(); kids.push(el("p", { id: "amway-missing", class: "help warn-note", hidden: !miss.length, text: miss.length ? "請填寫：" + miss.join("、") + "（必填；系統、中心沒有的話請勾選「無」）。" : "" })); }
    // The member number and the Amway fields in the order the administrator set; the number is always there.
    var items = [{ order: S.def.member_number.order, make: numberRow }];
    if (isAmway()) S.adefs.fields.forEach(function (d) { items.push({ order: d.order, make: function () { return amwayFieldRow(d); } }); });
    items.sort(function (a, b) { return a.order - b.order; }).forEach(function (it) { kids.push(it.make()); });
    return el("section", { class: "card" }, kids);
  }

  function searchCard() {
    var m = msg();
    var box = HG.checkbox("是否同意讓搜尋引擎為你打知名度？", S.indexing, function (on) {
      S.indexing = on;
      api("PUT", "/v1/me/search-indexing", { allowed: on }).then(function (r) {
        if (r.status !== 200) { S.indexing = !on; swap("search"); HG.toast(errText(r)); }
      });
    });
    return el("section", { class: "card" }, [el("h2", { text: "搜尋引擎" }), box,
      el("p", { class: "help", text: "勾選後，Google 等搜尋引擎可以收錄您的公開頁（只有您設為公開的資料）。不勾選則不會被收錄。" }), m]);
  }

  // ---- life number chart (same drawing data as the starry.phd member center) ----
  // One SVG with fixed geometry (same as src/web/chart.ts): each number has its own 72x80 cell, so any number of circles
  // or a shape never moves anything. Outward from the middle: the shape (天賦數 = outlined triangles, one per occurrence; 加總命數 = small solid square) behind the white number, then the circles.
  var RING_COLOR = { black: "#0f172a", birthday: "#f5b400", zodiac: "#8b2fe0" }, TALENT_COLOR = "#7ccf1b", LIFE_COLOR = "#e5303a", LINE_COLOR = "#0ea5e9", SW = 1.5, RING_STEP = 4.5;
  var TRI = { apex: 14.25, base: 9.75, half: 15, cy: 1.44, inradius: 8.31 };
  function triangleAt(x, y, k) {
    var f = 1 + (k * RING_STEP) / TRI.inradius;
    function at(dx, dy) { return (x + dx * f).toFixed(1) + "," + (y + TRI.cy + (dy - TRI.cy) * f).toFixed(1); }
    return '<polygon points="' + at(0, -TRI.apex) + " " + at(-TRI.half, TRI.base) + " " + at(TRI.half, TRI.base) + '" fill="none" stroke="' + TALENT_COLOR + '" stroke-width="' + SW + '" stroke-linejoin="round"/>';
  }
  function centre(n) { return n === 0 ? { x: 252, y: 200 } : { x: 36 + 72 * Math.floor((n - 1) / 3), y: 40 + 80 * ((n - 1) % 3) }; }
  function chartCell(n, r) {
    var kinds = [], i, k;
    for (i = 0; i < r.black; i++) kinds.push("black");
    if (r.birthday) kinds.push("birthday");
    if (r.zodiac) kinds.push("zodiac");
    var marked = kinds.length > 0 || r.talent > 0 || !!r.life;
    // Circles, triangles and the square are independent thin outlines and may overlap each other.
    var c = centre(n), r0 = 15, step = kinds.length > 1 ? Math.min(RING_STEP, (34 - r0) / (kinds.length - 1)) : 0;
    // The lines end at the innermost circle: a background disc keeps them off the digit.
    var out = '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + r0 + '" fill="#f6f8f4"/>';
    for (i = kinds.length - 1; i >= 0; i--) out += '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + (r0 + i * step).toFixed(2) + '" fill="none" stroke="' + RING_COLOR[kinds[i]] + '" stroke-width="' + SW + '"/>';
    for (k = r.talent - 1; k >= 0; k--) out += triangleAt(c.x, c.y, k);
    if (r.life) out += '<rect x="' + (c.x - 14) + '" y="' + (c.y - 14) + '" width="28" height="28" rx="2" fill="none" stroke="' + LIFE_COLOR + '" stroke-width="' + SW + '" stroke-linejoin="round"/>';
    return out + '<text x="' + c.x + '" y="' + (c.y + 1) + '" dy=".35em" text-anchor="middle" font-size="26" fill="' + (marked ? "#0f172a" : "#c3cbbf") + '">' + n + "</text>";
  }
  function chartSvg(c) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"), html = "";
    s.setAttribute("class", "ln-svg"); s.setAttribute("viewBox", "0 0 288 240"); s.setAttribute("role", "img"); s.setAttribute("aria-label", "彩色九宮格");
    function seg(l, extra) { var a = centre(l[0]), b = centre(l[l.length - 1]); return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + LINE_COLOR + '" stroke-width="' + SW + '" stroke-linecap="round"' + extra + "/>"; }
    (c.sub_lines || []).forEach(function (l) { html += seg(l, ' stroke-dasharray="7 6"'); });
    (c.lines || []).forEach(function (l) { html += seg(l, ""); });
    for (var n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) html += chartCell(n, c.rings[n]);
    s.innerHTML = html; return s;
  }
  var BLUE = 'stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" fill="none"';
  var LINE_LEGEND = [
    { icon: '<line x1="2" y1="16" x2="22" y2="8" ' + BLUE + "/>", text: "主線：天賦、能力" },
    { icon: '<line x1="2" y1="16" x2="22" y2="8" ' + BLUE + ' stroke-dasharray="3.2 3.2"/>', text: "副線：人際互動、處事態度" },
    { icon: '<line x1="2" y1="12" x2="22" y2="12" ' + BLUE + "/>", text: "橫線：你如何與世界互動？" },
    { icon: '<line x1="12" y1="2" x2="12" y2="22" ' + BLUE + "/>", text: "直線：你如何運用自己的能力？" },
    { icon: '<line x1="3" y1="21" x2="21" y2="3" ' + BLUE + "/>", text: "斜線：你如何追求人生目標？" }
  ];
  function svgIcon(cls, html) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", cls); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = html; return s;
  }
  // 「xxx的生命靈數（x年x月x日）」 is the block's title (the plain 生日與生命靈數 until a birthday is saved).
  function lifeTitle() {
    var f = S.profile.fields.birthday, m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((f && f.value) || "");
    return m ? (shownName() || "我") + "生命靈數 " + m[1] + "年" + Number(m[2]) + "月" + Number(m[3]) + "日" : "生日與生命靈數";
  }
  // The title stays on one line: the longer it is, the smaller the font (same steps as the public page).
  function titleClassOf(t) {
    var u = 0; Array.from(t).forEach(function (ch) { u += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.55; });
    return "life-title lt-" + (u <= 14.5 ? 0 : u <= 17 ? 1 : u <= 19.5 ? 2 : u <= 23 ? 3 : 4);
  }
  // The 生命靈數 chart inside the birthday block (one block for both).
  function chartBody() {
    var c = S.profile.life_chart; if (!c) return null;
    function item(cls, label, value, badge) { return el("div", { class: "ln-item " + cls }, [el("span", { text: label }), el("span", { class: "ln-badge " + badge, text: String(value) })]); }
    function legend(cls, text) { return el("div", {}, [el("span", { class: "ln-dot " + cls }), el("span", { text: text })]); }
    return el("div", {}, [
      el("div", { class: "ln-card" }, [
        el("div", { class: "ln-head" }, [item("z", "星座：" + c.zodiac_name, c.zodiac_number, "ln-b-zodiac"), item("b", "生日數：", c.birthday_number, "ln-b-birthday"), item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent"), item("l", "加總命數：", c.life_number, "ln-b-life")]),
        chartSvg(c),
        el("div", { class: "ln-legend" }, [
          legend("rg-black", "先天數生日數字"), legend("rg-birthday", "生日數"), legend("rg-zodiac", "星座數"), el("div", {}, [svgIcon("ln-dot-tri", '<polygon points="12,4 21,19 3,19" fill="none" stroke="#7ccf1b" stroke-width="1.8" stroke-linejoin="round"/>'), el("span", { text: "天賦數" })]),
          el("div", {}, [svgIcon("ln-dot-tri", '<rect x="5" y="5" width="14" height="14" rx="1.5" fill="none" stroke="#e5303a" stroke-width="1.8" stroke-linejoin="round"/>'), el("span", { text: "加總命數" })]),
          ].concat(LINE_LEGEND.map(function (l) { return el("div", {}, [svgIcon("ln-dot-tri", l.icon), el("span", { text: l.text })]); })))
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

  // The birthday was saved: read the profile again and draw the chart again (the date row itself is left alone).
  var CHART = null;
  function retitleLife() {
    if (!CHART || !CHART.card) return;
    var h = CHART.card.querySelector("h2"), t = lifeTitle(); if (!h) return;
    h.textContent = t; h.className = titleClassOf(t); HG.fitTitles(CHART.card);
  }
  function refreshBirthday() {
    return api("GET", "/v1/me/profile").then(function (r) {
      if (r.status !== 200 || !CHART) return;
      S.profile = r.body;
      var ch = chartBody(); CHART.holder.textContent = ""; if (ch) CHART.holder.appendChild(ch);
      retitleLife();
    });
  }

  function render() {
    root.textContent = "";
    // Same three places as on the page itself: back (where 編輯 is there), 分享, 預覽公開頁.
    var pubUrl = S.profile.fields.member_number.public_url;
    var shareBtn = el("button", { type: "button", onclick: function () {
      if (!pubUrl) return;
      if (navigator.share) { navigator.share({ title: shownName() ? shownName() + "｜會員中心" : "會員中心", url: pubUrl }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pubUrl).then(function () { HG.toast("已複製連結"); }, function () { HG.toast("請手動複製網址"); });
      else HG.toast("請手動複製網址");
    } }, [HG.shareIcon(), "分享"]);
    root.appendChild(el("div", { class: "pagebar" }, [el("a", { class: "button", href: ownPage(), text: "上一頁" }), shareBtn, el("a", { class: "button wide", href: publicPath(), text: "預覽公開頁" })]));
    function basicCard() { return card("基本資料", [el("p", { class: "help", text: "公開＝任何人都看得到；隱藏＝不在公開頁顯示（寰宇生態系內的服務仍可能使用）。" })].concat(S.defs.fields.filter(function (d) { return d.group === "basic"; }).sort(function (a, b) { return a.order - b.order; }).map(profileField))); }
    function contactCard() {
      var contact = S.defs.fields.filter(function (d) { return d.group === "contact"; }).sort(function (a, b) { return a.order - b.order; });
      return card("聯絡與地區", [el("p", { class: "help", text: "這個區塊預設全部隱藏，想公開哪一項請按該項的「隱藏」切換。" })].concat(contact.map(profileField)));
    }
    var makers = MAKERS = { avatar: avatarBlock, amway: amwayCard, basic: basicCard, education: educationCard, contact: contactCard, birthday: function () { var ch = chartBody(); var t = lifeTitle(); CHART = { holder: el("div", {}, ch ? [ch] : []) }; var c = card(t, [profileField(S.def.birthday), CHART.holder], titleClassOf(t)); CHART.card = c; return c; } };
    (S.defs.blocks || []).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (blk) {
      var make = makers[blk.key], node = make ? make() : null; if (node) { root.appendChild(node); NODES[blk.key] = node; }
    });
    var se = searchCard(); root.appendChild(se); NODES.search = se; MAKERS.search = searchCard;
    HG.fitTitles(root);
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
