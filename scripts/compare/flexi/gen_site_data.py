# 由 tiers.json + parsed.json + ward2.json 生成網站 data/medical/plans.json 同 premiums/*.csv
# 全部標 verified: false（待 Cody 抽查），網站正式版唔會顯示，預覽版會標「待核實」
import csv, json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1]); SITE = Path(sys.argv[2])
BASE = "https://www.vhis.gov.hk"
TODAY = "2026-11-05"
tiers = json.load(open(S / "tiers.json", encoding="utf-8"))
parsed = json.load(open(S / "parsed.json", encoding="utf-8"))
ward = json.load(open(S / "ward2.json", encoding="utf-8"))
flexi = {p["plan-info-certified"][0]["certification-no"][:6]: p for p in json.load(open(S / "vhis-dl/flexi-plans.json", encoding="utf-8-sig"))["certified-plans"]}
AREA_EN = {"亞洲": "Asia", "亞洲及澳紐": "Asia & Australia/NZ", "全球": "Worldwide", "全球(美國除外)": "Worldwide excl. US",
           "全球（美國除外）": "Worldwide excl. US", "全球不包括美國": "Worldwide excl. US", "香港及澳門": "Hong Kong & Macau", "大中華": "Greater China"}
prem_dir = SITE / "data/compare/medical/premiums"
for old in prem_dir.glob("vhis-*.csv"):
    old.unlink()


def money_or(v):
    return v if isinstance(v, int) else None


def pick_annual(w):
    vals = [v for v in (w.get("annual") or []) if v and v >= 400000]
    vals = sorted(set(vals))
    if w.get("annualNone") and not vals:
        return "none"
    if vals == [420000]:                           # 只搵到標準計劃部分嘅 $420,000，唔係成個計劃嘅限額 → 見條款
        return None
    if len(vals) == 1:
        return vals[0]
    if len(vals) == 2 and 420000 in vals:          # 420,000 係標準計劃部分
        return max(vals)
    return None                                     # 唔肯定 → 見條款


plans, skipped = [], []
for key, t in tiers.items():
    cert, tier = t["cert"], t["tier"]
    w = ward[key]
    variants = []
    for lv in t["levels"]:
        fn = lv["premiumPdf"].rsplit("/", 1)[-1]
        pr = parsed.get(fn)
        if not pr or not pr["ok"]:
            skipped.append(f"{key} / {lv['name']['zh-hk']}")
            continue
        vid = re.sub(r"[^A-Za-z0-9]+", "-", lv["certNo"]).strip("-").lower()
        csv_name = f"vhis-{vid}.csv"
        with open(prem_dir / csv_name, "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(["entryFrom", "entryTo", "age", "male_ns", "male_s", "female_ns", "female_s"])
            for b in pr["bands"]:
                lo, hi = (b["newApp"] or [0, 100])
                for age, row in sorted(b["table"].items(), key=lambda x: int(x[0])):
                    wr.writerow([lo, hi, age, row.get("male_ns"), row.get("male_s"), row.get("female_ns"), row.get("female_s")])
        area = lv["area"] or ""
        ded = lv["deductible"] or 0
        lab_zh = f"${ded:,} 自付費"
        lab_en = f"${ded:,} deductible"
        tables = [r for b in pr["bands"] for r in b["table"].values()]
        unisex = all(r.get("male_ns") == r.get("female_ns") for r in tables)
        smoker = any(r.get("male_ns") != r.get("male_s") for r in tables)
        variants.append({"id": vid, "label": {"zh": lab_zh, "en": lab_en}, "deductible": ded,
                         "area": {"zh": area, "en": AREA_EN.get(area, area)} if area else None,
                         "premiumFile": f"premiums/{csv_name}", "sourceUrl": BASE + lv["premiumPdf"],
                         "ageBasis": pr["basis"], "monthlyOnly": pr.get("monthlyOnly", False),
                         "unisex": unisex, "smokerRated": smoker, "certNo": lv["certNo"]})
    if not variants:
        continue
    p = flexi[cert]
    variants.sort(key=lambda v: ((v["area"] or {}).get("en", ""), v["deductible"]))
    name_zh = p["plan-name"]["zh-hk"] + (f"・{tier}" if tier else "")
    name_en = p["plan-name"]["en"] + (f" · {tier}" if tier else "")
    room = w.get("room")
    plans.append({
        "id": f"vhis-{cert.lower()}-{len(plans)}", "insurer": {"zh": p["company-name"]["zh-hk"], "en": p["company-name"]["en"]},
        "plan": {"zh": name_zh, "en": name_en}, "vhis": True, "certNo": cert,
        "ward": w["ward"] or "any", "wardBasis": w["why"],
        "roomLimit": {"zh": (room or "見條款").replace("全數", "全數賠償").replace("賠償賠償", "賠償"),
                      "en": "Paid in full" if room and "全數" in room else (re.sub(r"每日\s?\$?\s?", "$", room) + " a day" if room else "See terms")},
        "annualLimit": pick_annual(w), "lifetimeLimit": ("none" if w.get("life") == "無" else money_or(w.get("life"))),
        "features": {"zh": [], "en": []},
        "variants": variants,
        "planDocUrl": {"zh": BASE + t["planDoc"]["zh-hk"], "en": BASE + t["planDoc"]["en"]},
        "source": {"zh": "醫務衞生局自願醫保網站：官方標準保費表及條款", "en": "VHIS website: official standard premium tables and terms"},
        "sourceUrl": "https://www.vhis.gov.hk/tc/consumer_corner/flexi-plan.html",
        "updatedOn": TODAY, "verified": False,
    })
out = {"_說明": "由醫保網站官方保費 PDF 及條款自動抽取（scripts 喺 scratchpad）。verified: false = 待 Cody 抽查；正式網站唔顯示。ward: any = 條款冇指定受保病房（見 roomLimit）。",
       "plans": plans}
(SITE / "data/compare/medical/plans.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
import collections
print("plans", len(plans), "variants", sum(len(p["variants"]) for p in plans), "skipped levels", len(skipped))
print(collections.Counter(p["ward"] for p in plans))
print("annual unknown", sum(1 for p in plans if p["annualLimit"] is None), "lifetime unknown", sum(1 for p in plans if p["lifetimeLimit"] is None))
