# KEYS ARE A LIE

A troll platformer where **punishment is the movement system**.

## Run it
Double-click `index.html`. That's it — no build, no install, no dependencies.
Works in any modern browser, straight from `file://`.

## Controls
- **A / D** — always move you left and right, in the air as well as on the ground.
- **Everything else** — a disaster. Which disaster depends on the key, and the
  key's meaning changes every few seconds.
- **Hold SHIFT + a key** — *probe* it. Costs a probe, never hurts you, and tells
  the truth about whether that key is really a control. Probes are limited.

## The hook
**There is no jump key.** You have never had one. You get off the ground by
being punished: a flood lifts you, a dinosaur walks up and throws you, chaos
inverts the world and you fall upward. Learning which disasters move you — and
remembering them, because the keys keep lying — is the entire game.

## Files
- `index.html` — page shell and HUD
- `game.js` — the whole game (engine, art, audio, cutscenes)
- `lexicon.js` — 700+ meanings across 42 keys
- `style.css` — styling
- `tests/` — headless regression suites (`bash tests/run_all.sh`)
