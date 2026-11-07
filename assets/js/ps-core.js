/* 保單整理器 – 唔使畫面嘅部分（瀏覽器同 Node 測試共用）：
   - FIELDS：跟 Cody 嘅 Policy Summary 範本（2026-11 Choi Chin Long insurance summary），23 行
   - 遮個人資料（姓名、身份證、電話、電郵、地址）
   - 揀有用嘅頁（關鍵字評分）、估計 AI 費用
   - 合併 AI 結果、產品庫、人手輸入；搵未齊嘅格 */
(function (root) {
  "use strict";

  // key, Excel 左邊標題, 網頁顯示, 範圍：policy = 每份保單唔同；product = 同一個產品一樣（可以入產品庫）；manual = 只可人手（唔交 AI）
  var FIELDS = [
    { key: "company", label: "Insurance Company  保險公司", short: "保險公司", scope: "policy", hint: "例：AIA" },
    { key: "policyNo", label: "Policy Number  保單編號", short: "保單編號", scope: "policy" },
    { key: "effectiveDate", label: "Policy-Year-Date  保單生效日期", short: "保單生效日期", scope: "policy", hint: "例：2026/9/1" },
    { key: "owner", label: "Owner  持有人", short: "持有人", scope: "manual" },
    { key: "insured", label: "Insured  受保人", short: "受保人", scope: "manual" },
    { key: "plan", label: "Plan  計劃名稱", short: "計劃名稱", scope: "policy", hint: "例：自願醫保睿選計劃 AVSW" },
    { key: "coverage", label: "Coverage 保障", short: "保障類型", scope: "product", hint: "例：自願醫保-醫療／儲蓄型-危疾" },
    { key: "payTerm", label: "Premium Payment Period 繳付年期", short: "繳付年期", scope: "policy", hint: "例：終身／10年" },
    { key: "coverTo", label: "Protection up to 保障至", short: "保障至", scope: "policy", hint: "例：終身／65歲" },
    { key: "payMode", label: "Payment Mode 繳費形式", short: "繳費形式", scope: "policy", hint: "例：年／月" },
    { key: "currency", label: "Currency 貨幣", short: "貨幣", scope: "policy", hint: "USD／HKD" },
    { key: "life", label: "Face Amount - Life Insurance  人壽保額", short: "人壽保額", scope: "policy" },
    { key: "adb", label: "Accidental Death Benefit  意外身故保障", short: "意外身故保障", scope: "policy" },
    { key: "accMedical", label: "Accidental Medical Benefit  意外醫療保障", short: "意外醫療保障", scope: "product", long: true },
    { key: "accHospCash", label: "Daily Accidential Hospital Cash 每日意外住院現金", short: "每日意外住院現金", scope: "policy" },
    { key: "ci", label: "Critical Illnesses 嚴重疾病保障", short: "嚴重疾病保障", scope: "policy" },
    { key: "compassionate", label: "Compassionate Death Benefit 身故體恤津貼", short: "身故體恤津貼", scope: "product" },
    { key: "medical", label: "Medical Protection 醫療保障", short: "醫療保障", scope: "product", long: true },
    { key: "tpd", label: "Total & Permanent Disability Benefit  永久傷殘保障", short: "永久傷殘保障", scope: "product", long: true },
    { key: "hospCash", label: "Daily Hospital Cash 每日住院現金", short: "每日住院現金", scope: "product" },
    { key: "accountValue", label: "Account Value 戶口價值", short: "戶口價值", scope: "policy" },
    { key: "premium", label: "Premium Total(Annual) 合計(每年)", short: "每年保費", scope: "policy", hint: "例：HK$3,900.00" },
    { key: "remark", label: "備註欄", short: "備註", scope: "policy", optional: true }
  ];
  var AI_KEYS = FIELDS.filter(function (f) { return f.scope !== "manual"; }).map(function (f) { return f.key; });
  var PRODUCT_KEYS = FIELDS.filter(function (f) { return f.scope === "product"; }).map(function (f) { return f.key; });

  // Sonnet 5.5（2026-11）：輸入 US$2、輸出 US$10／每百萬 token
  var PRICE = { inUSD: 2 / 1e6, outUSD: 10 / 1e6, hkd: 7.8 };

  /* ---------- 遮個人資料 ---------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function maskText(text, names) {
    var t = String(text || ""), n = 0;
    function rep(re, tag) { t = t.replace(re, function () { n++; return tag; }); }
    (names || []).filter(function (x) { return x && x.trim().length >= 2; }).forEach(function (name) {
      var parts = name.trim().split(/\s+/);
      rep(new RegExp(escRe(name.trim()).replace(/\\?\s+/g, "[\\s,]*"), "gi"), "[客人姓名]");
      if (parts.length > 1) parts.forEach(function (p) { if (p.length >= 3) rep(new RegExp("\\b" + escRe(p) + "\\b", "gi"), "[姓名]"); });
    });
    // 香港身份證 A123456(7)／A1234567；後面再有數字就唔係（例如保單編號 U123456789 要保留）
    rep(/(?<![A-Za-z0-9])[A-Z]{1,2}\s?\d{6}\s?(?:[(（]\s?[0-9A]\s?[)）]|[0-9A](?![0-9A-Za-z]))/g, "[身份證]");
    rep(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[電郵]");
    // 香港 8 位電話：前面有「電話／Tel」等字，或者中間有空格／橫線（9123 4567）先當電話，免得遮咗保額（例如 20000000）
    rep(/(?:電話|手提|手機|聯絡|Tel|Phone|Mobile|Contact)[^\n\d]{0,12}(?:\+?852[\s-]?)?\d{4}[\s-]?\d{4}/gi, "[電話]");
    rep(/(?:\+?852[\s-]?)?(?<![\d,.])[2-9]\d{3}[\s-]\d{4}(?![\d,.])/g, "[電話]");
    rep(/(?:地址|通訊地址|住址|Address)\s*[:：]?[^\n]*(?:\n(?=[^\n]*(?:室|樓|座|街|道|路|村|苑|邨|Flat|Floor|Block|Road|Street|Kowloon|Hong Kong|New Territories))[^\n]*){0,3}/gi, "[地址]");
    rep(/(?:姓名|Name of (?:Policy ?Owner|Life Insured|Insured)|Policy ?Owner|Life Insured|持有人|受保人)\s*[:：]\s*[^\n]{2,40}/gi, "[姓名欄]");
    return { text: t, count: n };
  }

  /* ---------- 揀有用嘅頁 ---------- */
  var GOOD = [/保單編號|Policy (?:No|Number)/i, /生效日期|Effective Date|Date of Issue|簽發日期/i, /保額|Sum (?:Assured|Insured)|Face Amount|Notional Amount|名義金額/i,
    /保費|Premium/i, /保障至|保障期|Coverage Term|Benefit Term|期滿/i, /繳費|供款期|Payment Term|Premium Term|Payment Mode|繳付/i,
    /計劃名稱|基本計劃|附加契約|Basic Plan|Supplementary|Rider/i, /保單附表|Policy Schedule|Schedule of Benefits|保障表|保障摘要|Benefit Summary/i,
    /週年|Anniversary|保單價值|Cash Value|退保價值|Account Value|戶口價值/i, /自付費|Deductible|病房|Ward|限額|Limit/i];
  var BAD = [/釋義|定義|Definitions|Interpretation/i, /一般條款|General (?:Provisions|Conditions)|不保事項|Exclusions/i, /個人資料|私隱|Privacy|Personal Data/i,
    /投訴|Complaint|冷靜期|Cooling[- ]off/i, /索償程序|Claims? Procedure/i];
  function scorePage(text) {
    var t = String(text || ""), s = 0;
    GOOD.forEach(function (re) { if (re.test(t)) s += 2; });
    BAD.forEach(function (re) { if (re.test(t)) s -= 2; });
    var money = (t.match(/(?:HK\$|US\$|港元|美元|HKD|USD)\s?[\d,]{3,}/g) || []).length;
    s += Math.min(money, 6) * 0.5;
    if (t.replace(/\s/g, "").length < 40) s -= 5;                       // 冇字（掃描頁）或者空白頁
    return s;
  }
  /* pages: [{n, text}] → 揀分數最高嘅幾頁（保持原本次序）；kind = policy／brochure */
  function pickPages(pages, kind) {
    var max = kind === "brochure" ? 8 : 4, minScore = kind === "brochure" ? 2 : 3;
    var scored = pages.map(function (p) { return { n: p.n, score: scorePage(p.text) }; });
    var top = scored.filter(function (p) { return p.score >= minScore; }).sort(function (a, b) { return b.score - a.score; }).slice(0, max);
    if (!top.length) top = scored.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, Math.min(2, scored.length));
    return top.map(function (p) { return p.n; }).sort(function (a, b) { return a - b; });
  }

  /* ---------- 估計費用 ---------- */
  function estTextTokens(chars) { return Math.ceil(chars * 0.9); }        // 中文約 1 字 1 token，英文較少，保守估
  function estImageTokens(w, h) { return Math.ceil(w * h / 750); }
  function estimateHKD(textChars, images) {
    var inTok = 2500 + estTextTokens(textChars) + (images || []).reduce(function (a, im) { return a + estImageTokens(im.w, im.h); }, 0);
    var outTok = 1800;                                                    // JSON 結果＋少量思考
    return { inTok: inTok, outTok: outTok, hkd: (inTok * PRICE.inUSD + outTok * PRICE.outUSD) * PRICE.hkd };
  }

  /* ---------- 合併 ---------- */
  function blank(v) { return v === null || v === undefined || String(v).trim() === ""; }
  /* 次序：同事打嘅 > 客人文件（AI）> 產品庫。回傳 {values, from:{key:'manual'|'doc'|'library'}} */
  function merge(manual, ai, library) {
    var values = {}, from = {};
    FIELDS.forEach(function (f) {
      var k = f.key;
      if (!blank(manual && manual[k])) { values[k] = manual[k]; from[k] = "manual"; }
      else if (!blank(ai && ai[k])) { values[k] = ai[k]; from[k] = "doc"; }
      else if (f.scope === "product" && library && !blank(library[k])) { values[k] = library[k]; from[k] = "library"; }
      else values[k] = "";
    });
    return { values: values, from: from };
  }
  function missing(values) {
    return FIELDS.filter(function (f) { return !f.optional && blank(values[f.key]); }).map(function (f) { return f.key; });
  }
  function productKey(company, plan) {
    return (String(company || "") + "|" + String(plan || "")).toLowerCase().replace(/[\s「」『』"'()（）\-–—_.,，。]/g, "");
  }

  /* ---------- AI 指令（API 同「複製去我嘅 AI」共用，保證兩邊結果一樣） ---------- */
  var RULES = "你係香港保險顧問嘅助手，負責由保單文件抽資料，填一份 Policy Summary（保單整理表）。\n規則：\n"
    + "- 只可以用文件入面寫明嘅資料，唔好估、唔好用常識補。文件冇講嘅格填空字串 \"\"。\n"
    + "- 如果文件清楚顯示呢份保單／計劃冇呢項保障，填 \"N\"。\n"
    + "- 用繁體中文。金額要寫貨幣，例如 \"HK$500,000\"、\"US$2,250\"；日期用 \"2026/9/1\" 格式。\n"
    + "- 長保障（醫療保障、意外醫療保障、永久傷殘保障）只寫一句重點，最多 40 個字，例如「實報實銷，終身限額 6,000 萬港元」。\n"
    + "- 文件入面 [客人姓名]、[身份證]、[電話]、[地址] 等係已經遮咗嘅個人資料，唔使理。\n"
    + "- 一份文件可能有基本計劃同附加契約；只填 hint 指明嗰個計劃，冇 hint 就填基本計劃，喺 warnings 講有幾多個附加契約。\n"
    + "- warnings：列出有疑問、互相矛盾、或者睇唔清楚嘅地方（最多 5 條，每條一句）。";
  function keysFor(kind) { return kind === "brochure" ? ["company", "plan"].concat(PRODUCT_KEYS) : AI_KEYS; }
  function shortOf(k) { return FIELDS.filter(function (f) { return f.key === k; })[0].short; }
  function intro(kind, hint) {
    return (kind === "brochure"
      ? "以下係一份保險產品小冊子／條款嘅重點頁。抽出同一個產品所有客人都一樣嘅保障描述（唔好填個別客人嘅金額）。\n"
      : "以下係客人一份保單（合約、保單附表或者週年報表）嘅重點頁。\n") + (hint ? "要填嘅計劃：" + hint + "\n" : "");
  }
  /* 「複製去我嘅 AI」：一段可以直接貼去 Claude／ChatGPT／Gemini 等嘅文字 */
  function buildPastePrompt(kind, hint, texts, imageCount) {
    var keys = keysFor(kind), example = {};
    keys.forEach(function (k) { example[k] = ""; });
    return RULES + "\n\n" + intro(kind, hint)
      + (imageCount ? "（另外我會上載 " + imageCount + " 張已經遮咗個人資料嘅相，一齊睇。）\n" : "")
      + "\n要填嘅欄（左邊英文 key 唔好改）：\n" + keys.map(function (k) { return "- " + k + "：" + shortOf(k); }).join("\n")
      + "\n\n只回覆一段 JSON，唔好其他字，格式：\n" + JSON.stringify({ fields: example, warnings: [] })
      + "\n\n" + (texts || []).map(function (t) { return "--- " + (t.name || "文件") + " 第 " + t.page + " 頁 ---\n" + t.text; }).join("\n\n");
  }
  /* 讀同事貼返嚟嘅 AI 回覆：容許 ```json 包住、前後有字、平鋪（冇 fields） */
  function parseAIReply(text) {
    var t = String(text || ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) return { error: "搵唔到 AI 回覆入面嘅 { … } 代碼，請複製 AI 成段回覆再貼。" };
    var j;
    try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { error: "代碼唔完整（可能冇複製晒），請由 AI 回覆嘅「{」複製到最尾「}」。" }; }
    var f = j.fields && typeof j.fields === "object" ? j.fields : j, out = {}, n = 0;
    AI_KEYS.forEach(function (k) { if (typeof f[k] === "string" || typeof f[k] === "number") { out[k] = String(f[k]); n++; } });
    if (!n) return { error: "代碼入面冇任何認得嘅欄（例如 policyNo、plan），請確認係用網站複製嘅指令問 AI。" };
    return { fields: out, warnings: Array.isArray(j.warnings) ? j.warnings.map(String).slice(0, 5) : [] };
  }

  var api = { FIELDS: FIELDS, RULES: RULES, keysFor: keysFor, intro: intro, buildPastePrompt: buildPastePrompt, parseAIReply: parseAIReply, AI_KEYS: AI_KEYS, PRODUCT_KEYS: PRODUCT_KEYS, PRICE: PRICE, maskText: maskText, scorePage: scorePage,
    pickPages: pickPages, estimateHKD: estimateHKD, estImageTokens: estImageTokens, merge: merge, missing: missing, blank: blank, productKey: productKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PSCore = api;
})(this);
