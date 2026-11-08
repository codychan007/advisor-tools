"""產品溫習題庫：檢查 quiz-src/ 入面嘅題目，再合併做 data/quiz/*.json 俾網站用。

用法：python scripts/build_quiz.py      （有錯就唔會寫檔）

quiz-src/<產品 id>/*.json   每個產品自己嘅題目
quiz-src/compare/*.json     AIA 自己產品之間嘅比較題（"products" 標明涉及邊幾個產品）
quiz-src/products.json      產品清單（名、系列）
"""
import glob
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "quiz-src")
OUT = os.path.join(ROOT, "data", "quiz")
TYPES = {"single", "multi", "tf", "numeric", "match", "order"}
LEVELS = {"basic", "advanced"}


def load(pattern):
    qs = []
    for f in sorted(glob.glob(os.path.join(SRC, pattern))):
        for q in json.load(open(f, encoding="utf-8")):
            q["_file"] = os.path.relpath(f, ROOT)
            qs.append(q)
    return qs


def placeholders(text):
    return set(re.findall(r"\{(\w+)\}", text or ""))


def check(q, errs):
    where = f"{q.get('id')} ({q['_file']})"
    t = q.get("type")
    if t not in TYPES:
        errs.append(f"{where}: 題型唔啱 {t}")
        return
    if q.get("level") not in LEVELS:
        errs.append(f"{where}: level 唔啱")
    for k in ("id", "topic", "explain", "page"):
        if not q.get(k):
            errs.append(f"{where}: 冇 {k}")
    if t in ("single", "multi"):
        items = q.get("variants") or [q]
        for v in items:
            c, w = v.get("correct") or [], v.get("wrong") or []
            if not v.get("q"):
                errs.append(f"{where}: 冇題目")
            if not c:
                errs.append(f"{where}: 冇正確答案")
            if len(w) < 3 and t == "single":
                errs.append(f"{where}: 錯誤選項少過 3 個")
            if t == "single" and len(c) > 1 and not q.get("pickCorrect"):
                errs.append(f"{where}: 單選有多過一個正確答案但冇 pickCorrect")
            if set(c) & set(w):
                errs.append(f"{where}: 正確同錯誤選項重複 {set(c) & set(w)}")
            if len(set(c + w)) != len(c + w):
                errs.append(f"{where}: 選項重複")
        if t == "multi":
            pw = q.get("pickWrong", 2)
            if len(q.get("wrong", [])) < pw:
                errs.append(f"{where}: 錯誤選項唔夠抽")
    elif t == "tf":
        vs = q.get("versions") or []
        if not ({True, False} <= {v.get("answer") for v in vs}):
            errs.append(f"{where}: 是非題要有啱同錯兩個版本")
    elif t == "numeric":
        vs = q.get("variants") or []
        if not vs:
            errs.append(f"{where}: 數字題冇版本")
        for v in vs:
            text = v.get("q", q.get("q", ""))
            missing = placeholders(text) - set(v)
            if missing:
                errs.append(f"{where}: 題目有 {missing} 但版本冇提供")
            if not isinstance(v.get("answer"), (int, float)):
                errs.append(f"{where}: 數字題答案唔係數字")
        if not q.get("unit"):
            errs.append(f"{where}: 冇單位")
    elif t == "match":
        pairs = q.get("pairs") or []
        if len(pairs) < q.get("pick", 4):
            errs.append(f"{where}: 配對唔夠抽")
        if len({b for _, b in pairs}) != len(pairs) or len({a for a, _ in pairs}) != len(pairs):
            errs.append(f"{where}: 配對有重複")
    elif t == "order":
        if len(q.get("items") or []) < 3:
            errs.append(f"{where}: 排序項目太少")


def main():
    products = json.load(open(os.path.join(SRC, "products.json"), encoding="utf-8"))
    errs = []
    compare = load("compare/*.json")
    out_products = []
    seen = Counter()
    for p in products["products"]:
        qs = load(f"{p['id']}/*.json")
        for q in qs + compare:
            check(q, errs)
        for q in qs:
            seen[q["id"]] += 1
        own_cmp = [q for q in compare if p["id"] in q.get("products", [])]
        lv = Counter(q["level"] for q in qs + own_cmp)
        print(f"{p['short']}：自己 {len(qs)} 題＋比較 {len(own_cmp)} 題 → 基本 {lv['basic']}，進階 {lv['advanced']}")
        topics = Counter(q["topic"] for q in qs + own_cmp)
        print("  分類：" + "、".join(f"{k} {v}" for k, v in topics.most_common()))
        types = Counter(q["type"] for q in qs + own_cmp)
        print("  題型：" + "、".join(f"{k} {v}" for k, v in types.most_common()))
        out_products.append((p, qs))
    for q in compare:
        seen[q["id"]] += 1
        known = {p["id"] for p in products["products"]} | set(products.get("otherProducts", {}))
        for pid in q.get("products", []):
            if pid not in known:
                errs.append(f"{q['id']}: 未知產品 {pid}")
        if len(q.get("products", [])) < 2:
            errs.append(f"{q['id']}: 比較題要標明最少兩個產品")
    errs += [f"{k}: id 重複" for k, v in seen.items() if v > 1]
    if errs:
        print("\n有錯，冇寫檔：")
        print("\n".join(errs))
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)

    def clean(qs):
        return [{k: v for k, v in q.items() if not k.startswith("_")} for q in qs]

    for p, qs in out_products:
        with open(os.path.join(OUT, f"{p['id']}.json"), "w", encoding="utf-8") as f:
            json.dump({"product": p, "questions": clean(qs)}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "compare.json"), "w", encoding="utf-8") as f:
        json.dump({"questions": clean(compare)}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=1)
    print("\n寫好 data/quiz/")


if __name__ == "__main__":
    main()
