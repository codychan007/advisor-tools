// node tests/data.test.js — 用「真」資料檔（data/aia-medical-premiums.json）試晒每個醫保、每個選項，
// 確保網站揀到嘅組合全部計到數（新產品加入之後一定要過呢個）
const fs = require("fs"), path = require("path");
const C = require("../assets/js/medcalc.js");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/aia-medical-premiums.json"), "utf8"));
let fail = 0, n = 0;
const bad = m => { console.log("❌ " + m); fail++; };
for (const [key, p] of Object.entries(data.plans)) {
  if (!["basic", "high_end"].includes(p.category)) console.log("ℹ️ " + key + " category = " + p.category + "（網站會放喺「其他醫保」）");
  const sexes = p.sexSpecific ? ["M", "F"] : ["M"];
  const wards = p.wards.length > 1 ? p.wards : [null];
  const deds = p.deductibles.length ? p.deductibles.map(d => d.HKD) : [null];
  const areas = p.areas.length ? p.areas : [null];
  const riders = p.riderAvailable === false ? [false] : [false, true];
  for (const sex of sexes) for (const ward of wards) for (const ded of deds) for (const area of areas) for (const rider of riders)
    for (const age of [0, 30, 60, 80]) {
      const f = { name: "T", age, sex, savings: "GF", payYears: 5, premium: 5000, planKey: key, ward, deductible: ded, area, rider, startYear: Math.min(10, 90 - age) };
      if (f.startYear < 3) continue;
      n++;
      const v = C.validate(data, f);
      if (v.length) { bad(`${key} ${JSON.stringify(f)} 驗證唔過：${v.join("；")}`); continue; }
      try {
        const s = C.schedule(data, f);
        if (s.rows.length !== 91 - age || s.rows.some(r => !(r.usd > 0))) bad(`${key} ${age} 歲 ${sex} ${ward} ${ded} ${area}：保費有 0 或者欠年份`);
      } catch (e) { bad(`${key} ${sex} ${ward} ${ded} ${area}：${e.message}`); }
    }
}
console.log((fail ? "❌ " : "✅ ") + `試咗 ${n} 個組合，${fail} 個出錯`);
process.exit(fail ? 1 : 0);
