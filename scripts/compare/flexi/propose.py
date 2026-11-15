# 初步建議：每級嘅病房、每日房租、每年／終身限額（之後逐行人手核對）
import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
S = Path(sys.argv[1])
tiers = json.load(open(S / "tiers.json", encoding="utf-8"))
sn = json.load(open(S / "terms_snip.json", encoding="utf-8"))


def ward_of(text):
    if re.search(r"標準私家|私家房|私家病房", text) and not re.search(r"半私家", text):
        return "private"
    if re.search(r"半私家", text):
        return "semi-private"
    if re.search(r"普通房|普通病房|標準病房", text):
        return "standard"
    return None


def money(s):
    m = re.search(r"(?:\$|港元)\s?([\d,]{6,})", s) or re.search(r"([\d,]{7,})", s)
    return int(m.group(1).replace(",", "")) if m else None


rows = {}
for k, t in tiers.items():
    v = sn.get(k, {})
    w = ward_of(t["tier"]) or next((ward_of(h) for h in v.get("wardHits", []) if re.search(r"級別：|資格|受保病房", h) and ward_of(h)), None)
    room = next((re.search(r"每日\s?\$?\s?([\d,]+)|全數賠償|全數", r).group(0) for r in v.get("room", []) if re.search(r"每日\s?\$?\s?[\d,]+|全數", r)), None)
    ann = [money(a) for a in v.get("annual", []) if money(a)]
    ann_none = any(re.match(r"每年(?:總)?保障限額\s*(無|不設)", a) for a in v.get("annual", []))
    life = next((("無" if re.search(r"限額\s*(無|不設)|均不設終身", l) else money(l)) for l in v.get("life", [])), None)
    rows[k] = {"ward": w, "room": room, "annual": ann[:3], "annualNone": ann_none, "life": life}
(S / "proposal.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
for k, r in rows.items():
    flag = "" if r["ward"] and (r["annual"] or r["annualNone"]) else "  ⚠"
    print(f"{k[:34]:34} | {str(r['ward']):12} | 房 {str(r['room'])[:14]:14} | 年 {r['annual'] if r['annual'] else ('無' if r['annualNone'] else '?')} | 終身 {r['life']}{flag}")
