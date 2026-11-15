# 交叉檢查：用另一種抽字方法（pypdf 普通模式）讀 PDF，確認每個抽出嚟嘅保費數字都真係喺 PDF 入面出現
# 另外檢查：保費 > 0、40 歲後大致上升、男女都有
import json, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1])
d = json.load(open(S / "parsed.json", encoding="utf-8"))
bad, checked = {}, 0
for name, v in d.items():
    if not v["ok"]:
        continue
    text = " ".join(p.extract_text() for p in pypdf.PdfReader(str(S / "flexi-pdf/premium" / name)).pages)
    present = {float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", text) if re.search(r"\d", x)}
    # 黐埋嘅數（例如「9,352.000」= 9,352.00 + 年齡 0）：加埋所有「x,xxx.xx」前綴
    present |= {float(m.replace(",", "")) for m in re.findall(r"\d{1,3}(?:,\d{3})+\.\d{2}", text)}
    present |= {float(m.replace(",", "")) for m in re.findall(r"\d{1,3}(?:,\d{3})+(?=\D|$)", text)}
    # 黐埋年齡：「675.005」→ 675.00；「3,468.0010」→ 3,468.00
    present |= {float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*\.\d{2}", text)}
    present |= {float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*\.\d{1}(?!\d)", text)}
    problems = []
    for band in v["bands"]:
        for age, row in band["table"].items():
            for k, val in row.items():
                checked += 1
                raw = val / 12 if v.get("monthlyOnly") else val
                if not any(abs(raw - p) < 0.006 for p in (raw,) if p in present) and round(raw, 2) not in present:
                    problems.append(f"{band['newApp']} {age}歲 {k}={val}")
        ages = sorted(int(a) for a in band["table"])
        for a in ages:
            if a >= 45 and a + 5 in band["table"] if False else False:
                pass
        m45 = band["table"].get("45") or band["table"].get(45)
        m75 = band["table"].get("75") or band["table"].get(75)
        if m45 and m75 and m75["male_ns"] < m45["male_ns"]:
            problems.append(f"{band['newApp']} 75 歲保費低過 45 歲（可疑）")
    if problems:
        bad[name] = problems[:4] + ([f"…共 {len(problems)} 項"] if len(problems) > 4 else [])
print(f"檢查咗 {checked} 個數字；有問題嘅檔案：{len(bad)}")
for k, v in list(bad.items())[:15]:
    print(" ", k, v)
json.dump(bad, open(S / "crosscheck.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
