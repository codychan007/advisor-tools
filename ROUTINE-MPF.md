# 強積金工具：每月雲端任務（每月 1 號，Claude 雲端任務）

目的：更新「本月時事主題」同「轉移優惠」兩個人手檔案。**只可以推去 branch `mpf-monthly-YYYY-MM`，永遠唔好推 main**；Cody 睇過撳 Merge 先上網站。唔使 AI API、唔使錢。

## 步驟
1. `git checkout -b mpf-monthly-$(TZ=Asia/Hong_Kong date +%Y-%m)`（如果 branch 已經存在就用返佢）。
2. **時事主題** `data/mpf/themes.json`
   - 用網上搜尋睇上個月重要市場新聞（央行息口、美元、AI／科技股、港股、內地政策、地緣政治、通脹、日本），只用可靠來源（央行、政府、主要財經媒體）。
   - 由現有主題庫 `themes` 揀 3–5 個最貼近嘅，寫入 `active`：`month` = 今個月（YYYY-MM）、`picked` = 今日、`by` = "Claude 雲端任務建議（等 Cody 確認）"、`ids` = 揀咗嘅 id。
   - 主題庫冇合適嘅：可以**新增**一個主題（id、name、tilt、fact、logic、fit），規則：
     - `fact` 只寫已發生嘅事實，唔寫預測、唔寫目標價或者「一定升／跌」；
     - `tilt` 只可以用 `data/mpf/allocation-rules.json` `buckets` 入面嘅 key，每個數 -5 至 +5，股票類同非股票類各自加埋最好係 0；
     - 唔好改現有主題嘅字（Cody 已經睇過），除非事實已經過時，咁就喺 PR 描述講清楚。
3. **轉移優惠** `data/mpf/offers.json`
   - 逐間受託人睇官網優惠頁（友邦、銀聯信託 BCT、滙豐、恒生、宏利、永明、中銀保誠、東亞、交通銀行、中國人壽、萬通）：有冇新優惠、舊優惠改咗或者完咗。
   - 每個優惠要有：trustee、scheme、title、from、to、reward、conditions、source（官方網址）、checked（今日）、verified（有睇過條款原文先寫 true）。
   - 已經完咗超過 2 個月嘅優惠刪走。`news` 有新嘅制度變化（例如全自由行次階段時間表）可以加，要附官方來源。
   - `updated` 改做今日。
4. 驗證：`node tests/mpf.test.js` 一定要過。
5. Commit（訊息：`強積金每月主題及優惠 YYYY-MM`），`git push origin mpf-monthly-YYYY-MM`。
6. 喺最後報告用粵語列出：揀咗邊幾個主題同原因（附新聞來源）、優惠有咩改動。

## 唔好做
- 唔好推 main、唔好改其他工具嘅檔案、唔好改 `allocation-rules.json`。
- 唔好放任何客人資料或者內部培訓文件。
