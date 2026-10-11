/* Shared headless harness for KEYS ARE A LIE regression tests.
   Loads game.js in a stubbed DOM/canvas/WebAudio and exposes helpers. */
const path = require("path");
const fs = require("fs");

const DIR = path.resolve(__dirname, "..");

const els = {};
function makeEl(id) {
  const L = {};
  const el = {
    id, textContent: "", innerHTML: "", value: "", disabled: false, style: {}, dataset: {},
    width: 960, height: 540, _L: L,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
    },
    getContext() { return el._ctx; },
    addEventListener(t, fn) { (L[t] = L[t] || []).push(fn); },
    click() { (L["click"] || []).forEach((f) => f({ currentTarget: el, target: el, stopPropagation() {}, preventDefault() {} })); },
    blur() {}, focus() {},
  };
  const gradient = { addColorStop() {} };
  el._ctx = new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => gradient;
      if (p === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  return el;
}

const IDS = ["game", "glow", "scan", "hud", "punishCount", "coinCount", "goalbar", "goalbarfill",
  "revealBtn", "muteBtn", "manual", "slotLeft", "slotRight", "slotJump", "manualFoot",
  "toast", "start", "startBtn", "win", "winTitle", "winBody", "winStats", "againBtn",
  "hpCount", "hpBox", "phaseNum", "probeCount", "probeBox", "phaseBox", "bankedCount", "streakCount", "streakBox",
  "shopBtn", "shop", "shopList", "shopBank", "closeShop",
  "death", "deathTitle", "deathBody", "deathStats", "retryBtn",
  "codex", "codexList", "codexCount", "codexFoot", "codexBtn", "closeCodex",
  "cine", "cineName", "cineText", "cineSkip"];
IDS.forEach((id) => (els[id] = makeEl(id)));

const store = {};
const winL = {};
global.window = {
  addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); },
  AudioContext: function () {
    this.state = "running"; this.currentTime = 0; this.sampleRate = 44100;
    this.createOscillator = () => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }), start() {}, stop() {} });
    this.createGain = () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) });
    this.createBuffer = (a, n) => ({ getChannelData: () => new Float32Array(n) });
    this.createBufferSource = () => ({ buffer: null, connect: () => ({ connect() {} }), start() {} });
    this.destination = {}; this.resume = () => {};
  },
  localStorage: {
    getItem(k) { return k in store ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  },
  LEXICON_RAW: null,
};
global.document = {
  getElementById: (id) => els[id] || makeEl(id),
  createElement: () => makeEl("created"),
  activeElement: null,
};

let frames = 0, raf;
global.requestAnimationFrame = (fn) => { raf = fn; };
global.performance = { now: () => Date.now() };
global.setTimeout = () => {};

eval(fs.readFileSync(path.join(DIR, "lexicon.js"), "utf8"));
eval(fs.readFileSync(path.join(DIR, "game.js"), "utf8"));

const K = () => global.window.__KAL;
const kd = winL["keydown"][0], ku = winL["keyup"][0];

const ID2KEY = {
  space: " ", tab: "Tab", enter: "Enter", shift: "Shift", control: "Control", alt: "Alt",
  arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown",
};
function keyFor(id) {
  if (id in ID2KEY) return ID2KEY[id];
  if (id.startsWith("sym:") || id.startsWith("key:")) return id.slice(4);
  return id;
}
function ev(key) { return { key, repeat: false, preventDefault() {} }; }
function press(id) { const e = ev(keyFor(id)); kd(e); ku(e); }
function hold(id) { const e = ev(keyFor(id)); kd(e); return e; }
function release(id) { ku(ev(keyFor(id))); }
function tick(n) { for (let i = 0; i < (n || 1); i++) { frames++; if (raf) raf(frames * 16.7); } }

function skipCine() { let g = 0; while (K().state === "cine" && g++ < 80) els.cineSkip.click(); }
function startGame() { els.startBtn.click(); skipCine(); }

// soul positions (mirrors coinDefs in game.js) so the driver can jump AT them
const COIN_X = [600, 905, 1300, 1700, 2090, 2530, 2920, 1330];

// Jump the way a player now must: by CAUSING a disaster that launches you.
function bounce() {
  // Keep causing disasters until one actually launches you. Each press must be
  // spaced past FX_LOCK (0.55s) or the "one thing at a time" rule eats it.
  for (let i = 0; i < 40; i++) {
    const k = wrongKey();
    if (!k) return false;
    press(k);
    tick(36);
    if (K().player.y < 340) return true;   // left the ground
    if (K().state !== "play") return false;
  }
  return false;
}

function runTo(targetX) {
  let g = 0;
  // generous budget: hitstop eats sim frames during bounce bursts
  while (K().player.x < targetX && g++ < 60000 && K().state === "play") {
    const c = K().contract;
    if (!/^[a-z0-9]$/.test(c.right)) { K().rollContract(); continue; }
    if (!K().armed.right) press(c.right);
    hold(c.right);
    const px = K().player.x, py = K().player.y;
    if (py > 360 && COIN_X.some((cx) => cx - px > 18 && cx - px < 150)) bounce();
    tick(3); release(c.right);
  }
}

function T() {
  let p = 0, f = 0;
  const ok = (c, m) => { c ? (p++, console.log("  PASS", m)) : (f++, console.log("  FAIL", m)); };
  return {
    ok,
    done() {
      console.log(f ? `\nFAILED ${f} pass ${p}` : `\nOK: ${p} passed`);
      process.exit(f ? 1 : 0);
    },
  };
}

// a letter guaranteed NOT to be a current control key (so it always punishes)
function wrongKey() {
  const c = K().contract;
  return "qwertyuio".split("").find((k) => k !== c.left && k !== c.right && k !== "a" && k !== "d");
}

// survive by camp-punishing wrong keys until dead (deterministic-ish; camp fires
// every 1.6s regardless of the "cruel tease")
// Kill the player on purpose. NOTE: holding a key does nothing by design, so
// this must press repeatedly with gaps longer than the repeat lock.
function die(limit, skipCineToo) {
  let g = 0;
  while (K().state === "play" && g++ < (limit || 300)) {
    // Press on a timer. Launching is free and refused mid-air, but a NON-launch
    // disaster still costs HP wherever you are — and meanings cycle, so pressing
    // steadily will eventually land a costly one.
    const k = wrongKey();
    if (!k) break;
    press(k);
    tick(40);                     // > REPEAT_LOCK and > FX_LOCK
  }
  if (skipCineToo !== false && K().state === "cine") skipCine();
}

// Press wrong keys until one actually registers. The game's deliberate "cruel
// tease" means any single wrong key sometimes just works instead of firing,
// so tests that need "something happened" must be tolerant of that.
function fireOnce(maxTries) {
  const p = K().punishments;
  for (let i = 0; i < (maxTries || 8); i++) {
    tick(40);
    press(wrongKey());
    tick(4);
    if (K().punishments > p) return true;
  }
  return false;
}

Object.assign(global, {
  els, store, K, press, hold, release, tick, skipCine, startGame, runTo, keyFor, winL, T,
  wrongKey, die, COIN_X, bounce, fireOnce,
  rafRef: () => raf,
});