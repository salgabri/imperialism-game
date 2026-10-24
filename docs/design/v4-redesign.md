# v4 redesign and turn modes

Record of the v4 design import, implemented in commit `f2f0cf8` and merged with
`main`'s domestic campaigns in `159f2ac` (19 October 2026). This record supersedes [direction.md](direction.md) and
[ledger-restyle.md](ledger-restyle.md). Other notes in this folder describe
earlier states of the interface and are kept as history.

## Source

- **Claude Design project:** [Football Imperialism Game](https://claude.ai/design/p/440e3f09-8445-4fa3-8acb-531957f27c9b)
  (`440e3f09-8445-4fa3-8acb-531957f27c9b`).
- **Handoff bundle:** `design_handoff_imperialism_v4`, "Imperialism — modern UI
  redesign (v4) + turn modes".
- **Contents:** a README with exact values (tokens, type, map rendering, screen
  specs) and screenshots of boards A1–A4 (campaign map), B1–B2 (live match), C1–C2
  (squad) and D1–D2 (conquest) at 1920 / 1366 / 820 / 390 px. It also had
  old-style boards 12–14 (Rules of war, Your turn, Spectator) for layout only,
  and HTML references that were not shipped. The screenshots replay seed 2033
  with Italy managed.
- **Precedence:** the screenshots decide layout, and the handoff README decides
  exact values. The decisions below resolve the open questions and win over
  both.

The direction is modern, flat and calm: a grand-strategy map (Europa Universalis)
with dense football-management data (Football Manager), replacing the dark,
gold-trimmed "war room" look.

## Scope

- Built: v4 tokens, the masthead, campaign map, live match, squad and conquest
  screens, and turn order × targeting (the Rules of war setup step and the Your
  turn and Spectator screens), restyled with the v4 tokens.
- Screens not redrawn in v4 got the v4 tokens and component patterns: menu, the
  other setup steps, Ledger, Chronicle, victory, dialogs, loading and toasts.
  The patterns are a kicker, a table, white floating panels, square corners, and
  Archivo / Archivo Narrow only.
- No design HTML ships. Everything is React plus plain global CSS in the repo's
  conventions: one CSS file per component, `is-*` states and `--x` modifiers.
  Existing `fi-*` class names were kept where tests select them.

## Binding decisions

### Engine and determinism

- **D1 — Defaults reproduce the old game.** The defaults are `turnOrder:
  'random'` and `targeting: 'compass'`. Seeded replays, smoke seeds and
  production balance stay identical with them. Every duel turn consumes exactly
  3 campaign RNG samples in every mode: round robin ignores the attacker roll,
  player targeting still draws and then replaces the target, and
  `createTargetedDraw` consumes none. Views, view-models and Space handling never
  touch `this.rng`.
- **D2 — The rules apply to `pacing: 'duel'` only.** Blitz and chaos are
  normalised to random/compass at launch. Setup offers pacing and turn order as
  one choice, four draw cards (Random draw, Round robin, Blitz round, Chaos
  draw), so no rule card is ever disabled. "You choose" is offered only on the
  Your role step, to a manager under a one-match draw. A stored "player" left
  by an earlier choice is still normalised to compass at launch, so spectators
  always use the compass. After `continueAsSpectator` (`managementEnded`),
  targeting falls back to compass. *(Setup half amended 2026-10-24 by the
  settings simplification, which dropped the 2×2 rules matrix; the engine half
  and `launchRules` are unchanged.)*
- **D3 — Round robin.** The queue holds survivors sorted by starting strength
  (`baseEff`, fallback `teamEff`) descending, then name, then id. It is rebuilt
  at each round boundary, and `round` counts cycles. Random mode keeps one round
  per duel. The turn strip reads "Turn N of M this round": N is the attacker's
  position in the queue and M the queue length at round start. Played and
  eliminated entries are dimmed to .38, eliminated ones with a 1px ink diagonal
  strike. The current entry has a 2px `you` ring. "Next: <team>" names the next
  surviving entry, or reads "Next: new round".
- **D4 — "In reach" for You choose.** Route-legal land neighbours first; if
  none, direct sea strikes; if none, fallback sea/treaty routes. If still none,
  that turn uses the compass and logs it. The Fronts table uses the same land
  tier, and falls back to the reachable list when the tier is empty.
- **D5 — Win chances everywhere** use the repo's `estimateWinProbability` (its
  own cached RNG) with the campaign's uncertainty. "From N simulated matches"
  shows the real sample count. Colours follow the displayed integer: ≥60 gain,
  45–59 even, <45 loss.
