"""Road Show 熱點地圖：由 OpenStreetMap 拎港鐵出口，揀出主要人流站附近嘅「候選擺位」。

用法：python scripts/build_spots.py            （上網拎 OpenStreetMap 數據）
      python scripts/build_spots.py --osm DIR  （用已下載嘅 exits.json / stations.json）

輸出 data/roadshow/spots.json。全部位置都係「候選，待同事實地確認」：
  - 出口名係街名（道／街／路…）→ kind = street：出口外面多數係政府行人路（公眾地方）
  - 出口名係商場／屋苑／大廈／公園等 → kind = building：出口通去機構範圍，要行出外面行人路先可以企
  - 冇名 → kind = unknown
已經有人手確認嘅位（status ≠ 候選）會保留，唔會俾重新整理蓋過。
數據 © OpenStreetMap contributors（ODbL）。唔使 AI、唔使錢。
"""
import argparse, json, math, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "roadshow", "spots.json")
BBOX = "22.15,113.82,22.57,114.45"
ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter"]

# 主要人流站（中文站名，同 OpenStreetMap name:zh 一樣）＋大型場館附近嘅站
STATIONS_RAW = [
    "會展", "灣仔", "金鐘", "中環", "香港", "銅鑼灣", "天后", "北角", "太古", "西灣河", "筲箕灣",
    "尖沙咀", "尖東", "柯士甸", "佐敦", "油麻地", "旺角", "旺角東", "太子", "深水埗", "長沙灣", "美孚",
    "九龍塘", "樂富", "黃大仙", "鑽石山", "彩虹", "九龍灣", "牛頭角", "觀塘", "藍田", "油塘",
    "紅磡", "何文田", "土瓜灣", "宋皇臺", "啟德",
    "將軍澳", "坑口", "寶琳", "調景嶺",
    "沙田", "大圍", "第一城", "馬鞍山", "大埔墟", "粉嶺", "上水",
    "荃灣", "荃灣西", "葵芳", "葵興", "青衣", "東涌",
    "屯門", "兆康", "元朗", "朗屏", "天水圍", "錦上路",
    "香港大學", "西營盤", "上環", "鰂魚涌", "杏花邨", "柴灣",
    # 自發企街用：成熟屋苑／長者多／家庭多嘅住宅區站
    "黃埔", "石硤尾", "炮台山", "大窩口", "荔枝角", "南昌", "奧運", "康城", "太和", "大學", "恆安",
    "顯徑", "車公廟", "沙田圍", "堅尼地城", "黃竹坑", "海怡半島",
    "利東", "荃灣", "荔景", "美孚", "長沙灣", "天后", "炮台山",
]
STATIONS = list(dict.fromkeys(STATIONS_RAW))  # 去重
STREET = re.compile(r"(道|街|路|里|巷|坊|徑|圍|Road|Street|Avenue|Lane|Path)")
BUILDING = re.compile(r"(廣場|中心|商場|城|大廈|大樓|花園|苑|邨|村|酒店|醫院|學校|大學|學院|書院|公園|碼頭|站|政府|大會堂|"
                      r"Plaza|Centre|Center|Mall|Garden|Court|Building|Tower|House|Hotel|Hospital|School|Park|Pier|Square|Estate)", re.I)


def overpass(query):
    last = None
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"User-Agent": "advisor-tools-roadshow"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # 換第二個伺服器再試
            last = e
    raise SystemExit(f"OpenStreetMap 拎唔到：{last}")


