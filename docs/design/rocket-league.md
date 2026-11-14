# Rocket League

Status: implemented 2026-11-14. The first esport and the tenth sport: Rocket League, as the RLCS
plays its playoffs. Two nations' teams of three meet in a series, best of seven; each game is
five minutes, and a game level at the end goes to sudden-death overtime. Nations only, on the
world map, for now. Everything outside the match (territory, the draw, targeting, conquest,
signings, saves) is the game's own, unchanged.

The player chose (2026-11-13): ratings built from Liquipedia's results; the export made by hand
in a browser (Liquipedia shuts the project's fetcher out, below); nations first, the orgs later;
a tile of its own beside the nine sports; best of seven.

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
   `data-src/liquipedia/next-export.txt`: the stage pages of the last three years' events that
   the export links to but lacks (a major's Swiss groups, the national cups' group stages), then
   the pages of the rated players it has no nation for (a team card often leaves the flag out,
   and the wiki then reads the player's own page, `Infobox player`'s `country`). Paste the list
   into the same page's "Add pages manually" box for a second file, save it beside the first,
   and run the sync again.
6. `npm run build-rocket-league` writes the nations from the snapshot.

The first export, of 2026-11-14, held 1,135 pages: 935 3v3 events of S- and A-Tier (125 school
leagues left out) with 18,365 series and 74,770 games from 2015-09-10 to 2026-11-13. The second,
the same day, held 428 pages of its list's 438 titles (325 stage pages, then the players'): the
two make 943 events, 20,355 series and 81,534 games, and the players' own pages left 32 rated
players with no country where the first export alone left 102. The list the second leaves (25
stage pages, 51 players' pages and spellings) would hardly move a nation.

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
  never meets a namesake, and a redirect page in an export is followed. 730 spellings folded.
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
(`regionalStarts`: North America 1,583, Europe 1,582, MENA 1,518, Asia-Pacific 1,515, South
America 1,473, Oceania 1,447, Sub-Saharan Africa 1,208).

K was chosen by scoring the exports' last 180 days (2,462 games), each game before it was
played (`npm run sync:rocket-league -- --tune`): log loss 0.6021 at K 110, 0.5853 at 240, 0.5829
at 320, 0.5835 at 400, 0.5868 at 500, regional starts on (they lower it at every K). At 320 the
predictions are calibrated: games it gave 75% went 78%, 84% went 85%, 94.5% went 92.5%.

A player is rated once he has 20 games behind him and has played within a year of the export's
last game: 815 of 4,393. On the game's scale a rating is Elo / 25 − 2: a rating point is 25 Elo
points, as in tennis, so the match model plays Elo's own odds; the best player, dralii (Morocco),
is 97, a newcomer at 1,500 is 58. Each nation names its five best; it needs three for a team, so
a nation with fewer fields none and its land stays neutral. 57 nations field a team, from France
(90.3: Vatira, zen, ExoTiiK), the United States (90) and Saudi Arabia (89.3) down to Madagascar
(49). Rocket League offers every nation theatre, the Elite 32 included.

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
20 games before, as every rated player has: 20,072 with their goals (scoring has been steady
since 2022: 4.15–4.32 goals a game, 18.6–21.0% to overtime). A newcomer's games are left out, as
his Elo has not yet found his level and they are more lopsided than their odds say: the window's
other 8,171 scored 4.91 goals a game, 12.8% to overtime. Each game is played through the model at
its own pre-game Elo odds, so the real mix of matchups is the model's:

| | Model | Real |
| --- | --- | --- |
| Goals a game | 4.23 | 4.25 |
| Games to overtime | 19.8% | 19.7% |
| Won by one / two / three or more | 51.8% / 22.1% / 26.2% | 52.1% / 21.6% / 26.3% |

That takes 3.8 goals in five minutes between equals and the last minute's play: the side a goal
down scores at 1.4 times its rate, the leader at 0.9, both at 1.1 when level. Without it the same
goals give 18.1% overtime and 50.3% won by one. Overtime's goal came after 95 seconds on average
(median 64, sudden death's exponential wait), slower than regulation's pace (79 seconds): the
model times it at 0.83 of that pace.

Series are less predictable than their games. In the same years' 1,092 best-of-sevens with a
favourite, its odds 0.686 a game before the first, the favourite won 79.2%, where independent
games at those odds would win 81.6%; it swept 27.9% (25.7%), the underdog 2.9% (1.6%). The
scorelines of all 1,194 are likeliest with match-day form of 4.5 rating points (112 Elo) at
Balanced, which gives 76.9%, 27.8% and 3.3% (the favourite's share alone would ask for 3); the
best-of-fives ask for more (6.5: the favourite won 74.1% of 3,166). Form grows with the square of
the drama, as in every sport, so Wild swings Rocket League hardest of all.

The harness (`npm run simulation:realism`) plays the sixteen strongest nations twice a season:
4.22 goals a game, 20.2% to overtime, best of seven won 4–0 / 4–1 / 4–2 / 4–3 29.0% / 29.0% /
22.7% / 19.3% (real 30.5% / 26.6% / 22.9% / 20.0%), the favourite 76.1%.

**No home advantage.** At the exports' LANs, 1,853 games had one side of the host nation (two of
its three players); those sides did as Elo expected, within two standard errors (+9.9 ± 7.7 Elo:
were it real, 51.4% a game, and the first export alone gave +6.1 ± 8.3). So Rocket League offers no
Home advantage rule: the setup leaves it out, as tennis leaves out Computer signings, and a home
venue changes nothing. Computer signings is left out too, as in tennis: any player plays any place,
so the best-rated player is always the one who most improves a lineup (checked over every pair of
the 57 nations).

## Known limits

- Nations only: the orgs (Vitality, Karmine Corp, Falcons…) need a map of their own.
- One season, the built-in one: no earlier seasons yet.
- The exports still lack 25 recent stage pages and 32 rated players' countries
  (`next-export.txt` lists them for a third), and 104 recent series name a team with no roster.
- A player who changed his name (not only its punctuation) is two players to the reader. Côte
  d'Ivoire's "Aidenrll" and "Luchibald" (the FIFAe Nations League, to 2026-07-15) and "Aiden"
  and "Luchi" (its later events, from 2026-07-18) never play in the same series and look like
  two such, so its team of three may be two players and one of them again.
