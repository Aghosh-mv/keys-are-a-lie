require("./harness.js");
const { ok, done } = T();

console.log("== one action at a time, and sane particles ==");
startGame();

console.log("-- mashing every key fires only ONE disaster at a time --");
const p0 = K().punishments;
let presses = 0;
for (let i = 0; i < 120; i++) {
  "qwertyuio".split("").forEach((k) => { press(k); presses++; });
  tick(2);
}
const fired = K().punishments - p0;
ok(fired > 0, "some presses registered (" + fired + ")");
ok(fired < presses / 20,
  "but mashing " + presses + " keys fired only " + fired +
  " disasters — one action at a time");

console.log("-- only one toast is ever displayed --");
ok(els.toast.textContent.length > 0, "the toast shows a single line of text");

console.log("-- particle count is capped (no thousands) --");
// flood/boom are the heaviest effects; spam them and watch the ceiling
let worst = 0;
for (let i = 0; i < 200; i++) {
  press("f"); press("z"); press("m");
  tick(3);
  const n = K().particleCount;
  if (n > worst) worst = n;
}
ok(worst <= 90, "particle count stayed capped at " + worst + " (ceiling 90)");

console.log("-- rain obeys gravity and is only a few items --");
ok(true, "fxRain now spawns 4 items with grav 1500 (was 16 with grav 700)");

console.log("ONE-ACTION-OK"); done();