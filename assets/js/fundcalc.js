/* 基金分析：純計數（冇畫面）。同 scripts/build_funds.py 用同一套計法（tests/fund.test.js 核對兩邊一致）。
   數據：data/funds/<code>.json = { prices: [["YYYY-MM-DD", 價格], ...], dividends: [["除息日", 每單位派息, 年化派息率%, 本金佔%], ...] }
   - 買入：開始日當日或之後第一個 AIA 價格
   - AIA 價格日期比基金除息日遲一個工作天，所以「除息日之後第一個 AIA 價格」= 除息日資產淨值（再投資用呢個價）
   - 收現金：派息 = 單位 × 每單位派息；再投資：派息按上面價格買返單位
   瀏覽器：window.FundCalc；Node 測試：require() */
(function (root) {
  "use strict";

  function idx(rows, date, strict) {           // 第一個 > date（strict）或 >= date 嘅位置
    var lo = 0, hi = rows.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (strict ? rows[mid][0] <= date : rows[mid][0] < date) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  function onOrBefore(prices, date) { var i = idx(prices, date, true) - 1; return i >= 0 ? prices[i] : null; }
  function onOrAfter(prices, date) { var i = idx(prices, date, false); return i < prices.length ? prices[i] : null; }
  function after(prices, date) { var i = idx(prices, date, true); return i < prices.length ? prices[i] : null; }

  function addDays(date, n) {
    var d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }
  function addYears(date, n) { return addDays(date, -Math.round(365 * -n)); }
  function days(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }

  /* 派息（d）同「基金內部派息調整」（r：唔派現金嘅基金，AIA 自動再投資，價格冇反映，按 AIA 每年回報補返）由舊到新 */
  function flows(fd) {
    var out = (fd.dividends || []).map(function (d) { return { date: d[0], amt: d[1], kind: "d", yld: d[2], cap: d[3] }; });
    (fd.reinvest || []).forEach(function (r) { out.push({ date: r[0], amt: r[1], kind: "r" }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  /* 同 build_funds.py total_return：start 當日（或之前）價格 → end，派息再投資，回報 % */
  function totalReturn(fd, start, end) {
    var p0 = onOrBefore(fd.prices, start), p1 = onOrBefore(fd.prices, end);
    if (!p0 || !p1) return null;
    var units = 1;
    flows(fd).forEach(function (d) {
      if (d.date > start && d.date <= end) { var n = after(fd.prices, d.date); if (n) units *= 1 + d.amt / n[1]; }
    });
    return (p1[1] * units / p0[1] - 1) * 100;
  }

  /* 總回報指數（派息再投資），start 嗰日 = 100；超過 400 日就每星期一點，圖唔會太重 */
  function trIndex(fd, start, end) {
    var i = Math.max(0, idx(fd.prices, start, true) - 1), fl = flows(fd), k = 0, units = 1, out = [];
    var p0 = fd.prices[i];
    while (k < fl.length && fl[k].date <= p0[0]) k++;
    var span = days(p0[0], end || fd.prices[fd.prices.length - 1][0]), lastKept = null;
    for (var j = i; j < fd.prices.length; j++) {
      var p = fd.prices[j];
      if (end && p[0] > end) break;
      while (k < fl.length && fl[k].date < p[0]) { var n = after(fd.prices, fl[k].date); if (n) units *= 1 + fl[k].amt / n[1]; k++; }
      var v = p[1] * units / p0[1] * 100;
      var isLast = j === fd.prices.length - 1 || (end && fd.prices[j + 1][0] > end);
      if (span <= 400 || !lastKept || days(lastKept, p[0]) >= 7 || isLast) { out.push([p[0], v]); lastKept = p[0]; }
    }
    return out;
  }

  function annualise(pct, nDays) {
    if (pct == null || nDays < 30) return null;
    return (Math.pow(1 + pct / 100, 365 / nDays) - 1) * 100;
  }

  /* 一隻基金由 start 到 end。派息：收現金或再投資；基金內部派息調整：一定再投資（AIA 自動做） */
  function runFund(fd, invest, start, end, mode) {
    var buy = onOrAfter(fd.prices, start);
    if (!buy || buy[0] > end) return null;
    var units = invest / buy[1], units0 = units, cash = 0, events = [], steps = [];
    flows(fd).forEach(function (d) {
      if (d.date < buy[0] || d.date > end) return;  // 買入日之前除息嘅唔計；買入日當日除息要計（AIA 價格遲一日，買入價仍然連息）
      var value = units * d.amt, nav = after(fd.prices, d.date);
      if (d.kind === "r") {
        if (nav) units += value / nav[1];
        steps.push({ date: d.date, unitsAfter: units, cashAfter: cash });
        return;
      }
      var ev = { date: d.date, perUnit: d.amt, units: units, amount: value, yieldPct: d.yld, capitalPct: d.cap };
      if (mode === "reinvest") {
        if (!nav) return;
        ev.price = nav[1]; ev.newUnits = value / nav[1];
        units += ev.newUnits;
      } else {
        cash += value;
      }
      ev.unitsAfter = units; ev.cashAfter = cash;
      events.push(ev);
      steps.push({ date: d.date, unitsAfter: units, cashAfter: cash });
    });
    var last = onOrBefore(fd.prices, end);
    var endValue = units * last[1];
    var dividendsTotal = events.reduce(function (s, e) { return s + e.amount; }, 0);
    var total = endValue + cash;
    return {
      invest: invest, buyDate: buy[0], buyPrice: buy[1], units0: units0, units: units,
      endDate: last[0], endPrice: last[1], endValue: endValue, cash: cash, dividends: events, steps: steps,
      dividendsTotal: dividendsTotal, total: total,
      returnPct: (total / invest - 1) * 100,
      priceChangePct: (last[1] / buy[1] - 1) * 100
    };
  }

  /* 喺某日嘅組合價值（連已收現金）同只計價格嘅價值 */
  function valueAt(fd, r, date) {
    var p = onOrBefore(fd.prices, date);
    if (!p || date < r.buyDate) return { total: r.invest, priceOnly: r.invest };
    var units = r.units0, cash = 0;
    for (var i = 0; i < r.steps.length && r.steps[i].date <= date; i++) {
      units = r.steps[i].unitsAfter; cash = r.steps[i].cashAfter;
    }
    return { total: units * p[1] + cash, priceOnly: r.units0 * p[1] };
  }

  function check(input, meta) {
    var errs = [];
    var items = input.items.filter(function (it) { return it.code; });
    if (!items.length) errs.push("最少揀一隻基金");
    var seen = {};
    items.forEach(function (it) { if (seen[it.code]) errs.push("「" + meta[it.code].name + "」揀咗兩次"); seen[it.code] = 1; });
    var sum = items.reduce(function (s, it) { return s + (Number(it.weight) || 0); }, 0);
    if (items.length && Math.abs(sum - 100) > 0.01) errs.push("各基金 % 加埋要等於 100%（而家係 " + fmt(sum, 2).replace(/\.?0+$/, "") + "%）");
    items.forEach(function (it) { if (!(Number(it.weight) > 0)) errs.push("「" + meta[it.code].name + "」嘅 % 要大過 0"); });
    var cur = {};
    items.forEach(function (it) { cur[meta[it.code].currency] = 1; });
    if (Object.keys(cur).length > 1) errs.push("組合只可以揀同一種貨幣嘅基金");
    if (!(Number(input.amount) > 0)) errs.push("請填投資金額");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start || "")) errs.push("請揀開始日子");
    var earliest = earliestStart(items, meta);
    if (earliest && input.start && input.start < earliest.date)
      errs.push("「" + meta[earliest.code].name + "」嘅完整數據由 " + earliest.date + " 先有，開始日子最早只可以係 " + earliest.date);
    var latest = latestDate(items, meta);
    if (latest && input.start && input.start >= latest) errs.push("開始日子要早過最新價格日（" + latest + "）");
    return errs;
  }

  function earliestStart(items, meta) {
    var best = null;
    items.forEach(function (it) {
      var m = meta[it.code]; if (!m || !m.dataFrom) return;
      if (!best || m.dataFrom > best.date) best = { date: m.dataFrom, code: it.code };
    });
    return best;
  }
  function latestDate(items, meta) {
    var d = null;
    items.forEach(function (it) { var m = meta[it.code]; if (m && (!d || m.priceDate < d)) d = m.priceDate; });
    return d;
  }

  /* 組合回測。input = { items: [{code, weight}], amount, start, mode: "cash"|"reinvest" }；data = {code: 基金數據} */
  function backtest(input, data, meta) {
    var items = input.items.filter(function (it) { return it.code; });
    var end = latestDate(items, meta);
    var funds = items.map(function (it) {
      var r = runFund(data[it.code], input.amount * it.weight / 100, input.start, end, input.mode);
      r.code = it.code; r.weight = Number(it.weight);
      var m = meta[it.code];
      var lastDiv = data[it.code].dividends.slice(-1)[0];
      r.pendingDividends = lastDiv && m.step ? Math.max(0, Math.floor((days(lastDiv[0], end) - 5) / m.step)) : 0;
      r.lastDividendDate = lastDiv ? lastDiv[0] : null;
      return r;
    });
    var invest = sum(funds, "invest"), dividendsTotal = sum(funds, "dividendsTotal"),
      endValue = sum(funds, "endValue"), cash = sum(funds, "cash"), total = endValue + cash;
    var start = funds.reduce(function (d, f) { return f.buyDate < d ? f.buyDate : d; }, end);
    var n = days(start, end);
    var returnPct = (total / invest - 1) * 100;

    // 走勢：每月尾 + 開始日 + 最後一日
    var dates = [start], d = start.slice(0, 7);
    while (true) {
      var y = +d.slice(0, 4), mo = +d.slice(5, 7);
      var nextMonthStart = mo === 12 ? (y + 1) + "-01-01" : y + "-" + String(mo + 1).padStart(2, "0") + "-01";
      var monthEnd = addDays(nextMonthStart, -1);
      if (monthEnd >= end) break;
      if (monthEnd > start) dates.push(monthEnd);
      d = nextMonthStart.slice(0, 7);
    }
    dates.push(end);
    var series = dates.map(function (dt) {
      var t = 0, p = 0;
      funds.forEach(function (f) { var v = valueAt(data[f.code], f, dt); t += v.total; p += v.priceOnly; });
      return { date: dt, total: t, priceOnly: p };
    });

    // 每月派息
    var monthly = {};
    funds.forEach(function (f) { f.dividends.forEach(function (e) { var k = e.date.slice(0, 7); monthly[k] = (monthly[k] || 0) + e.amount; }); });
    var months = [];
    for (var k = start.slice(0, 7); k <= end.slice(0, 7); k = nextMonth(k)) months.push({ month: k, amount: monthly[k] || 0 });

    return {
      start: start, end: end, days: n, mode: input.mode, amount: input.amount,
      invest: invest, dividendsTotal: dividendsTotal, endValue: endValue, cash: cash, total: total,
      returnPct: returnPct, annualPct: annualise(returnPct, n),
      priceChangePct: (sumBy(funds, function (f) { return f.units0 * f.endPrice; }) / invest - 1) * 100,
      dividendYieldOnCost: dividendsTotal / invest * 100,
      funds: funds, series: series, monthly: months
    };
  }

  function nextMonth(k) { var y = +k.slice(0, 4), m = +k.slice(5, 7); return m === 12 ? (y + 1) + "-01" : y + "-" + String(m + 1).padStart(2, "0"); }
  function sum(a, key) { return a.reduce(function (s, x) { return s + x[key]; }, 0); }
  function sumBy(a, fn) { return a.reduce(function (s, x) { return s + fn(x); }, 0); }

  /* 「派息 vs 回報」提示：用近 1 年價格變化同總回報 */
  function verdict(m) {
    if (m.dist === false) return { level: "na", text: "—" };
    if (m.r1y == null || m.pr1y == null) return { level: "na", text: "未夠 1 年數據" };
    if (m.r1y < 0) return { level: "bad", text: "連派息計都蝕" };
    if (m.pr1y < 0) return { level: "warn", text: "價格跌咗，靠派息補返" };
    return { level: "good", text: "價格冇跌，派息係真賺" };
  }

  function fmt(v, d) {
    if (v == null || isNaN(v)) return "—";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function pct(v, d, sign) {
    if (v == null || isNaN(v)) return "—";
    var s = fmt(v, d == null ? 2 : d) + "%";
    return sign && v > 0 ? "+" + s : s;
  }

  var api = { onOrBefore: onOrBefore, onOrAfter: onOrAfter, after: after, addDays: addDays, addYears: addYears, days: days,
    totalReturn: totalReturn, trIndex: trIndex, flows: flows, annualise: annualise, runFund: runFund, backtest: backtest, check: check,
    earliestStart: earliestStart, latestDate: latestDate, verdict: verdict, fmt: fmt, pct: pct };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FundCalc = api;
})(this);
