// 醫療及危疾比較：保費公式驗算（由保障資訊通 tests/verify.html 搬過嚟，2026-11-15）。用法：node tests/compare.test.mjs
// 「預期」數字係直接由醫務衞生局官方 Excel／保險公司 CSV 逐格加總（另一個程式），唔係用網站程式計。
import fs from 'node:fs';
import assert from 'node:assert';
import * as P from '../assets/js/cmp/premium.js';

const J = p => JSON.parse(fs.readFileSync(new URL(`../data/compare/${p}`, import.meta.url), 'utf8'));
let n = 0;
const row = (name, exp, got) => { assert.ok(Math.abs(exp - got) < 0.01, `${name}：預期 ${exp}，計到 ${got}`); n++; };

const std = J('medical/vhis-standard.json');
const plan = (cert, rider = false) => std.plans.find(p => p.certNo.startsWith(cert) && (p.issuedAs === 'rider') === rider);
const cum = (p, sex, a0, a1) => P.cumulative(a => P.stdPremium(p, sex, a0, a), a0, a1).total;
if (std.asOf === '2026-11-02') {
  row('例 1：AIA 標準計劃（獨立保單）男 30→65 歲累計', 186603.2, cum(plan('S00013'), 'M', 30, 65));
  row('例 2：AIA 標準計劃（附加契約）男 30→65 歲累計', 170388.8, cum(plan('S00013', true), 'M', 30, 65));
  row('例 3：亞洲保險「延愛」男 30→65 歲累計', 170307, cum(plan('S00027'), 'M', 30, 65));
  row('例 4：保泰標準計劃 女 25→85 歲累計', 366312, cum(plan('S00023'), 'F', 25, 85));
  row('例 5：保柏（0–59 歲投保組）男 40→85 歲累計', 620298, cum(plan('S00020'), 'M', 40, 85));
  row('例 6：保柏 65 歲投保要用 60–69 歲組（72 歲保費）', 28154, P.stdPremium(plan('S00020'), 'M', 65, 72));
} else {
  console.log(`ℹ️ 官方標準計劃表已更新至 ${std.asOf}：標準計劃累計例子要用新 Excel 重新計預期數字（暫時跳過）`);
}
row('危疾：費率 443.3 × $1,000,000 ÷ 100,000', 4433, P.ciAnnual(443.3, 1000000));
row('危疾：$4,433 × 20 年', 88660, P.ciTotal(4433, 20, 30));
row('危疾：$500,000 保額、費率 250', 1250, P.ciAnnual(250, 500000));
row('危疾：30 歲供到 65 歲 = 35 年', 35, P.ciPayYears('to65', 30));
row('自付費：可接受 $2 萬，選項 2.5 萬/5 萬/10 萬 → 冇（-1）', -1, P.pickDeductible([25000, 50000, 100000], 20000) ?? -1);
row('自付費：可接受 $5 萬，選項 0/2 萬/5 萬 → 5 萬', 50000, P.pickDeductible([0, 20000, 50000], 50000));
row('保費佔年薪：$30,000 ÷ ($25,000 × 12)', 0.1, P.shareOfSalary(30000, 25000));
const ciD = J('ci/plans.compiled.json');
const ciP = id => ciD.plans.find(p => p.id === id);
row('危疾：AIA 簡護危疾保 男非吸煙 30→65 歲累計（每 5 年續保）', 576360, P.cumulative(a => P.ciRenewablePremium(ciP('aia-simple-care-essence'), 'M', false, 30, a), 30, 65).total);
row('危疾：AIA 簡護危疾保 32 歲投保、36 歲保費 = 32 歲費率', P.ciRenewablePremium(ciP('aia-simple-care-essence'), 'M', false, 32, 32), P.ciRenewablePremium(ciP('aia-simple-care-essence'), 'M', false, 32, 36));
row('危疾：保泰危疾保 男非吸煙 30→65 歲累計（每年續保）', 136716, P.cumulative(a => P.ciRenewablePremium(ciP('bowtie-term-ci'), 'M', false, 30, a), 30, 65).total);
row('危疾：保泰多重危疾保 女吸煙 25→65 歲累計', 292236, P.cumulative(a => P.ciRenewablePremium(ciP('bowtie-term-ci-multiple'), 'F', true, 25, a), 25, 65).total);
row('危疾：66 歲唔接受新投保（-1）', -1, P.ciRenewablePremium(ciP('bowtie-term-ci'), 'M', false, 66, 66) ?? -1);
const vs = [{ id: 'a0', deductible: 0, area: { en: 'Asia' } }, { id: 'a16', deductible: 16000, area: { en: 'Asia' } }, { id: 'a50', deductible: 50000, area: { en: 'Asia' } }, { id: 'w0', deductible: 0, area: { en: 'Worldwide' } }];
row('預設選項：上限 $2 萬 → 亞洲 $16,000', 16000, P.pickVariant(vs, 20000).deductible);
row('預設選項：上限 $0 → 亞洲 $0', 0, P.pickVariant(vs, 0).deductible);
const med = J('medical/plans.compiled.json');
assert.ok(med.plans.length >= 100 && med.plans.every(p => p.verified), '醫療 compiled：只可以有已核實計劃'); n++;
assert.ok(ciD.plans.length >= 50 && ciD.plans.every(p => p.verified), '危疾 compiled：只可以有已核實計劃'); n++;
console.log(`✅ 醫療及危疾比較：${n} 項通過`);
