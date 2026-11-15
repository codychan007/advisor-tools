# 下載危疾產品小冊子（每秒一個），抽重點句子：疾病數目、賠償比例、多次賠償、等候期、保障期、供款期、現金價值
import json, re, sys, time, urllib.request
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
items = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))   # [{"key","url"}]
PATS = [
    ("COUNT", r"\b\d{1,3}\s+(?:major|minor|early[- ]stage|critical|severe|juvenile|child(?:hood)?|carcinoma|illness|disease|conditions?)[^.]{0,80}"),
    ("PCT", r"\b\d{1,4}%\s+of\s+the\s+(?:sum|initial|notional|basic)[^.]{0,90}"),
    ("MULTI", r"(?:[Mm]ultiple|[Rr]ecurr|[Cc]ontinu|[Rr]elapse|[Pp]ersist)[^.]{0,140}"),
    ("WAIT", r"(?:waiting period|[Ww]aiting [Pp]eriod|\b\d+ days? (?:after|from)|exclusion period)[^.]{0,120}"),
    ("TERM", r"(?:[Bb]enefit [Tt]erm|[Cc]overage [Pp]eriod|[Pp]olicy [Tt]erm|[Rr]enew|up to age \d+|until age \d+|[Ww]hole[- ]?life)[^.]{0,100}"),
    ("PAY", r"(?:[Pp]remium [Pp]ayment [Tt]erm|[Pp]remium [Pp]ayment [Pp]eriod|\d+[- ]year premium|level premium|[Pp]remiums? (?:are|is) (?:guaranteed|non-guaranteed|not guaranteed))[^.]{0,100}"),
    ("CASH", r"(?:[Gg]uaranteed [Cc]ash [Vv]alue|[Cc]ash [Vv]alue|[Rr]efund of [Pp]remium|[Tt]erminal [Dd]ividend|[Rr]eversionary [Bb]onus)[^.]{0,80}"),
    ("AGE", r"(?:[Ii]ssue [Aa]ge|[Ee]ntry [Aa]ge|[Aa]ge at [Ii]ssue)[^.]{0,80}"),
    ("CAP", r"(?:[Tt]otal (?:benefit|payout|amount)[^.]{0,60}\d{2,4}%|up to \d{3,4}%)[^.]{0,80}"),
]
for it in items:
    fn = OUT / (it["key"] + ".pdf")
    if not fn.exists():
        try:
            req = urllib.request.Request(it["url"], headers={"User-Agent": "Mozilla/5.0 (HK-Life-Compass research)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                fn.write_bytes(r.read())
        except Exception as e:
            print(f"##### {it['key']} 下載失敗 {e}")
            continue
        time.sleep(1)
    try:
        t = re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in pypdf.PdfReader(str(fn)).pages))
    except Exception as e:
        print(f"##### {it['key']} 讀唔到 {e}")
        continue
    print(f"##### {it['key']}  ({len(t)} chars)")
    for tag, pat in PATS:
        seen = []
        for m in re.finditer(pat, t):
            s = m.group(0).strip()[:160]
            if s not in seen:
                seen.append(s)
            if len(seen) >= (4 if tag in ("COUNT", "PCT", "MULTI") else 2):
                break
        for s in seen:
            print(f"  {tag}: {s}")
