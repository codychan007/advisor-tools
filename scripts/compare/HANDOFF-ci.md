# 危疾數據交接（2026-11-05）

新 session 接手：繼續逐間公司加危疾計劃。**用廣東話（粵字）同 Cody 傾**；重要決定先問多幾條問題先做。

## 而家狀態
- 網站：`life-site/`（人生規劃通，工具一 `/compare/` 醫療＋危疾分頁）。本機預覽：`.claude/launch.json` 嘅 `life-preview`（port 8788，serve `life-site/dist`）。
- 建置：`python scripts/build.py`（正式）；預覽包未核實：`SHOW_UNVERIFIED=1 INCLUDE_TESTS=1 python scripts/build.py`
- 檢查：`python scripts/validate_data.py`；核實清單：`python scripts/make_checklist.py` → `/tests/checklist.html`；公式：`/tests/verify.html`（20 項 ✅）
- 危疾數據：`data/ci/plans.json`（68 個，9 間公司）；保費表 CSV 喺 `data/ci/premiums/`；產品清單同進度：`data/ci/_inventory.json`（done 28／todo 44／rider 8／skip 2）
- 已核實（verified: true）：AIA 簡護危疾保、保泰 3 個。其餘全部 verified: false（等 Cody 對核實清單）

## 下一批：富衛、永明、萬通、周大福
清單喺 `_inventory.json` 對應公司（FWD Life (Bermuda)、Sun Life Hong Kong、YF Life、Chow Tai Fook Life），有官方網頁／小冊子連結。

## 做法（每間公司）
1. **先睇 robots.txt**：PDF 被 Disallow（例如宏利 `Disallow: /*.pdf$`）就**唔好用程式下載**，只用產品網頁（HTML），讀唔到嘅欄位寫「見產品單張」。
2. 下載小冊子：`scratchpad` 工具已複製到 `scripts/flexi/`：`brochure_facts.py`（下載＋抽重點）、`keyfacts.py`（投保年齡、保障期、供款期、疾病數目、多次賠償、上限、相隔期、貨幣）、`find_tables.py`（搵真正保費表；≥12 行「年齡＋數字」先算）、`parse_rate_table.py`（每 $1,000 費率表 → CSV，會合併斷開數字並用第二種讀法核對）、`parse_ci.py`（固定保額保費表 → CSV）。
3. **中文名一定由保險公司中文官網抄**（例如用 built-in browser fetch `/zh-hk/...` 頁 `<title>`），唔好自己譯。
4. 用 Python 腳本加入 `plans.json`（格式見下），再 validate → make_checklist → 預覽 build → browser 手機闊度（375px）檢查冇橫向捲動、冇 console error。
5. 更新 `_inventory.json` 狀態同 memory。

## Cody 已定嘅規則（唔好改）
- **唔可以編造**任何保費／條款；唔肯定就 null（網站顯示「見條款」）。唔顯示任何「示例」。
- 有公開保費表 → `pricing: "table"`；冇 → `pricing: "quote"`（卡上「需經持牌顧問報價」，條款照列，**唔顯示小冊子保費例子**）。
- 固定保額保費表：只計表列保額；「每 $1,000 保額」費率表：`rateBasis: "per1000"`＋`sumAssuredOptions: [500000, 1000000]`（卡註明未計保額折扣）。
- 月供表：×12 並 `monthlyOnly: true`。
- 附加保障照列，`rider: true`（卡標「附加保障」）。
- 儲蓄型卡只列危疾保障欄位（唔寫保額增值／紅利回報）。
- 類型：`renewable`（續保型，`renewal: {every, to}`）、`level`（平準，`coverTo`、`payTo`）、`savings`；唔知就 `null`（顯示「類型見條款」）。
- 合規：描述文字唔可以有「最好／最抵／推介／best」等（官方產品名唔檢查）。

## plans.json 一項（需報價例子）
```json
{"id": "fwd-xxx", "insurer": {"zh": "富衛人壽保險（百慕達）有限公司", "en": "FWD Life Insurance Company (Bermuda) Limited"},
 "plan": {"zh": "（官方中文名）", "en": "(official English name)"}, "type": "savings", "rider": false,
 "renewal": null, "coverText": {"zh": "終身；供款 10／20／25 年", "en": "..."}, "issueAges": [0, 65],
 "pricing": "quote", "premiumFile": null, "diseases": {"severe": 58, "early": 44, "mid": 0},
 "otherCover": {"zh": "...", "en": "..."}, "earlyText": null,
 "multiClaim": {"cancer": {"times": 3, "gapYears": 3, "capPct": 300}, "heart": {"zh": "可多次（見說明）", "en": "Multiple claims (see details)"}, "stroke": null},
 "multiText": {"zh": "...", "en": "..."}, "totalCapPct": null, "capText": {"zh": "合共最多 900%", "en": "..."},
 "waitingDays": 90, "premiumText": {"zh": "...", "en": "..."}, "premiumGuaranteed": null, "cashValue": true,
 "extras": {"zh": [], "en": []}, "premiumSourceUrl": null, "termsUrl": {"zh": "（小冊子）", "en": "..."},
 "source": {"zh": "富衛官網：產品小冊子", "en": "FWD website: product brochure"}, "sourceUrl": "（產品頁）",
 "updatedOn": "YYYY-MM-DD", "verified": false}
```
保險公司英文名要同 `data/medical/vhis-standard.json` 一字不差，目錄先會將醫療同危疾歸同一格（例如 `Sun Life Hong Kong Limited`、`YF Life Insurance International Limited`、`Chow Tai Fook Life Insurance Co Ltd`、`FWD Life Insurance Company (Bermuda) Limited`）。

