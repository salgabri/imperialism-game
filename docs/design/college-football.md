# College football

Status: implemented 2026-11-15 (simulation version 1). The twelfth sport: the 138 schools of the 2026 Football Bowl
Subdivision, rated by EA SPORTS College Football 27, fight over the USA, each from its own stadium, so a campaign can be a
"138 team CFB 27 imperialism". It plays American football's drive model ([american-football.md](american-football.md))
under college rules, with its schools only (`clubsOnly`), on its own map. Everything outside the match (territory, the
draw, targeting, conquest, signings, saves) is the game's own, unchanged.

## Data

**Source.** EA SPORTS' College Football ratings site (`https://www.ea.com/games/ea-sports-college-football/ratings`) is
the one Madden NFL's ratings come from: it lists every player of the current edition, 100 to a page, with his school,
conference, position and overall, embedded in each page as JSON (`__NEXT_DATA__`). `npm run sync:college-football`
(`scripts/sync-college-football.mjs`) reads that JSON as data through `scripts/lib/polite-fetch.mjs` (EA's robots.txt
allows the pages), 1.5 s apart, and never runs the page's scripts. Re-checked on 2026-11-15 before syncing: the site
served College Football 27 (`college-football-27`) with eleven updates, Launch Ratings to Week 10 Ratings.

The snapshot `scripts/data/college-football-27.json` (590 KB, committed) holds one update: **Week 10 Ratings**
(`cfb-ratings-week-10`, retrieved 2026-11-15), 10,935 players of 138 schools (60 to 85 each), each `[EA id, name, team
id, position, overall, jersey, school year]`, and each conference's schools as the site's filter groups them: ACC 17, Big
12 16, Big Ten 18, Conference USA 10, Independent 2 (Notre Dame, Connecticut), MAC 13, Mountain West 10, Pac-12 8, SEC
16, Sun Belt 14 and The American 14. The pages are cached in the ignored `data-src/college-football/<update>/`. EA's own
rights are not cleared, as for the built-in Madden NFL 27 and EA FC 27 data.

**Schools.** `scripts/data/cfb-teams.json` names each school (EA's own label: "Cal", "Miami (Ohio)", "UL Monroe"), gives
its scoreboard code (three capitals, chosen here, as EA's site gives none: ALA, OSU, MOH …), its conference, the place
its territory is named after, its stadium and the point the map grows it from. Stadiums come from English Wikipedia's
"List of NCAA Division I FBS football stadiums" (retrieved 2026-11-15, CC BY-SA 4.0; all 138 rows match EA's 138
schools, Sacramento State and North Dakota State, new in 2026, included), each point from its stadium's article. A
territory is named after the college town (Tuscaloosa, Ann Arbor, State College for Penn State's University Park, South
Bend for Notre Dame, Starkville, Oxford); four towns that two schools share add the state's postal code (Athens, GA and
OH; Oxford, MS and OH; Columbia, MO and SC; Bowling Green, OH and KY), and the two cities with two schools name the side
each holds (North and South Atlanta for Georgia Tech and Georgia State, East and West Houston for Houston and Rice).

**The schools' squads.** `npm run build-college-football` (`scripts/build-college-football.mjs`) writes
`src/data/clubs.college-football.js` by the NFL's squad rules (`scripts/lib/nfl.mjs`): EA's positions grouped into the
game's ten (LT, LG, C, RG and RT are OL; LE, RE and DT are DL; LOLB, MLB and ROLB are LB; FS and SS are S; the fullback
RB), punters left out, the lineup the game picks from the whole roster (QB, RB, three WR, TE, five OL; four DL, two LB,
three CB, two S; the kicker), then the best backups: 34 players, 23 of them starters. Ratings are EA's overalls,
unchanged; a school's `league` is its conference. EA lists Air Force with no kicker in the week 10 update: it kicks with
its punter, Will Duncan (73). Western Michigan's roster has three cornerbacks, so its squad has 33. The schools rate from
Indiana's 87.4 to UTEP's 74.0. `--check` rebuilds the file byte for byte. Out of position costs 25 points, as in the
NFL (`outOfPositionPenalty`).

## The match model

`src/sports/collegeFootball.js` plays `src/sports/americanFootball.js`'s possessions, form, late-game play-calling and
tries under its own rulebook (`COLLEGE_RULES`); the NFL's rules and seasons are unchanged (every field the rulebook adds
is optional, and the NFL's results are the same draw for draw).

**Sources.** cfbstats.com's national team tables (its robots.txt allows them; ncaa.com's refuses Anthropic's agents),
games between FBS schools only, 2024 and 2025 together (3,212 team-games): 26.5 points a team a game, 3.27 touchdowns,
1.59 field-goal tries made 76.1% of the time, extra points 98.3% (the college kick is from the 3), two-point tries after
about 8.3% of touchdowns (touchdowns less extra-point tries), made 46.1%, 0.030 safeties. Drives that ended in a
touchdown, a field-goal try, a punt or a giveaway were 10.35 a team a game; with about two more ended on downs or by a
half's end, the model plays **12.3 possessions** a side (± 1.1, 9 to 16), against the NFL's 11.

**Fitted.** Whole conference seasons, every pair of conference mates played many times on neutral ground:

