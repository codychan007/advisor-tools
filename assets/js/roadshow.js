/* Road Show 熱點地圖：讀 data/roadshow/events.json + spots.json，畫地圖、清單、詳情、海報；記錄成效同建議經 /api/roadshow-* 存 KV。 */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TIER_CLASS = { 1: "t1", 2: "t2", 3: "t3" };
  const SRC = { hkcec: "香港會展", awe: "亞博", dhk: "旅發局", lcsd: "康文署", manual: "人手加入" };
  const KIND = { street: "街道出口（外面多數係政府行人路）", building: "出口通商場／屋苑／機構（要行出外面行人路）", unknown: "出口名未知" };
  const TILE = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/";
  const ATTR = '<a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener">© 地政總署</a> | 港鐵出口 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  let IDEAS = null, STATION_CENTRE = {};
  let DATA = null, SPOTS = [], SPOT_BY = {}, map = null, eventLayer = null, spotLayer = null, allSpotLayer = null;
  const state = { week: "this", tiers: new Set([1, 2]), tag: "", src: "", weekend: false, text: "" };

  // ---------- 日子 ----------
  const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const WD = "日一二三四五六";
  const md = (s) => { const d = D(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  function range(e) {
    const a = D(e.start), b = D(e.end);
    const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    if (e.start === e.end) return `${md(a)}（${WD[a.getDay()]}）`;
    if (a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth()) return `${md(a)}–${md(b)}`;
    return `${md(a)}–${b.getDate()}`;
  }
  function weeks() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m0 = monday(today), until = D(DATA.until), out = [];
    for (let i = 0; i < 9; i++) {
      const a = addDays(m0, 7 * i);
      if (a > until) break;
      const b = addDays(a, 6);
      out.push({ id: i === 0 ? "this" : i === 1 ? "next" : iso(a), label: i === 0 ? "本週" : i === 1 ? "下週" : `${a.getMonth() + 1}/${a.getDate()} 起`, from: iso(i === 0 ? today : a), to: iso(b) });
    }
    out.push({ id: "all", label: "未來 8 週", from: iso(today), to: DATA.until });
    return out;
  }
  let WEEKS = [];
  const curWeek = () => WEEKS.find((w) => w.id === state.week) || WEEKS[0];

  // ---------- 篩選 ----------
  function filtered() {
    const w = curWeek(), q = state.text.trim().toLowerCase();
    return DATA.events.filter((e) => {
      if (e.end < w.from || e.start > w.to) return false;
      if (!state.tiers.has(e.tier)) return false;
      if (state.tag && !e.tags.includes(state.tag)) return false;
      if (state.src && !e.sources.some((s) => s.src === state.src)) return false;
      if (state.weekend && !hasWeekendIn(e, w)) return false;
      if (q && !(`${e.name} ${e.nameEn} ${e.venueText} ${e.venue ? e.venue.name : ""}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => a.tier - b.tier || b.scores.total - a.scores.total || a.start.localeCompare(b.start));
  }
  function hasWeekendIn(e, w) {
    const a = D(e.start > w.from ? e.start : w.from), b = D(e.end < w.to ? e.end : w.to);
    if (e.dates) return e.dates.some((x) => x >= w.from && x <= w.to && [0, 6].includes(D(x).getDay()));
    for (let d = a; d <= b; d = addDays(d, 1)) if ([0, 6].includes(d.getDay())) return true;
    return false;
  }

  // ---------- 文字 ----------
  const tagLabel = (t) => (DATA.tags[t] ? DATA.tags[t].label : t);
  function levelBadge(e) {
    const tags = e.tags.length ? e.tags.map(tagLabel).join("・") : "未分類";
    return `<span class="rs-badge ${TIER_CLASS[e.tier]}">${esc(e.level)}｜${esc(tags)}</span>`;
  }
  function hookOf(e) {
    const t = e.tags.find((x) => x !== "trade" && DATA.tags[x]) || e.tags[0];
    return t && DATA.tags[t] ? DATA.tags[t].hooks[0] : "可以先做簡單問卷了解人流";
  }
  const venueLine = (e) => [e.venue ? e.venue.name : e.venueText || "地點未知", e.hall, e.access !== "公眾" ? e.access : "公眾"].filter(Boolean).join("｜");

  // ---------- 地圖 ----------
  function initMap() {
    map = L.map("map", { zoomControl: true, minZoom: 10, maxZoom: 19 }).setView([22.33, 114.15], 11);
    L.tileLayer(TILE + "basemap/WGS84/{z}/{x}/{y}.png", { maxZoom: 19, attribution: ATTR }).addTo(map);
    L.tileLayer(TILE + "label/hk/tc/WGS84/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    eventLayer = L.layerGroup().addTo(map);
    spotLayer = L.layerGroup().addTo(map);
    allSpotLayer = L.layerGroup();
    SPOTS.forEach((p) => spotMarker(p).addTo(allSpotLayer));
    $("#showAllSpots").addEventListener("change", (ev) => { ev.target.checked ? allSpotLayer.addTo(map) : allSpotLayer.remove(); });
  }
  function spotMarker(p) {
    const icon = L.divIcon({ className: "", html: `<i class="rs-spot ${p.kind}${p.status === "可行" ? " ok" : ""}"></i>`, iconSize: [12, 12], iconAnchor: [6, 6] });
    return L.marker([p.lat, p.lng], { icon, keyboard: false }).bindPopup(spotHtml(p));
  }
  function spotHtml(p) {
    return `<b>${esc(p.station)}站 ${esc(p.exit || "")} 出口</b>${p.exitName ? `<br>${esc(p.exitName)}` : ""}<br><small>${esc(KIND[p.kind])}</small><br><small>狀態：${esc(p.status)}${p.note ? "｜" + esc(p.note) : ""}</small>`;
  }
  function drawMap(list) {
    if (!map) return;
    eventLayer.clearLayers(); spotLayer.clearLayers();
    const groups = {};
    list.forEach((e) => { if (!e.venue) return; const k = `${e.venue.lat},${e.venue.lng}`; (groups[k] = groups[k] || []).push(e); });
    const pts = [];
    Object.values(groups).forEach((g) => {
      const best = Math.min(...g.map((e) => e.tier)), v = g[0].venue;
      const icon = L.divIcon({ className: "", html: `<span class="rs-pin ${TIER_CLASS[best]}">${g.length}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const html = `<b>${esc(v.name)}</b>${v.approx ? " <small>（位置大約）</small>" : ""}<ul class="rs-pop">` +
        g.map((e) => `<li><button type="button" data-open="${esc(e.id)}"><i class="dot ${TIER_CLASS[e.tier]}"></i>${esc(range(e))} ${esc(e.name)}</button></li>`).join("") + "</ul>";
      L.marker([v.lat, v.lng], { icon, zIndexOffset: 100 * (4 - best) }).bindPopup(html, { maxWidth: 300 }).addTo(eventLayer);
      pts.push([v.lat, v.lng]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }

  // ---------- 清單 ----------
  function drawList(list) {
    const w = curWeek();
    $("#listCount").textContent = `${w.label}（${w.from.slice(5).replace("-", "/")}–${w.to.slice(5).replace("-", "/")}）：${list.length} 個活動`;
    const unknown = list.filter((e) => !e.venue).length;
    $("#list").innerHTML = list.length ? list.map(card).join("") + (unknown ? `<p class="hint">${unknown} 個活動位置未知，冇喺地圖顯示。</p>` : "") :
      `<p class="muted">呢個時段冇符合條件嘅活動。試吓剔埋「不建議主攻」或者揀其他星期。</p>`;
    const by = { 1: [], 2: [], 3: [] };
    list.forEach((e) => by[e.tier].push(e.name.replace(/\s*\d{4}\s*$/, "")));
    $("#priority").innerHTML = `<h2>建議 TCT 優先次序</h2><div class="rs-prio">` + [1, 2, 3].map((t) =>
      `<div class="${TIER_CLASS[t]}"><b>${esc(DATA.tiers[t].name)}${DATA.tiers[t].sub ? "｜" + esc(DATA.tiers[t].sub) : ""}</b><p>${by[t].length ? by[t].slice(0, 8).map(esc).join("・") + (by[t].length > 8 ? ` 等 ${by[t].length} 個` : "") : "—"}</p></div>`).join("") + "</div>";
  }
  function card(e) {
    return `<button type="button" class="rs-card ${TIER_CLASS[e.tier]}" data-open="${esc(e.id)}">
      <span class="rs-date">${esc(range(e))}</span>
      <span class="rs-body"><b class="rs-name">${esc(e.name)}</b>
        <small class="rs-venue">${esc(venueLine(e))}</small>
        ${levelBadge(e)} <span class="rs-staff">👥 ${esc(e.staff)}</span>
        <span class="rs-hook">${esc(hookOf(e))}</span></span>
    </button>`;
  }

  // ---------- 詳情 ----------
  let miniMap = null;
  function openDetail(id) {
    const e = DATA.events.find((x) => x.id === id);
    if (!e) return;
    map && map.closePopup();
    const tags = e.tags.filter((t) => DATA.tags[t]);
    const srcs = e.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(SRC[s.src] || s.src)}</a>`).join("、");
    const check = e.dateConflict ? `<span class="rs-warn">⚠ 各來源日子有出入，出發前再確認</span>` :
      e.verified ? `<span class="rs-ok">✔ 兩個來源吻合</span>` :
      ["hkcec", "awe"].includes(e.sources[0].src) ? `<span class="rs-ok">✔ 場館官方日程</span>` : `<span class="muted">單一來源</span>`;
    const near = (e.spots || []).map((id) => SPOT_BY[id]).filter(Boolean);
    const streetNear = near.filter((p) => p.kind === "street" || p.status === "可行");
    $("#detailBody").innerHTML = `
      <p class="rs-d-tier ${TIER_CLASS[e.tier]}">${esc(DATA.tiers[e.tier].name)}${DATA.tiers[e.tier].sub ? "｜" + esc(DATA.tiers[e.tier].sub) : ""}　總分 ${e.scores.total.toFixed(1)} / 5</p>
      <h2>${esc(e.name)}</h2>
      ${e.nameEn && e.nameEn !== e.name ? `<p class="muted rs-en">${esc(e.nameEn)}</p>` : ""}
      ${e.image ? `<img class="rs-img" src="${esc(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <dl class="rs-dl">
        <dt>日期</dt><dd>${esc(range(e))}${e.dates && e.dates.length > 1 ? `（${e.dates.length} 日）` : ""}</dd>
        <dt>地點</dt><dd>${esc(e.venue ? e.venue.name : "")}${e.venueText && (!e.venue || e.venue.id.startsWith("st-")) ? `<br><small>${esc(e.venueText.replace(/<br>/g, " "))}</small>` : ""}${e.venue && e.venue.approx ? ` <small>（位置大約）</small>` : ""}</dd>
        ${e.hall ? `<dt>館號</dt><dd>${esc(e.hall)}</dd>` : ""}
        <dt>性質</dt><dd>${esc(e.access)}${e.fee ? `｜${esc(e.fee)}` : ""}</dd>
        ${e.organiser ? `<dt>主辦</dt><dd>${esc(e.organiser)}</dd>` : ""}
        <dt>來源</dt><dd>${srcs} ${check}${e.url ? `<br><a href="${esc(e.url)}" target="_blank" rel="noopener">活動網站 ↗</a>` : ""}</dd>
      </dl>

      <h3>目標客群特徵</h3>
      ${tags.length ? tags.map((t) => `<p><b>${esc(DATA.tags[t].label)}</b>：${esc(DATA.tags[t].profile)}</p>`).join("") : `<p class="muted">未有客群標籤。可以喺「建議場合／擺位」留言話 Cody 知應該係咩客群。</p>`}

      <h3>建議人數：${esc(e.staff)}</h3>
      <p>${esc(e.staffRoles)}${e.weekend ? "；人流多數集中星期六日下晝。" : "；只有平日，人流較少，可以先派少啲人試。"}</p>

      <h3>擺位建議</h3>
      ${e.venue && e.venue.tips ? `<p>${esc(e.venue.tips)}</p>` : ""}
      <p class="hint">冇機構批准：只可以喺公眾地方（政府行人路等），唔好企港鐵站大堂、商場、私人天橋或者屋苑範圍。以下港鐵出口全部係<b>候選</b>，要同事實地確認；試過好用可以喺「建議場合／擺位」話 Cody 知。</p>
      ${e.venue ? `<div id="miniMap" class="rs-minimap"></div>` : ""}
      ${near.length ? `<ul class="rs-spotlist">${near.slice(0, 8).map((p) => `<li><i class="rs-spot ${p.kind}"></i> ${esc(p.station)}站 ${esc(p.exit)}${p.exitName ? `（${esc(p.exitName)}）` : ""} <small>${esc(p.kind === "street" ? "街道出口" : p.kind === "building" ? "通商場／機構" : "未知")}｜${esc(p.status)}</small></li>`).join("")}</ul>` : `<p class="muted">附近未有候選港鐵出口。</p>`}

      <h3>話題切入點</h3>
      <ul>${(tags.length ? tags : ["family"]).flatMap((t) => (DATA.tags[t] || { hooks: [] }).hooks).slice(0, 4).map((h) => `<li>${esc(h)}</li>`).join("")}</ul>

      <details><summary>評分原因</summary>
        <ul class="rs-why">
          <li>人群潛力 ${e.scores.people}／5：${esc(e.why.people)}</li>
          <li>人流 ${e.scores.crowd}／5：${esc(e.why.crowd)}</li>
          <li>地理優勢 ${e.scores.geo}／5：${esc(e.why.geo)}${streetNear.length ? `（附近 ${streetNear.length} 個街道出口候選位）` : ""}</li>
          ${e.why.tier ? `<li>${esc(e.why.tier)}</li>` : ""}
        </ul>
      </details>
      <p class="rs-d-actions"><button type="button" class="btn small ghost" data-log="${esc(e.id)}">記錄今次成效</button></p>`;
    const dlg = $("#detail");
    dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
    if (e.venue) setTimeout(() => drawMini(e, near), 30);
  }
  function drawMini(e, near) {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    miniMap = L.map("miniMap", { zoomControl: true, attributionControl: true }).setView([e.venue.lat, e.venue.lng], 16);
    L.tileLayer(TILE + "basemap/WGS84/{z}/{x}/{y}.png", { maxZoom: 19, attribution: ATTR }).addTo(miniMap);
    L.tileLayer(TILE + "label/hk/tc/WGS84/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(miniMap);
    L.marker([e.venue.lat, e.venue.lng], { icon: L.divIcon({ className: "", html: `<span class="rs-pin ${TIER_CLASS[e.tier]}">★</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(esc(e.venue.name)).addTo(miniMap);
    const pts = [[e.venue.lat, e.venue.lng]];
    near.forEach((p) => { spotMarker(p).addTo(miniMap); pts.push([p.lat, p.lng]); });
    if (pts.length > 1) miniMap.fitBounds(pts, { padding: [20, 20], maxZoom: 17 });
  }

  // ---------- 海報 ----------
  async function poster() {
    const list = filtered().slice(0, 18), w = curWeek();
    if (!list.length) { alert("呢個時段冇活動可以出海報。"); return; }
    if (!window.html2canvas) { alert("海報工具未載入好，請等一陣再撳。"); return; }
    const by = { 1: [], 2: [], 3: [] };
    list.forEach((e) => by[e.tier].push(e.name.replace(/\s*\d{4}\s*$/, "")));
    const host = $("#posterHost");
    host.innerHTML = `<div class="rs-poster" id="posterEl">
      <p class="pk">TCT ROAD SHOW PLANNING · 每週熱點</p>
      <h1>${esc(md(w.from))}–${esc(md(w.to))} Road Show 活動</h1>
      <p class="pd">${esc(w.from.replace(/-/g, "/"))} 至 ${esc(w.to.replace(/-/g, "/"))}｜資料更新：${esc(DATA.updated)}｜日期以官方日程為準</p>
      <div class="pg">${list.map((e) => `<div class="pc ${TIER_CLASS[e.tier]}"><div class="ph"><b class="pdt">${esc(range(e))}</b><div><b>${esc(e.name)}</b><small>${esc(venueLine(e))}</small></div></div>
        ${levelBadge(e)} <span class="rs-staff">👥 ${esc(e.staff)}</span><p>${esc(hookOf(e))}</p></div>`).join("")}</div>
      <div class="pp"><h2>建議 TCT 優先次序</h2><div class="rs-prio">${[1, 2, 3].map((t) => `<div class="${TIER_CLASS[t]}"><b>${esc(DATA.tiers[t].name)}</b><p>${by[t].map(esc).join("・") || "—"}</p></div>`).join("")}</div></div>
      <p class="pf">來源：香港會展、亞博、旅發局、康文署官方網站｜評級係 TCT 策略分析，唔係官方數字｜TC Team專屬AI工具箱</p>
    </div>`;
    const btn = $("#posterBtn"); btn.disabled = true; btn.textContent = "整緊海報…";
    try {
      const canvas = await window.html2canvas($("#posterEl"), { scale: 1, backgroundColor: "#F7F3EA", useCORS: false });
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `roadshow-${w.from}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { alert("海報整唔到：" + err.message); }
    finally { btn.disabled = false; btn.textContent = "📥 下載本週海報"; host.innerHTML = ""; }
  }

  // ---------- 記錄同建議（KV） ----------
  const PRIV = /(\b[A-Z]{1,2}\d{6}\(?[\dA]\)?)|(\b[2-9]\d{3}\s?\d{4}\b)|@/i;
  async function api(path, body) {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ([404, 405, 501].includes(r.status) ? "呢個功能要喺正式網站先用到（本機預覽冇伺服器）" : `伺服器錯誤 ${r.status}`));
    return j;
  }
  function fillLogEvents() {
    const today = iso(new Date());
    const sel = $("#logEvent");
    const recent = DATA.events.filter((e) => e.tier <= 2 || e.sources[0].src !== "lcsd").filter((e) => e.start <= today).concat(DATA.events.filter((e) => e.start > today && e.tier <= 2));
    sel.innerHTML = `<option value="">— 揀活動 —</option>` + recent.map((e) => `<option value="${esc(e.id)}">${esc(range(e))} ${esc(e.name)}</option>`).join("") + (IDEAS ? `<optgroup label="自發企街（唔跟活動）">${IDEAS.themes.map((t) => `<option value="idea:${esc(t.id)}">自發：${esc(t.title)}</option>`).join("")}</optgroup>` : "") + `<option value="other">其他（下面填）</option>`;
    $("#logDate").value = today;
  }
  async function loadLogs() {
    const box = $("#logStats");
    try {
      const j = await api("/api/roadshow-log");
      if (!j.items.length) { box.innerHTML = "未有紀錄。"; return; }
      const g = {};
      j.items.forEach((x) => { const k = x.eventName || x.eventId; const a = (g[k] = g[k] || { n: 0, ph: 0, surveys: 0, leads: 0, meets: 0, deals: 0, last: "" }); a.n++; a.ph += (+x.people || 0) * (+x.hours || 0); ["surveys", "leads", "meets", "deals"].forEach((f) => (a[f] += +x[f] || 0)); if (x.date > a.last) a.last = x.date; });
      const rows = Object.entries(g).sort((a, b) => b[1].last.localeCompare(a[1].last));
      const sp = {};
      j.items.filter((x) => x.spot).forEach((x) => { const k = x.spot.replace(/\s+/g, " ").trim(); const a = (sp[k] = sp[k] || { n: 0, ph: 0, leads: 0, deals: 0 }); a.n++; a.ph += (+x.people || 0) * (+x.hours || 0); a.leads += +x.leads || 0; a.deals += +x.deals || 0; });
      const spotRows = Object.entries(sp).sort((a, b) => b[1].leads / (b[1].ph || 1) - a[1].leads / (a[1].ph || 1));
      const spotHtml = spotRows.length ? `<h3>按企位</h3><div class="table-wrap"><table class="rs-table"><thead><tr><th>企位</th><th>次數</th><th>人‧鐘</th><th>Leads</th><th>每人每鐘 leads</th><th>成交</th></tr></thead><tbody>` +
        spotRows.map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.n}</td><td>${a.ph.toFixed(0)}</td><td>${a.leads}</td><td>${(a.leads / (a.ph || 1)).toFixed(2)}</td><td>${a.deals}</td></tr>`).join("") + "</tbody></table></div>" : "";
      box.innerHTML = `<h3>按活動／主題</h3><div class="table-wrap"><table class="rs-table"><thead><tr><th>活動／地點</th><th>次數</th><th>人‧鐘</th><th>問卷</th><th>Leads</th><th>每人每鐘 leads</th><th>約見</th><th>成交</th></tr></thead><tbody>` +
        rows.map(([k, a]) => `<tr><td>${esc(k)}<br><small>最近 ${esc(a.last)}</small></td><td>${a.n}</td><td>${a.ph.toFixed(0)}</td><td>${a.surveys}</td><td>${a.leads}</td><td>${(a.leads / (a.ph || 1)).toFixed(2)}</td><td>${a.meets}</td><td>${a.deals}</td></tr>`).join("") + "</tbody></table></div>" + spotHtml;
    } catch (err) { box.innerHTML = `<span class="rs-warn">${esc(err.message)}</span>`; }
  }
  async function loadSugs() {
    const box = $("#sugList");
    try {
      const j = await api("/api/roadshow-suggest");
      const T = { event: "場合", spot: "擺位", feedback: "意見" };
      box.innerHTML = j.items.length ? `<ul class="rs-sugs">${j.items.map((x) => `<li><b>[${esc(T[x.type] || x.type)}] ${esc(x.name)}</b> <small>${esc(x.created.slice(0, 10))}${x.by ? "｜" + esc(x.by) : ""}</small><br>${esc([x.place, x.date].filter(Boolean).join("｜"))}${x.note ? `<br><span class="muted">${esc(x.note)}</span>` : ""}</li>`).join("")}</ul>` : "未有建議。";
    } catch (err) { box.innerHTML = `<span class="rs-warn">${esc(err.message)}</span>`; }
  }
  function bindForms() {
    $("#logForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const id = $("#logEvent").value, e = DATA.events.find((x) => x.id === id);
      const th = id.startsWith("idea:") && IDEAS ? IDEAS.themes.find((t) => "idea:" + t.id === id) : null;
      const body = {
        eventId: id === "other" ? "" : id, eventName: id === "other" || !id ? $("#logOther").value.trim() : e ? e.name : th ? "自發：" + th.title : "",
        date: $("#logDate").value, spot: $("#logSpot").value.trim(), people: +$("#logPeople").value, hours: +$("#logHours").value,
        surveys: +$("#logSurveys").value, leads: +$("#logLeads").value, meets: +$("#logMeets").value, deals: +$("#logDeals").value,
        note: $("#logNote").value.trim(), by: $("#logBy").value.trim(),
      };
      const msg = $("#logMsg");
      if (!body.eventName) { msg.textContent = "請揀活動或者填其他活動／地點。"; return; }
      if (PRIV.test(body.note + " " + body.spot)) { msg.textContent = "備註似乎有電話、身份證或者電郵，請刪走客人資料先儲存。"; return; }
      msg.textContent = "儲存緊…";
      try { await api("/api/roadshow-log", body); msg.textContent = "✔ 已儲存，多謝！"; ev.target.reset(); fillLogEvents(); loadLogs(); }
      catch (err) { msg.textContent = "✘ " + err.message; }
    });
    $("#sugForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = { type: ($("input[name=sugtype]:checked") || {}).value || "event", name: $("#sugName").value.trim(), place: $("#sugPlace").value.trim(), date: $("#sugDate").value.trim(), note: $("#sugNote").value.trim(), by: $("#sugBy").value.trim() };
      const msg = $("#sugMsg");
      if (PRIV.test(body.note + " " + body.place)) { msg.textContent = "詳情似乎有電話、身份證或者電郵，請刪走私人資料先送出。"; return; }
      msg.textContent = "送出緊…";
      try { await api("/api/roadshow-suggest", body); msg.textContent = "✔ 已送出，Cody 會整理。"; ev.target.reset(); loadSugs(); }
      catch (err) { msg.textContent = "✘ " + err.message; }
    });
  }


  // ---------- 自發企街 ----------
  let ideaMap = null, ideaPins = null, ideaExits = null;
  const ideaState = { month: new Date().getMonth() + 1, theme: "", station: "" };
  function stationCentres() {
    const acc = {};
    SPOTS.forEach((p) => { const a = (acc[p.station] = acc[p.station] || [0, 0, 0]); a[0] += p.lat; a[1] += p.lng; a[2]++; });
    Object.entries(acc).forEach(([k, a]) => (STATION_CENTRE[k] = [a[0] / a[2], a[1] / a[2]]));
  }
  const themeStations = (t) => [...new Set(t.groups.flatMap((g) => (IDEAS.stationGroups[g] || { stations: [] }).stations))].filter((st) => STATION_CENTRE[st]);
  function initIdeas() {
    $("#monthSeg").innerHTML = Array.from({ length: 12 }, (_, i) => `<label><input type="radio" name="rsmonth" value="${i + 1}" ${i + 1 === ideaState.month ? "checked" : ""}><span>${i + 1} 月</span></label>`).join("");
    $("#monthSeg").addEventListener("change", (ev) => { ideaState.month = +ev.target.value; drawThemes(); });
    $("#strategy").innerHTML = IDEAS.strategy.map((x) => `<li>${esc(x)}</li>`).join("");
    $("#stationSel").insertAdjacentHTML("beforeend", Object.keys(STATION_CENTRE).sort((a, b) => a.localeCompare(b, "zh-Hant")).map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join(""));
    $("#stationSel").addEventListener("change", (ev) => ev.target.value && focusStation(ev.target.value));
    $("#themeList").addEventListener("click", (ev) => { const b = ev.target.closest("[data-theme]"); if (b) pickTheme(b.dataset.theme); });
    $("#themeDetail").addEventListener("click", (ev) => {
      const c = ev.target.closest("[data-station]"); if (c) { focusStation(c.dataset.station); return; }
      const l = ev.target.closest("[data-logidea]");
      if (l) { switchTab("log"); $("#logEvent").value = "idea:" + l.dataset.logidea; if (ideaState.station) $("#logSpot").value = ideaState.station + "站 "; }
    });
    drawThemes();
  }
  const seasonOf = (t, m) => (t.months.length >= 12 ? "all" : t.months.includes(m) ? "hot" : "off");
  function drawThemes() {
    const m = ideaState.month, order = { hot: 0, all: 1, off: 2 };
    const list = IDEAS.themes.slice().sort((a, b) => order[seasonOf(a, m)] - order[seasonOf(b, m)]);
    const head = { hot: `${m} 月當造`, all: "全年都得", off: "其他月份" };
    let last = "", html = "";
    list.forEach((t) => {
      const s = seasonOf(t, m);
      if (s !== last) { html += `<h3>${esc(head[s])}</h3>`; last = s; }
      const pill = s === "hot" ? `<span class="rs-pill">當造</span>` : s === "all" ? `<span class="rs-pill all">全年</span>` : `<span class="rs-pill off">${esc(t.months.join("、"))} 月</span>`;
      html += `<button type="button" class="rs-theme ${s}" data-theme="${esc(t.id)}" aria-pressed="${t.id === ideaState.theme}">
        <span>${pill} <b>${esc(t.title)}</b></span>
        <small>${esc(IDEAS.slots[t.slot].label)}｜${esc(t.groups.map((g) => IDEAS.stationGroups[g].label).join("、"))}</small>
        ${t.proven ? `<small>✔ 同事試過</small>` : ""}</button>`;
    });
    $("#themeList").innerHTML = html;
  }
  function pickTheme(id) {
    const t = IDEAS.themes.find((x) => x.id === id);
    if (!t) return;
    ideaState.theme = id;
    $$("#themeList [data-theme]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.theme === id));
    const slot = IDEAS.slots[t.slot];
    const box = $("#themeDetail");
    box.classList.remove("hidden");
    box.innerHTML = `<h2>${esc(t.title)}</h2>
      ${t.proven ? `<p class="rs-proven">✔ ${esc(t.proven)}</p>` : ""}
      <p><b>對象：</b>${esc(t.who)}</p>
      <p><b>建議時段：</b>${esc(slot.when)}</p>
      <h3>建議地區（撳站名睇附近出口）</h3>
      ${t.groups.map((g) => `<p class="hint">${esc(IDEAS.stationGroups[g].label)}</p><div class="rs-chips">${IDEAS.stationGroups[g].stations.filter((st) => STATION_CENTRE[st]).map((st) => `<button type="button" class="rs-chip" data-station="${esc(st)}" aria-pressed="${st === ideaState.station}">${esc(st)} <small>${SPOTS.filter((p) => p.station === st).length} 個出口</small></button>`).join("")}</div>`).join("")}
      <h3>道具</h3><p>${esc(t.props)}</p>
      <h3>舉牌字句</h3><ul>${t.signs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h3>開場白</h3><ul>${t.openers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <h3>貼士</h3><p>${esc(t.tips)}</p>
      <p class="rs-d-actions"><button type="button" class="btn small ghost" data-logidea="${esc(t.id)}">記錄呢個主題嘅成效</button></p>`;
    drawIdeaPins(t);
    if (window.matchMedia("(max-width: 979px)").matches) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function initIdeaMap() {
    if (ideaMap || !window.L) return;
    ideaMap = L.map("ideaMap", { minZoom: 10, maxZoom: 19 }).setView([22.33, 114.15], 11);
    L.tileLayer(TILE + "basemap/WGS84/{z}/{x}/{y}.png", { maxZoom: 19, attribution: ATTR }).addTo(ideaMap);
    L.tileLayer(TILE + "label/hk/tc/WGS84/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(ideaMap);
    ideaPins = L.layerGroup().addTo(ideaMap);
    ideaExits = L.layerGroup().addTo(ideaMap);
  }
  function drawIdeaPins(t) {
    initIdeaMap();
    if (!ideaMap) return;
    ideaMap.invalidateSize();
    ideaPins.clearLayers();
    const sts = themeStations(t);
    sts.forEach((st) => {
      const icon = L.divIcon({ className: "", html: `<span class="rs-stpin${st === ideaState.station ? " on" : ""}">${esc(st)}</span>`, iconSize: [0, 0] });
      L.marker(STATION_CENTRE[st], { icon }).on("click", () => focusStation(st)).addTo(ideaPins);
    });
    if (sts.length) ideaMap.fitBounds(sts.map((st) => STATION_CENTRE[st]), { padding: [30, 30], maxZoom: 15, animate: false });
  }
  function focusStation(st) {
    initIdeaMap();
    if (!ideaMap || !STATION_CENTRE[st]) return;
    ideaMap.invalidateSize();
    ideaState.station = st;
    $("#stationSel").value = st;
    $$("#themeDetail [data-station]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.station === st));
    $$("#ideaMap .rs-stpin").forEach((el) => el.classList.toggle("on", el.textContent === st));
    ideaExits.clearLayers();
    const ex = SPOTS.filter((p) => p.station === st);
    ex.forEach((p) => spotMarker(p).addTo(ideaExits));
    ideaMap.fitBounds(ex.map((p) => [p.lat, p.lng]).concat([STATION_CENTRE[st]]), { padding: [40, 40], maxZoom: 18, animate: false });
    if (window.matchMedia("(max-width: 979px)").matches) $("#ideaMap").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- 起動 ----------
  function render() {
    const list = filtered();
    drawList(list);
    drawMap(list);
  }
  function bindUi() {
    $("#weekSeg").innerHTML = WEEKS.map((w) => `<label><input type="radio" name="rsweek" value="${w.id}" ${w.id === state.week ? "checked" : ""}><span>${esc(w.label)}</span></label>`).join("");
    $("#weekSeg").addEventListener("change", (ev) => { state.week = ev.target.value; render(); });
    $("#tierSeg").addEventListener("change", (ev) => { const t = +ev.target.value; ev.target.checked ? state.tiers.add(t) : state.tiers.delete(t); render(); });
    const tagIds = Object.keys(DATA.tags).filter((t) => DATA.events.some((e) => e.tags.includes(t)));
    $("#fTag").insertAdjacentHTML("beforeend", tagIds.map((t) => `<option value="${t}">${esc(tagLabel(t))}</option>`).join(""));
    $("#fSrc").insertAdjacentHTML("beforeend", Object.keys(DATA.sources).map((s) => `<option value="${s}">${esc(SRC[s])}</option>`).join("") + `<option value="manual">人手加入</option>`);
    $("#fTag").addEventListener("change", (ev) => { state.tag = ev.target.value; render(); });
    $("#fSrc").addEventListener("change", (ev) => { state.src = ev.target.value; render(); });
    $("#fWeekend").addEventListener("change", (ev) => { state.weekend = ev.target.checked; render(); });
    $("#fText").addEventListener("input", (ev) => { state.text = ev.target.value; render(); });
    $("#viewSeg").addEventListener("change", (ev) => {
      document.body.dataset.view = ev.target.value;
      if (ev.target.value === "map" && map) setTimeout(() => map.invalidateSize(), 50);
    });
    document.body.dataset.view = "map";
    document.addEventListener("click", (ev) => {
      const o = ev.target.closest("[data-open]"); if (o) { openDetail(o.dataset.open); return; }
      if (ev.target.closest("[data-close]")) { $("#detail").close(); return; }
      const lg = ev.target.closest("[data-log]");
      if (lg) { $("#detail").close(); switchTab("log"); $("#logEvent").value = lg.dataset.log; }
    });
    $("#detail").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
    $("#posterBtn").addEventListener("click", poster);
    $$(".rs-tabs [role=tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  }
  let loaded = {};
  function switchTab(id) {
    $$(".rs-tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === id));
    $$(".rs-pane").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + id));
    if (id === "plan" && map) setTimeout(() => map.invalidateSize(), 50);
    if (id === "idea") { initIdeaMap(); setTimeout(() => ideaMap && ideaMap.invalidateSize(), 50); }
    if (id === "log" && !loaded.log) { loaded.log = 1; loadLogs(); }
    if (id === "suggest" && !loaded.sug) { loaded.sug = 1; loadSugs(); }
  }

  async function start() {
    try {
      const [ev, sp, idea] = await Promise.all([fetch("/data/roadshow/events.json").then((r) => r.json()), fetch("/data/roadshow/spots.json").then((r) => r.json()), fetch("/data/roadshow/ideas.json").then((r) => r.json()).catch(() => null)]);
      IDEAS = idea;
      DATA = ev; SPOTS = sp.spots; SPOTS.forEach((p) => (SPOT_BY[p.id] = p));
    } catch (err) { $("#dataInfo").textContent = "數據載入唔到：" + err.message; return; }
    const okSrc = Object.entries(DATA.sources).map(([k, v]) => `${SRC[k]}${v.ok ? "" : "⚠"}`).join("、");
    $("#dataInfo").textContent = `數據更新：${DATA.updated}（每星期一）｜涵蓋至 ${DATA.until}｜來源：${okSrc}｜已剔走演唱會／球賽 ${DATA.droppedConcertsSports} 個`;
    if (DATA.problems && DATA.problems.length) { const p = $("#problems"); p.classList.remove("hidden"); p.innerHTML = "部分來源今次拎唔到，用緊上次資料：<ul>" + DATA.problems.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>"; }
    WEEKS = weeks();
    stationCentres();
    bindUi(); bindForms(); fillLogEvents();
    if (IDEAS) initIdeas();
    if (window.L) initMap(); else $("#map").textContent = "地圖載入唔到。";
    render();
  }
  start();
})();
