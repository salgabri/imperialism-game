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
  2026.
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
ShowZone's copies of the same cards (below). Nothing older can be read: ShowZone keeps
no edition before MLB The Show 18, the Wayback Machine holds two pages of the MLB 19
API, and no other dataset of every player's ratings for those years turned up. A fan
project that computes Show-like ratings from real statistics back to 1897 estimates
ratings rather than reading them, so it is not used. The 2020 season was 60 games;
here it is a season like any other.

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

## Known limits

- Nine seasons, 2018 to 2026: ShowZone keeps nothing older. 2018 to 2020 are a fan
  site's copy of Sony's cards, checked against Sony's own pages but not Sony's API,
  read from a data host whose site disallows /api in its robots.txt; MLB The Show 18's
  players field their primary position only, and its birthplaces come from the next
  editions and MLB's records.
- Nations by birthplace, not eligibility; no NPB, KBO or CPBL players.
- The ace starts every game, and a run scores as runs batted in only: no errors, wild
  pitches or unearned runs, no home runs as such.
- The bottom of the ninth still takes its three outs on the clock when it is not
  played, so a game reads "Final" at B9 either way.
