# Rocket League

Status: implemented 2026-11-14; its earlier seasons, every year from 2016 to 2025, on 2026-11-15.
The first esport and the tenth sport: Rocket League, as the RLCS plays its playoffs. Two nations'
teams of three meet in a series, best of seven; each game is five minutes, and a game level at the
end goes to sudden-death overtime. Nations only, on the world map, for now. Everything outside the
match (territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

The player chose (2026-11-13): ratings built from Liquipedia's results; the export made by hand
in a browser (Liquipedia shuts the project's fetcher out, below); nations first, the orgs later;
a tile of its own beside the nine sports; best of seven. Then (2026-11-15): the rosters of every
year since the game began ("Earlier seasons", below), a fourth export for the players those years
rate with no country, and each year at its own scoring.

## The Liquipedia export

Liquipedia's robots.txt shuts Anthropic's crawlers out of the whole site (`User-agent: ClaudeBot`,
`User-agent: Claude-Web`: `Disallow: /`) and every crawler out of `/rocketleague/api.php` and
`/rocketleague/index.php`; `api.liquipedia.net` (LiquipediaDB) answers `Disallow: /` to every
crawler. The project's fetcher obeys both (`scripts/lib/polite-fetch.mjs`, README "Network
requests"), so no script fetches anything from Liquipedia, and nothing here works around that:
the pages are saved by a person, in a browser, with the wiki's own export.

1. Open <https://liquipedia.net/rocketleague/Special:Export>.
2. Under "Add pages from category", add the tier categories every event page lists at its foot:
   `S-Tier Tournaments`, then `A-Tier Tournaments`.
3. Keep "Include only the current revision, not the full history" and "Save as file" ticked;
   leave "Include templates" unticked. Export.
4. Save the `.xml` into `data-src/liquipedia/` (ignored by git), under any name ending `.xml`.
5. `npm run sync:rocket-league`. It reads every `.xml` there and fetches nothing, and writes
   `data-src/liquipedia/next-export.txt`: the stage pages the exports' events link to but lack (a
   major's Swiss groups, the national cups' group stages), the newest first, then the pages of
   the players rated today or at an earlier season's end whom it has no nation for (a team card
   often leaves the flag out, and the wiki then reads the player's own page, `Infobox player`'s
   `country`), the best first, each under every spelling of him; a title an export already holds
   is left out. Paste the list into the same page's "Add pages manually" box for another file,
   save it beside the others, and run the sync again.
6. `npm run build-rocket-league` writes the nations from the snapshot, and
   `npm run build:rocket-league-seasons` the earlier seasons from theirs.

The first export, of 2026-11-14, held 1,135 pages: 935 3v3 events of S- and A-Tier (125 school
leagues left out) with 18,365 series and 74,770 games from 2015-09-10 to 2026-11-13. The second,
the same day, held 428 pages of its list's 438 titles (325 stage pages, then the players'), the
third, that night, 65 of its 76 (14 stage pages and all 51 players' titles), and the fourth, the
next morning, 327 of its 348 (135 of 149 stage pages, back to 2016, and 192 of the 199 titles of
the players the earlier seasons rated with no country): the four make 1,009 events, 22,854 series
and 90,966 games. The players' own pages leave 3 of today's rated players with no country, where
the first export alone left 102 and the first two 32, and 0 to 13 of an earlier season's, where
the first three left up to 95. The list the fourth leaves holds 56 titles: 14 stage pages and 6
players' pages it asked for that the wiki does not have, and 36 of players its games newly rate.

What the reader expects was checked against Liquipedia's own modules, which are open source
(github.com/Liquipedia/Lua-Modules, read through GitHub's API and raw.githubusercontent.com,
neither of which has a robots.txt), and then against the export itself: Rocket League's Match2
input (`score1`, `score2`, `ot`, `otlength` a game; `walkover`, `winner` a series; W, FF, L and DQ
for forfeits; no `bestof`, which the winner's games give), its legacy team card (`p1`–`p3` start,
`pNflag_o` before `pNflag`, `sub4`… flagged as `p4flag`…, `ex`… former players, `c`… coaches) and
TeamParticipants' `{{Opponent|team|players={{Persons|{{Person|name}}…}}}}`, which names no flags.

Liquipedia's content is CC BY-SA 3.0. The game credits it in the setup (the Season note) and
the README, the snapshot and the nations derived from it are shared under the same licence, and
each player's source links his Liquipedia page.

## Reading the export

`scripts/lib/liquipedia.mjs` reads the wikitext: each event's `Infobox league` (tier, mode, dates,
region, LAN or online, the host country), its teams and its series. `scripts/lib/rocket-league.mjs`
turns them into what the ratings play:

