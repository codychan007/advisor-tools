"""
醫療及危疾比較：將 plans.json + premiums/*.csv 合併成瀏覽器一次讀晒嘅 plans.compiled.json
（工具箱網站冇 build，所以 compiled 檔要 commit 埋。改完數據一定要行一次。）

  python scripts/compare/build_compare.py           # 生成
  python scripts/compare/build_compare.py --check   # 只檢查 compiled 檔係咪最新（GitHub 自動行）

未核實（verified: false）嘅計劃唔會放入 compiled 檔，網站唔顯示。
邏輯同保障資訊通 scripts/build.py 嘅 compile_medical／compile_ci 一樣（2026-11-15 搬過嚟）。
"""
import csv
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
DATA = Path(__file__).resolve().parent.parent.parent / "data" / "compare"
KEYS = ("male_ns", "male_s", "female_ns", "female_s")


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    v = (v or "").replace(",", "").strip()
    return float(v) if v not in ("", "-") else None


def compile_medical():
    src = DATA / "medical"
    D = json.loads((src / "plans.json").read_text(encoding="utf-8"))
    D["plans"] = [p for p in D["plans"] if p.get("verified")]
    for p in D["plans"]:
        for v in p["variants"]:
            # CSV：entryFrom,entryTo,age,male_ns,male_s,female_ns,female_s（entryFrom/To = 投保年齡組；冇就當 0–100）
            bands = {}
            for r in read_csv(src / v["premiumFile"]):
                a = int(r["age"])
                if not 0 <= a <= 100:
                    continue
                key = (int(num(r.get("entryFrom")) or 0), int(num(r.get("entryTo")) if r.get("entryTo") else 100))
                t = bands.setdefault(key, {k: [None] * 101 for k in KEYS})
                for k in t:
                    t[k][a] = num(r.get(k))
            v["bands"] = [{"from": lo, "to": hi, "premiums": t} for (lo, hi), t in sorted(bands.items())]
    return src / "plans.compiled.json", D


def compile_ci():
    src = DATA / "ci"
    D = json.loads((src / "plans.json").read_text(encoding="utf-8"))
    D["plans"] = [p for p in D["plans"] if p.get("verified")]
    for p in D["plans"]:
        # CSV：age,male_ns,male_s,female_ns,female_s（該保額嘅年保費）
        rates = {k: [None] * 101 for k in KEYS}
        if p.get("premiumFile"):
            for r in read_csv(src / p["premiumFile"]):
                a = int(r["age"])
                if 0 <= a <= 100:
                    for k in rates:
                        rates[k][a] = num(r.get(k))
        p["rates"] = rates
    return src / "plans.compiled.json", D


# ---------- 保單整理器用嘅產品名索引（2026-11-21，Cody 要求本機試打通） ----------
# 每項：id、src（med 自願醫保靈活／std 標準／ci 危疾／old 已停售）、co（公司名，對公司用）、names（產品名，對名用）、
# codes（自願醫保認可編號）、group（同一產品唔同選項）、label、status、fill（可以預填嘅「同一產品一樣」格）、facts（交俾 AI 對照嘅一句）
ALIAS = {   # 保單上常見嘅公司寫法
    "AIA": ["AIA", "友邦"], "Manulife": ["Manulife", "宏利"], "Prudential": ["Prudential", "保誠"], "AXA": ["AXA", "安盛"],
    "FWD": ["FWD", "富衛"], "Sun Life": ["Sun Life", "永明"], "Chow Tai Fook": ["CTF", "周大福", "FTLife", "富通"],
    "CTF Life": ["CTF", "周大福", "FTLife", "富通"], "YF Life": ["YF Life", "萬通", "MassMutual"], "HSBC": ["HSBC", "滙豐", "匯豐"],
    "BOC": ["BOC", "中銀"], "Bank of China": ["BOC", "中銀"], "Hang Seng": ["Hang Seng", "恒生"], "Bupa": ["Bupa", "保柏"],
    "Bowtie": ["Bowtie", "保泰"], "Chubb": ["Chubb", "安達"], "Zurich": ["Zurich", "蘇黎世"], "Blue Cross": ["Blue Cross", "藍十字"],
    "China Life": ["China Life", "中國人壽"], "China Taiping": ["China Taiping", "太平"], "MSIG": ["MSIG", "三井住友"],
    "Hong Kong Life": ["Hong Kong Life", "香港人壽"], "Liberty": ["Liberty", "利寶"], "Bolttech": ["bolttech", "保特"],
    "Asia Insurance": ["Asia Insurance", "亞洲保險"], "CIGNA": ["Cigna", "信諾"], "Well Link": ["Well Link", "立橋"],
    "MetLife": ["MetLife", "大都會"],
}


def aliases(zh, en):
    out = [x for k, v in ALIAS.items() if k.lower() in (en or "").lower() for x in v]
    return sorted(set(out + [zh] if zh else out))


def names_of(*names):   # 「A」／「B」、A / B 拆開，兩個名都認
    out = set()
    for n in names:
        if n:
            out.add(n)
            out.update(x.strip() for x in __import__("re").split(r"／| / ", n) if x.strip())
    return sorted(out)


def money(v):
    if v == "none":
        return "不設"
    if isinstance(v, (int, float)):
        return f"${v:,.0f}"
    if isinstance(v, dict):
        return v.get("zh") or "見條款"
    return v or "見條款"


