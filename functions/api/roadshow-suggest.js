// /api/roadshow-suggest：同事建議新場合／擺位／評級意見，Cody 收集後交 Claude 加入 data/roadshow/manual.json。
// 存 Cloudflare KV（ROADSHOW_KV），1 年後自動刪除。GET → 全部；POST → 加一個。
import { kvList, kvPut, json, clean, looksPrivate } from "../../server/roadshow-kv.js";

const PREFIX = "sug:";

export async function onRequestGet({ env }) {
  if (!env.ROADSHOW_KV) return json({ error: "未開儲存位（ROADSHOW_KV），請 Cody 喺 Cloudflare 設定" }, 503);
  return json({ items: await kvList(env.ROADSHOW_KV, PREFIX) });
}

export async function onRequestPost({ env, request }) {
  if (!env.ROADSHOW_KV) return json({ error: "未開儲存位（ROADSHOW_KV），請 Cody 喺 Cloudflare 設定" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: "資料格式唔啱" }, 400); }
  const item = {
    type: ["event", "spot", "feedback"].includes(b.type) ? b.type : "event",
    name: clean(b.name, 80), place: clean(b.place, 120), date: clean(b.date, 40), note: clean(b.note, 500), by: clean(b.by, 30),
  };
  if (!item.name) return json({ error: "名稱一定要填" }, 400);
  if (looksPrivate(item.note + " " + item.place)) return json({ error: "似乎有電話、身份證或者電郵，請刪走私人資料" }, 400);
  await kvPut(env.ROADSHOW_KV, PREFIX + new Date().toISOString().slice(0, 10), item);
  return json({ ok: true });
}
