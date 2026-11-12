"""Build the data for 基金分析 (/fund-analysis/) from AIA Hong Kong's public website.

Usage:  python scripts/build_funds.py             (download fresh data, parse, check, write data/funds/)
        python scripts/build_funds.py --offline   (re-use what is already in data/pdf_cache/funds/)

Plan: 「卓達智悅 2」 (TMP2) only: all investment options (dividend-paying ones also get their dividend history).
Sources (all public, www.aia.com.hk / www1.aia.com.hk):
  - fund list + AIA's calendar-year returns (dividends reinvested): CorpWS/Investment/Get/FundInfo2
  - daily prices since launch on AIA:                               CorpWS/Investment/Get/FundChart
  - dividend record PDF per option (written by each fund house):    /content/dam/hk/en/pdf/dividend-composition-and-distribution-record/<code>.pdf
Dividend PDFs come in ~20 layouts, so the parser is generic (dates + first plausible per-share amount)
and every fund is CHECKED: our own total return (prices + dividends) must match AIA's published
calendar-year / YTD returns. Dividends are merged into data/funds/<code>.json, so history keeps
growing even if a PDF only shows the last 12 months.
A fund that fails keeps its previous (checked) data and is listed in index.json "problems"; exit code 2.
"""
import argparse
import bisect
import datetime as dt
import json
import math
import re
import shutil
import sys
import time
import urllib.request
from pathlib import Path

from pypdf import PdfReader

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pdf_cache" / "funds"
OUT = ROOT / "data" / "funds"
BACKFILL = ROOT / "data" / "backfill"
CAT = "TMP2"
API = "https://www1.aia.com.hk/CorpWS/Investment/Get/"
PDF = "https://www.aia.com.hk/content/dam/hk/en/pdf/dividend-composition-and-distribution-record/{}.pdf"
DETAIL = "https://www.aia.com.hk/zh-hk/help-and-support/individuals/investment-information/investment-options-prices/details.html?id={}&cat=" + CAT + "&lang=zh"
TOLERANCE = 0.6   # % points allowed between our yearly return and AIA's (AIA rounds, dates differ by a day)

HOUSE_ZH = {
    "Allianz": "安聯", "Amundi": "東方匯理", "Baring": "霸菱", "BlackRock": "貝萊德", "Capital International": "資本集團",
    "FIL": "富達", "Franklin": "富蘭克林鄧普頓", "FundRock": "友邦投資", "JPMorgan": "摩根", "Janus": "駿利亨德森",
    "Neuberger": "路博邁", "Ninety One": "晉達", "PineBridge": "柏瑞", "Principal": "信安", "Schroder": "施羅德",
    "UBS": "瑞銀", "abrdn": "安本", "惠理": "惠理", "摩根": "摩根", "滙豐": "滙豐",
}
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (advisor-tools fund data)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode("utf-8")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3)


def strip_html(s):
    return re.sub(r"<[^>]+>|\[|\]|&nbsp;", "", s or "").strip()


def pct(s):
    m = re.search(r"-?\d+(?:\.\d+)?", strip_html(s))
    return float(m.group()) if m and "%" in strip_html(s) else None


def house_zh(house, name_zh):
    for k, v in HOUSE_ZH.items():
        if house.startswith(k) or name_zh.startswith(k):
            return v
    return house


# ---------- dividend PDF parsing ----------
D_YMD = r"(20\d\d)-(\d{1,2})-(\d{1,2})"
D_SLASH = r"(\d{1,2})/(\d{1,2})/(20\d\d)"
D_DMONY = r"(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4}|\d{2})(?![\d/])"
D_MONY = r"(?<![\w-])([A-Za-z]{3})[- ](\d{2})(?![\d/-])"
D_ZH = r"(20\d\d)年(\d{1,2})月(\d{1,2})日"
D_DOT = r"(?<![\d.])(\d{2})\.(\d{2})\.(\d{2}|20\d\d)(?![\d.])"
TOKEN = re.compile("|".join([
    r"(?P<ymd>" + D_YMD + r")(?!\d)",
    r"(?P<zh>" + D_ZH + r")",
    r"(?P<slash>" + D_SLASH + r")",
    r"(?P<dot>" + D_DOT + r")",
    r"(?P<dmony>" + D_DMONY + r")",
    r"(?P<mony>" + D_MONY + r")",
    r"(?P<pct>-?\d+(?:\.\d+)?)\s?%",
    r"(?P<num>(?<![\w./-])\d{1,6}\.\d{2,8}(?![\d/%-]))",
]))


REGULAR = ((25, 36), (85, 96), (175, 190), (358, 372))   # monthly / quarterly / half-yearly / yearly gaps


