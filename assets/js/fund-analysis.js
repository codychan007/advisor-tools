/* 基金分析：畫面。計數喺 fundcalc.js；PDF 喺 fund-pdf.js；數據 /data/funds/（scripts/build_funds.py 每日由 AIA 官網整） */
(function () {
  "use strict";
  var F = window.FundCalc;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var INDEX = null, META = {}, CACHE = {};
  var STORE = "fa-portfolio-v2", CMP_STORE = "fa-compare-v1";
  var CUR = { USD: "US$", RMB: "人民幣 ", HKD: "HK$", EUR: "€", JPY: "¥" };
  var CUR_NAME = { USD: "美元", RMB: "人民幣", HKD: "港元", EUR: "歐元", JPY: "日圓" };
  var ASSET_NAME = { "股票": "股票", "固定收入": "債券", "多元資產": "多元資產", "流動 / 貨幣市場": "貨幣市場" };
  var RISK_ORDER = { "低": 0, "中": 1, "高": 2 };
  var COLORS = ["#2E4A6B", "#B98327", "#4F6B3A", "#A3301C"];
  var INK = { grid: "#EAE0CB", axis: "#857B70", text: "#564E46", base: "#857B70", bar: "#4F6B3A" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shortName(m) { return m.name.replace(/\s*[（(]分派[)）]\s*$/, "").replace(/\s+-\s+/g, " - "); }
  function money(cur, v, d) { return CUR[cur] + F.fmt(v, d == null ? 0 : d); }
  function cls(v) { return v == null ? "" : (v < 0 ? "neg" : "pos"); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function assetName(m) { return ASSET_NAME[m.asset] || m.asset; }
  function typeName(m) { return assetName(m) + (m.region ? " - " + m.region : ""); }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 私隱模式 */ } }
  function recall(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  function load(code) {
    if (CACHE[code]) return Promise.resolve(CACHE[code]);
    return fetch("/data/funds/" + code + ".json").then(function (r) { if (!r.ok) throw new Error(code); return r.json(); })
      .then(function (d) { CACHE[code] = d; return d; });
  }
  /* AIA 上架之前嘅數據來源（data/backfill，經 build_funds.py 同 AIA 每年回報核對過） */
  function preSource(m) {
    var b = m.backfill;
    if (!b || m.backfillRejected) return null;
    var name = function (s) {
      if (!s) return "";
      if (/^blackrock/.test(s)) return "貝萊德官網";
      if (/^allianz/.test(s)) return "安聯官網";
      if (/^ft/.test(s)) return "金融時報（FT）";
      return s.replace(/（.*$/, "").replace(/\s*\(.*$/, "");
    };
    var p = name(b.priceSource || b.source), d = name(b.source);
    var hasPrices = b.lag !== null && b.lag !== undefined;
    if (!hasPrices) return { text: "派息紀錄來自" + d, prices: false };
    return { text: p === d || !m.dist ? "價格" + (m.dist ? "同派息" : "") + "來自" + p : "價格來自" + p + "、派息來自" + d, prices: true };
  }
  function preNote(m) {
    var s = preSource(m);
    if (!s) return "";
    return "「" + shortName(m) + "」" + (s.prices ? m.aiaFrom + " 上架 AIA 之前嘅" : "") + s.text + "，已同 AIA 公佈嘅每年回報核對。";
  }

  function badges(m, withKind) {
    var b = [];
    if (withKind) b.push('<span class="fa-kindtag ' + (m.dist ? "d" : "a") + '">' + (m.dist ? "派息" : "累積") + "</span>");
    if (m.currency !== "USD") b.push(CUR_NAME[m.currency] || m.currency);
    if (!m.checkOk) b.push('<span class="fa-warn" title="太新或者暫停交易，AIA 未有全年回報可以核對">⚠ 未能核對</span>');
    if (m.checkLevel === "adjusted") b.push('<span class="fa-adj" title="基金內部派息由 AIA 自動再投資，價格反映唔到，已按 AIA 公佈每年回報補返">已按 AIA 調整</span>');
    if (m.stale) b.push('<span class="fa-warn" title="今日嘅數據核對唔過，暫時顯示上次嘅數據">⚠ 數據未更新</span>');
    (m.remarks || []).forEach(function (r) { if (/暫停/.test(r)) b.push('<span class="fa-warn" title="' + esc(r) + '">⚠ 暫停交易</span>'); else if (/不接受|不可/.test(r)) b.push('<span class="fa-warn" title="' + esc(r) + '">⚠ 唔接受新投資／轉入</span>'); });
    return b.join(" · ");
  }

  /* ---------------- 圖表（SVG，顏色寫死喺屬性，PDF 都畫得到） ---------------- */
  function niceTicks(min, max, n) {
    if (min === max) { min -= 1; max += 1; }
    var raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(function (x) { return x * mag; }).find(function (x) { return x >= raw; });
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (var v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function shortNum(v) {
    var a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 1e6) return F.fmt(v / 1e6, a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e4) return F.fmt(v / 1e3, 0) + "K";
    if (a >= 100) return F.fmt(v, 0);
    return F.fmt(v, a >= 10 ? 1 : 2);
  }
  function text(x, y, s, anchor, size) { return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '" font-size="' + size + '" fill="' + INK.text + '" font-family="sans-serif">' + s + "</text>"; }
  function lineChart(series, opt) {
    opt = opt || {};
    var big = opt.big, fs = big ? 16 : 11;
    var W = 640, H = opt.height || 260, L = big ? 64 : 54, R = 12, T = 12, B = big ? 34 : 30;
    var pts = [].concat.apply([], series.map(function (s) { return s.points; }));
    if (!pts.length) return "";
    var t0 = Infinity, t1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(function (p) { var t = Date.parse(p[0]); t0 = Math.min(t0, t); t1 = Math.max(t1, t); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    if (opt.baseline != null) { y0 = Math.min(y0, opt.baseline); y1 = Math.max(y1, opt.baseline); }
    var ticks = niceTicks(y0, y1, 4); y0 = ticks[0]; y1 = ticks[ticks.length - 1];
    var x = function (d) { return L + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (W - L - R); };
    var y = function (v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); };
    var g = ['<svg class="fa-chart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(opt.label || "走勢圖") + '">',
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>'];
    ticks.forEach(function (v) {
      g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + INK.grid + '" stroke-width="1"/>');
      g.push(text(L - 6, y(v) + fs / 3, shortNum(v), "end", fs));
    });
    if (opt.baseline != null) g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(opt.baseline) + '" y2="' + y(opt.baseline) + '" stroke="' + INK.base + '" stroke-width="1" stroke-dasharray="4 4"/>');
    if (opt.marker && Date.parse(opt.marker.date) > t0 && Date.parse(opt.marker.date) < t1) {
      var mx = x(opt.marker.date);
      g.push('<line x1="' + mx + '" x2="' + mx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#A3301C" stroke-width="1.2" stroke-dasharray="3 3"/>');
      g.push(text(mx + 4, T + fs, esc(opt.marker.label), "start", fs));
    }
    var spanDays = (t1 - t0) / 864e5, months = spanDays > 1500 ? null : spanDays > 900 ? [1] : spanDays > 300 ? [1, 4, 7, 10] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    var d = new Date(t0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() <= t1) {
      var m = d.getUTCMonth() + 1, yr = d.getUTCFullYear();
      var show = months ? months.indexOf(m) >= 0 : (m === 1 && (yr % (spanDays > 3000 ? 2 : 1) === 0));
      if (show) {
        var xx = x(d.toISOString().slice(0, 10));
        g.push('<line x1="' + xx + '" x2="' + xx + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" stroke="' + INK.axis + '"/>');
        g.push(text(xx, H - B + fs + 5, m === 1 ? String(yr) : m + "月", "middle", fs));
      }
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="' + INK.axis + '"/>');
    series.forEach(function (s, i) {
      g.push('<path fill="none" stroke="' + (s.color || COLORS[i % 4]) + '" stroke-width="' + (big ? 3 : 2.2) + '" stroke-linejoin="round" d="' +
        s.points.map(function (p, k) { return (k ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1); }).join("") + '"/>');
    });
    g.push("</svg>");
    var legend = series.length > 1 || opt.legend ? '<div class="fa-legend">' + series.map(function (s, i) { return '<span><i style="background:' + (s.color || COLORS[i % 4]) + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>" : "";
    return legend + g.join("");
  }
  function barChart(rows, cur, big) {
    var fs = big ? 16 : 11, W = 640, H = 200, L = big ? 64 : 54, R = 12, T = 12, B = big ? 34 : 30;
    var max = Math.max.apply(null, rows.map(function (r) { return r.amount; }).concat([1]));
    var ticks = niceTicks(0, max, 3), top = ticks[ticks.length - 1];
    var bw = (W - L - R) / rows.length;
    var g = ['<svg class="fa-chart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="每月派息"><rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>'];
    ticks.forEach(function (v) {
      var yy = T + (1 - v / top) * (H - T - B);
      g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + INK.grid + '"/>' + text(L - 6, yy + fs / 3, shortNum(v), "end", fs));
    });
    rows.forEach(function (r, i) {
      var h = r.amount / top * (H - T - B), xx = L + i * bw;
      if (h > 0) g.push('<rect x="' + (xx + bw * 0.15).toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + INK.bar + '"><title>' + r.month + "：" + money(cur, r.amount) + "</title></rect>");
      var m = +r.month.slice(5), long = rows.length > 30;
      var nearStart = i > 0 && i < 3;         // 第一個標籤旁邊唔再標，費事疊埋
      if (i === 0 || (!nearStart && (m === 1 || (!long && rows.length > 18 && m === 7) || (rows.length <= 18 && m % 3 === 1))))
        g.push(text(xx + bw / 2, H - B + fs + 5, m === 1 || i === 0 ? r.month.slice(0, 4) + (m === 1 ? "" : "/" + m) : m + "月", "middle", fs));
    });
    g.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="' + INK.axis + '"/></svg>');
    return g.join("");
  }

  /* 一條總回報指數嘅統計：總回報、每年平均、波幅（每星期）、最大跌幅 */
  function seriesStats(s) {
    if (!s || s.length < 2) return null;
    var first = s[0], last = s[s.length - 1], n = F.days(first[0], last[0]);
    var ret = (last[1] / first[1] - 1) * 100, peak = 0, mdd = 0, weekly = [], lastDay = null;
    s.forEach(function (p) {
      peak = Math.max(peak, p[1]); mdd = Math.min(mdd, p[1] / peak - 1);
      if (!lastDay || F.days(lastDay, p[0]) >= 7) { weekly.push(p[1]); lastDay = p[0]; }
    });
    var r = []; for (var i = 1; i < weekly.length; i++) r.push(Math.log(weekly[i] / weekly[i - 1]));
    var mean = r.reduce(function (a, b) { return a + b; }, 0) / (r.length || 1);
    var vol = r.length > 10 ? Math.sqrt(r.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (r.length - 1)) * Math.sqrt(52) * 100 : null;
    return { ret: ret, ann: n >= 360 ? F.annualise(ret, n) : null, vol: vol, mdd: mdd * 100, days: n };
  }

  /* ---------------- 分頁 ---------------- */
  var TABS = { list: ["#tab-list"], cmp: ["#tab-cmp"], port: ["#tab-port", "#tab-port-res"], fund: ["#tab-fund"] };
  function showTab(name) {
    $$(".fa-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false"); });
    Object.keys(TABS).forEach(function (k) { TABS[k].forEach(function (s) { $(s).classList.toggle("hidden", k !== name); }); });
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* 冇所謂 */ }
    if (name === "cmp") renderCompare();
  }

  /* ---------------- 一覽 ---------------- */
  var sortKey = "default", sortDir = 1;
  var COLSETS = {
    dist: ["name", "risk", "yieldNow", "capitalPct12m", "r1y", "r2y", "a3y", "pr1y", "vol", "mdd", "verdict", "ops"],
    acc: ["name", "risk", "r1y", "a3y", "a5y", "rank3y", "vol", "mdd", "ops"],
    "": ["name", "risk", "yieldNow", "r1y", "a3y", "a5y", "vol", "mdd", "ops"]
  };
  var COLDEF = {
    name: { label: "基金" }, risk: { label: "風險" }, yieldNow: { label: "年化派息率", pct: 1 }, capitalPct12m: { label: "派息來自本金", pct: 1, d: 0 },
    r1y: { label: "1 年總回報", pct: 1, sign: 1 }, r2y: { label: "2 年總回報", pct: 1, sign: 1 }, a3y: { label: "3 年（每年）", pct: 1, sign: 1 },
    a5y: { label: "5 年（每年）", pct: 1, sign: 1 }, pr1y: { label: "1 年價格", pct: 1, sign: 1 }, vol: { label: "波幅", pct: 1, d: 1, plain: 1 },
    mdd: { label: "最大跌幅", pct: 1, d: 1 }, rank3y: { label: "同類排名" }, verdict: { label: "派息 vs 回報" }, ops: { label: "" }
  };
  function fv(name) { var el = $("input[name=" + name + "]:checked"); return el ? el.value : ""; }
  var CASH_KEY = { r1y: "c1y", r2y: "c2y", r3y: "c3y", r5y: "c5y", a3y: "ca3y", a5y: "ca5y" };
  function key(c) { return fv("flcalc") === "cash" && CASH_KEY[c] ? CASH_KEY[c] : c; }   // 一覽用邊種計法
  function filtered() {
    var kind = fv("flkind"), asset = fv("flasset"), region = $("#flRegion").value, risk = $("#flRisk").value, cur = $("#flCur").value, house = $("#flHouse").value;
    return INDEX.funds.filter(function (m) {
      return (!kind || (kind === "dist") === m.dist) && (!asset || m.asset === asset) && (!region || m.region === region) &&
        (!risk || m.risk === risk) && (!cur || m.currency === cur) && (!house || m.house === house);
    });
  }
  function refreshRegions() {
    var kind = fv("flkind"), asset = fv("flasset"), cur = $("#flRegion").value;
    var regions = INDEX.funds.filter(function (m) { return (!kind || (kind === "dist") === m.dist) && (!asset || m.asset === asset) && m.region; })
      .map(function (m) { return m.region; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    $("#flRegion").innerHTML = '<option value="">全部</option>' + regions.map(function (r) { return '<option' + (r === cur ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("");
  }
  function renderList() {
    var kind = fv("flkind"), cols = COLSETS[kind], rows = filtered();
    $("#flCalcWrap").classList.toggle("hidden", kind === "acc");
    var val = function (m) {
      if (sortKey === "default") return (m.dist ? 0 : 1e6) + RISK_ORDER[m.risk] * 1000 - (m.dist ? (m.yieldNow || 0) : (m.a3y == null ? -999 : m.a3y));
      if (sortKey === "risk") return RISK_ORDER[m.risk];
      if (sortKey === "name") return m.house + m.name;
      if (sortKey === "verdict") return { good: 0, warn: 1, bad: 2, na: 3 }[F.verdict(m).level];
      if (sortKey === "rank3y") return m.rank3y ? m.rank3y[0] / m.rank3y[1] : null;
      return m[key(sortKey)];
    };
    rows.sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;   // 冇數字嘅永遠排最後
      return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
    });
    $("#listHint").textContent = rows.length + " 隻基金。撳欄目名排次序；撳基金名睇詳情；「比較」最多揀 4 隻；「＋」加入組合。";
    var h = "<thead><tr>" + cols.map(function (c) {
      var on = sortKey === c;
      return "<th" + (c !== "ops" ? ' data-sort="' + c + '" class="sortable' + (on ? " on" : "") + '"' : "") + ">" + COLDEF[c].label + (on ? (sortDir > 0 ? " ▲" : " ▼") : "") + "</th>";
    }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (m) {
      h += "<tr>" + cols.map(function (c) {
        var d = COLDEF[c];
        if (c === "name") return '<td class="fa-name"><button type="button" class="linkbtn" data-open="' + m.code + '">' + esc(shortName(m)) + "</button><small>" + m.code + " · " + esc(m.house) + " · " + esc(typeName(m)) + (badges(m, kind === "") ? " · " + badges(m, kind === "") : "") + "</small></td>";
        if (c === "risk") return "<td>" + m.risk + "</td>";
        if (c === "verdict") { var v = F.verdict(m); return '<td><span class="fa-pill ' + v.level + '">' + v.text + "</span></td>"; }
        if (c === "rank3y") return "<td>" + (m.rank3y ? m.rank3y[0] + " / " + m.rank3y[1] : "—") + "</td>";
        if (c === "ops") {
          var inCmp = CMP.indexOf(m.code) >= 0;
          return '<td class="fa-ops"><button type="button" class="btn ghost small' + (inCmp ? " on" : "") + '" data-cmpadd="' + m.code + '">' + (inCmp ? "✓ 比較" : "比較") + '</button><button type="button" class="btn ghost small" data-add="' + m.code + '" title="加入組合">＋</button></td>';
        }
        var x = m[key(c)];
        if (c === "capitalPct12m" && x == null) return "<td></td>";
        return '<td class="' + (d.sign || c === "mdd" ? cls(x) : "") + '">' + F.pct(x, d.d == null ? 2 : d.d, d.sign) + "</td>";
      }).join("") + "</tr>";
    });
    if (!rows.length) h += '<tr><td colspan="' + cols.length + '" class="muted">冇符合條件嘅基金</td></tr>';
    $("#listTable").innerHTML = h + "</tbody>";
  }

  /* ---------------- 比較 ---------------- */
  var CMP = [], cmpYears = 3;
  function fundSelect(selected, filterCur, cls) {
    var groups = [];
    var add = function (label, list) { if (list.length) groups.push('<optgroup label="' + label + '">' + list.map(function (m) {
      return '<option value="' + m.code + '"' + (m.code === selected ? " selected" : "") + ">" + m.code + " " + esc(m.house) + "｜" + esc(shortName(m)) + (filterCur ? "" : (m.currency !== "USD" ? "（" + CUR_NAME[m.currency] + "）" : "")) + "</option>";
    }).join("") + "</optgroup>"); };
    var pool = INDEX.funds.filter(function (m) { return !filterCur || m.currency === filterCur; });
    ["低", "中", "高"].forEach(function (r) { add("派息基金 · " + r + "風險", pool.filter(function (m) { return m.dist && m.risk === r; })); });
    Object.keys(ASSET_NAME).forEach(function (a) { add("累積基金 · " + ASSET_NAME[a], pool.filter(function (m) { return !m.dist && m.asset === a; })); });
    return '<select class="' + cls + '" aria-label="基金"><option value="">請揀基金</option>' + groups.join("") + "</select>";
  }
  function saveCmp() { store(CMP_STORE, { codes: CMP, years: cmpYears }); updateCmpBadge(); }
  function updateCmpBadge() { var b = $("#cmpCount"); b.textContent = CMP.length; b.classList.toggle("hidden", !CMP.length); }
  function toggleCompare(code) {
    var i = CMP.indexOf(code);
    if (i >= 0) CMP.splice(i, 1);
    else { if (CMP.length >= 4) { alert("最多比較 4 隻基金，請先喺「比較」刪走一隻。"); return; } CMP.push(code); }
    saveCmp(); renderList();
  }
  function renderCompare() {
    var rows = CMP.map(function (c) {
      return '<div class="fa-row fa-cmprow"><i class="fa-dot" style="background:' + COLORS[CMP.indexOf(c)] + '"></i>' + fundSelect(c, null, "cmp-code") + '<button type="button" class="btn ghost small cmp-del" aria-label="刪除">✕</button></div>';
    }).join("");
    if (CMP.length < 4) rows += '<div class="fa-row fa-cmprow"><i class="fa-dot" style="background:#ccc"></i>' + fundSelect("", null, "cmp-code") + "<span></span></div>";
    $("#cmpRows").innerHTML = rows;
    $$("[data-cmp]").forEach(function (b) { b.classList.toggle("on", +b.dataset.cmp === cmpYears); });
    if (!CMP.length) { $("#cmpResult").innerHTML = '<p class="muted">未揀基金。</p>'; return; }
    $("#cmpResult").innerHTML = '<p class="muted">計緊…</p>';
    Promise.all(CMP.map(load)).then(function () {
      var latest = CMP.reduce(function (d, c) { var p = META[c].priceDate; return !d || p < d ? p : d; }, null);
      var earliest = CMP.reduce(function (d, c) { var f = META[c].dataFrom || META[c].launch; return f > d ? f : d; }, "1900-01-01");
      var start = cmpYears ? F.addDays(latest, -365 * cmpYears) : earliest, note = "";
      if (start < earliest) { note = "部分基金數據未夠 " + cmpYears + " 年，由 " + earliest + "（全部基金都有數據嗰日）開始計。"; start = earliest; }
      var series = CMP.map(function (c, i) { return { name: c + " " + shortName(META[c]), color: COLORS[i], points: F.cashIndex(CACHE[c], start, latest) }; });
      var curs = CMP.map(function (c) { return META[c].currency; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var h = '<p class="muted">' + start + " 至 " + latest + "（" + F.fmt(F.days(start, latest) / 365, 1) + " 年）· 起點 = 100 · 基金價值 + 已收現金息" + (curs.length > 1 ? " · 各基金以自己貨幣計" : "") + "</p>" +
        (note ? '<p class="note">' + esc(note) + "</p>" : "") + lineChart(series, { baseline: 100, label: "基金比較", legend: 1, height: 300 });
      var srcs = CMP.filter(function (c) { return preSource(META[c]) && (META[c].aiaFrom > start); }).map(function (c) { return preNote(META[c]); });
      if (srcs.length) h += '<p class="hint">' + srcs.map(esc).join("<br>") + "</p>";
      h += '<div class="table-wrap"><table class="fa-res"><thead><tr><th>基金</th><th>總回報</th><th>每年平均</th><th>波幅</th><th>最大跌幅</th><th>風險</th></tr></thead><tbody>' +
        series.map(function (s, i) {
          var st = seriesStats(s.points), m = META[CMP[i]];
          return '<tr><td class="fa-name"><i class="fa-dot" style="background:' + COLORS[i] + '"></i> ' + esc(shortName(m)) + "<small>" + m.code + " · " + (m.dist ? "派息" : "累積") + " · " + esc(typeName(m)) + (m.currency !== "USD" ? " · " + CUR_NAME[m.currency] : "") + "</small></td>" +
            '<td class="' + cls(st.ret) + '"><b>' + F.pct(st.ret, 2, true) + '</b></td><td class="' + cls(st.ann) + '">' + F.pct(st.ann, 2, true) + "</td><td>" + F.pct(st.vol, 1) + '</td><td class="neg">' + F.pct(st.mdd, 1) + "</td><td>" + m.risk + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="hint">波幅同最大跌幅只計呢段期間。過往表現並不代表將來表現。</p>';
      $("#cmpResult").innerHTML = h;
    });
  }

  /* ---------------- 組合 ---------------- */
  function pfCur() { return fv("pfcur") || "USD"; }
  function pfMode() { return fv("pfmode") || "cash"; }
  function addRow(code, weight) {
    var rows = $("#pfRows");
    if (rows.children.length >= 10) { alert("最多 10 隻基金"); return; }
    var div = document.createElement("div");
    div.className = "fa-row";
    div.innerHTML = fundSelect(code, pfCur(), "pf-code") +
      '<div class="fa-w"><input class="pf-w" type="number" inputmode="decimal" min="0" max="100" step="any" aria-label="佔幾多 %" value="' + (weight == null ? "" : weight) + '"><span>%</span></div>' +
      '<button type="button" class="btn ghost small pf-del" aria-label="刪除">✕</button>';
    rows.appendChild(div);
    updateSum();
  }
  function items() {
    return $$("#pfRows .fa-row").map(function (r) { return { code: $(".pf-code", r).value, weight: parseFloat($(".pf-w", r).value) || 0 }; });
  }
  function updateSum() {
    var its = items(), s = its.reduce(function (a, b) { return a + b.weight; }, 0);
    var el = $("#pfSum");
    el.textContent = "合計 " + F.fmt(s, 2).replace(/\.?0+$/, "") + "%";
    el.className = "fa-sum " + (Math.abs(s - 100) < 0.01 ? "good" : "bad");
    var e = F.earliestStart(its.filter(function (i) { return i.code; }), META);
    $("#pfStartHint").textContent = e ? "揀咗嘅基金完整數據最早由 " + e.date + " 開始（「" + shortName(META[e.code]) + "」）。" : "";
    $("#pfCurLabel").textContent = CUR[pfCur()];
    save();
  }
  function setBack(n) {
    var its = items().filter(function (i) { return i.code; });
    var latest = F.latestDate(its, META) || INDEX.latest;
    var e = F.earliestStart(its, META);
    var d = n === 0 ? (e ? e.date : F.addDays(latest, -365)) : F.addDays(latest, -365 * n);
    if (e && d < e.date) d = e.date;
    $("#pfStart").value = d;
    save();
  }
  function save() { store(STORE, { cur: pfCur(), items: items(), amount: $("#pfAmt").value, start: $("#pfStart").value, mode: pfMode() }); }
  function restore() {
    var s = recall(STORE) || recall("fa-portfolio-v1");
    if (s && s.items && s.items.length) {
      var r = $("input[name=pfcur][value=" + (CUR[s.cur] ? s.cur : "USD") + "]"); if (r) r.checked = true;
      s.items.forEach(function (i) { addRow(META[i.code] ? i.code : "", i.weight); });
      if (s.amount) $("#pfAmt").value = s.amount;
      if (s.start) $("#pfStart").value = s.start;
      var m = $("input[name=pfmode][value=" + (s.mode === "reinvest" && !$("#pfReinvestOpt").classList.contains("hidden") ? "reinvest" : "cash") + "]"); if (m) m.checked = true;
    } else { addRow("", 50); addRow("", 50); }
    updateSum();
    if (!$("#pfStart").value) setBack(2);
  }

  var LAST = null;
  function run() {
    var input = { items: items().filter(function (i) { return i.code; }), amount: parseFloat($("#pfAmt").value), start: $("#pfStart").value, mode: pfMode() };
    var errs = F.check(input, META);
    if (items().some(function (i) { return !i.code && i.weight; })) errs.unshift("有一行未揀基金");
    var box = $("#pfErr");
    if (errs.length) { box.innerHTML = "<b>請先改好：</b><ul>" + errs.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>"; box.classList.remove("hidden"); return; }
    box.classList.add("hidden");
    $("#pfResult").innerHTML = '<p class="muted">計緊…</p>';
    Promise.all(input.items.map(function (i) { return load(i.code); })).then(function () {
      var r = F.backtest(input, CACHE, META);
      LAST = { input: input, r: r, cur: META[input.items[0].code].currency };
      renderResult(LAST);
      $("#tab-port-res").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (e) { $("#pfResult").innerHTML = '<p class="note bad">載入數據失敗（' + esc(e.message) + "），請重新整理頁面再試。</p>"; });
  }
  function hasDist(res) { return res.funds.some(function (f) { return META[f.code].dist; }); }
  function kpis(res, cur) {
    var cash = res.mode === "cash", d = hasDist(res);
    return '<div class="kpis">' +
      (d ? '<div class="kpi"><span>' + (cash ? "總共收咗嘅息" : "派息總值（已再投資）") + "</span><b>" + money(cur, res.dividendsTotal) + "</b><small>投入額嘅 " + F.pct(res.dividendYieldOnCost) + "</small></div>" : "") +
      '<div class="kpi"><span>而家基金價值</span><b>' + money(cur, res.endValue) + "</b><small>投入 " + money(cur, res.invest) + "</small></div>" +
      '<div class="kpi"><span>真實總回報</span><b class="' + cls(res.returnPct) + '">' + F.pct(res.returnPct, 2, true) + "</b><small>" + (d && cash ? "基金價值 + 已收息" : "總值") + " = " + money(cur, res.total) + "</small></div>" +
      '<div class="kpi"><span>每年平均回報</span><b class="' + cls(res.annualPct) + '">' + (res.annualPct == null ? "—" : F.pct(res.annualPct, 2, true)) + "</b><small>" + F.fmt(res.days / 365, 1) + " 年</small></div>" +
      "</div>";
  }
  function fundTable(res, cur) {
    var cash = res.mode === "cash";
    var h = '<div class="table-wrap"><table class="fa-res"><thead><tr><th>基金</th><th>佔</th><th>投入</th><th>買入價</th><th>而家價格</th><th>價格升跌</th><th>' + (cash ? "收咗息" : "派息總值") + "</th><th>總值</th><th>總回報</th></tr></thead><tbody>";
    res.funds.forEach(function (f) {
      var m = META[f.code];
      h += '<tr><td class="fa-name">' + esc(shortName(m)) + "<small>" + f.code + " · " + (m.dist ? "派息" : "累積") + " · " + m.risk + "風險 · 買入日 " + f.buyDate + "</small></td>" +
        "<td>" + F.fmt(f.weight, 2).replace(/\.?0+$/, "") + "%</td><td>" + money(cur, f.invest) + "</td><td>" + F.fmt(f.buyPrice, 4) + "</td><td>" + F.fmt(f.endPrice, 4) + "</td>" +
        '<td class="' + cls(f.priceChangePct) + '">' + F.pct(f.priceChangePct, 2, true) + "</td><td>" + (m.dist ? money(cur, f.dividendsTotal) + "<small>" + f.dividends.length + " 次</small>" : "<small>唔派現金</small>") + "</td>" +
        "<td>" + money(cur, f.total) + '</td><td class="' + cls(f.returnPct) + '"><b>' + F.pct(f.returnPct, 2, true) + "</b></td></tr>";
    });
    h += '<tr class="fa-total"><td>合計</td><td>100%</td><td>' + money(cur, res.invest) + "</td><td></td><td></td>" +
      '<td class="' + cls(res.priceChangePct) + '">' + F.pct(res.priceChangePct, 2, true) + "</td><td>" + money(cur, res.dividendsTotal) + "</td><td>" + money(cur, res.total) + '</td><td class="' + cls(res.returnPct) + '"><b>' + F.pct(res.returnPct, 2, true) + "</b></td></tr>";
    return h + "</tbody></table></div>";
  }
  function charts(res, cur, big) {
    var d = hasDist(res);
    var line = lineChart([
      { name: d ? (res.mode === "cash" ? "總值（基金價值 + 已收息）" : "總值（派息再投資）") : "組合價值", points: res.series.map(function (p) { return [p.date, p.total]; }) },
      { name: "只計價格（唔計派息）", points: res.series.map(function (p) { return [p.date, p.priceOnly]; }) }
    ], { baseline: res.invest, label: "組合價值走勢", big: big });
    return '<div class="fa-chartbox"><h3>組合價值走勢</h3>' + line + (big ? "" : '<p class="hint">虛線 = 投入金額。兩條線之間嘅距離 = 派息（同基金內部派息）帶嚟嘅價值。</p>') + "</div>" +
      (d ? '<div class="fa-chartbox"><h3>每月派息（' + CUR[cur].trim() + "）</h3>" + barChart(res.monthly, cur, big) + "</div>" : "");
  }
  function notes(res) {
    var out = [];
    res.funds.forEach(function (f) {
      var m = META[f.code];
      if (f.pendingDividends > 0) out.push("「" + shortName(m) + "」派息紀錄只更新到 " + f.lastDividendDate + "（基金公司 PDF 未出最新月份），之後大約 " + f.pendingDividends + " 次派息未計入，回報可能略為低估。");
      if (!m.checkOk) out.push("「" + shortName(m) + "」係新基金，數據未能同 AIA 公佈嘅回報核對，請以 AIA 官網為準。");
      if (m.checkLevel === "adjusted") out.push("「" + shortName(m) + "」有基金內部派息（AIA 自動再投資），回報已按 AIA 公佈嘅每年回報調整。");
      if (preSource(m) && (preSource(m).prices ? f.buyDate < m.aiaFrom : true)) out.push(preNote(m));
    });
    return out;
  }
  var DISCLAIMER = [
    "投資涉及風險，過往表現並不代表將來表現。基金價格可升可跌。",
    "正數派息率並不代表正數回報。派息可能從資本中支付，即退回或提取部分原本投資，並可能令基金價格即時下跌。",
    "以上以「卓達智悅 2」投資選擇之 AIA 公佈價格及相關基金派息紀錄計算，並未扣除保單收費，實際保單回報會較低。",
    "僅供參考，不構成投資建議或要約。投資前請參閱「卓達智悅 2」及相關基金之銷售文件（包括產品資料概要）所載詳情，包括風險因素。"
  ];
  function renderResult(L) {
    var res = L.r, cur = L.cur, n = notes(res);
    $("#pfResult").innerHTML = '<p class="muted">' + res.start + " 至 " + res.end + "（" + F.fmt(res.days / 365, 1) + " 年）· 投入 " + money(cur, res.invest) + (hasDist(res) ? " · 派息" + (res.mode === "cash" ? "收現金" : "自動再投資") : "") + "</p>" +
      kpis(res, cur) + fundTable(res, cur) + charts(res, cur) +
      (n.length ? '<div class="note" style="margin-top:12px"><ul style="margin:0">' + n.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="actions"><button type="button" class="btn" id="pfPdf">下載 PDF 報告（俾客人）</button><span class="hint" id="pdfMsg"></span></div>';
  }

  /* ---------------- 客人報告 → PDF 檔案（唔使列印畫面） ---------------- */
  function buildReport(L) {
    var res = L.r, cur = L.cur, n = notes(res), d = hasDist(res);
    $("#reportHost").innerHTML = '<div class="fa-report" id="report">' +
      '<div class="fa-rep-head"><div><h1>' + (d ? "基金組合表現回顧" : "基金組合表現回顧") + "</h1><p>「卓達智悅 2」投資選擇 · 以過往數據計算</p></div><div class=\"fa-rep-date\">製作日期：" + today() + "<br>數據截至：" + res.end + "</div></div>" +
      '<p class="fa-rep-sum">假設 <b>' + res.start + "</b> 投入 <b>" + money(cur, res.invest) + "</b>" + (d ? "，派息" + (res.mode === "cash" ? "以現金收取" : "自動再投資") : "") + "，至 <b>" + res.end + "</b>（約 " + F.fmt(res.days / 365, 1) + " 年）：</p>" +
      kpis(res, cur) + fundTable(res, cur) + '<div class="fa-rep-charts">' + charts(res, cur, true) + "</div>" +
      (n.length ? '<div class="fa-rep-notes"><b>數據說明</b><ul>' + n.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="fa-rep-disc"><b>重要提示</b><ul>' + DISCLAIMER.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      "<p>數據來源：AIA 香港官網（投資選擇價格及派息紀錄），截至 " + res.end + "。</p></div></div>";
    return $("#report");
  }
  var h2cPromise = null;
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve();
    if (!h2cPromise) h2cPromise = new Promise(function (ok, bad) {
      var s = document.createElement("script"); s.src = "/assets/vendor/html2canvas.min.js"; s.onload = ok; s.onerror = function () { h2cPromise = null; bad(new Error("載入失敗")); };
      document.head.appendChild(s);
    });
    return h2cPromise;
  }
  function downloadPdf() {
    if (!LAST) return;
    var btn = $("#pfPdf"), msg = $("#pdfMsg");
    btn.disabled = true; msg.textContent = "整緊 PDF…";
    loadH2C().then(function () {
      var el = buildReport(LAST);
      return window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true });
    }).then(function (canvas) {
      var blob = window.FundPdf.fromCanvas(canvas, 0.9);
      window.FundPdf.download(blob, "基金組合表現回顧-" + today() + ".pdf");
      msg.textContent = "已下載（" + F.fmt(blob.size / 1024, 0) + " KB）。";
    }).catch(function (e) {
      msg.textContent = "整唔到 PDF（" + e.message + "），請再試。";
    }).then(function () { btn.disabled = false; $("#reportHost").innerHTML = ""; });
  }

  /* ---------------- 單隻基金 ---------------- */
  function renderFundSelect(code) {
    var wrap = document.createElement("div"); wrap.innerHTML = fundSelect(code, null, "x");
    $("#fdSel").innerHTML = wrap.firstChild.innerHTML;
  }
  function openFund(code) {
    if (!META[code]) return;
    renderFundSelect(code);
    showTab("fund");
    var m = META[code];
    $("#fdBody").innerHTML = '<p class="muted">載入緊…</p>';
    Promise.all([code].concat(m.siblings || []).map(load)).then(function () {
      var d = CACHE[code], cur = m.currency;
      var h = '<h2 style="margin-top:14px">' + esc(shortName(m)) + "</h2>" +
        '<p class="muted">' + m.code + " · " + (m.dist ? "派息基金" : "累積基金") + " · " + esc(m.house) + " · " + esc(typeName(m)) + " · " + m.risk + "風險 · " + (CUR_NAME[cur] || cur) +
        " · ISIN " + esc(m.isin) + " · AIA 上架 " + (m.aiaFrom || m.launch) + (badges(m) ? " · " + badges(m) : "") +
        (preSource(m) ? "<br>" + esc(preSource(m).prices ? "上架 AIA 之前：" + preSource(m).text : preSource(m).text) + "（已同 AIA 公佈每年回報核對）" : "") +
        '<br><a href="' + esc(m.detailUrl) + '" target="_blank" rel="noopener">AIA 官網基金頁</a>' + (m.pdfUrl ? ' · <a href="' + esc(m.pdfUrl) + '" target="_blank" rel="noopener">派息紀錄 PDF</a>' : "") + "</p>" +
        (m.remarks && m.remarks.length ? '<p class="note">' + m.remarks.map(esc).join("<br>") + "</p>" : "");
      h += '<div class="kpis">' +
        '<div class="kpi"><span>最新價格</span><b>' + F.fmt(m.price, 4) + "</b><small>" + m.priceDate + "</small></div>" +
        (m.dist ? '<div class="kpi"><span>年化派息率</span><b>' + F.pct(m.yieldNow) + "</b><small>" + (m.capitalPct12m != null ? "來自本金 " + F.pct(m.capitalPct12m, 0) : "按最近一次派息") + "</small></div>" : "") +
        '<div class="kpi"><span>1 年總回報</span><b class="' + cls(m.r1y) + '">' + F.pct(m.r1y, 2, true) + "</b><small>" + (m.dist ? "收現金計 " + F.pct(m.c1y, 2, true) : (m.rank1y ? "同類第 " + m.rank1y[0] + " / " + m.rank1y[1] : "&nbsp;")) + "</small></div>" +
        '<div class="kpi"><span>3 年（每年）</span><b class="' + cls(m.a3y) + '">' + F.pct(m.a3y, 2, true) + "</b><small>" + (m.rank3y ? "同類第 " + m.rank3y[0] + " / " + m.rank3y[1] : "總計 " + F.pct(m.r3y, 1, true)) + "</small></div>" +
        '<div class="kpi"><span>5 年（每年）</span><b class="' + cls(m.a5y) + '">' + F.pct(m.a5y, 2, true) + "</b><small>總計 " + F.pct(m.r5y, 1, true) + "</small></div>" +
        '<div class="kpi"><span>波幅 / 最大跌幅</span><b>' + F.pct(m.vol, 1) + ' / <span class="neg">' + F.pct(m.mdd, 1) + "</span></b><small>" + (m.statsYears ? "近 " + m.statsYears + " 年" : "未夠 1 年") + "</small></div>" +
        (m.dist ? '<div class="kpi"><span>派息 vs 回報</span><b style="font-size:1rem"><span class="fa-pill ' + F.verdict(m).level + '">' + F.verdict(m).text + "</span></b></div>" : "") + "</div>";
      var from = m.dataFrom || d.prices[0][0];
      var tr = F.cashIndex(d, from), p0 = F.onOrBefore(d.prices, from);
      var priceLine = d.prices.filter(function (p) { return p[0] >= p0[0]; }), step = Math.max(1, Math.floor(priceLine.length / 400));
      var lines = [{ name: m.dist ? "總回報（基金價值 + 已收派息，起點 = 100）" : "總回報（起點 = 100）", points: tr }];
      if (m.dist || m.checkLevel === "adjusted") lines.push({ name: "只計價格", points: priceLine.filter(function (_, i) { return i % step === 0 || i === priceLine.length - 1; }).map(function (p) { return [p[0], p[1] / p0[1] * 100]; }) });
      var mk = preSource(m) && preSource(m).prices ? { date: m.aiaFrom, label: "AIA 上架" } : null;
      h += "<h3>表現走勢（" + from + " 至今）</h3>" + lineChart(lines, { baseline: 100, label: "表現走勢", legend: 1, marker: mk }) +
        (mk ? '<p class="hint">紅色虛線 = AIA 上架日；之前嘅數據來自基金公司／FT。</p>' : "") +
        (m.dist ? '<p class="hint">派息以現金派發：派息之後價格會跌返派出嘅金額，所以要將已收嘅現金息加返先知真實表現。</p>' : "");
      // 同一隻基金嘅其他版本
      if (m.siblings && m.siblings.length) {
        var sib = [code].concat(m.siblings).map(function (c) { return META[c]; }).filter(Boolean);
        h += "<h3>同一隻基金嘅其他版本</h3><div class=\"table-wrap\"><table class=\"fa-res\"><thead><tr><th>版本</th><th>年化派息率</th><th>1 年總回報</th><th>3 年（每年）</th><th>波幅</th><th></th></tr></thead><tbody>" +
          sib.map(function (s) {
            return '<tr><td class="fa-name">' + (s.code === code ? "<b>" : '<button type="button" class="linkbtn" data-open="' + s.code + '">') + esc(shortName(s)) + (s.code === code ? "</b>" : "</button>") + "<small>" + s.code + " · " + (s.dist ? "派息" : "累積") + "</small></td>" +
              "<td>" + (s.dist ? F.pct(s.yieldNow) : "—") + '</td><td class="' + cls(s.r1y) + '">' + F.pct(s.r1y, 2, true) + '</td><td class="' + cls(s.a3y) + '">' + F.pct(s.a3y, 2, true) + "</td><td>" + F.pct(s.vol, 1) + "</td>" +
              "<td>" + (s.code === code ? "" : '<button type="button" class="btn ghost small" data-pair="' + code + "," + s.code + '">比較兩個</button>') + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="hint">派息版每月派現金；累積版唔派息，收益留喺基金入面。兩者總回報通常接近，分別在於客人要唔要定期現金。</p>';
      }
      // 每年回報
      var years = Object.keys(m.aiaReturns).filter(function (y) { return m.aiaReturns[y] != null; }).sort(function (a, b) { return a === "YTD" ? 1 : b === "YTD" ? -1 : a - b; });
      if (years.length) {
        var chk = {}; (m.checks || []).forEach(function (c) { if ("aia" in c) chk[c.year] = c; });
        h += "<h3>每年總回報（同 AIA 官網：股息再作投資計算）</h3><div class=\"table-wrap\"><table><thead><tr><th>年份</th><th>AIA 公佈</th><th>本工具計算</th></tr></thead><tbody>" +
          years.map(function (y) {
            var c = chk[y];
            var ours = c ? (c.adjusted ? '<small>已按 AIA 調整（價格計 ' + F.pct(c.ours, 2, true) + "）</small>" : F.pct(c.ours, 2, true) + (c.ok ? " ✓" : " ⚠")) : "<small>未有完整數據</small>";
            return "<tr><td>" + (y === "YTD" ? "今年至 " + m.perfAsOf : y) + '</td><td class="' + cls(m.aiaReturns[y]) + '">' + F.pct(m.aiaReturns[y], 2, true) + "</td><td>" + ours + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="hint">AIA 公佈嘅數字包括基金喺 AIA 上架之前嘅表現' + (cur !== "USD" ? "，而且非美元類別可能以美元計" : "") + "。「本工具計算」用 AIA 價格" + (m.dist ? "同派息紀錄" : "") + "自己計，用嚟證明數據準確。</p>";
      }
      if (m.dist) {
        var divs = d.dividends.slice().reverse();
        h += "<h3>派息紀錄（" + divs.length + " 次，最近排先）</h3>";
        if (divs.length) {
          var per = m.step < 45 ? 12 : m.step < 120 ? 4 : m.step < 250 ? 2 : 1;
          h += '<div class="table-wrap"><table><thead><tr><th>除息日</th><th>每單位派息</th><th>當日價格</th><th>年化派息率</th><th>來自本金</th></tr></thead><tbody>' +
            divs.map(function (x) {
              var nav = F.after(d.prices, x[0]);
              return "<tr><td>" + x[0] + "</td><td>" + F.fmt(x[1], 4) + "</td><td>" + (nav ? F.fmt(nav[1], 4) : "—") + "</td><td>" + (nav ? F.pct(x[1] / nav[1] * per * 100) : "—") + "</td><td>" + (x[3] == null ? "" : F.pct(x[3], 0)) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        } else h += '<p class="muted">冇派息紀錄。</p>';
        h += '<p class="hint">數據來源：AIA 官網派息紀錄 PDF（由基金公司提供），由 ' + (m.divFrom || "—") + " 開始儲存。</p>";
      }
      h += '<div class="actions"><button type="button" class="btn ghost" data-cmpadd="' + m.code + '">' + (CMP.indexOf(m.code) >= 0 ? "✓ 已加入比較" : "加入比較") + '</button><button type="button" class="btn ghost" data-add="' + m.code + '">＋ 加入組合</button></div>';
      $("#fdBody").innerHTML = h;
    }).catch(function () { $("#fdBody").innerHTML = '<p class="note bad">載入失敗，請重新整理頁面。</p>'; });
  }

  function addToPortfolio(code) {
    var m = META[code];
    if (m.currency !== pfCur()) { var r = $("input[name=pfcur][value=" + m.currency + "]"); r.checked = true; onCurChange(true); }
    showTab("port");
    if (!items().some(function (i) { return i.code === code; })) {
      var empty = $$("#pfRows .fa-row").find(function (row) { return !$(".pf-code", row).value; });
      if (empty) { $(".pf-code", empty).value = code; updateSum(); } else addRow(code, "");
    }
    $("#tab-port").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function onCurChange(clear) {
    var cur = pfCur();
    var keep = items().filter(function (i) { return i.code && META[i.code].currency === cur; });
    $("#pfRows").innerHTML = "";
    if (clear || !keep.length) addRow("", ""); else keep.forEach(function (i) { addRow(i.code, i.weight); });
    updateSum();
  }

  /* ---------------- 開始 ---------------- */
  function init() {
    fetch("/data/funds/index.json").then(function (r) { return r.json(); }).then(function (idx) {
      INDEX = idx;
      idx.funds.forEach(function (m) { META[m.code] = m; });
      idx.latest = idx.funds.reduce(function (d, m) { return m.priceDate > d ? m.priceDate : d; }, "");
      var nd = idx.funds.filter(function (m) { return m.dist; }).length, checked = idx.funds.filter(function (m) { return m.checkOk; }).length;
      $("#nDist").textContent = nd; $("#nAcc").textContent = idx.funds.length - nd; $("#nAll").textContent = idx.funds.length;
      $("#dataInfo").textContent = idx.plan + "：" + idx.funds.length + " 隻基金（派息 " + nd + "、累積 " + (idx.funds.length - nd) + "；" + checked + " 隻已同 AIA 公佈回報核對）· 價格截至 " + idx.latest + " · 更新於 " + idx.built;
      var uniq = function (k) { return idx.funds.map(function (m) { return m[k]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }); };
      $("#flCur").innerHTML += uniq("currency").sort(function (a, b) { return Object.keys(CUR).indexOf(a) - Object.keys(CUR).indexOf(b); }).map(function (c) { return '<option value="' + c + '">' + (CUR_NAME[c] || c) + "</option>"; }).join("");
      $("#flHouse").innerHTML += uniq("house").sort().map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
      $("#pfCur").innerHTML = Object.keys(CUR).filter(function (c) { return uniq("currency").indexOf(c) >= 0; }).map(function (c, i) {
        return '<label><input type="radio" name="pfcur" value="' + c + '"' + (i === 0 ? " checked" : "") + "><span>" + CUR_NAME[c] + "</span></label>";
      }).join("");
      $$("input[name=pfcur]").forEach(function (r) { r.addEventListener("change", function () { onCurChange(false); }); });
      var c = recall(CMP_STORE); if (c && c.codes) { CMP = c.codes.filter(function (x) { return META[x]; }).slice(0, 4); cmpYears = c.years == null ? 3 : c.years; }
      updateCmpBadge();
      refreshRegions(); renderList();
      renderFundSelect(idx.funds[0].code);
      restore();
      var h = (location.hash || "").slice(1);
      if (TABS[h]) showTab(h);
      if (h === "fund") openFund($("#fdSel").value);
    }).catch(function () { $("#dataInfo").textContent = "載入數據失敗，請重新整理頁面。"; });

    $(".fa-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tab]"); if (!b) return;
      showTab(b.dataset.tab);
      if (b.dataset.tab === "fund" && !$("#fdBody").innerHTML) openFund($("#fdSel").value);
    });
    $$("input[name=flkind], input[name=flasset]").forEach(function (r) { r.addEventListener("change", function () { sortKey = "default"; sortDir = 1; refreshRegions(); renderList(); }); });
    ["#flRegion", "#flRisk", "#flCur", "#flHouse"].forEach(function (s) { $(s).addEventListener("change", renderList); });
    $$("input[name=flcalc]").forEach(function (r) { r.addEventListener("change", renderList); });
    $("#listTable").addEventListener("click", function (e) {
      var th = e.target.closest("th[data-sort]");
      if (th) { var k = th.dataset.sort; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === "name" || k === "risk" || k === "verdict" || k === "rank3y" || k === "vol") ? 1 : -1; } renderList(); }
    });
    document.addEventListener("click", function (e) {
      var o = e.target.closest("[data-open]"); if (o) { openFund(o.dataset.open); return; }
      var a = e.target.closest("[data-add]"); if (a) { addToPortfolio(a.dataset.add); return; }
      var c = e.target.closest("[data-cmpadd]"); if (c) { toggleCompare(c.dataset.cmpadd); if ($("#fdBody").contains(c)) openFund(c.dataset.cmpadd); return; }
      var p = e.target.closest("[data-pair]"); if (p) { CMP = p.dataset.pair.split(","); cmpYears = 0; saveCmp(); renderList(); showTab("cmp"); return; }
      if (e.target.id === "pfPdf") downloadPdf();
    });
    $("#fdSel").addEventListener("change", function () { openFund(this.value); });
    $("#cmpRows").addEventListener("change", function (e) {
      var s = e.target.closest(".cmp-code"); if (!s) return;
      CMP = $$(".cmp-code").map(function (x) { return x.value; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 4);
      saveCmp(); renderList(); renderCompare();
    });
    $("#cmpRows").addEventListener("click", function (e) {
      if (!e.target.closest(".cmp-del")) return;
      var v = $(".cmp-code", e.target.closest(".fa-row")).value;
      CMP = CMP.filter(function (x) { return x !== v; }); saveCmp(); renderList(); renderCompare();
    });
    $$("[data-cmp]").forEach(function (b) { b.addEventListener("click", function () { cmpYears = +b.dataset.cmp; saveCmp(); renderCompare(); }); });
    $("#pfAdd").addEventListener("click", function () { addRow("", ""); });
    $("#pfEven").addEventListener("click", function () {
      var rows = $$("#pfRows .fa-row"), n = rows.length; if (!n) return;
      var base = Math.floor(10000 / n) / 100;
      rows.forEach(function (r, i) { $(".pf-w", r).value = i === n - 1 ? +(100 - base * (n - 1)).toFixed(2) : base; });
      updateSum();
    });
    $("#pfRows").addEventListener("input", updateSum);
    $("#pfRows").addEventListener("change", updateSum);
    $("#pfRows").addEventListener("click", function (e) {
      if (e.target.closest(".pf-del")) { e.target.closest(".fa-row").remove(); if (!$$("#pfRows .fa-row").length) addRow("", ""); updateSum(); }
    });
    $$("input[name=pfmode]").forEach(function (r) { r.addEventListener("change", save); });
    $("#pfAmt").addEventListener("input", save);
    $("#pfStart").addEventListener("change", save);
    $$("[data-back]").forEach(function (b) { b.addEventListener("click", function () { setBack(+b.dataset.back); }); });
    $("#pfRun").addEventListener("click", run);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
