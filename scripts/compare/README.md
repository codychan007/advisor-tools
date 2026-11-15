# 醫療及危疾比較（/compare/）：點樣更新產品資料

> 2026-11-15 由保障資訊通（life-tools）搬過嚟（Cody：公司之間嘅比較只俾顧問睇，唔公開俾客人）。
> 頁面：`compare/index.html`；程式：`assets/js/cmp/`（compare.js、premium.js 等，由保障資訊通抄過嚟）；樣式：`assets/css/compare.css`。
> 數據：`data/compare/medical/`、`data/compare/ci/`。

## 改完數據一定要做
1. `python scripts/compare/validate_compare.py` → 見到 ✅
2. `python scripts/compare/build_compare.py` → 更新 `plans.compiled.json`（網站讀呢個；工具箱冇 build，所以要 commit 埋）
3. `node tests/compare.test.mjs` → 全部通過
4. push 前 `git pull --rebase origin main`（main 每日有基金數據 bot commit）

GitHub 每次改動都會自動行 1–3（`.github/workflows/compare-data.yml`），有錯會紅色 + email。

## 自動更新
- **標準計劃官方保費**（`data/compare/medical/vhis-standard.json`）：保障資訊通每月 1 號由醫務衞生局 Excel 開 PR（醫療儲備仲用緊），Cody 撳 Merge 之後，呢度每星期二 10:00 由 `codychan-life.pages.dev` 自動抄過嚟、檢查、commit。
- **靈活計劃、危疾**：每月 2 號 11:00 Claude 雲端定時任務按 `scripts/compare/monthly-check-prompt.md` 檢查，有改動推去 `monthly-check-YYYY-MM` branch 等 Cody 核實，**唔會直接改 main**。
- 未核實（`verified: false`）嘅計劃唔會入 compiled 檔，網站唔顯示。

## 工具
- `scripts/compare/flexi/`：由醫務衞生局官方 PDF 抽靈活計劃保費、條款（流程睇 `flexi/README.md`）；危疾新增用 `flexi/ci_upsert.py`、`flexi/ci_inv_update.py`
- `scripts/compare/make_checklist.py`：生成核實清單
- `scripts/compare/HANDOFF-ci.md`：危疾逐間公司嘅加入紀錄（robots.txt 限制等）

---

## 2. 靈活計劃（半私家／私家）及非自願醫保計劃（`data/compare/medical/plans.json` ＋ `data/compare/medical/premiums/`）

網站**唔會顯示任何示例**，只顯示核實過嘅真數據。網頁上以「保險公司目錄」排列：同一間公司嘅標準計劃、靈活計劃會自動歸埋一格（靠公司英文名，要同官方名單一字不差）。

每個計劃一項，每個「選項」（自付費 × 保障地區）一個 CSV：

```json
{
  "id": "aia-f00081",
  "insurer": {"zh": "友邦保險（國際）有限公司", "en": "AIA International Limited"},
  "plan": {"zh": "AIA自願醫保睿選計劃", "en": "AIA Voluntary Health Insurance SelectWise Scheme"},
  "vhis": true, "certNo": "F00081",
  "ward": "semi-private",
  "annualLimit": 3000000, "lifetimeLimit": null,
  "features": {"zh": ["（只寫客觀條款）"], "en": ["(factual terms only)"]},
  "unisex": true, "smokerRated": false,
  "variants": [
    {"id": "hkd0", "label": {"zh": "$0 自付費", "en": "$0 deductible"}, "deductible": 0, "area": null,
     "premiumFile": "premiums/aia-f00081-hkd0.csv",
     "sourceUrl": "https://www.vhis.gov.hk/doc/certifiedplan/fp/F00081/F00081-01-000-01-StandardPremium-Bilingual.pdf"}
  ],
  "planDocUrl": {"zh": "https://www.vhis.gov.hk/doc/...PlanDoc-c.pdf", "en": "https://www.vhis.gov.hk/doc/...PlanDoc-e.pdf"},
  "source": {"zh": "醫務衞生局自願醫保網站：官方標準保費表", "en": "VHIS website: official standard premium table"},
  "sourceUrl": "https://www.vhis.gov.hk/tc/consumer_corner/flexi-plan.html",
  "updatedOn": "2026-11-05", "verified": true
}
```

CSV（用 Excel 開得）：`age,male_ns,male_s,female_ns,female_s`，0–99 歲每歲一行；保費唔分男女／吸煙就幾欄填一樣（`unisex`、`smokerRated` 照實寫）。

- `ward` 只可以係 `standard`（普通房）、`semi-private`（半私家）、`private`（私家），由條款 PDF 嘅病房級別或房租限額判斷
- 非自願醫保計劃：`vhis` 填 `false`、`certNo` 填 `null`，網站會標「非自願醫保（保費唔可以扣稅）」；**保險公司冇公開保費表就唔好加**，唔可以估數
- `features` 只寫客觀條款，**唔可以**寫「最好」「最抵」「推介」等字（檢查程式會擋）

**核實流程**：Claude 由官方 PDF 抽數 → 程式檢查（年齡連續、保費合理、同 PDF 再對一次）→ 你喺「核實清單」每間公司抽查幾個年齡對 PDF → 冇問題先將 `verified` 改 `true` 上網。

## 3. 危疾計劃（`data/compare/ci/plans.json` ＋ `data/compare/ci/premiums/`）

按公司目錄顯示；頂部按類型篩選：續保型定期（`renewable`）、平準保費定期（`level`）、儲蓄型（`savings`）。

- **有公開保費表（`pricing: "table"`）**：CSV 格式 `age,male_ns,male_s,female_ns,female_s,renewalOnly`，每行係**保費表列明嗰個保額**嘅年保費（月供表 × 12，並寫 `monthlyOnly: true`）。
  - `sumAssured`：保費表嘅保額（例如 500000），網站唔會按比例換算其他保額
  - `renewal`：`{"every": 1, "to": 100}` = 每年續保至 100 歲；`{"every": 5, "to": 80}` = 每 5 年續保（期內保費不變）
  - `issueAges`：新投保年齡（例如 `[0, 65]`），66 歲以上只限續保
- **冇公開保費表（`pricing: "quote"`）**：唔使 CSV，網站顯示「需經持牌顧問報價」，條款照列
- 疾病數目、早期賠償（`earlyText`）、多次賠償（`multiClaim` 加 `multiText`）、總賠償上限（`totalCapPct` 或 `capText`）、等候期、保費保證、現金價值：由保單條款或小冊子抄，連結放 `termsUrl`、保費表放 `premiumSourceUrl`

而家有：友邦簡護危疾保、保泰危疾保／多重危疾保／早期及多重危疾保（官方保費表）。富衛 MyCover、蘇黎世 Zurich Care、滙豐滙達保只有網上報價，未加入。

## 4. 「資料可能已過時」提示（自動）

每個產品按 `updatedOn` 計，超過 6 個月網站會自動加提示。官方標準計劃每月自動更新，所以正常唔會出現。


## 合規提醒
- 只陳列客觀資料；保險公司目錄按**英文名**字母排序，目錄格唔顯示價錢；公司入面先按用戶揀嘅數值排
- 唔顯示示例；每個產品一定要有來源連結同更新日期；唔可以寫「最好」「最抵」「推介」
- 頁面有「同事內部參考，請勿截圖、轉發或者展示俾客人」提示
