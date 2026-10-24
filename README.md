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
- **One country's clubs** — a country's top 100 football clubs on that country's
  own map, split into one section per club ([domestic campaigns](#domestic-campaigns)).

Everything outside the match — territory, the spinner, targeting, conquest,
autosave, the map — is sport- and layer-agnostic. A sport supplies its own roster
data, lineup shape, match model and vocabulary from `src/sports/`; adding a third
is a single module and a roster file.

Originally implemented from the `Football Imperialism.dc.html` design in the
[Football Imperialism Game](https://claude.ai/design/p/440e3f09-8445-4fa3-8acb-531957f27c9b)
Claude Design project.

The current interface is that project's **v4 redesign**: modern, flat and calm.
It pairs a grand-strategy map (Europa Universalis) with dense football-management
data (Football Manager). Surfaces are light (`#f5f5f2` with white panels) with
square corners and no textures, glows or gradients. One clay accent (`#9c5a43`)
marks your team and the primary action, and cobalt (`#2f54eb`) marks the next
opponent. Archivo and Archivo Narrow are the only faces loaded. They are
self-hosted with their open-font licenses in `public/fonts`, so no external font
service is needed. The Alegreya files and `public/textures/cartographic-paper.png`
remain in the repository but are no longer used. Map names wait for their font
metrics before switching faces. The [v4 redesign record](docs/design/v4-redesign.md)
lists the binding decisions, the architecture and the known deviations. Earlier
notes in `docs/design/` are kept as history.

## Running it

```bash
npm install
npm run dev         # dev server, prints a localhost URL
npm run build       # production bundle into dist/
npm test            # complete automated regression suite
npm run smoke       # headless: plays campaigns to completion and checks invariants
npm run smoke -- --scenarios=england # only the smoke scenarios whose names match
npm run smoke -- --campaign-only=7   # one scenario by index (also --resume-only=<i>, --manager-only)
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
npm run build:domestic   # rebuild country maps from snapshots and boundaries
npm run test:domestic    # country maps, sections and seeded country campaigns
```

## How a campaign plays

### Setup

A new campaign is set up in three steps: **Campaign → Rules → Nation & role**.
Space moves to the next step and launches the campaign from the last one.

1. **Campaign** — choose a sport, nations or clubs, and a **theatre**. Nation
   campaigns default to Europe (UEFA). The other choices are the whole world
   (170 nations), another confederation, or the Elite 32. Club campaigns offer
   individual leagues, all leagues, or the strongest 32 available clubs. The
   step shows the actual number of teams, the number of matches and the
   estimated duration at 1× autoplay. With clubs in football, a second theatre
   group, **One country · top clubs**, starts a [domestic campaign](#domestic-campaigns).
   A quick-resume card appears when a save exists.
2. **Rules of war** — turn order and targeting (below). A collapsed **Match
   settings** section holds pacing, match display, uncertainty, the final two,
   automatic recruitment, basketball starting ratings, the campaign seed and
   Express playback.
3. **Nation & role** — **Manager** commits to one team. You choose an approach
   before its matches and one of up to three signings after its wins.
   **Spectator** leaves draws, results and signings to the game, and you can
   follow any empire once the campaign starts. **Launch campaign** starts it.

**Pacing** decides how matchups are drawn:

| Mode | Draw |
| --- | --- |
| `duel` | One by one: a spinner (or the round-robin queue) picks the attacker, and a compass direction (or your choice) picks the opponent. One match per turn. |
| `blitz` | Pair everyone, preferring neighbours; otherwise use another opponent. An odd team gets a bye. |
| `chaos` | Draw neighbour-preferred matchups until a name repeats, then resolve the batch. |

Blitz and chaos allow distant pairings without the directional route restrictions
used in one-by-one mode. Neither mode annexes neutral land to connect teams.

### Rules of war

Setup step 2 combines a **turn order** with a **target** rule:

| Turn order | Who attacks |
| --- | --- |
| Round robin | Every surviving empire attacks once per round, strongest first (by starting strength, then name). |
| Random draw | Any surviving empire can be drawn each turn. |

| Target | Whom they attack |
| --- | --- |
| You choose | Manager only. On your turns you pick any empire in reach; every other empire spins the compass. |
| Compass | The compass picks the target for every attacker, you included. |

A 2×2 explainer names the four combinations: *Your front, your call* (round
robin × you choose), *Clockwork war* (round robin × compass), *Wait for the
draw* (random × you choose) and *Pure chaos* (random × compass, the original
Imperialism draw).

The rules apply to one-by-one (`duel`) pacing only. Blitz and chaos always use a
random draw and the compass, and setup shows the cards disabled with a note.
Spectators always use the compass: *You choose* becomes the compass when a
spectator launches it, and again when an eliminated manager continues as a
spectator. Rules are fixed at launch. The defaults, **random draw × compass**,
reproduce the original behaviour exactly. Every one-by-one turn consumes
exactly three campaign random samples in every mode, so seeds recorded before
the rules existed still replay the same campaign.

An empire is **in reach** if it is a land neighbour with a legal direct route.
If there is none, direct sea strikes count; after that, the fallback sea and
treaty routes. If nothing is in reach, that turn uses the compass and the log
says so.

Under round robin, a round is one full cycle. On the Map view a turn strip under
the masthead shows "Turn N of M this round" and the flags in turn order. Played
and fallen empires are dimmed (fallen ones are also struck through), the current
attacker is ringed, and "Next" names the following attacker. A round-robin
attacker with no route at all skips its turn. Under a random draw, spectators
get a strip with the number of empires that can be drawn and the recent
attackers.

On your turn under *You choose*, every empire in reach gets a dashed cobalt
outline and the land out of reach is veiled. The column's **Choose a target**
panel lists flag, name, strength, the territories you would gain and your win
chance. The list is sorted by win chance × territories, with the top row
preselected. A card on the map spells out what winning and losing would mean,
and the primary action becomes **Attack <team>**. The campaign waits for your
choice; no timer runs.

### Match rules

**Resolution** is either a live ticker or an instant final score. Level games go
to penalties in football and overtime in basketball. Pacing, the rules of war,
uncertainty, the final-two format and your role are fixed at launch. During a
campaign the masthead's **Settings** button shows them read-only and lets you
change the match display and Express playback. Predictable, balanced and wild
uncertainty presets adjust match-day rating variation; even Predictable retains
scoring and tie-break randomness.
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

### Masthead and controls

The masthead has two rows. Row 1 holds the wordmark, the dateline ("Round XIX ·
22 of 55 remain"), the screen navigation **Map / Squad / Match / Ledger /
Chronicle**, the one primary action and the Settings button. Row 2 shows your
team (flag, name, "Managed by you") with Strength and its change since Round I,
Territories, Conquests and Claimed. A spectator sees "Spectating · Following
<team>" with Empires, Matches, Upsets and Largest. Row 2 ends with the playback
controls, "Autoplay off · Speed 2×": the first toggles autoplay and the second
cycles 1× / 2× / 4×. Spectators also get a step button there (**Next match** /
**Finish match**).

There is one primary action per screen, and **Space** runs it on desktop. At
1200px and wider the button carries a "SPACE" hint. Focused controls keep their
own Space, and open dialogs block it.

| Primary | When |
| --- | --- |
| **Continue** | Draw the next match, move on after a result, or kick off at a tactical gate with the balanced approach |
| **Finish match** | Reveal a live ticker match's result |
| **Attack <team>** | Confirm your target under *You choose* |
| **Sign <player>** | Confirm the signing on the conquest screen (the masthead button reads "Sign player") |
| **Pause** / **Resume** | Autoplay is running / the clock is paused |
| **Play campaign** | A spectator's primary (it becomes **Pause** while autoplay runs) |
| **Results** | The campaign is over |

**Pause** freezes the draw, the ticker and scheduled presentation. A pending
target choice or signing holds the screen: only Map stays available in the
navigation. **Express** compresses routine presentation while keeping followed
matches, upsets and finales visible. It uses the same draw and match results.

### Map view

The map fills the screen next to a campaign column (500px at 1600px and wider,
360px from 1200px). For a manager, the column shows:

- **Next fixture.** Before the draw, round robin shows "<TEAM> to attack" with
  "Compass decides the target" or "You choose the target". A random draw shows
  "Next draw · Any of N empires can be drawn". Once the fixture is known, it
  shows "<A> v <B>", the route ("Across a land border" / "By sea — no shared
  border"), the odds bar and "Strength 82.1 v 78.4 · from N simulated matches".
  When your team plays, **Match preview** opens the approach choice. **or
  simulate the result** reveals this match at once with the default approach.
  **Continue** kicks off with the balanced approach. During and after the match
  the block holds the compact match card with the score and minute.
- **Your fronts** — neighbouring empires with strength, territories and your
  win chance: green at 60% or more, amber at 45–59%, red below 45%.
- **Latest results** — "Germany beat Austria", the score and the claimed
  player. **Chronicle** opens the full history.

A spectator's column shows **This turn** instead: attacker, "compass points
to", defender and the odds, then the live match card. It also shows
**Following**, where you change the followed team and switch on "Pause when
<team> plays", and the autoplay and speed controls.

The map carries a title card (round, campaign title, "Map after Round XVIII ·
seed 2026"), a key, the map-mode switch and the zoom −/+/reset control. A live
ticker runs along the bottom: a LIVE label and results newest first, such as
"R XVIII  GERMANY 2  AUSTRIA 0 · AUSTRIA OUT". It is static, not a marquee.

Map modes:

| Mode | Shows |
| --- | --- |
| **Political** (default) | A flat pastel per empire, picked by a hash of the team id. Your empire is clay; the next opponent turns cobalt once the fixture is known. |
| **Strength** | Five grey steps by strength percentile; your empire keeps its colour. |
| **Fronts** | Your fronts tinted by your win chance (green / amber / red); other land is neutral. |
| **Flags** | Each empire's flag across its land (see [Flags](#flags)); clubs keep their colours. |

The map mode is not saved: a reloaded campaign opens on Political. Hovering land
shows its owner, since when it has been held and the deciding result. Clicking
land opens that team's squad.

### Match, squad and conquest screens

**Match** shows the live match. A score header holds attack and defence, the
scorers, the score and the minute ("67' · LIVE", then FULL TIME, FINAL for
basketball, or PENALTIES). Below it, a **win-probability chart** follows the
match from your side: the managed team, else the followed team, else the
attacker. It marks goals and half-time. Football uses a Poisson model of the
goals still to come, built from the match's own lineups. Basketball uses a
normal approximation of the remaining margin. Both lineups follow, with
claimed players tagged and ratings coloured by tier. A dark match feed lists
events newest first and has 1× / 2× / 4× speed chips and Pause. When a live
ticker match involving your team (or, as a spectator, the followed team) kicks
off while you are on Map, the game switches to Match. It returns to Map at the
next turn if the switch was automatic. Express and "simulate the result" never
switch. Without a live match, the screen shows the last finished match, or the
next fixture before the first one.

**Squad** shows one team: the flag, "First team · N players · K claimed in
conquest", the starting-lineup strength and its change, and the claimed count.
Tabs switch between **List**, **Pitch** and **Acquisitions**. The list columns
are No · Pos · Player · Natural · In role · Rtg · Acquired · Source, grouped by
position, followed by squad depth. The side column has the formation (claimed
players in teal), a strength profile on a 60–95 scale and the latest claims.
Basketball uses a court, Guards / Forwards / Centres and an offence/defence
profile. Squad opens from the navigation, from map land or from a Ledger row;
Back returns to where you came from.

The **conquest screen** appears after your managed team wins, and the campaign
waits for your choice. The map hatches the taken land under a "+N territories
taken" callout. Beside it, an article reads "SERBIA IS OUT", with a
winner-first standfirst and the territory and empire effects. **Claim one
player** lists the candidates, with the best lineup fit preselected. Each one
reads "FW · 86 rating · Starts ahead of <player>" or "Adds depth · the XI is
unchanged", with the strength gain. The position lists every natural position,
so a basketball combo guard reads "PG/SG · 88 rating". A collapsible "Lineup
before and after" compares the lineups, and **Sign <player>** confirms. If your
team is knocked out, the same article layout ("ITALY IS OUT") offers
**Continue as spectator** or **Retry this setup**. Conquests by other teams
never wait: a notice on the map, the ticker and a brief hatch flash report them.

**Ledger** shows the standings (# · Team · Terr · Strength · Conq · Claimed),
the share of the map and the fallen empires. **Chronicle** shows the match
history, the archived match card, turning points and the activity feed.

### Phones and tablets

Below 700px the masthead shrinks to the flag, wordmark and round over four stat
cells. The map zooms to your empire and the next opponent, with a **Whole map** /
**Your fronts** toggle. The campaign column becomes a bottom sheet with a grab
handle; tapping it expands the sheet to show your fronts and latest results. A
full-width primary bar sits above a tab bar of **Map · Squad · Match · Ledger ·
More**. **More** holds the Chronicle, the playback controls, Settings and saves.
From 700px to 1199px the map sits on top and the column content runs in two
columns below. Touch targets are at least 44px. Reduced motion keeps only
opacity transitions.

### Finale, seeds and saves

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

The Chronicle's history filters by team and opens full match events and
conquest rewards. **View conquest on map** reveals the gained holdings. Final
results include the biggest upset, the decisive match and the transfer impact.
The masthead trophy reopens them after you view the map. The map has one
keyboard tab stop, arrow navigation and a skip link.

### Draw compass, flags and navigation

In one-by-one mode, the [draw compass](docs/design/duel-draw.md) selects an
attacker, slows to the chosen opponent's exact bearing, and briefly reveals the
route before kickoff. The compass and route share the same origin. Animation
and kickoff use one captured playback speed; changing speed during a draw takes
effect after that draw. Off-screen draws are brought into view, and reduced
motion replaces spinning with a short, static directional reveal.

In **Flags** mode each nation has its flag as the territory background, and
conquered land adopts its owner's banner. Countries outside the active campaign
stay neutral without flags. Clubs fly no flags and keep their own colours.

Fourteen [symbol-aware flag designs](docs/design/flag-symbols.md) separate the
continuous field from their emblem. Crosses, discs and coats of arms keep their
proportions and fit on owned land instead of stretching across the region's box.
The field remains continuous across nearby islands, and camera movement cannot
relocate or repeat the emblem. Other flags and the small UI flag chips retain
their original artwork.

Scroll to zoom (up to 16×, anchored on the pointer), drag to pan, double-click or
press the zoom readout to reset. The view is clamped to the world, so the map
cannot be lost off-screen. Borders, labels and markers hold a constant weight on
screen at every zoom level. The v4 map has no scale bar or coordinate readout.

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
eligibility follows the federation — Banchero plays for the USA rather than
Italy). The fives were last checked against FIBA records in October 2026: every
player has played for his national team since 2023, players who had retired
from it were replaced by current internationals at the same position, and no
five fields more than the one naturalized player FIBA allows.

Basketball positions are fluid, so most players list two neighbouring positions,
primary first: Dončić is PG/SG, Giannis PF/C, Melli PF/C. Pure point guards and
centres such as Calathes and Jokić list one, and so do players whose sources
show a single position. 133 of the 200 national players cover two positions.
Every listed position is one the player really plays, and every five has a
real player for each of the five positions. The lineup optimizer fields each
five from these positions, so Italy starts Pajola (PG/SG) at shooting guard and
Melli at centre.

Nations with no roster in a sport fall back to *that sport's* baseline, never to
another's. Getting this wrong first time ranked England third at basketball.

A team's **strength** is the mean effective rating of its best positional lineup.
An assignment optimizer fills all eleven football or five basketball slots.
Playing outside a natural position costs 12 rating points. A player may have
more than one natural position, and each one is penalty-free: a claimed PG/SG
can start at either guard spot. Missing legacy slots
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
player's positions are inferred from the attributes that define them — a centre
by interior defence, rebounding and post play; a point guard by vision, handle
and speed with the ball. Each fit is ranked as a league percentile, so the five
scales compare. A player's best fit is his primary position. He also covers the
better neighbouring position when it ranks within 15 percentiles of it. About
three in four players in the export, and 131 of the 150 NBA starters, cover two
positions. Each franchise's five is then the lineup the game itself would field
from its whole roster.

## Domestic campaigns

With **Clubs** and football, the Theatre list has a second group, **One country ·
top clubs**. Pick a country and its top clubs fight over that country alone: 100
of them, or fewer where the database has fewer viable sides (a country ships with
at least 10). The map is split into one section per club, built from the
country's real administrative divisions. Each club starts on the section around
its home town, and conquest is unchanged: the winner annexes everything the loser
holds and claims one player. Every section is held from kick-off, so there is no
neutral land and no transit treaty. Neighbouring countries are drawn as muted land
beneath the map. They are never territory, but attacks go around them, by sea if
need be; only an exclave (Nakhchivan, Gaza, Kaliningrad) may have to cross one,
labelled "Crossing foreign territory". Attack routes start from a point well
inside each section (the home town when it is clear of the border), while the
home marker shows the town itself. Tooltips and conquest results use section
names, such as "Lancashire (east)", where Burnley starts.

In the v4 interface, choosing **Clubs** in setup step 1 adds the **One country ·
top clubs** group below the leagues (football only). Picking a country shows a
preview card: its sections in their starting clubs' kick-off colours over the
neighbouring land, captioned with the number of sections. The sectioned map
uses the same flat style as the world map: pastel section fills, white borders
and the clay and cobalt identity colours. Neighbouring countries form an inert
land-neutral backdrop, and every home town is marked at any zoom. The title
card reads the theatre itself, such as "England · top 100 clubs", and the key
labels the marker **Home town** instead of Capital. Tooltips name the section
and read "Home of Burnley", "Held by … since Round …" or "Unclaimed". The
conquest screen and results name the sections taken. When an exclave's attack
has to cross a neighbour, the Next fixture route line reads "Through foreign
land — never claimed". In Flags mode, clubs keep their own colours.

Each country is one file, `public/domestic/<id>.json`, fetched only when chosen.
The setup screen shows a loading state, and Retry if the fetch fails. The setup
wizard previews the country in step 1, each section in the colour its starting
club takes at kick-off, and Launch shows that it is preparing the map. The file
holds the sections as TopoJSON with shared borders, the clubs and their squads,
and a projection centred on the country, so distances are true at the map's
centre. The generated index `src/data/domestic.js` lists the shipped
countries. Saves record `clubScope: 'domestic:<id>'` and the map's version.
Resuming, importing or reloading a save loads the map first. The saved-campaign
dialog says so meanwhile, and closing it (or Cancel import, or Clear quick
resume) cancels the restore. A save from another build of the same map resumes
club by club: section ids follow club rank, so each club's new starting section
goes to whoever held its old one. It is re-stamped with the new version and
restarts an interrupted draw. A save whose clubs differ from the new build's is
refused, and kept.

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
  86 clubs with no known home start at a populous place no other club holds
  (`homeSource` `placed:<geonameid>`, an estimate).
- **Boundaries**: [geoBoundaries](https://www.geoboundaries.org) gbOpen layers,
  pinned to one commit, with Natural Earth admin-1 (public domain) as a fallback;
  GeoNames places repair broken unit names. Licences differ by country: 31 maps
  derive from ODbL layers and 11 from CC BY-SA ones, and those terms also cover
  the section shapes. Land the game's own world map gives to another country is
  cut out (Pakistan's side of Kashmir from India, Crimea from Ukraine).

`public/domestic/ATTRIBUTION.txt` is generated with every build and lists each
country's boundary source and licence, its cuts and fills, plus the GeoNames,
Wikidata and EFEM notes. 128 countries ship, with 6,205 clubs; the maps total
17.9 MB (22–248 KB each), and a session fetches only the one chosen.

**How sections are built.** For each country the builder takes the coarsest
boundary level with at least twice as many units as clubs, or else the finest
level with enough units, checking each layer's real unit count and coverage, and
fills land a layer misses from the next coarser one (Kuwait's Bubiyan). England
uses the UK's districts inside the England border. Units with separate parts
become one unit per part, and far overseas islands without a club are dropped.
If there are still too few units, the units holding the most club homes are
split by a Voronoi diagram of those homes; a unit shared by clubs is also cut,
one piece per club, when a club would otherwise start far from home, and the
piece holding a shared town goes to its strongest club. In reputation order,
each club claims the unit holding its home, or the nearest free unit. The
smallest section then repeatedly takes an adjacent free unit, as long as no
other club's start is much nearer, until every unit is claimed; islands join a
club within reach. Each section is dissolved, simplified and quantized. Names
come from the source units, repaired from GeoNames where broken, and are unique
on each map; a club pushed off its home unit names its town, as in Everton's
"Sefton (near Liverpool)". Codes are three letters, and colours differ between
neighbours, also across straits.
The output is deterministic.

To refresh or rebuild:

```bash
npm run sync:domestic-clubs -- --only=826  # EFEM, Wikidata and GeoNames → scripts/data/domestic/826.json
npm run build:domestic -- --only=826       # boundaries + snapshot → public/domestic/, index, ATTRIBUTION.txt
npm run build:domestic -- --check          # offline rebuild must match the committed files byte for byte
npm run test:domestic                      # shipped data, section geometry, seeded country campaigns
```

Both stages cache downloads under the ignored `data-src/`, so reruns work offline.
The sync is polite: three requests at a time with pauses and retries. Leave out
`--only` to process every nation. Country routing (anchors, foreign land, border
routes) is tested by `scripts/domestic-routing.test.mjs`, which `npm test` runs.
The [design notes](docs/design/domestic-campaigns.md) give the sources and
queries, the partition, the file format, saves, acceptance checks and known
limitations.

## Squad economics

Beating a team claims one player. Strength (`EFF`) is the best-lineup rating, so
it only ever climbs; a claimed player who does not make the lineup adds depth
but no strength. The squad screen and the masthead show it against its
kick-off value. The Ledger standings
always rank teams by live overall strength (EFF), highest first, and show strength
gain since the campaign began. Equal strengths are ordered alphabetically;
territory count is informational and never changes the rank order.
Positive campaign gains appear as a green `+N` beside Strength (one decimal);
an unchanged strength reads a muted `±0.0`.
The latest match result also shows the winner's before/after strength and the
gain from that conquest alone. A transfer that does not improve the rating says
`No change`; territory itself adds no artificial strength bonus. Cumulative
gains remain available after resuming a saved campaign.

## Flags

In **Flags** mode, territory is filled with its **owner's** flag, so an empire
reads as one banner spreading across the map — conquered land switches to the
conqueror's colours the moment it is annexed. Political mode, the default,
communicates the same ownership with flat pastel fills. Flags also identify
national teams in the masthead, match results, standings, squads and the
victory screen.

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
in the nation's colour is the fallback. Non-participants remain unflagged in
continental campaigns, and clubs continue to use club colours.

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
horizontal and shape-aligned angles, measures the real text (Archivo Narrow,
uppercase, .14em tracking), and gives the name a gentle upward arch rising 5% of
its width. The padded footprint includes the curve and halo.
Cramped inland names can use a softer arch before being omitted.
Coastlines, foreign enclaves, holes and sea gaps are checked against the rendered
vector geometry.

Names grow with usable territory up to 30px at 1600px wide and above, 22px from
1200px, 20px from 700px and 18px on phones. They are hidden below 9px, except
your own empire's name, which can shrink to 6.5px.
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
  App.jsx              campaign state, flow, view router, primary action, render;
                       one-line delegates to src/app/
  app/                 App method bodies by area, called as fn.apply(this, args)
    mapMethods.jsx     map fills, flags, labels, tooltip, reach and conquest framing
    columnMethods.jsx  campaign column, map title card and key, ticker
    matchMethods.jsx   live match presentation, minute clock, match card
    squadMethods.jsx   squad view
    conquestMethods.jsx  result, signing gate, conquest screen, elimination
    turnMethods.jsx    turn order, target choice, turn strip, spectator panel
    ledgerMethods.jsx  standings, Ledger, Chronicle, victory, match preview
    shared.js          constants shared by App and the method modules
  viewModels/          pure build*(state, ctx) functions: masthead, campaign,
                       map, match, squad, conquest, turns, ledger, odds, format
  screens/             presentational v4 screens, one folder per area
    campaign/          Next fixture, Your fronts, Latest results, ticker, map overlays
    match/             score header, win-probability chart, XI tables, match feed
    squad/             squad table, pitch/court, strength profile, claims
    conquest/          conquest article and map callout
    turns/             turn strip, Choose a target panel and card, spectator panel
    ledger/            Ledger and Chronicle screens, standings, history
    setup/             setup wizard model (steps, rules of war, summaries)
  styles/
    tokens.css         v4 colour, type and layout tokens (incl. --map-veil)
    primitives.css     shared buttons, kickers, tables, panels
    shell.css          app shell per view and breakpoint, phone chrome
  config.js            simulation tunables (drama, upset threshold, labels), save version
  theme.js             design tokens for JS (v4 colours, map values, rating tiers)
  sports/              per-sport lineup, match model and vocabulary
    football.js        4-4-2, 90 minutes, penalty shootouts
    basketball.js      starting five, 40 minutes, overtime
  data/teams.js        170 nations: identity, squad building
  data/rosters.js      GENERATED football squads (npm run build-rosters)
  data/rosters.basketball.js  GENERATED FIBA fives (npm run build-basketball)
  data/clubs.football.js      GENERATED club XIs (npm run build-clubs)
  data/clubs.basketball.js    GENERATED NBA fives (npm run build-clubs)
  data/scopes.js       club theatre choices (per league, all, elite)
  data/domestic.js     GENERATED index of shipped country maps (npm run build:domestic)
  data/domesticScope.js  labels for 'domestic:<id>' theatres
  data/flags.js        nation id -> flag asset
  data/capitals.js     capital city coordinates
  hooks/               map zoom and pan viewport
  engine/
    geo.js             TopoJSON decode, land adjacency, projection, SVG paths
    random.js          sampling shared by every sport
    campaign.js        territory ownership, targeting, round draws
    duelDraw.js        one-by-one draw: attacker, compass bearing, route
    turns.js           round-robin queue, "in reach" targets, launch rules
    winProbability.js  live win-probability model (football and basketball)
    liveMinute.js      live match minute store (outside saved state)
    domestic.js        loads and validates a country map: sections and club rows
    storage.js         autosave, save slots and versions
  components/          masthead (CommandBar), playback, phone chrome, map, setup
                       wizard, match card, dialogs and overlays
public/
  world-110m.v1.json   Natural Earth 110m topology for campaign rules
  countries-50m.json   world-atlas 2.0.2 topology for display
  WORLD_ATLAS_LICENSE.txt  ISC licence for world-atlas
  domestic/            one sectioned map per country, fetched on demand
  fonts/               self-hosted Archivo and Archivo Narrow (Alegreya unused)
  textures/            former cartographic paper texture (unused since v4)
  flags/               170 vendored flag SVGs
scripts/
  test.mjs             runs every scripts/*.test.mjs (npm test)
  lib/app-harness.mjs  shared App/component harness for the jsdom tests
  data/seed-replay.golden.json  determinism golden for seeded campaigns
  smoke.mjs            headless campaign test (jsdom)
  sync-flags.mjs       vendors flag SVGs from flag-icons
  build-rosters.mjs    builds football squads from an EA FC export
  build-basketball.mjs builds FIBA fives from NBA 2K + fiba-squads.json
  build-clubs.mjs      builds the club layer for both sports
  sync-domestic-clubs.mjs  snapshots each country's clubs, squads and home towns
  build-domestic.mjs   builds the country maps, index and ATTRIBUTION.txt
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

`npm run smoke` boots the real component tree under jsdom and plays **nine full
campaigns** across all three pacings, both resolution modes, both sports, and
national, club and domestic teams; two of them are England's top 100 clubs on
their own map. A **manager campaign** (Italy, Europe, round robin × *You
choose*, live ticker) is driven only through the primary action. It covers
target choices, tactical gates, Finish match, signings on the conquest screen,
the automatic switch to Match and back, and Continue as spectator after
elimination. It also checks that every one-by-one turn draws exactly three
campaign samples and that no clock timer runs while a decision is pending.
**Five interrupt-and-resume scenarios** cover a world-scale
national campaign plus basketball nations, football clubs, NBA clubs and an
England domestic campaign, which is played on to its champion after the reload.
They verify that settings, ownership, squads, acquired players, and the remaining
match queue survive a reload and that the campaign remains playable. The app's
files are served from `public/` by path, with a 404 for anything missing. The
domestic runs also check the setup's loading, error and Retry states, and that
the neighbouring-land backdrop stays inert. The domestic resume also refuses a
save naming missing sections and a map that cannot load, resumes from a cold
map cache, and restores a save from an earlier map build. `npm run test:domestic`
kicks off every shipped country with legal duel draws.

The suite asserts that each match eliminates exactly one team, that no territory
is lost or duplicated, and that one player changes shirts per match. It checks
that setup and kickoff open on the Political map, national flag ownership after
switching to Flags, club colours, structured result rewards, the Chronicle,
Ledger and Squad screens opened through the masthead, victory, and absence of
React warnings.

Focused runs skip every other section:

```bash
npm run smoke -- --campaign-only=0   # one of the nine campaigns (index 0–8; 7 and 8 are England)
npm run smoke -- --resume-only=0     # one resume scenario (index 0–4; 4 is England)
npm run smoke -- --manager-only      # the manager campaign
npm run smoke -- --scenarios=england # scenarios whose names match; narrows the picks above
```

`npm test` runs every `scripts/*.test.mjs` file. Besides the engine, model and
UI suites listed under [Running it](#running-it), the v4 redesign added:

| Test file | Covers |
| --- | --- |
| `seed-replay` | Seeded campaigns replay the golden outcomes, final random state and decisions (`scripts/data/seed-replay.golden.json`) |
| `contracts` | Static contracts between App, the `src/app/` method modules and the frozen pure modules |
| `view-router` | Derived views, navigation locks, the primary-action table, Space, auto-switch to Match and back |
| `masthead` | Masthead markup and model, playback variants and the phone chrome |
| `turn-order` | Round-robin queue, "in reach" tiers, fixed-attacker and chosen-target draws |
| `turn-panels`, `turn-wiring` | Turn strip, Choose a target, spectator panel, and the turn flow in the real App |
| `win-probability` | The live win-probability model against the football and basketball match models |
| `save-size` | Save size and storage-quota behaviour for 170-nation campaigns |
| `font-audit` | Only Archivo and Archivo Narrow, no serif, monospace or italics in shipped source |
| `setup-wizard` | Setup steps, rules of war, launch normalisation and Space |
| `campaign-column`, `match-screen`, `squad-screen`, `conquest-screen`, `ledger-chronicle`, `map-v4`, `map-v4-engine` | Each v4 screen's view-models and components |
| `column-wiring`, `match-wiring`, `squad-wiring`, `conquest-wiring`, `ledger-wiring`, `map-wiring` | Each screen wired to the running App |

Domestic campaigns add `domestic-data`, `domestic-geometry`, `domestic-campaign`
and `domestic-routing`, which `npm run test:domestic` also runs on their own.

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
