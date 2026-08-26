// DAILY DIG machine-verified proofs — node proofs.mjs
// The suite pins the commercial promises: same day = same cave everywhere,
// every day is beatable, replays are the anti-cheat, physics is lawful.
export async function runProofs(C) {
  const P = [];
  const proof = (name, fn) => { try { fn(); P.push({ name, pass: true }); } catch (e) { P.push({ name, pass: false, msg: e.message }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  proof('rng: seeded, reproducible, divergent across seeds', () => {
    const a = C.makeRng(1), b = C.makeRng(1), c = C.makeRng(2);
    const A = [a(), a(), a()];
    assert(A.join() === [b(), b(), b()].join(), 'same seed diverged');
    assert(A.join() !== [c(), c(), c()].join(), 'seeds identical');
  });

  proof('daily: same day yields byte-identical caves', () => {
    const d1 = C.dailyCave('2026-08-03'), d2 = C.dailyCave('2026-08-03');
    assert(d1.cave.seed === d2.cave.seed, 'seeds differ');
    assert(JSON.stringify(d1.cave.grid) === JSON.stringify(d2.cave.grid), 'grids differ');
    assert(d1.proof.ticks === d2.proof.ticks, 'par differs');
  });

  proof('daily: different days yield different caves', () => {
    const a = C.dailyCave('2026-08-03'), b = C.dailyCave('2026-08-04');
    assert(a.cave.seed !== b.cave.seed || JSON.stringify(a.cave.grid) !== JSON.stringify(b.cave.grid), 'two days identical');
  });

  proof('daily: the shipped day is solver-verified by construction', () => {
    const d = C.dailyCave('2026-08-05');
    assert(d.proof.cleared, 'daily not cleared by solver');
    assert(d.proof.gems >= d.proof.quota, 'solver under quota');
  });

  proof('generation: the rim is sealed steel', () => {
    const { grid } = C.generate(12345);
    for (let x = 0; x < C.CFG.CW; x++) assert(grid[0][x] === C.T.STEEL && grid[C.CFG.CH - 1][x] === C.T.STEEL, 'open rim row');
    for (let y = 0; y < C.CFG.CH; y++) assert(grid[y][0] === C.T.STEEL && grid[y][C.CFG.CW - 1] === C.T.STEEL, 'open rim col');
  });

  proof('generation: exactly one exit, gems counted honestly', () => {
    const cave = C.generate(999);
    let exits = 0, gems = 0;
    for (const row of cave.grid) for (const c of row) { if (c === C.T.EXIT) exits++; if (c === C.T.GEM) gems++; }
    assert(exits === 1, exits + ' exits');
    assert(gems === cave.gems, 'gem count lies');
  });

  proof('physics: a rock falls one cell per tick through space', () => {
    const cave = C.generate(4242);
    const w = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.SPACE;
    w.grid[0][5] = C.T.STEEL;
    w.grid[5][5] = C.T.ROCK;
    w.grid[20][5] = C.T.STEEL;
    w.grid[w.p.y][w.p.x] = C.T.SPACE; w.p.x = 2; w.p.y = 2; w.grid[2][2] = C.T.PLAYER;
    w.gnashers.length = 0;
    C.tick(w, 0);
    assert(w.grid[6][5] === C.T.ROCK && w.grid[5][5] === C.T.SPACE, 'rock did not fall one cell');
    for (let i = 0; i < 13; i++) C.tick(w, 0);
    assert(w.grid[19][5] === C.T.ROCK, 'rock did not land on steel');
    C.tick(w, 0);
    assert(w.grid[19][5] === C.T.ROCK, 'rock fell through steel');
  });

  proof('physics: rocks roll off rounded piles', () => {
    const cave = C.generate(4243);
    const w = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.SPACE;
    w.grid[10][10] = C.T.ROCK;          // resting base
    w.grid[11][10] = C.T.STEEL;
    w.grid[8][10] = C.T.ROCK;           // will land on base then roll
    w.grid[11][9] = C.T.STEEL; w.grid[11][11] = C.T.STEEL;
    w.grid[w.p.y][w.p.x] = C.T.SPACE; w.p.x = 2; w.p.y = 2; w.grid[2][2] = C.T.PLAYER;
    w.gnashers.length = 0;
    for (let i = 0; i < 6; i++) C.tick(w, 0);
    const rolled = w.grid[10][9] === C.T.ROCK || w.grid[10][11] === C.T.ROCK;
    assert(rolled, 'rock refused to roll');
    // and a left-only chamber: the right side is walled, it MUST roll left
    const w2 = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w2.grid[y][x] = C.T.SPACE;
    w2.grid[10][10] = C.T.ROCK; w2.grid[11][10] = C.T.STEEL;
    w2.grid[9][11] = C.T.STEEL; w2.grid[10][11] = C.T.STEEL;
    w2.grid[11][9] = C.T.STEEL;
    w2.grid[8][10] = C.T.ROCK;
    w2.grid[w2.p.y][w2.p.x] = C.T.SPACE; w2.p.x = 2; w2.p.y = 2; w2.grid[2][2] = C.T.PLAYER;
    w2.gnashers.length = 0;
    for (let i = 0; i < 6; i++) C.tick(w2, 0);
    assert(w2.grid[10][9] === C.T.ROCK, 'left-only roll failed');
  });

  proof('physics: a falling rock detonates a TNT crate 3x3', () => {
    const cave = C.generate(4244);
    const w = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.DIRT;
    for (let y = 5; y <= 9; y++) w.grid[y][10] = C.T.SPACE;
    w.grid[5][10] = C.T.ROCK;
    w.grid[10][10] = C.T.CRATE;
    w.grid[w.p.y][w.p.x] = C.T.DIRT; w.p.x = 2; w.p.y = 2; w.grid[2][2] = C.T.PLAYER;
    w.gnashers.length = 0;
    for (let i = 0; i < 8; i++) C.tick(w, 0);
    let cleared = 0;
    for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++) if (w.grid[y][x] === C.T.SPACE) cleared++;
    assert(cleared >= 8, 'blast did not clear the 3x3 (' + cleared + ')');
  });

  proof('physics: digging a prop drops the column it held', () => {
    const cave = C.generate(4245);
    const w = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.DIRT;
    w.grid[10][10] = C.T.PROP;
    w.grid[9][10] = C.T.ROCK; w.grid[8][10] = C.T.ROCK;
    w.grid[10][9] = C.T.SPACE;
    w.grid[w.p.y][w.p.x] = C.T.DIRT;
    w.p.x = 9; w.p.y = 10; w.p.px = 9; w.p.py = 10; w.grid[10][9] = C.T.PLAYER;
    w.gnashers.length = 0;
    C.tick(w, 2);            // step right into the prop
    assert(w.p.x === 10, 'did not take the prop cell');
    for (let i = 0; i < 4; i++) C.tick(w, 1); // walk away left
    assert(w.grid[10][10] === C.T.ROCK || w.grid[9][10] === C.T.ROCK, 'column never came down');
  });

  proof('physics: one gem collected is exactly one gem banked', () => {
    const cave = C.generate(4246);
    const w = C.newWorld(cave);
    for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.DIRT;
    w.grid[w.p.y][w.p.x] = C.T.DIRT;
    w.p.x = 5; w.p.y = 5; w.p.px = 5; w.p.py = 5; w.grid[5][5] = C.T.PLAYER;
    w.grid[5][6] = C.T.GEM;
    w.gnashers.length = 0;
    C.tick(w, 2);
    assert(w.gems === 1, 'one gem banked as ' + w.gems);
  });

  proof('physics: quota opens the exit, exit ends the run', () => {
    const d = C.dailyCave('2026-08-06');
    const r = C.runTape(d.cave, d.proof.tape);
    assert(r.cleared, 'foreman tape does not clear');
  });

  proof('replay: codec roundtrips arbitrary tapes', () => {
    const rng = C.makeRng(31337);
    for (let t = 0; t < 20; t++) {
      const tape = Array.from({ length: 200 + (rng() * 800 | 0) }, () => rng() * 5 | 0);
      const dec = C.decodeTape(C.encodeTape(tape));
      assert(dec.length === tape.length, 'length changed');
      for (let i = 0; i < tape.length; i++) assert(dec[i] === tape[i], 'symbol changed at ' + i);
    }
  });

  proof('replay: decode rejects garbage', () => {
    assert(C.decodeTape('!!!') === null || Array.isArray(C.decodeTape('!!!')), 'decode threw');
    assert(C.decodeTape('~~') === null, 'garbage accepted');
    assert(C.decodeTape('8A') === null, 'input symbol > 4 accepted');
    assert(C.decodeTape('_A') === null, 'input symbol > 4 accepted (2)');
  });

  proof('replay: same tape, same world hash — the anti-cheat holds', () => {
    const d = C.dailyCave('2026-08-07');
    const a = C.runTape(d.cave, d.proof.tape);
    const b = C.runTape(d.cave, d.proof.tape);
    assert(a.hash === b.hash && a.ticks === b.ticks, 'replay diverged');
  });

  proof('replay: a truncated winning tape does not win', () => {
    const d = C.dailyCave('2026-08-08');
    const cut = d.proof.tape.slice(0, Math.floor(d.proof.tape.length * 0.6));
    const r = C.runTape(d.cave, cut);
    assert(!r.cleared, 'truncated tape still cleared');
  });

  proof('hash: two worlds differing only in player position hash apart', () => {
    const cave = C.generate(4247);
    const mk = () => {
      const w = C.newWorld(cave);
      for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.SPACE;
      w.grid[w.p.y] && (w.grid[w.p.y][w.p.x] = C.T.SPACE);
      w.p.x = 5; w.p.y = 5; w.grid[5][5] = C.T.PLAYER;
      w.gnashers.length = 0;
      return w;
    };
    const a = mk(), b = mk();
    C.tick(a, 2); C.tick(b, 2); C.tick(b, 2);
    a.ticks = b.ticks; // isolate position: neutralize the tick counter
    assert(C.hashWorld(a) !== C.hashWorld(b), 'hash blind to player position');
    // and grid-only difference: dig opposite cells, return to the same spot
    const mk2 = () => {
      const w = C.newWorld(cave);
      for (let y = 0; y < C.CFG.CH; y++) for (let x = 0; x < C.CFG.CW; x++) w.grid[y][x] = C.T.DIRT;
      w.grid[5][5] = C.T.PLAYER; w.p.x = 5; w.p.y = 5;
      w.gnashers.length = 0;
      return w;
    };
    const c1 = mk2(), c2 = mk2();
    C.tick(c1, 2); C.tick(c1, 1);   // dig right, step back
    C.tick(c2, 1); C.tick(c2, 2);   // dig left, step back
    assert(c1.p.x === c2.p.x && c1.ticks === c2.ticks, 'setup broken');
    assert(C.hashWorld(c1) !== C.hashWorld(c2), 'hash blind to the grid');
  });

  proof('solver: par is positive and under budget', () => {
    const d = C.dailyCave('2026-08-09');
    assert(d.proof.ticks > 0 && d.proof.ticks <= C.CFG.solverBudget, 'par out of range');
  });

  proof('fuzz: 3000 random inputs never corrupt the world', () => {
    const d = C.dailyCave('2026-08-10');
    const w = C.newWorld(d.cave);
    const rng = C.makeRng(777);
    for (let i = 0; i < 3000 && !w.done && !w.dead; i++) {
      C.tick(w, rng() * 5 | 0);
      assert(w.gems <= w.gemsTotal, 'gems overflow');
      assert(w.p.x >= 0 && w.p.x < C.CFG.CW && w.p.y >= 0 && w.p.y < C.CFG.CH, 'player escaped');
    }
    let players = 0;
    for (const row of w.grid) for (const c of row) if (c === C.T.PLAYER) players++;
    assert(players <= 1, players + ' players in grid');
  });

  proof('day plumbing: numbering is stable and 1-based at launch', () => {
    assert(C.dayNumber('2026-08-03') === 1, 'launch day is not #1');
    assert(C.dayNumber('2026-08-04') === 2, 'day 2 wrong');
    assert(C.dayNumber('2027-08-03') === 366, 'year math wrong');
  });

  return P;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const C = await import('./core.js');
  const results = await runProofs(C);
  let failed = 0;
  for (const r of results) { console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : ' — ' + r.msg}`); if (!r.pass) failed++; }
  console.log(`\n${results.length - failed}/${results.length} proofs hold`);
  process.exit(failed ? 1 : 0);
}
