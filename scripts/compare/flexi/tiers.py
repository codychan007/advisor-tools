# 將每個靈活計劃嘅港元選項分做「等級」（同一等級 = 同一病房／限額，只係自付費或地區唔同）
# 輸出 tiers.json；加 --download 就每級下載一份條款 PDF（每秒一個）
import json, re, sys, time, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1])
BASE = "https://www.vhis.gov.hk"
f = json.load(open(S / "vhis-dl/flexi-plans.json", encoding="utf-8-sig"))["certified-plans"]
live = [p for p in f if not p.get("de-reg") and not p.get("unavailable") and not p.get("renewal-only")]
AREA = re.compile(r"亞洲及澳紐|亞洲|全球\s*\(美國除外\)|全球（美國除外）|全球不包括美國|全球|香港及澳門|大中華")


def split_level(name_zh, name_en):
    ded = re.search(r"([\d,]+)\s*港元\s*自付費|自付費\s*([\d,]+)\s*港元|HK\$?\s?([\d,]+)\s*Deductible|HKD\s?([\d,]+)\s*Deductible", name_zh + " " + name_en, re.I)
    d = int(next(g for g in ded.groups() if g).replace(",", "")) if ded else (0 if re.search(r"自付費\s*無|Nil|No deductible", name_zh + name_en, re.I) else None)
    am = AREA.search(name_zh)
    area = am.group(0) if am else ""
    tier = name_zh
    tier = re.sub(r"[\d,]+\s*港元\s*自付費|自付費\s*[\d,]+\s*港元|自付費\s*無", "", tier)
    if area:
        tier = tier.replace(area, "")
    tier = re.sub(r"[()（）]", " ", tier)
    tier = re.sub(r"\s*[-–]\s*$|^\s*[-–]\s*", "", tier).strip(" -–")
    tier = re.sub(r"\s*港元\s*$", "", tier)
    tier = re.sub(r"\s{2,}", " ", tier).strip()
    return tier, d, area


tiers = {}
for p in live:
    for i in p["plan-info-certified"]:
        if i.get("currency") != "HKD" or i.get("renewal-only"):
            continue
        tier, ded, area = split_level(i["plan-level"]["zh-hk"], i["plan-level"]["en"])
        key = f'{i["certification-no"][:6]}|{tier}'
        t = tiers.setdefault(key, {"cert": i["certification-no"][:6], "company": p["company-name"], "plan": p["plan-name"],
                                   "tier": tier, "levels": [], "planDoc": i["plan-doc-url"]})
        t["levels"].append({"name": i["plan-level"], "deductible": ded, "area": area, "certNo": i["certification-no"],
                            "premiumPdf": i["premium-doc-url"]["zh-hk"], "planDoc": i["plan-doc-url"]})
import pypdf
for t in tiers.values():
    for l in t["levels"]:
        if l["deductible"] is None:   # 名冇寫：睇保費 PDF 第一頁標題
            fn = S / "flexi-pdf/premium" / l["premiumPdf"].rsplit("/", 1)[-1]
            head = (pypdf.PdfReader(str(fn)).pages[0].extract_text() or "")[:600]
            m = re.search(r"([\d,]+)\s*港元\s*自付費|自付費[：:\s]*([\d,]+)\s*港元|HKD\s?([\d,]+)\s*Deductible|HK\$\s?([\d,]+)\s*Deductible", head, re.I)
            if m:
                l["deductible"] = int(next(g for g in m.groups() if g).replace(",", ""))
                l["dedFrom"] = "premium-pdf"
            elif re.search(r"自付費|Deductible", head, re.I) is None:
                l["deductible"] = 0
                l["dedFrom"] = "none-mentioned"
(S / "tiers.json").write_text(json.dumps(tiers, ensure_ascii=False, indent=1), encoding="utf-8")
nod = [(k, l["name"]["zh-hk"]) for k, t in tiers.items() for l in t["levels"] if l["deductible"] is None]
print("tiers", len(tiers), "levels", sum(len(t["levels"]) for t in tiers.values()), "未讀到自付費:", len(nod), nod[:8])
if "--download" in sys.argv:
    out = S / "flexi-pdf/tierdoc"; out.mkdir(exist_ok=True)
    n = 0
    for t in tiers.values():
        url = t["planDoc"]["zh-hk"]
        dest = out / url.rsplit("/", 1)[-1]
        if dest.exists():
            continue
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(BASE + url, headers={"User-Agent": "HK-Life-Compass-data-check/1.0"}), timeout=120) as r:
                    data = r.read()
                dest.write_bytes(data)
                n += 1
                break
            except Exception as e:
                print("retry", attempt + 1, url, e)
                time.sleep(5 * (attempt + 1))
        time.sleep(1)
    print("downloaded", n)
