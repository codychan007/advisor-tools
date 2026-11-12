"""One-off: fetch price + dividend history from BEFORE a fund was on AIA, so the site can show 3-5 years.

Usage:  python scripts/backfill_funds.py Z17 Z37 ...      (codes; default = every fund in SOURCES)
Writes data/backfill/<code>.json:
  {"code", "isin", "source", "url", "fetched", "prices": [["NAV date", nav], ...], "dividends": [["ex-date", amount, null, null], ...]}
scripts/build_funds.py then puts these in front of AIA's own data (NAV dates moved one business day later, like AIA's
prices), checks the overlap with AIA's prices, and checks every year against AIA's published yearly returns
(which already include the years before the fund came to AIA). Data that does not match is not used.

Sources (Cody 2026-11-13: fund house first, FT only for prices when the fund house has none):
  blackrock : BlackRock product page (daily NAV + every distribution are embedded in the page)
  allianz   : Allianz GI Hong Kong fund-page APIs (Historical NAV + Dividends tabs)
  ft        : markets.ft.com historical prices (NAV only, 2 decimals)
  manual    : dividends typed from the fund house's own page / PDF (see MANUAL below, source noted per fund)
Only public pages are used.
"""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "backfill"
UA = {"User-Agent": "Mozilla/5.0 (advisor-tools fund history)"}

# code: (source, id)    id = BlackRock product id / FT symbol id ("xid")
SOURCES = {
    "Z17": ("blackrock", "270404"),
    "Z37": ("blackrock", "271612"),
    "Z07": ("allianz", "allianz-income-and-growth-am-usd"),
    "Z08": ("allianz", "allianz-dynamic-asian-high-yield-bond-amg-usd"),
    "Z27": ("allianz", "allianz-income-and-growth-am-cny-h2-cnh-cny"),
    # prices only (dividends already in AIA's own PDF, or accumulation funds) - FT symbol ids
    "ZP4": ("ft", "601227992"), "Z23": ("ft", "535661272"), "Z32": ("ft", "572024858"),
    "PC4": ("ft", "58460171"), "M13": ("ft", "6178977"), "W06": ("ft", "540312261"), "W07": ("ft", "538765309"),
    "I17": ("ft", "9254745"), "CG9": ("ft", "535693982"), "D18": ("ft", "535630791"), "M15": ("ft", "6178973"),
    "U06": ("ft", "92774525"), "X15": ("ft", "121434802"), "M23": ("ft", "988155295"), "P29": ("ft", "627178786"),
}


def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception:
            if i == 2:
                raise
            time.sleep(3)


def ymd(n):
    n = int(n)
    return f"{n // 10000:04d}-{n // 100 % 100:02d}-{n % 100:02d}"


def blackrock(pid):
    url = f"https://www.blackrock.com/lu/individual/products/{pid}"
    t = html.unescape(get(url))
    dec = json.JSONDecoder()
    prices, divs = [], []
    for m in re.finditer(r'"dataPointsByNameMap":', t):
        try:
            obj, _ = dec.raw_decode(t[m.end():])
        except ValueError:
            continue
        if "navData" in obj and not prices:
            nd = obj["navData"]
            prices = [[ymd(d), float(v)] for d, v in zip(nd["asOfDate"], nd["value"]) if v is not None]
        if "exDate" in obj and "totalDistribution" in obj and not divs:
            divs = [[ymd(d), float(a), None, None] for d, a in zip(obj["exDate"]["value"], obj["totalDistribution"]["value"]) if a not in (None, "")]
    return url, sorted(prices), sorted(divs)


def allianz(seo):
    """Allianz GI Hong Kong fund-page APIs (same data the site's Historical NAV / Dividends tabs show)."""
    base = "https://hk.allianzgi.com/en-HK/api/funddata"
    url = f"https://hk.allianzgi.com/en-hk/retail/products-solutions/retail-funds/{seo}"
    dmy = lambda s: dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    p = json.loads(get(f"{base}/prices/{seo}/hk_retail_financial_advisor/361c3268-a408-4d56-b9a0-456f554316b7"))
    d = json.loads(get(f"{base}/dividends/{seo}/hk_retail_financial_advisor/f6d611e8-7d34-4ec4-aad3-0104d6452faa"))
    prices = sorted([dmy(x["date"]), float(x["nav"])] for x in p)
    divs = sorted([dmy(x["ExDividendDate"]), float(x["DistReinvestPerUnit"].split()[-1]), None, None] for x in d)
    return url, prices, divs