def slash_orders(lines):
    """{line index: 'dmy'|'mdy'}. One PDF can hold two tables with different date styles, so decide per block of
    consecutive dated lines: unambiguous dates (day > 12) win; otherwise the reading that gives regular gaps."""
    blocks, block, last = [], [], -9
    for i, line in enumerate(lines):
        m = re.search(D_SLASH, line)
        if not m:
            continue
        if i - last > 3 and block:
            blocks.append(block)
            block = []
        block.append((i, int(m.group(1)), int(m.group(2)), int(m.group(3))))
        last = i
    if block:
        blocks.append(block)
    orders = {}
    for block in blocks:
        dmy = sum(1 for _, a, b, _ in block if a > 12 >= b)
        mdy = sum(1 for _, a, b, _ in block if b > 12 >= a)
        if dmy != mdy:
            order = "dmy" if dmy > mdy else "mdy"
        else:
            def regular(order):
                days = []
                for _, a, b, y in block:
                    d, mo = (a, b) if order == "dmy" else (b, a)
                    try:
                        days.append(dt.date(y, mo, d))
                    except ValueError:
                        return -1
                return sum(1 for x, z in zip(days, days[1:]) if any(lo <= abs((z - x).days) <= hi for lo, hi in REGULAR))
            order = "mdy" if regular("mdy") > regular("dmy") else "dmy"
        for i, *_ in block:
            orders[i] = order
    return orders


def to_date(m, order):
    try:
        if m.group("ymd"):
            y, mo, d = re.match(D_YMD, m.group("ymd")).groups()
            return dt.date(int(y), int(mo), int(d)), True
        if m.group("zh"):
            y, mo, d = re.match(D_ZH, m.group("zh")).groups()
            return dt.date(int(y), int(mo), int(d)), True
        if m.group("slash"):
            a, b, y = (int(x) for x in re.match(D_SLASH, m.group("slash")).groups())
            d, mo = (a, b) if order == "dmy" else (b, a)
            return dt.date(y, mo, d), True
        if m.group("dot"):
            d, mo, y = re.match(D_DOT, m.group("dot")).groups()
            return dt.date(int(y) + (2000 if len(y) == 2 else 0), int(mo), int(d)), True
        if m.group("dmony"):
            d, mon, y = re.match(D_DMONY, m.group("dmony")).groups()
            y = int(y) + (2000 if len(y) == 2 else 0)
            return dt.date(y, MONTHS[mon[:3].lower()], int(d)), True
        if m.group("mony"):
            mon, y = re.match(D_MONY, m.group("mony")).groups()
            if mon[:3].lower() not in MONTHS:
                return None, False
            return dt.date(2000 + int(y), MONTHS[mon[:3].lower()], 15), False
    except (ValueError, KeyError):
        return None, False
    return None, False


class Prices:
    def __init__(self, rows):
        self.d = [dt.date.fromisoformat(r[0]) for r in rows]
        self.p = [r[1] for r in rows]

    def on_or_before(self, day):
        i = bisect.bisect_right(self.d, day) - 1
        return self.p[i] if i >= 0 else None

    def after(self, day):
        """AIA prices are dated one business day after the fund's NAV date, so the ex-date NAV is the next AIA price."""
        i = bisect.bisect_right(self.d, day)
        return (self.d[i], self.p[i]) if i < len(self.d) else (None, None)


def parse_dividends(text, prices):
    """Return rows [date, amount, yieldPct|None, capitalPct|None] found in a dividend record PDF."""
    lines = text.splitlines()
    orders = slash_orders(lines)
    rows, cur = [], None
    for li, line in enumerate(lines):
        for m in TOKEN.finditer(line):
            kind = m.lastgroup if m.lastgroup in ("pct", "num") else "date"
            if kind == "date":
                day, full = to_date(m, orders.get(li, "dmy"))
                if not day:
                    continue
                if cur and cur["amt"] is not None and cur["line"] == li:
                    cur["dates"].append((day, full))      # pay / record date on the same line
                    continue
                if cur and cur["amt"] is not None:
                    rows.append(cur)
                    cur = None
                if cur and cur["line"] != li:
                    cur = None                            # stale header date ("as at ...", "launch ...") with no amount
                if cur is None:
                    cur = {"dates": [], "amt": None, "nums": [], "pcts": [], "line": li}
                cur["dates"].append((day, full))
            elif cur is not None:
                if kind == "num":
                    cur["nums"].append(float(m.group("num")))
                    if cur["amt"] is None:
                        cur["amt"] = pick_amount(cur, prices)
                        if cur["amt"] is not None:
                            cur["line"] = li
                elif cur["amt"] is not None:
                    cur["pcts"].append(float(m.group("pct")))
    if cur and cur["amt"] is not None:
        rows.append(cur)
    out = []
    for r in rows:
        fulls = [d for d, f in r["dates"] if f]
        day = fulls[0] if fulls else r["dates"][0][0]
        p = r["pcts"]
        cap = None
        if len(p) >= 2 and abs(p[-1] + p[-2] - 100) < 1.5:
            cap = p[-1]          # "% from income, % from capital" are the last two columns
            p = p[:-2]
        yld = p[0] if p and 0 < p[0] < 30 else None
        if day <= prices.d[-1] + dt.timedelta(days=60):
            out.append([day.isoformat(), r["amt"], yld, cap])
    return out