- `td` 0.2616 and `fgTry` 0.1748, a drive's touchdown and field-goal try at the 138 schools' average matchup (their mean
  offence less mean defence, `edge` 0.51) and average kicker (`kicker` 76), so seasons score 3.27 touchdowns and 1.21
  field goals made a team a game, as the FBS did; 26.8 points with overtime's;
- `early` 0.076, the share of early touchdowns that go for two, with the NFL's late-game chart, so 8.3% of touchdowns do;
- `scale` 1.57: each rating point of edge moves a drive's touchdown, field-goal and two-point odds 1.57 times as far as in
  the NFL. EA rates the schools about as close together as Madden rates the NFL's franchises (offence SD 3.8, defence
  3.6), though FBS schools differ far more than NFL franchises do; with it, conference seasons spread the schools'
  average margins with an SD of 10.5 points (8.0 true, plus the luck of 8.5 games), as the FBS's did (10.3 in 2024, 10.7
  in 2025).

A conference game's margin then spreads with an SD of about 20 points, 4.9% of conference games go to overtime, and the
best school beats the weakest more than 95% of the time.

**Home advantage** (off by default) gives the home side 0.7 rating points of edge each way: equal sides' home side wins by
about 2.5 points, 56% of the time, the home edge usually quoted for college football (not fitted here: cfbstats' home
splits mix in FCS visitors).

## College overtime

The NCAA's rules since 2021 (`overtime` 'college'), after a level regulation:

- A coin toss; its loser has the ball first in the first period (the winner defends, as nearly every team chooses), and
  the first possession alternates from period to period.
- **First and second periods:** a possession each from the opponent's 25. The first side plays it out: after a touchdown
  it kicks in the first period and must go for two in the second. The second side plays to that score: level, it plays
  for the field goal that wins (late-game play-calling, level); a field goal down, it plays the possession out (a touchdown
  wins, a field goal draws level); a touchdown down, it goes for it on fourth down and never settles for a field goal; its
  touchdown that levels a 7 is kicked (first period) or goes for two (second), and one that wins has no try.
- **From the third period:** two-point plays, one each; a period in which one side scores and the other does not decides
  the game. Each made play is 2 points and an event of its own (`kind` 'two'), credited to a back, receiver, tight end or
  the quarterback: "2PT — Jeremiah Smith (OSU)", "TWO-POINT CONVERSION" in the toast, "3OT" in the feed.
- No safeties and no defensive scores in overtime. After `maxOvertimes` (8) level periods, a last two-point play goes to
  either side with `logistic(0.08 · scale · (edgeA − edgeD))`, so a match always has a winner (about one conference
  overtime in 600 reaches the eighth period; the record under these rules is nine, Illinois–Penn State in 2021).

A possession from the 25 ends in a touchdown half the time between equals (`otTd` 0.5), else in a field-goal try three
times in four (`otFgTry`), made seven times in ten from about 42 yards (`otMake`): **estimates, not fitted** (no source of
college overtime possessions was at hand). The edge moves them as it moves the drives'. Overtime has no clock: each period
is four minutes on the match clock (`ot`), only to space its plays and the chart.

Between two average schools 57% of overtimes end in the first period, 31% in the second, and 12% (about one in eight)
reach the two-point plays.

