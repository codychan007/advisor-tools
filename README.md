# advisor-tools

TC Team專屬AI工具箱（同事內部用，有共用密碼）。上線同設定步驟睇 `上線步驟.md`。

## 產品溫習（/product-quiz/）
- 設計同 Cody 嘅選擇：`QUIZ-SPEC.md`。
- 題目原稿：`quiz-src/<產品 id>/*.json`；AIA 自己產品之間嘅比較題：`quiz-src/compare/*.json`（`products` 標明涉及邊幾個產品，唔會重複出）；產品清單：`quiz-src/products.json`。
- 改完題目：`python scripts/build_quiz.py`（檢查＋合併做 `data/quiz/`），再 `node tests/quiz.test.js`。
- 內部培訓文件**唔放入呢個 repo**，只留喺 `Claude project\產品培訓資料\`。
- 加新產品：存文件 → 抽文字 → 寫 `quiz-src/<id>/`（基本 150＋進階 150，增值服務 ≤ 7%）→ 先睇比較題庫有冇相關題，只加新嘅 → 加入 `products.json`。

## 基金分析（/fund-analysis/）
- 設計同 Cody 嘅選擇：`FUND-SPEC.md`。範圍：「卓達智悅 2」（TMP2）全部 150 隻基金（派息 38、累積 112）；組合只可以同一貨幣；PDF 報告用 html2canvas（`assets/vendor/`）影低再由 `assets/js/fund-pdf.js` 砌成 PDF 直接下載。
- 每日自動更新：`.github/workflows/fund-data.yml`（見 `上線步驟.md` 4b）。本機 push 前先 `git pull --rebase origin main`。
- 人手更新數據：`python scripts/build_funds.py`（AIA 官網 FundInfo2 / FundChart / 派息紀錄 PDF → `data/funds/`），再 `node tests/fund.test.js`。
  - 每隻基金自己計嘅每年回報要同 AIA 公佈嘅吻合（差 ≤ 0.6%；非美元類別亦試用歐洲央行匯率換算做美元再對）。核對唔過嘅基金保留上次數據，列喺 `index.json` 嘅 `problems`，程式回 2。
  - 派息紀錄會儲落 `data/funds/<code>.json`，越儲越長（PDF 好多只顯示最近 12 個月）。
  - 部分累積基金有基金內部派息（AIA 自動再投資，價格反映唔到）：按 AIA 每年回報逐月補返，存喺 `reinvest`，頁面標「已按 AIA 調整」。
  - 太新嘅派息基金冇全年回報可以對：用 PDF 自己嘅派息率對數；連派息率都冇就標「⚠ 未能核對」。
- **上架 AIA 之前嘅歷史（2026-11-13）**：`data/backfill/<code>.json`（一次過，由 `scripts/backfill_funds.py` 或人手由基金公司網頁抄錄；每個檔案寫明來源）。`build_funds.py` 自動判斷 AIA 日子同基金公司 NAV 日子係咪差一日、檢查重疊期價格一致，再同 AIA 公佈嘅每年回報核對；唔夾就唔用（`backfillRejected`）。來源：貝萊德／安聯官網 API、富蘭克林（派息）、惠理（每月單張）、滙豐（基金中心）、其餘價格用 FT。
- 本機 Python 連 ECB 可能有 SSL 證書問題：用 `curl -o data/pdf_cache/funds/ecb-fx.zip https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip` 再加 `--offline`。

## Road Show 熱點地圖（/roadshow/）
- 設計同 Cody 嘅選擇：`ROADSHOW-SPEC.md`（第 8 節係 Cody 2026-11-13 嘅答案，以呢節為準）。
- 每週自動更新：`.github/workflows/roadshow-data.yml`（星期一 08:00 香港時間）跑 `python scripts/build_roadshow.py` → `data/roadshow/events.json`（未來 8 星期），再 `node tests/roadshow.test.js`。來源：會展（中英）、亞博（中英）、旅發局（中英）、康文署 XML。
- 改評分規則／客群／話題：`data/roadshow/rules.json`；改場館、地區、活動資料、加商場活動：`data/roadshow/manual.json`。改完 `python scripts/build_roadshow.py --offline`（用 `raw.json` 重新計分，唔使上網）。
- 候選擺位：`python scripts/build_spots.py`（OpenStreetMap 港鐵出口 → `data/roadshow/spots.json`，全部「候選」）。同事確認咗嘅位將 `status` 改做「可行」／「唔可行」並寫 `note`，重新整理唔會蓋過。
- 記錄成效同同事建議：`functions/api/roadshow-log.js`、`roadshow-suggest.js`（`server/roadshow-kv.js`），存 KV `ROADSHOW_KV`，每筆 1 年自動刪除，拒收電話／身份證／電郵。要先開 KV（`上線步驟.md` 4c）。
- 自發企街（唔跟活動，Cody 2026-11-13 加）：`data/roadshow/ideas.json`（主題、月份、時段、地區站名、道具、舉牌字句、開場白、基本策略）。站名要喺 `spots.json` 有；加新站先加入 `scripts/build_spots.py` 嘅 `STATIONS_RAW` 再跑。記錄成效可以揀「自發：主題」，統計分「按活動／主題」同「按企位」。
- 地圖：Leaflet 1.9.4（`assets/vendor/leaflet/`）＋地政總署地圖 API（免費、唔使 key）。海報：html2canvas。樣式：`assets/css/roadshow.css`。