- **D6 — Live win-probability chart.** Football uses the handoff formula
  with `prepareFootballMatch` logA/logD from the match's own effA/effD (tactics
  included), Poisson sums to 15 goals, and a level score worth ½ (the shoot-out
  is 50/50). After full time the series ends at 1, 0, or 1 for the shoot-out
  winner. Basketball uses a normal approximation of the repo's basketball model.
  The chart is plotted from the managed team's side, else the followed team's,
  else the attacker's. The code is pure functions in
  `src/engine/winProbability.js`, with tests.
- **D7 — Live match minute.** Derived from revealed events and the
  presentation schedule, and kept outside saved state (`src/engine/liveMinute.js`),
  never in `state.match`. It reads "38' · LIVE", then "FULL TIME" (football),
  "FINAL" (basketball) or "PENALTIES".
- **D8 — Claimed provenance.** `applyConquest` stores `fromId`, `from`,
  `joined` (round) and `claimGain` (XI strength change at signing) on the moved
  player. Older saves derive these from `history`. The v4 import raised
  `SAVE_VERSION` to 3; versions 1 and 2 still load. New saved keys: `turnQueue`, `turnIndex`,
  `pendingTarget`, plus the `turnOrder` / `targeting` settings.
- **D9 — Squads.** A squad is 11 (football) or 5 (basketball) plus claimed
  players. Depth is everyone outside the selected lineup. Counts come from data
  ("FIRST TEAM · 13 PLAYERS · 2 CLAIMED IN CONQUEST"). "+ N more in depth"
  appears only when N > 5.

### Flow and screens

- **D10 — Fixture timing (no pre-draw).** The Next fixture block has five
  states:
  - *Idle:* round robin shows "<TEAM> TO ATTACK" with "Compass decides the
    target" or "You choose the target"; random shows "NEXT DRAW · Any of <n>
    empires can be drawn". No odds; the primary is Continue.
  - *Spin/locked:* "<A> v <B>", the route, odds and meta.
  - *Tactical gate:* the fixture and odds, a secondary **Match preview** (the
    restyled TacticalChoice dialog, which no longer opens by itself), and "or
    simulate the result" (balanced approach, instant reveal for this match
    only). Continue / Space kicks off with the balanced approach.
  - *Live:* score and minute; the primary is Finish match.
  - *Done:* the result; the primary is Continue.
- **D11 — Views.** The masthead nav is Map / Squad / Match / Ledger / Chronicle.
  The phone tab bar is Map, Squad, Match, Ledger, More, where More holds the
  Chronicle, settings and saves. `view` is UI-only state and is never saved.
  Derived views: setup → setup, a pending signing → conquest (Map highlighted),
  `pendingTarget` → map. A ticker kick-off involving the managed (or followed)
  team switches Map to Match, except in express or an instant reveal. The game switches back at the
  next turn if the switch was automatic. Clicking land or a ledger row opens that
  team's Squad. With no live match, Match shows the last finished match or an
  empty state. View changes never use clock timers.
- **D12 — Mounting.** WorldMap stays mounted in every view and is hidden when
  not visible. `CommandBar` (the masthead) and `CampaignStorageDialog` stay
  direct children of App's root. `render()` stays pure.
- **D13 — Space = primary action.** The labels are Continue / Finish match /
  Sign <player> / Attack <team> / Pause (autoplay on) / Resume / Results. A
  spectator's masthead primary is Pause / Play campaign. The "SPACE" chip and the
  phone bar's right-hand text sit outside the button's text, so exact
  `textContent` lookups keep working.
- **D14 — Autoplay and speed** sit in masthead row 2 as "AUTOPLAY OFF · SPEED
  2×". The re-skinned `PlaybackBar` stays their source on desktop and in the
  phone More sheet. The match feed footer has 1× / 2× / 4× chips and Pause.
- **D15 — Conquest screen.** It replaces the AcquisitionChoice modal for the
  manager's signing. The selection is stored in `choice.selected`, defaulting to
  the best lineup fit. Options use the repo's role-based `acquisitionOptions`.
  Each option's meta reads "<POS> · <rating> rating · Starts ahead of <X>" or
  "Adds depth · the XI is unchanged"; the gain reads "+x.x" or a muted "±0.0".
  A "Lineup before and after" `<details>` follows the options. The map shows a
  projection (`conquestPreview()`) with hatching on the taken land and a callout
  centred on it, excluding overseas dependencies. The standfirst puts the
  winner's score first, with sport-aware tie text. A defeat restyles
  ManagerElimination in the same article layout ("ITALY IS OUT", Continue as
  spectator / Retry this setup). Spectator and AI conquests do not wait: a
  notice, the ticker and a hatch flash report them.
