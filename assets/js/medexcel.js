/* 客人版 Excel「<名字>的醫療儲備計劃.xlsx」— 排版跟 medical-saving skill 嘅 make_excel.py（紫色標題、藍／淺橙表頭、黃色行、紅色總數、右邊重點） */
(function () {
  "use strict";
  var PURPLE = "FF7581BF", BLUE = "FF2E75B5", PEACH = "FFF7CAAC", YELLOW = "FFFFFF00", RED = "FFFF0000";
  var FONT = "Microsoft JhengHei", MONEY = '#,##0;-#,##0;""';
  function fill(c) { return { type: "pattern", pattern: "solid", fgColor: { argb: c } }; }
  function fmt(v) { return window.MedCalc.fmt(v); }

  function build(f, sched, rows) {
    var C = window.MedCalc, sv = C.SAVINGS[f.savings], md = sched.desc;
    var issue = f.age, S = f.startYear, endAge = f.endAge, pay = f.payYears, prem = f.premium;
    var med = {}; sched.rows.forEach(function (r) { med[r.age] = r.usd; });

    var opt = [];
    if (md.ward) opt.push(md.ward);
    if (md.deductibleHKD !== null) opt.push(md.deductibleUSD !== null ? "US$" + fmt(md.deductibleUSD) + " 自付費" : "HK$" + fmt(md.deductibleHKD) + " 自付費");
    if (md.area) opt.push(md.area);
    var medLabel = md.plan + (opt.length ? "（" + opt.join("／") + "）" : "");
    var payLabel = pay === 0 ? "一次過繳費" : pay + "年交付";
    var premLabel = pay === 0 ? "整付保費美元$" + fmt(prem) : "每年美元$" + fmt(prem);

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet("醫療儲備計劃", { views: [{ showGridLines: false, state: "frozen", ySplit: 3 }] });
    [8, 8, 13, 15, 14, 14, 16, 18, 3, 46].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });

    ws.mergeCells("A1:H1");
    var t = ws.getCell("A1");
    t.value = f.name + "的醫療儲備計劃\n香港友邦AIA－" + sv.name + " + " + medLabel + "\n（" + payLabel + "）" + premLabel + " + 醫療保費";
    t.font = { name: FONT, size: 20, bold: true, color: { argb: "FFFFFFFF" } };
    t.fill = fill(PURPLE);
    t.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.getRow(1).height = 96;

    var heads = [["年齡", BLUE], ["保單\n完結\n年度", BLUE], ["每年保費\n(USD)", BLUE], ["繳付保費\n總額(USD)", BLUE],
      ["醫保保費\n(USD)", PEACH], ["現金提取\n(USD)", PEACH], ["累積現金提取\n(USD)", PEACH], ["提取後\n退保現金價值\n(USD)", PEACH]];
    var thin = { style: "thin", color: { argb: "FFBFBFBF" } };
    heads.forEach(function (h, i) {
      var c = ws.getRow(3).getCell(i + 1);
      c.value = h[0]; c.fill = fill(h[1]);
      c.font = { name: FONT, size: 11, bold: true, color: { argb: h[1] === BLUE ? "FFFFFFFF" : "FF000000" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = { top: thin, bottom: thin, left: thin, right: thin };
    });
    ws.getRow(3).height = 58;

    function put(r, col, v, isMoney) {
      var c = ws.getRow(r).getCell(col);
      c.value = v;
      c.font = { name: FONT, size: 11 };
      c.alignment = { horizontal: "center", vertical: "middle" };
      if (isMoney) c.numFmt = MONEY;
      return c;
    }

    var r = 4;
    put(r, 1, String(issue)); put(r, 2, "投保時");
    for (var k = 3; k <= 8; k++) put(r, k, k === 5 ? med[issue] : null, true);

    var paidTotal = 0, cumWd = 0, clientMed = med[issue];
    var lastPay = pay > 0 ? pay : 1;
    rows.forEach(function (x) {
      r++;
      var n = x.n;
      var thisPrem = (pay === 0 && n === 1) || (n > 0 && n <= pay) ? prem : 0;
      paidTotal += thisPrem;
      var wd = n >= S ? x.withdrawal : 0;
      cumWd += wd;
      if (n < S) clientMed += med[x.age];
      put(r, 1, x.age); put(r, 2, n);
      put(r, 3, thisPrem, true); put(r, 4, paidTotal, true); put(r, 5, med[x.age], true);
      put(r, 6, wd, true); put(r, 7, cumWd, true); put(r, 8, x.surrender, true);
      if (n === lastPay || (n > lastPay && (n - lastPay) % 5 === 0))
        for (var col = 1; col <= 8; col++) ws.getRow(r).getCell(col).fill = fill(YELLOW);
    });

    var totalMed = 0; for (var a = issue; a <= endAge; a++) totalMed += med[a];
    var savingsTotal = prem * (pay === 0 ? 1 : pay);

    r++;
    ws.mergeCells(r, 1, r, 8);
    var red = ws.getRow(r).getCell(1);
    red.value = "醫療總保費：US$" + fmt(totalMed) + "（由 " + issue + "–" + endAge + " 歲）";
    red.fill = fill(RED);
    red.font = { name: FONT, size: 13, bold: true, color: { argb: "FFFFFFFF" } };
    red.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = 26;

    r += 2;
    ws.mergeCells(r, 1, r + 2, 8);
    var basis = "醫保保費按 AIA 官網保費表（生效日 " + md.effective + "）"
      + (md.rider ? "，附加契約按" + md.riderBasis : "")
      + (md.convertedFromHKD ? "，港元 ÷ " + md.hkdRate + " 換算美元" : "")
      + (md.inflation ? "，並假設醫療通脹每年 " + md.inflation + "%（投保後每年按此增長），實際保費調整以 AIA 為準。" : "；未計醫療通脹及保費調整。");
    var dc = ws.getRow(r).getCell(1);
    dc.value = "以上數字只供參考，以 AIA 正式建議書為準。儲蓄計劃數字為預期情景，非保證。" + basis;
    dc.font = { name: FONT, size: 9, color: { argb: "FF595959" } };
    dc.alignment = { wrapText: true, vertical: "top" };

    // 線圖（PNG）放 J 欄頂，「重點」移落圖下面
    var SIDE_ROW = 4;
    var cd = chartData(f, sched, rows), png = chartPng(cd, md);
    if (png) {
      var img = wb.addImage({ base64: png, extension: "png" });
      ws.addImage(img, { tl: { col: 9, row: 0 }, ext: { width: CHART_W, height: CHART_H } });
      SIDE_ROW = 11;
    }

    var side = [
      ["重點", null, true],
      ["唔做醫療儲備：醫保保費合共 US$" + fmt(cd.a[cd.a.length - 1].v) + "（" + issue + "–" + endAge + " 歲）"],
      ["做醫療儲備：客人自己出 US$" + fmt(cd.b[cd.b.length - 1].v) + "（儲蓄計劃保費 + 首 " + S + " 年醫保）"],
      ["首 " + S + " 年醫療保費（客人自己俾）：US$" + fmt(clientMed)],
      ["首 " + S + " 年總儲備保費：US$" + fmt(savingsTotal + clientMed)],
      ["（儲蓄計劃 US$" + fmt(savingsTotal) + " + 醫療 US$" + fmt(clientMed) + "）"],
      ["醫療總保費：US$" + fmt(totalMed) + "（由 " + issue + "–" + endAge + " 歲）"],
      ["由第 " + S + " 個保單年度（" + (issue + S) + " 歲）開始用儲蓄計劃俾醫保"],
      [""],
      [md.plan + " 保費表", md.premiumPdf],
      [md.plan + " 簡介", md.brochure],
      [sv.name + " 簡介", sv.brochure]
    ];
    side.forEach(function (s, i) {
      var c = ws.getRow(SIDE_ROW + i).getCell(10);
      c.value = s[1] ? { text: s[0], hyperlink: s[1] } : s[0];
      c.font = { name: FONT, size: 11, bold: !!s[2], underline: s[1] ? "single" : undefined, color: { argb: s[1] ? "FF0563C1" : "FF000000" } };
    });

    ws.pageSetup.fitToPage = true; ws.pageSetup.fitToWidth = 1; ws.pageSetup.fitToHeight = 0;
    ws.pageSetup.printTitlesRow = "3:3";
    return wb;
  }

  /* 線 A：唔做儲備，每年醫保保費累計到終止歲數。
     線 B：做儲備，客人自己出嘅錢（儲蓄計劃已繳保費 + 開始提取前自己俾嘅醫保）累計，到開始提取嗰歲停。
     儲蓄計劃保費計法同表格「繳付保費總額」一樣（第 n 年終結計入）。 */
  function chartData(f, sched, rows) {
    var issue = f.age, S = f.startYear, pay = f.payYears, prem = f.premium;
    var a = [], b = [], cumMed = 0, paid = 0, clientMed = 0;
    sched.rows.forEach(function (r) {
      cumMed += r.usd;
      a.push({ age: r.age, v: cumMed });
      if (r.n > 0 && ((pay === 0 && r.n === 1) || r.n <= pay)) paid += prem;
      if (r.n < S) clientMed += r.usd;
      if (r.n <= S) b.push({ age: r.age, v: paid + clientMed });
    });
    return { a: a, b: b, start: issue + S, issue: issue, end: f.endAge };
  }

  var CHART_W = 560, CHART_H = 340;
  function chartPng(cd, md) {
    if (typeof document === "undefined") return null;
    var k = 2, W = CHART_W, H = CHART_H;
    var cv = document.createElement("canvas"); cv.width = W * k; cv.height = H * k;
    var g = cv.getContext("2d"); if (!g) return null;
    g.scale(k, k);
    var font = function (s, b) { return (b ? "bold " : "") + s + 'px "Microsoft JhengHei","PingFang TC",sans-serif'; };
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    var L = 70, R = 20, T = 78, B = 40, pw = W - L - R, ph = H - T - B;
    var x0 = cd.issue, x1 = cd.end, maxV = 0;
    cd.a.concat(cd.b).forEach(function (p) { if (p.v > maxV) maxV = p.v; });
    var step = Math.pow(10, Math.floor(Math.log10(maxV / 4 || 1))), nice = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < nice.length; i++) if (maxV / (step * nice[i]) <= 5) { step *= nice[i]; break; }
    var top = Math.ceil(maxV / step) * step || 1;
    var X = function (age) { return L + (age - x0) / Math.max(1, x1 - x0) * pw; };
    var Y = function (v) { return T + ph - v / top * ph; };
    g.fillStyle = "#222"; g.font = font(15, true); g.textAlign = "left";
    g.fillText("累計醫療開支：做唔做醫療儲備（美元）", L - 50, 22);
    if (md && md.inflation) { g.font = font(11); g.fillStyle = "#666"; g.textAlign = "right"; g.fillText("已計醫療通脹每年 " + md.inflation + "%", W - R, 22); g.textAlign = "left"; }
    g.strokeStyle = "#e3e3e3"; g.lineWidth = 1; g.font = font(11); g.fillStyle = "#555"; g.textAlign = "right";
    for (var v = 0; v <= top + 1e-6; v += step) {
      g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + pw, Y(v)); g.stroke();
      g.fillText(v >= 1000 ? Math.round(v / 1000).toLocaleString("en-US") + "k" : String(v), L - 6, Y(v) + 4);
    }
    g.textAlign = "center";
    var xs = Math.max(1, Math.ceil((x1 - x0) / 10 / 5) * 5);
    for (var age = Math.ceil(x0 / xs) * xs; age <= x1; age += xs) g.fillText(age, X(age), T + ph + 16);
    g.fillText("歲", L + pw, T + ph + 32);
    g.strokeStyle = "#999"; g.beginPath(); g.moveTo(L, T); g.lineTo(L, T + ph); g.lineTo(L + pw, T + ph); g.stroke();
    // 開始提取虛線
    g.setLineDash([4, 4]); g.strokeStyle = "#7581BF"; g.beginPath(); g.moveTo(X(cd.start), T); g.lineTo(X(cd.start), T + ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#7581BF"; g.font = font(11); g.textAlign = "left"; g.fillText(cd.start + " 歲起由保單俾", Math.min(X(cd.start) + 4, L + pw - 90), T + 12);
    function line(pts, col) {
      g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath();
      pts.forEach(function (p, i) { if (i) g.lineTo(X(p.age), Y(p.v)); else g.moveTo(X(p.age), Y(p.v)); });
      g.stroke();
      var e = pts[pts.length - 1]; g.fillStyle = col; g.beginPath(); g.arc(X(e.age), Y(e.v), 4, 0, 7); g.fill();
      return e;
    }
    var ea = line(cd.a, "#E0442E"), eb = line(cd.b, "#2E75B5");
    g.font = font(11, true); g.textAlign = "right"; g.fillStyle = "#E0442E";
    g.fillText("US$" + Math.round(ea.v).toLocaleString("en-US"), X(ea.age) - 6, Y(ea.v) - 8);
    g.textAlign = "left"; g.fillStyle = "#2E75B5";
    g.fillText("US$" + Math.round(eb.v).toLocaleString("en-US"), X(eb.age) + 6, Y(eb.v) - 8);
    // 圖例
    g.font = font(12); g.textAlign = "left";
    [["唔做醫療儲備：自己俾晒醫保", "#E0442E"], ["做醫療儲備：儲蓄計劃保費＋自己俾嘅醫保", "#2E75B5"]].forEach(function (x, i) {
      var yy = 44 + i * 18;
      g.fillStyle = x[1]; g.fillRect(L + 10, yy - 8, 16, 4);
      g.fillStyle = "#333"; g.fillText(x[0], L + 32, yy - 2);
    });
    return cv.toDataURL("image/png");
  }

  function download(f, sched, rows) {
    if (!window.ExcelJS) return Promise.reject(new Error("Excel 程式未載入好，請等幾秒再撳"));
    var wb = build(f, sched, rows), name = f.name + "的醫療儲備計劃.xlsx";
    return wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return name;
    });
  }

  window.MedExcel = { build: build, download: download, chartData: chartData, chartPng: chartPng };
})();
