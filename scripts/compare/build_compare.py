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


def main():
    check = "--check" in sys.argv
    stale = []
    for fn in (compile_medical, compile_ci):
        out, D = fn()
        text = json.dumps(D, ensure_ascii=False, separators=(",", ":"))
        if check:
            if not out.is_file() or out.read_text(encoding="utf-8") != text:
                stale.append(out.relative_to(DATA.parent.parent).as_posix())
        else:
            out.write_text(text, encoding="utf-8")
            print(f"✅ {out.relative_to(DATA.parent.parent).as_posix()}：{len(D['plans'])} 個已核實計劃")
    if stale:
        print("❌ compiled 檔唔係最新，請執行 python scripts/compare/build_compare.py 再 commit：", ", ".join(stale))
        sys.exit(1)
    if check:
        print("✅ compiled 檔係最新")


if __name__ == "__main__":
    main()
