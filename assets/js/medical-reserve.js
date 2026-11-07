/* 醫療儲備計劃 – 畫面 */
(function () {
  "use strict";
  var C = window.MedCalc, $ = function (id) { return document.getElementById(id); };
  var DATA = null, F = null, SCHED = null;
  var PLAN_ORDER = [["基本計劃", ["standard", "flexi"]], ["高端醫療", ["selectwise", "privilege_ultra"]]];
  var SHORT = { standard: "標準計劃", flexi: "靈活計劃", selectwise: "睿選計劃", privilege_ultra: "尊耀計劃" };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function radio(name) { var x = document.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : null; }
  function usd(v, d) { return "US$" + C.fmt(v, d); }
  function unlock(id) { $(id).classList.remove("locked"); }
  function lock(id) { $(id).classList.add("locked"); }

  fetch("/data/aia-medical-premiums.json").then(function (r) { return r.json(); }).then(function (d) {
    DATA = d;
    var age = Math.round((Date.now() - new Date(d.generatedOn).getTime()) / 864e5 / 30.4);
    $("dataInfo").innerHTML = "醫保保費表：AIA 官網，" + esc(d.generatedOn) + " 更新" + (age >= 6 ? "（<b style='color:var(--danger)'>超過 6 個月，可能已過時</b>）" : "");
    var sel = $("f-plan");
    PLAN_ORDER.forEach(function (g) {
      var og = document.createElement("optgroup"); og.label = g[0];
      g[1].forEach(function (k) { if (d.plans[k]) { var o = new Option(d.plans[k].name, k); og.appendChild(o); } });
      sel.appendChild(og);
    });
    var no = document.createElement("optgroup"); no.label = "冇公開保費表（做唔到）";
    d.noPublicTable.forEach(function (p) { var o = new Option(p.name, ""); o.disabled = true; no.appendChild(o); });
    sel.appendChild(no);
  }).catch(function () { $("dataInfo").textContent = "讀唔到保費資料，請重新載入。"; });

  // 7. 供款年期跟儲蓄計劃
  document.querySelectorAll('input[name="savings"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var sv = C.SAVINGS[r.value];
      $("payYears").innerHTML = sv.terms.map(function (t) {
        return '<label><input type="radio" name="payYears" value="' + t + '"><span>' + C.termLabel(t) + "</span></label>";
      }).join("");
    });
  });

  // 10–12 跟醫療計劃
  $("f-plan").addEventListener("change", function () {
    var p = DATA && DATA.plans[this.value];
    function fill(wrap, selId, items) {
      $(wrap).classList.toggle("hidden", !items || !items.length);
      $(selId).innerHTML = '<option value="">請揀</option>' + (items || []).map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("");
    }
    fill("w-ward", "f-ward", p && p.wards.length > 1 ? p.wards.map(function (w) { return [w, w]; }) : null);
    fill("w-ded", "f-ded", p && p.deductibles.length ? p.deductibles.map(function (d) { return [d.HKD, "HK$" + C.fmt(d.HKD) + "（US$" + C.fmt(d.USD) + "）"]; }) : null);
    fill("w-area", "f-area", p && p.areas.length ? p.areas.map(function (a) { return [a, a]; }) : null);
    var std = this.value === "standard";
    $("riderYes").disabled = std;
    if (std) document.querySelector('input[name="rider"][value="0"]').checked = true;
    $("riderHint").textContent = std ? "標準計劃冇附加契約版本" : "加附加契約：醫保保費按基本計劃表 × 90% 計";
  });

  function startHint() {
    var a = +$("f-age").value, s = +$("f-start").value;
    $("startHint").textContent = $("f-age").value && s ? "即係 " + (a + s) + " 歲開始用儲蓄計劃俾醫保；" + a + "–" + (a + s - 1) + " 歲客人自己俾" : "";
  }
  $("f-age").addEventListener("input", startHint);
  $("f-start").addEventListener("input", startHint);

  function readForm() {
    var py = radio("payYears");
    return {
      name: $("f-name").value.trim(), age: $("f-age").value === "" ? NaN : +$("f-age").value,
      sex: radio("sex"), smoker: radio("smoker") === "1", residence: $("f-res").value.trim() || "香港",
      savings: radio("savings"), payYears: py === null ? NaN : +py, premium: +$("f-prem").value,
      planKey: $("f-plan").value, ward: $("f-ward").value || null,
      deductible: $("f-ded").value === "" ? null : +$("f-ded").value, area: $("f-area").value || null,
      rider: radio("rider") === "1", surname: $("f-surname").value.trim() || "VIP",
      startYear: $("f-start").value === "" ? NaN : +$("f-start").value, endAge: C.END_AGE
    };
  }

  $("caseForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!DATA) return;
    var f = readForm(), errs = C.validate(DATA, f);
    $("formErr").classList.toggle("hidden", !errs.length);
    if (errs.length) {
      $("formErr").innerHTML = "要補返：<ul>" + errs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      return;
    }
    F = f;
    SCHED = C.schedule(DATA, f);
    renderS2();
    unlock("s2"); unlock("s3"); lock("s4");
    $("s4body").innerHTML = '<p class="muted">貼好 iPGS 數字就會出。</p>';
    $("s2").scrollIntoView({ behavior: "smooth" });
  });

  function riderOption() {
    var d = SCHED.desc;
    if (d.planKey === "flexi") return "「" + d.ward + "」";
    var ded = "自付費 US$" + C.fmt(d.deductibleUSD);
    return d.area ? "「" + d.area + "」＋" + ded : ded;
  }

  function renderS2() {
    var f = F, s = SCHED, sv = C.SAVINGS[f.savings], d = s.desc;
    var startAge = f.age + f.startYear;
    var first = s.rows.filter(function (r) { return r.paidBy === "withdrawal"; })[0];
    var opt = [d.ward, d.deductibleHKD !== null ? "自付費 HK$" + C.fmt(d.deductibleHKD) : null, d.area, d.rider ? "附加契約" : null].filter(Boolean).join("／");
    var html = "";
    html += "<p><b>" + esc(d.plan) + "</b>" + (opt ? "（" + esc(opt) + "）" : "") + "，保費表生效 " + esc(d.effective)
      + (d.rider ? "；附加契約按基本計劃表 × 90%" : "") + (d.convertedFromHKD ? "；港元 ÷ " + d.hkdRate + " 換美元" : "") + "</p>";
    html += '<div class="kpis">'
      + kpi("客人自己俾（" + f.age + "–" + (startAge - 1) + " 歲）", usd(s.totals.client))
      + kpi("儲蓄計劃提取（" + startAge + "–" + f.endAge + " 歲）", usd(s.totals.withdrawals))
      + kpi("醫保總保費", usd(s.totals.all))
      + kpi("首年提取（" + startAge + " 歲）", usd(first.withdrawal)) + "</div>";

    html += "<h3>iPGS 逐步填法</h3><ol class='guide'>"
      + "<li>首頁撳「新建議書」（彈「編輯建議書」就揀「另建一份新建議書」）。</li>"
      + "<li>受保人：年齡 <b class='v'>" + f.age + "</b>、性別 <b class='v'>" + (f.sex === "M" ? "男" : "女") + "</b>、吸煙 <b class='v'>" + (f.smoker ? "是" : "否") + "</b>、居住地 <b class='v'>" + esc(f.residence) + "</b>；喺「終身壽險 及 儲蓄壽險」揀 <b class='v'>" + esc(sv.ipgsName) + "</b>。</li>"
      + "<li>基本計劃：供款年期 <b class='v'>" + C.termLabel(f.payYears) + "</b>，「預算每年保費」<b class='v'>" + usd(f.premium) + "</b> →「計算」→「下一步」。</li>"
      + (d.rider ? "<li>附加契約頁：剔 <b class='v'>" + esc(d.riderCode) + "</b>，「計劃」揀 <b class='v'>" + esc(riderOption()) + "</b> →「下一步」。</li>"
                 : "<li>附加契約頁：唔使剔 →「下一步」。</li>")
      + "<li>概覽 →「保單選項」→「多次提取」→「開始設定」：揀「年齡」，開始 <b class='v'>" + startAge + "</b> 歲，終止 <b class='v'>" + f.endAge + "</b> 歲，提取金額 <b class='v'>" + usd(first.withdrawal) + "</b>，揀「減少基本金額」→ 確認；通脹率打 <b class='v'>0</b>（打完<b>唔好撳 Tab</b>）→「儲存」→「計算」。</li>"
      + "<li>結果頁 →「進階設定」：用下面「📌 填進階設定」書籤一撳填晒（或者照下面個表逐格打，其他年份 0）→ 睇一眼 →「計算及儲存」。見到「金額已自動被調整」即係錢唔夠。</li>"
      + "<li>「完成」→ 概覽「保單選項」→「詳細說明」，成個表複製去第三步。</li>"
      + "<li>夠錢先生成建議書：建議書選項「受保人姓氏」填 <b class='v'>" + esc(f.surname) + "</b> →「下一步」→ 確認提示 →「檢視詳盡建議書」下載。</li>"
      + "</ol>";

    html += "<div class='note no-print' style='margin-top:16px'><b>📌 一撳填晒進階設定</b>"
      + "<ol style='margin:6px 0 0;padding-left:20px'>"
      + "<li><b>第一次用先做</b>：Chrome 撳 <b>Ctrl + Shift + B</b> 開書籤列（網址列下面嗰條），再用滑鼠<b>按住</b>下面深色「📌 填進階設定」掣，<b>拖去書籤列放手</b>。之後唔使再拖。</li>"
      + "<li>撳「複製提取金額」。</li>"
      + "<li>去 iPGS 打開「進階設定」視窗，撳書籤列上面嘅「📌 填進階設定」。第一次 Chrome 可能問「想查看剪貼簿」，撳<b>允許</b>。</li>"
      + "<li>睇一眼數字啱唔啱，再撳「計算及儲存」。</li></ol>"
      + "<div class='actions' style='margin-top:10px'><a class='btn small' id='bmLink' href='#'>📌 填進階設定</a>"
      + "<button class='btn small ghost' type='button' id='copyWd'>複製提取金額</button>"
      + "<button class='btn small ghost' type='button' id='copyBm'>拖唔到？複製書籤碼</button>"
      + "<span id='copyMsg' class='muted' style='align-self:center;font-size:14px'></span></div>"
      + "<p id='bmHelp' class='hidden' style='margin:8px 0 0;font-size:14px'>人手加：喺書籤列撳右鍵 →「新增網頁」→ 名稱打「填進階設定」，網址嗰格 Ctrl + V 貼上 → 儲存。</p></div>";
    html += "<h3 style='margin-top:16px'>每年醫保保費同提取金額</h3>";
    html += "<div class='table-wrap'><table><thead><tr><th>歲數</th><th>保單年度</th><th>醫保保費</th><th>邊個俾</th><th>進階設定提取金額</th></tr></thead><tbody>";
    s.rows.forEach(function (r) {
      html += "<tr class='" + (r.paidBy === "client" ? "client" : "") + "'><td>" + r.age + "</td><td>" + (r.n === 0 ? "投保時" : r.n) + "</td><td>" + usd(r.usd, 2) + "</td><td>"
        + (r.paidBy === "client" ? "客人" : "提取") + "</td><td><b>" + (r.withdrawal ? C.fmt(r.withdrawal) : "0") + "</b></td></tr>";
    });
    html += "</tbody></table></div>";
    $("s2body").innerHTML = html;
    var bm = $("bmLink");
    bm.href = window.IpgsFill.href();
    bm.addEventListener("click", function (e) { e.preventDefault(); $("copyMsg").textContent = "呢粒掣要拖去書籤列，再喺 iPGS 撳先有用"; });
    $("copyWd").addEventListener("click", function () {
      var n = s.rows.filter(function (r) { return r.withdrawal > 0; }).length;
      navigator.clipboard.writeText(window.IpgsFill.code(s.rows)).then(function () { $("copyMsg").textContent = "複製咗 " + n + " 個歲數（" + startAge + "–" + f.endAge + " 歲），去 iPGS 撳書籤"; },
        function () { $("copyMsg").textContent = "複製唔到，請照下面個表逐格打"; });
    });
    $("copyBm").addEventListener("click", function () {
      navigator.clipboard.writeText(window.IpgsFill.href()).then(function () { $("copyMsg").textContent = "複製咗書籤碼"; $("bmHelp").classList.remove("hidden"); },
        function () { $("copyMsg").textContent = "複製唔到"; });
    });
  }
  function kpi(label, val) { return "<div class='kpi'><span>" + esc(label) + "</span><b>" + val + "</b></div>"; }

  $("checkBtn").addEventListener("click", function () {
    if (!SCHED) return;
    var ip = C.parseIpgs($("ipgsText").value, F.age);
    var need = C.END_AGE - F.age, msg = $("parseMsg");
    msg.classList.remove("hidden", "bad", "good");
    if (!ip.count) {
      msg.classList.add("bad");
      msg.innerHTML = "讀唔到任何年份。請喺 iPGS「詳細說明」由表頭拉到最尾選晒成個表再複製。";
      return;
    }
    msg.innerHTML = "讀到 " + ip.count + " 年數字（需要第 1–" + need + " 年）" + (ip.bad.length ? "；有 " + ip.bad.length + " 行讀唔明，已略過" : "") + "。";
    var res = C.check(SCHED, ip, F.age, F.startYear, F.endAge);
    renderS4(res);
    unlock("s4");
    $("s4").scrollIntoView({ behavior: "smooth" });
  });

  function renderS4(res) {
    var html = "", last = res.rows[res.rows.length - 1];
    if (res.ok) {
      html += "<div class='note good'><b>✅ 夠錢。</b>由 " + (F.age + F.startYear) + " 歲到 " + last.age + " 歲每年都提到足額醫保保費；" + last.age + " 歲提取後退保發還金額 <b>" + usd(last.surrender) + "</b>。</div>";
      html += "<div class='actions'><button class='btn' type='button' id='xlsBtn'>下載客人版 Excel</button><span id='xlsMsg' class='muted' style='align-self:center;font-size:14px'></span></div>";
    } else {
      html += "<div class='note bad'><b>❌ 呢個儲蓄金額未必做到完整醫療儲備。</b>"
        + (res.firstShort ? "由 <b>" + res.firstShort + " 歲</b>開始唔夠。" : "")
        + "<ul>" + res.problems.slice(0, 8).map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + (res.problems.length > 8 ? "<li>…仲有 " + (res.problems.length - 8) + " 項</li>" : "") + "</ul>"
        + "<p style='margin:8px 0 0'>可以加首年保費、改供款年期，或者遲啲先開始提取，再返第一步重新計同重做 iPGS。<b>唔夠錢唔好生成建議書。</b></p></div>";
    }
    html += "<div class='table-wrap' style='margin-top:14px'><table><thead><tr><th>歲數</th><th>保單年度</th><th>繳付保費總額</th><th>要提</th><th>iPGS 提取</th><th>提取後退保發還</th></tr></thead><tbody>";
    res.rows.forEach(function (r) {
      var short = r.need && (r.withdrawal + 1 < r.need || r.surrender <= 0);
      html += "<tr class='" + (short ? "short" : "") + "'><td>" + r.age + "</td><td>" + r.n + "</td><td>" + C.fmt(r.paidTotal) + "</td><td>" + (r.need ? C.fmt(r.need) : "") + "</td><td>" + (r.withdrawal ? C.fmt(r.withdrawal) : "") + "</td><td>" + C.fmt(r.surrender) + "</td></tr>";
    });
    html += "</tbody></table></div>";
    $("s4body").innerHTML = html;
    if (res.ok) $("xlsBtn").addEventListener("click", function () {
      var btn = this; btn.disabled = true; $("xlsMsg").textContent = "整緊…";
      window.MedExcel.download(F, SCHED, res.rows).then(function (name) { $("xlsMsg").textContent = "已下載：" + name; },
        function (e) { $("xlsMsg").textContent = "出唔到 Excel：" + e.message; }).then(function () { btn.disabled = false; });
    });
  }
})();
