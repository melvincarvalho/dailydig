#!/usr/bin/env bash
# The daily contract, checked across a horizon of dates: every day must
# produce a solver-cleared cave, and the solver's replay must verify.
set -euo pipefail
node --input-type=module -e "
import { dailyCave, encodeTape, decodeTape, runTape } from './core.js';
let bad = 0;
const start = Date.UTC(2026, 7, 3);
for (let i = 0; i < 60; i++) {
  const d = new Date(start + i * 86400000);
  const day = d.toISOString().slice(0, 10);
  const got = dailyCave(day);
  if (!got) { console.log(day, 'NO SOLVABLE SEED'); bad++; continue; }
  const rt = runTape(got.cave, decodeTape(encodeTape(got.proof.tape)));
  const ok = rt.cleared && rt.ticks === got.proof.ticks;
  if (!ok) { console.log(day, 'REPLAY MISMATCH'); bad++; }
}
console.log(bad === 0 ? 'ALL 60 DAYS SOLVABLE + REPLAYS VERIFY' : bad + ' BAD DAYS');
process.exit(bad ? 1 : 0);
"
