# League of Legends

Status: implemented 2026-11-16. The fourth esport and the fourteenth sport: League of Legends, as its playoffs are played.
Two nations' teams of five, one player in each role (top, jungle, mid, bot, support), meet in a series of games, best of
five; a game is won when the enemy Nexus falls. Nations only, on the world map, for now. Everything outside the match
(territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

It came in beside Valorant, the two esports whose results sites let the project's fetcher in (docs/design/valorant.md,
"Sources").

## Sources

League's results are read from [gol.gg](https://gol.gg) (Game of Legends), whose robots.txt shuts every agent out of its
rankings, summoner, admin and raw pages and none of what is read here. Leaguepedia answers the fetcher with a bot
challenge, and Oracle's Elixir shuts ClaudeBot out. The scripts fetch through `scripts/lib/polite-fetch.mjs`, one page at
a time and ten seconds apart (`PAUSE_MS`), and keep each page gzipped in `data-src/golgg/` (ignored by git).

1. `npm run sync:league-of-legends -- --fetch` reads the current season's tournaments (gol.gg's own listing, as JSON),
   each tournament's match list, and each series' page: the summary of a series of several games, or a single game's page.
2. Without `--fetch`, the sync reads only the cache, rates every player and writes
   `scripts/data/league-of-legends-elo.json`.
3. `npm run build-league-of-legends` writes the nations, `src/data/rosters.league-of-legends.js` (`--check` compares byte
   for byte).

The cache holds 211 of gol.gg's tournaments, 13 July 2025 to 14 November 2026: 4,865 series and 10,940 games. The first
fetch stopped short of 2024: after those 4,865 series pages, a second apart and newest first, gol.gg stopped answering the
fetcher's connections and had not answered again half an hour later, so the built-in ratings stand on the sixteen months
the cache holds. The earlier seasons are read another way, two pages a tournament rather than one a series, ten seconds
apart (below, "Earlier seasons"), and a `--fetch` of the built-in season now goes back no further than the current season.

A series of two games won one each has no winner, and the match list marks neither side's name: the reader took those rows
for no series at all until 2026-11-25. 22 such series of the built-in season's sixteen months are not in its ratings; the
next sync fetches their pages.

## Reading the pages

`scripts/lib/golgg.mjs` reads:

- **A season's tournaments**: each one's name, region (KR, CN, EUW, FR…, WR for the world stage), games and dates.
- **A tournament's match list**: each series' page, its two teams, the score, the stage and the date; a series of two
  games won one each, and (for the earlier seasons' line-ups) one of which gol.gg keeps only the score.
- **A players list** (a tournament's, or a season's): each player's games and wins there, his country, and his figures
  over those games: kills, deaths and assists a game, creeps, gold, damage and vision score a minute, and his shares of
  his team's kills, damage, gold and vision score. A tag gol.gg stored as UTF-8 read as Latin-1 is mended ("FÃ©nec" →
  "Fénec").
- **A teams list** (a season's): each team's games, wins, gold and damage a minute, kills, deaths and Barons a game, and
  the length of its games.
- **A series' summary**: its format (BO3, BO5), each game's winner and length in order, and both sides' players over the
  series (six on a side when a substitute played a game).
- **A single game's page**: both sides, the winner, the length, each side's kills, towers, dragons, Barons and gold, and
  the ten players in role order.
- **Every player gol.gg knows**, from the search box each page carries: his name and the two-letter code of his country.

## Ratings

`scripts/lib/league-of-legends.mjs` turns the pages into what the ratings play, and `scripts/lib/esports-elo.mjs` (shared
with Valorant) plays them, as docs/design/valorant.md describes: each game one Elo game between the sides' players, a side
at its players' mean, K = K_SCALE / (games + 5)^0.4.

- **Players.** A player is his gol.gg page (`gg:<id>`). A series' page lists its sides' players over the series, so a
  substitute who played one game counts in every game of it, beside the starter he replaced: the summaries give no game's
  own lineup. A side of fewer than five on its page is left out with its series.
- **Roles.** gol.gg lists a side's five in role order, top to support; a player's role is the one he played most where his
  side listed exactly five.
- **Circuits.** A circuit is gol.gg's region (KR, CN, EUW, FR, DE…) with its second tier apart ("KR-2": the LCK's academy
  league; "FR-2": the LFL's second division; Germany's "1st Div 2025" is its first), the NLC apart from the LEC (gol.gg
  files both under EUW), and the Pacific's multinational league (PCS, later LCP) and South America's of 2025 by name; the
  world stage (Worlds, MSI, the Esports World Cup, First Stand, EMEA Masters) and a promotion tournament between two
  divisions belong to none. A player's home circuit is the one he has played most games in.
