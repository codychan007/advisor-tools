// 成個網站加共用密碼（Cloudflare Pages Functions，每個請求都經過呢度）。
// 密碼唔寫喺 GitHub：喺 Cloudflare → 呢個 Pages 項目 → Settings → Variables and Secrets
// 加一個 Secret，名 SITE_PASSWORD。冇設定就全部擋住（唔會唔小心公開）。
// 瀏覽器會彈「登入」視窗：用戶名稱隨便打（例如 aia），密碼打 SITE_PASSWORD。

const REALM = "advisor-tools";

function deny(msg) {
  return new Response(msg, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function sameText(a, b) {
  // 長度同內容一齊比，避免逐個字提早停
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function onRequest(context) {
  const pw = context.env.SITE_PASSWORD;
  if (!pw) return new Response("網站未設定密碼（SITE_PASSWORD），暫時唔開放。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

  const auth = context.request.headers.get("Authorization") || "";
  if (auth.startsWith("Basic ")) {
    let decoded = "";
    try {
      const bin = atob(auth.slice(6).trim());
      decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch (e) { decoded = ""; }
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (decoded.includes(":") && sameText(given, pw)) {
      const res = await context.next();
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "private, no-cache");
      return out;
    }
  }
  return deny("要密碼先入到。用戶名稱隨便打，密碼問 Cody。");
}
