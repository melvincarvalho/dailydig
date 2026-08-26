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
  parts: [], fxRng: null, gemPunchAt: -9, exitOpenAt: -9,
  rookie: false, hintStage: 0, hintShownAt: 0, deathCause: null, touchVis: null,
  calFrom: null, calCells: [],
  boomCols: new Set(),
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
  B.cave = d.cave; B.proof = d.proof; B.dailyParams = d.params || null;
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
  B.rookie = !s.history || Object.keys(s.history).length === 0;
}

function startAttempt() {
  B.w = newWorld(B.cave);
  B.parts = [];
  B.fxRng = makeRng((B.cave.seed ^ 0x5f3759df) >>> 0);
  B.gemPunchAt = -9; B.exitOpenAt = -9;
  B.boomCols = new Set();
  B.hintStage = B.rookie ? 1 : 0;
  B.hintShownAt = 0;
  B.deathCause = null;
  B.tape = [];
  B.attempts++;
  B.time = 0; B.tickAcc = 0;
  B.ghosts = B.ghostTapes.map((g) => ({ ...g, world: newWorld(B.cave), i: 0, done: false, trail: [], beaten: false, finished: false }));
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
  if ((B.mode === 'intro' || B.mode === 'results') && k === 'a') { B.calFrom = B.mode; B.mode = 'calendar'; }
  else if (B.mode === 'calendar' && (e.key === 'Escape' || k === 'a')) { B.mode = B.calFrom || 'intro'; }
  else if (B.mode === 'intro' && (e.key === ' ' || e.key === 'Enter')) startAttempt();
  else if (B.mode === 'results' && (e.key === ' ' || e.key === 'Enter') && !resultsLocked()) startAttempt();
  else if (B.mode === 'results' && k === 'c') doShare();
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

// the SHARE button's hit zone — one definition shared by every input path,
// kept in lockstep with the rect drawn in drawResults
function shareZoneHit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = (clientX - r.left) / r.width * W, y = (clientY - r.top) / r.height * H;
  return x > W / 2 - 130 && x < W / 2 + 130 && y > H / 2 + 84 && y < H / 2 + 124;
}
let tId = null, tax = 0, tay = 0;
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault(); audio();
  {
    const t0 = e.changedTouches[0];
    const r0 = canvas.getBoundingClientRect();
    const cx0 = (t0.clientX - r0.left) / r0.width * W;
    const cy0 = (t0.clientY - r0.top) / r0.height * H;
    if (B.mode === 'calendar') {
      for (const c of B.calCells) {
        if (cx0 > c.x && cx0 < c.x + c.w && cy0 > c.y && cy0 < c.y + c.h) {
          location.href = location.pathname + (c.day === dayString(Date.now()) ? '' : '?day=' + c.day);
          return;
        }
      }
      B.mode = B.calFrom || 'intro';
      return;
    }
    if ((B.mode === 'intro' || B.mode === 'results') && cx0 < 170 && cy0 < 60) { B.calFrom = B.mode; B.mode = 'calendar'; return; }
  }
  if (B.mode !== 'play') {
    const t0 = e.changedTouches[0];
    // preventDefault above suppresses the synthesized click, so the button
    // must be handled here for touch — a tap on SHARE shares, never restarts
    if (B.mode === 'results' && B.result && t0 && shareZoneHit(t0.clientX, t0.clientY)) { doShare(); B.suppressRestart = B.time; return; }
    if (B.mode === 'intro' || (B.mode === 'results' && !resultsLocked() && B.time - (B.suppressRestart || -9) > 0.3)) startAttempt();
    return;
  }
  if (tId !== null) return;
  const t = e.changedTouches[0];
  tId = t.identifier; tax = t.clientX; tay = t.clientY;
  const r = canvas.getBoundingClientRect();
  B.touchVis = [(t.clientX - r.left) / r.width * W, (t.clientY - r.top) / r.height * H];
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
  for (const t of e.changedTouches) if (t.identifier === tId) { tId = null; touchHeld = 0; B.touchVis = null; }
});
canvas.addEventListener('mousedown', (e) => {
  audio();
  // mousedown fires before click — a press on the SHARE button must not
  // restart, or the click handler wakes up in 'play' mode and does nothing
  if (B.mode === 'results' && B.result && shareZoneHit(e.clientX, e.clientY)) return;
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
  const dn = DIFF_NAMES[(B.dailyParams && B.dailyParams.D) || 3];
  // the route story: 10 columns — untouched, dug, gems taken, TNT let loose
  let row = '';
  for (let cxx = 0; cxx < 10; cxx++) {
    const x0 = 1 + Math.floor(cxx * (CFG.CW - 2) / 10), x1 = 1 + Math.floor((cxx + 1) * (CFG.CW - 2) / 10);
    let dug = 0, tot = 0, gem = 0;
    for (let y = 1; y < CFG.CH - 1; y++) for (let x = x0; x < x1; x++) {
      if (B.cave.grid[y][x] === T.DIRT) tot++;
      if (B.cave.grid[y][x] === T.DIRT && B.w.grid[y][x] !== T.DIRT) dug++;
      if (B.cave.grid[y][x] === T.GEM && B.w.grid[y][x] !== T.GEM) gem++;
    }
    row += B.boomCols.has(cxx) ? '🟧' : gem > 0 ? '💎' : dug / Math.max(1, tot) > 0.12 ? '🟫' : '⬛';
  }
  const boss = res.ticks <= B.proof.ticks;
  const vs = boss ? `outdug the FOREMAN (${fmtT(B.proof.ticks)})` : `FOREMAN ${fmtT(B.proof.ticks)}`;
  const s = store();
  const streakLine = (s.streak || 0) >= 2 ? `\n🔥 ${s.streak}-day streak` : '';
  return `DAILY DIG #${B.dayN} — ${dn} ⛏️\n${m.e} ${fmtT(res.ticks)} in ${res.attempts} attempt${res.attempts === 1 ? '' : 's'} · ${vs}\n${row}${streakLine}\nrace my ghost: ${url}`;
}
function doShare() {
  if (!B.result) return;
  const text = shareText(B.result);
  const copy = () => { try { navigator.clipboard.writeText(text); B.copied = B.time; B.shareMode = 'copy'; } catch {} };
  if (navigator.share) {
    // confirm only on resolve — a cancelled share sheet must not claim SHARED;
    // a genuine failure (not the user backing out) falls back to the clipboard
    navigator.share({ text }).then(() => { B.copied = B.time; B.shareMode = 'share'; })
      .catch((err) => { if (!err || err.name !== 'AbortError') copy(); });
    return;
  }
  copy();
}


// ---------------------------------------------------------------------------
// fx — every sim event earns pixels. Seeded rng keeps shots byte-stable.
function part(p) { if (B.parts.length < 400) B.parts.push(p); }
function spawnFX(events) {
  const R = B.fxRng || Math.random;
  for (const ev of events) {
    const cx = (ev.x !== undefined ? ev.x : 0) * TS + TS / 2, cy = (ev.y !== undefined ? ev.y : 0) * TS + TS / 2;
    if (ev.t === 'dig') {
      for (let i = 0; i < 5; i++) part({ k: 'dust', x: cx + (R() - 0.5) * 20, y: cy + (R() - 0.5) * 20, vx: (R() - 0.5) * 70, vy: -30 - R() * 50, r: 2 + R() * 3, c: '150,124,92', life: 0.3 + R() * 0.2, t: 0 });
    } else if (ev.t === 'gem') {
      B.gemPunchAt = B.time;
      for (let i = 0; i < 7; i++) { const a = R() * 6.28, s = 60 + R() * 160; part({ k: 'shard', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, r: 2 + R() * 2.5, c: '63,210,255', life: 0.35 + R() * 0.25, t: 0 }); }
      part({ k: 'flash', x: cx, y: cy, r: 26, c: '190,240,255', life: 0.18, t: 0 });
    } else if (ev.t === 'thud') {
      for (let i = 0; i < 4; i++) part({ k: 'dust', x: cx + (R() - 0.5) * 26, y: cy + TS / 2 - 3, vx: (R() - 0.5) * 90, vy: -20 - R() * 35, r: 2 + R() * 3, c: '150,124,92', life: 0.25 + R() * 0.2, t: 0 });
    } else if (ev.t === 'boom') {
      for (let i = 0; i < 14; i++) { const a = R() * 6.28, s = 90 + R() * 260; part({ k: 'debris', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, r: 2 + R() * 3.5, c: R() < 0.5 ? '120,96,68' : '255,170,80', life: 0.4 + R() * 0.35, t: 0, g: 480 }); }
      part({ k: 'ring', x: cx, y: cy, r: 12, c: '255,220,150', life: 0.35, t: 0 });
      part({ k: 'flash', x: cx, y: cy, r: 56, c: '255,235,200', life: 0.2, t: 0 });
    } else if (ev.t === 'prop') {
      for (let i = 0; i < 6; i++) part({ k: 'debris', x: cx, y: cy, vx: (R() - 0.5) * 160, vy: -50 - R() * 90, r: 1.5 + R() * 2.5, c: '176,133,78', life: 0.35 + R() * 0.3, t: 0, g: 520 });
    } else if (ev.t === 'push') {
      for (let i = 0; i < 3; i++) part({ k: 'dust', x: cx + (R() - 0.5) * 12, y: cy + TS / 2 - 4, vx: (R() - 0.5) * 50, vy: -15 - R() * 25, r: 1.5 + R() * 2, c: '150,124,92', life: 0.22, t: 0 });
    } else if (ev.t === 'open') {
      B.exitOpenAt = B.time;
    } else if (ev.t === 'crush' || ev.t === 'bite' || ev.t === 'die') {
      for (let i = 0; i < 10; i++) { const a = R() * 6.28, s = 70 + R() * 180; part({ k: 'debris', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, r: 2 + R() * 3, c: '200,160,120', life: 0.5 + R() * 0.3, t: 0, g: 420 }); }
    }
  }
}
function tickParts(dt) {
  for (let i = B.parts.length - 1; i >= 0; i--) {
    const p = B.parts[i];
    p.t += dt;
    if (p.t >= p.life) { B.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += (p.g || 160) * dt;
  }
}
function drawParts() {
  for (const p of B.parts) {
    const k = 1 - p.t / p.life;
    if (p.k === 'ring') {
      ctx.strokeStyle = `rgba(${p.c},${(k * 0.8).toFixed(3)})`;
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (1 - k) * 130, 0, 7); ctx.stroke();
    } else if (p.k === 'flash') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${p.c},${(k * 0.8).toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = `rgba(${p.c},${(k * 0.9).toFixed(3)})`;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
  }
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
  if (B.toastT > 0) B.toastT -= dt;
  B.shake = Math.max(0, B.shake - 30 * dt);
  if (B.mode !== 'play') return;
  B.tickAcc += dt;
  while (B.tickAcc >= CFG.TICK) {
    B.tickAcc -= CFG.TICK;
    const input = currentInput();
    if (input > 0) B.lastMove = input;
    B.tape.push(input);
    tick(B.w, input);
    spawnFX(B.w.events);
    if (B.hintStage === 1 && input > 0) { B.hintStage = 2; B.hintShownAt = B.time; }
    for (const ev of B.w.events) {
      if (ev.t === 'gem' && B.hintStage === 2) { B.hintStage = 3; B.hintShownAt = B.time; }
      if (ev.t === 'boom') B.boomCols.add(Math.min(9, Math.max(0, Math.floor((ev.x - 1) * 10 / (CFG.CW - 2)))));
      if (ev.t === 'crush') B.deathCause = 'crush';
      else if (ev.t === 'bite') B.deathCause = 'bite';
      else if (ev.t === 'boom' && !B.w.p.alive && !B.deathCause) B.deathCause = 'boom';
      if (SFX[ev.t]) SFX[ev.t]();
      if (ev.t === 'boom') B.shake = Math.min(B.shake + 8, 14);
      if (ev.t === 'thud') B.shake = Math.min(B.shake + 1.5, 6);
      if (ev.t === 'open') B.banner = { text: 'QUOTA MET', sub: 'the exit is open', t: 1.6 };
    }

    for (const g of B.ghosts) {
      if (g.done) { if (!g.finished && g.world.done) { g.finished = true; B.banner = { text: `${g.label} CLOCKED OUT`, sub: `${fmtT(g.world.ticks)} — finish yours`, t: 1.8 }; } continue; }
      const gp = g.world.p;
      if (g.trail.length === 0 || g.trail[g.trail.length - 1][0] !== gp.x || g.trail[g.trail.length - 1][1] !== gp.y) {
        g.trail.push([gp.x, gp.y]);
        if (g.trail.length > 14) g.trail.shift();
      }
      tick(g.world, g.i < g.tape.length ? g.tape[g.i] : 0);
      g.i++;
      if (g.world.done || g.world.dead || g.i > g.tape.length + 30) g.done = true;
      // the beat moment: your gems overtake this ghost's
      if (!g.beaten && B.w.gems > g.world.gems && B.w.gems > 0) {
        g.beaten = true;
        B.toast = `AHEAD OF THE ${g.label} ON GEMS`;
        B.toastT = 2.0;
      }
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
  tickParts(dt);
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
      if (m && m.dy) {
        // mid-fall: afterimages behind, a shadow racing up the landing tile
        for (const [ga, gy3] of [[0.22, -26], [0.12, -40]]) {
          ctx.save();
          ctx.globalAlpha = ga;
          ctx.translate(px + TS / 2 + ox, py + TS / 2 + oy + gy3);
          ctx.fillStyle = '#7c7264';
          ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
          ctx.restore();
        }
        let ly3 = y + 1;
        while (ly3 < CFG.CH && w.grid[ly3][x] === T.SPACE) ly3++;
        const dist = Math.max(1, ly3 - y);
        ctx.save();
        ctx.translate(px + TS / 2, py + TS / 2);
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0.15, 0.55 - dist * 0.07).toFixed(2)})`;
        ctx.beginPath(); ctx.ellipse(0, dist * TS - TS / 2 - 2, 8 + 12 / dist, 3.6, 0, 0, 7); ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(px + TS / 2 + ox, py + TS / 2 + oy);
      if (m && m.dy) ctx.scale(0.94, 1.1);
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
  if (wp.pushT > 0) ctx.rotate((wp.dir || 1) * 0.14);
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
  if (!w) { if (B.mode === 'calendar') drawCalendar(); else drawIntro(); return; }

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
  drawParts();
  // exit-open one-shot: gold rings sweep from the doorway
  const ek = B.time - B.exitOpenAt;
  if (w.exitOpen && ek >= 0 && ek < 0.9) {
    const [exX2, exY2] = w.exit;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const del of [0, 0.14]) {
      const t2 = ek - del;
      if (t2 < 0) continue;
      ctx.strokeStyle = `rgba(255,215,106,${(0.7 * (1 - ek / 0.9)).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, 3.5 - ek * 2.5);
      ctx.beginPath(); ctx.arc(exX2 * TS + TS / 2, exY2 * TS + TS / 2, 14 + t2 * 320, 0, 7); ctx.stroke();
    }
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

  // ghosts under the player: breadcrumb trail, body, name tag
  for (const g of B.ghosts) {
    if (g.done && g.world.done) continue;
    for (let ti = 0; ti < g.trail.length; ti++) {
      const [tx2, ty2] = g.trail[ti];
      ctx.fillStyle = g.color + Math.round(8 + (ti / g.trail.length) * 40).toString(16).padStart(2, '0');
      ctx.fillRect(tx2 * TS + TS / 2 - 3, ty2 * TS + TS / 2 - 3, 6, 6);
    }
    drawDigger(g.world.p, lerp, g.color, 0.42, g.world.p.moving);
    const gp = g.world.p;
    const gx2 = (gp.px + (gp.x - gp.px) * lerp) * TS + TS / 2;
    const gy2 = (gp.py + (gp.y - gp.py) * lerp) * TS;
    ctx.font = '700 9px Verdana, sans-serif';
    ctx.textAlign = 'center';
    const tw3 = ctx.measureText(g.label).width + 12;
    ctx.fillStyle = 'rgba(10,7,4,0.7)';
    ctx.beginPath(); ctx.roundRect(gx2 - tw3 / 2, gy2 - 47, tw3, 14, 4); ctx.fill();
    ctx.fillStyle = g.color;
    ctx.fillText(g.label, gx2, gy2 - 36.5);
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

  if (B.mode === 'play') drawGhostArrows();
  if (B.mode === 'play') drawHints();
  drawMarquee();
  drawHUD();
  if (B.banner) drawBanner();
  if (B.toastT > 0 && B.mode === 'play') {
    ctx.save();
    ctx.globalAlpha = Math.min(1, B.toastT * 2);
    label(B.toast, W / 2, H * 0.6, 14, '#7ce88a', 'center');
    ctx.restore();
  }
  if (B.mode === 'results') drawResults();
  if (B.mode === 'intro') drawIntro();
  if (B.mode === 'calendar') drawCalendar();
}

// ---------------------------------------------------------------------------
// the ledger: five weeks of shifts, the medal cabinet, the playable archive
const MEDAL_COL = { 'SHIFT BOSS': '#7ad4e8', GOLD: '#ffd76a', SILVER: '#c8c8d0', BRONZE: '#c9885c' };
function drawCalendar() {
  ctx.fillStyle = 'rgba(10,7,4,0.85)';
  ctx.fillRect(0, 0, W, H);
  const PX = W / 2 - 360, PY = 44, PW = 720, PH = H - 88;
  panel(PX, PY, PW, PH);
  label('DIG CO. — THE LEDGER', W / 2, PY + 34, 12, 'rgba(201,163,92,0.9)', 'center');
  const s = store();
  const hist = s.history || {};
  // the cabinet
  const counts = { 'SHIFT BOSS': 0, GOLD: 0, SILVER: 0, BRONZE: 0 };
  for (const d of Object.values(hist)) if (counts[d.medal] !== undefined) counts[d.medal]++;
  let cx2 = PX + 92;
  for (const [nm, n2] of Object.entries(counts)) {
    label(nm, cx2, PY + 66, 8, MEDAL_COL[nm], 'center');
    value(String(n2), cx2, PY + 88, 18, MEDAL_COL[nm], 'center');
    cx2 += 140;
  }
  label('BEST STREAK', PX + PW - 84, PY + 66, 8, PAL.good, 'center');
  value(String(s.bestStreak || 0), PX + PW - 84, PY + 88, 18, PAL.good, 'center');
  brassRule(PX + 40, PY + 104, PW - 80);
  // five weeks, Monday-led
  const names = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  for (let i = 0; i < 7; i++) label(names[i], PX + 88 + i * 88, PY + 130, 9, 'rgba(214,192,156,0.6)', 'center');
  B.calCells = [];
  const today = B.shotMode ? B.day : dayString(Date.now());
  const t0 = Date.parse(today + 'T00:00:00Z');
  const dow0 = (new Date(t0).getUTCDay() + 6) % 7;   // Monday = 0
  const gridStart = t0 - (dow0 + 28) * 86400000;
  for (let i2 = 0; i2 < 35; i2++) {
    const dms = gridStart + i2 * 86400000;
    const day = dayString(dms);
    const col = i2 % 7, row = (i2 / 7) | 0;
    const cellX = PX + 88 + col * 88, cellY = PY + 158 + row * 74;
    const n3 = dayNumber(day);
    const playable = n3 >= 1 && dms <= t0;
    const h2 = hist[day];
    const isToday = day === today;
    ctx.fillStyle = isToday ? 'rgba(122,212,232,0.12)' : h2 ? 'rgba(201,163,92,0.1)' : 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(cellX - 36, cellY - 26, 72, 60, 8); ctx.fill();
    if (isToday) { ctx.strokeStyle = 'rgba(122,212,232,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(cellX - 36, cellY - 26, 72, 60, 8); ctx.stroke(); }
    label(playable ? '#' + n3 : '—', cellX, cellY - 8, 9, playable ? 'rgba(214,192,156,0.8)' : 'rgba(214,192,156,0.25)', 'center');
    if (h2 && playable) {
      ctx.fillStyle = MEDAL_COL[h2.medal] || PAL.paper;
      ctx.beginPath(); ctx.roundRect(cellX - 24, cellY + 2, 48, 16, 5); ctx.fill();
      ctx.font = `700 9px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = '#1a1206';
      ctx.fillText(fmtT(h2.ticks), cellX, cellY + 14);
    } else if (playable) {
      label(isToday ? 'TODAY' : 'DIG IT', cellX, cellY + 14, 8, isToday ? PAL.blueprint : 'rgba(214,192,156,0.45)', 'center');
    }
    if (playable) B.calCells.push({ x: cellX - 36, y: cellY - 26, w: 72, h: 60, day });
  }
  label('TAP A SHIFT TO DIG ITS CAVE — A OR ESC TO CLOSE', W / 2, PY + PH - 20, 10, 'rgba(214,192,156,0.6)', 'center');
}

// ---------------------------------------------------------------------------
// off-screen ghosts point at themselves from the viewport edge
function drawGhostArrows() {
  for (const g of B.ghosts) {
    if (g.done) continue;
    const gp = g.world.p;
    const sx = gp.x * TS + TS / 2 - B.cam.x, sy = gp.y * TS + TS / 2 - B.cam.y + MQ;
    if (sx > 20 && sx < VW - 20 && sy > MQ + 20 && sy < MQ + VH - 20) continue;
    const cx2 = Math.max(46, Math.min(VW - 46, sx)), cy2 = Math.max(MQ + 46, Math.min(MQ + VH - 46, sy));
    const a = Math.atan2(sy - cy2, sx - cx2);
    ctx.save();
    ctx.translate(cx2, cy2);
    ctx.rotate(a);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = g.color;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
    ctx.rotate(-a);
    ctx.font = '700 8px Verdana, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,231,200,0.9)';
    ctx.fillText(g.label, 0, 20);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// onboarding — three hints for a rookie's first shift, then silence forever
function hintChip(txt, x, y) {
  ctx.font = '700 13px Verdana, sans-serif';
  ctx.textAlign = 'center';
  const w2 = ctx.measureText(txt).width + 28;
  ctx.fillStyle = 'rgba(16,11,6,0.88)';
  ctx.beginPath(); ctx.roundRect(x - w2 / 2, y - 20, w2, 30, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(122,212,232,0.6)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x - w2 / 2, y - 20, w2, 30, 8); ctx.stroke();
  ctx.fillStyle = '#cfeef8';
  ctx.fillText(txt, x, y);
}
function drawHints() {
  const w = B.w;
  // touch joystick visual: the drag is visible while it steers
  if (B.touchVis && touchHeld) {
    const [ax, ay] = B.touchVis;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#7ad4e8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ax, ay, 26, 0, 7); ctx.stroke();
    const D2 = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]][touchHeld];
    ctx.fillStyle = '#7ad4e8';
    ctx.beginPath(); ctx.arc(ax + D2[0] * 20, ay + D2[1] * 20, 8, 0, 7); ctx.fill();
    ctx.restore();
  }
  if (!B.rookie || B.hintStage === 0) return;
  const px = w.p.x * TS - B.cam.x, py = w.p.y * TS - B.cam.y + MQ;
  const pulse = Math.sin(B.time * 3) * 3;
  if (B.hintStage === 1) {
    hintChip(IS_TOUCH ? 'DRAG anywhere to dig' : 'DIG — hold an ARROW (or WASD)', Math.max(150, Math.min(W - 150, px + TS / 2)), Math.max(70, py - 34 + pulse));
  } else if (B.hintStage === 2 && B.time - B.hintShownAt < 6) {
    hintChip(`gems pay — bank ${w.quota} to open the exit`, Math.max(170, Math.min(W - 170, px + TS / 2)), Math.max(70, py - 34));
  } else if (B.hintStage === 3 && B.time - B.hintShownAt < 5) {
    hintChip('banked. watch loose rocks overhead', Math.max(170, Math.min(W - 170, px + TS / 2)), Math.max(70, py - 34));
  }
}
const DEATH_COACH = {
  crush: 'A loose rock came down on you. Never linger where the ceiling hangs.',
  bite: 'A gnasher got you. They follow walls — give them a cell of room.',
  boom: 'You were inside a blast. TNT clears three by three.',
};

// ---------------------------------------------------------------------------
// chrome — the company paperwork: parchment labels, mono values, brass rules
const DIFF_NAMES = [null, 'GENTLE', 'STEADY', 'FIRM', 'STERN', 'HARSH', 'MEAN'];
function nextShiftIn() {
  if (B.shotMode) return '07:14:22';
  const now = Date.now();
  const next = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  const s = Math.max(0, (next - now) / 1000 | 0);
  return `${String(s / 3600 | 0).padStart(2, '0')}:${String((s / 60 | 0) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function medalTargets() {
  const par = B.proof.ticks;
  return [
    { name: 'SHIFT BOSS', t: par },
    { name: 'GOLD', t: Math.floor(par * 1.7) },
    { name: 'SILVER', t: Math.floor(par * 2.8) },
  ];
}
function value(txt, x, y, size = 26, color = PAL.paper, align = 'left') {
  ctx.font = `800 ${size}px ${MONO}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
}
function brassRule(x, y, w2) {
  const g = ctx.createLinearGradient(x, 0, x + w2, 0);
  g.addColorStop(0, 'rgba(201,163,92,0)'); g.addColorStop(0.5, 'rgba(201,163,92,0.7)'); g.addColorStop(1, 'rgba(201,163,92,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w2, 1.5);
}
function stamp(txt, x, y, color = '#b8563c') {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.06);
  ctx.font = '900 15px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = 'center';
  const w2 = ctx.measureText(txt).width + 24;
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.strokeRect(-w2 / 2, -14, w2, 24);
  ctx.fillStyle = color;
  ctx.fillText(txt, 0, 4);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
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
  // company mark
  ctx.fillStyle = '#c9a35c';
  ctx.beginPath(); ctx.moveTo(26, 12); ctx.lineTo(38, 12); ctx.lineTo(32, 30); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#171008'; ctx.fillRect(30.5, 14, 3, 10);
  label('DIG CO.', 46, 20, 10, 'rgba(201,163,92,0.9)');
  label(B.day, 46, 33, 9, 'rgba(214,192,156,0.55)');
  ctx.font = `800 18px "Arial Black", Arial, sans-serif`;
  ctx.letterSpacing = '4px'; ctx.textAlign = 'center';
  ctx.fillStyle = '#e8c987';
  ctx.fillText(`DAILY DIG — SHIFT ${B.dayN}`, W / 2, 28);
  ctx.letterSpacing = '0px';
  label('NEXT SHIFT', W - 24, 18, 9, 'rgba(214,192,156,0.55)', 'right');
  value(nextShiftIn(), W - 24, 33, 13, 'rgba(122,212,232,0.85)', 'right');
}
function drawHUD() {
  const HY = H - HUD_H;
  ctx.fillStyle = '#161009'; ctx.fillRect(0, HY, W, HUD_H);
  ctx.fillStyle = 'rgba(201,163,92,0.85)'; ctx.fillRect(0, HY, W, 2);
  const w = B.w;
  if (!w) return;
  // zone dividers: a manifest, not a soup
  ctx.fillStyle = 'rgba(201,173,120,0.18)';
  for (const zx of [238, 560, 850, 1090]) ctx.fillRect(zx, HY + 14, 1, HUD_H - 28);

  // zone 1 — GEMS with the jewel itself
  label('GEMS', 32, HY + 28);
  ctx.save();
  ctx.translate(52, HY + 52);
  const F2 = (pts, col) => { ctx.beginPath(); pts.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  F2([[-9, -6], [9, -6], [13, 0], [0, 12], [-13, 0]], '#2b9cc4');
  F2([[-9, -6], [9, -6], [7, 0], [-7, 0]], '#bdeeff');
  F2([[-7, 0], [7, 0], [0, 12]], '#66d8ff');
  ctx.restore();
  {
    const pk = Math.max(0, 1 - (B.time - B.gemPunchAt) / 0.3);
    ctx.save();
    ctx.translate(84, HY + 64);
    ctx.scale(1 + 0.25 * pk * pk, 1 + 0.25 * pk * pk);
    value(`${w.gems}/${w.quota}`, 0, 0, 26, w.exitOpen ? PAL.good : PAL.paper);
    ctx.restore();
  }
  if (w.exitOpen) label('EXIT OPEN', 32, HY + 80, 9, PAL.good);

  // zone 2 — TIME with live pace vs the Foreman and the next medal target
  label('TIME', 262, HY + 28);
  value(fmtT(w.ticks), 262, HY + 64, 26, w.ticks <= B.proof.ticks ? PAL.blueprint : PAL.paper);
  const delta = w.ticks - B.proof.ticks;
  const ahead = delta <= 0;
  value((ahead ? '▲ ' : '▼ ') + fmtT(Math.abs(delta)), 380, HY + 52, 14, ahead ? '#7ce88a' : '#d88a6a');
  label('VS FOREMAN', 380, HY + 66, 8, 'rgba(214,192,156,0.55)');
  const nextM = medalTargets().find((m) => w.ticks <= m.t);
  label(nextM ? `ON PACE FOR ${nextM.name} — UNDER ${fmtT(nextM.t)}` : 'BRONZE PACE — JUST CLEAR IT', 262, HY + 82, 9, nextM && nextM.name === 'SHIFT BOSS' ? PAL.blueprint : 'rgba(214,192,156,0.7)');

  // zone 3 — the race
  let gy2 = HY + 32;
  for (const g of B.ghosts) {
    ctx.fillStyle = g.color;
    ctx.fillRect(584, gy2 - 9, 8, 8);
    label(g.label, 600, gy2, 10, g.color);
    value(g.world.done ? fmtT(g.world.ticks) : g.world.dead ? '—' : fmtT(g.world.ticks), 700, gy2, 13, 'rgba(243,231,200,0.85)');
    if (g.world.done) label('CLEAR', 760, gy2, 8, 'rgba(243,231,200,0.5)');
    gy2 += 24;
  }

  // zone 4 — the ledger
  label('ATTEMPT', 874, HY + 28);
  value(String(B.attempts), 874, HY + 60, 20);
  label('STREAK', 980, HY + 28);
  value(String(B.streak.n), 980, HY + 60, 20, B.streak.n > 0 ? PAL.good : PAL.paper);

  // zone 5 — best + next shift
  if (B.best) {
    label('BEST', 1114, HY + 28);
    value(fmtT(B.best.ticks), 1114, HY + 60, 20);
  }
}
function drawBanner() {
  const a = Math.min(1, B.banner.t * 3, (1.8 - B.banner.t) * 4);
  const born = Math.min(1, (1.8 - B.banner.t) * 5);
  const ease = 1 - Math.pow(1 - born, 3);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.translate(0, (1 - ease) * -26);
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
  ctx.fillStyle = 'rgba(201,163,92,0.5)';
  for (const [rx, ry] of [[x + 14, y + 14], [x + w2 - 14, y + 14], [x + 14, y + h2 - 14], [x + w2 - 14, y + h2 - 14]]) {
    ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, 7); ctx.fill();
  }
}
function drawIntro() {
  const PX = W / 2 - 350, PY = H / 2 - 205, PW = 700, PH = 410;
  panel(PX, PY, PW, PH);
  // header band: the company letterhead
  ctx.fillStyle = 'rgba(201,163,92,0.12)';
  ctx.fillRect(PX + 8, PY + 8, PW - 16, 64);
  label('DIG CO. — DAILY WORK ORDER', W / 2, PY + 30, 10, 'rgba(201,163,92,0.9)', 'center');
  ctx.textAlign = 'center';
  ctx.font = '900 38px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '6px';
  const wm = ctx.createLinearGradient(0, PY + 34, 0, PY + 66);
  wm.addColorStop(0, '#fff3d0'); wm.addColorStop(0.5, '#ffd97a'); wm.addColorStop(1, '#b0802e');
  ctx.fillStyle = wm;
  ctx.fillText('DAILY DIG', W / 2, PY + 62);
  ctx.letterSpacing = '0px';
  brassRule(PX + 40, PY + 80, PW - 80);
  // the order fields
  const fy = PY + 112;
  label('SHIFT', PX + 60, fy, 10); value('#' + B.dayN, PX + 60, fy + 26, 22);
  label('DATE', PX + 200, fy, 10); value(B.day, PX + 200, fy + 26, 16);
  label('QUOTA', PX + 372, fy, 10); value(`${B.proof ? B.proof.quota : '—'} GEMS`, PX + 372, fy + 26, 16);
  label('FOREMAN', PX + 530, fy, 10); value(fmtT(B.proof.ticks), PX + 530, fy + 26, 16, PAL.blueprint);
  stamp(DIFF_NAMES[(B.proof && B.dailyParams && B.dailyParams.D) || 3] || 'FIRM', PX + PW - 96, PY + 36);
  brassRule(PX + 40, fy + 44, PW - 80);
  // medal table
  const my = fy + 74;
  label('TODAY PAYS', PX + 60, my, 10);
  const meds = medalTargets();
  const medCols = [['SHIFT BOSS', PAL.blueprint], ['GOLD', '#ffd76a'], ['SILVER', '#c8c8d0']];
  for (let i = 0; i < 3; i++) {
    label(medCols[i][0], PX + 180 + i * 160, my, 9, medCols[i][1]);
    value('≤ ' + fmtT(meds[i].t), PX + 180 + i * 160, my + 20, 14);
  }
  brassRule(PX + 40, my + 36, PW - 80);
  // the race + the streak
  const ry3 = my + 62;
  if (B.ghostTapes && B.ghostTapes.length > 1) {
    label(`A RIVAL'S GHOST IS ON SITE — ${fmtT(B.ghostTapes[1].ticks)}. BEAT IT.`, W / 2, ry3, 11, '#ff8ad0', 'center');
  } else {
    label('THE FOREMAN DIGS BESIDE YOU. OUTPACE HIM.', W / 2, ry3, 11, 'rgba(122,212,232,0.85)', 'center');
  }
  if (B.streak.n > 0) label(`STREAK ${B.streak.n} — CLEAR TODAY TO KEEP IT`, W / 2, ry3 + 22, 10, PAL.good, 'center');
  // clock in
  if ((B.time * 1.6 | 0) % 2 === 0) {
    label(IS_TOUCH ? 'TAP TO CLOCK IN' : 'SPACE TO CLOCK IN', W / 2, PY + PH - 74, 18, '#ffffff', 'center');
  }
  label(IS_TOUCH ? 'DRAG ANYWHERE TO DIG' : 'WASD / ARROWS DIG · R RESTART · M MUTE', W / 2, PY + PH - 44, 10, 'rgba(214,192,156,0.7)', 'center');
  label(IS_TOUCH ? 'THE LEDGER: tap top-left corner' : 'A — THE LEDGER (archive + medals)', W / 2, PY + PH - 62, 10, 'rgba(201,163,92,0.75)', 'center');
  label('NEXT SHIFT IN ' + nextShiftIn(), W / 2, PY + PH - 22, 9, 'rgba(122,212,232,0.6)', 'center');
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
    ctx.fillText(fmtT(res.ticks), W / 2, H / 2 - 110);
    stamp(m.name, W / 2 + 190, H / 2 - 122, m.name === 'SHIFT BOSS' ? '#3c9ab8' : '#b8563c');
    {
      const rows = [['YOU', res.ticks, '#f3e7c8']];
      for (const g of B.ghosts) if (g.world.done) rows.push([g.label, g.world.ticks, g.color]);
      rows.sort((r1, r2) => r1[1] - r2[1]);
      let rx2 = W / 2 - (rows.length * 150) / 2 + 75;
      for (let i2 = 0; i2 < rows.length; i2++) {
        const [nm, tk, col] = rows[i2];
        label(`${i2 + 1}. ${nm}`, rx2, H / 2 - 84, 10, col, 'center');
        value(fmtT(tk) + (nm === 'YOU' ? '' : ` (${tk > res.ticks ? '+' : '−'}${fmtT(Math.abs(tk - res.ticks))})`), rx2, H / 2 - 66, 13, col, 'center');
        rx2 += 150;
      }
    }
    ctx.font = `700 14px Verdana, sans-serif`; ctx.fillStyle = PAL.paper;
    ctx.fillText(res.ticks <= B.proof.ticks ? 'You outdug the Foreman. The company is watching.' :
      'Share your ghost — the link IS the replay.', W / 2, H / 2 - 40);
    // the share slip: exactly what leaves the building, plus the button
    ctx.fillStyle = 'rgba(122,212,232,0.1)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 290, H / 2 - 20, 580, 88, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(122,212,232,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(W / 2 - 290, H / 2 - 20, 580, 88, 10); ctx.stroke();
    const st = shareText(res).split('\n');
    ctx.font = `700 13px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = PAL.blueprint;
    ctx.fillText(st[0], W / 2, H / 2 + 2);
    ctx.fillText(st[1], W / 2, H / 2 + 22);
    ctx.font = `700 18px ${MONO}`;
    ctx.fillText(st[2], W / 2, H / 2 + 48);
    // the button
    const shY = H / 2 + 84, copied = B.time - B.copied < 2 && B.copied > 0;
    ctx.fillStyle = copied ? 'rgba(124,232,138,0.18)' : 'rgba(122,212,232,0.18)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 130, shY, 260, 40, 10); ctx.fill();
    ctx.strokeStyle = copied ? '#7ce88a' : PAL.blueprint; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(W / 2 - 130, shY, 260, 40, 10); ctx.stroke();
    label(copied ? (B.shareMode === 'share' ? 'SHARED' : 'COPIED — GO POST IT') : (navigator.share ? 'SHARE MY GHOST' : 'COPY SHARE + GHOST LINK'), W / 2, shY + 26, 13, copied ? PAL.good : PAL.blueprint, 'center');
    if (!IS_TOUCH) label('C ALSO WORKS', W / 2 + 200, shY + 26, 9, 'rgba(214,192,156,0.5)', 'center');
    label(IS_TOUCH ? 'TAP ANYWHERE ELSE TO DIG AGAIN' : 'SPACE TO DIG AGAIN', W / 2, shY + 66, 13, '#ffffff', 'center');
  } else {
    ctx.font = '900 36px "Arial Black", Arial, sans-serif';
    ctx.fillStyle = PAL.danger;
    ctx.fillText('BURIED', W / 2, H / 2 - 100);
    label(DEATH_COACH[B.deathCause] || 'The cave keeps everything you had not banked.', W / 2, H / 2 - 60, 12, PAL.paper, 'center');
    label(`attempt ${B.attempts} — same cave, same rocks. Route smarter.`, W / 2, H / 2 - 34, 11, 'rgba(214,192,156,0.7)', 'center');
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
  const r0 = canvas.getBoundingClientRect();
  const cx0 = (e.clientX - r0.left) / r0.width * W;
  const cy0 = (e.clientY - r0.top) / r0.height * H;
  if (B.mode === 'calendar') {
    for (const c of B.calCells) {
      if (cx0 > c.x && cx0 < c.x + c.w && cy0 > c.y && cy0 < c.y + c.h) {
        location.href = location.pathname + (c.day === dayString(Date.now()) ? '' : '?day=' + c.day);
        return;
      }
    }
    B.mode = B.calFrom || 'intro';
    return;
  }
  if ((B.mode === 'intro' || B.mode === 'results') && cx0 < 170 && cy0 < 60) { B.calFrom = B.mode; B.mode = 'calendar'; return; }
  if (B.mode !== 'results' || !B.result) return;
  if (shareZoneHit(e.clientX, e.clientY)) { doShare(); B.suppressRestart = B.time; }
});

// ---------------------------------------------------------------------------
// deterministic screenshot harness for the critic loop
function stepWorld(n, inputFn) {
  for (let i = 0; i < n; i++) {
    const inp = inputFn ? inputFn(B.w, i) : 0;
    if (inp > 0) B.lastMove = inp;
    B.tape.push(inp);
    tick(B.w, inp);
    spawnFX(B.w.events);
    tickParts(CFG.TICK);
    for (const g of B.ghosts) {
      if (g.done) continue;
      const gp = g.world.p;
      if (g.trail.length === 0 || g.trail[g.trail.length - 1][0] !== gp.x || g.trail[g.trail.length - 1][1] !== gp.y) {
        g.trail.push([gp.x, gp.y]);
        if (g.trail.length > 14) g.trail.shift();
      }
      tick(g.world, g.i < g.tape.length ? g.tape[g.i] : 0); g.i++;
      if (g.world.done || g.world.dead) g.done = true;
    }
  }
  snapCam(true);
}
function runShot(name, f) {
  B.shotMode = true;
  B.day = q.get('day') || '2026-08-03';
  B.dayN = dayNumber(B.day);
  const d = dailyCave(B.day);
  B.cave = d.cave; B.proof = d.proof; B.dailyParams = d.params || null;
  B.ghostTapes = [{ label: 'FOREMAN', color: '#7ad4e8', tape: d.proof.tape }];
  B.rookie = false;         // shots ignore the profile's history; only onboard opts in
  if (name === 'intro') { B.time = 0.4; draw(); document.title = 'shot-ready'; return; }
  if (name === 'ledger') {
    const hist = {};
    const t0 = Date.parse(B.day + 'T00:00:00Z');
    const meds = ['SHIFT BOSS', 'GOLD', 'SILVER', 'BRONZE', 'GOLD', 'SILVER'];
    for (let i = 1; i <= 6; i++) {
      hist[dayString(t0 - i * 86400000)] = { ticks: 180 + i * 31, attempts: 1 + (i % 3), medal: meds[i - 1] };
    }
    try { localStorage.setItem('dailydig', JSON.stringify({ history: hist, streak: 4, bestStreak: 9, lastClear: dayString(t0 - 86400000) })); } catch {}
    B.mode = 'calendar';
    B.calFrom = 'intro';
    B.time = 1;
    draw(); document.title = 'shot-ready'; return;
  }
  if (name === 'onboard') {
    B.rookie = true;
    startAttempt();
    B.banner = null;
    B.time = 1.2;
    draw(); document.title = 'shot-ready'; return;
  }
  if (name === 'death') {
    startAttempt();
    B.banner = null;
    const g2 = B.w.grid;
    for (let y = 8; y <= 15; y++) for (let x = 20; x <= 24; x++) g2[y][x] = T.SPACE;
    g2[16][22] = T.STEEL;
    g2[9][22] = T.ROCK; B.w.fall[9][22] = 1;
    g2[B.w.p.y][B.w.p.x] = T.SPACE;
    B.w.p.x = 22; B.w.p.y = 14; B.w.p.px = 22; B.w.p.py = 14;
    g2[14][22] = T.PLAYER;
    for (let i = 0; i < 8 && !B.w.dead; i++) { tick(B.w, 0); spawnFX(B.w.events); for (const ev of B.w.events) { if (ev.t === 'crush') B.deathCause = 'crush'; } }
    B.mode = 'results'; B.result = null;
    B.time = 30; B.finishedAt = 29;
    draw(); document.title = 'shot-ready'; return;
  }
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
