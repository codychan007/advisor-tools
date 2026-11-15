# 每份小冊子抽 8 類關鍵句（每類最多 1–2 句、每句 170 字）
import re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
PATS = [
    ("ISSUE", r"(?:[Ii]ssue [Aa]ge|[Aa]ge at (?:[Ii]ssue|[Aa]pplication|[Ee]ntry)|[Ee]ntry [Aa]ge)[^.]{0,150}"),
    ("TERM", r"(?:[Bb]enefit [Tt]erm|[Pp]rotection [Pp]eriod|[Pp]olicy [Tt]erm|[Cc]overage [Tt]erm)[^.]{0,150}"),
    ("PAY", r"[Pp]remium [Pp]ayment [Tt]erm[^.]{0,150}"),
    ("COUNT", r"\b\d{2,3} (?:disease conditions|illnesses|critical illnesses|covered illnesses|conditions|diseases)[^.]{0,140}"),
    ("MAJOR", r"\b\d{1,3} (?:[Mm]ajor|[Ee]arly[- ][Ss]tage|[Mm]inor|[Jj]uvenile|[Ss]evere [Cc]hild)[^.]{0,120}"),
    ("MULTI", r"(?:up to \d+ times|[Mm]ultiple [Cc]laims?|[Ee]xtended [Mm]ajor [Dd]isease|[Cc]ontinuous [Cc]ancer)[^.]{0,150}"),
    ("CAP", r"(?:up to \d{3,4}%|\d{3,4}% (?:of the|protection))[^.]{0,120}"),
    ("WAITGAP", r"(?:at least \d+ years?|waiting period of \d+)[^.]{0,120}"),
    ("CURR", r"(?:[Pp]olicy [Cc]urrency|denominated in)[^.]{0,60}"),
]
for fn in sys.argv[1:]:
    t = re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in pypdf.PdfReader(fn).pages))
    print("#####", Path(fn).stem)
    for tag, pat in PATS:
        seen = []
        for m in re.finditer(pat, t):
            s = m.group(0)[:170]
            if s not in seen:
                seen.append(s)
            if len(seen) >= (2 if tag in ("COUNT", "MAJOR", "MULTI") else 1):
                break
        for s in seen:
            print(f"  {tag}: {s}")
