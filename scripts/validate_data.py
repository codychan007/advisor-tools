"""Check data/aia-medical-premiums.json before it goes live.

Usage:  python scripts/validate_data.py                 (compare with the version in git HEAD)
        python scripts/validate_data.py --base <file>   (compare with another JSON)

Hard checks (exit 1 if any fails):
  - every table has ages 0-99, positive HKD; USD either on every row or on none
  - HKD / USD between 7.0 and 9.0 where AIA prints USD (AIA uses 8.0; 7.75-8.05 outside = warning only)
  - higher deductible -> premium not higher (same plan / sex / ward / area / type)
  - ward order 普通房 <= 半私家房 <= 標準私家房 (same plan / sex / type)
  - rider table = 0.80-0.97 × basic table (ages 30, 60) when both exist
  - spot check: for ages 5, 35, 65, 85 of every table, the HKD figure appears in that plan's PDF text
    (data/pdf_cache/<key>.pdf); this catches mis-read columns, not a wrong row — the routine must also
    open the PDF and match a few rows by eye/regex (see ROUTINE.md)
Warnings (printed, exit 0): plans added / removed, effective date changed, median premium change > 25%.
"""
import argparse
import json
import statistics
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "aia-medical-premiums.json"
CACHE = ROOT / "data" / "pdf_cache"
WARD_ORDER = ["普通房", "半私家房", "標準私家房"]


def key_of(t, drop):
    d = {"type": t["type"], "sex": t["sex"], "ward": t["ward"], "area": t["area"],
         "ded": (t["deductible"] or {}).get("HKD")}
    d.pop(drop, None)
    return json.dumps(d, ensure_ascii=False, sort_keys=True)