An earlier season plays the overtime of its day ([Rules by era](#rules-by-era)): to 2018 a possession each in every
period, touchdowns going for two from the third; in 2019 and 2020 two-point plays from the fifth.

## Live win probability

`src/engine/winProbability.js`, kind `drives`, as American football's, under the college rules (`overtime` 'college'):
regulation's normal approximation over the possessions left, at the college rules' odds and tries; level at full time,
the overtime chain (`collegeChain`), exact for the model before form: each period's chances from either side first, the
first possession alternating (so from level at full time each side has the ball first half the time, as the toss gives
it), possessions from the 25 in the first two periods with the second side's answers, two-point rounds from the third,
the decisive play after the eighth. In overtime a lead is charted as the trailing side's answer in that period, level
leaving the next period's chain: a touchdown (going for it, `tdLate`) wins against up to 5 and, kicked in the first period
or with two points in the second, against 6; kicked it levels 7, with two points 8; a field goal wins against 1 or 2 and
levels 3; from the third period a two-point play levels 2. At kickoff the chart is within about a point of the simulated
odds under every Upsets setting (`scripts/college-football.test.mjs`). An earlier season's chart plays its own rules and
the overtime of its day, its chain exact too ([Rules by era](#rules-by-era)).

## The FBS map

`public/domestic/cfb.json` (165 KB), `npm run build:cfb-map` (`scripts/build-club-maps.mjs --league=cfb`), built as the
NFL's: each school holds the state its stadium stands in and nothing else, and a state with several schools is divided
between them along county lines (Texas thirteen, Ohio and California eight, Florida and North Carolina seven, Alabama
six …). Six counties hold two stadiums, and half a kilometre cuts each between them: Fulton (Georgia Tech north, Georgia
State south), Harris (Houston east, Rice west), Miami-Dade (Miami's Hard Rock Stadium north, FIU south), Los Angeles
(UCLA's Rose Bowl north, USC south), Santa Clara (Stanford, San Jose State) and Washtenaw (Michigan, Eastern Michigan).
**Hawaii stays on the map**: the Rainbow Warriors play in Honolulu, so their state is theirs at its true place, which
widens the map's opening view to the Pacific (`focus` −161.6° to −68.1°). Canada and Mexico lie beneath it as inert land,
so Hawaii could not be moved nearer as an inset without landing on Mexico. Montana, South Dakota, Maine, New Hampshire,
Vermont, Rhode Island and DC hold no FBS school and stay empty; Alaska lies off the map. Hawaii's routes cross the
Pacific like any sea route (the Seahawks' and Broncos' kind on the NFL's map).

## Crests

Each school's crest is its athletics logo, the first image of its athletics article's infobox on English Wikipedia
(`scripts/data/cfb-teams.json` `crest`; Western Michigan's 2021 logo where the article leads with an older one; Pitt and
UNLV brand with wordmarks, so theirs are). They come through the crest sync's `pages` route
(`scripts/data/club-logos.json` "pages", `npm run sync:club-logos -- --pages`), which reads no Wikipedia API answer: each
file page gives the file's original and licence. upload.wikimedia.org answered a run of originals with HTTP 429 and asked
for its standard thumbnail sizes instead, so a "pages" record may now name a standard width (`thumb`: 250, 330 or 500) and
pins that thumbnail's bytes; the schools' crests are 330px thumbnails (an original only for a raster narrower than that).
Club colours follow from the crests (`npm run build:club-colours`).

## Earlier seasons

Status: built 2026-11-18, on the user's request that day ("add seasons as far back as you can go in the past of college
football"). Seventeen seasons ship beside the built-in 2026: the FBS seasons 2009 to 2025 (data sets `cfb-<season>`,
kind `cfb`, labelled "FBS (computed)", so the Season list says "2013 · computed"). No game rates them for this game:
EA's ratings site keeps only its current edition, and the one full copy of College Football 26 found (a fan site's)
forbids automated copying. So each is computed from what its players did, by the method of
[computed-ratings.md](computed-ratings.md), with College Football 27's ratings as the scale. They play their own day's
scoring and overtime ([Rules by era](#rules-by-era)) on maps of their own
([domestic-campaigns.md](domestic-campaigns.md), "The FBS map": era maps 2009–2025).

**Why 2009.** A season needs every school's players with their positions. CollegeFootballData.com's rosters hold them
(about 100 a school, positions for 91–99%) from 2009; its 2004–2008 rosters list only the players with a box-score line
(26–28 a school: no linemen, few defenders), and nothing earlier names a school's players season by season (College
Football Reference is off limits; stats.ncaa.org, ESPN's site and footballdb refuse Anthropic's agents). Earlier
seasons would need another kind of source — each school's NFL draft picks and all-conference players — and could field
only the schools those name enough players for; that is not built.

- **Sources.** sportsdataverse (https://github.com/sportsdataverse), each repository pinned at one commit in
  `scripts/data/cfb-seasons-sources.json` (cfbfastR-data at 3fac3565, cfbfastR-cfb-data at 83ff6d04, read
  2026-11-18), every file by SHA-256, fetched from raw.githubusercontent.com (no robots.txt) into the ignored
  `data-src/cfb-history/` by `npm run sync:cfb-seasons -- --fetch` (`--pin` first asks GitHub's API for each repository's
  current commit and pins every file again):
  - cfbfastR-data's season rosters (`rosters/csv/cfb_rosters_<year>.csv`, CollegeFootballData.com's; CC BY 4.0): every
    rostered player with his ESPN athlete id, position, weight and, from about 2017, class;
  - cfbfastR-cfb-data's Parquet tables (ESPN-derived): every game's schedule row (`cfb_schedules`, from 2007), every
    player's box score (`player_box`, from 2004: passing, rushing, receiving, interceptions, kicking and returns; the
    defence's own rows exist only from 2023 and are not read, so every season is measured alike), each play's
    participants from 2014 (`play_participants`: the tackler and the assisting one, the sacker, the pass defender, the
    fumble forcer), and every recruiting class's 247Sports composite grade (`cfb_recruits`, from 2004). They are read by
    `scripts/lib/parquet.mjs`, a small reader of flat Parquet files (Thrift metadata, dictionary and data pages of both
    versions, zstd and gzip through node:zlib), written for these files rather than adding a dependency and tested on
    files a minimal writer makes (`scripts/parquet.test.mjs`).
- **The season's schools.** The FBS schools that played at least one completed game against another FBS school that
  season (`scheduleOf`, `schools`): 119 in 2009–2011, 123 in 2012, 124 in 2013, 127 in 2014–2016, 129 in 2017, 130 in
  2018–2019, 127 in 2020 (New Mexico State's only games of 2020 were against non-FBS sides; UConn and Old Dominion did
  not play), 130, 131, 133, 134 and 136 in 2025. A school whose roster leaves more than two lineup places short does not
  play (`MAX_GAPS`): Idaho, FBS to 2017, plays no season, its rosters listing 19–44 rated players and no offensive
  linemen. Each school's league is its conference of that season as the schedule names it (the Pac-10 to 2010, the Big
  East and the WAC to 2012, The American from 2013).
- **The players.** Every rostered player of a season's school, once: one a school lists twice under two ids
  (CollegeFootballData.com gives some two) is kept where he has an ESPN id, then a position. His position is the
  roster's, grouped into the game's ten as the built-in season groups EA's (DE, DT, NT and EDGE are DL; OT, G and C are
  OL; FB is RB; PK is K); a generic "DB" is a corner or a safety by another season's roster, else his recruiting position,
  else his weight (195 lb and up a safety; in 2025 the recruiting position agrees with EA's corner or safety 82% of the
  time, weight 68%); a player the roster does not place takes his nearest other season's position, his recruiting's, or
  his box score's (a passer, a kicker). Punters, long snappers and returners have no place in the lineup and are left
  out. Names lose the comma before a generational suffix ("Dante Fowler Jr.") and a backtick or opening quote standing
  for an apostrophe or ʻokina.
- **The value.** A weighted sum of standardised signals of his position (`SIGNALS`, `VALUE_WEIGHTS`), each pooled over
  the season and the two before it 3:2:1 by his school's games (`pooledWindow`):
  - quarterbacks: passing yards a game, adjusted yards a try (yards, 20 a touchdown, less 45 an interception; shrunk
    toward replacement by 150 tries), rushing yards a game; backs: rushing yards a game, yards a carry (shrunk by 60
    carries), receiving yards; receivers and tight ends: their share of the school's catches, receiving yards a game
    and touchdowns;
  - from 2014, defenders: the tackles (the tackler's and an assisting tackler's), sacks and passes defended the plays
    name, a game, their interceptions, and the share of the school's games they took part in; plays before 2014 name no
    tacklers, so defenders there are read from interceptions, their box-score games, recruiting and years (`early`);
  - kickers: field goals made a game, the share made (shrunk by 12 kicks), extra points tried a game;
  - every position: his 247Sports composite grade and his years in college (from his recruiting class, else from the
    first season a box score or roster names him), and for linemen and tight ends their weight. His recruiting record is
    his school's, a transfer's from a school he played for before, else the one recruit of his name and position who
    could still be in college (`recruitOf`). A player no class lists takes the graded players' tenth percentile (walk-ons,
    on the evidence, rate below recruits); a recruit the source lists without a grade (13–26% of the classes from 2016,
    many of them later transfers) their first quartile.
  A replacement level is the pooled rate of the quarter of a position's players with the least exposure.
- **The weights.** Fitted once by least squares (`fitWeights`; a signal that would weigh negatively is dropped) to College
  Football 27's launch ratings (EA SPORTS' ratings site, iteration 1-base, retrieved 2026-11-18, cached in
  `data-src/college-football/1-base/`) of the players of 2025 who returned in 2026, 7,469 matched by name at their school
  or uniquely by name (a transfer), then frozen (`npm run sync:cfb-seasons -- --tune --write` refits them into
  `scripts/data/cfb-seasons/calibration.json`, which a test holds `VALUE_WEIGHTS` to). How they order the launch ratings,
  Spearman within position, each half of the schools valued by weights fitted on the other:

  | | QB | RB | WR | TE | OL | DL | LB | CB | S | K |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 2014–2025 (plays named) | 0.84 | 0.86 | 0.82 | 0.73 | 0.65 | 0.77 | 0.80 | 0.79 | 0.80 | 0.68 |
  | 2009–2013 | 0.84 | 0.86 | 0.82 | 0.73 | 0.64 | 0.65 | 0.64 | 0.74 | 0.73 | 0.68 |

  The offensive line has no statistic of its own, so it is ranked by recruiting, years in college and weight alone. EA
  rates returning players partly on the same recruiting and class, so these figures measure agreement with EA's
  judgement, not truth; years in college and recruiting carry about 45% of a quarterback's value, so a young star reads
  below his season's acclaim (Caleb Williams, 2022's Heisman winner, a second-year transfer whose recruiting grade the
  source lacks, is USC's 88, the thirtieth quarterback). The method was checked for leaks: an early season's signal is
  measured on 2025 as an early season would have it (box-score categories every season has, no named plays).
- **The rating.** Each school's best at each position by value, as many as College Football 27 carries a school (`DEPTH`:
  4 quarterbacks, 5 backs, 10 receivers, 6 tight ends, 13 linemen, 14 on the defensive line, 8 linebackers, 8 corners, 8
  safeties, 2 kickers), are ranked across the season's schools and read off College Football 27's ratings at that
  position (Week 10 Ratings, each school's best as many: `referenceOf`, `ratingsOf`). Each school then fields the lineup
  the game picks and its best backups (34), by the built-in season's rules.
- **The move toward results.** As the NFL's computed seasons: each school's Simple Rating System over the season's games
  between FBS schools (regular season and postseason, a bowl or playoff game at a neutral site), its reliability r (0.67
  in 2020, when conferences barely met; 0.88–0.92 otherwise), m the margin the match model gives a point of played
  strength under the season's rules without its data set (3.6–4.1 points, over 160,000 games), and the target
  T = μ + √r × S ÷ m; every player of the school moves by a whole number and its best few one more, never reordered,
  and the school keeps the squad it then fields. A game against a school that does not play the season still counts
  toward its opponent's rating.
- **Results.** Schools spread as the built-in season's do (lineup strength SD 3.0–3.9 about 79.5, against College
  Football 27's 3.34 about 79.5; squad players p5/p25/p50/p75/p95 68–69/73–74/77–78/82/89, against 70/74/77/81/88). Every
  national champion is among its season's five strongest schools (a test holds it) and leads twelve of the seventeen:
  Alabama in 2009, 2011, 2012, 2015, 2017 and 2020, Florida State in 2013, Georgia in 2021 and 2022, Michigan in 2023,
  Ohio State in 2024 and Indiana in 2025 (15–0 against FBS schools). 2018's Clemson and 2019's LSU are second (behind
  Alabama and Ohio State), 2014's Ohio State third and 2016's Clemson fourth; 2010's Auburn is fifth, behind Oregon,
  Stanford, Boise State and Alabama, whose margins were wider. Replayed on its own schedule under its rules (each real
  game 20 times, the home side defending at home), a season scores 0.4–1.3 points a team above the real one and spreads
  its margins a little wider (SD 22–25 against 20–22), but its standings spread about a fifth too little (win% SD
  0.18–0.20 against 0.21–0.25): the match model's luck between equal sides is the real game's
  (a margin SD of 16.0 against 15.0–15.3 about the SRS fit), and the expected margins follow the SRS (slope 0.95–0.99),
  so the excess is the model's luck in mismatches, which the built-in season shares (Not done). The audit
  (`docs/design/college-football-seasons-audit.json`) lists every school with its conference, record, points, SRS and
  move, every documented lineup gap (an option offence's tight end: Army, Navy, Georgia Tech) and the schools left out.
- **Checks.** `npm run audit:rosters -- --sport=college-football`: the 17 seasons and the built-in one, 0 errors, 0
  warnings. Spot checks: Tim Tebow 2009 96, Ndamukong Suh 2009 96, Mark Ingram 2009 95, Marcus Mariota 2014 99, Derrick Henry 2015 98, Joe
  Burrow 2019 98, Jeremiah Smith 2025 99; Aaron Donald 2013 79 shows the early seasons' weak defensive evidence.
- **Size.** The season files are 118–138 KB each (2.2 MB), loaded only when chosen and cached for offline play
  (`src/pwa.js`); the snapshots 300–340 KB each (5.4 MB, `scripts/data/cfb-seasons/`).

## Interface

- **Setup.** The fifth sport tile, "College football", a helmet, after American football: "138 FBS schools". Choosing it
  switches Teams to clubs and disables Nations ("College football is played by FBS schools only": a sport may name its
  division and its word for its clubs, `clubLeague` and `clubNoun`); the one theatre is **FBS · USA**, the Season list
  holds the built-in 2026 and the [earlier seasons](#earlier-seasons) 2025 back to 2009 ("2013 · computed"), each on its
  era's map. Twelve sports (Counter-Strike came in the same day) still sit in three rows of four; measured in Chromium, setup's steps fit without
  scrolling at 360×640, 390×664, 390×844, 768×1024, 1024×768 and 1440×900.
- **Squad, match, ledger.** American football's field, units, profile (Offence, Defence, Kicking) and feed, through
  `isGridironSport` (src/data/teams.js), which both sports share; scorer lines count overtime's two-point plays apart from
  safeties ("Smith 1 TD, 1 2PT"), live and from an archived final's feed copy ("2PT — …").

## Data size

The schools' players are 143 KB (47 KB gzipped), as big as women's football's clubs: a lazy chunk of their own
(`vite.config.js` chunkOf), loaded the first time college football is played, so the other sports' shared chunk does not
grow by them.

## Rules by era

Status: built 2026-11-18 (simulation version 2, the earlier seasons only). Every earlier FBS season (data set
`cfb-<year>`, 2009 to 2025) plays its own day's scoring and the NCAA overtime of its day. `matchSport` asks the sport for
a campaign's rules (`rulesFor`), and `collegeFootballIn(settings)` gives one sport object per season, under
`collegeSeasonRules(year, dataSet)`. The built-in season (no data set) gets `collegeFootball` itself: today's rules and
results, draw for draw (its version stays 1). The NFL's results are unchanged too.

**Source.** sportsdataverse's cfbfastR-cfb-data tables (ESPN-derived Parquet,
`https://github.com/sportsdataverse/cfbfastR-cfb-data`, `cfb/<table>/parquet/`), saved in the ignored
`data-src/cfb-history/cfbfastR-cfb-data/` on 2026-11-18 and read by `scripts/lib/parquet.mjs`: each season's schedule
(`cfb_schedules`: the schools, their divisions, the final score), drives (`drives`: each possession's team, quarter,
offensive plays and ending) and box scores (`player_box`: each kicker's field goals and extra points, "made/tried").
`npm run build:college-scoring` (`scripts/build-college-scoring.mjs`) writes `scripts/data/college-scoring.json` (each
season's counts, the games left out and why, every file's SHA-256) and `src/data/collegeLeagueAverages.js`; `--check`
rebuilds both byte for byte where `data-src/` has the tables, else the module from the committed table, and checks each
season's average matchup against its schools either way; `--report` prints each season's figures a team-game.

**What is counted.** A season's games between two FBS schools, regular season and bowls. A game counts when its drives
cover all four quarters and both schools' points add up from their box scores: 95% to 100% of each season's do (2021 and
2022 have no drives for 29 games each; 2025 leaves out two of 808).

- Touchdowns: from each school's points less its extra points and field goals made and its safeties. What is left is six
  a touchdown beyond those whose extra point was tried and two a two-point try made, and the fewest tries that add up
  give its touchdowns: every one, the defence's, returners' and overtime's included. Overtime's are its drives' (from
  the fifth period) that ended in one.
- Possessions: regulation's drives of a play or more. ESPN lists kick and turnover returns as drives of no play (a
  kick-off return touchdown; before 2014 an interception or punt return beside the drive it ended) and, before 2014, a
  half that ended before the receiving side's first snap. None is a possession of the model's, and leaving out every
  drive of no play counts every season alike.
- Field goals and extra points tried and made: the kickers' rows, overtime's included; overtime's field-goal tries are
  its drives'.
- Safeties: the drives that ended in one, and those the points need that the drives do not name (two points no try
  explains: a fifth of 2012's).

**Against cfbstats.com** (2024 and 2025, the figures the match model was fitted on; theirs in brackets): 26.48 points a
team-game (26.5), 3.27 touchdowns (3.27), 1.59 field-goal tries (1.59) made 76.1% (76.1%), 0.032 safeties (0.030).
ESPN's box scores name fewer missed extra points: 98.6% made (98.3%). The touchdowns less the extra points tried leave
two-point tries after 8.6% of touchdowns, made 42.6% (8.3%, 46.1%): a walk-off touchdown, which has no try, counts as a
failed one. ESPN's drives give 11.73 possessions a team-game in regulation where the model plays 12.3 (cfbstats' 10.35
ending in a touchdown, a field-goal try, a punt or a giveaway, and about two more): by the drives 10.01 ended so and 1.65
on downs or at a half's end, the rest of the 10.35 being the defence's, returners' and overtime's touchdowns, which end
no possession of their own. Only each season's move from 2024 and 2025's is taken, so the difference does not matter.

**Gaps.** 2011's box scores name no missed extra point (every kicker's row reads n of n, a miss counting as no try): its
extra points are 2010's and 2012's between them, its touchdowns still add up (a miss reads as a failed two-point try).
2020 is the short COVID-19 season: 534 games between FBS schools, as the tables have them (526 counted). The few games
that reached the two-point shoot-out (2019 on, one to three a season) are left out: its plays add twos the box scores
cannot tell from tries.

Each season a team-game (games counted of the season's FBS games; possessions in regulation; touchdowns a possession in
regulation; two-point tries as the scoring leaves them, a check only), the possessions a side it plays, and its overtime:

| Season | Games | Points | Touchdowns | Possessions | TD a possession | FG tries | FG made | XP made | Safeties | Two-point tries | Possessions a side | Overtime |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2009 | 691 of 714 | 26.15 | 3.24 | 12.44 | 0.260 | 1.61 | 73.5% | 96.0% | 0.036 | 5.9% | 13.04 | 1997 |
| 2010 | 691 of 718 | 27.14 | 3.42 | 12.53 | 0.271 | 1.49 | 74.1% | 96.5% | 0.031 | 4.5% | 13.13 | 1997 |
| 2011 | 698 of 715 | 27.32 | 3.45 | 12.70 | 0.270 | 1.50 | 71.9% | none named | 0.034 | 8.4% | 13.31 | 1997 |
| 2012 | 714 of 732 | 28.32 | 3.58 | 12.85 | 0.276 | 1.54 | 73.5% | 96.5% | 0.028 | 5.4% | 13.47 | 1997 |
| 2013 | 733 of 737 | 28.42 | 3.59 | 13.02 | 0.274 | 1.47 | 75.4% | 97.0% | 0.031 | 4.6% | 13.65 | 1997 |
| 2014 | 741 of 760 | 28.42 | 3.58 | 13.10 | 0.271 | 1.59 | 72.5% | 96.8% | 0.028 | 4.2% | 13.74 | 1997 |
| 2015 | 756 of 765 | 28.50 | 3.57 | 13.10 | 0.270 | 1.61 | 73.7% | 97.1% | 0.039 | 4.4% | 13.74 | 1997 |
| 2016 | 743 of 760 | 28.97 | 3.66 | 12.99 | 0.279 | 1.51 | 75.5% | 96.8% | 0.043 | 4.8% | 13.61 | 1997 |
| 2017 | 767 of 776 | 27.91 | 3.52 | 12.80 | 0.272 | 1.54 | 73.1% | 96.9% | 0.029 | 4.8% | 13.42 | 1997 |
| 2018 | 759 of 772 | 28.32 | 3.58 | 12.71 | 0.280 | 1.48 | 74.1% | 97.0% | 0.042 | 5.7% | 13.33 | 1997 |
| 2019 | 769 of 774 | 27.85 | 3.50 | 12.50 | 0.278 | 1.54 | 74.8% | 97.8% | 0.019 | 6.0% | 13.10 | 2019 |
| 2020 | 526 of 534 | 28.77 | 3.64 | 12.41 | 0.290 | 1.54 | 73.7% | 97.5% | 0.029 | 7.5% | 13.01 | 2019 |
| 2021 | 735 of 770 | 27.54 | 3.43 | 12.13 | 0.281 | 1.58 | 75.0% | 98.0% | 0.044 | 6.1% | 12.72 | 2021 |
| 2022 | 742 of 776 | 27.15 | 3.37 | 12.19 | 0.276 | 1.55 | 77.0% | 98.5% | 0.036 | 8.1% | 12.78 | 2021 |
| 2023 | 782 of 792 | 26.59 | 3.30 | 11.98 | 0.273 | 1.58 | 75.2% | 98.6% | 0.024 | 8.2% | 12.56 | 2021 |
| 2024 | 777 of 798 | 26.82 | 3.32 | 11.82 | 0.279 | 1.59 | 75.8% | 98.3% | 0.035 | 8.7% | 12.39 | 2021 |
| 2025 | 806 of 808 | 26.16 | 3.22 | 11.65 | 0.273 | 1.59 | 76.5% | 98.8% | 0.030 | 8.4% | 12.21 | 2021 |
| 2024–25 | 1,583 of 1,606 | 26.48 | 3.27 | 11.73 | 0.276 | 1.59 | 76.1% | 98.6% | 0.032 | 8.6% | 12.30 | |

The fast game of the 2010s shows in the possessions (13.1 a team-game in 2014 and 2015, 11.65 in 2025, the clock running
on after a first down since 2023), more than in the touchdowns a possession.

**How a season's figures become its rules** (`collegeSeasonRules`). The possession model is today's (late-game
play-calling, the college scale, the home edge); only its rates move, each by as far as the season's sits from 2024 and
2025's, measured the same way from the same tables:

- **Possessions a side:** today's 12.3 times the season's possessions a team-game over 2024 and 2025's (12.2 in 2025 to
  13.7 in 2014 and 2015), `driveRange` as wide about them as today's 9 to 16.
