# 讀一份小冊子嘅「Cover at a glance」／保障一覽同保費表位置（俾 Claude 逐份核對用）
import re, sys
from pathlib import Path
import pypdf
sys.stdout.reconfigure(encoding="utf-8")
fn = Path(sys.argv[1]); n = int(sys.argv[2]) if len(sys.argv) > 2 else 2200
t = re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in pypdf.PdfReader(str(fn)).pages))
for head in (r"[Cc]over at a glance|[Pp]lan at a glance|[Kk]ey [Ff]eatures at a glance|[Aa]t a [Gg]lance",):
    ms = list(re.finditer(head, t))
    if ms:
        m = ms[-1] if len(ms) > 1 and len(t) - ms[-1].start() > 1500 else ms[0]
        print("== GLANCE ==", t[m.start():m.start() + n])
        break
else:
    print("== START ==", t[:n])
for lab, pat in (("RATE", r"[Pp]remium [Rr]ates?|[Pp]remium [Tt]able|per (?:US\$|HK\$)[^ ]*\s?1,000"),):
    hits = [m.start() for m in re.finditer(pat, t)]
    print(f"== {lab} hits: {len(hits)}")
    if hits:
        print(t[hits[0]:hits[0] + 600])
