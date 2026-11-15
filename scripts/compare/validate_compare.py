"""
檢查「醫療及危疾比較」產品數據有冇犯規（GitHub 每次改動都會自動行；本機：python scripts/compare/validate_compare.py）

規則：
  1. 示例（sample: true）：公司名同計劃名一定要有「示例」／"Sample"，verified 一定係 false
  2. 真數據（sample: false）：一定要有 sourceUrl、updatedOn（YYYY-MM-DD），verified 一定係 true
  3. 產品資料唔可以出現「最好」「最抵」「推介」「首選」等字眼（合規）
  4. 保費表 CSV：數字、年齡 0–99、欄位齊
  5. 官方標準計劃 JSON：日期、保費表長度、至少 20 個計劃
有錯會列晒出嚟，並以錯誤碼結束（GitHub 會顯示紅色 ❌）。
"""
import csv
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent.parent   # advisor-tools
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
BANNED = re.compile(r"最好|最抵|推介|首選|最佳|best|recommend", re.I)
errors, warns = [], []


def err(msg):
    errors.append(msg)


def text_of(obj):
    return json.dumps(obj, ensure_ascii=False)


def check_common(p, where):
    pid = p.get("id", "?")
    for k in ("id", "insurer", "plan", "source", "updatedOn"):
        if p.get(k) in (None, "", {}):
            err(f"{where} {pid}：缺少 {k}")
    if not DATE.match(str(p.get("updatedOn", ""))):
        err(f"{where} {pid}：updatedOn 要係 YYYY-MM-DD")
    if p.get("sample"):
        for k in ("insurer", "plan"):
            v = p.get(k) or {}
            if "示例" not in v.get("zh", "") or "Sample" not in v.get("en", ""):
                err(f"{where} {pid}：示例數據嘅 {k} 中文要有「示例」、英文要有 \"Sample\"")
        if p.get("verified"):
            err(f"{where} {pid}：示例數據唔可以 verified: true")
    else:
        if not p.get("sourceUrl"):
            err(f"{where} {pid}：真數據一定要有 sourceUrl（資料來源連結）")
        if p.get("verified") is not True:
            warns.append(f"{where} {pid}：未核實（verified: false），正式網站唔會顯示")
    for k in ("features", "extras", "otherCover", "earlyText", "multiText", "capText", "premiumText"):   # 官方產品名唔檢查
        if p.get(k) and BANNED.search(text_of(p[k])):
            err(f"{where} {pid}：{k} 有合規禁用字眼（最好／最抵／推介等）")


def check_medical():
    base = ROOT / "data" / "compare" / "medical"
    D = json.loads((base / "plans.json").read_text(encoding="utf-8"))
    std_insurers = {p["insurer"]["en"] for p in json.loads((base / "vhis-standard.json").read_text(encoding="utf-8"))["plans"]}
    for p in D["plans"]:
        check_common(p, "醫療")
        if p.get("ward") not in ("standard", "semi-private", "private", "any"):
            err(f"醫療 {p['id']}：ward 只可以係 standard / semi-private / private / any")
        if p.get("vhis") and p["insurer"]["en"] not in std_insurers:
            warns.append(f"醫療 {p['id']}：公司英文名「{p['insurer']['en']}」同官方標準計劃名單唔一樣，目錄會分開兩格")
        if not p.get("variants"):
            err(f"醫療 {p['id']}：最少要有一個 variants（自付費／保障地區選項）")
        for v in p.get("variants", []):
            f = base / v.get("premiumFile", "")
            if not f.is_file():
                err(f"醫療 {p['id']}/{v.get('id')}：搵唔到保費表 {v.get('premiumFile')}")
                continue
            rows = list(csv.DictReader(open(f, encoding="utf-8-sig")))
            need = {"age", "male_ns", "male_s", "female_ns", "female_s"}
            if not rows or not need <= set(rows[0]):
                err(f"醫療 {p['id']}/{v['id']}：保費表欄位要有 {sorted(need)}")
                continue
            groups = {}
            for r in rows:
                groups.setdefault((r.get("entryFrom", "0"), r.get("entryTo", "100")), []).append(int(r["age"]))
            for g, ages in groups.items():
                if ages != list(range(ages[0], ages[0] + len(ages))):
                    err(f"醫療 {p['id']}/{v['id']}：投保年齡組 {g} 年齡唔連續（可能抄漏行）")
            for r in rows:
                for k in need - {"age"}:
                    if r[k] not in (None, "") and float(r[k]) <= 0:
                        err(f"醫療 {p['id']}/{v['id']}：{r['age']} 歲 {k} 保費唔合理")
                        break


