// GET /api/ps-budget → AI 設定好未、今個月用咗幾多（港元）同上限
import core from "../../assets/js/ps-core.js";
import { capUSD, spentUSD, json } from "../../server/ps-ai.js";

export async function onRequestGet({ env }) {
  const ready = !!(env.ANTHROPIC_API_KEY && env.POLICY_KV);
  const spent = env.POLICY_KV ? await spentUSD(env.POLICY_KV) : 0;
  return json({ ready, monthHKD: +(spent * core.PRICE.hkd).toFixed(2), capHKD: Math.round(capUSD(env) * core.PRICE.hkd) });
}