- **Touchdowns and field-goal tries:** at its own average matchup (`COLLEGE_SEASON_MATCHUPS`: its schools' mean offence
  less mean defence, `public/college-football/cfb-<year>.json`; the built-in schools' for a season without its file), a
  drive's touchdown odds, and its field-goal-try odds when it ends in none, sit from today's at the built-in schools'
  average matchup as far, in log odds, as the season's touchdowns a regulation possession (and its field-goal tries on
  one that ended in none) sit from 2024 and 2025's; less the allowance for its schools' spread beyond today's
  (`spreadAllowance`, as the NFL's, at the college edge's slopes, 0.075 and 0.025 times the scale 1.57). The computed
  seasons' schools average an edge of about 0.2 (2018) to 1.3 (2012) and spread about 23 to 33, against the built-in
  schools' 0.51 and 27.6.
- **Field goals and extra points made:** by the season's average kicker (about 77 in every season's file, 76 for the
  built-in schools), today's 76.1% and
  98.3% moved as far in log odds as the season's sit from 2024 and 2025's (field goals 71.9% in 2011 to 77.0% in 2022;
  extra points 95.2% in 2009 to 98.6% in 2025), within today's ranges about them; a kicker's rating point moves extra
  points by as much more than today's 0.3 in a hundred as the season missed more (`xpSlope`).
