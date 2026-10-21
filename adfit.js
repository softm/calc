(function (root) {
  "use strict";

  if (!root.document || root.CalcAdFit) return;

  const storageKey = "calc:adfit:collapsed:v1";
  const sdkId = "calc-adfit-sdk";
  const responseWait = 30000;
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  let zone, host, panel, toggle, label, icon;
  let initialized = false;
  let requested = false;
  let loaded = false;
  let failed = false;
  let failureReason = "";
  let collapsed = false;
  let autoCollapsed = false;
  let ad = null;
  let timeout = 0;
  let timeoutPhase = "";
  let adObserver = null;

  function settings() {
    return root.CALC_AD_CONFIG || {};
  }

  function validPlacement(placement) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(placement?.unit || "").trim())
      && Number(placement?.width) === 320
      && Number(placement?.height) === 100;
  }

  function isEmbedded() {
    try { return root.self !== root.top; } catch { return true; }
  }

  function offline() {
    return root.navigator?.onLine === false;
  }

  function isEditable(target) {
    const field = target?.closest?.("input, textarea, [contenteditable]");
    if (!field || field.disabled || field.readOnly) return false;
    if (field.isContentEditable || field.tagName === "TEXTAREA") return true;
    if (field.tagName === "INPUT") return !/^(button|submit|reset|checkbox|radio|range|color|file|hidden)$/i.test(field.type || "text");
    return field.getAttribute("contenteditable") !== "false";
  }

  function keyboardOpen() {
    const viewport = root.visualViewport;
    return Boolean(viewport && isEditable(root.document.activeElement)
      && (!viewport.scale || viewport.scale < 1.1)
      && (root.innerHeight - viewport.height - (viewport.offsetTop || 0)) > 140);
  }

  function dialogOpen() {
    return Boolean(root.document.querySelector("dialog[open]"));
  }

  function syncSpace() {
    const height = zone && !zone.hidden ? Math.ceil(zone.getBoundingClientRect().height) : 0;
    root.document.body.style.setProperty("--calc-ad-space", `${height}px`);
  }

  function clearWait() {
    root.clearTimeout(timeout);
    timeout = 0;
  }

  function markLoaded() {
    // The documented failure callback can arrive after an iframe is inserted.
    // Keep that callback active, but stop observing successful DOM mutations.
    if (failed || !ad || !host.querySelector("iframe")) return false;
    loaded = true;
    timeoutPhase = "";
    clearWait();
    adObserver?.disconnect();
    adObserver = null;
    if (!zone.hidden) zone.dataset.state = "loaded";
    syncSpace();
    return true;
  }

  function fail(reason) {
    if (failed) return;
    failed = true;
    failureReason = reason;
    timeoutPhase = "";
    clearWait();
    adObserver?.disconnect();
    adObserver = null;
    // Remove this placement without relying on undocumented SDK teardown APIs.
    // No automatic request retry follows.
    ad = null;
    host?.replaceChildren();
    if (zone) {
      zone.hidden = true;
      zone.dataset.state = "failed";
      zone.dataset.reason = reason;
    }
    syncSpace();
  }

  function ensureWait(phase) {
    if (phase) {
      clearWait();
      timeoutPhase = phase;
    }
    if (loaded || failed || !timeoutPhase) return;
    if (root.document.hidden || offline() || zone.hidden) {
      clearWait();
      return;
    }
    if (timeout) return;
    timeout = root.setTimeout(() => {
      timeout = 0;
      // A collapsed panel still contains its valid iframe; visibility is not
      // evidence of NOAD. Background tabs resume their wait on visibilitychange.
      if (markLoaded()) return;
      if (root.document.hidden || offline() || zone.hidden) return;
      fail(`${timeoutPhase}-timeout`);
    }, responseWait);
  }

  function requestAd() {
    if (requested || failed || collapsed || autoCollapsed || zone.hidden
      || root.document.hidden || offline() || dialogOpen() || keyboardOpen()) return;
    const config = settings();
    const placement = config.placement;
    if (!validPlacement(placement) || host.clientWidth < Number(placement.width)) return;

    requested = true;
    zone.dataset.state = "loading";
    ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = String(placement.unit).trim();
    ad.dataset.adWidth = String(placement.width);
    ad.dataset.adHeight = String(placement.height);
    ad.dataset.adOnfail = "calcAdFitFailed";
    ad.dataset.adOnload = "calcAdFitLoaded";
    host.appendChild(ad);

    if (root.MutationObserver) {
      adObserver = new root.MutationObserver(markLoaded);
      adObserver.observe(host, {childList: true, subtree: true});
    }

    let script = root.document.getElementById(sdkId);
    if (!script) {
      script = root.document.createElement("script");
      script.id = sdkId;
      script.async = true;
      script.charset = "utf-8";
      script.src = config.script || "https://t1.kakaocdn.net/kas/static/ba.min.js";
      script.addEventListener("error", () => fail("sdk-error"), {once: true});
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        if (!markLoaded()) ensureWait("response");
      }, {once: true});
      ensureWait("sdk");
      root.document.head.appendChild(script);
    } else {
      script.addEventListener("error", () => fail("sdk-error"), {once: true});
      script.addEventListener("load", () => { if (!markLoaded()) ensureWait("response"); }, {once: true});
      ensureWait(script.dataset.loaded === "true" ? "response" : "sdk");
    }
  }

  function sync() {
    if (!initialized) return;
    const config = settings();
    if (dialogOpen() || keyboardOpen()) autoCollapsed = true;
    const hiddenPanel = collapsed || autoCollapsed;
    panel.hidden = hiddenPanel;
    zone.dataset.collapsed = String(hiddenPanel);
    toggle.setAttribute("aria-expanded", String(!hiddenPanel));
    label.textContent = hiddenPanel ? "광고 펼치기" : "광고 접기";
    if (icon) icon.textContent = hiddenPanel ? "⌃" : "⌄";

    const state = loaded ? "loaded" : requested ? "loading" : "idle";
    let unavailable = "";
    if (!config.enabled || !validPlacement(config.placement)) unavailable = "disabled";
    else if (appWithNativeAds) unavailable = "native";
    else if (isEmbedded()) unavailable = "embedded";
    else if (failed) unavailable = "failed";
    else if (offline()) unavailable = "offline";
    else if (root.document.documentElement.clientWidth < Number(config.placement.width)) unavailable = "too-narrow";

    zone.hidden = Boolean(unavailable);
    if (!unavailable) {
      // Keep the flex scroll container once enabled, including after NOAD.
      // Hiding only the aside then releases space without changing scroll roots.
      root.document.body.classList.add("adfit-layout");
      const width = hiddenPanel ? zone.clientWidth : host.clientWidth;
      if (width < Number(config.placement.width)) {
        zone.hidden = true;
        unavailable = "too-narrow";
      }
    }
    zone.dataset.state = unavailable || state;
    if (failed) zone.dataset.reason = failureReason;
    syncSpace();
    if (!unavailable && requested) markLoaded();
    ensureWait();
    if (!unavailable) requestAd();
  }

  function collapseForInput() {
    if (autoCollapsed) return;
    autoCollapsed = true;
    sync();
  }

  function init() {
    if (initialized) return;
    zone = root.document.getElementById("calculator-ad");
    host = zone?.querySelector("[data-adfit-host]");
    panel = root.document.getElementById("calculator-ad-panel");
    toggle = root.document.getElementById("calculator-ad-toggle");
    label = toggle?.querySelector("[data-adfit-toggle-label]");
    icon = toggle?.querySelector("[data-adfit-toggle-icon]");
    if (!zone || !host || !panel || !toggle || !label) {
      if (zone) zone.hidden = true;
      return;
    }
    initialized = true;
    try { collapsed = root.sessionStorage.getItem(storageKey) === "1"; } catch {}
    if (isEditable(root.document.activeElement) || dialogOpen() || keyboardOpen()) autoCollapsed = true;

    toggle.addEventListener("click", () => {
      collapsed = !(collapsed || autoCollapsed);
      autoCollapsed = false;
      try { root.sessionStorage.setItem(storageKey, collapsed ? "1" : "0"); } catch {}
      sync();
    });
    root.document.addEventListener("focusin", event => {
      if (isEditable(event.target) || dialogOpen()) collapseForInput();
    });
    for (const type of ["beforeinput", "input"]) {
      root.document.addEventListener(type, event => {
        if (isEditable(event.target)) collapseForInput();
      });
    }
    root.document.addEventListener("click", event => {
      if (event.target?.closest?.("#keypad button, [data-insert], [data-action], #backspace-button")) collapseForInput();
      else if (dialogOpen()) collapseForInput();
    });
    root.document.addEventListener("keydown", event => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || event.target?.closest?.("#calculator-ad-toggle")) return;
      if (/^[\d.+\-*/%^()!=]$/.test(event.key) || ["Enter", "Backspace"].includes(event.key)) collapseForInput();
    });
    root.document.addEventListener("beforetoggle", event => {
      if (event.target?.tagName === "DIALOG" && event.newState === "open") collapseForInput();
    }, true);
    if (root.MutationObserver) {
      const dialogObserver = new root.MutationObserver(() => { if (dialogOpen()) collapseForInput(); });
      for (const dialog of root.document.querySelectorAll("dialog")) {
        dialogObserver.observe(dialog, {attributes: true, attributeFilter: ["open"]});
      }
    }
    root.addEventListener("resize", sync, {passive: true});
    root.addEventListener("online", sync);
    root.addEventListener("offline", sync);
    root.addEventListener("pageshow", sync);
    root.document.addEventListener("visibilitychange", sync);
    root.visualViewport?.addEventListener("resize", sync, {passive: true});
    if (root.ResizeObserver) new root.ResizeObserver(syncSpace).observe(zone);
    sync();
  }

  root.calcAdFitFailed = currentAd => {
    if (ad && currentAd === ad) fail("noad");
  };
  root.calcAdFitLoaded = currentAd => {
    if (ad && currentAd === ad) markLoaded();
  };
  root.CalcAdFit = Object.freeze({sync});
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
})(typeof window === "undefined" ? globalThis : window);
