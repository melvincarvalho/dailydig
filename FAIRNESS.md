# How DAILY DIG stays fair

DAILY DIG makes three promises. None of them ask you to trust us — every one
is checked by your own device, every time.

## Promise 1 — everyone digs the same cave

There is no level server. The day's date is hashed to a seed; candidate
seeds are tried in a fixed order; the first cave that passes the editorial
gates AND that the built-in solver (the Foreman) clears becomes the daily.
Your device re-derives this from scratch. Two honest devices can't disagree,
and nobody — including us — can slip a different cave to different players.

The weekday difficulty curve (gentle Monday → mean Saturday) is part of the
same derivation: every knob comes from the date alone.

## Promise 2 — every day is beatable, provably

The Foreman's clear is not a promise, it's a construction rule: a cave that
can't be solver-cleared at or above the day's par floor never ships. The
Foreman's input tape is included in the derivation — it's the par time you
see and the ghost you race. Run `node proofs.mjs` (20+ machine-verified
proofs), `node mutants.mjs` (19 injected bugs, all caught), or
`tools/playtest.sh` (60 consecutive days solved and replay-verified) on any
checkout.

## Promise 3 — a time claim is a tape, and tapes don't lie

A "finished in 1:42" claim is never a number — it's the complete input
recording of the run. Share links carry the tape in the URL; board posts
carry it in the event. Every client that sees a claim REPLAYS it against
the day's cave in its own simulation and accepts it only if the replay
clears with exactly the claimed tick count. Cheating the board means
beating the physics, not the honor system.

### The seed-hint cache (and why it can't cheat)

Repeat visits skip the seed search using a cached attempt index. The cache
is an untrusted hint: a wrong value falls through to the full scan, and a
tampered one only hurts the tamperer — a non-canonical cave's tapes fail
replay verification on every other device, so it quarantines itself.

### Keys and identity

Posting to the board generates a throwaway key that never leaves your
device (only the public key and signature do). No account, no email, no
tracking. Your name on the board is whatever you say it is; your time is
whatever your tape proves it is.
