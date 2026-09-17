import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const publicFile = name => new URL(`../web/public/${name}`, import.meta.url);

class FakeTarget {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.capturedPointers = new Set();
    this.children = [];
    this.classList = {
      values: new Set(),
      toggle: (name, force) => force ? this.classList.values.add(name) : this.classList.values.delete(name),
      add: name => this.classList.values.add(name),
      remove: name => this.classList.values.delete(name),
      contains: name => this.classList.values.has(name),
    };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      pointerId: 0,
      pointerType: "",
      detail: type === "click" ? 1 : 0,
      key: "",
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    this[`on${type}`]?.(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  setPointerCapture(pointerId) {
    if (this.captureFails) throw new Error("pointer capture unavailable");
    this.capturedPointers.add(pointerId);
  }
  hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); }
  releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  dispatchEvent(event) { this.dispatch(event.type, event); }
  focus() {}
}

async function setupShell({runtimeReady = true, autoLaunch = true} = {}) {
  let now = 0;
  let timerId = 0;
  const timers = [];
  const events = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeTarget(id));
    return elements.get(id);
  };
  const keys = ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown", " ", "x", "Enter", "1", "2", "3", "m", "h"];
  const buttons = keys.map((key, index) => {
    const button = element(`key-${index}`);
    button.dataset.key = key;
    if (key === " ") button.dataset.hold = "true";
    button.setAttribute("aria-pressed", "false");
    return button;
  });
  const selectors = new Map([
    ["#mode-title", element("mode-title")], ["#mode-description", element("mode-description")],
    ["#launch", element("launch")], ["#status", element("status")],
    ["#game-controls", element("game-controls")], ["#downloads", element("downloads")],
    ["#game", element("game")], ["#stop", element("stop")],
    ["#controls-more", element("controls-more")], ["#restart", element("restart")],
    ["#audio", element("audio")], ["#play-surface", element("play-surface")],
    ["#fullscreen", element("fullscreen")], ["#exit-fullscreen", element("exit-fullscreen")],
    ["#diagnostics", element("diagnostics")], ["#diagnostics pre", element("diagnostics-pre")],
    ["#game-lobby-toggle", element("game-lobby-toggle")],
  ]);
  selectors.get("#controls-more").setAttribute("aria-expanded", "false");
  const document = new FakeTarget("document");
  document.hidden = false;
  document.fullscreenElement = null;
  document.querySelector = selector => selectors.get(selector) || (selector.startsWith("nav a[") ? element("nav-current") : null);
  document.querySelectorAll = selector => selector === "[data-key]" ? buttons : [];
  document.createElement = tag => new FakeTarget(tag);
  document.head = new FakeTarget('head');
  document.exitFullscreen = async () => { document.fullscreenElement = null; };
  const window = new FakeTarget("window");
  window.document = document;
  window.location = { search: "?mode=tutorial", href: "http://test/?mode=tutorial", reload() {} };
  window.performance = { now: () => now };
  window.screen = { orientation: new FakeTarget("orientation") };
  if (runtimeReady) window.DirPlayer = { init() {} };
  window.__vm = {
    key_down: key => events.push(["down", key]),
    key_up: key => events.push(["up", key]),
    mcp_get_execution_state: () => "{}",
    mcp_get_console_output: () => "",
  };
  window.setTimeout = (callback, delay = 0) => {
    const timer = { id: ++timerId, at: now + delay, callback };
    timers.push(timer);
    return timer.id;
  };
  window.clearTimeout = id => {
    const timer = timers.find(candidate => candidate.id === id);
    if (timer) timer.cancelled = true;
  };
  window.setInterval = () => ++timerId;
  window.clearInterval = () => {};
  window.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
  window.URL = URL;
  window.URLSearchParams = URLSearchParams;
  window.Object = Object;
  window.Map = Map;
  window.WeakMap = WeakMap;
  window.Set = Set;
  window.Promise = Promise;
  window.console = console;
  window.window = window;
  window.globalThis = window;

  const context = vm.createContext(window);
  for (const file of ["control-input.js", "shell.js"])
    vm.runInContext(await readFile(publicFile(file), "utf8"), context, { filename: file });
  if (autoLaunch) await context.gutfeelLaunchMovie();

  function advance(milliseconds) {
    now += milliseconds;
    let ran;
    do {
      ran = false;
      timers.sort((a, b) => a.at - b.at);
      for (const timer of timers) {
        if (!timer.cancelled && !timer.ran && timer.at <= now) {
          timer.ran = true;
          timer.callback();
          ran = true;
        }
      }
    } while (ran);
  }

  return { window, document, buttons, byKey: key => buttons.find(button => button.dataset.key === key), events, advance };
}