- **Safeties:** today's rate a possession, times the season's over 2024 and 2025's.
- **Two-point tries:** today's, made 46.1% and gone for after about 8% of touchdowns: no source names them. The scoring's
  check above gives 4–6% of touchdowns from 2009 to 2018 and 8% from 2022 (8.6% in 2024 and 2025 by the same count), so
  the earlier seasons likely went for two about half as often; but walk-off touchdowns and unnamed missed kicks are in
  that count, so it is not played.
- **Overtime:** its day's (below). Its possessions from the 25 (today's estimates: a touchdown half the time between
  equals, else a field-goal try three times in four, made seven in ten) move as the season's drives and kicks do.

**Overtime by era.** The NCAA's overtime of each season's day, as optional fields of the rulebook (`collegeOvertimeRule`):
the first period whose touchdowns must go for two (`otTwoFrom`) and the first period of two-point plays (`otPlaysFrom`,
null for none). A rulebook without them plays today's (`collegeOvertimeOf`), so the built-in season's games are what
they were, draw for draw.

| Seasons | A possession each from the 25 | Touchdowns go for two | Two-point plays, one each from the 3 |
| --- | --- | --- | --- |
| 2009–2018 (the 1997 rules) | every period | from the third period | none |
| 2019 and 2020 | the first four periods | in the third and fourth | from the fifth period |
| 2021 on, and the built-in season | the first two periods | in the second | from the third period |

