/* =========================================================================
   KEYS ARE A LIE  —  game.js
   Plain canvas + JS, no dependencies. Open index.html and play.

   Core loop:
   - You must reach the portal on the right.
   - THREE secret keys move you (LEFT / RIGHT / JUMP). They are hidden and
     re-rolled every 18 seconds.
   - The Manual on screen shows which keys those are. The Manual lies.
   - Press any key that is NOT a current control key and it punishes you with
     a themed disaster based on that letter. Every letter has 20+ meanings;
     press it again and again to see them all.
   - The only way to win is to experiment and remember. Good luck.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // deterministic hash → stable per-frame noise (no flicker from Math.random)
  function h1(n) { const s = Math.sin(n * 127.1 + 3.7) * 43758.5453; return s - Math.floor(s); }

  /* --------------------------------------------------------------- canvas */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  /* ------------------------------------------------------------ constants */
  const GRAV = 2600;
  const MOVE = 340;
  const JUMP = -880;
  const LEVEL_W = 3600;
  const GROUND_Y = H - 120;      // 420
  const ROLL_MS = 18000;         // contract re-roll period at phase 1

  // --- STAKES ---------------------------------------------------------------
  // HP is damage-only (never a permanent wound). It rises by phase: the further
  // you get, the more a wrong key costs. Death is not free: souls you are
  // CARRYING are lost unless you BANKED them at a checkpoint. (loss aversion)
  const HP_MAX = 3;
  const INVULN = 0.7;            // i-frames after taking a hit (one hold ≠ insta-death)
  const PHASE_ROLL = [18000, 15000, 11000]; // re-roll period per phase (gets crueller)
  const CHECKPOINTS = [
    { x: 1400, y: GROUND_Y, reached: false },
    { x: 2400, y: GROUND_Y, reached: false },
    { x: 3200, y: GROUND_Y, reached: false },
  ];
  const META_KEY = "kal_meta_v1";

  /* -------------------------------------------------------------- DOM refs */
  const $ = (id) => document.getElementById(id);
  // additive bloom layer: draw light here, CSS blends it over the scene with `screen`
  const elGlow = $("glow");
  const g2 = elGlow.getContext("2d");
  const elPunish = $("punishCount");
  const elCoin = $("coinCount");
  const elBanked = $("bankedCount");
  const elHp = $("hpCount");
  const elPhase = $("phaseNum");
  const elStreak = $("streakCount");
  const elProbe = $("probeCount");
  const elGoalFill = $("goalbarfill");
  const elSlotL = $("slotLeft");
  const elSlotR = $("slotRight");
  const elSlotJ = $("slotJump");
  const elManual = $("manual");
  const elToast = $("toast");
  const elStart = $("start");
  const elWin = $("win");
  const elWinTitle = $("winTitle");
  const elWinBody = $("winBody");
  const elWinStats = $("winStats");
  const elDeath = $("death");
  const elDeathTitle = $("deathTitle");
  const elDeathBody = $("deathBody");
  const elDeathStats = $("deathStats");
  const elShop = $("shop");
  const elShopList = $("shopList");
  const elShopBank = $("shopBank");
  const elCodex = $("codex");
  const elCodexList = $("codexList");
  const elCodexCount = $("codexCount");
  const elCodexFoot = $("codexFoot");
  const elCine = $("cine");
  const elCineName = $("cineName");
  const elCineText = $("cineText");
  const elCineSkip = $("cineSkip");

  /* ---------------------------------------------------- persistent meta */
  // only souls you BANK survive a death. carried is at risk. cosmetics persist.
  function loadMeta() {
    const def = { banked: 0, bestStreak: 0, bestPct: 0, owned: {}, trail: 0, seenIntro: false, known: {} };
    try {
      const raw = window.localStorage && window.localStorage.getItem(META_KEY);
      if (!raw) return def;
      const m = JSON.parse(raw);
      return Object.assign(def, m);
    } catch (e) { return def; }
  }
  function saveMeta() {
    try {
      if (window.localStorage) window.localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) { /* private mode etc. — game still runs */ }
  }

  /* --------------------------------------------------------------- state  */
  let state = "menu";            // menu | play | cine | shop | dead | win
  let now = 0;                   // seconds, engine time
  let lastT = 0;
  let punishments = 0;
  let coins = 0;                 // souls CARRIED this run (at risk)
  let carried = 0;               // == coins, named for clarity in stakes code
  const meta = loadMeta();       // banked souls + records (persist across deaths)
  let streak = 0;                // checkpoints reached this run without dying
  let lastCP = -1;               // index of last checkpoint banked (-1 = start)
  let probes = 3;                // CAREFUL tests — scarce, and the only real information
  const PROBE_MAX = 5;
  const STRAIN_MAX = 4;          // launches before you start paying for them
  const REPEAT_LOCK = 0.45;      // seconds before the SAME key can fire again
  const FX_LOCK = 0.55;          // only one disaster may be in flight at a time
  const lastFire = {};           // id -> when it last fired
  let fxLockUntil = -1;

  const held = new Set();        // currently held key ids
  const heldSince = {};          // id -> when it was (re)armed
  // a control key only moves you if you PRESSED it after the current re-roll.
  // (kills the "hold one key and wait for it to become a control key" exploit)
  const armed = { left: false, right: false, jump: false };
  let jumpBuffer = 0;

  // contract = the REAL control keys ; lies = what the manual claims
  let contract = { left: "q", right: "p", jump: "m" };
  let lies = { left: "a", right: "d", jump: " " };
  let rollTimer = 0;
  let revealUntil = -1;
  let leakUntil = -1;
  let leakId = null;

  // player
  const player = { x: 80, y: GROUND_Y - 52, w: 44, h: 52, vx: 0, vy: 0, onGround: false, face: 1, coyote: 0, py: 0, landT: 0, hurt: 0, wasGround: false, dazed: 0, hp: HP_MAX, maxHp: HP_MAX, invuln: 0, flyT: 0, strain: 0 };
  let camCur = 80 - W * 0.38;    // smoothed camera x (follows player lazily)

  // screen effects
  const scr = { shake: 0, flash: 0, dark: 0, invert: 0, tint: null, tintA: 0, spin: 0, spinV: 0, hitstop: 0 };
  let freezeUntil = -1;
  let xaxisUntil = -1;
  let pullUntil = -1;
  const pullPt = { x: 0, y: 0 };

  const particles = [];          // world-space emoji bits
  const bolts = [];              // lightning path segments
  const trail = [];              // cosmetic trail (unlockable)
  let water = { on: false, y: GROUND_Y + 400, target: GROUND_Y + 400, vel: 0 };

  /* ---------------------------------------------------------------- level */
  const platforms = [
    { x: 0, y: GROUND_Y, w: LEVEL_W, h: 200 },
    { x: 520, y: 300, w: 190, h: 24 },
    { x: 850, y: 214, w: 190, h: 24 },
    { x: 1230, y: 320, w: 210, h: 24 },
    { x: 1640, y: 236, w: 190, h: 24, crumble: true },
    { x: 2020, y: 330, w: 230, h: 24 },
    { x: 2470, y: 248, w: 190, h: 24, crumble: true },
    { x: 2860, y: 322, w: 210, h: 24 },
  ];
  // the world fights back: spike strips live only in the late (high-stakes) phases
  const HAZARDS = [
    { x: 1280, w: 78 }, { x: 1780, w: 86 }, { x: 2160, w: 74 },
    { x: 2620, w: 92 }, { x: 3060, w: 80 }, { x: 3320, w: 96 },
  ].map((h) => Object.assign(h, { y: GROUND_Y - 15, h: 15 }));
  const coinDefs = [
    [600, 262], [905, 176], [1300, 282], [1700, 198],
    [2090, 292], [2530, 210], [2920, 284], [1330, 260],
  ];
  const coinList = coinDefs.map(([x, y]) => ({ x, y, r: 15, got: false, bob: rand(0, 6.28) }));

  const GOAL = { x: LEVEL_W - 170, y: GROUND_Y - 170, w: 56, h: 170 };

  /* --------------------------------------------------------------- audio  */
  let actx = null;
  let muted = false;
  function initAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }
  function tone(freq, dur, type, vol, slideTo) {
    if (!actx || muted) return;
    const t0 = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.07, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol) {
    if (!actx || muted) return;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = actx.createBufferSource(); s.buffer = buf;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol || 0.12, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    s.connect(g).connect(actx.destination); s.start();
  }
  function sfx(type) {
    switch (type) {
      case "boom": noise(0.35, 0.18); tone(70, 0.4, "sawtooth", 0.14, 30); break;
      case "lightning": noise(0.18, 0.16); tone(1400, 0.18, "square", 0.09, 300); break;
      case "flash": tone(1200, 0.14, "square", 0.08, 2000); break;
      case "fire": noise(0.3, 0.08); tone(180, 0.3, "sawtooth", 0.05, 90); break;
      case "freeze": tone(900, 0.4, "sine", 0.09, 180); break;
      case "blackout": tone(120, 0.5, "sine", 0.08, 60); break;
      case "spin": tone(400, 0.5, "sine", 0.08, 900); break;
      case "invert": tone(300, 0.2, "triangle", 0.08, 600); break;
      case "pull": tone(200, 0.4, "sawtooth", 0.08, 800); break;
      case "teleport": noise(0.1, 0.1); tone(1800, 0.14, "square", 0.08, 400); break;
      case "giant": tone(60, 0.5, "sawtooth", 0.12, 40); noise(0.2, 0.1); break;
      case "jump": tone(700, 0.16, "square", 0.08, 1500); break;
      default: tone(rand(300, 700), 0.12, "square", 0.06); noise(0.05, 0.05);
    }
  }

  /* ------------------------------------------------------------- lexicon  */
  const LEX = {};
  (function parseLex() {
    const src = window.LEXICON_RAW || {};
    for (const id in src) {
      LEX[id] = String(src[id]).split(";").map((s) => {
        const parts = s.split("|");
        return { word: (parts[0] || "?").trim(), emoji: (parts[1] || "❓").trim(), type: (parts[2] || "confuse").trim() };
      });
    }
  })();
  const FALLBACK = [
    { word: "mystery", emoji: "❓", type: "confuse" },
    { word: "nothing", emoji: "🌑", type: "blackout" },
    { word: "rocks", emoji: "🪨", type: "rain" },
    { word: "chaos", emoji: "🌀", type: "spin" },
    { word: "an explosion", emoji: "💥", type: "boom" },
  ];
  const lexFor = (id) => LEX[id] || FALLBACK;

  // per-key shuffled meaning pointer so all meanings appear before repeating
  const mOrder = {};
  const mPtr = {};
  function nextMeaning(id) {
    const list = lexFor(id);
    if (!mOrder[id] || mOrder[id].length !== list.length) {
      mOrder[id] = shuffle([...Array(list.length).keys()]);
      mPtr[id] = 0;
    }
    const idx = mOrder[id][mPtr[id]];
    mPtr[id] = (mPtr[id] + 1) % mOrder[id].length;
    return list[idx];
  }

  /* -------------------------------------------------------------- keymap  */
  const LETTER_KEYS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
  const SPECIAL_KEYS = ["space", "tab", "enter", "shift", "control", "alt"];
  const ARROW_KEYS = ["arrowleft", "arrowright", "arrowup", "arrowdown"];
  const MOUSE_KEYS = ["mouse-left", "mouse-right", "mouse-middle"];
  const ALL_KEYS = LETTER_KEYS.concat(SPECIAL_KEYS, ARROW_KEYS, MOUSE_KEYS);
  // a and d are EXCLUDED from control pool (the whole joke: you assume ad)
  // a and d are EXCLUDED (the joke: you assume ad). SHIFT is excluded too —
