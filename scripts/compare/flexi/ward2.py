# 病房級別第二輪：只接受「病房級別／受保病房 + 病房名」嘅表格行，排除定義句
import json, re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1])
tiers = json.load(open(S / "tiers.json", encoding="utf-8"))
prop = json.load(open(S / "proposal.json", encoding="utf-8"))
WARDRX = r"(標準私家病房|標準私家房間?|私家病房|私家房間?|標準半私家病房|標準半私家房|半私家病房|半私家房間?|標準普通病房|普通病房|普通房|標準病房|大房)"
NORM = lambda w: "semi-private" if "半私家" in w else "private" if "私家" in w else "standard"
cache = {}


def text_of(fn):
    if fn not in cache:
        cache[fn] = re.sub(r"\s+", " ", "\n".join((pg.extract_text() or "") for pg in pypdf.PdfReader(str(fn)).pages))
    return cache[fn]


res = {}
for k, t in tiers.items():
    fn = S / "flexi-pdf/tierdoc" / t["planDoc"]["zh-hk"].rsplit("/", 1)[-1]
    txt = text_of(fn)
    found = []
    for m in re.finditer(r"(受保病房|病房級別|病房類別)\s*(?:\(\d+\)|（\d+）|[：:﹕])?\s*(?:「)?\s*" + WARDRX, txt):
        ctx = txt[max(0, m.start() - 25):m.end() + 15]
        if re.search(r"是指|低於|高於|不包括|例如|升級|較高|較低|或以上|或以下", ctx):
            continue
        found.append(NORM(m.group(2)))
    name_w = None
    if re.search(r"半私家", t["tier"]):
        name_w = "semi-private"
    elif re.search(r"私家", t["tier"]):
        name_w = "private"
    elif re.search(r"普通", t["tier"]):
        name_w = "standard"
    uniq = sorted(set(found))
    if name_w:
        ward, why = name_w, "等級名稱"
    elif len(uniq) == 1:
        ward, why = uniq[0], f"條款「病房級別」×{len(found)}"
    elif uniq:
        ward, why = None, f"條款有多個：{uniq}"
    else:
        ward, why = None, "條款冇指定"
    res[k] = {"ward": ward, "why": why, "room": prop[k]["room"], "annual": prop[k]["annual"], "annualNone": prop[k]["annualNone"], "life": prop[k]["life"]}
(S / "ward2.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
import collections
print(collections.Counter((v["ward"] is not None, v["why"].split("：")[0].split("×")[0]) for v in res.values()))
for k, v in res.items():
    if v["ward"] is None:
        print(f"{k[:32]:32} | {v['why'][:40]:40} | 房 {v['room']}")
