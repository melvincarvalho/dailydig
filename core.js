// DAILY DIG core — the pure simulation. No DOM, no audio, no network.
// Everything the game trusts lives here: the daily seed rule, cave
// generation, the tick physics, the solver (which is both the proof that
// today's cave is beatable and the Foreman ghost you race), and the replay
// codec. Deterministic to the byte: same day, same cave, same physics, on
// every device. proofs.mjs and mutants.mjs import this file directly.

export const CFG = {
  CW: 60, CH: 34,          // world size in cells (bigger than anything before)
  TICK: 0.11,              // physics cadence, seconds
  quotaFrac: 0.6,          // fraction of gems required to open the exit
  pushDelay: 1,            // extra tick before a push lands
  solverBudget: 2600,      // max ticks the Foreman may spend
  seedTries: 44,           // candidate seeds tried before a day is declared bad
  genRocks: 0.16, genGems: 0.055, genCrates: 7, genShafts: 9, genGnashers: 5,
  replayCap: 6000,         // hard cap on recorded ticks
};

// bump when generation or acceptance changes: invalidates seed-hint caches
export const GENV = 3;

// ---------------------------------------------------------------------------
// deterministic primitives
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cells. DIRT digs, ROCK falls and rolls, GEM falls and is collected, CRATE
// is TNT (pushable; a falling ROCK detonates it), PROP is a timber support
// (dig it and whatever it held comes down), GNASH is an enemy, EXIT opens at
// quota. STEEL is the world rim, WALL is interior masonry.
export const T = {
  SPACE: ' ', DIRT: '.', WALL: 'W', STEEL: 'S', ROCK: 'r', GEM: 'd',
  CRATE: 'c', PROP: 'p', EXIT: 'X', PLAYER: 'P', GNASH: 'g', BOOM: 'e',
};
const ROUNDED = new Set([T.ROCK, T.GEM, T.WALL, T.CRATE]);
const FALLS = new Set([T.ROCK, T.GEM, T.CRATE]);

