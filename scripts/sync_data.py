"""將 medical-saving skill 嘅醫保保費表抄過嚟網站（每半年 skill 跑完 build_premiums.py 之後跑一次）。

用法：python scripts/sync_data.py
"""
import json
import shutil
import sys
from pathlib import Path

SRC = Path.home() / ".claude/skills/medical-saving/data/aia-medical-premiums.json"
DST = Path(__file__).resolve().parent.parent / "data/aia-medical-premiums.json"

new = json.loads(SRC.read_text(encoding="utf-8"))
old = json.loads(DST.read_text(encoding="utf-8")) if DST.exists() else {}
for k in ("standard", "flexi", "selectwise", "privilege_ultra"):
    if k not in new["plans"]:
        sys.exit(f"skill 資料冇 {k}，網站會壞，唔抄")
shutil.copyfile(SRC, DST)
print(f"保費表 {old.get('generatedOn', '（冇）')} → {new['generatedOn']}")
for k, p in new["plans"].items():
    was = old.get("plans", {}).get(k, {}).get("effective")
    print(f"  {p['name']}：生效 {p['effective']}" + ("（改咗，舊係 " + was + "）" if was and was != p["effective"] else ""))
