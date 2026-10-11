require("./harness.js");
const { ok, done } = T();

console.log("== stakes: HP by phase, banking, death cost, cutscenes, respawn ==");
els.startBtn.click();
ok(K().state === "cine", "intro cutscene plays on first start");
ok(els.cineName.textContent.length > 0, "cutscene has a speaker (" + els.cineName.textContent + ")");
skipCine();
ok(K().state === "play", "skip returns to play");
ok(K().hp === 3, "full HP at start");

console.log("-- there is no jump key --");
ok(K().contract.jump === null, "the contract has NO jump key (jump=" + K().contract.jump + ")");
ok(els.slotJump.textContent === "NONE", "the manual shows the jump slot as NONE");

console.log("-- phase 1 is safe: you can jump freely by causing disasters --");
const c0 = K().contract;
for (const k of "qwertyuio".split("")) {
  if (k === c0.left || k === c0.right) continue;
  press(k); tick(30);
}
ok(K().hp === 3, "phase 1: wrong keys do NOT damage");

console.log("-- jumping by CAUSING a disaster (there is no jump key) --");
tick(30);                       // settle on the ground first
K().warp(300);
const y0 = K().player.y;
bounce();
ok(K().player.y < 360, "pressing wrong keys got the player off the ground (y " +
  y0.toFixed(0) + "->" + K().player.y.toFixed(0) + ", ground top ~368)");

console.log("-- collecting + banking (phase 1, safe) --");
K().grantSouls(3);
ok(K().carried === 3, "carrying 3 souls (carried=" + K().carried + ")");
runTo(1450);
ok(K().streak >= 1, "checkpoint reached -> streak=" + K().streak);
ok(K().banked >= 3, "souls BANKED at the checkpoint (banked=" + K().banked + ")");
ok(K().carried === 0, "carried cleared after banking");

console.log("-- late phase: non-launching disasters hurt --");
K().warp(2600);
ok(K().phase >= 1, "in the damage phase (phase=" + K().phase + ")");
const hpBefore = K().hp;
let hits = 0;
for (let i = 0; i < 40 && K().hp === hpBefore && K().state === "play"; i++) {
  press(wrongKey()); tick(30);
  hits++;
}
ok(K().hp < hpBefore || K().state !== "play",
  "a disaster that does NOT move you costs HP (hp " + hpBefore + "->" + K().hp + ")");

console.log("-- death costs carried, keeps banked --");
const bankedBefore = K().banked;
K().warp(2600);
die(120, false);
ok(K().state === "cine", "death cutscene plays (state=" + K().state + ")");
skipCine();
ok(K().state === "dead", "death overlay shown");
ok(K().banked === bankedBefore, "banked souls SURVIVE death (banked=" + K().banked + ")");
ok(K().carried === 0, "carried souls LOST on death");
ok(K().streak === 0, "streak reset on death");
ok(/banked kept/.test(els.deathStats.textContent), "death screen states the loss");

console.log("-- respawn --");
els.retryBtn.click();
ok(K().state === "play", "respawn -> play");
ok(K().hp === 3, "respawn at full HP");
ok(K().player.x > 1000, "respawned at last checkpoint (x=" + K().player.x.toFixed(0) + ")");

console.log("-- shop economy --");
K().warp(2500);           // crosses checkpoints -> banks anything carried
const b0 = K().banked;
els.shopBtn.click();
const shopClick = els.shopList._L["click"][0];
if (b0 >= 3) {
  shopClick({ target: { dataset: { item: "peek" } } });
  ok(K().state === "play", "peek bought -> shop closes");
  ok(K().banked === b0 - 3, "peek cost 3 souls (banked " + b0 + "->" + K().banked + ")");
} else {
  // too poor: buying must be refused, not silently free
  shopClick({ target: { dataset: { item: "peek" } } });
  ok(K().state === "shop", "cannot buy without enough banked souls (banked=" + b0 + ")");
  ok(K().banked === b0, "a refused purchase costs nothing");
  ok(/disabled/.test(els.shopList.innerHTML), "unaffordable items render disabled");
}
done();