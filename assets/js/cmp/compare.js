// ============================================================
// 工具一：醫療及危疾產品比較、保費查詢（保險公司目錄）
// 2026-11-15 由保障資訊通搬嚟 TC Team專屬AI工具箱（Cody：公司比較只俾顧問睇，唔公開俾客人）
// 介面：保險公司列表（公司名＋計劃數目＋病房標籤，唔顯示價錢）→ 撳開同頁展開該公司計劃，
//       按「標準（普通房）／半私家／私家」分組；每個計劃一張卡，卡入面揀自付費／保障地區。
// 數據（只放核實過嘅真數據，唔顯示示例）：
//   /data/medical/vhis-standard.json       自願醫保標準計劃（醫務衞生局官方 Excel，每月自動更新）
//   /data/medical/standard-plan-terms.json 標準計劃統一保障（官方範本）
//   /data/medical/plans.compiled.json      靈活計劃及非自願醫保計劃（build.py 由 plans.json + premiums/*.csv 生成）
//   /data/ci/plans.compiled.json           危疾計劃
// 合規：只陳列客觀資料；公司按英文名排序；目錄格唔顯示價錢；唔會出現「最好／最抵／推介」。
// ============================================================
import { mountLayout, money, pct, readNum, moneyInput, loadJSON, isOutdated, esc } from './layout.js';
import { t, EN } from './i18n.js';
import { lineChart, COLORS } from './chart.js';
import { stdSchedule, stdPremium, variantPremium, pickVariant, cumulative, ciRenewablePremium, shareOfSalary } from './premium.js';

mountLayout();
const $ = id => document.getElementById(id);
const L = o => (o == null ? '' : typeof o === 'string' ? o : (EN ? o.en : o.zh) ?? o.zh ?? '');
const MAX_SEL = 3;
const WARDS = ['standard', 'semi-private', 'private', 'any'];

const S = {
  age: 30, sex: 'M', smoker: false, tab: 'med',
  ward: 'all', ded: 0, medSort: 'name',
  ciType: 'all', ciSort: 'name', ciSA: {},
  open: { med: new Set(), ci: new Set() },   // 展開咗嘅公司
  variant: {},                                // 計劃 id → 用戶喺卡入面揀嘅選項 id
  sel: [],                                    // [{kind, id}]
  trendEnd: 65,
};

let STD, TERMS, MED, CI;

async function init() {
  try {
    [STD, TERMS, MED, CI] = await Promise.all([
      loadJSON('/data/compare/medical/vhis-standard.json'), loadJSON('/data/compare/medical/standard-plan-terms.json'),
      loadJSON('/data/compare/medical/plans.compiled.json'), loadJSON('/data/compare/ci/plans.compiled.json')]);
  } catch (e) {
    $('med-list').innerHTML = `<div class="card">${t('暫時讀唔到產品資料，請遲啲再試。', 'Product data could not be loaded. Please try again later.')}</div>`;
    return;
  }
  // 唔顯示任何示例（就算資料檔仲有，都喺呢度過濾）
  MED.plans = MED.plans.filter(p => !p.sample);
  CI.plans = CI.plans.filter(p => !p.sample);
  bind();
  if (location.hash === '#ci') setTab('ci');
  render();
}

// ------------------------------------------------------------
// 醫療：每個計劃整理成統一格式（variants = 可揀嘅選項）
// ------------------------------------------------------------
const wardName = w => ({ standard: t('標準（普通房）', 'Standard (ward)'), 'semi-private': t('半私家', 'Semi-private'), private: t('私家', 'Private'), any: t('條款冇指定病房', 'No ward specified') }[w] || w);
const limitText = v => (v === 'none' ? t('不設', 'None') : typeof v === 'number' ? money(v) : v && typeof v === 'object' ? esc(L(v)) : t('見條款', 'See terms'));   // object = 文字說明（例如按年齡分開）

