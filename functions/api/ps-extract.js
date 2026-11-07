// POST /api/ps-extract  保單整理器：將（已經喺同事部機遮咗個人資料嘅）保單重點頁交俾 Claude 抽資料。
// body: {kind: "policy"|"brochure", texts:[{name,page,text}], images:[{media_type,data,w,h}], hint, company, plan}
// 密碼由 functions/_middleware.js 擋；每月上限同產品庫用 KV（binding 名 POLICY_KV）。
import core from "../../assets/js/ps-core.js";
import { buildRequest, callClaude, parseResponse, costUSD, capUSD, spentUSD, addSpend, putProduct, json } from "../../server/ps-ai.js";

const MAX_IMAGES = 8, MAX_TEXT = 60000, MAX_BODY = 12 * 1024 * 1024;

export async function onRequestPost(ctx) {
  return handleExtract(ctx);
}

export async function handleExtract({ request, env }, makeClient) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "未設定 AI（ANTHROPIC_API_KEY），暫時只可以人手輸入。" }, 503);
  if (!env.POLICY_KV) return json({ error: "未設定 POLICY_KV（每月上限同產品庫），暫時只可以人手輸入。" }, 503);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "文件太大，請減少頁數或者影細啲。" }, 413);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "資料格式唔啱" }, 400); }
  const kind = body.kind === "brochure" ? "brochure" : "policy";
  const texts = Array.isArray(body.texts) ? body.texts.slice(0, 20) : [];
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((i) => i && /^image\/(jpeg|png|webp)$/.test(i.media_type) && typeof i.data === "string")
    .slice(0, MAX_IMAGES);
  if (!texts.length && !images.length) return json({ error: "冇揀任何頁" }, 400);
  if (texts.reduce((a, t) => a + String(t.text || "").length, 0) > MAX_TEXT) return json({ error: "文字太多，請少揀幾頁。" }, 413);

  const cap = capUSD(env), spent = await spentUSD(env.POLICY_KV);
  if (spent >= cap) {
    return json({ error: `今個月 AI 預算（HK$${Math.round(cap * core.PRICE.hkd)}）已經用晒，下個月 1 號重新開始；而家可以人手輸入。`, budget: true }, 402);
  }

  const req = buildRequest({ kind, texts, images, hint: body.hint });
  const r = await callClaude(env, req, makeClient);
  if (r.error) return json({ error: r.error }, r.status);
  const usd = costUSD(r.msg.usage);
  const total = await addSpend(env.POLICY_KV, usd);
  const out = parseResponse(r.msg);
  const meta = { costHKD: +(usd * core.PRICE.hkd).toFixed(2), monthHKD: +(total * core.PRICE.hkd).toFixed(2), capHKD: Math.round(cap * core.PRICE.hkd) };
  if (out.error) return json({ error: out.error, ...meta }, 422);

  let saved = false;
  if (kind === "brochure" && out.fields.plan) {
    const key = core.productKey(out.fields.company || body.company, out.fields.plan || body.plan);
    const fields = {};
    for (const k of core.PRODUCT_KEYS) if (out.fields[k]) fields[k] = out.fields[k];
    if (Object.keys(fields).length) {
      await putProduct(env.POLICY_KV, key, { company: out.fields.company || body.company || "", plan: out.fields.plan, fields, source: "小冊子（AI）" });
      saved = true;
    }
  }
  return json({ fields: out.fields, warnings: out.warnings, savedToLibrary: saved, ...meta });
}
