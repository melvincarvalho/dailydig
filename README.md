# DAILY DIG ⛏️

**One cave. The whole world. Every day.**

A daily speedrun mining puzzle for the open web. Every day at 00:00 UTC a
new cave exists — the same one for everyone, derived from the date, provably
solvable on your own device. Dig the gem quota, reach the exit, and race the
**Foreman**: the deterministic solver whose clear time is the day's par and
whose ghost digs beside you.

**Play: https://melvincarvalho.github.io/dailydig/**

Finish and you get a share worth posting: your medal, your time, an emoji
strata-map of how you tore up the cave — and a link that **is** your replay.
Anyone who opens it races your ghost. No account. No install. No server.

## How the daily works (provable fairness)

The day string is hashed to a base seed; candidate seeds are tried in order
and the first cave the built-in solver clears is the day's cave. Your device
re-derives and re-verifies this independently — nobody can rig a daily, and
every "I beat it in 1:42" claim is a tape any client can replay and check.

## Fairness, in writing

[FAIRNESS.md](FAIRNESS.md) states the three promises — same cave for
everyone, every day provably beatable, every time claim a replayable tape —
and exactly how your own device checks each one.

## The machine-verified core

```
node proofs.mjs      # 24 proofs — daily determinism, physics law, codec, anti-cheat
node mutants.mjs     # 19 injected bugs, every one must be caught
tools/playtest.sh    # 60 consecutive days: solvable, replays verify
```

`core.js` is pure simulation (no DOM); `game.js` renders and may never steer
it. The mechanics are original: TNT crates, timber props holding rock
columns, gnashers — dig/gravity/gems in the classic family, tuned for
speedrunning.

## What's in the shaft

- **The race**: the Foreman's ghost digs beside you (name-tagged, breadcrumbed,
  edge-arrowed when off-screen); share links carry YOUR ghost to anyone.
- **The board**: a global daily leaderboard over Nostr where every claimed
  time is re-verified by replaying its tape on your device. No accounts.
- **The ledger**: a five-week calendar of your shifts, the medal cabinet,
  and every past day playable from the archive.
- **The paperwork**: daily work orders with the weekday difficulty stamped
  (gentle Monday → mean Saturday), medal pay tables, live pace-vs-Foreman.
- **The craft**: buffered input, event-driven particles, a scheduled mining
  groove, lantern-lit earth, coached deaths, rookie onboarding that retires
  itself, PWA install + offline dailies, reduced-motion support.

## The campaign

Sixteen critical passes built this, each an issue + PR with the harness
green and an adversarial reviewer who caught real defects in most of them
— see [PASSES.md](PASSES.md) for the full trail and
[prompt.md](prompt.md) for the prompt that produced it all.

## License

MIT
