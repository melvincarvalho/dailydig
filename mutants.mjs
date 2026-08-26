// DAILY DIG mutant gate — node mutants.mjs
// Deliberate bugs injected into core.js; every one must make a proof fail.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runProofs } from './proofs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'core.js'), 'utf8');

const MUTANTS = [
  ['daily seed ignores the day', "const base = fnv('dailydig:' + day);", "const base = fnv('dailydig:');"],
  ['solver verification skipped', 'if (proof.cleared) return { cave, proof, attempt: i };', 'if (true) return { cave, proof, attempt: i };'],
  ['rim left open', 'for (let x = 0; x < CW; x++) { g[0][x] = T.STEEL; g[CH - 1][x] = T.STEEL; }', 'for (let x = 0; x < CW; x++) { }'],
  ['gravity stops', "if (below === T.SPACE) {", "if (false) {"],
  ['rocks roll uphill only', "if (cellAt(w, x - 1, y) === T.SPACE && cellAt(w, x - 1, y + 1) === T.SPACE) {", "if (false) {"],
  ['TNT is inert', '} else if (w.fall[y][x] && below === T.CRATE) {', '} else if (false) {'],
  ['blast spares the middle', 'w.grid[y][x] = T.SPACE;\n    w.fall[y][x] = 0;', 'w.fall[y][x] = 0;'],
  ['quota never opens the exit', 'if (!w.exitOpen && w.gems >= w.quota) { w.exitOpen = true;', 'if (false) { w.exitOpen = true;'],
  ['gems collect for free', 'w.gems++;', 'w.gems += 2;'],
  ['replay symbols drift', "const run = hi * 32 + (b % 32) + 1;", "const run = hi * 32 + (b % 32) + 2;"],
  ['codec drops the cap', 'if (v > 4) return null;', 'if (false) return null;'],
  ['world hash goes blind to the grid', 'for (let y = 0; y < CFG.CH; y++) for (let x = 0; x < CFG.CW; x++) mix(w.grid[y][x].charCodeAt(0));', 'mix(0);'],
  ['rng loses its seed', 'let a = seed >>> 0;', 'let a = 1;'],
  ['par is a lie', 'return { cleared: w.done, ticks: w.ticks, tape, gems: w.gems, quota: w.quota };', 'return { cleared: w.done, ticks: 0, tape, gems: w.gems, quota: w.quota };'],
];

const tmp = join(here, '.mutants');
mkdirSync(tmp, { recursive: true });
let killed = 0;
const survivors = [];
for (let i = 0; i < MUTANTS.length; i++) {
  const [name, from, to] = MUTANTS[i];
  if (!source.includes(from)) { console.log(`? ${name} — target missing`); survivors.push(name + ' (target)'); continue; }
  const file = join(tmp, `m${i}.mjs`);
  writeFileSync(file, source.replace(from, to));
  const M = await import(`file://${file}`);
  const res = await runProofs(M);
  const fails = res.filter((r) => !r.pass);
  if (fails.length) { killed++; console.log(`✓ killed: ${name} (by "${fails[0].name}")`); }
  else { survivors.push(name); console.log(`✗ SURVIVED: ${name}`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
if (survivors.length) { console.log('survivors:', survivors.join(', ')); process.exit(1); }
