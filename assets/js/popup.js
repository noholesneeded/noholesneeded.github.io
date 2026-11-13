/* No Holes Needed — delayed / exit-intent guide popup. No third-party libraries. */
(function () {
  "use strict";

  var DELAY_MS = 8000;
  var DISMISS_DAYS = 30;
  var STORAGE_DISMISS = "nhn_guide_popup_dismissed";
  var STORAGE_SUB = "nhn_guide_subscribed";
  var EXCLUDED = ["/free-renters-survival-guide/", "/privacy-policy/"];

  var root = document.getElementById("nhn-guide-popup");
  if (!root) return;

  var dialog = root.querySelector(".nhn-popup-dialog");
  var closeBtns = root.querySelectorAll("[data-nhn-popup-close]");
  var readyAt = Date.now() + DELAY_MS;
  var opened = false;
  var lastFocus = null;
  var lastScrollY = window.scrollY || 0;
  var lastScrollT = Date.now();

  function path() {
    var p = location.pathname;
    if (p.length > 1 && !p.endsWith("/")) p += "/";
    return p;
  }

  function excluded() {
    return EXCLUDED.indexOf(path()) !== -1;
  }

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function isSubscribed() {
    return storeGet(STORAGE_SUB) === "1";
  }

  function isDismissed() {
    var raw = storeGet(STORAGE_DISMISS);
    if (!raw) return false;
    var at = parseInt(raw, 10);
    if (!isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }

  function forceRequested() {
    try {
      return new URLSearchParams(location.search).get("nhn_popup") === "1";
    } catch (e) {
      return /(?:\?|&)nhn_popup=1(?:&|$)/.test(location.search);
    }
  }

  function markDismissed() {
    storeSet(STORAGE_DISMISS, String(Date.now()));
  }

  function markSubscribed() {
    storeSet(STORAGE_SUB, "1");
  }

  function focusables() {
    var nodes = dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetParent !== null || nodes[i] === document.activeElement) out.push(nodes[i]);
    }
    return out;
  }

  function setInert(on) {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === root) continue;
      if (on) kids[i].setAttribute("inert", "");
      else kids[i].removeAttribute("inert");
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    var list = focusables();
    if (!list.length) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(opts) {
    opts = opts || {};
    if (opened) return false;
    if (excluded()) return false;
    if (!opts.force) {
      if (Date.now() < readyAt) return false;
      if (isSubscribed() || isDismissed()) return false;
    }
    opened = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    root.setAttribute("data-open", "true");
    document.body.classList.add("nhn-popup-open");
    setInert(true);
    document.addEventListener("keydown", onKey, true);
    var closeBtn = dialog.querySelector(".nhn-popup-close");
    window.requestAnimationFrame(function () {
      (closeBtn || dialog).focus();
    });
    return true;
  }

  function close() {
    if (!opened) return;
    opened = false;
    markDismissed();
    root.hidden = true;
    root.removeAttribute("data-open");
    document.body.classList.remove("nhn-popup-open");
    setInert(false);
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus(); } catch (e) {}
    }
  }

  function maybeOpen() {
    open({ force: false });
  }

  function articleProgress() {
    var el = document.querySelector("article") || document.getElementById("main");
    if (!el) {
      var doc = document.documentElement;
      var span = doc.scrollHeight - window.innerHeight;
      return span <= 0 ? 0 : window.scrollY / span;
    }
    var top = el.getBoundingClientRect().top + window.scrollY;
    var height = el.offsetHeight;
    if (height <= 0) return 0;
    var seen = window.scrollY + window.innerHeight - top;
    return seen / height;
  }

  function onScroll() {
    if (opened) return;
    var y = window.scrollY || 0;
    var t = Date.now();
    var dt = Math.max(1, t - lastScrollT);
    var dy = lastScrollY - y;
    var speed = dy / dt;
    lastScrollY = y;
    lastScrollT = t;
    if (articleProgress() >= 0.5) maybeOpen();
    if (speed > 1.6 && y < 80) maybeOpen();
  }

  function onMouseOut(e) {
    if (e.relatedTarget || e.toElement) return;
    if (e.clientY > 8) return;
    maybeOpen();
  }

  for (var i = 0; i < closeBtns.length; i++) {
    closeBtns[i].addEventListener("click", function (e) {
      e.preventDefault();
      close();
    });
  }

  var cta = root.querySelector(".nhn-popup-cta");
  if (cta) {
    cta.addEventListener("click", function () {
      markDismissed();
    });
  }

  document.addEventListener("emailoctopus:form.success", function () {
    markSubscribed();
    if (opened) close();
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("mouseout", onMouseOut);

  window.__nhnOpenGuidePopup = function () {
    return open({ force: true });
  };
  window.__nhnCloseGuidePopup = function () {
    close();
  };

  if (forceRequested() && !excluded()) {
    readyAt = 0;
    open({ force: true });
  }
})();