def dist_m(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def zh(tags):
    n = tags.get("name:zh") or tags.get("name:zh-Hant") or tags.get("name", "")
    return n.split(" ")[0] if " " in n and re.match(r"[一-鿿]", n) else n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", help="已下載嘅 exits.json / stations.json 資料夾")
    a = ap.parse_args()
    if a.osm:
        exits = json.load(open(os.path.join(a.osm, "exits.json"), encoding="utf-8"))["elements"]
        stations = json.load(open(os.path.join(a.osm, "stations.json"), encoding="utf-8"))["elements"]
    else:
        exits = overpass(f'[out:json][timeout:120];(node["railway"="subway_entrance"]({BBOX});'
                         f'node["railway"="train_station_entrance"]({BBOX}););out body;')["elements"]
        stations = overpass(f'[out:json][timeout:120];(nwr["railway"="station"]({BBOX});'
                            f'nwr["public_transport"="station"]["subway"="yes"]({BBOX});'
                            f'nwr["public_transport"="station"]["train"="yes"]({BBOX}););out center tags;')["elements"]

    st = []
    for s in stations:  # 港鐵站好多畫成一塊地（way），用中心點
        if "lat" not in s and "center" in s:
            s["lat"], s["lon"] = s["center"]["lat"], s["center"]["lon"]
        if "lat" not in s or s["tags"].get("station") not in ("subway", "train"):
            continue  # 輕鐵、纜車唔要
        if re.search(r"深圳|Shenzhen|轻轨", json.dumps(s["tags"], ensure_ascii=False)):
            continue
        st.append(s)
    by_name = {}
    for s in st:
        by_name.setdefault(zh(s["tags"]).removesuffix("站"), s)
    missing = [n for n in STATIONS if n not in by_name]

    old = {}
    if os.path.exists(OUT):
        for p in json.load(open(OUT, encoding="utf-8")).get("spots", []):
            old[p["id"]] = p

    spots = []
    for name in STATIONS:
        s = by_name.get(name)
        if not s:
            continue
        sp = (s["lat"], s["lon"])
        for e in exits:
            ep = (e["lat"], e["lon"])
            if dist_m(sp, ep) > 450:
                continue
            # 呢個出口最近嘅站一定要係呢個站（避免兩個站之間嘅出口重複）
            near = min(st, key=lambda x: dist_m((x["lat"], x["lon"]), ep))
            if near is not s:
                continue
            t = e["tags"]
            ref = t.get("ref") or t.get("loc_ref") or ""
            label = zh(t) or t.get("name:en", "")
            kind = "unknown"
            if label and BUILDING.search(label + " " + t.get("name:en", "")):
                kind = "building"
            elif label and STREET.search(label + " " + t.get("name:en", "")):
                kind = "street"
            sid = f"mtr-{name}-{ref or e['id']}"
            spot = {
                "id": sid, "station": name, "stationEn": s["tags"].get("name:en", ""),
                "exit": ref, "exitName": label, "lat": round(e["lat"], 6), "lng": round(e["lon"], 6),
                "kind": kind, "status": "候選", "note": "",
            }
            if sid in old and old[sid].get("status") != "候選":
                spot.update({k: old[sid][k] for k in ("status", "note") if k in old[sid]})
            spots.append(spot)

    # 人手加嘅位（id 唔係 mtr- 開頭）原封不動保留
    spots += [p for p in old.values() if not p["id"].startswith("mtr-")]
    seen, uniq = set(), []
    for p in spots:
        if p["id"] not in seen:
            seen.add(p["id"]); uniq.append(p)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "note": "候選擺位：港鐵出口位置由 OpenStreetMap 嚟（© OpenStreetMap contributors, ODbL）。"
                "全部要同事實地確認：出口外面係唔係公眾行人路、夠唔夠闊、有冇人流。"
                "kind：street＝出口名係街名；building＝出口通商場／屋苑／機構（要行出外面行人路先企）；unknown＝冇名。",
        "rule": "冇機構批准：只可以喺公眾地方（唔屬於任何公營／私營機構或住宅管轄範圍），例如政府行人路；"
                "港鐵站大堂、商場、私人天橋、屋苑範圍唔得。有批准先入機構範圍。",
        "stationsMissing": missing,
        "spots": uniq,
    }, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    kinds = {k: sum(1 for p in uniq if p["kind"] == k) for k in ("street", "building", "unknown")}
    print(f"候選擺位 {len(uniq)} 個（{kinds}），{len(STATIONS) - len(missing)} 個站；搵唔到嘅站：{missing}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
