// node tests/fund.test.js — 基金分析：用真資料（data/funds/）核對
// 1. 網頁計數（assets/js/fundcalc.js）同數據程式（scripts/build_funds.py）計出嚟一樣
// 2. 計出嚟嘅每年回報同 AIA 官網公佈嘅數字吻合（美元基金）
// 3. 組合回測：收現金／再投資兩種計法自己對得埋數；表格檢查會擋錯誤輸入
const fs = require("fs"), path = require("path");
const F = require("../assets/js/fundcalc.js");
const dir = path.join(__dirname, "../data/funds");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const meta = {}, data = {};
index.funds.forEach(m => { meta[m.code] = m; data[m.code] = JSON.parse(fs.readFileSync(path.join(dir, m.code + ".json"), "utf8")); });
let fail = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { console.log("❌ " + msg); fail++; } };
const near = (a, b, tol, msg) => ok(a != null && b != null && Math.abs(a - b) <= tol, `${msg}：${a} vs ${b}`);

// --- 數據本身 ---
ok(index.funds.filter(m => m.dist).length >= 30, "派息基金數目太少");
ok(index.funds.filter(m => !m.dist).length >= 100, "累積基金數目太少");
ok((index.problems || []).length <= 5, "核對唔過嘅基金太多：" + (index.problems || []).join(","));
for (const m of index.funds) {
  const d = data[m.code];
  ok(d.prices.length > 0, `${m.code} 冇價格`);
  ok(d.prices.every((p, i) => i === 0 || p[0] > d.prices[i - 1][0]), `${m.code} 價格日子唔係由舊到新`);
  ok(d.dividends.every((x, i) => i === 0 || x[0] > d.dividends[i - 1][0]), `${m.code} 派息日子重複或者次序錯`);
  for (const x of d.dividends) {
    const nav = F.after(d.prices, x[0]);
    ok(!nav || (x[1] / nav[1] > 0.0001 && x[1] / nav[1] < 0.12), `${m.code} ${x[0]} 派息 ${x[1]} 唔合理`);
  }
  ok(["USD", "RMB", "HKD", "EUR", "JPY"].includes(m.currency), `${m.code} 貨幣 ${m.currency}`);
  ok(m.dist || d.dividends.length === 0, `${m.code} 累積基金唔應該有派息`);
  ok(["低", "中", "高"].includes(m.risk), `${m.code} 風險 ${m.risk}`);
}
const checked = index.funds.filter(m => m.checkOk).length;
ok(checked >= index.funds.length - 10, `核對過關嘅基金太少（${checked}/${index.funds.length}）`);

// --- 1 + 2：網頁計法 = 數據程式計法；美元基金同 AIA 公佈嘅每年回報差唔多 ---
for (const m of index.funds) {
  for (const c of m.checks.filter(c => "aia" in c)) {
    if (m.currency !== "USD") continue;            // 人民幣類別：AIA 用美元計，數據程式已經換算核對
    const start = c.year === "YTD" ? `${+m.perfAsOf.slice(0, 4) - 1}-12-31` : `${+c.year - 1}-12-31`;
    const end = c.year === "YTD" ? m.perfAsOf : `${c.year}-12-31`;
    const js = F.totalReturn(data[m.code], start, end);
    if (!c.adjusted) near(+js.toFixed(2), c.ours, 0.011, `${m.code} ${c.year} 網頁 vs 數據程式`);
    near(js, c.aia, 0.6, `${m.code} ${c.year} 同 AIA 公佈`);
  }
  for (const [key, yrs] of [["r1y", 1], ["r2y", 2], ["r3y", 3], ["r5y", 5]]) {
    if (m[key] == null) continue;
    const end = m.priceDate, start = F.addDays(end, -365 * yrs);
    near(+F.totalReturn(data[m.code], start, end).toFixed(2), m[key], 0.011, `${m.code} ${key}`);
  }
}

