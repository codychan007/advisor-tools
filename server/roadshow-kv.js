// Road Show 記錄同建議共用：KV 讀寫（每筆 1 年自動到期）、清理輸入、私隱檢查。
export const ONE_YEAR = 365 * 24 * 3600;

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export function clean(s, max) {
  return String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

export function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
}

// 香港身份證、8 位電話、電郵 → 唔收
export function looksPrivate(s) {
  return /\b[A-Z]{1,2}\d{6}\s?\(?[\dA]\)?/i.test(s) || /(^|\D)[2-9]\d{3}\s?-?\d{4}(\D|$)/.test(s) || /@\w/.test(s);
}

// 整份資料放喺 metadata（≤ 1KB），list 一次過攞晒，唔使逐條讀，慳 KV 讀取次數
export async function kvPut(kv, keyPrefix, item) {
  const created = new Date().toISOString();
  const key = `${keyPrefix}:${created}:${crypto.randomUUID().slice(0, 8)}`;
  const value = JSON.stringify({ ...item, created });
  let meta = { ...item, created };
  if (JSON.stringify(meta).length > 1000) meta = { ...meta, note: meta.note.slice(0, 120) + "…" };
  await kv.put(key, value, { expirationTtl: ONE_YEAR, metadata: meta });
}

export async function kvList(kv, prefix) {
  const items = [];
  let cursor;
  do {
    const r = await kv.list({ prefix, cursor, limit: 1000 });
    r.keys.forEach((k) => k.metadata && items.push(k.metadata));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && items.length < 5000);
  return items.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
