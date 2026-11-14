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
    ["vocab.manage", "關聯詞", function () { vocab(); }], ["layout.manage", "欄位順序", layoutTab], ["social.manage", "社群平台", socialAdmin], ["apps.operate", "App", apps], ["staff.manage", "管理人員", staff], ["", "權限", permissionsTab], ["audit.read", "稽核", audit]
  ];
  function tab(i) {
    menuBtns.forEach(function (b, j) { b.className = j === i ? "on" : ""; });
    var box = document.getElementById("menu-toggle"); if (box) box.checked = false;
    pane.textContent = "";
    visible[i][2]();
  }
  // Staff may open the overview without any special permission; every other tab needs its permission.
  function allowed(t) { return t[0] === "" || me.permissions.indexOf(t[0]) >= 0; }
  function buildMenu() {
    var menu = document.getElementById("menu"); if (!menu) return;
    menu.textContent = "";
    visible = TABS.filter(allowed);
    // Every option is shown directly (nothing hidden under 更多); 會員中心 and 登出 are not in this menu.
    visible.forEach(function (t, i) {
      var b = el("button", { type: "button", text: t[1], onclick: function () { tab(i); } });
      menuBtns.push(b);
      menu.appendChild(b);
    });
  }
  // 權限: a dot chart of who may do what (the same table the server enforces).
  function permissionsTab() {
    api("GET", "/v1/admin/permissions").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("權限", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      // 超級管理員 and 總部秘書 can do everything, so they are not columns; rows only they have are left out too.
      var b = r.body, cols = b.roles.filter(function (x) { return x.role !== "super_admin" && x.role !== "secretary"; });
      var feats = b.features.filter(function (f) { return f.diamond || cols.some(function (x) { return f.roles.indexOf(x.role) >= 0; }); });
      var head = el("tr", {}, [el("th", { text: "功能" })].concat(cols.map(function (x) { return el("th", { class: b.mine.indexOf(x.role) >= 0 ? "me" : "", text: x.label }); })).concat([el("th", { text: "鑽石級以上獎銜" })]));
      var rows = feats.map(function (f) {
        return el("tr", {}, [el("td", { text: f.label })].concat(cols.map(function (x) { return el("td", { class: f.roles.indexOf(x.role) >= 0 ? "y" : "", text: f.roles.indexOf(x.role) >= 0 ? "●" : "·" }); })).concat([el("td", { class: f.diamond ? "y" : "", text: f.diamond ? "●" : "·" })]));
      });
      pane.appendChild(card("權限", [
        el("p", { class: "help", text: "● 可以使用，· 不行。「鑽石級以上獎銜」是身分條件：本人已審核的獎銜達到鑽石級以上，不論職務都可查詢全部會員（只能查詢）。超級管理員與總部秘書擁有全部功能，不列在表內。這張表是各職務的預設權限；另外特別開給某個人的權限，請到「管理人員」查看與設定。標色的欄位是您自己的職務。" }),
        el("table", { class: "dots" }, [head].concat(rows))
      ]));
    });
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

  var STATUS = { active: "正常", disabled: "已停權" };
  function members() {
    var f = { q: "", system: "", center: "", rank: "", status: "", amway: "", country: "", offset: 0 };
    var out = el("div"), info = el("p", { class: "help" }), filt = el("div", { class: "filters" });
    var qi = el("input", { type: "text", placeholder: "會員編號、姓名或會員識別碼", maxlength: 100 });
    function pick(label, key, opts) {
      // The shared dropdown (never a native select): choosing a value only sets the filter; 查詢 runs it.
      var dd = HG.dropdown({ options: [{ value: "", label: label + "：全部" }].concat(opts), value: "", block: true, searchable: opts.length > 8, onchange: function (v) { f[key] = v; } });
      return dd.el;
    }
    function run() {
      f.q = qi.value.trim();
      var qs = Object.keys(f).filter(function (k) { return f[k] !== "" && f[k] !== 0; }).map(function (k) { return k + "=" + encodeURIComponent(f[k]); });
      api("GET", "/v1/admin/members" + (qs.length ? "?" + qs.join("&") : "")).then(function (r) {
        out.textContent = "";
        if (r.status !== 200) { out.appendChild(el("p", { class: "msg bad", text: errText(r) })); return; }
        var b = r.body;
        info.textContent = b.scope.length ? "您可以查詢：" + b.scope.join("、") + (b.can_manage ? "（可管理）" : "（只能查詢，不能修改）") : "您目前沒有可查詢的會員：請先在自己的基本資料填好「地區教育中心」。";
        if (!b.members.length) out.appendChild(el("p", { class: "help", text: "沒有符合的會員。" }));
        b.members.forEach(function (x) {
          var num = x.member_number ? (x.member_number.number.indexOf(x.member_number.country) === 0 ? x.member_number.number : x.member_number.country + x.member_number.number) : "";
          out.appendChild(el("div", { class: "row member-row" }, [
            el("button", { type: "button", class: "linklike", text: (x.display_name || "會員") + (num ? "（" + num + "）" : ""), onclick: function () { pane.textContent = ""; detail(x.member_id); } }),
            el("div", { class: "help", text: [x.system ? "系統：" + x.system : "", x.center ? "中心：" + x.center : "", x.rank ? "獎銜：" + x.rank : "", x.status === "disabled" ? "已停權" : ""].filter(Boolean).join(" ") || "（尚未填寫系統、中心、獎銜）" })
          ]));
        });
        var from = b.total ? f.offset + 1 : 0, to = f.offset + b.members.length;
        out.appendChild(el("div", { class: "inline" }, [
          el("span", { class: "help", text: "第 " + from + "–" + to + " 位，共 " + b.total + " 位" }),
          el("button", { type: "button", class: "small", text: "上一頁", disabled: f.offset <= 0, onclick: function () { f.offset = Math.max(0, f.offset - 30); run(); } }),
          el("button", { type: "button", class: "small", text: "下一頁", disabled: to >= b.total, onclick: function () { f.offset += 30; run(); } })
        ]));
      });
    }
    api("GET", "/v1/admin/member-filters").then(function (r) {
      var c = r.status === 200 ? r.body : { systems: [], centers: [], ranks: [], countries: [] };
      var tw = function (a) { return a.map(function (v) { return { value: v, label: v }; }); };
      filt.appendChild(qi);
      filt.appendChild(pick("系統", "system", tw(c.systems)));
      filt.appendChild(pick("中心", "center", tw(c.centers)));
      filt.appendChild(pick("獎銜", "rank", c.ranks));
      filt.appendChild(pick("狀態", "status", [{ value: "active", label: "正常" }, { value: "disabled", label: "已停權" }]));
      filt.appendChild(pick("Amway", "amway", [{ value: "yes", label: "已勾選" }, { value: "no", label: "未勾選" }]));
      filt.appendChild(pick("國家", "country", tw(c.countries)));
      filt.appendChild(el("div", { class: "inline" }, [el("button", { class: "primary", text: "查詢", onclick: function () { f.offset = 0; run(); } }), el("button", { text: "清除", onclick: function () { pane.textContent = ""; members(); } })]));
    });
    pane.appendChild(card("查詢會員", [info, filt, out]));
    run();
  }
  function detail(id) {
    Promise.all([api("GET", "/v1/admin/members/" + id), api("GET", "/v1/amway/field-definitions")]).then(function (r) {
      if (r[0].status !== 200) { pane.appendChild(card("會員", [el("p", { class: "msg bad", text: errText(r[0]) }), el("button", { text: "← 回到列表", onclick: function () { pane.textContent = ""; members(); } })])); return; }
      var d = r[0].body, defs = r[1].body ? r[1].body.fields : [];
      var adjustable = ["education_system", "education_center", "rank"];
      function view(f) { var st = d.amway[f.key]; return f.label + "：" + show(st ? st.value : null, f.key) + (st && st.pending_value ? "（待審：" + show(st.pending_value, f.key) + "）" : ""); }
      var rows = defs.filter(function (f) { return adjustable.indexOf(f.key) >= 0; }).map(function (f) {
        if (!d.can_manage) return el("div", { class: "row" }, [el("div", { text: view(f) })]);
        var st = d.amway[f.key], box = m(), cur = st ? st.value : null, ctl, dd = null;
        if (f.type === "select") {
          dd = HG.dropdown({ options: [{ value: "", label: "（無）" }].concat(f.options || []), value: cur || "" });
          ctl = dd.el;
        } else { ctl = el("input", { type: "text", maxlength: f.max_length || 50 }); ctl.value = cur || ""; }
        function current() { return String(dd ? dd.get() : ctl.value).trim(); }
        return el("div", { class: "row" }, [el("label", { text: view(f) }),
          el("div", { class: "inline" }, [ctl, el("button", { text: "修改", onclick: function () {
            api("PUT", "/v1/admin/members/" + id + "/amway/" + f.key, { value: current() === "" ? null : current() }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已修改並通知會員" : errText(res)); });
          } }), box])]);
      });
      var box2 = m(), kids = [
        el("p", { class: "mono", text: d.member_id }),
        el("p", { text: "編號：" + d.member_numbers.map(function (n) { return n.number.indexOf(n.country) === 0 ? n.number : n.country + n.number; }).join("、") + " 狀態：" + (STATUS[d.status] || d.status) }),
        el("p", { text: "Amway：" + (d.amway_enabled ? "已勾選" : "未勾選") + (d.spouse ? "；夫妻：" + (d.spouse.display_name || "會員") : "") })
      ].concat(rows);
      if (!d.can_manage) kids.push(el("p", { class: "help", text: "您的身分只能查詢，不能修改。" }));
      if (d.can_manage) {
        kids.push(el("div", { class: "actions" }, [
          el("button", { class: d.status === "active" ? "danger" : "primary", text: d.status === "active" ? "停權" : "解除停權", onclick: function () {
            if (!confirm(d.status === "active" ? "確定要停權這位會員嗎？會立刻在所有裝置登出，且無法再登入。" : "確定要解除停權嗎？")) return;
            api("POST", "/v1/admin/members/" + id + "/status", { status: d.status === "active" ? "disabled" : "active" }).then(function (res) { if (res.status === 200) { pane.textContent = ""; detail(id); } else say(box2, false, errText(res)); });
          } }),
          el("button", { class: "danger", text: "刪除會員", onclick: function () {
            if (!confirm("確定要刪除這位會員嗎？帳號會立即匿名化並關閉，無法復原。")) return;
            api("POST", "/v1/admin/members/" + id + "/delete").then(function (res) {
              if (res.status === 200) { pane.textContent = ""; members(); return; }
              if (res.body && res.body.error && res.body.error.code === "reauth_required") { location.href = "/login?return_to=%2Fadmin"; return; }
              say(box2, false, errText(res));
            });
          } }), box2]));
      }
      kids.push(el("div", { class: "actions" }, [el("button", { text: "← 回到列表", onclick: function () { pane.textContent = ""; members(); } })]));
      pane.appendChild(card(d.display_name || "會員", kids));
    });
  }

  // 詞庫：each suggestion vocabulary is curated on its own (edit, merge, delete); members' saved values follow.
  function vocab(poolKey, keepY) {
    api("GET", "/v1/admin/vocab").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("關聯詞", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var pools = r.body.pools, cur = poolKey || pools[0].pool, bar = el("div", { class: "tabs" });
      pools.forEach(function (p) { bar.appendChild(el("button", { class: p.pool === cur ? "on" : "", text: p.label + "（" + p.terms + "）", onclick: function () { pane.textContent = ""; vocab(p.pool); } })); });
      pane.appendChild(el("h1", { text: "關聯詞" }));
      pane.appendChild(el("p", { class: "help", text: "會員在自由輸入欄位打過的詞，會自動收進對應的關聯詞，之後輸入時當作關聯詞顯示。這裡可以分開管理每一組關聯詞：編輯詞（已填寫的會員資料會一起改）、勾選多個合併成一個、刪除（只從建議中移除，不影響會員已填的內容）。" }));
      pane.appendChild(bar);
      api("GET", "/v1/admin/vocab/" + cur).then(function (t) {
        var terms = t.body.terms, box = m(), picked = {};
        // Reloading after an edit, merge or delete keeps the page where it was (no jump back to the top).
        function reload() { var y = window.scrollY; pane.textContent = ""; vocab(cur, y); }
        function done(res) { if (res.status === 200) reload(); else say(box, false, errText(res)); }
        var add = el("input", { type: "text", placeholder: "新增一個詞", maxlength: 100 });
        var into = el("input", { type: "text", placeholder: "合併後的詞", maxlength: 100 });
        var ordered = !!t.body.ordered;
        // The buttons sit on the left in fixed places and the term on the right; ▲▼ move the row where it is (no reload, the page
        // keeps its place), saved one request after another in the background, so the owner can tap again and again.
        var rowsBox = el("div"), saving = Promise.resolve();
        function move(i, dir) {
          var j = i + dir; if (j < 0 || j >= terms.length) return;
          var before = rowsBox.children[i], top0 = before ? before.getBoundingClientRect().top : null;
          var x = terms[i]; terms[i] = terms[j]; terms[j] = x;
          paint();
          // The page follows the moved row, so it stays under the finger: the same spot can be tapped again and again.
          var after = rowsBox.children[j];
          if (top0 !== null && after) window.scrollBy(0, after.getBoundingClientRect().top - top0);
          saving = saving.then(function () { return api("POST", "/v1/admin/vocab/" + cur + "/move", { term: x.term, direction: dir < 0 ? "up" : "down" }); }).then(function (res) { if (res.status !== 200) say(box, false, errText(res)); });
        }
        function rowOf(x, i) {
          var chk = el("button", { type: "button", class: "chk", role: "checkbox", "aria-checked": picked[x.term] ? "true" : "false", "aria-label": "選取 " + x.term, onclick: function () {
            picked[x.term] = !picked[x.term]; chk.setAttribute("aria-checked", picked[x.term] ? "true" : "false");
          } }, [el("span", { class: "box" })]);
          var tools = [];
          if (ordered) {
            tools.push(el("button", { type: "button", class: "small", text: "▲", "aria-label": "上移 " + x.term, disabled: i === 0, onclick: function () { move(i, -1); } }));
            tools.push(el("button", { type: "button", class: "small", text: "▼", "aria-label": "下移 " + x.term, disabled: i === terms.length - 1, onclick: function () { move(i, 1); } }));
          }
          tools.push(el("button", { class: "btn-edit", text: "編輯", onclick: function () {
            var to = prompt("把「" + x.term + "」改成：", x.term); if (to === null || !to.trim() || to.trim() === x.term) return;
            api("POST", "/v1/admin/vocab/" + cur + "/rename", { from: x.term, to: to.trim() }).then(done);
          } }));
          tools.push(el("button", { class: "danger", text: "刪除", onclick: function () {
            if (!confirm("從建議中刪除「" + x.term + "」？（會員已填的內容不會被改）")) return;
            api("POST", "/v1/admin/vocab/" + cur + "/delete", { term: x.term }).then(done);
          } }));
          if (cur === "education_system") tools.push(el("button", { class: x.hglobal ? "primary" : "", text: x.hglobal ? "✓ 代表 H-Global1985" : "標示為 H-Global1985", onclick: function () {
            api("POST", "/v1/admin/vocab/education_system/hglobal", { term: x.term, hglobal: !x.hglobal }).then(done);
          } }));
          return el("div", { class: "row vocab-row" }, [el("div", { class: "vocab-tools" }, tools), el("div", { class: "vocab-name" }, [el("strong", { text: (ordered ? (i + 1) + ". " : "") + x.term }), el("div", { class: "help", text: "使用 " + x.uses + " 次" })]), chk]);
        }
        function paint() {
          rowsBox.textContent = "";
          if (!terms.length) { rowsBox.appendChild(el("p", { class: "help", text: "這組關聯詞還沒有詞。" })); return; }
          terms.forEach(function (x, i) { rowsBox.appendChild(rowOf(x, i)); });
        }
        paint();
        pane.appendChild(card(t.body.label + "（" + terms.length + " 個詞）", [
          t.body.closed ? el("p", { class: "help", text: "這一組是會員資料頁「" + t.body.label + "」下拉選單的清單：會員只能從這裡選，不會自動新增；用 ▲▼ 調整順序，改了立刻生效。" }) : null,
          cur === "education_system" ? el("p", { class: "help", text: "標示為「代表寰宇」的詞：會員填這個詞又填了「地區教育中心」時，中心與獎銜需要由相同中心的審核員審核；只填系統不需審核。" }) : null,
          el("div", { class: "inline" }, [add, el("button", { class: "primary", text: "新增", onclick: function () { api("POST", "/v1/admin/vocab/" + cur + "/add", { term: add.value }).then(done); } })]),
          el("div", { class: "inline" }, [into, el("button", { text: "把勾選的合併成這個詞", onclick: function () {
            var froms = Object.keys(picked).filter(function (k) { return picked[k]; });
            if (!froms.length) { say(box, false, "請先勾選要合併的詞"); return; }
            if (!into.value.trim()) { say(box, false, "請輸入合併後的詞"); return; }
            api("POST", "/v1/admin/vocab/" + cur + "/merge", { froms: froms, into: into.value.trim() }).then(done);
          } })]),
          box
        , rowsBox]));
        if (keepY) window.scrollTo(0, keepY);
      });
    });
  }

  // 欄位順序: the order of the fields on every member's page (per group), set once for everyone.
  function layoutTab() {
    api("GET", "/v1/admin/profile-layout").then(function (r) {
      if (r.status !== 200) { pane.appendChild(card("欄位順序", [el("p", { class: "msg bad", text: errText(r) })])); return; }
      var groups = r.body.groups, box = m();
      pane.appendChild(el("h1", { text: "欄位順序" }));
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
        el("button", { type: "button", class: "btn-save", text: "儲存順序", onclick: function () {
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
      pane.appendChild(el("p", { class: "help", text: "會員在名片上新增連結時可以選的平台。按 ▲ ▼ 調整順序後按「儲存順序」；可以改名稱、換圖示（會自動縮小）、刪除（已建立的連結會保留，改顯示通用連結圖示）。「自定義」讓會員自己上傳小圖示，不能刪除。" }));
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
        el("button", { type: "button", class: "btn-save", text: "儲存順序", onclick: function () { api("POST", "/v1/admin/social-platforms/reorder", { keys: list.map(function (p) { return p.key; }) }).then(function (res) { say(box, res.status === 200, res.status === 200 ? "已儲存順序" : errText(res)); }); } }),
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
        el("p", { class: "help", text: "權限範圍、聯絡信箱用途、webhook 與服務金鑰在「平台設定」。新 App 預設只有最小權限。" }),
        el("div", { class: "inline" }, [el("button", { class: a ? "btn-save" : "primary", text: a ? "儲存" : "建立", onclick: save }), el("button", { text: "取消", onclick: reload }), box]),
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
    var STD = { webhook: "收到變動與刪除通知（webhook）並驗證簽章", delete_copy: "收到刪除通知就刪除自己這邊的副本", no_email_copy: "不長期保存聯絡信箱，改用中央查詢", snapshot_reconcile: "交易存當時快照，對帳靠付款代碼不靠姓名", least_scope: "只使用被授權的最小權限" };
    function cbox(label, checked, onchange) {
      var b = el("button", { type: "button", class: "chk", role: "checkbox", "aria-checked": checked ? "true" : "false" }, [el("span", { class: "box" }), el("span", { text: label })]);
      b.addEventListener("click", function () { var next = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", next ? "true" : "false"); onchange(next); });
      return b;
    }
    function platform(a, b) {
      api("GET", "/v1/admin/apps/" + encodeURIComponent(a.app_id) + "/platform").then(function (r) {
        if (r.status !== 200) return;
        var p = r.body, box = m(), id = encodeURIComponent(a.app_id);
        var url = el("input", { type: "text", placeholder: "https://…（只能是 https 網域）", value: p.webhook ? p.webhook.url : null });
        var secretBox = el("div", { class: "help" });
        function shown(res) { if (res.status === 200 && res.body.secret) { secretBox.textContent = "金鑰（只顯示這一次，由業主放進 App 的伺服器環境變數，不要貼到對話）：" + res.body.secret; } else if (res.status === 200 && res.body.client_secret) { secretBox.textContent = "服務金鑰（只顯示這一次，由業主放進 App 的伺服器環境變數，不要貼到對話）：" + res.body.client_secret; } else if (!reauth(res)) say(box, false, errText(res)); }
        var chk = {};
        var scopeRows = p.scope_options.map(function (o) {
          var on = p.scopes.indexOf(o.key) >= 0, c = cbox(o.label + "（" + o.key + "）", on, function (v) { chk[o.key] = v; });
          chk[o.key] = on; return el("div", {}, [c]);
        });
        var purposeRows = p.contact_purpose_options.map(function (o) {
          var on = p.contact_purposes.indexOf(o.key) >= 0, c = cbox(o.label + "（" + o.key + "）", on, function (v) { chk["purpose:" + o.key] = v; });
          chk["purpose:" + o.key] = on; return el("div", {}, [c]);
        });
        var dataBoxes = [], lastGroup = "";
        var dataRows = [];
        p.member_data_options.forEach(function (o) {
          if (o.group !== lastGroup) { lastGroup = o.group; dataRows.push(el("div", { class: "help", text: o.group })); }
          var on = p.member_data_fields.indexOf(o.key) >= 0, c = cbox(o.label + "（" + o.key + "）", on, function (v) { chk["data:" + o.key] = v; });
          chk["data:" + o.key] = on; dataBoxes.push(c); dataRows.push(el("div", {}, [c]));
        });
        function setAllData(v) { dataBoxes.forEach(function (c, i) { c.setAttribute("aria-checked", v ? "true" : "false"); chk["data:" + p.member_data_options[i].key] = v; }); }
        function saveScopes() {
          var scopes = p.scope_options.map(function (o) { return o.key; }).filter(function (sc) { return chk[sc]; });
          var purposes = p.contact_purpose_options.map(function (o) { return o.key; }).filter(function (pp) { return chk["purpose:" + pp]; });
          if (!p.scopes_restricted && !confirm("這會把「" + a.name + "」從「全部權限」改成只有勾選的權限，之後沒勾的功能會被拒絕。確定嗎？")) return;
          var fieldsAllowed = p.member_data_options.map(function (o) { return o.key; }).filter(function (k) { return chk["data:" + k]; });
          api("PUT", "/v1/admin/apps/" + id, { name: a.name, scopes: scopes, contact_purposes: purposes, member_data_fields: fieldsAllowed }).then(function (res) { if (res.status === 200) { say(box, true, "已儲存（30 秒內生效）"); } else if (!reauth(res)) say(box, false, errText(res)); });
        }
        var log = (p.webhook_log.events || []).map(function (e) { return el("div", { class: "help", text: e.created_at.slice(0, 16).replace("T", " ") + "｜" + e.type + "｜" + e.status + "（" + e.attempts + " 次" + (e.last_error ? "，" + e.last_error : "") + "）" }); });
        var rep = a.standards || [], ck = a.checks || {};
        var stdRows = Object.keys(STD).map(function (k) {
          var central = k === "webhook" ? ck.webhook_configured : k === "least_scope" ? ck.least_scope : null;
          var ok = (central === null ? rep.indexOf(k) >= 0 : central && rep.indexOf(k) >= 0);
          var note = central === null ? (rep.indexOf(k) >= 0 ? "App 已回報" : "App 尚未回報") : ((central ? "中央已設定" : "中央尚未設定") + "／" + (rep.indexOf(k) >= 0 ? "App 已回報" : "App 尚未回報"));
          return el("div", { class: "help", text: (ok ? "✔ " : "✗ ") + STD[k] + "｜" + note });
        });
        pane.textContent = "";
        pane.appendChild(card("平台設定：" + a.name, [
          el("h3", { text: "標準符合度" }), el("div", {}, stdRows),
          el("h3", { text: "事件通知（webhook）" }),
          p.signing_configured ? null : el("p", { class: "msg bad", text: "尚未設定簽章金鑰（Workers Secret WEBHOOK_SIGNING_KEY），目前不會送出任何事件。" }),
          field("網址", url, "會員資料變動或刪除時通知這個網址；空白＝移除。"),
          el("div", { class: "inline" }, [
            el("button", { class: "btn-save", text: "儲存網址", onclick: function () { api("PUT", "/v1/admin/apps/" + id + "/webhook", { url: url.value.trim() || null }).then(function (res) { if (res.status === 200) { say(box, true, "已儲存"); } else if (!reauth(res)) say(box, false, errText(res)); }); } }),
            el("button", { text: "顯示金鑰", onclick: function () { api("POST", "/v1/admin/apps/" + id + "/webhook/secret", { rotate: false }).then(shown); } }),
            el("button", { text: "重新產生金鑰", onclick: function () { if (confirm("舊金鑰會立刻失效，確定嗎？")) api("POST", "/v1/admin/apps/" + id + "/webhook/secret", { rotate: true }).then(shown); } }),
            el("button", { text: "送一則測試", onclick: function () { api("POST", "/v1/admin/apps/" + id + "/webhook/test").then(function (res) { if (res.status === 200) say(box, res.body.status === "delivered", res.body.status === "delivered" ? "對方已收到（HTTP " + res.body.last_http_status + "）" : "沒有成功：" + (res.body.last_error || res.body.status)); else say(box, false, errText(res)); }); } })
          ]),
          secretBox,
          el("p", { class: "help", text: "待送 " + p.webhook_log.pending + " 則，失敗 " + p.webhook_log.failed + " 則。最近事件：" }), el("div", {}, log.length ? log : [el("div", { class: "help", text: "（沒有）" })]),
          el("h3", { text: "服務金鑰（App 查詢聯絡信箱用）" }),
          el("p", { class: "help", text: p.service_credential ? "已建立。" : "尚未建立。" }),
          el("div", { class: "inline" }, [
            el("button", { text: p.service_credential ? "重新產生服務金鑰" : "建立服務金鑰", onclick: function () { if (!p.service_credential || confirm("舊金鑰會立刻失效，確定嗎？")) api("POST", "/v1/admin/apps/" + id + "/service-secret").then(shown); } }),
            p.service_credential ? el("button", { class: "danger", text: "撤銷", onclick: function () { if (confirm("撤銷後這款 App 不能再查詢，確定嗎？")) api("DELETE", "/v1/admin/apps/" + id + "/service-secret").then(function (res) { if (res.status === 200) say(box, true, "已撤銷"); else if (!reauth(res)) say(box, false, errText(res)); }); } }) : null
          ]),
          el("h3", { text: "權限範圍與聯絡信箱用途" }),
          el("p", { class: "help", text: p.scopes_restricted ? "這款 App 目前只有勾選的權限；沒勾的功能會被拒絕。" : "目前是舊制：這款 App 擁有全部權限（尚未收緊）。勾選後按儲存，才會改成只有勾選的權限；沒勾的功能之後會被拒絕。" }),
          el("div", {}, scopeRows),
          el("p", { class: "help", text: "允許查詢聯絡信箱的用途（沒勾＝不能查詢）：" }), el("div", {}, purposeRows),
          el("h3", { text: "可使用的會員資料欄位（含會員設為隱藏的）" }),
          el("p", { class: "help", text: "會員的「公開／隱藏」只管對外的公開頁；寰宇生態系內的 App 經你勾選後，可以讀取在這款 App 登入過的會員的這些欄位（隱藏的也可以），不必再問會員。沒勾＝不能讀。請先確認隱私權政策已寫明這項用途再勾選。" }),
          el("div", { class: "inline" }, [el("button", { text: "全部勾選", onclick: function () { setAllData(true); } }), el("button", { text: "全部取消", onclick: function () { setAllData(false); } })]),
          el("div", {}, dataRows),
          el("div", { class: "inline" }, [el("button", { class: "btn-save", text: "儲存權限與用途", onclick: saveScopes }), el("button", { text: "返回", onclick: reload }), box])
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
          el("div", { class: "help", text: "平台標準符合 " + (a.standards || []).length + "／5" + (a.checks && a.checks.webhook_failed_events ? "｜webhook 有 " + a.checks.webhook_failed_events + " 則送不出去" : "") }),
          el("div", { class: "inline" }, [
            el("button", { text: "給開發 AI 的串接指令", onclick: function () { handoff(a); } }),
            b.can_manage ? el("button", { text: "平台設定", onclick: function () { platform(a, b); } }) : null,
            b.can_manage ? el("button", { class: "btn-edit", text: "編輯登記資料", onclick: function () { pane.textContent = ""; pane.appendChild(form(b, a)); } }) : null,
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
    Promise.all([api("GET", "/v1/admin/staff"), api("GET", "/v1/admin/permission-catalog")]).then(function (rr) {
      var b = rr[0].body, cat = rr[1].body;
      if (rr[0].status !== 200 || rr[1].status !== 200) { pane.appendChild(card("管理人員", [el("p", { class: "msg bad", text: errText(rr[0].status !== 200 ? rr[0] : rr[1]) })])); return; }
      function labelOf(role) { var f = cat.roles.filter(function (x) { return x.role === role; })[0]; return f ? f.label : role; }
      function permText(g) { var p = cat.permissions.filter(function (x) { return x.permission === g.permission; })[0]; return (p ? p.label : g.permission) + (p && p.scopes.length > 1 ? "（" + cat.scopes[g.scope] + "）" : ""); }
      var panel = el("div"), box = m();
      // Positions (default permissions) and extra permissions are two separate settings: pick a member, tick positions, then the permissions.
      var qi = el("input", { type: "text", placeholder: "搜尋會員（編號、姓名）", maxlength: 100 }), results = el("div");
      function chk(text, on, disabled, change, note) {
        var btn = el("button", { type: "button", class: "chk", role: "checkbox", "aria-checked": on ? "true" : "false", disabled: disabled, onclick: function () { if (!disabled) change(!on); } }, [el("span", { class: "box" }), el("span", { text: text })]);
        return note ? el("span", { class: "chkwrap" }, [btn, el("span", { class: "help", text: note })]) : btn;
      }
      function choose(id, name) {
        Promise.all([api("GET", "/v1/admin/members/" + id)]).then(function (dd) {
          var d = dd[0].body || {}, roleSet = {}, extra = {};
          (d.staff_roles || []).forEach(function (x) { roleSet[x] = true; });
          (d.staff_grants || []).forEach(function (x) { extra[x.permission + ":" + x.scope] = true; });
          var wrap = el("div"), save = m();
          function inheritedBy(perm, scope) { var by = []; cat.roles.forEach(function (rl) { if (roleSet[rl.role] && rl.grants.some(function (g) { return g.permission === perm && g.scope === scope; })) by.push(rl.label); }); return by; }
          function effective() {
            var out = [];
            cat.permissions.forEach(function (p) {
              var sc = p.scopes.filter(function (x) { return inheritedBy(p.permission, x).length || extra[p.permission + ":" + x]; });
              if (sc.length) out.push(p.label + (p.scopes.length > 1 ? "：" + sc.map(function (x) { return cat.scopes[x]; }).join("、") : ""));
            });
            return out;
          }
          function render() {
            wrap.textContent = "";
            wrap.appendChild(el("h3", { text: "① 職務（每個職務有一組預設權限）" }));
            cat.roles.forEach(function (rl) { wrap.appendChild(el("div", {}, [chk(rl.label, !!roleSet[rl.role], false, function (on) { roleSet[rl.role] = on; render(); })])); });
            wrap.appendChild(el("h3", { text: "② 額外權限（在職務預設之外，另外特別開給這個人）" }));
            wrap.appendChild(el("p", { class: "help", text: "已由職務給的權限會打勾並標示「來自職務」，不能在這裡取消；想拿掉就取消那個職務。沒有打勾的可以另外開。" }));
            cat.permissions.forEach(function (p) {
              var line = el("div", { class: "permline" }, [el("div", { class: "permname", text: p.label })]);
              p.scopes.forEach(function (sc) {
                var by = inheritedBy(p.permission, sc), key = p.permission + ":" + sc;
                line.appendChild(chk(p.scopes.length > 1 ? cat.scopes[sc] : "開啟", by.length > 0 || !!extra[key], by.length > 0, function (on) { if (on) extra[key] = true; else delete extra[key]; render(); }, by.length ? "來自職務：" + by.join("、") : ""));
              });
              wrap.appendChild(line);
            });
            wrap.appendChild(el("h3", { text: "③ 實際權限預覽" }));
            var eff = effective();
            wrap.appendChild(el("ul", { class: "plain" }, (eff.length ? eff : ["（沒有任何權限）"]).map(function (t) { return el("li", { text: t }); })));
            if (d.diamond_rank) wrap.appendChild(el("p", { class: "help", text: "另外：本人已審核的獎銜達到鑽石級以上，不論職務都可查詢全部會員（只能查詢）。" }));
            wrap.appendChild(el("div", { class: "actions" }, [el("button", { class: "btn-save", text: "儲存職務與權限", onclick: function () {
              var roles = cat.roles.filter(function (rl) { return roleSet[rl.role]; }).map(function (rl) { return rl.role; });
              var grants = Object.keys(extra).map(function (k) { var i = k.indexOf(":"); return { permission: k.slice(0, i), scope: k.slice(i + 1) }; }).filter(function (g) { return !inheritedBy(g.permission, g.scope).length; });
              api("PUT", "/v1/admin/staff/" + encodeURIComponent(id), { roles: roles, grants: grants }).then(function (res) {
                if (res.status === 200) { pane.textContent = ""; staff(); return; }
                say(save, false, errText(res));
              });
            } }), save]));
          }
          panel.textContent = "";
          panel.appendChild(el("div", { class: "row" }, [el("strong", { text: "職務與權限：" + name }), wrap]));
          render();
        });
      }
      function search() {
        api("GET", "/v1/admin/members?limit=20" + (qi.value.trim() ? "&q=" + encodeURIComponent(qi.value.trim()) : "")).then(function (res) {
          results.textContent = "";
          ((res.body && res.body.members) || []).forEach(function (x) {
            var num = x.member_number ? (x.member_number.number.indexOf(x.member_number.country) === 0 ? x.member_number.number : x.member_number.country + x.member_number.number) : "";
            results.appendChild(el("div", { class: "row" }, [el("button", { type: "button", class: "linklike", text: (x.display_name || "會員") + (num ? "（" + num + "）" : ""), onclick: function () { choose(x.member_id, x.display_name || "會員"); } })]));
          });
          if (!results.children.length) results.appendChild(el("p", { class: "help", text: "沒有符合的會員。" }));
        });
      }
      pane.appendChild(card("管理人員", b.staff.map(function (s) {
        return el("div", { class: "row" }, [el("strong", { text: s.display_name || s.member_id }),
          el("div", { class: "help", text: "職務：" + (s.roles.length ? s.roles.map(labelOf).join("、") : "（無）") + (s.center ? " 中心：" + s.center : "") }),
          s.grants.length ? el("div", { class: "help", text: "額外權限：" + s.grants.map(permText).join("、") }) : null,
          el("button", { type: "button", class: "small btn-edit", text: "編輯職務與權限", onclick: function () { choose(s.member_id, s.display_name || "會員"); } })]);
      })));
      pane.appendChild(card("給予職務與權限", [el("p", { class: "help", text: "搜尋會員、點選名字。職務與權限是兩件事：職務有預設權限，也可以另外特別開更多權限給這個人。" }), el("div", { class: "inline" }, [qi, el("button", { class: "primary", text: "搜尋", onclick: search })]), results, panel]));
      search();
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
