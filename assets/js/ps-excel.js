/* 保單整理器 – 出 Excel，格式跟 Cody 嘅 Policy Summary 範本：
   第 1 行大標題；「保險公司」行紅底白字；左邊標題欄；「計劃名稱」標題灰底；「N」灰底；全部框線。 */
(function () {
  "use strict";
  var FONT = "Microsoft JhengHei", RED = "FFFF0000", GREY = "FFBFBFBF", LABEL_GREY = "FFD9D9D9";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fill(c) { return { type: "pattern", pattern: "solid", fgColor: { argb: c } }; }

  function title(client) {
    var d = client.month ? new Date(client.month + "-01T00:00:00") : new Date();
    var who = (client.salutation ? client.salutation + " " : "") + (client.name || "客人") + (client.birthYear ? "(" + client.birthYear + ")" : "");
    return who + " - POLICY SUMMARY (" + MONTHS[d.getMonth()] + " " + d.getFullYear() + ")";
  }

  function rowHeight(texts, colChars) {
    var lines = 1;
    texts.forEach(function (t) {
      var len = 0; String(t || "").split("").forEach(function (ch) { len += ch.charCodeAt(0) > 255 ? 1 : 0.55; });
      var l = String(t || "").split("\n").length - 1 + Math.ceil(len / colChars);
      if (l > lines) lines = l;
    });
    return Math.max(34, lines * 24 + 10);
  }

  /* client: {salutation, name, birthYear, month:"2026-09"}; policies: [{values:{key:value}}] */
  function build(client, policies) {
    var F = window.PSCore.FIELDS, n = policies.length;
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false, state: "frozen", xSplit: 1, ySplit: 1 }] });
    ws.getColumn(1).width = 50;
    for (var i = 0; i < n; i++) ws.getColumn(i + 2).width = 36;
    var thin = { style: "thin", color: { argb: "FF000000" } }, border = { top: thin, bottom: thin, left: thin, right: thin };

    ws.mergeCells(1, 1, 1, n + 1);
    var t = ws.getCell(1, 1);
    t.value = title(client);
    t.font = { name: FONT, size: 22, bold: true };
    t.alignment = { horizontal: "center", vertical: "middle" };
    t.border = border;
    ws.getRow(1).height = 48;

    F.forEach(function (f, r) {
      var row = ws.getRow(r + 2), vals = policies.map(function (p) { return p.values[f.key] || ""; });
      var lab = row.getCell(1);
      lab.value = f.label;
      lab.font = { name: FONT, size: 14, bold: true, underline: f.key === "company" };
      lab.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      lab.border = border;
      if (f.key === "plan") lab.fill = fill(LABEL_GREY);
      vals.forEach(function (v, i) {
        var c = row.getCell(i + 2);
        c.value = v;
        c.border = border;
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        if (f.key === "company") {
          c.font = { name: FONT, size: 22, bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = fill(RED);
        } else {
          c.font = { name: FONT, size: 14, bold: f.key === "premium" };
          if (String(v).trim().toUpperCase() === "N") c.fill = fill(GREY);
        }
      });
      row.height = f.key === "company" ? 40 : rowHeight(vals, 15);
    });

    ws.pageSetup.orientation = "landscape";
    ws.pageSetup.fitToPage = true; ws.pageSetup.fitToWidth = 1; ws.pageSetup.fitToHeight = 0;
    return wb;
  }

  function fileName(client) {
    return (client.name || "客人") + " insurance summary.xlsx";
  }

  function download(client, policies) {
    if (!window.ExcelJS) return Promise.reject(new Error("Excel 程式未載入好，請等幾秒再撳"));
    var name = fileName(client);
    return build(client, policies).xlsx.writeBuffer().then(function (buf) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return name;
    });
  }

  window.PSExcel = { build: build, download: download, title: title, fileName: fileName };
})();
