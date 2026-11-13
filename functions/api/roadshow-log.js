// /api/roadshow-log：同事記錄每次 Road Show 嘅數字（冇客人資料）。存 Cloudflare KV（ROADSHOW_KV），1 年後自動刪除。
// GET  → 最近 1 年全部紀錄；POST → 加一筆。
import { kvList, kvPut, json, clean, num, looksPrivate } from "../../server/roadshow-kv.js";

const PREFIX = "log:";

export async function onRequestGet({ env }) {
  if (!env.ROADSHOW_KV) return json({ error: "未開儲存位（ROADSHOW_KV），請 Cody 喺 Cloudflare 設定" }, 503);
  return json({ items: await kvList(env.ROADSHOW_KV, PREFIX) });
}

export async function onRequestPost({ env, request }) {
  if (!env.ROADSHOW_KV) return json({ error: "未開儲存位（ROADSHOW_KV），請 Cody 喺 Cloudflare 設定" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: "資料格式唔啱" }, 400); }
  const item = {
    eventId: clean(b.eventId, 80), eventName: clean(b.eventName, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "",
    spot: clean(b.spot, 60),
    people: num(b.people, 1, 200), hours: num(b.hours, 0.5, 24),
    surveys: num(b.surveys, 0, 9999), leads: num(b.leads, 0, 9999), meets: num(b.meets, 0, 9999), deals: num(b.deals, 0, 9999),
    note: clean(b.note, 300), by: clean(b.by, 30),
  };
  if (!item.eventName || !item.date || item.people == null || item.hours == null) return json({ error: "活動、日期、人數同鐘數一定要填" }, 400);
  if (looksPrivate(item.note + " " + item.spot)) return json({ error: "似乎有電話、身份證或者電郵，請刪走客人資料" }, 400);
  await kvPut(env.ROADSHOW_KV, PREFIX + item.date, item);
  return json({ ok: true });
}
