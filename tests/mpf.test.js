// 強積金工具：配置規則、單張比較、數據格式。node tests/mpf.test.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const C = require("../assets/js/mpf-core.js");
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "mpf", f), "utf8"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const rules = D("allocation-rules.json"), themes = D("themes.json"), market = D("market.json"), prices = D("prices-index.json");

// ---- 數據 ----
ok(market.funds.length >= 400, "全行基金少過 400 隻：" + market.funds.length);
ok(/^\d{4}-\d{2}-\d{2}$/.test(market.asof), "積金局截至日");
ok(market.calYears.length === 5, "每年回報年份");
ok(market.funds.every((f) => f.id && f.scheme && f.fund && f.category && f.schemeEn), "每隻基金要有編號、計劃、名、類別、英文計劃名");
ok(market.funds.filter((f) => f.fer != null).length > market.funds.length * 0.95, "FER 缺太多");
ok(market.funds.filter((f) => f.schemeEn === "AIA MPF - Prime Value Choice").length >= 20, "友邦計劃基金");
ok(Object.keys(prices.funds).length >= market.funds.length * 0.95, "有價格嘅基金太少");
ok(prices.dailyCount >= 100, "每日價基金太少：" + prices.dailyCount);
Object.entries(prices.funds).slice(0, 50).forEach(([id, p]) => {
  ok(market.funds.some((f) => f.id === id), "價格對唔到基金 " + id);
  ok(p.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date), "價格格式 " + id);
});
const fsIdx = D("factsheets/index.json");
ok(fsIdx.issues.length >= 1, "最少一期基金單張");
const lastFs = D("factsheets/aia-" + fsIdx.issues[fsIdx.issues.length - 1].month + ".json");
ok(Object.keys(lastFs.funds).length >= 18, "單張基金數");
Object.values(lastFs.funds).forEach((f) => {
  if (f.alloc.length) ok(Math.abs(f.alloc.reduce((a, x) => a + x[1], 0) - 100) < 2, f.name + " 資產分布加埋唔係 100");
});
const ids = themes.themes.map((t) => t.id);
ok(themes.active.ids.every((i) => ids.includes(i)), "本月主題要喺主題庫");
themes.themes.forEach((t) => Object.keys(t.tilt).forEach((b) => ok(b in rules.buckets, t.id + " 用咗唔存在嘅類別 " + b)));
ok(Object.values(rules.equityCore).reduce((a, b) => a + b, 0) === 100, "股票核心比重要加埋 100");
const offers = D("offers.json");
ok(offers.offers.every((o) => o.trustee && o.source && o.checked), "優惠要有來源同核對日期");

// ---- 配置 ----
const schemes = [...new Set(market.funds.map((f) => f.schId))];
for (const sid of schemes) {
  const sf = market.funds.filter((f) => f.schId === sid);
  for (const age of [22, 35, 50, 58, 64]) for (const profile of ["conservative", "balanced", "growth", "custom"]) for (const nF of [2, 3, 5]) {
    const r = C.allocate(rules, themes, { age, profile, customEquity: 70, nFunds: nF, themeIds: themes.active.ids, schemeFunds: sf });
    const tot = r.buckets.reduce((a, b) => a + b.weight, 0);
    if (!r.warnings.length) ok(tot === 100, `${sid} ${age} ${profile} ${nF}：合計 ${tot}`);
    ok(r.buckets.length <= nF, "基金數超過上限");
    ok(r.buckets.every((b) => b.weight % 5 === 0), "要約到 5%");
    ok(r.buckets.every((b) => b.cands.length > 0), "每個類別要有候選基金");
    const prof = rules.profiles[profile];
    const e0 = profile === "custom" ? 70 : prof.equity;
    ok(r.equity <= Math.min(e0, r.equityCap) + 5, `${sid} ${age} ${profile}：股票 ${r.equity} 超過 ${Math.min(e0, r.equityCap)}`);
    if (Math.min(e0, r.equityCap) >= 10 && r.equity === 0 && !r.warnings.length) ok(false, "股票部分唔見咗");
  }
}
assert.strictEqual(C.equityCap(rules, 30), 100); assert.strictEqual(C.equityCap(rules, 1), 20); assert.strictEqual(C.equityCap(rules, 15), 80); n += 3;
assert.strictEqual(C.disEquity(30), 60); assert.strictEqual(C.disEquity(64), 20); n += 2;
const rr = C.roundTo({ a: 33.4, b: 33.3, c: 33.3 }, 5); assert.strictEqual(Object.values(rr).reduce((a, b) => a + b, 0), 100); n++;

// ---- 單張比較 ----
const prev = { alloc: [["美國 United States", 60], ["香港 Hong Kong", 40]], top10: [["A", 5], ["B", 4]], topAsof: "2026-07-31", reportZh: "本基金於7月份錄得1.2%回報。市場關注減息。" };
const cur = { alloc: [["美國 United States", 65], ["香港 Hong Kong", 35]], top10: [["A", 5.5], ["C", 3]], topAsof: "2026-09-30", reportZh: "本基金於9月份錄得2.5%回報。市場關注減息。人工智能股票表現強勁。" };
const d = C.diffFactsheet(prev, cur);
assert.strictEqual(d.alloc[0].diff, 5); assert.deepStrictEqual(d.topIn.map((x) => x[0]), ["C"]); assert.deepStrictEqual(d.topOut.map((x) => x[0]), ["B"]);
assert.deepStrictEqual(d.sentences.map((s) => s.isNew), [false, false, true]); ok(d.keywords.includes("AI／科技"), "關鍵字");
n += 4;
console.log(`mpf.test.js：${n} 項全部通過`);
