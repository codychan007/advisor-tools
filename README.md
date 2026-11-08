# advisor-tools

TC Team專屬AI工具箱（同事內部用，有共用密碼）。上線同設定步驟睇 `上線步驟.md`。

## 產品溫習（/product-quiz/）
- 設計同 Cody 嘅選擇：`QUIZ-SPEC.md`。
- 題目原稿：`quiz-src/<產品 id>/*.json`；AIA 自己產品之間嘅比較題：`quiz-src/compare/*.json`（`products` 標明涉及邊幾個產品，唔會重複出）；產品清單：`quiz-src/products.json`。
- 改完題目：`python scripts/build_quiz.py`（檢查＋合併做 `data/quiz/`），再 `node tests/quiz.test.js`。
- 內部培訓文件**唔放入呢個 repo**，只留喺 `Claude project\產品培訓資料\`。
- 加新產品：存文件 → 抽文字 → 寫 `quiz-src/<id>/`（基本 150＋進階 150，增值服務 ≤ 7%）→ 先睇比較題庫有冇相關題，只加新嘅 → 加入 `products.json`。
