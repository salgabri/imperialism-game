# Baseball

Status: implemented 2026-11-01. A fourth sport beside football, basketball and
American football: the 30 MLB clubs, rated by MLB The Show 26, fight over the USA
and Canada on MLB's own map ([domestic-campaigns.md](domestic-campaigns.md#the-mlb-map)),
and the nations field the MLB players born there. Everything outside the match
(territory, the draw, targeting, conquest, signings, saves) is the game's own,
unchanged; the match clock is the one thing baseball adds, because it counts outs
and shows half-innings rather than minutes.

## Data

**Source.** MLB The Show's public JSON API (`https://mlb26.theshow.com/apis/items.json`,
documented by Sony Interactive Entertainment at `/apis/docs`) lists every card of the
game, 25 to a page. The **Live series** is the current roster of every club, its
ratings moved by each roster update; the other series (legends, awards, event cards)
are left out. `npm run sync:mlb-the-show` (`scripts/sync-mlb-the-show.mjs`) reads the
142 pages 1.5 s apart and caches them in the ignored `data-src/mlb-the-show/mlb26/`.
Nothing here reads a page or runs a script: the API is JSON throughout.

The snapshot `scripts/data/mlb-the-show-26.json` (186 KB, committed) holds roster
update 26 (2 October 2026, retrieved 2026-11-01): 2,084 Live cards of 3,539, each
`[uuid, name, team, position, secondary positions, overall, born]`. `born` is a US
state or a country. Each club has its 40-man roster (1,200 cards); the other 884 are
free agents, as The Show files every player off a 40-man roster, the injured among
them. Sony's rights are not cleared, as for the built-in EA and 2K data.

`--edition=<NN>` reads another edition and `--parallel=<n>` (at most 4) asks for several
pages at once: the older editions' hosts take 15–25 s a page. The earlier seasons
(below) are built from editions 21 to 25, and from ShowZone's copies of 18 to 20.

**Clubs.** `scripts/data/mlb-teams.json` names each club, its scoreboard code, the
place its territory is named after, its ballpark and the point the map places it at
(each ballpark's Wikidata coordinates). Codes are three capitals: MLB's own,
ATH for the Athletics (The Show still files them as OAK), and KCR, SDP, SFG and TBR
for the four with two letters. Chicago and New York have two clubs each, so their
territories are named after their parts of town: the North Side and the South Side,
the Bronx and Queens. The Athletics play at Sutter Health Park in West Sacramento
(2025–2027), the Rays back at Tropicana Field.

`npm run build-mlb` (`scripts/build-mlb.mjs`) writes `src/data/clubs.baseball.js` and
`src/data/rosters.baseball.js`; `--check` rebuilds both byte for byte.

- The Show lists a primary position and the others a player can field. The closer
  (CP) is a reliever (RP). A player's positions are the primary first, then the rest:
  Ohtani is `SP/RF`, Edmundo Sosa `2B/3B/SS/LF`.
- Each club fields the lineup the game itself picks from its 40-man roster
  (`selectLineup`), then the rest of an active roster of 26: a second catcher, three
  more hitters, four more starters and five more relievers (short of one, the other
  kind takes the place). That is 26 players, 13 of them starters.
- Ratings are The Show's overalls, unchanged. A club's strength (`str`) is its lineup
  rating; the 2026 build runs from the Dodgers' 82.6 to the Giants' 71.4.

**Nations.** Every Live card, free agents included, is filed under the nation of its
birthplace: a US state, Washington DC, Guam and the Virgin Islands are the United
States'; Curaçao and Aruba play for the Kingdom of the Netherlands, as in the World
Baseball Classic; Great Britain is the United Kingdom (826), whose home nations
baseball, like basketball, plays as one. Each nation keeps its lineup and up to a
club's depth. 23 nations field players: the United States (88), the Dominican
Republic (85), Venezuela (82), Cuba (79), Canada (74), Puerto Rico (73), Mexico (71)
and Japan (69) can field most or all of a lineup; Korea, Colombia, Panama and the
Netherlands seven to nine of its thirteen places; eleven more one to seven players.

- A lineup place a nation's own players cannot fill naturally (Japan's catcher,
  shortstop and centre fielder, every place but two of Italy's) is the game's to fill: `buildTeam` adds a
  generated player there at the nation's strength, shown dimmed and asterisked, as
  basketball does. The strength counts those places at the baseline (45).
- A nation with no MLB players is a minnow at the baseline, 45, whatever its football
  confederation: baseball is a few nations' sport. Since 2026-11-09 it fields no team, nor
  does a nation whose MLB players hold less than half the lineup (`fieldedNations` in
  `src/engine/footballSets.js`): 12 nations play, and the rest of the land stays neutral.
- This is birthplace, not World Baseball Classic eligibility: Italy and Israel, whose
  classic teams are heritage players born in the USA, are almost empty, and Japan has
  only its MLB players (no NPB). The game's football nations are likewise dated XIs by
  database nationality rather than call-ups.

## The lineup

Thirteen starters: the batting order's nine (C, 1B, 2B, 3B, SS, LF, CF, RF and a
designated hitter, no pitcher at the plate), the day's starter and three relievers.
Strength is the mean effective rating of the thirteen, as in the other sports.