def fmt_variants(v):
    out = {f"{v:,.2f}", f"{v:.2f}"}
    if float(v).is_integer():
        out |= {f"{v:,.0f}", f"{v:.0f}"}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    a = ap.parse_args()
    d = json.loads(DATA.read_text(encoding="utf-8"))
    errs, warns = [], []

    for k, p in d["plans"].items():
        for f in ("name", "category", "page", "premiumPdf", "tables", "wards", "deductibles", "areas", "sexSpecific", "riderAvailable"):
            if f not in p:
                errs.append(f"{k}: 冇 {f}")
        basic = [t for t in p["tables"] if t["type"] == "basic"]
        if not basic:
            errs.append(f"{k}: 冇基本計劃表")
        has_usd, bad_rate = None, set()
        for t in p["tables"]:
            lab = f"{k} {key_of(t, None)}"
            ages = [int(x) for x in t["annual"]]
            miss = [x for x in range(100) if x not in ages]
            if miss:
                errs.append(f"{lab}: 欠歲數 {miss[:8]}")
            for age, c in t["annual"].items():
                if not (c["HKD"] and c["HKD"] > 0):
                    errs.append(f"{lab} {age} 歲：港元保費唔啱 {c['HKD']}")
                usd = c["USD"] is not None
                if has_usd is None:
                    has_usd = usd
                elif has_usd != usd:
                    errs.append(f"{lab} {age} 歲：有啲歲數有美元有啲冇")
                if usd and c["HKD"] > 100 and lab not in bad_rate:
                    rate = c["HKD"] / c["USD"]
                    if not 7.0 <= rate <= 9.0:
                        bad_rate.add(lab)
                        errs.append(f"{lab} {age} 歲：港元÷美元 = {rate:.3f}，唔似匯率，可能讀錯欄")
                    elif not 7.75 <= rate <= 8.05:  # e.g. flexi M 標準私家房 21 歲: AIA's own PDF prints USD = age 20's
                        warns.append(f"{lab} {age} 歲：港元÷美元 = {rate:.3f}（同 PDF 一樣，似 AIA 自己打錯，照用美元欄）")
        # deductible order
        groups = {}
        for t in p["tables"]:
            if t["deductible"]:
                groups.setdefault(key_of(t, "ded"), []).append(t)
        for g in groups.values():
            g.sort(key=lambda t: t["deductible"]["HKD"])
            for lo, hi in zip(g, g[1:]):
                for age in ("5", "35", "65", "85"):
                    if hi["annual"][age]["HKD"] > lo["annual"][age]["HKD"] + 0.01:
                        errs.append(f"{k} {age} 歲：自付費 {hi['deductible']['HKD']} 反而貴過 {lo['deductible']['HKD']}")
        # ward order
        groups = {}
        for t in p["tables"]:
            if t["ward"] in WARD_ORDER and len(p["wards"]) > 1:
                groups.setdefault(key_of(t, "ward"), []).append(t)
        for g in groups.values():
            g.sort(key=lambda t: WARD_ORDER.index(t["ward"]))
            for lo, hi in zip(g, g[1:]):
                for age in ("5", "35", "65", "85"):
                    if hi["annual"][age]["HKD"] < lo["annual"][age]["HKD"] - 0.01:
                        errs.append(f"{k} {age} 歲：{hi['ward']} 平過 {lo['ward']}")
        # rider vs basic
        for t in p["tables"]:
            if t["type"] != "rider":
                continue
            twin = next((b for b in basic if key_of(b, "type") == key_of(t, "type")), None)
            if twin:
                for age in ("30", "60"):
                    r = t["annual"][age]["HKD"] / twin["annual"][age]["HKD"]
                    if not 0.80 <= r <= 0.97:
                        errs.append(f"{k} {age} 歲：附加契約 ÷ 基本計劃 = {r:.3f}，唔似 AIA 一貫約 0.89")
        # PDF spot check
        pdf = CACHE / f"{k}.pdf"
        if not pdf.exists():
            errs.append(f"{k}: data/pdf_cache/{k}.pdf 唔見咗，抽查唔到")
            continue
        text = "\n".join(pg.extract_text() or "" for pg in PdfReader(str(pdf)).pages)
        n_ok = n = 0
        for t in p["tables"]:
            for age in ("5", "35", "65", "85"):
                n += 1
                v = t["annual"][age]["HKD"]
                if any(x in text for x in fmt_variants(v)):
                    n_ok += 1
                else:
                    errs.append(f"{k} {key_of(t, None)} {age} 歲：港元 {v:,.2f} 喺 PDF 搵唔到")
        print(f"{p['name']}：抽查 {n_ok}/{n} 個數喺 PDF 搵到")

    # compare with previous version
    try:
        if a.base:
            old = json.loads(Path(a.base).read_text(encoding="utf-8"))
        else:
            raw = subprocess.run(["git", "show", "HEAD:data/aia-medical-premiums.json"], cwd=ROOT,
                                 capture_output=True, check=True).stdout.decode("utf-8")
            old = json.loads(raw)
    except Exception as e:  # first run / no git
        old = None
        warns.append(f"搵唔到舊版本比較（{e.__class__.__name__}）")
    if old:
        for k in d["plans"]:
            if k not in old["plans"]:
                warns.append(f"新增：{d['plans'][k]['name']}")
        for k in old["plans"]:
            if k not in d["plans"]:
                warns.append(f"移除：{old['plans'][k]['name']}")
        for k, p in d["plans"].items():
            o = old["plans"].get(k)
            if not o:
                continue
            if o.get("effective") != p.get("effective"):
                warns.append(f"{p['name']}：生效日 {o.get('effective')} → {p.get('effective')}")
            ch = []
            for t in p["tables"]:
                ot = next((x for x in o["tables"] if key_of(x, None) == key_of(t, None)), None)
                if ot:
                    for age in ("5", "35", "65", "85"):
                        ch.append(t["annual"][age]["HKD"] / ot["annual"][age]["HKD"] - 1)
            if ch:
                med = statistics.median(ch)
                if abs(med) > 0.0005:
                    warns.append(f"{p['name']}：保費中位數變動 {med:+.1%}")
                if abs(med) > 0.25:
                    warns.append(f"⚠️ {p['name']}：變動超過 25%，要再核對係咪讀錯")
        names_old = {x["name"] for x in old.get("noPublicTable", [])}
        names_new = {x["name"] for x in d.get("noPublicTable", [])}
        for n in names_new - names_old:
            warns.append(f"冇公開保費表清單新增：{n}")
        for n in names_old - names_new:
            warns.append(f"冇公開保費表清單移除：{n}")

    for w in warns:
        print("ℹ️ ", w)
    if errs:
        print(f"\n❌ {len(errs)} 個問題：")
        for e in errs[:60]:
            print(" -", e)
        sys.exit(1)
    print("✅ 資料檢查全部通過")


if __name__ == "__main__":
    main()