- **Events.** 3v3 events of S-, A- and B-Tier, a school's league (Collegiate Rocket League:
  `liquipediatiertype` School) left out, its players being a pool apart. An event with no region
  is international (majors, the world championship, the Esports World Cup, the national cups).
- **Teams.** A series names its teams by the wiki's team templates ("nip", "kc", "flcn",
  "Genesis (South American Team)"), its event's rosters by name ("Ninjas in Pyjamas"): the
  templates are not in the export, so a template meets its event's roster by its name without a
  disambiguation or region tag, else as the one roster it abbreviates best (initials, the start of
  the name, its letters in order). Failing both, the same team's roster at an event within four
  months stands in; else the series is left out (104 of the last two years', 94 of them in the
  RLCS opens, whose pages list no roster for many of their teams).
- **Players.** A player is his page (`pNlink`) or his name. One player is spelt many ways across
  ten years of rosters ("Atow." on his clubs' cards, "Atow" on Belgium's; "AcroniK", "AcroniK.",
  "Acronic"), so spellings that differ only in case and punctuation fold into the one the rosters
  use most, unless their nations clash; a page the wiki disambiguates ("Dead (Israeli Player)")
  never meets a namesake, and a redirect page in an export is followed (Scrzbbles, who renamed
himself zach, is one player). 823 spellings folded.
  Two of a nation's five who still go by one name are each shown by his page ("Abdullah" and
  "Abdullahrll" for Oman, not two Abdullahs).
- **Nations.** A player plays for the nation he last played for in a national-team event (the
  FIFAe World Cup and the Esports Nations Cup, and their regionals: 611 players), as rugby
  league takes a Test side before a birthplace; else the country flag his cards file him under
  most often; else his page's country. Liquipedia's own flag codes count (England "uken",
  Scotland "uksc", Wales "ukwa"; Réunion and Guadeloupe for France, Curaçao for the Netherlands),
  its region flags ("usca", "north america", "eu", "mena") name no nation, and a country off the
  map (Singapore, Malta, Hong Kong) fields none. Great Britain plays as one, as in tennis.

## Ratings

Every series in date order, game by game, as an Elo of players: a team plays at the mean of its
three starters' Elo, the winner of a game takes K × (1 − E) from the loser, and each player moves
by his team's amount. A player's K shrinks with his games: 320 / (games + 5)^0.4, never below 8.
The regions meet only at the majors and the world championship, too rarely for Elo alone to bring
a whole region's players to its level, so a newcomer starts at his region's level, each region's
start solved so that its teams win as often at the international events as Elo expects
(`regionalStarts`: North America 1,580, Europe 1,578, MENA 1,525, Asia-Pacific 1,507, South
America 1,476, Oceania 1,447, Sub-Saharan Africa 1,167).

K was chosen by scoring the exports' last 180 days (2,462 games), each game before it was
played (`npm run sync:rocket-league -- --tune`): log loss 0.5995 at K 110, 0.5834 at 240, 0.5811
at 320, 0.5818 at 400, 0.5851 at 500, regional starts on (they lower it at every K). At 320 the
predictions are calibrated: games it gave 75% went 78%, 84% went 85%, 94.6% went 92.3%.

A player is rated once he has 20 games behind him and has played within a year of the export's
last game: 817 of 4,907. On the game's scale a rating is Elo / 25 − 2: a rating point is 25 Elo
points, as in tennis, so the match model plays Elo's own odds; the best player, dralii (Morocco),
is 98, a newcomer at 1,500 is 58. Each nation names its five best; it needs three for a team, so
a nation with fewer fields none and its land stays neutral. 57 nations field a team, from the
United States (93.7: zach, Firstkiller, Chronic), France (91.3) and Saudi Arabia (90.7) down to
Ghana and Madagascar (48.7).
Rocket League offers every nation theatre, the Elite 32 included.

## The match

`src/sports/rocketLeague.js`. A team plays at its three best players' mean, tactics and upsets
included, and wins each game with Elo's own odds for the gap (`gameOdds`). One match-day form
draw for the series moves every game's gap.

