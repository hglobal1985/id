// /assets/common.js — helpers shared by the member pages (window.HG): DOM building, API calls, and the custom
// controls that replace native dropdowns and checkboxes (dropdown, checkbox, suggestions, multi-item input).
// textContent only (no innerHTML with data). Written without template literals so it can live in String.raw.
export const COMMON_JS = String.raw`
(function () {
  "use strict";
  var HG = (window.HG = {});
  var SVGNS = "http://www.w3.org/2000/svg";

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
  HG.el = el;

  function svg(inner, cls) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico" + (cls ? " " + cls : "")); s.setAttribute("aria-hidden", "true");
    s.innerHTML = inner; // fixed icon markup only, never member data
    return s;
  }
  var ICONS = {
    eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
    eyeoff: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><line x1="3" y1="3" x2="21" y2="21" stroke="#e5484d" stroke-width="2.8" stroke-linecap="round"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    floppy: '<path d="M5 3h11l3 3v15H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 3v6h8V3M8 21v-7h8v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    share: '<circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4" stroke="currentColor" stroke-width="2"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
  };
  HG.icon = function (name, cls) { return svg(ICONS[name], cls); };

  HG.api = function (method, path, body, raw) {
    var opt = { method: method, credentials: "same-origin", headers: {} };
    if (raw) { opt.headers["content-type"] = raw.type; opt.body = raw.data; }
    else if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        return { status: r.status, body: j };
      });
    });
  };
  HG.errText = function (res) {
    if (res.status === 413) return "圖片太大，請換一張小一點的";
    if (res.body && res.body.error) {
      var c = res.body.error.code;
      if (c === "reauth_required") return "為了確認是您本人，請先重新登入。";
      if (c === "rate_limited") return "修改太頻繁，請稍後再試。";
      if (c === "amway_disabled") return "請先勾選「我是Amway會員」。";
      return res.body.error.message || "儲存失敗";
    }
    return "發生錯誤，請稍後再試";
  };
  HG.msg = function () { return el("div", { class: "msg" }); };
  HG.say = function (m, ok, text) { m.className = "msg " + (ok ? "ok" : "bad"); m.textContent = text; };

  var toastBox = null, toastTimer = null;
  HG.toast = function (text) {
    if (!toastBox) { toastBox = el("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true }); document.body.appendChild(toastBox); }
    toastBox.textContent = text; toastBox.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastBox.hidden = true; }, 1800);
  };

  HG.initials = function (name) {
    var t = (name || "").trim(); if (!t) return "H";
    var parts = t.split(/\s+/).filter(Boolean), ch = function (x) { return Array.from(x); };
    if (parts.length >= 2) return (ch(parts[0])[0] + ch(parts[parts.length - 1])[0]).toUpperCase();
    var a = ch(parts[0]); return (a.length >= 2 ? a[0] + a[1] : a[0]).toUpperCase();
  };
  HG.bubble = function (size, url, name) {
    return url ? el("img", { class: "avatar " + size, src: url, alt: name || "" }) : el("span", { class: "avatar " + size, role: "img", "aria-label": name || "", text: HG.initials(name) });
  };

  // Characters that confirm one item of a multi-item field (same list as the server's TOKEN_SEPARATORS).
  HG.SEP = /[\s,;:\-#*\/\\'’，、；：。.．]+/;

  // ---- checkbox: a button that looks like a checkbox as big as the text ----
  HG.checkbox = function (label, checked, onchange) {
    var b = el("button", { type: "button", class: "chk", role: "checkbox", "aria-checked": checked ? "true" : "false" }, [el("span", { class: "box" }), el("span", { text: label })]);
    b.addEventListener("click", function () {
      var next = b.getAttribute("aria-checked") !== "true";
      b.setAttribute("aria-checked", next ? "true" : "false");
      if (onchange) onchange(next);
    });
    b.setChecked = function (v) { b.setAttribute("aria-checked", v ? "true" : "false"); };
    return b;
  };

  // ---- dropdown: replaces <select>; options [{value,label}] ----
  HG.dropdown = function (o) {
    var cur = o.value === null || o.value === undefined ? "" : o.value;
    var wrap = el("div", { class: "dd" + (o.block ? " block" : "") });
    var btn = el("button", { type: "button", class: "dd-btn", "aria-haspopup": "listbox", "aria-expanded": "false" });
    var list = el("div", { class: "dd-list", role: "listbox", hidden: true });
    var search = o.searchable ? el("input", { type: "search", class: "dd-search", placeholder: "搜尋", "aria-label": "搜尋" }) : null;
    function labelOf(v) { var f = o.options.filter(function (x) { return x.value === v; })[0]; return f ? f.label : null; }
    function show() { btn.textContent = labelOf(cur) || o.placeholder || "（未選擇）"; }
    function fill(filter) {
      Array.prototype.slice.call(list.querySelectorAll("button")).forEach(function (b) { b.remove(); });
      var q = (filter || "").toLowerCase();
      o.options.forEach(function (opt) {
        if (q && opt.label.toLowerCase().indexOf(q) < 0 && String(opt.value).toLowerCase().indexOf(q) < 0) return;
        list.appendChild(el("button", { type: "button", role: "option", "aria-selected": opt.value === cur ? "true" : "false", text: opt.label, onclick: function () { pick(opt.value); } }));
      });
    }
    function onDoc(e) { if (!wrap.contains(e.target)) close(); }
    function open() { fill(""); if (search) search.value = ""; list.hidden = false; btn.setAttribute("aria-expanded", "true"); document.addEventListener("mousedown", onDoc); document.addEventListener("touchstart", onDoc); if (search) search.focus(); }
    function close() { list.hidden = true; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); }
    function pick(v) { cur = v; show(); close(); if (o.onchange) o.onchange(v); }
    btn.addEventListener("click", function () { if (list.hidden) open(); else close(); });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { close(); btn.focus(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var items = Array.prototype.slice.call(list.querySelectorAll("button")); if (!items.length) return;
      e.preventDefault();
      var i = items.indexOf(document.activeElement); i = e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0); items[i].focus();
    });
    if (search) { list.appendChild(search); search.addEventListener("input", function () { fill(search.value); }); }
    wrap.appendChild(btn); wrap.appendChild(list); show();
    return { el: wrap, get: function () { return cur; }, set: function (v) { cur = v; show(); } };
  };

  // ---- suggestions under a text input; fetcher(q) -> Promise<string[]> (any typed character matches) ----
  HG.suggestBox = function (input, fetcher, onpick) {
    var box = el("div", { class: "sg" }), list = el("div", { class: "sg-list", role: "listbox", hidden: true }), timer = null, idx = -1, seq = 0;
    function hide() { list.hidden = true; idx = -1; }
    function render(items) {
      list.textContent = "";
      if (!items.length) { hide(); return; }
      items.forEach(function (t) { list.appendChild(el("button", { type: "button", role: "option", text: t, onmousedown: function (e) { e.preventDefault(); }, onclick: function () { choose(t); } })); });
      list.hidden = false; idx = -1;
    }
    function choose(t) { hide(); if (onpick) onpick(t); else { input.value = t; input.focus(); } }
    function run() {
      var q = input.value.trim(); var my = ++seq;
      if (!q) { hide(); return; }
      Promise.resolve(fetcher(q)).then(function (items) { if (my === seq) render(items || []); }, hide);
    }
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(run, 150); });
    input.addEventListener("blur", function () { setTimeout(hide, 150); });
    input.addEventListener("keydown", function (e) {
      var items = Array.prototype.slice.call(list.querySelectorAll("button"));
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); idx = e.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items.forEach(function (b, i) { b.className = i === idx ? "cur" : ""; });
      } else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); e.stopPropagation(); choose(items[idx].textContent); }
      else if (e.key === "Escape") hide();
    });
    box.appendChild(input); box.appendChild(list);
    return box;
  };

  // ---- multi-item input (occupation, company, interests): chips; separators or Enter confirm one item ----
  HG.tags = function (o) {
    var items = (o.value || []).slice(), chips = el("span", { class: "chips-in" }), input = el("input", { type: "text", placeholder: o.placeholder || "輸入後按 Enter 或逗號確認", "aria-label": o.label || "項目", maxlength: o.itemMax || 50 });
    var tg = el("div", { class: "tg" });
    function paint() {
      chips.textContent = "";
      items.forEach(function (t, i) {
        chips.appendChild(el("span", { class: "chip" }, [el("span", { text: t }), el("button", { type: "button", "aria-label": "移除 " + t, text: "×", onclick: function () { items.splice(i, 1); paint(); } })]));
      });
    }
    function add(t) {
      t = t.trim(); if (!t) return;
      var dupe = items.some(function (x) { return x.toLowerCase() === t.toLowerCase(); });
      if (!dupe && items.length < (o.max || 20)) items.push(t);
      paint();
    }
    function flush() { HG.SEP.test(input.value) ? input.value.split(HG.SEP).forEach(add) : add(input.value); input.value = ""; }
    input.addEventListener("input", function () {
      if (!HG.SEP.test(input.value)) return;
      var parts = input.value.split(HG.SEP), last = parts.pop(); parts.forEach(add); input.value = last;
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); flush(); }
      else if (e.key === "Backspace" && !input.value && items.length) { items.pop(); paint(); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { if (input.value.trim()) flush(); }, 160); });
    paint();
    var field = input;
    if (o.fetcher) field = HG.suggestBox(input, function (q) { var last = q.split(HG.SEP).pop(); return last ? o.fetcher(last) : []; }, function (t) { input.value = ""; add(t); input.focus(); });
    tg.appendChild(chips); tg.appendChild(field);
    return { el: tg, get: function () { if (input.value.trim()) flush(); return items.slice(); } };
  };
})();
`;
