require("./harness.js");
const { ok, done } = T();

console.log("== anti-farm: souls lost on death must NOT be re-collectable ==");
startGame();

K().grantSouls(1);
ok(K().carried >= 1, "carrying a soul, un-banked (carried=" + K().carried + ")");
ok(K().banked === 0, "nothing banked before any checkpoint (banked=" + K().banked + ")");

// x=1200 is past the damage boundary (~1166) but before the checkpoint (1400)
K().warp(1200);
ok(K().phase >= 1, "in the damage phase (phase=" + K().phase + ")");
ok(K().banked === 0, "warp did NOT cross the checkpoint (banked=" + K().banked + ")");

die();
ok(K().state === "dead", "died in the damage zone (state=" + K().state + ")");
ok(K().carried === 0, "the un-banked soul is gone (carried=" + K().carried + ")");
ok(K().banked === 0, "nothing banked, so nothing survives (banked=" + K().banked + ")");

els.retryBtn.click();
ok(K().state === "play", "respawned");
ok(K().carried === 0, "still carrying nothing after respawn");
ok(K().banked === 0, "no souls farmed by respawning (banked=" + K().banked + ")");
done();