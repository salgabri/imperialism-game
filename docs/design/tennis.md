# Tennis

Status: implemented 2026-11-08. A seventh sport, played by the rules of the Davis Cup: two
nations' teams meet in a tie of five rubbers, first to three. Nations only, on the world map:
tennis has no clubs. Everything outside the match (territory, the draw, targeting,
conquest, signings, saves) is the game's own, unchanged. The women's game plays the same
rules as the Billie Jean King Cup, a sport of its own ([women's tennis](womens-tennis.md)).

The player chose the format and the data: the home-and-away ties' five rubbers (rather than
the Final 8's three, or the old best-of-five sets), and Elo ratings only, with nothing
estimated.

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

`src/sports/tennis.js`.

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

## Interface

- **Setup.** A Tennis card with a racket icon. Tennis is nations only (`nationsOnly` on the
  sport): the Clubs choice is off, a challenge link's `teams=clubs` is ignored, and the
  Season choice lists 2026 and the 53 earlier seasons back to 1973 (see Earlier seasons).
- **Squad.** A court from above: the No. 1 and No. 2 at the near baseline, the doubles pair
  across the net. The list groups Singles and Doubles, a player who doubles up appears in
  both, and a note says so. The profile reads Singles and Doubles, as does the tale of the
  tape before a tie. Each player's source is "Tennis Abstract Elo", with his raw Elo in the
  title and a link to his page.
- **Tactics.** A reserve supports Attack and Defend at half weight either way
  (`SUPPORT.tennis`); the options work as in the other sports.

## Realism

`npm run simulation:realism` plays the sixteen strongest nations against each other, each
pair once a season, 40 seasons (4,800 ties):

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

## Earlier seasons

Status: built 2026-11-08. The Season choice lists 53 earlier seasons, 2025 back to 1973, each
the ATP's men at the end of a year and the Davis Cup nations of that day, nations only
(set ids `tennis-<year>`, kind `elo`, `public/tennis/tennis-<year>.json`). The user chose the
sources: Tennis Abstract's own published lists where they exist, and earlier years computed
from Jeff Sackmann's match results by Tennis Abstract's published method, on today's scale
and labelled as computed.

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
- **Pins.** `scripts/data/tennis-seasons.json` holds the SHA-256 of all 107 archive files and
  19 captures. The captures are the Wayback Machine's raw pages (`id_`): the 2016–2019 reports
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

The game shows a federation by its holder's name and flag (Czechia, Russia, Serbia, Germany):
a season file has no way to rename a nation. The audit names both ("Czechoslovakia (Czechia)
87.4" in 1985).

### Tests

`scripts/tennis-seasons.test.mjs`: the build and (with the inputs cached) the sync rebuild byte
for byte; every input pinned; the listing, 2025 back to 1973, and its labels; every season
decodes, two to five men a nation, each rating his Elo on the game's scale less the season's
shift, the best at 99 where shifted; Borg and Djokovic shifted; 1985's Czechoslovakia holding
Slovakia with Lendl, West Germany with Becker, South Africa barred with Kriek and Curren out of
the game in 1980; the Soviet Union, the CIS and Croatia in 1990–1992; FR Yugoslavia barred and
Kosovo's years; the nation-of-the-day rules and fixes; Tennis Abstract's own lists and
countries (Tabilo); the validation thresholds; the loader refusing damaged files; the running
App listing the seasons, loading one, launching 1985 with Slovakia in Czechoslovakia's empire
and resuming the save; and a challenge link to a season.

### Limits

- **1973–1979 are rough**, and their labels say so: the ratings start from nothing in 1968 (the
  archive's amateur file, majors and Davis Cup only before the open era, is not used), and
  starting them in 1970 instead moves the 1975 list by about 48 points and reorders it more than
  later seasons.
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
