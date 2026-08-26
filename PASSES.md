# The pass campaign

DAILY DIG is built to absorb a large number of critical passes. Every pass is
run the same way: capture deterministic evidence (`?shot=` scenes,
quarter-tick strips, 60-day playtests), critique it harshly against a
commercial bar, fix as a single owner, re-verify (20 proofs, 14-mutant gate,
60-day solvability contract), and land as an issue + PR. The foundation ships
plain on purpose — the campaign is the product.

| # | Pass | Lens | Bar | Status |
|---|------|------|-----|--------|
| 1 | Core game feel | dig cadence, push weight, input buffering, camera | Boulder Dash Deluxe | ✅ #1 → PR 2 |
| 2 | Cave generation quality | route drama, setpieces, weekday difficulty curve | daily-puzzle editorial quality | ✅ #3 → PR 4 |
| 3 | Aesthetics: world | material identity, lighting, pockets, depth strata | SteamWorld Dig | ✅ #5 → PR 6 |
| 4 | Aesthetics: chrome | work orders, shift manifest, typography system | commercial UI kit | ✅ #7 → PR 8 |
| 5 | Animation | event-driven particles, fall language, reward punch | 60fps arcade feel | ✅ #9 → PR 10 |
| 6 | Sound & music | shift tune, combo ladder, layered SFX | chiptune commercial | ✅ #19 → PR 20 |
| 7 | Onboarding | rookie hints, death coaching, touch joystick | hyper-casual funnel | ✅ #11 → PR 12 |
| 8 | Share card | route-story grid, native share, the slip | Wordle share grid | ✅ #13 → PR 14 |
| 9 | Ghost UX | tags, trails, edge arrows, beat moments, finishing table | speedrun broadcast | ✅ #15 → PR 16 |
| 10 | Daily meta | the ledger: calendar, cabinet, archive | Duolingo streak psychology | ✅ #17 → PR 18 |
| 11 | Mobile | PWA install, offline dailies, rotate hint | app-store quality | ✅ #21 → PR 22 |
| 12 | Nostr layer | replay-verified global board, throwaway keys | provably-fair standard | ✅ #23 → PR 24 |
| 13 | Performance | seed-hint cache: 1017ms → 8ms worst-day boot | 60fps on mid phones | ✅ #25 → PR 26 |
| 14 | Fairness & anti-cheat | FAIRNESS.md — the contract in writing | provably-fair standard | ✅ #27 → PR 28 |
| 15 | Accessibility | reduced motion, ARIA, shape-coding audit | WCAG-pragmatic | ✅ #29 → PR 30 |
| 16 | Launch polish | README, assets, games-page card | store-page quality | ✅ #31 → PR 32 |

Every pass merged only after an adversarial review with one fix round; the
reviewers caught genuine defects in twelve of the sixteen.

Rerun passes (aesthetics 2, animation 2, generation 2 …) are expected: a pass
that plateaus below bar goes back in the queue.

## The evidence toolkit

- `?shot=intro|play|race|results` — deterministic scenes (`&day=` pins the cave)
- `?shot=anim&f=N` — quarter-tick motion frames
- `node proofs.mjs` — 20 machine-verified proofs
- `node mutants.mjs` — 14-mutant gate (every injected bug must be caught)
- `tools/playtest.sh` — 60-day solvability + replay-verification contract
- `tools/capture.sh <port>` — the standard shot set
