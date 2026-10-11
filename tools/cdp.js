/* Minimal Chrome DevTools Protocol client used by record.js. */
const http = require("http");
const { spawn } = require("child_process");

function httpJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: 9222, path }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { rej(e); }
      });
    }).on("error", rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { return await httpJSON("/json/version"); } catch (e) { await sleep(250); }
  }
  throw new Error("Chrome devtools never came up");
}

async function launchChrome(url, { port = 9222, headless = true } = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--window-size=960,600",
    "--hide-scrollbars",
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=Translate,MediaRouter",
    "--force-device-scale-factor=1",
    "--disable-features=DialMediaRouteProvider",
    "--use-mock-keychain",
  ];
  if (headless) args.unshift("--headless=new", "--disable-dev-shm-usage");
  const proc = spawn("google-chrome", [...args, url], { stdio: "ignore" });
  await waitForChrome();
  return proc;
}

async function findPageTarget() {
  const list = await httpJSON("/json/list");
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no page target");
  return page;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((f) => f(msg.params));
      }
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /* --- input helpers --- */
  async key(type, key, opts = {}) {
    const code = opts.code || key.length === 1
      ? "Key" + key.toUpperCase()
      : key;
    const isChar = key.length === 1;
    await this.send("Input.dispatchKeyEvent", {
      type,
      key,
      code: opts.code || (isChar ? "Key" + key.toUpperCase() : key),
      windowsVirtualKeyCode: opts.vk || (isChar ? key.toUpperCase().charCodeAt(0) : 0),
      nativeVirtualKeyCode: opts.vk || (isChar ? key.toUpperCase().charCodeAt(0) : 0),
      text: type === "keyDown" && isChar ? key : undefined,
    });
  }
  async tap(key, holdMs = 60) {
    await this.key("keyDown", key);
    await sleep(holdMs);
    await this.key("keyUp", key);
  }
  async evalJS(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result && r.result.value;
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return new CDP(ws);
}

module.exports = { launchChrome, findPageTarget, connect, sleep, httpJSON };