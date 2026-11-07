/* 保單整理器 – 畫面 */
(function () {
  "use strict";
  var C = window.PSCore, D = window.PSDocs, $ = function (id) { return document.getElementById(id); };
  var KEY = "ps-draft-v1", MOCK = /[?&]mock=1/.test(location.search);
  var S = { client: {}, policies: [] }, seq = 0, AI = { ready: false };
  var DOCS = {}; // policyId → {kind, pages}（文件唔儲）

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && d.policies) S = d; } catch (e) {} }
  function pol(id) { return S.policies.filter(function (p) { return p.id === id; })[0]; }
  function names() {
    return [S.client.name].concat(String(S.client.other || "").split(/[,，、]/)).map(function (s) { return (s || "").trim(); }).filter(Boolean);
  }
  var SRC = { manual: "", doc: "文件", library: "產品庫" };

  /* ---------- AI 狀態 ---------- */
  function refreshBudget() {
    if (MOCK) { AI = { ready: true, monthHKD: 0, capHKD: 100 }; showAI(); return; }
    fetch("/api/ps-budget").then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { AI = d; showAI(); })
      .catch(function () { AI = { ready: false, offline: true }; showAI(); });
  }
  function showAI() {
    var el = $("aiStatus");
    el.className = "note" + (AI.ready ? " good" : "");
    el.innerHTML = AI.ready
      ? "🤖 AI 讀文件：今個月全組用咗 <b>HK$" + (AI.monthHKD || 0).toFixed(2) + "</b>／上限 HK$" + AI.capHKD + (MOCK ? "（試用模式：假資料，唔收錢）" : "")
      : AI.offline ? "呢度連唔到網站 AI（本機預覽冇伺服器）。上載文件之後可以用「📋 複製去我嘅 AI」免費做；網址加 <b>?mock=1</b> 可以試假資料。"
        : "網站 AI 未設定好。上載文件之後可以用「📋 複製去我嘅 AI」（用你自己嘅 Claude／ChatGPT 等，免費），或者人手輸入。";
  }

  /* ---------- 客人 ---------- */
  function initClient() {
    var c = S.client;
    if (!c.month) { var d = new Date(); c.month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
    if (c.sal === undefined) c.sal = "Mr.";
    $("c-sal").value = c.sal; $("c-name").value = c.name || ""; $("c-year").value = c.year || ""; $("c-month").value = c.month; $("c-other").value = c.other || "";
    [["c-sal", "sal"], ["c-name", "name"], ["c-year", "year"], ["c-month", "month"], ["c-other", "other"]].forEach(function (x) {
      $(x[0]).addEventListener("input", function () {
        var old = S.client.name;
        S.client[x[1]] = this.value;
        if (x[1] === "name") S.policies.forEach(function (p) {   // 持有人／受保人跟住客人名（未改過先跟）
          ["owner", "insured"].forEach(function (k) {
            if (!p.values[k] || p.values[k] === old) { p.values[k] = S.client.name; var i = fieldInput(p.id, k); if (i) i.value = S.client.name; }
          });
        });
        save(); checkAll();
      });
    });
  }

  /* ---------- 保單卡 ---------- */
  function addPolicy() {
    var p = { id: ++seq + "-" + Date.now(), values: {}, from: {}, open: true, warnings: [] };
    C.FIELDS.forEach(function (f) { p.values[f.key] = ""; });
    p.values.owner = p.values.insured = S.client.name || "";
    S.policies.push(p); save();
    renderPolicy(p); checkAll();
    document.getElementById("p-" + p.id).scrollIntoView({ behavior: "smooth" });
  }

  function fieldInput(id, k) { return document.querySelector('#p-' + CSS.escape(id) + ' [data-k="' + k + '"] .ps-in'); }

  function renderPolicy(p) {
    var idx = S.policies.indexOf(p) + 1, el = document.getElementById("p-" + p.id);
    if (!el) { el = document.createElement("div"); el.className = "ps-policy"; el.id = "p-" + p.id; $("policies").appendChild(el); }
    var f = C.FIELDS.map(function (fd) {
      var v = p.values[fd.key] || "", tag = SRC[p.from[fd.key] || "manual"];
      var input = fd.long
        ? '<textarea class="ps-in" rows="2" placeholder="' + esc(fd.hint || "") + '">' + esc(v) + "</textarea>"
        : '<input class="ps-in" type="text" value="' + esc(v) + '" placeholder="' + esc(fd.hint || "") + '">';
      return '<div class="field ps-f' + (fd.long ? " full" : "") + '" data-k="' + fd.key + '"><label>' + esc(fd.short) + (fd.optional ? "（可以唔填）" : "")
        + ' <span class="ps-src">' + (tag ? esc(tag) : "") + "</span></label>"
        + '<div class="ps-inrow">' + input + (fd.optional || fd.scope === "manual" ? "" : '<button class="ps-n" type="button" title="冇呢項保障">N</button>') + "</div></div>";
    }).join("");
    el.innerHTML = '<div class="ps-head"><b class="ps-title"></b><span class="ps-badge"></span>'
      + '<button class="btn ghost small" data-a="toggle" type="button"></button><button class="btn ghost small" data-a="del" type="button">刪除</button></div>'
      + '<div class="ps-body">'
      + '<div class="ps-ai"><div class="actions" style="margin-top:0">'
      + '<label class="btn small" data-upload>📄 上載保單文件（PDF／相）<input type="file" multiple accept="application/pdf,image/*" hidden data-kind="policy"></label>'
      + '<label class="btn small ghost" data-upload>📘 上載產品小冊子（補保障描述）<input type="file" multiple accept="application/pdf,image/*" hidden data-kind="brochure"></label></div>'
      + '<div class="ps-pages"></div><div class="ps-msg"></div></div>'
      + '<div class="form ps-fields">' + f + "</div>"
      + '<div class="actions"><button class="btn ghost small hidden" data-a="saveLib" type="button">將保障描述存入產品庫（全組共用）</button></div>'
      + "</div>";
    el.querySelector(".ps-title").textContent = "保單 " + idx;
    wire(p, el); refreshCard(p); showAI();
  }

  function refreshCard(p) {
    var el = document.getElementById("p-" + p.id); if (!el) return;
    var miss = C.missing(p.values), idx = S.policies.indexOf(p) + 1;
    el.querySelector(".ps-title").textContent = "保單 " + idx + "：" + (p.values.plan || "（未填計劃）");
    var b = el.querySelector(".ps-badge");
    b.textContent = miss.length ? "欠 " + miss.length + " 項" : "✅ 齊";
    b.className = "ps-badge " + (miss.length ? "bad" : "good");
    el.classList.toggle("closed", !p.open);
    el.querySelector('[data-a="toggle"]').textContent = p.open ? "收起" : "展開";
    C.FIELDS.forEach(function (fd) {
      var box = el.querySelector('[data-k="' + fd.key + '"]');
      box.classList.toggle("miss", miss.indexOf(fd.key) >= 0);
      box.querySelector(".ps-src").textContent = SRC[p.from[fd.key] || "manual"] || "";
    });
    var canSave = p.values.plan && C.PRODUCT_KEYS.some(function (k) { return p.values[k] && p.from[k] !== "library"; });
    el.querySelector('[data-a="saveLib"]').classList.toggle("hidden", !canSave || AI.offline);
  }

  function wire(p, el) {
    el.querySelectorAll(".ps-f").forEach(function (box) {
      var k = box.getAttribute("data-k"), inp = box.querySelector(".ps-in");
      inp.addEventListener("input", function () { p.values[k] = inp.value; p.from[k] = "manual"; save(); refreshCard(p); checkAll(); });
      if (k === "plan" || k === "company") inp.addEventListener("change", function () { lookupLibrary(p, false); });
      var n = box.querySelector(".ps-n");
      if (n) n.addEventListener("click", function () { inp.value = "N"; inp.dispatchEvent(new Event("input")); });
    });
    el.querySelector('[data-a="toggle"]').addEventListener("click", function () { p.open = !p.open; save(); refreshCard(p); });
    el.querySelector('[data-a="del"]').addEventListener("click", function () {
      if (!confirm("刪除保單「" + (p.values.plan || "未填") + "」？")) return;
      S.policies.splice(S.policies.indexOf(p), 1); delete DOCS[p.id]; el.remove(); save();
      S.policies.forEach(refreshCard); checkAll();
    });
    el.querySelector('[data-a="saveLib"]').addEventListener("click", function () { saveLibrary(p, el); });
    el.querySelectorAll("input[type=file]").forEach(function (fi) {
      fi.addEventListener("change", function () {
        var files = Array.prototype.slice.call(fi.files); fi.value = "";
        if (files.length) readDocs(p, files, fi.getAttribute("data-kind"));
      });
    });
  }

  function msg(p, html, cls) {
    var m = document.querySelector("#p-" + CSS.escape(p.id) + " .ps-msg");
    m.className = "ps-msg" + (html ? " note " + (cls || "") : "");
    m.innerHTML = html || "";
  }

  /* ---------- 讀文件 → 揀頁 ---------- */
  async function readDocs(p, files, kind) {
    msg(p, "讀緊文件（喺你部機，唔使錢）…");
    try {
      var pages = await D.readFiles(files, function (s) { msg(p, "讀緊：" + esc(s)); });
      var textPages = pages.filter(function (x) { return x.kind === "text"; });
      var pick = C.pickPages(textPages.map(function (x) { return { n: x.id, text: x.text }; }), kind);
      pages.forEach(function (x) {
        x.score = x.kind === "text" ? C.scorePage(x.text) : null;
        x.on = x.kind === "text" ? pick.indexOf(x.id) >= 0 : (pages.filter(function (y) { return y.kind === "image"; }).length <= 4);
      });
      DOCS[p.id] = { kind: kind, pages: pages };
      msg(p, "");
      renderPages(p);
    } catch (e) { msg(p, esc(e.message || e), "bad"); }
  }

  function renderPages(p) {
    var doc = DOCS[p.id], box = document.querySelector("#p-" + CSS.escape(p.id) + " .ps-pages");
    if (!doc) { box.innerHTML = ""; return; }
    var nText = doc.pages.filter(function (x) { return x.kind === "text"; }).length;
    var html = '<div class="ps-pick"><p style="margin:0 0 8px"><b>' + (doc.kind === "brochure" ? "產品小冊子" : "保單文件") + "：揀要交俾 AI 讀嘅頁</b>"
      + (nText ? "<br><small>有文字嘅頁已經按內容自動揀咗最有用嗰幾頁（例如保單附表、保額、保費），條款、定義等冇用嘅頁唔會送。你可以自己加減。</small>" : "")
      + "</p><div class=\"ps-pagelist\">";
    doc.pages.forEach(function (x) {
      if (x.kind === "note") { html += '<div class="muted" style="font-size:13px">' + esc(x.text) + "</div>"; return; }
      html += '<label class="ps-page' + (x.on ? " on" : "") + '" data-pid="' + x.id + '"><input type="checkbox"' + (x.on ? " checked" : "") + ">"
        + (x.kind === "image" ? '<img src="' + x.thumb + '" alt="">' : '<span class="ps-pg-text">' + esc(x.text.slice(0, 90)) + "…</span>")
        + "<span>" + esc(x.file) + " p." + x.n + (x.kind === "text" ? (x.score >= 3 ? ' <em class="tag">有用</em>' : "") : (x.rects && x.rects.length ? ' <em class="tag">已遮 ' + x.rects.length + " 格</em>" : ' <em class="tag warn">圖片</em>')) + "</span>"
        + (x.kind === "image" ? '<button class="btn ghost small" type="button" data-redact="' + x.id + '">遮資料</button>' : "") + "</label>";
    });
    html += "</div>";
    var on = doc.pages.filter(function (x) { return x.on; });
    var masked = on.filter(function (x) { return x.kind === "text"; }).map(function (x) { return C.maskText(x.text, names()); });
    var chars = masked.reduce(function (a, m) { return a + m.text.length; }, 0);
    var imgs = on.filter(function (x) { return x.kind === "image"; });
    var est = C.estimateHKD(chars, imgs.map(function (x) { return { w: x.canvas.width, h: x.canvas.height }; }));
    if (masked.length) {
      html += '<details style="margin-top:8px"><summary>睇會送出嘅文字（已遮 ' + masked.reduce(function (a, m) { return a + m.count; }, 0) + " 處個人資料）</summary><pre class=\"ps-pre\">"
        + esc(masked.map(function (m) { return m.text; }).join("\n\n—\n\n").slice(0, 6000)) + "</pre></details>";
    }
    if (imgs.length) html += '<label class="ps-confirm"><input type="checkbox" id="cf-' + esc(p.id) + '"> 我已經用「遮資料」遮好圖片入面嘅姓名、身份證、地址、電話</label>';
    html += '<div class="actions">'
      + (AI.ready ? '<button class="btn" type="button" data-send' + (on.length ? "" : " disabled") + ">🤖 送去網站 AI（" + on.length + " 頁，約 HK$" + Math.max(0.01, est.hkd).toFixed(2) + "）</button>" : "")
      + '<button class="btn' + (AI.ready ? " ghost" : "") + '" type="button" data-copy' + (on.length ? "" : " disabled") + ">📋 複製去我嘅 AI（免費）</button>"
      + (imgs.length ? '<button class="btn ghost" type="button" data-dlimg>⬇️ 下載遮好嘅相（' + imgs.length + "）</button>" : "")
      + '<button class="btn ghost" type="button" data-cancel>取消</button></div>'
      + '<div class="ps-paste hidden"><p style="margin:10px 0 6px"><b>已複製。</b>去你自己嘅 AI（Claude、ChatGPT、Gemini、Poe 等）開新對話，'
      + (imgs.length ? "<b>先上載啱啱下載嘅 " + imgs.length + " 張遮好嘅相</b>，再" : "") + "貼上（Ctrl + V）送出。AI 回覆之後，成段複製返嚟貼喺下面：</p>"
      + '<textarea class="ps-reply" rows="5" placeholder="將 AI 回覆貼喺度（{ … } 嗰段）"></textarea>'
      + '<div class="actions"><button class="btn" type="button" data-fill>填入</button><button class="btn ghost small" type="button" data-recopy>再複製一次指令</button></div></div></div>';
    box.innerHTML = html;

    box.querySelectorAll(".ps-page").forEach(function (lab) {
      var x = doc.pages.filter(function (y) { return y.id === +lab.getAttribute("data-pid"); })[0];
      lab.querySelector("input").addEventListener("change", function () { x.on = this.checked; renderPages(p); });
    });
    box.querySelectorAll("[data-redact]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        var x = doc.pages.filter(function (y) { return y.id === +b.getAttribute("data-redact"); })[0];
        D.redact(x).then(function (r) { if (r) { x.rects = r; x.on = true; } renderPages(p); });
      });
    });
    box.querySelector("[data-cancel]").addEventListener("click", function () { delete DOCS[p.id]; renderPages(p); });
    var prompt = function () {
      var texts = doc.pages.filter(function (x) { return x.on && x.kind === "text"; }).map(function (x, i) { return { name: x.file, page: x.n, text: masked[i].text }; });
      return C.buildPastePrompt(doc.kind, p.values.plan || "", texts, imgs.length);
    };
    var copyIt = function () {
      if (imgs.length && !document.getElementById("cf-" + p.id).checked) { alert("請先用「遮資料」遮好相入面嘅個人資料，再剔確認。"); return false; }
      var t = prompt();
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).catch(function () {
        var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      });
      box.querySelector(".ps-paste").classList.remove("hidden");
      return true;
    };
    box.querySelector("[data-copy]").addEventListener("click", copyIt);
    box.querySelector("[data-recopy]").addEventListener("click", copyIt);
    var dl = box.querySelector("[data-dlimg]");
    if (dl) dl.addEventListener("click", function () {
      if (!document.getElementById("cf-" + p.id).checked) { alert("請先用「遮資料」遮好相入面嘅個人資料，再剔確認。"); return; }
      imgs.forEach(function (x, i) {
        var a = document.createElement("a");
        a.href = D.applyRects(x).toDataURL("image/jpeg", 0.85);
        a.download = "已遮-" + (i + 1) + ".jpg";
        document.body.appendChild(a); a.click(); a.remove();
      });
    });
    box.querySelector("[data-fill]").addEventListener("click", function () {
      var r = C.parseAIReply(box.querySelector(".ps-reply").value);
      if (r.error) { alert(r.error); return; }
      var filled = applyAI(p, r.fields, doc.kind === "brochure" ? "library" : "doc");
      delete DOCS[p.id]; renderPages(p);
      var w = r.warnings.length ? "<ul>" + r.warnings.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "";
      msg(p, "✅ 由你個 AI 填咗 " + filled + " 格。<b>請逐格核對。</b>" + (doc.kind === "brochure" ? "核對完可以撳下面「將保障描述存入產品庫」，全組下次自動填。" : "") + (w ? "<br>AI 提你留意：" + w : ""), "good");
      if (doc.kind === "policy") lookupLibrary(p, true);
      afterChange(p);
    });
    var sendBtn = box.querySelector("[data-send]");
    if (sendBtn) sendBtn.addEventListener("click", function () {
      if (imgs.length && !document.getElementById("cf-" + p.id).checked) { alert("送圖片之前，請先遮好個人資料，再剔確認。"); return; }
      send(p, doc, masked, imgs, this);
    });
  }

  /* ---------- 送 AI ---------- */
  async function send(p, doc, masked, imgs, btn) {
    btn.disabled = true; btn.textContent = "AI 讀緊，大約 10–30 秒…";
    var texts = doc.pages.filter(function (x) { return x.on && x.kind === "text"; }).map(function (x, i) { return { name: x.file, page: x.n, text: masked[i].text }; });
    var images = imgs.map(function (x) { return D.toJpeg(D.applyRects(x)); });
    var body = { kind: doc.kind, texts: texts, images: images, hint: p.values.plan || "", company: p.values.company, plan: p.values.plan };
    try {
      var d = MOCK ? mockReply(doc.kind) : await fetch("/api/ps-extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return { error: "伺服器回覆唔啱（" + r.status + "）" }; }); });
      if (d.monthHKD !== undefined) { AI.monthHKD = d.monthHKD; AI.capHKD = d.capHKD || AI.capHKD; showAI(); }
      if (d.error) { msg(p, esc(d.error) + (d.costHKD ? "（今次用咗 HK$" + d.costHKD + "）" : ""), "bad"); btn.disabled = false; btn.textContent = "再試一次"; return; }
      var filled = applyAI(p, d.fields || {}, doc.kind === "brochure" ? "library" : "doc");
      delete DOCS[p.id]; renderPages(p);
      var w = (d.warnings || []).length ? "<ul>" + d.warnings.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "";
      msg(p, "✅ AI 填咗 " + filled + " 格（今次 HK$" + (d.costHKD || 0) + "）。" + (doc.kind === "brochure" && d.savedToLibrary ? "保障描述已經存入產品庫，全組下次免費用。" : "")
        + "<b>請逐格核對。</b>" + (w ? "<br>AI 提你留意：" + w : ""), "good");
      if (doc.kind === "policy") lookupLibrary(p, true);
      afterChange(p);
    } catch (e) {
      msg(p, "連唔到 AI，請再試一次。", "bad"); btn.disabled = false; btn.textContent = "再試一次";
    }
  }

  function applyAI(p, fields, from) {
    var n = 0;
    Object.keys(fields).forEach(function (k) {
      var v = String(fields[k] || "").trim();
      if (!v || p.from[k] === "manual" && !C.blank(p.values[k])) return;
      if (C.FIELDS.every(function (f) { return f.key !== k || f.scope === "manual"; })) return;
      p.values[k] = v; p.from[k] = from; n++;
      var i = fieldInput(p.id, k); if (i) i.value = v;
    });
    return n;
  }

  /* ---------- 產品庫 ---------- */
  function lookupLibrary(p, afterAI) {
    if (AI.offline || !p.values.plan) return;
    var q = MOCK ? Promise.resolve({ found: false }) : fetch("/api/ps-product?company=" + encodeURIComponent(p.values.company || "") + "&plan=" + encodeURIComponent(p.values.plan))
      .then(function (r) { return r.json(); });
    q.then(function (d) {
      var needs = C.PRODUCT_KEYS.filter(function (k) { return C.blank(p.values[k]); });
      if (d.found) {
        var n = 0;
        needs.forEach(function (k) { if (d.fields && d.fields[k]) { p.values[k] = d.fields[k]; p.from[k] = "library"; var i = fieldInput(p.id, k); if (i) i.value = d.fields[k]; n++; } });
        if (n) appendMsg(p, "📘 產品庫有「" + esc(d.plan) + "」，已經補咗 " + n + " 格保障描述（唔使錢）。");
        afterChange(p);
      } else if (afterAI && needs.length) {
        appendMsg(p, "📘 產品庫未有呢個產品。保障描述仲欠 " + needs.length + " 格：可以撳「上載產品小冊子」等 AI 補（之後全組免費），或者自己填。");
      }
    }).catch(function () {});
  }
  function appendMsg(p, html) {
    var m = document.querySelector("#p-" + CSS.escape(p.id) + " .ps-msg");
    if (!m.innerHTML) m.className = "ps-msg note";
    m.innerHTML += (m.innerHTML ? "<br>" : "") + html;
  }
  function saveLibrary(p, el) {
    var fields = {};
    C.PRODUCT_KEYS.forEach(function (k) { if (!C.blank(p.values[k])) fields[k] = p.values[k]; });
    var b = el.querySelector('[data-a="saveLib"]'); b.disabled = true;
    var q = MOCK ? Promise.resolve({ ok: true }) : fetch("/api/ps-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: p.values.company, plan: p.values.plan, fields: fields }) }).then(function (r) { return r.json(); });
    q.then(function (d) {
      b.disabled = false;
      if (d.ok) { C.PRODUCT_KEYS.forEach(function (k) { if (fields[k]) p.from[k] = "library"; }); save(); refreshCard(p); appendMsg(p, "📘 已經存入產品庫，全組同事下次見到「" + esc(p.values.plan) + "」會自動填。"); }
      else appendMsg(p, esc(d.error || "存唔到"));
    });
  }

  function afterChange(p) { save(); refreshCard(p); checkAll(); }

  /* ---------- 出 Excel ---------- */
  function checkAll() {
    var html = "";
    if (!S.policies.length) html = '<p class="muted">未加保單。</p>';
    else html = "<ul class=\"ps-check\">" + S.policies.map(function (p, i) {
      var miss = C.missing(p.values);
      return "<li class=\"" + (miss.length ? "bad" : "good") + "\">保單 " + (i + 1) + "（" + esc(p.values.plan || "未填計劃") + "）："
        + (miss.length ? "欠 " + miss.map(function (k) { return C.FIELDS.filter(function (f) { return f.key === k; })[0].short; }).join("、") : "✅ 齊") + "</li>";
    }).join("") + "</ul>";
    if (!S.client.name) html = '<p class="note bad" style="margin:0 0 8px">未填客人英文名</p>' + html;
    $("checkList").innerHTML = html;
  }
  function ready() { return S.client.name && S.policies.length && S.policies.every(function (p) { return !C.missing(p.values).length; }); }

  $("dlBtn").addEventListener("click", function () {
    if (!ready()) { $("dlMsg").textContent = "仲有資料未齊（睇上面紅色），補齊或者填「N」先可以出 Excel。"; return; }
    $("dlMsg").textContent = "整緊…";
    window.PSExcel.download({ salutation: S.client.sal, name: S.client.name, birthYear: S.client.year, month: S.client.month }, S.policies)
      .then(function (n) { $("dlMsg").textContent = "已下載：" + n; }, function (e) { $("dlMsg").textContent = "出唔到：" + e.message; });
  });
  $("clearAll").addEventListener("click", function () {
    if (!confirm("清除呢個客人所有資料（呢部機）？")) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  });
  $("addPolicy").addEventListener("click", addPolicy);

  /* ---------- 試用模式（?mock=1）：唔叫 AI，用假資料試流程 ---------- */
  function mockReply(kind) {
    if (kind === "brochure") return { fields: { company: "AIA", plan: "自願醫保睿選計劃", coverage: "自願醫保-醫療", medical: "實報實銷，終身限額 6,000 萬港元", accMedical: "意外急症門診全數賠償", tpd: "N", compassionate: "HK$10,000", hospCash: "N" }, warnings: [], savedToLibrary: true, costHKD: 0, monthHKD: 0, capHKD: 100 };
    return { fields: { company: "AIA", policyNo: "U123456789", effectiveDate: "2026/9/1", plan: "自願醫保睿選計劃 AVSW", payTerm: "終身", coverTo: "終身", payMode: "年", currency: "USD", life: "N", adb: "N", accHospCash: "N", ci: "N", accountValue: "N", premium: "HK$3,900.00", coverage: "", medical: "" }, warnings: ["文件冇寫醫療保障限額，請補充"], costHKD: 0, monthHKD: 0, capHKD: 100 };
  }

  /* ---------- 開始 ---------- */
  load();
  S.policies.forEach(function (p) { var n = parseInt(p.id, 10); if (n > seq) seq = n; });
  initClient();
  refreshBudget();
  if (!S.policies.length) addPolicy(); else S.policies.forEach(renderPolicy);
  checkAll();
})();
