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
a time and a second apart, and keep each page gzipped in `data-src/golgg/` (ignored by git).

1. `npm run sync:league-of-legends -- --fetch` reads each season's tournaments (gol.gg's own listing, as JSON) from 2024,
   each tournament's match list, and each series' page: the summary of a series of several games, or a single game's page.
2. Without `--fetch`, the sync reads only the cache, rates every player and writes
   `scripts/data/league-of-legends-elo.json`.
3. `npm run build-league-of-legends` writes the nations, `src/data/rosters.league-of-legends.js` (`--check` compares byte
   for byte).

The cache holds 211 of gol.gg's tournaments, 13 July 2025 to 14 November 2026: 4,865 series and 10,940 games. The fetch
stopped short of 2024: after those 4,865 series pages, a second apart and newest first, gol.gg stopped answering the
fetcher's connections and had not answered again half an hour later, so the ratings stand on the sixteen months the cache
holds. A later `--fetch` carries on from the cache, and should go slower.

## Reading the pages

`scripts/lib/golgg.mjs` reads:

- **A season's tournaments**: each one's name, region (KR, CN, EUW, FR…, WR for the world stage), games and dates.
- **A tournament's match list**: each series' page, its two teams, the score, the stage and the date.
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
  on that likelihood, the levels centred so that the players' mean is 1500. Every link counts in proportion to what it
  says: the international events, a player's move from one league to another, a call-up, a promoted team. An earlier way,
  moving each circuit's start by its sides' mean surprise against the other circuits, put the LFL above the LCK: it beat
  the other national leagues at EMEA Masters by more than Elo expected, and nothing held it below the LEC. A newcomer
  starts at his home circuit's level, not his first event's: Seany, of Vietnam's MVK academy, first appears at the 2025
  KeSPA Cup, which gol.gg files under Korea, and so started at the LCK's level.

K was tuned on the last 180 days' games, from 18 May 2026 (4,180 of them), each scored before it was played (`--tune`, the
levels and homes from the games before):

| K_SCALE | log loss | with the circuits' levels |
| ---: | ---: | ---: |
| 80 | 0.6404 | 0.6181 |
| 120 | 0.6347 | 0.6135 |
| 160 | 0.6324 | **0.6123** |
| 200 | 0.6319 | 0.6129 |
| 240 | 0.6326 | 0.6145 |
| 320 | 0.6365 | 0.6199 |
| 400 | 0.6427 | 0.6271 |

K_SCALE is 160, with the levels. Fitted on every game, they run from the LCK's 2246 and the LPL's 2175 through the LEC's
2029, the LCS's 1990, the CBLOL's 1896, the LFL's 1850, the LCK's academy league's 1825 and the LCP's 1793 down to
Portugal's 992. The held-out log loss is 0.6085 (Brier 0.2111); Elo's favourites win a little more often than it expects
(at 0.75, 0.79 of 404 games; at 0.84, 0.88 of 212).

A player is rated once he has 20 games behind him and has played within a year of the last game: 1,315 of the 2,524
players gol.gg's series name. On the game's scale a rating is (Elo − 100) / 25: the levels centre all of gol.gg's players
at 1500, which puts the best near 2530, and a base of 100 (Rocket League's is 50) keeps them at 97, under the game's 99.
The best are Bilibili Gaming's Bin and Gen.G's Chovy and Ruler (97), BLG's Knight and ON (96), Gen.G's Canyon (95), then
BLG's Viper and Gen.G's Duro and Kiin (94).

## Nations

A player plays for the country gol.gg files him under; one with none, or from a country the map does not draw (Hong Kong,
Macau, Andorra), plays for nobody. Taiwan's "tw" is Chinese Taipei's. Great Britain plays as one. A gamer tag that is an
insult or an obscenity plays for nobody (`isOffensiveName`).

A nation names its best player in each role it has one for, then its best others by Elo, seven in all. It needs five
rated players for a team; one short of a role plays another player there, out of his role (15 rating points down,
`PENALTY_OF` in `src/data/teams.js`: a mid laner at support plays a lane and a champion pool he does not know). Its
strength is the lineup's rating as the game picks it. 40 nations field a team. South Korea leads (95.4), then China
(93.6), the United States (84.0), Chinese Taipei (80.4), France (80.2), Poland, Brazil and Vietnam; the weakest are Japan
(53.4), Morocco, Venezuela, Russia and Slovakia (46.4). Sixteen play someone out of his role, Spain among them (no rated
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

## Known limits

- Nations only: the orgs (T1, Gen.G, G2…) need a map of their own.
- A substitute who played one game of a series counts in all of it (the summaries give no game's own lineup).
- 11 rated players play for no nation: Hong Kong's seven, one from Andorra and one from the Faroe Islands (the map draws
  none of the three), and two gol.gg files under no country; 57 more are from a nation with fewer than five.
- The seasons before July 2025 are not read: gol.gg stopped answering the fetch there (above, "Sources").
