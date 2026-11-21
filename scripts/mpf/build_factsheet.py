"""強積金工具：AIA「基金表現回顧」每月 PDF（fact sheet）→ data/mpf/factsheets/aia-YYYY-MM.json

Usage:  python scripts/mpf/build_factsheet.py              (look for new issues from the last 6 months, parse all cached)
        python scripts/mpf/build_factsheet.py --back 24    (also try older issues, for history)
        python scripts/mpf/build_factsheet.py --offline

Source (public): https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-and-guides/employer/forms/
                 aia-mpf-prime-value-choice-fund-performance-review-<mon>-<yyyy>.pdf   (about 2-3 months late)
One page per fund: fund facts, asset allocation (percent block, then labels in the same order), top ten holdings
(AIA only refreshes them in Jan/Mar/May/Jul/Sep/Nov issues), fund manager's report (Chinese + English).
No AI: the page shows month-on-month differences computed in the browser from two of these files.
Each fund is checked (allocation adds up to ~100 %, labels = percentages, top ten has 10 rows); failures are
kept with "problems" so the page can show "⚠ 讀取有問題" for that fund only.
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from pypdf import PdfReader

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from build_prices import Market, norm  # noqa: E402

OUT = ROOT / "data" / "mpf" / "factsheets"
CACHE = ROOT / "data" / "pdf_cache" / "mpf" / "factsheet"
URL = ("https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-and-guides/employer/forms/"
       "aia-mpf-prime-value-choice-fund-performance-review-{mon}-{y}.pdf")
SCHEME_EN = "AIA MPF - Prime Value Choice"
PCT = r"-?\d+(?:\.\d+)?%"


def fetch(y, m):
    mon = dt.date(y, m, 1).strftime("%b").lower()
    f = CACHE / f"{mon}-{y}.pdf"
    if f.exists():
        return f
    try:
        req = urllib.request.Request(URL.format(mon=mon, y=y), headers={"User-Agent": "Mozilla/5.0 (advisor-tools mpf data)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
        if b[:4] != b"%PDF":
            return None
        f.write_bytes(b)
        time.sleep(1)
        return f
    except Exception:
        return None


def between(t, a, b_list):
    i = t.find(a)
    if i < 0:
        return ""
    i += len(a)
    ends = [t.find(b, i) for b in b_list]
    ends = [e for e in ends if e >= 0]
    return t[i:min(ends)] if ends else t[i:]


def parse_page(t):
    t = re.sub(r"[\x00-\x08\x0b-\x1f]", "", t)
    lines = [l.strip() for l in t.splitlines() if l.strip()]
    if "資產分布 | ASSET ALLOCATION" not in t or "基金資料 | FUND FACTS" not in t:
        return None
    # name: the two lines before 投資目標
    k = next((i for i, l in enumerate(lines) if l.startswith("投資目標")), None)
    if k is None or k < 2:
        return None
    zh, en = lines[k - 2], lines[k - 1]
    f = {"name": zh, "nameEn": en, "problems": []}
    facts = re.findall(r"：\s*([^\n]+)", t)
    def fact(pat):
        for v in facts:
            m = re.search(pat, v.strip())
            if m:
                return m.group(1)
    f["nav"] = fact(r"HK\$([\d,.]+)港元")
    f["fer"] = fact(r"^([\d.]+)%$")
    pcts = re.findall(r"(?m)^(" + PCT + r")\s*$", between(t, "Fund Descriptor", ["資產分布 | ASSET ALLOCATION"]))
    if len(pcts) >= 2:   # first two "：x%" facts are FER and risk indicator; the rest is the allocation block
        pass
    labels = [l for l in between(t, "資產分布 | ASSET ALLOCATION", ["基金經理報告", "十大投資項目"]).splitlines() if l.strip()]
    # descriptor lines may also end in % (e.g. "最大股票投資為 65%"): allocation numbers are the bare "x.xx%" lines
    alloc_pcts = [float(p[:-1]) for p in pcts][-len(labels):] if labels else []
    if labels and len(alloc_pcts) == len(labels):
        f["alloc"] = [[l.strip(), p] for l, p in zip(labels, alloc_pcts)]
        tot = sum(alloc_pcts)
        if abs(tot - 100) > 1.5:
            f["problems"].append(f"資產分布加埋 {tot:.1f}%")
    else:
        f["alloc"] = []
        f["problems"].append(f"資產分布 {len(labels)} 項名、{len(alloc_pcts)} 個 %")
    top = between(t, "十大投資項目", ["佔資產淨值百分比", "% of NAV"])
    m = re.search(r"截至(\d{4})年(\d{1,2})月(\d{1,2})日", top)
    f["topAsof"] = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None
    items = []
    for l in top.splitlines()[1:]:
        mm = re.match(r"(.+?)\s*(" + PCT + r")\s*$", l.strip())
        if mm:
            items.append([mm.group(1).strip(), float(mm.group(2)[:-1])])
    f["top10"] = items
    if items and len(items) != 10:
        f["problems"].append(f"十大只讀到 {len(items)} 項")
    # manager's report: Chinese paragraph starts with 本基金, English with "The fund"
    rep = t[t.find("基金經理報告"):] if "基金經理報告" in t else t
    stop = ["資料來源 Source", "十大投資項目", "佔資產淨值百分比", "基金表現 | FUND PERFORMANCE"]
    zi = rep.find("本基金")
    ei = rep.find("The fund", zi if zi >= 0 else 0)
    def cut(s):
        ends = [s.find(x) for x in stop]
        ends = [e for e in ends if e > 0]
        return s[:min(ends)] if ends else s
    f["reportZh"] = re.sub(r"\s*\n\s*", "", cut(rep[zi:ei])).strip() if zi >= 0 and ei > zi else ""
    f["reportEn"] = re.sub(r"\s*\n\s*", " ", cut(rep[ei:])).strip() if ei >= 0 else ""
    if not f["reportZh"]:
        f["problems"].append("搵唔到經理報告")
    return f


def parse_pdf(path, mk):
    r = PdfReader(str(path))
    funds, unmatched = {}, []
    for p in r.pages:
        t = p.extract_text() or ""
        f = parse_page(t)
        if not f:
            continue
        cf = mk.match(SCHEME_EN, f["nameEn"])
        if not cf:
            unmatched.append(f["nameEn"])
            continue
        funds[cf] = f
    asof = None
    m = re.search(r"截至(\d{4})年(\d{1,2})月(\d{1,2})日\s*As at", "".join((p.extract_text() or "") for p in r.pages[5:9]))
    if m:
        asof = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return asof, funds, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--back", type=int, default=6)
    ap.add_argument("--offline", action="store_true")
    a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    mk = Market()
    if not a.offline:
        today = dt.date.today()
        y, m = today.year, today.month
        for _ in range(a.back):
            m -= 1
            if m == 0:
                y, m = y - 1, 12
            fetch(y, m)
    index, problems = [], []
    for pdf in sorted(CACHE.glob("*.pdf")):
        mon, y = pdf.stem.split("-")
        key = f"{y}-{dt.datetime.strptime(mon, '%b').month:02d}"
        try:
            asof, funds, un = parse_pdf(pdf, mk)
        except Exception as e:
            problems.append(f"{pdf.name}: {e}")
            continue
        if len(funds) < 15:
            problems.append(f"{pdf.name}: 只讀到 {len(funds)} 隻基金")
            continue
        for cf, f in funds.items():
            for p in f["problems"]:
                problems.append(f"{key} {f['name']}：{p}")
        (OUT / f"aia-{key}.json").write_text(json.dumps({"month": key, "asof": asof, "source": URL.format(mon=mon, y=y),
                                                           "funds": funds, "unmatched": un}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # index = every issue already saved (GitHub Actions only has the last few PDFs; older issues stay as JSON)
    index = []
    for jf in sorted(OUT.glob("aia-*.json")):
        j = json.loads(jf.read_text(encoding="utf-8"))
        index.append({"month": j["month"], "asof": j.get("asof"), "funds": len(j["funds"])})
    (OUT / "index.json").write_text(json.dumps({"issues": index, "problems": problems}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(index)} 期：{', '.join(i['month'] for i in index)}；問題 {len(problems)}")
    for p in problems[:40]:
        print(" -", p)
    return 0 if index else 1


if __name__ == "__main__":
    sys.exit(main())
