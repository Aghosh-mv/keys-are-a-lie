/* Records a genuine gameplay video of KEYS ARE A LIE by actually playing it.
 *
 * Launches Chrome, captures a real screencast via CDP, and drives the game with
 * synthetic key events — the same input path a human uses. Nothing is faked:
 * the disasters, launches, codex and endings in the video are the real game.
 *
 *   node tools/record.js [outfile.mp4] [seconds]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { launchChrome, findPageTarget, connect, sleep } = require("./cdp");

const GAME = "file://" + path.resolve(__dirname, "..", "index.html");
const OUT = process.argv[2] || path.resolve(__dirname, "..", "dist", "gameplay.mp4");
const DURATION = Number(process.argv[3] || 210);
const FRAMES = path.resolve(__dirname, "..", "dist", "frames");

const KEY_POOL = "qwertyuiopzxcvbnm234567890".split("");

let chromeProc = null;
let idx = 0;
const stamps = [];

// If we are killed mid-recording, still produce an mp4 from what we captured.
let stopped = false;
function onSignal() {
  if (stopped) process.exit(1);
  stopped = true;
  console.log("\ninterrupted — encoding captured frames anyway");
  try { chromeProc && chromeProc.kill("SIGKILL"); } catch (e) {}
  encode();
  process.exit(0);
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

function encode() {
  const dur = stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 1000 : 0;
  const n = fs.existsSync(FRAMES) ? fs.readdirSync(FRAMES).filter((f) => f.endsWith(".jpg")).length : 0;
  if (n < 10) { console.error("too few frames (" + n + ") to encode"); process.exit(1); }
  const fps = dur > 0 ? n / dur : 30;
  console.log(`captured ${n} frames over ${dur.toFixed(1)}s (~${fps.toFixed(1)} fps)`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const r = spawnSync("ffmpeg", [
    "-y", "-framerate", fps.toFixed(3), "-i", path.join(FRAMES, "f%06d.jpg"),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest", "-movflags", "+faststart", OUT,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) { console.error("ffmpeg failed: " + String(r.stderr).slice(-600)); process.exit(1); }
  console.log("wrote", OUT, fs.statSync(OUT).size + " bytes");
  fs.rmSync(FRAMES, { recursive: true, force: true });
}

(async function main() {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  chromeProc = await launchChrome(GAME);
  const target = await findPageTarget();
  const cdp = await connect(target);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await sleep(1200);

  // ---- capture --------------------------------------------------------
  cdp.on("Page.screencastFrame", async (p) => {
    try {
      if (p.data) {
        fs.writeFileSync(path.join(FRAMES, "f" + String(idx).padStart(6, "0") + ".jpg"),
          Buffer.from(p.data, "base64"));
        stamps.push(Date.now());
        idx++;
      }
      await cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId });
    } catch (e) { /* page went away */ }
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg", quality: 82, maxWidth: 960, maxHeight: 540, everyNthFrame: 1,
  });

  const t0 = Date.now();
  const log = (...a) => console.log("[" + ((Date.now() - t0) / 1000).toFixed(1) + "s]", ...a);

  const st = () => cdp.evalJS("window.__KAL ? __KAL.state : 'boot'");
  const info = () => cdp.evalJS(
    "JSON.stringify({s:__KAL.state,x:Math.round(__KAL.player.x),hp:__KAL.hp," +
    "banked:__KAL.banked,carried:__KAL.carried,codex:__KAL.codexCount,pct:Math.round(__KAL.player.x/34.3)})");
  const click = (id) => cdp.evalJS(`document.getElementById('${id}').click()`);

  // ---- the run --------------------------------------------------------
  await sleep(4500);                       // hold on the title screen
  log("title card held");

  await click("startBtn");                // -> intro cutscene
  await sleep(1200);

  // play through the intro cutscene the way a player would
  for (let i = 0; i < 40; i++) {
    if ((await st()) !== "cine") break;
    await cdp.tap(" ");
    await sleep(700);
  }
  log("intro cutscene done, state =", await st());

  await click("muteBtn");                 // stop the synth drone wrecking the capture
  await sleep(400);

  // hold D so we always move right, then hammer keys to trigger disasters
  await cdp.key("keyDown", "d");

  let lastNote = 0;
  while ((Date.now() - t0) / 1000 < DURATION) {
    const elapsed = (Date.now() - t0) / 1000;
    const s = await st();

    if (s === "cine") {                   // advance cutscenes
      await cdp.tap(" ");
      await sleep(500);
      continue;
    }
    if (s === "dead" || s === "win") {     // ending screens linger, then retry
      if (s === "dead" && elapsed > DURATION - 25) { /* let the death screen finish the video */ }
      else await click("retryBtn");
      await sleep(900);
      continue;
    }
    if (s === "menu") { await click("startBtn"); await sleep(600); continue; }

    // a random wrong key -> a disaster, which is how you jump
    const k = KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)];
    await cdp.tap(k, 70);
    await sleep(260);

    // beat on the drums: show the codex and the dealer partway through
    if (elapsed > 70 && elapsed < 76) {
      await cdp.key("keyUp", "d"); await click("codexBtn"); await sleep(2600);
      await click("closeCodex"); await cdp.key("keyDown", "d");
      log("showed the codex ->", await info());
    }
    if (elapsed > 120 && elapsed < 126) {
      await cdp.key("keyUp", "d"); await click("shopBtn"); await sleep(2600);
      await click("closeShop"); await cdp.key("keyDown", "d");
      log("showed the dealer ->", await info());
    }
    if (elapsed - lastNote > 15) { lastNote = elapsed; log(await info()); }
  }

  await cdp.key("keyUp", "d");
  await sleep(600);
  log("final ->", await info());

  await cdp.send("Page.stopScreencast");
  await sleep(400);
  chromeProc.kill("SIGKILL");
  encode();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });