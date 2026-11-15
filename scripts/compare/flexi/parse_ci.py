# 危疾保費表（每行：年齡 | 男非吸煙 | 男吸煙 | 女非吸煙 | 女吸煙）→ CSV（年保費）
# 月供表 × 12；「0 - 15」= 0 至 15 歲同一個數；「66*」= 只供續保
import csv, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
D = Path(sys.argv[1]); OUT = Path(sys.argv[2])
JOBS = [
    ("aia-sce-table-en.pdf", "aia-simple-care-essence.csv", 1),
    ("bowtie-Premium-Schedule-Term-Critical-Illness-500,000-02.pdf", "bowtie-term-ci.csv", 12),
    ("bowtie-Premium-Schedule-Term-CI-Multiple-Cover-500,000-02.pdf", "bowtie-term-ci-multiple.csv", 12),
    ("bowtie-Premium-Schedule-Term-CI-Early-Stage-Multiple-Cover-500,000-02.pdf", "bowtie-term-ci-early-multiple.csv", 12),
]
ROW = re.compile(r"^\s*(\d{1,3})\s*(?:-\s*(\d{1,3}))?\s*([*#^@]*)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$")
for src, dst, mult in JOBS:
    rows = {}
    for page in pypdf.PdfReader(str(D / src)).pages:
        for line in page.extract_text(extraction_mode="layout").splitlines():
            m = ROW.match(line)
            if not m:
                continue
            a0, a1 = int(m.group(1)), int(m.group(2) or m.group(1))
            vals = [float(x.replace(",", "")) * mult for x in m.group(4, 5, 6, 7)]
            for a in range(a0, a1 + 1):
                if a in rows and rows[a]["vals"] != vals:
                    raise SystemExit(f"{src}: {a} 歲有兩個唔同數")
                rows[a] = {"vals": vals, "renewalOnly": bool(m.group(3))}
    ages = sorted(rows)
    gaps = [a for a in range(ages[0], ages[-1] + 1) if a not in rows]
    with open(OUT / dst, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["age", "male_ns", "male_s", "female_ns", "female_s", "renewalOnly"])
        for a in ages:
            w.writerow([a, *[round(v, 2) for v in rows[a]["vals"]], int(rows[a]["renewalOnly"])])
    first_ren = min((a for a in ages if rows[a]["renewalOnly"]), default=None)
    print(f"{dst}: 年齡 {ages[0]}–{ages[-1]}，缺 {gaps}，續保專用由 {first_ren} 歲起；30 歲 {rows[30]['vals']}")