def pick_amount(cur, prices):
    day = next((d for d, f in cur["dates"] if f), cur["dates"][0][0])
    price = prices.on_or_before(day) or prices.after(day)[1]
    x = cur["nums"][-1]
    if price is None:
        return None
    return x if 0.0003 < x / price < 0.12 else None


def series_split(rows):
    """Split into runs of monotonic dates (a new table / another share class starts a new run)."""
    runs, run, direction = [], [], 0
    for r in rows:
        if run:
            prev = dt.date.fromisoformat(run[-1][0])
            now = dt.date.fromisoformat(r[0])
            step = (now - prev).days
            d = 0 if step == 0 else (1 if step > 0 else -1)
            gap_ok = abs(step) <= 200
            if d == 0 or not gap_ok or (direction and d != direction):
                # a jump back to the start of a new year-table keeps going in the same direction overall
                runs.append(run)
                run, direction = [], 0
            elif not direction:
                direction = d
        run.append(r)
    if run:
        runs.append(run)
    return runs


def dedupe(rows):
    """Merge rows that are the same dividend (within 7 days: record / ex / NAV dates differ between tables).
    Returns None if two different amounts fall in the same week (= rows from another share class)."""
    out = []
    for r in sorted(rows, key=lambda r: (r[0], r[1])):
        if out and (dt.date.fromisoformat(r[0]) - dt.date.fromisoformat(out[-1][0])).days <= 7:
            o = out[-1]
            if abs(o[1] - r[1]) > 0.005 * max(o[1], r[1]):
                return None
            out[-1] = [o[0], o[1], o[2] if o[2] is not None else r[2], o[3] if o[3] is not None else r[3]]
            continue
        out.append(list(r))
    return out


def runs_of(parsed, zipped):
    """Separate tables / share classes as runs (each internally consistent), longest first."""
    runs = []
    for run in series_split(parsed):
        piece = []
        for row in run:                       # split a run where two tables meet with clashing amounts
            if piece and dedupe(piece + [row]) is None:
                runs.append(dedupe(piece))
                piece = []
            piece.append(row)
        if piece:
            runs.append(dedupe(piece))
    if zipped:
        runs.append(zipped)
    return sorted(runs, key=len, reverse=True)


