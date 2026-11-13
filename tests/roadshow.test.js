// Road Show 熱點地圖：檢查 data/roadshow/*.json 合理（workflow commit 之前跑）。用法：node tests/roadshow.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dir = path.join(__dirname, "..", "data", "roadshow");
const ev = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8"));
const spots = JSON.parse(fs.readFileSync(path.join(dir, "spots.json"), "utf8")).spots;
const rules = JSON.parse(fs.readFileSync(path.join(dir, "rules.json"), "utf8"));
const spotIds = new Set(spots.map((p) => p.id));
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

ok(/^\d{4}-\d{2}-\d{2}$/.test(ev.updated), "updated 日期");
ok(ev.events.length >= 10, `活動太少（${ev.events.length}）`);
ok(Object.values(ev.sources).some((s) => s.ok), "至少一個來源成功");
const ids = new Set();
const excl = new RegExp(rules.excludeNames, "i");
const staffSizes = new Set(rules.staff.map((s) => s.size));
for (const e of ev.events) {
  const tag = `${e.id} ${e.name}`;
  ok(!ids.has(e.id), "重複 id：" + tag); ids.add(e.id);
  ok(e.name && e.start <= e.end, "名／日子：" + tag);
  ok(e.end >= ev.updated && e.start <= ev.until, "日子喺範圍外：" + tag);
  ok([1, 2, 3].includes(e.tier), "梯隊：" + tag);
  for (const k of ["people", "crowd", "geo", "total"]) ok(e.scores[k] >= 0 && e.scores[k] <= 5, `${k} 分：` + tag);
  const w = rules.weights, t = +(w.people * e.scores.people + w.crowd * e.scores.crowd + w.geo * e.scores.geo).toFixed(2);
  ok(Math.abs(t - e.scores.total) < 0.02, "總分計錯：" + tag);
  if (e.tier === 1 && !(e.why && e.why.tier)) ok(e.scores.people >= 4 && e.scores.crowd >= 3.5 && e.scores.total >= 3.8, "第一梯隊條件：" + tag);
  ok(staffSizes.has(e.staff), "建議人數：" + tag);
  ok(e.manual || !excl.test(`${e.name} ${e.nameEn}`), "演唱會／球賽應該剔走：" + tag);
  ok(e.tags.every((x) => ev.tags[x]), "未知客群標籤：" + tag);
  if (e.venue) ok(e.venue.lat > 22.1 && e.venue.lat < 22.6 && e.venue.lng > 113.8 && e.venue.lng < 114.5, "座標唔喺香港：" + tag);
  ok((e.spots || []).every((s) => spotIds.has(s)), "擺位 id 唔存在：" + tag);
  ok(e.sources.length >= 1 && e.sources.every((s) => s.src), "來源：" + tag);
}
for (const p of spots) ok(p.lat > 22.1 && p.lat < 22.6 && p.lng > 113.8 && p.lng < 114.5 && ["street", "building", "unknown"].includes(p.kind), "擺位：" + p.id);

// 自發企街點子
const ideas = JSON.parse(fs.readFileSync(path.join(dir, "ideas.json"), "utf8"));
const stations = new Set(spots.map((p) => p.station));
for (const [g, v] of Object.entries(ideas.stationGroups)) for (const st of v.stations) ok(stations.has(st), `點子地區 ${g} 嘅站 ${st} 冇候選擺位`);
for (const t of ideas.themes) {
  ok(t.id && t.title && ideas.slots[t.slot], "主題時段：" + t.id);
  ok(t.groups.length && t.groups.every((g) => ideas.stationGroups[g]), "主題地區：" + t.id);
  ok(t.months.length && t.months.every((m) => m >= 1 && m <= 12), "主題月份：" + t.id);
  ok(t.tags.every((x) => ev.tags[x]), "主題客群：" + t.id);
  ok(t.signs.length && t.openers.length && t.props && t.who, "主題內容：" + t.id);
}
for (let m = 1; m <= 12; m++) ok(ideas.themes.some((t) => t.months.includes(m)), `${m} 月冇主題`);

// 私隱檢查（同伺服器用同一個函數）
import(require("url").pathToFileURL(path.join(__dirname, "..", "server", "roadshow-kv.js")).href).then((m) => {
  ok(m.looksPrivate("客人電話 9123 4567"), "電話");
  ok(m.looksPrivate("A123456(7)"), "身份證");
  ok(m.looksPrivate("abc@gmail.com"), "電郵");
  ok(!m.looksPrivate("灣仔站 A1 出口，12:00–18:00 人多，派咗 300 張單張"), "正常備註唔應該當私隱");
  ok(m.num("3", 1, 200) === 3 && m.num("0", 1, 200) === null, "num()");
  console.log(`roadshow：${n} 項檢查通過（${ev.events.length} 個活動、${spots.length} 個候選擺位）`);
}).catch((e) => { console.error(e); process.exit(1); });

// 記錄成效／建議 API：用假 KV 試（唔使上網）
(async () => {
  const { pathToFileURL } = require("url");
  const fn = (f) => import(pathToFileURL(path.join(__dirname, "..", "functions", "api", f)).href);
  const store = new Map();
  const kv = {
    async put(k, v, o) { assert.strictEqual(o.expirationTtl, 365 * 24 * 3600, "1 年到期"); store.set(k, { v, m: o.metadata }); },
    async list({ prefix }) { return { keys: [...store].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.m })), list_complete: true }; },
  };
  const req = (b) => ({ json: async () => b });
  const log = await fn("roadshow-log.js"), sug = await fn("roadshow-suggest.js");
  let r = await log.onRequestGet({ env: {} });
  assert.strictEqual(r.status, 503, "冇 KV → 503");
  r = await log.onRequestPost({ env: { ROADSHOW_KV: kv }, request: req({ eventName: "結婚節", date: "2026-12-12", people: 8, hours: 5, leads: 12, note: "灣仔站 A1 人多" }) });
  assert.strictEqual(r.status, 200, "記錄成功");
  r = await log.onRequestPost({ env: { ROADSHOW_KV: kv }, request: req({ eventName: "結婚節", date: "2026-12-12", people: 8, hours: 5, note: "陳生 9123 4567" }) });
  assert.strictEqual(r.status, 400, "有電話 → 拒絕");
  r = await sug.onRequestPost({ env: { ROADSHOW_KV: kv }, request: req({ type: "spot", name: "沙田站 A3 外面", note: "週末人多" }) });
  assert.strictEqual(r.status, 200, "建議成功");
  const logs = await (await log.onRequestGet({ env: { ROADSHOW_KV: kv } })).json();
  const sugs = await (await sug.onRequestGet({ env: { ROADSHOW_KV: kv } })).json();
  assert.ok(logs.items.length === 1 && logs.items[0].leads === 12 && sugs.items.length === 1, "讀返紀錄");
  console.log("roadshow API：假 KV 測試通過");
})().catch((e) => { console.error(e); process.exit(1); });
