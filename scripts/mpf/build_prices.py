"""強積金工具：每日／每月基金價格 → data/mpf/prices/<積金局基金編號>.json + data/mpf/prices-index.json

Usage:
  python scripts/mpf/build_prices.py                     每日：AIA + BCT 最新價（之後可以加其他受託人）
  python scripts/mpf/build_prices.py --monthly           加讀積金局每月月底價 Excel（全行；要 pip install xlrd）
  python scripts/mpf/build_prices.py --bct-backfill 2016-01-01 2026-11-20 [--step 7]
                                                         由 BCT 拎歷史價（每 step 日一個點；慢慢拎，每次 0.4 秒）
  python scripts/mpf/build_prices.py --mpfa-xls FILE ... 讀已下載嘅積金局月底價 Excel（追溯歷史用）

Needs data/mpf/market.json first (scripts/mpf/build_market.py): it gives every fund's MPFA id, scheme and names.
Each source's fund is matched to an MPFA fund by trustee + scheme + normalised English name; anything that
does not match is listed in prices-index.json "unmatched" (never guessed).
Check: where a daily source and MPFA's month-end price exist for the same date they must agree within 0.2 %;
otherwise that fund's new points are not saved and it is listed in "problems" (exit 2).
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

for s in (sys.stdout, sys.stderr):
    s.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "mpf"
PRICES = DATA / "prices"
CACHE = ROOT / "data" / "pdf_cache" / "mpf"
UA = {"User-Agent": "Mozilla/5.0 (advisor-tools mpf data)"}
MPFA_XLS = "https://www.mpfa.org.hk/en/-/media/files/information-centre/fund-information/monthly-fund-price/consolidated_list_for_{mon}_{yy}_read_only.xls"
AIA_URL = "https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundPriceList/mpf"
BCT_URL = "https://www.bcthk.com/bin/servlet/fundInformation?lang=en&schemaInfoId={sid}&date={date}"
BCT_DATES = "https://www.bcthk.com/bin/servlet/fundDate?lang=en"   # list of BCT pricing days, newest first
# BCT web scheme id -> MPFA English scheme name (both as published)
BCT_SCHEMES = {
    "pro-choice": "BCT (MPF) Pro Choice", "strategic-mpf": "BCT Strategic MPF Scheme",
    "series-800": "BCT MPF Scheme Series 800", "smart-plan": "BCT MPF - Smart Plan",
    "simple-plan": "BCT MPF - Simple Plan", "industry-choice": "BCT (MPF) Industry Choice",
}
TOL = 0.2   # % allowed between a daily source and MPFA's month-end price


def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
            return b if binary else b.decode("utf-8", errors="replace")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(4 * (i + 1))


def norm(s, keep_class=True):
    s = (s or "").lower().replace("&", " and ").replace("–", "-").replace("’", "'")
    s = re.sub(r"\((?:with )?de-?risking[^)]*\)", " ", s)
    s = re.sub(r"\bunit class\b", "class", s)
    if not keep_class:
        s = re.sub(r"\bclass [a-z]\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\b(the|fund|mpf|constituent)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


class Market:
    def __init__(self):
        m = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
        self.asof = m["asof"]
        self.funds = {f["id"]: f for f in m["funds"]}
        self.by_scheme = {}
        for f in m["funds"]:
            self.by_scheme.setdefault(norm(f.get("schemeEn", "")), []).append(f)

    def match(self, scheme_en, fund_en, cls=None):
        """Exact name (with class) first; then without class only if that is unique in the scheme."""
        sk = norm(scheme_en)
        if sk not in self.by_scheme and sk.startswith("principal "):   # Principal schemes were renamed BCT (old MPFA files)
            sk = "bct " + sk[len("principal "):]
        cands = self.by_scheme.get(sk, [])
        cls = cls if cls and re.fullmatch(r"[A-Za-z]", cls) else None
        name = fund_en if (not cls or re.search(r"class [a-z]\b", fund_en, re.I)) else f"{fund_en} class {cls}"
        for keep in (True, False):
            n = norm(name, keep)
            hits = [f for f in cands if norm(f.get("fundEn", ""), keep) == n]
            if len(hits) == 1:
                return hits[0]["id"]
            if len(hits) > 1:
                return None
        return None

    def classless(self, cf):
        return not re.search(r"class [a-z]\b", self.funds[cf].get("fundEn", ""), re.I)


def load(cf):
    f = PRICES / f"{cf}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"id": cf, "d": [], "p": [], "src": {}}


def merge(rec, points, src):
    """points: {date: price}. Daily sources overwrite MPFA month-end values on the same date."""
    cur = dict(zip(rec["d"], rec["p"]))
    for d, p in points.items():
        if p is None or p <= 0:
            continue
        if d in cur and src == "mpfa" and rec["src"].get(d[:7]) not in (None, "mpfa"):
            continue
        cur[d] = round(float(p), 6)
    ds = sorted(cur)
    rec["d"], rec["p"] = ds, [cur[d] for d in ds]
    for d in points:
        if src != "mpfa":
            rec["src"][d[:7]] = src
    return rec


def save(rec):
    PRICES.mkdir(parents=True, exist_ok=True)
    (PRICES / f"{rec['id']}.json").write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ---------------- sources ----------------
def src_aia(mk):
    data = json.loads(get(AIA_URL))
    out, un = {}, []
    for f in data:
        if f.get("unitizedFund") == "N" or not f.get("unitPrice"):
            continue
        d = f["valutationDate"]
        d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        cf = mk.match(f["scheme"], f["constituentFund"])
        if cf:
            out.setdefault(cf, {})[d] = float(f["unitPrice"])
        else:
            un.append(f"AIA {f['constituentFund']}")
    return out, un


def bct_dates():
    return json.loads(get(BCT_DATES))["data"]


def src_bct(mk, date=""):
    if not date:   # daily run: the last 3 pricing days (fills a missed day)
        out, un = {}, []
        for d in bct_dates()[:3]:
            o, u = src_bct_day(mk, d, report=not un)
            for cf, pts in o.items():
                out.setdefault(cf, {}).update(pts)
            un = un or u
        return out, un
    return src_bct_day(mk, date, report=False)


def src_bct_day(mk, date, report):
    out, un, seen = {}, [], {}
    for sid, scheme in BCT_SCHEMES.items():
        js = json.loads(get(BCT_URL.format(sid=sid, date=date)))
        for f in js.get("data", {}).get("fundInformationList", []):
            pd = f.get("fundPerformanceDetail") or {}
            if not pd.get("price"):
                continue
            cls = f.get("unitClass") or ""
            cf = mk.match(scheme, f["name"], cls)
            if cf:
                # MPFA lists one line for some funds that BCT shows in two classes: keep class A for that line
                if mk.classless(cf) and cls != "A" and cf in seen and seen[cf] == "A":
                    continue
                seen[cf] = cls
                out.setdefault(cf, {})[pd["priceDate"]] = float(pd["price"])
            elif report:
                un.append(f"BCT {scheme}: {f['name']} ({f.get('unitClass')})")
        time.sleep(0.3)
    return out, un


def parse_mpfa_xls(path, mk):
    import xlrd
    sh = xlrd.open_workbook(str(path)).sheet_by_index(0)
    date = None
    for r in range(min(12, sh.nrows)):
        for v in sh.row_values(r):
            m = re.search(r"as at (\d{1,2})\.(\d{1,2})\.(\d{4})", str(v))
            if m:
                date = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    if not date:
        raise ValueError(f"{path.name}: 搵唔到「as at」日期")
    out, un, scheme = {}, [], ""
    for r in range(sh.nrows):
        row = sh.row_values(r)
        if len(row) < 4:
            continue
        if isinstance(row[1], str) and row[1].strip() and not re.search(r"[㐀-鿿]", row[1]):
            scheme = row[1].strip()
        name, price = row[2], row[3]
        if isinstance(price, float) and isinstance(name, str) and not re.search(r"[㐀-鿿]", name):
            cf = mk.match(scheme, name.strip())
            if cf:
                out.setdefault(cf, {})[date] = price
            else:
                un.append(f"積金局 {scheme}: {name.strip()}")
    return date, out, un


def src_mpfa_monthly(mk, months=14):
    out, un, today = {}, [], dt.date.today()
    y, m = today.year, today.month
    for _ in range(months):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        mon = dt.date(y, m, 1).strftime("%b").lower()
        f = CACHE / "mpfa-xls" / f"{y}-{m:02d}.xls"
        f.parent.mkdir(parents=True, exist_ok=True)
        miss = f.with_suffix(".missing")
        if not f.exists() and not miss.exists():
            try:
                b = get(MPFA_XLS.format(mon=mon, yy=str(y)[2:]), binary=True)
                if not b.startswith(bytes([0xD0, 0xCF])):   # not an .xls (error page)
                    raise ValueError("not xls")
                f.write_bytes(b)
            except Exception:
                if (today - dt.date(y, m, 1)).days > 90:
                    miss.touch()   # old month really missing: don't ask again
                continue
        try:
            _, o, u = parse_mpfa_xls(f, mk)
        except Exception as e:
            f.unlink(missing_ok=True)
            continue
        for cf, pts in o.items():
            out.setdefault(cf, {}).update(pts)
        un += u
    return out, un


# ---------------- summary ----------------
def ret(d, p, days=None, since=None):
    if not d:
        return None
    last = dt.date.fromisoformat(d[-1])
    target = since or (last - dt.timedelta(days=days))
    i = None
    for k in range(len(d) - 1, -1, -1):
        if dt.date.fromisoformat(d[k]) <= target:
            i = k
            break
    if i is None or (target - dt.date.fromisoformat(d[i])).days > 7:
        return None
    return round((p[-1] / p[i] - 1) * 100, 2)


def summary(mk, problems, unmatched):
    idx = {}
    for cf in mk.funds:
        r = load(cf)
        if not r["d"]:
            continue
        last = dt.date.fromisoformat(r["d"][-1])
        daily = r["src"].get(r["d"][-1][:7]) not in (None, "mpfa")
        idx[cf] = {"date": r["d"][-1], "price": r["p"][-1], "daily": daily, "first": r["d"][0], "n": len(r["d"]),
                   "r1m": ret(r["d"], r["p"], 30), "r3m": ret(r["d"], r["p"], 91), "r1y": ret(r["d"], r["p"], 365),
                   "ytd": ret(r["d"], r["p"], since=dt.date(last.year - 1, 12, 31))}
    out = {"updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "funds": idx,
           "dailyCount": sum(1 for v in idx.values() if v["daily"]), "problems": problems, "unmatched": unmatched}
    (DATA / "prices-index.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


def check_and_merge(mk, srcname, pts_by_cf, problems):
    n = 0
    for cf, pts in pts_by_cf.items():
        rec = load(cf)
        known = dict(zip(rec["d"], rec["p"]))
        bad = [d for d, p in pts.items() if d in known and rec["src"].get(d[:7]) in (None, "mpfa") and srcname != "mpfa"
               and abs(p / known[d] - 1) * 100 > TOL]
        if bad:
            problems.append(f"{cf} {mk.funds[cf]['fund']}（{srcname}）{bad[0]} 價 {pts[bad[0]]} ≠ 積金局 {known[bad[0]]}")
            continue
        save(merge(rec, pts, srcname))
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--monthly", action="store_true")
    ap.add_argument("--bct-backfill", nargs=2, metavar=("FROM", "TO"))
    ap.add_argument("--step", type=int, default=7)
    ap.add_argument("--mpfa-xls", nargs="+")
    ap.add_argument("--mpfa-months", type=int, default=14, help="how many past months of MPFA month-end files to read")
    a = ap.parse_args()
    mk = Market()
    problems, unmatched, broken = [], [], []

    if a.mpfa_xls:
        for f in a.mpfa_xls:
            date, o, u = parse_mpfa_xls(Path(f), mk)
            print(f"{Path(f).name}: {date} {len(o)} 隻")
            check_and_merge(mk, "mpfa", o, problems)
        summary(mk, problems, unmatched)
        return 0

    if a.bct_backfill:
        d0, d1 = (dt.date.fromisoformat(x) for x in a.bct_backfill)
        d = d1
        while d >= d0:
            if d.weekday() < 5:
                try:
                    o, _ = src_bct(mk, d.isoformat())
                    check_and_merge(mk, "bct", o, problems)
                    print(d, len(o), flush=True)
                except Exception as e:
                    print(d, "錯誤", e, flush=True)
            d -= dt.timedelta(days=a.step)
        summary(mk, problems, unmatched)
        return 0

    if a.monthly:
        try:
            o, u = src_mpfa_monthly(mk, a.mpfa_months)
            check_and_merge(mk, "mpfa", o, problems)
            unmatched += sorted(set(u))
        except Exception as e:
            broken.append(f"積金局月底價：{e}")
    for name, fn in (("aia", src_aia), ("bct", src_bct)):
        try:
            o, u = fn(mk)
            n = check_and_merge(mk, name, o, problems)
            unmatched += u
            print(f"{name}: {n} 隻基金有新價")
        except Exception as e:
            broken.append(f"{name}：{e}")
    out = summary(mk, problems + broken, unmatched)
    print(f"每日價 {out['dailyCount']} 隻；問題 {len(problems + broken)}；配對唔到 {len(unmatched)}")
    for p in problems + broken + unmatched[:30]:
        print(" -", p)
    return 2 if problems or broken else 0


if __name__ == "__main__":
    sys.exit(main())
