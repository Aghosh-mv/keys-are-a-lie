require("./harness.js");
const { ok, done } = T();

console.log("== probes: SHIFT turns guessing into deduction ==");
startGame();
ok(K().probes === 3, "start with 3 probes (probes=" + K().probes + ")");

// SHIFT must never be one of the three real controls (it is the modifier)
let leak = 0;
for (let i = 0; i < 300; i++) {
  K().rollContract();
  const c = K().contract;
  if (c.left === "shift" || c.right === "shift" || c.jump === "shift") leak++;
}
ok(leak === 0, "SHIFT is never a control key across 300 rolls (leaks=" + leak + ")");

// a probe on a REAL control key tells the truth and arms it
K().rollContract();
let it = 0; while (it++ < 500) { if (/^[a-z0-9]$/.test(K().contract.right)) break; K().rollContract(); }
const right = K().contract.right;
const hp0 = K().hp, pun0 = K().punishments, p0 = K().probes;
hold("shift"); hold(right); release("shift");   // hold the probed key, as a player would
ok(K().probes === p0 - 1, "probing spent a probe (" + p0 + "->" + K().probes + ")");
ok(K().armed.right === true, "probe revealed AND armed the real control key");
ok(K().punishments === pun0, "probing a real control caused no punishment");
ok(K().hp === hp0, "probing cost no health");
const mx = K().player.x; tick(20);
ok(K().player.x > mx + 5, "the probed key then actually moves you (" + (K().player.x - mx).toFixed(1) + ")");
release(right);

// a probe on a NON-control key tells the truth ("nothing") and never punishes
it = 0;
while (it++ < 500) {
  const c = K().contract;
  const bad = ["q", "w", "e", "r", "t", "y", "u", "i", "o"].find((k) =>
    k !== c.left && k !== c.right && k !== c.jump);
  if (bad) { global.__bad = bad; break; }
  K().rollContract();
}
const bad = global.__bad;
const pun1 = K().punishments, hp1 = K().hp;
hold("shift"); press(bad); release("shift");
ok(K().punishments === pun1, "probing a wrong key caused NO punishment");
ok(K().hp === hp1, "probing a wrong key cost no health");

// probes are finite: at zero, SHIFT is powerless (and says so)
while (K().probes > 0) { hold("shift"); press("z"); release("shift"); }
ok(K().probes === 0, "probes can be spent down to 0");
K().rollContract();
it = 0; while (it++ < 500) { const c = K().contract; const b = ["q", "w", "e"].find((k) => k !== c.left && k !== c.right && k !== c.jump); if (b) { global.__b2 = b; break; } K().rollContract(); }
const pun2 = K().punishments;
// holding would do nothing by design; press repeatedly with gaps past the lock
hold("shift");
let punished = false;
for (let i = 0; i < 6 && !punished; i++) {
  press(global.__b2); tick(40);
  punished = K().punishments > pun2;
}
release("shift");
ok(punished, "with 0 probes, SHIFT no longer protects you (punished)");

// checkpoints grant a probe
runTo(1450);
ok(K().probes >= 1, "checkpoint granted a probe (probes=" + K().probes + ")");
done();