- **D16 — Ledger and Chronicle.** Ledger shows the full-screen standings
  (`.fi-standings`, columns #, Team, Terr, Strength first) and the fallen list.
  Chronicle shows the history, the archived match card and the activity feed
  that the old Sidebar held. Sidebar tests were ported to these screens.
- **D17 — Match card contract.** A compact `MatchCard` (`data-testid=
  "match-card"`, `.fi-match-result`, `.fi-match-odds`, `.fi-scoreboard`, the
  strength-gain test id) stays in the Map column for the live and done states.
  The full board-B1 layout lives in the Match view.

### Map

- **D18 — Political is the default map mode.** All four modes are
  interactive:
  - *Strength:* a 5-step neutral-to-grey ramp (`#e8e9e4` → `#8a9297`) by
    strength percentile; your empire keeps the you-fill.
  - *Fronts:* your empire you-fill, your fronts tinted gain/even/loss at a 35%
    mix with white, everything else land-neutral.
  - *Flags:* the existing flag patterns with v4 borders and labels.
- **D19 — Map styling** follows the handoff README:
  - Sea `#dfe7eb` with no paper texture; a white graticule at 0.6 / 55%.
  - Pastel empire fills by hash (11 colours). The next opponent is
    opponent-filled only once the fixture is known.
  - Borders: white 1.5 between empires and 0.6 @75% inside one; coast `#9aa7ae`
    0.6. Your outline is ink 1.4, the opponent's `#2f54eb` 1.8.
  - Capitals are 3.8px squares; yours is an ink star.
  - All strokes are non-scaling.
  - Labels: Archivo Narrow 600 (yours 700), uppercase, .14em. Maximum size
    30/22/20/18px by width class; hidden below 9px (your own at 6.5px); a 5%
    arc.
- **D20 — Attack arrow.** A quadratic curve bent 22%, with a white halo, ink
  shaft, head and origin circle. The draw-compass contract
  (`.draw-route-line` `d === routeD`, no ids or markers, reduced-motion CSS) is
  kept. The compass is restyled with a white disk, an ink needle and a `you`
  tip.
- **D21 — Overlays.** Title card top-left; key bottom-left; mode switch
  bottom-right (top-right on tablet). Zoom −/+/reset is kept as a minimal
  vertical control. The tooltip is a white panel. On your turn, in-reach empires
  get a dashed cobalt outline (2px, dash 5 3) and out-of-reach land an ink veil.
  Battle scars, the LAT/LON readout and the km scale bar are gone.
- **D22 — Phone and tablet.** Below 700px: the map zooms to your empire and
  the next opponent, with a "Whole map" / "Your fronts" toggle. A bottom sheet
  with a grab handle expands on tap. Then a 56px primary bar and an 84px tab
  bar. From 700 to 1199px the map sits on top (≈47% height), with the column
  content in two columns below.

### Copy and values

- Zero deltas read a muted "±0.0". Source column "EA FC 26" / "FM 26".
- The strength profile uses a 60–95 segment mapping; its kicker reads "Scale
  60–95".
- The campaign title comes from `campaignTitle` ("The European Campaign").
  Round 0 reads "Before the first match · seed 2026".
- Basketball squads: a court with 5 discs (PG SG SF PF C), the groups Guards /
  Forwards / Centres, an Offence / Defence profile, and "Starting five".
- The ticker is static, clipped and newest first, with no marquee.
- Fonts: Archivo and Archivo Narrow only. The Alegreya `@font-face` is gone; the
  files stay.
- Hit targets are at least 44px on touch. Reduced motion keeps only opacity
  transitions.

### Implementation refinements

These settle layout questions the decisions above left open:

- The your-turn and spectator panels are docked in the Map column. They
  replace the Next fixture block, and Fronts is hidden during a target choice.
- The setup frame is opaque and the opening-partition preview map was dropped.
  Step 2 shows the four draw cards, a visible Show matches control (`resolution`
  and `express` as Live / Final score only / Fast-forward) and a collapsed
  **More rules** `<details>`; the manager's opponent choice is on step 3.
- Space on a focused option in the conquest or target list still runs the
  primary action. Setup handles its own Space (next step / launch).
- While a signing or target choice is pending, every nav entry except Map is
  disabled.
- The phone More sheet reuses the masthead's settings panel (Show matches, a
  read-only This campaign list, Saves, New campaign) and adds the Chronicle
  link and playback.