// ---------------------------------------------------------------------------
// day plumbing
export function dayString(dateMs) {
  const d = new Date(dateMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function dayNumber(day) {
  // day 1 is launch day; playable archive counts up from here
  return Math.round((Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) -
                     Date.UTC(2026, 7, 3)) / 86400000) + 1;
}

// ---------------------------------------------------------------------------
// the editorial curve: crossword rhythm — Monday is a stroll, Saturday is a
// shift you talk about. Every knob derives from the date alone.
export function dayParams(day) {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();      // 0 Sun .. 6 Sat
  const D = [3, 1, 2, 3, 4, 5, 6][dow];                      // difficulty 1..6
  return {
    D,
    rocks: 0.13 + 0.008 * D,
    gnashers: 3 + Math.floor(D / 2),
    crates: 6 + (D > 3 ? 2 : 0),
    shafts: 8 + D,
    quotaFrac: 0.52 + 0.025 * D,
    vaults: 1 + (D >= 5 ? 1 : 0),
    guards: 1 + (D >= 4 ? 1 : 0),
    minPar: 125 + 18 * D,
    maxSpaceFrac: 0.34,
  };
}

// ---------------------------------------------------------------------------
// cave generation
export function generate(seed, P) {
  P = P || {
    rocks: CFG.genRocks, gnashers: CFG.genGnashers, crates: CFG.genCrates,
    shafts: CFG.genShafts, quotaFrac: CFG.quotaFrac, vaults: 1, guards: 1,
  };
  const { CW, CH } = CFG;
  const rng = makeRng(seed);
  const g = Array.from({ length: CH }, () => new Array(CW).fill(T.DIRT));
  for (let x = 0; x < CW; x++) { g[0][x] = T.STEEL; g[CH - 1][x] = T.STEEL; }
  for (let y = 0; y < CH; y++) { g[y][0] = T.STEEL; g[y][CW - 1] = T.STEEL; }

  // masonry ribs give the cave structure and route decisions
  const ribs = 3 + (rng() * 3 | 0);
  for (let i = 0; i < ribs; i++) {
    const vx = 6 + (rng() * (CW - 12) | 0);
    const gap = 3 + (rng() * (CH - 8) | 0);
    for (let y = 2; y < CH - 2; y++) if (Math.abs(y - gap) > 1 && rng() < 0.85) g[y][vx] = T.WALL;
  }

  // worm tunnels carve the open bones of the route
  const worms = 8 + (rng() * 4 | 0);
  for (let i = 0; i < worms; i++) {
    let x = 2 + (rng() * (CW - 4) | 0), y = 2 + (rng() * (CH - 4) | 0);
    const len = 20 + (rng() * 50 | 0);
    for (let s = 0; s < len; s++) {
      if (g[y][x] !== T.STEEL) g[y][x] = T.SPACE;
      const d = rng();
      if (d < 0.3) x += rng() < 0.5 ? 1 : -1;
      else if (d < 0.55) y += rng() < 0.5 ? 1 : -1;
      else x += rng() < 0.5 ? 1 : -1;
      x = Math.max(1, Math.min(CW - 2, x)); y = Math.max(1, Math.min(CH - 2, y));
    }
  }

  // rocks, then gem veins (clusters read as ore seams, not confetti)
  for (let y = 1; y < CH - 1; y++) for (let x = 1; x < CW - 1; x++) {
    if (g[y][x] === T.DIRT && rng() < P.rocks) g[y][x] = T.ROCK;
  }
  let gems = 0;
  const veins = 10 + (rng() * 5 | 0);
  for (let i = 0; i < veins; i++) {
    // veins pool toward the depths: risk pays
    let x = 3 + (rng() * (CW - 6) | 0);
    let y = 3 + ((CH - 9) * Math.pow(rng(), 0.6) | 0);
    const deep = y > CH * 0.55;
    const n = (deep ? 3 : 2) + (rng() * 4 | 0);
    for (let s = 0; s < n; s++) {
      if (g[y] && g[y][x] === T.DIRT) { g[y][x] = T.GEM; gems++; }
      x += (rng() * 3 | 0) - 1; y += rng() < 0.6 ? 1 : 0;
      x = Math.max(1, Math.min(CW - 2, x)); y = Math.max(1, Math.min(CH - 2, y));
    }
  }
  for (let y = 1; y < CH - 1 && gems < 24; y++) for (let x = 1; x < CW - 1 && gems < 24; x++) {
    if (g[y][x] === T.DIRT && rng() < 0.01) { g[y][x] = T.GEM; gems++; }
  }

  // TNT crates near masonry: routing tools for those who look
  for (let i = 0; i < P.crates; i++) {
    const x = 2 + (rng() * (CW - 4) | 0), y = 2 + (rng() * (CH - 4) | 0);
    if (g[y][x] === T.DIRT) g[y][x] = T.CRATE;
  }

  // propped shafts: a timber PROP holds a rock column — dig it, it all comes down
  for (let i = 0; i < P.shafts; i++) {
    const x = 3 + (rng() * (CW - 6) | 0), y = 6 + (rng() * (CH - 10) | 0);
    if (g[y][x] !== T.DIRT) continue;
    g[y][x] = T.PROP;
    const h = 2 + (rng() * 3 | 0);
    for (let k = 1; k <= h; k++) if (g[y - k][x] === T.DIRT || g[y - k][x] === T.SPACE) g[y - k][x] = T.ROCK;
    if (g[y + 1][x] === T.DIRT) g[y + 1][x] = T.SPACE;
  }

  // SETPIECE — the TNT vault: a walled pocket of bonus gems. Outside it, a
  // prop holds a rock over a crate: knock the prop, the rock falls, the
  // crate blows the wall. The quota never depends on vault gems (the daily
  // acceptance rule guarantees the Foreman cleared quota without them).
  const setpieces = { vaults: 0, guards: 0 };
  for (let v = 0; v < (P.vaults || 0); v++) {
    const vx = 10 + (rng() * (CW - 22) | 0), vy = 8 + (rng() * (CH - 16) | 0);
    let clear = true;
    for (let y = vy; y < vy + 4 && clear; y++) for (let x = vx; x < vx + 6; x++) {
      if (g[y][x] === T.STEEL || g[y][x] === T.EXIT) { clear = false; break; }
    }
    if (!clear) continue;
    for (let y = vy; y < vy + 4; y++) for (let x = vx; x < vx + 6; x++) {
      g[y][x] = (y === vy || y === vy + 3 || x === vx || x === vx + 5) ? T.WALL : T.DIRT;
    }
    for (let k = 0; k < 5; k++) {
      const gx = vx + 1 + (rng() * 4 | 0), gy = vy + 1 + (rng() * 2 | 0);
      if (g[gy][gx] === T.DIRT) { g[gy][gx] = T.GEM; gems++; }
    }
    // the fuse, hung on the left wall: rock over prop over crate
    const bx = vx - 1, by = vy + 2;
    if (bx > 2 && g[by][bx] !== T.STEEL) {
      g[by][bx] = T.CRATE;
      if (g[by - 1][bx] !== T.STEEL) g[by - 1][bx] = T.PROP;
      if (g[by - 2][bx] !== T.STEEL) g[by - 2][bx] = T.ROCK;
      if (g[by][bx - 1] !== T.STEEL) g[by][bx - 1] = T.DIRT;
      if (g[by - 1][bx - 1] !== T.STEEL) g[by - 1][bx - 1] = T.DIRT;
      setpieces.vaults++;
    }
  }
  // SETPIECE — the guarded vein: a rich seam whose approach runs under a
  // prop-held column. Take the gems the slow way, or drop the roof first.
  for (let gv = 0; gv < (P.guards || 0); gv++) {
    const gx = 8 + (rng() * (CW - 16) | 0), gy = 10 + (rng() * (CH - 16) | 0);
    if (g[gy][gx] === T.STEEL) continue;
    for (let k = 0; k < 4; k++) {
      const vx2 = gx + k;
      if (g[gy][vx2] !== T.STEEL && g[gy][vx2] !== T.EXIT) { g[gy][vx2] = T.GEM; gems++; }
    }
    const px2 = gx + 1, py2 = gy - 2;
    if (py2 > 3 && g[py2][px2] !== T.STEEL) {
      g[py2][px2] = T.PROP;
      for (let k = 1; k <= 2; k++) if (g[py2 - k][px2] !== T.STEEL) g[py2 - k][px2] = T.ROCK;
      if (g[py2 + 1][px2] !== T.STEEL && g[py2 + 1][px2] !== T.GEM) g[py2 + 1][px2] = T.DIRT;
      setpieces.guards++;
    }
  }

  // gnashers patrol carved pockets
  const gnashers = [];
  let placed = 0, guard = 0;
  while (placed < P.gnashers && guard++ < 400) {
    const x = 4 + (rng() * (CW - 8) | 0), y = 4 + (rng() * (CH - 8) | 0);
    if (g[y][x] === T.SPACE) { g[y][x] = T.GNASH; gnashers.push({ x, y, dir: rng() * 4 | 0 }); placed++; }
  }

  // start pocket top-left, exit in the far quadrant
  const sx = 2, sy = 2;
  for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 2; x++) {
    if (g[y] && g[y][x] && g[y][x] !== T.STEEL) g[y][x] = T.SPACE;
  }
  const ex = CW - 3 - (rng() * 6 | 0), ey = CH - 3 - (rng() * 4 | 0);
  g[ey][ex] = T.EXIT;
  if (g[ey - 1][ex] === T.ROCK) g[ey - 1][ex] = T.DIRT;

  // the ledger is the grid: recount after every paver has had its say
  gems = 0;
  for (const row of g) for (const c of row) if (c === T.GEM) gems++;

  return { grid: g, start: [sx, sy], exit: [ex, ey], gems, seed, quotaFrac: P.quotaFrac || CFG.quotaFrac, setpieces };
}

