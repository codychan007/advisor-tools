// node tests/quiz.test.js — 產品溫習：每條題目出卷、改卷都正常（先跑 python scripts/build_quiz.py）
const fs = require("fs"), path = require("path");
const Q = require("../assets/js/quiz-core.js");
const dir = path.join(__dirname, "../data/quiz");
let fail = 0; const ok = (c, m) => { if (!c) { console.log("❌ " + m); fail++; } };

const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const bank = { index: idx, products: idx.products, byProduct: {}, compare: JSON.parse(fs.readFileSync(path.join(dir, "compare.json"), "utf8")).questions };
idx.products.forEach(p => { bank.byProduct[p.id] = JSON.parse(fs.readFileSync(path.join(dir, p.id + ".json"), "utf8")).questions; });
const all = Object.values(bank.byProduct).flat().concat(bank.compare);

let made = 0;
all.forEach(q => {
  for (let seed = 1; seed <= 25; seed++) {
    const it = Q.make(q, Q.rng(seed * 7919 + q.id.length)); made++;
    ok(it.q && !/\{\w+\}/.test(it.q), q.id + " 題目有未填嘅 {}");
    const right = it.type === "numeric" ? String(it.answer) : it.type === "match" || it.type === "order" ? it.answer.slice() : it.answer.slice();
    ok(Q.grade(it, right), q.id + " 正確答案改唔到啱");
    if (it.options) {
      ok(it.answer.every(a => it.options.includes(a)), q.id + " 選項冇正確答案");
      ok(new Set(it.options).size === it.options.length, q.id + " 選項重複");
      const wrongOpt = it.options.find(o => !it.answer.includes(o));
      if (it.type !== "tf") ok(wrongOpt, q.id + " 冇錯誤選項");
      if (wrongOpt) ok(!Q.grade(it, [wrongOpt]), q.id + " 錯誤答案當咗啱");
      if (q.type === "single") ok(it.options.length >= 4 && it.answer.length === 1, q.id + " 單選要 4 個選項、1 個答案");
      if (it.multi && it.answer.length > 1) ok(!Q.grade(it, [it.answer[0]]), q.id + " 多選只答一個都當啱");
    }
    if (it.type === "numeric") { ok(!Q.grade(it, String(it.answer + 1)), q.id + " 數字錯都當啱"); ok(Q.grade(it, it.answer.toLocaleString("en-US")), q.id + " 有千位逗號改唔到"); }
    if (it.type === "order") ok(it.start.join() !== it.answer.join(), q.id + " 排序開頭已經係答案");
    if (it.type === "match") ok(new Set(it.right).size === it.right.length && it.left.length === it.right.length, q.id + " 配對選項唔啱");
  }
});

// 抽卷
const basic = Q.pool(bank, { stage: "product", product: "avsw", level: "basic" });
const adv = Q.pool(bank, { stage: "product", product: "avsw", level: "advanced" });
ok(basic.length === 150 && adv.length === 150, `睿選基本 ${basic.length}、進階 ${adv.length}（應該各 150）`);
ok(Q.pool(bank, { stage: "all", level: "mixed" }).length === all.length, "綜合混合 = 全部題目");
ok(Q.pool(bank, { stage: "series", series: "醫療", level: "mixed" }).length === all.length, "醫療系列包晒睿選同比較題");
for (let s = 1; s <= 50; s++) {
  const ex = Q.exam(bank, { stage: "product", product: "avsw", level: "advanced" }, s);
  ok(ex.length === 15 && new Set(ex.map(x => x.id)).size === 15, "每份卷 15 條唔重複");
  ok(ex.every(x => x.level === "advanced"), "進階卷只有進階題");
}
const e1 = Q.exam(bank, { stage: "product", product: "avsw", level: "basic" }, 1).map(x => x.id).join();
const e2 = Q.exam(bank, { stage: "product", product: "avsw", level: "basic" }, 2).map(x => x.id).join();
ok(e1 !== e2, "唔同次考試抽到唔同題目");

// 改卷
const ex = Q.exam(bank, { stage: "product", product: "avsw", level: "basic" }, 3);
const resps = ex.map((it, i) => i < 11 ? (it.type === "numeric" ? String(it.answer) : it.answer.slice()) : null);
const sc = Q.score(ex, resps);
ok(sc.right === 11 && sc.passed === true && sc.pct === 73, `11/15 = 73% 合格（${sc.right} ${sc.pct}）`);
const resps2 = resps.map((r, i) => i === 10 ? null : r);
ok(Q.score(ex, resps2).passed === false, "10/15 唔合格");

console.log(fail ? `\n${fail} 項失敗` : `✅ 題庫 ${all.length} 題、試咗 ${made} 個版本，全部正常`);
process.exit(fail ? 1 : 0);