function stdPlans() {
  // 同一個認可編號嘅獨立保單／附加契約 合併做一個計劃，用選項揀
  const byCert = new Map();
  for (const p of STD.plans) {
    if (p.renewalOnly) continue;
    if (!byCert.has(p.certNo)) byCert.set(p.certNo, []);
    byCert.get(p.certNo).push(p);
  }
  return [...byCert.values()].map(group => {
    const p0 = group.find(p => p.issuedAs !== 'rider') || group[0];
    const variants = group.map(p => ({
      id: p.issuedAs, plan: p, deductible: 0,
      label: p.issuedAs === 'rider' ? t('附加契約（要配合基本保單）', 'Rider (needs a base policy)') : p.issuedAs === 'both' ? t('獨立保單／附加契約', 'Standalone or rider') : t('獨立保單', 'Standalone'),
      premium: a => stdPremium(p, S.sex, S.age, a),
      available: !!stdSchedule(p, S.age),
    })).sort((a, b) => (a.id === 'rider') - (b.id === 'rider'));
    return {
      kind: 'med', id: `std-${p0.certNo}`, std: true, vhis: true, insurerKey: p0.insurer.en, insurer: p0.insurer,
      name: L(p0.plan), certNo: p0.certNo, ward: 'standard', variants, variantLabel: t('投保方式', 'Issued as'),
      annualLimit: TERMS.annualLimit, lifetimeLimit: TERMS.lifetimeLimit ?? 'none', verified: true,
      wardText: t('不限病房級別（病房每日上限 $750）', 'Any ward (room up to $750 a day)'),
      features: [...L(TERMS.features).slice(0, 3), ...L(p0.otherBenefits)],
      updatedOn: STD.asOf, ageBasis: p0.ageBasis,
      sources: v => [
        [t('醫務衞生局標準保費一覽表', 'Health Bureau premium summary'), S.sex === 'F' ? STD.sourceUrl.female : STD.sourceUrl.male],
        [t('官方保費表', 'Official premium table'), L(v.plan.premiumDocUrl)],
        [t('條款及保障', 'Terms and benefits'), L(v.plan.planDocUrl)],
      ],
    };
  });
}

function otherPlans() {
  return MED.plans.map(p => {
    const variants = p.variants.map(v => ({
      id: v.id, deductible: v.deductible, area: v.area, sourceUrl: v.sourceUrl, raw: v,
      label: [L(v.label), v.area ? L(v.area) : ''].filter(Boolean).join('・'),
      premium: a => variantPremium(v, S.sex, S.smoker, S.age, a),
      available: variantPremium(v, S.sex, S.smoker, S.age) != null,
    }));
    return {
      kind: 'med', id: p.id, std: false, vhis: p.vhis, insurerKey: p.insurer.en, insurer: p.insurer,
      name: L(p.plan), certNo: p.certNo, ward: p.ward, variants, variantLabel: t('自付費／保障地區', 'Deductible / area'),
      annualLimit: p.annualLimit, lifetimeLimit: p.lifetimeLimit, roomLimit: L(p.roomLimit),
      wardText: p.ward === 'any' ? t(`條款冇指定病房（病房及膳食：${L(p.roomLimit)}）`, `No ward specified (room: ${L(p.roomLimit)})`) : `${wardName(p.ward)}${p.roomLimit ? t(`（病房及膳食：${L(p.roomLimit)}）`, ` (room: ${L(p.roomLimit)})`) : ''}`,
      features: L(p.features), updatedOn: p.updatedOn, verified: p.verified,
      sources: v => [[t('官方保費表', 'Official premium table'), v.sourceUrl || L(p.sourceUrl)], ...(p.planDocUrl ? [[t('條款及保障', 'Terms and benefits'), L(p.planDocUrl)]] : [])],
    };
  });
}

/** 計劃而家用緊邊個選項：用戶揀咗就跟用戶；否則按頂部自付費上限揀 */
function currentVariant(pl) {
  const avail = pl.variants.filter(v => v.available);
  const chosen = avail.find(v => v.id === S.variant[pl.id]);
  if (chosen) return chosen;
  if (pl.std) return avail[0] || null;
  return pickVariant(avail, S.ded) || pickVariant(avail, S.ded, avail.find(v => v.deductible <= S.ded)?.area?.en) || null;
}

function medPlans() {
  const all = [...stdPlans(), ...otherPlans()];
  return all.map(pl => { const v = currentVariant(pl), r = v?.raw || {};   // 個別選項（例如保障地區）可以有自己嘅限額
    return { ...pl, v, annualLimit: r.annualLimit ?? pl.annualLimit, lifetimeLimit: r.lifetimeLimit ?? pl.lifetimeLimit }; })
    .filter(pl => pl.v && (S.ward === 'all' || pl.ward === S.ward))
    .map(pl => ({ ...pl, premium: a => pl.v.premium(a) }));
}

// ------------------------------------------------------------
// 危疾
// ------------------------------------------------------------
const CI_TYPES = { renewable: () => t('續保型定期', 'Renewable term'), level: () => t('平準保費定期', 'Level-premium term'), savings: () => t('儲蓄型', 'Savings') };

