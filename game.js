// DAILY DIG browser layer — rendering, input, audio, screens, ghosts.
// The sim lives in core.js; this file may read it and may never steer it.
import {
  CFG, T, dayString, dayNumber, dailyCave, newWorld, tick, solve,
  encodeTape, decodeTape, runTape, makeRng,
} from './core.js';

const W = 1280, H = 720, TS = 32;
const MQ = 42, HUD_H = 92;
const VW = W, VH = H - MQ - HUD_H;
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
const MONO = '"Courier New", monospace';

// ---------------------------------------------------------------------------
// palette — warm working mine under lamplight; blueprint-cyan is reserved
// for the company paperwork (HUD chrome), gems own the saturated pops
const PAL = {
  earth: '#7a5a3a', earthDark: '#5d452f',
  bgTop: '#14100c', bgDeep: '#0a0806',
  gem: '#3fd2ff', crate: '#e8a13c', prop: '#b0854e',
  paper: '#f3e7c8', ink: '#c9a35c', blueprint: '#7ad4e8',
  danger: '#ff6b5e', good: '#ffd76a',
};

// ---------------------------------------------------------------------------
// browser state
const B = {
  mode: 'intro',            // intro | play | results | calendar
  leadX: 0, leadY: 0, lastMove: 0,
  day: null, dayN: 1, cave: null, proof: null,
  w: null,                  // live world
  tape: [],                 // my recorded inputs this attempt
  attempts: 0,
  ghosts: [],               // [{label, color, world, tape, i, done}]
  cam: { x: 0, y: 0 },
  tickAcc: 0, time: 0,
  banner: null, toastT: 0, toast: '',
  shake: 0, finishedAt: 0, result: null,
  muted: false, best: null, streak: { n: 0, last: '' },
  copied: 0,
};

// ---------------------------------------------------------------------------
// persistence
function store() { try { return JSON.parse(localStorage.getItem('dailydig') || '{}'); } catch { return {}; } }
function save(s) { try { localStorage.setItem('dailydig', JSON.stringify(s)); } catch {} }
function recordResult(day, res) {
  const s = store();
  s.history = s.history || {};
  const prev = s.history[day];
  if (!prev || res.ticks < prev.ticks) s.history[day] = res;
  const yesterday = dayString(Date.parse(day + 'T00:00:00Z') - 86400000);
  if (s.lastClear !== day) {
    s.streak = (s.lastClear === yesterday) ? (s.streak || 0) + 1 : 1;
    s.lastClear = day;
    s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
  }
  save(s);
}

// ---------------------------------------------------------------------------
// audio — tiny synth kit, unlocked on first gesture
let AC = null, master = null;
function audio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); master.gain.value = B.muted ? 0 : 0.4;
  master.connect(AC.destination);
}
function blip(f, dur = 0.07, type = 'square', vol = 0.15, slide = 0) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function rumble(dur = 0.3, vol = 0.3, cut = 700) {
  if (!AC) return;
  const n = AC.sampleRate * dur, buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
  const g = AC.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master); src.start();
}
const SFX = {
  dig: () => rumble(0.08, 0.1, 1400),
  gem: () => { blip(880, 0.07, 'square', 0.14); blip(1320, 0.1, 'square', 0.1); },
  thud: () => rumble(0.16, 0.22, 500),
  boom: () => { rumble(0.5, 0.4, 380); blip(90, 0.35, 'sawtooth', 0.2, 40); },
  open: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.12, 'square', 0.13), i * 90)),
  clear: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => blip(f, 0.15, 'square', 0.13), i * 100)),
  die: () => { rumble(0.4, 0.35, 600); blip(220, 0.4, 'sawtooth', 0.16, 60); },
  push: () => rumble(0.09, 0.12, 900),
  prop: () => { rumble(0.14, 0.2, 800); blip(160, 0.12, 'triangle', 0.12, 90); },
};

// ---------------------------------------------------------------------------
// day bootstrap
const q = new URLSearchParams(location.search);
function loadDay() {
  let day = q.get('day') || dayString(Date.now());
  let ghostParam = null;
  if (location.hash.startsWith('#g=')) {
    const parts = location.hash.slice(3).split('.');
    if (parts.length === 2) { day = parts[0]; ghostParam = parts[1]; }
  }
  B.day = day;
  B.dayN = dayNumber(day);
  const d = dailyCave(day);
  if (!d) { B.mode = 'broken'; return; }
  B.cave = d.cave; B.proof = d.proof;
  B.ghostTapes = [{ label: 'FOREMAN', color: '#7ad4e8', tape: d.proof.tape }];
  if (ghostParam) {
    const tape = decodeTape(ghostParam);
    if (tape) {
      const check = runTape(d.cave, tape);
      if (check.cleared) B.ghostTapes.push({ label: 'RIVAL', color: '#ff8ad0', tape, ticks: check.ticks });
    }
  }
  const s = store();
  B.streak = { n: s.streak || 0, last: s.lastClear || '' };
  B.best = (s.history || {})[day] || null;
}

function startAttempt() {
  B.w = newWorld(B.cave);
  B.tape = [];
  B.attempts++;
  B.time = 0; B.tickAcc = 0;
  B.ghosts = B.ghostTapes.map((g) => ({ ...g, world: newWorld(B.cave), i: 0, done: false }));
  B.mode = 'play';
  B.banner = { text: `SHIFT ${B.dayN}`, sub: B.day + ' — quota ' + B.w.quota, t: 1.6 };
  snapCam(true);
}

