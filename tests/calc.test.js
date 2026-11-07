// node tests/calc.test.js — 用 VIP 試運行個案對數（skill 計嘅 withdrawals.json / ipgs.txt）
const fs = require("fs"), path = require("path");
const C = require("../assets/js/medcalc.js");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/aia-medical-premiums.json"), "utf8"));
const CASE = process.argv[2] || "C:/Users/codyc/Desktop/Normal file/Claude project/medical-saving/2026-11-07-VIP";
let fail = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fail++; };

const s = C.schedule(data, { planKey: "selectwise", age: 25, deductible: 18000, rider: false, startYear: 15 });
const want = JSON.parse(fs.readFileSync(path.join(CASE, "withdrawals.json"), "utf8"));
const got = {}; s.rows.filter(r => r.paidBy === "withdrawal").forEach(r => got[r.age] = r.withdrawal);
ok(JSON.stringify(Object.entries(got).map(([a, v]) => [+a, v])) === JSON.stringify(Object.entries(want).map(([a, v]) => [+a, v])), "51 年提取金額同 skill 一樣");
ok(Math.round(s.totals.client) === 9696, "客人自己俾 US$9,696（" + C.fmt(s.totals.client) + "）");
ok(s.totals.withdrawals === 210225, "提取合共 US$210,225（" + C.fmt(s.totals.withdrawals) + "）");

const txt = fs.readFileSync(path.join(CASE, "ipgs.txt"), "utf8");
const ip = C.parseIpgs(txt, 25);
ok(ip.count === 75, "ipgs.txt 讀到 75 年");
const r = C.check(s, ip, 25, 15);
ok(r.ok && r.rows[r.rows.length - 1].surrender === 523225, "夠錢，90 歲退保 US$523,225");

// 貼上 iPGS 表格（tab 分隔、千位逗號、「15 (40歲)」）
const pasted = "保單年度終結\t繳付保費總額\t...\n" + txt.split(";").map(l => { const [lab, ...v] = l.trim().split(" "); const [n, a] = lab.split("/"); return `${n} (${a}歲)\t` + v.map(x => (+x).toLocaleString("en-US")).map(x => x === "0" ? "-" : x).join("\t"); }).join("\n");
const ip2 = C.parseIpgs(pasted, 25);
ok(ip2.count === 75 && C.check(s, ip2, 25, 15).ok, "貼上嘅表格格式都讀到");

// 錢唔夠：第 30 年起提取少咗
const short = C.parseIpgs(txt.replace("30/55 21975 1771", "30/55 21975 900"), 25);
const r2 = C.check(s, short, 25, 15);
ok(!r2.ok && r2.firstShort === 55, "錢唔夠會報 55 歲開始唔夠");

// 驗證
ok(C.validate(data, { name: "A", age: 25, sex: "M", savings: "GF", payYears: 10, premium: 1, planKey: "standard", rider: true, startYear: 2 }).length === 3, "GF 10年／標準加附加契約／第 2 年 都會攔");
// 標準計劃港元 ÷ 7.84
const st = C.schedule(data, { planKey: "standard", age: 40, sex: "F", startYear: 10 });
ok(st.desc.convertedFromHKD && Math.abs(st.rows[0].usd - data.plans.standard.tables.find(t => t.sex === "F").annual["40"].HKD / 7.84) < 0.01, "標準計劃 ÷ 7.84");
const rd = C.schedule(data, { planKey: "flexi", age: 30, sex: "M", ward: "半私家房", rider: true, startYear: 5 });
ok(Math.abs(rd.rows[0].usd - data.plans.flexi.tables.find(t => t.sex === "M" && t.ward === "半私家房" && t.type === "basic").annual["30"].USD * 0.9) < 0.01, "附加契約 × 0.9");

// iPGS 真實複製格式：每格一行（2026-11-08 Cody 截圖），表頭都係一格一行
{
  const C2 = require("../assets/js/medcalc.js");
  const fs2 = require("fs"), p2 = require("path");
  const t = fs2.readFileSync(p2.join(CASE, "ipgs.txt"), "utf8");
  const head = "保單年度終結\n繳付保費總額\n現金提取金額\n現金提取後之基本金額\n保證現金價值\n復歸紅利\n終期分紅\n現金提取後之退保發還金額\n";
  const perCell = head + t.split(";").map(l => { const [lab, ...v] = l.trim().split(" "); const [n, a] = lab.split("/");
    return [`${n} (${a}歲)`, ...v.map(x => x === "0" ? "-" : (+x).toLocaleString("en-US"))].join("\n"); }).join("\n");
  const ip3 = C2.parseIpgs(perCell, 25);
  const s3 = C2.schedule(data, { planKey: "selectwise", age: 25, deductible: 18000, startYear: 15 });
  const r3 = C2.check(s3, ip3, 25, 15);
  ok(ip3.count === 75 && r3.ok && r3.rows[r3.rows.length - 1].surrender === 523225, "一格一行嘅 iPGS 複製格式都讀到（" + ip3.count + " 年）");
}
process.exit(fail ? 1 : 0);
