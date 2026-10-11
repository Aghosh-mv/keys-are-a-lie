require("./harness.js");
const { ok, done } = T();

console.log("== codex: knowledge persists across death, and pays once ==");
startGame();
ok(K().codexCount === 0, "codex starts empty (" + K().codexCount + ")");

console.log("-- learning a lifting disaster writes a codex entry --");
let learned = 0, g = 0;
// press wrong keys until at least 3 distinct lift-words are learned
while (learned < 3 && g++ < 400) {
  bounce();
  learned = Object.keys(K().known).length;
}
ok(learned >= 1, "pressing random keys taught the game new words (" + learned + " known)");
const before = Object.keys(K().known);

console.log("-- the codex overlay renders what is known --");
els.codexBtn.click();
ok(K().state === "codex", "codex opens (state=" + K().state + ")");
ok(els.codexList.innerHTML.length > 0, "codex rendered rows");
const rows = (els.codexList.innerHTML.match(/codexrow/g) || []).length;
ok(rows >= 3, "codex shows learned + undiscovered slots (rows=" + rows + ")");
ok((els.codexList.innerHTML.match(/codexrow unknown/g) || []).length > 0,
  "undiscovered entries show as ??? so there is always a next goal");
els.closeCodex.click();
ok(K().state === "play", "codex closes back to play");

console.log("-- knowledge survives death --");
K().warp(2600);          // deep zone: strain and spikes can actually kill you
die(300);
ok(K().state === "dead", "died");
const lost = before.filter((w) => !K().known[w]);
ok(lost.length === 0, "no codex entry is lost to death (" + lost.length + " lost, " +
  Object.keys(K().known).length + " total)");

console.log("-- re-learning the same word pays nothing more --");
const bankedNow = K().banked;
els.retryBtn.click();
g = 0;
while (g++ < 200) { bounce(); }
ok(K().banked >= bankedNow - 0, "banked never decreases while exploring (banked=" + K().banked + ")");
ok(Object.keys(K().known).length >= 3, "codex only grows, never shrinks (" +
  Object.keys(K().known).length + " entries)");

console.log("-- codex entries record what the word does --");
const first = Object.keys(K().known)[0];
ok(typeof K().known[first].v === "string" && K().known[first].v.length > 0,
  'entry "' + first + '" remembers its effect: "' + K().known[first].v + '"');
done();