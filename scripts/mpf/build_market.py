"""強積金工具：全行基金資料（積金局「強積金基金平台」mfp.mpfa.org.hk）→ data/mpf/market.json

Usage:  python scripts/mpf/build_market.py            (download, parse, write)
        python scripts/mpf/build_market.py --offline  (re-parse what is in data/pdf_cache/mpf/)
        python scripts/mpf/build_market.py --no-detail (skip the 380-odd fund detail pages)

What it reads (all public, monthly; "最新資料截至 <month end>" appears around mid next month):
  - tch/mpp_list.jsp and eng/mpp_list.jsp : every constituent fund (scheme, trustee, MPFA category, launch,
    size, risk class, latest FER, annualised / cumulative / calendar-year returns, management-fee split)
  - tch/cf_detail.jsp?cf_id=N             : per fund: fund risk indicator, scheme-level fees, "持續成本列表"
Exit codes: 0 ok (or nothing new), 1 source broken (nothing written), 2 written with warnings.
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "mpf"
CACHE = ROOT / "data" / "pdf_cache" / "mpf"
BASE = "https://mfp.mpfa.org.hk/"
UA = {"User-Agent": "Mozilla/5.0 (advisor-tools mpf data)"}


def get(url, data=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(5 * (i + 1))


def num(s):
    s = (s or "").replace(",", "").replace("最高", "").replace("Up to", "").strip()
    if s in ("", "n.a.", "N/A", "-", "不適用"):
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def cells(row):
    out = []
    for attrs, body in re.findall(r"<td([^>]*)>(.*?)</td>", row, flags=re.S):
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body))).strip()
        cf = re.search(r'cfid="\s*(\d+)', body)
        sch = re.search(r"schId=(\w+)", body)
        title = re.search(r'title="([^"]*)"', body)
        out.append({"t": txt, "cf": cf.group(1) if cf else "", "sch": sch.group(1) if sch else "",
                    "title": html.unescape(title.group(1)) if title else ""})
    return out


def parse_list(page):
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    m = re.search(r"最新資料截至\s*(\d{4})年(\d{1,2})月(\d{1,2})日", page) or \
        re.search(r"as at\s+(\d{1,2})[-/ ](\w+)[-/ ](\d{4})", page, flags=re.I)
    asof = None
    if m and "年" in m.group(0):
        asof = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    flat = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))
    ym = re.search(r"(20\d\d) (20\d\d) (20\d\d) (20\d\d) (20\d\d)", flat)
    years = [int(y) for y in ym.groups()] if ym else []
    rows = re.findall(r'<tr class="wr"[^>]*>(.*?)</tr>', page, flags=re.S)
    funds = {}
    for r in rows:
        c = cells(r)
        if len(c) < 30 or not c[29]["cf"]:
            continue
        cf = c[29]["cf"]
        funds[cf] = {
            "id": cf, "scheme": c[1]["t"], "schId": c[2]["sch"], "fund": c[3]["t"],
            "trustee": c[4]["t"], "trusteeFull": c[4]["title"], "category": c[5]["t"],
            "launch": c[6]["t"], "sizeM": num(c[7]["t"]), "risk": num(c[8]["t"]), "fer": num(c[9]["t"]),
            "ann": [num(c[i]["t"]) for i in range(10, 14)],     # 1y 5y 10y since launch (% p.a.)
            "cum": [num(c[i]["t"]) for i in range(14, 18)],
            "cal": [num(c[i]["t"]) for i in range(18, 23)],     # years[0..4]
            "fee": {"mgmt": num(c[23]["t"]), "mgmtMax": "最高" in c[23]["t"] or "Up to" in c[23]["t"],
                    "trustee": num(c[24]["t"]), "empf": num(c[25]["t"]), "member": num(c[26]["t"]),
                    "invest": num(c[27]["t"]), "guarantee": num(c[28]["t"])},
        }
    return asof, years, funds


DETAIL_FIELDS = {
    "基金風險標記": "riskIndicator", "計劃參加費": "joiningFee", "年費": "annualFee", "供款費": "contributionFee",
    "買入差價": "bidSpread", "賣出差價": "offerSpread", "權益提取費": "withdrawalFee",
    "持續成本列表 – 一年": "cost1", "持續成本列表 – 三年": "cost3", "持續成本列表 – 五年": "cost5",
    "基金類別 － 詳細類型描述": "descriptor",
}


def parse_detail(page):
    page = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", "", page, flags=re.S)
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))
    out = {}
    keys = sorted(DETAIL_FIELDS, key=len, reverse=True)
    for k in keys:
        i = txt.find(k)
        if i < 0:
            continue
        rest = txt[i + len(k):i + len(k) + 160].strip()
        if DETAIL_FIELDS[k] == "descriptor":
            out["descriptor"] = re.split(r" 基金規模| 推出日期", rest)[0].strip()
        elif DETAIL_FIELDS[k].startswith("cost"):
            out[DETAIL_FIELDS[k]] = num(rest.split("持續")[0])
        else:
            m = re.match(r"(-?[\d,.]+%?(?: p\.a\.)?|不適用|n\.a\.)", rest)
            out[DETAIL_FIELDS[k]] = m.group(1) if m else rest.split(" ")[0]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--no-detail", action="store_true")
    ap.add_argument("--force", action="store_true", help="rebuild even if MPFA's 'as at' month has not changed")
    a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    pages = {}
    for lang in ("tch", "eng"):
        f = CACHE / f"list-{lang}.html"
        if not a.offline:
            f.write_text(get(BASE + lang + "/mpp_list.jsp"), encoding="utf-8")
        pages[lang] = f.read_text(encoding="utf-8")
    asof, years, funds = parse_list(pages["tch"])
    _, _, en = parse_list(pages["eng"])
    if not asof or len(funds) < 300:
        print(f"積金局頁面讀唔到（截至={asof}，基金={len(funds)}）", file=sys.stderr)
        return 1
    for cf, f in funds.items():
        e = en.get(cf)
        if e:
            f["schemeEn"], f["fundEn"], f["trusteeEn"], f["categoryEn"] = e["scheme"], e["fund"], e["trusteeFull"] or e["trustee"], e["category"]

    old = {}
    mf = OUT / "market.json"
    if mf.exists():
        old = json.loads(mf.read_text(encoding="utf-8"))
    oldfunds = {f["id"]: f for f in old.get("funds", [])}
    same_month = old.get("asof") == asof
    if same_month and not a.force and not a.offline:
        print(f"積金局仍然係截至 {asof}，冇新數據")
        return 0

    warnings = []
    if not a.no_detail:
        for n, cf in enumerate(sorted(funds, key=int)):
            df = CACHE / "detail" / f"{cf}.html"
            df.parent.mkdir(exist_ok=True)
            if not a.offline and not (same_month and df.exists()):
                try:
                    df.write_text(get(BASE + f"tch/cf_detail.jsp?cf_id={cf}"), encoding="utf-8")
                    time.sleep(0.3)
                except Exception as e:
                    warnings.append(f"{cf} 詳細頁: {e}")
            if df.exists():
                funds[cf]["detail"] = parse_detail(df.read_text(encoding="utf-8"))
            elif cf in oldfunds and "detail" in oldfunds[cf]:
                funds[cf]["detail"] = oldfunds[cf]["detail"]
            if n % 50 == 0:
                print(f"詳細頁 {n}/{len(funds)}")

    out = {
        "source": "積金局強積金基金平台 mfp.mpfa.org.hk",
        "asof": asof, "calYears": years,
        "trustees": sorted({f["trustee"] for f in funds.values()}),
        "schemes": sorted({(f["schId"], f["scheme"], f["trustee"]) for f in funds.values()}),
        "funds": sorted(funds.values(), key=lambda f: (f["trustee"], f["scheme"], f["fund"])),
        "warnings": warnings,
    }
    out["schemes"] = [{"id": s, "name": n, "trustee": t, "count": sum(1 for f in funds.values() if f["schId"] == s)}
                      for s, n, t in out["schemes"]]
    mf.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"截至 {asof}：{len(funds)} 隻基金、{len(out['schemes'])} 個計劃、{len(out['trustees'])} 個受託人；警告 {len(warnings)}")
    return 2 if warnings else 0


if __name__ == "__main__":
    sys.exit(main())
