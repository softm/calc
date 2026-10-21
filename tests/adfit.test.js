import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const runtime = fs.readFileSync(new URL("../adfit.js", import.meta.url), "utf8");

function setup({userAgent = "Browser/1", unit = "DAN-testUnit1"} = {}) {
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.hidden = true;
      this.clientWidth = 360;
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(selector) {
      if (selector === "[data-adfit-host]") return this.host || null;
      if (selector === "iframe") return this.children.find(child => child.tagName === "IFRAME") || null;
      return null;
    }
  }

  const host = new Element();
  const zone = new Element("aside");
  zone.host = host;
  const head = new Element("head");
  const listeners = new Map();
  const document = {
    hidden: false,
    head,
    getElementById: id => id === "calculator-ad" ? zone : null,
    createElement: tagName => new Element(tagName)
  };
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback([{isIntersecting: true}]); }
    disconnect() {}
  }
  const scope = {
    document,
    navigator: {userAgent},
    IntersectionObserver,
    Object,
    clearTimeout() {},
    setTimeout() { return 1; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    CALC_AD_CONFIG: {enabled: true, script: "https://example.test/adfit.js", placement: {unit, width: 320, height: 100}}
  };
  scope.window = scope;
  scope.globalThis = scope;
  vm.runInContext(runtime, vm.createContext(scope));
  listeners.get("DOMContentLoaded")();
  return {scope, zone, host, head};
}

test("웹에서는 320x100 AdFit 광고를 한 번만 요청한다", () => {
  const state = setup();
  assert.equal(state.zone.hidden, false);
  assert.equal(state.host.children[0].dataset.adUnit, "DAN-testUnit1");
  assert.equal(state.host.children[0].dataset.adWidth, "320");
  assert.equal(state.head.children.length, 1);
});

test("AdMob Android WebView와 잘못된 광고 ID에서는 AdFit을 요청하지 않는다", () => {
  const app = setup({userAgent: "Browser/1 AdMobNative/1"});
  assert.equal(app.zone.hidden, true);
  assert.equal(app.head.children.length, 0);

  const invalid = setup({unit: "invalid"});
  assert.equal(invalid.zone.hidden, true);
  assert.equal(invalid.head.children.length, 0);
});
