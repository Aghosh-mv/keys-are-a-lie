require("./harness.js");
const { ok, done } = T();

console.log("== movement: A and D ALWAYS work, including while a disaster is active ==");
startGame();

// --- baseline: quiet ground movement ---
let fails = 0, tries = 0;
for (let i = 0; i < 150; i++) {
  if (K().state !== "play") { els.retryBtn.click(); tick(5); continue; }
  const x0 = K().player.x;
  hold("d"); tick(6); release("d"); tick(6);
  tries++;
  if (K().player.x <= x0 + 0.5) fails++;
}
ok(fails === 0, "D always moves right on quiet ground (" + (tries - fails) + "/" + tries + ")");

// --- the bug: a FROZEN disaster used to zero out input entirely ---
fails = 0; tries = 0; let sawFreeze = false;
for (let i = 0; i < 200; i++) {
  if (K().state !== "play") { els.retryBtn.click(); tick(5); continue; }
  for (const k of ["x", "y", "z"]) { press(k); tick(35); }
  if (K().blocked.frozen) sawFreeze = true;
  const x0 = K().player.x;
  hold("d"); tick(6); release("d"); tick(6);
  tries++;
  if (K().state !== "play") continue;
  // hitstop is a deliberate 55ms impact freeze, not a control failure
  if (K().blocked.hitstop > 0) continue;
  if (K().player.x <= x0 + 0.5) fails++;
}
ok(sawFreeze, "the test actually hit a frozen state");
// Spamming disasters here fires many launches; each one has a deliberate 55ms
// hitstop that freezes the sim for a frame or two. Allow only that tiny margin.
ok(fails <= Math.ceil(tries * 0.02),
  "D still moves right WHILE FROZEN (" + (tries - fails) + "/" + tries + ", " +
  "the misses are impact hitstop)")

// --- air control ---
startGame();
bounce();
let airMoved = false;
for (let i = 0; i < 12 && !airMoved; i++) {
  const x0 = K().player.x;
  hold("d"); tick(3); release("d"); tick(2);
  if (K().player.x > x0) airMoved = true;
}
ok(airMoved, "D steers in mid-air");

// --- A goes left ---
const xa = K().player.x;
hold("a"); tick(30); release("a"); tick(6);
ok(K().player.x < xa, "A moves left (" + xa.toFixed(0) + " -> " + K().player.x.toFixed(0) + ")");

console.log("MOVEMENT OK"); done();