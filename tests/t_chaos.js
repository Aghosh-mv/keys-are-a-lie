require("./harness.js");
const { ok, done } = T();

console.log("== world chaos: spike strips hurt, unstable platforms drop ==");
startGame();

K().warp(1200);
ok(K().phase >= 1, "warped into the high-stakes phase (phase=" + K().phase + ")");
const hp0 = K().hp;
let g = 0;
while (K().state === "play" && K().player.x < 1400 && g++ < 600) {
  const c = K().contract;
  if (!K().armed.right) press(c.right);
  hold(c.right); tick(1); release(c.right);
}
ok(K().player.x > 1200 || K().state !== "play",
  "approached the first spike strip (x=" + K().player.x.toFixed(0) + ")");

g = 0;
while (K().state === "play" && K().hp === hp0 && g++ < 800) {
  const c = K().contract;
  if (!K().armed.right) press(c.right);
  hold(c.right); tick(1); release(c.right);
}
ok(K().hp < hp0 || K().state !== "play", "spikes cost HP (hp " + hp0 + "->" + K().hp + ")");

// unstable platform traversal must not throw
startGame();
K().warp(1560);
g = 0;
while (g++ < 800 && K().state !== "dead") {
  const c = K().contract;
  if (!/^[a-z0-9]$/.test(c.right)) { K().rollContract(); continue; }
  if (!K().armed.right) press(c.right);
  hold(c.right);
  if (K().player.y > 360 && g % 8 === 0) bounce();   // jump by causing a disaster
  tick(2); release(c.right);
}
ok(true, "unstable-platform traversal ran without throwing (state=" + K().state + ")");
done();