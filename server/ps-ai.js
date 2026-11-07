// 保單整理器 – 伺服器（Cloudflare Pages Functions）共用：Claude 請求、每月上限、產品庫。
// 放喺 functions/ 以外，免得變成網址。冇任何密鑰：API key 喺 Cloudflare secret ANTHROPIC_API_KEY。
import Anthropic from "@anthropic-ai/sdk";
import core from "../assets/js/ps-core.js";

export const MODEL = "claude-sonnet-5-5"; // Cody 2026-11-08 揀
const { FIELDS, PRICE } = core;

const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.short]));

const RULES = core.RULES; // 同「複製去我嘅 AI」共用同一套規則

function schemaFor(keys) {
  const props = {};
  for (const k of keys) props[k] = { type: "string", description: LABEL[k] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["fields", "warnings"],
    properties: {
      fields: { type: "object", additionalProperties: false, required: keys, properties: props },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

// kind: "policy"（客人保單／週年報表）或 "brochure"（產品小冊子 → 入產品庫）
export function buildRequest({ kind, texts, images, hint }) {
  const keys = core.keysFor(kind);
  const want = keys.map((k) => `${k}=${LABEL[k]}`).join("、");
  const content = [];
  for (const im of images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
  }
  const textPart = (texts || []).map((t) => `--- ${t.name || "文件"} 第 ${t.page} 頁 ---\n${t.text}`).join("\n\n");
  content.push({
    type: "text",
    text: core.intro(kind, hint) + `要填嘅欄：${want}\n\n${textPart}`,
  });
  return {
    model: MODEL,
    max_tokens: 4000,
    system: RULES,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(keys) } },
    // 安全分類器拒答時，由伺服器自動轉去 Anthropic 建議嘅後備型號（Cody 2026-11-08 接受）
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

export function costUSD(usage) {
  if (!usage) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return inTok * PRICE.inUSD + (usage.output_tokens || 0) * PRICE.outUSD;
}

export function parseResponse(msg) {
  if (msg.stop_reason === "refusal") return { error: "AI 拒絕處理呢份文件，請人手輸入。" };
  if (msg.stop_reason === "max_tokens") return { error: "文件太長，AI 未讀完。請減少頁數再試。" };
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const j = JSON.parse(text);
    return { fields: j.fields || {}, warnings: j.warnings || [] };
  } catch (e) {
    return { error: "AI 回覆格式唔啱，請再試一次或者人手輸入。" };
  }
}

/* ---------- 每月上限（KV：spend:YYYY-MM = 美元） ---------- */
export function monthKey(d = new Date()) {
  const hk = new Date(d.getTime() + 8 * 3600e3); // 香港時間
  return "spend:" + hk.toISOString().slice(0, 7);
}
export function capUSD(env) {
  return Number(env.MONTHLY_BUDGET_HKD || 100) / PRICE.hkd;
}
export async function spentUSD(kv) {
  return Number((await kv.get(monthKey())) || 0);
}
export async function addSpend(kv, usd) {
  const k = monthKey();
  const now = Number((await kv.get(k)) || 0) + usd;
  await kv.put(k, String(now), { expirationTtl: 400 * 24 * 3600 });
  return now;
}

/* ---------- 產品庫（KV：product:<key> = {company, plan, fields, savedAt}） ---------- */
export async function getProduct(kv, key) {
  const v = await kv.get("product:" + key);
  return v ? JSON.parse(v) : null;
}
export async function putProduct(kv, key, entry) {
  await kv.put("product:" + key, JSON.stringify({ ...entry, savedAt: new Date().toISOString() }));
}
export async function listProducts(kv) {
  const out = [];
  let cursor;
  do {
    const r = await kv.list({ prefix: "product:", cursor });
    for (const k of r.keys) out.push(k.name.slice(8));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// makeClient 可以喺測試換做假嘅
export async function callClaude(env, req, makeClient = (k) => new Anthropic({ apiKey: k })) {
  const client = makeClient(env.ANTHROPIC_API_KEY);
  try {
    const msg = await client.beta.messages.create(req);
    return { msg };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "AI 鑰匙（ANTHROPIC_API_KEY）唔啱，請 Cody 檢查 Cloudflare 設定。", status: 500 };
    if (e instanceof Anthropic.RateLimitError) return { error: "AI 太多人用緊，請等一分鐘再試。", status: 429 };
    if (e instanceof Anthropic.BadRequestError) return { error: "AI 唔接受呢個請求（" + e.message.slice(0, 120) + "）。", status: 400 };
    if (e instanceof Anthropic.APIError) return { error: "AI 服務暫時有問題（" + e.status + "），請稍後再試。", status: 502 };
    return { error: "連唔到 AI 服務，請稍後再試。", status: 502 };
  }
}
