# 醫療及危疾比較：每月產品檢查（自動程序指示）

> repo：advisor-tools（TC Team專屬AI工具箱，/compare/ 頁）。每月 2 號早上 11:00（香港時間）由 Claude 雲端定時任務執行。人手檢查都可以照住做。
> 2026-11-15 由保障資訊通搬過嚟；標準計劃官方保費由 `.github/workflows/compare-data.yml` 每星期二自動由保障資訊通抄過嚟，唔使理。

## 目標

顧問工具箱「醫療及危疾比較」嘅數字**唔可以有錯**，所以呢個任務**只係偵測同草擬，唔會直接改網站**：
發現有變 → 喺匯報列清楚，需要嘅話推一條 branch 等 Cody 核實；**永遠唔好推 main**。

## A. 自願醫保靈活計劃（醫療）

1. 下載官方清單 https://www.vhis.gov.hk/public/data/flexi-plans.json（公開、唔使登入）。
2. 同 `data/compare/medical/plans.json` 比較（每個計劃 `certNo`；每個選項 `variants[].certNo` 同 `variants[].sourceUrl` 官方保費 PDF）。
   **注意**：網站**只收港元（HKD）選項**，美元／其他貨幣選項係刻意唔收，唔好當「新選項」報；另外 2026-11 有 13 個港元選項因為保費 PDF 版面讀唔到而冇收（Zurich 8、BOC Life 4、FWD 1），都唔使當新選項報，除非佢哋嘅保費 PDF 連結變咗。只報**港元**選項嘅變動：
   - 官方有、我哋冇嘅計劃或選項 → **新計劃／新選項**
   - 我哋有、官方冇 → **可能已停售**
   - 同一個選項，官方保費 PDF 連結（檔名／日期）唔同咗 → **保費可能已更新**
3. 唔好改 `data/compare/medical/`；只喺匯報列出（計劃名、證書號碼、官方連結）。保費更新要用 `scripts/compare/flexi/` 嘅流程人手處理，再由 Cody 對核實清單。

## B. 危疾計劃

1. **先睇每個網址所屬主機嘅 robots.txt**（PDF 主機可能同產品網頁唔同）：佢禁止嘅就**唔好下載**，只睇產品網頁（HTML）。每秒最多一個請求。已知（2026-11）：
   - **安盛**：小冊子放喺 `hk-axa-web-2024.cdn.prismic.io`，佢嘅 robots.txt 係 `Disallow: *.pdf` → **唔好下載安盛 PDF**，只睇 `www.axa.com.hk` 產品頁。
   - **宏利**：`Disallow: /*.pdf$`；robots.txt 對程式回 403 → 冇法確認就**全部唔抓**，喺匯報寫「宏利需人手睇」。
   - **保誠**：`User-agent: *` 有 `Disallow: /` 但有更長嘅 `Allow: /content/dam/prudential-phkl/pdf/` → 按「最長規則優先」，小冊子 PDF 可以下載。
   - 周大福人壽網站有時會斷線（connection reset）→ 隔幾秒再試一次，仲唔得就寫「需人手開」。
2. 對 `data/compare/ci/plans.json` 每個計劃：開 `sourceUrl`（產品頁）同 `termsUrl`（小冊子）。
   - 打唔開（404）、產品頁冇咗、或者寫「已停售」→ **可能已停售／換咗新版**
   - 小冊子檔名或日期變咗 → **條款可能更新**（再對一次卡上嘅疾病數目、投保年齡、等候期、多次賠償，列出唔同嘅地方）
3. 對 `data/compare/ci/_inventory.json` 每間公司搵清單入面冇嘅**新危疾產品**。產品列表頁多數用 JavaScript 載入，所以優先用 sitemap：
   - 富衛：`https://www.fwd.com.hk/sitemap-pages.xml`（搵 `/zh/critical-illness/`）
   - 永明：`https://www.sunlife.com.hk/zh-hant/sitemap.xml`（搵 `/insurance/health/critical-illness/`）
   - 萬通：`https://www.yflife.com/sitemap.xml`（搵 `/tc/product/health/critical-illness/`）
   - 周大福：`https://www.ctflife.com.hk/sitemap.xml`（搵 `/tc/product/health/`）
   - 友邦、保誠、安盛、宏利、保泰：試 `https://（主機）/sitemap.xml`；搵唔到就寫「需人手睇最新產品」。
4. 有新產品：可以喺 branch 草擬新項目（格式同 `data/compare/ci/plans.json` 其他項目一樣），**`verified: false`**、`pricing: "quote"`（除非有官方保費表）、唔知嘅欄位寫 `null`、中文名由保險公司中文官網抄、`multiClaim` 文字要寫 `{"zh": …, "en": …}`。未核實嘅計劃正式網站唔會顯示。

## 提交

- 全部冇變 → 唔使提交，只匯報「冇變」。
- 有要改／草擬 → 先 `git pull origin main`（main 每日有基金數據 bot commit），再 `git checkout -b monthly-check-YYYY-MM`，只改 `data/compare/ci/plans.json`（新草擬項目）、`data/compare/ci/_inventory.json`（標 status）；執行 `python3 scripts/compare/validate_compare.py`（必須 ✅）、`python3 scripts/compare/build_compare.py`（更新 compiled 檔）同 `node tests/compare.test.mjs`；commit 訊息 `data: monthly check YYYY-MM`；`git push origin monthly-check-YYYY-MM`。**唔好推 main，唔好 force push。**
- 匯報附上 `https://github.com/codychan007/advisor-tools/compare/main...monthly-check-YYYY-MM`。

## 必須遵守

- **絕對唔可以編造**任何保費、條款、數字或日期；唔肯定就寫「需人手核實」。
- 唔好抓要登入或者 robots.txt 禁止嘅網頁。
- 唔好用「最好／最抵／推介」等字眼。
- 完成後用繁體中文（廣東話）簡短匯報，分 A／B 兩部分：有咩變、邊啲要 Cody 核實、branch 連結。
