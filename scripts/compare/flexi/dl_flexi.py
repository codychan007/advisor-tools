# 下載所有仍接受新投保嘅自願醫保靈活計劃（港元）官方標準保費 PDF，同每個計劃一份條款 PDF
# 公開資料、唔使登入；每秒最多一個請求
import json, sys, time, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
SRC = Path(sys.argv[1])            # flexi-plans.json 所在資料夾
OUT = Path(sys.argv[2]); (OUT / "premium").mkdir(parents=True, exist_ok=True); (OUT / "plandoc").mkdir(exist_ok=True)
BASE = "https://www.vhis.gov.hk"
UA = {"User-Agent": "HK-Life-Compass-data-check/1.0 (public data, 1 req/s)"}
f = json.load(open(SRC / "flexi-plans.json", encoding="utf-8-sig"))["certified-plans"]
live = [p for p in f if not p.get("de-reg") and not p.get("unavailable") and not p.get("renewal-only")]
jobs = []
for p in live:
    levels = [i for i in p["plan-info-certified"] if i.get("currency") == "HKD" and not i.get("renewal-only")]
    for i in levels:
        jobs.append(("premium", i["premium-doc-url"]["zh-hk"]))
    if levels:
        jobs.append(("plandoc", levels[0]["plan-doc-url"]["zh-hk"]))
ok = fail = skip = 0
for kind, path in jobs:
    dest = OUT / kind / path.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 1000:
        skip += 1
        continue
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=60) as r:
            dest.write_bytes(r.read())
        ok += 1
    except Exception as e:
        fail += 1
        print("FAIL", path, e)
    time.sleep(1)
print(f"done: {ok} downloaded, {skip} already there, {fail} failed, {len(jobs)} total")