- **Circuits' levels.** The leagues meet too seldom for Elo to place them: the LEC's teams never play the national leagues
  below it, the LCK's and the LPL's meet the rest only at the international events, and a closed pool's mean stays where
  its newcomers start. With every newcomer at 1500, the LFL's best stood above the LCK's. So a newcomer starts at his home
  circuit's level (`circuitLevels` in `scripts/lib/esports-elo.mjs`, `CIRCUIT_LEVELS`), fitted at once with every
  player's own strength: a player plays at his circuit's level plus his own offset (a normal prior of spread 150 Elo keeps
  the offset near 0 where his games say little), a side at its players' mean, a game won with Elo's odds; gradient ascent
  on that likelihood, the levels centred so that the players' mean is 1500 and, since 2026-11-21, held by a normal prior
  of their own, 500 Elo around that mean (`LEVEL_SPREAD`; below, "Circuits on one scale"). Every link counts in
  proportion to what it
  says: the international events, a player's move from one league to another, a call-up, a promoted team. An earlier way,
  moving each circuit's start by its sides' mean surprise against the other circuits, put the LFL above the LCK: it beat
  the other national leagues at EMEA Masters by more than Elo expected, and nothing held it below the LEC. A newcomer
  starts at his home circuit's level, not his first event's: Seany, of Vietnam's MVK academy, first appears at the 2025
  KeSPA Cup, which gol.gg files under Korea, and so started at the LCK's level.

K was tuned on the last 180 days' games, from 18 May 2026 (4,180 of them, 681 between two circuits' sides), each scored
before it was played (`--tune`, the levels and homes from the games before; the levels with their prior):

| K_SCALE | log loss | with the circuits' levels | games between circuits | between, with the levels |
| ---: | ---: | ---: | ---: | ---: |
| 80 | 0.6404 | 0.6180 | 0.6627 | 0.5769 |
| 120 | 0.6347 | 0.6136 | 0.6586 | 0.5762 |
| 160 | 0.6324 | **0.6124** | 0.6560 | 0.5780 |
| 200 | 0.6319 | 0.6131 | 0.6544 | 0.5806 |
| 240 | 0.6326 | 0.6148 | 0.6537 | 0.5837 |
| 320 | 0.6365 | 0.6202 | 0.6543 | 0.5903 |
| 400 | 0.6427 | 0.6274 | 0.6567 | 0.5974 |

K_SCALE is 160, with the levels. Fitted on every game, they run from the LCK's 2227 and the LPL's 2154 through the LEC's
2014, the LCS's 1969, the CBLOL's 1876, the LFL's 1849, the LCK's academy league's 1809 and the LCP's 1776 down to
Japan's 1138 and Portugal's 1009 (before the levels' prior: 2246, 2175, 2029, 1990, 1896, 1850, 1825, 1793, 1098 and 992).
The held-out log loss is 0.6086 (Brier 0.2111); Elo's favourites win a little more often than it expects (at 0.75, 0.80
of 403 games; at 0.84, 0.88 of 208).

