# KEYS ARE A LIE

**Team:** justcode  ·  **Member:** Aghosh-mv

A troll platformer where **punishment is the movement system** — you win by
hurting yourself.

| | |
| --- | --- |
| **Live repo** | https://github.com/Aghosh-mv/keys-are-a-lie |
| **Download this submission** | https://raw.githubusercontent.com/Aghosh-mv/keys-are-a-lie/main/dist/keys-are-a-lie.zip |
| **Play in a browser** | Open `index.html` — no build, no install, no internet |
| **Tech** | Plain HTML/CSS/JS. Zero dependencies. Runs from `file://` |
| **Video** | `gameplay.mp4` — 3:35 real gameplay capture |

---

## Screenshots

| | |
| --- | --- |
| ![title](dist/screenshots/07-title.png) **The title screen** — the manual is already lying to you | ![shrine](dist/screenshots/01-bamboo-shrine.png) **Act I — Bamboo Shrine** |
| ![forest](dist/screenshots/02-spirit-forest.png) **Act II — Spirit Forest** | ![gate](dist/screenshots/03-red-gate.png) **Act III — Red Gate** |
| ![dragon](dist/screenshots/04-dragons-end.png) **Act IV — Dragon's End** | ![codex](dist/screenshots/05-codex.png) **The Codex** — knowledge that survives death |

Further: `dist/screenshots/06-dealer.png` (The Dealer), `dist/screenshots/08-cutscene.png` (a Mastermind cutscene).

---

## How to run

Double-click `index.html`. That is the whole setup.

No build step, no install, no dependencies, no internet. It runs straight from
`file://` in any modern browser (tested in Chrome). Every asset — art, sound,
fonts, the 700-entry lie database — is generated or embedded in these four files.

To verify the build, run `bash tests/run_all.sh` (6 headless regression suites,
82 assertions, ~2 seconds).

---

## Game description

You are trying to reach a portal at the far right of the screen. A manual sits in
the corner telling you which keys move you left, right and jump.

**There is no jump key. There has never been one.**

Two keys move you left and right. Every other key you press triggers a disaster
whose meaning is chosen at random — press `w` and it might be a flood, a dinosaur,
chaos, a swarm, a lightning strike, a giant foot. And the disaster is *how you
travel*: a flood lifts you, a dinosaur walks over, grabs you and throws you, a
tornado carries you, chaos inverts the world and you fall upward.

So the core loop is inverted. You win **by punishing yourself**. The puzzle is not
"what key do I press" but "which disasters move me, and can I remember them" —
because the contract re-rolls every few seconds, faster the closer you get to the
portal, so knowledge expires constantly.

Three systems sit on top of that:

- **Probing.** Hold `SHIFT` and press a key to test it. It costs a probe, never
  hurts you, and tells you the truth. Probes are limited, so you have to choose
  between spending one to *learn* or gambling on a key and eating the punishment.
- **A Codex.** Every disaster that has ever picked you up is written down
  permanently and survives death. Undiscovered entries show as `???`, so there is
  always a visible next thing to chase.
- **Stakes.** You carry souls; they are only *banked* (safe forever) when you
  cross a checkpoint. Die and everything you were carrying is gone. Banked souls,
  cosmetics and codex knowledge persist. Launches are free, but four in a row
  costs health, so you cannot spam your way to safety.

---

## Theme implementation

> If your brief assigns a specific theme, swap this heading — the rest of the
> README stands on its own.

The theme this build is built around is **deliberately bad UX as the subject
matter** — a game about a game that lies to you. Every design decision serves
that:

- The **Manual is a lie**, and it is styled to look authoritative. The player's
  first instinct (assume WASD) is the joke, so WASD actually works — and that is
  the misdirection that makes them hunt for other keys.
- **The third slot is permanently marked `NONE`.** Players will look for a jump
  key anyway. Not giving them one is the whole game.
- **The punishment is the reward.** The most common "mistake" in the game is also
  the only way to progress. There is no correct play, only informed suffering.
- Failure feedback is deliberately unhelpful — `FLOOD` might be helpful, `CONFUSE`
  might wipe your manual, `BLACKOUT` might hide the screen — and you have to
  experiment to find out which is which.

The four acts (Bamboo Shrine, Spirit Forest, Red Gate, Dragon's End) escalate
visually from calm morning to sunset so the run *feels* like it is going
somewhere, even though the mechanics never get easier.

---

## Intentional bad design choices

This section is the honest one. These are deliberate, and they are the game.

1. **The controls are hidden and randomised.** There is no way to learn the
   correct keys — the contract re-rolls on a timer. A well-designed platformer
   would make the correct input learnable and stable.
2. **There is no jump button.** Jumping, the single most expected verb in a
   platformer, is deliberately unavailable and must be improvised.
3. **Punishment is mandatory to progress.** There is no safe route. Every metre of
   vertical progress requires something terrible happening to you.
4. **The instructions actively lie.** An on-screen manual is present, readable,
   well-styled, and wrong. We built a convincing UI specifically to mislead.
5. **Random meanings per key.** Pressing the same key twice gives two completely
   unrelated disasters, so memorisation is unreliable on purpose.
6. **The antagonist talks constantly.** A cutscene voice explains what it is doing
   to you while it does it, which is terrible pacing in a normal game.
7. **Progress is lost on death.** Un-banked souls vanish. Normally this reads as
   punishing/bad; here it is the entire reason to care about the run.

Each of these is a decision a normal game would reverse, kept because the concept
is a game about a dishonest game.

---

## Repository & guidance

The complete source lives in the public repo, including commit history:

```bash
git clone https://github.com/Aghosh-mv/keys-are-a-lie.git
cd keys-are-a-lie
# open index.html  — that is the whole setup
bash tests/run_all.sh        # optional: 6 suites, 82 assertions, ~2s
```

Everything in the game is generated or embedded in four files. There is no art
pipeline, no asset pipeline, no build step, and no network access at runtime —
the "art" is drawn with the Canvas 2D API and the sound is synthesised with
WebAudio, so the whole game is self-contained text.

If you want to regenerate the submission media:

```bash
node tools/shots.js                 # the screenshots in this README
node tools/record.js out.mp4 200    # records a real playthrough via CDP screencast
```


---

## Contents

| File | What it is |
| --- | --- |
| `index.html` | Page shell, HUD, overlays |
| `game.js` | The entire game — engine, art, audio, cutscenes, actors |
| `lexicon.js` | The lie database: 700+ meanings across 42 keys |
| `style.css` | Styling, additive bloom layer, CRT treatment |
| `README.md` | This file |
| `gameplay.mp4` | 3:35 gameplay recording (real screencast) |
| `screenshot.png` | Hero screenshot |
| `dist/screenshots/` | All eight screenshots used above |
| `tests/` | Headless regression suites — `bash tests/run_all.sh` |
| `tools/` | Screenshot + screencast recorders |


Controls: **A / D** always move you (including in the air). **Hold SHIFT + a key**
to probe it safely.
