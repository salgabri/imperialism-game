# Campaign improvement verification

Developer verification on 2 October 2026 covers the fifteen items in
[the improvement checklist](improvements.md). The atlas and existing match-ledger
presentation remain the foundation.

## Automated checks

- `npm test`: 208 campaign/UI regressions pass; the final integrated run passes
  216 with the concurrent map-border checks. Coverage includes legal lineups and starter-only
  scoring, draw recovery, odds, pausable clocks, real App checkpoint restoration,
  manager decisions, single conquest after a series, history, export and keyboard UI.
- `npm run smoke`: seven complete campaigns and four interrupt/resume scenarios
  across football, basketball, nations, clubs and all pacing modes. All scenarios
  passed without console warnings. The cache-only label probe freezes the clock
  before kickoff so accelerated conquest cannot race its label assertions.
- `npm run build`: production bundle succeeds. `git diff --check` is clean.
- Routing regression fixtures cover all 25 offered sport/layer/theatre fields,
  every initial attacker and representative merged final opponents. Japan,
  neutral enclosures and disconnected holdings have checked fallback routes.

## Browser checks

The local app was exercised at 1280×720 and 390×844.

- South America football, seed 42, manager role: Brazil's first conquest waits
  for a signing. Reload/resume retains the same candidates. Selecting Valverde
  replaces Ronaldo Cabrais, increases strength from 86.2 to 86.7 and captures
  Uruguay once.
- History filters by Brazil and restores the full Uruguay–Brazil event feed and
  acquisition. Conquest focus reveals the gained land. Squad separates eleven
  starters and the displaced player on the bench.
- Pausing during a draw retains its spinning stage; resuming reaches kickoff.
  Pausing the ticker retains the 0–0 score and opening event state through the
  subsequent inspection/export work. Resuming continues the scheduled match.
- Export opens a checkpoint with seed, RNG state, history and the pending match.
  Copy succeeds. The visible JSON was saved to a local file and imported through
  the browser file chooser; it restores the pending Chile–Peru match and completes
  it again with the original result. Blob-download notifications were unavailable
  in the embedded browser, so the copy fallback was verified directly.
- Express spectator playback completes the same campaign with a two-game final:
  Venezuela wins the series 2–0, with one final conquest and signing. Results close
  to the map and reopen from the header trophy. Recap includes penalty resolution.
- The map exposes ten owned territories through one tab stop. ArrowRight moves
  from Argentina to Bolivia, Enter opens Venezuela's squad, and the skip link
  focuses Campaign details.
- On the phone, playback remains at the bottom while scrolling Squad. Conquest
  focus scrolls back to the map and moves keyboard focus there. Page width
  stays within the viewport and the controls clear the bottom edge. Viewport
  overrides were reset after verification.

## Seeded balance probes

[The machine-readable report](balance-report.json) contains 144 Elite 32
campaigns: two sports × three pacing modes × two finale variants × twelve seeds.
All completed; none stalled. Campaigns use balanced uncertainty and automatic
highest-rating captures. Independent roster/draw/per-fixture random streams keep
single and series experiments comparable; these probes are not a replay of the
App's one shared RNG stream.

| Measure | Football | Basketball |
| --- | --- | --- |
| Signings improving the lineup | 82.5–94.4% | 62.4–74.7% |
| Initial top-five teams becoming champion | 25–75% | 83.3–91.7% |
| USA championships per twelve-seed configuration | — | 9–11 |
| Games in the optional final | Two or three | Two or three |

For a synthetic ten-point rating advantage, 5,000-match probes give the favourite
91.8% / 86.2% / 76.6% win chances in football and 93.2% / 86.2% / 76.5% in
basketball for Predictable / Balanced / Wild. Predictable still allows random
scoring and tie-break upsets.

This sample supports completion and a useful uncertainty range. It also identifies
basketball champion concentration for further tuning; twelve seeds per configuration
cannot establish broad balance or player enjoyment. The optional series should
remain a selectable experiment. Use [the playtest protocol](playtest.md) with new
players before drawing conclusions about onboarding, pacing or manager agency.