// ---------------------------------------------------------------------------
// world state + tick physics
export function newWorld(cave) {
  const grid = cave.grid.map((r) => r.slice());
  const gnashers = [];
  for (let y = 0; y < CFG.CH; y++) for (let x = 0; x < CFG.CW; x++) {
    if (grid[y][x] === T.GNASH) gnashers.push({ x, y, px: x, py: y, dir: (x + y) % 4 });
  }
  const [sx, sy] = cave.start;
  grid[sy][sx] = T.PLAYER;
  return {
    grid, fall: Array.from({ length: CFG.CH }, () => new Uint8Array(CFG.CW)),
    p: { x: sx, y: sy, px: sx, py: sy, dir: 1, alive: true, pushT: 0, moving: false },
    gnashers, gems: 0, gemsTotal: cave.gems, quota: Math.ceil(cave.gems * (cave.quotaFrac || CFG.quotaFrac)),
    exit: cave.exit, exitOpen: false, done: false, dead: false, ticks: 0,
    boomQueue: [], moves: [], events: [],
  };
}
const cellAt = (w, x, y) => (x < 0 || x >= CFG.CW || y < 0 || y >= CFG.CH) ? T.STEEL : w.grid[y][x];

function detonate(w, cx, cy) {
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const c = cellAt(w, x, y);
    if (c === T.STEEL || c === T.EXIT) continue;
    if (c === T.PLAYER) w.p.alive = false;
    if (c === T.GNASH) {
      const i = w.gnashers.findIndex((e) => e.x === x && e.y === y);
      if (i >= 0) w.gnashers.splice(i, 1);
    }
    if (c === T.CRATE && !(x === cx && y === cy)) w.boomQueue.push([x, y]);
    w.grid[y][x] = T.SPACE;
    w.fall[y][x] = 0;
  }
  w.events.push({ t: 'boom', x: cx, y: cy });
}

