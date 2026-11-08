// node tests/ps.test.mjs — 保單整理器：遮資料、揀頁、合併、伺服器（假 AI、假 KV）
import core from "../assets/js/ps-core.js";
import { buildRequest, costUSD, parseResponse, monthKey } from "../server/ps-ai.js";
import { handleExtract } from "../functions/api/ps-extract.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fail++; };

// ---------- 遮資料 ----------
const doc = `保單持有人 : CHOI CHIN LONG
受保人：Choi Chin Long
身份證號碼 A123456(7)
電話：9123 4567  電郵 abc.def@gmail.com
通訊地址：九龍旺角彌敦道 123 號
10 樓 A 室
保單編號 U123456789
基本保額 HK$20000000  每年保費 HK$3,900.00
蔡展朗先生`;
const m = core.maskText(doc, ["Choi Chin Long", "蔡展朗"]);
ok(!/CHOI|Choi|蔡展朗/i.test(m.text), "客人英文名、中文名遮咗");
ok(!/A123456/.test(m.text), "身份證遮咗");
ok(!/9123/.test(m.text) && !/gmail/.test(m.text), "電話、電郵遮咗");
ok(!/彌敦道|10 樓/.test(m.text), "地址（連下一行）遮咗");
ok(/U123456789/.test(m.text), "保單編號保留（Cody：保單編號要交 AI）");
ok(/20000000/.test(m.text) && /3,900\.00/.test(m.text), "保額、保費冇被當電話遮");

// ---------- 揀頁 ----------
const pages = [
  { n: 1, text: "封面 保險合約" },
  { n: 2, text: "釋義 本合約內 「意外」指… 定義 Definitions ".repeat(5) },
  { n: 3, text: "保單附表 Policy Schedule 保單編號 U1 生效日期 2026/9/1 基本保額 HK$500,000 每年保費 HK$10,698 繳費年期 10年" },
  { n: 4, text: "一般條款 General Provisions 不保事項 Exclusions ".repeat(5) },
  { n: 5, text: "個人資料收集聲明 Privacy Personal Data ".repeat(5) },
  { n: 6, text: "附加契約 Rider 保額 HK$100,000 保費 HK$1,059 保障至 80歲" },
];
const pick = core.pickPages(pages, "policy");
ok(pick.includes(3) && pick.includes(6) && !pick.includes(2) && !pick.includes(4) && !pick.includes(5), "揀到保單附表同附加契約頁，跳過條款、定義、私隱頁（揀咗 " + pick.join(",") + "）");

// ---------- 點解揀呢頁 ----------
const e3 = core.explainPage(pages[2].text);
ok(e3.hits.includes("保單編號") && e3.hits.includes("保費") && e3.hits.includes("保額") && e3.money === 2 && !e3.misses.length, "附表頁列出命中字眼同金額數目（" + e3.hits.join("、") + "）");
ok(e3.score === core.scorePage(pages[2].text), "explainPage 同 scorePage 分數一樣");
const e4 = core.explainPage(pages[3].text);
ok(e4.misses.includes("條款／不保事項") && !e4.hits.length, "條款頁標為冇用");
ok(core.whyText(e3, true) === "有：保單編號、生效日期、保額、保費、繳費期、保障表（2 個金額）", "揀咗嘅頁寫有咩：" + core.whyText(e3, true));
ok(core.whyText(e4, false) === "條款／不保事項頁，冇自動揀", "條款頁寫冇自動揀：" + core.whyText(e4, false));
ok(core.whyText(null, true) === "圖片頁，要自己判斷", "圖片頁");
ok(core.whyText(core.explainPage("  "), false).startsWith("幾乎冇字"), "冇字頁");
ok(core.whyText(core.explainPage("保單編號 U1 " + "釋義 Definitions ".repeat(3)), true).includes("但似定義頁"), "有用又似條款嘅頁兩樣都講");
const mk = core.maskText("受 保 人 蔡 展 朗 先 生 保 單 編 號 U123456789", ["蔡展朗"]);
ok(!mk.text.includes("蔡") && mk.text.includes("U123456789"), "PDF 有空格嘅中文名都遮到：" + mk.text);
const spaced = core.explainPage("保 單 編 號 U123456 ⽣ 效 ⽇ 期 2026/9/1 基 本 保 額 HK$500,000 每 年 保 費 HK$10,698");
ok(["保單編號", "生效日期", "保額", "保費"].every((h) => spaced.hits.includes(h)), "PDF 抽出嚟有空格／康熙部首嘅字都對到（" + spaced.hits.join("、") + "）");

// ---------- 合併 ----------
const mg = core.merge({ premium: "HK$1" }, { premium: "HK$2", plan: "A" }, { medical: "實報實銷", plan: "B" });
ok(mg.values.premium === "HK$1" && mg.from.premium === "manual", "同事打嘅優先");
ok(mg.values.plan === "A" && mg.from.plan === "doc", "文件優先過產品庫");
ok(mg.values.medical === "實報實銷" && mg.from.medical === "library", "產品庫只補產品欄");
ok(core.missing(mg.values).length === core.FIELDS.filter((f) => !f.optional).length - 3, "未齊嘅欄數啱（備註可以唔填）");
ok(core.productKey("AIA", "「自願醫保睿選計劃」 AVSW") === core.productKey("aia", "自願醫保睿選計劃AVSW"), "產品庫 key 唔理空格、引號、大細楷");

