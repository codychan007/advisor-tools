// GET  /api/ps-product?company=&plan=   → 產品庫有冇呢個產品（全組同事共用，只存產品資料，唔存客人資料）
// POST /api/ps-product {company, plan, fields} → 同事核對／修改後存入產品庫
import core from "../../assets/js/ps-core.js";
import { getProduct, putProduct, json } from "../../server/ps-ai.js";

export async function onRequestGet({ request, env }) {
  if (!env.POLICY_KV) return json({ found: false, disabled: true });
  const u = new URL(request.url);
  const key = core.productKey(u.searchParams.get("company"), u.searchParams.get("plan"));
  if (key === "|") return json({ found: false });
  const p = await getProduct(env.POLICY_KV, key);
  return json(p ? { found: true, ...p } : { found: false });
}

export async function onRequestPost({ request, env }) {
  if (!env.POLICY_KV) return json({ error: "未設定 POLICY_KV" }, 503);
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: "資料格式唔啱" }, 400); }
  if (!b.plan || typeof b.plan !== "string") return json({ error: "冇計劃名稱" }, 400);
  const fields = {};
  for (const k of core.PRODUCT_KEYS) {
    if (b.fields && typeof b.fields[k] === "string" && b.fields[k].trim()) fields[k] = b.fields[k].trim().slice(0, 300);
  }
  if (!Object.keys(fields).length) return json({ error: "冇保障描述可以存" }, 400);
  await putProduct(env.POLICY_KV, core.productKey(b.company, b.plan), { company: String(b.company || "").slice(0, 60), plan: b.plan.slice(0, 120), fields, source: "同事核對" });
  return json({ ok: true });
}
