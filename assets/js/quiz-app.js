/* 產品溫習：畫面。出卷／改卷喺 quiz-core.js；紀錄只存 localStorage（同事自己部機）。 */
(function () {
  "use strict";
  var Q = window.QuizCore;
  var KEY = "tc-quiz-v1";
  var LEVEL = { basic: "基本", advanced: "進階", mixed: "混合" };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  var bank = null, cur = null;   // cur = { opt, items, resps, idx, review }

  // ---------- 紀錄 ----------
  function loadRec() {
    try { var r = JSON.parse(localStorage.getItem(KEY)); if (r && r.v === 1) return r; } catch (e) {}
    return { v: 1, exams: {}, wrong: {}, topics: {} };
  }
  function saveRec(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }

  // ---------- 題庫 ----------
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function loadBank() {
    return getJSON("/data/quiz/index.json").then(function (idx) {
      return Promise.all(idx.products.map(function (p) { return getJSON("/data/quiz/" + p.id + ".json"); })
        .concat([getJSON("/data/quiz/compare.json")])).then(function (files) {
        var cmp = files.pop();
        var b = { index: idx, products: idx.products, byProduct: {}, compare: cmp.questions, byId: {} };
        files.forEach(function (f) { b.byProduct[f.product.id] = f.questions; });
        Object.keys(b.byProduct).forEach(function (k) { b.byProduct[k].forEach(function (q) { b.byId[q.id] = q; }); });
        b.compare.forEach(function (q) { b.byId[q.id] = q; });
        return b;
      });
    });
  }

  // ---------- 揀考試 ----------
  function val(name) { var el = document.querySelector("input[name=" + name + "]:checked"); return el ? el.value : null; }
  function opt() {
    var stage = val("stage"), o = { stage: stage, level: val("level") };
    if (stage === "product") o.product = val("pick");
    if (stage === "series") o.series = val("pick");
    return o;
  }
  function optLabel(o) {
    var name = o.stage === "product" ? (bank.products.filter(function (p) { return p.id === o.product; })[0] || {}).short
      : o.stage === "series" ? o.series + "系列" : "綜合（全部產品）";
    return name + "｜" + LEVEL[o.level];
  }
  function optKey(o) { return [o.stage, o.product || o.series || "all", o.level].join(":"); }

  function renderPicks() {
    var stage = val("stage"), html = "";
    if (stage === "product") {
      html = bank.products.map(function (p, i) {
        return '<label class="qz-pick"><input type="radio" name="pick" value="' + esc(p.id) + '"' + (i ? "" : " checked") + '><span><b>' + esc(p.short) + '</b><small>' + esc(p.name) + '｜' + esc(p.series) + '</small></span></label>';
      }).join("");
    } else if (stage === "series") {
      html = bank.index.series.map(function (s, i) {
        var ps = bank.products.filter(function (p) { return p.series === s; }).map(function (p) { return p.short; });
        return '<label class="qz-pick"><input type="radio" name="pick" value="' + esc(s) + '"' + (i ? "" : " checked") + '><span><b>' + esc(s) + '系列</b><small>' + esc(ps.join("、") || "未有產品") + '</small></span></label>';
      }).join("");
    } else {
      html = '<p class="muted" style="margin:0">全部產品一齊抽：' + esc(bank.products.map(function (p) { return p.short; }).join("、")) + '</p>';
    }
    if (bank.products.length < 2 && stage !== "product") html += '<p class="muted" style="font-size:13px;margin:6px 0 0">而家只有一個產品，同「單一產品」一樣；加多啲產品之後會自動混埋一齊。</p>';
    $("pickList").innerHTML = html;
    updatePool();
  }
  function updatePool() {
    var o = opt(), n = Q.pool(bank, o).length;
    $("poolMsg").textContent = "題庫：" + n + " 題（每次抽 " + Math.min(Q.examSize(o.stage), n) + " 題，選項同數字每次都唔同）";
    $("startBtn").disabled = n === 0;
    var w = Object.keys(loadRec().wrong).filter(function (id) { return bank.byId[id]; }).length;
    $("reviewBtn").textContent = "錯題重溫（" + w + " 題）";
    $("reviewBtn").disabled = w === 0;
  }

  function renderRecord() {
    var r = loadRec(), rows = Object.keys(r.exams).map(function (k) { return r.exams[k]; });
    var html = "";
    if (!rows.length) html = '<p class="muted" style="margin:0">未考過。考完會喺度見到每關最高分同合格紀錄。</p>';
    else {
      html = '<div class="table-wrap" style="max-height:none"><table><tr><th>考試</th><th>次數</th><th>最高分</th><th>合格</th></tr>' +
        rows.sort(function (a, b) { return b.last - a.last; }).map(function (e) {
          return "<tr><td>" + esc(e.label) + "</td><td>" + e.times + "</td><td>" + e.best + "%</td><td>" + (e.passed ? "✅ 過咗" : "未過") + "</td></tr>";
        }).join("") + "</table></div>";
      var weak = Object.keys(r.topics).map(function (t) { var s = r.topics[t]; return { t: t, n: s.total, pct: s.right / s.total }; })
        .filter(function (x) { return x.n >= 3; }).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 3);
      if (weak.length) html += '<p style="margin:12px 0 0"><b>錯得最多：</b>' + weak.map(function (x) { return esc(x.t) + "（啱 " + Math.round(x.pct * 100) + "%）"; }).join("、") + "</p>";
    }
    $("recordBody").innerHTML = html;
  }

  // ---------- 考試 ----------
  function show(id) { ["home", "examView", "resultView"].forEach(function (v) { $(v).classList.toggle("hidden", v !== id); }); window.scrollTo(0, 0); }

  function start(o, review) {
    var items;
    if (review) {
      var rec = loadRec();
      var qs = Object.keys(rec.wrong).map(function (id) { return bank.byId[id]; }).filter(Boolean);
      items = Q.exam(bank, { questions: qs });
    } else items = Q.exam(bank, o);
    if (!items.length) { alert(review ? "冇錯題，做得好！" : "呢個組合未有題目。"); return; }
    cur = { opt: o, items: items, resps: items.map(function (it) { return it.type === "order" ? it.start.slice() : null; }),
      touched: items.map(function () { return false; }), idx: 0, review: !!review };
    $("examTitle").textContent = review ? "錯題重溫" : optLabel(o);
    show("examView");
    renderQ();
  }

  function answered(i) {
    var it = cur.items[i], r = cur.resps[i];
    if (it.type === "order") return cur.touched[i];
    if (it.type === "numeric") return r != null && String(r).trim() !== "";
    if (it.type === "match") return Array.isArray(r) && r.filter(Boolean).length === it.left.length;
    return Array.isArray(r) && r.length > 0;
  }

  function typeHint(it) {
    return { single: "單選", multi: "多選（揀晒所有啱嘅）", tf: "是非題", numeric: "計數題（填數字）", match: "配對", order: "排次序（用 ↑ ↓ 調位）" }[it.type];
  }

  function renderQ() {
    var i = cur.idx, it = cur.items[i], r = cur.resps[i], n = cur.items.length, h = "";
    $("examProg").textContent = "第 " + (i + 1) + " / " + n + " 題";
    $("examBar").style.width = Math.round((i + 1) / n * 100) + "%";
    h += '<div class="qz-meta"><span class="tag">' + esc(typeHint(it)) + '</span><span class="tag">' + esc(it.topic) + "</span></div>";
    h += '<p class="qz-q">' + esc(it.q) + "</p>";
    if (it.options) {
      h += '<div class="qz-opts">' + it.options.map(function (o, k) {
        var on = Array.isArray(r) && r.indexOf(o) >= 0;
        return '<button type="button" class="qz-opt' + (on ? " on" : "") + '" data-k="' + k + '"><span class="qz-mark">' + (it.multi ? (on ? "☑" : "☐") : (on ? "●" : "○")) + "</span>" + esc(o) + "</button>";
      }).join("") + "</div>";
    } else if (it.type === "numeric") {
      h += '<div class="qz-num"><input id="numIn" type="text" inputmode="decimal" autocomplete="off" placeholder="例：12000" value="' + esc(r || "") + '"><span>' + esc(it.unit) + "</span></div>";
    } else if (it.type === "match") {
      h += '<div class="qz-match">' + it.left.map(function (l, k) {
        var sel = (r || [])[k] || "";
        return '<div class="qz-mrow"><span>' + esc(l) + '</span><select data-k="' + k + '"><option value="">揀…</option>' +
          it.right.map(function (x) { return '<option' + (x === sel ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select></div>";
      }).join("") + "</div>";
    } else if (it.type === "order") {
      h += '<ol class="qz-order">' + r.map(function (s, k) {
        return '<li><span>' + esc(s) + '</span><span class="qz-ob"><button type="button" class="btn ghost small" data-up="' + k + '"' + (k ? "" : " disabled") + ' aria-label="上移">↑</button><button type="button" class="btn ghost small" data-down="' + k + '"' + (k === r.length - 1 ? " disabled" : "") + ' aria-label="下移">↓</button></span></li>';
      }).join("") + "</ol>";
    }
    $("qCard").innerHTML = h;
    $("prevBtn").disabled = i === 0;
    $("nextBtn").textContent = i === n - 1 ? "交卷" : "下一題 →";
    $("dots").innerHTML = cur.items.map(function (_, k) {
      return '<button type="button" class="qz-dot' + (k === i ? " cur" : "") + (answered(k) ? " done" : "") + '" data-go="' + k + '">' + (k + 1) + "</button>";
    }).join("");
    var ni = $("numIn"); if (ni) ni.focus({ preventScroll: true });
  }

  function onCard(e) {
    var it = cur.items[cur.idx], i = cur.idx, b;
    if ((b = e.target.closest(".qz-opt"))) {
      var o = it.options[+b.dataset.k], r = cur.resps[i] || [];
      if (it.multi) r = r.indexOf(o) >= 0 ? r.filter(function (x) { return x !== o; }) : r.concat([o]);
      else r = [o];
      cur.resps[i] = r; renderQ();
    } else if ((b = e.target.closest("[data-up],[data-down]"))) {
      var arr = cur.resps[i], k = b.dataset.up != null ? +b.dataset.up : +b.dataset.down, j = b.dataset.up != null ? k - 1 : k + 1;
      var t = arr[k]; arr[k] = arr[j]; arr[j] = t; cur.touched[i] = true; renderQ();
    }
  }
  function onInput(e) {
    var it = cur.items[cur.idx];
    if (e.target.id === "numIn") { cur.resps[cur.idx] = e.target.value; markDot(); }
    if (e.target.tagName === "SELECT" && it.type === "match") {
      var r = cur.resps[cur.idx] || it.left.map(function () { return ""; });
      r[+e.target.dataset.k] = e.target.value; cur.resps[cur.idx] = r; markDot();
    }
  }
  function markDot() { var d = $("dots").children[cur.idx]; if (d) d.classList.toggle("done", answered(cur.idx)); }

  function next() {
    if (cur.idx < cur.items.length - 1) { cur.idx++; renderQ(); window.scrollTo(0, 0); return; }
    var left = cur.items.filter(function (_, k) { return !answered(k); }).length;
    if (left && !confirm("仲有 " + left + " 題未答，未答當錯。確定交卷？")) return;
    finish();
  }

  // 數字＝內部培訓簡報頁數；字串（例如「小冊子 p.12」）＝公開產品小冊子
  function srcText(pages) {
    pages = pages || [];
    var nums = pages.filter(function (p) { return typeof p === "number"; });
    var other = pages.filter(function (p) { return typeof p !== "number"; }).map(function (p) { return String(p).replace(/^小冊子\s*/, "產品小冊子 "); });
    var parts = [];
    if (nums.length) parts.push("培訓簡報第 " + nums.join("、") + " 頁");
    return parts.concat(other).join("；") || "—";
  }

  // ---------- 成績 ----------
  function finish() {
    var s = Q.score(cur.items, cur.resps), rec = loadRec();
    cur.items.forEach(function (it, k) {
      if (s.results[k]) delete rec.wrong[it.id];
      else rec.wrong[it.id] = { n: ((rec.wrong[it.id] || {}).n || 0) + 1, t: Date.now() };
      var tp = rec.topics[it.topic] || (rec.topics[it.topic] = { right: 0, total: 0 });
      tp.total++; if (s.results[k]) tp.right++;
    });
    if (!cur.review) {
      var key = optKey(cur.opt), e = rec.exams[key] || { label: optLabel(cur.opt), times: 0, best: 0, passed: false };
      e.times++; e.best = Math.max(e.best, s.pct); e.passed = e.passed || s.passed; e.last = Date.now();
      rec.exams[key] = e;
    }
    saveRec(rec);

    var head = '<div class="qz-score ' + (s.passed ? "good" : "bad") + '"><b>' + s.right + " / " + s.total + "</b><span>" + s.pct + "%｜" + (s.passed ? "合格 🎉" : "未合格（要 70%）") + "</span></div>";
    head += '<p class="muted" style="margin:10px 0 0">' + esc(cur.review ? "錯題重溫：答啱嘅會由錯題清單移走。" : optLabel(cur.opt)) + "</p>";
    var tps = Object.keys(s.topics).map(function (t) { return { t: t, r: s.topics[t].right, n: s.topics[t].total }; }).sort(function (a, b) { return a.r / a.n - b.r / b.n; });
    head += '<div class="qz-topics">' + tps.map(function (x) { return '<span class="tag' + (x.r < x.n ? " bad" : "") + '">' + esc(x.t) + " " + x.r + "/" + x.n + "</span>"; }).join("") + "</div>";
    $("resultHead").innerHTML = head;

    $("resultList").innerHTML = cur.items.map(function (it, k) {
      var ok = s.results[k];
      return '<div class="qz-res ' + (ok ? "good" : "bad") + '"><div class="qz-res-q"><b>' + (ok ? "✅" : "❌") + " " + (k + 1) + ".</b> " + esc(it.q) + "</div>" +
        (ok ? "" : '<div class="qz-res-a">你答：' + esc(Q.respText(it, cur.resps[k])) + "</div>") +
        '<div class="qz-res-a"><b>正確答案：</b>' + esc(Q.answerText(it)) + "</div>" +
        '<div class="qz-res-x">💡 ' + esc(it.explain) + '<span class="qz-src">出處：' + esc(srcText(it.page)) + "</span></div></div>";
    }).join("");
    show("resultView");
    renderRecord();
  }

  // ---------- 開始 ----------
  function init() {
    loadBank().then(function (b) {
      bank = b;
      renderPicks(); renderRecord();
      $("stageSeg").addEventListener("change", renderPicks);
      $("levelSeg").addEventListener("change", updatePool);
      $("pickList").addEventListener("change", updatePool);
      $("startBtn").onclick = function () { start(opt(), false); };
      $("reviewBtn").onclick = function () { start(opt(), true); };
      $("qCard").addEventListener("click", onCard);
      $("qCard").addEventListener("input", onInput);
      $("qCard").addEventListener("change", onInput);
      $("qCard").addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "numIn") next(); });
      $("prevBtn").onclick = function () { if (cur.idx > 0) { cur.idx--; renderQ(); } };
      $("nextBtn").onclick = next;
      $("dots").addEventListener("click", function (e) { var b = e.target.closest("[data-go]"); if (b) { cur.idx = +b.dataset.go; renderQ(); } });
      $("quitBtn").onclick = function () { if (confirm("放棄今次考試？唔會記錄成績。")) { show("home"); updatePool(); } };
      $("againBtn").onclick = function () { start(cur.opt, cur.review); };
      $("wrongBtn").onclick = function () { start(cur.opt, true); };
      $("homeBtn").onclick = function () { show("home"); updatePool(); };
      $("clearRec").onclick = function () { if (confirm("清除晒你呢部機嘅考試紀錄同錯題？")) { try { localStorage.removeItem(KEY); } catch (e) {} renderRecord(); updatePool(); } };
    }).catch(function (e) {
      $("home").innerHTML = '<div class="note bad" style="margin-top:18px">讀唔到題庫：' + esc(e.message) + "。請重新整理網頁。</div>";
    });
  }
  init();
})();
