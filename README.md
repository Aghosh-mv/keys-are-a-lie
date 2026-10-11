# KEYS ARE A LIE

**Team:** justcode
**Members:** Aghosh-mv

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

## Contents

| File | What it is |
| --- | --- |
| `index.html` | Page shell, HUD, overlays |
| `game.js` | The entire game — engine, art, audio, cutscenes, actors |
| `lexicon.js` | The lie database: 700+ meanings across 42 keys |
| `style.css` | Styling, bloom layer, CRT treatment |
| `screenshot.png` | Gameplay screenshot |
| `gameplay.mp4` | 3–5 minute gameplay recording |
| `tests/` | Headless regression suites (`bash tests/run_all.sh`) |
| `tools/` | The screencast recorder used to make the video |

Controls: **A / D** always move you (including in the air). **Hold SHIFT + a key**
to probe it safely.