A game is played in ten thirty-second slices. Its goals are Poisson draws at rates split
between the two sides (`gameRates`) so that the game, played slice by slice with its late game
and overtime, is the favourite's with exactly Elo's chance: the goals follow the ratings and
the winner is Elo's. In the last minute a side a goal down pushes up and the leader sits back;
level, both sides go for the winner. Level after five minutes, the first goal of overtime wins
it. Any of the three can score, the better player more often.

On the clock each game has twelve units: its ten slices and two for its overtime. The shortest
series (4–0) fills 48 units, and each further game extends it as overtime periods do in other
sports. The events are each goal (`pts` 0, the score counts games) and each game's end (`pts`
1), named for the goal that won it; an overtime goal shows its time ("+1:12"). The live chart
(`kind: 'series'` in `src/engine/winProbability.js`) is exact: the game in play from its slice and
margin, then the games left, over the form nodes weighed by the games already won.

## Calibration

Fitted to the exports' games of the three years to 2026-11-13 whose six players had each played
20 games before, as every rated player has: 21,156 with their goals (scoring has been steady
since 2022: 4.16–4.32 goals a game, 17.9–20.9% to overtime). A newcomer's games are left out, as
his Elo has not yet found his level and they are more lopsided than their odds say: the window's
other 7,712 scored 4.93 goals a game, 12.5% to overtime. Each game is played through the model at
its own pre-game Elo odds, so the real mix of matchups is the model's:

| | Model | Real |
| --- | --- | --- |
| Goals a game | 4.23 | 4.26 |
| Games to overtime | 19.8% | 19.6% |
| Won by one / two / three or more | 51.7% / 22.1% / 26.2% | 52.1% / 21.7% / 26.2% |