// it is the CAREFUL modifier and must never be a control itself.
  const CONTROL_POOL = LETTER_KEYS.concat(SPECIAL_KEYS, MOUSE_KEYS)
    .filter((k) => k !== "a" && k !== "d" && k !== "shift");

  function keyId(e) {
    const k = e.key;
    if (k === " ") return "space";
    if (k === "Shift") return "shift";
    if (k === "Control") return "control";
    if (k === "Alt") return "alt";
    if (k === "Tab") return "tab";
    if (k === "Enter") return "enter";
    if (k === "Escape") return "key:Escape";
    if (k === "ArrowLeft") return "arrowleft";
    if (k === "ArrowRight") return "arrowright";
    if (k === "ArrowUp") return "arrowup";
    if (k === "ArrowDown") return "arrowdown";
    if (k.length === 1) {
      const l = k.toLowerCase();
      if (/[a-z0-9]/.test(l)) return l;
      return "sym:" + k;
    }
    return "key:" + k;
  }
  const LABELS = {
    space: "SPACE", tab: "TAB", enter: "ENTER", shift: "SHIFT", control: "CTRL", alt: "ALT",
    arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓",
    "mouse-left": "LMB", "mouse-right": "RMB", "mouse-middle": "MMB",
  };
  function keyLabel(id) {
    if (LABELS[id]) return LABELS[id];
    if (id.startsWith("sym:")) return id.slice(4);
    if (id.startsWith("key:")) return id.slice(4);
    return id.toUpperCase();
  }

  /* ------------------------------------------------------------ contract  */
  function rollContract() {
    let left, right;
    if (Math.random() < 0.07) {
      // the "blessed" classic rig — rarely, the obvious keys really do work
      left = "a"; right = "d";
    } else {
      const pool = shuffle(CONTROL_POOL.slice());
      left = pool[0]; right = pool[1];
    }
    // THERE IS NO JUMP KEY. The manual's third slot is always a lie — and
    // being punished is how you get off the ground.
    const jump = choice(ALL_KEYS.filter((k) => k !== left && k !== right));
    contract = { left, right, jump: null, jumpLie: jump };
    const liePool = shuffle(ALL_KEYS.filter((k) => k !== left && k !== right));
    lies = { left: liePool[0], right: liePool[1], jump: liePool[2] };
    leakId = choice(["left", "right", "jump"]);
    leakUntil = now + 0.7;
    rollTimer = rerollMs() / 1000;
    // a newly-rolled control key must be PRESSED again to work: a key you were
    // already holding does not carry over. (anti-exploit)
    armed.left = armed.right = armed.jump = false;
    elManual.classList.add("glitch");
    tone(200, 0.08, "square", 0.05);
    setTimeout(() => tone(300, 0.08, "square", 0.05), 90);
  }

  function refreshManual() {
    const rev = now < revealUntil;
    const show = rev ? contract : lies;
    let l = keyLabel(show.left), r = keyLabel(show.right);
    if (!rev && now < leakUntil && leakId) {
      if (leakId === "left") l = keyLabel(contract.left);
      if (leakId === "right") r = keyLabel(contract.right);
    }
    if (elSlotL.textContent !== l) elSlotL.textContent = l;
    if (elSlotR.textContent !== r) elSlotR.textContent = r;
    // JUMP is not a command in this game. It never was.
    if (elSlotJ.textContent !== "NONE") elSlotJ.textContent = "NONE";
    elManual.classList.toggle("reveal", rev);
    elManual.classList.toggle("glitch", now < leakUntil);
  }

  /* --------------------------------------------------------------- toast  */
  let toastUntil = -1;
  function showToast(text, secs) {
    elToast.textContent = text;
    elToast.classList.add("show");
    toastUntil = now + (secs || 1.6);
  }

  /* -------------------------------------------------------------- stakes  */
  // phase 0/1/2 by progress. early = safe (learn), late = expensive (tension).
  function phaseIndex() {
    const f = player.x / GOAL.x;
    return f < 0.34 ? 0 : f < 0.67 ? 1 : 2;
  }
  function damageForPhase() { return [0, 1, 1][phaseIndex()]; } // HP lost per wrong key
  function rerollMs() { return PHASE_ROLL[phaseIndex()]; }

  function updateHud() {
    elPunish.textContent = punishments;
    elCoin.textContent = coins;
    elBanked.textContent = "(" + meta.banked + " banked)";
    elHp.textContent = "\u2764".repeat(player.hp) + "\u2661".repeat(Math.max(0, player.maxHp - player.hp));
    elPhase.textContent = phaseIndex() + 1;
    elStreak.textContent = streak;
    if (elProbe) elProbe.textContent = probes;
  }

  // bank carried souls into the persistent pile (safe forever) + heal a little
  function bankSouls(cpIndex) {
    if (carried > 0) {
      meta.banked += carried;
      showToast("\uD83D\uDCB0 BANKED " + carried + " SOULS \u2014 SAFE NOW", 1.9);
      carried = 0; coins = 0;
    } else {
      showToast("\uD83D\uDEA9 CHECKPOINT " + (cpIndex + 1) + "/" + CHECKPOINTS.length, 1.6);
    }
    player.hp = Math.min(player.maxHp, player.hp + 1);
    probes = Math.min(PROBE_MAX, probes + 1);
    lastCP = cpIndex;
    streak++;
    if (streak > meta.bestStreak) meta.bestStreak = streak;
    saveMeta();
    tone(760, 0.1, "square", 0.06, 1040);
    setTimeout(() => tone(1040, 0.14, "square", 0.06, 1320), 110);
    updateHud();
  }

  // one place HP is spent, so i-frames, death and HUD stay consistent
  function hurt(n, why) {
    if (player.invuln > 0 || state !== "play") return false;
    player.hp -= n;
    player.invuln = INVULN;
    player.hurt = 0.35;
    updateHud();
    if (player.hp <= 0) { die(why); return true; }
    return false;
  }

  // the run ends here. carried souls are LOST (loss aversion); banked persist.
  function die(reason) {
    if (state !== "play") return;
    state = "dead";
    const pct = clamp((player.x / GOAL.x) * 100, 0, 100);
    const lost = carried;
    // THE STAKES: un-banked souls are GONE. Only what you banked survives.
    carried = 0; coins = 0;
    updateHud();
    if (pct > meta.bestPct) meta.bestPct = pct;
    saveMeta();
    streak = 0;
    scr.flash = 0.6; scr.shake = Math.min(scr.shake + 26, 40);
    tone(160, 0.5, "sawtooth", 0.09, 60);
    const near = pct >= 80 ? "SO CLOSE." : pct >= 50 ? "SO CLOSE." : "";
    const msgs = [
      "It watched you the whole way.",
      "You were never supposed to solve it.",
      "The keys changed. You didn't.",
      "It would have kept going.",
    ];
    elDeathTitle.textContent = near ? near + " " + Math.round(pct) + "%" : "CAUGHT";
    elDeathBody.textContent = reason || choice(msgs);
    elDeathStats.textContent =
      "lost " + lost + " carried soul" + (lost === 1 ? "" : "s") +
      "  ·  " + meta.banked + " banked kept" +
      "  ·  reached " + Math.round(pct) + "%" +
      "  ·  best " + Math.round(meta.bestPct) + "%";
    playCine(CINE_DEATH, () => { state = "dead"; elDeath.classList.remove("hidden"); });
  }

  // deliberate restart from the last checkpoint (NOT an accidental instant retry)
  function respawn() {
    state = "play";
    elDeath.classList.add("hidden");
    const cp = lastCP >= 0 ? CHECKPOINTS[lastCP] : null;
    player.x = cp ? cp.x : 80;
    player.y = GROUND_Y - player.h;
    player.vx = 0; player.vy = 0; player.onGround = false;
    player.hp = player.maxHp; player.invuln = 0; player.hurt = 0; player.dazed = 0; player.flyT = 0; player.strain = 0;
    camCur = clamp(player.x - W * 0.38, 0, LEVEL_W - W);
    scr.shake = 0; scr.flash = 0;
    freezeUntil = -1; xaxisUntil = -1; pullUntil = -1;
    // NOTE: souls already collected stay collected. They were LOST on death —
    // they must not be re-pickupable, or dying repeatedly would farm souls.
    rollContract();
    updateHud();
    showToast("AGAIN. FIND THE KEYS.", 1.8);
  }

  /* ------------------------------------------------------------- effects  */
  function spawnParticle(o) {
    particles.push(Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, life: 2, max: 2, emoji: "❓", size: 34,
      rot: rand(-0.3, 0.3), vr: rand(-3, 3), grav: 900, homing: 0, drag: 0,
    }, o));
  }

  function runEffect(type, emoji, word, id) {
    scr.shake = Math.min(scr.shake + 6, 22);
    // disasters that are real actors rather than particle showers
    if (type === "dino" || type === "wings" || type === "slap" || type === "tornado") {
      spawnEntity(type, emoji, word);
      if (type === "dino") { scr.shake = Math.min(scr.shake + 10, 26); tone(90, 0.4, "sawtooth", 0.07, 60); }
      if (type === "wings") tone(520, 0.3, "triangle", 0.05, 900);
      if (type === "slap") tone(160, 0.14, "square", 0.08, 70);
      if (type === "tornado") tone(300, 0.5, "sawtooth", 0.05, 700);
    }
    switch (type) {
      case "rain": fxRain(emoji); break;
      case "swarm": fxSwarm(emoji); break;
      case "flood": fxFlood(emoji); break;
      case "shake": fxShake(); break;
      case "freeze": fxFreeze(emoji); break;
      case "blackout": fxBlackout(); break;
      case "fire": fxFire(emoji); break;
      case "lightning": fxLightning(emoji); break;
      case "jump": fxJumpscare(emoji); break;
      case "giant": fxGiant(emoji); break;
      case "spin": fxSpin(); break;
      case "invert": fxInvert(emoji); break;
      case "pull": fxPull(); break;
      case "boom": fxBoom(emoji); break;
      case "flash": fxFlash(); break;
      case "confuse": fxConfuse(emoji); break;
      case "xaxis": fxXAxis(); break;
      case "teleport": fxTeleport(); break;
      // actors draw and animate themselves; no particle shower needed
      case "dino": case "wings": case "slap": case "tornado": break;
      default: fxFlash();
    }
    sfx(type);
  }

  function fxRain(emoji) {
    for (let i = 0; i < 16; i++) {
      spawnParticle({
        x: camX() - 60 + rand(0, W + 120), y: rand(-260, -40),
        vx: rand(-30, 30), vy: rand(120, 320), grav: 700,
        emoji: emoji, size: rand(26, 44), life: rand(2.5, 4), max: 4,
      });
    }
  }
  function fxSwarm(emoji) {
    for (let i = 0; i < 10; i++) {
      const a = rand(0, 6.283), d = rand(160, 320);
      spawnParticle({
        x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d - 40,
        vx: 0, vy: 0, grav: 0, homing: 1, emoji: emoji,
        size: rand(26, 38), life: rand(4, 6), max: 6, drag: 1.6,
      });
    }
    pushPlayer(choice([-1, 1]) * 120, -160);
  }
  function fxFlood(emoji) {
    water.on = true;
    water.y = GROUND_Y + 260;
    water.target = GROUND_Y - rand(70, 150);
    water.vel = 0;
    for (let i = 0; i < 8; i++) spawnParticle({
      x: camX() + rand(0, W), y: GROUND_Y - 20, vx: rand(-40, 40), vy: rand(-360, -160),
      grav: 600, emoji: "💧", size: rand(18, 30), life: 1.6, max: 1.6,
    });
  }
  function fxShake() { scr.shake = 26; }
  function fxFreeze(emoji) {
    freezeUntil = now + 1.4;
    for (let i = 0; i < 12; i++) spawnParticle({
      x: player.x + rand(-40, 40), y: player.y + rand(-20, 40),
      vx: rand(-60, 60), vy: rand(-120, 40), grav: 400,
      emoji: emoji || "❄️", size: rand(16, 30), life: 1.4, max: 1.4,
    });
  }
  function fxBlackout() { scr.dark = 1; }
  function fxFire(emoji) {
    scr.tint = "#ff6a00"; scr.tintA = 0.35;
    for (let i = 0; i < 16; i++) spawnParticle({
      x: player.x + rand(-90, 90), y: GROUND_Y - 10,
      vx: rand(-40, 40), vy: rand(-320, -140), grav: -120,
      emoji: emoji || "🔥", size: rand(22, 40), life: rand(1.2, 2), max: 2,
    });
    pushPlayer(0, -420);
  }
  function fxLightning(emoji) {
    const n = randInt(2, 3);
    for (let i = 0; i < n; i++) {
      const bx = camX() + rand(60, W - 60) + (i === 0 ? (player.x - camX() - W / 2) * 0.5 : 0);
      const seg = [];
      let x = bx, y = -20;
      for (let s = 0; s < 10; s++) { seg.push([x, y]); x += rand(-28, 28); y += (GROUND_Y + 40) / 10; }
      seg.push([bx + rand(-40, 40), GROUND_Y]);
      bolts.push({ pts: seg, life: 0.35, max: 0.35 });
    }
    scr.flash = 0.9;
    scr.shake = 24;
    pushPlayer(choice([-1, 1]) * 160, -260);
  }
  function fxJumpscare(emoji) {
    scr.flash = 0.5;
    scr.shake = 18;
    spawnParticle({ x: player.x, y: player.y - 30, vx: 0, vy: 0, grav: 0, emoji: emoji || "😱", size: 220, life: 0.5, max: 0.5, drag: 0 });
    if (player.onGround || player.coyote > 0) { player.vy = JUMP; player.onGround = false; }
  }
  function fxGiant(emoji) {
    const gx = clamp(player.x + rand(-200, 200), camX() + 100, camX() + W - 100);
    spawnParticle({ x: gx, y: -180, vx: 0, vy: 900, grav: 0, emoji: emoji || "🦶", size: 260, life: 3, max: 3, drag: 0, vr: 0, rot: 0 });
    setTimeout(() => { scr.shake = 30; noise(0.3, 0.16); tone(50, 0.5, "sawtooth", 0.12, 30); }, 380);
  }
  function fxSpin() { scr.spinV = choice([-1, 1]) * 14; }
  function fxInvert(emoji) {
    scr.invert = 1.6;
    canvas.style.filter = "invert(1) hue-rotate(180deg)";
    // also swap your left/right for the duration (chaos)
    if (contract.left && contract.right) {
      const t = contract.left; contract.left = contract.right; contract.right = t;
    }
  }
  function fxPull() {
    pullUntil = now + 1.3;
    pullPt.x = player.x + rand(-120, 120);
    pullPt.y = player.y + 140;
  }
  function fxBoom(emoji) {
    for (let i = 0; i < 22; i++) {
      const a = rand(0, 6.283), s = rand(180, 520);
      spawnParticle({
        x: player.x + player.w / 2, y: player.y + player.h / 2,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 700,
        emoji: Math.random() < 0.5 ? (emoji || "💥") : "💥",
        size: rand(20, 44), life: rand(0.8, 1.6), max: 1.6,
      });
    }
    scr.flash = 0.7; scr.shake = 26;
    pushPlayer(choice([-1, 1]) * 320, -520);
  }
  function fxFlash() { scr.flash = 1; }
  function fxConfuse(emoji) {
    // re-lie the manual and jitter the world
    const liePool = shuffle(ALL_KEYS.filter((k) => k !== contract.left && k !== contract.right && k !== contract.jump));
    lies = { left: liePool[0], right: liePool[1], jump: liePool[2] };
    scr.shake = 16;
    for (let i = 0; i < 8; i++) spawnParticle({
      x: player.x + rand(-120, 120), y: player.y + rand(-120, 40),
      vx: rand(-80, 80), vy: rand(-80, 80), grav: 0, emoji: "❓", size: rand(20, 40), life: 1.4, max: 1.4, drag: 1.2,
    });
  }
  function fxXAxis() {
    xaxisUntil = now + 3;
    scr.flash = 0.4;
    spawnParticle({ x: player.x, y: player.y, vx: 0, vy: 0, grav: 0, emoji: "🔀", size: 160, life: 0.6, max: 0.6 });
    showToast("NOW PLAY IN X-AXIS", 2.2);
  }
  function fxTeleport() {
    scr.flash = 0.5;
    const nx = clamp(player.x + rand(-260, 460), 40, LEVEL_W - 120);
    for (let i = 0; i < 10; i++) spawnParticle({
      x: player.x, y: player.y + rand(-20, 40), vx: rand(-120, 120), vy: rand(-120, 120),
      grav: 0, emoji: "✨", size: rand(16, 30), life: 0.8, max: 0.8, drag: 2,
    });
    player.x = nx; player.vy = 0;
  }

  function pushPlayer(vx, vy) { player.vx += vx; if (vy) { player.vy = Math.min(player.vy, 0) + vy; player.onGround = false; } }

  /* -------------------------------------------------------------- events  */
  function camX() { return camCur; }

  /* --------------------------------------------------- disaster movement */
  // THE CENTRAL INVERSION: there is no jump key. Being punished is how you get
  // off the ground — a flood lifts you, a dinosaur throws you, chaos flips the
  // world and you fall upward. Each disaster is a movement verb.
  const LAUNCH = {
    flood:     { vy: -1220, txt: "the flood LIFTS you" },
    boom:      { vy: -1260, txt: "the blast THROWS you" },
    lightning: { vy: -1120, txt: "the lightning THROWS you" },
    fire:      { vy: -1000, txt: "the fire BLOWS you up" },
    spin:      { vy: -1060, txt: "the spin WHIPS you up" },
    tornado:   { vy: -1180, txt: "the tornado CARRIES you up" },
    dino:      { vy: -1340, txt: "the dinosaur THREW you" },
    slap:      { vy: -920, vx: 540, txt: "the hand SLAPPED you" },
    wings:     { vy: -720, fly: 1.5, txt: "the wings GIVE YOU FLIGHT" },
    giant:     { vy: -880, txt: "the giant FLATTENS you upward" },
    jump:      { vy: -900, txt: "you LEAP" },
    quake:     { vy: -780, txt: "the quake HURTS you upward" },
    shock:     { vy: -1080, txt: "the shock KICKS you up" },
    invert:    { vy: -700, txt: "the world INVERTS — you fall up" },
    pull:      { vy: -640, txt: "the pull RIPS you off the ground" },
    rain:      { vy: -700, txt: "the downpour DROPS you upward" },
  };

  function disasterMove(type, word) {
    const L = LAUNCH[type];
    if (!L) return false;
    const grounded = player.onGround || player.coyote > 0;
    // being hit in mid-air still nudges you, but disasters only really LIFT from
    // the ground — that keeps aiming and landing a skill instead of a free flight
    if (!grounded && Math.abs(player.vy) > 260) return false;
    player.vy = Math.min(player.vy, 0) + L.vy;
    player.onGround = false;
    player.coyote = 0;
    if (L.vx) player.vx = Math.sign(player.vx || 1) * L.vx;
    if (L.fly) player.flyT = L.fly;                 // wings = a second of real air time
    if (!grounded) player.vx *= 1.15;
    // STRAIN: launching is free, but doing it constantly is not. Without this,
    // spamming a lifting key would make you untouchable and the stakes vanish.
    player.strain += 1;
    if (player.strain >= STRAIN_MAX) {
      player.strain = 0;
      const sd = damageForPhase();
      if (sd > 0) hurt(sd, "You threw yourself around until something broke.");
      else showToast("OUT OF BREATH", 0.9);
    }
    // hitstop + punch so a launch reads as an IMPACT, not a state change
    scr.hitstop = 0.055;
    scr.shake = Math.min(scr.shake + 9, 30);
    scr.flash = Math.max(scr.flash, 0.22);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.28;
      spawnParticle({
        x: player.x + player.w / 2, y: player.y + player.h,
        vx: Math.cos(a) * rand(90, 260), vy: Math.sin(a) * rand(60, 190) - 60,
        grav: 700, emoji: "💨", size: rand(12, 24), life: 0.45, max: 0.45,
      });
    }
    tone(520, 0.12, "square", 0.05, 980);
    // KNOWLEDGE PERSISTS. The first time a word is learned to lift you, it is
    // written into the Codex forever and pays a bonus — so no run is ever wasted.
    if (word && !meta.known[word]) {
      meta.known[word] = { t: type, v: L.txt };
      meta.banked += 1;
      saveMeta();
      showToast("\uD83D\uDCD6 NEW CODEX ENTRY: " + word.toUpperCase() + "  (+1 soul)", 2.4);
      tone(1320, 0.1, "square", 0.07, 1760);
      setTimeout(() => tone(1760, 0.16, "square", 0.06, 2200), 110);
    }
    return true;
  }

  function handlePunish(id, stacks) {
    fxLockUntil = now + FX_LOCK;      // nothing else may fire until this one finishes
    const m = nextMeaning(id);
    punishments++;
    elPunish.textContent = punishments;
    const tag = stacks > 1 ? "  (×" + stacks + " HELD)" : "";
    showToast(m.emoji + "  " + keyLabel(id) + " stands for " + m.word.toUpperCase() + "!" + tag, 1.7);
    // if this disaster can move you, it does — being punished IS the transport
    const L = LAUNCH[m.type];
    const lifted = disasterMove(m.type, m.word);
    if (lifted && L) showToast(L.txt + "  —  " + m.word.toUpperCase(), 1.7);
    player.hurt = 0.35;               // the character flinches — a real cost, not just an animation
    player.dazed = Math.max(player.dazed, stacks > 1 ? 1.1 : 0.5);
    // STAKES: wrong keys cost HP once you're past the safe opening phase — but a
// disaster that actually LAUNCHED you is your transport, not a wound. You pay
// for the ones that hurt you without moving you.
    const dmg = lifted ? 0 : damageForPhase();
    if (dmg > 0) hurt(dmg, null);
    runEffect(m.type, m.emoji, m.word, id);
  }

  function onPressKey(id) {
    if (state !== "play") return;
    if (id === "shift") return;               // SHIFT is only ever a modifier

    // CAREFUL PROBE — hold SHIFT and press a key to TEST it safely.
    // Costs a probe, tells the truth, and never punishes. This is how you
    // actually solve the game instead of guessing: the contract re-rolls, so
    // knowledge expires and probes are scarce.
    if (held.has("shift")) {
      if (probes > 0) {
        if (now < fxLockUntil || now - (lastFire[id] || -99) < REPEAT_LOCK) return;
        lastFire[id] = now;
        probes--; updateHud();
        const role = id === contract.left ? "LEFT" : id === contract.right ? "RIGHT" : null;
        if (role) {
          showToast("✓ " + keyLabel(id) + " really is " + role, 1.5);
          armIfControl(id);
          tone(880, 0.09, "square", 0.06, 1320);
        } else {
          showToast("✗ " + keyLabel(id) + " is nothing at all", 1.3);
          tone(200, 0.1, "square", 0.05, 150);
        }
        return;
      }
      // out of probes: CAREFUL stops protecting you, so it can never become a
      // free "no damage" button.
      showToast("NO PROBES LEFT — CAREFUL DOES NOTHING", 1.4);
    }

    if (isControl(id)) {
      // A/D and the real contract keys are never punished
      return;
    }

    // ONE THING AT A TIME, AND REPEATS DO NOTHING.
    // Mashing or holding a key must not spray disasters, and a fresh
    // disaster must not stack on top of one still playing out.
    if (now < fxLockUntil) return;
    if (now - (lastFire[id] || -99) < REPEAT_LOCK) return;
    lastFire[id] = now;

    // does a lying manual key occasionally just work? (the cruel tease)
    let work = false, dir = 0;
    if (id === lies.left && Math.random() < 0.13) { work = true; dir = -1; }
    else if (id === lies.right && Math.random() < 0.13) { work = true; dir = 1; }
    else if (id === lies.jump && Math.random() < 0.13) { work = true; dir = 2; }
    else if (Math.random() < 0.05) { work = true; dir = choice([-1, 1, 2]); }

    if (work) {
      if (dir === -1) player.vx = -MOVE * 1.4;
      else if (dir === 1) player.vx = MOVE * 1.4;
      else if (dir === 2 && (player.onGround || player.coyote > 0)) { player.vy = JUMP; player.onGround = false; }
      else player.x = clamp(player.x + rand(-30, 30), 0, LEVEL_W - player.w);
      showToast("...?", 0.7);
      return;
    }
    handlePunish(id);
  }

  // Anti-exploit: a key only counts as a control key if it was PRESSED while it
  // was already that control. Holding a key across a contract re-roll does NOT
  // silently hand you control — you must let go and press it again.
  // A and D ALWAYS move you, in the air as well as on the ground. The secret
  // contract keys are EXTRA movers on top of that — so the game is never
  // unplayable because a roll hid something obtuse, but you still gain from
  // discovering the hidden keys.
  function movesLeft(id) { return id === contract.left || id === "a"; }
  function movesRight(id) { return id === contract.right || id === "d"; }
  function isControl(id) { return movesLeft(id) || movesRight(id); }

  function armIfControl(id) {
    if (movesLeft(id)) armed.left = true;
    else if (movesRight(id)) armed.right = true;
  }
  function disarmIfControl(id) {
    if (movesLeft(id)) armed.left = false;
    else if (movesRight(id)) armed.right = false;
  }

  window.addEventListener("keydown", (e) => {
    // any key advances (or completes) the current cutscene line
    if (cine.on) { if (!e.repeat) advanceCine(); return; }
    if (state !== "play") { if (e.key === " " && state === "menu") { /* no-op */ } return; }
    if (["Tab", " ", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
    const id = keyId(e);
    if (e.repeat) { held.add(id); return; }
    held.add(id);
    heldSince[id] = now;
    armIfControl(id);
    onPressKey(id);
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    const id = keyId(e);
    held.delete(id);
    delete heldSince[id];
    disarmIfControl(id);
  });
  window.addEventListener("blur", () => {
    held.clear();
    armed.left = armed.right = armed.jump = false;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    if (state !== "play") return;
    const id = e.button === 0 ? "mouse-left" : e.button === 2 ? "mouse-right" : "mouse-middle";
    held.add(id);
    heldSince[id] = now;
    armIfControl(id);
    onPressKey(id);
  });
  window.addEventListener("mouseup", (e) => {
    const id = e.button === 0 ? "mouse-left" : e.button === 2 ? "mouse-right" : "mouse-middle";
    held.delete(id);
    delete heldSince[id];
    disarmIfControl(id);
  });

  /* --------------------------------------------------------------- update */
  function update(dt) {
    // hitstop freezes the sim briefly so heavy impacts land
    if (scr.hitstop > 0) { scr.hitstop -= dt; return; }
    now += dt;

    // contract re-roll
    if (state === "play") {
      rollTimer -= dt;
      if (rollTimer <= 0) rollContract();
    }
    refreshManual();

    // toast fade
    if (elToast.classList.contains("show") && now > toastUntil) elToast.classList.remove("show");

    // cutscene plays with the game paused
    if (cine.on) updateCine(dt);

    // screen effect decay
    scr.shake *= Math.pow(0.0025, dt); if (scr.shake < 0.05) scr.shake = 0;
    scr.flash = Math.max(0, scr.flash - dt * 2.2);
    scr.dark = Math.max(0, scr.dark - dt * 0.8);
    scr.tintA *= Math.pow(0.02, dt);
    if (scr.invert > 0) { scr.invert -= dt; if (scr.invert <= 0) canvas.style.filter = ""; }
    scr.spin += scr.spinV * dt; scr.spinV *= Math.pow(0.02, dt);
    if (Math.abs(scr.spinV) < 0.01 && Math.abs(scr.spin) > 0.001) { scr.spin *= Math.pow(0.15, dt); }

    if (state !== "play") return;

    // holding a key does NOTHING further — the repeat lock handles that

    // water
    if (water.on) {
      water.y += (water.target - water.y) * Math.min(1, dt * 2.4);
      if (Math.abs(water.y - water.target) < 6) water.target = GROUND_Y + 400; // recede
      if (water.y > GROUND_Y + 380 && water.target === GROUND_Y + 400) water.on = false;
      if (player.y + player.h > water.y) {
        player.vy = Math.min(player.vy, -180);
        player.onGround = false;
      }
    }

    // player control
    const frozen = now < freezeUntil;
    const xaxis = now < xaxisUntil;
    let dir = 0;
    if (!frozen) {
      if (armed.left && held.has(contract.left)) dir -= 1;
      if (armed.right && held.has(contract.right)) dir += 1;
      // A and D always move you — on the ground and in mid-air
      if (held.has("a")) dir -= 1;
      if (held.has("d")) dir += 1;
    }
    const targetVx = dir * MOVE;
    player.vx += (targetVx - player.vx) * Math.min(1, dt * 16);

    // jump (buffered; only a key you actually pressed while it was the jump key)
    jumpBuffer -= dt;

    // gravity / pull / xaxis  (wings = brief real lift, not a normal arc)
    if (xaxis) {
      player.vy *= Math.pow(0.02, dt);
    } else if (player.flyT > 0) {
      player.flyT -= dt;
      player.vy += GRAV * 0.18 * dt;      // floaty, and you can steer while up there
    } else {
      player.vy += GRAV * dt;
    }
    if (now < pullUntil) {
      const ax = (pullPt.x - player.x) * 6, ay = (pullPt.y - player.y) * 6;
      player.vx += clamp(ax, -900, 900) * dt;
      player.vy += clamp(ay, -900, 900) * dt;
    }

    player.py = player.y;
    player.x = clamp(player.x + player.vx * dt, 0, LEVEL_W - player.w);
    player.y += player.vy * dt;
    if (Math.abs(player.vx) > 12) player.face = player.vx < 0 ? -1 : 1;

    // smoothed camera follow + landing/hurt animation state
    const camT = clamp(player.x - W * 0.38, 0, LEVEL_W - W);
    camCur += (camT - camCur) * Math.min(1, dt * 8);
    if (player.onGround && !player.wasGround) player.landT = 0.15;
    player.wasGround = player.onGround;
    player.landT = Math.max(0, player.landT - dt);
    player.hurt = Math.max(0, player.hurt - dt);
    player.dazed = Math.max(0, player.dazed - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.strain = Math.max(0, player.strain - dt * 0.5);

    // cosmetic trail
    if (meta.owned.trail) trail.push({ x: player.x + player.w / 2, y: player.y + player.h / 2, life: 0.5, max: 0.5 });
    for (let i = trail.length - 1; i >= 0; i--) { trail[i].life -= dt; if (trail[i].life <= 0) trail.splice(i, 1); }

    // collision (land on platform tops)
    player.onGround = false;
    let stood = null;
    if (!xaxis) {
      for (const p of platforms) {
        if (p.gone) continue;
        if (player.vy >= 0 &&
            player.py + player.h <= p.y + 8 &&
            player.y + player.h >= p.y &&
            player.x + player.w > p.x + 3 && player.x < p.x + p.w - 3) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          stood = p;
        }
      }
    }
    player.coyote = player.onGround ? 0.1 : player.coyote - dt;

    // unstable platforms: stand too long and they drop out from under you
    for (const p of platforms) {
      if (!p.crumble) continue;
      if (p.gone) { p.retT -= dt; if (p.retT <= 0) { p.gone = false; p.crumT = 0; } continue; }
      if (stood === p) {
        p.crumT += dt;
        if (p.crumT > 0.55 && !p.shown) {
          p.shown = true;
          showToast("⚠ THE FLOOR IS GOING — MOVE", 1.1);
          scr.shake = Math.min(scr.shake + 6, 16);
        }
        if (p.crumT > 0.95) {
          p.gone = true; p.retT = 4; p.crumT = 0; p.shown = false;
          scr.shake = Math.min(scr.shake + 12, 26);
          for (let i = 0; i < 10; i++) spawnParticle({
            x: p.x + rand(0, p.w), y: p.y + rand(0, p.h), vx: rand(-90, 90), vy: rand(-140, -20),
            grav: 900, emoji: "🪨", size: rand(12, 22), life: 0.9, max: 0.9,
          });
          if (player.onGround) { player.onGround = false; player.coyote = 0; }
        }
      } else if (p.crumT > 0) { p.crumT = Math.max(0, p.crumT - dt * 1.5); p.shown = false; }
    }

    // spike strips: real danger, late in the level only
    if (state === "play" && player.invuln <= 0) {
      for (const hz of HAZARDS) {
        if (player.x + player.w > hz.x && player.x < hz.x + hz.w &&
            player.y + player.h > hz.y && player.y + player.h <= hz.y + hz.h + 12) {
          player.vy = -420; player.vy *= 1; player.vx = player.x < GOAL.x ? 260 : -260;
          showToast("▲ SPIKES", 0.9);
          tone(120, 0.16, "sawtooth", 0.07, 60);
          hurt(1, "The spikes were not the point. You still walked into them.");
          break;
        }
      }
    }

    // coins (souls) — CARRIED, at risk until you bank them at a checkpoint
    for (const c of coinList) {
      if (c.got) continue;
      if (Math.abs((player.x + player.w / 2) - c.x) < c.r + 22 &&
          Math.abs((player.y + player.h / 2) - c.y) < c.r + 26) {
        c.got = true; coins++; carried = coins; updateHud();
        tone(880, 0.09, "square", 0.06, 1320);
        for (let i = 0; i < 6; i++) spawnParticle({
          x: c.x, y: c.y, vx: rand(-120, 120), vy: rand(-200, -40), grav: 700,
          emoji: "✨", size: rand(12, 22), life: 0.7, max: 0.7,
        });
      }
    }

    // checkpoints — cross one to BANK your carried souls (they can no longer be lost)
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const cp = CHECKPOINTS[i];
      if (cp.reached) continue;
      if (player.x + player.w / 2 > cp.x) { cp.reached = true; bankSouls(i); break; }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.homing) {
        const tx = player.x + player.w / 2, ty = player.y + player.h / 2;
        const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * 480 * dt;
        p.vy += (dy / d) * 480 * dt;
      }
      p.vy += p.grav * dt;
      if (p.drag) { p.vx *= Math.pow(1 / (1 + p.drag), dt * 3); p.vy *= Math.pow(1 / (1 + p.drag), dt * 3); }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }

    // zone change: announce the new act with a Mastermind line (once per zone)
    const zi = zoneAt(player.x);
    if (zi !== zoneIdx && state === "play") {
      const first = zoneIdx === -1;
      zoneIdx = zi;
      if (!first) {
        showToast("\u25B6 " + ZONES[zi].name, 2.2);
        tone(180, 0.3, "triangle", 0.06, 300);
      }
    }

    // entities (dinosaurs walk, wings flap, hands slap) — they act on the player
    updateEntities(dt);
    updateScarf();

    // bolts
    for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].life -= dt; if (bolts[i].life <= 0) bolts.splice(i, 1); }

    // goal
    if (player.x + player.w > GOAL.x + 10) win();

    // goal bar
    elGoalFill.style.width = clamp((player.x / (GOAL.x)) * 100, 0, 100) + "%";
  }

  function win() {
    // a win banks everything you were carrying — forever
    meta.banked += carried;
    meta.bestPct = 100;
    saveMeta();
    scr.flash = 1;
    tone(660, 0.12, "square", 0.08, 990);
    setTimeout(() => tone(990, 0.18, "square", 0.08, 1320), 140);
    elWinTitle.textContent = coins >= coinList.length ? "PERFECT RUN" : "YOU MADE IT";
    elWinBody.textContent = "The portal accepts you. " + carried + " souls banked.";
    elWinStats.textContent = "punished " + punishments + "×  ·  souls " + coins + "/" + coinList.length +
      "  ·  banked " + meta.banked + "  ·  best " + Math.round(meta.bestPct) + "%";
    playCine(CINE_WIN, () => { state = "win"; elWin.classList.remove("hidden"); });
  }

  function reset() {
    state = "play";
    punishments = 0; coins = 0; carried = 0; streak = 0; lastCP = -1; probes = 3;
    elPunish.textContent = "0"; elCoin.textContent = "0";
    player.x = 80; player.y = GROUND_Y - player.h; player.vx = 0; player.vy = 0; player.onGround = false;
    player.landT = 0; player.hurt = 0; player.dazed = 0; player.wasGround = false; player.flyT = 0; player.strain = 0;
    player.hp = player.maxHp; player.invuln = 0;
    camCur = clamp(player.x - W * 0.38, 0, LEVEL_W - W);
    coinList.forEach((c) => (c.got = false));
    CHECKPOINTS.forEach((c) => (c.reached = false));
    particles.length = 0; bolts.length = 0; entities.length = 0;
    water.on = false; water.y = GROUND_Y + 400; water.target = GROUND_Y + 400;
    scr.shake = 0; scr.flash = 0; scr.dark = 0; scr.invert = 0; scr.spin = 0; scr.spinV = 0; scr.tint = null; scr.tintA = 0;
    canvas.style.filter = "";
    freezeUntil = -1; xaxisUntil = -1; pullUntil = -1; revealUntil = -1;
    elWin.classList.add("hidden");
    elDeath.classList.add("hidden");
    elManual.classList.remove("reveal");
    rollContract();
    updateHud();
    showToast("FIND THE KEYS. THE MANUAL LIES.", 2.4);
  }

  /* --------------------------------------------------------------- render */
  /* --------------------------------------------------------------- zones  */
  // The level is four themed acts, not one corridor. Each brings its own sky,
  // scenery and particles, and announces itself with a Mastermind line.
  const ZONES = [
    {
      name: "THE BAMBOO SHRINE", at: 0,
      sky: ["#06121c", "#0b2434", "#123b45", "#1c5560"],
      ridge: ["#123039", "#0d2229"], hill: ["#15414a", "#0d2b33"],
      accent: "#7fe6c8", fog: "150,220,205", ember: null, style: "bamboo",
      line: ["THE MASTERMIND", "A quiet shrine. Nothing here will help you jump."],
    },
    {
      name: "THE SPIRIT FOREST", at: 900,
      sky: ["#160a26", "#2a1140", "#3d1a52", "#52245f"],
      ridge: ["#2c1440", "#1d0e2c"], hill: ["#351a48", "#231034"],
      accent: "#d98cff", fog: "200,140,240", ember: "#e0a0ff", style: "torii",
      line: ["THE MASTERMIND", "The lanterns are lit for you. They are not lit for anyone else."],
    },
    {
      name: "THE RED GATE", at: 2000,
      sky: ["#2a0810", "#4a0f18", "#6b1620", "#8a2026"],
      ridge: ["#3d1018", "#260a10"], hill: ["#4a141c", "#2c0c12"],
      accent: "#ff6b5a", fog: "255,120,100", ember: "#ff8a5a", style: "gate",
      line: ["THE MASTERMIND", "Everything past this gate is on purpose."],
    },
    {
      name: "THE DRAGON'S END", at: 2950,
      sky: ["#07040f", "#160a2e", "#2b0f45", "#43155c"],
      ridge: ["#1e0f34", "#140a24"], hill: ["#27143f", "#180c2a"],
      accent: "#ff4fd8", fog: "210,110,220", ember: "#ff6be0", style: "dragon",
      line: ["THE MASTERMIND", "The portal is right there. It has been right there the whole time."],
    },
  ];
  function zoneAt(x) {
    let z = 0;
    for (let i = 0; i < ZONES.length; i++) if (x >= ZONES[i].at) z = i;
    return z;
  }
  let zoneIdx = -1;

  function renderBackground(cx) {
    const m = dread();
    const Z = ZONES[zoneAt(player.x)];
    // sky: each zone owns its palette, warmed slightly as the portal nears
    const warm = m > 0.6 ? 0.25 : 0;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    for (let i = 0; i < 4; i++) {
      const c = mixHex(Z.sky[i], "#3a0d18", warm * (i / 3));
      g.addColorStop([0, 0.40, 0.68, 1][i], c);
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    drawStars();
    drawMoon(cx, Z);
    drawWatcher(cx);
    drawClouds(cx);
    drawZoneScenery(cx, Z);
    drawFog(Z);
    drawMotes(cx, Z);
  }

  function drawZoneScenery(cx, Z) {
    const par = Z.style === "bamboo" ? 0.16 : Z.style === "torii" ? 0.24 : 0.30;
    drawRange(cx, par, GROUND_Y - 30, Z.ridge[0], Z.ridge[1], 150, 300);
    if (Z.style === "torii" || Z.style === "gate" || Z.style === "dragon") drawSkyline(cx, 0.34, GROUND_Y + 2, Z);
    drawHills(cx, 0.50, GROUND_Y + 2, Z.hill[0], 66, 300);
    drawHills(cx, 0.68, GROUND_Y + 2, Z.hill[1], 92, 240);
    if (Z.style === "bamboo") drawBamboo(cx);
    if (Z.style === "torii") drawTorii(cx);
    if (Z.style === "gate") drawTorii(cx, true);
    if (Z.style === "dragon") drawDragon(cx);
  }

  // swaying bamboo stalks — motion sells the "living" magical world
  function drawBamboo(cx) {
    const par = 0.42, step = 78;
    const start = Math.floor((cx * par - 300) / step), end = Math.ceil((cx * par + W + 300) / step);
    for (let j = start; j <= end; j++) {
      const x = j * step - cx * par + h1(j * 1.7) * 40;
      const hgt = 210 + h1(j * 3.3) * 130;
      const sw = Math.sin(now * 0.7 + j) * 5;
      ctx.strokeStyle = j % 3 === 0 ? "#1e5a4a" : "#16463c";
      ctx.lineWidth = 7 + h1(j) * 4;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 6);
      ctx.quadraticCurveTo(x + sw, GROUND_Y - hgt * 0.5, x + sw * 2.2, GROUND_Y - hgt);
      ctx.stroke();
      // leaf blades
      ctx.lineWidth = 3;
      for (let b = 1; b <= 4; b++) {
        const t = b / 5, ly = GROUND_Y - hgt * t, lx = x + sw * t * 2;
        const dir = b % 2 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx + dir * 22, ly - 10, lx + dir * 34, ly + 6);
        ctx.stroke();
      }
    }
  }

  function drawTorii(cx, grand) {
    const par = grand ? 0.58 : 0.5, step = grand ? 620 : 430;
    const start = Math.floor((cx * par - 500) / step), end = Math.ceil((cx * par + W + 500) / step);
    for (let j = start; j <= end; j++) {
      const x = j * step - cx * par + h1(j) * 90;
      const sc = (grand ? 1.5 : 1) * (0.9 + h1(j * 2.2) * 0.3);
      const hgt = 210 * sc, wdt = 150 * sc;
      const glow = 0.5 + 0.5 * Math.sin(now * 1.2 + j);
      ctx.save();
      ctx.translate(x, GROUND_Y);
      // pillars
      ctx.fillStyle = grand ? "#8f1620" : "#6d1220";
      ctx.fillRect(-wdt / 2, -hgt, 13 * sc, hgt);
      ctx.fillRect(wdt / 2 - 13 * sc, -hgt, 13 * sc, hgt);
      // kasagi (top beam) with curve
      ctx.fillStyle = grand ? "#b01f28" : "#8a1a22";
      ctx.beginPath();
      ctx.moveTo(-wdt * 0.62, -hgt);
      ctx.quadraticCurveTo(0, -hgt - 22 * sc, wdt * 0.62, -hgt);
      ctx.lineTo(wdt * 0.62, -hgt + 14 * sc);
      ctx.quadraticCurveTo(0, -hgt - 4 * sc, -wdt * 0.62, -hgt + 14 * sc);
      ctx.closePath(); ctx.fill();
      // nuki (second beam)
      ctx.fillRect(-wdt * 0.46, -hgt * 0.78, wdt * 0.92, 10 * sc);
      // paper lanterns
      ctx.globalAlpha = 0.55 + glow * 0.45;
      for (const lx of [-wdt * 0.3, wdt * 0.3]) {
        const lg = ctx.createRadialGradient(lx, -hgt * 0.66, 1, lx, -hgt * 0.66, 34);
        lg.addColorStop(0, "rgba(255,190,120,.85)");
        lg.addColorStop(1, "rgba(255,150,80,0)");
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, -hgt * 0.66, 34, 0, 6.28); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // a coiled dragon breathing light over the final stretch
  function drawDragon(cx) {
    const par = 0.2;
    const x = W * 0.72 - cx * par;
    const y = H * 0.30 + Math.sin(now * 0.8) * 8;
    const breathe = 0.5 + 0.5 * Math.sin(now * 2.2);
    ctx.save();
    ctx.translate(x, y);
    // coils
    ctx.strokeStyle = "rgba(150,60,190,.55)";
    ctx.lineWidth = 20; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const a = t * Math.PI * 2.4 + now * 0.35;
      const r = 130 * (1 - t * 0.55);
      const px2 = Math.cos(a) * r * 1.5;
      const py2 = Math.sin(a) * r * 0.62 + t * 60;
      i ? ctx.lineTo(px2, py2) : ctx.moveTo(px2, py2);
    }
    ctx.stroke();
    // head
    ctx.fillStyle = "#a04ad0";
    ctx.beginPath(); ctx.ellipse(150, -34, 34, 20, -0.3, 0, 6.28); ctx.fill();
    // horns
    ctx.strokeStyle = "#d8a0ff"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(160, -52); ctx.lineTo(150, -84); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(176, -48); ctx.lineTo(184, -76); ctx.stroke();
    // eye + maw glow
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(158, -40, 7, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#ff2f6e"; ctx.beginPath(); ctx.arc(159, -40, 3.4, 0, 6.28); ctx.fill();
    const mg = ctx.createRadialGradient(186, -28, 2, 186, -28, 40);
    mg.addColorStop(0, "rgba(255,80,180," + (0.3 + breathe * 0.4).toFixed(3) + ")");
    mg.addColorStop(1, "rgba(255,80,180,0)");
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(186, -28, 40, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  // 0..1 continuous progress toward the portal — drives the whole atmosphere
  function dread() { return clamp(player.x / GOAL.x, 0, 1); }

  function mixHex(a, b, u) {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * u));
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  }

  function drawStars() {
    ctx.save();
    for (let i = 0; i < 110; i++) {
      const x = h1(i * 3 + 1) * W;
      const y = h1(i * 3 + 2) * H * 0.55;
      const tw = 0.5 + 0.5 * Math.sin(now * (0.8 + h1(i) * 2.2) + i * 2.1);
      const r = 0.5 + h1(i * 3 + 3) * 1.5;
      ctx.globalAlpha = (0.18 + tw * 0.7) * (1 - dread() * 0.55); // stars fade as it gets worse
      ctx.fillStyle = i % 9 === 0 ? "#ffe6b0" : "#cfe9ff";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawMoon(cx, Z) {
    const m = dread();
    const mx = W * 0.80 - cx * 0.03, my = H * 0.19, r = 44;
    const g = ctx.createRadialGradient(mx, my, r * 0.4, mx, my, r * 3.3);
    const gc = Z && Z.accent ? hexRgbStr(Z.accent) : (m < 0.5 ? "190,220,255" : "255,90,80");
    g.addColorStop(0, "rgba(" + gc + "," + (0.30 + m * 0.22).toFixed(3) + ")");
    g.addColorStop(1, "rgba(" + gc + ",0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, r * 3.3, 0, 6.28); ctx.fill();
    // a supermoon: bigger and brighter deep in the run
    const rr = r * (1 + m * 0.35);
    ctx.fillStyle = m < 0.5 ? "#e8f1ff" : "#ff9a86";
    ctx.beginPath(); ctx.arc(mx, my, rr, 0, 6.28); ctx.fill();
    ctx.fillStyle = "rgba(150,175,210,.40)";
    ctx.beginPath(); ctx.arc(mx - 13, my - 7, 7, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 12, my + 9, 5, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 3, my - 17, 4, 0, 6.28); ctx.fill();
  }
  function hexRgbStr(h) {
    return parseInt(h.slice(1, 3), 16) + "," + parseInt(h.slice(3, 5), 16) + "," + parseInt(h.slice(5, 7), 16);
  }

  // the Mastermind: a watching eye in the sky that tracks the player
  function drawWatcher(cx) {
    const m = dread();
    const ex = W * 0.27 - cx * 0.02, ey = H * 0.17, rw = 74 + m * 34, rh = 44 + m * 20;
    const blink = Math.pow(Math.max(0, Math.sin(now * 0.9)), 30);
    const px = player.x - camX() + player.w / 2, py = player.y + player.h / 2;
    const gl = ctx.createRadialGradient(ex, ey, 6, ex, ey, 150 + m * 70);
    gl.addColorStop(0, "rgba(255,80,130," + (0.26 + m * 0.30).toFixed(3) + ")");
    gl.addColorStop(1, "rgba(255,80,130,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(ex, ey, 150 + m * 70, 0, 6.28); ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.55 + m * 0.35;
    ctx.beginPath(); ctx.ellipse(ex, ey, rw, Math.max(1, rh * (1 - blink)), 0, 0, 6.28);
    ctx.fillStyle = "rgba(225,238,255,.13)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,120,165," + (0.55 + m * 0.4).toFixed(3) + ")"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    const dx = clamp((px - ex) / (W * 0.5), -1, 1), dy = clamp((py - ey) / (H * 0.5), -1, 1);
    const ix = ex + dx * (rw - 22), iy = ey + dy * (rh - 15);
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.1 * Math.sin(now * 2) + m * 0.3;
    ctx.beginPath(); ctx.ellipse(ix, iy, 20 + m * 6, Math.max(1, (20 + m * 6) * (1 - blink)), 0, 0, 6.28);
    ctx.fillStyle = "rgba(255,55,110,.6)"; ctx.fill();
    ctx.beginPath(); ctx.arc(ix, iy, 8 + m * 3, 0, 6.28);
    ctx.fillStyle = "rgba(15,0,8,.85)"; ctx.fill();
    ctx.restore();
  }

  function blob(x, y, r) { ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, 6.28); ctx.fill(); }
  function drawClouds(cx) {
    const par = -cx * 0.08;
    for (let i = 0; i < 5; i++) {
      const span = W + 460;
      const base = h1(i * 9 + 4) * span;
      const x = (((base + par + now * (5 + h1(i) * 9)) % span) + span) % span - 230;
      const y = 34 + h1(i * 9 + 5) * H * 0.26;
      const s = 0.7 + h1(i * 9 + 6) * 0.9;
      ctx.globalAlpha = 0.09 + h1(i * 9 + 7) * 0.10;
      ctx.fillStyle = "#9fc0e6";
      blob(x, y, 58 * s);
      blob(x + 52 * s, y + 7 * s, 42 * s);
      blob(x - 48 * s, y + 9 * s, 38 * s);
      blob(x + 10 * s, y - 16 * s, 36 * s);
    }
    ctx.globalAlpha = 1;
  }

  function drawRange(cx, par, baseY, topC, botC, peakH, span) {
    const start = Math.floor((cx * par - span) / span);
    const end = Math.ceil((cx * par + W + span) / span);
    const g = ctx.createLinearGradient(0, baseY - peakH, 0, baseY + 40);
    g.addColorStop(0, topC); g.addColorStop(1, botC);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-200, H);
    ctx.lineTo(start * span - cx * par, baseY);
    for (let j = start; j <= end; j++) {
      const px = j * span - cx * par;
      const hh = peakH * (0.42 + h1(j * 2.3 + 0.5) * 0.95);
      ctx.lineTo(px, baseY - hh);
      ctx.lineTo(px + span * 0.5, baseY);
    }
    ctx.lineTo(W + 300, H); ctx.closePath(); ctx.fill();
  }

  function drawSkyline(cx, par, baseY, Z) {
    const off = cx * par, span = 62;
    const start = Math.floor((off - 260) / span);
    const end = Math.ceil((off + W + 260) / span);
    const body = Z && Z.ridge ? Z.ridge[0] : "#0b1524";
    const win = Z && Z.accent ? Z.accent : "255,214,140";
    for (let j = start; j <= end; j++) {
      const bw = 34 + h1(j * 5.1) * 30;
      const bh = 46 + h1(j * 5.7 + 1) * 150;
      const bx = j * span - off, by = baseY - bh;
      ctx.fillStyle = body;
      ctx.fillRect(bx, by, bw, bh + 80);
      // pagoda roof hint on taller towers
      if (bh > 150) {
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(bx - 8, by);
        ctx.quadraticCurveTo(bx + bw / 2, by - 16, bx + bw + 8, by);
        ctx.lineTo(bx + bw, by + 6); ctx.lineTo(bx, by + 6);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = "rgba(" + win + ",.5)";
      for (let wy = by + 8; wy < baseY - 6; wy += 14)
        for (let wx = bx + 6; wx < bx + bw - 6; wx += 12)
          if (h1(wx * 0.7 + wy * 1.3 + j) > 0.62) ctx.fillRect(wx, wy, 4, 5);
    }
  }

  function drawHills(cx, par, baseY, color, amp, span) {
    const off = cx * par;
    const start = Math.floor((off - span) / span);
    const end = Math.ceil((off + W + span) / span);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-200, H);
    ctx.lineTo(start * span - off, baseY);
    for (let j = start; j <= end; j++) {
      const px = j * span - off;
      const hh = amp * (0.5 + h1(j * 3.1) * 0.8);
      ctx.quadraticCurveTo(px + span / 2, baseY - hh, px + span, baseY);
    }
    ctx.lineTo(W + 300, H); ctx.closePath(); ctx.fill();
  }

  function drawFog(Z) {
    const m = dread();
    const g = ctx.createLinearGradient(0, GROUND_Y - 90, 0, GROUND_Y + 30);
    const fc = Z && Z.fog ? Z.fog : (m < 0.5 ? "130,170,215" : "220,110,120");
    g.addColorStop(0, "rgba(" + fc + ",0)");
    g.addColorStop(1, "rgba(" + fc + "," + (0.20 + m * 0.22).toFixed(3) + ")");
    ctx.fillStyle = g; ctx.fillRect(0, GROUND_Y - 90, W, 120);
  }

  function drawMotes(cx, Z) {
    const m = dread();
    // drifting motes; in the magical zones they become rising spirit embers
    const rising = !!(Z && Z.ember);
    for (let i = 0; i < 44; i++) {
      const x = h1(i * 7 + 2) * 2600 - cx * 0.9;
      if (x < -20 || x > W + 20) continue;
      const drift = now * (8 + h1(i) * 16);
      const yy = rising
        ? H - (((h1(i * 7 + 3) * H + drift * 2.2) % H))
        : (((h1(i * 7 + 3) * H - drift) % H) + H) % H;
      const flick = rising ? (0.5 + 0.5 * Math.sin(now * 6 + i)) : 1;
      ctx.globalAlpha = (0.12 + 0.26 * h1(i * 7 + 5)) * (rising ? (0.3 + m * 0.9) * flick : 1);
      ctx.fillStyle = rising ? Z.ember : "#bfeaff";
      ctx.beginPath(); ctx.arc(x, yy, (rising ? 1 + m : 1) + h1(i * 7 + 6) * 1.6, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlatform(p) {
    // unstable platforms visibly shake, then drop away
    if (p.crumble) {
      if (p.gone) return;
      const shake = p.crumT > 0 ? (rand(-1, 1) * p.crumT * 4) : 0;
      ctx.save();
      ctx.translate(shake, 0);
    }
    // grass top for ground, glowing neon plate for floaters
    if (p.h > 60) {
      ctx.fillStyle = "#1c2c22";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      const gg = ctx.createLinearGradient(0, p.y, 0, p.y + 18);
      gg.addColorStop(0, "#63b769");
      gg.addColorStop(1, "#2f6a3a");
      ctx.fillStyle = gg;
      ctx.fillRect(p.x, p.y, p.w, 18);
      const pulse = 0.5 + 0.5 * Math.sin(now * 1.6);
      ctx.globalAlpha = 0.22 + pulse * 0.22;
      ctx.fillStyle = "#9dff5f"; ctx.fillRect(p.x, p.y, p.w, 3);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = 2;
      for (let x = p.x + 30; x < p.x + p.w; x += 60) { ctx.beginPath(); ctx.moveTo(x, p.y + 18); ctx.lineTo(x, p.y + p.h); ctx.stroke(); }
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(now * 2.6 + p.x * 0.02);
      ctx.globalAlpha = 0.10 + pulse * 0.14;
      ctx.fillStyle = "#5ffbf1";
      roundRect(p.x - 4, p.y - 4, p.w + 8, p.h + 16, 10); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#232f47";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "rgba(95,251,241,.16)";
      ctx.fillRect(p.x, p.y + 4, p.w, p.h - 4);
      ctx.fillStyle = "#5ffbf1";
      ctx.fillRect(p.x, p.y, p.w, 4);
      ctx.fillStyle = "#9dff5f";
      ctx.fillRect(p.x, p.y, 4, p.h);
      ctx.fillRect(p.x + p.w - 4, p.y, 4, p.h);
    }
    if (p.crumble) {
      // warning cracks as it gives way
      const warn = clamp(p.crumT / 0.95, 0, 1);
      if (warn > 0.02) {
        ctx.globalAlpha = 0.35 + warn * 0.5;
        ctx.fillStyle = "#ff5a3c";
        ctx.fillRect(p.x, p.y - 2, p.w, 4);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawHazards() {
    for (const hz of HAZARDS) {
      const cx = hz.x + hz.w / 2;
      if (cx < camX() - 200 || cx > camX() + W + 200) continue;
      const t = hz.h;
      ctx.save();
      // base bar
      ctx.fillStyle = "#3a1620";
      ctx.fillRect(hz.x, hz.y + t - 5, hz.w, 5);
      // teeth
      ctx.fillStyle = "#c9d4e4";
      ctx.beginPath();
      const step = 16;
      for (let x = hz.x; x < hz.x + hz.w; x += step) {
        const w2 = Math.min(step, hz.x + hz.w - x);
        ctx.moveTo(x, hz.y + t - 3);
        ctx.lineTo(x + w2 / 2, hz.y);
        ctx.lineTo(x + w2, hz.y + t - 3);
      }
      ctx.closePath(); ctx.fill();
      // danger glow
      const g = ctx.createRadialGradient(cx, hz.y, 2, cx, hz.y, hz.w);
      g.addColorStop(0, "rgba(255,60,60," + (0.10 + 0.08 * Math.sin(now * 3 + hz.x)) + ")");
      g.addColorStop(1, "rgba(255,60,60,0)");
      ctx.fillStyle = g;
      ctx.fillRect(hz.x - hz.w, hz.y - hz.w, hz.w * 3, hz.w * 2);
      ctx.restore();
    }
  }

  // --- the scarf: a chain of points that lags behind, giving real secondary motion
  const scarf = [];
  function updateScarf() {
    scarf.unshift({
      x: player.x + player.w / 2 - player.face * 12,
      y: player.y + player.h * 0.28,
      t: 1,
    });
    for (let i = scarf.length - 1; i >= 0; i--) {
      scarf[i].t -= 0.045;
      scarf[i].y += (1.6 + Math.sin(now * 6 + i) * 1.4);   // sag + flutter
      if (scarf[i].t <= 0) scarf.splice(i, 1);
    }
    while (scarf.length > 14) scarf.pop();
  }

  function drawScarf(accent) {
    if (scarf.length < 3) return;
    ctx.save();
    for (let i = 0; i < scarf.length - 1; i++) {
      const a = scarf[i], b = scarf[i + 1];
      const taper = clamp(a.t, 0, 1);
      ctx.globalAlpha = 0.85 * taper;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(0.6, 7 * taper);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const w = player.w, h = player.h;
    const cx = player.x + w / 2, cy = player.y + h / 2;
    const Z = ZONES[zoneAt(player.x)];
    const accent = (Z && Z.accent) || "#7cf6ff";
    const air = !player.onGround;
    const v = clamp(player.vy / 900, -1, 1);
    let sx = 1, sy = 1;
    if (air) { sy = 1 + v * 0.16; sx = 1 - v * 0.12; }          // stretch up / squash down
    if (player.landT > 0) { const k = player.landT / 0.15; sy -= 0.30 * k; sx += 0.30 * k; } // landing squash
    const speed = Math.abs(player.vx);
    const moving = player.onGround && speed > 25;
    const phase = now * 15;
    const bob = moving ? -Math.abs(Math.sin(phase)) * 3 : Math.sin(now * 2) * 1.6;
    const lean = (now < xaxisUntil) ? player.face * 0.4 : clamp(player.vx / 1500, -0.16, 0.16);
    const hurt = player.hurt > 0, dazed = player.dazed > 0;

    // shadow (world space)
    ctx.globalAlpha = air ? 0.12 : 0.34;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(cx, player.y + h + 5, w * (air ? 0.4 : 0.5), 6, 0, 0, 6.28);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.rotate(lean);
    ctx.scale(sx, sy);

    // legs (behind body)
    const swing = moving ? Math.sin(phase) * 7 : 0;
    ctx.fillStyle = "#16336b";
    ctx.save(); ctx.translate(-9, h / 2 - 5); ctx.rotate(swing * 0.05);
    roundRect(-5, 0, 10, 12, 4); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(9, h / 2 - 5); ctx.rotate(-swing * 0.05);
    roundRect(-5, 0, 10, 12, 4); ctx.fill(); ctx.restore();

    // arms
    const aswing = moving ? Math.sin(phase + Math.PI) * 8 : 0;
    ctx.fillStyle = "#1c4a94";
    ctx.save(); ctx.translate(-w / 2 + 2, -6); ctx.rotate(aswing * 0.05);
    roundRect(-4, 0, 8, 16, 4); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(w / 2 - 2, -6); ctx.rotate(-aswing * 0.05);
    roundRect(-4, 0, 8, 16, 4); ctx.fill(); ctx.restore();

    // body — a hooded figure, tinted to the zone it is standing in
    const grd = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    if (hurt) { grd.addColorStop(0, "#ffb3b3"); grd.addColorStop(1, "#ff2f2f"); }
    else { grd.addColorStop(0, accent); grd.addColorStop(0.45, "#2f6ea8"); grd.addColorStop(1, "#1b2c5e"); }
    ctx.fillStyle = grd;
    roundRect(-w / 2, -h / 2, w, h, 13); ctx.fill();
    // rim light picked up from the sky
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = accent; ctx.lineWidth = 5;
    roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 10); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(234,255,255,.9)"; ctx.lineWidth = 2;
    roundRect(-w / 2, -h / 2, w, h, 13); ctx.stroke();

    // hood over the face
    ctx.fillStyle = hurt ? "#8c1a1a" : "#16233f";
    ctx.beginPath();
    ctx.moveTo(-13, -2);
    ctx.quadraticCurveTo(-15, -26, 0, -27);
    ctx.quadraticCurveTo(15, -26, 13, -2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.globalAlpha = 1;

    // face plate (a mask, not a face — the Mastermind never shows you one)
    ctx.fillStyle = hurt ? "#ffd9d9" : "#e9f4ff";
    roundRect(-10, -22, 20, 18, 7); ctx.fill();

    // face — eyes and mouth sit on the mask plate
    const eyeX = player.face * 2;
    const blink = h1(Math.floor(now * 3.3)) > 0.93 || dazed;
    const eyeH = blink ? 1.2 : 4.6;
    const eyeCol = hurt ? "#7a0d12" : accent;
    ctx.fillStyle = eyeCol;
    ctx.beginPath(); ctx.ellipse(-6 + eyeX, -14, 4.2, eyeH, 0, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8 + eyeX, -14, 4.2, eyeH, 0, 0, 6.28); ctx.fill();
    if (!blink) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-7 + eyeX, -15.2, 1.7, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(7 + eyeX, -15.2, 1.7, 0, 6.28); ctx.fill();
    }
    // mouth: a flat line, a small smile, or an open scream
    ctx.strokeStyle = eyeCol; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath();
    if (hurt || dazed) ctx.arc(eyeX, -2, 5, 1.2 * Math.PI, 1.8 * Math.PI);
    else if (air) { ctx.ellipse(eyeX, -6, 3.2, 3.6, 0, 0, 6.28); ctx.stroke(); }
    else ctx.arc(eyeX, -9, 6, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCosmetics() {
    if (meta.owned.trail) {
      ctx.save();
      for (const t of trail) {
        const a = t.life / t.max;
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = "#8fd8ff";
        ctx.beginPath(); ctx.arc(t.x, t.y, 10 * a, 0, 6.28); ctx.fill();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (meta.owned.aura && player.hp <= 1) {
      const p = 0.5 + 0.5 * Math.sin(now * 9);
      ctx.save();
      ctx.globalAlpha = 0.3 * p;
      ctx.fillStyle = "#ff3040";
      ctx.beginPath(); ctx.arc(player.x + player.w / 2, player.y + player.h / 2, 42 + 8 * p, 0, 6.28); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  function drawGoal() {
    const pulse = 0.5 + 0.5 * Math.sin(now * 3);
    const cx = GOAL.x + GOAL.w / 2, cy = GOAL.y + GOAL.h / 2;

    // ground glow
    ctx.save();
    ctx.globalAlpha = 0.45 + pulse * 0.25;
    const gg = ctx.createRadialGradient(cx, GROUND_Y, 4, cx, GROUND_Y, 120);
    gg.addColorStop(0, "rgba(157,255,95,.7)");
    gg.addColorStop(1, "rgba(157,255,95,0)");
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.ellipse(cx, GROUND_Y, 120, 26, 0, 0, 6.28); ctx.fill();
    ctx.restore();

    // expanding swirl rings
    for (let i = 0; i < 3; i++) {
      const t = (now * 0.6 + i / 3) % 1;
      const rr = GOAL.w * 0.35 + t * GOAL.w * 0.9;
      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.strokeStyle = i % 2 ? "#5ffbf1" : "#ff5fd2";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.85, 0, 0, 6.28); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // core portal
    const rg = ctx.createRadialGradient(cx, cy, 6, cx, cy, GOAL.h * 0.7);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(0.4, "#5ffbf1");
    rg.addColorStop(1, "rgba(255,95,210,0)");
    ctx.globalAlpha = 0.8 + pulse * 0.2;
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.ellipse(cx, cy, GOAL.w * 0.7, GOAL.h * 0.6, 0, 0, 6.28); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#9dff5f"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, cy, GOAL.w * 0.55, GOAL.h * 0.52, 0, 0, 6.28); ctx.stroke();

    // pole
    ctx.strokeStyle = "#cfe9ff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(GOAL.x - 6, GOAL.y - 20); ctx.lineTo(GOAL.x - 6, GROUND_Y); ctx.stroke();
  }

  function drawCoins() {
    for (const c of coinList) {
      if (c.got) continue;
      const y = c.y + Math.sin(now * 2 + c.bob) * 5;
      ctx.save();
      const gleam = 0.45 + 0.25 * Math.sin(now * 3 + c.bob);
      const cg = ctx.createRadialGradient(c.x, y, 2, c.x, y, 26);
      cg.addColorStop(0, "rgba(255,240,120," + (0.55 * gleam + 0.2) + ")");
      cg.addColorStop(1, "rgba(255,200,60,0)");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(c.x, y, 26, 0, 6.28); ctx.fill();
      ctx.font = "30px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🔮", c.x, y);
      ctx.restore();
    }
  }

  function drawCheckpoints() {
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const cp = CHECKPOINTS[i];
      const x = cp.x, y = cp.y;
      const col = cp.reached ? "#57f7a0" : "#5a6480";
      ctx.save();
      // pole
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 96); ctx.stroke();
      // flag
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x, y - 96); ctx.lineTo(x + 40, y - 82); ctx.lineTo(x, y - 68); ctx.closePath(); ctx.fill();
      // glow if banked + pulsing beacon
      if (cp.reached) {
        const g = ctx.createRadialGradient(x, y - 50, 2, x, y - 50, 70);
        g.addColorStop(0, "rgba(87,247,160," + (0.35 + 0.2 * Math.sin(now * 3)) + ")");
        g.addColorStop(1, "rgba(87,247,160,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y - 50, 70, 0, 6.28); ctx.fill();
      }
      ctx.font = "16px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = cp.reached ? "#bfffe0" : "rgba(200,210,230,.45)";
      ctx.fillText(cp.reached ? "BANKED" : "BANK", x, y - 110);
      ctx.restore();
    }
  }

  function renderWorld() {
    const cx = camX();
    const shx = rand(-scr.shake, scr.shake) * 0.5;
    const shy = rand(-scr.shake, scr.shake) * 0.5;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(scr.spin);
    ctx.translate(-W / 2, -H / 2);
    ctx.translate(-cx + shx, shy);

    // world edge marker
    ctx.strokeStyle = "rgba(255,255,255,.2)";
    ctx.beginPath(); ctx.moveTo(LEVEL_W, 0); ctx.lineTo(LEVEL_W, H); ctx.stroke();

    for (const p of platforms) drawPlatform(p);
    for (const p of PROPS) drawProp(p);
    drawCheckpoints();
    drawHazards();
    drawEntities();
    drawCoins();
    drawGoal();

    // particles
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const p of particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a > 0.5 ? 1 : a * 2;
      ctx.font = p.size + "px serif";
      ctx.fillText(p.emoji, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    drawScarf((ZONES[zoneAt(player.x)] || {}).accent || "#7cf6ff");
    drawPlayer();
    drawCosmetics();
    drawForeground(cx);

    // water overlay
    if (water.on) {
      const wy = water.y;
      ctx.fillStyle = "rgba(40,120,255,.45)";
      ctx.fillRect(cx - 40, wy, W + 80, H + 400 - wy);
      ctx.fillStyle = "rgba(120,200,255,.6)";
      ctx.fillRect(cx - 40, wy, W + 80, 5);
    }

    // lightning bolts
    for (const b of bolts) {
      const a = b.life / b.max;
      ctx.globalAlpha = a;
      ctx.strokeStyle = "#eaffff"; ctx.lineWidth = 4;
      ctx.shadowColor = "#5ffbf1"; ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function renderOverlays() {
    // soft always-on vignette for depth
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.92);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.6, "rgba(0,0,0,.18)");
    vg.addColorStop(1, "rgba(0,0,0,.52)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // red hurt flash
    if (player.hurt > 0.001) {
      ctx.globalAlpha = clamp(player.hurt / 0.35, 0, 1) * 0.30;
      ctx.fillStyle = "#ff2030"; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // tint (fire etc.)
    if (scr.tint && scr.tintA > 0.01) {
      ctx.globalAlpha = scr.tintA;
      ctx.fillStyle = scr.tint; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // blackout vignette with a hole around the player
    if (scr.dark > 0.01) {
      const px = player.x - camX() + player.w / 2;
      const py = player.y + player.h / 2;
      const rg = ctx.createRadialGradient(px, py, 40, px, py, 360);
      rg.addColorStop(0, "rgba(0,0,0,0)");
      rg.addColorStop(1, "rgba(0,0,0,.96)");
      ctx.globalAlpha = clamp(scr.dark, 0, 1);
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // flash
    if (scr.flash > 0.01) {
      ctx.globalAlpha = clamp(scr.flash, 0, 1) * 0.85;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // freeze hint
    if (now < freezeUntil) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#9fe8ff"; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.font = "bold 20px ui-monospace,monospace"; ctx.textAlign = "center";
      ctx.fillText("FROZEN", W / 2, 70);
    }
    // low-HP heartbeat: the closer to death, the harder the screen pulses red
    if (state === "play" && player.hp <= 1) {
      const beat = 0.5 + 0.5 * Math.sin(now * 9);
      const pulse = (player.hp === 1 ? 0.16 : 0.09) * beat * (phaseIndex() + 1) / 2;
      ctx.globalAlpha = clamp(pulse, 0, 0.4);
      ctx.fillStyle = "#ff1020"; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // film grain — a tiled noise pattern. Cheap, and it stops the clean vector
    // shapes from reading as "flash-era 2D".
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "overlay";
    const gx = (now * 137) % GRAIN_P.size, gy = (now * 211) % GRAIN_P.size;
    for (let y = -GRAIN_P.size; y < H; y += GRAIN_P.size) {
      for (let x = -GRAIN_P.size; x < W; x += GRAIN_P.size) {
        ctx.drawImage(GRAIN_P, x + gx, y + gy);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ------------------------------------------------------- grain tile  */
  // one small noise canvas, generated once, tiled every frame
  const GRAIN_P = (() => {
    const s = 128;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const g = c.getContext("2d");
    const img = g.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  /* ----------------------------------------------------------- entities  */
  // Real animated actors, not sprites flying at you. Each has behaviour
  // (a dinosaur WALKS up to you, wings FLAP and carry you) and is drawn with
  // limbs/poses, so the punishment is a scene rather than an emoji.
  const entities = [];

  function spawnEntity(type, emoji, word) {
    // ONE ACTOR AT A TIME. Two dinosaurs screaming over each other is noise,
    // not drama — a fresh disaster replaces whatever is still playing.
    if (entities.length) entities.length = 0;
    const e = {
      type, emoji: emoji || "", word: word || "",
      x: player.x + (Math.random() < 0.5 ? -1 : 1) * rand(320, 520),
      y: GROUND_Y, vx: 0, vy: 0,
      t: 0, life: 0, dying: false,
      grab: 0,          // 0..1 how much it has you
      scale: 1, flip: 1,
    };
    if (type === "dino") { e.y = GROUND_Y; e.life = 7; e.scale = rand(0.9, 1.25); }
    else if (type === "wings") { e.y = player.y - rand(90, 200); e.life = 6; e.scale = rand(0.9, 1.2); }
    else if (type === "slap") { e.y = player.y + 10; e.life = 3.2; e.scale = 1; }
    else if (type === "tornado") { e.x = player.x + rand(-260, 260); e.y = GROUND_Y; e.life = 5; e.scale = rand(0.9, 1.3); }
    e.flip = e.x > player.x ? -1 : 1;
    entities.push(e);
    return e;
  }

  function updateEntities(dt) {
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      e.t += dt;
      e.life -= dt;
      const px = player.x + player.w / 2, py = player.y + player.h / 2;

      if (e.type === "dino") {
        // WALKS toward you on its hind legs, then snaps you up in its jaws
        const toward = Math.sign(px - e.x) || 1;
        e.flip = toward;
        e.vx = toward * 190 * e.scale;
        e.x += e.vx * dt;
        if (e.x < -200 || e.x > LEVEL_W + 200) e.life = 0;
        const near = Math.abs(px - e.x) < 120 * e.scale && e.y - py > -40;
        if (near && e.grab < 1) e.grab = Math.min(1, e.grab + dt * 2.4);
        if (e.grab > 0.9) {
          // jaws clamp: hold the player up in the bite before the throw
          player.x = e.x - player.w / 2 + toward * 26;
          player.y = e.y - 150 * e.scale;
          player.vy = 0; player.onGround = false;
        }
      } else if (e.type === "wings") {
        // FLAPS down at you, then carries you upward on its beat
        e.x += (px - e.x) * dt * 1.1;
        e.y += (player.y - 120 - e.y) * dt * 0.8 + Math.sin(e.t * 3) * 26 * dt;
        if (e.grab < 1 && Math.abs(px - e.x) < 90 && Math.abs(py - e.y) < 110) {
          e.grab = Math.min(1, e.grab + dt * 3);
        }
        if (e.grab > 0.5) {
          player.vy = Math.min(player.vy, -240);
          player.flyT = Math.max(player.flyT, 0.3);
        }
      } else if (e.type === "slap") {
        // rears back, then SLAPS down across you
        e.y = player.y - 20 - Math.sin(Math.min(1, e.t / 0.55) * Math.PI) * 150;
        if (e.grab < 1 && Math.abs(px - e.x) < 150) e.grab = Math.min(1, e.grab + dt * 4);
        if (e.grab >= 1 && !e.dying) {
          e.dying = true;
          player.vx = (px < e.x ? -1 : 1) * 420;
          for (let k = 0; k < 14; k++) spawnParticle({
            x: px, y: py, vx: rand(-260, 260), vy: rand(-280, -40), grav: 900,
            emoji: "💥", size: rand(14, 30), life: 0.6, max: 0.6,
          });
        }
      } else if (e.type === "tornado") {
        // funnels toward you and whips you off your feet
        e.x += (px - e.x) * dt * 0.9;
        e.y = GROUND_Y;
        if (Math.abs(px - e.x) < 130) {
          player.vy = Math.min(player.vy, -300);
          player.vx += Math.sign(px - e.x || 1) * 200 * dt;
        }
      }
      if (e.life <= 0) entities.splice(i, 1);
    }
  }

  /* --------------------------------------------------------- draw actors */
  function drawDino(e) {
    const f = e.flip, s = e.scale, gait = e.t * 6;
    const bite = e.grab > 0.4 ? 1 : 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(s * f, s);
    // tail
    ctx.strokeStyle = "#2f6b46"; ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(10, -70);
    ctx.quadraticCurveTo(48, -80 + Math.sin(gait) * 8, 74, -46 + Math.sin(gait) * 14);
    ctx.stroke();
    // hind legs, alternating gait
    for (let i = 0; i < 2; i++) {
      const ph = gait + i * Math.PI;
      const kx = 6 + i * 10, ky = -46;
      const fx = kx + Math.sin(ph) * 12, fy = ky + 18 + Math.max(0, Math.cos(ph)) * 6;
      ctx.strokeStyle = i ? "#27603c" : "#2f6b46"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(kx, ky);
      ctx.quadraticCurveTo(kx + Math.sin(ph) * 6, ky + 12, fx, fy);
      ctx.stroke();
    }
    // body
    ctx.fillStyle = "#357a52";
    ctx.beginPath(); ctx.ellipse(0, -62, 30, 22, -0.12, 0, 6.28); ctx.fill();
    // neck + head
    ctx.strokeStyle = "#357a52"; ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(-14, -70); ctx.quadraticCurveTo(-30, -96, -44, -108);
    ctx.stroke();
    ctx.save();
    ctx.translate(-46, -110);
    ctx.rotate(bite ? -0.35 + Math.sin(e.t * 18) * 0.12 : -0.1);
    ctx.fillStyle = "#3d8a5c";
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 13, 0, 0, 6.28); ctx.fill();
    // jaws
    ctx.fillStyle = "#1d3b28";
    const open = bite ? 9 + Math.abs(Math.sin(e.t * 16)) * 7 : 3;
    ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(-30, 5); ctx.lineTo(-6, 2 + open);
    ctx.closePath(); ctx.fill();
    // teeth
    ctx.fillStyle = "#eef7f0";
    for (let i = 0; i < 3; i++) ctx.fillRect(-12 - i * 6, 2 + open * 0.3, 3, 4);
    // eye + brow
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(4, -6, 4.2, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#101c14"; ctx.beginPath(); ctx.arc(2.5, -6, 2, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "#1d3b28"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-2, -11); ctx.lineTo(12, -9); ctx.stroke();
    ctx.restore();
    // arms
    ctx.strokeStyle = "#2f6b46"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-6, -74); ctx.lineTo(-16 + Math.sin(gait) * 6, -56); ctx.stroke();
    ctx.restore();
  }

  function drawWings(e) {
    const f = e.flip, s = e.scale;
    const beat = Math.sin(e.t * (e.grab > 0.4 ? 16 : 7));
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(s * f, s);
    // body
    ctx.fillStyle = "#3b2b52";
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 20, 0, 0, 6.28); ctx.fill();
    // head
    ctx.fillStyle = "#46356a";
    ctx.beginPath(); ctx.ellipse(0, -24, 8, 9, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = "#ffe066";
    ctx.beginPath(); ctx.arc(3, -26, 1.8, 0, 6.28); ctx.fill();
    // beak
    ctx.fillStyle = "#e0b354";
    ctx.beginPath(); ctx.moveTo(5, -23); ctx.lineTo(15, -21); ctx.lineTo(5, -19); ctx.closePath(); ctx.fill();
    // two wings, beating out of phase
    for (let i = 0; i < 2; i++) {
      const a = beat * (i ? -0.9 : 0.9) - 0.3;
      ctx.save();
      ctx.translate(i ? 6 : -6, -6);
      ctx.rotate(a);
      const grd = ctx.createLinearGradient(0, 0, -46, -10);
      grd.addColorStop(0, "#6a4fa3"); grd.addColorStop(1, "#33244d");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-26, -18, -48, -6);
      ctx.quadraticCurveTo(-30, 10, 0, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSlap(e) {
    const f = e.flip;
    const down = e.grab >= 1;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(f, 1);
    // forearm
    const grd = ctx.createLinearGradient(0, -170, 0, -10);
    grd.addColorStop(0, "#6b5a8a"); grd.addColorStop(1, "#3b2f52");
    ctx.fillStyle = grd;
    ctx.fillRect(-16, -150, 32, 140);
    // cuff
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(-20, -160, 40, 22);
    // palm
    ctx.fillStyle = "#c98f6b";
    ctx.beginPath(); ctx.ellipse(0, -6, 30, 24, 0, 0, 6.28); ctx.fill();
    // fingers + motion blur when it lands
    for (let i = 0; i < 4; i++) {
      const fx = -20 + i * 14;
      ctx.beginPath(); ctx.ellipse(fx, 12, 8, 15, (i - 1.5) * 0.1, 0, 6.28); ctx.fill();
    }
    ctx.strokeStyle = "#9c6a4d"; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const fx = -20 + i * 14;
      ctx.beginPath(); ctx.moveTo(fx, 6); ctx.lineTo(fx, 20); ctx.stroke();
    }
    if (down) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(0, -6, 30 + i * 16, -0.9, 0.9);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawTornado(e) {
    const s = e.scale;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(s, s);
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      const yy = -t * 220;
      const rr = 46 * (1 - t) + 10;
      ctx.globalAlpha = 0.35 + 0.3 * (1 - t);
      ctx.strokeStyle = "#8fd6e8";
      ctx.lineWidth = 7 * (1 - t) + 2;
      ctx.beginPath();
      ctx.ellipse(Math.sin(e.t * 5 + i) * 10, yy, rr, rr * 0.28, 0, 0, 6.28);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // debris orbiting the funnel
    for (let i = 0; i < 8; i++) {
      const a = e.t * 6 + i;
      const rr = 52 * (1 - (i % 5) / 5);
      ctx.fillStyle = "#cfe9f5";
      ctx.fillRect(Math.cos(a) * rr, -20 - (i % 5) * 42 + Math.sin(a) * 6, 5, 5);
    }
    ctx.restore();
  }

  function drawEntities() {
    for (const e of entities) {
      ctx.save();
      if (e.type === "dino") drawDino(e);
      else if (e.type === "wings") drawWings(e);
      else if (e.type === "slap") drawSlap(e);
      else if (e.type === "tornado") drawTornado(e);
      ctx.restore();
      // ground shadow so actors sit in the world
      if (e.type === "dino" || e.type === "slap") {
        ctx.globalAlpha = 0.3; ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(e.x, GROUND_Y + 4, 46 * e.scale, 8, 0, 0, 6.28);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ------------------------------------------------- foreground & props  */
  // Props give the level a sense of place. Deterministic per index, so they
  // never pop or jitter as the camera moves.
  const PROPS = (() => {
    const out = [];
    for (let i = 0; i < 46; i++) {
      const x = 60 + i * 78 + h1(i * 5.3) * 40;
      if (x > LEVEL_W - 80) break;
      const kind = Math.floor(h1(i * 3.7) * 4);
      if (kind === 3 && i % 3 !== 0) continue;   // thin out some kinds
      out.push({ x, kind, s: 0.7 + h1(i * 7.1) * 0.7, ph: h1(i * 2.9) * 6.28 });
    }
    return out;
  })();

  function drawProp(p) {
    if (p.x < camX() - 120 || p.x > camX() + W + 120) return;
    const y = GROUND_Y;
    ctx.save();
    ctx.translate(p.x, y);
    ctx.scale(p.s, p.s);
    if (p.kind === 0) {
      // gravestone
      ctx.fillStyle = "#1a2436";
      ctx.beginPath();
      ctx.moveTo(-11, 0); ctx.lineTo(-11, -22);
      ctx.arc(0, -22, 11, Math.PI, 0); ctx.lineTo(11, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(140,170,200,.25)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(140,170,200,.18)";
      ctx.fillRect(-5, -16, 10, 2); ctx.fillRect(-5, -10, 10, 2);
    } else if (p.kind === 1) {
      // dead tree
      ctx.strokeStyle = "#101a2b"; ctx.lineCap = "round";
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-2, -46); ctx.stroke();
      ctx.lineWidth = 3;
      for (let b = 0; b < 4; b++) {
        const s = b % 2 ? 1 : -1;
        const yy = -18 - b * 9;
        ctx.beginPath(); ctx.moveTo(-2, yy);
        ctx.quadraticCurveTo(s * 12, yy - 6, s * (16 + h1(b) * 8), yy - 20 - h1(b + 3) * 10);
        ctx.stroke();
      }
    } else if (p.kind === 2) {
      // lantern with a live flame
      const fl = 0.72 + 0.28 * Math.sin(now * 9 + p.ph) * Math.sin(now * 5.3 + p.ph * 2);
      ctx.strokeStyle = "#0f1726"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -40); ctx.lineTo(10, -40); ctx.stroke();
      ctx.fillStyle = "#0d1420";
      ctx.fillRect(6, -40, 9, 12);
      const g = ctx.createRadialGradient(10, -34, 1, 10, -34, 26);
      g.addColorStop(0, "rgba(255,200,110," + (0.55 * fl).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,160,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(10, -34, 26, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(255,235,180," + (0.9 * fl).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(10, -34, 2.6, 0, 6.28); ctx.fill();
    } else {
      // grass tufts
      ctx.strokeStyle = "#16351f"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let b = 0; b < 6; b++) {
        const sx = -12 + b * 5;
        const bend = Math.sin(now * 1.4 + p.ph + b) * 3;
        ctx.beginPath(); ctx.moveTo(sx, 0);
        ctx.quadraticCurveTo(sx + bend, -9, sx + bend * 1.7, -16 - h1(b) * 7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // near-black silhouettes drawn IN FRONT of the player: the single cheapest
  // trick for making a side-scroller feel like it has depth.
  function drawForeground(cx) {
    const par = 1.35;
    const step = 150;
    const start = Math.floor((cx * par - 200) / step);
    const end = Math.ceil((cx * par + W + 200) / step);
    ctx.fillStyle = "#05070d";
    for (let j = start; j <= end; j++) {
      const x = j * step - cx * par;
      const tall = h1(j * 4.1);
      if (tall < 0.34) {
        // a broken pillar
        const hgt = 70 + h1(j * 2.2) * 110;
        ctx.fillRect(x, H - 30 - hgt, 26, hgt);
        ctx.fillRect(x - 6, H - 34 - hgt, 38, 10);
      } else if (tall < 0.62) {
        // hanging chain
        ctx.fillRect(x + 16, 0, 3, 90 + h1(j) * 60);
      } else {
        // grass blades along the very bottom
        ctx.beginPath();
        ctx.moveTo(x - 40, H);
        for (let k = 0; k <= 8; k++) {
          const bx = x - 40 + k * 10;
          ctx.lineTo(bx, H - 12 - h1(j * 3 + k) * 22);
          ctx.lineTo(bx + 5, H);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------- bloom  */
  // Everything neon re-emits into an additive, blurred layer. Approximate shapes
  // are fine here — this is the light, not the art.
  function drawBloom() {
    g2.clearRect(0, 0, W, H);
    g2.save();
    try { g2.filter = "blur(11px)"; } catch (e) { /* older engines: unblurred */ }
    g2.globalCompositeOperation = "lighter";

    // the portal — the brightest thing in the game, so you always know where home is
    const gcx = GOAL.x + GOAL.w / 2, gcy = GOAL.y + GOAL.h / 2;
    const p = 0.5 + 0.5 * Math.sin(now * 3);
    g2.globalAlpha = 0.55 + p * 0.35;
    g2.fillStyle = "#7dff8f";
    g2.beginPath(); g2.arc(gcx, gcy, GOAL.w * (0.8 + p * 0.25), 0, 6.28); g2.fill();

    // checkpoints
    for (const cp of CHECKPOINTS) {
      if (cp.x < camX() - 200 || cp.x > camX() + W + 200) continue;
      g2.globalAlpha = cp.reached ? 0.5 : 0.18;
      g2.fillStyle = cp.reached ? "#57f7a0" : "#7c8ba8";
      g2.beginPath(); g2.arc(cp.x, cp.y - 50, 26, 0, 6.28); g2.fill();
    }

    // souls
    for (const c of coinList) {
      if (c.got) continue;
      if (c.x < camX() - 100 || c.x > camX() + W + 100) continue;
      g2.globalAlpha = 0.5;
      g2.fillStyle = "#ffd75e";
      g2.beginPath(); g2.arc(c.x, c.y, 14, 0, 6.28); g2.fill();
    }

    // spike strips glow like a warning
    for (const hz of HAZARDS) {
      if (hz.x + hz.w < camX() - 200 || hz.x > camX() + W + 200) continue;
      g2.globalAlpha = 0.16 + 0.08 * Math.sin(now * 3 + hz.x);
      g2.fillStyle = "#ff4a4a";
      g2.beginPath(); g2.ellipse(hz.x + hz.w / 2, hz.y, hz.w * 0.9, 12, 0, 0, 6.28); g2.fill();
    }

    // the Mastermind's eye
    const ew = 74 + dread() * 34, ex2 = W * 0.27 - camX() * 0.02, ey2 = H * 0.17;
    g2.globalAlpha = 0.30 + dread() * 0.30;
    g2.fillStyle = "#ff2f6e";
    g2.beginPath(); g2.arc(ex2, ey2, ew * 0.7, 0, 6.28); g2.fill();

    // the player
    if (state === "play" || state === "dead") {
      const flash = player.hurt > 0.01 ? 1 : 0;
      g2.globalAlpha = 0.55 + 0.2 * Math.sin(now * 5);
      g2.fillStyle = flash ? "#ff5566" : (meta.owned.aura && player.hp <= 1 ? "#ff3b50" : "#63d8ff");
      g2.beginPath();
      g2.ellipse(player.x - camX() + player.w / 2, player.y + player.h / 2,
        player.w * 0.62, player.h * 0.62, 0, 0, 6.28);
      g2.fill();
    }

    g2.restore();
    g2.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    renderBackground(camX());
    renderWorld();
    renderOverlays();
    drawBloom();
  }

  /* ----------------------------------------------------------------- loop */
  function loop(t) {
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05; // clamp big pauses
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  /* ----------------------------------------------------------------- wiring */
  $("startBtn").addEventListener("click", () => {
    initAudio();
    elStart.classList.add("hidden");
    reset();
    // the Mastermind introduces himself the first time only
    if (!meta.seenIntro) {
      meta.seenIntro = true; saveMeta();
      playCine(CINE_INTRO);
    }
  });
  $("againBtn").addEventListener("click", () => { reset(); });
  $("retryBtn").addEventListener("click", () => { respawn(); });

  /* -------------------------------------------------------------- cutscene */
  // The Mastermind narrates. Runs with the game paused (state="cine"), typed out
  // a character at a time, and skippable with any key / click / the SKIP button.
  const CINE_INTRO = [
    ["THE MANUAL", "Welcome. Please stop reading this."],
    ["THE MASTERMIND", "I have been watching you read it."],
    ["THE MANUAL", "The keys are on this page. They are correct. Do not trust me."],
    ["THE MASTERMIND", "Press anything. I will be the one who explains what it meant."],
    ["THE MASTERMIND", "Get to the portal. Or don't. The souls you carry home are the only thing you will keep."],
  ];
  const CINE_WIN = [
    ["THE MASTERMIND", "...you actually did it."],
    ["THE MASTERMIND", "I did not think you would. That is not a compliment."],
    ["THE PORTAL", "Whatever you are, you are through. Try not to lose it on the way back."],
  ];
  const CINE_DEATH = [
    ["THE MASTERMIND", "Ah."],
    ["THE MASTERMIND", "The ones you were carrying did not make it. Only the banked ones did."],
  ];
  const cine = { on: false, lines: [], i: 0, ch: 0, t: 0, after: null };
  function playCine(lines, after) {
    cine.on = true; cine.lines = lines; cine.i = 0; cine.ch = 0; cine.t = 0;
    cine.after = after || null;
    state = "cine";
    held.clear();
    armed.left = armed.right = armed.jump = false;
    showCineLine();
    elCine.classList.remove("hidden");
  }
  function showCineLine() {
    const l = cine.lines[cine.i];
    elCineName.textContent = l[0];
    elCineText.textContent = "";
  }
  function advanceCine() {
    if (!cine.on) return;
    const full = cine.lines[cine.i][1];
    if (cine.ch < full.length) { cine.ch = full.length; elCineText.textContent = full; return; }
    cine.i++; cine.ch = 0; cine.t = 0;
    if (cine.i >= cine.lines.length) { endCine(); return; }
    showCineLine();
  }
  function endCine() {
    cine.on = false;
    elCine.classList.add("hidden");
    const after = cine.after; cine.after = null;
    if (after) after(); else state = "play";
  }
  function updateCine(dt) {
    if (!cine.on) return;
    const full = cine.lines[cine.i][1];
    cine.t += dt;
    const per = 0.028; // chars per second-ish
    if (cine.t >= per) {
      cine.t -= per;
      if (cine.ch < full.length) { cine.ch++; elCineText.textContent = full.slice(0, cine.ch); }
    }
    // subtle voice tick while typing
    if (cine.ch < full.length && cine.ch % 3 === 0 && cine.t > 0) tone(180 + Math.random() * 60, 0.02, "square", 0.012);
  }
  elCineSkip.addEventListener("click", (e) => { e.stopPropagation(); endCine(); });
  elCine.addEventListener("click", () => advanceCine());
  /* ------------------------------------------------------------- codex  */
  // The permanent record of what you have learned. Deaths erase souls but
  // never this — it is the one thing you always take with you.
  const TOTAL_LIFT_WORDS = 22;   // unknown slots shown as hints to chase
  function renderCodex() {
    const words = Object.keys(meta.known);
    words.sort((a, b) => a.localeCompare(b));
    let html = "";
    for (const w of words) {
      const e = meta.known[w];
      html += "<div class='codexrow'><b>" + w.toUpperCase() + "</b><span>" + e.v + "</span></div>";
    }
    // undiscovered slots, so there is always a visible next thing to find
    for (let i = words.length; i < TOTAL_LIFT_WORDS; i++) {
      html += "<div class='codexrow unknown'><b>? ? ?</b><span>not yet learned</span></div>";
    }
    elCodexList.innerHTML = html;
    elCodexCount.textContent = words.length;
    elCodexFoot.textContent = words.length + " / " + TOTAL_LIFT_WORDS + " discovered — press random keys until something throws you.";
  }
  function openCodex() {
    if (state === "shop" || state === "cine") return;
    prevCodexState = state;
    state = "codex";
    renderCodex();
    elCodex.classList.remove("hidden");
  }
  function closeCodex() {
    if (state !== "codex") return;
    state = prevCodexState === "codex" ? "play" : prevCodexState;
    elCodex.classList.add("hidden");
    if (state === "play") rollContract();
    updateHud();
  }
  let prevCodexState = "menu";

  /* -------------------------------------------------------------- the dealer */
  // spending banked souls — the reward for a clean run, the reason banking mattered
  const SHOP_ITEMS = [
    { id: "peek", name: "PEEK", desc: "reveal the real keys for 3 seconds", cost: 3, consumable: true },
    { id: "trail", name: "SPECTRAL TRAIL", desc: "a ghostly trail follows you (cosmetic)", cost: 8 },
    { id: "aura", name: "CURSED AURA", desc: "a red aura when you are near death (cosmetic)", cost: 12 },
  ];
  let prevState = "menu";
  function openShop() {
    if (state === "win" || state === "dead" || state === "shop") return;
    prevState = state;
    state = "shop";
    renderShop();
    elShop.classList.remove("hidden");
  }
  function closeShop() {
    if (state !== "shop") return;
    state = prevState === "shop" ? "play" : prevState;
    elShop.classList.add("hidden");
    if (state === "play") rollContract();
    updateHud();
  }
  function renderShop() {
    elShopBank.textContent = meta.banked;
    let html = "";
    for (const it of SHOP_ITEMS) {
      const owned = it.consumable ? false : !!meta.owned[it.id];
      const afford = meta.banked >= it.cost;
      const label = owned ? "OWNED" : (it.consumable ? "BUY" : "UNLOCK");
      html += "<div class='shoprow'>" +
        "<div class='shopinfo'><b>" + it.name + "</b><span>" + it.desc + "</span></div>" +
        "<button data-item='" + it.id + "'" + ((owned || !afford) ? " disabled" : "") + ">" +
        (owned ? "OWNED" : label + " · " + it.cost) + "</button></div>";
    }
    elShopList.innerHTML = html;
  }
  function buyItem(id) {
    const it = SHOP_ITEMS.find((x) => x.id === id);
    if (!it || state !== "shop") return;
    if (!it.consumable && meta.owned[id]) return;
    if (meta.banked < it.cost) { showToast("NOT ENOUGH SOULS", 1.2); return; }
    meta.banked -= it.cost;
    if (it.consumable) {
      saveMeta(); closeShop();
      revealUntil = now + 3;
      showToast("\uD83D\uDC41 THE KEYS: " + keyLabel(contract.left) + " moves left, " + keyLabel(contract.right) + " moves right. (There is no jump key.)", 3.4);
    } else {
      meta.owned[id] = true; saveMeta(); renderShop(); updateHud();
      tone(700, 0.12, "square", 0.06, 990);
    }
  }
  $("codexBtn").addEventListener("click", () => { openCodex(); $("codexBtn").blur(); });
  $("closeCodex").addEventListener("click", () => { closeCodex(); });

  $("shopBtn").addEventListener("click", () => { openShop(); $("shopBtn").blur(); });
  $("closeShop").addEventListener("click", () => { closeShop(); });
  elShopList.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.item) buyItem(t.dataset.item);
  });

  $("revealBtn").addEventListener("click", () => {
    if (state !== "play") return;
    revealUntil = now + 2.5;
    punishments++; elPunish.textContent = punishments;
    showToast("the truth costs you", 1.4);
    const id = choice(ALL_KEYS);
    const m = nextMeaning(id);
    runEffect(m.type, m.emoji, m.word, id);
    $("revealBtn").blur();
  });
  $("muteBtn").addEventListener("click", (e) => {
    muted = !muted;
    e.currentTarget.textContent = muted ? "🔇" : "🔊";
    e.currentTarget.blur();
  });

  // initial paint so the menu has something behind it
  rollContract();
  refreshManual();
  updateHud();
  requestAnimationFrame(loop);

  // read-only debug view (used by headless regression tests; harmless in play)
  window.__KAL = {
    get state() { return state; },
    get contract() { return { left: contract.left, right: contract.right, jump: contract.jump }; },
    get armed() { return { left: armed.left, right: armed.right, jump: armed.jump }; },
    get held() { return Array.from(held); },
    get player() { return { x: player.x, y: player.y, vx: player.vx, vy: player.vy }; },
    get punishments() { return punishments; },
    get hp() { return player.hp; },
    get phase() { return phaseIndex(); },
    get carried() { return carried; },
    get banked() { return meta.banked; },
    get streak() { return streak; },
    rollContract,
    // QA only: jump the player somewhere for automated screenshots/regressions.
    warp(x) {
      if (state !== "play") return false;
      player.x = clamp(x, 0, LEVEL_W - player.w);
      player.y = GROUND_Y - player.h;
      player.vx = 0; player.vy = 0;
      camCur = clamp(player.x - W * 0.38, 0, LEVEL_W - W);
      return true;
    },
    get probes() { return probes; },
    get known() { return meta.known; },
    get codexCount() { return Object.keys(meta.known).length; },
    // QA only: seed carried souls so economy tests exercise logic, not luck.
    grantSouls(n) { carried += n; coins = carried; updateHud(); return carried; },
  };
})();