// input: 0 none, 1 left, 2 right, 3 up, 4 down
const DIRS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];

export function tick(w, input) {
  if (w.done || w.dead) return;
  w.moves = [];
  w.events = [];
  w.ticks++;
  const g = w.grid, p = w.p;

  // queued TNT chains resolve first, one wave per tick
  const q = w.boomQueue; w.boomQueue = [];
  for (const [x, y] of q) detonate(w, x, y);

  // gravity: single top-down scan, Boulder-Dash order, with prop support
  const moved = Array.from({ length: CFG.CH }, () => new Uint8Array(CFG.CW));
  for (let y = 0; y < CFG.CH; y++) for (let x = 0; x < CFG.CW; x++) {
    const c = g[y][x];
    if (!FALLS.has(c) || moved[y][x]) continue;
    const below = cellAt(w, x, y + 1);
    if (below === T.SPACE) {
      g[y][x] = T.SPACE; g[y + 1][x] = c;
      moved[y + 1][x] = 1; w.fall[y + 1][x] = 1; w.fall[y][x] = 0;
      w.moves.push({ x, y: y + 1, dx: 0, dy: -1, c });
    } else if (w.fall[y][x] && below === T.CRATE) {
      w.fall[y][x] = 0;
      detonate(w, x, y + 1);
    } else if (w.fall[y][x] && below === T.PLAYER) {
      p.alive = false; w.fall[y][x] = 0;
      w.events.push({ t: 'crush', x, y: y + 1 });
    } else if (w.fall[y][x] && below === T.GNASH) {
      const i = w.gnashers.findIndex((e) => e.x === x && e.y === y + 1);
      if (i >= 0) w.gnashers.splice(i, 1);
      g[y + 1][x] = T.SPACE;
      detonate(w, x, y + 1);
      w.fall[y][x] = 0;
    } else if (ROUNDED.has(below) && below !== T.CRATE) {
      if (cellAt(w, x - 1, y) === T.SPACE && cellAt(w, x - 1, y + 1) === T.SPACE) {
        g[y][x] = T.SPACE; g[y][x - 1] = c;
        moved[y][x - 1] = 1; w.fall[y][x - 1] = 1; w.fall[y][x] = 0;
        w.moves.push({ x: x - 1, y, dx: 1, dy: 0, c });
      } else if (cellAt(w, x + 1, y) === T.SPACE && cellAt(w, x + 1, y + 1) === T.SPACE) {
        g[y][x] = T.SPACE; g[y][x + 1] = c;
        moved[y][x + 1] = 1; w.fall[y][x + 1] = 1; w.fall[y][x] = 0;
        w.moves.push({ x: x + 1, y, dx: -1, dy: 0, c });
      } else {
        if (w.fall[y][x]) w.events.push({ t: 'thud', x, y });
        w.fall[y][x] = 0;
      }
    } else {
      if (w.fall[y][x]) w.events.push({ t: 'thud', x, y });
      w.fall[y][x] = 0;
    }
  }

  // player
  p.moving = false;
  if (p.alive && input > 0) {
    const [dx, dy] = DIRS[input];
    const nx = p.x + dx, ny = p.y + dy;
    const t = cellAt(w, nx, ny);
    p.dir = dx !== 0 ? dx : p.dir;
    if (t === T.DIRT || t === T.SPACE) {
      if (t === T.DIRT) w.events.push({ t: 'dig', x: nx, y: ny });
      g[p.y][p.x] = T.SPACE; g[ny][nx] = T.PLAYER;
      p.px = p.x; p.py = p.y; p.x = nx; p.y = ny; p.moving = true; p.pushT = 0;
    } else if (t === T.GEM) {
      w.gems++;
      w.events.push({ t: 'gem', x: nx, y: ny });
      if (!w.exitOpen && w.gems >= w.quota) { w.exitOpen = true; w.events.push({ t: 'open' }); }
      g[p.y][p.x] = T.SPACE; g[ny][nx] = T.PLAYER;
      p.px = p.x; p.py = p.y; p.x = nx; p.y = ny; p.moving = true; p.pushT = 0;
    } else if (t === T.PROP) {
      // knocking out a support is a dig — the column above is coming down
      w.events.push({ t: 'prop', x: nx, y: ny });
      g[p.y][p.x] = T.SPACE; g[ny][nx] = T.PLAYER;
      p.px = p.x; p.py = p.y; p.x = nx; p.y = ny; p.moving = true; p.pushT = 0;
    } else if ((t === T.ROCK || t === T.CRATE) && dy === 0 && !w.fall[ny][nx] && cellAt(w, nx + dx, ny) === T.SPACE) {
      p.pushT++;
      if (p.pushT > CFG.pushDelay) {
        g[ny][nx + dx] = t;
        w.moves.push({ x: nx + dx, y: ny, dx: -dx, dy: 0, c: t });
        g[ny][nx] = T.PLAYER; g[p.y][p.x] = T.SPACE;
        p.px = p.x; p.py = p.y; p.x = nx; p.moving = true; p.pushT = 0;
        w.events.push({ t: 'push', x: nx, y: ny });
      }
    } else if (t === T.EXIT && w.exitOpen) {
      w.done = true;
      w.events.push({ t: 'clear' });
      return;
    } else p.pushT = 0;
  } else p.pushT = 0;

  // gnashers: wall-followers; touching one is death
  for (const e of w.gnashers.slice()) {
    if (!w.gnashers.includes(e)) continue;
    e.px = e.x; e.py = e.y;
    const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const pref = [(e.dir + 3) % 4, e.dir, (e.dir + 1) % 4, (e.dir + 2) % 4];
    let stepped = false;
    for (const nd of pref) {
      const nx = e.x + D4[nd][0], ny = e.y + D4[nd][1];
      const t = cellAt(w, nx, ny);
      if (t === T.PLAYER) { p.alive = false; w.events.push({ t: 'bite', x: nx, y: ny }); stepped = true; break; }
      if (t === T.SPACE) {
        g[e.y][e.x] = T.SPACE; g[ny][nx] = T.GNASH;
        e.x = nx; e.y = ny; e.dir = nd; stepped = true; break;
      }
    }
    if (!stepped) e.dir = (e.dir + 2) % 4;
    if (Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1) { p.alive = false; w.events.push({ t: 'bite', x: e.x, y: e.y }); }
  }

  if (!p.alive && !w.dead) {
    w.dead = true;
    if (g[p.y][p.x] === T.PLAYER) g[p.y][p.x] = T.SPACE;
    w.events.push({ t: 'die', x: p.x, y: p.y });
  }
}