A player is rated once he has 20 games behind him and has played within a year of the last game: 1,315 of the 2,524
players gol.gg's series name. On the game's scale a rating is (Elo − 100) / 25: the levels centre all of gol.gg's players
at 1500, which puts the best near 2500, and a base of 100 (Rocket League's is 50) keeps them at 96, under the game's 99.
The best are Bilibili Gaming's Bin, Knight and ON and Gen.G's Chovy and Ruler (96), Gen.G's Canyon (94), then BLG's Viper
and Gen.G's Duro and Kiin (93).

### Circuits on one scale

Checked on 2026-11-21, at the user's request that a nation's rating not stand high only because its players dominate a
weaker circuit, by the method docs/design/valorant.md ("Circuits on one scale") describes: every game scored before it was
played, a side's circuit the home of three of its five, a circuit's offset the Elo its sides' edge needed in the games
against other circuits' sides (its error clustered by series), 25 Elo a rating point. The held-out figures are
`npm run sync:league-of-legends -- --tune --rolling`'s.

**The shipped ratings, against all the results.** With the levels fitted on every game, no circuit, region or nation
stands beyond two errors in the 1,280 games between circuits from July 2025: the regions against each other the Pacific
−33 ± 56 Elo, EMEA −20 ± 36, China +2 ± 29, Korea +15 ± 27 and the Americas +15 ± 39; Turkey's TCL 0 ± 49, Brazil's CBLOL
+22 ± 72, the LTA South −7 ± 47, the LCP −36 ± 52, the Balkans' EBL −63 ± 44; the nations' sides Spain −101 ± 75, Chinese
Taipei −92 ± 75, Turkey −18 ± 53, Vietnam +14 ± 56, Brazil +2 ± 50; the VCS +73 ± 93 and Latin America's LRN and LRS
−41 ± 101 on 17 games each. Japan's LJL met other circuits' sides in 6 games (it lost all six, 0.8 expected) and is tied to
the rest mostly through players who also played in other circuits (125 games of teams mixing them); gol.gg's cache holds
no Oceanian league.

**Held out**, each period from 1 January and 18 May 2026 scored with the levels fitted on the games before it:

| Held-out log loss | all (8,249) | between circuits (963) | within (7,286) | between, seasoned (745) | within, seasoned (3,236) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Every newcomer at 1500 | 0.6296 | 0.6571 | 0.6260 | 0.6621 | 0.6424 |
| The levels, before 2026-11-21 | 0.6205 | 0.6027 | 0.6228 | 0.6024 | 0.6383 |
| With the levels' prior of 500 (shipped) | **0.6165** | **0.5973** | **0.6190** | **0.6008** | **0.6369** |

The levels' prior was tried at 100 to 1000 Elo: 400 and 500 do best (between circuits 0.5974 and 0.5973), 100 worst
(0.6125); K stays 160. Its gain is in the first period, when the levels stood on six months of games; over the last 180
days alone it changes nothing (0.6123 → 0.6124 over all, 0.5764 → 0.5780 between circuits). Held out, without the levels
Korea's sides beat their Elo by 109 ± 32 and the Pacific's (the LCP, the VCS) fell 268 ± 92 short; with them Korea
+26 ± 32, China +27 ± 33, EMEA −37 ± 43, the Americas +68 ± 43 and the Pacific −190 ± 93 (11 won of 23.2 expected in 68
games, 2026's international events), the one region beyond two errors, which the fit on every game takes in (−33 ± 56
above). Circuits beyond two errors: six of 17 without the levels (the sum of their (offset / error)² 52.2), two with them
(20.4): the EBL −200 ± 79 and the LCK's academy league +146 ± 65. The prior moved no nation by more than a point: South
Korea 95.4 → 94.4, China 93.6 → 93.0, the United States 84.0 → 83.2, Chinese Taipei 80.4 → 79.4, Brazil 79.6 → 78.6, Japan
53.4 → 53.0.

## Nations

A player plays for the country gol.gg files him under; one with none, or from a country the map does not draw (Hong Kong,
Macau, Andorra), plays for nobody. Taiwan's "tw" is Chinese Taipei's. Great Britain plays as one. A gamer tag that is an
insult or an obscenity plays for nobody (`isOffensiveName`).

A nation names its best player in each role it has one for, then its best others by Elo, seven in all. It needs five
rated players for a team; one short of a role plays another player there, out of his role (15 rating points down,
`PENALTY_OF` in `src/data/teams.js`: a mid laner at support plays a lane and a champion pool he does not know). Its
strength is the lineup's rating as the game picks it. 40 nations field a team. South Korea leads (94.4), then China
(93.0), the United States (83.2), France (79.8), Poland (79.6), Chinese Taipei (79.4), Vietnam and Brazil; the weakest are
Japan (53.0), Morocco, Russia, Venezuela and Slovakia (46.6). Sixteen play someone out of his role, Spain among them (no rated
mid laner of the year). Europe, South America, Asia and the Elite 32 have their four real sides beside the world.

## The match

`src/sports/leagueOfLegends.js`. A team plays at its lineup's rating, tactics and upsets included, and wins each game with
Elo's own odds for the gap (`gameOdds`). One match-day form draw for the series moves every game's gap.

A game is drawn for its winner as the real ones go (below, "Calibration"): its length, normal around 32.1 minutes (spread
5.4); the winner's kills, Poisson at their real mean whatever the length; the loser's, growing with the square of the
game's length (a stomp is short and one-sided); a Baron for the winner in 91% of games and for the loser in 16%; first
blood to a side in proportion to the game's kills.

On the clock each game has twelve units of four minutes, forty-eight minutes in all (a longer game ends in the last). The
shortest series (three games) fills 36 units, and each further game extends it as an overtime period does in other
sports. The events are first blood (`pts` 0, named for its killer), each Baron, and each game's end (`pts` 1, the
winner's, with the kills from its side and the game's length, named for its best player): "GAME 2 — KOR · 22–9 kills ·
Faker". The live chart (`kind: 'games'`) knows the games won; a game in play counts at its odds.