// ---------------------------------------------------------------------------
// input
const keys = {};
let touchHeld = 0;
// last-pressed-wins held stack + a one-shot tap buffer: a tap that falls
// between physics ticks still digs exactly one cell, never zero, never two
const KEY2DIR = { arrowleft: 1, a: 1, arrowright: 2, d: 2, arrowup: 3, w: 3, arrowdown: 4, s: 4 };
const heldStack = [];
let tapBuffer = 0;
function currentInput() {
  if (heldStack.length) { tapBuffer = 0; return heldStack[heldStack.length - 1]; }
  if (touchHeld) { tapBuffer = 0; return touchHeld; }
  const t = tapBuffer; tapBuffer = 0;
  return t;
}
function resultsLocked() { return B.time - B.finishedAt < 0.45; }
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  keys[k] = true;
  const dir = KEY2DIR[k];
  if (dir) {
    const i = heldStack.indexOf(dir);
    if (i >= 0) heldStack.splice(i, 1);
    heldStack.push(dir);
    tapBuffer = dir;
  }
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  audio();
  if (k === 'm') { B.muted = !B.muted; if (master) master.gain.value = B.muted ? 0 : 0.4; }
  if (B.mode === 'intro' && (e.key === ' ' || e.key === 'Enter')) startAttempt();
  else if (B.mode === 'results' && (e.key === ' ' || e.key === 'Enter') && !resultsLocked()) startAttempt();
  else if (B.mode === 'results' && k === 'c') copyShare();
  else if (B.mode === 'play' && k === 'r') startAttempt();
});
addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  keys[k] = false;
  const dir = KEY2DIR[k];
  if (dir) { const i = heldStack.indexOf(dir); if (i >= 0) heldStack.splice(i, 1); }
});
// losing focus mid-hold means the keyup never arrives — drop everything,
// or the digger walks into a rock while you answer a text
addEventListener('blur', () => {
  heldStack.length = 0; tapBuffer = 0; touchHeld = 0; tId = null;
  for (const k in keys) keys[k] = false;
});

let tId = null, tax = 0, tay = 0;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault(); audio();
  if (B.mode !== 'play') { if (B.mode === 'intro' || (B.mode === 'results' && !resultsLocked())) startAttempt(); return; }
  if (tId !== null) return;
  const t = e.changedTouches[0];
  tId = t.identifier; tax = t.clientX; tay = t.clientY;
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== tId) continue;
    const dx = t.clientX - tax, dy = t.clientY - tay;
    const DEAD = 14;
    if (Math.abs(dx) < DEAD && Math.abs(dy) < DEAD) { touchHeld = 0; continue; }
    touchHeld = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 4 : 3);
    const R = 34;
    if (Math.abs(dx) > R) tax = t.clientX - Math.sign(dx) * R;
    if (Math.abs(dy) > R) tay = t.clientY - Math.sign(dy) * R;
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) if (t.identifier === tId) { tId = null; touchHeld = 0; }
});
canvas.addEventListener('mousedown', () => {
  audio();
  if (B.mode === 'intro' || (B.mode === 'results' && !resultsLocked())) startAttempt();
});
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------------------
// share
function medalFor(ticks) {
  const par = B.proof.ticks;
  if (ticks <= par) return { e: '👷', name: 'SHIFT BOSS' };
  if (ticks <= par * 1.7) return { e: '🥇', name: 'GOLD' };
  if (ticks <= par * 2.8) return { e: '🥈', name: 'SILVER' };
  return { e: '🥉', name: 'BRONZE' };
}
function fmtT(ticks) {
  const s = ticks * CFG.TICK;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function shareText(res) {
  const m = medalFor(res.ticks);
  const url = `${location.origin}${location.pathname}#g=${B.day}.${encodeTape(res.tape)}`;
  // strata row: 10 columns of the cave, each glyph = how you treated it
  let row = '';
  for (let cxx = 0; cxx < 10; cxx++) {
    const x0 = 1 + Math.floor(cxx * (CFG.CW - 2) / 10), x1 = 1 + Math.floor((cxx + 1) * (CFG.CW - 2) / 10);
    let dug = 0, tot = 0, gem = 0;
    for (let y = 1; y < CFG.CH - 1; y++) for (let x = x0; x < x1; x++) {
      if (B.cave.grid[y][x] === T.DIRT) tot++;
      if (B.cave.grid[y][x] === T.DIRT && B.w.grid[y][x] !== T.DIRT) dug++;
      if (B.cave.grid[y][x] === T.GEM && B.w.grid[y][x] !== T.GEM) gem++;
    }
    row += gem > 0 ? '💎' : dug / Math.max(1, tot) > 0.12 ? '🟫' : '⬛';
  }
  return `DAILY DIG #${B.dayN} ⛏️\n${m.e} ${fmtT(res.ticks)} · ${res.attempts} attempt${res.attempts === 1 ? '' : 's'} · 👷 ${fmtT(B.proof.ticks)}\n${row}\nrace my ghost: ${url}`;
}
function copyShare() {
  if (!B.result) return;
  try { navigator.clipboard.writeText(shareText(B.result)); B.copied = B.time; } catch {}
}

// ---------------------------------------------------------------------------
// update
const LEAD = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
function snapCam(hard) {
  // the camera leads the digger: you see where you are going, not where
  // you have been — the difference between driving and being dragged
  const [ldx, ldy] = LEAD[B.lastMove] || [0, 0];
  const gain = B.w.p.moving ? 1 : 0.35;
  B.leadX += (ldx * TS * 2.6 * gain - B.leadX) * (hard ? 1 : 0.05);
  B.leadY += (ldy * TS * 1.8 * gain - B.leadY) * (hard ? 1 : 0.05);
  const px = B.w.p.x * TS + TS / 2 - VW / 2 + B.leadX, py = B.w.p.y * TS + TS / 2 - VH / 2 + B.leadY;
  const tx = Math.max(0, Math.min(CFG.CW * TS - VW, px));
  const ty = Math.max(0, Math.min(CFG.CH * TS - VH, py));
  if (hard) { B.cam.x = tx; B.cam.y = ty; }
  else { B.cam.x += (tx - B.cam.x) * 0.12; B.cam.y += (ty - B.cam.y) * 0.12; }
}

function update(dt) {
  B.time += dt;
  if (B.banner) { B.banner.t -= dt; if (B.banner.t <= 0) B.banner = null; }
  B.shake = Math.max(0, B.shake - 30 * dt);
  if (B.mode !== 'play') return;
  B.tickAcc += dt;
  while (B.tickAcc >= CFG.TICK) {
    B.tickAcc -= CFG.TICK;
    const input = currentInput();
    if (input > 0) B.lastMove = input;
    B.tape.push(input);
    tick(B.w, input);
    for (const ev of B.w.events) {
      if (SFX[ev.t]) SFX[ev.t]();
      if (ev.t === 'boom') B.shake = Math.min(B.shake + 8, 14);
      if (ev.t === 'thud') B.shake = Math.min(B.shake + 1.5, 6);
      if (ev.t === 'open') B.banner = { text: 'QUOTA MET', sub: 'the exit is open', t: 1.6 };
    }
    for (const g of B.ghosts) {
      if (g.done) continue;
      tick(g.world, g.i < g.tape.length ? g.tape[g.i] : 0);
      g.i++;
      if (g.world.done || g.world.dead || g.i > g.tape.length + 30) g.done = true;
    }
    if (B.w.done) {
      const res = { ticks: B.w.ticks, attempts: B.attempts, tape: B.tape.slice(), day: B.day };
      B.result = res;
      recordResult(B.day, { ticks: res.ticks, attempts: res.attempts, medal: medalFor(res.ticks).name, tape: encodeTape(res.tape) });
      const s = store();
      B.streak = { n: s.streak || 0, last: s.lastClear || '' };
      B.best = (s.history || {})[B.day];
      B.mode = 'results';
      B.finishedAt = B.time;
    } else if (B.w.dead) {
      B.banner = { text: 'BURIED', sub: 'tap or SPACE — back to the shaft top', t: 2.2 };
      B.mode = 'results'; B.result = null;
      B.finishedAt = B.time;
    }
  }
  if (B.tape.length >= CFG.replayCap) { B.mode = 'results'; B.result = null; }
  snapCam(false);
}

// ---------------------------------------------------------------------------
// world rendering
const lightC = document.createElement('canvas');
lightC.width = VW / 2; lightC.height = VH / 2;
const lctx = lightC.getContext('2d');
function drawLighting(w, lerp, shx, shy) {
  const s = 0.5;
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = 'rgb(152,134,112)';
  lctx.fillRect(0, 0, lightC.width, lightC.height);
  lctx.globalCompositeOperation = 'lighter';
  const light = (wx, wy, r, col, a) => {
    const lx = (wx - B.cam.x + shx) * s, ly = (wy - B.cam.y + shy) * s;
    if (lx < -r * s || ly < -r * s || lx > lightC.width + r * s || ly > lightC.height + r * s) return;
    const g = lctx.createRadialGradient(lx, ly, 0, lx, ly, r * s);
    g.addColorStop(0, col.replace('A)', a + ')')); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(lx, ly, r * s, 0, 7); lctx.fill();
  };
  const p = w.p;
  const plx = (p.px + (p.x - p.px) * lerp) * TS + TS / 2, ply = (p.py + (p.y - p.py) * lerp) * TS + TS / 2;
  const breathe = 0.985 + 0.012 * Math.sin(B.time * 9);
  light(plx, ply, 270 * breathe, 'rgba(255,233,200,A)', 1.0);
  const x0 = Math.max(0, B.cam.x / TS - 2 | 0), x1 = Math.min(CFG.CW, (B.cam.x + VW) / TS + 3 | 0);
  const y0 = Math.max(0, B.cam.y / TS - 2 | 0), y1 = Math.min(CFG.CH, (B.cam.y + VH) / TS + 3 | 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = w.grid[y][x];
    if (c === T.GEM) light(x * TS + TS / 2, y * TS + TS / 2, 66, 'rgba(63,210,255,A)', 0.55);
    else if (c === T.EXIT && w.exitOpen) light(x * TS + TS / 2, y * TS + TS / 2, 190, 'rgba(255,215,106,A)', 0.85);
    else if (c === T.CRATE) light(x * TS + TS / 2, y * TS + TS / 2, 44, 'rgba(255,160,60,A)', 0.22);
  }
  for (const e of w.gnashers) light(e.x * TS + TS / 2, e.y * TS + TS / 2, 90, 'rgba(255,70,50,A)', 0.5);
  for (const ev of w.events) if (ev.t === 'boom') light(ev.x * TS + TS / 2, ev.y * TS + TS / 2, 260, 'rgba(255,240,210,A)', 0.95);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lightC, 0, MQ, VW, VH);
  ctx.restore();
}

