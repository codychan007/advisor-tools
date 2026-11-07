"""Download AIA's public medical premium tables and turn them into data/aia-medical-premiums.json.

Usage:  python scripts/build_premiums.py            (download fresh PDFs, parse, check, write JSON)
        python scripts/build_premiums.py --offline  (re-parse the PDFs already in data/pdf_cache/)

Lives in the advisor-tools repo (moved from the medical-saving skill 2026-11-08). The half-yearly cloud
routine runs it, then scripts/validate_data.py. If any check fails the live JSON is NOT overwritten;
the result goes to data/pdf_cache/candidate.json instead.
New AIA medical plan with a public premium table = add it to PLANS + write a parse_<key>() + PARSERS.
Set "riderAvailable": False for plans with no 附加契約 version (iPGS has none for 標準計劃).

Only AIA's own website is used (www.aia.com.hk, robots.txt allows /content/dam/...).
Each table = one sex/ward/deductible/area combination, basic plan (基本計劃) or rider (附加契約),
annual premium per age 0-100 in HKD and (where AIA prints it) USD.
"""
import argparse
import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path

from pypdf import PdfReader

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pdf_cache"
OUT = ROOT / "data" / "aia-medical-premiums.json"
AIA = "https://www.aia.com.hk"

PLANS = {
    "standard": {
        "name": "AIA自願醫保標準計劃",
        "riderCode": "AVS",
        "riderAvailable": False,
        "category": "basic",
        "page": AIA + "/zh-hk/products/health/vhis-standard",
        "brochure": AIA + "/content/dam/hk/zh-hk/pdf/product-brochure/individuals/vhis-standard/AIAVoluntaryHealthInsuranceStandardScheme_tc.pdf",
        "premiumPdf": AIA + "/content/dam/hk/zh-hk/pdf/product-brochure/individuals/vhis-standard/AVS(0321)_premium_insert_TC_final.pdf",
    },
    "flexi": {
        "name": "AIA自願醫保靈活計劃",
        "riderCode": "AVFR",
        "category": "basic",
        "page": AIA + "/zh-hk/products/health/vhis-flexi",
        "brochure": AIA + "/content/dam/hk/zh-hk/pdf/product-brochure/individuals/vhis-flexi/AIAVoluntaryHealthInsuranceFlexiScheme_tc.pdf",
        "premiumPdf": AIA + "/content/dam/hk/zh-hk/pdf/product-brochure/individuals/vhis-flexi/avf-premium-insert-tc.pdf",
    },
    "selectwise": {
        "name": "AIA自願醫保睿選計劃",
        "riderCode": "AVSW",
        "category": "high_end",
        "page": AIA + "/zh-hk/products/health/vhis-select-wise",
        "brochure": AIA + "/content/dam/hk-wise/pdf/products/individuals/zh-hk/selectwise/vhis-selectwise_tc.pdf",
        "premiumPdf": AIA + "/content/dam/hk-wise/pdf/products/individuals/zh-hk/selectwise/vhis-selectwise-premium-table-tc.pdf",
    },
    "privilege_ultra": {
        "name": "AIA自願醫保尊耀計劃",
        "riderCode": "AVPU",
        "category": "high_end",
        "page": AIA + "/zh-hk/products/health/vhis-privilege-ultra",
        "brochure": AIA + "/content/dam/hk-wise/pdf/products/individuals/zh-hk/newmedical/newVHISmedical-tc.pdf",
        "premiumPdf": AIA + "/content/dam/hk-wise/pdf/products/individuals/zh-hk/newmedical/newVHISmedicalpremiumtable-tc.pdf",
    },
}

# AIA medical plans on sale (2026-11-07) whose premium tables are NOT public (only via the adviser).
NO_PUBLIC_TABLE = [
    {"name": "「至尊醫療計劃5」/「至尊醫療計劃(環球)5」", "page": AIA + "/zh-hk/products/health/ceo-medical-plan-5-series"},
    {"name": "極臻 • 至尊醫療計劃", "page": AIA + "/zh-hk/products/health/optimaceo-medical-plan"},
    {"name": "特級「健康之寶」醫療保障計劃2", "page": AIA + "/zh-hk/products/health/super-good-health-medical-plan-2"},
    {"name": "「全程守護健康保」", "page": AIA + "/zh-hk/products/health/health-journey-guardian"},
]

NUM = r"[\d,]+(?:\.\d+)?"
AGE = r"\d+(?:-\d+)?\+?\*?"


