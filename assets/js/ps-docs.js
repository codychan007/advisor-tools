/* 保單整理器 – 喺同事部機處理文件（唔使錢、唔上載）：
   - PDF：用 pdf.js 逐頁抽文字；冇文字（掃描）嘅頁變成圖片
   - 相片：縮細到長邊 1500px
   - 遮圖：同事用手指／滑鼠拉黑格遮個人資料 */
(function () {
  "use strict";
  var PDFJS = "/assets/vendor/pdfjs/";
  var MAX_EDGE = 1500, THUMB_EDGE = 220, MAX_PDF_PAGES = 120;
  var pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(PDFJS + "pdf.min.mjs").then(function (m) {
      m.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
      return m;
    });
    return pdfjsP;
  }

  function canvasFrom(src, maxEdge) {
    var w = src.width, h = src.height, s = Math.min(1, maxEdge / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    var g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function loadImageFile(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { var c = canvasFrom(img, MAX_EDGE); URL.revokeObjectURL(url); ok(c); };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error(file.name + "：開唔到呢張相（iPhone 嘅 HEIC 請先轉 JPG，或者直接用 iPhone 嘅 Safari 上載）")); };
      img.src = url;
    });
  }

  /* 回傳 pages: [{id, file, n, kind:'text'|'image', text?, canvas?, thumb}] */
  async function readFiles(files, onProgress) {
    var pages = [], id = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var file = files[fi];
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        var lib = await pdfjs(), doc;
        try {
          doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: PDFJS + "cmaps/", cMapPacked: true }).promise;
        } catch (e) {
          throw new Error(file.name + (e && e.name === "PasswordException" ? "：PDF 有密碼，請先解鎖或者影相上載" : "：開唔到呢個 PDF"));
        }
        var total = Math.min(doc.numPages, MAX_PDF_PAGES);
        for (var p = 1; p <= total; p++) {
          if (onProgress) onProgress(file.name + " 第 " + p + "／" + total + " 頁");
          var page = await doc.getPage(p), tc = await page.getTextContent();
          var text = tc.items.map(function (it) { return (it.str || "") + (it.hasEOL ? "\n" : " "); }).join("").replace(/[ \t]+/g, " ").trim();
          if (text.replace(/\s/g, "").length >= 40) {
            pages.push({ id: ++id, file: file.name, n: p, kind: "text", text: text });
          } else {
            var vp = page.getViewport({ scale: 1 }), scale = MAX_EDGE / Math.max(vp.width, vp.height);
            var v2 = page.getViewport({ scale: scale }), c = document.createElement("canvas");
            c.width = Math.round(v2.width); c.height = Math.round(v2.height);
            await page.render({ canvasContext: c.getContext("2d"), viewport: v2 }).promise;
            pages.push({ id: ++id, file: file.name, n: p, kind: "image", canvas: c, thumb: canvasFrom(c, THUMB_EDGE).toDataURL("image/jpeg", 0.7) });
          }
        }
        if (doc.numPages > MAX_PDF_PAGES) pages.push({ id: ++id, file: file.name, n: 0, kind: "note", text: "PDF 有 " + doc.numPages + " 頁，只讀咗頭 " + MAX_PDF_PAGES + " 頁" });
      } else if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
        if (onProgress) onProgress(file.name);
        var cv = await loadImageFile(file);
        pages.push({ id: ++id, file: file.name, n: 1, kind: "image", canvas: cv, thumb: canvasFrom(cv, THUMB_EDGE).toDataURL("image/jpeg", 0.7) });
      } else {
        throw new Error(file.name + "：只可以上載 PDF 或者相片");
      }
    }
    return pages;
  }

  function toJpeg(canvas) {
    var url = canvas.toDataURL("image/jpeg", 0.82);
    return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1), w: canvas.width, h: canvas.height };
  }

  /* ---------- 遮圖：喺 canvas 上面拉黑格 ---------- */
  function redact(page) {
    return new Promise(function (done) {
      var src = page.canvas, rects = (page.rects || []).slice();
      var wrap = document.createElement("div");
      wrap.className = "ps-modal";
      wrap.innerHTML = '<div class="ps-modal-box"><div class="ps-modal-head"><b>遮個人資料</b><span class="muted">用手指或者滑鼠拉出黑格，遮住姓名、身份證、地址、電話、簽名。保單編號、計劃、金額唔使遮。</span></div>'
        + '<div class="ps-canvas-wrap"><canvas></canvas></div>'
        + '<div class="actions"><button class="btn ghost small" data-a="undo" type="button">復原上一格</button><button class="btn ghost small" data-a="clear" type="button">全部清除</button>'
        + '<button class="btn small" data-a="ok" type="button">遮好咗</button><button class="btn ghost small" data-a="cancel" type="button">取消</button></div></div>';
      document.body.appendChild(wrap);
      var cv = wrap.querySelector("canvas"), g = cv.getContext("2d");
      var box = wrap.querySelector(".ps-canvas-wrap");
      var scale = Math.min(1, (box.clientWidth || 600) / src.width, (window.innerHeight * 0.68) / src.height);
      cv.width = Math.round(src.width * scale); cv.height = Math.round(src.height * scale);
      var drag = null;
      function draw() {
        g.drawImage(src, 0, 0, cv.width, cv.height);
        g.fillStyle = "#000";
        rects.concat(drag ? [drag] : []).forEach(function (r) { g.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale); });
      }
      function pt(e) { var b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / scale, y: (e.clientY - b.top) / scale }; }
      cv.addEventListener("pointerdown", function (e) { cv.setPointerCapture(e.pointerId); var p = pt(e); drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 }; e.preventDefault(); });
      cv.addEventListener("pointermove", function (e) {
        if (!drag) return; var p = pt(e);
        drag.x = Math.min(drag.x0, p.x); drag.y = Math.min(drag.y0, p.y); drag.w = Math.abs(p.x - drag.x0); drag.h = Math.abs(p.y - drag.y0); draw();
      });
      cv.addEventListener("pointerup", function () { if (drag && drag.w > 4 && drag.h > 4) rects.push({ x: drag.x, y: drag.y, w: drag.w, h: drag.h }); drag = null; draw(); });
      wrap.addEventListener("click", function (e) {
        var a = e.target.getAttribute && e.target.getAttribute("data-a");
        if (a === "undo") { rects.pop(); draw(); }
        if (a === "clear") { rects = []; draw(); }
        if (a === "ok" || a === "cancel") { wrap.remove(); done(a === "ok" ? rects : null); }
      });
      draw();
    });
  }

  function applyRects(page) {
    var c = document.createElement("canvas");
    c.width = page.canvas.width; c.height = page.canvas.height;
    var g = c.getContext("2d");
    g.drawImage(page.canvas, 0, 0);
    g.fillStyle = "#000";
    (page.rects || []).forEach(function (r) { g.fillRect(r.x, r.y, r.w, r.h); });
    return c;
  }

  window.PSDocs = { readFiles: readFiles, redact: redact, applyRects: applyRects, toJpeg: toJpeg };
})();