// objects sit in excavated pockets of the same earth, never on black stickers
function pocket(x, y) {
  const px = x * TS, py = y * TS;
  const tex = dirtTexture();
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.drawImage(tex, (x % 8) * TS, (y % 8) * TS, TS, TS, px, py, TS, TS);
  ctx.restore();
  ctx.fillStyle = 'rgba(20,12,6,0.22)';
  ctx.fillRect(px, py, TS, TS);
  ctx.fillStyle = 'rgba(255,214,150,0.14)';
  ctx.fillRect(px, py, TS, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(px, py + TS - 3, TS, 3);
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  ctx.fillStyle = 'rgba(150,120,86,0.5)';
  for (let k = 0; k < 3; k++) {
    const ex2 = (h >> (k * 5)) & 15, ey2 = (h >> (k * 5 + 8)) & 1;
    ctx.fillRect(px + 2 + ex2 * 1.8, ey2 ? py + 1 : py + TS - 3, 3, 2);
  }
}

let dirtTex = null;
function dirtTexture() {
  if (dirtTex) return dirtTex;
  const c = document.createElement('canvas'); c.width = TS * 8; c.height = TS * 8;
  const x = c.getContext('2d');
  const rng = makeRng(777);
  x.fillStyle = PAL.earth; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 120; i++) {
    const bx = rng() * c.width, by = rng() * c.height, r = 8 + rng() * 30;
    const g = x.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0, `rgba(${60 + rng() * 60 | 0},${45 + rng() * 40 | 0},${28 + rng() * 24 | 0},${0.25 + rng() * 0.25})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  for (let i = 0; i < 5; i++) {
    const sy = (i + 0.5) * c.height / 5;
    x.strokeStyle = 'rgba(40,28,16,0.4)'; x.lineWidth = 2 + rng() * 2;
    x.beginPath();
    for (let sx = 0; sx <= c.width; sx += 12) x.lineTo(sx, sy + Math.sin(sx * 0.05 + i * 2) * 4 + rng() * 2);
    x.stroke();
  }
  for (let i = 0; i < 400; i++) {
    x.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(220,190,150,0.12)';
    x.fillRect(rng() * c.width | 0, rng() * c.height | 0, 1 + rng() * 2, 1 + rng() * 1.5);
  }
  dirtTex = c;
  return c;
}

function poly2(x1, y1, x2, y2, x3, y3) {
  ctx.fillStyle = '#8a6030';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
}
function drawCell(x, y, c, w, MV, lerp) {
  const px = x * TS, py = y * TS;
  const m = MV.get(y * CFG.CW + x);
  const ox = m ? m.dx * TS * (1 - lerp) : 0, oy = m ? m.dy * TS * (1 - lerp) : 0;
  switch (c) {
    case T.DIRT: {
      const tex = dirtTexture();
      ctx.drawImage(tex, (x % 8) * TS, (y % 8) * TS, TS, TS, px, py, TS, TS);
      break;
    }
    case T.WALL: {
      // dressed sandstone masonry, offset courses
      const odd = y & 1;
      const g2 = ctx.createLinearGradient(px, py, px, py + TS);
      g2.addColorStop(0, '#8a7355'); g2.addColorStop(0.5, '#70593d'); g2.addColorStop(1, '#7c6547');
      ctx.fillStyle = g2; ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = '#4a3826';
      ctx.fillRect(px, py + TS - 2, TS, 2);
      ctx.fillRect(px + (odd ? TS / 2 - 1 : TS / 4 - 1), py + 2, 2, TS - 4);
      ctx.fillStyle = 'rgba(255,224,170,0.18)'; ctx.fillRect(px + 1, py + 1, TS - 2, 2);
      const h2 = ((x * 31 + y * 57) % 7);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(px + 4 + h2 * 3, py + 8 + (h2 % 3) * 6, 3, 2);
      break;
    }
    case T.STEEL: {
      // company iron: plate, rivets, and depth etched on the western rim
      const g3 = ctx.createLinearGradient(px, py, px, py + TS);
      g3.addColorStop(0, '#3c352c'); g3.addColorStop(0.5, '#2a251f'); g3.addColorStop(1, '#332d26');
      ctx.fillStyle = g3; ctx.fillRect(px, py, TS, TS);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.75, py + 0.75, TS - 1.5, TS - 1.5);
      ctx.fillStyle = 'rgba(255,240,210,0.1)'; ctx.fillRect(px + 2, py + 2, TS - 4, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (const [rx, ry] of [[6, 6], [TS - 6, 6], [6, TS - 6], [TS - 6, TS - 6]]) {
        ctx.beginPath(); ctx.arc(px + rx, py + ry, 1.6, 0, 7); ctx.fill();
      }
      if (x === 0 && y % 6 === 3) {
        ctx.save();
        ctx.font = `800 11px ${MONO}`; ctx.textAlign = 'center';
        ctx.translate(px + TS / 2, py + TS / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(`${y * 4}m`, 0.8, 3.8);
        ctx.fillStyle = 'rgba(201,168,106,0.85)';
        ctx.fillText(`${y * 4}m`, 0, 3);
        ctx.restore();
      }
      break;
    }
    case T.ROCK: {
      pocket(x, y);
      ctx.save();
      ctx.translate(px + TS / 2 + ox, py + TS / 2 + oy);
      if (m && m.dx) ctx.rotate(m.dx * (1 - lerp) * 1.1);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(0, TS / 2 - 3, 12, 3.5, 0, 0, 7); ctx.fill();
      const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 15);
      g.addColorStop(0, '#a4988a'); g.addColorStop(0.6, '#7c7264'); g.addColorStop(1, '#4c443a');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + ((x * 7 + y) % 5);
        const r = 13 + Math.sin(i * 2.3 + x + y) * 2;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.95) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.95);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.restore();
      break;
    }
    case T.GEM: {
      pocket(x, y);
      ctx.save();
      ctx.translate(px + TS / 2 + ox, py + TS / 2 + oy);
      const ph = ((x * 73 + y * 131) % 97) / 97 * Math.PI * 2;
      ctx.rotate(Math.sin(B.time * 2 + ph) * 0.1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      gg.addColorStop(0, `rgba(63,210,255,${0.22 + 0.12 * Math.sin(B.time * 3 + ph)})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill();
      ctx.restore();
      const F = (pts, col) => { ctx.beginPath(); pts.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
      F([[-6, -10], [6, -10], [11, -2], [0, 11], [-11, -2]], '#2b9cc4');
      F([[-6, -10], [6, -10], [5, -2], [-5, -2]], '#bdeeff');
      F([[-5, -2], [5, -2], [0, 11]], '#66d8ff');
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-11, -2); ctx.lineTo(11, -2); ctx.stroke();
      const gk = Math.sin(B.time * 2.7 + ph);
      if (gk > 0.55) {
        const s = 3 + 4 * (gk - 0.55) / 0.45;
        ctx.strokeStyle = `rgba(255,255,255,${(gk - 0.55) / 0.45})`; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-3 - s, -6); ctx.lineTo(-3 + s, -6); ctx.moveTo(-3, -6 - s); ctx.lineTo(-3, -6 + s);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case T.CRATE: {
      pocket(x, y);
      ctx.save();
      ctx.translate(px + ox, py + oy);
      // planked powder crate, warning diamond, a stub of fuse
      const pg = ctx.createLinearGradient(0, 3, 0, TS - 3);
      pg.addColorStop(0, '#a87c44'); pg.addColorStop(1, '#7c5628');
      ctx.fillStyle = pg; ctx.fillRect(3, 3, TS - 6, TS - 6);
      ctx.strokeStyle = 'rgba(60,38,16,0.8)'; ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(3, 3 + k * (TS - 6) / 4); ctx.lineTo(TS - 3, 3 + k * (TS - 6) / 4); ctx.stroke(); }
      ctx.strokeStyle = '#4c3214'; ctx.lineWidth = 2.5;
      ctx.strokeRect(4, 4, TS - 8, TS - 8);
      ctx.save();
      ctx.translate(TS / 2, TS / 2); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#e8402a'; ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#fff0d8'; ctx.fillRect(-5, -5, 10, 10);
      ctx.fillStyle = '#e8402a'; ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      ctx.strokeStyle = '#2c2016'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(TS - 9, 4); ctx.quadraticCurveTo(TS - 5, 0, TS - 10, 1); ctx.stroke();
      const fk = 1.6 + Math.sin(B.time * 11 + x * 3) * 0.7;
      ctx.fillStyle = '#ffb040';
      ctx.beginPath(); ctx.arc(TS - 10, 1, fk, 0, 7); ctx.fill();
      ctx.restore();
      break;
    }
    case T.PROP: {
      pocket(x, y);
      // load-bearing timber: post, header beam, wedges, grain
      const wg = ctx.createLinearGradient(px + TS / 2 - 5, py, px + TS / 2 + 5, py);
      wg.addColorStop(0, '#c49a5e'); wg.addColorStop(0.5, '#a87c44'); wg.addColorStop(1, '#8a6030');
      ctx.fillStyle = wg;
      ctx.fillRect(px + TS / 2 - 5, py + 6, 10, TS - 6);
      ctx.fillStyle = '#b0854e';
      ctx.fillRect(px + 2, py + 2, TS - 4, 6);
      ctx.fillStyle = 'rgba(255,230,180,0.35)'; ctx.fillRect(px + 2, py + 2, TS - 4, 2);
      ctx.fillStyle = 'rgba(60,38,16,0.6)';
      ctx.fillRect(px + 2, py + 6, TS - 4, 1.5);
      poly2(px + TS / 2 - 9, py + 8, px + TS / 2 - 5, py + 8, px + TS / 2 - 5, py + 14);
      poly2(px + TS / 2 + 9, py + 8, px + TS / 2 + 5, py + 8, px + TS / 2 + 5, py + 14);
      ctx.strokeStyle = 'rgba(90,60,30,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + TS / 2 - 2, py + 8); ctx.lineTo(px + TS / 2 - 2, py + TS - 2);
      ctx.moveTo(px + TS / 2 + 2, py + 10); ctx.lineTo(px + TS / 2 + 2, py + TS - 4);
      ctx.stroke();
      break;
    }
    case T.EXIT: {
      const open = w.exitOpen;
      ctx.fillStyle = '#241c12'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
      if (open) {
        const dg = ctx.createLinearGradient(px, py, px, py + TS);
        dg.addColorStop(0, '#ffd97a'); dg.addColorStop(1, '#c98d34');
        ctx.fillStyle = dg; ctx.fillRect(px + 5, py + 4, TS - 10, TS - 6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px + TS / 2, py + TS / 2, 0, px + TS / 2, py + TS / 2, 70);
        g.addColorStop(0, `rgba(255,215,106,${0.4 + 0.15 * Math.sin(B.time * 3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 70, 0, 7); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = open ? '#b08d4a' : 'rgba(201,163,92,0.5)'; ctx.lineWidth = 3;
      ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6);
      break;
    }
  }
}

function drawDigger(wp, lerp, color, alpha, moving) {
  const lx = (wp.px + (wp.x - wp.px) * lerp) * TS, ly = (wp.py + (wp.y - wp.py) * lerp) * TS;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(lx + TS / 2, ly + TS);
  // lamp
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(0, -20, 0, 0, -20, 46);
  lg.addColorStop(0, `rgba(255,240,180,${0.2 * alpha})`); lg.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(0, -20, 46, 0, 7); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(0, -1, 9, 3, 0, 0, 7); ctx.fill();
  const bob = moving ? Math.sin(B.time * 18) * 1.2 : Math.sin(B.time * 2.4) * 0.8;
  ctx.translate(0, bob);
  // body
  ctx.fillStyle = color === 'me' ? '#4f7fb5' : color;
  ctx.fillRect(-6, -20, 12, 12);
  ctx.fillStyle = color === 'me' ? '#35597f' : color;
  ctx.fillRect(-6, -10, 5, 9); ctx.fillRect(1, -10, 5, 9);
  // survival outline: one warm pixel of rim, whatever the light says
  ctx.strokeStyle = 'rgba(255,233,176,0.55)'; ctx.lineWidth = 1;
  ctx.strokeRect(-7, -32, 14, 25);
  // head + helmet + lamp
  ctx.fillStyle = '#f0c8a0'; ctx.fillRect(-5, -27, 10, 8);
  ctx.fillStyle = '#ffd12a'; ctx.fillRect(-6, -31, 12, 6);
  ctx.fillStyle = '#fff7d0'; ctx.fillRect(wp.dir < 0 ? -8 : 4, -30, 4, 4);
  ctx.restore();
}

function draw() {
  ctx.fillStyle = '#0a0705'; ctx.fillRect(0, 0, W, H);
  if (B.mode === 'broken') { drawBroken(); return; }
  const w = B.w;
  if (!w) { drawIntro(); return; }

  const lerp = Math.max(0, Math.min(1, B.tickAcc / CFG.TICK));
  const MV = new Map();
  for (const m of w.moves) MV.set(m.y * CFG.CW + m.x, m);

  // one shake offset per frame: tiles, lighting, and sprites all share it,
  // so the layers never tear apart under a boom
  const shx = B.shake > 0.1 ? (Math.random() - 0.5) * B.shake : 0;
  const shy = B.shake > 0.1 ? (Math.random() - 0.5) * B.shake * 0.7 : 0;

  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.translate(shx, MQ + shy);
  ctx.translate(-B.cam.x, -B.cam.y);

  const bg = ctx.createLinearGradient(0, B.cam.y, 0, B.cam.y + VH);
  bg.addColorStop(0, PAL.bgTop); bg.addColorStop(1, PAL.bgDeep);
  ctx.fillStyle = bg; ctx.fillRect(B.cam.x, B.cam.y, VW, VH);

  const x0 = Math.max(0, B.cam.x / TS - 1 | 0), x1 = Math.min(CFG.CW, (B.cam.x + VW) / TS + 2 | 0);
  const y0 = Math.max(0, B.cam.y / TS - 1 | 0), y1 = Math.min(CFG.CH, (B.cam.y + VH) / TS + 2 | 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const c = w.grid[y][x];
    if (c !== T.SPACE && c !== T.PLAYER && c !== T.GNASH) drawCell(x, y, c, w, MV, lerp);
    else if (c === T.SPACE || c === T.PLAYER) {
      // carved residue: crumbs where earth used to be
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      ctx.fillStyle = 'rgba(122,104,84,0.32)';
      for (let k = 0; k < 3; k++) {
        const cx2 = (h >> (k * 6)) & 31, cy2 = (h >> (k * 6 + 9)) & 31;
        ctx.fillRect(x * TS + (cx2 % 28) + 2, y * TS + (cy2 % 28) + 2, 2, 1.6);
      }
    }
  }

  // depth strata: the deeper the row, the older the earth
  const sg2 = ctx.createLinearGradient(0, 0, 0, CFG.CH * TS);
  sg2.addColorStop(0, 'rgba(255,220,170,0.05)');
  sg2.addColorStop(0.4, 'rgba(0,0,0,0)');
  sg2.addColorStop(1, 'rgba(10,4,16,0.3)');
  ctx.fillStyle = sg2;
  ctx.fillRect(B.cam.x, 0, VW, CFG.CH * TS);
  ctx.strokeStyle = 'rgba(40,26,14,0.28)'; ctx.lineWidth = 2;
  for (let sy = 8; sy < CFG.CH; sy += 8) {
    ctx.beginPath();
    for (let sx = x0 * TS; sx <= x1 * TS; sx += 16)
      ctx.lineTo(sx, sy * TS + Math.sin(sx * 0.02 + sy) * 4);
    ctx.stroke();
  }

  ctx.restore();
  drawLighting(w, lerp, shx, shy);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.translate(shx, MQ + shy);
  ctx.translate(-B.cam.x, -B.cam.y);
  // golden lamplight: additive over the shadowed earth
  {
    const p2 = w.p;
    const lx2 = (p2.px + (p2.x - p2.px) * lerp) * TS + TS / 2, ly2 = (p2.py + (p2.y - p2.py) * lerp) * TS + TS / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(lx2, ly2, 6, lx2, ly2, 160);
    gl.addColorStop(0, 'rgba(255,210,122,0.22)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(lx2, ly2, 160, 0, 7); ctx.fill();
    ctx.restore();
  }
  // gnashers — threats live above the shadow so they never hide
  for (const e of w.gnashers) {
    const gx = ((e.px ?? e.x) + (e.x - (e.px ?? e.x)) * lerp) * TS + TS / 2;
    const gy = ((e.py ?? e.y) + (e.y - (e.py ?? e.y)) * lerp) * TS + TS / 2;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
    g.addColorStop(0, 'rgba(255,80,60,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
    ctx.restore();
    const ch = Math.sin(B.time * 9 + e.x) * 3;
    ctx.fillStyle = '#c83a2a';
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a0e0a';
    ctx.beginPath();
    ctx.moveTo(-8, -2 + ch * 0.3); ctx.lineTo(8, -2 - ch * 0.3); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe9c8';
    ctx.fillRect(-5, -6, 3, 3); ctx.fillRect(2, -6, 3, 3);
    ctx.restore();
  }

  // ghosts under the player
  for (const g of B.ghosts) {
    if (g.done && g.world.done) continue;
    drawDigger(g.world.p, lerp, g.color, 0.4, g.world.p.moving);
  }
  if (!w.dead) drawDigger(w.p, lerp, 'me', 1, w.p.moving);

  // events fx (single-frame flashes; a real particle pass comes later)
  for (const ev of w.events) {
    if (ev.t === 'boom') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(ev.x * TS + TS / 2, ev.y * TS + TS / 2, 0, ev.x * TS + TS / 2, ev.y * TS + TS / 2, 70);
      g.addColorStop(0, 'rgba(255,220,150,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(ev.x * TS + TS / 2, ev.y * TS + TS / 2, 70, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  drawMarquee();
  drawHUD();
  if (B.banner) drawBanner();
  if (B.mode === 'results') drawResults();
  if (B.mode === 'intro') drawIntro();
}

// ---------------------------------------------------------------------------
// chrome
function label(txt, x, y, size = 12, color = 'rgba(214,192,156,0.9)', align = 'left') {
  ctx.font = `700 ${size}px Verdana, sans-serif`;
  ctx.letterSpacing = '2px';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
  ctx.letterSpacing = '0px';
}
function drawMarquee() {
  ctx.fillStyle = '#171008'; ctx.fillRect(0, 0, W, MQ);
  ctx.fillStyle = 'rgba(201,163,92,0.55)'; ctx.fillRect(0, MQ - 2, W, 2);
  ctx.font = `800 18px "Arial Black", Arial, sans-serif`;
  ctx.letterSpacing = '4px'; ctx.textAlign = 'center';
  ctx.fillStyle = '#e8c987';
  ctx.fillText(`DAILY DIG — SHIFT ${B.dayN}`, W / 2, 28);
  ctx.letterSpacing = '0px';
  label(B.day, 24, 27, 12, 'rgba(214,192,156,0.8)');
  if (B.w) label(IS_TOUCH ? 'DRAG TO DIG' : 'WASD / ARROWS · R RESTART · M MUTE', W - 24, 27, 10, 'rgba(214,192,156,0.6)', 'right');
}
function drawHUD() {
  const HY = H - HUD_H;
  ctx.fillStyle = '#161009'; ctx.fillRect(0, HY, W, HUD_H);
  ctx.fillStyle = 'rgba(201,163,92,0.85)'; ctx.fillRect(0, HY, W, 2);
  const w = B.w;
  if (!w) return;
  // gems
  label('GEMS', 32, HY + 30);
  ctx.font = `800 26px ${MONO}`; ctx.textAlign = 'left';
  ctx.fillStyle = w.exitOpen ? PAL.good : PAL.paper;
  ctx.fillText(`${w.gems}/${w.quota}`, 32, HY + 64);
  // time vs par
  label('TIME', 260, HY + 30);
  ctx.font = `800 26px ${MONO}`;
  ctx.fillStyle = w.ticks <= B.proof.ticks ? PAL.blueprint : PAL.paper;
  ctx.fillText(fmtT(w.ticks), 260, HY + 64);
  label(`PAR ${fmtT(B.proof.ticks)}`, 400, HY + 58, 11, 'rgba(122,212,232,0.75)');
  // ghosts status
  let gy2 = HY + 30;
  for (const g of B.ghosts) {
    label(g.label, 620, gy2, 10, g.color);
    label(g.world.done ? 'CLEAR ' + fmtT(g.world.ticks) : g.world.dead ? 'BURIED' : fmtT(g.world.ticks), 700, gy2, 10, 'rgba(243,231,200,0.8)');
    gy2 += 22;
  }
  // attempts + streak + best
  label('ATTEMPT', 900, HY + 30);
  ctx.font = `800 20px ${MONO}`; ctx.fillStyle = PAL.paper;
  ctx.fillText(String(B.attempts), 900, HY + 60);
  label('STREAK', 1020, HY + 30);
  ctx.font = `800 20px ${MONO}`; ctx.fillStyle = B.streak.n > 0 ? PAL.good : PAL.paper;
  ctx.fillText(`${B.streak.n}🔥`.replace('🔥', ''), 1020, HY + 60);
  if (B.best) {
    label('BEST', 1140, HY + 30);
    ctx.font = `800 20px ${MONO}`; ctx.fillStyle = PAL.paper;
    ctx.fillText(fmtT(B.best.ticks), 1140, HY + 60);
  }
}
function drawBanner() {
  const a = Math.min(1, B.banner.t * 3, (1.8 - B.banner.t) * 4);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.fillStyle = 'rgba(18,12,6,0.85)';
  ctx.fillRect(0, H * 0.34, W, 96);
  ctx.textAlign = 'center';
  ctx.font = '900 34px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillStyle = PAL.good;
  ctx.fillText(B.banner.text, W / 2, H * 0.34 + 46);
  ctx.font = '600 14px Verdana, sans-serif';
  ctx.fillStyle = PAL.paper;
  ctx.fillText(B.banner.sub, W / 2, H * 0.34 + 76);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function panel(x, y, w2, h2) {
  ctx.fillStyle = 'rgba(16,11,6,0.94)';
  ctx.beginPath(); ctx.roundRect(x, y, w2, h2, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(201,163,92,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w2 - 6, h2 - 6, 11); ctx.stroke();
}
function drawIntro() {
  panel(W / 2 - 330, H / 2 - 190, 660, 380);
  ctx.textAlign = 'center';
  ctx.font = '900 44px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '6px';
  const wm = ctx.createLinearGradient(0, H / 2 - 140, 0, H / 2 - 96);
  wm.addColorStop(0, '#fff3d0'); wm.addColorStop(0.5, '#ffd97a'); wm.addColorStop(1, '#b0802e');
  ctx.fillStyle = wm;
  ctx.fillText('DAILY DIG', W / 2, H / 2 - 100);
  ctx.letterSpacing = '0px';
  label(`SHIFT ${B.dayN} — ${B.day}`, W / 2, H / 2 - 62, 14, PAL.ink, 'center');
  label('one cave · the whole world · every day', W / 2, H / 2 - 34, 12, 'rgba(214,192,156,0.8)', 'center');
  ctx.font = `700 15px Verdana, sans-serif`; ctx.fillStyle = PAL.paper; ctx.textAlign = 'center';
  ctx.fillText(`Dig the quota of ${B.proof ? B.proof.quota : '—'} gems, reach the exit, beat the clock.`, W / 2, H / 2 + 4);
  ctx.fillText(`The FOREMAN cleared it in ${fmtT(B.proof.ticks)} — race his ghost.`, W / 2, H / 2 + 30);
  if (B.ghostTapes && B.ghostTapes.length > 1) {
    ctx.fillStyle = '#ff8ad0';
    ctx.fillText(`A RIVAL's ghost is waiting: ${fmtT(B.ghostTapes[1].ticks)}. Beat it.`, W / 2, H / 2 + 56);
  }
  if ((B.time * 1.6 | 0) % 2 === 0) {
    label(IS_TOUCH ? 'TAP TO CLOCK IN' : 'SPACE TO CLOCK IN', W / 2, H / 2 + 110, 18, '#ffffff', 'center');
  }
  label('watch your head — rocks fall, props snap, TNT is TNT', W / 2, H / 2 + 150, 10, 'rgba(214,192,156,0.6)', 'center');
}
function drawResults() {
  const res = B.result;
  ctx.fillStyle = 'rgba(18,10,6,0.45)';
  ctx.fillRect(0, 0, W, H);
  panel(W / 2 - 330, H / 2 - 170, 660, 340);
  ctx.textAlign = 'center';
  if (res) {
    const m = medalFor(res.ticks);
    ctx.font = '900 36px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = PAL.good;
    ctx.fillText(`${m.name} — ${fmtT(res.ticks)}`, W / 2, H / 2 - 110);
    label(`Foreman ${fmtT(B.proof.ticks)} · attempt ${res.attempts} · streak ${B.streak.n}`, W / 2, H / 2 - 74, 13, PAL.ink, 'center');
    ctx.font = `700 14px Verdana, sans-serif`; ctx.fillStyle = PAL.paper;
    ctx.fillText(res.ticks <= B.proof.ticks ? 'You outdug the Foreman. The company is watching.' :
      'Share your ghost — the link IS the replay.', W / 2, H / 2 - 40);
    // share box
    ctx.fillStyle = 'rgba(122,212,232,0.12)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 280, H / 2 - 16, 560, 66, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(122,212,232,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W / 2 - 280, H / 2 - 16, 560, 66, 10); ctx.stroke();
    ctx.font = `700 13px ${MONO}`; ctx.fillStyle = PAL.blueprint;
    const st = shareText(res).split('\n');
    ctx.fillText(st[0] + '  ·  ' + st[1], W / 2, H / 2 + 8);
    ctx.font = `700 16px ${MONO}`;
    ctx.fillText(st[2], W / 2, H / 2 + 34);
    label(B.time - B.copied < 2 && B.copied > 0 ? 'COPIED — go make someone lose their lunch break' : (IS_TOUCH ? 'TAP SHARE below' : 'C TO COPY SHARE + GHOST LINK'), W / 2, H / 2 + 84, 12, B.time - B.copied < 2 && B.copied > 0 ? PAL.good : PAL.blueprint, 'center');
    label(IS_TOUCH ? 'TAP TO DIG AGAIN' : 'SPACE TO DIG AGAIN', W / 2, H / 2 + 128, 14, '#ffffff', 'center');
  } else {
    ctx.font = '900 36px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = PAL.danger;
    ctx.fillText('BURIED', W / 2, H / 2 - 100);
    label(`attempt ${B.attempts} — the cave keeps the gems you banked? No. It keeps everything.`, W / 2, H / 2 - 60, 12, PAL.paper, 'center');
    label(IS_TOUCH ? 'TAP TO CLOCK BACK IN' : 'SPACE TO CLOCK BACK IN', W / 2, H / 2 + 60, 16, '#ffffff', 'center');
  }
}
function drawBroken() {
  ctx.textAlign = 'center';
  ctx.fillStyle = PAL.danger;
  ctx.font = '900 28px "Arial Black", Arial, sans-serif';
  ctx.fillText('NO DIGGABLE CAVE TODAY — THE MINE IS CLOSED', W / 2, H / 2);
}

// results-screen share tap zone (touch)
canvas.addEventListener('click', (e) => {
  if (B.mode !== 'results' || !B.result) return;
  const r = canvas.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height * H;
  if (y > H / 2 - 16 && y < H / 2 + 96) copyShare();
});

// ---------------------------------------------------------------------------
// deterministic screenshot harness for the critic loop
function stepWorld(n, inputFn) {
  for (let i = 0; i < n; i++) {
    const inp = inputFn ? inputFn(B.w, i) : 0;
    if (inp > 0) B.lastMove = inp;
    B.tape.push(inp);
    tick(B.w, inp);
    for (const g of B.ghosts) { if (!g.done) { tick(g.world, g.i < g.tape.length ? g.tape[g.i] : 0); g.i++; if (g.world.done || g.world.dead) g.done = true; } }
  }
  snapCam(true);
}
function runShot(name, f) {
  B.day = q.get('day') || '2026-08-03';
  B.dayN = dayNumber(B.day);
  const d = dailyCave(B.day);
  B.cave = d.cave; B.proof = d.proof;
  B.ghostTapes = [{ label: 'FOREMAN', color: '#7ad4e8', tape: d.proof.tape }];
  if (name === 'intro') { B.time = 0.4; draw(); document.title = 'shot-ready'; return; }
  if (name === 'map') {
    B.w = newWorld(d.cave);
    B.time = 30;
    const s = Math.min(W / (CFG.CW * TS), (H - 40) / (CFG.CH * TS));
    ctx.fillStyle = '#0a0705'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate((W - CFG.CW * TS * s) / 2, 40 + (H - 40 - CFG.CH * TS * s) / 2);
    ctx.scale(s, s);
    const MV = new Map();
    for (let y = 0; y < CFG.CH; y++) for (let x = 0; x < CFG.CW; x++) {
      const c = B.w.grid[y][x];
      if (c !== T.SPACE && c !== T.PLAYER && c !== T.GNASH) drawCell(x, y, c, B.w, MV, 1);
      if (c === T.GNASH) { ctx.fillStyle = '#ff5040'; ctx.fillRect(x * TS + 8, y * TS + 8, TS - 16, TS - 16); }
      if (c === T.PLAYER) { ctx.fillStyle = '#7ad4e8'; ctx.fillRect(x * TS + 6, y * TS + 6, TS - 12, TS - 12); }
    }
    ctx.restore();
    ctx.font = '700 16px Verdana'; ctx.textAlign = 'left'; ctx.fillStyle = '#e8c987';
    ctx.fillText(`${B.day}  D${d.params ? d.params.D : '?'}  par ${d.proof.ticks}  quota ${d.proof.quota}  gems ${d.cave.gems}  vaults ${d.cave.setpieces ? d.cave.setpieces.vaults : 0} guards ${d.cave.setpieces ? d.cave.setpieces.guards : 0}`, 20, 26);
    document.title = 'shot-ready';
    return;
  }
  startAttempt();
  B.banner = null;
  if (name === 'play') stepWorld(40, (w, i) => d.proof.tape[i] || 0);
  else if (name === 'race') stepWorld(120, (w, i) => d.proof.tape[i + 6] || 0);
  else if (name === 'results') {
    for (let i = 0; i < d.proof.tape.length && !B.w.done; i++) { B.tape.push(d.proof.tape[i]); tick(B.w, d.proof.tape[i]); }
    if (B.w.done) { B.result = { ticks: B.w.ticks, attempts: 1, tape: B.tape.slice(), day: B.day }; B.mode = 'results'; }
  }
  else if (name === 'anim') { stepWorld(Math.floor((f | 0) / 4), (w, i) => d.proof.tape[i] || 0); for (let k = 0; k < (f | 0) % 4; k++) { B.tickAcc += CFG.TICK / 4; } }
  B.time = 30;
  draw(); document.title = 'shot-ready';
}

// ---------------------------------------------------------------------------
// main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

window.__dd = { B, CFG };   // read-only debug handle for probes and critics

// feel probes: synthetic input patterns, verdict lands in document.title
function runProbe(name) {
  const press = (dir, downMs, upMs) => {
    const K = { 1: 'ArrowLeft', 2: 'ArrowRight', 3: 'ArrowUp', 4: 'ArrowDown' }[dir];
    setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { key: K })), downMs);
    setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { key: K })), upMs);
  };
  startAttempt();
  const x0 = B.w.p.x;
  if (name === 'tap') {
    // five 30ms taps, 250ms apart: with buffering every tap must land
    for (let i = 0; i < 5; i++) press(2, 300 + i * 250, 330 + i * 250);
    setTimeout(() => { document.title = `probe:tap:${B.w.p.x - x0}`; }, 2200);
  } else if (name === 'hold') {
    // hold right for 1.1s: cadence check (expect ~1.1/TICK cells)
    press(2, 300, 1400);
    setTimeout(() => { document.title = `probe:hold:${B.w.p.x - x0}`; }, 2000);
  } else if (name === 'lastwins') {
    // hold right, then also press left: left (last pressed) must win
    setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })), 300);
    setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })), 800);
    setTimeout(() => {
      document.title = `probe:lastwins:${B.w.p.x - x0 < 0 ? 'left' : 'right'}`;
      dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
      dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    }, 1600);
  }
  // probes drive the clock with timers: rAF does not pump under --dump-dom
  setInterval(() => { update(1 / 60); }, 16);
}

const shotName = q.get('shot');
loadDay();
if (shotName) runShot(shotName, Number(q.get('f') || 0));
else if (q.get('probe')) runProbe(q.get('probe'));
else requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