def parse_zipped(text, prices):
    """Layout where amounts and dates sit in two separate column blocks (e.g. HSBC): pair them in order."""
    lines = text.splitlines()
    orders = slash_orders(lines)
    med = sorted(prices.p)[len(prices.p) // 2]
    amt_lines, date_lines = {}, []
    for li, line in enumerate(lines):
        toks = list(TOKEN.finditer(line))
        dates = [to_date(m, orders.get(li, "dmy")) for m in toks if m.lastgroup not in ("pct", "num")]
        dates = [d for d, full in dates if d and full]
        nums = [float(m.group("num")) for m in toks if m.lastgroup == "num"]
        if dates and not nums:
            date_lines.append((li, dates[0]))
        elif nums and not dates and 0.0003 < nums[0] / med < 0.12:
            sig = re.sub(r"[\d.]+", "#", line.strip())
            pcts = [float(m.group("pct")) for m in toks if m.lastgroup == "pct"]
            amt_lines.setdefault(sig, []).append((nums[0], pcts[0] if pcts and 0 < pcts[0] < 30 else None))
    blocks, block = [], []
    for li, d in date_lines:
        if block and li - block[-1][0] > 1:
            blocks.append(block)
            block = []
        block.append((li, d))
    if block:
        blocks.append(block)
    date_lines = [d for _, d in max(blocks, key=len)] if blocks else []
    if not amt_lines or len(date_lines) < 6:
        return None
    amts = max(amt_lines.values(), key=len)
    if len(amts) != len(date_lines):
        return None
    return dedupe([[d.isoformat(), a, y, None] for d, (a, y) in zip(date_lines, amts)])


# ---------- returns ----------
class FxSeries:
    def __init__(self, rows):
        self.d = [r[0] for r in rows]
        self.v = [r[1] for r in rows]

    def on_or_before(self, day):
        i = bisect.bisect_right(self.d, day) - 1
        return self.v[i] if i >= 0 else None


def Fx(offline):
    """{currency: USD per 1 unit} from the ECB reference rates (public). Used only to check non-USD classes
    against AIA, because AIA publishes the returns of e.g. RMB classes converted to USD."""
    import csv, io, zipfile
    f = CACHE / "ecb-fx.zip"
    if not offline or not f.exists():
        f.write_bytes(get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip", binary=True))
    cols = {"RMB": "CNY", "HKD": "HKD", "JPY": "JPY", "EUR": None}
    rows = {k: [] for k in cols}
    with zipfile.ZipFile(f) as z:
        for r in csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")):
            try:
                day, usd = dt.date.fromisoformat(r["Date"]), float(r["USD"])
            except (ValueError, KeyError):
                continue
            for cur, col in cols.items():
                try:
                    rows[cur].append((day, usd if col is None else usd / float(r[col])))
                except (ValueError, KeyError):
                    pass
    return {k: FxSeries(sorted(v)) for k, v in rows.items() if v}


def total_return(prices, divs, start, end, fx=None):
    """% return from AIA price on/before `start` to on/before `end`, dividends reinvested at the next AIA price.
    With fx: measured in USD (RMB class)."""
    p0, p1 = prices.on_or_before(start), prices.on_or_before(end)
    if p0 is None or p1 is None:
        return None
    if fx:
        p0, p1 = p0 * fx.on_or_before(start), p1 * fx.on_or_before(end)
    units = 1.0
    for d, amt, *_ in divs:
        day = dt.date.fromisoformat(d)
        if start < day <= end:
            _, nav = prices.after(day)
            if nav:
                units *= 1 + amt / nav
    return (p1 * units / p0 - 1) * 100


def cash_return(prices, divs, start, end):
    """% return when dividends are paid out in cash (not reinvested): (end price + cash received) / start price."""
    p0, p1 = prices.on_or_before(start), prices.on_or_before(end)
    if p0 is None or p1 is None:
        return None
    cash = sum(d[1] for d in divs if start < dt.date.fromisoformat(d[0]) <= end)
    return ((p1 + cash) / p0 - 1) * 100


def check_fund(prices, divs, aia_years, perf_as_of, fx=None):
    """Compare our calendar-year returns with AIA's. Only years fully covered by price + dividend data count."""
    if not divs:
        return [], False
    first_div, last_div = dt.date.fromisoformat(divs[0][0]), dt.date.fromisoformat(divs[-1][0])
    gaps = sorted((dt.date.fromisoformat(b[0]) - dt.date.fromisoformat(a[0])).days for a, b in zip(divs, divs[1:]))
    step = gaps[len(gaps) // 2] if gaps else 31
    tol = TOLERANCE * (2.5 if fx else 1)
    results = []
    for year, aia in aia_years.items():
        if aia is None:
            continue
        if year == "YTD":
            start, end = dt.date(perf_as_of.year - 1, 12, 31), perf_as_of
        else:
            start, end = dt.date(int(year) - 1, 12, 31), dt.date(int(year), 12, 31)
        if (prices.d[0] > start or (first_div - start).days > step + 10 or end > prices.d[-1]
                or last_div + dt.timedelta(days=step - 5) <= end):   # PDF not yet showing the last dividend(s)
            continue          # not covered (fund not yet on AIA, or dividend history starts later)
        ours = total_return(prices, divs, start, end, fx)
        if ours is None:
            continue
        results.append({"year": year, "ours": round(ours, 2), "aia": aia, "ok": abs(ours - aia) <= tol})
    return results, bool(results) and all(r["ok"] for r in results)


def yield_check(prices, divs):
    """Fallback for funds too new for AIA's yearly figures: the PDF's own annualised yield must agree with
    amount / NAV x 12 (monthly) for most rows. Returns (rows checked, ok)."""
    n = good = 0
    for d, amt, yld, _ in divs:
        if not yld or dt.date.fromisoformat(d) < prices.d[0]:
            continue
        _, nav = prices.after(dt.date.fromisoformat(d))
        if not nav:
            continue
        n += 1
        simple = amt / nav * 12 * 100
        compound = ((1 + amt / nav) ** 12 - 1) * 100
        if min(abs(simple - yld), abs(compound - yld)) <= max(0.25, yld * 0.08):
            good += 1
    return n, n >= 3 and good >= 0.8 * n


def plausible(prices, divs):
    """Every dividend must be 0.1%-25% a year of the price (monthly-ish), else it is from another table."""
    for d, amt, *_ in divs:
        _, nav = prices.after(dt.date.fromisoformat(d))
        if nav and not (0.0001 < amt / nav < 0.12):
            return False
    return True


def choose_dividends(runs, stored, prices, aia_years, perf_as_of, fx):
    """Start from stored history (or the best single run) and add runs one by one, keeping a run only if it
    does not clash with what we have and does not make the match with AIA's yearly returns worse."""
    def score(divs):
        res, ok = check_fund(prices, divs, aia_years, perf_as_of, fx)
        good = sum(1 for r in res if r["ok"])
        err = round(sum(abs(r["ours"] - r["aia"]) for r in res), 2)
        return (good, -err), res, ok

    if stored:
        base = stored
    else:
        best = None
        for r in runs:
            if not plausible(prices, r):
                continue
            sc = score(r)[0] + (len(r),)
            if best is None or sc > best[0]:
                best = (sc, r)
        base = best[1] if best else []
    base_sc = score(base)[0]
    for r in runs:
        merged = dedupe(base + r)
        if merged is None or merged == base or not plausible(prices, merged):
            continue
        sc = score(merged)[0]
        if sc >= base_sc:
            base, base_sc = merged, sc
    gaps = sorted((dt.date.fromisoformat(b[0]) - dt.date.fromisoformat(a[0])).days for a, b in zip(base, base[1:]))
    step = gaps[len(gaps) // 2] if gaps else 31
    i = 0
    while i < len(base) - 1:
        gap = (dt.date.fromisoformat(base[i + 1][0]) - dt.date.fromisoformat(base[i][0])).days
        if gap < 0.8 * step:
            trials = [base[:i] + base[i + 1:], base[:i + 1] + base[i + 2:]]
            sc, pick = max(((score(t)[0], t) for t in trials), key=lambda x: x[0])
            if sc > base_sc:
                base, base_sc = pick, sc
                continue
        i += 1
    _, res, ok = score(base)
    return None, base, res, ok


def summary(prices, divs, dist):
    """Numbers for the fund list. Same method as assets/js/fundcalc.js (tests/fund.test.js checks they agree).
    step      = usual days between dividends; dataFrom = earliest start date with full data
    yieldNow  = latest dividend / ex-date price x payments per year (simple, %)
    r1y..r5y  = total return with dividends reinvested over the last n years (%); a3y/a5y = per year
    pr1y      = price change only (1 year); vol = yearly volatility (%), mdd = worst fall from a high (%),
                both on the total-return index over the last 3 years (shorter if the data is shorter, >= 1 year)"""
    out = {"step": None, "dataFrom": prices.d[0].isoformat(), "yieldNow": None}
    data_from = prices.d[0]
    if dist:
        if not divs:
            return {**out, "dataFrom": None, "r1y": None, "r2y": None, "r3y": None, "r5y": None, "a3y": None, "a5y": None,
                    "c1y": None, "c2y": None, "c3y": None, "c5y": None, "ca3y": None, "ca5y": None,
                    "pr1y": None, "vol": None, "mdd": None, "statsYears": None}
        gaps = sorted((dt.date.fromisoformat(b[0]) - dt.date.fromisoformat(a[0])).days for a, b in zip(divs, divs[1:]))
        step = gaps[len(gaps) // 2] if gaps else 30
        first = dt.date.fromisoformat(divs[0][0])
        data_from = max(prices.d[0], first - dt.timedelta(days=step - 3))
        _, nav = prices.after(first if len(divs) == 1 else dt.date.fromisoformat(divs[-1][0]))
        per_year = 12 if step < 45 else (4 if step < 120 else (2 if step < 250 else 1))
        out.update(step=step, dataFrom=data_from.isoformat(),
                   yieldNow=round(divs[-1][1] / nav * per_year * 100, 2) if nav else None)
    end = prices.d[-1]
    for key, years in (("r1y", 1), ("r2y", 2), ("r3y", 3), ("r5y", 5)):
        start = end - dt.timedelta(days=365 * years)
        out[key] = round(total_return(prices, divs, start, end), 2) if start >= data_from else None
    for key, src, years in (("a3y", "r3y", 3), ("a5y", "r5y", 5)):
        out[key] = round(((1 + out[src] / 100) ** (1 / years) - 1) * 100, 2) if out[src] is not None else None
    # 「收現金」計法（客人實際情況）：基金價值 + 已收現金息；累積基金冇現金派息，同上面一樣
    for key, years in (("c1y", 1), ("c2y", 2), ("c3y", 3), ("c5y", 5)):
        start = end - dt.timedelta(days=365 * years)
        r = "r" + key[1:]
        out[key] = (round(cash_return(prices, divs, start, end), 2) if start >= data_from else None) if dist else out[r]
    for key, src, years in (("ca3y", "c3y", 3), ("ca5y", "c5y", 5)):
        out[key] = round(((1 + out[src] / 100) ** (1 / years) - 1) * 100, 2) if out[src] is not None else None
    s1 = end - dt.timedelta(days=365)
    out["pr1y"] = round((prices.on_or_before(end) / prices.on_or_before(s1) - 1) * 100, 2) if s1 >= prices.d[0] else None
    # risk numbers on the total-return index
    start = max(end - dt.timedelta(days=365 * 3), data_from)
    years = (end - start).days / 365
    if years < 0.99:
        out.update(vol=None, mdd=None, statsYears=None)
        return out
    idx = tr_index(prices, divs, start, end)
    weekly, day = [], start
    while day <= end:
        weekly.append(idx_on_or_before(idx, day))
        day += dt.timedelta(days=7)
    rets = [math.log(b / a) for a, b in zip(weekly, weekly[1:]) if a and b]
    mean = sum(rets) / len(rets)
    vol = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(52) * 100
    peak, mdd = 0, 0
    for _, v in idx:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    out.update(vol=round(vol, 2), mdd=round(mdd * 100, 2), statsYears=round(years, 1))
    return out


def tr_index(prices, divs, start, end):
    """Daily total-return index (dividends reinvested at the next AIA price), 1.0 at the price on/before start."""
    i = max(0, bisect.bisect_right(prices.d, start) - 1)
    units, out, di = 1.0, [], 0
    divs = [(dt.date.fromisoformat(d[0]), d[1]) for d in divs]
    while di < len(divs) and divs[di][0] <= prices.d[i]:
        di += 1
    p0 = prices.p[i]
    for j in range(i, len(prices.d)):
        if prices.d[j] > end:
            break
        while di < len(divs) and divs[di][0] < prices.d[j]:
            _, nav = prices.after(divs[di][0])
            if nav:
                units *= 1 + divs[di][1] / nav
            di += 1
        out.append((prices.d[j], prices.p[j] * units / p0))
    return out


def idx_on_or_before(idx, day):
    lo, hi = 0, len(idx)
    while lo < hi:
        mid = (lo + hi) // 2
        if idx[mid][0] <= day:
            lo = mid + 1
        else:
            hi = mid
    return idx[lo - 1][1] if lo else None


def check_prices(prices, aia_years, perf_as_of, fxs, adjust=()):
    """Funds without dividends: price change per calendar year must match AIA's (in the fund's currency or in USD)."""
    best = None
    for fx in fxs:
        res = []
        for year, aia in aia_years.items():
            if aia is None:
                continue
            start = dt.date(perf_as_of.year - 1, 12, 31) if year == "YTD" else dt.date(int(year) - 1, 12, 31)
            end = perf_as_of if year == "YTD" else dt.date(int(year), 12, 31)
            if prices.d[0] > start or end > prices.d[-1]:
                continue
            ours = total_return(prices, list(adjust), start, end, fx)
            res.append({"year": year, "ours": round(ours, 2), "aia": aia, "ok": abs(ours - aia) <= TOLERANCE * (2 if fx else 1)})
        score = (sum(r["ok"] for r in res), -sum(abs(r["ours"] - r["aia"]) for r in res))
        if best is None or score > best[0]:
            best = (score, res, fx)
    res = best[1]
    return res, bool(res) and all(r["ok"] for r in res), best[2]


def adjustments(prices, checks, perf_as_of, basis=None):
    """Monthly reinvestment entries [date, amount per unit] so that each mismatching year matches AIA's figure."""
    out = []
    for c in checks:
        if c["ok"]:
            continue
        y = c["year"]
        start = dt.date(perf_as_of.year - 1, 12, 31) if y == "YTD" else dt.date(int(y) - 1, 12, 31)
        end = perf_as_of if y == "YTD" else dt.date(int(y), 12, 31)
        months = []
        d = dt.date(start.year + (start.month // 12), start.month % 12 + 1, 1)
        while True:
            nxt = dt.date(d.year + (d.month // 12), d.month % 12 + 1, 1)
            last = min(nxt - dt.timedelta(days=1), end)
            if last <= start or last > end:
                break
            months.append(last)
            if last == end:
                break
            d = nxt
        if not months:
            continue
        ours = total_return(prices, [], start, end, basis)
        factor = (1 + c["aia"] / 100) / (1 + ours / 100)
        g = factor ** (1 / len(months))
        for m in months:
            _, nav = prices.after(m)
            if nav:
                out.append([m.isoformat(), round((g - 1) * nav, 8)])
    return sorted(out)


def currency_of(s):
    s = s or ""
    if s.startswith("US"):
        return "USD"
    if "RMB" in s or "人民幣" in s:
        return "RMB"
    if "HK" in s or "港元" in s:
        return "HKD"
    if "EUR" in s or "€" in s or "歐元" in s:
        return "EUR"
    if "YEN" in s or "¥" in s or "日圓" in s:
        return "JPY"
    return s


def read_prices(raw):
    rows = []
    for ts, p, *_ in raw:
        day = dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc).date().isoformat()
        if rows and rows[-1][0] == day:
            rows[-1][1] = p
        else:
            rows.append([day, p])
    return rows


def dump_fund(data):
    """One price per line: the daily update then changes only the last lines (small git history)."""
    rows = ",\n".join(json.dumps(r, separators=(",", ":")) for r in data["prices"])
    divs = ",\n".join(json.dumps(r, separators=(",", ":")) for r in data["dividends"])
    adj = ",\n".join(json.dumps(r, separators=(",", ":")) for r in data.get("reinvest") or [])
    return '{"code":%s,\n"prices":[\n%s],\n"dividends":[\n%s],\n"reinvest":[\n%s]}\n' % (json.dumps(data["code"]), rows, divs, adj)


def next_business_day(day):
    day += dt.timedelta(days=1)
    while day.weekday() >= 5:
        day += dt.timedelta(days=1)
    return day


def load_backfill(code, aia_rows):
    """data/backfill/<code>.json (scripts/backfill_funds.py): fund-house / FT history from before the fund came to AIA.
    NAV dates move one business day later (AIA's convention). Returns (rows to put in front, dividends, info) or None
    if the file is missing or its prices do not match AIA's where both exist."""
    f = BACKFILL / f"{code}.json"
    if not f.exists():
        return None
    b = json.loads(f.read_text(encoding="utf-8"))
    info = {"source": b["source"], "url": b["url"], "priceSource": b.get("priceSource", b["source"]), "fetched": b["fetched"]}
    first = aia_rows[0][0]
    if not b["prices"]:                                  # dividends only (AIA already has the prices)
        info["lag"] = None
        return [], b.get("dividends") or [], info
    # AIA dates some funds one business day after the NAV date, others on the same day: use whichever lines up
    best = None
    for lag in (0, 1):
        shifted = {}
        for d, nav in b["prices"]:
            day = dt.date.fromisoformat(d)
            shifted[(next_business_day(day) if lag else day).isoformat()] = nav
        diffs = sorted(abs(shifted[d] / p - 1) for d, p in aia_rows[:250] if d in shifted and p)
        exact = sum(1 for x in diffs if x < 0.0006)
        if diffs and (best is None or exact > best[0]):
            best = (exact, lag, shifted, diffs)
    if not best or len(best[3]) < 20:
        print(f"    {code}: backfill has too little overlap with AIA prices - not used")
        return None
    _, lag, shifted, overlap = best
    info["lag"] = lag
    info["overlapDiff"] = round(overlap[len(overlap) // 2] * 100, 3)
    if overlap[len(overlap) // 2] > 0.004:               # median gap > 0.4%: another share class or wrong data
        print(f"    {code}: backfill prices do not match AIA (median {info['overlapDiff']}%) - not used")
        return None
    front = sorted([d, p] for d, p in shifted.items() if d < first)
    return front, b.get("dividends") or [], info


def process(code, en, zh, fx, args):
    dist = en.get("distribution_fund") == "Y"
    cf, pf = CACHE / f"{code}_chart.json", CACHE / f"{code}.pdf"
    if not args.offline:
        cf.write_text(get(f"{API}FundChart/?fund_code={code}&fund_cat={CAT}"), encoding="utf-8")
        if dist:
            pf.write_bytes(get(PDF.format(code), binary=True))
        time.sleep(0.3)
    aia_rows = read_prices(json.loads(cf.read_text(encoding="utf-8")))
    if not aia_rows:
        raise ValueError("no prices")
    bf = load_backfill(code, aia_rows)
    if bf:
        fund, data, problem = process_once(code, en, zh, fx, dist, pf, aia_rows, bf)
        if not problem and fund["checkOk"]:
            return fund, data, problem
        print(f"    {code}: check failed with the backfill - retrying with AIA data only")
    fund, data, problem = process_once(code, en, zh, fx, dist, pf, aia_rows, None)
    if bf:
        fund["backfillRejected"] = True
    return fund, data, problem


def process_once(code, en, zh, fx, dist, pf, aia_rows, bf):
    price_rows = (bf[0] if bf else []) + aia_rows
    prices = Prices(price_rows)
    cur = currency_of(en["currency"])
    perf_as_of = dt.datetime.strptime(en["performance_as_of"], "%m/%d/%Y").date()
    aia_years = {h["year"]: pct(h["price"]) for h in en["priceHistory"]}
    old = OUT / f"{code}.json"
    stored = json.loads(old.read_text(encoding="utf-8"))["dividends"] if old.exists() else []
    if bf and bf[1]:
        older = [list(d) for d in bf[1] if not stored or d[0] < stored[0][0]]
        merged = dedupe(stored + older)
        stored = merged if merged is not None else sorted(stored + [d for d in older if d[0] < (stored[0][0] if stored else "9")])
    level, divs, adjust = None, [], []
    if dist:
        text = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(pf)).pages)
        cands = runs_of(parse_dividends(text, prices), parse_zipped(text, prices))
        _, divs, checks, ok = choose_dividends(cands, stored, prices, aia_years, perf_as_of, fx.get(cur))
        level = "aia" if ok else None
        if not checks:
            n, yok = yield_check(prices, divs)
            if yok:
                ok, level = True, "yield"
            checks = [{"year": "派息率核對", "rows": n, "ok": yok}]
        divs = [d for d in divs if d[0] >= price_rows[0][0]]
        problem = not ok and (any("aia" in c for c in checks) or (checks and checks[0].get("rows")))
    else:
        checks, ok, basis = check_prices(prices, aia_years, perf_as_of, [None, fx.get(cur)] if cur != "USD" else [None])
        level = "aia" if ok else None
        if checks and not ok:
            # Some options without cash dividends still get dividends inside the fund (reinvested by AIA), which the
            # price does not show. Match AIA's yearly returns by spreading the missing part over each month.
            adjust = adjustments(prices, checks, perf_as_of, basis)
            checks2, ok2, _ = check_prices(prices, aia_years, perf_as_of, [basis], adjust)
            if ok2:
                level, ok = "adjusted", True
                for c in checks:
                    c["adjusted"] = not c["ok"]
        problem = bool(checks) and not ok
    last12 = [d for d in divs if dt.date.fromisoformat(d[0]) > prices.d[-1] - dt.timedelta(days=365)]
    caps = [d[3] for d in last12 if d[3] is not None]
    name_zh = re.sub(r"\s+", " ", zh["name"]).strip()
    typ = zh["type"]
    remarks = [strip_html(r) for r in (zh.get("specialRemarks") or []) if strip_html(r)]
    if strip_html(zh.get("fund_remark")):
        remarks.append(strip_html(zh["fund_remark"]))
    fund = {
        "code": code, "dist": dist,
        "name": name_zh, "nameEn": re.sub(r"\s+", " ", en["name"]).strip(),
        "underlying": re.sub(r"\s+", " ", en.get("underlying_fundname") or "").strip(),
        "house": house_zh(en["house"], name_zh),
        "type": typ, "asset": typ.split(" - ")[0].strip(), "region": typ.split(" - ")[1].strip() if " - " in typ else "",
        "risk": zh["risk"], "currency": cur, "isin": en.get("ISIN", ""),
        "launch": dt.datetime.strptime(en["price_avail_date"], "%m/%d/%Y").date().isoformat(),
        "price": price_rows[-1][1], "priceDate": price_rows[-1][0],
        "perfAsOf": perf_as_of.isoformat(), "aiaReturns": aia_years, "msRating": en.get("rating") or None,
        "checks": checks, "checkOk": ok, "checkLevel": level,
        "divFrom": divs[0][0] if divs else None, "divCount": len(divs),
        "latestDividend": divs[-1] if divs else None,
        "capitalPct12m": round(sum(caps) / len(caps), 1) if caps else None,
        **summary(prices, divs + adjust, dist),
        "remarks": remarks,
        "aiaFrom": aia_rows[0][0],
        "backfill": bf[2] if bf else None,
        "detailUrl": DETAIL.format(code),
        "pdfUrl": PDF.format(code) if dist else None,
    }
    flag = "OK " if ok else ("BAD" if problem else "?? ")
    print(f"{flag} {code} {'D' if dist else 'A'} {cur} divs={len(divs):3d} checks=" +
          ", ".join(f"{c['year']}:{c.get('ours', c.get('rows'))}/{c.get('aia', c['ok'])}" for c in checks))
    return fund, {"code": code, "prices": price_rows, "dividends": divs, "reinvest": adjust}, problem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--only", help="comma separated codes (debug)")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    lists = {}
    for lang in ("en", "zh"):
        f = CACHE / f"list_{lang}.json"
        if not args.offline:
            f.write_text(get(f"{API}FundInfo2/?fund_cat={CAT}&fund_type=&fund_house=&fund_code=&name=&lang={lang}"), encoding="utf-8")
        lists[lang] = {x["code"]: x for x in json.loads(f.read_text(encoding="utf-8"))}
    codes = list(lists["en"])
    if args.only:
        codes = [c for c in codes if c in args.only.split(",")]
    if len(codes) < 50 and not args.only:
        print(f"AIA returned only {len(codes)} funds - not updating")
        return 1

    fx = Fx(args.offline)
    old_index = {}
    if (OUT / "index.json").exists():
        old_index = {f["code"]: f for f in json.loads((OUT / "index.json").read_text(encoding="utf-8"))["funds"]}
    funds, problems = [], []
    for code in codes:
        en, zh = lists["en"][code], lists["zh"].get(code, lists["en"][code])
        try:
            fund, data, problem = process(code, en, zh, fx, args)
        except Exception as e:                       # one broken fund must not stop the daily update
            print(f"ERR {code}: {e}")
            fund, data, problem = None, None, True
        if problem:
            problems.append(code)
            if code in old_index:                    # keep yesterday's checked data for this fund
                fund = {**old_index[code], "stale": True}
                print(f"    {code}: keeping previous data")
                funds.append(fund)
                continue
            if fund is None:
                continue
        (OUT / f"{code}.json").write_text(dump_fund(data), encoding="utf-8")
        funds.append(fund)

    if args.only:                                    # debug run on a few funds: keep every other fund as it was
        done = {f["code"] for f in funds}
        funds += [f for c, f in old_index.items() if c not in done]
    # pairs (same underlying fund: dividend vs accumulation, same currency) and ranks within the same type + currency
    by_under = {}
    for f in funds:
        by_under.setdefault((f.get("underlying") or f["code"], f["currency"]), []).append(f)
    for f in funds:
        f["siblings"] = [g["code"] for g in by_under[(f.get("underlying") or f["code"], f["currency"])] if g["code"] != f["code"]]
    for key in ("r1y", "r3y"):
        groups = {}
        for f in funds:
            if f.get(key) is not None:
                groups.setdefault((f["type"], f["currency"]), []).append(f)
        for g in groups.values():
            g.sort(key=lambda f: -f[key])
            for i, f in enumerate(g):
                f["rank" + key[1:]] = [i + 1, len(g)]
    order = {"低": 0, "中": 1, "高": 2}
    funds.sort(key=lambda f: (not f["dist"], f["currency"] != "USD", order.get(f["risk"], 9), f["house"], f["code"]))
    index = {"plan": "「卓達智悅 2」", "planCode": CAT, "source": "AIA 香港官網（投資選擇價格、派息紀錄）",
             "built": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"),
             "problems": problems, "funds": funds}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(funds)} funds to {OUT}; {len(problems)} problem(s): {', '.join(problems) or '-'}")
    return 2 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
