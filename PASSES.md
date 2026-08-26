# The pass campaign

DAILY DIG is built to absorb a large number of critical passes. Every pass is
run the same way: capture deterministic evidence (`?shot=` scenes,
quarter-tick strips, 60-day playtests), critique it harshly against a
commercial bar, fix as a single owner, re-verify (20 proofs, 14-mutant gate,
60-day solvability contract), and land as an issue + PR. The foundation ships
plain on purpose — the campaign is the product.

| # | Pass | Lens | Bar |
|---|------|------|-----|
| 1 | Core game feel | dig cadence, push weight, input buffering, camera | Boulder Dash Deluxe |
| 2 | Cave generation quality | route drama, vein placement, TNT/prop setpieces, difficulty curve across weekdays | daily-puzzle editorial quality |
| 3 | Aesthetics: world | material identity, lighting, pockets (no sticker-cells), depth strata | SteamWorld Dig |
| 4 | Aesthetics: chrome | HUD/marquee/panels as company paperwork, typography system | commercial UI kit |
| 5 | Animation | glide, impact, reward punch, idle life (quarter-tick strips) | 60fps arcade feel |
| 6 | Sound & music | synth SFX depth, a daily-shift tune, mute UX | chiptune commercial |
| 7 | Onboarding | first 30 seconds, teach-by-cave-1 principles, touch discoverability | hyper-casual funnel |
| 8 | Share card | share text, strata emoji art, OG image per day, copied-state feedback | Wordle share grid |
| 9 | Ghost UX | rival ghost legibility, race framing, multi-ghost, beat-moments | speedrun broadcast |
| 10 | Daily meta | streak surfaces, calendar/archive screen, countdown to next shift, medals cabinet | Duolingo streak psychology |
| 11 | Mobile | portrait layout, drag tuning, safe areas, PWA manifest + icons | app-store quality |
| 12 | Nostr layer | global daily board, publish/verify ghosts as events, opt-in identity | melrise/asteroids pattern, hardened |
| 13 | Performance | load time (solver at boot), render cost, battery | 60fps on mid phones |
| 14 | Fairness & anti-cheat | replay verification on ingest, tape sanity bounds, seed commitment writeup | provably-fair standard |
| 15 | Accessibility | color-blind safety, reduced motion, keyboard-only, screen-reader shell | WCAG-pragmatic |
| 16 | Launch polish | README, og assets, games-page card, press blurb | store-page quality |

Rerun passes (aesthetics 2, animation 2, generation 2 …) are expected: a pass
that plateaus below bar goes back in the queue.

## The evidence toolkit

- `?shot=intro|play|race|results` — deterministic scenes (`&day=` pins the cave)
- `?shot=anim&f=N` — quarter-tick motion frames
- `node proofs.mjs` — 20 machine-verified proofs
- `node mutants.mjs` — 14-mutant gate (every injected bug must be caught)
- `tools/playtest.sh` — 60-day solvability + replay-verification contract
- `tools/capture.sh <port>` — the standard shot set
