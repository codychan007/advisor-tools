# 讀小冊子入面「每 $1,000 保額」年保費率表：每組 = 年齡（或 18 - 25）+ 男非吸煙 + 男吸煙 + 女非吸煙 + 女吸煙
# 用 layout 模式讀，再用普通模式交叉檢查每個數字都喺 PDF 出現；對唔上就停低
import csv, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
pages = [int(x) for x in sys.argv[3].split(",")]
r = pypdf.PdfReader(str(src))
plain = " ".join((r.pages[i].extract_text() or "") for i in pages)
present = set(re.findall(r"\d+\.\d+", plain))
rows = {}
for i in pages:
    for line in r.pages[i].extract_text(extraction_mode="layout").splitlines():
        toks = line.split()
        # 合併斷開嘅數：「8.2 5」→「8.25」（之後會再對 PDF 普通模式）
        merged = []
        for tk in toks:
            prev = merged[-1] if merged else ""
            if (re.fullmatch(r"\d", tk) and re.fullmatch(r"\d+\.\d", prev)) \
                    or (re.fullmatch(r"\d{1,2}", tk) and re.fullmatch(r"\d+\.", prev)) \
                    or (re.fullmatch(r"\.\d{1,2}", tk) and re.fullmatch(r"\d+", prev)):
                merged[-1] += tk
            else:
                merged.append(tk)
        j = 0
        while j < len(merged):
            m = re.fullmatch(r"(\d{1,2})(\*?)", merged[j])
            rng = None
            if j + 2 < len(merged) and m and merged[j + 1] == "-" and re.fullmatch(r"\d{1,2}", merged[j + 2]):
                rng = (int(m.group(1)), int(merged[j + 2]))
                j += 3
            elif m:
                rng = (int(m.group(1)), int(m.group(1)))
                j += 1
            else:
                j += 1
                continue
            vals = merged[j:j + 4]
            if len(vals) == 4 and all(re.fullmatch(r"\d+\.\d+", v) for v in vals):
                for a in range(rng[0], rng[1] + 1):
                    rows[a] = (vals, bool(m.group(2)))
                j += 4
bad = [(a, v) for a, (vals, _) in rows.items() for v in vals if v not in present]
ages = sorted(rows)
gaps = [a for a in range(ages[0], ages[-1] + 1) if a not in rows]
print(f"{src.name}: 年齡 {ages[0]}–{ages[-1]} 缺 {gaps} 對唔上 PDF：{bad[:6]}")
if bad or gaps:
    sys.exit(1)
with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["age", "male_ns", "male_s", "female_ns", "female_s", "renewalOnly"])
    for a in ages:
        vals, ren = rows[a]
        w.writerow([a, *vals, int(ren)])
print("寫入", dst, "；30 歲：", rows.get(30, (None,))[0])
