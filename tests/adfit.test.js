import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const runtime = fs.readFileSync(new URL("../adfit.js", import.meta.url), "utf8");
const storageKey = "calc:adfit:collapsed:v1";

// Browser-free tests exercise network/request and input lifecycle transitions.
// Layout and real Kakao delivery are checked separately in the deployed page.
function setup(options = {}) {
  let width = options.width ?? 390;
  let nextTimer = 0;
  const timers = new Map();
  const observers = [];
  const storage = new Map(options.collapsed ? [[storageKey, "1"]] : []);

  class Events {
    listeners = new Map();
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({callback, once: options?.once});
    }
    emit(type, detail = {}) {
      const handlers = [...(this.listeners.get(type) || [])];
      for (const handler of handlers) {
        if (handler.once) this.listeners.set(type, this.listeners.get(type).filter(item => item !== handler));
        handler.callback({target: this, ...detail});
      }
    }
  }

  function mutation(target, type = "childList", attributeName) {
    for (const observer of observers) {
      if (observer.targets.some(item => (item.target === target || item.options.subtree && item.target.contains(target))
        && (type === "childList" && item.options.childList || type === "attributes" && item.options.attributes
          && (!item.options.attributeFilter || item.options.attributeFilter.includes(attributeName))))) {
        observer.callback([{target, type, attributeName}]);
      }
    }
  }

  class Element extends Events {
    constructor(tagName = "div") {
      super();
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.attributes = {};
      this.style = {setProperty(name, value) { this[name] = value; }};
      this.classList = {values: new Set(), add(value) { this.values.add(value); }, contains(value) { return this.values.has(value); }};
      this.hidden = false;
      this.textContent = "";
    }
    get clientWidth() { return this.hidden || this.parentNode?.clientWidth === 0 ? 0 : width; }
    getBoundingClientRect() { return {width: this.clientWidth, height: this.hidden ? 0 : panel.hidden ? 44 : 168}; }
    appendChild(child) { child.parentNode = this; this.children.push(child); mutation(this); return child; }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; for (const child of children) this.appendChild(child); mutation(this); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(name, value) { this.attributes[name] = String(value); mutation(this, "attributes", name); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    matches(selector) {
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector === "[data-adfit-host]") return this === host;
      if (selector === "[data-adfit-toggle-label]") return this === label;
      if (selector === "[data-adfit-toggle-icon]") return this === icon;
      if (selector === "[contenteditable]") return "contenteditable" in this.attributes;
      if (selector === "[data-insert]") return "insert" in this.dataset;
      if (selector === "[data-action]") return "action" in this.dataset;
      return this.tagName.toLowerCase() === selector;
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    closest(selector) {
      return selector.split(",").map(part => part.trim()).some(part => this.matches(part)) ? this : this.parentNode?.closest(selector) || null;
    }
  }

  const host = new Element();
  const panel = new Element(); panel.id = "calculator-ad-panel"; panel.appendChild(host);
  const label = new Element("span");
  const icon = new Element("span");
  const toggle = new Element("button"); toggle.id = "calculator-ad-toggle"; toggle.appendChild(label); toggle.appendChild(icon);
  const zone = new Element("aside"); zone.id = "calculator-ad"; zone.hidden = true; zone.appendChild(toggle); zone.appendChild(panel);
  const dialog = new Element("dialog");
  const head = new Element("head");
  const body = new Element("body"); body.appendChild(zone); body.appendChild(dialog);
  const document = Object.assign(new Events(), {
    readyState: "loading",
    hidden: options.hidden ?? false,
    head, body, documentElement: new Element("html"), activeElement: body,
    getElementById: id => head.querySelector(`#${id}`) || body.querySelector(`#${id}`),
    createElement: tagName => new Element(tagName),
    querySelector: selector => selector === "dialog[open]" && dialog.open ? dialog : null,
    querySelectorAll: selector => selector === "dialog" ? [dialog] : []
  });
  class MutationObserver {
    targets = [];
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.targets.push({target, options}); }
    disconnect() { this.targets = []; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  }
  const visualViewport = Object.assign(new Events(), {height: 844, offsetTop: 0, scale: 1});
  const scope = Object.assign(new Events(), {
    document, visualViewport, innerHeight: 844,
    navigator: {userAgent: options.userAgent ?? "Browser/1", onLine: options.online ?? true},
    MutationObserver: options.mutationObserver === false ? undefined : MutationObserver,
    ResizeObserver,
    sessionStorage: {
      getItem(key) { if (options.storageBlocked) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem(key, value) { if (options.storageBlocked) throw new Error("Storage blocked"); storage.set(key, value); }
    },
    clearTimeout(id) { timers.delete(id); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    CALC_AD_CONFIG: {enabled: options.enabled ?? true, script: "https://example.test/adfit.js", placement: {unit: options.unit ?? "DAN-testUnit1", width: 320, height: options.height ?? 100}}
  });
  scope.window = scope; scope.globalThis = scope; scope.self = scope;
  scope.top = options.embedded ? {} : scope;
  const context = vm.createContext(scope);
  vm.runInContext(runtime, context);
  document.emit("DOMContentLoaded");
  const script = () => head.children.find(child => child.tagName === "SCRIPT");
  const pressToggle = () => { document.activeElement = toggle; toggle.emit("click"); };
  const deliver = () => { const frame = new Element("iframe"); host.children[0].appendChild(frame); return frame; };
  const runTimers = () => { for (const [id, timer] of [...timers]) if (timers.delete(id)) timer.callback(); };
  return {
    scope, context, document, zone, host, panel, toggle, label, head, body, dialog, timers, observers, storage,
    script, pressToggle, deliver, runTimers,
    setWidth(value) { width = value; scope.emit("resize"); },
    setHidden(value) { document.hidden = value; document.emit("visibilitychange"); },
    setOnline(value) { scope.navigator.onLine = value; scope.emit(value ? "online" : "offline"); },
    focus(tagName = "input") { const field = new Element(tagName); document.activeElement = field; document.emit("focusin", {target: field}); return field; },
    newElement(tagName) { return new Element(tagName); }
  };
}

test("웹은 전용 규격을 요청하고 접기·펼치기·중복 실행에도 SDK와 ins를 재생성하지 않는다", () => {
  const s = setup();
  assert.equal(s.zone.hidden, false);
  assert.equal(s.zone.dataset.state, "loading");
  assert.equal(s.host.children[0].dataset.adUnit, "DAN-testUnit1");
  assert.equal(s.host.children[0].dataset.adWidth, "320");
  assert.equal(s.host.children[0].dataset.adHeight, "100");
  const originalAd = s.host.children[0];
  s.script().emit("load"); s.deliver();
  assert.equal(s.zone.dataset.state, "loaded");
  assert.equal(s.timers.size, 0);
  assert.equal(s.observers.some(observer => observer.targets.some(item => item.target === s.host)), false);
  s.pressToggle();
  assert.equal(s.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(s.panel.hidden, true);
  assert.equal(s.label.textContent, "광고 펼치기");
  assert.equal(s.body.style["--calc-ad-space"], "44px");
  s.pressToggle();
  assert.equal(s.panel.hidden, false);
  assert.equal(s.body.style["--calc-ad-space"], "168px");
  vm.runInContext(runtime, s.context);
  s.document.emit("DOMContentLoaded"); s.scope.emit("pageshow");
  assert.equal(s.head.children.length, 1);
  assert.equal(s.host.children[0], originalAd);
});

test("세션에 접힘이 저장되어 있으면 첫 펼침까지 요청하지 않으며 선택을 저장한다", () => {
  const s = setup({collapsed: true});
  assert.equal(s.panel.hidden, true);
  assert.equal(s.head.children.length, 0);
  s.setHidden(true); s.setHidden(false);
  assert.equal(s.head.children.length, 0);
  s.pressToggle();
  assert.equal(s.head.children.length, 1);
  assert.equal(s.storage.get(storageKey), "0");
  s.pressToggle();
  assert.equal(s.storage.get(storageKey), "1");
});

test("AdMob WebView·iframe·비활성·잘못된 ID나 크기는 요청과 예약 공간이 없다", () => {
  for (const options of [{userAgent: "Browser/1 AdMobNative/1"}, {embedded: true}, {enabled: false}, {unit: "invalid"}, {height: 50}]) {
    const s = setup(options);
    assert.equal(s.zone.hidden, true);
    assert.equal(s.head.children.length, 0);
    assert.equal(s.body.style["--calc-ad-space"], "0px");
    assert.equal(s.body.classList.contains("adfit-layout"), false);
  }
});

test("백그라운드 진입은 가시화 시 한 번 요청하고 진행 중 타임아웃은 복귀 후 재개한다", () => {
  const s = setup({hidden: true});
  assert.equal(s.head.children.length, 0);
  s.setHidden(false);
  assert.equal(s.head.children.length, 1);
  s.script().emit("load");
  s.setHidden(true);
  assert.equal(s.timers.size, 0);
  s.runTimers();
  assert.equal(s.zone.hidden, false);
  s.setHidden(false);
  assert.equal(s.timers.size, 1);
  s.deliver();
  assert.equal(s.timers.size, 0);
  assert.equal(s.head.children.length, 1);
});

test("오프라인과 320px 미만 공간은 일시 중지하며 복구해도 받은 광고를 재요청하지 않는다", () => {
  const s = setup({online: false});
  assert.equal(s.zone.dataset.state, "offline");
  assert.equal(s.head.children.length, 0);
  s.setWidth(300); s.setOnline(true);
  assert.equal(s.zone.dataset.state, "too-narrow");
  assert.equal(s.head.children.length, 0);
  s.setWidth(320);
  assert.equal(s.head.children.length, 1);
  s.script().emit("load"); s.deliver();
  const ad = s.host.children[0];
  s.setWidth(280);
  assert.equal(s.zone.hidden, true);
  assert.equal(s.body.style["--calc-ad-space"], "0px");
  s.setWidth(390); s.setOnline(false); s.setOnline(true);
  assert.equal(s.zone.dataset.state, "loaded");
  assert.equal(s.zone.hidden, false);
  assert.equal(s.host.children[0], ad);
  assert.equal(s.head.children.length, 1);
});

test("입력·키패드·키보드 계산은 자동 접히고 수동 펼침 전까지 다시 나타나지 않는다", () => {
  const s = setup(); s.script().emit("load"); s.deliver();
  for (const tagName of ["input", "textarea"]) {
    s.focus(tagName);
    assert.equal(s.panel.hidden, true);
    assert.equal(s.storage.has(storageKey), tagName === "textarea");
    s.document.activeElement = s.body;
    s.scope.emit("resize"); s.setHidden(true); s.setHidden(false);
    assert.equal(s.panel.hidden, true);
    s.pressToggle();
    assert.equal(s.panel.hidden, false);
  }
  const key = s.newElement("button"); key.dataset.insert = "1";
  s.document.emit("click", {target: key});
  assert.equal(s.panel.hidden, true);
  s.pressToggle();
  s.document.emit("keydown", {target: s.body, key: "7"});
  assert.equal(s.panel.hidden, true);
  s.pressToggle();
  s.document.emit("keydown", {target: s.toggle, key: "Enter"});
  assert.equal(s.panel.hidden, false);
  assert.equal(s.head.children.length, 1);
});

test("대화상자와 가상 키보드에서 접고 닫힌 후에도 사용자 펼침을 기다린다", () => {
  const s = setup({collapsed: true});
  s.dialog.open = true; s.dialog.setAttribute("open", "");
  s.pressToggle();
  assert.equal(s.panel.hidden, true);
  assert.equal(s.head.children.length, 0);
  s.dialog.open = false;
  s.scope.emit("resize");
  assert.equal(s.panel.hidden, true);
  s.pressToggle();
  assert.equal(s.head.children.length, 1);
  s.focus("textarea");
  s.scope.visualViewport.height = 500;
  s.scope.visualViewport.emit("resize");
  assert.equal(s.panel.hidden, true);
  s.scope.visualViewport.height = 844;
  s.scope.visualViewport.emit("resize");
  assert.equal(s.panel.hidden, true);
  s.pressToggle();
  assert.equal(s.panel.hidden, false);
});

test("포커스가 남은 입력창의 붙여넣기·IME·contenteditable 입력도 광고를 접는다", () => {
  const s = setup(); s.script().emit("load"); s.deliver();
  const field = s.focus("textarea");
  s.toggle.emit("click"); // Some mobile browsers leave the field focused.
  assert.equal(s.document.activeElement, field);
  assert.equal(s.panel.hidden, false);
  s.document.emit("beforeinput", {target: field, inputType: "insertFromPaste"});
  assert.equal(s.panel.hidden, true);
  s.toggle.emit("click");
  s.document.emit("input", {target: field, data: "한", isComposing: true});
  assert.equal(s.panel.hidden, true);
  const editable = s.newElement("div"); editable.setAttribute("contenteditable", "true");
  const child = s.newElement("span"); editable.appendChild(child);
  s.toggle.emit("click");
  s.document.emit("input", {target: child, data: "a"});
  assert.equal(s.panel.hidden, true);
  assert.equal(s.head.children.length, 1);
});

test("NOAD는 iframe 수신 후에도 공간을 반환하고 재시도하지 않는다", () => {
  const s = setup(); s.script().emit("load"); s.deliver();
  const ad = s.host.children[0];
  s.scope.calcAdFitFailed({});
  assert.equal(s.zone.hidden, false);
  s.scope.calcAdFitFailed(ad);
  assert.equal(s.zone.hidden, true);
  assert.equal(s.zone.dataset.reason, "noad");
  assert.equal(s.body.style["--calc-ad-space"], "0px");
  assert.equal(s.body.classList.contains("adfit-layout"), true);
  s.setWidth(800); s.setOnline(false); s.setOnline(true); s.scope.calcAdFitLoaded(ad);
  assert.equal(s.zone.hidden, true);
  assert.equal(s.host.children.length, 0);
  assert.equal(s.head.children.length, 1);
});

test("SDK 오류·다운로드 무응답·광고 응답 무응답은 지면과 공간을 반환한다", () => {
  for (const failure of ["error", "sdk-timeout", "response-timeout"]) {
    const s = setup();
    if (failure === "error") s.script().emit("error");
    else { if (failure === "response-timeout") s.script().emit("load"); s.runTimers(); }
    assert.equal(s.zone.hidden, true, failure);
    assert.equal(s.zone.dataset.state, "failed");
    assert.equal(s.body.style["--calc-ad-space"], "0px");
    assert.equal(s.timers.size, 0);
    s.scope.emit("resize"); s.setHidden(true); s.setHidden(false);
    assert.equal(s.head.children.length, 1);
  }
});

test("MutationObserver나 성공 콜백이 없어도 숨긴 정상 iframe을 실패로 처리하지 않는다", () => {
  const s = setup({mutationObserver: false});
  s.script().emit("load");
  s.pressToggle();
  s.deliver();
  s.runTimers();
  assert.equal(s.zone.hidden, false);
  assert.equal(s.zone.dataset.state, "loaded");
  assert.equal(s.panel.hidden, true);
  s.pressToggle();
  assert.equal(s.host.children.length, 1);
  assert.equal(s.head.children.length, 1);
});

test("성공 콜백만으로 iframe 없는 지면을 성공 처리하지 않고 저장소 차단도 견딘다", () => {
  const s = setup({storageBlocked: true});
  s.script().emit("load");
  s.scope.calcAdFitLoaded(s.host.children[0]);
  assert.equal(s.zone.dataset.state, "loading");
  s.pressToggle(); s.pressToggle();
  assert.equal(s.head.children.length, 1);
  s.runTimers();
  assert.equal(s.zone.hidden, true);
});