- The map key follows the map mode. Changing speed during a live match
  reschedules the rest of it from the current minute.
- The turn strip shows on the Map view only. Under a random draw only
  spectators see it.

## Domestic campaigns in v4

[Domestic campaigns](domestic-campaigns.md) (a country's top football clubs on
that country's own sectioned map) arrived on `main` while v4 was being built.
They were merged into the redesign in `159f2ac`. They follow the v4 patterns:

- **Setup:** with Teams = Clubs and football, step 1 lists a second theatre
  group, **One country · top clubs**. Choosing a country shows a preview card:
  its sections in their starting clubs' kick-off colours over the neighbouring
  land, with a loading state and Retry.
- **Map:** the sectioned map renders in the v4 flat style: pastel fills, white
  borders, and the clay/cobalt identity colours. Neighbouring countries form an
  inert land-neutral backdrop, and every home town is marked at any zoom.
- **Overlays:** the title card reads the theatre itself ("England · top 100
  clubs") instead of "… Campaign". The key labels the marker **Home town**
  instead of Capital.
- **Names:** tooltips, conquest results and the conquest screen name sections
  ("Lancashire (east)"); a club's home section reads "Home of Burnley" in the
  tooltip. An exclave's route through a
  neighbour reads "Through foreign land — never claimed" in the Next fixture
  block.

**Storage** follows main's rule when the browser is full. A save is all or
nothing, and a campaign may drop only its own recovery copies to fit. Another
campaign's recovery copy is never deleted; the save fails with a "storage is
full" status instead, and **Saved campaigns** can delete a campaign to free
space. `scripts/save-size.test.mjs` covers this.

## Architecture

```
App.jsx      class component: state, flow, view router (currentView / setView),
             primaryAction() + Space, render(); one-line delegates
  src/app/*Methods.jsx    method bodies per area (map, column, match, squad,
                          conquest, turn, ledger), plain functions called as
                          fn.apply(this, args)
  viewContext()           plain ctx: board, geo, sport, managed/followed ids, cache …
    src/viewModels/*.js   pure build*(state, ctx): no window/document/timers/campaign RNG
      src/screens/**      presentational screens (campaign, match, squad, conquest,
      src/components/**   turns, ledger, setup model) and shared components
        CSS               src/styles/tokens.css, primitives.css, shell.css
                          plus one global CSS file per owner
```

- The method modules keep test subclasses and instance overrides working:
  delegates live on `App.prototype`, and moved bodies call `this.x()`.
- New engine modules are pure and unit-tested: `turns.js` (queue, reach,
  launch rules), `winProbability.js` and `liveMinute.js`.
- Retired: `Sidebar.jsx`, `AcquisitionChoice.jsx`, `polish.css`,
  `controls.css`, `results.css`, `strategy.css`, the paper texture in CSS, and
  Alegreya and serif fallbacks.
- New tests guard the architecture: `seed-replay` (a determinism golden),
  `contracts` (static contracts between App, the method modules and the frozen
  pure modules), `view-router`, `masthead` and `font-audit`. Each screen also
  has a component suite and a `*-wiring` suite against the running App. See the
  README's [Verification](../../README.md#verification).

## Known gaps and deviations

- **Strength and Fronts renderings were not in the design.** The handoff only
  names the modes. The ramps above are derived:
  - Strength: `#e8e9e4 #d1d3d1 #b9bebe #a2a8aa #8a9297`.
  - Fronts: gain `#acd6c0`, even `#dccaa6`, loss `#efb8b6`.
  - The map key uses the same values.
- **Some handoff colours are below WCAG 4.5:1 for small text. They were kept
  as specified.**
  - Gain / rating tier 80–83 `#138a4a`: 4.41:1 on white, 4.04:1 on `#f5f5f2`,
    3.71:1 on `#ebece7`.
  - Even `#9a6700`: 4.46:1 on `#f5f5f2`.
  - On `#ebece7` (chart, pitch and inset backgrounds) loss, claimed and the
    75–79 and 70–74 rating tiers also fall to 4.1–4.4:1.
- **The your-turn veil** is `rgba(17,20,23,.55)` over land only, behind the
  single `--map-veil` switch in `src/styles/tokens.css`. Verification judged it
  readable. If it reads as broken, the planned fallback is `.35`.
- The football win-probability formula leaves out match-day form, tempo and
  shoot-out skill, so the chart's 0' value can differ from the pre-match odds.
  The gap averages about 2 points under the balanced preset and grows to about
  12 under wild. The handoff formula ships as specified (see the comment in
  `src/engine/winProbability.js`).