## Calibration

The game's constants are gol.gg's 4,563 games between seasoned players (each of the ten had 20 games before) from July
2025 to November 2026: 32.1 minutes on average (spread 5.4), the winner's kills 21.5 and the loser's 10.5 over the 339
single games whose pages give them, a Baron for the winner in 90.9% and for the loser in 15.9%. Among the sixteen
strongest nations (`npm run simulation:realism`) a game runs 32.2 minutes, the winner kills 21.5 and the loser 10.9, and
the winner takes a Baron in 88.3% of games, the loser in 15.4%.

Match-day form (`FORM_AT_BALANCED`) was fitted by maximum likelihood on the 468 real best-of-fives between seasoned
players: the favourite's odds a game 62.8% on average, the favourite won 66.7% of them. The likeliest spread is 5 rating
points (125 Elo) at Balanced, the favourite then winning 67.3% (the 945 best-of-threes give 4). The sixteen strongest
nations sweep 3–0 more often than the real best-of-fives (45.4% against 40.0%), their gaps wider than a playoff's.

No home advantage is measured: gol.gg gives no event's host. So League offers no Home advantage rule, and a home venue
changes nothing. Computer signings stays a choice: with one player a role, the best-rated player is not always the one who
most improves a lineup.

## Earlier seasons

Asked for on 2026-11-25 ("can we have more seasons of league of legends"). Every year from 2016 to 2025 is a season of its
own (`lol-2016` to `lol-2025`, chosen under Season in setup): its players as rated on its last day, nations only, each
nation's best player in each role and its best others, seven in all, as today.

### Two pages a tournament

gol.gg holds some 31,000 series from 2016 to July 2025, a page each, and stopped answering after 5,000 pages at one a
second. The earlier seasons are read from two pages a tournament instead, 2,000 in all, fetched ten seconds apart:

- its **match list**: each series' two teams, its score and its date;
- its **players list**: each player's games and wins in the tournament and his figures over them, but not his team.

