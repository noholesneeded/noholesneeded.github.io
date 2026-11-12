/* Kindle & Cloth — client-side site search. Loaded only on /search/. */
(function () {
  "use strict";

  var INDEX_URL = "/assets/search-index.json";
  var form = document.getElementById("search-form");
  var input = document.getElementById("search-q");
  var statusEl = document.getElementById("search-status");
  var resultsEl = document.getElementById("search-results");
  var emptyEl = document.getElementById("search-empty");
  var emptyMsg = document.getElementById("search-empty-msg");
  var defaultEmpty = emptyMsg ? emptyMsg.textContent : "";
  var indexPromise = null;
  var debounceTimer = 0;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL).then(function (res) {
        if (!res.ok) throw new Error("Could not load search index");
        return res.json();
      });
    }
    return indexPromise;
  }

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(/\s+/).filter(Boolean);
  }

  function stem(t) {
    var s = t;
    if (s.length > 6 && s.slice(-6) === "ations") return s.slice(0, -6);
    if (s.length > 5 && s.slice(-5) === "ation") return s.slice(0, -5);
    if (s.length > 4 && s.slice(-4) === "tions") return s.slice(0, -4);
    if (s.length > 4 && s.slice(-3) === "ing") return s.slice(0, -3);
    if (s.length > 4 && s.slice(-3) === "ies") return s.slice(0, -3) + "y";
    if (s.length > 3 && s.slice(-2) === "es") return s.slice(0, -2);
    if (s.length > 3 && s.slice(-1) === "s") return s.slice(0, -1);
    return s;
  }

  function levenshtein(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    if (!la) return lb;
    if (!lb) return la;
    var prev = new Array(lb + 1);
    var i, j, cur, tmp, cost, rowMin;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = i;
      rowMin = cur;
      for (j = 1; j <= lb; j++) {
        cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        tmp = Math.min(prev[j] + 1, cur + 1, prev[j - 1] + cost);
        prev[j - 1] = cur;
        cur = tmp;
        if (cur < rowMin) rowMin = cur;
      }
      prev[lb] = cur;
      if (rowMin > max) return max + 1;
    }
    return prev[lb];
  }

  function tokenMatch(q, word) {
    if (!q || !word || word.length < 2) return 0;
    if (q === word) return 8;
    if (q.length >= 3 && word.indexOf(q) === 0) return 6;
    if (word.length >= 4 && q.indexOf(word) === 0) return 5;
    if (q.length >= 4 && word.indexOf(q) !== -1) return 3;
    var qs = stem(q), ws = stem(word);
    if (qs.length >= 4 && ws.length >= 4 && (qs === ws || ws.indexOf(qs) === 0 || qs.indexOf(ws) === 0)) return 5;
    var max = q.length >= 5 ? 2 : 1;
    if (q.length >= 4) {
      var d = levenshtein(q, word, max);
      if (d === 1) return 4.5;
      if (d === 2 && q.length >= 5) return 2;
      if (qs !== q || ws !== word) {
        d = levenshtein(qs, ws, max);
        if (d === 1) return 3;
        if (d === 2 && q.length >= 5) return 1.6;
      }
    }
    return 0;
  }

  function bestTokenScore(q, words) {
    var best = 0, i, s;
    for (i = 0; i < words.length; i++) {
      s = tokenMatch(q, words[i]);
      if (s > best) best = s;
    }
    return best;
  }

  function hayWords(item) {
    if (item._words) return item._words;
    var parts = [item.title, item.short, item.excerpt, (item.cats || []).join(" "), (item.url || "").replace(/[-/]/g, " ")];
    item._words = tokens(parts.join(" "));
    item._titleWords = tokens((item.title || "") + " " + (item.short || ""));
    item._normTitle = normalize((item.title || "") + " " + (item.short || ""));
    item._normAll = item._words.join(" ");
    return item._words;
  }

  function scoreItem(item, query) {
    hayWords(item);
    var qNorm = normalize(query);
    if (!qNorm) return 0;
    var qTokens = qNorm.split(/\s+/);
    var score = 0;
    var i, t, inTitle, inAll;
    if (item._normTitle.indexOf(qNorm) !== -1) score += 20;
    else if (item._normAll.indexOf(qNorm) !== -1) score += 8;
    for (i = 0; i < qTokens.length; i++) {
      t = qTokens[i];
      inTitle = bestTokenScore(t, item._titleWords);
      inAll = bestTokenScore(t, item._words);
      if (inTitle === 0 && inAll === 0) return 0;
      score += inTitle ? inTitle * 3 : inAll;
    }
    if (item.kind === "guide") score += 0.4;
    return score;
  }

  function excerptOf(item) {
    var text = item.excerpt || "";
    if (text.length <= 150) return text;
    var cut = text.slice(0, 150).lastIndexOf(" ");
    return text.slice(0, cut > 80 ? cut : 150).replace(/[,:;]+$/, "") + "…";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function kindLabel(item) {
    if (item.kind === "category") return "Topic";
    if (item.kind === "hub") return "Guide collection";
    if (item.kind === "shop") return "Shop";
    return (item.cats && item.cats[0]) || "Guide";
  }

  function renderResults(items, query) {
    resultsEl.innerHTML = items.map(function (item) {
      return (
        '<a class="search-card" href="' + escapeHtml(item.url) + '">' +
          '<div class="frame"><img src="' + escapeHtml(item.thumb) + '" alt="" width="280" height="280"></div>' +
          '<div class="body">' +
            '<p class="kicker">' + escapeHtml(kindLabel(item)) + "</p>" +
            "<h2>" + escapeHtml(item.short || item.title) + "</h2>" +
            "<p>" + escapeHtml(excerptOf(item)) + "</p>" +
          "</div>" +
        "</a>"
      );
    }).join("");
    resultsEl.hidden = items.length === 0;
    emptyEl.hidden = items.length > 0;
    if (!query) {
      statusEl.textContent = "";
      if (emptyMsg) emptyMsg.textContent = defaultEmpty;
      emptyEl.hidden = false;
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }
    if (items.length) {
      statusEl.textContent = items.length === 1
        ? "1 result for “" + query + "”"
        : items.length + " results for “" + query + "”";
    } else {
      statusEl.textContent = "";
      if (emptyMsg) emptyMsg.textContent = "No guides matched “" + query + "”. Try a different word, or browse a topic:";
    }
  }

  function search(items, query) {
    var q = (query || "").trim();
    if (!q) return [];
    var scored = [];
    var i, s;
    for (i = 0; i < items.length; i++) {
      s = scoreItem(items[i], q);
      if (s > 0) scored.push({ item: items[i], score: s });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (x) { return x.item; });
  }

  function setQueryInUrl(query) {
    var url = query ? "/search/?q=" + encodeURIComponent(query) : "/search/";
    if (location.pathname + location.search !== url) {
      history.replaceState(null, "", url);
    }
    document.title = query
      ? "Search: " + query + " | Kindle & Cloth"
      : "Search | Kindle & Cloth";
  }

  function run(query, updateUrl) {
    var q = (query || "").trim();
    if (input && input.value !== q) input.value = q;
    if (updateUrl) setQueryInUrl(q);
    if (!q) {
      renderResults([], "");
      return Promise.resolve();
    }
    statusEl.textContent = "Searching…";
    return loadIndex()
      .then(function (items) {
        renderResults(search(items, q), q);
      })
      .catch(function () {
        statusEl.textContent = "Search couldn’t load. Please refresh and try again.";
        resultsEl.hidden = true;
        emptyEl.hidden = false;
      });
  }

  if (!form || !input || !statusEl || !resultsEl || !emptyEl) return;

  var initial = new URLSearchParams(location.search).get("q") || "";
  if (initial) {
    input.value = initial;
    run(initial, false);
  } else {
    renderResults([], "");
    input.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    run(input.value, true);
  });

  input.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      run(input.value, true);
    }, 160);
  });
})();