The first period's touchdowns are kicked in every era (the rules left the try to the team, and the model kicks), and
under the 1997 rules the second's too. The 1997 rules have no shoot-out: periods of possessions go on until one decides
the game, here at most `maxOvertimes` (8) and then the decisive two-point play, as today. Between two of 2013's average
schools 57% of overtimes end in the first period, 24% in the second, 13% in the third and 6% go on; under today's rules
the forced two-point try of the second period ends 32% there and only 13% reach the third.

The live chart (`collegeChain`, `collegeLeadAt` in `src/engine/winProbability.js`) plays each era's overtime: a season
whose overtime is not today's carries its periods on the live model (`twoFrom`, `playsFrom`), and its chain is exact for
the simulation before form, as today's is. In a period of possessions a lead is the trailing side's one answer (with the
two-point try where the rules require it: a touchdown and two level 8 in a 1997 third period); in a period of plays a
two-point play levels 2.

**Sources** (read 2026-11-18):

- Overtime in every Division I-A game from 1996, the 1995 bowl games' system: Wikipedia, "1996 NCAA Division I-A
  football season", `https://en.wikipedia.org/w/index.php?oldid=1358960662`.
- From the third overtime period a touchdown must go for two (from 1997): Wikipedia, "1997 NCAA Division I-A football
  season", `https://en.wikipedia.org/w/index.php?oldid=1372100265`.
