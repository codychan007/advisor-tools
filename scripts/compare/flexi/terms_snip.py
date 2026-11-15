# 每級條款抽保障表重點：受保病房、病房及膳食限額、每年／終身保障限額（唔要定義句）
import json, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1])
tiers = json.load(open(S / "tiers.json", encoding="utf-8"))
only = sys.argv[2:] or None
WARD = r"(?:普通病房|普通房|標準病房|半私家病房|半私家房間?|標準私家病房|標準私家房間?|私家病房|私家房間?)"


def clean(s):
    return re.sub(r"\s+", " ", s).strip()


def values(t, label, n=90, k=4):
    out = []
    for m in re.finditer(label, t):
        seg = clean(t[m.start():m.end() + n])
        if "是指" in seg or "均不設" in seg[:30] and False:
            continue
        if re.search(r"\$\s?[\d,]{5,}|[\d,]{6,}|無|不設|全數|每日", seg):
            if seg not in out:
                out.append(seg)
        if len(out) >= k:
            break
    return out


out = {}
for key, tr in tiers.items():
    if only and not any(key.startswith(o) for o in only):
        continue
    fn = S / "flexi-pdf/tierdoc" / tr["planDoc"]["zh-hk"].rsplit("/", 1)[-1]
    if not fn.exists():
        out[key] = {"err": "未下載"}
        continue
    try:
        t = "\n".join((pg.extract_text() or "") for pg in pypdf.PdfReader(str(fn)).pages)
    except Exception as e:
        out[key] = {"err": str(e)}
        continue
    wards = []
    for m in re.finditer(r"(?:受保病房|病房級別|病房類別|病房)[^。\n]{0,25}?" + WARD, t):
        s = clean(m.group(0))
        if s not in wards:
            wards.append(s)
    out[key] = {
        "wardHits": wards[:5],
        "room": values(t, r"病房及膳食", 70, 3),
        "annual": values(t, r"每年(?:總)?保障限額", 70, 3),
        "life": values(t, r"終身(?:總)?保障限額", 60, 2),
    }
(S / "terms_snip.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
for k, v in out.items():
    if "err" in v:
        print(f"### {k} ERR {v['err']}")
        continue
    print(f"### {k} | ded {sorted({l['deductible'] for l in tiers[k]['levels']})} | areas {sorted({l['area'] for l in tiers[k]['levels']})}")
    print("  W:", " ¦ ".join(x[:60] for x in v["wardHits"]))
    for x in v["room"][:2]: print("  R:", x[:120])
    for x in v["annual"][:3]: print("  A:", x[:120])
    for x in v["life"][:1]: print("  L:", x[:100])