// ---------- 請求 ----------
const req = buildRequest({ kind: "policy", texts: [{ name: "a.pdf", page: 3, text: "保單附表" }], images: [{ media_type: "image/jpeg", data: "QUJD" }], hint: "愛伴航2" });
ok(req.model === "claude-sonnet-5-5" && req.output_config.effort === "low" && req.output_config.format.type === "json_schema", "用 Sonnet 5.5、low effort、JSON schema");
ok(req.fallbacks === "default" && req.betas.includes("server-side-fallback-2026-07-01"), "開咗拒答後備（fallbacks default）");
const sch = req.output_config.format.schema.properties.fields;
ok(!sch.required.includes("owner") && !sch.required.includes("insured") && sch.required.includes("policyNo"), "持有人／受保人唔交 AI；保單編號要");
ok(req.messages[0].content[0].type === "image" && /愛伴航2/.test(req.messages[0].content[1].text), "圖片放文字前面，有 hint");
ok(Math.abs(costUSD({ input_tokens: 1e6, output_tokens: 1e5 }) - 3) < 1e-9, "費用：1M 輸入 + 100k 輸出 = US$3");
ok(parseResponse({ stop_reason: "refusal", content: [] }).error, "拒答有中文錯誤訊息");
ok(/^spend:\d{4}-\d{2}$/.test(monthKey()), "每月 key 格式");

// ---------- 伺服器（假 KV、假 Claude） ----------
function fakeKV() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
}
const reply = (fields) => ({ stop_reason: "end_turn", usage: { input_tokens: 5000, output_tokens: 1000 }, content: [{ type: "text", text: JSON.stringify({ fields, warnings: ["x"] }) }] });
let sent = null;
const fakeClient = (fields) => () => ({ beta: { messages: { create: async (r) => { sent = r; return reply(fields); } } } });
const post = (body) => new Request("https://x/api/ps-extract", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const kv = fakeKV();
const env = { ANTHROPIC_API_KEY: "test", POLICY_KV: kv, MONTHLY_BUDGET_HKD: "100" };
let r = await handleExtract({ request: post({ kind: "policy", texts: [{ name: "a", page: 1, text: "保單" }] }), env }, fakeClient({ plan: "睿選", premium: "HK$3,900" }));
let j = await r.json();
ok(r.status === 200 && j.fields.premium === "HK$3,900" && j.costHKD > 0, "成功讀取，回傳欄位同費用（HK$" + j.costHKD + "）");
ok(Math.abs(Number(kv.m.get(monthKey())) - (5000 * 2e-6 + 1000 * 10e-6)) < 1e-9, "每月用量記入 KV");

r = await handleExtract({ request: post({ kind: "brochure", texts: [{ name: "b", page: 1, text: "小冊子" }] }), env }, fakeClient({ company: "AIA", plan: "睿選", medical: "實報實銷", coverage: "自願醫保-醫療" }));
j = await r.json();
ok(j.savedToLibrary && kv.m.has("product:" + core.productKey("AIA", "睿選")), "小冊子讀完自動入產品庫");

kv.m.set(monthKey(), String(100 / 7.8 + 0.01));
sent = null;
r = await handleExtract({ request: post({ kind: "policy", texts: [{ name: "a", page: 1, text: "保單" }] }), env }, fakeClient({}));
ok(r.status === 402 && sent === null, "用晒 HK$100 → 唔再叫 AI");

r = await handleExtract({ request: post({ kind: "policy", texts: [] }), env: { POLICY_KV: kv } }, fakeClient({}));
ok(r.status === 503, "未設定 API key → 503 叫同事人手輸入");


// ---------- 複製去我嘅 AI ----------
const pp = core.buildPastePrompt("policy", "愛伴航2", [{ name: "a.pdf", page: 3, text: "保單附表 [客人姓名]" }], 2);
ok(pp.includes(core.RULES) && pp.includes("policyNo：保單編號") && pp.includes("要填嘅計劃：愛伴航2") && pp.includes("2 張已經遮咗") && pp.includes("保單附表 [客人姓名]"), "複製指令有規則、欄位、hint、相片提示、遮好嘅文字");
ok(!pp.includes("owner") && !pp.includes("insured"), "複製指令唔包持有人／受保人");
const r1 = core.parseAIReply('好的，以下係結果：\n```json\n{"fields":{"policyNo":"U1","plan":"愛伴航2","premium":"HK$10,698"},"warnings":["有 1 個附加契約"]}\n```');
ok(!r1.error && r1.fields.plan === "愛伴航2" && r1.warnings.length === 1, "讀到 ```json 包住、前面有字嘅回覆");
ok(!core.parseAIReply('{"policyNo":"U1","premium":"HK$1"}').error, "讀到平鋪（冇 fields）嘅回覆");
ok(core.parseAIReply('{"policyNo":"U1"').error && core.parseAIReply("唔知").error, "唔完整／冇代碼會出中文提示");
ok(!("owner" in core.parseAIReply('{"fields":{"owner":"X","plan":"A"}}').fields), "回覆入面嘅持有人唔會覆蓋同事填嘅");
process.exit(fail ? 1 : 0);