function ciPlans() {
  const out = [];
  for (const p of CI.plans) {
    if (S.ciType !== 'all' && p.type !== S.ciType) continue;
    const priced = p.pricing === 'table';
    const opts = p.sumAssuredOptions || (p.sumAssured ? [p.sumAssured] : []);
    const sa = opts.includes(S.ciSA[p.id]) ? S.ciSA[p.id] : opts[opts.length - 1] ?? null;
    const factor = p.rateBasis === 'per1000' ? sa / 1000 : 1;
    const premium = a => { const r = priced ? ciRenewablePremium(p, S.sex, S.smoker, S.age, a) : null; return r == null ? null : Math.round(r * factor * 100) / 100; };
    const annual = premium(S.age);
    if (priced && annual == null) continue;           // 你嘅年紀唔接受投保
    if (!priced && p.issueAges && (S.age < p.issueAges[0] || S.age > p.issueAges[1])) continue;
    out.push({
      kind: 'ci', id: p.id, plan: p, insurerKey: p.insurer.en, insurer: p.insurer, name: L(p.plan),
      annual, premium, sa, saOptions: opts, updatedOn: p.updatedOn, verified: p.verified,
      sources: () => [[t('官方保費表', 'Official premium table'), L(p.premiumSourceUrl)], [t('條款／小冊子', 'Terms / brochure'), L(p.termsUrl)]].filter(x => x[1]),
    });
  }
  return out;
}