// --- 「收現金」計法：網頁 = 數據程式；走勢指數最後一點 = 收現金回報 ---
for (const m of index.funds) {
  for (const [key, yrs] of [["c1y", 1], ["c2y", 2], ["c3y", 3], ["c5y", 5]]) {
    if (m[key] == null) continue;
    const end = m.priceDate, start = F.addDays(end, -365 * yrs);
    near(+F.cashReturn(data[m.code], start, end).toFixed(2), m[key], 0.011, `${m.code} ${key}`);
  }
  if (!m.dist) ok(m.c1y === m.r1y, `${m.code} 累積基金兩種計法應該一樣`);
}
for (const m of index.funds.filter(m => m.dist && m.c1y != null).slice(0, 15)) {
  const start = F.addDays(m.priceDate, -365), ci = F.cashIndex(data[m.code], start);
  near(ci[ci.length - 1][1] - 100, F.cashReturn(data[m.code], start, m.priceDate), 0.01, `${m.code} 收現金指數 = 收現金回報`);
}

// --- 總回報指數（比較圖用）最後一點 = 總回報 ---
for (const m of index.funds.slice(0, 40)) {
  if (m.r1y == null) continue;
  const start = F.addDays(m.priceDate, -365), tr = F.trIndex(data[m.code], start);
  near(tr[0][1], 100, 1e-9, `${m.code} 指數由 100 開始`);
  near(tr[tr.length - 1][1] - 100, F.totalReturn(data[m.code], start, m.priceDate), 0.01, `${m.code} 指數 = 總回報`);
}

// --- 固定例子：摩根亞太入息（Z03）2023 年 AIA 公佈 6.38% ---
if (data.Z03) near(F.totalReturn(data.Z03, "2022-12-31", "2023-12-31"), 6.38, 0.1, "Z03 2023 年回報");

// --- 3：組合回測 ---
const usd = index.funds.filter(m => m.currency === "USD" && m.checkOk && m.dataFrom && m.dataFrom <= F.addDays(m.priceDate, -400));
ok(usd.length >= 3, "夠一年數據嘅美元基金太少");
const pick = usd.slice(0, 3);
const start = pick.reduce((d, m) => (m.dataFrom > d ? m.dataFrom : d), "2000-01-01") > F.addDays(pick[0].priceDate, -365)
  ? pick.reduce((d, m) => (m.dataFrom > d ? m.dataFrom : d), "2000-01-01") : F.addDays(pick[0].priceDate, -365);
const input = { items: [{ code: pick[0].code, weight: 50 }, { code: pick[1].code, weight: 30 }, { code: pick[2].code, weight: 20 }], amount: 100000, start };
ok(F.check({ ...input, mode: "cash" }, meta).length === 0, "正常組合唔應該有錯：" + F.check({ ...input, mode: "cash" }, meta).join("；"));
const cash = F.backtest({ ...input, mode: "cash" }, data, meta);
const re = F.backtest({ ...input, mode: "reinvest" }, data, meta);
near(cash.invest, 100000, 0.001, "投入金額");
near(cash.total, cash.endValue + cash.cash, 0.001, "收現金：總值 = 基金價值 + 已收息");
near(cash.cash, cash.dividendsTotal, 0.001, "收現金：已收息 = 派息總數");
for (const f of cash.funds) {
  const exp = data[f.code].dividends.filter(d => d[0] >= f.buyDate && d[0] <= f.endDate).reduce((s, d) => s + f.units0 * d[1], 0);
  near(f.dividendsTotal, exp, 0.001, `${f.code} 收現金派息 = 單位 × 每單位派息`);
}
near(re.cash, 0, 1e-9, "再投資：冇現金");
for (const f of re.funds) {
  // 買入日正好係價格日 → 再投資回報 = totalReturn（由買入日前一個價格日起計）
  const prev = F.onOrBefore(data[f.code].prices, F.addDays(f.buyDate, -1));
  const tr = F.totalReturn(data[f.code], f.buyDate, f.endDate);
  near(f.returnPct, tr, 0.05, `${f.code} 再投資回報 = 總回報計法`);
  ok(prev == null || prev[0] < f.buyDate, `${f.code} 買入日`);
}
near(re.series[re.series.length - 1].total, re.total, 0.01, "走勢最後一點 = 總值");
near(cash.series[0].total, 100000, 0.01, "走勢第一點 = 投入金額");
ok(cash.monthly.reduce((s, x) => s + x.amount, 0) - cash.dividendsTotal < 0.01, "每月派息加埋 = 派息總數");

