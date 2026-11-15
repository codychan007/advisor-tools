// ============================================================
// 保費計算（純函數，tests/verify.html 會驗算）
// ============================================================

/** 標準計劃：按年齡計算基準（實際年齡／最接近生日／下次生日）轉換 */
export function basisAge(plan, age) {
  return plan.ageBasis === 'next' ? age + 1 : age;
}

/**
 * 標準計劃：用投保年齡揀保費表（有啲公司按投保年齡分組，例如 0–59、60–69）
 * 回傳 schedule 或 null（呢個年齡唔接受新投保）
 */
export function stdSchedule(plan, entryAge) {
  const a = basisAge(plan, entryAge);
  return plan.schedules.find(s => s.newApp && a >= s.newApp[0] && a <= s.newApp[1]) || null;
}

/** 標準計劃：喺某個年齡嘅年保費（以投保年齡揀定嘅保費表，之後續保跟同一張表） */
export function stdPremium(plan, sex, entryAge, atAge) {
  const s = stdSchedule(plan, entryAge);
  if (!s) return null;
  const v = s[sex === 'F' ? 'female' : 'male'][basisAge(plan, atAge)];
  return v == null ? null : v;
}

/**
 * 靈活／其他計劃嘅一個選項：variant.bands = [{from, to, premiums: {male_ns: [..101], ...}}]
 * 用「投保年齡」揀保費表組（有啲公司 0–59、60–69 歲投保用唔同表），之後續保跟同一組。
 * ageBasis：next = 下次生日年齡（實際年齡 +1）；nearest／attained = 照用
 */
export function variantPremium(variant, sex, smoker, entryAge, atAge = entryAge) {
  const shift = variant?.ageBasis === 'next' ? 1 : 0;
  const e = entryAge + shift, a = atAge + shift;
  const band = (variant?.bands || []).find(b => e >= b.from && e <= b.to);
  const v = band?.premiums?.[`${sex === 'F' ? 'female' : 'male'}_${smoker ? 's' : 'ns'}`]?.[a];
  return v == null ? null : v;
}

/** 揀自付費：計劃有嘅選項入面，唔超過「最多可接受」嘅最高一個（保費最低）；冇就 null */
export function pickDeductible(options, maxAccept) {
  const ok = options.filter(d => d <= maxAccept);
  return ok.length ? Math.max(...ok) : null;
}

/** 揀預設選項：同一保障地區（預設第一個地區）入面，自付費唔超過可接受上限嘅最高一個 */
export function pickVariant(variants, maxDeductible, areaKey) {
  const area = areaKey ?? (variants[0]?.area?.en || '');
  const same = variants.filter(v => (v.area?.en || '') === area);
  const d = pickDeductible(same.map(v => v.deductible), maxDeductible);
  return d == null ? null : same.find(v => v.deductible === d);
}

/**
 * 累計保費：由 fromAge 交到 toAge（包括頭尾兩年），fn(age) 回傳該年保費
 * 回傳 { total, years, missing }；missing = 有幾多年冇保費數據
 */
export function cumulative(fn, fromAge, toAge) {
  let total = 0, years = 0, missing = 0;
  for (let a = fromAge; a <= toAge; a++) {
    const v = fn(a);
    if (v == null) missing++; else { total += v; years++; }
  }
  return { total, years, missing };
}

/**
 * 續保型危疾：plan.rates[male_ns|...][age] = 指定保額嘅年保費（按當時年齡）
 * 每 renewal.every 年續保一次，期內保費不變：atAge 嘅保費 = 投保年齡 + every × 已過幾多個保障期 嗰歲嘅費率
 * 投保年齡唔喺 issueAges，或者 atAge 超過最高續保年齡 → null
 */
export function ciRenewablePremium(plan, sex, smoker, entryAge, atAge = entryAge) {
  const [lo, hi] = plan.issueAges || [0, 100];
  if (entryAge < lo || entryAge > hi || atAge < entryAge) return null;
  if (plan.type === 'level') {   // 平準保費：按投保年齡費率，供到 payTo（冇寫就到 coverTo）前一歲
    const until = plan.payTo ?? plan.coverTo;
    if (until != null && atAge >= until) return null;
    const v0 = plan.rates?.[`${sex === 'F' ? 'female' : 'male'}_${smoker ? 's' : 'ns'}`]?.[entryAge];
    return v0 == null ? null : v0;
  }
  const every = plan.renewal?.every || 1;
  if (plan.renewal?.to != null && atAge >= plan.renewal.to + (every === 1 ? 1 : 0)) return null;
  const rateAge = entryAge + every * Math.floor((atAge - entryAge) / every);
  const v = plan.rates?.[`${sex === 'F' ? 'female' : 'male'}_${smoker ? 's' : 'ns'}`]?.[rateAge];
  return v == null ? null : v;
}

/** 危疾：年保費 = 每 $100,000 保額費率 × 保額 ÷ 100,000 */
export const ciAnnual = (ratePer100k, sumAssured) => ratePer100k * sumAssured / 100000;

/** 危疾：供款年數（「to65」＝供到 65 歲） */
export const ciPayYears = (payTerm, age) => (payTerm === 'to65' ? Math.max(0, 65 - age) : Number(payTerm));

/** 危疾：總保費（平準保費 × 供款年數） */
export const ciTotal = (annual, payTerm, age) => annual * ciPayYears(payTerm, age);

/** 保費佔年薪 % */
export const shareOfSalary = (annualPremium, monthlySalary) => (monthlySalary > 0 ? annualPremium / (monthlySalary * 12) : null);
