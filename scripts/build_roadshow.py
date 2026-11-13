"""Road Show 熱點地圖：每星期一由各官方網站拎未來 8 星期嘅活動，計分，寫 data/roadshow/events.json。

來源（全部公開網頁，唔使 AI、唔使錢）：
  hkcec  香港會展官方日程（中文＋英文；有公眾／業內／登記欄）
  awe    亞洲國際博覽館 upcoming events（有館號、類型）
  dhk    旅發局 DiscoverHongKong 活動（網頁入面嵌住嘅資料；有日子、地址、類別）
  lcsd   康文署文化節目（政府開放數據 XML；只收親子／節慶／展覽類）
  manual data/roadshow/manual.json 嘅 extraEvents（商場、同事提議）

用法：
  python scripts/build_roadshow.py             上網拎
  python scripts/build_roadshow.py --offline   唔上網，用上次存低嘅原始資料（data/roadshow/raw.json）重新計分
  python scripts/build_roadshow.py --today 2026-11-16   當今日係呢日（測試用）
回傳：0 = 全部 OK；2 = 有來源拎唔到（嗰個來源用返上次資料，其他照更新）；1 = 全部來源都失敗（唔寫檔）。
"""
import argparse, datetime as dt, html, json, math, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "roadshow")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
HORIZON_DAYS = 56  # 未來 8 星期

HKCEC_ZH = "https://www.hkcec.com/zh/%E6%9C%80%E6%96%B0%E6%B4%BB%E5%8B%95"
HKCEC_EN = "https://www.hkcec.com/en/event-calendar"
AWE_EN = "https://www.asiaworld-expo.com/en-us/whats-on/upcoming-events/"
AWE_ZH = "https://www.asiaworld-expo.com/zh-hk/whats-on/upcoming-events/"
DHK_EN = "https://www.discoverhongkong.com/eng/what-s-new/events.html"
DHK_ZH = "https://www.discoverhongkong.com/hk-tc/what-s-new/events.html"
LCSD = "https://www.lcsd.gov.hk/datagovhk/event/"
SOURCE_NAMES = {"hkcec": "香港會展", "awe": "亞博", "dhk": "旅發局", "lcsd": "康文署", "manual": "人手加入"}


