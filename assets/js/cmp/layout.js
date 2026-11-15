// ============================================================
// 共用版面同格式化工具
// 由保障資訊通抄過嚟（醫療及危疾比較用）；工具箱冇手機選單，mountLayout() 自動跳過
// ============================================================
import { t } from './i18n.js';

export function mountLayout() {
  mountNavGroup();
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '✕' : '☰';
  });
}

/** 「實用資訊欄」：撳開彈出 4 個頁面；撳外面或者按 Esc 收埋（同理財資訊通一樣） */
function mountNavGroup() {
  const group = document.querySelector('.nav-group');
  const btn = group?.querySelector('.nav-group-btn');
  if (!btn) return;
  const set = open => { group.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', e => { e.stopPropagation(); set(!group.classList.contains('open')); });
  document.addEventListener('click', e => { if (!group.contains(e.target)) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && group.classList.contains('open')) { set(false); btn.focus(); } });
}

// ------------------------------------------------------------
// 工具函數（之後 4 個工具共用）
// ------------------------------------------------------------
const nf0 = new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 0 });
export const money = x => (isFinite(x) ? '$' + nf0.format(Math.round(x)) : '—');
export const pct = (x, d = 0) => (isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');

/** 讀取輸入框數字（容許逗號） */
export function readNum(el) {
  const v = parseFloat(String(el.value).replace(/[,\s$]/g, ''));
  return isFinite(v) ? v : 0;
}

/** 金額輸入框：輸入時自動加千位逗號 */
export function moneyInput(el) {
  el.setAttribute('inputmode', 'numeric');
  el.addEventListener('input', () => {
    const raw = el.value.replace(/[^\d]/g, '');
    el.value = raw ? nf0.format(Number(raw)) : '';
  });
}

export async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(t(`讀取 ${path} 失敗`, `Could not load ${path}`));
  return res.json();
}

/** 今日日期（香港時間）YYYY-MM-DD */
export function todayHK() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
}

/** 產品資料超過 N 個月未更新 → true（預設 6 個月；冇日期當過時） */
export function isOutdated(updatedOn, months = 6) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedOn || '')) return true;
  const d = new Date(updatedOn + 'T00:00:00+08:00');
  d.setMonth(d.getMonth() + months);
  return new Date(todayHK() + 'T00:00:00+08:00') > d;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 保障資訊：過咗「下次檢視日期」（reviewBy）就當資料或已過時 */
export function isStale(reviewBy) {
  return reviewBy && /^\d{4}-\d{2}-\d{2}$/.test(reviewBy) && todayHK() > reviewBy;
}