// --- 派息 + 累積混合（累積基金冇現金派息；基金內部派息調整一定再投資） ---
const acc = index.funds.find(m => !m.dist && m.currency === "USD" && m.checkLevel === "adjusted" && m.dataFrom <= start)
  || index.funds.find(m => !m.dist && m.currency === "USD" && m.dataFrom <= start);
const mix = F.backtest({ items: [{ code: pick[0].code, weight: 70 }, { code: acc.code, weight: 30 }], amount: 100000, start, mode: "cash" }, data, meta);
const accRes = mix.funds.find(f => f.code === acc.code);
near(accRes.dividendsTotal, 0, 1e-9, `${acc.code} 累積基金冇現金派息`);
near(accRes.returnPct, F.totalReturn(data[acc.code], accRes.buyDate, accRes.endDate), 0.05, `${acc.code} 累積基金回報 = 總回報計法`);

// --- 表格檢查 ---
const rmb = index.funds.find(m => m.currency === "RMB" && m.dist);
const errs = (inp) => F.check({ amount: 100000, start, mode: "cash", ...inp }, meta);
ok(errs({ items: [{ code: pick[0].code, weight: 60 }, { code: pick[1].code, weight: 30 }] }).some(e => e.includes("100%")), "% 唔夠 100 要報錯");
if (rmb) ok(errs({ items: [{ code: pick[0].code, weight: 50 }, { code: rmb.code, weight: 50 }] }).some(e => e.includes("同一種貨幣")), "混貨幣要報錯");
ok(errs({ items: [{ code: pick[0].code, weight: 100 }], start: "2000-01-01" }).some(e => e.includes("最早")), "開始日太早要報錯");
ok(errs({ items: [{ code: pick[0].code, weight: 50 }, { code: pick[0].code, weight: 50 }] }).some(e => e.includes("兩次")), "同一隻揀兩次要報錯");

// --- 提示 ---
ok(F.verdict({ r1y: -1, pr1y: -5 }).level === "bad", "verdict bad");
ok(F.verdict({ r1y: 3, pr1y: -2 }).level === "warn", "verdict warn");
ok(F.verdict({ r1y: 8, pr1y: 1 }).level === "good", "verdict good");
ok(F.verdict({ r1y: null, pr1y: null }).level === "na", "verdict na");
ok(F.verdict({ dist: false, r1y: 5, pr1y: 5 }).level === "na", "累積基金冇派息提示");

// --- PDF 檔案結構（兩頁假 JPEG）：開頭 %PDF、結尾 %%EOF、xref 位置啱 ---
const P = require("../assets/js/fund-pdf.js");
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const pdf = Buffer.from(P.build([{ jpeg, w: 100, h: 140 }, { jpeg, w: 100, h: 60 }])).toString("latin1");
ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"), "PDF 頭尾");
const sx = +pdf.match(/startxref\n(\d+)/)[1];
ok(pdf.slice(sx, sx + 4) === "xref", "PDF xref 位置");
const offs = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
ok(offs.length === 8 && offs.every((o, i) => pdf.slice(o).startsWith((i + 1) + " 0 obj")), "PDF 每個物件位置");
ok(/\/Count 2/.test(pdf), "PDF 兩頁");

console.log((fail ? "❌ " : "✅ ") + `基金分析：${n} 項檢查，${fail} 項出錯（${index.funds.length} 隻基金，${checked} 隻核對過關）`);
process.exit(fail ? 1 : 0);
