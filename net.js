// DAILY DIG network layer — the global board over Nostr. Lazy-loaded on
// first use so the core game stays dependency-free. Every score fetched is
// re-verified by replaying its tape against the day's cave on YOUR device:
// the board trusts physics, not relays.
import { schnorr } from 'https://esm.sh/@noble/curves@1.7.0/secp256k1';
import { sha256 } from 'https://esm.sh/@noble/hashes@1.6.1/sha256';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const KIND = 30078;                       // NIP-78 app data, replaceable per (pubkey, d)
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
const utf8 = (s) => new TextEncoder().encode(s);

export function loadKey() {
  try {
    let k = localStorage.getItem('dailydig_nsec');
    if (!k) {
      const buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      k = bytesToHex(buf);
      localStorage.setItem('dailydig_nsec', k);
    }
    return k;
  } catch { return null; }
}
export function pubkeyOf(priv) { return bytesToHex(schnorr.getPublicKey(priv)); }

async function signEvent(ev, priv) {
  const ser = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
  ev.id = bytesToHex(sha256(utf8(ser)));
  ev.sig = bytesToHex(schnorr.sign(ev.id, priv));
  return ev;
}

function relayRoundtrip(url, outgoing, collect, doneAfterMs) {
  return new Promise((resolve) => {
    let ws;
    const got = [];
    const bail = setTimeout(() => { try { ws && ws.close(); } catch {} resolve(got); }, doneAfterMs);
    try { ws = new WebSocket(url); } catch { clearTimeout(bail); return resolve(got); }
    ws.onopen = () => { for (const msg of outgoing) ws.send(JSON.stringify(msg)); };
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (collect && d[0] === 'EVENT') got.push(d[2]);
        if (collect && d[0] === 'EOSE') { clearTimeout(bail); ws.close(); resolve(got); }
        if (!collect && d[0] === 'OK') { clearTimeout(bail); ws.close(); resolve([d[2]]); }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(bail); try { ws.close(); } catch {} resolve(got); };
  });
}

export async function publishRun(day, name, ticks, tape) {
  const priv = loadKey();
  if (!priv) return { ok: false, why: 'no key store' };
  const ev = await signEvent({
    pubkey: pubkeyOf(priv),
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND,
    tags: [['d', 'dailydig:' + day], ['t', 'dailydig'], ['name', String(name).slice(0, 16)]],
    content: JSON.stringify({ v: 1, day, ticks, tape }),
  }, priv);
  const results = await Promise.all(RELAYS.map((r) => relayRoundtrip(r, [['EVENT', ev]], false, 6000)));
  const ok = results.some((r) => r[0] === true);
  return { ok, why: ok ? '' : 'no relay accepted' };
}

export async function fetchBoard(day) {
  const sub = 'dd' + Math.random().toString(36).slice(2, 8);
  const req = ['REQ', sub, { kinds: [KIND], '#d': ['dailydig:' + day], limit: 300 }];
  const batches = await Promise.all(RELAYS.map((r) => relayRoundtrip(r, [req], true, 7000)));
  const seen = new Map();
  for (const ev of batches.flat()) {
    if (!ev || ev.kind !== KIND) continue;
    let body;
    try { body = JSON.parse(ev.content); } catch { continue; }
    if (!body || body.day !== day || typeof body.tape !== 'string' || !Number.isFinite(body.ticks)) continue;
    const name = (ev.tags.find((t) => t[0] === 'name') || [])[1] || ev.pubkey.slice(0, 8);
    const prev = seen.get(ev.pubkey);
    if (!prev || body.ticks < prev.ticks) seen.set(ev.pubkey, { pubkey: ev.pubkey, name, ticks: body.ticks, tape: body.tape });
  }
  return [...seen.values()];
}
