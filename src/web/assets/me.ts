// /assets/me.js — the member's edit page (/my/edit). Built from the field definition APIs (no hard-coded fields,
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
        if (res && res.status === 200) { HG.toast("已儲存"); if (cfg.after) cfg.after(); else if (cfg.reload) load(); else { stop(); } }
        else say(m, false, res ? errText(res) : "儲存失敗");
      });
    });
    cancel.addEventListener("click", stop);
    row.appendChild(el("div", { class: "row-head" }, [el("label", { text: cfg.label }), tools]));
    if (cfg.note) row.appendChild(el("div", {}, [el("span", { class: "note", text: cfg.note })]));
    if (cfg.help) row.appendChild(el("div", { class: "help", text: cfg.help }));
    if (cfg.forced) tools.appendChild(lockedPill());
    else if (cfg.keys) tools.appendChild(eyeButton(cfg.keys, cfg.vis));
    if (!cfg.noEdit) { tools.appendChild(cancel); tools.appendChild(edit); }
    row.appendChild(valueBox); row.appendChild(m);
    paintValue(); paintBtn();
    row.refresh = paintValue;
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
    return makeRow({ label: def.label, help: def.help, keys: [def.key], vis: st.visibility, forced: def.visibility.configurable === false, display: display, editor: editor, save: save, reload: def.key === "birthday" });
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
    var box = el("div"), links = S.social, panel = null;
    var total = links.length + 1, dense = total > 10;
    var row = el("div", { class: "socials" + (dense ? " dense" : "") });
    links.forEach(function (l) {
      var name = l.label || l.platform_name || "連結";
      // In edit mode the name under the icon opens this link for editing (copying is on the public page).
      var copy = el("button", { type: "button", class: "soc-copy", title: "點一下編輯這個連結", text: name, onclick: function () {
        if (panel) { panel.remove(); panel = null; }
        panel = editPanel(l, function () { panel = null; }); box.appendChild(panel); panel.scrollIntoView({ block: "nearest" });
      } });
      row.appendChild(el("div", { class: "soc" }, [
        el("a", { class: "soc-link", href: l.url, target: "_blank", rel: "noopener noreferrer nofollow", title: name }, [el("img", { class: "soc-ico", src: l.icon_url, alt: name })]), copy,
        el("button", { type: "button", class: "soc-x", "aria-label": "移除 " + name, text: "×", onclick: function () {
          if (!confirm("移除「" + name + "」？")) return;
          api("DELETE", "/v1/me/social-links/" + encodeURIComponent(l.id)).then(function (r) { if (r.status === 200) refreshSocial(); else HG.toast(errText(r)); });
        } })]));
    });
    row.appendChild(el("div", { class: "soc" }, [el("button", { type: "button", class: "soc-plus", "aria-label": "新增連結", onclick: function () { if (panel) { panel.remove(); panel = null; } else { panel = addPanel(function () { panel = null; }); box.appendChild(panel); } } }, [HG.icon("plus")]), el("span", { class: "soc-tag", text: "新增連結" })]));
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
  function addPanel(onClose) {
    var m = msg(), key = S.platforms.length ? S.platforms[0].key : "", iconBlob = null;
    var dd = HG.dropdown({ options: S.platforms.map(function (p) { return { value: p.key, label: p.name }; }), value: key, block: true, searchable: true, onchange: function (v) { key = v; paintCustom(); } });
    var url = el("input", { type: "url", placeholder: "貼上你的個人頁網址（https://…）", "aria-label": "網址" });
    var label = el("input", { type: "text", maxlength: 30, placeholder: "顯示名稱（選填，例如：健管、XS系列；不填就顯示平台名稱）", "aria-label": "名稱" });
    var file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "選擇圖示" });
    var preview = el("img", { class: "soc-preview", alt: "", hidden: true });
    var custom = el("div");
    function isCustom() { return S.platforms.filter(function (p) { return p.key === key; }).map(function (p) { return p.custom; })[0] === true; }
    function paintCustom() {
      custom.textContent = "";
      if (!isCustom()) { iconBlob = null; return; }
      custom.appendChild(el("div", { class: "gap" }));
      custom.appendChild(el("div", { class: "inline" }, [el("button", { type: "button", class: "small", text: "上傳圖示（選填）", onclick: function () { file.click(); } }), preview, file]));
    }
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; if (!f) return;
      smallImage(f, 64, 16 * 1024, function (b) { if (!b) { say(m, false, "這個檔案無法讀取"); return; } iconBlob = b;
        // A data: address (the page's CSP allows images from data:, not from blob:).
        var reader = new FileReader(); reader.onload = function () { preview.src = reader.result; preview.hidden = false; }; reader.readAsDataURL(b);
      });
    });
    paintCustom();
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
    var row = makeRow({ label: f.label, note: note, forced: true, display: display, editor: editor, save: save, noEdit: !canEdit, reload: true });
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
      return { node: useSuggest ? HG.suggestBox(input, suggestFetcher(d.suggest), undefined, { openOnFocus: d.key === "education_center" }) : input, get: function () { return input.value.trim() || null; } };
    }
    function save(v) { return api("PUT", "/v1/me/amway/fields/" + d.key, { value: v }); }
    return makeRow({ label: d.label, keys: [d.key], vis: st.visibility, forced: !!(d.visibility && d.visibility.configurable === false), display: display, editor: editor, save: save, after: refreshAmway });
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
  // One SVG with fixed geometry (same as src/web/chart.ts): each number has its own 100x80 cell, so any number of circles
  // or a triangle never moves anything. Outward from the middle: the red triangle behind the number, then the circles.
  var RING_COLOR = { black: "#0f172a", birthday: "#f5b400", zodiac: "#8b2fe0", talent: "#7ccf1b" };
  function centre(n) { return { x: 50 + 100 * Math.floor((n - 1) / 3), y: 40 + 80 * ((n - 1) % 3) }; }
  function chartCell(n, r) {
    var kinds = [], i;
    for (i = 0; i < r.black; i++) kinds.push("black");
    if (r.birthday) kinds.push("birthday");
    if (r.zodiac) kinds.push("zodiac");
    for (i = 0; i < r.talent; i++) kinds.push("talent");
    var c = centre(n), r0 = r.life ? 26 : 15, step = kinds.length > 1 ? Math.min(4.5, (37 - r0) / (kinds.length - 1)) : 0, out = "";
    for (i = kinds.length - 1; i >= 0; i--) out += '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + (r0 + i * step).toFixed(2) + '" fill="#f6f8f4" stroke="' + RING_COLOR[kinds[i]] + '" stroke-width="2.5"/>';
    if (r.life) out += '<polygon points="' + c.x + "," + (c.y - 18) + " " + (c.x - 19) + "," + (c.y + 14) + " " + (c.x + 19) + "," + (c.y + 14) + '" fill="#e5303a" stroke="#e5303a" stroke-width="3" stroke-linejoin="round"/>';
    var fill = r.life ? "#ffffff" : kinds.length ? "#0f172a" : "#c3cbbf";
    return out + '<text x="' + c.x + '" y="' + (c.y + (r.life ? 5 : 1)) + '" dy=".35em" text-anchor="middle" font-size="' + (r.life ? 22 : 24) + '" fill="' + fill + '">' + n + "</text>";
  }
  function chartSvg(c) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"), html = "";
    s.setAttribute("class", "ln-svg"); s.setAttribute("viewBox", "0 0 300 240"); s.setAttribute("role", "img"); s.setAttribute("aria-label", "彩色九宮格");
    (c.lines || []).forEach(function (l) { var a = centre(l[0]), b = centre(l[2]); html += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>'; });
    for (var n = 1; n <= 9; n++) html += chartCell(n, c.rings[n]);
    s.innerHTML = html; return s;
  }
  function svgIcon(cls, html) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", cls); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = html; return s;
  }
  // The 生命靈數 chart inside the birthday block (one block for both).
  function chartBody() {
    var c = S.profile.life_chart; if (!c) return null;
    function item(cls, label, value, badge) { return el("div", { class: "ln-item " + cls }, [el("span", { text: label }), el("span", { class: "ln-badge " + badge, text: String(value) })]); }
    function legend(cls, text) { return el("div", {}, [el("span", { class: "ln-dot " + cls }), el("span", { text: text })]); }
    return el("div", { class: "row" }, [
      el("div", { class: "row-head" }, [el("label", { text: "生命靈數" }), el("div", { class: "row-tools" }, [lockedPill()])]),
      el("div", { class: "ln-card" }, [
        el("div", { class: "ln-head" }, [item("z", "星座：" + c.zodiac_name, c.zodiac_number, "ln-b-zodiac"), item("b", "生日數：", c.birthday_number, "ln-b-birthday"), item("t", "天賦數：", c.talent_numbers.length ? c.talent_numbers.join("、") : "—", "ln-b-talent"), item("l", "加總命數：", c.life_number, "ln-b-life")]),
        chartSvg(c),
        el("div", { class: "ln-legend" }, [
          legend("rg-black", "先天數生日數字"), legend("rg-birthday", "生日數"), legend("rg-zodiac", "星座數"), legend("rg-talent", "天賦數"),
          el("div", {}, [svgIcon("ln-dot-tri", '<polygon points="12,3 22,21 2,21" fill="#e5303a" stroke="#e5303a" stroke-width="2" stroke-linejoin="round"/>'), el("span", { text: "加總命數" })]),
          el("div", {}, [svgIcon("ln-dot-tri", '<line x1="2" y1="12" x2="22" y2="12" stroke="#2563eb" stroke-width="3.7" stroke-linecap="round"/>'), el("span", { text: "特殊連線" })])])
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
    root.appendChild(el("div", { class: "pagebar" }, [el("a", { class: "button small", href: ownPage(), text: "← 回到我的頁面" }), el("div", { class: "tools" }, [el("a", { class: "button small", href: publicPath(), text: "預覽公開頁" })])]));
    function basicCard() { return card("基本資料", S.defs.fields.filter(function (d) { return d.group === "basic"; }).sort(function (a, b) { return a.order - b.order; }).map(profileField)); }
    function contactCard() {
      var contact = S.defs.fields.filter(function (d) { return d.group === "contact"; }).sort(function (a, b) { return a.order - b.order; });
      return card("聯絡與地區", [el("p", { class: "help", text: "這個區塊預設全部隱藏，想公開哪一項請按該項的「隱藏」切換。" })].concat(contact.map(profileField)));
    }
    var makers = MAKERS = { avatar: avatarBlock, amway: amwayCard, basic: basicCard, education: educationCard, contact: contactCard, birthday: function () { var ch = chartBody(); return card("生日與生命靈數", [profileField(S.def.birthday), ch]); } };
    (S.defs.blocks || []).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (blk) {
      var make = makers[blk.key], node = make ? make() : null; if (node) { root.appendChild(node); NODES[blk.key] = node; }
    });
    var se = searchCard(); root.appendChild(se); NODES.search = se; MAKERS.search = searchCard;
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
