/* 書籤小工具「填進階設定」：喺 iPGS 結果頁打開「進階設定」視窗之後撳，
   由剪貼簿讀網站「複製提取金額」嘅內容（MS1|40:758,41:812,...），逐格填「提取金額」，其他年份填 0。
   唔會撳「計算及儲存」，由同事自己檢查完先撳。
   網站用 IpgsFill.href() 將下面個 function 變成 javascript: 書籤。 */
(function () {
  "use strict";

  function bookmarklet() {
    var TAG = "MS1|";
    function toast(msg, bad) {
      var old = document.getElementById("ms-fill-toast");
      if (old) old.remove();
      var d = document.createElement("div");
      d.id = "ms-fill-toast";
      d.textContent = msg;
      d.style.cssText = "position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);max-width:560px;"
        + "padding:14px 18px;border-radius:8px;font:15px/1.6 'Microsoft JhengHei',sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);"
        + "color:#fff;background:" + (bad ? "#A3301C" : "#2E4A6B") + ";cursor:pointer";
      d.onclick = function () { d.remove(); };
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.remove(); }, bad ? 15000 : 9000);
    }
    function parse(t) {
      var want = {}, m, i = (t || "").indexOf(TAG), re = /(\d{1,3})\s*:\s*(\d+)/g;
      if (i < 0) return want;
      var body = t.slice(i + TAG.length);
      while ((m = re.exec(body))) { if (+m[1] <= 120) want[+m[1]] = +m[2]; }
      return want;
    }
    function fill(want) {
      var dlgs = document.querySelectorAll('[role="dialog"], .MuiDialog-root'), dlg = null;
      for (var k = dlgs.length - 1; k >= 0; k--) {
        if (dlgs[k].querySelector("td input")) { dlg = dlgs[k]; break; }
      }
      if (!dlg) { toast("搵唔到「進階設定」視窗。請先喺 iPGS 結果頁撳「進階設定」，見到逐年嘅格先撳呢個書籤。", true); return; }
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      var inputs = dlg.querySelectorAll("td input"), cells = [], seen = {}, filled = 0, locked = [];
      for (var j = 0; j < inputs.length; j++) {
        var inp = inputs[j], td = inp.closest("td"), lab = td && td.previousElementSibling;
        var m = lab && lab.innerText.match(/(\d+)\s*[（(]\s*(\d+)\s*歲/);
        if (!m) continue;
        seen[+m[2]] = true;
        cells.push({ inp: inp, age: +m[2] });
      }
      var missing = Object.keys(want).filter(function (a) { return !seen[a]; });
      if (missing.length) {
        toast("冇填任何嘢：iPGS 冇 " + missing[0] + (missing.length > 1 ? "–" + missing[missing.length - 1] : "") + " 歲嘅格。網站同 iPGS 可能唔係同一個客人（投保年齡要一樣），請檢查清楚再試。", true);
        return;
      }
      for (j = 0; j < cells.length; j++) {
        inp = cells[j].inp;
        var age = cells[j].age, v = want[age] || 0;
        if (inp.disabled || inp.readOnly) { if (v) locked.push(age); continue; }
        inp.focus();
        setter.call(inp, String(v));
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.blur();
        if (v) filled++;
      }
      var warn = locked.length ? " ⚠️ iPGS 唔俾填呢啲歲數：" + locked.join("、") + "，請自己睇吓。" : "";
      if (!filled) { toast("一格都填唔到。請確認網站同 iPGS 係同一個客人（投保年齡要一樣）。" + warn, true); return; }
      toast("✅ 填好 " + filled + " 個歲數嘅提取金額，其他年份填 0。請睇一眼，再撳「計算及儲存」。" + warn, !!warn);
    }
    function ask() {
      var t = window.prompt("讀唔到剪貼簿。請喺下面貼上網站「複製提取金額」嘅內容（Ctrl + V）：");
      if (t) go(t);
    }
    function go(t) {
      var w = parse(t);
      if (!Object.keys(w).length) { toast("剪貼簿入面唔係提取金額。請返網站第二步撳「複製提取金額」，再撳一次呢個書籤。", true); return; }
      fill(w);
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(go, ask);
    } else ask();
  }

  /* 網站「複製提取金額」用嘅格式 */
  function code(rows) {
    return "MS1|" + rows.filter(function (r) { return r.withdrawal > 0; })
      .map(function (r) { return r.age + ":" + r.withdrawal; }).join(",");
  }

  function href() {
    return "javascript:" + encodeURIComponent("(" + bookmarklet.toString().replace(/\n\s*/g, "\n") + ")();void 0");
  }

  var api = { bookmarklet: bookmarklet, code: code, href: href };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else window.IpgsFill = api;
})();
