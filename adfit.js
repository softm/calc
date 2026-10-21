(function (root) {
  "use strict";

  const zoneId = "calculator-ad";
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  let requested = false;
  let failed = false;
  let timeout = 0;
  let ad = null;

  function settings() {
    return root.CALC_AD_CONFIG || {};
  }

  function validPlacement(placement) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(placement?.unit || "").trim())
      && Number(placement?.width) === 320
      && Number(placement?.height) === 100;
  }

  function elements() {
    const zone = root.document.getElementById(zoneId);
    return {zone, host: zone?.querySelector("[data-adfit-host]")};
  }

  function hide() {
    const {zone, host} = elements();
    root.clearTimeout(timeout);
    failed = true;
    if (zone) zone.hidden = true;
    if (host) host.replaceChildren();
  }

  function load() {
    if (requested || failed || root.document.hidden) return;
    const config = settings();
    const placement = config.placement;
    const {zone, host} = elements();
    if (!zone || !host || !config.enabled || appWithNativeAds || !validPlacement(placement) || host.clientWidth < placement.width) {
      hide();
      return;
    }

    requested = true;
    zone.hidden = false;
    zone.dataset.state = "loading";
    ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = placement.unit;
    ad.dataset.adWidth = String(placement.width);
    ad.dataset.adHeight = String(placement.height);
    ad.dataset.adOnfail = "calcAdFitFailed";
    ad.dataset.adOnload = "calcAdFitLoaded";
    host.appendChild(ad);

    const script = root.document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = config.script || "https://t1.kakaocdn.net/kas/static/ba.min.js";
    script.onerror = hide;
    script.onload = () => {
      timeout = root.setTimeout(() => {
        if (!host.querySelector("iframe")) hide();
      }, 30000);
    };
    root.document.head.appendChild(script);
  }

  function init() {
    const {zone} = elements();
    if (!zone || appWithNativeAds || !settings().enabled || !validPlacement(settings().placement)) {
      hide();
      return;
    }
    zone.hidden = false;
    if (!root.IntersectionObserver) {
      load();
      return;
    }
    const observer = new root.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, {rootMargin: "200px 0px"});
    observer.observe(zone);
  }

  root.calcAdFitFailed = currentAd => {
    if (currentAd === ad) hide();
  };
  root.calcAdFitLoaded = currentAd => {
    if (currentAd !== ad || failed) return;
    root.clearTimeout(timeout);
    const {zone} = elements();
    if (zone) zone.dataset.state = "loaded";
  };
  root.addEventListener("DOMContentLoaded", init, {once: true});
})(typeof window === "undefined" ? globalThis : window);
