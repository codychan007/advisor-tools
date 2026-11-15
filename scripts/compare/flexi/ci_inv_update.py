# replace one insurer's product list in _inventory.json: python inv_update.py <insurer_en> <products.json>
import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
f = Path(__file__).resolve().parents[3] / "data/compare/ci/_inventory.json"
inv = json.loads(f.read_text(encoding="utf-8"))
prods = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
for i in inv["insurers"]:
    if i["insurer"] == sys.argv[1]:
        i["products"] = prods
        break
else:
    raise SystemExit("insurer not found")
f.write_text(json.dumps(inv, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
from collections import Counter
print(Counter(p["status"] for i in inv["insurers"] for p in i["products"]))