export function hashWorld(w) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 255; h = Math.imul(h, 0x01000193); h ^= (n >> 8) & 255; h = Math.imul(h, 0x01000193); };
  for (let y = 0; y < CFG.CH; y++) for (let x = 0; x < CFG.CW; x++) mix(w.grid[y][x].charCodeAt(0));
  mix(w.gems); mix(w.ticks); mix(w.p.x); mix(w.p.y);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// the Foreman: a deterministic solver. Its clear is the proof the day is
// beatable, its tick count is par, and its input tape is the ghost you race.
export function solve(cave) {
  const w = newWorld(cave);
  const tape = [];
  let stuck = 0;
  while (!w.done && !w.dead && w.ticks < CFG.solverBudget) {
    const input = foremanStep(w);
    tape.push(input);
    const before = w.gems + w.p.x + w.p.y * 100;
    tick(w, input);
    const after = w.gems + w.p.x + w.p.y * 100;
    stuck = before === after && input !== 0 ? stuck + 1 : 0;
    if (stuck > 60) break;
  }
  return { cleared: w.done, ticks: w.ticks, tape, gems: w.gems, quota: w.quota };
}

function dangerous(w, x, y) {
  // never stand where an unsupported rock can arrive, never hug a gnasher
  const above = cellAt(w, x, y - 1);
  if ((above === T.ROCK || above === T.CRATE) || (cellAt(w, x, y - 2) === T.ROCK && above === T.SPACE)) return true;
  for (const e of w.gnashers) if (Math.abs(e.x - x) + Math.abs(e.y - y) <= 2) return true;
  return false;
}

