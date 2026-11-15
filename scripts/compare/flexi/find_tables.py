# 搵小冊子入面真正嘅「年齡 × 保費」表：一頁有 ≥12 行「年齡 + 幾個數字」先算
import re, sys
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
ROW = re.compile(r"^\s*\d{1,3}\*?(?:\s*-\s*\d{1,3}\*?)?\s+(?:[\d,]+\.?\d*\s+){1,}[\d,]+\.?\d*\s*$")
for fn in sys.argv[1:]:
    try:
        r = pypdf.PdfReader(fn)
    except Exception as e:
        print(fn, "ERR", e)
        continue
    hits = []
    for i, p in enumerate(r.pages):
        lines = (p.extract_text(extraction_mode="layout") or "").splitlines()
        n = sum(1 for l in lines if ROW.match(l))
        if n >= 12:
            head = " ".join(l.strip() for l in lines[:40] if re.search(r"[Pp]remium|per (?:HK|US)|Sum Assured|Age", l))[:160]
            hits.append(f"p{i}({n}): {head}")
    print(fn.split("/")[-1], "→", hits if hits else "冇保費表")
