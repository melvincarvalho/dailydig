#!/usr/bin/env bash
# Deterministic shot capture for the critic loop. Serve over HTTP (snap
# chromium cannot read file:///tmp) then: tools/capture.sh <port> [outdir]
set -euo pipefail
PORT="${1:?port}"
OUT="${2:-shots}"
mkdir -p "$OUT"
CHROME="${CHROME:-chromium}"
cap() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,720 --virtual-time-budget=12000 \
    --screenshot="$OUT/$1.png" "http://localhost:$PORT/index.html?$2" 2>/dev/null
  echo "captured $1"
}
cap intro   "shot=intro&day=2026-08-03"
cap play    "shot=play&day=2026-08-03"
cap race    "shot=race&day=2026-08-03"
cap results "shot=results&day=2026-08-03"
for f in 0 2 4 6 8 10; do cap "anim_$f" "shot=anim&f=$f&day=2026-08-03"; done
