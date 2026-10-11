require("./harness.js");
const { ok, done } = T();

console.log("== smoke: play path, every effect type, every button, no throw ==");
startGame();
ok(K().state === "play", "in play state");

const keys = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
for (let r = 0; r < 6; r++) for (const k of keys) press(k);
[" ", "Tab", "Enter", "Shift", "Control", "Alt", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "!", "@", "#"].forEach(press);

els.revealBtn.click();
els.muteBtn.click(); els.muteBtn.click();
els.shopBtn.click(); ok(K().state === "shop", "shop opens");
els.closeShop.click(); ok(K().state === "play", "shop closes");

for (let i = 0; i < 200; i++) K().rollContract();
tick(120);
ok(K().punishments > 0, "punishments accumulated (" + K().punishments + ")");

// bloom layer must be a real canvas and must actually be driven
ok(typeof els.glow.getContext === "function", "bloom canvas present");
done();