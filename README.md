# Imperialism

A world-conquest simulation where sport decides borders. Every nation starts
holding its own territory. Win a match and you annex **everything** the loser
holds and claim one player. Spectators automatically sign the highest-rated
player; managers choose from three candidates ranked by lineup improvement.
Last team standing takes the map.

Pick your sport at kick-off:

| Sport | Lineup | Clock | Level game |
| --- | --- | --- | --- |
| Football | XI in a 4-4-2 | 90 minutes | penalty shootout |
| Basketball | starting five | 40 minutes | overtime periods |

And pick who fights:

- **Nations** — 170 national teams, each starting on its own homeland.
- **Clubs** — 132 football clubs from seven European leagues, or all 30 NBA
  franchises. Real Madrid annexes territory exactly the way Spain does.
- **One country's clubs** — a country's top football clubs (up to 100) on that
  country's own map, split into 100 sections ([domestic campaigns](#domestic-campaigns)).

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
npm test            # complete automated regression suite
npm run smoke       # headless: plays campaigns to completion and checks invariants
npm run smoke -- --scenarios=england # only the smoke scenarios whose names match
npm run balance -- --runs=12 # seeded odds, acquisitions and campaign balance report
npm run test:simulation # score distributions, RNG, tie-breaks, odds and live ticker
npm run simulation:report -- --samples=200000 --out=docs/design/match-simulation-report.json
npm run test:experience # pause, manager choice, series and checkpoint integration
npm run test:reachability # every offered theatre and disconnected final opponents
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
npm run sync:domestic-clubs # refresh country club snapshots (network, cached)
npm run build:domestic   # rebuild country maps from snapshots and boundaries (about 5 minutes)
npm run test:domestic    # country maps, sections and seeded country campaigns
```

## How a campaign plays

Choose a sport, nations or clubs, and a **theatre**. Nation campaigns default to
Europe (UEFA); the other choices are the whole world (170 nations), another
confederation, or the Elite 32. Club campaigns offer individual leagues, all
leagues, or the strongest 32 available clubs. The setup shows the actual number
of teams for each choice.

Short, standard and world session presets show the field, games and estimated
autoplay duration before launch. Choose **Spectator** for automatic signings or
**Manager** to select a captured player when your managed team wins. The pinned
team selector changes the team you follow or manage. Optional alerts pause for
its matches; eliminated teams remain identified in the selector.

**Pacing** decides how matchups are drawn:

| Mode | Draw |
| --- | --- |
| `duel` | A spinner picks one attacker and a compass direction. One match per round. |
| `blitz` | Pair everyone, preferring neighbours; otherwise use another opponent. An odd team gets a bye. |
| `chaos` | Draw neighbour-preferred matchups until a name repeats, then resolve the batch. |

Blitz and chaos allow distant pairings without the directional route restrictions
used in one-by-one mode. Neither mode annexes neutral land to connect teams.

**Resolution** is either a live ticker or an instant final score. Level games go
to penalties in football and overtime in basketball. Pacing and resolution are
under **Match settings** during setup and the header's **Settings** button during
a campaign. Predictable, balanced and wild uncertainty presets adjust match-day
rating variation; even Predictable retains scoring and tie-break randomness.
Football uses the selected forwards and midfield to create chances against the
opposing defence and goalkeeper. Shared match tempo, form and Poisson scoring
produce varied low-scoring games. Basketball uses shared possessions, positional
offence/defence, form and shooting variance. Stronger teams are favourites, while
every uncertainty setting retains scoring randomness and possible upsets.
Pre-match percentages estimate this model with an independent seeded sample.
They do not consume the campaign's random stream.
Odds prepare the two lineups once and sample scores without building hundreds of
event timelines. The [match simulation notes](docs/design/match-simulation.md)
describe the rules, calibration checks and measured performance.

**Next match** draws or advances a match; **Finish match** fast-forwards a live
ticker to its result. **Play campaign** runs the campaign automatically, and
**Pause** freezes the draw, ticker and scheduled presentation, and **Resume**
continues them. Manual live matches also have a pause control. Speed cycles
1× / 2× / 4×. **Express** compresses routine presentation while keeping followed
matches, upsets and finales visible. It uses the same draw and match results.

The optional best-of-three finale starts when two teams remain. Interim games
award no territory or player; the second win resolves one conquest. A numeric
seed reproduces a campaign when settings, manager choices and simulation version
match. Updating the model can change future results for older seeds; already
generated matches in saved campaigns retain their outcome and events.

Progress autosaves during pending matches and after signings, preserving the
seed, random state, queue, history and pending manager choice. Save status reports
storage errors. Each checkpoint is kept with a recovery copy. A save is all or
nothing: when browser storage is full, a campaign may drop its own recovery copy to
fit, but never another campaign's; otherwise nothing is written and save status
says storage is full. **Saved campaigns** can delete a campaign (after a
confirmation; not the one in play) to free space. Country campaigns store their
players compactly, so a 100-club checkpoint is about 0.1 MB at kick-off and 0.3 MB
at the final. Export/import JSON provides a portable checkpoint, with download
and clipboard copy options. Entering new
campaign setup retains the previous save until a replacement is launched.
Older version-one saves migrate, but their original random stream was never
recorded, so exact continuation from that historical stream cannot be recovered.

History filters by team and opens full match events and conquest rewards.
**View conquest on map** reveals the gained holdings. Final results include the
largest upset, decisive match and most useful signing; the header trophy reopens
them after viewing the map. On phones, playback stays at the bottom while
scrolling. The map has one keyboard tab stop, arrow navigation and a skip link.

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

Football fields source-backed players; each squad row links to its rating evidence.
Game ratings use a 1–99 display range, with the original source values retained.

**Football** — `src/data/rosters.js` combines the committed EA FC 26 update 4
snapshot (19 September 2025; 18,405 records) with Football Manager 26 database
26.3.0 from [EFEM.club](https://efem.club/players), retrieved on 2 October 2026.
All **170 nations field eleven source-backed players**, with natural coverage for
a 4-4-2. The builder prioritises unchanged EA overall ratings and uses FM to fill
coverage gaps. It retains database IDs, full/display names, all natural roles,
source URLs, versions, dates and original ratings through transfers and saves.
The 280 generic Brazilian domestic players in EA's unlicensed `Série A` are
excluded; this does not exclude the Italian `Serie A`.

EFEM displays FM Current Ability on a normalised 1–100 scale. The game converts
it once using `round(currentAbility * 99 / 100)` and exposes both values in the
rating tooltip. It does not use potential or the site's separate EFEM Score.
EA overall and FM Current Ability remain different measures; the conversion
does not claim an official equivalence. These are **dated fantasy XIs by database
nationality**, including international retirees, rather than current call-ups.
Existing campaigns retain their saved squads; start a new campaign to use the
updated data. See `docs/design/football-roster-audit.json` for per-nation coverage.

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

A team's **strength** is the mean effective rating of its best positional lineup.
An assignment optimizer fills all eleven football or five basketball slots.
Playing outside a natural position costs 12 rating points. Missing legacy slots
use the team's sport baseline. The same starters determine strength and appear
in match scoring and tie-break events. Squad lists separate starters from bench
and identify positional penalties; bench depth does not directly inflate strength.

Football never invents a missing player or rating: an incomplete future source
is shown as an incomplete squad. The shipped sources cover every football XI.
Basketball is curated to the 40 federations that matter, so **24% of shirts are
real** but every serious basketball nation is. Basketball gaps retain generated
players at the confederation baseline, shown dimmed and asterisked.

To rebuild after swapping datasets:

```bash
npm run build-rosters [path/to/players.csv]   # football
npm run sync:football-manager                # refresh the pinned FM database supplement
npm run build-basketball                     # basketball
```

Football builders default to the committed reduced source snapshots in
`scripts/data/`, so regeneration works without network access. An optional EA
CSV must also include player IDs/URLs, full names, database version/update/date,
birth dates and club/competition IDs. The FM refresh reads the same public
endpoint and filters as EFEM's player grid. The original large exports remain in
ignored `data-src/`; only fields used for roster construction and evidence are
retained in the committed snapshots.

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
generated colour rather than a flag — identical national flags would tell you
nothing. Everything else (capital markers, the power table, squad panels,
conquest, player theft) behaves identically.

Club lineups come from the same two exports as the national squads:
`clubs.football.js` from the EA Sports FC CSV filtered to tier-one leagues, and
`clubs.basketball.js` from the NBA 2K export. 2K carries no position, so each
player's role is inferred from the attributes that define it — a centre by
interior defence, rebounding and post play; a point guard by vision, handle and
speed with the ball.

## Domestic campaigns

With **Clubs** and football, the Theatre list has a second group, **One country ·
top clubs**. Pick a country and its top clubs fight over that country alone: 100
of them, or fewer where the database has fewer viable sides (a country ships with
at least two; every club is real). The map is always split into 100 sections,
built from the country's real administrative divisions. Each club starts on the
section around its home town; with fewer than 100 clubs it also starts on the
sections around that one, a group of 100/N rounded down or up (the stronger clubs
take the extra ones where they have room), so Fiji's 16 clubs start with 6 or 7
sections each and Belize's two with 50. Conquest is unchanged: the winner annexes
everything the loser holds and claims one player, so a starting group always
changes hands whole. Every section is held from kick-off, so there is no neutral
land and no transit treaty. Neighbouring
countries are drawn as muted land beneath the map. They are never territory, but
attacks go around them, by sea if need be; only an exclave (Nakhchivan, Gaza,
Kaliningrad) may have to cross one, labelled "Crossing foreign territory". Attack
routes start from a point well inside each section (the home town when it is
clear of the border), while the home marker shows the town itself. Tooltips and
conquest results use section names, such as "Lancashire (east)", where Burnley
starts.

Each country is one file, `public/domestic/<id>.json`, fetched only when chosen.
The setup screen shows a loading state, and Retry if the fetch fails. On wide
screens it previews the country beside the setup panel, each section in its
starting club's colour (hovering one names the club), and Launch shows that it
is preparing the map. The file holds the sections as TopoJSON with shared
borders, the clubs with their starting sections and squads, and a projection
centred on the country, so the scale bar is a true distance at the map's centre.
The generated index `src/data/domestic.js` lists the shipped countries. Saves
record `clubScope: 'domestic:<id>'` and the map's version. Resuming, importing or
reloading a save loads the map first. The saved-campaign dialog says so
meanwhile, and closing it (or Cancel import, or Clear quick resume) cancels the
restore. A save from another build of the same map resumes club by club: section
ids follow club rank, and a club's starting sections always share one holder, so
all of its new starting sections go to whoever held its old home section. Saves
from the earlier one-section-per-club maps move onto the 100-section maps the
same way. A moved save is re-stamped with the new version and restarts an
interrupted draw. A save whose clubs differ from the new build's, or whose
holdings split a starting group, is refused, and kept.

**Sources.** All of this is fetched at build time and committed; nothing loads
from these services at runtime.

- **Clubs and squads**: Football Manager 26 database 26.3.0 from
  [EFEM.club](https://efem.club), in reputation order (clubs of equal reputation
  are re-read whole, since EFEM's pages shuffle them). A club is viable if it is a
  men's first team (not a reserve, B, academy or youth side of a stronger club)
  with at least eleven natural-position players, including a goalkeeper. Squads
  keep up to 16 players: a natural 4-4-2 in the game's own roles (wingers count
  as forwards) first, then the best by Current Ability, converted to the 1–99
  range as for nations. Loans are not applied: EFEM lists only a player's
  contract club. FM's placeholder names for unlicensed clubs (Portugal's "BRG")
  are replaced from `scripts/data/domestic-names.json`.
- **Home towns**: manual overrides in `scripts/data/domestic-locations.json`, then
  Wikidata (CC0), then GeoNames `cities1000` (CC BY 4.0). Each club records which
  one placed it. Some overrides are region-level (marked "approximate:"), and the
  87 clubs with no known home start at a populous place no other club holds
  (`homeSource` `placed:<geonameid>`, an estimate).
- **Boundaries**: [geoBoundaries](https://www.geoboundaries.org) gbOpen layers,
  pinned to one commit, with Natural Earth admin-1 (public domain) as a fallback;
  GeoNames places repair broken unit names and name the extra sections. Licences
  differ by country: 34 maps derive from ODbL layers and 13 from CC BY-SA ones,
  and those terms also cover the section shapes. Land the game's own world map
  gives to another country is cut out (Pakistan's side of Kashmir from India,
  Crimea from Ukraine).

`public/domestic/ATTRIBUTION.txt` is generated with every build and lists each
country's boundary source and licence, its cuts and fills, plus the GeoNames,
Wikidata and EFEM notes. 163 of the game's 170 nations ship, with 6,364 clubs (22
countries have 100, nine have two); the maps total 23.9 MB (34–250 KB each), and
a session fetches only the one chosen. Sri Lanka, Cuba, Eritrea, Afghanistan,
the Bahamas, Namibia and Sierra Leone have fewer than two viable clubs, so they
do not ship.

**How sections are built.** For each country the builder takes the coarsest
boundary level with at least 200 units (twice the 100 sections), or else the
finest level with at least 100, checking each layer's real unit count and
coverage, and fills land a layer misses from the next coarser one (Kuwait's
Bubiyan). England uses the UK's districts inside the England border. Units with
separate parts become one unit per part, and far overseas islands without a club
are dropped. Units are split until there are at least 100: first those holding
the most club homes, by a Voronoi diagram of those homes, then the largest. A
unit shared by clubs is also cut, one piece per club, when a club would
otherwise start far from home, and the piece holding a shared town goes to its
strongest club. In reputation order, each club claims the unit holding its home,
or the nearest free unit. The smallest territory then repeatedly takes an
adjacent free unit, as long as no other club's start is much nearer, until every
unit is claimed; islands join a club within reach. With 100 clubs each territory
is one section. With fewer, each territory is cut into its club's group: extra
sections are seeded at its towns and villages (GeoNames, mildly favouring the
populous ones), and each grows inside the territory only, so a group is always
contiguous on land. Where every club gets two or more sections (50 clubs or
fewer), territories also stop growing at about 1.5 times their fair share of
land, clubs crowded into one city start in wedges fanned out around it (Dhaka's
ten clubs), and a club still boxed in starts just outside its city, never
farther from home than one club's share of the country is wide; when a club
still ends up with too little land, the partition is redone. Each section is
dissolved, simplified and quantized. Names come from the source units, or for an
extra section from the town it was built around, repaired from GeoNames where
broken, and are unique on each map; a club pushed off its home unit names its
town, as in Everton's "Sefton (near Liverpool)". Codes are three letters, and
colours differ between neighbouring clubs' groups, also across straits. The
output is deterministic.

To refresh or rebuild:

```bash
npm run sync:domestic-clubs -- --only=826  # EFEM, Wikidata and GeoNames → scripts/data/domestic/826.json
npm run build:domestic -- --only=826       # boundaries + snapshot → public/domestic/, index, ATTRIBUTION.txt
npm run build:domestic                     # every country: 4.5–6.5 minutes, nearly all of it Canada
npm run build:domestic -- --check          # offline rebuild must match the committed files byte for byte (as long)
npm run test:domestic                      # shipped data, section geometry, seeded country campaigns (about 40 s)
```

Both stages cache downloads under the ignored `data-src/`, so reruns work offline;
from a warm cache the sync of every nation takes about 30 s. The sync is polite:
three requests at a time with pauses and retries. Leave out `--only` to process
every nation. A full build or `--check` runs countries in parallel worker threads
(`--jobs=N`, up to 8 by default) and is best run in the background. Country
routing (anchors, foreign land, border routes) is tested by
`scripts/domestic-routing.test.mjs`; `npm test` runs every test file, the domestic
ones included. The [design notes](docs/design/domestic-campaigns.md) give the
sources and queries, the partition, the file format, saves, acceptance checks and
known limitations.

## Squad economics

Beating a team claims one player. The squad panel tracks what that has
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
capital pair is blocked. If every direct route is blocked, the fallback rules
below apply. Display labels use a separate
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
attacker has no legal straight-line route, a checked coastal sea polyline tries
to connect its holdings to an enemy. If neutral enclosure prevents that route,
an explicitly labelled **neutral transit treaty** permits crossing neutral land
without claiming it. The displayed polyline follows the checked route. A draw
retries an unreachable attacker without consuming extra random samples. These
exceptions keep disconnected final opponents playable. Blitz and chaos use the
batch pairing rules described above.

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

- `matchDrama` (0–12) — default match-day variance in rating points. Campaign
  uncertainty presets use 0, 6 and 12; higher values widen performance variation.
  Scoring and tie-break randomness remains at zero variance.
- `upsetThreshold` (2–15) — rating gap at which a win is flagged as an upset.
- `showLabels` — draw empire names (club codes for clubs) over their largest held
  shape; labels are spaced to remain readable at the current zoom.

## Verification

`npm run smoke` boots the real component tree under jsdom and plays **ten full
campaigns** across all three pacings, both resolution modes, both sports, and
national, club and domestic teams; two of them are England's top 100 clubs on
their own map and one is Fiji's 16 clubs, each starting on a group of its 100
sections. **Six interrupt-and-resume scenarios** cover a world-scale national
campaign plus basketball nations, football clubs, NBA clubs and England and Fiji
domestic campaigns, which are played on to their champions after the reload.
They verify that settings, ownership, squads, acquired players, and the remaining
match queue survive a reload and that the campaign remains playable. The app's
files are served from `public/` by path, with a 404 for anything missing. The
domestic runs also check the setup's loading, error and Retry states, and that
the neighbouring-land backdrop stays inert. The domestic resume also refuses a
save naming missing sections and a map that cannot load, resumes from a cold
map cache, and restores a one-section-per-club save onto the 100-section map,
each starting group whole with its holder. `npm run test:domestic` kicks off
every shipped country with legal duel draws.

The suite asserts that each match eliminates exactly one team, that no territory
is lost or duplicated, and that one player changes shirts per match. It checks
political ownership colours, national flag ownership in Flags mode, club colours,
structured result rewards, the sidebar tabs, victory, and absence of React
warnings.

It also checks each sport's match model over 400 simulated games: that every match
has a winner, that a level score always triggers a tie-break, that the event feed
adds up to the final score, and that scoring lands in the right range for the
sport.

The [improvement checklist](docs/design/improvements.md) records the implemented
design changes. The [playtest protocol](docs/design/playtest.md) covers first-run
understanding, pacing, manager agency and save confidence. `npm run balance`
compares seeded single-match and series finales, champion concentration, leader
turnover and useful signing rates. Model probes and developer interaction checks
do not replace observing new players.