Which team each player played for is worked out from the two (`scripts/lib/golgg-lineups.mjs`). A side's five play its
every game, one to a role, so a team's players share its record (its games and wins) or make it up between them, a role
at a time; and a player's figures give his team's own: his gold a minute over his share of his team's gold is his team's
gold a minute, and so are his vision score, damage and kills over his shares of them. Team-mates' readings agree to a few
tenths of a percent (gold) or a few percent (kills), and teams differ by many times that, so the players of a record fall
into their teams by their readings, and a substitute goes where the games, wins and readings he adds make his team's whole
(`solveLineups`: the plain groups first, then each player moved or swapped while that lowers the cost, seeded). Two teams of
one record are told apart by their players' other tournaments of the season (`solveSeason`, three passes, the plainest
tournaments first): a group of a record of its own names its players' team surely, and a cup's team is its players' league
team, or its academy (the org's name).

Each player's role comes from his figures (creeps, his shares of gold, damage and vision, his kills against his assists: a
role model fitted on the 2,715 player-seasons of 2025 and 2026 whose series pages give one clear role), and a team's five
with most games take one role each, in their likeliest arrangement: a player at a role his figures make unlikely costs its
log-odds against his likeliest (`MISFIT`), a substitute goes to the role whose games he fills best. Alone, the model reads
an era unlike its own with confidence and sometimes wrongly: 2016's bot laners as mid laners (Ruler 91%, Bang 84%), so
that counting each player at his likeliest role, as the solver first did, broke LCK Summer 2016's three best teams apart,
each of one record, rather than put one of two "mid laners" at bot. gol.gg's lists hold no vision score before 2018, and
the LPL's of 2016 and 2017 no gold or damage either, so a player is read by a model fitted without what his list lacks
(`trainRoles`' `lacking`): one that took a missing figure for average put 2026's players at their role 21% of the time
once their gold, damage and vision were taken out, little better than chance. With those figures taken out of the
tournaments checked below, 98.4% of the players' games stand beside the right team-mates and 97.1% at the right role
without vision; 96.5% and 91.8% without gold and damage as well.

Checked on the 149 tournaments of 2026 whose every series page the built-in season's cache holds, solved as a season of
their own (`--lineups`): 98.9% of the players' games stand beside the right team-mates, 97.9% under the right team's name,
and 97.2% at the right role. What it misses is mostly a substitute of a few games, a player traded within a split (Diable
and Taeyoon swapped BNK FearX and Nongshim RedForce halfway through LCK 2026 Rounds 1–2), and a club's cup team mixing its
first team and its academy (the KeSPA Cup).

And on the seasons themselves: six series a season, drawn by a fixed seed from the tournaments whose line-ups are worked
out, their pages fetched for the check (`--fetch --sample`, 66 pages; `--lineups` reads them). 594 of their 607 players
stand in the side they played for (97.9%: 63 of 64 in 2016, 54 of 60 in 2025, where LRS 2025's Golden Lions are missed
whole), and 510 of the 562 of a side of five at the role they played (90.7%: 45 of 49 in 2016, all 60 in 2023; a side of
six, with a substitute, lists its players in no order of roles).

A player's role in a season is the one his line-ups put him at most over its window, the year before counting half, with
his career's shares added in as much (`careerRoles`, `CAREER`: every season's line-ups and the built-in season's pages): a
season the line-ups split between two roles goes his career's way (Ale and 369, top laners read as mid laners in 2021 and
2022), and a season of one role stands (Rekkles at bot to 2023 and at support from 2024).

A series is then played as its tournament's line-ups: each player of a side counts for the part of its games he played
(`share`, scripts/lib/esports-elo.mjs: his part of the side's mean, his part of each move), the games of a series won 3–1
in turn, the winner's last. A series whose side has fewer than three of its five places known is left out.

### Ratings

Each season is rated as the built-in one is (above, "Ratings"), on its own window: the games of its year and the year
before, every newcomer starting at his home circuit's level as those games set it. A rating is (Elo − the season's base) /
25: the levels centre the year's players at 1500, five leagues' in 2016 and fifty's in 2025, so the season's base is set
so that its 25 strongest players average what the built-in season's do (`ANCHOR_PLAYERS`); the best of each season are the
best of their day. A season more top-heavy than today's (one player or one team far ahead) would put its best above 99 at
that base; the base then rises until he reads 98 (`TOP_RATING`), as it does in 2017, 2023 and 2025 (today's best read
96).

