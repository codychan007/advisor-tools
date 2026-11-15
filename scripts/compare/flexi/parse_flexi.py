# 由官方標準保費 PDF 抽「年繳・基本計劃」保費 → {age: {male_ns, male_s, female_ns, female_s}}
# 做法：每個數字欄按「正上方最近」嘅表頭字眼標籤（年繳／月繳、男／女、基本／附加契約、吸煙／非吸煙）。
# 唔肯定嘅一律 flag，唔估。
import collections, json, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")

AGE = re.compile(r"^(\d{1,3})[*+#^]*$")
NUM = re.compile(r"^[\d,]+(\.\d+)?$")
CATS = {
    "freq": [("H", r"半年繳|半年|Semi-?annual(?:ly)?|Half-?yearly"), ("Q", r"季繳|Quarterly"), ("M", r"月繳|Monthly"), ("A", r"年繳|全年|Annual(?:ly)?|Yearly")],
    "sex": [("F", r"女性|女|Female"), ("M", r"男性|男|Male")],
    "plan": [("R", r"附加契約|附加保障契約|Policy\s*rider|Rider"), ("B", r"基本計劃|基本保單|Basic\s*plan|Basic")],
    "smoke": [("N", r"非吸煙|Non-?\s*smoker"), ("S", r"吸煙|Smoker")],
}


def is_age(tok):
    m = AGE.match(tok)
    return bool(m) and int(m.group(1)) <= 130 and "," not in tok and "." not in tok


def keywords(line):
    """回傳 [(cat, val, x中心)]；長字先配，配咗嘅位置遮住（例如 Semi-annual 唔會再當 Annual）"""
    found, mask = [], [False] * len(line)
    for cat, pats in CATS.items():
        for val, pat in pats:
            for m in re.finditer(pat, line, re.I):
                if any(mask[m.start():m.end()]):
                    continue
                for i in range(m.start(), m.end()):
                    mask[i] = True
                found.append((cat, val, (m.start() + m.end()) / 2))
    return found