def fetch(url, dest):
    req = urllib.request.Request(url.replace("(", "%28").replace(")", "%29"),
                                 headers={"User-Agent": "Mozilla/5.0 (advisor-tools premium update)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if not data.startswith(b"%PDF"):
        raise SystemExit(f"唔係 PDF：{url}")
    dest.write_bytes(data)


def ages_of(token):
    t = token.rstrip("*")
    if t.endswith("+"):
        a = int(t[:-1])
        return list(range(a, 101))
    if "-" in t:
        a, b = map(int, t.split("-"))
        return list(range(a, b + 1))
    return [int(t)]


def to_num(s):
    return float(s.replace(",", ""))


def rows_inline(text, usd=True):
    """Rows like '35 5,621.60 709.80 2,867.04 ...' -> {age: (hkd, usd)}"""
    out = {}
    text = re.sub(r"(?m)^(\s*\d+)\s+-\s+(\d+)", r"\1-\2", text)  # "0 - 4" -> "0-4"
    pat = re.compile(rf"^\s*({AGE})\s+({NUM})\s+({NUM})", re.M)
    for m in pat.finditer(text):
        age_tok, a, b = m.groups()
        try:
            ages = ages_of(age_tok)
        except ValueError:
            continue
        if not ages or ages[0] > 100 or ages[0] >= 1900:
            continue
        hkd = to_num(a)
        u = to_num(b) if usd else None
        for g in ages:
            out[g] = (hkd, u)
    return out


def rows_split(text):
    """尊耀 PDF: age labels come as one block, numbers rows as another block (same order)."""
    lines = [l.strip() for l in text.split("\n")]
    ages = [l for l in lines if re.fullmatch(AGE, l)]
    rows = [l for l in lines if re.fullmatch(rf"{NUM}(\s+{NUM}){{7}}", l)]
    out = {}
    if len(ages) != len(rows):
        raise ValueError(f"歲數 {len(ages)} 行，數字 {len(rows)} 行，對唔上")
    for a, r in zip(ages, rows):
        n = r.split()
        for g in ages_of(a):
            out[g] = (to_num(n[0]), to_num(n[1]))
    return out


def effective(text):
    m = re.search(r"(\d{4})\s*年\s*(\d+)\s*月\s*(\d+)\s*日", text)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def parse_standard(reader):
    tables = []
    for i in range(0, len(reader.pages), 2):
        t1, t2 = reader.pages[i].extract_text(), reader.pages[i + 1].extract_text()
        both = t1 + "\n" + t2
        # heading text may sit anywhere on the first page of each pair
        h = re.search(r"(基本計劃|附加契約)標準保費表\s*\n?\s*(男性|女性)", t1)
        kind = "basic" if h.group(1) == "基本計劃" else "rider"
        sex = "M" if h.group(2) == "男性" else "F"
        rows = rows_inline(both, usd=False)
        tables.append({"type": kind, "sex": sex, "ward": "普通房", "deductible": None, "area": None,
                       "rows": rows, "effective": effective(both)})
    return tables


def parse_flexi(reader):
    tables = []
    for i in range(0, len(reader.pages), 2):
        t1, t2 = reader.pages[i].extract_text(), reader.pages[i + 1].extract_text()
        both = t1 + "\n" + t2
        kind = "basic" if "基本計劃標準保費表" in t1 else "rider"
        m = re.search(r"(男性|女性)\s*\((普通房|半私家房|標準私家房)\)", t1)
        tables.append({"type": kind, "sex": "M" if m.group(1) == "男性" else "F", "ward": m.group(2),
                       "deductible": None, "area": None, "rows": rows_inline(both), "effective": effective(both)})
    return tables


def parse_selectwise(reader):
    tables = []
    for i in range(0, len(reader.pages), 2):
        t1, t2 = reader.pages[i].extract_text(), reader.pages[i + 1].extract_text()
        both = t1 + "\n" + t2
        kind = "basic" if "基本計劃標準保費表" in t1 else "rider"
        m = re.search(r"([\d,]+)港元 / ([\d,]+)美元自付費", t1)
        tables.append({"type": kind, "sex": None, "ward": None,
                       "deductible": {"HKD": int(to_num(m.group(1))), "USD": int(to_num(m.group(2)))},
                       "area": None, "rows": rows_inline(both), "effective": effective(both)})
    return tables


def parse_privilege_ultra(reader):
    # This PDF's Chinese font has no Unicode map; digits survive. Page order checked by eye
    # (2026-11-07): pages 1-16 基本計劃, 17-32 附加契約; each table = 2 pages; areas alternate
    # 亞洲 / 全球(美國除外); deductibles 0 / 16,000 / 25,000 / 50,000 港元.
    tables = []
    for i in range(0, len(reader.pages), 2):
        t1, t2 = reader.pages[i].extract_text(), reader.pages[i + 1].extract_text()
        m = re.search(r"([\d,]+)\S*?([\d,]+)\S*Ι˹൬", t1) or re.search(r"\n([\d,]+)ಥʩ㕟([\d,]+)ߕʩ", t1)
        hkd, usd = int(to_num(m.group(1))), int(to_num(m.group(2)))
        area_line = next(l for l in t1.split("\n") if "ήਹ" in l)
        area = "亞洲" if area_line.endswith("ԭݲ") else "全球（美國除外）"
        kind = "basic" if i < 16 else "rider"
        rows = rows_split(t1)
        rows.update(rows_split(t2))
        eff = re.search(r"(\d{4})ϋ(\d+)˜(\d+)˚", t1)
        tables.append({"type": kind, "sex": None, "ward": None, "deductible": {"HKD": hkd, "USD": usd},
                       "area": area, "rows": rows,
                       "effective": f"{eff.group(1)}-{int(eff.group(2)):02d}-{int(eff.group(3)):02d}" if eff else None})
    return tables


PARSERS = {"standard": parse_standard, "flexi": parse_flexi,
           "selectwise": parse_selectwise, "privilege_ultra": parse_privilege_ultra}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    out = {"generatedOn": dt.date.today().isoformat(), "source": "www.aia.com.hk 公開保費表",
           "notes": ["年繳保費，未計保費徵費",
                     "表上「加入 AIA Vitality 即享首年保費9折」只係首年優惠，呢度唔計",
                     "標準計劃保費表只有港元"],
           "noPublicTable": NO_PUBLIC_TABLE, "plans": {}}
    problems = []
    for key, meta in PLANS.items():
        pdf = CACHE / f"{key}.pdf"
        if not args.offline or not pdf.exists():
            fetch(meta["premiumPdf"], pdf)
        tables = PARSERS[key](PdfReader(str(pdf)))
        clean = []
        for t in tables:
            rows = t.pop("rows")
            missing = [a for a in range(0, 100) if a not in rows]
            label = f"{meta['name']} {t['type']} {t['sex'] or ''} {t['ward'] or ''} {t['deductible'] or ''} {t['area'] or ''}"
            if missing:
                problems.append(f"{label}: 欠歲數 {missing[:10]}{'…' if len(missing) > 10 else ''}")
            # premiums must not drop sharply between consecutive adult ages (catches mis-parsed rows)
            for a in range(19, 99):
                if a in rows and a + 1 in rows and rows[a + 1][0] < rows[a][0] * 0.8:
                    problems.append(f"{label}: {a}→{a + 1} 歲保費跌咗超過兩成，要人手核對")
            t["annual"] = {str(a): {"HKD": rows[a][0], "USD": rows[a][1]} for a in sorted(rows)}
            clean.append(t)
        effs = sorted({t["effective"] for t in clean if t["effective"]})
        out["plans"][key] = {**meta, "effective": effs[-1] if effs else None, "tables": clean,
                             "wards": sorted({t["ward"] for t in clean if t["ward"]}),
                             "deductibles": sorted({json.dumps(t["deductible"], ensure_ascii=False) for t in clean if t["deductible"]}),
                             "areas": sorted({t["area"] for t in clean if t["area"]}),
                             "sexSpecific": any(t["sex"] for t in clean)}
        out["plans"][key]["deductibles"] = sorted((json.loads(d) for d in out["plans"][key]["deductibles"]),
                                                  key=lambda x: x["HKD"])
        print(f"{meta['name']}: {len(clean)} 張表，生效日 {out['plans'][key]['effective']}")

    for key in out["plans"]:
        out["plans"][key].setdefault("riderAvailable", True)
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if problems:
        cand = CACHE / "candidate.json"
        cand.write_text(text, encoding="utf-8")
        print("\n❌ 檢查唔過，冇覆蓋", OUT.name, "；結果放咗喺", cand)
        for p in problems:
            print(" -", p)
        sys.exit(1)
    OUT.write_text(text, encoding="utf-8")
    print("寫咗", OUT)
    if problems:
        print("\n要留意：")
        for p in problems:
            print(" -", p)
        sys.exit(1)
    print("檢查：全部表都有 0–99 歲，冇異常跌價。")


if __name__ == "__main__":
    main()
