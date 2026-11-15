"""
生成「核實清單」：tests/checklist.html（只喺本機預覽用，唔會上網）
每間公司抽 2 個計劃 × 3 個年齡（30／45／60），列出網站數字同官方 PDF 連結，等 Cody 逐項對。
  python scripts/compare/make_checklist.py
"""
import csv, html, json, random, sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent.parent   # advisor-tools
D = json.loads((ROOT / "data/compare/medical/plans.json").read_text(encoding="utf-8"))
e = html.escape
random.seed(20261105)
by_ins = {}
for p in D["plans"]:
    by_ins.setdefault(p["insurer"]["en"], []).append(p)
rows, n = [], 0
for ins, plans in sorted(by_ins.items()):
    for p in random.sample(plans, min(2, len(plans))):
        v = random.choice(p["variants"])
        data = list(csv.DictReader(open(ROOT / "data/compare/medical" / v["premiumFile"], encoding="utf-8")))
        band = data[0]["entryFrom"], data[0]["entryTo"]
        for age in (30, 45, 60):
            r = next((x for x in data if int(x["age"]) == age and (x["entryFrom"], x["entryTo"]) == band), None)
            if not r:
                continue
            n += 1
            rid = f"{p['id']}|{v['id']}|{age}"
            area = f"・{v['area']['zh']}" if v.get("area") else ""
            basis = {"next": "下次生日年齡", "nearest": "最接近生日年齡"}.get(v.get("ageBasis"), "實際年齡")
            note = "（月繳×12）" if v.get("monthlyOnly") else ""
            rows.append(f"""<tr data-id="{e(rid)}"><td>{e(p['insurer']['zh'])}</td><td>{e(p['plan']['zh'])}<br><small>{e(v['label']['zh'])}{e(area)}・投保年齡組 {band[0]}–{band[1]}</small></td>
<td>{age}<br><small>{basis}</small></td><td>{float(r['male_ns']):,.2f}{note}</td><td>{float(r['female_ns']):,.2f}{note}</td>
<td><a href="{e(v['sourceUrl'])}" target="_blank" rel="noopener">開 PDF</a></td>
<td><label><input type="checkbox" data-ok> 啱</label> <label><input type="checkbox" data-bad> 唔啱</label></td></tr>""")
CI = json.loads((ROOT / "data/compare/ci/plans.json").read_text(encoding="utf-8"))
for p in CI["plans"]:
    if p.get("pricing") != "table":
        continue
    data = {int(x["age"]): x for x in csv.DictReader(open(ROOT / "data/compare/ci" / p["premiumFile"], encoding="utf-8"))}
    for age in (30, 45, 60):
        r = data.get(age)
        if not r:
            continue
        n += 1
        note = "（月供×12）" if p.get("monthlyOnly") else ("（每 $1,000 保額費率）" if p.get("rateBasis") == "per1000" else "")
        sa_txt = "表列每 $1,000 保額" if p.get("rateBasis") == "per1000" else f"保額 ${p['sumAssured']:,}"
        rid = f"ci|{p['id']}|{age}"
        rows.append(f"""<tr data-id="{e(rid)}"><td>{e(p['insurer']['zh'])}<br><small>危疾</small></td><td>{e(p['plan']['zh'])}<br><small>{sa_txt}</small></td>
<td>{age}</td><td>{float(r['male_ns']):,.2f}{note}</td><td>{float(r['female_ns']):,.2f}{note}</td>
<td><a href="{e(p['premiumSourceUrl']['zh'])}" target="_blank" rel="noopener">開 PDF</a></td>
<td><label><input type="checkbox" data-ok> 啱</label> <label><input type="checkbox" data-bad> 唔啱</label></td></tr>""")
for p in CI["plans"]:
    if p.get("pricing") != "quote":
        continue
    n += 1
    d = p["diseases"]
    cap = (p.get("capText") or {}).get("zh") or (f"保額 {p['totalCapPct']}%" if p.get("totalCapPct") else "見條款")
    facts = f"嚴重 {d['severe']}／早期 {d['early']}；總賠償上限：{cap}；{(p.get('multiText') or {}).get('zh', '')}"
    rows.append(f"""<tr data-id="ci-terms|{e(p['id'])}"><td>{e(p['insurer']['zh'])}<br><small>危疾條款</small></td><td>{e(p['plan']['zh'])}<br><small>需報價（對條款）</small></td>
<td>—</td><td colspan="2" style="font-size:13px">{e(facts)}</td>
<td><a href="{e(p['termsUrl']['zh'])}" target="_blank" rel="noopener">開小冊子</a></td>
<td><label><input type="checkbox" data-ok> 啱</label> <label><input type="checkbox" data-bad> 唔啱</label></td></tr>""")
page = f"""<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>靈活計劃保費核實清單</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;margin:16px;max-width:1100px}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}}
small{{color:#666}}tr.ok{{background:#eef7ea}}tr.bad{{background:#fbe5e1}}.bar{{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:2px solid #333}}</style></head><body>
<div class="bar"><b>保費核實清單</b>（{n} 項；每間公司抽 2 個計劃 × 30／45／60 歲，非吸煙年繳基本計劃）<br>
做法：撳「開 PDF」→ 搵「年繳」表、對應年齡 → 對男、女兩個數 → 剔「啱」或「唔啱」。剔嘅結果只存喺你部機。
<button id="copy">複製結果俾 Claude</button> <span id="sum"></span></div>
<table><tr><th>公司</th><th>計劃・選項</th><th>年齡</th><th>男（網站）</th><th>女（網站）</th><th>官方</th><th>結果</th></tr>
{''.join(rows)}</table>
<script>
const KEY='life-checklist-v1'; let st={{}}; try{{st=JSON.parse(localStorage.getItem(KEY)||'{{}}')}}catch(e){{}}
const paint=()=>{{let ok=0,bad=0;document.querySelectorAll('tr[data-id]').forEach(tr=>{{const v=st[tr.dataset.id];tr.className=v||'';tr.querySelector('[data-ok]').checked=v==='ok';tr.querySelector('[data-bad]').checked=v==='bad';if(v==='ok')ok++;if(v==='bad')bad++;}});
document.getElementById('sum').textContent=`已對 ${{ok+bad}} / {n}（啱 ${{ok}}、唔啱 ${{bad}}）`;}};
document.addEventListener('change',ev=>{{const tr=ev.target.closest('tr[data-id]');if(!tr)return;st[tr.dataset.id]=ev.target.checked?(ev.target.hasAttribute('data-ok')?'ok':'bad'):undefined;try{{localStorage.setItem(KEY,JSON.stringify(st))}}catch(e){{}}paint();}});
document.getElementById('copy').onclick=()=>{{const lines=Object.entries(st).filter(([k,v])=>v).map(([k,v])=>v+' '+k);navigator.clipboard.writeText(lines.join('\\n')).then(()=>alert('已複製 '+lines.length+' 項，貼返俾 Claude 就得'));}};
paint();
</script></body></html>"""
(ROOT / "tests/checklist.html").write_text(page, encoding="utf-8")
print(f"✅ tests/checklist.html：{n} 項")
