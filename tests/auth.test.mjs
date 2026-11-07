// node tests/auth.test.mjs — 測試 functions/_middleware.js 嘅密碼邏輯
import { onRequest } from "../functions/_middleware.js";
let fail = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fail++; };
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const ctx = (pw, auth) => ({ env: pw === undefined ? {} : { SITE_PASSWORD: pw },
  request: new Request("https://x/medical-reserve/", { headers: auth ? { Authorization: auth } : {} }),
  next: async () => new Response("PAGE", { status: 200 }) });
let r = await onRequest(ctx(undefined, "Basic " + b64("a:x"))); ok(r.status === 503, "冇設密碼 → 全部擋");
r = await onRequest(ctx("醫療2026")); ok(r.status === 401 && r.headers.get("WWW-Authenticate").startsWith("Basic"), "冇打密碼 → 彈登入");
r = await onRequest(ctx("醫療2026", "Basic " + b64("aia:錯"))); ok(r.status === 401, "密碼錯 → 擋");
r = await onRequest(ctx("醫療2026", "Basic " + b64("aia:醫療2026"))); ok(r.status === 200 && (await r.text()) === "PAGE", "密碼啱（中文都得）→ 入到");
r = await onRequest(ctx("abc:123", "Basic " + b64("任何人:abc:123"))); ok(r.status === 200, "密碼有冒號都得");
r = await onRequest(ctx("abc", "Basic ###")); ok(r.status === 401, "亂碼 → 擋");
process.exit(fail ? 1 : 0);
