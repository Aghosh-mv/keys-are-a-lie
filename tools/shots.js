/* Capture the four act screenshots + UI screens for the submission README. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.resolve(__dirname, "..");
const IDX = path.join(DIR, "index.html");
const OUT = path.join(DIR, "dist", "screenshots");
const original = fs.readFileSync(IDX, "utf8");

fs.mkdirSync(OUT, { recursive: true });

const shots = [
  ["01-bamboo-shrine", 300, ['q', 'e']],
  ["02-spirit-forest", 1250, ['w', 't']],
  ["03-red-gate", 2350, ['e', 'r']],
  ["04-dragons-end", 3150, ['d', 's', 'q']],
];

function shoot(name, warp, keys, after) {
  const js =
    `const K=window.__KAL;` +
    `document.getElementById("startBtn").click();` +
    `while(K.state==="cine") document.getElementById("cineSkip").click();` +
    (warp !== null ? `K.warp(${warp});` : "") +
    (keys ? `${JSON.stringify(keys)}.forEach(k=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:k}));window.dispatchEvent(new KeyboardEvent("keyup",{key:k}));});` : "") +
    (after || "");
  const inject = `<script>window.addEventListener("load",()=>{setTimeout(()=>{${js}},60);});</script>\n</body>`;
  fs.writeFileSync(IDX, original.replace("</body>", inject));
  execFileSync("google-chrome", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--window-size=960,540", "--virtual-time-budget=2500",
    "--screenshot=" + path.join(OUT, name + ".png"),
    "file://" + IDX,
  ], { stdio: "ignore" });
  console.log("shot:", name);
}

for (const [name, warp, keys] of shots) shoot(name, warp, keys);

// UI screens
shoot("05-codex", 1100, null, `K.grantSouls(0);["q","w","e","r"].forEach(k=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:k}));window.dispatchEvent(new KeyboardEvent("keyup",{key:k}));});document.getElementById("codexBtn").click();`);
shoot("06-dealer", 1100, null, `["q","w","e"].forEach(k=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:k}));window.dispatchEvent(new KeyboardEvent("keyup",{key:k}));});document.getElementById("shopBtn").click();`);
shoot("07-title", null, null, ``);
shoot("08-cutscene", null, null, `document.getElementById("startBtn").click();`);

fs.writeFileSync(IDX, original);
console.log("index.html restored");