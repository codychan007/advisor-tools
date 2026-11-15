# 針對性抽句：供款期／投保年齡／保障期表、疾病數目、多次賠償、等候期、總賠償、現金價值
import re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
for fn in sys.argv[1:]:
    t = re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in pypdf.PdfReader(fn).pages))
    print("#####", Path(fn).stem)
    def show(label, pat, n=230, k=1):
        for i, m in enumerate(re.finditer(pat, t)):
            if i >= k:
                break
            print(f"  {label}: {t[m.start():m.start() + n]}")
    show("PAYTERM", r"Premium Payment Term", 260)
    show("COUNTS", r"\d{2,3} (?:critical illnesses|illnesses|diseases)[^.]{0,20}\(", 230)
    show("TIMES", r"(?:up to|Up to) (?:five|four|three|two|\d) (?:times|claims|additional)", 200, 2)
    show("PCT", r"\d{3,4}% (?:of|protection)", 160, 2)
    show("WAIT", r"waiting period of", 200, 2)
    show("EXCL", r"within 90 days|within \d+ days after the policy", 120)
    show("CASH", r"[Gg]uaranteed [Cc]ash [Vv]alue", 120)
    show("BONUS", r"Terminal (?:Dividend|Bonus)|Annual Dividend|Reversionary", 80)
    show("ISSUE", r"(?:Insured’s Age at (?:Policy Issue|Application)|Issue Age)", 160)
