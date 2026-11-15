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
odds under every Upsets setting (`scripts/college-football.test.mjs`).

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

## Interface

- **Setup.** The fifth sport tile, "College football", a helmet, after American football: "138 FBS schools". Choosing it
  switches Teams to clubs and disables Nations ("College football is played by FBS schools only": a sport may name its
  division and its word for its clubs, `clubLeague` and `clubNoun`); the one theatre is **FBS · USA**, the Season list
  holds the built-in 2026. Twelve sports (Counter-Strike came in the same day) still sit in three rows of four; measured in Chromium, setup's steps fit without
  scrolling at 360×640, 390×664, 390×844, 768×1024, 1024×768 and 1440×900.
- **Squad, match, ledger.** American football's field, units, profile (Offence, Defence, Kicking) and feed, through
  `isGridironSport` (src/data/teams.js), which both sports share; scorer lines count overtime's two-point plays apart from
  safeties ("Smith 1 TD, 1 2PT"), live and from an archived final's feed copy ("2PT — …").

## Data size

The schools' players are 143 KB (47 KB gzipped), as big as women's football's clubs: a lazy chunk of their own
(`vite.config.js` chunkOf), loaded the first time college football is played, so the other sports' shared chunk does not
grow by them.

## Not done

- One season: College Football 27's. EA's site keeps only the current edition, and College Football 25 and 26 rosters
  would need a fan compilation, as Madden's earlier seasons did.
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