test('Training is ready before the runtime downloads, and Start waits for one load', async () => {
  const {window, document} = await setupShell({runtimeReady: false, autoLaunch: false});
  assert.equal(document.querySelector('#mode-title').textContent, 'Automaton training');
  assert.equal(document.querySelector('#play-surface').hidden, false);
  assert.equal(document.querySelector('#game-controls').hidden, true);
  assert.equal(document.head.children.length, 0);

  const launch = window.gutfeelLaunchMovie();
  assert.equal(document.querySelector('#launch').disabled, true);
  assert.equal(document.querySelector('#game').children.length, 0);
  await window.gutfeelLaunchMovie();
  assert.equal(document.head.children.length, 1);
  const script = document.head.children[0];
  assert.equal(script.src, 'runtime/dirplayer-polyfill.js');
  assert.equal(script.getAttribute('data-manual-init'), '');
  let starts = 0;
  window.DirPlayer = {init() { starts++; }};
  script.onload();
  await launch;
  assert.equal(starts, 1);
  assert.equal(document.querySelector('#game').children[0].src, 'movies/tutorial/main.dir');
  assert.equal(document.querySelector('#game-controls').hidden, false);
});

test('a failed runtime download leaves Start available for a successful retry', async () => {
  const {window, document} = await setupShell({runtimeReady: false, autoLaunch: false});
  const first = window.gutfeelLaunchMovie();
  document.head.children[0].onerror();
  await first;
  assert.equal(document.head.children[0].removed, true);
  assert.equal(document.querySelector('#launch').disabled, false);
  assert.match(document.querySelector('#status').textContent, /could not load/);
  assert.equal(document.querySelector('#game-controls').hidden, true);
  const retry = window.gutfeelLaunchMovie();
  assert.equal(document.head.children.length, 2);
  window.DirPlayer = {init() {}};
  document.head.children[1].onload();
  await retry;
  assert.equal(document.querySelector('#game').children.length, 1);
});

