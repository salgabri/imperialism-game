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
- **Generated players, audited 2026-11-21, unchanged.** Asked whether made-up ratings lift a weak nation toward the
  strong ones, the built-in season and The Show 18–25's were built as a campaign builds them
  (scripts/lib/roster-audit.mjs `loadSeasons`/`seasonTeams`). Generated players hold 12.8% of the fielded nations' lineup
  places: 41 of 95 season-nations (the Netherlands in 9 seasons, Colombia 8, Panama 7, Japan and Canada 6), one to six of
  the 13. Each comes at the nation's stored strength − 3 ± 4, a stored strength that counts his place at 45: 53 to 73,
  always below the nation's own starters, by 11 points at the median (5 to 22). So a nation plays 3.6 points above its
  stored strength at the median (8.2 at most, the Netherlands in 2019), and 19 pairs within 4.1 points of each other turn,
  most often the Netherlands or Japan over Colombia or Panama. In the built-in season Japan's three generated players
  (catcher, shortstop, centre field) take it from 71.7 to 76.2 as played, past Canada (75.2) and Puerto Rico (73.3); Korea
  plays 65.1 (62.1 at 45), Colombia 63.5 (60.5), Panama 62.5 (56.4) and the Netherlands 61.5 (55.9). No confederation
  constant reaches the field (the fallback is the flat 45). Whether a missing place is worth 45, the nation's level less 3,
  or more (Japan's NPB players, whom the game leaves out) would take World Baseball Classic and Premier12 results, which the
  repo does not hold, so the rule stands.

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
  a run. These are the built-in season's odds, 2026's 4.48 runs a game; an earlier
  season scores at its own league's rate ([Rules by era](#rules-by-era)).
- **Home and away.** The attacker bats first (the top of each inning); the defender,
  holding the territory, is the home side and bats last. The bottom of the ninth is
  not played when the home side leads, and the hit that puts the home side ahead in
  the ninth or later ends the game with every run it drives in (a walk-off home run
  with men on wins by more than one). Batting last is no advantage in the model:
  neither rule changes who wins. With the campaign's Home advantage rule on, the
  side batting last also gains 1.4 rating points of edge in its half-innings and
  the visitors lose as much in theirs, so equal sides win 53% at home, as MLB home
  sides do ([match simulation](match-simulation.md#home-advantage-optional)).
- **Extra innings**, MLB's regular-season rule since 2020: each half starts with a
  runner on second, so a run comes with `logistic(logit(0.6) + 0.038·edge)` (61.4%
  of the time from second with nobody out in 2010–15, Tom Tango's tables). After six
  extra innings still level, a decisive run goes to either side with
  `logistic(0.08·(edgeA − edgeD))`, an even coin flip between equals. A season before
  2020 plays its extra innings as the ninth, twelve of them ([Rules by era](#rules-by-era)).
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
setting. A match of an earlier season keeps its own odds in the model it saves
(`score`, `extra` and `more`, and twelve extra innings before 2020), so the chart plays
out that season's scoring and its extra innings; the built-in season's model has
none of them and reads as it always did.

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
`scripts/baseball-eras.test.mjs` holds each earlier season to its own rules
([Rules by era](#rules-by-era)).

## Earlier seasons

Eight more seasons from MLB The Show ship beside the built-in 2026: 2018 to 2025, each
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

Status: built 2026-11-09; its names, birthplaces, records and ballparks re-sourced from
the Baseball Databank on 2026-11-10; each club moved toward its real record on
2026-11-17 (below, "Each club's move toward its record"), and from 1997 with both leagues
on one scale on 2026-11-21 ("One scale for both leagues"). Fifty-eight more seasons, 1960
to 2017 (`mlb-war-<year>`, listed "Computed from WAR, end of <year>"), whose ratings no
game published. Each player's rating is computed from his WAR and put on MLB The Show's
scale, rank for rank within his role; then every player of a club moves by the same
whole number toward the club's real won-lost record. The clubs, nations and maps are
built as the MLB The Show seasons' are. They are not a game's ratings, and every file
says so (`source.computed`, `method`, `conversion`, `rawScale: "WAR"`).

**Sources.** Pinned in `scripts/data/mlb-war-seasons.json` (`sources`) and cached in the
ignored `data-src/mlb-war/`:

- **WAR**: JEFFBAGWELL, Neil Paine's player-season-stint WAR of every MLB player since
  1901 (github.com/Neil-Paine-1/MLB-WAR-data-historical, `jeffbagwell_war_historical_2025.csv`,
  added in a9087e3, read at commit 1c8c308; git blob 48d384a4, SHA-256 0572a897…). MIT
  licence. Its WAR averages Baseball-Reference's and FanGraphs' (pitching: FIP-based,
  runs-allowed modified for defence, and RA9). Neither site was read for these seasons:
  their terms pages answered HTTP 403 to the research pass and were not read, and no
  other Sports Reference or FanGraphs page was requested. 2025 is in the file only partly
  (it was made in April 2025) and is not used.
- **Baseball Databank** (Chadwick Baseball Bureau, CC BY-SA 3.0): People (names, given
  names, birth year and birth country, joined by `bbrefID`), Teams (each club's
  Baseball-Reference code, name and record) and HomeGames (the ballpark each club played
  most of its home games in, from Retrosheet's game logs). The Databank keeps the Lahman
  database's tables and format, generated from the Bureau's own data. The Bureau's
  repository (github.com/chadwickbureau/baseballdatabank) is no longer on GitHub, so
  whether it had later commits cannot be seen; the latest commit any of its 159 surviving
  forks holds, `e9f247e` (Ted Turocy, 6 November 2023; seasons 1871 to 2022), is read from
  raw.githubusercontent.com through a fork whose master is that commit
  (github.com/infonuum/baseballdatabank, forked two days later); each file's git blob is
  checked against that commit's tree (GitHub's API) and its SHA-256 pinned.
  raw.githubusercontent.com and api.github.com serve no robots.txt; github.com's own pages
  were not requested. Retrieved 10 November 2026, one request every 1.5 s, User-Agent
  `imperialism-game-data/1.0`. Every one of the 10,401 players of 1960 to 2017 is found,
  each filed once. The research pass's copy of the Lahman 2025 files, from sabr.box.com,
  was replaced because box.com's robots.txt disallows the download path it came through.
- **English Wikipedia** (CC BY-SA 4.0; facts only): the names of the day and the
  coordinates of the ballparks of 1960 to 1979, from 39 articles' infoboxes, and Elmer
  Valo's birthplace, the one birth country the Databank gets wrong (below); each
  article's revision and SHA-256 is pinned. en.wikipedia.org's
  robots.txt allows /wiki/ pages to every agent; one request every 1.5 s, 2026-11-09.
  The research pass had read the same parks' coordinates from Wikidata's query service,
  whose robots.txt disallows /sparql; those answers are not used.
- **English Wikipedia's "Interleague play"** (CC BY-SA 4.0; facts only): the American
  League's record against the National League in each season's interleague games,
  1997–2017, revision 1381217136, read once on 2026-11-21 and cached in the ignored
  `data-src/mlb-interleague/`; `node scripts/sync-mlb-interleague.mjs` writes
  `scripts/data/mlb-interleague.json` from it (below, "One scale for both leagues").
- **MLB The Show 18 to 24** (the earlier seasons' snapshots): the scale only, and the
  calibration. No card is copied into these seasons.

`public/baseball/ATTRIBUTION.txt` credits all three (and the interleague article), repeats the MIT notice and, in the
Databank README's own words, its CC BY-SA 3.0 statement and Retrosheet's notice (the
importer checks that the README holds both), credits Baseball-Reference and FanGraphs as
the WAR's origin and the Lahman database of 2015 the Databank grew from, and puts the
season files and their snapshots under CC BY-SA 3.0, as the Databank's share-alike licence
asks of derived data.

**Building.** `npm run import:mlb-war` (`scripts/import-mlb-war.mjs`) checks every pin
(each file's SHA-256 and, for the WAR file and the Databank, its git blob in the pinned
commit), never fetches, and writes one snapshot a season,
`scripts/data/mlb-war-seasons/<year>.json` (6.7 MB in all, 58,902 player-seasons): every
player who played in the season with his club, role, positions, score, the inputs it was
computed from and his birth country, and each club's name, record and main ballpark. It
also writes
`scripts/data/mlb-war-reference.json` (below). `npm run build:mlb-seasons` rates and teams
each season from its snapshot and moves each club toward its record
(`public/baseball/mlb-war-<year>.json`, 17–33 KB, 1.6 MB in all), with the listing,
`docs/design/baseball-war-seasons-audit.json` and the attribution; it takes about 17
seconds, most of them the moves' search over lineups. `npm run build:mlb-map` draws the era
maps. All three take `--check` and rebuild byte for byte offline: the importer from its
cache, the seasons from committed files alone (the engine's per-point measure is seeded by
the season), the maps from the boundary cache (`data-src/boundaries/`).

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
- **WAR, not a blend of selection and production.** The computed-ratings method
  (`docs/design/computed-ratings.md`, step 3) values a player by selection (his share of
  his club's playing time) and production (his WAR rate shrunk toward replacement), each
  weighted once against a game where one has rated the sport. Measured as the
  calibration below measures the WAR score, each of 2018–2024 left out in turn (Spearman
  with the Show's overall over the 9,674 cards; `npm run import:mlb-war -- --blend`,
  2026-11-17):

  | | hitters | starters | relievers |
  |---|---|---|---|
  | the WAR score (kept) | 0.845 | 0.818 | 0.742 |
  | selection alone (plate appearances or innings a scheduled game, 3/2/1 window) | 0.764 | 0.634 | 0.632 |
  | production alone (WAR rate, 3/2/1 window, prior from its reliability) | 0.805 | 0.804 | 0.679 |
  | the two, weight tuned on the six seasons left in | 0.837 | 0.808 | 0.706 |
  | the WAR score and selection, weight tuned | 0.845 | 0.818 | 0.742 |

  The tuned blend trails the WAR score by 0.008, 0.010 and 0.036 (it gives selection
  0.375–0.4, 0.125–0.15 and 0.35–0.375 of the weight); added to the WAR score, selection
  is given 0 to 0.025 and changes nothing to the third decimal. The WAR score already
  counts playing time through its prior below replacement, and its reliever's leverage
  term reads the role better than innings do. The seasons keep the WAR score.

**Calibration** (`leaveOneOut` in the reference: each season of 2018–2024 rated against
the other six seasons' reference):

| | MAE | Pearson | Spearman | within 3 |
|---|---|---|---|---|
| hitters (4,375) | 3.62 | 0.80 | 0.845 | 61% |
| starters (1,798) | 4.41 | 0.78 | 0.818 | 52% |
| relievers (3,501) | 5.31 | 0.70 | 0.742 | 44% |
| all (9,674) | 4.38 | | | 53% |

Club strength (each club's lineup by the game's own rule) against the Show-built clubs of
the same seasons: r 0.892, mean error 1.13 points, bias +0.24. Against the real records
(the Databank's, which end with 2022, so 2023 and 2024 have none: `winShare` null), the
computed clubs correlate better than the Show's own in three of the five seasons (2018 0.89
against 0.87, 2019 0.92/0.89, 2020 0.67/0.70, 2021 0.79/0.82, 2022 0.94/0.91). Out of
sample, the computed 2016 against MLB The Show
17's launch top five at every position (GamesRadar, 40 players): r 0.81, mean error 3.9,
the computed 3.8 lower (the list is the Show's own top, which the rank mapping
compresses).

**Each club's move toward its record** (2026-11-17; `docs/design/computed-ratings.md`,
step 5, the user's "full" setting; `resultsMove` and `perPointOfSeason` in
`scripts/lib/mlb-war.mjs`). Rated from its players alone, a club followed its real
record at r 0.82 on average (0.56 in 1991, whose strongest club on paper, the Reds, went
74–88): each player's rating carries its own error, and nothing in it knows how the club
fared. So every completed season (all 58) moves each club toward the strength its record
says it had:

- **The strength moved** is the one the match model plays, `baseballStrength`
  (`src/sports/baseball.js`): the mean of the lineup's batting and its defence (75%
  pitching, of which the day's starter 60%, and 25% fielding), before the season's
  pitching premium. A game's odds follow the gap between two sides' strengths, and a
  point for every player moves it by a point. (The strength the game shows, the
  lineup's mean rating, weighs the starter a third as much and the bullpen more.)
- **Its results** are its won-lost record, the Databank's, as `winShareOf` reads one:
  S = W% − ½, with its reliability r, the share of the records' variance that is not
  luck (binomial luck, p(1 − p) ÷ games): 0.478 (1984) to 0.829 (1962), 0.669 on
  average. Game scores would give the Simple Rating System (`srsOf`), but the only
  source of them, Retrosheet's game logs, is disallowed by retrosheet.org's robots.txt
  ("Rules by era"), and season totals of runs give neither scores nor a record.
- **A club never plays itself**, so in a league of n clubs its share measures its gap to
  the others, which is n ÷ (n − 1) times its gap to the league's mean: S × (n − 1)/n is
  its strength above the mean, as a balanced schedule's SRS reads margins. n is its
  league's clubs that season (8 to 16). Before 1997 the leagues met only in the World
  Series; from 1997 their interleague games put both on one scale (below, "One scale for
  both leagues", 2026-11-21).
- **m**, the win share a point of strength is worth, is measured with the engine under
  the season's own rules (`perPointOf`): two copies of one of the season's clubs, drawn
  at random, every player of one raised and of the other lowered by half a gap of ±2 or
  ±4 points, 40,000 games at each gap at a neutral venue and the game's balanced
  drama, the raised one batting first half the time, seeded by the season so it rebuilds
  byte for byte. m is 0.0234 to 0.0252 (0.0242 on average).
- **The target** is T = μ + √r × S × (n − 1)/n ÷ m, μ the season's mean strength before
  the move (`resultsTargets`); from 1997, μ + √r × S ÷ m with S the club's strength above
  the season's mean on both leagues' scale (`jointShareOf`). The square root of r: the
  engine adds its own luck back.
- **The move** (`clubMoveOf`): every player of the club by one whole number, and the best
  few of the lineup it plays by one more, whichever brings its strength nearest the
  target; then the rest of the club in rating order. Nobody passes a teammate. The best
  few are the lineup's, not the club's, because a point more for a starter on the bench
  would move him into the bullpen out of his position (the 2002 Diamondbacks). Clubs move
  by −5 to +4 points a player (−2 to +2 for 1,383 of the 1,522), 1.13 points of strength
  on average, and land within 0.11 of their targets (0.03 on average). The largest: the
  2004 Diamondbacks (51–111) 77.9 → 72.9, the 2001 Mariners (116–46) 82.2 → 86.9, the
  2012 Orioles (93–69) 78.1 → 82.7, the 2008 Padres (63–99) 79.4 → 74.9, the 1991 Reds
  (74–88) 82.8 → 78.4 and the 2012 Athletics (94–68) 78.6 → 82.9 (until 2026-11-21, when
  both leagues came onto one scale, the 2010 Mariners, 1977 Angels and 1996 Mariners were
  among them and 1,409 clubs moved within two).

Each season's `source.conversion` states the move and its own μ, r and m (from 1997 its
interleague record and edge too), and the audit lists every club's strength before and
after, its target and its move, and each league's mean strength before and after. After
it, the strength the match model plays follows the club's results exactly (Pearson 1.000
every season: its record, from 1997 on both leagues' scale), and the strength the game
shows at r 0.947 on average (0.895 in 1984 to 0.983 in 1962; Spearman 0.94 in the median
season), against 0.817 before. Against the raw record alone, from 1997, the shown strength
follows it at 0.909 on average (0.796 in 2006, when the American League won 154–98 of its
interleague games: a .500 club of the one league was not a .500 club of the other). Played
as their real leagues played (each club against its own league only, as many games as it
played, 40 seasons each; `scripts/baseball-war-seasons.test.mjs`), the 58 seasons'
standings spread as the real ones did: win% SD 0.0696 on average against the real 0.0704,
0.0013 from it on average (0.0063 before the move) and correlated with it at 0.99 across
the seasons (0.71 before). The realism harness plays every club against every other, which
spreads them a little less: 1968, 1987 and 2000 at 0.057, 0.058 and 0.060 against the
real 0.059, 0.059 and 0.061 (`npm run simulation:realism`; 2000 at 0.058 until its leagues
came onto one scale). Player ratings move with
their clubs: Pedro Martinez's 2001, an injured season for a club that went 82–79, falls
from 94 to 91; Mickey Mantle's 1961 rises from 95 to 98. Each season's pitching premium,
recomputed from the moved clubs, rises by 0.02 to 0.23, because the extra point goes first
to the lineup's best, often its ace. The national teams take the moved ratings; one nation
stops fielding a team: Mexico in 1993, whose own players now hold less than half its
lineup.

**One scale for both leagues** (2026-11-21, on the user's request to make sure ratings are
"normalized": a league's best must not be rated like the best of a stronger one just
because its results were read inside its own league; `jointShareOf` in
`scripts/lib/mlb-war.mjs`). The clubs of both leagues meet on every MLB map, but the move
read each club's record inside its own league, every league's share centred on ½: after it
the American League's clubs averaged within 0.04 points of the National League's in
every season before 1997, and from 1997 only by what their interleague games added to
their own records (−0.3 to +0.7 points). Those games say how far apart the leagues were:

| | interleague games (AL record) | the AL's edge in them, in points of strength (± SE) | the ratings' AL lead before → after |
| --- | --- | --- | --- |
| 1997–2003 | 1,696 (833–863) | −0.4 ± 0.5 | −0.1 → −0.3 |
| 2004–2017 | 3,768 (2,057–1,711) | +1.9 ± 0.3 | +0.3 → +1.5 |
| 2006 | 252 (154–98) | +4.6 ± 1.3 | +0.7 → +3.5 |
| 2008 | 252 (149–103) | +3.8 ± 1.3 | +0.6 → +3.1 |

(A point of strength is worth m, about 0.024 of a game's win share, so the 2004–2017
edge is the AL's 54.6% of the games between the leagues.) The WAR itself carries a
league's quality only in part: Baseball-Reference sets each league's replacement level by
era, which the JEFFBAGWELL file shows as a fixed lead in Baseball-Reference's pitching WAR a
club (`br_pwar162`: the National League's by 2.6–3.0 in 1960–65, the American League's by
1.3–1.5 in 1972–79 and 1989–91, 1.9–3.0 in 1992–2012 and 1.4 in 2013–17), averaged there
with FanGraphs', which shows little. Rank-mapped over the whole season, the players carried
it as a lead before the move of up to 1.3 points for the National League (in the 1960s) and up
to 1.4 for the American League (1974–76, 1993–96), which the move then centred away; it
did not follow the interleague games from season to season (1997–2003: +0.2 to +0.8 where
the games say −1.9 to +1.7).

So from 1997 each club's strength is read with both leagues on one scale. English
Wikipedia's "Interleague play" gives the American League's record against the National League
each season (97–117 in 1997 to 160–140 in 2017; below, "The source of the records"), and the
sync and the build check it against the Databank: the
American League's clubs' wins less their losses are exactly those of its interleague games,
since its games inside the league cancel out (all 21 agree). Its edge Δ = W ÷ (W + L) − ½;
each league stands Δ × (the other league's share of the clubs) above or below the
season's mean, and within its league a club stands (W% − ½ − f × Δ) ÷ ((1 − f) × n/(n − 1)
+ f) above its league's mean, f the share of its league's games that were interleague (its
own record holds them too). Before 1997, with f and Δ nought, that is the rule as it was,
and those 37 seasons rebuild byte for byte. The target keeps the season's r, the share of
the records' variance that is not luck (0.67 on average in 1997–2017): the leagues' edge,
read from 214 to 300 games a season, is about as reliable (0.59 over the 21 seasons, its
own error against how far it ranged), so one √r serves both.

- **Held out.** Each season's edge, as the move now carries it, predicts the next season's
  interleague games better than the shipped ratings did: 7.6 nats of log-likelihood over a
  level pair of leagues across 1998–2017, against 4.2 for the ratings before (whose lead was
  what each club's own interleague games gave it) and 5.0 for the raw edge unshrunk. The
  gain is the AL's run of 2005–2017; in 1997–2003 the edge changed sign from season to
  season and carries nothing over. The players who changed league, whom the games do not
  count, agree where it matters: their league-relative hitting (wRC+) and pitching (ERA−)
  before and after the move put the American League 1.8 ± 0.5 points ahead in 2004–12 and
  1.1 ± 0.6 in 2013–17 (the games: 2.1 ± 0.4 and 1.6 ± 0.5).
- **In play.** The clubs played against each other at random across the leagues (20,000
  games a season, neutral venue, Balanced): the AL's clubs win 0.537 of 2004–2017's games
  against the NL's (0.508 before; real 0.546) and 0.490 of 1997–2003's (0.498; real 0.491);
  the rest of the gap is √r's.
- **Clubs.** 2006: the Tigers (95–67) 82.2 → 83.7 and the Mets (97–65) 82.6 → 81.3, the
  Yankees 82.5 → 83.9, the Cardinals (83–78, the World Series' winners) 80.1 → 78.7, the
  Royals (62–100) 76.2 → 77.7 now above the Cubs (66–96) 76.9 → 75.6. 2008: the Rays
  (97–65) 82.7 → 84.1 and the Cubs (97–64) 82.8 → 81.7. 2003, when the National League
  won 137–115: the Braves (101–61) 83.3 → 84.0 and the Yankees (101–61) 83.3 → 82.7.
  Players move with their clubs: in 2006 Albert Pujols and Chase Utley 95 → 94 and Carlos
  Beltran 94 → 92, Travis Hafner, Alex Rodriguez and Carlos Guillen 91 → 93 and Johan
  Santana 94 → 95. The nations take the new ratings; no season's fielded nations change.
- **Before 1997 the leagues stay level.** Nothing in the repo's sources links them soundly:
  one World Series a season and the All-Star games are too few, and the players who changed
  league, the one large link, missed the 1997–2003 games by 2.3 points (they put the AL 1.9
  ± 0.7 ahead where the games say −0.4 ± 0.5). Read the same way, they put the National
  League 2.3 ± 0.9 points ahead in 1960–68 and 2.4 ± 0.7 in 1969–76 and the leagues level in
  1977–92 (−0.1 ± 0.5); Baseball-Reference's replacement levels lean the same way. Decided
  2026-11-21 (the coordinating session, for the user): the leagues stay level before 1997,
  because that one large link, checked on the seasons that can check it, missed them by 2.3
  points, so it is not a sound link.
- **The source of the records.** English Wikipedia's "Interleague play"
  (https://en.wikipedia.org/wiki/Interleague_play), revision 1381217136, read once on
  2026-11-21 through `scripts/lib/polite-fetch.mjs` (en.wikipedia.org's robots.txt allows /wiki/
  pages to every agent, ClaudeBot included) into the ignored `data-src/mlb-interleague/`, and
  pinned by revision and SHA-256 in the manifest (`sources.interleague`). No cache on the
  computer held the season's games one by one (MLB's Stats API cache holds only players, and
  Retrosheet's game logs are disallowed). `node scripts/sync-mlb-interleague.mjs` checks the
  pin and reads the article's table of each season's total games and each league's wins into
  `scripts/data/mlb-interleague.json` (`--check` rebuilds it byte for byte; facts only, CC BY-SA
  4.0, credited in `public/baseball/ATTRIBUTION.txt`). It stops unless each season's two wins
  add up to its games (214 in 1997, 224 in 1998, 251 in 1999 and 2000, 252 to 2012, 300 from
  2013) and its net is the Databank's: all 21 agree, and the build checks the nets again.

**Spot checks** (`docs/design/baseball-war-seasons-audit.json` has every season; strength
is the lineup's mean rating, which the game shows):

| season | strongest clubs (record) | best players | club strength vs win%, before → after |
|---|---|---|---|
| 1960 | Yankees 83.3 (97–57), Pirates 82.1 (95–59), White Sox 81.4 | Mays 95, Aaron 94, Banks 93 | 0.80 → 0.95 |
| 1961 | Yankees 84.4 (109–53), Reds 82.4 (93–61), Tigers 82.2 (101–61) | Mantle 98, Mays 95, Aaron 92 | 0.93 → 0.98 |
| 1969 | Orioles 85.2 (109–53), Twins 81.9 (97–65), Mets 81.5 (100–62) | Clemente 96, Yastrzemski 95 | 0.92 → 0.97 |
| 1975 | Reds 84.6 (108–54), Athletics 82.9 (98–64), Red Sox 81.7 | Morgan 98, Schmidt 96, Bench 93 | 0.87 → 0.96 |
| 1984 | Tigers 83.0 (104–58), Padres 81.8 (92–70), Cubs 81.2 | Ripken 95, Carter 94, Schmidt 92 | 0.68 → 0.90 |
| 1998 | Yankees 85.6 (114–48), Braves 82.3 (106–56), Astros 82.2 | Bonds 98, Piazza 94, Griffey Jr. 92 | 0.85 → 0.97 |
| 2017 | Astros 82.8 (101–61), Indians 82.5 (102–60), Dodgers 81.5 (104–58) | Trout 98, Altuve 94, Donaldson 94 | 0.83 → 0.94 |

The best pitchers read as expected: Gibson 94 in 1968, Seaver 93 in 1975, Gooden 94 in
1985; Hoyt Wilhelm (1961), Gossage (1985, level with Quisenberry) and Rivera (2001) head
their seasons' bullpens.

**Clubs.** Each club fields the lineup the game picks and the rest of an active roster
of 26, as in every baseball season. A club that used fewer than thirteen pitchers all
season (109 of the 1,522 club-seasons, nearly all before 1990; the 1975 Reds used eleven)
keeps every one it used beside its thirteen hitters, so its squad has 23 to 25 players;
nothing is made up to fill it.

**Names.** The Databank's first name and surname, with the WAR file's generational suffix
(Ken Griffey and Ken Griffey Jr., the 1990 Mariners), initials written as the Show writes
them ("A.J. Burnett", where the Databank has "A. J."). The Databank writes names without
diacritics (Tony Pena, Minnie Minoso) and some by the name the player goes by today (Yolmer
Sanchez, the White Sox's Carlos Sanchez of 2014–17). Namesakes of one season who would
share a squad are told apart: the better keeps the name, the others take a middle initial
from the Databank's given names ("Bob L. Miller"), else a birth year. Only one pair shares
a squad in the 58 seasons: Pedro Martinez of 1968 beside Pedro Martinez of 1971 in the
Dominican Republic's squads of 1993 to 1995 ("Pedro Martinez (1968)"); the Databank gives
the elder no middle name.

**Nations.** By the Databank's birth country, as every baseball season places players by
birthplace (`nations` in the manifest): US states, the Virgin Islands (the Databank's
"V.I."), Guam and American Samoa are the United States'; Curacao, Aruba and the
Netherlands the Kingdom of the Netherlands'; the United Kingdom's players (born in England
and Scotland) the United Kingdom's. The Databank names today's countries: Germany for West
Germany, Russia (Victor Cole, Leningrad), Viet Nam (Danny Graves, Saigon), Belize (Chito
Martinez). Rod Carew (Gatun) and Mike Eden (Fort Clayton), born in the Panama Canal Zone,
are Panama's, as the Databank files them. The Databank files Elmer Valo under the Czech
Republic, his birth state reading "Plzensky"; he was born in Rybník in Levice District,
Slovakia (Wikipedia, citing his SABR biography), and the manifest's `birthCountries`
gives him Slovakia: the one correction, which the importer applies only while the
Databank still reads "Czech Republic". Hong Kong's Austin Brice is China's, as MLB The
Show files him (the game has no Hong Kong). The game has no Singapore, so Robin Jennings
plays for his club only; every other player of the 58 seasons has a nation. Each nation
keeps its lineup and up to a club's depth; 4 to 10 nations a season field a team by the
game's rule (their own players hold half the lineup): in 1960 the United States, Cuba,
Puerto Rico and the Dominican Republic; Canada, Panama, Venezuela and Mexico in some
seasons from 1962, 1967 and 1972; the Netherlands from 1998, Japan from 2001, Colombia in
2015 and South Korea in 2016; ten in 2012. The North and Central America theatre, which
needs four of its nations' real sides, is offered in every season but 1985–87 and
1989–90: then only the United States, the Dominican Republic and Puerto Rico field one
(Venezuela, the fourth, is South America's), and those seasons' nations play the world.

**Clubs of their day.** `scripts/data/mlb-war-seasons.json` `eras` names each franchise's
clubs of 1960 to 2017 by today's franchise: its Baseball-Reference code (`war`, the code
the WAR file and the Databank use), its own id, name, code and territory where they are not
today's, its ballpark of the day and its point (`home`), and the Databank's key of that
ballpark (`park`, Retrosheet's park code). The build checks every season against the
Databank: the same clubs under the same codes and names, each at the ballpark it played
most of its home games in (which places the mid-season moves: the 1966 Cardinals at Busch
Memorial Stadium, the 1970 Reds at Riverfront, the 1970 Pirates still at Forbes Field (42
games to Three Rivers' 40), the 1989 Blue Jays at SkyDome, the 1999 Mariners at Safeco
Field); the importer stops on a club that played as many home games at two ballparks. The
one name the Databank gives otherwise is the Angels' of 2016–17, Los Angeles Angels from
2016 (the 1980–2020 eras research), which the Databank still calls "of Anaheim"
(`databankName`).

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
at least 0.88; records to 2022); ratings that keep each role's order; the listing, after
MLB The Show's, each season on its map; every season decoding, computed, its clubs its
map's, each fielding all nine places and keeping 26 players or every pitcher it used; the
spot checks above and the record correlation (at least 0.92 on average and 0.85 in every
season; from 1997 against the records on both leagues' scale); each club's move (one whole
number a player and one more for the lineup's best few, nobody passing a teammate, its
constants in the conversion) and the target's formula on a made-up season of two leagues;
the joint scale on made-up leagues (each club's strength, its league's edge, a .500 club of
the stronger league above one of the weaker, a record that does not add up refused); the
interleague records rebuilt byte for byte from the pinned page (when it is on the computer),
their pin the manifest's, their nets the Databank's, and the American League's lead after
the move √r × Δ ÷ m from 1997 and nought before; the standings played by the real leagues
(within 0.003 of the real spreads on average, r above 0.95); the nations of 1960, the Databank's birth
countries, Elmer Valo's correction and Rod Carew's Panama; the namesakes; the clubs of
their day; the rename rule (37 maps, ballparks named in place,
2017 with 2018's places); every club growing inside its own land, Los Angeles in 1961, the
Polo Grounds and the tenants; the loader's refusals; and the running App launching a 1961
clubs campaign on `mlb1961` and resuming it. `scripts/club-maps.test.mjs` holds the 37
maps to the state rule, as every other.

**Decisions** (2026-11-09). The user's: seasons back to 1960 and no further. Claude's, as
coordinator, under the user's request to cover every missing season, approved by the user with
the release of 2026-11-10: JEFFBAGWELL WAR with the Lahman database for names and birthplaces, by this
rule and mapping (a Lahman-only metric, nearly as good overall but 5–12 points lower for
glove-first players, stays a documented fallback, not built); a ballpark renamed in place
keeps its map, 2017 gets its own; shared ballparks' tenants grow from their own previous
home; the full per-player snapshot is committed. The WAR averages Baseball-Reference's and
FanGraphs', whose terms could not be read, a caveat the user accepted with the release of 2026-11-10. The builder's
own (2026-11-09): "Los Angeles (Dodgers)" and "Los Angeles (Angels)" for 1961–65 and
"Manhattan" for the Polo Grounds Mets; the Senators' ids by founding year
(`mlb-washington-senators-1901`, `-1961`); a club short of thirteen pitchers keeps the ones
it used; namesakes in one squad keep the better player's name; the ballparks' names and
coordinates of 1960–79 from Wikipedia rather than the research pass's Wikidata answers. The
re-sourcing's (2026-11-10): the Lahman tables from the Chadwick Bureau's Baseball Databank,
the first choice asked for, read at the latest commit its forks hold, through one of them;
its names and birth countries as it gives them (the Peñas become Pena, Rod Carew and Mike
Eden Panama's), Elmer Valo's alone corrected; the calibration's record check limited to the
Databank's seasons (2018–2022) rather than a second source for 2023–24.

**Decisions** (2026-11-17). The user's (`docs/design/computed-ratings.md`, "Decisions"):
the full move toward each club's results in every completed computed season, and the
seasons already shipped re-rated by it. Claude's, building it: the WAR score kept, since
no blend of selection and production beat it with each calibration season left out; the
won-lost record as the results (`winShareOf`), because game scores, which the Simple
Rating System needs, would come only from Retrosheet's game logs, which its robots.txt
disallows, and the Databank's season totals of runs scored and allowed are neither scores
nor a record (run differential a game would order 304 of the 1,522 clubs more than a point
from where the record puts them; its targets correlate with the record's at 0.935 on
average); each club's share read against its league less itself, (n − 1)/n, which played
by the real leagues gives the real standings' spread; the strength moved the match
model's (`baseballStrength`), not the lineup's shown mean; m measured each season under
its own rules, 40,000 games a gap; the extra point for the best of the lineup first, so the
move never puts a starting pitcher in the bullpen; one rating a player, so the national
teams take the moved ratings.

**Decisions** (2026-11-21). The user's: ratings "correct and normalized", a league's best
not rated like the best of a stronger one for being read inside its own league. Claude's,
building it: from 1997 one scale for both leagues, set by each season's own interleague
record (not a window of seasons: the move reads the season's results), shrunk by the
season's √r like every club's record; the interleague records read from English Wikipedia's
"Interleague play" at one pinned revision, no cache holding the games themselves, and
checked against the Databank's league totals; the WAR's own league adjustment neither used
nor undone (the move centres it away). The coordinating session's, for the user, on
2026-11-21: before 1997 the leagues stay level, the players who changed league having missed
the interleague games of 1997–2003, the seasons that can check them, by 2.3 points.

## Rules by era

Status: built 2026-11-10. Every earlier season plays its own day's baseball: its
league's runs a game, its extra innings and its ratings' own balance. The built-in
2026 season plays today's rules exactly as before (simulation version 2, its seeds'
results unchanged); the earlier seasons are version 3. `matchSport` asks baseball for
a season's rules (`rulesFor`, `baseballIn` in `src/sports/baseball.js`): one sport
object a season, its rules carried on each prepared match (`prepared.rules`), so the
score-only draw, the full game, the odds and the live chart all read them.

| Seasons | Extra innings in MLB's regular season | In the game | Designated hitter in MLB |
| --- | --- | --- | --- |
| 1960–1972 | as the ninth | as the ninth; twelve, then the decisive run | none |
| 1973–2019 | as the ninth | as the ninth; twelve, then the decisive run | the American League (interleague games from 1997: the home club's league) |
| 2020 | a runner on second | the runner; six, then the decisive run | both leagues |
| 2021 | a runner on second | the runner; six, then the decisive run | the American League |
| 2022–2026 | a runner on second (permanent from 2023) | the runner; six, then the decisive run | both leagues |

Never in the postseason: the runner is the regular season's rule, which every
campaign match plays. The game fields a designated hitter in every season (below).

**The run level.** `src/data/mlbLeagueAverages.js` holds each regular season's games,
runs, outs and shutouts, summed over its clubs. 1960 to 2022 are the Baseball
Databank's Teams.csv (G, R, IPouts and SHO of every American and National League club,
the commit the WAR seasons pin); `npm run import:mlb-war` sums them again and stops on
any figure the module gives otherwise. 2023 to 2026 are MLB's own Stats API
(`https://statsapi.mlb.com/api/v1/teams/stats?season=<year>&sportIds=1&group=hitting&stats=season&gameType=R`,
group `pitching` for outs and shutouts; statsapi.mlb.com serves no robots.txt), read
2026-11-10 by `node scripts/sync-mlb-league-runs.mjs` into
`scripts/data/mlb-league-runs.json`, club by club. The API gives the same games and
runs as the Databank in all twelve seasons the file holds of both (1960, 1968, 1981,
1987, 1994, 2000, 2010, 2018–2022); its shutouts and outs differ only in 2020's
shutouts (100 against 99) and the outs of 1960 and 1968 (13 and 21 more). Retrosheet's
game logs were not used: retrosheet.org's robots.txt disallows `/gamelogs/`. 2026's
season is complete (its last games were played in September), so it is the latest full
season, the built-in season's own.

A season's half-innings score so that a game between equal sides brings its runs a
game in the proportion the real ones bear to 2026's 4.48: `gameRuns` works out a
game's runs exactly as the model plays it (the unplayed bottom of the ninth, walk-offs,
the season's extra innings and the decisive run) and `eraRules` finds the scoring rate
that gives it. Three quarters of a season's change in rate goes into how often a
half-inning scores, a quarter into how many a scoring one brings: across Tom Tango's
four eras of 1950–2015 (run expectancy from the start of an inning and the chance of a
run in it, from Retrosheet's data: [re24](http://www.tangotiger.net/re24.html), read
2026-11-10; 0.476 to 0.547 runs an inning, a run in 26.3% to 29.4% of them) the chance
moves with the runs at a slope of 0.75, log against log, and the Databank's shutouts by
season agree best at 0.75 (of 0.5, 0.75 and 1). With the runner on second, an extra
half-inning's chance moves by as much in logit.

**Each season's pitching premium.** MLB The Show rates its hitters against its
pitchers differently each year, and the computed seasons inherit 2018–24's balance, so
the 2.3 premium that makes the built-in clubs' average matchup an even edge would give
2025's hitters 1.4 rating points too much. Each season takes its own,
`seasonPremium` of its clubs (their defence's mean rating above their batting's):
0.93 for MLB The Show 25, 1.53 for 19, 2.68 for 22, 1.89 to 2.86 for the computed
seasons (1.72 to 2.71 before each club's move toward its record of 2026-11-17, which
gives its extra point to the lineup's best first, often the ace; 1.86 to 2.88 until both
leagues came onto one scale on 2026-11-21). `npm run build:mlb-seasons` writes them to `src/data/baseballSeasonPremiums.js`
(and `--check` holds them), and a season's nations play its clubs' premium.

| Season | Runs a game | Runs a nine innings | Shut out | A half-inning scores | Runs a scoring one | Premium | The game: runs, shut out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1960 | 4.31 | 4.32 | 6.4% | 25.9% | 1.84 | 2.10 | 4.35, 7.0% |
| 1963 | 3.95 | 3.95 | 8.5% | 24.2% | 1.80 | 2.41 | 3.96, 8.3% |
| 1968 | 3.42 | 3.42 | 10.4% | 21.6% | 1.73 | 2.57 | 3.45, 10.8% |
| 1972 | 3.69 | 3.69 | 9.6% | 22.9% | 1.76 | 2.79 | 3.71, 9.3% |
| 1977 | 4.47 | 4.48 | 5.7% | 26.7% | 1.86 | 2.54 | 4.49, 6.3% |
| 1987 | 4.72 | 4.76 | 5.0% | 27.8% | 1.88 | 2.35 | 4.72, 5.6% |
| 1994 | 4.92 | 4.96 | 4.5% | 28.7% | 1.90 | 2.42 | 4.91, 4.9% |
| 2000 | 5.14 | 5.20 | 4.2% | 29.7% | 1.92 | 2.47 | 5.13, 4.5% |
| 2010 | 4.38 | 4.43 | 6.8% | 26.3% | 1.85 | 2.52 | 4.38, 6.7% |
| 2014 | 4.07 | 4.08 | 7.3% | 24.8% | 1.81 | 2.39 | 4.06, 7.6% |
| 2019 | 4.83 | 4.86 | 5.5% | 28.3% | 1.89 | 1.53 | 4.81, 5.5% |
| 2020 | 4.65 | 4.85 | 5.5% | 27.3% | 1.87 | 2.28 | 4.64, 6.2% |
| 2021 | 4.53 | 4.65 | 6.2% | 26.7% | 1.86 | 0.89 | 4.50, 6.5% |
| 2025 | 4.45 | 4.52 | 6.8% | 26.3% | 1.85 | 0.93 | 4.49, 6.8% |
| 2026, built in | 4.48 | 4.55 | 6.2% | 26.5% | 1.85 | 2.3 | 4.50, 6.6% |

The real columns are the module's (shut out: the share of a side's games it scored no
runs in); "the game" plays every pairing of the season's clubs twelve times under its
rules (the computed seasons' rows drawn again after their clubs' move, 2026-11-17; the
premiums of 1997–2017 recomputed when their leagues came onto one scale, 2026-11-21, which
moves their game by at most 0.05 runs and 0.4 points of shutouts, within the draw's own
noise). Over
all 67 seasons the game's runs a game sit within 0.9% of the league's (0.2% over on
average) and its shutouts 0.4 points above the league's on average (at most 1.4 points,
1982). 2020 and 2021 scheduled seven-inning doubleheaders
([Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1370243501), read 2026-11-10),
which the game does not play, so their runs a game sit 2–4% under their runs a nine
innings; the game plays their games at their runs a game.

**Extra innings.** MLB put a runner on second at the start of each extra half-inning
in the 2020 regular season, extended it through 2021 and 2022 and made it permanent
from 2023; postseason games never use it ([Wikipedia, "Extra innings"](https://en.wikipedia.org/w/index.php?oldid=1380896790),
read 2026-11-10). Before 2020 an extra inning plays as the ninth, at the season's own
odds, and between average sides 52–63% of them end level: 45% of the game's 2019
extra-inning games end in the tenth, as 43.9% of 2019's did, and 72% with the runner,
as 69.1% of 2020's did (the same article, citing The Boston Globe of 18 July 2023).
Six extra innings, which with the runner leave 0.06% of extra-inning games to the
decisive run, would leave 2–6% of them to it before 2020, so those seasons play twelve
(21 innings; the era's longest games went 24 and 25, the same article): 0.04–0.4% then
end on the decisive run, and about one game in 140 of 1968 runs past fifteen innings.
The live chart's extra innings follow the season's rule and its cap.

**The designated hitter is not played by era.** MLB had none before 1973; the American
League has used it since 1973, the National League in 2020 and since 2022; interleague
games from 1997 to 2021 took the home club's league's rule, and the World Series had
none in 1973–75, used it in every game of the even years 1976–85 and in the American
League's park from 1986 ([Wikipedia, "Designated hitter"](https://en.wikipedia.org/w/index.php?oldid=1382529081),
read 2026-11-10). Every season here still bats a designated hitter, because playing the
rule properly would take:

- **Lineups by rule, not by sport.** `selectLineup` (`src/data/teams.js`) picks every
  lineup from one plan a sport (`LINEUP_PLANS.baseball`, with its DH) and is called with
  the team alone from about fifteen places: the strength shown and fought with
  (`teamEff`), conquest gains, tactics, odds, the squad screen, the match's lineups, the
  ledger. A pitcher batting ninth needs a plan per team (1960–72) or per match (from
  1973, by the home club's league) threaded through all of them, and the strength each
  works out must be the match's, or `prepareMatch`'s tactics offset (the strength given
  less the lineup's own rating) cancels the difference.
- **Each club's league by season.** The season files call every club's league "MLB".
  The WAR snapshots hold each club's AL or NL from the Databank (1960–2017); 2018–25
  would need MLB's Stats API. Only the Brewers (to the National League in 1998) and the
  Astros (to the American League in 2013) changed league in 1960–2026.
- **A batting rating for pitchers.** No source rates them as hitters, and the game's own
  rule for a pitcher at the plate (40 points off his rating) would make an ace a better
  hitter.
- **A rule for nations from 1973 to 2021**, which had no league: no source gives one
  (the World Baseball Classic began in 2006).
- **Strength, nations and saves.** A season's club strengths are its thirteen-place
  lineups with a designated hitter; a twelve-place lineup changes every club's strength
  and perhaps which nations field a team (half the places, `fieldsRealSide`), and a
  saved campaign's teams would change strength when resumed.

Doing 1960–72 alone, where no league is needed, would leave the National League's clubs
a designated hitter for 47 seasons. The run level is right either way: each season
scores at its league's real rate, the pitchers' batting included.

**Decisions** (2026-11-10, the builder's, under the user's request for each era's rules
and realistic results, not yet confirmed by the user): the run level matches runs a
game, not runs a nine innings (whose 2020 and 2021 would run 2–4% above their games);
the split of three quarters in how often an inning scores; twelve extra innings before
2020; each season's own pitching premium; MLB's Stats API for 2023–2026, as the
birthplaces already use it; the designated hitter left as it is.

**Checks.** `scripts/baseball-eras.test.mjs` (in `npm run test:baseball`): the league
totals from 1960, the API's sums against the module and the Databank; the built-in
season's rules untouched and each earlier season's its own, one object a season, which
differs from today's only in its model; the extra innings by season; each premium its
clubs' own and every season's average matchup an even edge; every one of the 67
seasons within 3.5% of its league's runs a game (within 1% on average) and 2.2 points
of its shutouts; 2019's extra-inning games ending in the tenth as 2019's did, 2020's as
2020's; a game of 1968 to the twenty-first inning; and the live chart at the fixture
odds, its extra innings exact for the season's rule. `npm run simulation:realism` plays
1968, 1987, 2000 and 2019 as whole 162-game seasons beside the built-in clubs
([match simulation](match-simulation.md#realism-against-real-leagues)), and the 1961
clubs campaign in `scripts/baseball-war-seasons.test.mjs` checks the App plays 1961's
rules and resumes with them.

## Known limits

- MLB The Show's nine seasons, 2018 to 2026: ShowZone keeps nothing older, so 1960 to
  2017 are computed (below). 2018 to 2020 are a fan
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
  did not have ([Rules by era](#rules-by-era) says what the designated hitter would
  take); each scores at its league's runs a game all the same. The WAR averages
  Baseball-Reference's and FanGraphs', whose terms could not be read.
- Before 1997 the two leagues stand level, each club placed by its record inside its own
  league: nothing linked them but the World Series and the All-Star games, and the players
  who changed league, the one large link, missed the interleague games of 1997–2003 by 2.3
  points, so it is no sound link. Read that way they would put the National League about
  2.3 points ahead in 1960–76 ([One scale for both leagues](#seasons-before-2018-computed-from-war)).
  From 1997 each season's interleague record sets the gap, its own games only, so a season
  whose games ran against the trend (2003's, the National League ahead by 1.5) carries it.
- Names and birthplaces of 1960 to 2017 are the Baseball Databank's of November 2023, a
  resource its own README calls legacy, its legacy parts unmaintained: names without
  diacritics, and whatever it has not corrected since. Its seasons end with 2022, so the
  calibration checks no records of 2023 or 2024.
- Nations by birthplace, not eligibility; no NPB, KBO or CPBL players.
- The ace starts every game, and a run scores as runs batted in only: no errors, wild
  pitches or unearned runs, no home runs as such.
- The bottom of the ninth still takes its three outs on the clock when it is not
  played, so a game reads "Final" at B9 either way.
- Each season scores at its league's rate, but its clubs keep 2018–24's spread of
  ratings (the computed seasons) or The Show's: 1968's, 1987's and 2000's standings
  spread as the real ones did (a winning percentage's standard deviation 0.058–0.064
  against 0.059–0.061), 2019's narrower (0.083 against 0.096). Nothing models a
  season's own style beyond its runs: stolen bases, home runs, complete games.