- From the fifth period each team lines up at the 3 for a two-point try instead of snapping from the 25 (from 2019):
  Wikipedia, "2019 NCAA Division I FBS football season", `https://en.wikipedia.org/w/index.php?oldid=1384258209`.
- From 2021 a touchdown must go for two from the second period (before, the third), alternating two-point tries from the
  third (before, the fifth), the first period's try still the team's choice: Wikipedia, "2021 NCAA Division I FBS
  football season", `https://en.wikipedia.org/w/index.php?oldid=1381333026`.
- Possessions from the opponent's 25; the first four each in 2019 and 2020 and the first two since 2021, then two-point
  tries from the 3; the 2018 LSU–Texas A&M game (74–72) behind the 2019 change; Illinois–Penn State's nine periods (2021),
  the longest FBS game: Wikipedia, "Overtime (sports)", `https://en.wikipedia.org/w/index.php?oldid=1383118578`.
- The game clock no longer stopped for a first down but in each half's last two minutes, from 2023: Wikipedia, "2023 NCAA
  Division I FBS football season", `https://en.wikipedia.org/w/index.php?oldid=1377196806`.

**Measured** (2026-11-18, the season files of that evening, `scripts/college-football-eras.test.mjs`): each season's own
schools, every school against every fourth other four times (about 19,000 games), score as far from today's as their
league did from 2024 and 2025's, within −0.16 to +0.35 points a team-game, their touchdowns within 1.5% (the test allows
0.6 points and 3%). Over conference pairings only, as today's rules were fitted, the seasons score up to 0.6 points above
(−0.03 to +0.64): their computed schools differ more within a conference than College Football 27's (the spread of a
conference pairing's edge 16.5 to 25.4, against 11.6), and the allowance is for all pairings, as the NFL's is.

