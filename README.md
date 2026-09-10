# Imperialism

A world-conquest simulation where sport decides borders. Every nation starts
holding its own territory. Win a match and you annex **everything** the loser
holds and sign their best player. Last nation standing takes the map.

Pick your sport at kick-off:

| Sport | Lineup | Clock | Level game |
| --- | --- | --- | --- |
| Football | XI in a 4-4-2 | 90 minutes | penalty shootout |
| Basketball | starting five | 40 minutes | overtime periods |

And pick who fights:

- **Nations** — 170 national teams, each starting on its own homeland.
- **Clubs** — 133 football clubs from six European leagues, or all 30 NBA
  franchises. Real Madrid annexes territory exactly the way Spain does.

Everything outside the match — territory, the spinner, targeting, conquest,
autosave, the map — is sport- and layer-agnostic. A sport supplies its own roster
data, lineup shape, match model and vocabulary from `src/sports/`; adding a third
is a single module and a roster file.

Originally implemented from the `Football Imperialism.dc.html` design in the
[Football Imperialism Game](https://claude.ai/design/p/440e3f09-8445-4fa3-8acb-531957f27c9b)
Claude Design project.

The current interface combines Football Manager's readable management screens
with Europa Universalis-style political cartography: a large map, a compact
campaign form, a quiet header with settings, and a sidebar showing the latest
result, territory gained, and the player claimed. Standings, activity, and squads
share that sidebar. The [design direction](docs/design/direction.md) records the
visual references and decisions, including the generated cartographic paper
texture in `public/textures/cartographic-paper.png`.

The current [match-ledger restyle](docs/design/ledger-restyle.md) pairs a warm-paper
intelligence panel with the dark atlas. Archivo, Archivo Narrow and Alegreya are
self-hosted with their open-font licenses in `public/fonts`; no external font
service is needed. Map names wait for their font metrics before switching faces.

## Running it

```bash
npm install
npm run dev         # dev server, prints a localhost URL
npm run build       # production bundle into dist/
npm run smoke       # headless: plays campaigns to completion and checks invariants
npm run test:map-fonts # font-loading, fallback and geographic remeasurement checks
npm run test:duel-draw # selection, staged timing, cancellation and kickoff checks
npm run test:draw-compass # compass, route, zoom and reduced-motion rendering
npm run test:map-viewport # minimal camera reveal and world-edge checks
npm run test:targeting # intervening borders, islands, neutral land and real Europe
npm run test:flag-symbols # symbol proportions, land fitting and generated asset integrity
npm run build:flag-symbols # regenerate reviewed field/emblem assets after source review
npm run sync-flags  # re-vendor flag SVGs after editing src/data/flags.js
npm run build-rosters   # regenerate football squads from an EA FC player CSV
npm run build-basketball # regenerate basketball squads from an NBA 2K export
npm run build-clubs      # regenerate the club layer for both sports
```

## How a campaign plays

Choose a sport, nations or clubs, and a **theatre**. Nation campaigns default to
Europe (UEFA); the other choices are the whole world (170 nations), another
confederation, or the Elite 32. Club campaigns offer individual leagues, all
leagues, or the strongest 32 available clubs. The setup shows the actual number
of teams for each choice.

**Pacing** decides how matchups are drawn:

| Mode | Draw |
| --- | --- |
| `duel` | A spinner picks one attacker and a compass direction. One match per round. |
| `blitz` | Everyone is paired with a neighbour. The field halves each round. |
| `chaos` | Random matchups are drawn until a name repeats, then the batch resolves. |

**Resolution** is either a live ticker or an instant final score. Level games go
to penalties in football and overtime in basketball. Pacing and resolution are
under **Match settings** during setup and the header's **Settings** button during
a campaign.

**Next match** draws or advances a match; **Finish match** fast-forwards a live
ticker to its result. **Play campaign** runs the campaign automatically, and
**Pause** stops autoplay. Speed cycles 1× / 2× / 4×. Progress autosaves after every
match and can be resumed from setup. Discarding or replacing a saved campaign
requires confirmation.

In one-by-one mode, the [draw compass](docs/design/duel-draw.md) selects an
attacker, slows to the chosen opponent's exact bearing, and briefly reveals the
route before kickoff. The compass and route share the same origin. Animation
and kickoff use one captured playback speed; changing speed during a draw takes
effect after that draw. Off-screen draws are brought into view, and reduced
motion replaces spinning with a short, static directional reveal.

The map starts in **Flags** mode: each nation has its flag as the territory
background, and conquered land adopts its owner's banner. Countries outside the
active campaign stay neutral without flags; setup still previews national flags.
**Political** remains available for muted ownership colours. Clubs retain their
own colours in both modes.

Fourteen [symbol-aware flag designs](docs/design/flag-symbols.md) separate the
continuous field from their emblem. Crosses, discs and coats of arms keep their
proportions and fit on owned land instead of stretching across the region's box.
The field remains continuous across nearby islands, and camera movement cannot
relocate or repeat the emblem. Other flags and the small UI flag chips retain
their original artwork.

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

## The club layer

A club is a combatant with the same shape as a nation — id, code, colour,
strength, lineup — so every rule already in the game applies unchanged.

The one problem clubs create is territory. Twenty Premier League sides share one
homeland, and the map has no sub-national shapes to split. So clubs are **dealt**
onto it: working down the strength order, each club claims the nearest country to
its homeland that nobody has taken. The best club in each league gets the
homeland itself and the rest fan outwards, which is why an all-leagues campaign
opens with Europe carved up and the strongest sides at its centre. Countries
nobody reaches stay neutral, exactly as non-participating nations do.

Clubs have no crest in either dataset, so their territory is painted in a
generated colour rather than a flag — 133 identical English flags would tell you
nothing. Everything else (capital markers, the power table, squad panels,
conquest, player theft) behaves identically.

Club lineups come from the same two exports as the national squads:
`clubs.football.js` from the EA Sports FC CSV filtered to tier-one leagues, and
`clubs.basketball.js` from the NBA 2K export. 2K carries no position, so each
player's role is inferred from the attributes that define it — a centre by
interior defence, rebounding and post play; a point guard by vision, handle and
speed with the ball.

## Squad economics

Beating a nation takes its best player. The squad panel tracks what that has
actually done to a side: `EFF` is the best-lineup rating and only ever climbs, while
`AVG` is the whole-squad mean and can *fall* when a strong nation absorbs a weak
one's best player. Both are shown against their kick-off value. The standings
always rank teams by live overall strength (EFF), highest first, and show strength
gain since the campaign began. Equal strengths are ordered alphabetically;
territory count is informational and never changes the rank order.
Positive campaign gains appear as a green `+N` beside Strength (one decimal).
The latest match result also shows the winner's before/after strength and the
gain from that conquest alone. A transfer that does not improve the rating says
`No change`; territory itself adds no artificial strength bonus. Cumulative
gains remain available after resuming a saved campaign.

## Flags

In **Flags** mode, territory is filled with its **owner's** flag, so an empire
reads as one banner spreading across the map — conquered land switches to the
conqueror's colours the moment it is annexed. Political mode communicates the
same ownership with solid colours. Flags also identify national teams in match
results, popups, standings, squads, and the victory screen.

Each **geographic region of an empire** shares one SVG `<pattern>`. Neighboring
conquered countries and nearby islands sample the same flag continuously:
Corsica, Sardinia and Sicily do not each restart a miniature Swiss cross when
Switzerland owns France and Italy. Regions connect through coast-to-coast gaps
of at most 180 projected kilometers, using the map's fixed distance scale.
Only land with the same owner can join; the flag remains clipped to land.
Distant possessions such as Greenland or French Guiana receive separate flags,
so they cannot stretch European stripes or emblems out of sight. This is a
visual grouping only, not a change to conquest adjacency. Multipart countries
are drawn as separate flag parts beneath a single clickable outline, preserving holes and
country selection. Bounds update after conquest, not on zoom or pan. Only land
reveals the flag; seas and neutral countries stay untouched. A solid rectangle
in the nation's colour is the fallback. Setup previews native flags with the
same regional treatment; non-participants remain unflagged in continental
campaigns, and clubs continue to use club colours.

Run `npm run test:flag-regions` for coastal grouping and island-display
regressions, and `npm run test:territories` for the underlying exact landmass,
overseas, winding, date-line and geometry-cache regressions.

`src/data/flags.js` maps ISO-3166 numeric ids to flag basenames, derived from the
Natural Earth attribute table with two football-specific overrides: England
(`gb-eng`) rather than the United Kingdom, and Kosovo (`xk`), which has no ISO
numeric code. The SVGs are vendored into `public/flags/` from the MIT-licensed
[`flag-icons`](https://github.com/lipis/flag-icons) package, so the built app has
no runtime dependency on it.

## Capitals

Rule targeting starts at each nation's **capital city**. Candidate routes are
ranked capital-to-capital, but the arrow stops just inside the first target
territory it reaches. It cannot cross a third country's land to reach that
capital. Expanded empires can attack from another holding when their nearest
capital pair is blocked. Display labels use a separate
ownership-aware interior-fit algorithm; their positions never affect targeting.

## Empire names

Names span the current empire rather than staying attached to one original
country. The label engine combines owned land across internal borders, separates
disconnected landmasses, and searches for a safe interior text area. It tests
horizontal and shape-aligned angles, measures the real serif text, and gives the
name a gentle upward arch. The padded footprint includes the curve and halo.
Cramped inland names can use a softer arch before being omitted.
Coastlines, foreign enclaves, holes and sea gaps are checked against the rendered
vector geometry.

Names grow with usable territory while staying within an 11–32px readable range.
On-land fits are preferred. When necessary, a name may extend a little over water:
at most 10 screen pixels from owned land, with no more than 22% of its padded
envelope at sea. Its anchor stays on owned land, and foreign or neutral countries
remain forbidden. Names that still cannot fit wait for more zoom.
Geographic candidates and recent placements are
cached to avoid jitter or repeated geometry work during match playback. Separate
colonies cannot pull a mainland label into the ocean. Flags and map interactions
are unchanged.

See `docs/design/empire-labels.md` for the algorithm and its tradeoffs. Run
`npm run test:labels` for independent geometry regressions and `npm run smoke`
for real-app integration coverage.

## Capital data and dependencies

`src/data/capitals.js` holds lon/lat for all 170. Coastline generalisation at
110m in the rule geometry leaves some real capitals fractionally offshore, so a
capital that misses its own outline is walked toward the country's centre until
it lands; 166 of 170
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
In one-by-one draws, every candidate route is also tested against the visible
country shapes. Intervening rival or neutral land blocks the route, even when
its capital falls outside the search cone. The selector tries another route or
opponent, widening the cone only among unobstructed candidates. If the selected
attacker has no legal straight-line route, the draw pauses without starting a
match or changing ownership and offers another draw. Blitz and chaos pairing
rules are unchanged. Previously saved results are not rewritten.

## Map geometry

The map uses a flat equirectangular projection with a 30° standard parallel:
longitude and latitude form a straight rectangular grid, with no polar taper
or raised coastline shadow. Flags, curved names, capitals and attack routes
share this coordinate plane. The scale label is an approximate equatorial
reference, not a uniform real-world distance at every latitude.

The display uses `public/countries-50m.json` from `world-atlas` 2.0.2 for more
detailed coastlines. Its ISC licence is included in
`public/WORLD_ATLAS_LICENSE.txt`. The original `public/world-110m.v1.json` still
drives rule geography, adjacency, capital anchors, and candidate distances.
The detailed display shapes also validate duel routes, so an arrow cannot pass
through a visible country merely because its capital lies elsewhere.

Closed coastline rings are clipped at ±180° longitude before projection, so
date-line crossings cannot create diagonal closure wedges through Russia or
Pacific islands. New seam edges follow the projected meridian, and the same
rounded rings drive the visible outline, flag clipping and label containment.
Source-ring targeting/anchor metadata is retained separately from repaired
display rings, and is reprojected with the map. Geographic capital anchors and
saved ownership, squads and results are unchanged. Projected-distance ordering
(including new club allocations and future draws) can differ from the former
projection; the first-visible-foreign-land targeting rule remains enforced.
Run `npm run test:geography` for straight-grid/inverse-projection, source-atlas
coastline and date-line regressions.

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
  data/clubs.football.js      GENERATED club XIs (npm run build-clubs)
  data/clubs.basketball.js    GENERATED NBA fives (npm run build-clubs)
  data/scopes.js       club theatre choices (per league, all, elite)
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
  world-110m.v1.json   Natural Earth 110m topology for campaign rules
  countries-50m.json   world-atlas 2.0.2 topology for display
  WORLD_ATLAS_LICENSE.txt  ISC licence for world-atlas
  textures/            generated cartographic paper texture
  flags/               170 vendored flag SVGs
scripts/
  smoke.mjs            headless campaign test (jsdom)
  sync-flags.mjs       vendors flag SVGs from flag-icons
  build-rosters.mjs    builds football squads from an EA FC export
  build-basketball.mjs builds FIBA fives from NBA 2K + fiba-squads.json
  build-clubs.mjs      builds the club layer for both sports
```

### Tuning

`src/config.js`:

- `matchDrama` (0–12) — match-day variance in rating points. `0` makes the better
  side always win; higher values produce more giant-killings.
- `upsetThreshold` (2–15) — rating gap at which a win is flagged as an upset.
- `showLabels` — draw empire names (club codes for clubs) over their largest held
  shape; labels are spaced to remain readable at the current zoom.

## Verification

`npm run smoke` boots the real component tree under jsdom and plays **seven full
campaigns** across all three pacings, both resolution modes, both sports, and
national and club teams. **Four interrupt-and-resume scenarios** cover a
world-scale national campaign plus basketball nations, football clubs, and NBA
clubs. They verify that settings, ownership, squads, acquired players, and the
remaining match queue survive a reload and that the campaign remains playable.

The suite asserts that each match eliminates exactly one team, that no territory
is lost or duplicated, and that one player changes shirts per match. It checks
political ownership colours, national flag ownership in Flags mode, club colours,
structured result rewards, the sidebar tabs, victory, and absence of React
warnings.

It also checks each sport's match model over 400 simulated games: that every match
has a winner, that a level score always triggers a tie-break, that the event feed
adds up to the final score, and that scoring lands in the right range for the
sport.