- **Any hitter can be the designated hitter**: the DH place accepts every player who
  fields a position (`canPlay` in `src/data/teams.js`).
- **Out of position costs 20**, not 12 (`outOfPositionPenalty`): The Show already
  lists every position a player can field, so one outside the list is unfamiliar, and
  a starter in the bullpen (or a reliever starting) is out of his role. At 12 the
  Yankees put their second starter in the bullpen.
- **A hitter pitching, or a pitcher in the field or at the plate, costs 40**
  (`CROSSOVER_PENALTY`): an unfilled place counts 40, so a hitter pitches only when he
  is better than nobody.
- The ace starts every match: the game has no fatigue, and every conquest is a
  winner-take-all game.

## The match model

`src/sports/baseball.js`, half-inning by half-inning.

- **Ratings.** Each side's **batting** is the mean of its nine hitters; its
  **pitching** 60% the starter and 40% the bullpen; its **defence** 75% pitching and
  25% fielding (the eight fielders), less 2.3: The Show rates pitchers above hitters
  (the clubs bat 77.0 on average against a defence of 79.3), and an average lineup
  facing an average staff should be an even edge. A side's **edge** is its batting
  minus the opposing defence. Tactics and Upsets act through the same
  effective-strength offset as the other sports.
- **A half-inning** scores with probability `logistic(logit(0.265) + 0.038·edge)`,
  and a scoring half-inning brings one run plus a geometric run of more (ratio 0.46):
  1.85 runs, 0.49 a half-inning between equals, 4.4 a game, as in MLB. The ratio
  fits MLB's scoring innings (54% bring one run, a quarter two, one in nine three)
  and its spread of a side's runs (a 3.1 standard deviation); 0.038 a rating point
  spreads a 162-game season as MLB's did in 2022–2025 (about 106 wins to 56). The old
  0.28, 3/7 and 0.05 gave the best club 112 wins and three games in ten decided by
  a run.
