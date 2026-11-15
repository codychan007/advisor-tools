# 靈活計劃（半私家／私家）數據流程

全部用醫務衞生局自願醫保網站嘅公開資料（唔使登入，每秒最多一個請求）。
用一個工作資料夾 W（入面要有 vhis-dl/flexi-plans.json，由 https://www.vhis.gov.hk/public/data/flexi-plans.json 下載）：

1. `python dl_flexi.py W/vhis-dl W/flexi-pdf`：下載所有港元選項嘅官方保費 PDF
2. `python parse_flexi.py W`：抽「年繳・基本計劃」保費（按表頭位置標欄、用數值大細核對年繳／月繳、分投保年齡組）→ W/parsed.json
3. `python crosscheck.py W`：用第二種方法再讀 PDF，確認每個數字都喺 PDF 出現
4. `python tiers.py W --download`：按等級分組，每級下載一份條款 PDF
5. `python terms_snip.py W`、`python propose.py W`、`python ward2.py W`：由條款抽病房級別、房租上限、每年／終身限額
6. `python gen_site_data.py W <advisor-tools 資料夾>`：生成 data/compare/medical/plans.json 同 premiums/*.csv（全部 verified: false）
7. `python ../make_checklist.py`（再執行 `python ../build_compare.py` 更新網站用嘅 compiled 檔）：生成核實清單，Cody 抽查後先將 verified 改 true

讀唔到嘅選項（版面特別）會跳過，唔會估數。
