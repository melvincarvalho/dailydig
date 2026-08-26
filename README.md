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

## The machine-verified core

```
node proofs.mjs      # 20 proofs — daily determinism, physics law, codec, anti-cheat
node mutants.mjs     # 14 injected bugs, every one must be caught
tools/playtest.sh    # 60 consecutive days: solvable, replays verify
```

`core.js` is pure simulation (no DOM); `game.js` renders and may never steer
it. The mechanics are original: TNT crates, timber props holding rock
columns, gnashers — dig/gravity/gems in the classic family, tuned for
speedrunning.

## The campaign

The foundation ships plain. [PASSES.md](PASSES.md) is the roadmap: 16+
harsh critical passes (feel, generation, art, animation, sound, onboarding,
share, ghosts, meta, mobile, Nostr board, performance, fairness,
accessibility), each landed as an issue + PR with the full harness green.
[prompt.md](prompt.md) is the prompt that produced all of this.

## License

MIT