function foremanStep(w) {
  // BFS through diggable space to the nearest safe gem (or the exit)
  const targetGem = w.gems < w.quota || !w.exitOpen;
  const seen = new Uint8Array(CFG.CW * CFG.CH);
  const from = new Int16Array(CFG.CW * CFG.CH).fill(-1);
  const qx = [w.p.x], qy = [w.p.y];
  seen[w.p.y * CFG.CW + w.p.x] = 1;
  let goal = -1;
  for (let i = 0; i < qx.length && goal < 0; i++) {
    const x = qx[i], y = qy[i];
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * CFG.CW + nx;
      if (nx < 1 || nx >= CFG.CW - 1 || ny < 1 || ny >= CFG.CH - 1 || seen[k]) continue;
      const c = w.grid[ny][nx];
      const walkable = c === T.SPACE || c === T.DIRT || c === T.GEM || c === T.PROP ||
                       (c === T.EXIT && w.exitOpen);
      if (!walkable || dangerous(w, nx, ny)) continue;
      seen[k] = 1; from[k] = y * CFG.CW + x;
      qx.push(nx); qy.push(ny);
      if ((targetGem && c === T.GEM) || (!targetGem && c === T.EXIT)) goal = k;
    }
  }
  if (goal < 0) return 0;
  let k = goal, prev = from[k];
  while (prev !== w.p.y * CFG.CW + w.p.x && prev >= 0) { k = prev; prev = from[k]; }
  const tx = k % CFG.CW, ty = (k / CFG.CW) | 0;
  if (tx > w.p.x) return 2;
  if (tx < w.p.x) return 1;
  if (ty < w.p.y) return 3;
  if (ty > w.p.y) return 4;
  return 0;
}

// ---------------------------------------------------------------------------
// the daily rule: first candidate seed whose cave the Foreman clears.
// Every client derives and verifies this independently — provable fairness.
function tryAttempt(base, P, i) {
  const cave = generate((base + i * 0x9E3779B9) >>> 0, P);
  // editorial gates before we even bother the Foreman
  let space = 0;
  for (const row of cave.grid) for (const c of row) if (c === T.SPACE) space++;
  if (space / (CFG.CW * CFG.CH) > P.maxSpaceFrac) return null;
  const proof = solve(cave);
  if (!proof.cleared) return null;
  if (proof.ticks < P.minPar) return null;      // too easy is also broken
  return { cave, proof, attempt: i, params: P };
}

// `hint` is an untrusted shortcut: the attempt index this device accepted
// last time (cached keyed by GENV + day). A valid hint skips the rejected
// candidates; a wrong one falls through to the full scan. A tampered hint
// only hurts its own device — a non-canonical cave self-quarantines because
// its tapes fail replay-verification on every other client.
export function dailyCave(day, hint) {
  const base = fnv('dailydig:' + day);
  const P = dayParams(day);
  if (Number.isInteger(hint) && hint >= 0 && hint < CFG.seedTries) {
    const got = tryAttempt(base, P, hint);
    if (got) return got;
  }
  for (let i = 0; i < CFG.seedTries; i++) {
    const got = tryAttempt(base, P, i);
    if (got) return got;
  }
  return null;
}

// ---------------------------------------------------------------------------
// replay codec: per-tick inputs, run-length encoded, base64url
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function encodeTape(tape) {
  let out = '';
  let i = 0;
  while (i < tape.length && i < CFG.replayCap) {
    const v = tape[i];
    let run = 1;
    while (i + run < tape.length && tape[i + run] === v && run < 340) run++;
    // symbol: 3 bits input (0-4) packed with run in base-64 pairs
    out += B64[v * 12 + Math.min(11, ((run - 1) / 32) | 0)] + B64[(run - 1) % 32];
    i += run;
  }
  return out;
}
export function decodeTape(s) {
  const tape = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const a = B64.indexOf(s[i]), b = B64.indexOf(s[i + 1]);
    if (a < 0 || b < 0) return null;
    const v = (a / 12) | 0, hi = a % 12;
    if (v > 4) return null;
    const run = hi * 32 + (b % 32) + 1;
    for (let k = 0; k < run && tape.length < CFG.replayCap; k++) tape.push(v);
  }
  return tape;
}

// replay a tape against a day's cave: the verdict is the anti-cheat
export function runTape(cave, tape) {
  const w = newWorld(cave);
  for (let i = 0; i < tape.length && !w.done && !w.dead; i++) tick(w, tape[i]);
  return { cleared: w.done, dead: w.dead, ticks: w.ticks, gems: w.gems, hash: hashWorld(w) };
}