test("quick mouse pointer press releases and its click does not latch", async () => {
  const app = await setupShell();
  const left = app.byKey("ArrowLeft");
  left.dispatch("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0 });
  assert.deepEqual(app.events, [["down", "ArrowLeft"]]);
  assert.notEqual(left.getAttribute("aria-pressed"), "true", "momentary holds are not toggle buttons");
  assert.equal(left.classList.contains("is-held"), true);
  left.dispatch("pointerup", { pointerType: "mouse", pointerId: 1, button: 0 });
  assert.deepEqual(app.events, [["down", "ArrowLeft"], ["up", "ArrowLeft"]]);
  assert.equal(left.classList.contains("is-held"), false);
  left.dispatch("click", { detail: 1 });
  assert.deepEqual(app.events, [["down", "ArrowLeft"], ["up", "ArrowLeft"]]);
});

test("click-only accessibility activation is a deterministic short press", async () => {
  const app = await setupShell();
  app.byKey("ArrowRight").dispatch("click", { detail: 0 });
  assert.deepEqual(app.events, [["down", "ArrowRight"]]);
  app.advance(139);
  assert.deepEqual(app.events, [["down", "ArrowRight"]]);
  app.advance(1);
  assert.deepEqual(app.events, [["down", "ArrowRight"], ["up", "ArrowRight"]]);
});

test("click-only mouse activation pulses, while a right-button pointer is ignored", async () => {
  const app = await setupShell();
  const right = app.byKey("ArrowRight");
  right.dispatch("pointerdown", { pointerType: "mouse", pointerId: 4, button: 2 });
  right.dispatch("pointerup", { pointerType: "mouse", pointerId: 4, button: 2 });
  assert.deepEqual(app.events, []);

  right.dispatch("click", { detail: 1, pointerType: "mouse" });
  assert.deepEqual(app.events, [["down", "ArrowRight"]]);
  app.advance(140);
  assert.deepEqual(app.events, [["down", "ArrowRight"], ["up", "ArrowRight"]]);
});

test("touch compatibility click never re-latches after release", async () => {
  const app = await setupShell();
  const boost = app.byKey(" ");
  boost.dispatch("pointerdown", { pointerType: "touch", pointerId: 7 });
  boost.dispatch("pointerup", { pointerType: "touch", pointerId: 7 });
  app.advance(800);
  boost.dispatch("click", { detail: 1 });
  assert.deepEqual(app.events, [["down", " "], ["up", " "]]);
});

test("long touch and mouse holds remain down until pointer release", async () => {
  for (const key of ["ArrowUp", "x"])
    for (const pointerType of ["touch", "mouse"]) {
      const app = await setupShell();
      const button = app.byKey(key);
      button.dispatch("pointerdown", { pointerType, pointerId: 9, button: 0 });
      app.advance(2_500);
      assert.deepEqual(app.events, [["down", key]]);
      button.dispatch("pointerup", { pointerType, pointerId: 9, button: 0 });
      assert.deepEqual(app.events, [["down", key], ["up", key]]);
    }
});

test("two fingers and every cancellation path release independently", async () => {
  const app = await setupShell();
  const left = app.byKey("ArrowLeft");
  const boost = app.byKey(" ");
  left.dispatch("pointerdown", { pointerType: "touch", pointerId: 21 });
  boost.dispatch("pointerdown", { pointerType: "touch", pointerId: 22 });
  left.dispatch("pointercancel", { pointerType: "touch", pointerId: 21 });
  assert.deepEqual(app.events, [["down", "ArrowLeft"], ["down", " "], ["up", "ArrowLeft"]]);
  boost.dispatch("lostpointercapture", { pointerType: "touch", pointerId: 22 });
  assert.deepEqual(app.events.at(-1), ["up", " "]);

  left.dispatch("pointerdown", { pointerType: "touch", pointerId: 23 });
  left.dispatch("pointerup", { pointerType: "touch", pointerId: 23 }); // captured outside release
  boost.dispatch("pointerdown", { pointerType: "touch", pointerId: 24 });
  app.window.dispatch("blur");
  assert.deepEqual(app.events.slice(-4), [
    ["down", "ArrowLeft"], ["up", "ArrowLeft"], ["down", " "], ["up", " "],
  ]);
});

test("capture failure and window fallbacks cannot leave a held key behind", async () => {
  const app = await setupShell();
  const left = app.byKey("ArrowLeft");
  const boost = app.byKey(" ");

  left.captureFails = true;
  left.dispatch("pointerdown", { pointerType: "mouse", pointerId: 31, button: 0 });
  left.dispatch("pointerleave", { pointerType: "mouse", pointerId: 31, button: 0 });
  assert.deepEqual(app.events, [["down", "ArrowLeft"], ["up", "ArrowLeft"]]);

  boost.dispatch("pointerdown", { pointerType: "touch", pointerId: 32 });
  app.window.dispatch("pointerup", { pointerType: "touch", pointerId: 32 });
  left.captureFails = false;
  left.dispatch("pointerdown", { pointerType: "touch", pointerId: 33 });
  app.window.dispatch("pointercancel", { pointerType: "touch", pointerId: 33 });
  assert.deepEqual(app.events.slice(-4), [
    ["down", " "], ["up", " "], ["down", "ArrowLeft"], ["up", "ArrowLeft"],
  ]);
});
