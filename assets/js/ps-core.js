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
  // 唔入 Excel、只係俾 AI 填嘅輔助欄：月繳／季繳保單文件通常只寫每期保費，由程式換算做年繳
  var EXTRA = [{ key: "premiumModal", short: "每期保費（文件寫嘅金額連貨幣，例如月繳嗰期；文件已寫年繳就同 premium 一樣）" }];
  var AI_KEYS = FIELDS.filter(function (f) { return f.scope !== "manual"; }).map(function (f) { return f.key; }).concat(EXTRA.map(function (e) { return e.key; }));
  var PRODUCT_KEYS = FIELDS.filter(function (f) { return f.scope === "product"; }).map(function (f) { return f.key; });

  // Sonnet 5.5（2026-11）：輸入 US$2、輸出 US$10／每百萬 token
  var PRICE = { inUSD: 2 / 1e6, outUSD: 10 / 1e6, hkd: 7.8 };

  /* ---------- 遮個人資料 ---------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function maskText(text, names) {
    var t = normText(text), n = 0;                                     // 先還原「蔡 展 朗」咁嘅空格，否則中文名遮唔到
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
  var GOOD_LABEL = ["保單編號", "生效日期", "保額", "保費", "保障期", "繳費期", "計劃名稱", "保障表", "保單價值", "自付費／病房／限額"];
  var BAD = [/釋義|定義|Definitions|Interpretation/i, /一般條款|General (?:Provisions|Conditions)|不保事項|Exclusions/i, /個人資料|私隱|Privacy|Personal Data/i,
    /投訴|Complaint|冷靜期|Cooling[- ]off/i, /索償程序|Claims? Procedure/i];
  var BAD_LABEL = ["定義", "條款／不保事項", "私隱", "投訴／冷靜期", "索償程序"];
  /* 點解揀呢頁：{score, hits:[有用字眼], misses:[冇用字眼], money:金額數目, empty:冇字} */
  /* PDF 抽出嚟嘅中文成日「保 單 編 號」咁有空格，或者用咗康熙部首（⽣、⽇），先還原先對字 */
  function normText(text) {
    var t = String(text || "");
    if (t.normalize) t = t.normalize("NFKC");
    var cjk = "[\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]";
    return t.replace(new RegExp("(" + cjk + ")[ \\t\\u3000]+(?=" + cjk + ")", "g"), "$1");
  }
  function explainPage(text) {
    var t = normText(text), s = 0, hits = [], misses = [];
    GOOD.forEach(function (re, i) { if (re.test(t)) { s += 2; hits.push(GOOD_LABEL[i]); } });
    BAD.forEach(function (re, i) { if (re.test(t)) { s -= 2; misses.push(BAD_LABEL[i]); } });
    var money = (t.match(/(?:HK\$|US\$|港元|美元|HKD|USD)\s?[\d,]{3,}/g) || []).length;
    s += Math.min(money, 6) * 0.5;
    var empty = t.replace(/\s/g, "").length < 40;
    if (empty) s -= 5;                                                  // 冇字（掃描頁）或者空白頁
    return { score: s, hits: hits, misses: misses, money: money, empty: empty };
  }
  function scorePage(text) { return explainPage(text).score; }
  /* 揀頁畫面每頁下面嘅一行細字 */
  function whyText(info, picked) {
    if (!info) return "圖片頁，要自己判斷";
    if (info.empty) return "幾乎冇字（可能係掃描頁），" + (picked ? "揀咗" : "冇自動揀");
    var parts = [];
    if (info.hits.length) parts.push("有：" + info.hits.join("、") + (info.money ? "（" + info.money + " 個金額）" : ""));
    else if (info.money) parts.push("有 " + info.money + " 個金額");
    if (info.misses.length) parts.push((info.hits.length ? "但似" : "") + info.misses.join("／") + "頁");
    if (!parts.length) parts.push("搵唔到保單資料字眼");
    return parts.join("；") + (picked ? "" : "，冇自動揀");
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
  /* 月繳／季繳／半年繳 → 年繳：annualize("HK$1,234.50", "月") = "HK$14,814.00（月繳 HK$1,234.50 × 12）"；認唔到就回傳 null */
  var MODES = [[/半年|semi/i, "半年", 2], [/季|quarter/i, "季", 4], [/月|month/i, "月", 12], [/年|annual|yearly/i, "年", 1]];
  function annualize(modal, mode) {
    var m = String(modal || "").match(/(HK\$|US\$|MOP\$?|RMB|HKD|USD|港元|美元|澳門幣|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (!m) return null;
    var amt = parseFloat(m[2].replace(/,/g, "")), cur = m[1] || "";
    if (!(amt > 0)) return null;
    var hit = MODES.filter(function (x) { return x[0].test(String(mode || "")); })[0];
    if (!hit) return null;
    var fmt2 = function (v) { return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var pre = /^(港元|美元|澳門幣|HKD|USD|RMB)$/i.test(cur) ? cur + " " : cur;
    if (hit[2] === 1) return pre + fmt2(amt);
    return pre + fmt2(Math.round(amt * hit[2] * 100) / 100) + "（" + hit[1] + "繳 " + pre + fmt2(amt) + " × " + hit[2] + "）";
  }
  /* AI 結果：premium 空、但有每期保費同繳費形式 → 自動計年繳 */
  function annualFields(fields, payModeFallback) {
    var f = {}; Object.keys(fields || {}).forEach(function (k) { f[k] = fields[k]; });
    if (blank(f.premium) && !blank(f.premiumModal)) {
      var a = annualize(f.premiumModal, blank(f.payMode) ? payModeFallback : f.payMode);
      if (a) f.premium = a;
    }
    delete f.premiumModal;
    return f;
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
    + "- premium 係每年保費總額：文件有寫年繳保費先填；如果只寫月繳／季繳／半年繳嘅金額，premium 填 \"\"，將嗰期金額（連貨幣）填 premiumModal，payMode 寫清楚月／季／半年／年，系統會自動換算年繳。唔好自己乘。\n"
    + "- 一份文件可能有基本計劃同附加契約；只填 hint 指明嗰個計劃，冇 hint 就填基本計劃，喺 warnings 講有幾多個附加契約。\n"
    + "- warnings：列出有疑問、互相矛盾、或者睇唔清楚嘅地方（最多 5 條，每條一句）。";
  function keysFor(kind) { return kind === "brochure" ? ["company", "plan"].concat(PRODUCT_KEYS) : AI_KEYS; }
  function shortOf(k) { return FIELDS.concat(EXTRA).filter(function (f) { return f.key === k; })[0].short; }
  function intro(kind, hint) {
    return (kind === "brochure"
      ? "以下係一份保險產品小冊子／條款嘅重點頁。抽出同一個產品所有客人都一樣嘅保障描述（唔好填個別客人嘅金額）。\n"
      : "以下係客人一份保單（合約、保單附表或者週年報表）嘅重點頁。\n") + (hint ? "要填嘅計劃：" + hint + "\n" : "");
  }
  /* 「複製去我嘅 AI」：一段可以直接貼去 Claude／ChatGPT／Gemini 等嘅文字 */
  function buildPastePrompt(kind, hint, texts, imageCount, facts) {
    var keys = keysFor(kind), example = {};
    keys.forEach(function (k) { example[k] = ""; });
    return RULES + "\n\n" + intro(kind, hint) + (facts || "")
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

  /* ---------- 認產品（2026-11-21）：同醫療及危疾比較嘅產品名索引（data/compare/ps-index.json）對 ----------
     次序：自願醫保認可編號 > 產品名完全一樣 > 名包含 > 字面相似；有懷疑就俾同事揀，唔會亂認。全部喺瀏覽器做，唔送客人資料去邊。 */
  function normName(s) {
    s = String(s || "").normalize ? String(s || "").normalize("NFKC") : String(s || "");
    s = s.replace(/([一-鿿」』）)])\s*(?!(?:I{1,3}|IV|V)\s*$)[A-Z][A-Z0-9]{1,5}\s*$/, "$1");   // 名尾嘅計劃代號，例如「… AVSW」（II／III 唔當代號）
    s = s.toLowerCase().replace(/[（(][^）)]{0,10}(?:舊版|網上|手機|銀行)[^）)]{0,10}[）)]\s*$/, "");   // 尾巴（舊版）（網上投保）之類；（加強版）要保留
    s = s.replace(/\b(iii|ii|iv)\b/g, function (m) { return { ii: "2", iii: "3", iv: "4" }[m]; });
    return s.replace(/保險計劃|計劃|insuranceplan|insurance|plan|scheme/g, "").replace(/[\s「」『』"'()（）\-–—_.,，。・·‧•\/：:&＆+＋]/g, "");
  }
  function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) o[s.slice(i, i + 2)] = (o[s.slice(i, i + 2)] || 0) + 1; return o; }
  function dice(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    var A = bigrams(a), B = bigrams(b), n = 0, t = 0, k;
    for (k in A) { t += A[k]; if (B[k]) n += Math.min(A[k], B[k]); }
    for (k in B) t += B[k];
    return 2 * n / t;
  }
  function coScore(item, company) {      // 1 = 公司對；0 = 冇寫公司；-1 = 寫咗另一間
    var c = normName(company); if (!c) return 0;
    return item.co.some(function (a) { var x = normName(a); return x && (c.indexOf(x) >= 0 || x.indexOf(c) >= 0); }) ? 1 : -1;
  }
  function stripCo(x, item) {             // 名前面嘅公司名（AIA自願醫保… → 自願醫保…）
    (item.co || []).forEach(function (a) { var c = normName(a); if (c && c.length < x.length - 1 && x.indexOf(c) === 0) x = x.slice(c.length); });
    return x;
  }
  function nameScore(item, plan) {
    var q = stripCo(normName(plan), item), best = 0;
    if (q.length < 2) return 0;
    item.names.forEach(function (n) {
      var raw = normName(n), x = stripCo(raw, item), s = 0;
      if (!x) return;
      if (raw === normName(plan)) s = 100;
      else if (x === q) s = 92;                 // 要拎走公司名先一樣：唔算完全一樣（例如「危疾保」唔可以自動認做「保泰危疾保」）
      else if (x.length >= 4 && q.length >= 4 && (q.indexOf(x) >= 0 || x.indexOf(q) >= 0)) s = 70 + 25 * Math.min(x.length, q.length) / Math.max(x.length, q.length);
      else s = 75 * dice(x, q);
      if (s > best) best = s;
    });
    return best;
  }
  var CODE_RE = /\b([FS]\d{5})(?:-(\d{2})-(\d{3})-(\d{2}))?\b/g;
  function codesIn(text) {
    var out = [], m; CODE_RE.lastIndex = 0;
    while ((m = CODE_RE.exec(String(text || "")))) out.push(m[0].toUpperCase());
    return out;
  }
  /* q = {company, plan, text}；回覆 {pick: item|null, how, candidates: [item…]（最多 4 個，俾同事揀）} */
  function matchProduct(index, q) {
    var items = (index && index.items) || [], none = { pick: null, how: "", candidates: [] };
    if (!items.length) return none;
    // 1. 認可編號：完整選項編號（F00022-01-000-03）一定準；淨係 F00022 就可能要揀選項
    var codes = codesIn((q.plan || "") + " " + (q.text || ""));
    if (codes.length && !q.list && !q.exclude) {
      var full = items.filter(function (it) { return it.codes.some(function (c) { return codes.indexOf(c) >= 0 && c.length > 6; }); });
      if (full.length === 1) return { pick: full[0], how: "認可編號 " + full[0].codes.filter(function (c) { return codes.indexOf(c) >= 0 && c.length > 6; })[0], candidates: [] };
      var grp = items.filter(function (it) { return codes.some(function (c) { return it.group === c.slice(0, 6) || it.codes.indexOf(c.slice(0, 6)) >= 0; }); });
      if (grp.length === 1) return { pick: grp[0], how: "認可編號 " + grp[0].group, candidates: [] };
      if (grp.length > 1) {   // 同一個自願醫保有幾個選項：再用名收窄
        var named = grp.map(function (it) { return { it: it, s: nameScore(it, q.plan) }; }).sort(function (a, b) { return b.s - a.s; });
        if (named[0].s >= 95 && (named.length < 2 || named[0].s - named[1].s >= 8)) return { pick: named[0].it, how: "認可編號＋選項名", candidates: [] };
        return { pick: null, how: "認可編號 " + grp[0].group + "（有幾個選項）", candidates: named.slice(0, 6).map(function (x) { return x.it; }) };
      }
    }
    // 2. 產品名（加公司核對）
    if (normName(q.plan).length < 2) return none;
    var scored = items.map(function (it) {
      var s = nameScore(it, q.plan), c = coScore(it, q.company);
      return { it: it, ex: s >= 100 && c >= 0, s: c < 0 ? s * 0.5 : s + (c > 0 ? 5 : 0) };
    }).filter(function (x) { return x.s >= 50; }).sort(function (a, b) { return b.s - a.s; });
    if (q.exclude) scored = scored.filter(function (x) { return x.it.id !== q.exclude; });   // 同事撳咗「唔係呢個」：淨係列其他
    if (q.list) return { pick: null, how: "其他可能", candidates: scored.slice(0, 5).map(function (x) { return x.it; }) };
    if (!scored.length) return none;
    var top = scored[0], second = scored[1];
    // 同一個自願醫保嘅唔同選項（同 group）唔算互相競爭，但要揀選項
    var rivals = scored.filter(function (x) { return x.it.group !== top.it.group && x.s >= top.s - 12; });
    var sameGroup = scored.filter(function (x) { return x.it.group === top.it.group && x.s >= top.s - 12; });
    var exact = scored.filter(function (x) { return x.ex; });
    if (exact.length === 1 || top.s >= 95 && !rivals.length && sameGroup.length === 1) return { pick: top.it, how: "產品名", candidates: [] };
    if (exact.length > 1 && exact.every(function (x) { return x.it.group === top.it.group; })) {   // 自願醫保淨係寫計劃名：揀選項
      return { pick: null, how: "要揀選項", candidates: scored.filter(function (x) { return x.it.group === top.it.group; }).slice(0, 8).map(function (x) { return x.it; }) };
    }
    var cand = [], seen = {};
    scored.forEach(function (x) { if (!seen[x.it.id] && cand.length < (sameGroup.length > 1 && !rivals.length ? 6 : 4)) { seen[x.it.id] = 1; cand.push(x.it); } });
    return { pick: null, how: second ? "名似，要揀" : "名似一半，要確認", candidates: cand };
  }
  /* AI 讀之前：喺（已遮資料嘅）保單文字入面搵產品，攞嚟做 AI 參考 */
  function findInText(index, text) {
    var items = (index && index.items) || [], t = normName(text);
    var r = matchProduct(index, { text: text });
    if (r.pick) return r.pick;
    var best = null, bl = 0;
    items.forEach(function (it) {
      it.names.forEach(function (n) { var x = normName(n); if (x.length >= 5 && x.length > bl && t.indexOf(x) >= 0) { best = it; bl = x.length; } });
    });
    return best;
  }
  /* 交俾 AI 嘅參考（API 同「複製去我嘅 AI」共用） */
  function factsNote(item) {
    if (!item) return "";
    return "\n參考（由產品比較資料自動認出，只係幫你對照產品名同保障類型；填欄仍然要以文件為準，文件冇寫就留空）：" + String(item.facts || "").slice(0, 400) + "\n";
  }

  var api = { normName: normName, matchProduct: matchProduct, findInText: findInText, codesIn: codesIn, factsNote: factsNote, FIELDS: FIELDS, EXTRA: EXTRA, annualize: annualize, annualFields: annualFields, shortOf: shortOf, RULES: RULES, keysFor: keysFor, intro: intro, buildPastePrompt: buildPastePrompt, parseAIReply: parseAIReply, AI_KEYS: AI_KEYS, PRODUCT_KEYS: PRODUCT_KEYS, PRICE: PRICE, maskText: maskText, scorePage: scorePage, explainPage: explainPage, whyText: whyText,
    pickPages: pickPages, estimateHKD: estimateHKD, estImageTokens: estImageTokens, merge: merge, missing: missing, blank: blank, productKey: productKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PSCore = api;
})(this);