// ------------------------------------------------------------
// 排序（公司：英文名；公司入面：用戶揀嘅客觀數值）
// ------------------------------------------------------------
function sortPlans(items, sortBy) {
  const name = (a, b) => `${a.name}`.localeCompare(`${b.name}`, EN ? 'en' : 'zh-Hant');
  const num = (f, dir = 1) => (a, b) => {
    const x = f(a), y = f(b);
    if (x == null && y == null) return name(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir || name(a, b);
  };
  const by = {
    name, premium: num(i => i.premium(S.age)), 'premium-desc': num(i => i.premium(S.age), -1),
    limit: num(i => (typeof i.annualLimit === 'number' ? i.annualLimit : i.annualLimit === 'none' ? Infinity : null), -1), total: num(i => i.total), cap: num(i => i.plan.totalCapPct, -1),
  }[sortBy] || name;
  return [...items].sort(by);
}

function groupByInsurer(items) {
  const m = new Map();
  for (const it of items) {
    if (!m.has(it.insurerKey)) m.set(it.insurerKey, { key: it.insurerKey, insurer: it.insurer, items: [] });
    m.get(it.insurerKey).items.push(it);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

// ------------------------------------------------------------
// 卡片
// ------------------------------------------------------------
const isSel = (kind, id) => S.sel.some(s => s.kind === kind && s.id === id);
const badge = (txt, cls = '') => `<span class="badge ${cls}">${esc(txt)}</span>`;
const yesNo = v => (v == null ? t('見條款', 'See terms') : v ? t('有', 'Yes') : t('冇', 'No'));

function sourceLine(it, v) {
  const links = it.sources(v).map(([n, u]) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>` : esc(n))).join('・');
  const old = isOutdated(it.updatedOn) ? ` ${badge(t('資料可能已過時', 'May be out of date'), 'stale')}` : '';
  return `<div class="source">${t('資料來源：', 'Source: ')}${links}<br>${t('資料更新日期：', 'Updated: ')}${esc(it.updatedOn)}${old}</div>`;
}

function selBtn(it) {
  const on = isSel(it.kind, it.id);
  const full = !on && S.sel.filter(s => s.kind === it.kind).length >= MAX_SEL;
  return `<button type="button" class="btn ${on ? '' : 'secondary'} block sel-btn" data-kind="${it.kind}" data-id="${esc(it.id)}" aria-pressed="${on}" ${full ? 'disabled' : ''}>${
    on ? t('✓ 已加入比較', '✓ Added to compare') : full ? t('已揀滿 3 個', '3 already picked') : t('加入比較', 'Add to compare')}</button>`;
}

function variantSelect(it) {
  const avail = it.variants.filter(v => v.available);
  if (avail.length < 2) return `<div class="variant-one">${esc(it.v.label)}</div>`;
  return `<label class="variant"><span>${esc(it.variantLabel)}</span><select data-variant="${esc(it.id)}">${
    avail.map(v => `<option value="${esc(v.id)}" ${v === it.v ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>`;
}

function medCard(it) {
  const p = it.premium(S.age);
  const tags = [
    it.std ? badge(t('自願醫保・標準計劃', 'VHIS Standard Plan')) : it.vhis ? badge(t('自願醫保・靈活計劃', 'VHIS Flexi Plan')) : badge(t('非自願醫保（保費唔可以扣稅）', 'Not VHIS (no tax deduction)'), 'draft'),
    it.verified === false ? badge(t('待核實（只喺預覽版顯示）', 'Pending check (preview only)'), 'stale') : '',
  ].join(' ');
  const raw = it.v.raw || {};
  const notes = [
    (it.ageBasis || raw.ageBasis) === 'next' ? t('保費按「下次生日年齡」計。', 'Premiums use age next birthday.') : '',
    (it.ageBasis || raw.ageBasis) === 'nearest' ? t('保費按「最接近生日年齡」計，實際可能差一歲。', 'Premiums use age nearest birthday; it may differ by one year.') : '',
    S.smoker && (it.std || raw.smokerRated === false) ? t('官方保費表冇分吸煙／非吸煙，吸煙人士實際保費可能較高。', "The official table doesn't separate smokers; smokers may pay more.") : '',
    raw.unisex ? t('呢個計劃保費唔分男女。', 'Premiums for this plan are the same for men and women.') : '',
    raw.monthlyOnly ? t('呢個計劃只可月繳，年保費 = 月繳 × 12。', 'Monthly payment only; annual premium = monthly × 12.') : '',
    it.ward === 'any' ? t('條款冇指定受保病房級別，實際賠償按條款各項上限計，請睇條款。', 'The terms do not specify a covered ward class; claims follow the item limits in the terms.') : '',
  ].filter(Boolean);
  return `<article class="card plan">
    <div class="tags">${tags}</div>
    <h3>${esc(it.name)}</h3>
    ${it.certNo ? `<div class="insurer muted">${t('認可編號', 'Cert. no.')} ${esc(it.certNo)}</div>` : ''}
    ${variantSelect(it)}
    <div class="price"><b class="num">${money(p)}</b><span>${t(`每年保費（${S.age} 歲）`, `a year (age ${S.age})`)}</span></div>
    <dl class="facts">
      <div><dt>${t('每年保障限額', 'Annual limit')}</dt><dd>${limitText(it.annualLimit)}</dd></div>
      <div><dt>${t('終身保障限額', 'Lifetime limit')}</dt><dd>${limitText(it.lifetimeLimit)}</dd></div>
      <div><dt>${t('病房級別', 'Ward class')}</dt><dd>${esc(it.wardText)}</dd></div>
      <div><dt>${t('自付費', 'Deductible')}</dt><dd>${money(it.v.deductible)}</dd></div>
    </dl>
    ${it.features.length ? `<ul class="feat">${it.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
    ${sourceLine(it, it.v)}
    ${selBtn(it)}
  </article>`;
}

function diseaseTxt(d) {
  return d.severe + d.early + d.mid === 0 ? t('見條款', 'See terms') : `${d.severe} / ${d.early} / ${d.mid}`;
}

function multiTxt(m) {
  if (typeof m === 'string') return esc(m);            // 舊格式（只有中文）
  if (m && m.zh != null) return esc(L(m));             // { zh, en }
  return m ? t(`最多 ${m.times} 次・相隔 ${m.gapYears} 年・上限 ${m.capPct}%`, `Up to ${m.times}x, ${m.gapYears}-yr gap, cap ${m.capPct}%`) : t('冇', 'No');
}
const renewName = r => (!r ? '—' : r.every === 1 ? t(`每年續保至 ${r.to} 歲`, `Renewed yearly to ${r.to}`) : t(`每 ${r.every} 年續保至 ${r.to} 歲`, `Renewed every ${r.every} years to ${r.to}`));
const capName = p => (p.capText ? L(p.capText) : p.totalCapPct != null ? t(`保額 ${p.totalCapPct}%`, `${p.totalCapPct}% of sum insured`) : t('見條款', 'See terms'));

function ciCard(it) {
  const p = it.plan, d = p.diseases;
  const price = it.annual == null
    ? `<div class="price quote"><b>${t('需經持牌顧問報價', 'Quote needed from a licensed adviser')}</b><span>${t('保險公司冇公開呢個計劃嘅保費表', "The insurer hasn't published a premium table for this plan")}</span></div>`
    : `<div class="price"><b class="num">${money(it.annual)}</b><span>${t(`每年保費（${S.age} 歲，保額 ${money(it.sa)}）`, `a year (age ${S.age}, sum insured ${money(it.sa)})`)}</span></div>`;
  const saSel = it.saOptions.length > 1 ? `<label class="variant"><span>${t('保額', 'Sum insured')}</span><select data-ci-sa="${esc(it.id)}">${
    it.saOptions.map(v => `<option value="${v}" ${v === it.sa ? 'selected' : ''}>${money(v)}</option>`).join('')}</select></label>` : '';
  const notes = [
    p.monthlyOnly ? t('只可月供，年保費 = 月供 × 12。', 'Monthly payment only; annual premium = monthly × 12.') : '',
    p.rateBasis === 'per1000' ? t('保費 = 小冊子「每 $1,000 保額」費率 × 保額，未計任何保額折扣。', "Premium = the brochure's rate per $1,000 × sum insured, before any sum-insured discount.") : '',
    !p.rateBasis && p.sumAssured ? t(`保費表只列保額 ${money(p.sumAssured)}，其他保額請向保險公司查詢。`, `The premium table only lists a sum insured of ${money(p.sumAssured)}; ask the insurer about other amounts.`) : '',
    p.rider ? t('附加保障：要配合指定基本保單先可以投保。', 'Rider: must be attached to a specified base policy.') : '',
    p.effectiveDate ? t(`保費表生效日期：${p.effectiveDate}`, `Premium table effective: ${p.effectiveDate}`) : '',
  ].filter(Boolean);
  return `<article class="card plan">
    <div class="tags">${badge(CI_TYPES[p.type]?.() || t('類型見條款', 'Type: see terms'))}${p.rider ? ' ' + badge(t('附加保障', 'Rider'), 'draft') : ''}${it.verified === false ? ' ' + badge(t('待核實（只喺預覽版顯示）', 'Pending check (preview only)'), 'stale') : ''}</div>
    <h3>${esc(it.name)}</h3>
    ${saSel}
    ${price}
    <dl class="facts">
      <div><dt>${t('保障期／續保', 'Cover / renewal')}</dt><dd>${p.type === 'level' ? t(`保障至 ${p.coverTo} 歲・平準保費`, `Cover to ${p.coverTo} · level premium`) : p.renewal ? renewName(p.renewal) : esc(L(p.coverText) || '—')}</dd></div>
      <div><dt>${t('投保年齡', 'Issue age')}</dt><dd>${p.issueAges ? `${p.issueAges[0]}–${p.issueAges[1]}` : '—'}</dd></div>
      <div><dt>${t('受保疾病（嚴重／早期／中期）', 'Illnesses (severe / early / mid)')}</dt><dd>${diseaseTxt(d)}</dd></div>
      <div><dt>${t('總賠償上限', 'Total payout limit')}</dt><dd>${esc(capName(p))}</dd></div>
      <div><dt>${t('多次賠償：癌症', 'Multiple claims: cancer')}</dt><dd>${multiTxt(p.multiClaim?.cancer)}</dd></div>
      <div><dt>${t('多次賠償：心臟病', 'Multiple claims: heart')}</dt><dd>${multiTxt(p.multiClaim?.heart)}</dd></div>
      <div><dt>${t('多次賠償：中風', 'Multiple claims: stroke')}</dt><dd>${multiTxt(p.multiClaim?.stroke)}</dd></div>
      <div><dt>${t('等候期', 'Waiting period')}</dt><dd>${p.waitingDays != null ? t(`${p.waitingDays} 日`, `${p.waitingDays} days`) : t('見條款', 'See terms')}</dd></div>
      <div><dt>${t('保費保證不變', 'Premium guaranteed')}</dt><dd>${yesNo(p.premiumGuaranteed)}</dd></div>
      <div><dt>${t('保證現金價值', 'Guaranteed cash value')}</dt><dd>${yesNo(p.cashValue)}</dd></div>
    </dl>
    <ul class="feat">
      ${p.otherCover ? `<li>${esc(L(p.otherCover))}</li>` : ''}
      ${p.earlyText ? `<li>${esc(L(p.earlyText))}</li>` : ''}
      ${p.multiText ? `<li>${esc(L(p.multiText))}</li>` : ''}
      ${p.premiumText ? `<li>${esc(L(p.premiumText))}</li>` : ''}
      ${L(p.extras).map(f => `<li>${esc(f)}</li>`).join('')}
    </ul>
    ${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
    ${sourceLine(it)}
    ${selBtn(it)}
  </article>`;
}

// ------------------------------------------------------------
// 公司目錄
// ------------------------------------------------------------
function directory(kind, groups, cardFn, sortBy) {
  return groups.map(g => {
    const open = S.open[kind].has(g.key);
    const wards = kind === 'med' ? WARDS.filter(w => g.items.some(i => i.ward === w)) : [];
    const picked = g.items.filter(i => isSel(kind, i.id)).length;
    const head = `<button type="button" class="ins-head" data-ins="${esc(g.key)}" data-kind="${kind}" aria-expanded="${open}">
        <span class="ins-name"><b>${esc(L(g.insurer))}</b>${EN ? '' : `<small>${esc(g.insurer.en)}</small>`}</span>
        <span class="ins-meta">${t(`${g.items.length} 個計劃`, `${g.items.length} plan${g.items.length === 1 ? '' : 's'}`)}${
          wards.map(w => `<span class="pill">${esc(wardName(w))}</span>`).join('')}${picked ? `<span class="pill on">${t(`已揀 ${picked}`, `${picked} picked`)}</span>` : ''}</span>
        <span class="caret" aria-hidden="true"></span></button>`;
    if (!open) return `<section class="ins">${head}</section>`;
    let body;
    if (kind === 'med') {
      body = WARDS.map(w => {
        const list = sortPlans(g.items.filter(i => i.ward === w), sortBy);
        return list.length ? `<h4 class="ward-head">${esc(wardName(w))}</h4><div class="plan-list">${list.map(cardFn).join('')}</div>` : '';
      }).join('');
    } else {
      body = `<div class="plan-list">${sortPlans(g.items, sortBy).map(cardFn).join('')}</div>`;
    }
    return `<section class="ins open">${head}<div class="ins-body">${body}</div></section>`;
  }).join('');
}

// ------------------------------------------------------------
// 畫面
// ------------------------------------------------------------
let LAST = { med: [], ci: [] };

function render() {
  const med = medPlans();
  const medGroups = groupByInsurer(med);
  $('med-intro').innerHTML = `<div class="callout green">${t(
    `<b>點用：</b>撳保險公司名就會展開佢嘅計劃。自願醫保標準計劃嘅保費來自醫務衞生局官方一覽表（截至 ${STD.asOf}），所有公司標準計劃條款相同；靈活計劃保費來自醫保網站上各公司嘅官方保費表。`,
    `<b>How to use:</b> tap an insurer to see its plans. VHIS Standard Plan premiums are from the Health Bureau's official summary (as of ${STD.asOf}); all Standard Plans share the same terms. Flexi Plan premiums are from each insurer's official premium table on the VHIS website.`)}
    ${MED.plans.length ? '' : `<br><span class="muted">${t('半私家／私家（靈活計劃）資料核實緊，會陸續加入。', 'Semi-private and private (Flexi Plan) data is being verified and will be added soon.')}</span>`}</div>`;
  $('med-count').textContent = t(`${medGroups.length} 間保險公司・${med.length} 個計劃`, `${medGroups.length} insurers · ${med.length} plans`);
  $('med-list').innerHTML = directory('med', medGroups, medCard, S.medSort) ||
    `<div class="card muted">${S.ward !== 'all' && S.ward !== 'standard' && !MED.plans.length
      ? t('半私家／私家計劃資料核實緊，好快加入。而家可以揀「全部」或「標準」睇自願醫保標準計劃。', 'Semi-private and private plan data is being verified. Choose "All" or "Standard" to see VHIS Standard Plans for now.')
      : t('冇符合條件嘅計劃，試下調高可接受嘅自付費。', 'No plans match. Try accepting a higher deductible.')}</div>`;

  const ci = ciPlans();
  const ciGroups = groupByInsurer(ci);
  $('ci-intro').innerHTML = '';
  $('ci-count').textContent = CI.plans.length ? t(`${ciGroups.length} 間保險公司・${ci.length} 個計劃`, `${ciGroups.length} insurers · ${ci.length} plans`) : '';
  $('ci-list').innerHTML = !CI.plans.length
    ? `<div class="card"><h3 class="mt0">${t('危疾產品資料整理緊', 'Critical illness data is being compiled')}</h3><p class="muted">${t(
      '我哋正逐間保險公司核實定期危疾嘅公開保費表同條款，核實後會喺呢度按公司列出。',
      "We're checking each insurer's published term CI premium tables and terms. They'll be listed here by insurer once verified. To talk it through now, book a chat.")}</p></div>`
    : directory('ci', ciGroups, ciCard, S.ciSort) || `<div class="card muted">${t('呢個類型暫時未有核實咗嘅計劃，或者你嘅年齡唔接受投保。', 'No verified plans of this type yet, or your age is outside the issue ages.')}</div>`;

  LAST = { med, ci };
  renderCompare();
  renderCombo();
}

function selectedItems() {
  const pool = { med: LAST.med, ci: LAST.ci };
  S.sel = S.sel.filter(s => pool[s.kind].some(i => i.id === s.id));   // 改咗條件唔再符合就自動移除
  return S.sel.map(s => pool[s.kind].find(i => i.id === s.id));
}

function renderCompare() {
  const kind = S.tab;
  const items = selectedItems().filter(i => i.kind === kind);
  $('compare-hint').classList.toggle('hidden', items.length > 0);
  const trendItems = items.filter(i => kind === 'med' || i.annual != null);
  $('trend').classList.toggle('hidden', !trendItems.length);
  if (!items.length) { $('compare-table').innerHTML = ''; return; }
  const head = `<tr><th></th>${items.map(i => `<th>${esc(i.name)}<br><small class="muted">${esc(L(i.insurer))}</small></th>`).join('')}</tr>`;
  const row = (label, f) => `<tr><td>${label}</td>${items.map(i => `<td>${f(i)}</td>`).join('')}</tr>`;
  let rows;
  if (kind === 'med') {
    rows = [
      row(t(`年保費（${S.age} 歲）`, `Annual premium (age ${S.age})`), i => `<b>${money(i.premium(S.age))}</b>`),
      row(t('選項', 'Option'), i => esc(i.v.label)),
      row(t('每年保障限額', 'Annual limit'), i => limitText(i.annualLimit)),
      row(t('終身保障限額', 'Lifetime limit'), i => limitText(i.lifetimeLimit)),
      row(t('病房級別', 'Ward class'), i => esc(i.wardText)),
      row(t('自付費', 'Deductible'), i => money(i.v.deductible)),
      row(t('資料更新日期', 'Updated'), i => esc(i.updatedOn)),
    ];
  } else {
    rows = [
      row(t(`年保費（${S.age} 歲）`, `Annual premium (age ${S.age})`), i => (i.annual == null ? t('需報價', 'Quote') : `<b>${money(i.annual)}</b>`)),
      row(t('保額', 'Sum insured'), i => (i.sa ? money(i.sa) : '—')),
      row(t('類型', 'Type'), i => esc(CI_TYPES[i.plan.type]?.() || t('見條款', 'See terms'))),
      row(t('保障期／續保', 'Cover / renewal'), i => (i.plan.type === 'level' ? t(`至 ${i.plan.coverTo} 歲（平準）`, `To ${i.plan.coverTo} (level)`) : i.plan.renewal ? renewName(i.plan.renewal) : esc(L(i.plan.coverText) || '—'))),
      row(t('嚴重／早期／中期疾病', 'Severe / early / mid'), i => diseaseTxt(i.plan.diseases)),
      row(t('總賠償上限', 'Total payout limit'), i => esc(capName(i.plan))),
      row(t('癌症多次賠償', 'Cancer multi-claim'), i => multiTxt(i.plan.multiClaim?.cancer)),
      row(t('等候期', 'Waiting period'), i => (i.plan.waitingDays != null ? t(`${i.plan.waitingDays} 日`, `${i.plan.waitingDays} days`) : '—')),
      row(t('保費保證不變', 'Premium guaranteed'), i => yesNo(i.plan.premiumGuaranteed)),
    ];
  }
  $('compare-table').innerHTML = `<table class="data wrap-cells compare">${head}${rows.join('')}</table>`;
  if (trendItems.length) renderTrend(trendItems);
}

function renderTrend(items) {
  const end = Math.max(S.trendEnd, S.age);
  const series = items.map((it, k) => ({
    name: it.name, color: COLORS[k],
    points: Array.from({ length: end - S.age + 1 }, (_, j) => S.age + j).map(a => [a, it.premium(a)]).filter(p => p[1] != null),
  }));
  lineChart($('trend-chart'), { series, yFmt: v => (v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + v), xFmt: v => v, xLabel: t('歲', 'age') });
  const rows = items.map((it, k) => {
    const c = cumulative(it.premium, S.age, end);
    return `<tr><td><i class="dot" style="background:${COLORS[k]}"></i>${esc(it.name)}</td><td>${money(it.premium(S.age))}</td><td>${money(it.premium(end))}</td><td><b>${money(c.total)}</b>${
      c.missing ? `<small class="muted">${t(`（${c.missing} 年冇數據）`, ` (${c.missing} yrs no data)`)}</small>` : ''}</td></tr>`;
  }).join('');
  $('trend-table').innerHTML = `<table class="data wrap-cells"><tr><th>${t('計劃', 'Plan')}</th><th>${t(`${S.age} 歲`, `Age ${S.age}`)}</th><th>${t(`${end} 歲`, `Age ${end}`)}</th><th>${
    t(`累計 ${S.age}–${end} 歲（共 ${end - S.age + 1} 年）`, `Total, ages ${S.age}–${end} (${end - S.age + 1} yrs)`)}</th></tr>${rows}</table>`;
}

function renderCombo() {
  const sel = selectedItems();
  const meds = sel.filter(i => i.kind === 'med'), cis = sel.filter(i => i.kind === 'ci');
  const opt = (list, cur) => `<option value="">${t('（未揀）', '(none)')}</option>` +
    list.map(i => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  const curM = $('combo-med').value || meds[0]?.id || '', curC = $('combo-ci').value || cis[0]?.id || '';
  $('combo-med').innerHTML = opt(meds, curM);
  $('combo-ci').innerHTML = opt(cis, curC);
  const m = meds.find(i => i.id === $('combo-med').value), c = cis.find(i => i.id === $('combo-ci').value);
  if (!meds.length && !cis.length) {
    $('combo-result').innerHTML = `<p class="muted mt0">${t('喺兩個分頁各自「加入比較」，呢度就會幫你加埋。', 'Add plans to compare on each tab and they will be added up here.')}</p>`;
    return;
  }
  if (c && c.annual == null) {
    $('combo-result').innerHTML = `<p class="mt0">${t('所揀危疾計劃需要報價，暫時計唔到合計。', 'The critical illness plan needs a quote, so a total cannot be shown yet.')}</p>`;
    return;
  }
  const total = (m ? m.premium(S.age) : 0) + (c ? c.annual : 0);
  const share = shareOfSalary(total, readNum($('salary')));
  $('combo-result').innerHTML = `<div class="stat-row">
      <div class="stat"><span>${t('每年總保費', 'Total a year')}</span><b class="num">${money(total)}</b></div>
      <div class="stat"><span>${t('平均每月', 'Per month')}</span><b class="num">${money(total / 12)}</b></div>
    </div>
    <p style="margin-top:12px">${share == null ? t('填埋月薪，就計到佔你收入幾多。', 'Add your monthly salary to see the share of income.') :
      t(`大約係你年薪嘅 <span class="hl">${pct(share, 1)}</span>。`, `That's about <span class="hl">${pct(share, 1)}</span> of your yearly salary.`)}</p>`;
}

// ------------------------------------------------------------
// 互動
// ------------------------------------------------------------
function setTab(tab) {
  S.tab = tab;
  for (const k of ['med', 'ci']) {
    $(`tab-${k}`).setAttribute('aria-selected', String(k === tab));
    $(`panel-${k}`).hidden = k !== tab;
  }
  history.replaceState(null, '', tab === 'ci' ? '#ci' : location.pathname);
}

function chips(id, key, conv = v => v, after) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.setAttribute(x.classList.contains('chip') ? 'aria-pressed' : 'aria-selected', String(x === b)));
    if (key) S[key] = conv(b.dataset.v);
    after?.(b.dataset.v);
    render();
  });
}

function bind() {
  const age = $('age');
  const setAge = v => { S.age = Math.max(0, Math.min(80, Math.round(v) || 0)); age.value = S.age; render(); };
  age.addEventListener('change', () => setAge(Number(age.value)));
  document.querySelectorAll('[data-age]').forEach(b => b.addEventListener('click', () => setAge(S.age + Number(b.dataset.age))));
  chips('sex', 'sex');
  chips('smoker', 'smoker', v => v === '1');
  chips('ward', 'ward');
  chips('ded', 'ded', Number, () => { S.variant = {}; });   // 改上限就重新揀預設選項
  chips('ci-type', 'ciType');
  chips('trend-end', 'trendEnd', Number);
  moneyInput($('salary'));
  $('salary').addEventListener('input', render);
  $('med-sort').addEventListener('change', e => { S.medSort = e.target.value; render(); });
  $('ci-sort').addEventListener('change', e => { S.ciSort = e.target.value; render(); });
  $('combo-med').addEventListener('change', render);
  $('combo-ci').addEventListener('change', render);
  $('tab-med').addEventListener('click', () => { setTab('med'); render(); });
  $('tab-ci').addEventListener('click', () => { setTab('ci'); render(); });
  document.addEventListener('change', e => {
    const s = e.target.closest('select[data-variant]');
    if (s) { S.variant[s.dataset.variant] = s.value; render(); }
    const c = e.target.closest('select[data-ci-sa]');
    if (c) { S.ciSA[c.dataset.ciSa] = Number(c.value); render(); }
  });
  document.addEventListener('click', e => {
    const h = e.target.closest('.ins-head');
    if (h) {
      const set = S.open[h.dataset.kind];
      set.has(h.dataset.ins) ? set.delete(h.dataset.ins) : set.add(h.dataset.ins);
      render();
      return;
    }
    const b = e.target.closest('.sel-btn');
    if (!b) return;
    const { kind, id } = b.dataset;
    if (isSel(kind, id)) S.sel = S.sel.filter(s => !(s.kind === kind && s.id === id));
    else if (S.sel.filter(s => s.kind === kind).length < MAX_SEL) S.sel.push({ kind, id });
    render();
  });
}

init();
