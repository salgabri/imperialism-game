# Imperialism — War Room

A world-conquest simulation where sport decides borders. Every nation starts
holding its own territory. Win a match and you annex **everything** the loser
holds and sign their best player. Last nation standing takes the map.

Pick your sport at kick-off:

| Sport | Lineup | Clock | Level game |
| --- | --- | --- | --- |
| Football | XI in a 4-4-2 | 90 minutes | penalty shootout |
| Basketball | starting five | 40 minutes | overtime periods |

Everything outside the match — territory, the spinner, targeting, conquest,
autosave, the map — is sport-agnostic. A sport supplies its own roster data,
lineup shape, match model and vocabulary from `src/sports/`; adding a third is a
single module and a roster file.

Implemented from the `Football Imperialism.dc.html` design in the
[Football Imperialism Game](https://claude.ai/design/p/440e3f09-8445-4fa3-8acb-531957f27c9b)
Claude Design project.

## Running it

```bash
npm install
npm run dev         # dev server, prints a localhost URL
npm run build       # production bundle into dist/
npm run smoke       # headless: plays campaigns to completion and checks invariants
npm run sync-flags  # re-vendor flag SVGs after editing src/data/flags.js
npm run build-rosters   # regenerate football squads from an EA FC player CSV
npm run build-basketball # regenerate basketball squads from an NBA 2K export
```

## How a campaign plays

**Theatre** — the whole world (170 nations), a single confederation, or the Elite 32.

**Pacing** decides how matchups are drawn:

| Mode | Draw |
| --- | --- |
| `duel` | A spinner picks one attacker and a compass direction. One match per round. |
| `blitz` | Everyone is paired with a neighbour. The field halves each round. |
| `chaos` | Random matchups are drawn until a name repeats, then the batch resolves. |

**Resolution** is either a live minute-by-minute ticker (draws go to penalties) or
an instant full-time score.

`STEP` advances one action; mid-match it fast-forwards to full time. `PLAY` runs
the war unattended. Speed cycles 1× / 2× / 4×. Progress autosaves after every
match and is offered back on the setup screen.

Scroll to zoom (up to 16×, anchored on the pointer), drag to pan, double-click or
press the zoom readout to reset. The view is clamped to the world, so the map
cannot be lost off-screen. Borders, labels and markers hold a constant weight on
screen at every zoom level, and the scale bar re-snaps to a round distance.

## Squads

Both sports field **real players with real ratings**, on the same 1–99 scale.

**Football** — `src/data/rosters.js`, generated from an EA Sports FC export
(18,405 players). For each nationality the best available player by overall
rating fills each slot of the 4-4-2, then the squad is topped up to eleven with
the best remaining players whatever their position — which is what small nations
do in reality.

**Basketball** — `src/data/rosters.basketball.js`, 40 federations, 200 players.
No public dataset carries both current basketball ratings *and* nationality: NBA
2K has real 1–99 overalls but no country, and every NBA bio dataset with a
country column stops in 2014. So the split is deliberate — nationality and
position are curated in `scripts/fiba-squads.json`, and ratings are resolved from
the 2K export by name, with a curated rating for EuroLeague players it doesn't
cover. Curating nationality is the right call regardless: FIBA squads are not NBA
rosters (Serbia, Spain, Greece and Lithuania field mostly EuroLeague players, and
eligibility follows the federation — Banchero plays for the USA, Siakam for
Cameroon).

Nations with no roster in a sport fall back to *that sport's* baseline, never to
another's. Getting this wrong first time ranked England third at basketball.

A nation's **strength** is the mean rating across every shirt in the lineup;
slots the data cannot fill count at the confederation's baseline, so a country
with one 62-rated player doesn't rate alongside a deep squad averaging 62.
`teamEff` then blends strength with the top five, so star power and depth both
count. The resulting orders come out credible without tuning — France, Brazil,
Spain, England at football; USA, Canada, Serbia, Greece at basketball.

Coverage is uneven in both. The football dataset only has players at playable
clubs (England 1,495 candidates, Vietnam none): **65% of shirts are real** and 79
nations field a fully real XI. Basketball is curated to the 40 federations that
matter, so **24% of shirts are real** but every serious basketball nation is. Anything the data can't cover is
generated at the confederation baseline and shown *dimmed and asterisked* in the
squad list, so an invented name never reads as a real player. A football nation
with no keeper in the dataset always has that shirt generated rather than handed
to an outfielder.

To rebuild after swapping datasets:

```bash
npm run build-rosters [path/to/players.csv]   # football
npm run build-basketball                     # basketball
```

The football CSV needs `short_name`, `player_positions`, `overall` and
`nationality_name` columns. Sources live in `data-src/` and are not committed
(11 MB) — only the generated rosters are.

## Squad economics

Beating a nation takes its best player. The squad panel tracks what that has
actually done to a side: `EFF` is the best-XI rating and only ever climbs, while
`AVG` is the whole-squad mean and can *fall* when a strong nation absorbs a weak
one's best player. Both are shown against their kick-off value, and the power
table ranks live EFF with the gain since the campaign began.

## Flags

Territory is filled with its **owner's** flag, so an empire reads as one banner
spreading across the map — conquered land switches to the conqueror's colours the
moment it is annexed. Flags also appear next to the nation code in the match card,
the matchup and steal popups, the power table, the squad header and the victory
screen.

Each country gets its own SVG `<pattern>` anchored to the bounds of its *largest*
landmass, so a country with distant islands (the US, Indonesia) shows a flag
scaled to its mainland with the tile repeating over the outliers, rather than one
flag stretched across the whole archipelago. The flag is stretched to fill rather
than cropped, so the entire design stays visible even on awkward shapes. A solid
rectangle in the nation's colour sits behind each flag as a fallback.

`src/data/flags.js` maps ISO-3166 numeric ids to flag basenames, derived from the
Natural Earth attribute table with two football-specific overrides: England
(`gb-eng`) rather than the United Kingdom, and Kosovo (`xk`), which has no ISO
numeric code. The SVGs are vendored into `public/flags/` from the MIT-licensed
[`flag-icons`](https://github.com/lipis/flag-icons) package, so the built app has
no runtime dependency on it.

## Capitals

Nations are anchored on their **capital city**, not their centre of mass: the
capital marker, the empire label, the spinner and both ends of an attack vector
sit on the capital, and empires are therefore measured capital-to-capital.

`src/data/capitals.js` holds lon/lat for all 170. Coastline generalisation at
110m leaves some real capitals fractionally offshore, so a capital that misses
its own outline is walked toward the country's centre until it lands; 166 of 170
anchor on the city itself and the rest fall back to the centroid rather than
stranding a marker at sea.

Overseas territory is declared in `DEPENDENCIES` in `src/data/teams.js`. It
fields no team of its own, flies its parent's flag, and is annexed and lost with
its parent — Greenland goes with Denmark.

## Targeting rule

A nation may only attack a land neighbour, or strike across the sea at the
**nearest** enemy in the spun direction — it can never leapfrog a closer one.
Land borders come from the TopoJSON itself: two countries that share a topology
arc share a border, so adjacency stays correct as empires absorb territory.

## Layout

```
src/
  App.jsx              campaign state machine, match flow, view models
  config.js            simulation tunables (drama, upset threshold, labels)
  theme.js             design tokens
  sports/              per-sport lineup, match model and vocabulary
    football.js        4-4-2, 90 minutes, penalty shootouts
    basketball.js      starting five, 40 minutes, overtime
  data/teams.js        170 nations: identity, squad building
  data/rosters.js      GENERATED football squads (npm run build-rosters)
  data/rosters.basketball.js  GENERATED FIBA fives (npm run build-basketball)
  data/flags.js        nation id -> flag asset
  data/capitals.js     capital city coordinates
  hooks/               map zoom and pan viewport
  engine/
    geo.js             TopoJSON decode, land adjacency, projection, SVG paths
    random.js          sampling shared by every sport
    campaign.js        territory ownership, targeting, round draws
    storage.js         autosave
  components/          command bar, map, sidebar, overlays, popups
public/
  world-110m.v1.json   Natural Earth 110m country topology
  flags/               170 vendored flag SVGs
scripts/
  smoke.mjs            headless campaign test (jsdom)
  sync-flags.mjs       vendors flag SVGs from flag-icons
  build-rosters.mjs    builds football squads from an EA FC export
  build-basketball.mjs builds FIBA fives from NBA 2K + fiba-squads.json
```

### Tuning

`src/config.js`:

- `matchDrama` (0–12) — match-day variance in rating points. `0` makes the better
  side always win; higher values produce more giant-killings.
- `upsetThreshold` (2–15) — rating gap at which a win is flagged as an upset.
- `showLabels` — draw the leading empires' codes and territory counts on the map.

## Verification

`npm run smoke` boots the real component tree under jsdom and plays campaigns to
a champion across all three pacings and both resolution modes, plus a world-scale
run that is interrupted and reloaded from the autosave — **in both sports**. It
asserts that each match eliminates exactly one nation, that no territory is lost
or duplicated, that one player changes shirts per match, that every held
territory flies its owner's flag, and that no React warnings are emitted.

It also checks each sport's match model over 400 simulated games: that every match
has a winner, that a level score always triggers a tie-break, that the event feed
adds up to the final score, and that scoring lands in the right range for the
sport.
