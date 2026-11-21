/* 強積金工具：計數核心（唔掂畫面）。瀏覽器：window.MpfCore；Node 測試：require()
   - allocate()：參考配置（MPF-SPEC.md §4，規則喺 data/mpf/allocation-rules.json）
   - diffFactsheet()：兩期 AIA 基金單張比較（資產分布、十大、經理報告句子）
   - disEquity()：預設投資策略（核心累積基金／65歲後基金）大約股票比例，用嚟對照 */
(function (root) {
  "use strict";

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function sum(o) { var s = 0; for (var k in o) s += o[k]; return s; }

  function matches(fund, bucket) {
    var c = fund.category || "";
    return bucket.match.some(function (m) { return c.indexOf(m) >= 0; });
  }

  /* 預設投資策略：50 歲前約 60% 股票（核心累積基金），50–64 歲每年減，64 歲後約 20%（65歲後基金） */
  function disEquity(age) {
    if (age < 50) return 60;
    if (age >= 64) return 20;
    return Math.round(60 - (age - 50) * 40 / 14);
  }

  function equityCap(rules, years) {
    var g = rules.glide;
    if (years > g.startYears) return 100;
    if (years <= 1) return g.toEquity;
    return Math.round(g.toEquity + (years - 1) / (g.startYears - 1) * (g.fromEquity - g.toEquity));
  }

  /* 喺一組（股票或債券）入面按主題加減，正數加埋唔超過 cap，之後唔可以負數，再拉返做 100 */
  function tiltGroup(base, tilts, cap) {
    var w = {}, k;
    for (k in base) w[k] = base[k];
    var pos = 0;
    tilts.forEach(function (t) { for (var b in t) if (b in w && t[b] > 0) pos += t[b]; });
    var f = pos > cap ? cap / pos : 1;
    tilts.forEach(function (t) { for (var b in t) if (b in w) w[b] += t[b] * f; });
    for (k in w) w[k] = Math.max(0, w[k]);
    var s = sum(w);
    for (k in w) w[k] = s > 0 ? w[k] * 100 / s : 0;
    return w;
  }

  function roundTo(weights, step) {           // 最大餘數法：加埋一定 100
    var keys = Object.keys(weights), units = 100 / step, raw = keys.map(function (k) { return weights[k] / step; });
    var fl = raw.map(Math.floor), left = units - fl.reduce(function (a, b) { return a + b; }, 0);
    var order = raw.map(function (r, i) { return [r - fl[i], i]; }).sort(function (a, b) { return b[0] - a[0]; });
    for (var j = 0; j < left && j < order.length; j++) fl[order[j][1]]++;
    var out = {};
    keys.forEach(function (k, i) { if (fl[i] > 0) out[k] = fl[i] * step; });
    return out;
  }

  /* input: { age, profile, customEquity, nFunds, themeIds, schemeFunds:[market funds of one scheme] }
     themes: themes.json；回傳 { steps:[文字], equity, buckets:[{key,name,weight,cands,why}], warnings, ... } */
  function allocate(rules, themes, input) {
    var steps = [], warnings = [];
    var prof = rules.profiles[input.profile] || rules.profiles.balanced;
    var years = Math.max(0, rules.retireAge - input.age);
    var e0 = input.profile === "custom" ? clamp(+input.customEquity || 0, 0, 100) : prof.equity;
    steps.push("① 風險取向「" + prof.name + "」：股票 " + e0 + "%。");
    var cap = equityCap(rules, years), eq = Math.min(e0, cap);
    if (years > rules.glide.startYears) steps.push("② 距離 " + rules.retireAge + " 歲尚有 " + years + " 年（多過 " + rules.glide.startYears + " 年），唔使減股票。");
    else if (eq < e0) steps.push("② 距離 " + rules.retireAge + " 歲尚有 " + years + " 年，股票上限 " + cap + "%，所以由 " + e0 + "% 減到 " + eq + "%（臨近退休逐步減風險）。");
    else steps.push("② 距離 " + rules.retireAge + " 歲尚有 " + years + " 年，股票上限 " + cap + "%，" + e0 + "% 未超過，唔使減。");

    var B = rules.buckets, eqKeys = [], bdKeys = [];
    for (var k in B) (B[k].kind === "equity" ? eqKeys : bdKeys).push(k);
    var chosen = (themes.themes || []).filter(function (t) { return (input.themeIds || []).indexOf(t.id) >= 0; });
    var eqBase = {}, bdBase = {};
    eqKeys.forEach(function (k) { eqBase[k] = rules.equityCore[k] || 0; });
    var cashPct = years <= rules.cashRamp.withinYears ? clamp((rules.cashRamp.withinYears - years + 1) * rules.cashRamp.perYear, 0, 100) : 0;
    bdKeys.forEach(function (k) { bdBase[k] = k === "cash" ? cashPct : (rules.bondSplit[k] || 0) * (100 - cashPct) / 100; });
    var coreTxt = eqKeys.filter(function (k) { return eqBase[k] > 0; }).map(function (k) { return B[k].name + " " + eqBase[k] + "%"; }).join("、");
    steps.push("③ 股票部分核心比重：" + coreTxt + "。");
    var eqW = tiltGroup(eqBase, chosen.map(function (t) { return t.tilt; }), rules.tiltCap);
    var bdW = tiltGroup(bdBase, chosen.map(function (t) { return t.tilt; }), rules.tiltCap);
    if (chosen.length) steps.push("④ 時事主題（" + chosen.map(function (t) { return t.name; }).join("、") + "）喺股票／債券部分入面微調，最多郁 " + rules.tiltCap + " 個百分點，股票總比例唔變。");
    else steps.push("④ 冇揀時事主題，唔作微調。");
    steps.push("⑤ 債券部分：環球債券同亞洲／港元債券各半" + (cashPct ? "；距離退休 " + years + " 年，其中 " + Math.round(cashPct) + "% 放強積金保守基金" : "") + "。");

    var w = {};
    eqKeys.forEach(function (k) { w[k] = eqW[k] * eq / 100; });
    bdKeys.forEach(function (k) { w[k] = bdW[k] * (100 - eq) / 100; });

    // 計劃冇呢類基金 → 撥去後備類別
    var funds = input.schemeFunds || [];
    var avail = {};
    for (k in B) avail[k] = funds.filter(function (f) { return matches(f, B[k]); });
    var moved = [];
    for (k in B) {
      if (w[k] > 0.01 && !avail[k].length) {
        var to = (B[k].fallback || []).filter(function (x) { return avail[x] && avail[x].length; })[0];
        if (!to) {   // 同一組（股票／非股票）入面任何有基金嘅類別
          var eqK = B[k].kind === "equity";
          to = Object.keys(B).filter(function (x) { return (B[x].kind === "equity") === eqK && avail[x].length; })[0];
        }
        if (to) { w[to] = (w[to] || 0) + w[k]; moved.push(B[k].name + "→" + B[to].name); }
        else warnings.push("呢個計劃冇「" + B[k].name + "」類基金，嗰部分（" + w[k].toFixed(0) + "%）未能配置。");
        w[k] = 0;
      }
    }
    if (moved.length) steps.push("⑥ 呢個計劃冇部分類別，改用相近類別：" + moved.join("、") + "。");

    // 限隻數：細嘅併入同類主要類別
    var n = clamp(+input.nFunds || 3, 1, 8);
    var live = Object.keys(w).filter(function (x) { return w[x] > 0.01; }).sort(function (a, b) { return w[b] - w[a]; });
    if (live.length > n) {
      // 股票、非股票（債券＋保守）各自最少留一隻（嗰組有 5% 或以上），唔會將債券併入股票而令風險變高
      var grp = function (x) { return B[x].kind === "equity" ? "e" : "b"; };
      var keep = [];
      ["e", "b"].forEach(function (g) {
        var top = live.filter(function (x) { return grp(x) === g; });
        var tot = top.reduce(function (a, x) { return a + w[x]; }, 0);
        if (top.length && tot >= 5 && keep.length < n) keep.push(top[0]);
      });
      live.forEach(function (x) { if (keep.length < n && keep.indexOf(x) < 0) keep.push(x); });
      var drop = live.filter(function (x) { return keep.indexOf(x) < 0; }), merged = [];
      drop.forEach(function (x) {
        var tgt = rules.mergeInto[B[x].kind];
        if (keep.indexOf(tgt) < 0) tgt = keep.filter(function (y) { return grp(y) === grp(x); }).sort(function (a, b) { return w[b] - w[a]; })[0] || keep[0];
        w[tgt] += w[x]; merged.push(B[x].name + "→" + B[tgt].name); w[x] = 0;
      });
      steps.push("⑦ 限 " + n + " 隻基金：細嘅類別併入相近類別（" + merged.join("、") + "）。");
    }
    var live2 = {};
    Object.keys(w).forEach(function (x) { if (w[x] > 0.01) live2[x] = w[x]; });
    var rounded = roundTo(live2, rules.roundTo || 5);
    steps.push("⑧ 每項約到 " + (rules.roundTo || 5) + "%，加埋 100%。");

    var buckets = Object.keys(rounded).sort(function (a, b) { return rounded[b] - rounded[a]; }).map(function (x) {
      var cands = avail[x].slice().sort(function (a, b) { return (a.fer == null ? 9 : a.fer) - (b.fer == null ? 9 : b.fer); });
      return { key: x, name: B[x].name, kind: B[x].kind, weight: rounded[x], cands: cands };
    });
    var eqFinal = buckets.filter(function (b) { return b.kind === "equity"; }).reduce(function (a, b) { return a + b.weight; }, 0);
    return { steps: steps, years: years, equityStart: e0, equityCap: cap, equity: eqFinal, profile: prof, buckets: buckets,
             warnings: warnings, themes: chosen, dis: disEquity(input.age) };
  }

  /* 已揀基金 → 加權風險、FER、回報 */
  function portfolioStats(rows) {     // rows: [{weight, fund}]
    var s = { risk: 0, fer: 0, r1: 0, r5: 0, n1: 0, n5: 0 };
    rows.forEach(function (r) {
      var f = r.fund, w = r.weight / 100;
      if (!f) return;
      s.risk += (f.risk || 0) * w; s.fer += (f.fer || 0) * w;
      if (f.ann && f.ann[0] != null) { s.r1 += f.ann[0] * w; s.n1 += w; }
      if (f.ann && f.ann[1] != null) { s.r5 += f.ann[1] * w; s.n5 += w; }
    });
    s.r1 = s.n1 > 0.999 ? s.r1 : null; s.r5 = s.n5 > 0.999 ? s.r5 : null;
    return s;
  }

  /* 「時事部署邏輯」：用主題庫預寫句子＋客人年期砌出嚟 */
  function rationale(res, age) {
    var p = [];
    var lens = res.years > 25 ? "可承受較長期波動，適合以長線增值為主" : res.years > 15 ? "仍有頗長投資年期，可以保持一定增長部署" : res.years > 5 ? "開始接近退休，宜逐步減低波動" : "臨近退休，以保存資本、減少大上大落為先";
    p.push("客戶（" + age + " 歲）距離 " + (age + res.years) + " 歲尚有 " + res.years + " 年，" + lens + "。按「" + res.profile.name + "」取向，股票約佔 " + res.equity + "%（預設投資策略同年齡大約 " + res.dis + "%）。");
    if (res.themes.length) {
      p.push("本次參考 TC Team 揀選嘅 " + res.themes.length + " 個主題：" + res.themes.map(function (t) { return "「" + t.name + "」— " + t.fact + t.logic; }).join(" "));
    }
    return p;
  }

  /* ---------- 基金單張比較 ---------- */
  function splitSentences(t) {
    return (t || "").split(/(?<=[。！？；])/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function simpleKey(s) { return s.replace(/[\d.,%\s]/g, ""); }   // 數字唔同當同一句（例如「錄得 1.5% 回報」）

  var KEYWORDS = [["減息", /減息|降息|rate cut/i], ["加息", /加息|升息|鷹派|hawkish/i], ["通脹", /通脹|inflation/i], ["AI／科技", /人工智能|AI|科技|半導體|晶片/i],
    ["中國", /中國|內地|中港|港股/], ["美國", /美國|美股/], ["地緣政治", /地緣|中東|戰|關稅|貿易/], ["債息", /債息|收益率|孳息/], ["美元", /美元/], ["日本", /日本|日圓/]];

  function keywords(t) { return KEYWORDS.filter(function (k) { return k[1].test(t || ""); }).map(function (k) { return k[0]; }); }

  function diffFactsheet(prev, cur) {
    var out = { alloc: [], topIn: [], topOut: [], topMove: [], newSentences: [], keywords: keywords(cur && cur.reportZh), score: 0,
                topSame: !!(prev && cur && prev.topAsof && prev.topAsof === cur.topAsof) };
    if (!cur) return out;
    var pa = {}; (prev && prev.alloc || []).forEach(function (a) { pa[a[0]] = a[1]; });
    (cur.alloc || []).forEach(function (a) {
      var before = pa[a[0]], d = before == null ? null : +(a[1] - before).toFixed(2);
      out.alloc.push({ label: a[0], now: a[1], before: before == null ? null : before, diff: d });
      if (d != null) out.score += Math.abs(d);
      delete pa[a[0]];
    });
    for (var k in pa) out.alloc.push({ label: k, now: 0, before: pa[k], diff: -pa[k], gone: true });
    var pt = {}; (prev && prev.top10 || []).forEach(function (h) { pt[h[0]] = h[1]; });
    var ct = {}; (cur.top10 || []).forEach(function (h) { ct[h[0]] = h[1]; });
    if (prev && !out.topSame) {
      (cur.top10 || []).forEach(function (h) {
        if (!(h[0] in pt)) out.topIn.push(h); else if (Math.abs(h[1] - pt[h[0]]) >= 0.3) out.topMove.push([h[0], pt[h[0]], h[1]]);
      });
      (prev.top10 || []).forEach(function (h) { if (!(h[0] in ct)) out.topOut.push(h); });
      out.score += out.topIn.length * 1.5;
    }
    var old = {}; splitSentences(prev && prev.reportZh).forEach(function (s) { old[simpleKey(s)] = 1; });
    out.sentences = splitSentences(cur.reportZh).map(function (s) { return { text: s, isNew: !old[simpleKey(s)] }; });
    out.score = +out.score.toFixed(2);
    return out;
  }

  var api = { allocate: allocate, portfolioStats: portfolioStats, rationale: rationale, disEquity: disEquity, equityCap: equityCap,
              diffFactsheet: diffFactsheet, keywords: keywords, roundTo: roundTo, tiltGroup: tiltGroup };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MpfCore = api;
})(this);
