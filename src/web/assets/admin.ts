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
  var me = null, pane = el("div"), menuBtns = [], visible = [];
  var TABS = [
    ["", "總覽", overview], ["members.read", "會員", members],
    ["vocab.manage", "詞庫", function () { vocab(); }], ["layout.manage", "基本資料設定", layoutTab], ["social.manage", "社群平台", socialAdmin], ["apps.operate", "App", apps], ["staff.manage", "管理人員", staff], ["audit.read", "稽核", audit]
  ];
  function tab(i) {
    menuBtns.forEach(function (b, j) { b.className = j === i ? "on" : ""; });
    var box = document.getElementById("menu-toggle"); if (box) box.checked = false;
    var more = document.querySelector("details.more"); if (more) more.open = false;
    pane.textContent = "";
    visible[i][2]();
  }
  // Staff may open the overview without any special permission; every other tab needs its permission.
  function allowed(t) { return t[0] === "" || me.permissions.indexOf(t[0]) >= 0; }
  var PRIMARY = ["總覽", "會員", "App"];
  function buildMenu() {
    var menu = document.getElementById("menu"); if (!menu) return;
    menu.textContent = "";
    visible = TABS.filter(allowed);
    var more = el("div", { class: "drop" });
    visible.forEach(function (t, i) {
      var b = el("button", { type: "button", text: t[1], onclick: function () { tab(i); } });
      menuBtns.push(b);
      (PRIMARY.indexOf(t[1]) >= 0 ? menu : more).appendChild(b);
    });
    if (more.children.length) menu.appendChild(el("details", { class: "more" }, [el("summary", { text: "更多 ▾" }), more]));
    menu.appendChild(el("a", { href: "/me", text: "會員中心" }));
    menu.appendChild(el("a", { href: "/logout", text: "登出" }));
  }
  function overview() {
    api("GET", "/v1/admin/overview").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("總覽", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var b = r.body;
      function stat(n, label, cls) { return el("div", { class: "stat" + (cls ? " " + cls : "") }, [el("b", { text: String(n) }), el("span", { text: label })]); }
      pane.appendChild(el("h1", { text: "總覽" }));
      pane.appendChild(el("p", { class: "help", text: "身分：" + me.roles.map(function (x) { return x.label; }).join("、") }));
      pane.appendChild(el("div", { class: "lights" }, b.lights.map(function (l) { return el("div", { class: "light " + l.color }, [el("i"), el("div", {}, [el("b", { text: l.label }), el("span", { text: l.text })])]); })));
      pane.appendChild(el("div", { class: "stats" }, [
        stat(b.members.total, "會員"), stat(b.members.new_7d, "近 7 天新會員"), stat(b.members.active_7d, "近 7 天登入"),
        stat(b.active_sessions, "App 目前登入數"), stat(b.pending_reviews, "待審核（到通知頁處理）", b.pending_reviews ? "warn" : ""),
        stat(b.apps.active + "／" + b.apps.total, "App 正常／全部", b.apps.killed ? "bad" : b.apps.paused ? "warn" : "")
      ]));
    });
  }
  function card(title, kids) { return el("section", { class: "card" }, [el("h2", { text: title })].concat(kids)); }
  function m() { return el("div", { class: "msg" }); }
  function say(box, ok, t) { box.className = "msg " + (ok ? "ok" : "bad"); box.textContent = t; }

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
        var cur = st ? st.value : null, ctl;
        if (f.type === "select") {
          ctl = el("select", {}, [el("option", { value: "", text: "（無）" })].concat((f.options || []).map(function (o) { return el("option", { value: o.value, text: o.label }); })));
          ctl.value = cur || "";
        } else { ctl = el("input", { type: "text", maxlength: f.max_length || 50 }); ctl.value = cur || ""; }
        return el("div", { class: "row" }, [el("label", { text: f.label + "：" + show(cur, f.key) + (st && st.pending_value ? "（待審：" + show(st.pending_value, f.key) + "）" : "") }),
          el("div", { class: "inline" }, [ctl, el("button", { text: "代調整", onclick: function () {
            api("PUT", "/v1/admin/members/" + id + "/amway/" + f.key, { value: ctl.value.trim() === "" ? null : ctl.value.trim() }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已調整並通知會員" : errText(res)); });
          } }), box])]);
      });
      pane.appendChild(card(d.display_name || "會員", [
        el("p", { class: "mono", text: d.member_id }),
        el("p", { text: "編號：" + d.member_numbers.map(function (n) { return n.number.indexOf(n.country) === 0 ? n.number : n.country + n.number; }).join("、") }),
        el("p", { text: "Amway：" + (d.amway_enabled ? "已勾選" : "未勾選") + (d.spouse ? "；夫妻：" + (d.spouse.display_name || "會員") : "") })
      ].concat(rows)));
    });
  }

  // 詞庫：each suggestion vocabulary is curated on its own (edit, merge, delete); members' saved values follow.
  function vocab(poolKey) {
    api("GET", "/v1/admin/vocab").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("詞庫", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var pools = r.body.pools, cur = poolKey || pools[0].pool, bar = el("div", { class: "tabs" });
      pools.forEach(function (p) { bar.appendChild(el("button", { class: p.pool === cur ? "on" : "", text: p.label + "（" + p.terms + "）", onclick: function () { pane.textContent = ""; vocab(p.pool); } })); });
      pane.appendChild(el("h1", { text: "關聯詞庫" }));
      pane.appendChild(el("p", { class: "help", text: "會員在自由輸入欄位打過的詞，會自動收進對應的詞庫，之後輸入時當作關聯詞顯示。這裡可以分開管理每個詞庫：編輯詞（已填寫的會員資料會一起改）、勾選多個合併成一個、刪除（只從建議中移除，不影響會員已填的內容）。" }));
      pane.appendChild(bar);
      api("GET", "/v1/admin/vocab/" + cur).then(function (t) {
        var terms = t.body.terms, box = m(), picked = {};
        function reload() { pane.textContent = ""; vocab(cur); }
        function done(res) { if (res.status === 200) reload(); else say(box, false, errText(res)); }
        var add = el("input", { type: "text", placeholder: "新增一個詞", maxlength: 100 });
        var into = el("input", { type: "text", placeholder: "合併後的詞", maxlength: 100 });
        var rows = terms.map(function (x) {
          var chk = el("button", { type: "button", class: "chk", role: "checkbox", "aria-checked": "false", "aria-label": "選取 " + x.term, onclick: function () {
            picked[x.term] = !picked[x.term]; chk.setAttribute("aria-checked", picked[x.term] ? "true" : "false");
          } }, [el("span", { class: "box" })]);
          var kids = [chk, el("strong", { text: x.term }), el("span", { class: "help", text: "使用 " + x.uses + " 次" })];
          if (cur === "education_system") kids.push(el("button", { class: x.hglobal ? "primary" : "", text: x.hglobal ? "✓ 代表 H-Global1985" : "標示為 H-Global1985", onclick: function () {
            api("POST", "/v1/admin/vocab/education_system/hglobal", { term: x.term, hglobal: !x.hglobal }).then(done);
          } }));
          kids.push(el("button", { text: "編輯", onclick: function () {
            var to = prompt("把「" + x.term + "」改成：", x.term); if (to === null || !to.trim() || to.trim() === x.term) return;
            api("POST", "/v1/admin/vocab/" + cur + "/rename", { from: x.term, to: to.trim() }).then(done);
          } }));
          kids.push(el("button", { class: "danger", text: "刪除", onclick: function () {
            if (!confirm("從建議中刪除「" + x.term + "」？（會員已填的內容不會被改）")) return;
            api("POST", "/v1/admin/vocab/" + cur + "/delete", { term: x.term }).then(done);
          } }));
          return el("div", { class: "row" }, [el("div", { class: "inline" }, kids)]);
        });
        pane.appendChild(card(t.body.label + "（" + terms.length + " 個詞）", [
          cur === "education_system" ? el("p", { class: "help", text: "標示為「代表 H-Global1985」的詞：會員填這個詞時需要審核，審核通過才有資格。" }) : null,
          el("div", { class: "inline" }, [add, el("button", { class: "primary", text: "新增", onclick: function () { api("POST", "/v1/admin/vocab/" + cur + "/add", { term: add.value }).then(done); } })]),
          el("div", { class: "inline" }, [into, el("button", { text: "把勾選的合併成這個詞", onclick: function () {
            var froms = Object.keys(picked).filter(function (k) { return picked[k]; });
            if (!froms.length) { say(box, false, "請先勾選要合併的詞"); return; }
            if (!into.value.trim()) { say(box, false, "請輸入合併後的詞"); return; }
            api("POST", "/v1/admin/vocab/" + cur + "/merge", { froms: froms, into: into.value.trim() }).then(done);
          } })]),
          box
        ].concat(rows.length ? rows : [el("p", { class: "help", text: "這個詞庫還沒有詞。" })])));
      });
    });
  }

  // 基本資料設定: the order of the fields on every member's page (per group), set once for everyone.
  function layoutTab() {
    api("GET", "/v1/admin/profile-layout").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("基本資料設定", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var groups = r.body.groups, box = m();
      pane.appendChild(el("h1", { text: "基本資料設定" }));
      pane.appendChild(el("p", { class: "help", text: "設定「基本資料」「聯絡與地區」「Amway 專區」每個欄位由上到下的順序，全體會員的資料頁、公開頁和 App 都會照這個順序顯示。按 ▲ ▼ 調整，最後按「儲存順序」。學歷、生日、會員編號的位置固定。" }));
      groups.forEach(function (g) {
        var list = el("div");
        function paint() {
          list.textContent = "";
          g.fields.forEach(function (f, i) {
            list.appendChild(el("div", { class: "row" }, [el("div", { class: "row-head" }, [el("strong", { text: (i + 1) + ". " + f.label }), el("div", { class: "row-tools" }, [
              el("button", { type: "button", class: "small", text: "▲", "aria-label": "上移 " + f.label, disabled: i === 0, onclick: function () { var t = g.fields[i - 1]; g.fields[i - 1] = f; g.fields[i] = t; paint(); } }),
              el("button", { type: "button", class: "small", text: "▼", "aria-label": "下移 " + f.label, disabled: i === g.fields.length - 1, onclick: function () { var t = g.fields[i + 1]; g.fields[i + 1] = f; g.fields[i] = t; paint(); } })
            ])])]));
          });
        }
        paint();
        pane.appendChild(card(g.label, [list]));
      });
      pane.appendChild(el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", text: "儲存順序", onclick: function () {
          var order = {}; groups.forEach(function (g) { order[g.group] = g.fields.map(function (f) { return f.key; }); });
          api("PUT", "/v1/admin/profile-layout", { order: order }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已儲存，全體會員立即套用" : errText(res)); });
        } }),
        el("button", { type: "button", text: "恢復預設順序", onclick: function () {
          if (!confirm("恢復成系統預設的順序？")) return;
          api("PUT", "/v1/admin/profile-layout", { order: null }).then(function (res) { if (res.status === 200) { pane.textContent = ""; layoutTab(); } else say(box, false, errText(res)); });
        } }), box
      ]));
    });
  }

  // 社群平台: the platforms a member can pick for a social link (name, order, icon). Icons are shrunk in the page first.
  function socialAdmin() {
    api("GET", "/v1/admin/social-platforms").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("社群平台", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var list = r.body.platforms, box = m();
      function reload() { pane.textContent = ""; socialAdmin(); }
      function done(res) { if (res.status === 200) reload(); else say(box, false, errText(res)); }
      function shrink(file, size, cb) {
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () {
          var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas"); c.width = size; c.height = size;
          c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
          URL.revokeObjectURL(url);
          var tries = [["image/png", undefined], ["image/webp", 0.8], ["image/jpeg", 0.7]];
          (function next(i) { c.toBlob(function (b) { if (b && (b.size <= 32 * 1024 || i === tries.length - 1)) cb(b); else next(i + 1); }, tries[i][0], tries[i][1]); })(0);
        };
        img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
        img.src = url;
      }
      pane.appendChild(el("h1", { text: "社群平台" }));
      pane.appendChild(el("p", { class: "help", text: "會員在名片上新增社群連結時可以選的平台。按 ▲ ▼ 調整順序後按「儲存順序」；可以改名稱、換圖示（會自動縮小）、刪除（已建立的連結會保留，改顯示通用連結圖示）。「自定義」讓會員自己上傳小圖示，不能刪除。" }));
      var add = el("input", { type: "text", maxlength: 30, placeholder: "新增一個平台（名稱）", "aria-label": "新平台名稱" });
      var card1 = el("section", { class: "card" }, [el("h2", { text: "平台（" + list.length + "）" })]);
      function repaint() {
        card1.textContent = ""; card1.appendChild(el("h2", { text: "平台（" + list.length + "）" }));
        list.forEach(function (p, i) { card1.appendChild(buildRow(p, i)); });
      }
      function buildRow(p, i) {
        var file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "選擇圖示" });
        file.addEventListener("change", function () {
          var f = file.files && file.files[0]; if (!f) return;
          shrink(f, 96, function (b) {
            if (!b) { say(box, false, "這個檔案無法讀取"); return; }
            fetch("/v1/admin/social-platforms/" + encodeURIComponent(p.key) + "/icon", { method: "PUT", credentials: "same-origin", headers: { "content-type": b.type }, body: b }).then(function (x) { return x.text().then(function (t) { done({ status: x.status, body: t ? JSON.parse(t) : null }); }); });
          });
        });
        function swapWith(j) { var t = list[j]; list[j] = list[i]; list[i] = t; repaint(); }
        var tools = [
          el("button", { type: "button", class: "small", text: "▲", "aria-label": "上移 " + p.name, disabled: i === 0, onclick: function () { swapWith(i - 1); } }),
          el("button", { type: "button", class: "small", text: "▼", "aria-label": "下移 " + p.name, disabled: i === list.length - 1, onclick: function () { swapWith(i + 1); } }),
          el("button", { type: "button", class: "small", text: "改名", onclick: function () { var n = prompt("平台名稱：", p.name); if (n === null || !n.trim() || n.trim() === p.name) return; api("PUT", "/v1/admin/social-platforms/" + encodeURIComponent(p.key), { name: n.trim() }).then(done); } }),
          el("button", { type: "button", class: "small", text: "換圖示", onclick: function () { file.click(); } }),
          p.uploaded_icon ? el("button", { type: "button", class: "small", text: "還原預設圖示", onclick: function () { api("DELETE", "/v1/admin/social-platforms/" + encodeURIComponent(p.key) + "/icon").then(done); } }) : null,
          p.custom ? null : el("button", { type: "button", class: "small danger", text: "刪除", onclick: function () { if (!confirm("刪除「" + p.name + "」？（已建立的 " + p.links + " 個連結會保留）")) return; api("DELETE", "/v1/admin/social-platforms/" + encodeURIComponent(p.key)).then(done); } }),
          file
        ];
        return el("div", { class: "row" }, [el("div", { class: "inline" }, [el("img", { class: "adm-ico", src: p.icon_url, alt: "" }), el("strong", { text: p.name }), el("span", { class: "help", text: p.links + " 個連結" + (p.custom ? "（會員自己上傳圖示）" : "") })]), el("div", { class: "inline" }, tools)]);
      }
      repaint();
      pane.appendChild(card1);
      pane.appendChild(el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", text: "儲存順序", onclick: function () { api("POST", "/v1/admin/social-platforms/reorder", { keys: list.map(function (p) { return p.key; }) }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已儲存順序" : errText(res)); }); } }),
        add, el("button", { type: "button", text: "新增平台", onclick: function () { api("POST", "/v1/admin/social-platforms", { name: add.value }).then(done); } }), box
      ]));
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
      function save() {
        var body = { name: name.value, ios_bundle_id: ios.value, android_package: android.value, web_origins: lines(web), return_urls: lines(ret), extra_google_audiences: lines(aud), min_version: min.value };
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
        el("p", { class: "help", text: "所有 App 都擁有全部權限範圍，不需要設定。" }),
        el("div", { class: "inline" }, [el("button", { class: "primary", text: a ? "儲存" : "建立", onclick: save }), el("button", { text: "取消", onclick: reload }), box]),
        a ? el("div", { class: "help", text: "儲存需要 10 分鐘內登入過；會跳到登入頁再回來。" }) : null
      ]);
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
    buildMenu();
    root.appendChild(pane);
    api("GET", "/v1/amway/field-definitions").then(function (d) {
      ((d.body && d.body.fields) || []).forEach(function (f) { labels[f.key] = {}; (f.options || []).forEach(function (o) { labels[f.key][o.value] = o.label; }); });
      tab(0);
    });
  });
})();
`;