The window, K and the levels' prior were scored as the built-in season's were: each season's games from 1 July, each
before it was played, the levels and homes fitted on the window's games before (`--tune`, 22,210 games of 2016–2025):

| Held-out log loss | all (22,210) | between circuits (2,645) | within (19,565) | between, seasoned (2,249) | within, seasoned (11,457) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Every newcomer at 1500 | 0.6366 | 0.6678 | 0.6324 | 0.6711 | 0.6494 |
| A window of one year | 0.6337 | 0.6562 | 0.6309 | 0.6674 | 0.6488 |
| Two years (shipped) | **0.6249** | 0.6015 | **0.6281** | 0.6089 | 0.6464 |
| Three years | 0.6252 | **0.5998** | 0.6286 | **0.6079** | **0.6431** |
| K 120 | 0.6257 | 0.6009 | 0.6291 | 0.6083 | 0.6457 |
| K 200 | 0.6259 | 0.6032 | 0.6290 | 0.6105 | 0.6483 |
| The levels' prior 100 | 0.6267 | 0.6113 | 0.6288 | 0.6168 | 0.6469 |
| The levels' prior 300 | 0.6249 | 0.6014 | 0.6281 | 0.6085 | 0.6464 |

(A window of one or three years classes a few games otherwise, between circuits or within, as its homes class them.) Two
years beat one by a wide margin and three by nothing over all the games; K 160 and the levels' prior of 500, the built-in
season's, stand. 2016's
window is its own year alone (gol.gg's lists of 2015 are not whole), and its 295 rated players stand on 984 series of the
five major leagues and the international events, so it is marked rough.

| Season | Tournaments | Series | Rated | Nations | Strongest | Minutes | Kills (winner–loser) | Baron (winner–loser) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 2016 | 37 | 984 | 295 | 11 | South Korea 94.8, China 89.6, United States 87.8 | 37.4 | 17–6.8 | 74%–43% |
| 2017 | 90 | 2,446 | 499 | 16 | South Korea 94, China 88.8, United States 86 | 36.8 | 15.5–8.4 | 88%–29% |
| 2018 | 139 | 4,272 | 893 | 29 | China 93.6, South Korea 92.8, Chinese Taipei 89.6 | 34.9 | 15.6–7.2 | 89%–27% |
| 2019 | 176 | 6,279 | 1,075 | 37 | South Korea 93.6, China 93.4, Denmark 85.8 | 33.3 | 17.1–8.1 | 90%–20% |
| 2020 | 192 | 7,593 | 1,209 | 37 | South Korea 95.2, China 92.2, Denmark 86.2 | 33.4 | 17.9–7.8 | 88%–18% |
| 2021 | 238 | 9,342 | 1,459 | 43 | South Korea 95.6, China 92.8, Chinese Taipei 85.4 | 32.4 | 18.8–9 | 90%–19% |
| 2022 | 259 | 10,702 | 1,537 | 41 | South Korea 95.2, China 93.2, Chinese Taipei 82 | 32.6 | 18.2–8.8 | 91%–18% |
| 2023 | 258 | 10,556 | 1,545 | 42 | South Korea 96, China 91.2, Chinese Taipei 79 | 32.1 | 18.2–8.8 | 92%–20% |
| 2024 | 275 | 9,869 | 1,516 | 41 | South Korea 94.6, China 94.2, Chinese Taipei 81.4 | 32.4 | 19.3–9.4 | 92%–20% |
| 2025 | 305 | 8,601 | 1,416 | 46 | South Korea 95.4, China 90, Chinese Taipei 85.8 | 32.7 | 20.6–10.6 | 84%–16% |

Tournaments and series are the window's (two years', but 2016's), rated players its own. Each year's best: Samsung
Galaxy's Ruler in 2016 and 2017, Invictus Gaming's Ning in 2018 (China ahead of Korea that year alone), FunPlus Phoenix's
Tian in 2019, Gen.G's Clid in 2020, FunPlus Phoenix's Nuguri in 2021, DRX's BeryL in 2022, KT Rolster's Lehends in 2023,
Top Esports' 369 in 2024 and Gen.G's Canyon, Kiin and Chovy in 2025; the world champions of 2017, 2018, 2019 and 2022
among them (`docs/design/league-of-legends-seasons-audit.json` lists every nation's seven).

**Between regions.** The games between circuits (the international events, the promotions, the European Masters) test
the levels: over the seasons' own games, Korea's players won 469 of the 438.3 their Elo gave them (+38 ± 15 Elo), and held
out, each season's from 1 July, 318 of 280.7 (+70 ± 19); the Pacific's (Chinese Taipei, Vietnam, Japan, Oceania) did worse
held out (−76 ± 23). No circuit stands beyond two errors in the seasons' own games. Korean teams won most of these years'
World Championships, where most such games are played, perhaps as a team at its peak at the year's end outruns an Elo
of the whole year. Two corrections were tried on 2022–2025 and dropped: a higher K for the games between regions (1.5, 2 and 3 times) forecast
them worse, and moving each player by his region's offset in the half-season before (Korea +3 to +8) gained nothing.

### Each year's games

A season plays games of its year's length, kills and Barons (`LEAGUE_OF_LEGENDS_GAMES`, `leagueOfLegendsIn`): today's
constants (GAMES_TODAY), each scaled by the year's figure over 2026's, both read off gol.gg the same way: the length of a
game from its tournaments listing, the winner's and the loser's kills and Barons from its teams list (each team's kills
and Barons a game against its share of games won, read at all wins and at none). Who wins is Elo's whatever the games, so
a season's odds, its live chart and its simulation version are today's.

### Countries

gol.gg files no country for a tenth to a quarter of the players of 2016–2019, most of them retired before 2020. Each is
found by his tag on esportsearnings.com's lists of the game's players by country and on Wikidata's League of Legends
players (`npm run sync:league-of-legends-countries`, `scripts/data/league-of-legends-countries.json`), where the match fits
the leagues he played in: a country of those leagues', or, for an import, both lists agreeing, or the only player of his tag
being of a country that sends players abroad (Korea, China, Chinese Taipei). One the lists do not settle plays for no
nation. Of the 481 players of ten games in a season that gol.gg gives no country, the lists settle 293 (252 by their
leagues' own country, 14 by the one of a tag from his leagues' country, 18 as the only player of a tag from a sending
country, 9 by both lists agreeing) and leave 188, most of them in the LPL, where Korean imports keep a tag alone from
settling a country. Tried on the 2,497 player-seasons of 2016–2019 whose country gol.gg does give, the same rules put
1,912 at it, 25 elsewhere (Xmithie, of the Philippines, as of the United States; inSec, of Korea, as of China) and leave
560 unsettled.

## Known limits

- Nations only: the orgs (T1, Gen.G, G2…) need a map of their own.
- A substitute who played one game of a series counts in all of it (the summaries give no game's own lineup); in the earlier
  seasons, a player counts for his part of every series of his tournament.
- 11 rated players play for no nation: Hong Kong's seven, one from Andorra and one from the Faroe Islands (the map draws
  none of the three), and two gol.gg files under no country; 57 more are from a nation with fewer than five.
- The built-in season reads only July 2025 on: gol.gg stopped answering the first fetch there (above, "Sources"). The
  earlier seasons begin with 2016: gol.gg's players lists of 2015 and before hold only the games it has full figures of.
- The earlier seasons' line-ups are worked out, not read (above, "Two pages a tournament"): about one player-game in fifty
  stands beside the wrong team-mates, and one player in ten of the sampled sides at the wrong role in his tournament (his
  season's role, with his career's word, is right more often). 2016 and 2017 have no vision score, and the LPL of those
  years no gold or damage, so China's line-ups of those years rest on records, creeps and kills.
- Players whose country neither gol.gg nor the lists give play for no nation: 17 rated players in 2016, 18 in 2017, 67 in
  2018 and 54 in 2019 (none after), most of them in the LPL, whose Korean imports keep a tag alone from settling a country.
- gol.gg's players page can be filtered by role, but by a form whose post came back unfiltered (one request, 2026-11-27):
  roles are read off the figures instead.
