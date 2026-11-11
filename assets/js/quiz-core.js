/* 產品溫習：出卷同改卷（冇畫面）。
   題庫格式睇 scripts/build_quiz.py。防死背：每次抽唔同題目、版本、錯誤選項，選項次序打亂。
   瀏覽器：window.QuizCore；Node 測試：require() */
(function (root) {
  "use strict";

  var EXAM_SIZE = 15, PASS_RATIO = 0.7;
  var SIZES = { product: 15, series: 30, all: 50 };   // 單一產品 15、系列 30、綜合 50
  function examSize(stage) { return SIZES[stage] || EXAM_SIZE; }

  function rng(seed) {                      // 測試可以傳 seed；網站用 Math.random
    if (seed == null) return Math.random;
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sample(arr, n, rand) { return shuffle(arr, rand).slice(0, Math.min(n, arr.length)); }
  function fill(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, function (m, k) {
      var v = vars[k]; return v == null ? m : (typeof v === "number" ? v.toLocaleString("en-US") : v);
    });
  }

  // 由題庫揀題：stage = product / series / all；level = basic / advanced / mixed
  function pool(bank, opt) {
    var ids = {};
    var pids = opt.stage === "product" ? [opt.product]
      : opt.stage === "series" ? bank.products.filter(function (p) { return p.series === opt.series; }).map(function (p) { return p.id; })
      : bank.products.map(function (p) { return p.id; });
    var out = [];
    function add(q) { if (!ids[q.id]) { ids[q.id] = 1; out.push(q); } }
    pids.forEach(function (pid) { (bank.byProduct[pid] || []).forEach(add); });
    bank.compare.forEach(function (q) {
      if ((q.products || []).some(function (p) { return pids.indexOf(p) >= 0; })) add(q);
    });
    return out.filter(function (q) { return opt.level === "mixed" || q.level === opt.level; });
  }

  // 一條題目變成今次考試嘅版本
  function make(q, rand) {
    var it = { id: q.id, type: q.type, topic: q.topic, level: q.level, explain: q.explain, page: q.page, products: q.products };
    if (q.type === "single" || q.type === "multi") {
      var v = q.variants ? q.variants[Math.floor(rand() * q.variants.length)] : q;
      var correct = q.pickCorrect ? sample(v.correct, q.pickCorrect, rand) : v.correct.slice();
      var nWrong = q.pickWrong || (q.type === "single" ? 3 : 2);
      var wrong = sample(v.wrong || q.wrong || [], nWrong, rand);
      it.q = v.q;
      it.options = shuffle(correct.concat(wrong), rand);
      it.answer = correct;
      it.multi = q.type === "multi";
    } else if (q.type === "tf") {
      var ver = q.versions[Math.floor(rand() * q.versions.length)];
      it.q = ver.s; it.options = ["啱", "錯"]; it.answer = [ver.answer ? "啱" : "錯"];
    } else if (q.type === "numeric") {
      var nv = q.variants[Math.floor(rand() * q.variants.length)];
      it.q = fill(nv.q || q.q, nv); it.unit = q.unit; it.answer = nv.answer;
    } else if (q.type === "match") {
      var pairs = sample(q.pairs, q.pick || 4, rand);
      it.q = q.q; it.left = pairs.map(function (p) { return p[0]; });
      it.right = shuffle(pairs.map(function (p) { return p[1]; }), rand);
      it.answer = pairs.map(function (p) { return p[1]; });
    } else if (q.type === "order") {
      it.q = q.q; it.answer = q.items.slice();
      var s = shuffle(q.items, rand), tries = 0;
      while (s.join("|") === q.items.join("|") && tries++ < 10) s = shuffle(q.items, rand);
      it.start = s;
    }
    return it;
  }

  function exam(bank, opt, seed) {
    var rand = rng(seed);
    var list = opt.questions || pool(bank, opt);
    var n = Math.min(opt.size || (opt.questions ? EXAM_SIZE : examSize(opt.stage)), list.length);
    return sample(list, n, rand).map(function (q) { return make(q, rand); });
  }

  function num(s) { var x = parseFloat(String(s == null ? "" : s).replace(/[,，\s]/g, "")); return isNaN(x) ? null : x; }

  // 改一題：resp = 選咗嘅選項陣列／數字字串／配對陣列／排序陣列
  function grade(it, resp) {
    if (resp == null) return false;
    if (it.type === "single" || it.type === "multi" || it.type === "tf") {
      var a = it.answer.slice().sort().join("|"), r = (resp || []).slice().sort().join("|");
      return a === r;
    }
    if (it.type === "numeric") { var x = num(resp); return x !== null && Math.abs(x - it.answer) < 0.005; }
    if (it.type === "match" || it.type === "order") return (resp || []).join("|") === it.answer.join("|");
    return false;
  }

  function answerText(it) {
    if (it.type === "numeric") return it.answer.toLocaleString("en-US") + " " + (it.unit || "");
    if (it.type === "match") return it.left.map(function (l, i) { return l + " → " + it.answer[i]; }).join("；");
    if (it.type === "order") return it.answer.map(function (s, i) { return (i + 1) + ". " + s; }).join("　");
    return it.answer.join("、");
  }
  function respText(it, resp) {
    if (resp == null || (Array.isArray(resp) && !resp.length) || resp === "") return "（未答）";
    if (it.type === "numeric") return String(resp) + " " + (it.unit || "");
    if (it.type === "match") return it.left.map(function (l, i) { return l + " → " + (resp[i] || "？"); }).join("；");
    if (it.type === "order") return resp.map(function (s, i) { return (i + 1) + ". " + s; }).join("　");
    return resp.join("、");
  }

  function score(items, resps) {
    var right = 0, topics = {};
    var results = items.map(function (it, i) {
      var ok = grade(it, resps[i]);
      if (ok) right++;
      var t = topics[it.topic] || (topics[it.topic] = { right: 0, total: 0 });
      t.total++; if (ok) t.right++;
      return ok;
    });
    var total = items.length;
    return { right: right, total: total, pct: total ? Math.round(right / total * 100) : 0,
      passed: total > 0 && right / total >= PASS_RATIO - 1e-9, results: results, topics: topics };
  }

  var api = { EXAM_SIZE: EXAM_SIZE, SIZES: SIZES, examSize: examSize, PASS_RATIO: PASS_RATIO, pool: pool, make: make, exam: exam,
    grade: grade, score: score, answerText: answerText, respText: respText, shuffle: shuffle, rng: rng, fill: fill };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.QuizCore = api;
})(this);