- **Home and away.** The attacker bats first (the top of each inning); the defender,
  holding the territory, is the home side and bats last. The bottom of the ninth is
  not played when the home side leads, and the hit that puts the home side ahead in
  the ninth or later ends the game with every run it drives in (a walk-off home run
  with men on wins by more than one). Batting last is no advantage in the model:
  neither rule changes who wins. With the campaign's Home advantage rule on, the
  side batting last also gains 1.4 rating points of edge in its half-innings and
  the visitors lose as much in theirs, so equal sides win 53% at home, as MLB home
  sides do ([match simulation](match-simulation.md#home-advantage-optional)).
- **Extra innings**, MLB's regular-season rule: each half starts with a runner on
  second, so a run comes with `logistic(logit(0.6) + 0.05·edge)`. After six extra
  innings still level, a decisive run goes to either side with
  `logistic(0.08·(edgeA − edgeD))`, an even coin flip between equals.
- **Form.** One match-day draw, `N(0, drama·0.6)` rating points, raises the
  attacker's edge and lowers the defender's, as American football's does.
- **Events.** Each scoring half-inning is told as runs batted in, one to four at a
  time, each on one of its three outs: "2 RBI — Aaron Judge (NYY)", stamped "T3" (the
  top of the third). The heart of the order drives in most (DH 1.35, 1B 1.3, RF 1.2,
  LF and 3B 1.15, CF 1, SS 0.95, 2B 0.9, C 0.8 by weight, times the rating above 50);
  pitchers never do.

Measured over 20,000 seeded games of the 30 clubs: 4.34 runs a team in nine innings,
9.4% of games to extra innings, 27.5% won by a run, a median margin of 3; the bottom
of the ninth goes unplayed in 41% of games and one in eleven ends on a walk-off. The
strongest club beats the weakest 75% (Predictable) and 74% (Balanced and Wild) of the
time: baseball is the most even of the four sports, as it is in life.

## The clock

The clock counts **outs**: three a half-inning, six an inning, 54 in nine innings,
75 ms each at normal speed (about four seconds a game, as the other sports). The
match shows half-innings, never minutes: "T5 · LIVE" in the score header, the
compact card and the phone bar; T1 to B9 (and T10 on) against each feed row; the win
chart ticks at the end of every inning and counts them (1 to 9). Each sport may now
supply `formatClock`, `formatTick`, `clockLeft` ("4 innings left") and `overtime`
(baseball's "after 11 innings", "F/11"); `src/sports/index.js` reads them
(`clockLabel`, `clockTick`, `overtimeText`, `overtimeShort`, `overtimePeriodsOf`) with
the minute defaults for the other sports. Baseball has no half-time row, and its
overtime row reads "Extra innings". The clock always reaches the end of the last
inning played (`overtimeEnd`): a game the visitors win in the top of the tenth still
plays out its bottom half, as basketball plays out a five-minute overtime after its
last basket. American football's overtime ends at its deciding score instead.

## Live win probability

`src/engine/winProbability.js`, kind `innings`, built from the model's own
distributions rather than a normal curve. Each half-inning's runs follow the model's
distribution for the batting side's edge (`runMasses`); the runs still to come are
the convolution of the half-innings left, the one in progress with its chance to score
scaled by the outs it has left (the one approximation); P(A wins) =
P(final margin ≥ 1) + P(level)·P(A wins the extra innings), whose chain (at most six,
then the decisive run) is exact too. Neither the unplayed bottom of the ninth nor a
walk-off changes who wins, so the full nine are counted. Match-day form is integrated
over its normal spread with seven-point Gauss–Hermite quadrature. At first pitch the
chart is within 0.4 points of the fixture's simulated odds under every Upsets
setting.

## Interface

- **Setup.** A fourth sport card, "Nations · 30 MLB clubs". Clubs have one theatre,
  **MLB · USA and Canada**; nations the usual theatres (North and Central America,
  where the baseball nations are, or the world). The Season list holds the built-in
  2026, then MLB The Show's 2025 to 2018 and the computed 2017 to 1960 (below); a
  season's clubs take the map of their day.
- **Squad.** A diamond: the catcher at home plate, the infield and the starter on the
  mound, the outfield inside the fence, the designated hitter on deck and the bullpen
  beyond the right-field line. Groups read Catcher, Infield, Outfield, Designated
  hitter, Starting pitcher and Bullpen; the profile reads Batting, Pitching and
  Fielding. The lineup is the "Starting lineup" ("Lineup" in short).
- **Match.** First pitch and Final, inning ticks on the chart, a marker per RBI hit,
  scorer lines such as "Judge 3 RBI · Soto 1 RBI", "after 11 innings".
- **Crests and colours.** The 30 crests come from Wikipedia and Commons (18 public
  domain, 12 non-free), matched by English label; five colours are corrected where the
  crest misleads (the Yankees navy, the Phillies red, the Giants orange, the Athletics
  green, the Padres brown).

## Saves

Baseball squads are plain records, as the other sports' clubs are. A save names
`sport: "baseball"` and, for clubs, `clubScope: "domestic:mlb"` with the map's version.

## Tests

`scripts/baseball.test.mjs`: the clubs and nations rebuild byte for byte and match the
snapshot's ratings; every club fields 13 natural starters and 26 players; the
designated hitter, the 20- and 40-point penalties and a two-way player; nations by
birthplace, the Kingdom of the Netherlands and the generated places; 4,000 games with
a winner, a feed that adds up, MLB-like scores, extra innings and one-run games; the
unplayed ninth and the walk-off; odds by Upsets setting; the half-inning odds, the
copy, the clock labels and the tie-break texts; the feed's half-innings and extra
innings; the live chart against the odds, through the ninth and the extra innings;
the map (one territory per club, its ballpark inside, Chicago split, Toronto's
Ontario, campaigns to a champion); setup; the squad screen; and the running App
launching on the MLB map and saving. `npm run smoke` adds an MLB duel campaign with
the live ticker, a baseball nations campaign and an MLB resume.

## Earlier seasons

Eight more seasons ship beside the built-in 2026: 2018 to 2025, each MLB The Show
edition's Live series at its last roster update (1 November 2018, 27 September 2019,
30 October 2020, 5 November 2021, 11 November 2022, 10 November 2023, 8 November 2024
and the 2025 edition's last). 2021 to 2025 are read from each edition's own API host
(mlb21 to mlb25.theshow.com). Sony's mlb18–mlb20 hosts are gone, so 2018 to 2020 are
ShowZone's copies of the same cards (below). No game's ratings of every player can be
read before that: ShowZone keeps no edition before MLB The Show 18, the Wayback Machine
holds two pages of the MLB 19 API, and no other dataset of every player's ratings for
those years turned up. The seasons from 1960 to 2017 are therefore computed from the
players' WAR, by a documented rule and labelled as computed ([below](#seasons-before-2018-computed-from-war)).
A fan project that computes Show-like ratings from real statistics back to 1897 is
not used. The 2020 season was 60 games; here it is a season like any other.

- **Building.** `npm run build:mlb-seasons` (`scripts/build-mlb-seasons.mjs`) builds
  each season from its committed snapshot by the built-in season's rules, now in
  `scripts/lib/mlb.mjs`: `public/baseball/mlb-the-show-<nn>.json` (kind `show`), their
  listing `src/data/baseballSeasons.js` and `docs/design/baseball-seasons-audit.json`.
  `--check` rebuilds every file byte for byte, offline.
- **ShowZone.** showzone.gg, a fan-run card database that is not the publisher, keeps
  the Live series of MLB The Show 18 to 26 at each edition's last roster update and
  serves it from a public data API (data.showzone.gg). Its pages for 18 to 21 were read
  once, on 8 November 2026 (74 pages of 100 cards), cached in the ignored
  `data-src/showzone/` and pinned by SHA-256 in `scripts/data/mlb-seasons.json`
  (`showzone`). showzone.gg's robots.txt disallows /api on its own host; the data host
  serves none. ShowZone states "All Rights Reserved" and publishes no terms: as with
  Sony's own data, the rights are not cleared. `npm run import:mlb-showzone`
  (`scripts/import-mlb-showzone.mjs`) checks the pins and writes
  `scripts/data/mlb-the-show-18.json` to `-20.json` in the Sony snapshots' shape, with
  the source and these checks in each; it never fetches, and `--check` rebuilds the
  three byte for byte.
- **Checks.** ShowZone's MLB The Show 21 must equal Sony's own snapshot card for card
  (all 2,092: uuid, name, team, position, overall and birthplace) or the import stops;
  its team ids take their codes and names from that edition, which the clubs kept from
  2018 to 2021. Against Sony's own pages, ShowZone holds the new rating and the team of
  all 37 changes of MLB 18's last roster update, 142 of 143 of MLB 19's and 113 of 114
  of MLB 20's (the Wayback Machine); every overall of the 60 MLB 18, 10 MLB 19 and 95
  MLB 20 card pages the Wayback Machine and Common Crawl hold agrees, and so do the
  secondary positions and birthplaces of 19 and 20. Two Live cards are missing, and
  so are their players: Giovanny Gallegos (MLB 19) and Paolo Espino (MLB 20).
- **MLB The Show 18** lists no secondary positions (nor do Sony's own MLB 18 card
  pages), so its players field their primary position only; every club still fields
  every place naturally. It names no birthplace either. A card takes one from the
  nearest edition within three that names it (MLB 19 to 21: 1,369 cards, and all 54
  that Sony's own MLB 18 pages name agree), else from MLB's own records:
  `npm run sync:mlb-birthplaces` (`scripts/sync-mlb-birthplaces.mjs`) matches each of
  the other 202 cards to one player of the 2016–2019 seasons in MLB's Stats API
  (statsapi.mlb.com, which serves no robots.txt; one request a season, pinned in the
  manifest's `statsApi`), by name, then surname and a shortened first name ("Matt" for
  Matthew), then surname and club, always in the card's role and with its hands (a
  pitcher's batting hand aside), and writes the answers to
  `scripts/data/mlb-birthplaces.json`. 201 match, the six that Sony's MLB 18 pages
  name among them, and agree; Chris Smith, a free agent two players could be, plays
  for no nation. The audit lists every birthplace found and where.
- **Clubs of their day.** `scripts/data/mlb-seasons.json` names the eras in which a
  franchise played under another name or elsewhere (from the franchise history of
  1980–2020 researched for the maps): the Cleveland Indians (to 2021), the Oakland
  Athletics (to 2024) at the Oakland–Alameda County Coliseum, the RingCentral Coliseum
  (2019) and the Oakland Coliseum (2021–24), the Blue Jays at Sahlen Field in Buffalo
  (2020, Canada closing its border to visiting teams), the Rangers at Globe Life Park
  in Arlington (to 2019), the Rays at George M. Steinbrenner Field in Tampa (2025,
  Tropicana Field being repaired after Hurricane Milton), and the old names of
  SunTrust Park (to 2019), Marlins Park and Miller Park (to 2020), Safeco Field and
  AT&T Park (2018), Guaranteed Rate Field and Minute Maid Park (to 2024). A club of
  another era has its own id (`mlb-cleveland-indians`, `mlb-oakland-athletics`), as
  the NBA's moved franchises do, so it has no crest.
- **Era maps.** `npm run build:mlb-map` also draws `mlb2018`, `mlb2019`, `mlb2020`,
  `mlb2021`, `mlb2022` (2022–24) and `mlb2025` from the manifest; each lists the
  seasons it serves, and a season's clubs play only there. A map serves the seasons
  with the same clubs in the same ballparks under the same names, so 2018, 2019 and
  2020 have one each. Their clubs rank as their franchises rank today, so section ids
  follow one order on every map. Cook County is cut between the Chicago clubs on
  every map. In 2020 the Blue Jays hold their part of New York State, which they
  share with the Yankees and the Mets, and Ontario is nobody's.
- **Nations.** A season keeps both layers, unlike an NBA season: its nations
  replace the built-in ones (a nation it does not list fields no team, nor does one whose players hold less than half the lineup),
  and its clubs the built-in clubs, on its era's map. The loader (`seasonSport` in
  `src/engine/footballSets.js`) binds baseball to both; saves name the set, its
  version and its season ('2024', a calendar year). MLB The Show 19 and 20 name three
  places the later editions do not: Northern Ireland (the United Kingdom, as Great
  Britain is), Lithuania and Saudi Arabia, each one pitcher's.
- **A source error.** MLB The Show 24's API gives the wrong country for players born
  outside the United States (Juan Soto and Ketel Marte "At Sea", Ronald Acuña Jr.
  "Slovenia", Shohei Ohtani "Honduras"); its US states are right. The manifest marks
  that edition (`unreliableBirthplaces`), and the build takes each foreign-born
  player's birthplace from the nearest sound edition within three, earlier first.
  Where that edition has two players of the name born in different places, the one in
  the card's role (pitcher or not) decides, then the one on its club, then the one at
  its position; failing all three, the edition is passed over. The audit lists every
  one, and any player no edition names, who then plays for his club only. The other
  editions agree with 2026 on all but a handful of players.

## Seasons before 2018: computed from WAR

Status: built 2026-11-09. Fifty-eight more seasons, 1960 to 2017 (`mlb-war-<year>`,
listed "Computed from WAR, end of <year>"), whose ratings no game published. Each
player's rating is computed from his WAR and put on MLB The Show's scale, rank for rank
within his role; the clubs, nations and maps are built as the MLB The Show seasons' are.
They are not a game's ratings, and every file says so (`source.computed`, `method`,
`conversion`, `rawScale: "WAR"`).

**Sources.** Pinned in `scripts/data/mlb-war-seasons.json` (`sources`) and cached in the
ignored `data-src/mlb-war/`:

- **WAR**: JEFFBAGWELL, Neil Paine's player-season-stint WAR of every MLB player since
  1901 (github.com/Neil-Paine-1/MLB-WAR-data-historical, `jeffbagwell_war_historical_2025.csv`,
  added in a9087e3, read at commit 1c8c308; git blob 48d384a4, SHA-256 0572a897…). MIT
  licence. Its WAR averages Baseball-Reference's and FanGraphs' (pitching: FIP-based,
  runs-allowed modified for defence, and RA9). Neither site was read for these seasons;
  their terms pages answered HTTP 403 to the research pass and were not read, and no
  Sports Reference or FanGraphs page was fetched. 2025 is in the file only partly (it was
  made in April 2025) and is not used.
- **Lahman Baseball Database 2025** (SABR, CC BY-SA 3.0): People (names, given names,
  birth year and birth country, joined by `bbrefID`), Teams (each club's
  Baseball-Reference code, name and record) and HomeGames (the ballpark each club played
  most of its home games in). Every one of the 10,401 players of 1960 to 2017 is found.
- **English Wikipedia** (CC BY-SA 4.0; facts only): the names of the day and the
  coordinates of the ballparks of 1960 to 1979, from 39 articles' infoboxes, and Elmer
  Valo's birthplace; each article's revision and SHA-256 is pinned. en.wikipedia.org's
  robots.txt allows /wiki/ pages to every agent; one request every 1.5 s, 2026-11-09.
  The research pass had read the same parks' coordinates from Wikidata's query service,
  whose robots.txt disallows /sparql; those answers are not used.
- **MLB The Show 18 to 24** (the earlier seasons' snapshots): the scale only, and the
  calibration. No card is copied into these seasons.

`public/baseball/ATTRIBUTION.txt` credits all three, repeats the MIT notice, credits
Baseball-Reference and FanGraphs as the WAR's origin, and puts the season files and their
snapshots under CC BY-SA 3.0, as Lahman's share-alike licence asks of derived data.

**Building.** `npm run import:mlb-war` (`scripts/import-mlb-war.mjs`) checks every pin,
never fetches, and writes one snapshot a season, `scripts/data/mlb-war-seasons/<year>.json`
(6.6 MB in all, 58,902 player-seasons): every player who played in the season with his
club, role, positions, score, the inputs it was computed from and his birth country, and
each club's name, record and main ballpark. It also writes
`scripts/data/mlb-war-reference.json` (below). `npm run build:mlb-seasons` rates and teams
each season from its snapshot (`public/baseball/mlb-war-<year>.json`, 17–33 KB, 1.8 MB in
all), with the listing, `docs/design/baseball-war-seasons-audit.json` and the attribution;
`npm run build:mlb-map` draws the era maps. All three take `--check` and rebuild byte for
byte offline: the importer from its cache, the seasons from committed files alone, the
maps from the boundary cache (`data-src/boundaries/`).

**The rule** (constants in the manifest's `method`; `scripts/lib/mlb-war.mjs`):

- A player's stints of a season are summed. A stint's WAR is the file's WAR per 162 team
  games times its club's scheduled games over 162, so the strike seasons of 1981, 1994
  and 1995 count their own WAR against their own playing time. His club is that of his
  last stint, as MLB The Show files a player under his club at its last roster update.
- He is a pitcher when his innings × 4.3 exceed his plate appearances (or he pitched in at
  least 80% as many games as he batted in, with fewer than 100 plate appearances). A
  pitcher starts (SP) when his starts are at least 40% of his games over the season and
  the one before, else he relieves (RP): the Show's label for 88% of 2019–24 cards.
- A hitter's position is the fielding position he played most games at in the season
  (the most over three seasons breaking ties), else the one he played most over the
  three, else the designated hitter. He also fields every other position he played at
  least 3 games at over the three seasons (against the Show's lists: precision 0.92,
  recall 0.59). Every club of the 58 seasons fields all nine places naturally.
- Scores, over the season (weight 5) and the two before it (3 and 2), regressed toward a
  level below replacement so that playing time counts:
  - hitters: 600 × (5W + 3W₋₁ + 2W₋₂ − 9) / (5PA + 3PA₋₁ + 2PA₋₂ + 600), 600 plate
    appearances of prior at −0.015 WAR each;
  - starters: 180 × (5W + 3W₋₁ + 2W₋₂ − 4.5) / (5IP + 3IP₋₁ + 2IP₋₂ + 150);
  - relievers: 65 × (W + W₋₁ + W₋₂ − 1.5) / (IP + IP₋₁ + IP₋₂ + 30) + 0.8 × the season's
    average leverage index (weighted by innings).
  The weights and priors were grid-searched on the within-season rank correlation with
  the Show's overalls, 2018–2024 (hitters 0.854, starters 0.853, relievers 0.756; the
  season's raw WAR gives 0.69, 0.70 and 0.46). The snapshot keeps each input rounded
  (WAR to 0.001, innings to 0.001) and the score is computed from those, so it can be
  checked from the snapshot alone; the build checks it.
- **Ratings.** The reference is the Show 18 to 24 overalls of the cards matched to their
  season's WAR (by name, then role, then club: 1,333 / 1,332 / 1,224 / 1,447 / 1,465 /
  1,440 / 1,433, 9,674 in all), grouped by the role the WAR file gives the player,
  strongest first: 4,375 hitters (98 to 47), 1,798 starters (97 to 49) and 3,501 relievers
  (94 to 41), over 210 club-seasons. The k-th best score of a role in a season of T clubs
  takes the reference value at index (k − 0.5) / T × 210 − 0.5, interpolated and rounded;
  deeper ranks take the floor; equal scores share their mean rank. Every era therefore
  has the 2018–24 spread per club, as hockey's rescaled 1990s and rugby league's 2008 do.
  Mapping hitters by position instead did worse (rank correlation 0.836 against 0.846).

**Calibration** (`leaveOneOut` in the reference: each season of 2018–2024 rated against
the other six seasons' reference):

| | MAE | Pearson | Spearman | within 3 |
|---|---|---|---|---|
| hitters (4,375) | 3.62 | 0.80 | 0.845 | 61% |
| starters (1,798) | 4.41 | 0.78 | 0.818 | 52% |
| relievers (3,501) | 5.31 | 0.70 | 0.742 | 44% |
| all (9,674) | 4.38 | | | 53% |

Club strength (each club's lineup by the game's own rule) against the Show-built clubs of
the same seasons: r 0.892, mean error 1.13 points, bias +0.24. Against the real records,
the computed clubs correlate better than the Show's own in five of the seven seasons
(2018 0.89 against 0.87, 2019 0.92/0.89, 2020 0.67/0.70, 2021 0.79/0.82, 2022 0.94/0.91,
2023 0.82/0.82, 2024 0.90/0.88). Out of sample, the computed 2016 against MLB The Show
17's launch top five at every position (GamesRadar, 40 players): r 0.81, mean error 3.9,
the computed 3.8 lower (the list is the Show's own top, which the rank mapping
compresses).

**Spot checks** (`docs/design/baseball-war-seasons-audit.json` has every season):

| season | strongest clubs (record) | best players | club strength vs win% |
|---|---|---|---|
| 1960 | Yankees 82.1 (97–57), White Sox 81.1, Pirates 80.8 | Mays 95, Banks 93, Aaron 92 | 0.80 |
| 1961 | Yankees 82.3 (109–53), Tigers 80.6 (101–61) | Mantle 95, Mays 94, Aaron 92 | 0.93 |
| 1969 | Orioles 83.5 (109–53), Tigers 81.4, Giants 81.3 | Clemente 96, Yastrzemski 94 | 0.92 |
| 1975 | Reds 83.2 (108–54), Athletics 82.3 (98–64) | Morgan 96, Schmidt 94, Carew 93 | 0.87 |
| 1984 | Tigers 81.8 (104–58), Blue Jays 80.5 | Ripken 96, Carter 94, Schmidt 93 | 0.68 |
| 1998 | Yankees 82.5 (114–48), Indians 81.8 | Bonds 96, Griffey Jr. 94, Piazza 94 | 0.85 |
| 2017 | Astros 83.5 (101–61), Dodgers 82.8 (104–58) | Trout 96, Altuve 94, Donaldson 94 | 0.83 |

Over the 58 seasons club strength correlates with the real win share at r 0.82 on
average (0.56 in 1991, whose strongest club on paper, the Reds, went 74–88, to 0.93 in
1961). The best pitchers read as expected: Gibson 93 in 1968, Seaver 94 in 1975, Gooden 94
in 1985, Pedro Martinez 94 in 2001; Hoyt Wilhelm (1961), Gossage (1985) and Rivera (2001)
head their seasons' bullpens.

**Clubs.** Each club fields the lineup the game picks and the rest of an active roster
of 26, as in every baseball season. A club that used fewer than thirteen pitchers all
season (109 of the 1,522 club-seasons, nearly all before 1990; the 1975 Reds used eleven)
keeps every one it used beside its thirteen hitters, so its squad has 23 to 25 players;
nothing is made up to fill it.

**Names.** Lahman's first name and surname, with the WAR file's generational suffix (Ken
Griffey and Ken Griffey Jr., the 1990 Mariners), initials written as the Show writes them
("A.J. Burnett", where Lahman has "A. J."). Namesakes of one season who would share a
squad are told apart: the better keeps the name, the others take a middle initial from
Lahman's given names ("Bob L. Miller"), else a birth year. Only one pair shares a squad in
the 58 seasons: Pedro Martinez of 1968 beside Pedro Martinez of 1971 in the Dominican
Republic's squads of 1993 to 1995 ("Pedro Martinez (1968)"); Lahman gives the elder no
middle name.

**Nations.** By Lahman's birth country, as every baseball season places players by
birthplace (`nations` in the manifest): US states, the Virgin Islands, Guam and American
Samoa are the United States'; Curaçao, Aruba and the Netherlands the Kingdom of the
Netherlands'; England and Scotland the United Kingdom's. Countries of their day are
today's: West Germany (14 players) is Germany, the Soviet Union (Victor Cole, Leningrad)
Russia, South Vietnam (Danny Graves, Saigon) Vietnam, British Honduras (Chito Martinez)
Belize, and Czechoslovakia (Elmer Valo) Slovakia, for his birthplace Rybník in Levice
District (Wikipedia, citing his SABR biography; Lahman's birth state reads "Plzenský").
Hong Kong's Austin Brice is China's, as Lahman files him. The game has no Singapore, so
Robin Jennings plays for his club only, and so does Bob Johnson of 1969–1977
(`johnsbo03`), whom Lahman gives no birthplace. Each nation keeps its lineup and up to a
club's depth; 4 to 10 nations a season field a team by the game's rule (their own players
hold half the lineup): in 1960 the United States, Cuba, Puerto Rico and the Dominican
Republic; Canada, Panama, Venezuela and Mexico in some seasons from 1962, 1967 and 1972;
the Netherlands from 1998, Japan from 2001, Colombia in 2015 and South Korea in 2016;
ten in 2012. The North and Central America theatre is offered in every season.

**Clubs of their day.** `scripts/data/mlb-war-seasons.json` `eras` names each franchise's
clubs of 1960 to 2017 by today's franchise: its Baseball-Reference code (`war`, the code
the WAR file and Lahman use), its own id, name, code and territory where they are not
today's, its ballpark of the day and its point (`home`), and Lahman's key of that
ballpark (`park`). The build checks every season against Lahman: the same clubs under the
same codes and names, each at the ballpark it played most of its home games in (which
places the mid-season moves: the 1966 Cardinals at Busch Memorial Stadium, the 1970 Reds
at Riverfront, the 1970 Pirates still at Forbes Field (42 games to Three Rivers' 40), the
1989 Blue Jays at SkyDome, the 1999 Mariners at Safeco Field). The one name Lahman gives
otherwise is the Angels' of 2016–17, Los Angeles Angels from 2016 (the 1980–2020 eras
research), which Lahman still calls "of Anaheim" (`lahmanName`).

- Clubs of another name have their own ids and no crest: the Milwaukee Braves (1960–65),
  Kansas City Athletics (1960–67), Washington Senators of 1901 (1960, today's Twins) and of
  1961 (1961–71, today's Rangers), Houston Colt .45's (1962–64), California Angels
  (1965–96), Anaheim Angels (1997–2004), Los Angeles Angels of Anaheim (2005–15), Seattle
  Pilots (1969), Montreal Expos (1969–2004), Florida Marlins (1993–2011) and Tampa Bay
  Devil Rays (1998–2007), with the Oakland Athletics and Cleveland Indians of the MLB The
  Show seasons. The Los Angeles Angels of 1961–64 have today's name, id and crest. Codes are
  Baseball-Reference's for clubs of another day (MLN, KCA, WSH and WSA, CAL, ANA, SEP, MON,
  FLA, TBD).
- Clubs number 16 in 1960, 18 in 1961, 20 from 1962, 24 from 1969, 26 from 1977, 28 from
  1993 and 30 from 1998.
- Ballparks are named as they were: Briggs Stadium (1960), White Sox Park (1962–75),
  Busch Stadium (Sportsman's Park, to 1965), Connie Mack Stadium, District of Columbia
  Stadium (1962–68), Atlanta Stadium (1966–75), San Diego Stadium (1969–80), Royals Stadium
  (1973–92) and the names of 1980 onward the eras research gives. Ballparks still in use
  in 1980 keep that research's coordinates; the twelve others take their Wikipedia
  article's (Crosley Field, the Los Angeles Memorial Coliseum, Griffith Stadium, Kansas
  City's Municipal Stadium, Connie Mack Stadium, Forbes Field, Sportsman's Park, Wrigley
  Field in Los Angeles, Colt Stadium, the Polo Grounds, Sick's Stadium, Jarry Park).
- **Two clubs in one city.** In 1961–65 the Dodgers and Angels are "Los Angeles
  (Dodgers)" and "Los Angeles (Angels)", as the NFL names its two Los Angeles clubs, and
  Los Angeles County is cut between them; in 1962–63 the Mets at the Polo Grounds hold
  their part of New York State as "Manhattan", beside the Yankees' Bronx.
- **Shared ballparks.** The Angels played at Dodger Stadium in 1962–65 and the Yankees at
  Shea Stadium in 1974–75: two clubs on one point cannot share out its county. As the
  NFL's clubs that share a stadium grow from their training grounds, each tenant grows
  from its own previous home (`base`): the Angels from Wrigley Field, Los Angeles, the
  Yankees from Yankee Stadium. The map names the ballpark they played at.

**Era maps.** `npm run build:mlb-map` draws 37 maps for the 58 seasons (`maps` in the
manifest), each listing the seasons it serves, built as the other MLB maps are: mlb1960,
mlb1961, mlb1962 (1962–63), mlb1964, mlb1965, mlb1966 (1966–67), mlb1968, mlb1969 to
mlb1973, mlb1974 (1974–75), mlb1976, mlb1977 (1977–81), mlb1982 (1982–88), mlb1989
(1989–90), mlb1991 to mlb1994, mlb1995 (1995–96), mlb1997 to mlb2000, mlb2001 (2001–02),
mlb2003 to mlb2005, mlb2006 (2006–07), mlb2008, mlb2009, mlb2010 (2010–11), mlb2012
(2012–15), mlb2016 and mlb2017. A new map starts when the clubs, a club's id, name or
territory, its tenant base or its ballpark's point changes; a ballpark renamed in place
keeps the map, which names it as its first season did (the map's `arena` is not shown in
play). The map builder now checks every era's seasons, the MLB The Show seasons' too, by
that rule; mlb, mlb2018 to mlb2025 rebuild byte for byte. 2017 has 2018's clubs in
2018's ballparks, yet gets a map of its own, mlb2017, so mlb2018's version (and the saves
that name it) stays as it is. Before 1969 no club is Canadian, and Canada's provinces stay
empty.

**Checks.** `scripts/baseball-war-seasons.test.mjs` (in `npm run test:baseball`): the
importer's rebuild (when the caches are on the computer); every snapshot score from its
inputs; the reference's 9,674 cards and its calibration (mean error at most 4.5, clubs r
at least 0.88); ratings that keep each role's order; the listing, after MLB The Show's,
each season on its map; every season decoding, computed, its clubs its map's, each
fielding all nine places and keeping 26 players or every pitcher it used; the spot checks
above and the record correlation; the nations of 1960 and the countries of their day; the
namesakes; the clubs of their day; the rename rule (37 maps, ballparks named in place,
2017 with 2018's places); every club growing inside its own land, Los Angeles in 1961, the
Polo Grounds and the tenants; the loader's refusals; and the running App launching a 1961
clubs campaign on `mlb1961` and resuming it. `scripts/club-maps.test.mjs` holds the 37
maps to the state rule, as every other.

**Decisions** (the user's, 2026-11-09): seasons back to 1960 and no further; JEFFBAGWELL
WAR with the Lahman database for names and birthplaces, by this rule and mapping (a
Lahman-only metric, nearly as good overall but 5–12 points lower for glove-first players,
stays a documented fallback, not built); a ballpark renamed in place keeps its map, 2017
gets its own; shared ballparks' tenants grow from their own previous home; the full
per-player snapshot is committed. The builder's own (2026-11-09): "Los Angeles (Dodgers)"
and "Los Angeles (Angels)" for 1961–65 and "Manhattan" for the Polo Grounds Mets; the
Senators' ids by founding year (`mlb-washington-senators-1901`, `-1961`); a club short of
thirteen pitchers keeps the ones it used; namesakes in one squad keep the better player's
name; the ballparks' names and coordinates of 1960–79 from Wikipedia rather than the
research pass's Wikidata answers.

## Known limits

- Nine seasons, 2018 to 2026: ShowZone keeps nothing older. 2018 to 2020 are a fan
  site's copy of Sony's cards, checked against Sony's own pages but not Sony's API,
  read from a data host whose site disallows /api in its robots.txt; MLB The Show 18's
  players field their primary position only, and its birthplaces come from the next
  editions and MLB's records.
- 1960 to 2017 are computed, not a game's ratings: about 4.4 points a player from what
  the Show would say (relievers 5.3), the very top compressed (3.8 points under MLB The
  Show 17's launch top fives), and every era given the 2018–24 spread per club by design.
  Swingmen and firemen of the 1960s are sorted into starters and relievers by a modern
  rule. A player's club is his last stint's: a deadline acquisition counts for the club
  that acquired him, a released player stays with the club that released him. Every
  season is played with a designated hitter and rosters of up to 26, which those seasons
  did not have. The WAR averages Baseball-Reference's and FanGraphs', whose terms could
  not be read.
- Nations by birthplace, not eligibility; no NPB, KBO or CPBL players.
- The ace starts every game, and a run scores as runs batted in only: no errors, wild
  pitches or unearned runs, no home runs as such.
- The bottom of the ninth still takes its three outs on the clock when it is not
  played, so a game reads "Final" at B9 either way.