That takes 3.8 goals in five minutes between equals and the last minute's play: the side a goal
down scores at 1.4 times its rate, the leader at 0.9, both at 1.1 when level. Without it the same
goals give 18.1% overtime and 50.3% won by one. Overtime's goal came after 95 seconds on average
(median 64, sudden death's exponential wait), slower than regulation's pace (79 seconds): the
model times it at 0.83 of that pace.

Series are less predictable than their games. In the same years' 1,118 best-of-sevens with a
favourite, its odds 0.685 a game before the first, the favourite won 79.0%, where independent
games at those odds would win 81.3%; it swept 27.5% (25.5%), the underdog 3.1% (1.7%). The
scorelines of all 1,205 are likeliest with match-day form of 4.5 rating points (112 Elo) at
Balanced, which gives 76.6%, 27.6% and 3.4% (the favourite's share alone would ask for 3); the
best-of-fives ask for more (6: the favourite won 74.6% of 3,434). Form grows with the square of
the drama, as in every sport, so Wild swings Rocket League hardest of all.

The harness (`npm run simulation:realism`) plays the sixteen strongest nations twice a season:
4.23 goals a game, 20.5% to overtime, best of seven won 4–0 / 4–1 / 4–2 / 4–3 29.1% / 29.3% /
23.1% / 18.5% (real 30.4% / 26.7% / 22.9% / 20.0%), the favourite 74.5%.

**No home advantage.** At the exports' LANs, 1,933 games had one side of the host nation (two of
its three players); those sides did as Elo expected, within two standard errors (+11.8 ± 7.5 Elo:
were it real, 51.7% a game, and the first export alone gave +6.1 ± 8.3). So Rocket League offers no
Home advantage rule: the setup leaves it out, as tennis leaves out Computer signings, and a home
venue changes nothing. Computer signings is left out too, as in tennis: any player plays any place,
so the best-rated player is always the one who most improves a lineup (checked over every pair of
the 57 nations).

## Earlier seasons

Every year from 2016 to 2025 is a season of its own (`rl-2016` to `rl-2025`, chosen under Season
in setup): its players as the Elo of Liquipedia's results stood on its last day. The sync runs the
same Elo over the games up to 31 December only (`playersAsOf`) and keeps who was rated then by
today's rules, 20 games behind him and one within the year; each nation names its five best and
plays its three best, as today. A player plays for the nation the whole record gives him (his
national-team events, his flags, his page), whichever year it is: a country is a person's, and the
record's national-team events are recent. His team is the one he played for that December.

The record begins on 2015-09-10, with 35 games that year: nobody has twenty games by its end, so
2016 is the first season. 2016 and 2017 say they are rough, a rating then resting on a year or two
of games.

| Season | Rated | Nations | Strongest | Real games | Goals a game | Rate | Overtime, model (real) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2016 (rough) | 71 | 9 | United States 69.3, Great Britain 69, Netherlands 69 | 516 | 4.34 | 3.97 | 20.5% (18.0%) |
| 2017 (rough) | 142 | 11 | Netherlands 76, France 73.7, United States 73.3 | 886 | 3.96 | 3.60 | 22.1% (14.4%) |
| 2018 | 185 | 13 | United States 76, Netherlands 75, France 73.7 | 1,631 | 4.07 | 3.70 | 21.5% (19.7%) |
| 2019 | 375 | 18 | United States 83, Brazil 79.3, France 79 | 3,168 | 3.86 | 3.50 | 22.5% (20.1%) |
| 2020 | 575 | 24 | Brazil 84, United States 83, France 81.3 | 5,401 | 3.90 | 3.52 | 21.9% (21.0%) |
| 2021 | 757 | 29 | Saudi Arabia 89.3, Great Britain 83.7, United States 83.3 | 8,589 | 4.01 | 3.62 | 21.4% (20.9%) |
| 2022 | 1,061 | 30 | United States 87.7, Japan 87, Great Britain 86.7 | 14,619 | 4.21 | 3.82 | 20.7% (19.0%) |
| 2023 | 863 | 31 | France 92, Brazil 89, Saudi Arabia 89 | 9,147 | 4.22 | 3.82 | 20.6% (17.9%) |
| 2024 | 619 | 27 | France 91.3, Saudi Arabia 90, United States 90 | 5,962 | 4.28 | 3.85 | 19.7% (20.0%) |
| 2025 | 851 | 50 | United States 94.3, France 92.7, Saudi Arabia 90.7 | 9,044 | 4.32 | 3.88 | 19.5% (18.5%) |

The early years are thin, as the S-, A- and B-Tier events of their time were: North America,
Europe and Oceania, nine nations in 2016 and thirteen by 2018. The fourth export's stage pages
filled 2020 most: 5,401 games between seasoned players where the first three exports held 2,031,
and 575 rated where they rated 425. 2021's rise to 29 is the RLCS's new regions (Saudi Arabia
leads it), and 2025's to 50 the national-team events, which brought many smaller nations' players
into the record.

**Each year's scoring.** A season plays its own year's goal rate: the rate between equals that
brings the year's real games between seasoned players (all six with 20 games behind them), each
played through the model at its own pre-game Elo odds, to the goals they scored. The build solves
it (`gameMeans`) into `src/data/rocketLeagueScoring.js`, and `rocketLeagueIn` plays it; the late game
and overtime's pace are today's. 2019 and 2020 scored least, 3.86 and 3.90 goals a game, at rates
of 3.50 and 3.52; 2022 to 2025 are within 0.1 of today's 3.8. Who wins a game is Elo's at any rate,
so the same draws give the same games in any season and only their goals differ, and the live chart
plays the game in play at the season's rate. The model sends one or two points more of most years'
games to overtime than went; 2017's 14.4% stands out beside every other year's 18–21%, perhaps
overtimes the older pages leave unmarked.

`npm run build:rocket-league-seasons` writes each season's file (`public/rocket-league/rl-<year>.json`,
format 1, kind `rl`), `public/rocket-league/ATTRIBUTION.txt` (Liquipedia, CC BY-SA 3.0), the listing
`src/data/rocketLeagueSeasons.js`, the scoring table and `docs/design/rocket-league-seasons-audit.json`
(each season's nations, who is left out, its real games and the model's), from the sync's
`scripts/data/rocket-league-seasons/<year>.json`; `--check` compares them byte for byte.

## Known limits

- Nations only: the orgs (Vitality, Karmine Corp, Falcons…) need a map of their own.
- A season counts only the S-, A- and B-Tier events the exports hold, and a player only if his
  country is known: the earlier years' players with none play for nobody (at most 13 in a
  season, 2020's, of 575 rated).
- Three rated players have no country yet (Chronomia, Patty and Evample, rated 46 to 59:
  `next-export.txt` lists their pages), 14 stage pages are missing (none of them has a page on the
  wiki yet), and 104 recent series name a team with no roster.
- A player who changed his name (not only its punctuation) is two players to the reader, unless
  an export holds his old name's redirect (Scrzbbles to zach). Côte
  d'Ivoire's "Aidenrll" and "Luchibald" (the FIFAe Nations League, to 2026-07-15) and "Aiden"
  and "Luchi" (its later events, from 2026-07-18) never play in the same series and look like
  two such, so its team of three may be two players and one of them again.
