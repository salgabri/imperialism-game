# Tennis

Status: implemented 2026-11-08. A seventh sport, played by the rules of the Davis Cup: two
nations' teams meet in a tie of five rubbers, first to three. Nations only, on the world map:
tennis has no clubs. Everything outside the match (territory, the draw, targeting,
conquest, signings, saves) is the game's own, unchanged. The women's game plays the same
rules as the Billie Jean King Cup, a sport of its own ([women's tennis](womens-tennis.md)).

The player chose the format and the data: the home-and-away ties' five rubbers (rather than
the Final 8's three, or the old best-of-five sets), and Elo ratings only, with nothing
estimated. That is the built-in season's format; since 2026-11-10 an earlier season plays its
own year's, best-of-five sets and advantage sets included ([Format by year](#format-by-year)).

## Data

**Source.** There is no video-game ratings list for tennis. Tennis Abstract (Jeff
Sackmann) publishes Elo ratings for the men it has enough recent matches for, updated
weekly: [atp_elo_ratings.html](https://tennisabstract.com/reports/atp_elo_ratings.html),
547 players on 2026-11-02, from Jannik Sinner's 2297 down to 1050. The same site's ATP
rankings report ([atpRankings.html](https://tennisabstract.com/reports/atpRankings.html),
2,301 players) gives each player's country (the IOC code the ATP files him under) and birth
date; the three rated players it no longer lists have their country read from their own page.

`npm run sync:tennis` (`scripts/sync-tennis.mjs`) caches the pages in the ignored
`data-src/tennis/` and writes the snapshot `scripts/data/tennis-elo.json` (50 KB,
committed): `[key, name, country, birth date, Elo, hard, clay, grass, Elo rank, ATP rank]`.
The surface Elos are kept but not played (see Known limits). Tennis Abstract's spelling is
kept as it is: no diacritics (Jiri Lehecka), "Alex De Minaur", "Christopher Oconnell".

**Ratings.** A player's rating is his Elo on the game's scale, Elo / 25 + 4, rounded:
Sinner 96, Alcaraz 91, a 1700 player 72, the list's last 46 (`scripts/lib/tennis.mjs`). A
rating point is then 25 Elo points, so the match model plays Elo's own odds. Nothing is
estimated: a player Tennis Abstract does not rate is not in the game.

**Nations.** `npm run build-tennis` (`scripts/build-tennis.mjs`, `--check` rebuilds byte for
byte) writes `src/data/rosters.tennis.js`. Each nation names its five best by Elo, as a Davis
Cup captain nominates five. Left out:

- the three the ATP no longer ranks (Gael Monfils, Kei Nishikori, Khumoun Sultanov);
- two from a country the map does not draw (Monaco's Valentin Vacherot, Hong Kong's Coleman
  Wong);
- twelve who are their nation's only rated player (Paraguay, Luxembourg, Jordan, Lebanon,
  the Dominican Republic, Moldova, Côte d'Ivoire, Morocco, Malaysia, Uzbekistan, Latvia,
  Jamaica): a tie needs two.

That leaves 52 nations, from Spain (86.1) and Italy (86) down to Thailand (58.5). A nation
without a team stays neutral land, as in women's football. Great Britain plays the Davis Cup
as one, so the home nations' shapes start in the United Kingdom's empire, which plays as Great
Britain (GBR) under the Union Jack, as in basketball, baseball and hockey. Russia and Belarus,
out of today's Davis Cup, play here.

## The team

`LINEUP_PLANS.tennis` is two singles places and two doubles places (`SGL`, `DBL`), filled by
`tennisLineup` in `src/data/teams.js` rather than by the assignment the other sports use: the
two best play the singles, the No. 1 first, and the next two the doubles. Any player plays
either, so nobody is out of position. A team of two or three plays its singles players in the
doubles too, as small nations do: Norway's doubles are Durasovic and Ruud. That place holds a
second copy of the player, marked `doubling`; `starters` lists each player once. The team's
strength weighs each place by its rubbers: the No. 1 and No. 2 two each, the pair one between
them, so (2·No.1 + 2·No.2 + ½·each doubles player) / 5.

There are no doubles ratings: the pair is the mean of its two players' singles ratings.

## The match model

`src/sports/tennis.js`. The built-in season's, and every season's since 2019; the years
before play their own format on the same model ([Format by year](#format-by-year)).

- **The tie.** Day one: each side's No. 1 plays the other's No. 2 (the attacker's No. 1
  first). Day two: the doubles, then No. 1 against No. 1 and No. 2 against No. 2. Once a side
  has three rubbers the rest are dead and are not played, so a tie ends 3–0, 3–1 or 3–2.
- **A rubber's odds** are Elo's for the gap between the players (or the pairs), tactics,
  Upsets and the venue included: `1 / (1 + 10^(−gap·25/400))`, 64% at 4 points, 76% at 8,
  91% at 16.
- **Form.** One draw for the tie, in rating points, on every rubber: 1.5 at Balanced,
  growing with the square of the drama as in the other sports, so Predictable plays Elo's
  odds and Wild swings ties.
- **Home advantage.** The host picks the surface and fills the stands. From 2003 to 2016
  hosts won 60.9% of 322 World Group ties where Elo expected 53.1%, and the edge was larger
  in the singles than in the doubles
  ([Tennis Abstract](https://www.tennisabstract.com/blog/?p=2091)). The model gives the host
  1.8 rating points (45 Elo) in a singles rubber and 0.7 in the doubles: among the sixteen
  strongest nations that lifts the host's share of ties by 7.7 points, and equal teams' hosts
  win 60.5%.
- **Sets.** Every rubber is a best-of-three match of tie-break sets, played game by game:
  each server holds with the chance his point odds give (`holdChance`), the tie-break point by
  point, the servers alternating every game across the sets after a toss. The two players'
  point odds split the difference around the tour's 64% on serve (`serveEdge`) so that the set
  odds come out right; who serves first does not change a set's odds.
- **Day form.** With independent sets, about 44% of the ATP's best-of-three matches would go
  to a third set; about 35% do (Tennis Abstract, 2014 and 2023). So each rubber draws the
  day's form, a spread of 1 in the log-odds of winning a set, and its mean is set so that the
  match odds stay Elo's (`setLogitFor`). Between players 8 points apart a third set then comes
  35% of the time, between equals 41%.
- **One score, two paths.** The odds' fast path (`sampleResult`) draws the form and then one
  number a rubber. The full tie (`simulateTie`) makes the same draws first, so a seed gives
  the same score on both, then plays each rubber's sets given its winner, exactly: the day's
  form given the result, which sets the winner takes given the form, then each set's games
  given its winner (`playMatchWon`).
- **Walkovers.** An empty place concedes its rubber. The built-in teams have none; a custom
  or damaged save might.

## The clock and the feed

Each rubber has twenty clock units, 70 ms each at normal speed; its sets end at their share
of its games, the deciding set at the end of the block. Three rubbers make the shortest tie,
about four seconds; a fourth and a fifth extend it as overtime periods do in other sports, so
the chart's axis grows only when they are played. The clock shows the rubber ("R2 · LIVE"),
the chart ticks at the end of each ("R1", "R2", "R3"), and there is no half-time.

The score counts rubbers (`labels.score` "RUBBERS"). Every set won is an event: `pts` 1 for
the set that wins its rubber, 0 for the others, so the feed tells the story set by set while
the score moves by rubbers:

- `SET 1 — Jannik Sinner (ITA) 7–6(5)`
- `SINGLES — Jannik Sinner (ITA) 7–6(5) 3–6 6–4`, the sets from the winner's side
- `DOUBLES — Cobolli/Berrettini (ITA) 6–4 6–4`, the pair by surname, the stronger first

The scorer line under each side lists who won its rubbers: "Sinner · Cobolli/Berrettini".
`src/viewModels/match.js` keeps a set's 0 points as 0 (it used to read any falsy `pts` as 1),
and reads the archived rubber lines back for a finished tie's scorer line.

## Live win probability

`src/engine/winProbability.js`, kind `rubbers`, exact rather than approximated: the model holds
the five rubbers' gaps; the events say which rubbers and which sets of the one in play each
side has won. P(A wins) is that rubber's chance from its sets, each day-form node weighed by
how likely it made the sets already played, then the rubbers left. Match-day form is integrated
with seven-point Gauss–Hermite quadrature, as hockey's is. Games inside a set do not move the
chart; a set or a rubber always does. At the first serve it sits within sampling error of the
tie's simulated odds.

## Format by year

Status: implemented 2026-11-10, when the user asked that over time the rules of the games be
correct. An earlier season plays the Davis Cup of its year: `matchSport` asks the sport for the
rules of the season's year (`rulesFor`, `src/sports/eras.js`), and tennis answers with
`DAVIS_CUP_FORMATS` in `src/sports/tennis.js`, one sport object a format (the same players,
words and labels, its own rubbers, sets and clock). The built-in 2026 and the seasons of
2019–2025 play today's ties on the sport itself, exactly as before (a test pins the built-in
season's ties to the ones the module played before this change).

| Seasons | Tie | Sets | Source |
| --- | --- | --- | --- |
| 1960–1988 | Five rubbers over three days, first to three: the two singles, the doubles, the reverse singles | Best of five, no tie-break: every set an advantage set | [Davis Cup](https://en.wikipedia.org/w/index.php?oldid=1384175798) ("Each tie consists of five rubbers, which are played in three days"; "Each rubber is normally played as best of five sets") |
| 1989–2015 | The same | Best of five, a tie-break at 6–6 in every set but the fifth | [1989 Davis Cup](https://en.wikipedia.org/w/index.php?oldid=1367121733): "the introduction of the tiebreak, played at 6–6 in all sets except for the final set" |
| 2016–2018 | The same | Best of five, a tie-break in every set | [2016 Davis Cup](https://en.wikipedia.org/w/index.php?oldid=1373159027): the deciding set settled by a tie-break at 6 games all; [2018 Davis Cup](https://en.wikipedia.org/w/index.php?oldid=1374169870): only the zone groups went to best of three |
| 2019–2026 | Five rubbers over two days, the doubles first on day two (today's) | Best of three tie-break sets | [2019 Davis Cup](https://en.wikipedia.org/w/index.php?oldid=1375952558): the matches "changing from best-of-5 sets to best-of-3"; the qualifiers home and away over two days |

The Wikipedia revisions were read on 2026-11-10, each fetched once as its article page under
`/wiki/` with the User-Agent "imperialism-game-data/1.0" (robots.txt allows `/wiki/`). Jeff
Sackmann's match files (the pinned archive of Earlier seasons) bear every date out, as
`node scripts/tennis-formats-real.mjs` counts them from the pinned files (2026-11-10): none of
the 17,940 sets of the Davis Cup's best-of-five rubbers of 1960–1988 ended 7–6 (two sets of
dead rubbers shortened to best of three did), and 1,647 went past 7–5; from 1989 to 2015, 2,772
of the 20,411 first four sets ended 7–6 and none went past it, while 157 of the 1,052 fifth sets
went past 7–5 and none ended 7–6; from 2016, 12 of the 87 fifth sets ended 7–6 and none went past
it; all 1,350 rubbers of 2019–2025 are best of three. The files number the singles 1, 2, 4 and 5
(the doubles third) in all but 2 of the 3,987 ties of 1968–2025, and the first reverse singles is
the No. 1s': in 505 of the 640 World Group ties of 1985–2018 whose players have a ranking, its two
players' rankings add up to less than the second's (a dead rubber often fielded others).

**The model.**

- **The order of play** is the Davis Cup's in every year: the two singles, the doubles, the
  reverse singles, No. 1 against No. 1 first. The third day is not played apart: one match-day
  form for the tie, as today.
- **Best of five.** Tennis Abstract's Elo is a best-of-three rating ("My version of tennis Elo
  is based on the most common match format, best-of-three matches. In a best-of-five match, the
  favorite has a better chance of winning": Jeff Sackmann,
  [An Introduction to Tennis Elo](https://www.tennisabstract.com/blog/2019/12/03/an-introduction-to-tennis-elo/),
  3 December 2019). So a rubber's set chance comes from Elo's odds as in best of three
  (`setLogitFor`, under the same day form), and the rubber is five sets of it: at each day-form
  node P = s³(10 − 15s + 6s²) (`bestOfFiveOdds`; the score-only path reads it from a table,
  `fiveSetOdds`, within 2·10⁻⁵). Sackmann's own conversion treats the sets as independent: his
  81.4% favourite over three sets is 86.7% over five. Under day form a player's sets are not
  independent, so the favourite gains less: 84.1%.
- **Checked against real matches** (`scripts/tennis-formats-real.mjs`, 2026-11-10: every
  completed best-of-five match of 1968–2025 between men with twenty rated matches behind them,
  each player's Elo before the match by Tennis Abstract's method, `scripts/lib/tennis-elo.mjs`,
  whose `rateMatches` takes a `before` hook for it):

  | Matches | Elo's best-of-three odds | Day form over five sets | Independent sets | Favourite won | Fifth set: model, independent, real | Straight sets: model, real |
  | --- | --- | --- | --- | --- | --- | --- |
  | The majors, 25,005 | 71.7% | 73.6% | 75.3% | 72.0% | 20.8%, 28.5%, 19.2% | 48.0%, 48.2% |
  | The Davis Cup to 2018, 4,928 | 72.1% | 73.9% | 75.7% | 71.4% | 20.7%, 28.3%, 20.7% | 48.2%, 48.9% |

  Day form, fitted on best-of-three matches, sends as many rubbers to a fifth set as went there,
  where independent sets would send half as many again. The favourites' wins sit between Elo's
  best-of-three odds and day form's: Elo overrates a favourite by two or three points in best of
  three too (the tour's best-of-three matches of 2000–2025: 68.1% expected, 65.7% won), so the
  gain over five sets is about day form's.
- **Advantage sets.** A set without a tie-break is played game by game until a side is two
  clear (6–4, 9–7, 13–11), with the same hold and break model; its odds are exact
  (`setChance(pA, pD, false)`: level at five all, the server holds and breaks before the
  receiver does), and the two servers split their difference for it as for a tie-break set, so
  the set is still won with the day's set chance. A set that reached 70 games all would end in a
  tie-break (`MAX_SET_GAMES`), past the longest ever played (Isner–Mahut's 70–68 at Wimbledon in
  2010); between equal men a set level at five all goes on two more games about seven times in
  ten. The feed shows such sets as played: "SET 3 — Gilbert/Annacone (USA) 13–11",
  "SINGLES — John McEnroe (USA) 4–6 6–3 6–3 4–6 6–4".
- **The clock.** Twenty units a rubber, as today; a best-of-five rubber's units last 113 ms
  rather than 70, as its games are 1.6 times as many between equal men (the model's own: 39.2
  with a tie-break in every set, 39.6 without one in the fifth and 43.6 with none, against
  today's 24.4), so a tie of 1985 lasts 6.8 to 11.3 seconds at normal speed where today's lasts
  4.2 to 7. The setup's estimate of a campaign reads the season's clock.
- **The live chart** is the same exact model over five sets: a rubber's chance after its sets
  weighs each day-form node by how likely it made them, then the sets it still needs
  (`bestOf: 5` on the saved model; today's model is unchanged).

**Realism** (`npm run simulation:realism`, its "The cups by year" part: each season's sixteen
strongest nations, each pair once a season, 40 seasons, 4,800 ties; real: the World Group's live
best-of-five singles in the match files, a dead rubber having been shortened to best of three or
not played):

| Measure | 1985 | Real, 1981–1988 | 2005 | Real, 1989–2015 | 2017 | Real, 2016–2018 |
| --- | --- | --- | --- | --- | --- | --- |
| Rubbers to a fifth set | 21.0% | 21.3% | 22.5% | 20.3% | 21.0% | 24.4% |
| Rubbers in straight sets | 48.8% | 50.0% | 45.3% | 50.0% | 47.9% | 36.9% |
| Sets that reached 6–6 | 18.5% | 12.8% | 18.9% | 16.5% | 18.0% | 18.2% |
| Sets past 7–5 ending 8–6 / 9–7 / longer | 32.2 / 21.9 / 45.9% | 34.9 / 24.7 / 40.3% | 33.4 / 20.4 / 46.2% | 37.7 / 18.9 / 43.4% (fifth sets) | — | — |
| Ties decided 3–0 / 3–1 / 3–2 | 37.2 / 37.4 / 25.4% | — | 26.9 / 38.4 / 34.7% | 34.9 / 35.7 / 29.4% | 21.3 / 41.5 / 37.1% | — |
| The longest set | 30–28 | 21–19 | 26–24 (a fifth) | 17–15 | — | — |

The real samples (`scripts/tennis-formats-real.mjs`): 390, 1,721 and 160 rubbers; 1,448, 6,373
and 620 sets; 186 sets and 53 fifth sets past 7–5; 613 ties of 1989–2015 whose live rubbers say
when they were decided (before then dead rubbers were not yet shortened in every tie, and the
files hold no doubles). Their fields are whole World Groups, not the game's sixteen strongest of
one season. Fewer sets reached 6–6 in the 1980s than in the model: it plays every year at today's
serve (64% of points won), and the serve won less then. Best of five makes favourites surer: by
the live model's exact odds at the first serve, the favourites of 1985's sixteen win 82.0% of
their ties, where today's ties between the same men would give them 80.5% (2005's: 72.8% and
71.2%).

## Interface

- **Setup.** A Tennis card with a racket icon. Tennis is nations only (`nationsOnly` on the
  sport): the Clubs choice is off, a challenge link's `teams=clubs` is ignored, and the
  Season choice lists 2026 and the 66 earlier seasons back to 1960 (see Earlier seasons).
- **Squad.** A court from above: the No. 1 and No. 2 at the near baseline, the doubles pair
  across the net. The list groups Singles and Doubles, a player who doubles up appears in
  both, and a note says so. The profile reads Singles and Doubles, as does the tale of the
  tape before a tie. Each player's source is "Tennis Abstract Elo", with his raw Elo in the
  title and a link to his page.
- **Tactics.** A reserve supports Attack and Defend at half weight either way
  (`SUPPORT.tennis`); the options work as in the other sports.

## Realism

`npm run simulation:realism` plays the sixteen strongest nations against each other, each
pair once a season, 40 seasons (4,800 ties), in today's ties (an earlier year's format has its
own table, [Format by year](#format-by-year)):

| Measure | Model | Real |
| --- | --- | --- |
| Ties won 3–0 / 3–1 / 3–2 | 26.8% / 41.0% / 32.2% | — |
| Rubbers to a third set | 36.0% | about 35% of the ATP's best-of-three matches |
| Sets decided in a tie-break | 18.6% | 19.1% of the ATP's sets |
| Sets won 6–0 | 1.6% | 2.0% of the ATP's sets |
| Favourite wins the tie | 72.1% | — |
| Host wins, Home advantage on | 58.1% (49.7% neutral) | 60.9% where Elo expected 53.1% |

The rubber odds are Elo's by construction, so who wins a rubber is as well calibrated as
Tennis Abstract's ratings are. The tie scores, the tie-break share and the favourites' share
have no real figure here: real Davis Cup ties often play their dead rubbers, which hides when a
tie was decided. The tour's set scores come from Jeff Sackmann's match files, counted on
2026-11-08 for the women's game (docs/design/womens-tennis.md): the ATP's 9,454 completed
tour-level best-of-three matches of 2022–2025 went to a third set 35.9% of the time, and their
sets to a tie-break 19.1% and 6–0 2.0%; its servers won 64.0% of their points and held 79.9% of
their games, the serve the model plays.

## Tests

`scripts/tennis.test.mjs`: the data rebuilds byte for byte; every rating is Elo / 25 + 4; who
is left out and why; the lineup and its doubling; holds, tie-breaks and sets, the same
whoever serves first; Elo's odds kept with day form, and about a third of rubbers to a third
set; 2,000 ties in the Davis Cup's order with a feed that adds up; the fast path and the full
tie agreeing seed for seed; walkovers; the copy and the clock; the live chart against the odds
and moving only with sets and rubbers; setup with nations only and challenge links; the court;
the running App launching, playing a tie and saving it. `scripts/home-advantage.test.mjs` and
`scripts/simulation-realism.test.mjs` hold the host's edge; `npm run smoke` adds a Davis Cup
campaign of Europe with the live ticker.

`scripts/tennis-formats.test.mjs` holds the formats by year, the women's too: each year's format
and the one sport object a format; advantage sets (exact odds against game-by-game play, their
serve edge, no tie-break, about a fifth playing on past 7–5); best of five (the formula, Tennis
Abstract's 81.4% example both ways, the table, Elo's odds over five sets, fifth and straight sets
as day form expects, rubbers played out given their result); the clock's pace against the games;
the built-in season's ties pinned to the ones played before (their SHA-256); a 1985 tie of best-of-
five advantage sets and a 2005 one with the fifth set alone untied; the Fed Cup's three rubbers,
the No. 2s first, and its doubles last; the live chart's start at the odds, its exact posterior
after each set of a best-of-five rubber, a three-rubber tie's ticks; the clock and the feed's
"rubber 2 of 3"; the running App playing a 1985 season best of five, saving and resuming it, and
a women's 1985 season in three rubbers.

## Known limits

- No doubles ratings: a pair is its players' singles mean, so doubles specialists (Bolelli and
  Vavassori, Granollers, Pavić) are not in the game, and a nation's No. 3 and No. 4 play its
  doubles.
- The built-in season is 2026, as of Tennis Abstract's update of 2 November; the earlier
  seasons have their own limits (Earlier seasons, below).
- Men only here: the women play the Billie Jean King Cup as a sport of their own, on these rules
  with the WTA's serve ([women's tennis](womens-tennis.md)).
- No surfaces: a host's choice of surface is in the home edge, not played. The snapshot keeps
  each player's hard, clay and grass Elo for that.
- Players by the country Tennis Abstract files them under, not by Davis Cup nominations.
- Every year at today's serve: an earlier season's sets reach 6–6 more often than they did
  (18.5% in the model's 1985, 12.8% in the World Group of 1981–1988). The day form and the
  hold-and-break model are today's too; only the format is the year's.
- The Davis Cup's three days are not played apart: one match-day form for the tie, as today's
  two days. Dead rubbers are not played, though they were in every year.

## Earlier seasons

Status: built 2026-11-08; 1960–1972 added 2026-11-09 (Before 1973, below). The Season choice
lists 66 earlier seasons, 2025 back to 1960, each the ATP's men at the end of a year (before
1968 the amateurs') and the Davis Cup nations of that day, nations only (set ids
`tennis-<year>`, kind `elo`, `public/tennis/tennis-<year>.json`). The user chose the
sources (2026-11-08): Tennis Abstract's own published lists where they exist, and earlier
years computed from Jeff Sackmann's match results by Tennis Abstract's published method, on
today's scale and labelled as computed. The women's seasons are built by the same scripts
with `--tour=wta` ([womens-tennis.md](womens-tennis.md), "Earlier seasons"); the men's
rebuild byte for byte. Since 2026-11-10 each season plays its year's Davis Cup format
([Format by year](#format-by-year)).

### Sources

- **2016–2025: Tennis Abstract's year-end reports**, as the Wayback Machine archived them (the
  last capture of each before the next update): 12 December 2016, 20 November 2017 (the report
  was not updated again that year, so the list stops at the ATP Finals and never took in the
  Davis Cup final: "Tennis Abstract Elo, through the ATP Finals"), 24 December 2018,
  2 December 2019, then 28, 27, 26, 25, 23 and 29 December 2020–2025. Labels read "Tennis
  Abstract Elo, December 2023". Every Elo is Tennis Abstract's, unchanged.
- **Countries** of the published seasons come from Tennis Abstract's ATP rankings report, by
  player key, from the capture nearest the list's date (nine captures, December 2016 to
  January 2026: Alejandro Tabilo is Canadian in 2019 and Chilean from 2020), else from
  Sackmann's player file. Tennis Abstract renamed some keys (`StanislasWawrinka` /
  `StanWawrinka`, `TaylorHarryFritz`, `CarlosAlcarazGarfia`, `DiegoSebastianSchwartzman`,
  `FrancisTiafoe`, `SamuelGroth`, `ChakLamColemanWong`, and ten full names of its 2019–2020
  lists such as `MarceloTomasBarriosVera`): `keyAliases` joins each to its current key, which
  also finds the man in the match files (a key is his name) and links his page.
- **1973–2015: Elo computed** from Jeff Sackmann's ATP match results, 1968 to 2025: the
  tour-level files (with the Davis Cup) and the challenger and qualifying files from 1978. The
  original repository is gone; its fork
  [Kadantte/tennis_atp](https://github.com/Kadantte/tennis_atp) at commit `712be0c` (Sackmann's
  own last commit, 8 June 2026) is pinned, and the Hugging Face mirror
  `Aneeshers/tennis-sackmann-archive` holds the same bytes. Labels read "Elo from match results,
  end of 1985"; the player's source is "Elo from match results", with his Elo in its title.
- **Pins.** `scripts/data/tennis-seasons.json` holds the SHA-256 of all 108 archive files (the
  amateur file of Before 1973 among them) and 19 captures. The captures are the Wayback Machine's raw pages (`id_`): the 2016–2019 reports
  match the archive's own SHA-1 digests, the 2020 one's gzipped page matches its digest and
  decodes to the pinned bytes, and fresh downloads of 2021–2024 and of five rankings captures
  match their pins (the 2025 report could not be fetched again: the archive was throttling).
- **Licence.** Sackmann's data and Tennis Abstract's reports are CC BY-NC-SA 4.0 (credit "Jeff
  Sackmann / Tennis Abstract", non-commercial, share alike), as the 2026 season already is; the
  computed ratings are derived data under the same terms. Each season's `source.licence` says
  so, and `public/tennis/ATTRIBUTION.txt` credits both. The non-commercial clause binds the game:
  serving these seasons on pages that carry advertising is a question for the owner.

`npm run sync:tennis-seasons` (`scripts/sync-tennis-seasons.mjs`) reads the pinned inputs from
the ignored `data-src/tennis-seasons/` (downloading any that are missing, checked against their
pins) and writes one snapshot a season to `scripts/data/tennis-seasons/<year>.json` (1.6 MB in
all, committed: every rated man with his key or match-file id, name, nation of the day and how
it was found, birth date, Elo and matches, the published ones with their surface Elos too) and
`validation.json`. `npm run build:tennis-seasons` (`scripts/build-tennis-seasons.mjs`) builds the
season files, `src/data/tennisSeasons.js`, the attribution and
`docs/design/tennis-seasons-audit.json` from them. Both have `--check` and rebuild byte for byte.

### The method

`scripts/lib/tennis-elo.mjs`, from Sackmann's own descriptions (Tennis Abstract posts of
2015–2024; the parameters and their sources are in the manifest's `method`):

- the expected score is `1 / (1 + 10^((opponent − player) / 400))`, and K is
  `250 / (n + 6)^0.4`, n the matches the player has already played, with no bonus for the
  majors (an offset of 6 fits Sackmann's worked example and his February 2016 report);
- counted: tour-level main draws with the Davis Cup, tour-level qualifying and challengers'
  main draws, as his report says ("tour-level, tour-level qualifying, men's challenger"); never
  a walkover, retirement, default or abandoned match, nor a challenger's qualifying (the files
  hold whole qualifying draws in 2018 and from 2022: counting them lists some 180 men a season
  his report does not, and lifts the modern lists by 20 to 40 points);
- a new player starts at 1450 if his first counted match is at tour level, 1275 if it is a
  challenger or a tour-level qualifying round. Sackmann gives no figure ("the low 1200s,
  depending on the level") and the public files lack the history before 1968, so these are
  fitted: on Tennis Abstract's own current-method numbers for 1973–2000, the 20 career peaks of
  its Tennis 128 profiles that fall then and the 18 yElo seasons of its best-seasons table, the
  computed values are 2.0 Elo low on average, root mean square 15.1 (1970s −1.2, 1980s −1.6,
  1990s −4.7). A start of 1300 fits 1973–2000 about as well (+1.3) but puts the 2000s and
  2010s 44 points high; 1250 leaves the 1990s 15 low;
- a layoff of eight weeks or more (15 November to 15 January not counted) costs 100 points,
  rising linearly to 150 at a year, when the player returns; K is then 1.5 times as large, back
  to normal over 20 matches; a second layoff within two years of the last comeback is charged
  the difference. A list shows a player in the middle of a layoff with the penalty he would be
  charged on its date, as Tennis Abstract's does: Hubert Hurkacz, away since June 2025, is
  listed 117 points under his rating at the end of 2025 (1869; Tennis Abstract's list has 1821,
  the usual offset apart, where without the penalty he would be 128 points out of line). Only
  players rated 1900 or more are charged, the population Sackmann studied: charging everyone
  lowers every list by 100 to 200 points against everything Tennis Abstract has published;
- a season ends after its last event as the files group them: the Masters played in January
  1978–1986 belongs to the year before, and an event starting on 29 December to the next;
- a season lists the men with ten counted matches in it, as Tennis Abstract's report has listed
  those with ten in the last 52 weeks since 2020. The published seasons keep the men of its list
  who pass the same test (the 2026 build's ATP-rank rule cannot be applied: the rankings
  captures are too sparse for 2021–2023).

**Validation** (`scripts/data/tennis-seasons/validation.json`; the Elo of the same men,
computed minus published, over Tennis Abstract's top hundred):

| List | Matched | Mean difference | Correlation | Slope | Top ten shared | Listed by both |
| --- | --- | --- | --- | --- | --- | --- |
| 2016, pre-2018 method | 99 | −2.8 | 0.999 | 1.00 | 9 | 143 of 147 |
| 2017, pre-2018 method | 99 | +4.9 | 0.997 | 1.01 | 9 | 162 of 171 |
| 2018, tour level only | 95 | +41.5 | 0.942 | 1.14 | 9 | 166 of 183 |
| 2019 | 100 | +43.7 | 0.989 | 1.07 | 8 | 403 of 404 |
| 2020 | 100 | +20.9 | 0.956 | 0.86 | 8 | 296 of 296 |
| 2021 | 100 | +28.3 | 0.987 | 1.00 | 9 | 384 of 384 |
| 2022 | 100 | +33.3 | 0.973 | 1.07 | 9 | 444 of 444 |
| 2023 | 100 | +35.1 | 0.996 | 1.04 | 9 | 455 of 456 |
| 2024 | 100 | +38.8 | 0.977 | 1.02 | 9 | 481 of 482 |
| 2025 | 100 | +31.1 | 0.982 | 1.01 | 10 | 491 of 498 |

The 2016 and 2017 rows run the same engine with the method Tennis Abstract used before May 2018
(tour-level matches only, everyone starting at 1500, no layoff penalty): it reproduces those
lists to 6.6 and 8.1 points on average, a check of the engine itself (the research's own
reconstruction, `data-src/research/tennis/computed-elo-from-sackmann`, matched them to 1.5–7
points after a constant 12). The current method's rows compare its own numbers with Tennis
Abstract's: over every man of the 2019–2025 lists the correlation is 0.994–0.999 and the slope
0.95–1.02. The seasons' records come out as Tennis Abstract's (Borg 84–5 in 1979, Lendl 105–9
in 1982) in 27 of its 30 best seasons.

**Scale.** The computed ratings agree with Tennis Abstract's for 1973–2000 (−2 Elo), but sit
about 30 points above its numbers from 2005 on: its yElo seasons and Federer's, Nadal's and
Djokovic's peaks (+29 on average), and its 2019–2025 lists (+21 to +44 over the top hundred).
The offset is uniform (slopes near 1): it moves a season's ratings by about a point together
and no match's odds, which depend on rating gaps alone. A rating is the Elo on the game's
scale, `round((Elo + 100) / 25)`, as in 2026. Where a season's best player would be over 99
(Borg's 2466 in 1980 is 103) the whole season is shifted down until he is 99, which keeps every
gap and so every match's odds where a cap would not: 1979 (3), 1980 (4), 1981 (2), 1984 (3),
1986 (1), 1987 (1), 2013 (1), 2014 (1), 2015 (4), and the pre-2018 lists 2016 (5: Djokovic
2508) and 2017 (2). The shift is the season's `source.shift`; each player keeps his Elo as
`rawRating`.

### Nations of the day

`scripts/lib/tennis-seasons.mjs`. A computed season's player plays for the nation he played the
Davis Cup for in the nearest season (the same, then earlier, then later, within six), read from
the ties' names in the match files ("Davis Cup WG F: USA vs AUS"; 16 rubbers place neither
player), else for his country by Sackmann's player file, which gives only his latest: Ivan
Lendl is American there, Czechoslovak here until 1991. Combined teams (the Caribbean, the
Eastern Caribbean, Pacific Oceania) say nothing of a player's own country: his file does. The
code is then that season's state's:

| Federation | Years | Plays on the map as | Holds |
| --- | --- | --- | --- |
| Czechoslovakia | to 1992 | Czechia | Slovakia |
| Soviet Union | to 1991 | Russia | the other fourteen republics |
| CIS | 1992 | Russia | ten republics (not the Baltic states, not Georgia) |
| Yugoslavia | to 1991 | Serbia | Croatia, Slovenia, Bosnia, North Macedonia, Montenegro, Kosovo |
| FR Yugoslavia, Serbia and Montenegro | 1992–2006 | Serbia | Montenegro, Kosovo |
| Serbia | 2007 | Serbia | Kosovo |
| West Germany | to 1990 | Germany | — |

A federation's other shapes start in its holder's empire when it fields a team that season.
After a federation a player passes to his own successor nation (Ivanisevic is Croatian from
1992), an emigrant to his own country. East Germany fielded no Davis Cup team: its men play for
nobody before 1991. A nation barred from the Davis Cup fields no team and its land is neutral:
South Africa 1979–1992 (the files' ties stop in 1978 and resume in Group II in 1993) and FR
Yugoslavia 1993–1995 (United Nations sanctions; back in Group II in 1996). Hand fixes for men
who changed country with no Davis Cup row to show it (`nations.fixes`): Johan Kriek South
African to 1981, Kevin Curren to 1984, Greg Rusedski Canadian to 1994, Mikhail Kukushkin and
Andrey Golubev Russian to 2007. Great Britain plays as one, as in 2026. A nation needs two rated
men; countries the map does not draw (Monaco, Hong Kong, Barbados…) field nobody.

Since 2026-11-10 the game shows a federation under its own name and flag in its years
(src/data/namesOfTheDay.js, [Earlier maps](historic-maps.md)): Czechoslovakia to 1992, the Soviet
Union to 1991, the CIS in 1992, Yugoslavia to 1991, FR Yugoslavia to 2002, Serbia and Montenegro
to 2006, West Germany to 1990 and the United Arab Republic (Egypt) to 1971. The season files
are unchanged (the names are the game's, by year), and the audit names both ("Czechoslovakia
(Czechia) 87.4" in 1985). Until then it showed the holder's name and flag (Czechia, Russia,
Serbia, Germany). East Germany is on the map of every season to 1990, its land neutral.
South Vietnam's Davis Cup team of 1964 and 1965 plays on its own land, Vietnam cut at the
17th parallel to 1975 (`nations.dayNations`). Rhodesia (to 1979) still plays under
Zimbabwe's name and flag: its flag of the day is too large a drawing to ship.

### Before 1973

Built 2026-11-09, when the user asked for every sport's missing years and the 1960s and 1970s.
Thirteen seasons, `tennis-1960` to `tennis-1972`: 1960–1967 the amateurs alone, labelled
"Amateur Elo, end of 1962 (rough)", 1968–1972 the open era, "Elo from match results, end of
1970 (rough)". Their source says `computed`, `rough`, `amateurs` before 1968, and the method
"Tennis Abstract's published Elo method, warmed up on Jeff Sackmann's majors and Davis Cup
results of 1877-1967". Claude's choices (2026-11-09), under that request, approved by the user with
the release of 2026-11-10: back to 1960, the floor the user set for the NBA's, MLB's, NFL's and NHL's
computed seasons (the file would allow 1950); a run of their own, so that 1973–2025 stay byte
for byte as shipped; every rated man in 1968–1972, contract professionals too, as from 1973;
three counted matches a season before 1968; Wikipedia's published top tens pinned as validation
inputs only; South Africa barred 1970–1972; Drobny's fix; the duplicate ids reviewed and
committed.

**Sources.**

- **Sackmann's amateur file**, `atp_matches_amateur.csv`, from the same pinned commit
  (`712be0c`, SHA-256 `2edfa7ab…`, 3,936,333 bytes; the same git blob is in
  `Aneeshers/tennis-sackmann-archive` at `8373358`): 25,001 rows, 1877–1967, of two levels
  only, the majors (20,201) and the Davis Cup rubbers (4,800), every tie named with its two
  sides ("Davis Cup EUR R1: AUT vs FIN"). Each row stops after 40 of the header's 49 cells and
  is padded when read; it has two rounds of its own (PR, a preliminary round; CR, Wimbledon's
  challenge round to 1921 and the US Championships' to 1911). Licence as above (CC BY-NC-SA
  4.0); `public/tennis/ATTRIBUTION.txt` names the file. It holds about a third of a leading
  amateur's matches, and no professional's: Tennis Abstract's own 1957–1967 database, with the
  pro tours, is on its site only, behind paths its robots.txt disallows.
- **The open era's files**, 1968–2025, as the first run reads them.
- **Validation only** (the manifest's `checks`; nothing from them is in a season file):
  Wikipedia's "Top ten ranked male tennis players (1912–1972)", revision 1379999545 (13 October
  2026, CC BY-SA 4.0), whose lists for 1960–1972 are Lance Tingay's (The Daily Telegraph: the
  amateurs' ten to 1967, everyone's from 1968); each name is kept with its match-file id, joined
  by hand (Pancho Gonzales is "Richard Gonzalez" in the player file, Jan-Erik Lundqvist "Jan Erik
  Lundquist"). They match Tingay's columns on the article page of that revision, fetched once
  under `/wiki/`, which Wikipedia's robots.txt allows (SHA-256 `c6e6c9b0…`). The research pass
  had first read them from the raw wikitext through `/w/index.php`, a path robots.txt disallows;
  nothing here uses that copy or fetches `/w/`. Where Tingay ranked men equal at the foot of his
  list the page's first is kept (1967's tenth place is Leschly's, shared with Bungert and
  Drysdale). And Tennis Abstract's own words in The Tennis 128: Newcombe fourth at the end of 1968, behind
  Laver, Rosewall and Ashe, and again in 1969, behind Laver, Roche and Okker; Rosewall behind
  Laver at the end of 1970; Laver's peak of 2,571 in 1970.
- **Facts for the nations rules**, from Wikipedia (the revisions are in the manifest's `why`):
  the article pages of Drobný, Mulligan, Hewitt and Letcher, fetched once each under `/wiki/`,
  which robots.txt allows, and the article page of "Sporting boycott of South Africa during the
  apartheid era" at the revision the manifest cites, fetched the same way, for South Africa's
  ejection from the 1970 Davis Cup (the research pass had read it through `/w/api.php`, which
  robots.txt disallows).

**The method.** `method.early`: a second run of the same engine, kept apart from the first. It
reads the amateur file before the open era's files and changes four things:

- **Newcomers of the amateur file start at 1360**, fitted to five points so that the run carries
  on as the shipped one: on Tennis Abstract's 38 targets for 1973–2000 it comes out −2.0 Elo,
  root mean square 15.3 (the shipped run −2.0 and 15.1), and over the shipped run's top 50 of
  each season 1973–1980 its Elo of the same men is within 0.3 to 3.0 points on average (in all
  −1.2 to +2.6). 1350 leaves those seasons up to 4.8 points under the shipped run, 1450 (the
  open era's start) 18 to 30 over it. The research pass had fitted 1350 before the 24 open-era
  aliases below; with them 1360 fits.
- **Layoffs.** A gap that begins before 1 January 1968 is charged only when it also ends before
  it and lasts 26 weeks or more, on the shipped scale: the file holds a third of an amateur's
  matches, and the eight-week rule charges nearly all of them. Against Tingay's tens of
  1960–1967 the mean rank correlation is 0.66 with eight weeks, 0.64 with 13, 0.70 with 26,
  0.67 with 39 and 0.67 with no charge. A gap across that date (a professional coming back in
  1968: Laver last played an amateur match in 1962) is never charged.
- **Activity.** 1960–1967 list the men with three counted matches in the season (a floor of
  ten leaves six to eight nations a season, five 15 to 20, three 23 to 30); 1968–1972 ten, as
  from 1973.
- **Duplicate ids.** 225 pairs, reviewed by hand and committed (`method.early.aliases`), each
  merged into the id of the same man before rating: 200 ids of the amateur file with Davis Cup
  rows only (Edison Mandarino's joins Jose Edison Mandarino's, Alfred Huber's Freddie Huber's)
  and 25 amateur ids of men who carry on under another id in the open era (John McDonald, Paul
  Sullivan). Each pair shares a country and careers no more than two seasons apart unless the
  birth dates agree, by the same full name, surname and initial, surname and birth date, or
  (fourteen, by hand) a variant of the first name or, for two, of the surname. Those two had
  each put one man in a squad twice until a second search, for surnames spelt two ways, found
  them: Julie Mayer, "Julius Mayer" in South Africa's ties of 1961 and "Julian Mayers" at the
  majors (Wikipedia's article on him names both), and András Szikszay, "Szikszai" at the
  majors, twice in Hungary's squad of 1967. The open era's id is kept. Never
  merged: two ids in one event, and men told apart by first name or birth date (the Ulrichs,
  the Frasers, the Amritraj and Dell brothers, Vo Van Bay and Vo Van Thanh). The sync checks
  every pair again (both in the player file, no chain, a shared country, no shared event), and
  1,498 rows move.

Each season lists its men strongest first; the nations of the day come from the same run's
Davis Cup rows, aliases applied (31 rubbers place nobody). Nothing needs a shift: the best is
Laver's 2,269 at the end of 1970, rating 95.

**Validation** (`validation.json`, `early` and `checks`):

| Season | Rated | Nations | Best (rating) | Strongest three | Tingay's ten shared | Rank correlation |
| --- | --- | --- | --- | --- | --- | --- |
| 1960 | 111 | 23 | Neale Fraser (85) | Australia, United States, Italy | 7 | 0.87 |
| 1961 | 119 | 25 | Neale Fraser (84) | Australia, United States, Italy | 8 | 0.33 |
| 1962 | 129 | 28 | Rod Laver (89) | Australia, United States, Italy | 6 | 0.73 |
| 1963 | 134 | 28 | Roy Emerson (85) | United States, Australia, Mexico | 6 | 0.81 |
| 1964 | 119 | 27 | Roy Emerson (89) | Australia, United States, Sweden | 8 | 0.67 |
| 1965 | 125 | 24 | Roy Emerson (88) | Australia, United States, Spain | 7 | 0.68 |
| 1966 | 131 | 29 | Roy Emerson (87) | Australia, United States, Spain | 8 | 0.83 |
| 1967 | 141 | 30 | Roy Emerson (87) | Australia, United States, South Africa | 7 | 0.68 |
| 1968 | 184 | 23 | Rod Laver (89) | Australia, United States, Spain | 6 | 0.76 |
| 1969 | 136 | 17 | Rod Laver (94) | Australia, United States, Spain | 8 | 0.49 |
| 1970 | 137 | 19 | Rod Laver (95) | Australia, United States, Spain | 7 | 0.48 |
| 1971 | 156 | 20 | Rod Laver (92) | Australia, United States, Spain | 9 | 0.39 |
| 1972 | 168 | 22 | Ilie Nastase (92) | United States, Australia, Romania | 7 | 0.81 |

1960–1967 share 7.1 of Tingay's ten a season (rank correlation 0.70), 1968–1972 7.4 (0.59);
every man on his lists is rated in his season. Without the warm-up (the first run, everyone new
in 1968) 1968 has Ashe first, Laver second and Newcombe thirteenth, sharing four of the ten;
with it Laver, Rosewall, Roche, Ashe, then Emerson, Newcombe sixth. Tennis Abstract's year
ends come out Laver 1, Rosewall 2, Ashe 4, Newcombe 6 in 1968 (its 1, 2, 3, 4), Laver 1, Okker
2, Roche 5, Newcombe 8 in 1969 (its 1, 3, 2, 4) and Laver 1, Rosewall 2 in 1970 (its order).
Laver's peak is 2,329 (20 September 1969) against Tennis Abstract's 2,571, which counts the pro
tours these files lack. The Davis Cup bears the nations out: Italy, third in 1960, lost that
year's Challenge Round to Australia; Mexico (Osuna) is third in 1963 and fifth in 1962, the year
it reached the Challenge Round; the United States and Australia lead every season; Romania,
the finalist of 1969, 1971 and 1972, is fourth, fourth and third. In 1973–1980 one man
sits far from the shipped run, Tony Roche (up to 100 points in 1977): a layoff the 1900
threshold charges in one run and not the other.

**Nations of the day, 1960–1972.** The rule above, from the second run's Davis Cup rows. West
Germany's ties read GER until 1960 and FRG from 1961, both West Germany. The Soviet Union's
first cup was 1962, so Russia holds the other republics from then (a nation of one before).
Rhodesia plays as Zimbabwe when it has two rated men; the Caribbean's combined team sends its
men to their own countries. Monaco and Hong Kong are off the map. Additions:

- **South Africa is barred 1970–1972**: ejected from the 1970 cup and banned indefinitely; the
  files have none of its ties in those years and have them again from 1973. Drysdale, Hewitt
  and seven more play for nobody in 1970.
- **Fixes**: Jaroslav Drobný plays for Great Britain from 1960 (Czechoslovak to 1950, Egyptian
  1950–1959, British after; his file says Czechoslovak and his ties end in 1949); Martin
  Mulligan for Australia to 1967 (his only ties are Italy's of 1968, which the six-season window
  would reach back to 1962); Bob Hewitt for Australia to 1966 (South African from 1967, the year
  his ties start); Cliff Letcher for Australia to 1972 (he accepted Austria's Davis Cup offer in
  November 1974 and played its ties of 1977, which made him Austria's best man of 1971). The
  fix stops at 1972, so the shipped 1973 and 1974 still make him Austrian by the window.

**Limits.**

- **A third of the amateurs' matches.** Veterans with a few matches keep old ratings (Seixas
  ninth in 1962 on four matches, Drobný tenth in 1960 on three); 1961 agrees worst with Tingay
  (0.33).
- **No professionals before 1968**: Rosewall, Gonzales, Hoad, Laver from 1963 and the rest of
  the pro tours are missing, true to the Davis Cup, which barred them; from 1968 they are back
  in every season though the cup barred contract professionals until 1973.
- **Two tuned parameters**, the start of 1360 and the 26-week layoff, documented, not
  published; the seasons' level cannot be checked against Tennis Abstract's.
- **The nearest-season rule** can still make a man his later nation's up to six seasons early
  where no fix says otherwise; the cases a review of 1960–1972 found are fixed (Mulligan, Hewitt,
  Letcher).
- **The second run is not the first**: its 1973 differs from the shipped 1973 by about two
  points on average, so a 1972 player and his 1973 self come from two runs.

### Tests

`scripts/tennis-seasons.test.mjs`: the build and (with the inputs cached) the sync rebuild byte
for byte; every input pinned, the amateur file among them; the listing, 2025 back to 1960, and
its labels; every season decodes, two to five men a nation, each rating his Elo on the game's
scale less the season's shift, the best at 99 where shifted; Borg and Djokovic shifted; 1985's
Czechoslovakia holding Slovakia with Lendl, West Germany with Becker, South Africa barred with
Kriek and Curren out of the game in 1980; the Soviet Union, the CIS and Croatia in 1990–1992;
FR Yugoslavia barred and Kosovo's years; the nation-of-the-day rules and fixes; Tennis
Abstract's own lists and countries (Tabilo); the validation thresholds; before 1973, the
second run's snapshots (three or ten counted matches, no man twice), the professionals absent
until 1968 and Laver first in 1968–1970, the alias list, Mandarino, Mayers and Szikszay merged
and the Ulrichs not, no nation naming one man under two spellings of his surname, South Africa
barred 1970–1972 with Drysdale and Hewitt out, the Soviet Union from 1962, the Drobný,
Mulligan, Hewitt and Letcher fixes, and the fit, seam and top-ten thresholds; the loader
refusing damaged files; the running App listing the seasons, loading one, launching 1985 with
Slovakia in Czechoslovakia's empire and 1962 with Ukraine in the Soviet Union's, and resuming
the saves; and a challenge link to a season.

### Limits

- **1960–1979 are rough**, and their labels say so. 1973–1979 start from nothing in 1968 (the
  first run does not read the archive's amateur file), and starting them in 1970 instead moves
  the 1975 list by about 48 points and reorders it more than later seasons; 1960–1972 have
  limits of their own (Before 1973).
- **No surfaces for the computed seasons.** The published ones keep Tennis Abstract's surface
  Elos (2017–2018 single-surface, 2019–2025 blended); the game plays none of them.
- **Nation changes.** A man who changed country with no Davis Cup row before the change plays
  for his later country from his first season, unless he is among the fixes. The 1980 Davis
  Cup is only half in the files.
- **Russia and Belarus** play in 2022–2025, as in 2026 by the user's choice, though barred from
  the Davis Cup since 2022, unlike South Africa and FR Yugoslavia in their years.
- **The scale offset** of the computed method after 2000 (about +30 Elo, above).
- **2018** is Tennis Abstract's list of that year, computed from tour-level matches only (its
  challengers came in in January 2019): 183 men, 166 of them with ten counted matches.
