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
- 本機 Python 連 ECB 可能有 SSL 證書問題：用 `curl -o data/pdf_cache/funds/ecb-fx.zip https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip` 再加 `--offline`。
