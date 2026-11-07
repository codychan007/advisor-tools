# 每半年雲端任務：更新 AIA 醫保保費表

雲端任務（每年 2 月 1 日、8 月 1 日 11:00 HKT）照呢份做。全程用廣東話寫報告。

## Cody 授權（2026-11-08）
- 可以**直接 push 去 main**，唔使開分支等 Cody 審批。
- AIA 有新醫保推出、有公開保費表，可以**直接加入**網站（新增選項）。
- 新讀出嚟嘅數字由任務自己抽查同自動測試，唔使 Cody 核對。
- 例外：任何測試唔過又修唔好 → **唔好 push main**，改為 push 分支 `premium-update-YYYY-MM`，報告寫清楚卡喺邊。

## 範圍
- 只用 AIA 官網 `www.aia.com.hk`。每次開工先睇 `https://www.aia.com.hk/robots.txt`，確認 `/zh-hk/products/` 同 `/content/dam/` 冇被禁止；被禁就停，只報告。
- 醫保 = 實報實銷住院醫療保險（自願醫保標準／靈活、高端醫療等，年繳、可續保）。**唔包**危疾、癌症現金、住院現金、意外。
- 唔好改 `functions/`（密碼）、`assets/vendor/`、`_headers`。

## 步驟
1. 環境：系統 python3 嘅 cryptography 壞咗（import pypdf 會 panic，2026-11-07 試跑發現），**一開始就用 venv**：`python3 -m venv /tmp/v && /tmp/v/bin/pip install -q pypdf` ，之後所有 python 指令用 `/tmp/v/bin/python`。確認有 `node`。
   - 唔使收錄：標明「不適用於新申請」嘅舊產品（例如尊尚／尊顯／尊裕 vhis-prime／privilege／privilege-plus）；危疾＋醫療組合（例如 Metro Trio）。
2. **產品清單**：開 `https://www.aia.com.hk/zh-hk/products/health/medical-protection`（頁面有「展示更多」，用頁面 HTML／JSON 或 `https://www.aia.com.hk/sitemap.xml` 搵晒 `/zh-hk/products/health/` 下面嘅產品頁）。同 `scripts/build_premiums.py` 嘅 `PLANS` 同 `NO_PUBLIC_TABLE` 對：
   - **新產品**：開佢產品頁搵「保費表」PDF。
     - 有公開保費表 → 加入 `PLANS`（name、riderCode 唔知就 `None`、riderAvailable、category `basic`／`high_end`、page、brochure、premiumPdf），寫一個 `parse_<key>()` 加入 `PARSERS`。每張表要有 type（basic／rider）、sex、ward、deductible（{HKD, USD}）、area、0–100 歲。
     - 冇公開保費表 → 加入 `NO_PUBLIC_TABLE`（網站會列做「做唔到」）。
   - **下架**（產品頁 404 或者唔再喺清單）→ 由 `PLANS`／`NO_PUBLIC_TABLE` 刪走。
   - 現有產品保費表 PDF 網址變咗 → 喺產品頁搵新網址更新 `premiumPdf`。
3. `python scripts/build_premiums.py`（下載 PDF、讀表；檢查唔過唔會覆蓋 `data/aia-medical-premiums.json`）。
4. `python scripts/validate_data.py`（匯率、自付費／房型次序、附加契約比例、PDF 抽查、同上一版比較）。
5. `node tests/data.test.js`（網站每個醫保、每個選項都計到數）、`node tests/calc.test.js`、`node tests/auth.test.mjs`。
6. **人手抽查**（新產品或者生效日有變嘅表必做）：每張表揀 3 個歲數（例如 5、45、85），喺 PDF 文字搵返**嗰一行**（歲數＋港元＋美元喺同一行／同一格），確認同 JSON 一樣。淨係「個數喺 PDF 出現過」唔夠（以前試過數字喺第二度出現）。
7. 寫一段喺 `data/UPDATE-LOG.md` 最頂：日期、生效日變動、平均加幅、新增／下架產品、抽查結果、任何 AIA PDF 本身嘅怪數（例如靈活計劃男標準私家房 21–23 歲港元÷美元 ≈ 8.06，係 PDF 原文）。
8. 冇任何改動（PDF 一樣、冇新產品）→ 只喺 UPDATE-LOG 加一行「冇改動」，commit + push。
9. commit message 用廣東話講改咗咩，push main。Cloudflare Pages 會自動部署；網站有密碼，唔使理。

## 報告（任務最後輸出）
- 每份保費表：生效日、有冇改、保費中位數變動。
- 新增／下架產品。
- 測試結果。
- push 咗 main 定分支。