**Estimated, not measured:** the overtime possessions' odds (as today's, moved with the season); two-point tries
(today's); 2011's extra points (its neighbours'). ESPN's drives do name overtime's possessions from the 25: from 2014 to
2025, 948 of the first two periods' that name their end finished in a touchdown 56% of the time, in a field-goal try on
72% of the rest, made 73.5%, near today's estimates (50%, 75%, 70%); the second side's answers are played to the score,
so they are not fitted, and today's estimates stand so the built-in season's draws do not change.

## Not done

- No game-rated season but College Football 27's. EA's site keeps only the current edition, and the one full copy of
  College Football 26 found forbids automated copying; 2009–2025 are computed ([Earlier seasons](#earlier-seasons)).
- No season before 2009: full rosters begin then. Seasons from each school's NFL draft picks and all-conference players
  could go further back, fielding only the schools those name enough players for.
- 2009–2013's defenders are ranked without tackles or sacks (plays before 2014 name no tacklers): by interceptions,
  recruiting and years, which order EA's ratings at 0.64–0.74 against 0.77–0.80 from 2014.
- The match model's luck in mismatches: replayed on its own schedule a computed season's standings spread about a fifth
  too little (win% SD 0.18–0.20 against the real 0.21–0.25), though its expected margins follow the real ones and its
  luck between equal sides is the real game's. The built-in season shares the model, so a recalibration would touch it
  too.
- Overtime's possession odds are estimates; the edge scale and the rates are fitted to conference seasons, not to
  non-conference games, whose mismatches are wider.
- The realism harness (`npm run simulation:realism`) and the match-simulation report do not cover college football yet.

## Tests

`scripts/college-football.test.mjs`: the schools rebuild byte for byte; every school fields 23 natural starters; the
college rules; 3,000 games with a winner, a feed that adds up and FBS-like scores; college overtime's periods, tries and
two-point plays; favourites, upsets and the home edge; the feed copy and scorer lines, live and archived; the live chart
against simulated odds and its overtime chain against simulated overtimes; the map (one territory per school around its
stadium, the shared counties' cuts, Hawaii, the empty states) and a seeded campaign to a champion; setup; the squad
screen; and the running App launching on the FBS map, saving and resuming. `scripts/club-maps.test.mjs` holds the map to
the state rule (Hawaii is the FBS map's own); `npm run smoke` adds an FBS duel with the live ticker and an FBS resume.

`scripts/college-football-eras.test.mjs` ([Rules by era](#rules-by-era)): the built-in season keeps today's rules and
its draws (and the NFL its own: digests taken before the seasons' rules came in); the overtime by year; every season's
rules, one sport object each; the scoring readers on a made-up season; the scoring table rebuilt (`--check`, byte for
byte where `data-src/` has the tables), every point adding up and 2024–25 against cfbstats.com; every season scoring
like its league; each era's overtime periods and tries in simulated games; the clock, ticker and setup; and the live
chart's chain against simulated overtimes in each era, its kickoff against the odds and its leads by era.

`scripts/cfb-seasons.test.mjs` ([Earlier seasons](#earlier-seasons)): the readers on invented rows (positions, generic
backs, recruiting by name and school, box-score categories, the schedule's schools, the 3:2:1 window, shrinkage, the
standardised signals, the least-squares weights, the rating by rank); the frozen weights against the calibration;
every snapshot's squads, gaps and left-out schools, its SRS, targets and moves recomputed from its own games; every
national champion among its season's five strongest; the snapshots rebuilt byte for byte from the pinned sources where
`data-src/` has them (two seasons; `npm run sync:cfb-seasons -- --check` does all); every season, its listing and audit
rebuilt; each season on its era's map with the conferences of its day, Idaho and New Mexico State's 2020 left out; the
loader's refusals; the sport bound to a season; and the running App listing the seasons ("2013 · computed"), launching
2010's and 2021's schools on their era's maps, saving and resuming. `scripts/parquet.test.mjs` holds the Parquet reader
to files a minimal writer makes; `scripts/club-maps.test.mjs` holds the era maps.