def check_ci():
    base = ROOT / "data" / "compare" / "ci"
    D = json.loads((base / "plans.json").read_text(encoding="utf-8"))
    for p in D["plans"]:
        check_common(p, "危疾")
        if p.get("type") not in ("renewable", "level", "savings", None):
            err(f"危疾 {p['id']}：type 只可以係 renewable / level / savings")
        if p.get("pricing") not in ("table", "quote"):
            err(f"危疾 {p['id']}：pricing 只可以係 table 或 quote")
        for k in ("severe", "early", "mid"):
            if not isinstance(p.get("diseases", {}).get(k), int):
                err(f"危疾 {p['id']}：diseases.{k} 要係整數")
        if p.get("pricing") == "table":
            if not (p.get("sumAssured") or p.get("sumAssuredOptions")) or not p.get("issueAges") or not (p.get("renewal") or (p.get("type") == "level" and p.get("coverTo"))):
                err(f"危疾 {p['id']}：有保費表就要寫 sumAssured（或 sumAssuredOptions）、issueAges、renewal")
            if p.get("rateBasis") == "per1000" and not p.get("sumAssuredOptions"):
                err(f"危疾 {p['id']}：每千元費率要寫 sumAssuredOptions")
            f = base / (p.get("premiumFile") or "")
            if not f.is_file():
                err(f"危疾 {p['id']}：搵唔到保費表 {p.get('premiumFile')}")
                continue
            rows = list(csv.DictReader(open(f, encoding="utf-8-sig")))
            need = {"age", "male_ns", "male_s", "female_ns", "female_s"}
            if not rows or not need <= set(rows[0]):
                err(f"危疾 {p['id']}：保費表欄位要有 {sorted(need)}")
                continue
            ages = [int(r["age"]) for r in rows]
            if ages != list(range(ages[0], ages[0] + len(ages))):
                err(f"危疾 {p['id']}：年齡唔連續")
            lo, hi = p["issueAges"]
            if not (ages[0] <= lo and ages[-1] >= hi):
                err(f"危疾 {p['id']}：保費表冇齊投保年齡 {lo}–{hi}")
            for r in rows:
                if any(float(r[k]) <= 0 for k in need - {"age"}):
                    err(f"危疾 {p['id']}：{r['age']} 歲保費唔合理")
                    break
        for k, v in (p.get("multiClaim") or {}).items():
            if isinstance(v, str):
                err(f"危疾 {p['id']}：multiClaim.{k} 要寫成 {{\"zh\": …, \"en\": …}}（英文版先唔會顯示中文）")
            elif isinstance(v, dict) and "zh" in v and not (v.get("en") or "").strip():
                err(f"危疾 {p['id']}：multiClaim.{k} 缺英文")
        if p.get("pricing") == "quote" and not p.get("termsUrl"):
            err(f"危疾 {p['id']}：需報價嘅計劃都要有條款／小冊子連結 termsUrl")
        if p.get("extras") and BANNED.search(text_of(p["extras"])):
            err(f"危疾 {p['id']}：有合規禁用字眼")


def check_standard():
    f = ROOT / "data" / "compare" / "medical" / "vhis-standard.json"
    D = json.loads(f.read_text(encoding="utf-8"))
    if not DATE.match(D.get("asOf") or ""):
        err("標準計劃：asOf 日期唔啱")
    if len(D["plans"]) < 20:
        err(f"標準計劃：只得 {len(D['plans'])} 個，可能轉換出錯")
    for p in D["plans"]:
        for s in p["schedules"]:
            if len(s["male"]) != 101 or len(s["female"]) != 101:
                err(f"標準計劃 {p['id']}：保費表長度唔係 0–100 歲")
        if not p["planDocUrl"]["zh"].startswith("https://www.vhis.gov.hk/"):
            err(f"標準計劃 {p['id']}：條款連結唔係官方網站")


def check_terms():
    D = json.loads((ROOT / "data" / "compare" / "medical" / "standard-plan-terms.json").read_text(encoding="utf-8"))
    if not DATE.match(D.get("verifiedOn", "")):
        err("標準計劃條款：verifiedOn 日期唔啱")


for fn in (check_medical, check_ci, check_standard, check_terms):
    try:
        fn()
    except Exception as e:  # 格式錯到讀唔到
        err(f"{fn.__name__}：讀取失敗 {e!r}")

if warns:
    print(f"⚠️ 提示 {len(warns)} 項（例如：{warns[0]}）")
if errors:
    print("❌ 數據檢查唔通過：")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("✅ 數據檢查通過")
