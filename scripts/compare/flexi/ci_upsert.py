# upsert CI entries (by id) into advisor-tools/data/compare/ci/plans.json; entries come from a python file defining PLANS
import json, sys, runpy
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
SITE = Path(__file__).resolve().parents[3]   # advisor-tools
INS = {
    "fwd": {"zh": "富衛人壽保險（百慕達）有限公司", "en": "FWD Life Insurance Company (Bermuda) Limited"},
    "sunlife": {"zh": "香港永明金融有限公司", "en": "Sun Life Hong Kong Limited"},
    "yf": {"zh": "萬通保險國際有限公司", "en": "YF Life Insurance International Limited"},
    "ctf": {"zh": "周大福人壽保險有限公司", "en": "Chow Tai Fook Life Insurance Co Ltd"},
}
SRC = {
    "fwd": ("富衛官網：產品小冊子", "FWD website: product brochure"),
    "sunlife": ("永明官網：產品小冊子", "Sun Life website: product brochure"),
    "yf": ("萬通官網：產品小冊子", "YF Life website: product brochure"),
    "ctf": ("周大福人壽官網：產品小冊子", "CTF Life website: product brochure"),
}
ORDER = ["id", "insurer", "plan", "type", "rider", "renewal", "coverText", "issueAges", "pricing", "premiumFile",
         "diseases", "otherCover", "earlyText", "multiClaim", "multiText", "totalCapPct", "capText", "waitingDays",
         "premiumText", "premiumGuaranteed", "cashValue", "extras", "premiumSourceUrl", "termsUrl", "source",
         "sourceUrl", "updatedOn", "verified"]


def build(e):
    co = e.pop("co")
    brochure = e.pop("brochure", None)
    src = e.pop("src", None) or SRC[co]
    out = {"insurer": INS[co], "rider": False, "renewal": None, "pricing": "quote", "premiumFile": None,
           "otherCover": None, "earlyText": None, "multiClaim": None, "multiText": None, "totalCapPct": None,
           "capText": None, "waitingDays": None, "premiumText": None, "premiumGuaranteed": None, "cashValue": None,
           "extras": {"zh": [], "en": []}, "premiumSourceUrl": None,
           "termsUrl": ({"zh": brochure, "en": brochure} if isinstance(brochure, str) else brochure),
           "source": {"zh": src[0], "en": src[1]}, "updatedOn": "2026-11-05", "verified": False}
    out.update(e)
    return {k: out.get(k) for k in ORDER}


def main(path):
    plans_file = SITE / "data/compare/ci/plans.json"
    data = json.loads(plans_file.read_text(encoding="utf-8"))
    new = [build(dict(e)) for e in runpy.run_path(path)["PLANS"]]
    ids = {p["id"]: i for i, p in enumerate(data["plans"])}
    for p in new:
        if p["id"] in ids:
            data["plans"][ids[p["id"]]] = p
            print("updated", p["id"])
        else:
            data["plans"].append(p)
            print("added", p["id"])
    plans_file.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("total", len(data["plans"]))


if __name__ == "__main__":
    main(sys.argv[1])
