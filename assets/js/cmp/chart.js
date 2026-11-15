// ============================================================
// 簡單 SVG 線圖（唔靠外部程式庫）：4 個工具共用
// lineChart(el, { series: [{ name, color, points: [[x, y], ...] }], yFmt, xFmt, xLabel })
// ============================================================
import { esc } from './layout.js';

export const COLORS = ['#2E4A6B', '#B98327', '#4F6B3A', '#8C2614'];

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function lineChart(el, { series, yFmt = v => v, xFmt = v => v, xLabel = '', dashed = [] }) {
  // 畫布闊度跟容器（1:1 像素），手機上啲字唔會縮到睇唔到
  const W = Math.max(300, Math.min(900, el.clientWidth || 640)), H = Math.round(Math.min(320, Math.max(220, W * 0.55))), L = 58, R = 14, T = 14, B = 40;
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { el.innerHTML = ''; return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const yMax = niceMax(Math.max(...ys) * 1.05);
  const X = x => L + ((x - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = y => T + (1 - y / yMax) * (H - T - B);
  const grid = [0, .25, .5, .75, 1].map(f => {
    const v = yMax * f, y = Y(v);
    return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity=".12"/>` +
      `<text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="currentColor" fill-opacity=".65">${esc(yFmt(v))}</text>`;
  }).join('');
  const step = Math.max(1, Math.ceil((x1 - x0) / 8 / 5) * 5);
  let xt = '';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    xt += `<text x="${X(x)}" y="${H - B + 18}" text-anchor="middle" font-size="12" fill="currentColor" fill-opacity=".65">${esc(xFmt(x))}</text>`;
  }
  const lines = series.map((s, i) => {
    if (!s.points.length) return '';
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const last = s.points[s.points.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" ${dashed.includes(i) ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round"/>` +
      `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3.5" fill="${s.color}"/>`;
  }).join('');
  const legend = series.map(s => `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}" style="width:100%;height:auto;color:var(--ink)">
    ${grid}<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" stroke-opacity=".5"/>${xt}
    <text x="${W - R}" y="${H - 4}" text-anchor="end" font-size="12" fill="currentColor" fill-opacity=".65">${esc(xLabel)}</text>${lines}</svg>
    <div class="legend">${legend}</div>`;
}
