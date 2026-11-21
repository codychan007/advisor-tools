/* 強積金工具（/mpf/）：畫面。數據：data/mpf/*.json（GitHub Actions 自動更新）；計數：mpf-core.js */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var D = {};               // market, prices, rules, themes, offers, fsIndex
  var AIA = "AIA MPF - Prime Value Choice";
  var COLORS = ["#2E4A6B", "#B8442E", "#C8962E", "#5B7F4A", "#7A5C99", "#3A8C8C", "#8C6A3A", "#A23B72"];
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(v, d) { return v == null || isNaN(v) ? "–" : (+v).toFixed(d == null ? 2 : d) + "%"; }
  function sgn(v) { return v == null || isNaN(v) ? "" : v > 0 ? "pos" : v < 0 ? "neg" : ""; }
  function num(v, d) { return v == null || isNaN(v) ? "–" : (+v).toLocaleString("en-HK", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function shortScheme(s) { return (s || "").replace(/強積金|計劃|（強積金）|\(強積金\)/g, "").trim() || s; }
  function catShort(c) { return (c || "").replace(/^股票基金 - /, "股票 · ").replace(/^債券基金 - /, "債券 · ").replace(/^混合資產基金 - /, "混合 · ").replace(/基金$/, ""); }

  /* ---------- 共用：可排序表格 ---------- */
  function sortTable(tbl, cols, rows, state, rowHtml) {
    var s = state.sort || {};
    var sorted = rows.slice();
    if (s.key) {
      var col = cols.filter(function (c) { return c.key === s.key; })[0];
      sorted.sort(function (a, b) {
        var x = col.val(a), y = col.val(b);
        if (x == null || (typeof x === "number" && isNaN(x))) return 1;
        if (y == null || (typeof y === "number" && isNaN(y))) return -1;
        return (typeof x === "string" ? x.localeCompare(y, "zh-HK") : x - y) * (s.dir || 1);
      });
    }
    var head = "<thead><tr>" + cols.map(function (c) {
      return "<th class='" + (c.val ? "sortable " : "") + (c.cls || "") + (s.key === c.key ? " on" : "") + "' data-k='" + c.key + "'>" + c.label + (s.key === c.key ? (s.dir > 0 ? " ▲" : " ▼") : "") + "</th>";
    }).join("") + "</tr></thead>";
    tbl.innerHTML = head + "<tbody>" + sorted.map(rowHtml).join("") + "</tbody>";
    tbl.querySelectorAll("th.sortable").forEach(function (th) {
      th.onclick = function () {
        var k = th.dataset.k;
        state.sort = { key: k, dir: s.key === k ? -(s.dir || 1) : (cols.filter(function (c) { return c.key === k; })[0].desc ? -1 : 1) };
        sortTable(tbl, cols, rows, state, rowHtml);
      };
    });
  }

  /* ---------- 共用：篩選列 ---------- */
  function filterBar(el, onChange) {
    var tr = D.market.trustees.slice().sort();
    var cats = [["", "全部類別"], ["股票", "股票基金"], ["債券", "債券基金"], ["混合資產", "混合資產"], ["預設投資策略", "預設投資策略"], ["貨幣市場", "貨幣市場／保守"], ["保證", "保證基金"]];
    el.innerHTML = "<label>受託人<select data-f='tr'><option value=''>全部</option>" + tr.map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("") + "</select></label>" +
      "<label>計劃<select data-f='sch'><option value=''>全部</option></select></label>" +
      "<label>類別<select data-f='cat'>" + cats.map(function (c) { return "<option value='" + c[0] + "'>" + c[1] + "</option>"; }).join("") + "</select></label>" +
      "<label>搜尋<input type='search' data-f='q' placeholder='基金名'></label>" +
      "<label class='mpf-check'><input type='checkbox' data-f='aia'> 只睇友邦</label>";
    var st = {};
    function fillSchemes() {
      var s = el.querySelector("[data-f=sch]"), v = s.value;
      s.innerHTML = "<option value=''>全部</option>" + D.market.schemes.filter(function (x) { return !st.tr || x.trustee === st.tr; })
        .map(function (x) { return "<option value='" + x.id + "'>" + esc(x.name) + "（" + x.count + "）</option>"; }).join("");
      s.value = v;
    }
    el.querySelectorAll("[data-f]").forEach(function (i) {
      i.addEventListener(i.type === "search" ? "input" : "change", function () {
        st[i.dataset.f] = i.type === "checkbox" ? i.checked : i.value;
        if (i.dataset.f === "tr") { fillSchemes(); st.sch = el.querySelector("[data-f=sch]").value; }
        onChange();
      });
    });
    fillSchemes();
    return function (f) {
      if (st.aia && f.schemeEn !== AIA) return false;
      if (st.tr && f.trustee !== st.tr) return false;
      if (st.sch && f.schId !== st.sch) return false;
      if (st.cat && (f.category || "").indexOf(st.cat) < 0) return false;
      if (st.q && (f.fund + f.scheme + (f.fundEn || "")).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    };
  }

  function fundName(f) {
    return "<b>" + esc(f.fund) + "</b><small>" + esc(f.scheme) + " · " + esc(f.trustee) + "</small>";
  }

  /* ---------- 全行收費 ---------- */
  var feState = { sort: { key: "fer", dir: 1 } }, feFilter;
  function renderFees() {
    var rows = D.market.funds.filter(feFilter);
    $("feHint").textContent = rows.length + " 隻基金 · 積金局截至 " + D.market.asof + " · 撳欄目排序";
    var cols = [
      { key: "name", label: "基金", cls: "l", val: function (f) { return f.fund; } },
      { key: "cat", label: "類別", cls: "l", val: function (f) { return f.category; } },
      { key: "risk", label: "風險", val: function (f) { return f.risk; } },
      { key: "fer", label: "FER", val: function (f) { return f.fer; } },
      { key: "mgmt", label: "管理費", val: function (f) { return f.fee.mgmt; } },
      { key: "tf", label: "受託人費", val: function (f) { return f.fee.trustee; } },
      { key: "ef", label: "積金易平台費", val: function (f) { return f.fee.empf; } },
      { key: "if", label: "投資管理費", val: function (f) { return f.fee.invest; } },
      { key: "c1", label: "持續成本<small>1／3／5 年</small>", val: function (f) { return f.detail && f.detail.cost1; } },
      { key: "size", label: "規模<small>百萬港元</small>", desc: true, val: function (f) { return f.sizeM; } }
    ];
    sortTable($("feTable"), cols, rows, feState, function (f) {
      var d = f.detail || {}, extra = [];
      ["joiningFee", "annualFee", "contributionFee", "withdrawalFee", "bidSpread", "offerSpread"].forEach(function (k) {
        var v = d[k]; if (v && !/^0(\.0+)?%?$/.test(v) && !/不適用|n\.a/.test(v)) extra.push({ joiningFee: "參加費", annualFee: "年費", contributionFee: "供款費", withdrawalFee: "提取費", bidSpread: "買入差價", offerSpread: "賣出差價" }[k] + " " + v);
      });
      return "<tr class='" + (f.schemeEn === AIA ? "hi" : "") + "'><td class='mpf-name'>" + fundName(f) + (extra.length ? "<small>⚠ " + esc(extra.join("、")) + "</small>" : "") + "</td>" +
        "<td class='l'>" + esc(catShort(f.category)) + "</td><td>" + (f.risk || "–") + "</td><td><b>" + pct(f.fer) + "</b></td>" +
        "<td>" + (f.fee.mgmtMax ? "<small>最高</small>" : "") + pct(f.fee.mgmt) + "</td><td>" + pct(f.fee.trustee) + "</td><td>" + pct(f.fee.empf) + "</td><td>" + pct(f.fee.invest) + "</td>" +
        "<td>" + (d.cost1 != null ? "$" + d.cost1 + " / $" + d.cost3 + " / $" + d.cost5 : "–") + "</td><td>" + num(f.sizeM, 0) + "</td></tr>";
    });
  }

  /* ---------- 基金回報 ---------- */
  var reState = { sort: { key: "a5", dir: -1 } }, reFilter;
  function renderRet() {
    var P = D.prices.funds, Y = D.market.calYears;
    var rows = D.market.funds.filter(reFilter);
    $("reHint").textContent = rows.length + " 隻基金 · 每日價 " + D.prices.dailyCount + " 隻（更新：" + D.prices.updated + "）· 積金局截至 " + D.market.asof;
    var p = function (f) { return P[f.id] || {}; };
    var cols = [
      { key: "name", label: "基金", cls: "l", val: function (f) { return f.fund; } },
      { key: "px", label: "最新價", val: null },
      { key: "m1", label: "1 個月", desc: true, val: function (f) { return p(f).r1m; } },
      { key: "m3", label: "3 個月", desc: true, val: function (f) { return p(f).r3m; } },
      { key: "ytd", label: "今年", desc: true, val: function (f) { return p(f).ytd; } },
      { key: "y1", label: "1 年", desc: true, val: function (f) { return p(f).r1y != null ? p(f).r1y : f.ann[0]; } },
      { key: "a5", label: "5 年<small>每年</small>", desc: true, val: function (f) { return f.ann[1]; } },
      { key: "a10", label: "10 年<small>每年</small>", desc: true, val: function (f) { return f.ann[2]; } }
    ].concat(Y.map(function (y, i) { return { key: "c" + y, label: String(y), desc: true, val: function (f) { return f.cal[i]; } }; }));
    sortTable($("reTable"), cols, rows, reState, function (f) {
      var q = p(f), y1 = q.r1y != null ? q.r1y : f.ann[0];
      return "<tr class='" + (f.schemeEn === AIA ? "hi" : "") + "'><td class='mpf-name'>" + fundName(f) + "<small>" + esc(catShort(f.category)) + " · 風險 " + (f.risk || "–") + "</small></td>" +
        "<td>" + (q.price != null ? num(q.price, 4) + (q.daily ? " <span class='mpf-daily'>每日</span>" : "") + "<small>" + q.date + "</small>" : "–") + "</td>" +
        [q.r1m, q.r3m, q.ytd, y1, f.ann[1], f.ann[2]].concat(f.cal).map(function (v) { return "<td class='" + sgn(v) + "'>" + pct(v) + "</td>"; }).join("") + "</tr>";
    });
  }

  /* ---------- 同類比較 ---------- */
  var peState = { sort: { key: "a5", dir: -1 } }, pePicked = [];
  function initPeer() {
    var cats = {};
    D.market.funds.forEach(function (f) { cats[f.category] = (cats[f.category] || 0) + 1; });
    $("peCat").innerHTML = Object.keys(cats).sort().map(function (c) { return "<option value='" + esc(c) + "'>" + esc(c) + "（" + cats[c] + "）</option>"; }).join("");
    var def = Object.keys(cats).filter(function (c) { return c.indexOf("美國股票") >= 0; })[0];
    if (def) $("peCat").value = def;
    $("peHi").innerHTML = D.market.schemes.map(function (s) { return "<option value='" + s.id + "'>" + esc(s.name) + "</option>"; }).join("");
    var aia = D.market.schemes.filter(function (s) { return s.name.indexOf("友邦") >= 0; })[0];
    if (aia) $("peHi").value = aia.id;
    $("peCat").onchange = function () { pePicked = []; renderPeer(); };
    $("peHi").onchange = renderPeer;
  }
  function rankOf(rows, f, val, desc) {
    var v = val(f); if (v == null) return null;
    var list = rows.map(val).filter(function (x) { return x != null; }).sort(function (a, b) { return desc ? b - a : a - b; });
    return [list.indexOf(v) + 1, list.length];
  }
  function renderPeer() {
    var cat = $("peCat").value, hi = $("peHi").value, P = D.prices.funds;
    var rows = D.market.funds.filter(function (f) { return f.category === cat; });
    var mine = rows.filter(function (f) { return f.schId === hi; });
    var a5 = function (f) { return f.ann[1]; }, a1 = function (f) { return f.ann[0]; }, fer = function (f) { return f.fer; };
    $("peSummary").innerHTML = mine.length ? mine.map(function (f) {
      var r5 = rankOf(rows, f, a5, true), r1 = rankOf(rows, f, a1, true), rf = rankOf(rows, f, fer, false);
      return "<b>" + esc(f.fund) + "</b>：同類 " + rows.length + " 隻入面，5 年回報排第 " + (r5 ? r5[0] + "／" + r5[1] : "–") +
        "、1 年排第 " + (r1 ? r1[0] + "／" + r1[1] : "–") + "、收費（FER）由低至高排第 " + (rf ? rf[0] + "／" + rf[1] : "–") + "。";
    }).join("<br>") : "所選計劃冇呢個類別嘅基金。";
    var cols = [
      { key: "pick", label: "圖", val: null },
      { key: "name", label: "基金", cls: "l", val: function (f) { return f.fund; } },
      { key: "fer", label: "FER", val: fer },
      { key: "a1", label: "1 年", desc: true, val: a1 },
      { key: "a5", label: "5 年<small>每年</small>", desc: true, val: a5 },
      { key: "a10", label: "10 年<small>每年</small>", desc: true, val: function (f) { return f.ann[2]; } },
      { key: "ytd", label: "今年", desc: true, val: function (f) { return (P[f.id] || {}).ytd; } },
      { key: "risk", label: "風險", val: function (f) { return f.risk; } },
      { key: "ri", label: "風險標記", val: function (f) { return parseFloat((f.detail || {}).riskIndicator); } },
      { key: "size", label: "規模<small>百萬</small>", desc: true, val: function (f) { return f.sizeM; } }
    ];
    sortTable($("peTable"), cols, rows, peState, function (f) {
      var on = pePicked.indexOf(f.id) >= 0;
      return "<tr class='" + (f.schId === hi ? "hi" : "") + "'><td><input type='checkbox' data-pick='" + f.id + "'" + (on ? " checked" : "") + " aria-label='加入走勢圖'></td><td class='mpf-name'>" + fundName(f) + "</td>" +
        "<td><b>" + pct(f.fer) + "</b></td>" + [f.ann[0], f.ann[1], f.ann[2], (P[f.id] || {}).ytd].map(function (v) { return "<td class='" + sgn(v) + "'>" + pct(v) + "</td>"; }).join("") +
        "<td>" + (f.risk || "–") + "</td><td>" + esc((f.detail || {}).riskIndicator || "–") + "</td><td>" + num(f.sizeM, 0) + "</td></tr>";
    });
    $("peTable").onchange = function (e) {
      var id = e.target.dataset.pick; if (!id) return;
      if (e.target.checked) { if (pePicked.length >= 4) { e.target.checked = false; alert("最多 4 隻"); return; } pePicked.push(id); }
      else pePicked = pePicked.filter(function (x) { return x !== id; });
      renderLine();
    };
    $("peScatter").innerHTML = scatter(rows, hi);
    renderLine();
  }

  function scatter(rows, hi) {
    var pts = rows.filter(function (f) { return f.fer != null && f.ann[1] != null; });
    if (pts.length < 2) return "<p class='hint'>未夠 5 年數據嘅基金唔會出現喺圖入面。</p>";
    var W = 760, H = 260, L = 48, R = 12, T = 14, B = 34;
    var xs = pts.map(function (f) { return f.fer; }), ys = pts.map(function (f) { return f.ann[1]; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min(0, Math.min.apply(0, ys)), y1 = Math.max.apply(0, ys);
    if (x1 - x0 < 0.2) { x0 -= 0.1; x1 += 0.1; } if (y1 - y0 < 1) y1 = y0 + 1;
    var X = function (v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }, Yf = function (v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); };
    var g = "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='收費同 5 年回報'>";
    g += "<line x1='" + L + "' x2='" + (W - R) + "' y1='" + Yf(0) + "' y2='" + Yf(0) + "' stroke='#bbb' stroke-dasharray='3 3'/>";
    for (var i = 0; i <= 4; i++) { var yv = y0 + (y1 - y0) * i / 4; g += "<text x='" + (L - 6) + "' y='" + (Yf(yv) + 4) + "' font-size='11' text-anchor='end' fill='#666'>" + yv.toFixed(1) + "%</text>"; }
    for (i = 0; i <= 4; i++) { var xv = x0 + (x1 - x0) * i / 4; g += "<text x='" + X(xv) + "' y='" + (H - 14) + "' font-size='11' text-anchor='middle' fill='#666'>" + xv.toFixed(2) + "%</text>"; }
    g += "<text x='" + (W / 2) + "' y='" + (H - 2) + "' font-size='11' text-anchor='middle' fill='#444'>基金開支比率（FER，越左越平）</text>";
    g += "<text x='12' y='" + (T + 4) + "' font-size='11' fill='#444'>5 年每年回報</text>";
    pts.forEach(function (f) {
      var me = f.schId === hi;
      g += "<circle cx='" + X(f.fer).toFixed(1) + "' cy='" + Yf(f.ann[1]).toFixed(1) + "' r='" + (me ? 6 : 4) + "' fill='" + (me ? "#B8442E" : "#2E4A6B") + "' fill-opacity='" + (me ? 1 : .45) + "'><title>" + esc(f.fund + "（" + f.scheme + "）FER " + f.fer.toFixed(2) + "%，5 年 " + f.ann[1] + "%") + "</title></circle>";
      if (me) g += "<text x='" + (X(f.fer) + 8).toFixed(1) + "' y='" + (Yf(f.ann[1]) + 4).toFixed(1) + "' font-size='11' fill='#B8442E'>" + esc(f.fund) + "</text>";
    });
    return "<div class='mpf-legend'><span><i style='background:#B8442E'></i>所選計劃</span><span><i style='background:#2E4A6B;opacity:.5'></i>其他計劃</span></div>" + g + "</svg>";
  }

  var priceCache = {};
  function loadPrices(id) {
    if (priceCache[id]) return Promise.resolve(priceCache[id]);
    return getJSON("/data/mpf/prices/" + id + ".json").then(function (r) { priceCache[id] = r; return r; }).catch(function () { return null; });
  }
  function renderLine() {
    var box = $("peLine");
    if (!pePicked.length) { box.innerHTML = ""; return; }
    box.innerHTML = "<p class='hint'>載入緊價格…</p>";
    Promise.all(pePicked.map(loadPrices)).then(function (recs) {
      recs = recs.filter(Boolean);
      if (!recs.length) { box.innerHTML = ""; return; }
      var start = recs.map(function (r) { return r.d[0]; }).sort().pop();     // 共同起點
      var series = recs.map(function (r) {
        var i0 = r.d.findIndex(function (d) { return d >= start; }), base = r.p[i0];
        var pts = []; for (var i = i0; i < r.d.length; i++) pts.push([r.d[i], r.p[i] / base * 100]);
        return { id: r.id, pts: pts };
      });
      box.innerHTML = "<div class='mpf-chartbox'>" + lineChart(series, function (id) { var f = D.byId[id]; return f.fund + "（" + shortScheme(f.scheme) + "）"; }) + "</div>" +
        "<p class='hint'>由 " + start + " 開始（4 隻都有價嘅最早日子）= 100。月底價之間用直線連接；有每日價嘅日子會更密。</p>";
    });
  }
  function lineChart(series, label) {
    var W = 760, H = 280, L = 44, R = 12, T = 12, B = 28;
    var all = [].concat.apply([], series.map(function (s) { return s.pts; }));
    var t = function (d) { return Date.parse(d); };
    var x0 = Math.min.apply(0, all.map(function (p) { return t(p[0]); })), x1 = Math.max.apply(0, all.map(function (p) { return t(p[0]); }));
    var y0 = Math.min.apply(0, all.map(function (p) { return p[1]; })), y1 = Math.max.apply(0, all.map(function (p) { return p[1]; }));
    if (x1 === x0) x1 = x0 + 864e5; if (y1 - y0 < 2) { y0 -= 1; y1 += 1; }
    var X = function (d) { return L + (t(d) - x0) / (x1 - x0) * (W - L - R); }, Y = function (v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); };
    var g = "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='價格走勢'>";
    for (var i = 0; i <= 4; i++) { var yv = y0 + (y1 - y0) * i / 4; g += "<line x1='" + L + "' x2='" + (W - R) + "' y1='" + Y(yv) + "' y2='" + Y(yv) + "' stroke='#eee'/><text x='" + (L - 6) + "' y='" + (Y(yv) + 4) + "' font-size='11' text-anchor='end' fill='#666'>" + yv.toFixed(0) + "</text>"; }
    var y0d = new Date(x0).getFullYear(), y1d = new Date(x1).getFullYear(), stepY = Math.max(1, Math.ceil((y1d - y0d + 1) / 8));
    for (var y = y0d + 1; y <= y1d; y += stepY) { var xd = X(y + "-01-01"); if (xd > L && xd < W - R) g += "<text x='" + xd + "' y='" + (H - 8) + "' font-size='11' text-anchor='middle' fill='#666'>" + y + "</text>"; }
    series.forEach(function (s, k) {
      g += "<polyline fill='none' stroke='" + COLORS[k] + "' stroke-width='2' points='" + s.pts.map(function (p) { return X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ") + "'/>";
    });
    return "<div class='mpf-legend'>" + series.map(function (s, k) { var last = s.pts[s.pts.length - 1]; return "<span><i style='background:" + COLORS[k] + "'></i>" + esc(label(s.id)) + " " + last[1].toFixed(1) + "</span>"; }).join("") + "</div>" + g + "</svg>";
  }

  /* ---------- 參考配置 ---------- */
  var alPicks = {};   // bucketKey -> fund id（同事揀）
  var alWeights = null, alLast = null;
  function initAlloc() {
    var R = D.rules;
    $("alProf").innerHTML = Object.keys(R.profiles).map(function (k, i) {
      var p = R.profiles[k];
      return "<label><input type='radio' name='alprof' value='" + k + "'" + (k === "balanced" ? " checked" : "") + "><span>" + p.name + (p.equity != null ? " <small>股票 " + p.equity + "%</small>" : "") + "</span></label>";
    }).join("");
    var groups = {};
    D.market.schemes.forEach(function (s) { (groups[s.trustee] = groups[s.trustee] || []).push(s); });
    $("alScheme").innerHTML = Object.keys(groups).sort().map(function (t) {
      return "<optgroup label='" + esc(t) + "'>" + groups[t].map(function (s) { return "<option value='" + s.id + "'>" + esc(s.name) + "（" + s.count + " 隻）</option>"; }).join("") + "</optgroup>";
    }).join("");
    var aia = D.market.schemes.filter(function (s) { return s.name.indexOf("友邦") >= 0; })[0];
    if (aia) $("alScheme").value = aia.id;
    var th = D.themes, act = th.active || {}, actIds = act.ids || [];
    var fresh = act.month && monthsAgo(act.month) <= 2;
    $("alThemeInfo").textContent = fresh ? "「本月」= " + act.month + " TC Team 揀選（" + (act.by || "") + "）" : "本月主題已過期，請更新";
    $("alThemes").innerHTML = th.themes.map(function (t) {
      var on = fresh && actIds.indexOf(t.id) >= 0;
      return "<label class='mpf-theme" + (on ? " on" : "") + "' title='" + esc(t.fact) + "'><input type='checkbox' value='" + t.id + "'" + (on ? " checked" : "") + ">" + esc(t.name) + (on ? " <b>本月</b>" : "") + "</label>";
    }).join("");
    var sync = function (src) { var v = Math.max(18, Math.min(64, +src.value || 35)); $("alAge").value = v; $("alAgeR").value = v; runAlloc(true); };
    $("alAge").oninput = function () { sync($("alAge")); };
    $("alAgeR").oninput = function () { sync($("alAgeR")); };
    $("alCustom").oninput = function () { $("alCustomV").textContent = $("alCustom").value + "%"; runAlloc(true); };
    document.querySelectorAll("input[name=alprof],input[name=aln]").forEach(function (i) { i.onchange = function () { runAlloc(true); }; });
    $("alScheme").onchange = function () { alPicks = {}; runAlloc(true); };
    $("alThemes").onchange = function (e) { e.target.closest(".mpf-theme").classList.toggle("on", e.target.checked); runAlloc(true); };
    runAlloc(true);
  }
  function monthsAgo(ym) { var d = new Date(), p = ym.split("-"); return (d.getFullYear() - +p[0]) * 12 + (d.getMonth() + 1 - +p[1]); }

  function runAlloc(reset) {
    var prof = document.querySelector("input[name=alprof]:checked").value;
    $("alCustomWrap").classList.toggle("hidden", prof !== "custom");
    var age = +$("alAge").value, sid = $("alScheme").value;
    var input = { age: age, profile: prof, customEquity: +$("alCustom").value, nFunds: +document.querySelector("input[name=aln]:checked").value,
                  themeIds: [].map.call(document.querySelectorAll("#alThemes input:checked"), function (i) { return i.value; }),
                  schemeFunds: D.market.funds.filter(function (f) { return f.schId === sid; }) };
    var res = MpfCore.allocate(D.rules, D.themes, input);
    $("alYears").textContent = "距離 " + D.rules.retireAge + " 歲尚有 " + res.years + " 年";
    if (reset) alWeights = res.buckets.map(function (b) { return { key: b.key, name: b.name, kind: b.kind, weight: b.weight, cands: b.cands, manual: false }; });
    alLast = { res: res, input: input };
    renderAllocResult();
  }

  function renderAllocResult() {
    var res = alLast.res, input = alLast.input, sid = $("alScheme").value;
    var schemeFunds = input.schemeFunds.slice().sort(function (a, b) { return a.fund.localeCompare(b.fund, "zh-HK"); });
    var rows = alWeights.map(function (b) {
      var id = alPicks[b.key + (b.manual ? "*" : "")] || (b.cands[0] && b.cands[0].id);
      return { b: b, fund: D.byId[id], weight: b.weight };
    });
    var total = rows.reduce(function (a, r) { return a + (+r.weight || 0); }, 0);
    var st = MpfCore.portfolioStats(rows);
    var riskOk = st.risk <= res.profile.riskMax + 0.001;
    var h = "<div class='mpf-res'><h2 class='mpf-h2'>參考配置</h2>";
    h += "<div class='mpf-bar'>" + rows.map(function (r, i) { return r.weight > 0 ? "<span style='width:" + r.weight + "%;background:" + COLORS[i % COLORS.length] + "'>" + (r.weight >= 10 ? r.weight + "%" : "") + "</span>" : ""; }).join("") + "</div>";
    h += "<div class='mpf-legend'>" + rows.map(function (r, i) { return "<span><i style='background:" + COLORS[i % COLORS.length] + "'></i>" + esc(r.b.name) + " " + r.weight + "%</span>"; }).join("") + "</div>";
    if (res.warnings.length) h += "<p class='mpf-warn'>" + res.warnings.map(esc).join("<br>") + "</p>";
    h += "<div class='mpf-picks'>" + rows.map(function (r, i) {
      var list = r.b.manual ? schemeFunds : r.b.cands;
      var f = r.fund, pr = f ? D.prices.funds[f.id] || {} : {};
      return "<div class='mpf-pick'><div class='mpf-pick-head'><i class='fa-dot' style='display:inline-block;width:12px;height:12px;border-radius:50%;background:" + COLORS[i % COLORS.length] + "'></i><b>" + esc(r.b.name) + "</b>" +
        "<input type='number' min='0' max='100' step='5' value='" + r.weight + "' data-w='" + i + "' aria-label='比例'>%" +
        (r.b.manual ? " <button type='button' class='btn small' data-del='" + i + "'>刪除</button>" : "") + "</div>" +
        "<select data-pick='" + i + "' aria-label='揀基金'>" + list.map(function (c) {
          return "<option value='" + c.id + "'" + (f && c.id === f.id ? " selected" : "") + ">" + esc(c.fund) + " · FER " + pct(c.fer) + " · 1年 " + pct(c.ann[0]) + " · 5年 " + pct(c.ann[1]) + " · 風險 " + (c.risk || "–") + "</option>";
        }).join("") + "</select>" +
        (f ? "<div class='mpf-facts'><span>FER <b>" + pct(f.fer) + "</b></span><span>今年 <b class='" + sgn(pr.ytd) + "'>" + pct(pr.ytd) + "</b></span><span>1 年 <b>" + pct(pr.r1y != null ? pr.r1y : f.ann[0]) + "</b></span><span>5 年每年 <b>" + pct(f.ann[1]) + "</b></span><span>風險級別 <b>" + (f.risk || "–") + "</b></span><span>" + esc(catShort(f.category)) + "</span></div>" : "<p class='mpf-warn'>呢個類別冇基金</p>") +
        "</div>";
    }).join("") + "</div>";
    h += "<div class='mpf-sumline'><button type='button' class='btn small' id='alAdd'>＋ 加其他基金（例如混合資產）</button><button type='button' class='btn small' id='alReset'>重設</button>" +
      "<span class='" + (total === 100 ? "ok" : "bad") + "'>合計 " + total + "%" + (total === 100 ? " ✓" : "（要等於 100%）") + "</span></div>";
    h += "<div class='mpf-kpis'><div class='mpf-kpi'><small>股票比例</small><b>" + rows.filter(function (r) { return r.fund && /股票基金/.test(r.fund.category); }).reduce(function (a, r) { return a + r.weight; }, 0) + "%</b></div>" +
      "<div class='mpf-kpi'><small>加權風險級別</small><b class='" + (riskOk ? "" : "neg") + "'>" + st.risk.toFixed(1) + "</b><small>" + res.profile.name + "上限 " + res.profile.riskMax + (riskOk ? " ✓" : " ⚠ 超出") + "</small></div>" +
      "<div class='mpf-kpi'><small>加權 FER</small><b>" + st.fer.toFixed(2) + "%</b></div>" +
      "<div class='mpf-kpi'><small>過去 1 年（加權）</small><b class='" + sgn(st.r1) + "'>" + pct(st.r1) + "</b></div>" +
      "<div class='mpf-kpi'><small>過去 5 年每年（加權）</small><b class='" + sgn(st.r5) + "'>" + pct(st.r5) + "</b></div>" +
      "<div class='mpf-kpi'><small>預設投資策略同齡股票</small><b>" + res.dis + "%</b></div></div>";
    h += "<h3>點解係呢個比例</h3><ol class='mpf-steps'>" + res.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    h += "<h3>時事部署邏輯</h3><div class='mpf-why'>" + MpfCore.rationale(res, input.age).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") + "</div>";
    var nm = LS.get("mpf.contactName") || "", tel = LS.get("mpf.contactTel") || "";
    h += "<div class='mpf-pdf'><label class='mpf-check'><input type='checkbox' id='pdfContact'" + (LS.get("mpf.showContact") === "1" ? " checked" : "") + "> PDF 顯示我嘅聯絡資料</label>" +
      "<input type='text' id='pdfName' placeholder='姓名' value='" + esc(nm) + "'><input type='tel' id='pdfTel' placeholder='電話' value='" + esc(tel) + "'>" +
      "<button type='button' class='btn primary' id='pdfBtn'" + (total === 100 ? "" : " disabled") + ">下載 PDF</button><span id='pdfMsg' class='hint'></span></div>";
    h += "<p class='hint'>聯絡資料只會記喺你部機（瀏覽器），唔會上傳。PDF 唔會有客人姓名。</p></div>";
    $("alResult").innerHTML = h;

    $("alResult").querySelectorAll("[data-w]").forEach(function (i) { i.onchange = function () { alWeights[+i.dataset.w].weight = Math.max(0, Math.min(100, +i.value || 0)); renderAllocResult(); }; });
    $("alResult").querySelectorAll("select[data-pick]").forEach(function (s) { s.onchange = function () { var b = alWeights[+s.dataset.pick]; alPicks[b.key + (b.manual ? "*" : "")] = s.value; renderAllocResult(); }; });
    $("alResult").querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { alWeights.splice(+b.dataset.del, 1); renderAllocResult(); }; });
    $("alAdd").onclick = function () {
      var key = "x" + Date.now();
      alWeights.push({ key: key, name: "其他基金", kind: "other", weight: 0, cands: [], manual: true });
      var mixed = schemeFunds.filter(function (f) { return /混合資產/.test(f.category); })[0] || schemeFunds[0];
      if (mixed) alPicks[key + "*"] = mixed.id;
      renderAllocResult();
    };
    $("alReset").onclick = function () { alPicks = {}; runAlloc(true); };
    ["pdfName", "pdfTel"].forEach(function (id) { $(id).onchange = function () { LS.set(id === "pdfName" ? "mpf.contactName" : "mpf.contactTel", $(id).value); }; });
    $("pdfContact").onchange = function () { LS.set("mpf.showContact", $("pdfContact").checked ? "1" : "0"); };
    $("pdfBtn").onclick = function () { makePdf(rows, st, res, input); };
  }

  function makePdf(rows, st, res, input) {
    if (!window.html2canvas || !window.FundPdf) { $("pdfMsg").textContent = "PDF 元件載入失敗，請重新整理"; return; }
    $("pdfMsg").textContent = "整緊 PDF…";
    var scheme = D.market.schemes.filter(function (s) { return s.id === $("alScheme").value; })[0];
    var showC = $("pdfContact").checked && ($("pdfName").value || $("pdfTel").value);
    var h = "<div class='mpf-report'><div class='mpf-rep-head'><div><h1>強積金參考配置</h1><p>" + esc(scheme ? scheme.name : "") + " · 客戶 " + input.age + " 歲（距離 65 歲 " + res.years + " 年）· " + esc(res.profile.name) + "</p></div>" +
      "<div style='text-align:right;font-size:11px'>" + today() + (showC ? "<br>" + esc($("pdfName").value) + " " + esc($("pdfTel").value) : "") + "</div></div>";
    h += "<div class='mpf-bar'>" + rows.map(function (r, i) { return r.weight > 0 ? "<span style='width:" + r.weight + "%;background:" + COLORS[i % COLORS.length] + "'>" + (r.weight >= 10 ? r.weight + "%" : "") + "</span>" : ""; }).join("") + "</div>";
    h += "<table><thead><tr><th>基金</th><th>比例</th><th>FER</th><th>今年</th><th>1 年</th><th>5 年每年</th><th>風險</th></tr></thead><tbody>" + rows.filter(function (r) { return r.fund && r.weight > 0; }).map(function (r, i) {
      var f = r.fund, pr = D.prices.funds[f.id] || {};
      return "<tr><td><b>" + esc(f.fund) + "</b><br><span style='color:#666'>" + esc(catShort(f.category)) + "</span></td><td>" + r.weight + "%</td><td>" + pct(f.fer) + "</td><td>" + pct(pr.ytd) + "</td><td>" + pct(pr.r1y != null ? pr.r1y : f.ann[0]) + "</td><td>" + pct(f.ann[1]) + "</td><td>" + (f.risk || "–") + "</td></tr>";
    }).join("") + "</tbody></table>";
    h += "<p>加權風險級別 " + st.risk.toFixed(1) + " · 加權 FER " + st.fer.toFixed(2) + "% · 過去 1 年（加權）" + pct(st.r1) + " · 過去 5 年每年（加權）" + pct(st.r5) + "</p>";
    h += "<h3>點解係呢個比例</h3><ol style='margin:0;padding-left:18px'>" + res.steps.map(function (s) { return "<li>" + esc(s.replace(/^[①-⑧]\s*/, "")) + "</li>"; }).join("") + "</ol>";
    h += "<h3>時事部署邏輯</h3>" + MpfCore.rationale(res, input.age).map(function (p) { return "<p style='margin:3px 0'>" + esc(p) + "</p>"; }).join("");
    h += "<div class='mpf-rep-disc'>" + D.rules.disclaimer.map(function (d) { return "<p>" + esc(d) + "</p>"; }).join("") +
      "<p>資料來源：積金局強積金基金平台（截至 " + esc(D.market.asof) + "）、受託人網站（價格截至 " + esc(D.prices.updated.slice(0, 10)) + "）。投資前請參閱有關計劃說明書。</p></div></div>";
    var host = $("reportHost"); host.innerHTML = h;
    window.html2canvas(host.firstChild, { scale: 2, backgroundColor: "#ffffff", logging: false }).then(function (canvas) {
      window.FundPdf.download(window.FundPdf.fromCanvas(canvas, 0.9), "強積金參考配置-" + today() + ".pdf");
      $("pdfMsg").textContent = "已下載";
      host.innerHTML = "";
    }).catch(function (e) { $("pdfMsg").textContent = "PDF 出錯：" + e.message; });
  }

  /* ---------- 每月單張變化 ---------- */
  var fsCache = {}, fsSel = null;
  function loadFs(m) { return fsCache[m] ? Promise.resolve(fsCache[m]) : getJSON("/data/mpf/factsheets/aia-" + m + ".json").then(function (r) { fsCache[m] = r; return r; }); }
  function initFs() {
    var iss = (D.fsIndex.issues || []).slice().reverse();
    if (!iss.length) { $("fsHint").textContent = "未有基金單張數據。"; return; }
    $("fsMonth").innerHTML = iss.map(function (x, i) { return "<option value='" + x.month + "'>" + x.month + (iss[i + 1] ? " 對比 " + iss[i + 1].month : "（最早一期）") + "</option>"; }).join("");
    $("fsMonth").onchange = renderFs;
    renderFs();
  }
  function renderFs() {
    var m = $("fsMonth").value, iss = D.fsIndex.issues.map(function (x) { return x.month; }), i = iss.indexOf(m), pm = iss[i - 1];
    Promise.all([loadFs(m), pm ? loadFs(pm) : Promise.resolve(null)]).then(function (r) {
      var cur = r[0], prev = r[1];
      $("fsHint").innerHTML = "友邦強積金優選計劃「基金表現回顧」" + m + "（數據截至 " + (cur.asof || m) + "）" + (prev ? " 對比 " + pm : "") +
        "。AIA 大約遲 2–3 個月出；十大持股只喺單數月（1、3、5、7、9、11 月）更新。<a href='" + esc(cur.source) + "' target='_blank' rel='noopener'>原文 PDF</a>";
      var list = Object.keys(cur.funds).map(function (id) {
        var d = MpfCore.diffFactsheet(prev && prev.funds[id], cur.funds[id]);
        return { id: id, f: cur.funds[id], d: d };
      }).sort(function (a, b) { return b.d.score - a.d.score; });
      $("fsList").innerHTML = "<div class='mpf-fslist'>" + list.map(function (x, k) {
        var big = x.d.alloc.filter(function (a) { return a.diff != null && Math.abs(a.diff) >= 2; }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
        var note = [];
        big.slice(0, 2).forEach(function (a) { note.push(a.label.split(" ")[0] + " " + (a.diff > 0 ? "+" : "") + a.diff.toFixed(1) + "%"); });
        if (x.d.topIn.length) note.push("新入十大：" + x.d.topIn.map(function (h) { return h[0].split(" ")[0]; }).slice(0, 2).join("、"));
        if (!note.length) note.push(prev ? "冇明顯變化" : "最早一期");
        return "<button type='button' class='mpf-fscard" + (k < 5 && x.d.score >= 2 ? " top" : "") + (fsSel === x.id ? " on" : "") + "' data-id='" + x.id + "'><b>" + esc(x.f.name) + "</b><small>" + esc(note.join("；")) + "</small>" +
          x.d.keywords.map(function (t) { return "<span class='mpf-tag'>" + esc(t) + "</span>"; }).join("") + (x.f.problems.length ? "<small class='mpf-warn'>⚠ 讀取有問題</small>" : "") + "</button>";
      }).join("") + "</div>";
      $("fsList").querySelectorAll("[data-id]").forEach(function (b) { b.onclick = function () { fsSel = b.dataset.id; renderFs(); }; });
      var sel = list.filter(function (x) { return x.id === fsSel; })[0];
      $("fsDetail").innerHTML = sel ? fsDetail(sel, prev, pm) : "<p class='hint'>撳上面一隻基金睇詳細變化（橙色框 = 今期變化最大嘅 5 隻）。</p>";
    }).catch(function (e) { $("fsHint").textContent = "載入失敗：" + e.message; });
  }
  function fsDetail(x, prev, pm) {
    var d = x.d, f = x.f, mk = D.byId[x.id];
    var h = "<div class='mpf-fsdetail'><h2 class='mpf-h2'>" + esc(f.name) + " <small class='muted'>" + esc(f.nameEn) + "</small></h2>";
    if (f.problems.length) h += "<p class='mpf-warn'>⚠ " + esc(f.problems.join("；")) + "</p>";
    if (mk) h += "<p class='hint'>FER " + pct(mk.fer) + " · 風險級別 " + (mk.risk || "–") + " · " + esc(catShort(mk.category)) + "</p>";
    h += "<div class='mpf-fsgrid'><div><h3>資產分布</h3><div class='table-wrap'><table class='mpf-table'><thead><tr><th class='l'>項目</th><th>今期</th><th>上期</th><th>變化</th></tr></thead><tbody>" +
      d.alloc.map(function (a) {
        var cls = a.diff == null ? "" : a.diff >= 2 ? "mpf-up" : a.diff <= -2 ? "mpf-down" : "";
        return "<tr><td class='l'>" + esc(a.label) + "</td><td>" + pct(a.now) + "</td><td>" + pct(a.before) + "</td><td class='" + cls + "'>" + (a.diff == null ? "新" : (a.diff > 0 ? "+" : "") + a.diff.toFixed(2)) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    h += "<div><h3>十大投資項目 <small class='muted'>截至 " + esc(f.topAsof || "–") + "</small></h3>";
    if (prev && d.topSame) h += "<p class='hint'>今期十大未更新（同上期一樣，AIA 雙數月唔更新）。</p>";
    h += "<ol style='margin:0;padding-left:20px;font-size:14px'>" + (f.top10 || []).map(function (t) {
      var isNew = d.topIn.some(function (n) { return n[0] === t[0]; }), mv = d.topMove.filter(function (m) { return m[0] === t[0]; })[0];
      return "<li>" + esc(t[0]) + " <b>" + t[1] + "%</b>" + (isNew ? " <span class='mpf-up'>新入</span>" : "") + (mv ? " <small class='" + (mv[2] > mv[1] ? "mpf-up" : "mpf-down") + "'>(上期 " + mv[1] + "%)</small>" : "") + "</li>";
    }).join("") + "</ol>";
    if (d.topOut.length) h += "<p class='hint'>跌出十大：" + d.topOut.map(function (t) { return esc(t[0]) + "（" + t[1] + "%）"; }).join("、") + "</p>";
    h += "</div></div>";
    h += "<h3>基金經理報告</h3><p class='hint'>" + (prev ? "黃色底 = 今期新寫嘅句子（上期冇）。" : "") + d.keywords.map(function (t) { return "<span class='mpf-tag'>" + esc(t) + "</span>"; }).join("") + "</p>";
    h += "<p class='mpf-sent'>" + (d.sentences || []).map(function (s) { return s.isNew && prev ? "<mark>" + esc(s.text) + "</mark>" : esc(s.text); }).join("") + "</p>";
    if (prev && prev.funds[x.id]) h += "<details class='note'><summary>上期（" + pm + "）原文</summary><p class='mpf-sent'>" + esc(prev.funds[x.id].reportZh) + "</p></details>";
    return h + "</div>";
  }

  /* ---------- 轉移優惠 ---------- */
  function renderOffers() {
    var O = D.offers, t = today();
    $("ofNews").innerHTML = (O.news || []).map(function (n) {
      return "<div class='mpf-news'><b>" + esc(n.title) + "</b><p>" + esc(n.body) + "</p><small>來源：<a href='" + esc(n.source) + "' target='_blank' rel='noopener'>" + esc(n.sourceName) + "</a></small></div>";
    }).join("");
    $("ofHint").textContent = "最後更新 " + O.updated + "。每月核對一次；細節以各受託人條款為準。";
    var list = (O.offers || []).slice().sort(function (a, b) { return (b.trustee === "友邦") - (a.trustee === "友邦") || (a.to || "9").localeCompare(b.to || "9"); });
    $("ofList").innerHTML = list.map(function (o) {
      var old = o.to && o.to < t;
      return "<div class='mpf-offer" + (o.trustee === "友邦" ? " aia" : "") + (old ? " old" : "") + "'><h3>" + esc(o.trustee) + "：" + esc(o.title) + "</h3><p><small>" + esc(o.scheme) + "</small></p>" +
        (o.from ? "<p>優惠期：" + esc(o.from) + " 至 " + esc(o.to) + (old ? "（已完）" : "") + "</p>" : "") +
        (o.reward ? "<p>回贈：" + esc(o.reward) + "</p>" : "") + (o.conditions ? "<p>條件：" + esc(o.conditions) + "</p>" : "") +
        "<p><small>核對：" + esc(o.checked) + (o.verified ? "" : "（未逐條睇條款）") + " · <a href='" + esc(o.source) + "' target='_blank' rel='noopener'>官方頁面</a></small></p></div>";
    }).join("");
  }

  /* ---------- 分頁、載入 ---------- */
  var inited = {};
  function show(tab) {
    document.querySelectorAll(".mpf-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false"); });
    document.querySelectorAll(".mpf-pane").forEach(function (p) { p.classList.toggle("hidden", p.id !== "tab-" + tab); });
    LS.set("mpf.tab", tab);
    if (inited[tab]) return;
    inited[tab] = true;
    if (tab === "alloc") initAlloc();
    if (tab === "peer") { initPeer(); renderPeer(); }
    if (tab === "fees") { feFilter = filterBar($("feFilters"), renderFees); renderFees(); }
    if (tab === "ret") { reFilter = filterBar($("reFilters"), renderRet); renderRet(); }
    if (tab === "fs") initFs();
    if (tab === "offer") renderOffers();
  }

  Promise.all(["market", "prices-index", "allocation-rules", "themes", "offers", "factsheets/index"].map(function (n) { return getJSON("/data/mpf/" + n + ".json"); }))
    .then(function (r) {
      D.market = r[0]; D.prices = r[1]; D.rules = r[2]; D.themes = r[3]; D.offers = r[4]; D.fsIndex = r[5];
      D.byId = {}; D.market.funds.forEach(function (f) { D.byId[f.id] = f; });
      $("topDisc").textContent = D.rules.disclaimer[0];
      $("dataInfo").textContent = "全行數據：積金局，截至 " + D.market.asof + "（" + D.market.funds.length + " 隻基金）｜每日價：" + D.prices.dailyCount + " 隻，更新 " + D.prices.updated;
      document.querySelectorAll(".mpf-tabs button").forEach(function (b) { b.onclick = function () { show(b.dataset.tab); }; });
      var t = LS.get("mpf.tab");
      show(t && $("tab-" + t) ? t : "alloc");
    })
    .catch(function (e) { $("dataInfo").textContent = "載入數據失敗：" + e.message; });
})();