def ps_index():
    items = []
    M = json.loads((DATA / "medical" / "plans.json").read_text(encoding="utf-8"))
    for p in M["plans"]:
        if not p.get("verified"):
            continue
        full, base = p["plan"]["zh"], p["plan"]["zh"].split("・")[0]
        room = (p.get("roomLimit") or {}).get("zh") or ""
        med = f"實報實銷；每年限額{money(p.get('annualLimit'))}；終身限額{money(p.get('lifetimeLimit'))}" + (f"；房租{room}" if room and room != "全數賠償" else "")
        items.append({"id": p["id"], "src": "med", "co": aliases(p["insurer"]["zh"], p["insurer"]["en"]),
                      "names": sorted({full, base, p["plan"]["en"], p["plan"]["en"].split(" · ")[0]}), "base": base,
                      "codes": sorted({p["certNo"]} | {v["certNo"] for v in p["variants"] if v.get("certNo")}), "group": p["certNo"],
                      "label": full, "status": "on", "fill": {"coverage": "自願醫保-醫療", "medical": med[:60]},
                      "facts": f"{full}（自願醫保靈活計劃，認可編號 {p['certNo']}）：{med}"})
    S = json.loads((DATA / "medical" / "vhis-standard.json").read_text(encoding="utf-8"))
    for p in S["plans"]:
        if p["id"].endswith("-rider"):
            continue
        items.append({"id": "std-" + p["certNo"], "src": "std", "co": aliases(p["insurer"]["zh"], p["insurer"]["en"]),
                      "names": sorted({p["plan"]["zh"], p["plan"]["en"]}), "base": p["plan"]["zh"], "codes": [p["certNo"]], "group": p["certNo"][:6],
                      "label": p["plan"]["zh"], "status": "renewal-only" if p.get("renewalOnly") else "on",
                      "fill": {"coverage": "自願醫保-醫療", "medical": "自願醫保標準計劃：保障同所有標準計劃一樣（政府劃一）"},
                      "facts": f"{p['plan']['zh']}（自願醫保標準計劃，認可編號 {p['certNo']}）"})
    C = json.loads((DATA / "ci" / "plans.json").read_text(encoding="utf-8"))
    kind = {"savings": "儲蓄型-危疾", "renewable": "消費型-危疾", "level": "消費型-危疾"}
    for p in C["plans"]:
        if not p.get("verified"):
            continue
        d = p.get("diseases") or {}
        bits = [f"{d['severe']} 種嚴重疾病" if d.get("severe") else "", f"{d['early']} 種早期／非嚴重疾病" if d.get("early") else "",
                ((p.get("coverText") or {}).get("zh") or ""), ((p.get("earlyText") or {}).get("zh") or ""), ((p.get("multiText") or {}).get("zh") or "")]
        items.append({"id": p["id"], "src": "ci", "co": aliases(p["insurer"]["zh"], p["insurer"]["en"]),
                      "names": names_of(p["plan"]["zh"], p["plan"]["en"]), "base": p["plan"]["zh"], "codes": [], "group": p["id"],
                      "label": p["plan"]["zh"], "status": "on", "fill": {"coverage": kind.get(p.get("type"), "危疾")},
                      "facts": f"{p['plan']['zh']}（危疾）：" + "；".join(b for b in bits if b)[:300]})
    O = json.loads((DATA / "stopped.json").read_text(encoding="utf-8"))
    for p in O["products"]:
        zh, en = p["name"].get("zh"), p["name"].get("en")
        cat = p["category"]["zh"]
        cov = "自願醫保-醫療" if cat == "自願醫保" else ("醫療" if p["kind"] == "med" else "危疾")
        seen = f"官網 {p['seen'][0]} 至 {p['seen'][1]} 出現" if p.get("seen") else ""
        items.append({"id": "old-" + p["id"], "src": "old", "co": aliases(p["brand"]["zh"], p["brand"]["en"]),
                      "names": names_of(zh, en), "base": zh or en, "codes": [p["certNo"]] if p.get("certNo") else [],
                      "group": "old-" + p["id"], "label": zh or en, "status": p["status"], "seen": p.get("seen"),
                      "url": (p.get("sources") or [{}])[0].get("url"), "fill": {"coverage": cov},
                      "facts": f"{zh or en}（{cat}，{'只供續保' if p['status'] == 'renewal-only' else '已停售'}{'；' + seen if seen else ''}）"})
    return DATA / "ps-index.json", {"_說明": "保單整理器用嘅產品名索引，由 build_compare.py 自動生成，唔好人手改。",
                                     "items": items}


def main():
    check = "--check" in sys.argv
    stale = []
    for fn in (compile_medical, compile_ci, ps_index):
        out, D = fn()
        text = json.dumps(D, ensure_ascii=False, separators=(",", ":"))
        if check:
            if not out.is_file() or out.read_text(encoding="utf-8") != text:
                stale.append(out.relative_to(DATA.parent.parent).as_posix())
        else:
            out.write_text(text, encoding="utf-8")
            print(f"✅ {out.relative_to(DATA.parent.parent).as_posix()}：" + (f"{len(D['plans'])} 個已核實計劃" if "plans" in D else f"{len(D['items'])} 個產品名（保單整理器用）"))
    if stale:
        print("❌ compiled 檔唔係最新，請執行 python scripts/compare/build_compare.py 再 commit：", ", ".join(stale))
        sys.exit(1)
    if check:
        print("✅ compiled 檔係最新")


if __name__ == "__main__":
    main()