## 之後
- 友邦 4 個附加保障、「摯愛妳」保障計劃（Plan 1/2/3 定額保費表，要新增 plan-option 格式）、宏利「心愛一家保」。
- 其他公司：滙豐、中銀人壽、安達、蘇黎世、立橋、香港人壽、三井住友、信諾等。
- Cody 對完核實清單，就將通過嘅計劃改 `verified: true` 加 `verifiedBy`。
- 之後工具二至四、分享圖、PDF 摘要（見 `人生規劃網站-規劃書.md`）。

## 進度（第 3 輪：富衛、永明、萬通、周大福）
- 2026-11-05 富衛 ✅ 11 個加咗（全部需報價；冇公開保費表）；CANsurance（癌症醫療實報實銷）、XDefender、Guardian Plus 標 skip。工具腳本：`scripts/flexi/ci_upsert.py <PLANS.py>`（upsert 入 plans.json）、`scripts/flexi/ci_inv_update.py <insurer_en> <products.json>`；今輪數據源檔喺 `scripts/flexi/ci_round3/`。
- 永明 ✅ 6 個加咗（包括附加保障危疾萬全保）；OmniCare 標 skip（官網危疾列表冇咗）。
- 萬通 ✅ 8 個（包括附加保障 Update 兒童健康保障）；額外癌症加護保標 skip（住院現金／每月津貼）。
- 周大福 ✅ 4 個；護痊保（計劃＋附加）標 skip（癌症醫療實報實銷）。
- 2026-11-06 第 3 輪完成：危疾共 68 個；validate ✅；checklist 232 項（新增 29 項 ci-terms）；預覽 375px 冇橫向捲動、冇 console error。compare.js 加咗 diseaseTxt（疾病數全 0 → 「見條款」）。
- 下一步：工具二至四（先問 Cody 問題）。robots.txt 四間都容許 PDF。
- 之後：Cody 要做工具二至四（醫療儲備、退休、稅務），做之前先問佢幾條問題。

## 工具二至四（2026-11-06 完成第一版）
- 共用：`assets/js/wizard.js`（一頁一題）；公式：`assets/js/calc/reserve.js`、`retire.js`、`tax.js`；頁面邏輯：`assets/js/reserve.js`、`retire.js`、`tax.js`。
- 數據：`data/assumptions.json`（醫療儲備緩衝／計分、退休預設）、`data/statutory.json`（強積金）、`data/tax/2025-26.json`、`2026-27.json`（已對稅務局／GovHK）。
- `/tests/verify.html` 34/34 ✅（新增 14 項：規劃書稅務例子 $15,580→$6,900、退休、醫療儲備）。
- 未做：分享圖、PDF 摘要。等 Cody 試用後調整。

## 互換：慳稅 → 理財資訊通、保障資訊 → 人生規劃通（2026-11-06 本機準備好）
- 人生規劃通：新增 `/insurance/`；目錄改「實用資訊欄」下拉；拎走 `/tax/`（`_redirects` 轉去姊妹網站）。verify 26/26 ✅。
- 理財資訊通（`site/`，未 commit）：新增隱藏 `/tax/`（noindex、唔喺目錄）。
- **公開當日照 `scripts/launch-swap-checklist.md` 做**（包括改兩個雲端定時任務嘅 repo）。

## 危疾全部核實（2026-11-06）
- Cody 授權 Claude 代剔：64 個未核實計劃重新對官方小冊子／產品頁；改正安盛 6 個等候期（90→60 日）、4 個等候期改 null（小冊子冇寫）、保誠延續保障 III 多次賠償寫法。68/68 verified，正式版會顯示晒。
- multiClaim 文字值已改成 {zh, en}（2026-11-06）；validate_data.py 會擋只有中文嘅寫法。
- 上線步驟俾 Cody：`Claude project/人生規劃通-上線步驟.md`（repo `life-tools`、Cloudflare 項目 `codychan-life`）。

## GitHub（2026-11-06）
- repo：codychan007/life-tools（Private），首次上載 dd55869（main）。之後改完：`git add -A && git commit && git push`。
- 下一步：Cody 做 GitHub 設定（第 2 部分）同 Cloudflare 項目 codychan-life（第 3 部分），步驟喺 `../人生規劃通-上線步驟.md`。
- 2026-11-06：Cloudflare Pages 項目 codychan-life 上咗網（預覽版）https://codychan-life.pages.dev ，push main 就自動部署。
- 2026-11-06：安盛 9 張卡嘅資料來自 prismic PDF（robots.txt 禁止 *.pdf）；Cody 決定保持現狀。以後唔好再下載安盛 PDF，更新只用 www.axa.com.hk 網頁。

## 2026-11-06 正式公開＋改名
- 網站改名「香港地一站式保障資訊通」（HK Protection Compass，印章「保」），網址不變；PREVIEW=False。合規部未批，Cody 決定先公開。
- 互換完成：理財資訊通 `/tax/` 入咗目錄、`/insurance/` 301 轉嚟呢度；保障資訊兩個雲端任務已轉 life-tools。
