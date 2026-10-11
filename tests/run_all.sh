#!/usr/bin/env bash
# Every KEYS ARE A LIE regression suite. Run from anywhere: bash tests/run_all.sh
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

echo "== syntax =="
for f in game.js lexicon.js; do
  if node --check "$f" >/dev/null 2>&1; then echo "  PASS node --check $f"
  else echo "  FAIL node --check $f"; fail=1; fi
done

for t in tests/t_*.js; do
  echo; echo "== $(basename "$t" .js) =="
  if node "$t"; then echo "  -> $(basename "$t" .js) PASS"; else echo "  -> $(basename "$t" .js) FAIL"; fail=1; fi
done

echo
[ $fail -eq 0 ] && echo "ALL SUITES PASS" || echo "SOME SUITES FAILED"
exit $fail