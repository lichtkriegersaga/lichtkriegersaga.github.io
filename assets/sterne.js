/*
 * Lichtkrieger · Sterne — 1–5 Sterne pro Lederband + geteilter Durchschnitt
 * Backend: Supabase REST/RPC (rate_book, rating_summary) per fetch, kein SDK.
 * Konfiguration: assets/sterne-config.js (SUPABASE_URL, SUPABASE_ANON_KEY).
 * Ohne Konfiguration oder offline: Sterne bleiben lokal klickbar, keine Fehlermeldung.
 * Demo nur für Screenshots: ?sterne-demo=1 (feste Beispielzahlen, nichts wird gesendet).
 */
(function () {
  "use strict";
  var BOOKS = ["lilli", "maya", "piri", "filli"];
  var CFG = window.STERNE_CONFIG || {};
  var URL_BASE = String(CFG.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  var KEY = String(CFG.SUPABASE_ANON_KEY || "").trim();
  var DEMO = /(?:^|[?&])sterne-demo=1(?:&|$)/.test(location.search);
  var ONLINE = !DEMO && !!(URL_BASE && KEY);
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (_) {} }
  };

  var T = {
    de: {
      q: "Wie hat dir die Geschichte gefallen?",
      group: "Deine Bewertung, 1 bis 5 Sterne",
      star: function (n) { return n === 1 ? "1 Stern" : n + " Sterne"; },
      thanks: "Danke für deine Sterne! Du kannst deine Wertung jederzeit ändern.",
      votes: function (n) { return n === 1 ? "Stimme" : "Stimmen"; },
      none: "Noch keine Stimmen",
      demo: "Demo · Beispielzahlen",
      loc: "de-DE"
    },
    en: {
      q: "How did you like the story?",
      group: "Your rating, 1 to 5 stars",
      star: function (n) { return n === 1 ? "1 star" : n + " stars"; },
      thanks: "Thank you for your stars! You can change your rating any time.",
      votes: function (n) { return n === 1 ? "vote" : "votes"; },
      none: "No votes yet",
      demo: "Demo · sample numbers",
      loc: "en-US"
    }
  };
  function tr(lang) { return T[lang] || T.de; }
  function fmtAvg(avg, lang) {
    return new Intl.NumberFormat(tr(lang).loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(avg);
  }
  function fmtInt(n, lang) { return new Intl.NumberFormat(tr(lang).loc).format(n); }
  function summaryText(s, lang) {
    if (!s || !s.count) return tr(lang).none;
    return "★ " + fmtAvg(s.avg, lang) + " · " + fmtInt(s.count, lang) + " " + tr(lang).votes(s.count);
  }

  // —— anonymous device id (random UUID, nothing personal) ——
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function deviceId() {
    var id = LS.get("sterne_device");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { id = uuid(); LS.set("sterne_device", id); }
    return id;
  }
  function myVote(book) { var v = parseInt(LS.get("sterne_vote_" + book), 10); return v >= 1 && v <= 5 ? v : 0; }

  // —— summary store ——
  var summary = null;          // { book: {avg, count} }
  var summaryPromise = null;
  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (_) {} }); }

  var demoBase = { lilli: { avg: 4.8, count: 37 }, maya: { avg: 4.6, count: 29 }, piri: { avg: 4.7, count: 23 }, filli: { avg: 4.9, count: 18 } };
  function demoSummary() {
    var out = {};
    BOOKS.forEach(function (b) {
      var s = demoBase[b], sum = s.avg * s.count, n = s.count, v = myVote(b);
      if (v) { sum += v; n += 1; }
      out[b] = { avg: Math.round((sum / n) * 10) / 10, count: n };
    });
    return out;
  }

  function rpc(fn, body) {
    var headers = { "apikey": KEY, "Content-Type": "application/json", "Accept": "application/json" };
    if (/^eyJ/.test(KEY)) headers["Authorization"] = "Bearer " + KEY; // legacy anon JWT; publishable keys only via apikey
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 7000) : null;
    return fetch(URL_BASE + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: headers, body: JSON.stringify(body || {}),
      signal: ctl ? ctl.signal : undefined, cache: "no-store", credentials: "omit"
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function mergeRows(rows) {
    if (!Array.isArray(rows)) return;
    summary = summary || {};
    rows.forEach(function (row) {
      if (!row || BOOKS.indexOf(row.book) < 0) return;
      var c = Number(row.count) || 0;
      summary[row.book] = { avg: c ? Number(row.avg) : 0, count: c };
    });
    try { sessionStorage.setItem("sterne_summary", JSON.stringify({ t: Date.now(), s: summary })); } catch (_) {}
  }
  function loadSummary() {
    if (summaryPromise) return summaryPromise;
    if (DEMO) { summary = demoSummary(); summaryPromise = Promise.resolve(summary); return summaryPromise; }
    if (!ONLINE) { summaryPromise = Promise.resolve(null); return summaryPromise; }
    try {
      var c = JSON.parse(sessionStorage.getItem("sterne_summary") || "null");
      if (c && c.s && Date.now() - c.t < 60000) summary = c.s;
    } catch (_) {}
    summaryPromise = rpc("rating_summary", {}).then(function (rows) { mergeRows(rows); emit(); return summary; })
      .catch(function () { return summary; });
    return summaryPromise;
  }

  // —— voting (upsert per device; debounced; retried on next visit if offline) ——
  var sendTimers = {};
  function sendVote(book, stars) {
    if (!ONLINE) return;
    LS.set("sterne_pending_" + book, String(stars));
    clearTimeout(sendTimers[book]);
    sendTimers[book] = setTimeout(function () {
      rpc("rate_book", { p_book: book, p_stars: stars, p_device: deviceId() })
        .then(function (rows) {
          if (LS.get("sterne_pending_" + book) === String(stars)) LS.del("sterne_pending_" + book);
          mergeRows(rows); emit();
        })
        .catch(function () { /* stays pending; resent next visit */ });
    }, 450);
  }
  function flushPending() {
    if (!ONLINE) return;
    BOOKS.forEach(function (b) {
      var p = parseInt(LS.get("sterne_pending_" + b), 10);
      if (p >= 1 && p <= 5 && p === myVote(b)) sendVote(b, p);
    });
  }
  function vote(book, stars) {
    LS.set("sterne_vote_" + book, String(stars));
    if (DEMO) { summary = demoSummary(); emit(); return; }
    sendVote(book, stars);
  }

  // —— styles (use the page's leather/gold/parchment variables) ——
  function injectStyle() {
    if (document.getElementById("sterne-style")) return;
    var css = [
      ".sterne-block{box-sizing:border-box;width:min(380px,86vw);margin:.9rem auto .3rem;padding:.55rem .8rem .65rem;text-align:center;",
      "color:var(--ink,#1a120c);background:linear-gradient(180deg,rgba(0,0,0,.035),transparent 30%),var(--parchment,#f3e6c8);",
      "border:1px solid var(--brass,#8a6a3a);border-radius:6px;box-shadow:0 0 0 3px #1a0e08,0 0 0 4px rgba(201,162,39,.55),0 16px 34px rgba(0,0,0,.5);font-family:inherit}",
      ".sterne-block[hidden]{display:none!important}",
      ".sterne-orn{display:flex;align-items:center;justify-content:center;gap:.6rem;color:var(--brass,#8a6a3a);font-size:.6rem;margin-bottom:.15rem}",
      ".sterne-orn::before,.sterne-orn::after{content:'';flex:0 1 3.6rem;height:1px;background:linear-gradient(90deg,transparent,#c9a22799,transparent)}",
      ".sterne-q{margin:0 0 .3rem;font-size:.84rem;font-weight:600;color:#5a3a18;letter-spacing:.01em}",
      ".sterne-stars{display:inline-flex;gap:.15rem;align-items:center;justify-content:center}",
      ".sterne-block .sterne-star{all:unset;display:inline-block;box-sizing:border-box;width:1.75rem;height:1.75rem;padding:.14rem;cursor:pointer;border-radius:5px;line-height:0;",
      "transition:transform .15s ease;-webkit-tap-highlight-color:transparent}",
      ".sterne-block .sterne-star svg{width:100%;height:100%;display:block;overflow:visible}",
      ".sterne-block .sterne-star path{fill:rgba(138,106,58,.10);stroke:#8a6a3a;stroke-width:1.3;stroke-linejoin:round;transition:fill .12s ease,stroke .12s ease}",
      ".sterne-block .sterne-star.on path{fill:#c9a227;stroke:#6a4a14;filter:drop-shadow(0 1px 1px rgba(90,58,24,.35))}",
      ".sterne-block .sterne-star.pre path{fill:#e3c35a;stroke:#8a6a3a}",
      ".sterne-block .sterne-star:hover{transform:translateY(-1px) scale(1.06)}",
      ".sterne-block .sterne-star:focus-visible{outline:2px solid #5a3a18;outline-offset:1px}",
      ".sterne-thanks{margin:.3rem 0 0;font-size:.74rem;font-style:italic;color:#5a3a18}",
      ".sterne-avg{margin:.25rem 0 0;font-size:.72rem;color:#5a3a18}",
      ".sterne-avg:empty{display:none}",
      ".sterne-demo{margin:.25rem 0 0;font-size:.56rem;letter-spacing:.12em;text-transform:uppercase;color:#8a3a18;opacity:.85}",
      "@media (max-width:720px){.sterne-block{width:min(320px,84vw);margin-top:.75rem;padding:.5rem .6rem .6rem}.sterne-block .sterne-star{width:2rem;height:2rem;padding:.25rem}.sterne-q{font-size:.8rem}}",
      /* bookshelf badges */
      ".spine .spine-rating{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:3px;display:flex;flex-direction:column;align-items:center;",
      "line-height:1;white-space:nowrap;pointer-events:none;z-index:3;font-size:10px;color:#e6c35c;letter-spacing:.02em;",
      "text-shadow:0 1px 1px #000,0 0 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6)}",
      ".spine .spine-rating:empty{display:none}",
      ".spine-rating .sr-meter{display:none;position:relative;letter-spacing:1px}",
      ".spine-rating .sr-bg{color:rgba(230,195,92,.28)}",
      ".spine-rating .sr-fg{position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap;color:#e6c35c}",
      ".spine-rating .sr-num{margin-top:2px;font-variant-numeric:tabular-nums}",
      "@media (max-width:720px){.spine .spine-rating{font-size:12px;margin-top:6px}.spine-rating .sr-one{display:none}.spine-rating .sr-meter{display:block;font-size:10px}}",
      ".sterne-demo-flag{position:fixed;left:.6rem;bottom:.6rem;z-index:50;font:600 .62rem/1.2 Georgia,serif;letter-spacing:.12em;text-transform:uppercase;",
      "color:#1a0e08;background:#c9a227;border:1px solid #f0e0a8;border-radius:3px;padding:.25rem .45rem;opacity:.9;pointer-events:none}"
    ].join("");
    var st = document.createElement("style");
    st.id = "sterne-style"; st.textContent = css;
    document.head.appendChild(st);
    if (DEMO && !document.querySelector(".sterne-demo-flag")) {
      var f = document.createElement("div");
      f.className = "sterne-demo-flag"; f.textContent = "Sterne-Demo · Beispielzahlen";
      (document.body || document.documentElement).appendChild(f);
    }
  }

  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.6l2.83 6.08 6.67.72-4.98 4.5 1.4 6.56L12 17.1l-5.92 3.36 1.4-6.56-4.98-4.5 6.67-.72z"/></svg>';

  // —— end-of-book rating block ——
  function paintStars(el, n, cls) {
    el.querySelectorAll(".sterne-star").forEach(function (b, i) { b.classList.toggle(cls, i < n); });
  }
  function buildBlock(host, book, lang) {
    var t = tr(lang), mine = myVote(book);
    var blk = document.createElement("section");
    blk.className = "sterne-block";
    blk.setAttribute("aria-label", t.q);
    blk.innerHTML =
      '<div class="sterne-orn" aria-hidden="true">✦</div>' +
      '<p class="sterne-q"></p>' +
      '<div class="sterne-stars" role="radiogroup"></div>' +
      '<p class="sterne-thanks" aria-live="polite"></p>' +
      '<p class="sterne-avg" aria-live="polite"></p>' +
      (DEMO ? '<p class="sterne-demo"></p>' : "");
    blk.querySelector(".sterne-q").textContent = t.q;
    if (DEMO) blk.querySelector(".sterne-demo").textContent = t.demo;
    var group = blk.querySelector(".sterne-stars");
    group.setAttribute("aria-label", t.group);
    for (var n = 1; n <= 5; n++) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "sterne-star"; b.dataset.v = String(n);
      b.setAttribute("role", "radio"); b.setAttribute("aria-label", t.star(n));
      b.innerHTML = STAR_SVG;
      group.appendChild(b);
    }
    var thanks = blk.querySelector(".sterne-thanks"), avgEl = blk.querySelector(".sterne-avg");
    function sync() {
      var v = myVote(book);
      paintStars(blk, v, "on");
      group.querySelectorAll(".sterne-star").forEach(function (b, i) {
        var checked = v === i + 1;
        b.setAttribute("aria-checked", checked ? "true" : "false");
        b.tabIndex = (v ? checked : i === 0) ? 0 : -1;
      });
      thanks.textContent = v ? t.thanks : "";
      thanks.hidden = !v;
      var s = summary && summary[book];
      avgEl.textContent = (ONLINE || DEMO) && summary ? summaryText(s, lang) : "";
    }
    function choose(v) { vote(book, v); sync(); }
    group.addEventListener("click", function (e) {
      var b = e.target.closest(".sterne-star"); if (!b) return;
      choose(parseInt(b.dataset.v, 10));
      b.focus();
    });
    group.addEventListener("mouseover", function (e) {
      var b = e.target.closest(".sterne-star"); if (!b) return;
      paintStars(blk, parseInt(b.dataset.v, 10), "pre");
    });
    group.addEventListener("mouseleave", function () { paintStars(blk, 0, "pre"); });
    group.addEventListener("focusout", function () { paintStars(blk, 0, "pre"); });
    group.addEventListener("keydown", function (e) {
      var b = e.target.closest(".sterne-star"); if (!b) return;
      var stars = Array.prototype.slice.call(group.querySelectorAll(".sterne-star"));
      var i = stars.indexOf(b), j = i;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") j = Math.min(4, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") j = Math.max(0, i - 1);
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = 4;
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); choose(i + 1); return; }
      else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); choose(+e.key); stars[+e.key - 1].focus(); return; }
      else return;
      // arrows move focus + preview only (page flipping must not react)
      e.preventDefault(); e.stopPropagation();
      stars.forEach(function (s, k) { s.tabIndex = k === j ? 0 : -1; });
      stars[j].focus();
      paintStars(blk, j + 1, "pre");
    });
    blk._sync = sync;
    sync();
    return blk;
  }

  var hosts = [];
  function bookPage(host, book, lang, isLast) {
    if (!host || BOOKS.indexOf(book) < 0) return;
    injectStyle();
    if (!isLast) { host.hidden = true; return; }
    if (host._sterneLang !== lang || !host.firstChild) {
      host.innerHTML = "";
      host.appendChild(buildBlock(host, book, lang));
      host._sterneLang = lang;
    } else if (host.firstChild._sync) host.firstChild._sync();
    host.hidden = false;
    if (hosts.indexOf(host) < 0) hosts.push(host);
    loadSummary();
  }
  listeners.push(function () {
    hosts.forEach(function (h) { if (h.firstChild && h.firstChild._sync) h.firstChild._sync(); });
  });

  // —— bookshelf badges ——
  var shelfLang = "de";
  function fillBadge(btn) {
    var book = btn.dataset.id, badge = btn.querySelector(".spine-rating");
    if (!badge) return;
    var s = summary && summary[book];
    if (!s || !s.count) { badge.innerHTML = ""; return; }
    var pct = Math.max(0, Math.min(100, (s.avg / 5) * 100));
    badge.innerHTML =
      '<span class="sr-one">★</span>' +
      '<span class="sr-meter"><span class="sr-bg">★★★★★</span><span class="sr-fg" style="width:' + pct.toFixed(1) + '%">★★★★★</span></span>' +
      '<span class="sr-num">' + fmtAvg(s.avg, shelfLang) + "</span>";
    if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title || "";
    var full = btn.dataset.baseTitle + " · " + summaryText(s, shelfLang);
    btn.title = full; btn.setAttribute("aria-label", full);
  }
  function decorateSpine(btn, book, lang) {
    if (!btn || BOOKS.indexOf(book) < 0) return;
    injectStyle();
    shelfLang = lang || shelfLang;
    var badge = btn.querySelector(".spine-rating");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "spine-rating"; badge.setAttribute("aria-hidden", "true");
      btn.appendChild(badge);
    }
    btn.dataset.baseTitle = btn.title || "";
    if (summary) fillBadge(btn);
    else loadSummary();
  }
  listeners.push(function () { document.querySelectorAll(".spine[data-id]").forEach(fillBadge); });

  window.Sterne = {
    bookPage: bookPage,
    decorateSpine: decorateSpine,
    loadSummary: loadSummary,
    isDemo: DEMO,
    isOnline: ONLINE
  };
  if (DEMO) summary = demoSummary();
  flushPending();
})();