def data_line(line):
    line = re.sub(r"(\d)\s+([*+#^]+)(?=\s|$)", lambda m: m.group(1) + m.group(2) + " " * (len(m.group(0)) - len(m.group(1)) - len(m.group(2))), line)
    toks = [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", line)]
    if len(toks) < 2:
        return None
    # 中銀格式：「15 天 days - 1 歲 aged 5,982 5,060」當 0 歲
    if re.search(r"天.*days", line):
        nums = [t for t in toks if NUM.match(t[0]) and ("," in t[0] or "." in t[0])]
        if nums:
            return [("0", toks[0][1], toks[0][2])] + nums + [("1", toks[0][1], toks[0][2])] + nums
    if not is_age(toks[0][0]):
        return None
    if not all(NUM.match(t) or is_age(t) for t, _, _ in toks):
        return None
    return toks


BAND = re.compile(r"介乎\s*(\d+)\s*至\s*(\d+)\s*歲|from\s+age\s+(\d+)\s+to\s+(\d+)", re.I)


def parse_pdf(fn):
    """回傳 cols: {(band, page, block, idx): {age: v}}, labels: {同 key: {sex, plan, smoke, freq, x}}"""
    r = pypdf.PdfReader(str(fn))
    cols = collections.defaultdict(dict)
    labels, basis = {}, "attained"
    full_text, last_band = "", None
    for pi, page in enumerate(r.pages):
        lines = [l for l in page.extract_text(extraction_mode="layout").splitlines() if l.strip()]
        full_text += " ".join(lines[:14]) + " "
        rows = [(k, data_line(l)) for k, l in enumerate(lines)]
        rows = [(k, t) for k, t in rows if t]
        if len(rows) < 5:
            continue
        first = rows[0][0]
        top = " ".join(lines[:first])
        bm = BAND.search(top)
        band = tuple(int(x) for x in (bm.group(1, 2) if bm and bm.group(1) else bm.group(3, 4))) if bm else last_band
        last_band = band
        head_lines = lines[max(0, first - 9):first]
        kws = [kw for hl in head_lines for kw in keywords(hl)]
        title_kws = [kw for hl in lines[:max(0, first - 9)] for kw in keywords(hl)]
        if re.search(r"下次生日|Next\s*Birthday", top, re.I):
            basis = "next"
        elif re.search(r"最接近|Nearest", top, re.I):
            basis = "nearest"
        page_freqs = {val for c, val, _ in kws + title_kws if c == "freq"}
        for k, toks in rows:
            blocks, cur = [], None
            for tok in toks:
                if is_age(tok[0]) and (cur is None or len(cur["vals"]) > 0):
                    cur = {"age": int(AGE.match(tok[0]).group(1)), "ax": tok[1], "vals": []}
                    blocks.append(cur)
                elif cur is not None and NUM.match(tok[0]):
                    cur["vals"].append(((tok[1] + tok[2]) / 2, float(tok[0].replace(",", ""))))
            for bi, b in enumerate(blocks):
                for vi, (x, v) in enumerate(b["vals"]):
                    key = (band, pi, round(b["ax"] / 8), vi)
                    cols[key][b["age"]] = v
                    if key not in labels:
                        lab = {"x": x, "pageFreqs": page_freqs}
                        for cat in ("sex", "plan", "smoke", "freq"):
                            cands = [(abs(kx - x), val) for c, val, kx in kws if c == cat]
                            if cands:
                                lab[cat] = min(cands)[1]
                            else:
                                tv = {val for c, val, _ in title_kws if c == cat}
                                if len(tv) == 1:
                                    lab[cat] = tv.pop()
                        labels[key] = lab
    # 年繳／月繳 用數值大細再核一次：同一頁同一年齡，年繳 ≈ 最大；月繳 ≈ 年繳 ÷ 12
    by_page = collections.defaultdict(list)
    for key in cols:
        by_page[(key[0], key[1])].append(key)
    for pk, keys in by_page.items():
        for key in keys:
            ratios = []
            for age, v in cols[key].items():
                peers = [cols[k2][age] for k2 in keys if age in cols[k2]]
                if peers:
                    ratios.append(v / max(peers))
            if not ratios:
                continue
            ratios.sort()
            med = ratios[len(ratios) // 2]
            mag = "A" if med > 0.6 else "H" if med > 0.4 else "Q" if med > 0.2 else "M"
            lab = labels[key]
            lab["mag"] = mag
            if "A" not in lab["pageFreqs"] and lab["pageFreqs"] and mag == "A":
                lab["mag"] = sorted(lab["pageFreqs"])[0]   # 成頁都冇年繳（例如淨係月繳）
    return cols, labels, basis, full_text


def pick(cols, labels):
    """揀 年繳・基本計劃 欄，按 入保年齡組 → 男女×吸煙 合併；冇年繳但有月繳就用 月繳×12（標 monthlyOnly）"""
    bands = collections.defaultdict(lambda: collections.defaultdict(dict))
    used = collections.Counter()
    has_annual = any(l.get("mag") == "A" for l in labels.values())
    monthly_only = not has_annual and any(l.get("mag") == "M" for l in labels.values())
    for key, lab in labels.items():
        want = "M" if monthly_only else "A"
        if lab.get("mag") != want or lab.get("plan") == "R":
            continue
        if lab.get("freq") and lab["freq"] != want:
            used["freq_mismatch"] += 1   # 表頭同數值大細唔一致 → 唔用，交人手
            continue
        mult = 12 if monthly_only else 1
        sexes = [lab["sex"]] if "sex" in lab else ["M", "F"]
        smokes = [lab["smoke"]] if "smoke" in lab else ["N", "S"]
        for sx in sexes:
            for sm in smokes:
                field = f"{'male' if sx == 'M' else 'female'}_{'ns' if sm == 'N' else 's'}"
                used[field] += 1
                out = bands[key[0]]
                for age, v in cols[key].items():
                    v = round(v * mult, 2)
                    if age in out and field in out[age] and abs(out[age][field] - v) > 0.01:
                        out[age][field + "_CONFLICT"] = v
                    out[age][field] = v
    return bands, used, monthly_only


def check(table, start=0):
    if not table:
        return "冇數"
    ages = sorted(table)
    if ages[0] > max(1, start):
        return f"最細年齡 {ages[0]}"
    missing = [a for a in range(max(ages[0], start), 81) if a not in table or len([k for k in table[a] if not k.endswith('CONFLICT')]) < 4]
    if missing:
        return f"缺年齡／欄 {missing[:6]}"
    conflicts = [a for a in ages if any(k.endswith("CONFLICT") for k in table[a])]
    if conflicts:
        return f"同一格有兩個唔同數 {conflicts[:5]}"
    bad = [a for a in ages if any(v <= 100 or v > 2_000_000 for k, v in table[a].items())]
    if bad:
        return f"數值唔合理 {bad[:5]}"
    return None


if __name__ == "__main__":
    S = Path(sys.argv[1])
    f = json.load(open(S / "vhis-dl/flexi-plans.json", encoding="utf-8-sig"))["certified-plans"]
    live = [p for p in f if not p.get("de-reg") and not p.get("unavailable") and not p.get("renewal-only")]
    data, report = {}, []
    for p in live:
        for i in p["plan-info-certified"]:
            if i.get("currency") != "HKD" or i.get("renewal-only"):
                continue
            name = i["premium-doc-url"]["zh-hk"].rsplit("/", 1)[-1]
            cols, labels, basis, _ = parse_pdf(S / "flexi-pdf/premium" / name)
            bands, used, monthly_only = pick(cols, labels)
            problems = [f"{b}: {check(t, b[0] if b else 0)}" for b, t in bands.items() if check(t, b[0] if b else 0)] if bands else ["冇數"]
            if used.get("freq_mismatch"):
                problems.append("表頭同數值大細唔一致")
            problem = "；".join(problems) or None
            data[name] = {"ok": problem is None, "problem": problem, "basis": basis, "monthlyOnly": monthly_only,
                          "bands": [{"newApp": list(b) if b else None, "table": {a: row for a, row in sorted(t.items())}} for b, t in bands.items()]}
            report.append((p["company-name"]["en"], name, problem))
    (S / "parsed.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    good = sum(1 for r in report if not r[2])
    print(f"OK {good}/{len(report)}")
    bad = collections.Counter((r[0], (r[2] or "").split(" ")[0]) for r in report if r[2])
    for (c, h), n in bad.most_common():
        ex = next(r[1] for r in report if r[0] == c and r[2] and r[2].startswith(h))
        print(f"  ✗ {n:3} {c[:38]:38} {h:14} e.g. {ex}")
