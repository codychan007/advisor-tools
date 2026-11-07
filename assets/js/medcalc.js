/* 醫療儲備：純計數（冇畫面），同 medical-saving skill 嘅 premium_schedule.py / make_excel.py 同一套規則。
   - 醫保保費只用 data/aia-medical-premiums.json（AIA 官網保費表）
   - 年齡跟 iPGS：第 n 年終結 = 投保歲數 + n；第 S 年開始提取 = (投保歲數 + S) 歲
   - 附加契約：基本計劃表 × 0.9；標準計劃港元 ÷ 7.84
   - 每年提取金額 = 該歲醫保保費向上取整到美元
   瀏覽器：window.MedCalc；Node 測試：require() */
(function (root) {
  "use strict";

  var SAVINGS = {
    GF: {
      code: "GF", name: "環宇盈活儲蓄保險計劃", ipgsName: "GF - GlobalFlexi", terms: [0, 5],
      brochure: "https://www.aia.com.hk/content/dam/hk-wise/pdf/products/individuals/zh-hk/globalflexi-savings-insurance-plan/GlobalFlexiSavingsInsurancePlan_tc.pdf"
    },
    GP3: {
      code: "GP3", name: "盈御多元貨幣儲蓄保險計劃 3", ipgsName: "GP3 - Global Power Multi-Currency Savings Insurance Plan 3", terms: [0, 3, 5, 10],
      brochure: "https://www.aia.com.hk/content/dam/hk-wise/pdf/products/individuals/zh-hk/global-power-multi-currency-plan-3/GlobalPowerMultiCurrencyPlan3_tc.pdf"
    }
  };
  var HKD_RATE = 7.84, RIDER_FACTOR = 0.9, END_AGE = 90, MAX_END_AGE = 100, MIN_START_YEAR = 3;  // END_AGE = 預設；AIA 保費表同 iPGS 都計到 100 歲

  function termLabel(t) { return t === 0 ? "一次過繳費" : t + "年"; }

  function findTable(plan, o) {
    for (var i = 0; i < plan.tables.length; i++) {
      var t = plan.tables[i];
      if (t.type !== "basic") continue;
      if (plan.sexSpecific && t.sex !== o.sex) continue;
      if (plan.wards.length && t.ward !== o.ward) continue;
      if (plan.deductibles.length && (t.deductible || {}).HKD !== o.deductible) continue;
      if (plan.areas.length && t.area !== o.area) continue;
      return t;
    }
    throw new Error("搵唔到保費表：" + plan.name);
  }

  /* o = {planKey, age, sex:'M'|'F', ward, deductible(HKD 數字), area, rider:bool, startYear, endAge} */
  function schedule(data, o) {
    var plan = data.plans[o.planKey];
    var endAge = o.endAge || END_AGE;
    var ward = plan.wards.length === 1 ? plan.wards[0] : o.ward;
    var table = findTable(plan, { sex: o.sex, ward: ward, deductible: o.deductible, area: o.area });
    var factor = o.rider ? RIDER_FACTOR : 1;
    var rows = [], converted = false;
    for (var a = o.age; a <= endAge; a++) {
      var cell = table.annual[String(Math.min(a, 100))];
      var usd = cell.USD;
      if (usd === null || usd === undefined) { usd = cell.HKD / HKD_RATE; converted = true; }
      usd = Math.round(usd * factor * 100) / 100;
      var n = a - o.age;
      var byWd = n >= o.startYear;
      rows.push({ age: a, n: n, usd: usd, paidBy: byWd ? "withdrawal" : "client", withdrawal: byWd ? Math.ceil(usd - 1e-9) : 0 });
    }
    var dedUSD = table.deductible ? table.deductible.USD : null;
    var client = 0, wd = 0;
    rows.forEach(function (r) { if (r.paidBy === "client") client += r.usd; else wd += r.withdrawal; });
    return {
      desc: {
        plan: plan.name, planKey: o.planKey, riderCode: plan.riderCode, ward: plan.wards.length > 1 ? ward : null,
        deductibleHKD: plan.deductibles.length ? o.deductible : null, deductibleUSD: dedUSD,
        area: plan.areas.length ? o.area : null, rider: !!o.rider,
        riderBasis: o.rider ? "基本計劃保費表 × 90%" : null, effective: table.effective,
        premiumPdf: plan.premiumPdf, brochure: plan.brochure, productPage: plan.page,
        convertedFromHKD: converted, hkdRate: converted ? HKD_RATE : null, generatedFrom: data.generatedOn
      },
      rows: rows,
      totals: { client: client, withdrawals: wd, all: client + wd }
    };
  }

  /* 驗證表格答案；回傳問題清單（空 = OK） */
  function validate(data, f) {
    var p = [];
    if (!f.name) p.push("1. 客人名稱未填");
    if (!(f.age >= 0 && f.age <= 80)) p.push("2. 年齡要係 0–80");
    if (f.sex !== "M" && f.sex !== "F") p.push("3. 性別未揀");
    var sv = SAVINGS[f.savings];
    if (!sv) p.push("6. 儲蓄計劃未揀");
    else if (sv.terms.indexOf(f.payYears) < 0) p.push("7. " + f.savings + " 冇「" + termLabel(f.payYears) + "」");
    if (!(f.premium > 0)) p.push("8. 首年保費未填");
    var plan = data.plans[f.planKey];
    if (!plan) p.push("9. 醫療計劃未揀");
    else {
      if (plan.wards.length > 1 && plan.wards.indexOf(f.ward) < 0) p.push("10. 房型未揀");
      if (plan.deductibles.length && !plan.deductibles.some(function (d) { return d.HKD === f.deductible; })) p.push("11. 自付費未揀");
      if (plan.areas.length && plan.areas.indexOf(f.area) < 0) p.push("12. 地域未揀");
      if (f.rider && (plan.riderAvailable === false || f.planKey === "standard")) p.push("13. " + plan.name + " 冇附加契約版本");
    }
    if (!(f.startYear >= MIN_START_YEAR)) p.push("15. 最早由第 " + MIN_START_YEAR + " 年開始提取");
    var endAge = f.endAge || END_AGE;
    if (!(endAge >= 1 && endAge <= MAX_END_AGE && Math.floor(endAge) === endAge)) p.push("16. 提取到幾多歲要係整數，最高 " + MAX_END_AGE + " 歲");
    else if (f.startYear >= MIN_START_YEAR && f.age + f.startYear > endAge) p.push("15／16. 開始提取（" + (f.age + f.startYear) + " 歲）遲過提取到嘅歲數（" + endAge + " 歲）");
    return p;
  }

  function num(s) {
    s = String(s).replace(/,/g, "").trim();
    if (s === "" || s === "-" || s === "–") return 0;
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  /* iPGS「詳細說明」表：喺 iPGS 選取成個表 Ctrl+C 貼過嚟，或者 skill 嘅 ipgs.txt 格式（1/26 5000 0 ...;2/27 ...）。
     每行：保單年度、歲數（可有可無）、繳付保費總額、現金提取金額、基本金額、保證現金價值、復歸紅利、終期分紅、退保發還金額 */
  function parseIpgs(text, issueAge) {
    var a = parseCells(text, issueAge), b = parseLines(text, issueAge);
    return a.count >= b.count ? a : b;
  }

  /* iPGS 真實複製格式（2026-11-08 Cody 截圖）：每格一行，例如「1 (26歲)」「5,000」「-」「50,506」…
     做法：成段拆做一格格，見到「n (A歲)」就攞跟住 7 格數字 */
  function parseCells(text, issueAge) {
    var out = {}, bad = [];
    var cells = String(text || "").split(/[\n\t;]+/).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ""; });
    for (var i = 0; i < cells.length; i++) {
      var m = cells[i].match(/^(\d+)\s*[（(]\s*(\d+)\s*歲\s*[）)]?$/);
      if (!m) continue;
      var vals = cells.slice(i + 1, i + 8).map(function (c) { return num(c.replace(/US\$|\$/g, "")); });
      if (vals.length < 7 || vals.some(function (v) { return v === null; })) { bad.push(cells[i]); continue; }
      out[+m[1]] = { age: +m[2], paidTotal: vals[0], withdrawal: vals[1], base: vals[2], surrender: vals[6] };
      i += 7;
    }
    return { rows: out, bad: bad, count: Object.keys(out).length };
  }

  function parseLines(text, issueAge) {
    var out = {}, bad = [];
    String(text || "").split(/[\n;]+/).forEach(function (line) {
      var clean = line.replace(/[（(）)\/歲]/g, " ").replace(/US\$|\$/g, "");
      var toks = clean.split(/[\s\t]+/).filter(function (t) { return t !== ""; });
      if (!toks.length || !/^\d+$/.test(toks[0])) return;            // 表頭／空行
      var nums = toks.map(num);
      if (nums.some(function (v) { return v === null; })) return;     // 有文字＝唔係數字行
      var n, age, rest;
      if (nums.length >= 9 && nums[1] === issueAge + nums[0]) { n = nums[0]; age = nums[1]; rest = nums.slice(2); }
      else if (nums.length === 8) { n = nums[0]; age = issueAge + n; rest = nums.slice(1); }
      else { bad.push(line.trim()); return; }
      out[n] = { age: age, paidTotal: rest[0], withdrawal: rest[1], base: rest[2], surrender: rest[6] };
    });
    return { rows: out, bad: bad, count: Object.keys(out).length };
  }

  function check(sched, ipgs, issueAge, startYear, endAge) {
    endAge = endAge || END_AGE;
    var need = {}; sched.rows.forEach(function (r) { need[r.age] = r.withdrawal; });
    var problems = [], rows = [], firstShort = null, early = [];
    for (var n = 1; n <= endAge - issueAge; n++) {
      var age = issueAge + n, p = ipgs.rows[n];
      if (!p) { problems.push("iPGS 數字冇第 " + n + " 年（" + age + " 歲）"); continue; }
      var req = n >= startYear ? need[age] : 0;
      if (n < startYear && p.withdrawal > 0) early.push({ n: n, age: age, withdrawal: p.withdrawal });
      if (n >= startYear && p.withdrawal + 1 < req) {
        problems.push(age + " 歲（第 " + n + " 年）要提 US$" + fmt(req) + "，iPGS 只提到 US$" + fmt(p.withdrawal) + "，差 US$" + fmt(req - p.withdrawal));
        if (firstShort === null) firstShort = age;
      }
      if (n >= startYear && p.surrender <= 0) {
        problems.push(age + " 歲（第 " + n + " 年）提取後退保發還金額係 0，保單可能終止");
        if (firstShort === null) firstShort = age;
      }
      rows.push({ n: n, age: age, need: req, paidTotal: p.paidTotal, withdrawal: p.withdrawal, base: p.base, surrender: p.surrender });
    }
    return { ok: problems.length === 0, problems: problems, rows: rows, firstShort: firstShort, early: early };
  }

  /* 估計最少首年保費（唔係 AIA 計算，只係用今次 iPGS 數字推算）：
     每年「提取前價值 ÷ 上年提取後價值」= 保單自己嘅增長率 g，假設保費加減唔會改變 g，
     第 S−1 年價值跟保費按比例，逐年 A = A × g − 提取，搵 A 一直 > 0 嘅最細倍數 k。
     k = 1 時會完全還原 iPGS 結果。錢用完之後冇 g，用最後 5 年平均。 */
  function estimateMinPremium(rows, startYear, premium) {
    var byN = {}; rows.forEach(function (r) { byN[r.n] = r; });
    var g = {}, known = [];
    rows.forEach(function (r) {
      var p = byN[r.n - 1];
      if (r.n >= 2 && p && p.surrender > 0 && r.surrender > 0 && r.paidTotal <= p.paidTotal + 0.5) {
        g[r.n] = (r.surrender + r.withdrawal) / p.surrender; known.push(r.n);
      }
    });
    var start = byN[startYear - 1];
    if (!start || !(start.surrender > 0) || !known.length) return null;
    var tail = known.slice(-5).map(function (n) { return g[n]; });
    var gx = Math.pow(tail.reduce(function (a, b) { return a * b; }, 1), 1 / tail.length);
    function ok(k) {
      var A = k * start.surrender;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i]; if (r.n < startYear) continue;
        A = A * (g[r.n] || gx) - r.need;
        if (A <= 0) return false;
      }
      return true;
    }
    var lo = 0, hi = 1;
    while (!ok(hi)) { hi *= 1.5; if (hi > 100) return null; }
    for (var j = 0; j < 50; j++) { var m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    var min = premium * hi;
    return { min: min, suggest: Math.ceil(min * 1.03 / 100) * 100, ratio: hi, extrapolated: rows.some(function (r) { return r.n >= startYear && !g[r.n]; }) };
  }

  function fmt(v, d) {
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  var api = { SAVINGS: SAVINGS, HKD_RATE: HKD_RATE, END_AGE: END_AGE, MAX_END_AGE: MAX_END_AGE, MIN_START_YEAR: MIN_START_YEAR,
    termLabel: termLabel, schedule: schedule, validate: validate, parseIpgs: parseIpgs, check: check,
    estimateMinPremium: estimateMinPremium, fmt: fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MedCalc = api;
})(this);