def ft(xid, start="2016-01-01"):
    """FT historical prices, one year per request."""
    url = f"https://markets.ft.com/data/funds/tearsheet/historical?s={xid}"
    rows = {}
    y0, y1 = int(start[:4]), dt.date.today().year
    for y in range(y0, y1 + 1):
        j = json.loads(get(f"https://markets.ft.com/data/equities/ajax/get-historical-prices?startDate={y}%2F01%2F01&endDate={y}%2F12%2F31&symbol={xid}"))
        cells = re.findall(r"<td[^>]*>(.*?)</td>", j.get("html", ""))
        for i in range(0, len(cells) - 5, 6):
            day = re.search(r'medium-above">\w+, (\w+ \d+, \d{4})<', cells[i])
            if day:
                rows[dt.datetime.strptime(day.group(1), "%b %d, %Y").date().isoformat()] = float(cells[i + 4].replace(",", ""))
        time.sleep(0.5)
    return url, sorted([d, p] for d, p in rows.items()), []


def save_manual(code, source, url, compact, price_src):
    """Dividends read from a fund-house page (compact 'YYYYMMDD:amount ...'), prices from price_src ('ft:<xid>')."""
    divs = sorted([f"{d[:4]}-{d[4:6]}-{d[6:]}", float(a), None, None] for d, a in (x.split(":") for x in compact.split()))
    if price_src:
        kind, sid = price_src.split(":")
        _, prices, _ = {"ft": ft, "blackrock": blackrock, "allianz": allianz}[kind](sid)
    else:
        kind, prices = "-", []                        # dividends only: AIA already has the prices
    index = {f["code"]: f for f in json.loads((ROOT / "data/funds/index.json").read_text(encoding="utf-8"))["funds"]}
    data = {"code": code, "isin": index[code]["isin"], "source": source, "url": url, "priceSource": price_src,
            "fetched": dt.date.today().isoformat(), "prices": prices, "dividends": divs}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{code}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{code}: {source} dividends {len(divs)} ({divs[0][0]} ->), prices {kind} {len(prices)} ({prices[0][0] if prices else '-'} ->)")


def save_prices_divs(code, source, url, prices, compact_divs):
    """Prices already read (list of [date, nav]) + dividends 'YYYYMMDD:amount ...' from a fund-house page."""
    divs = sorted([f"{d[:4]}-{d[4:6]}-{d[6:]}", float(a), None, None] for d, a in (x.split(":") for x in compact_divs.split())) if compact_divs else []
    index = {f["code"]: f for f in json.loads((ROOT / "data/funds/index.json").read_text(encoding="utf-8"))["funds"]}
    data = {"code": code, "isin": index[code]["isin"], "source": source, "url": url, "priceSource": source,
            "fetched": dt.date.today().isoformat(), "prices": sorted(prices), "dividends": divs}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{code}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{code}: {source} prices {len(prices)} ({min(prices)[0] if prices else '-'} ->), dividends {len(divs)}")


def main():
    codes = sys.argv[1:] or list(SOURCES)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {f["code"]: f for f in json.loads((ROOT / "data/funds/index.json").read_text(encoding="utf-8"))["funds"]}
    for code in codes:
        src, sid = SOURCES[code]
        url, prices, divs = {"blackrock": blackrock, "allianz": allianz, "ft": ft}[src](sid)
        data = {"code": code, "isin": index[code]["isin"], "source": src, "url": url, "fetched": dt.date.today().isoformat(),
                "prices": prices, "dividends": divs}
        (OUT / f"{code}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{code}: {src} prices {len(prices)} ({prices[0][0] if prices else '-'} ->), dividends {len(divs)} ({divs[0][0] if divs else '-'} ->)")


if __name__ == "__main__":
    main()