# ---------- 工具 ----------
def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def text(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def dmy(s):  # 11/12/2026 → date
    d, m, y = (int(x) for x in s.split("/"))
    return dt.date(y, m, d)


def days(a, b):
    return [a + dt.timedelta(n) for n in range((b - a).days + 1)]


def norm(s):
    s = (s or "").lower()
    s = re.sub(r"\b(20\d\d|the|hong kong|hk|of|and|&|cum|expo|fair|show|exhibition)\b", " ", s)
    return set(w for w in re.findall(r"[a-z0-9]+|[一-鿿]", s) if len(w) > 1 or re.match(r"[一-鿿]", w))


def similar(a, b):
    A, B = norm(a), norm(b)
    if not A or not B:
        return False
    return len(A & B) / min(len(A), len(B)) >= 0.6


# ---------- 來源 ----------
def parse_hkcec(h):
    out = []
    for b in h.split('class="event-table"')[1:]:
        b = b.split("Load More")[0][:5000]
        title = text((re.search(r'class="event-title"[^>]*>(.*?)</', b, re.S) or [None, ""])[1])
        title = re.sub(r"\s*\d\d/\d\d/\d{4}\s*-\s*\d\d/\d\d/\d{4}\s*$", "", title).strip()
        m = re.search(r"(\d\d/\d\d/\d{4})\s*-\s*(\d\d/\d\d/\d{4})", b)
        if not title or not m:
            continue
        nature = text((re.search(r'class="event-nature"[^>]*>(.*?)</', b, re.S) or [None, ""])[1])
        org = text((re.search(r'class="event-organiser"[^>]*>(.*?)</', b, re.S) or [None, ""])[1])
        email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", b) or [""])[0]
        link = (re.search(r'href="(https?://[^"]+)"', b) or [None, ""])[1]
        out.append({"title": title, "start": dmy(m[1]), "end": dmy(m[2]), "nature": nature,
                    "org": org, "email": email.lower(), "link": link})
    return out


def fetch_hkcec(today, until):
    def pages(base):
        rows = []
        for p in range(15):
            h = get(base + (f"?page={p}" if p else ""))
            got = parse_hkcec(h)
            rows += got
            if not got or got[-1]["start"] > until or "Load More" not in h:
                break
        return rows
    zh, en = pages(HKCEC_ZH), pages(HKCEC_EN)
    if not zh:
        raise RuntimeError("會展中文日程讀唔到任何活動（網頁可能改咗版）")
    en_by = {}
    for r in en:
        en_by.setdefault((r["start"], r["end"], r["email"]), []).append(r)
    events = []
    for r in zh:
        if r["end"] < today or r["start"] > until:
            continue
        cands = en_by.get((r["start"], r["end"], r["email"]), [])
        e = cands[0] if len(cands) == 1 else None  # 同一主辦同日子有幾個展：中英次序唔同，唔好亂配
        n = r["nature"]
        access = "公眾" if n in ("公眾", "公開") or "Public" in n else "業界" if "業" in n or "Trade" in n else "登記入場" if "登記" in n or "Registration" in n else "邀請" if "邀請" in n or "Invitation" in n else n or "未知"
        events.append({
            "src": "hkcec", "srcId": f"{r['start']}-{r['email']}-{r['title'][:20]}",
            "name": r["title"], "nameEn": e["title"] if e else "",
            "start": r["start"].isoformat(), "end": r["end"].isoformat(),
            "venueText": "香港會議展覽中心（灣仔）", "venueHint": "hkcec", "hall": "",
            "access": access, "organiser": r["org"], "kinds": [],
            "url": r["link"] or HKCEC_EN, "srcUrl": HKCEC_ZH,
        })
    return events


def parse_awe(h):
    out = []
    for m in re.finditer(r'<div class="event-filter-tab[^"]*" data-cat="([^"]*)" data-start="([^"]*)" data-end="([^"]*)">(.*?)event-filter-tab-tool', h, re.S):
        cat, s, e, body = m.groups()
        title = text((re.search(r"<h3>(.*?)</h3>", body, re.S) or [None, ""])[1])
        loc = re.findall(r"<div class=\"event-filter-tab-location\">(.*?)</div>", body, re.S)
        href = (re.search(r'href="([^"]*upcoming-events/events/[^"]*)"', body) or [None, ""])[1]
        img = (re.search(r'data-src="([^"]+)"', body) or [None, ""])[1]
        sid = (re.search(r"ebmsid=(\d+)", href) or [None, href])[1]
        try:
            mm, dd, yy = (int(x) for x in s.split("/")); start = dt.date(yy, mm, dd)
            mm, dd, yy = (int(x) for x in e.split("/")); end = dt.date(yy, mm, dd)
        except ValueError:
            continue
        out.append({"id": sid, "title": title, "cat": cat.lower(), "start": start, "end": end,
                    "hall": text(loc[-1]) if loc else "", "href": href, "img": img})
    return out


def fetch_awe(today, until):
    en, zh = parse_awe(get(AWE_EN)), parse_awe(get(AWE_ZH))
    if not en:
        raise RuntimeError("亞博網頁讀唔到任何活動（網頁可能改咗版）")
    zh_by = {r["id"]: r for r in zh}
    events = []
    for r in en:
        if r["end"] < today or r["start"] > until:
            continue
        if re.search(r"\[(cancelled|postponed)\]", r["title"], re.I):
            continue
        z = zh_by.get(r["id"])
        events.append({
            "src": "awe", "srcId": r["id"], "name": z["title"] if z and z["title"] else r["title"], "nameEn": r["title"],
            "start": r["start"].isoformat(), "end": r["end"].isoformat(),
            "venueText": "亞洲國際博覽館", "venueHint": "awe", "hall": r["hall"],
            "access": "未確認" if "exhibition" in r["cat"] else "公眾", "organiser": "",
            "kinds": sorted(set(r["cat"].split("|"))),
            "url": "https://www.asiaworld-expo.com" + r["href"] if r["href"].startswith("/") else r["href"],
            "srcUrl": AWE_EN,
            "image": ("https://www.asiaworld-expo.com" + r["img"]) if r["img"].startswith("/") else r["img"],
        })
    return events


def parse_dhk(h):
    items = {}
    dec = json.JSONDecoder()
    for m in re.finditer(r"prepareDataContainer\(\s*\"[^\"]*\"\s*,\s*", h):
        try:
            obj, _ = dec.raw_decode(h, m.end())
        except ValueError:
            continue
        for it in obj.get("items", []) if isinstance(obj, dict) else []:
            if it.get("startDate") and it.get("id"):
                items[str(it["id"])] = it
    return items


def fetch_dhk(today, until):
    en, zh = parse_dhk(get(DHK_EN)), parse_dhk(get(DHK_ZH))
    if not en:
        raise RuntimeError("旅發局網頁讀唔到任何活動（網頁可能改咗版）")
    events = []
    for i, r in en.items():
        try:
            start = dt.date.fromisoformat(r["startDate"][:10]); end = dt.date.fromisoformat((r.get("endDate") or r["startDate"])[:10])
        except ValueError:
            continue
        if end < today or start > until:
            continue
        z = zh.get(i, {})
        thumb = (r.get("thumbnailInfo") or {}).get("thumbnail", "")
        events.append({
            "src": "dhk", "srcId": i, "name": z.get("title") or r.get("title", ""), "nameEn": r.get("enTitle") or r.get("title", ""),
            "start": start.isoformat(), "end": end.isoformat(),
            "venueText": z.get("addr") or r.get("addr", ""), "venueTextEn": r.get("addr", ""), "venueHint": "", "hall": "",
            "access": "公眾", "organiser": "", "kinds": [c.lower() for c in r.get("eventCategories", []) if c not in ("DHK-direct", "spotlight")],
            "url": r.get("website") or r.get("pageUrl", ""), "srcUrl": r.get("pageUrl", DHK_EN),
            "image": ("https://www.discoverhongkong.com" + thumb) if thumb.startswith("/") else thumb,
        })
    return events


LCSD_KEEP = re.compile(r"親子|家庭|嘉年華|節|展覽|博覽|市集|開放日|fun day|carnival|festival|family|fair|expo|exhibition", re.I)


def fetch_lcsd(today, until):
    ev = ET.fromstring(get(LCSD + "events.xml").encode("utf-8"))
    dates = ET.fromstring(get(LCSD + "eventDates.xml").encode("utf-8"))
    venues = ET.fromstring(get(LCSD + "venues.xml").encode("utf-8"))
    vmap = {v.get("id"): ((v.findtext("venuec") or "").strip(), (v.findtext("venuee") or "").strip()) for v in venues}
    dmap = {}
    for e in dates:
        ds = []
        for x in e.findall("indate"):
            try:
                ds.append(dt.datetime.strptime((x.text or "").strip(), "%Y%m%d").date())
            except ValueError:
                pass
        dmap[e.get("id")] = ds
    events = []
    for e in ev:
        title = (e.findtext("titlec") or "").strip()
        title_en = (e.findtext("titlee") or "").strip()
        if not LCSD_KEEP.search(title + " " + title_en):
            continue
        ds = [d for d in dmap.get(e.get("id"), []) if today <= d <= until]
        if not ds:
            continue
        vc, ve = vmap.get((e.findtext("venueid") or "").strip(), ("", ""))
        events.append({
            "src": "lcsd", "srcId": e.get("id"), "name": title, "nameEn": title_en,
            "start": min(ds).isoformat(), "end": max(ds).isoformat(), "dates": [d.isoformat() for d in sorted(ds)],
            "venueText": vc, "venueTextEn": ve, "venueHint": "", "hall": "",
            "access": "公眾", "organiser": (e.findtext("presenterorgc") or "").strip(), "kinds": ["lcsd"],
            "url": (e.findtext("urlc") or "").strip(), "srcUrl": "https://data.gov.hk/tc-data/dataset/hk-lcsd-event-event-cultural",
            "fee": (e.findtext("pricec") or "").strip(),
        })
    return events


FETCHERS = {"hkcec": fetch_hkcec, "awe": fetch_awe, "dhk": fetch_dhk, "lcsd": fetch_lcsd}


# ---------- 合併、地點、計分 ----------
def merge(raw):
    """同一活動喺幾個來源出現 → 合併；日子唔夾就標出嚟。場館官方來源優先。"""
    order = {"hkcec": 0, "awe": 0, "dhk": 1, "manual": 1, "lcsd": 2}
    raw = sorted(raw, key=lambda e: (order.get(e["src"], 3), e["start"]))
    out = []
    for e in raw:
        e = dict(e, sources=[{"src": e["src"], "url": e.get("srcUrl", ""), "start": e["start"], "end": e["end"]}])
        hit = None
        for o in out:
            if o["src"] == e["src"]:
                continue
            same_name = similar(o["nameEn"] or o["name"], e["nameEn"] or e["name"]) or similar(o["name"], e["name"])
            overlap = not (e["end"] < o["start"] or e["start"] > o["end"])
            near_dates = abs((dt.date.fromisoformat(e["start"]) - dt.date.fromisoformat(o["start"])).days) <= 7
            if same_name and (overlap or near_dates):
                hit = o
                break
        if hit:
            hit["sources"].append(e["sources"][0])
            for k in ("image", "fee"):
                if e.get(k) and not hit.get(k):
                    hit[k] = e[k]
            if (e["start"], e["end"]) != (hit["start"], hit["end"]):
                hit["dateConflict"] = True
        else:
            out.append(e)
    for e in out:
        e["verified"] = len({s["src"] for s in e["sources"]}) > 1 and not e.get("dateConflict")
    return out


def station_centres(spots):
    acc = {}
    for p in spots:
        a = acc.setdefault(p["station"], [0, 0, 0])
        a[0] += p["lat"]; a[1] += p["lng"]; a[2] += 1
    return {k: (v[0] / v[2], v[1] / v[2]) for k, v in acc.items()}


def locate(e, manual, centres):
    blob = " ".join([e.get("venueHint", ""), e.get("venueText", ""), e.get("venueTextEn", ""), e["name"], e.get("nameEn", "")]).lower()
    for v in manual["venues"]:
        if e.get("venueHint") == v["id"] or (v["match"] and re.search(v["match"], blob, re.I)):
            return v, False
    for pat, st in manual.get("districts", {}).items():
        if pat == "note":
            continue
        if re.search(pat, blob, re.I) and st in centres:
            lat, lng = centres[st]
            return {"id": "st-" + st, "name": f"{st}一帶", "lat": lat, "lng": lng, "geo": None,
                    "stations": [st], "tips": ""}, True
    return None, True


def dist_m(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def score(e, rules, venue, spots):
    blob = " ".join([e["name"], e.get("nameEn", ""), " ".join(e.get("kinds", [])), e.get("organiser", "")]).lower()
    why = {}
    # 人群潛力
    tags = []
    if e["access"] in ("業界", "登記入場", "邀請"):
        tags.append("trade")
    for t in rules["tags"]:
        if t["match"] and re.search(t["match"], blob, re.I) and t["id"] not in tags:
            tags.append(t["id"])
    if e.get("tags"):
        tags = list(e["tags"])
    tmap = {t["id"]: t for t in rules["tags"]}
    if tags:
        best = max(tmap[t]["score"] for t in tags)
        highs = sum(1 for t in tags if tmap[t]["score"] >= 4)
        people = min(5, best + 0.5 * max(0, highs - 1))
        if "trade" in tags:
            people = tmap["trade"]["score"]
        why["people"] = "、".join(tmap[t]["label"] for t in tags) + (f"（{highs} 類高關聯客群，+0.5）" if highs > 1 and "trade" not in tags else "")
    else:
        people = rules["defaultPeople"]
        why["people"] = "未有客群標籤（可以人手加）"
    # 人流
    d0, d1 = dt.date.fromisoformat(e["start"]), dt.date.fromisoformat(e["end"])
    span = days(d0, d1) if not e.get("dates") else [dt.date.fromisoformat(x) for x in e["dates"]]
    weekend = any(d.weekday() >= 5 for d in span)
    reasons = []
    if e["src"] == "awe" or (venue and venue["id"] == "awe"):
        halls = max(1, len(re.findall(r"\d+", e.get("hall", ""))))
        crowd = 1.5 + 0.5 * min(halls, 4); reasons.append(f"用 {halls} 個館")
    elif venue and venue["id"] == "hkcec":
        crowd = 2.5; reasons.append("會展公眾展")
    elif e["src"] == "lcsd":
        crowd = 1; reasons.append("康文署節目（多數細型）")
    else:
        crowd = 2.5; reasons.append("一般公眾活動")
    long_event = len(span) > 14
    if long_event:
        reasons.append("長期活動（人流分散，唔加分）")
    else:
        if len(span) > 1:
            crowd += min(1, 0.25 * (len(span) - 1)); reasons.append(f"{len(span)} 日")
        if weekend:
            crowd += 0.5 if e["src"] == "lcsd" else 1; reasons.append("有星期六日")
    if e["src"] == "lcsd":
        crowd = min(crowd, 2.5)
    for h in rules.get("crowdHints", []):
        if re.search(h["match"], blob, re.I):
            crowd += h["add"]; reasons.append(h["why"]); break
    if e.get("crowd") is not None:
        crowd = e["crowd"]; reasons = ["人手估算"]
    crowd = max(0, min(5, crowd))
    why["crowd"] = "、".join(reasons)
    # 地理
    near = []
    if venue:
        vp = (venue["lat"], venue["lng"])
        near = sorted((p for p in spots if dist_m(vp, (p["lat"], p["lng"])) <= 700 and p.get("status") != "唔可行"),
                      key=lambda p: dist_m(vp, (p["lat"], p["lng"])))
    street = [p for p in near if p["kind"] == "street" or p.get("status") == "可行"]
    if venue and venue.get("geo") is not None:
        geo = venue["geo"]; why["geo"] = f"{venue['name']}（場館評分）"
    else:
        geo = min(4.5, 2 + 0.5 * len(street)); why["geo"] = f"附近 {len(street)} 個街道出口候選位" if venue else "位置未知"
    if e.get("indoorBooth"):
        geo = max(geo, 3.5); why["geo"] += "；有室內 booth"
    total = round(rules["weights"]["people"] * people + rules["weights"]["crowd"] * crowd + rules["weights"]["geo"] * geo, 2)
    t1, t2 = rules["tiers"]["1"], rules["tiers"]["2"]
    tier = (1 if total >= t1["minTotal"] and people >= t1["minPeople"] and crowd >= t1.get("minCrowd", 0)
            else 2 if total >= t2["minTotal"] and people >= t2["minPeople"] and crowd >= t2.get("minCrowd", 0) else 3)
    if venue and venue.get("maxTier") and not e.get("indoorBooth") and tier < venue["maxTier"]:
        tier = venue["maxTier"]; why["tier"] = f"{venue['name']}太遠，冇室內 booth 最多第{'二' if tier == 2 else '三'}梯隊"
    if e.get("tier"):
        tier = e["tier"]; why["tier"] = "人手調整"
    staff = rules["staff"][2] if tier == 1 and crowd >= 4 else rules["staff"][1] if tier <= 2 and crowd >= 2.5 else rules["staff"][0]
    level = "高" if people >= 4 else "中" if people >= 2.5 else "低"
    return {
        "tags": tags, "level": level, "scores": {"people": round(people, 2), "crowd": round(crowd, 2), "geo": round(geo, 2), "total": total},
        "why": why, "tier": tier, "staff": staff["size"], "staffRoles": staff["roles"], "weekend": weekend,
        "spots": [p["id"] for p in near[:12]],
    }


def build(raw_by_src, manual, rules, spots, today, until):
    raw = [e for src in raw_by_src.values() for e in src]
    for x in manual.get("extraEvents", []):
        if x.get("end", x.get("start", "")) >= today.isoformat() and x.get("start", "") <= until.isoformat():
            raw.append(dict({"src": "manual", "srcId": x.get("id", x["name"]), "nameEn": "", "venueText": "", "venueHint": "",
                             "hall": "", "access": "公眾", "organiser": "", "kinds": [], "url": "", "srcUrl": ""}, **x))
    excl = re.compile(rules["excludeKinds"], re.I)
    excl_name = re.compile(rules.get("excludeNames", r"(?!x)x"), re.I)
    keep, dropped, seen = [], 0, set()
    for e in raw:
        if e["src"] in ("awe", "dhk") and any(excl.search(k) for k in e.get("kinds", [])):
            dropped += 1; continue
        if e["src"] != "manual" and excl_name.search(e["name"] + " " + e.get("nameEn", "")):
            dropped += 1; continue
        key = (e["name"], e.get("venueText", ""), e["start"], e["end"])
        if key in seen:
            continue
        seen.add(key)
        if e["src"] == "awe" and re.search(r"concert|live|tour|fan ?meeting|演唱會|見面會", e.get("nameEn", "") + e["name"], re.I):
            dropped += 1; continue
        keep.append(e)
    events = merge(keep)
    centres = station_centres(spots)
    out = []
    for e in events:
        for o in manual.get("overrides", []):
            if re.search(o["match"], e["name"] + " " + e.get("nameEn", ""), re.I):
                if o.get("remove"):
                    e["removed"] = True
                e.update({k: v for k, v in o.items() if k not in ("match", "remove")})
        if e.get("removed"):
            continue
        venue, approx = locate(e, manual, centres)
        s = score(e, rules, venue, spots)
        e.update(s)
        e["id"] = f"{e['src']}-{e['srcId']}"
        e["venue"] = {"id": venue["id"], "name": venue["name"], "lat": round(venue["lat"], 5), "lng": round(venue["lng"], 5),
                      "approx": approx, "tips": venue.get("tips", ""), "stations": venue.get("stations", [])} if venue else None
        for k in ("venueHint", "srcId", "srcUrl", "removed"):
            e.pop(k, None)
        out.append(e)
    out.sort(key=lambda e: (e["start"], e["tier"], -e["scores"]["total"]))
    return out, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--today")
    a = ap.parse_args()
    hk = dt.timezone(dt.timedelta(hours=8))
    today = dt.date.fromisoformat(a.today) if a.today else dt.datetime.now(hk).date()
    until = today + dt.timedelta(HORIZON_DAYS)
    rules = json.load(open(os.path.join(DIR, "rules.json"), encoding="utf-8"))
    manual = json.load(open(os.path.join(DIR, "manual.json"), encoding="utf-8"))
    spots = json.load(open(os.path.join(DIR, "spots.json"), encoding="utf-8"))["spots"]
    raw_path = os.path.join(DIR, "raw.json")
    old_raw = json.load(open(raw_path, encoding="utf-8")) if os.path.exists(raw_path) else {"sources": {}}
    raw_by_src, status, problems = {}, {}, []
    for src, fn in FETCHERS.items():
        if a.offline:
            raw_by_src[src] = old_raw["sources"].get(src, {}).get("events", [])
            status[src] = old_raw["sources"].get(src, {}).get("status", {"ok": False})
            continue
        try:
            ev = fn(today, until)
            raw_by_src[src] = ev
            status[src] = {"ok": True, "count": len(ev), "fetched": today.isoformat()}
        except Exception as e:
            prev = old_raw["sources"].get(src, {})
            raw_by_src[src] = prev.get("events", [])
            status[src] = {"ok": False, "count": len(raw_by_src[src]), "fetched": prev.get("status", {}).get("fetched"), "error": str(e)[:300]}
            problems.append(f"{SOURCE_NAMES[src]}拎唔到，用返上次資料：{str(e)[:160]}")
    if not a.offline:
        if not any(s["ok"] for s in status.values()):
            print("全部來源都拎唔到，今次唔更新：", problems)
            return 1
        json.dump({"note": "各來源原始資料（--offline 重新計分用）", "sources": {k: {"status": status[k], "events": v} for k, v in raw_by_src.items()}},
                  open(raw_path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    # 舊資料可能有過咗期嘅活動
    for src in raw_by_src:
        raw_by_src[src] = [e for e in raw_by_src[src] if e["end"] >= today.isoformat() and e["start"] <= until.isoformat()]
    events, dropped = build(raw_by_src, manual, rules, spots, today, until)
    data = {
        "updated": today.isoformat(), "until": until.isoformat(), "horizonWeeks": HORIZON_DAYS // 7,
        "sources": {k: dict(v, name=SOURCE_NAMES[k]) for k, v in status.items()},
        "problems": problems, "droppedConcertsSports": dropped,
        "tiers": rules["tiers"], "tags": {t["id"]: {k: t[k] for k in ("label", "profile", "hooks", "score")} for t in rules["tags"]},
        "events": events,
    }
    with open(os.path.join(DIR, "events.json"), "w", encoding="utf-8") as f:  # 一個活動一行，細啲又睇得明 diff
        f.write(json.dumps({k: v for k, v in data.items() if k != "events"}, ensure_ascii=False)[:-1] + ',\n"events": [\n')
        f.write(",\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in events))
        f.write("\n]}\n")
    by_tier = {t: sum(1 for e in events if e["tier"] == t) for t in (1, 2, 3)}
    print(f"{today} 至 {until}：{len(events)} 個活動（第一梯隊 {by_tier[1]}、第二 {by_tier[2]}、不建議 {by_tier[3]}），"
          f"剔走演唱會／球賽 {dropped} 個；來源：" + "、".join(f"{SOURCE_NAMES[k]} {'✔' if v.get('ok') else '✘'}{v.get('count', 0)}" for k, v in status.items()))
    for p in problems:
        print("⚠", p)
    return 2 if problems else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
