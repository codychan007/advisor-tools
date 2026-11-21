"""強積金工具：用「自動瀏覽器」（無畫面 Chromium）打開受託人公開嘅基金價格頁，等價格表出咗，讀畫面上嘅字。
同人用瀏覽器睇一樣，唔會直接叫受託人嘅內部數據接口。

Used by build_prices.py (src_browser).  Needs:  pip install playwright==1.49.1 && python -m playwright install chromium
Each SITE: url, MPFA English scheme name, a regex that appears only once the price table has loaded,
and where the price date is (page text or a date input).  Only names that match one of that scheme's
MPFA Chinese fund names are kept (never guessed).

未做到（2026-11-21）：宏利、富達（網站拒絕自動瀏覽器，唔可以繞過）；永明（要先撳「接受」重要事項）；
東亞、交通銀行、中國人壽、海通、AMTD、新地（未搵到價格頁）。呢啲計劃用積金局月底價。
"""
import re
import unicodedata

SITES = [
    {"key": "hsbc", "name": "滙豐", "scheme": "HSBC Mandatory Provident Fund - SuperTrust Plus",
     "url": "https://www.hsbc.com.hk/zh-hk/mpf/tool/unit-prices/",
     "wait": r"65歲後基金\s+\d+\.\d{4}", "date": r"基金價格\s*(\d{4})年(\d{1,2})月(\d{1,2})日"},
    {"key": "hangseng", "name": "恒生", "scheme": "Hang Seng Mandatory Provident Fund - SuperTrust Plus",
     "url": "https://www.hangseng.com/zh-hk/personal/insurance-mpf/e-mpf/fund-price-performance/",
     "wait": r"65歲後基金\s+\d+\.\d{4}", "dateInput": "unitPrice-datePicker"},
    {"key": "boc-easy", "name": "中銀保誠（簡易）", "scheme": "BOC-Prudential Easy-Choice Mandatory Provident Fund Scheme",
     "url": "https://www.bocpt.com/homepage/easy-choice-mpf/fund-price-enquiry/",
     "wait": r"基金\s+\d+\.\d{5}", "dateInput": "StartDate"},
    {"key": "boc-my", "name": "中銀保誠（我的）", "scheme": "My Choice Mandatory Provident Fund Scheme",
     "url": "https://www.bocpt.com/homepage/my-choice-mpf/fund-price-enquiry/",
     "wait": r"基金\s+\d+\.\d{5}", "dateInput": "StartDate"},
    {"key": "yf", "name": "萬通", "scheme": "MASS Mandatory Provident Fund Scheme",
     "url": "https://www.yflife.com/tc/product/mpf-hongkong/fund-price-history/",
     "wait": r"基金\s+HK\s+\d+\.\d{4}", "date": r"(\d{1,2})/(\d{1,2})/(\d{4})", "mdy": True},
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
NUM = re.compile(r"^\d{1,4}(?:,\d{3})*\.\d{2,6}$")


def norm_zh(s):
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[（(][^）)]*(風險降低|de-risking)[^）)]*[）)]", "", s)
    s = re.sub(r"[\s　*＊^#]+", "", s)
    if not re.search(r"\d{4}基金$", s):      # footnote digits at the end, but keep "2050基金"
        s = re.sub(r"\d+$", "", s)
    return s


def parse_rows(text):
    """[(name, price)]. Table rows usually come as "name<TAB>...<TAB>price..." (first number = bid price);
    some sites put each cell on its own line, so also accept "name line, then a number line"."""
    out = []
    for raw in text.splitlines():
        cells = [c.strip() for c in raw.split("\t") if c.strip()]
        if len(cells) >= 2 and not NUM.match(cells[0]) and len(cells[0]) <= 40:
            nums = [c for c in cells[1:] if NUM.match(c)]
            if nums:
                out.append((cells[0], float(nums[0].replace(",", ""))))
    if out:
        return out
    lines = [l.strip() for l in text.replace("\t", "\n").splitlines()]
    lines = [l for l in lines if l]
    for i, l in enumerate(lines[:-1]):
        if NUM.match(l) or len(l) > 40:
            continue
        if NUM.match(lines[i + 1]):
            out.append((l, float(lines[i + 1].replace(",", ""))))
    return out


def page_date(text, inputs, site):
    if site.get("date"):
        m = re.search(site["date"], text)
        if m and site.get("mdy"):
            return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        if m:
            return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    if site.get("dateInput"):
        for name, val in inputs:
            if site["dateInput"] in name:
                m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", val)
                if m:
                    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def fetch_all(sites=SITES, timeout_ms=45000):
    """{site key: (date, [(name, price)], error)}"""
    from playwright.sync_api import sync_playwright
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for s in sites:
            try:
                pg = b.new_page(locale="zh-HK", user_agent=UA)
                pg.goto(s["url"], wait_until="domcontentloaded", timeout=60000)
                pg.wait_for_function("t => new RegExp(t).test(document.body.innerText)", arg=s["wait"], timeout=timeout_ms)
                text = pg.inner_text("body")
                inputs = pg.evaluate("() => [...document.querySelectorAll('input')].map(i => [i.name || i.id || '', i.value || ''])")
                d = page_date(text, inputs, s)
                res[s["key"]] = (d, parse_rows(text), None if d else "搵唔到價格日期")
                pg.close()
            except Exception as e:
                res[s["key"]] = (None, [], str(e).splitlines()[0][:200])
        b.close()
    return res


def match_rows(mk, site, rows):
    """map page rows to MPFA ids using the scheme's Chinese fund names"""
    cands = [f for f in mk.funds.values() if f.get("schemeEn") == site["scheme"]]
    by = {}
    for f in cands:
        by.setdefault(norm_zh(f["fund"]), []).append(f["id"])
    out = {}
    for name, price in rows:
        ids = by.get(norm_zh(name))
        if ids and len(ids) == 1 and ids[0] not in out:
            out[ids[0]] = price
    missing = [f["fund"] for f in cands if f["id"] not in out]
    return out, missing
