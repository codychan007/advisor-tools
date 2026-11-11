/* 基金分析：將報告（html2canvas 畫好嘅 canvas）變成 A4 PDF 直接下載，唔使彈列印畫面。
   自己寫最簡單嘅 PDF：每頁一張 JPEG 圖。瀏覽器：window.FundPdf；Node 測試：require() */
(function (root) {
  "use strict";
  var A4_W = 595.28, A4_H = 841.89;   // pt

  function bytes(str) {               // 只會有 ASCII
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  /* pages = [{ jpeg: Uint8Array, w: 像素闊, h: 像素高 }] → Uint8Array（PDF） */
  function build(pages) {
    var chunks = [], len = 0, offsets = [];
    function put(x) { var b = typeof x === "string" ? bytes(x) : x; chunks.push(b); len += b.length; }
    function obj(n, body) { offsets[n] = len; put(n + " 0 obj\n"); body(); put("\nendobj\n"); }
    var n = 2 + pages.length * 3;
    put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    obj(1, function () { put("<< /Type /Catalog /Pages 2 0 R >>"); });
    obj(2, function () {
      put("<< /Type /Pages /Count " + pages.length + " /Kids [" + pages.map(function (_, i) { return (3 + i * 3) + " 0 R"; }).join(" ") + "] >>");
    });
    pages.forEach(function (p, i) {
      var pageNo = 3 + i * 3, imgNo = pageNo + 1, contNo = pageNo + 2;
      var drawW = A4_W, drawH = p.h * A4_W / p.w;              // 闊度貼滿 A4，高度按比例（每頁已經切好唔會超過 A4）
      var content = "q " + drawW.toFixed(2) + " 0 0 " + drawH.toFixed(2) + " 0 " + (A4_H - drawH).toFixed(2) + " cm /Im" + i + " Do Q";
      obj(pageNo, function () {
        put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + A4_W + " " + A4_H + "] /Resources << /XObject << /Im" + i + " " + imgNo + " 0 R >> >> /Contents " + contNo + " 0 R >>");
      });
      obj(imgNo, function () {
        put("<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpeg.length + " >>\nstream\n");
        put(p.jpeg); put("\nendstream");
      });
      obj(contNo, function () { put("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"); });
    });
    var xref = len;
    var x = "xref\n0 " + (n + 1) + "\n0000000000 65535 f \n";
    for (var k = 1; k <= n; k++) x += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
    put(x + "trailer\n<< /Size " + (n + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    var out = new Uint8Array(len), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* canvas → 切成 A4 頁（盡量喺白色橫行切，唔好切開字） → PDF Blob */
  function fromCanvas(canvas, quality) {
    var pageH = Math.floor(canvas.width * A4_H / A4_W), pages = [], y = 0;
    var ctx = canvas.getContext("2d");
    while (y < canvas.height) {
      var h = Math.min(pageH, canvas.height - y);
      if (y + h < canvas.height) h = whiteCut(ctx, canvas.width, y, h);
      var c = document.createElement("canvas");
      c.width = canvas.width; c.height = h;
      var cx = c.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, h);
      cx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      var b64 = c.toDataURL("image/jpeg", quality || 0.88).split(",")[1], bin = atob(b64), jpeg = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
      pages.push({ jpeg: jpeg, w: c.width, h: h });
      y += h;
    }
    return new Blob([build(pages)], { type: "application/pdf" });
  }

  function whiteCut(ctx, w, y, h) {        // 由頁底向上搵一行全白嘅位置切
    for (var row = y + h - 1; row > y + h * 0.7; row -= 2) {
      var d = ctx.getImageData(0, row, w, 1).data, white = true;
      for (var i = 0; i < d.length; i += 16) { if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { white = false; break; } }
      if (white) return row - y;
    }
    return h;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  var api = { build: build, fromCanvas: fromCanvas, download: download };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FundPdf = api;
})(this);
