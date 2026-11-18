# Basketball's European competitions: the EuroLeague and EuroBasket

Status: implemented 2026-11-08, merged with main's code split and nation-theatre rule
2026-11-10. Asked for as "in basketball can you add euroleague and european championship (the
main ones)": Europe's main club competition and its national championship. Re-rated 2026-11-18
by the computed-ratings method ([computed-ratings.md](computed-ratings.md)): minutes and PIR
blended, read off NBA 2K27's starters, and every earlier season's clubs moved toward their
results.

- **The EuroLeague**: a second club theatre for basketball, beside the NBA. Its 20 clubs of
  2026/27 fight over a map of Europe, each on land in its own country (Dubai holds the Emirates),
  under the EuroLeague's own rules: FIBA's forty minutes at its pace and scoring rate.
- **EuroBasket**: a basketball nation theatre of the 24 nations of EuroBasket 2025, the last
  European Championship played. The seven of them that had no five of their own now field the
  players who played for them there.

Everything outside the match and the data (the draw, targeting, conquest, signings, saves,
challenge links) is the game's own, unchanged.

## The EuroLeague's players

**No source rates EuroLeague players.** NBA 2K has carried no EuroLeague teams since 2K17 (its
2K Archive pages list NBA teams and free agents only; checked for every edition from NBA 2K to
NBA 2K27), and no other public dataset rates them. So every EuroLeague rating is the game's own
estimate, marked as one wherever it is shown, as hockey's below EA's top 300 are
(`src/data/estimates.js`, in the EuroLeague's words: "no game rates EuroLeague players, so this
one comes from his EuroLeague minutes and PIR, ranked on NBA 2K27's scale (a past season's also
moved toward his club's results)"). Since 2026-11-14 the national fives' EuroLeague players take
these estimates too, under their clubs' spelling (`npm run build-basketball`), so no player rates
one way for his club and another for his country; the roster audit (`npm run audit:rosters`,
docs/design/roster-audit.md) found 15 who did. Their curated ratings stay in
`scripts/fiba-squads.json` for the day one leaves the EuroLeague.

**Source.** `npm run sync:euroleague` (`scripts/sync-euroleague.mjs`) reads the EuroLeague's own
public data API (`api-live.euroleague.net`, which its website reads), cached in the ignored
`data-src/euroleague/`, into the committed snapshot `scripts/data/euroleague-2026-27.json`
(40 KB):

- the season's 20 clubs and their rosters on 8 November 2026 (337 players: code, name, guard,
  forward or centre, height, nationality);
- every player's per-game box score in 2024/25, 2025/26 and 2026/27 so far (ten rounds): games,
  minutes, points, rebounds, assists, three-point attempts and PIR, the EuroLeague's
  Performance Index Rating (265 rostered players have games);
- the last full season's league figures (`league`): 74.2 possessions a game, 86.2 points a team
  in the regular season, home sides winning 63.7%.

The window's two earlier seasons are read from the earlier seasons' snapshots (below), which list
every player with a game; the snapshot's own lines for them are the leaderboard's, a subset of the
same figures. So 287 rostered players have a EuroLeague game in the window, not 265.

**The rating** (`scripts/lib/euroleague-ratings.mjs`, since 2026-11-18) follows the method every
computed season shares ([computed-ratings.md](computed-ratings.md), steps 3 and 4), on the facts
the API keeps: each player's games, minutes and PIR, the EuroLeague's Performance Index Rating.
It replaced a straight line in PIR a game (PIR 9 rating 73, 1.3 points a point of PIR, 60–88).

- **Window.** The season under way counts 3, the last 2 and the one before 1, each season's
  minutes and PIR pooled by those weights, so ten rounds of this season weigh less than a full
  last season. A season he played elsewhere adds nothing, so a newcomer is not marked down for it.
- **Two signals**, within his position group (the EuroLeague's guards, forwards and centres):
  - *selection*, his share of his club's minutes (games × 200: five players for forty minutes)
    over the window: the coach's judgement;
  - *production*, his PIR a minute, shrunk toward the fringe's (the pooled rate of the quarter of
    the group with the fewest minutes that season) as if he had also played `k` minutes at it.
- **Priors, measured.** `k` is n̄(1 − r)/r, r the year-to-year correlation of PIR a minute among
  players with a quarter of their club's games in two seasons running, n̄ their minutes a season,
  over every pair of seasons from 2000/01 to 2025/26: 305 minutes for guards, 246 for forwards and
  313 for centres (about ten games each).
- **Blend.** value = w·z(selection) + (1 − w)·z(production), each signal weighed by √rel ÷ (1 − rel),
  rel its year-to-year rank correlation over the same pairs: minutes 0.51, 0.48, 0.38 and PIR a
  minute 0.60, 0.62, 0.52 (guards, forwards, centres), so minutes weigh 0.43, 0.39 and 0.40. Measured
  once over the league's history, not season by season: one season's thirty centres put the
  minutes' weight anywhere from 0.14 to 0.87. Over the earlier seasons, selection alone ranks the
  clubs at 0.17 against their SRS in the median season (every club gives its best players its
  minutes), PIR a minute alone at 0.72 and the blend at 0.70, while it orders the players within a
  club by both.
- **Scale: NBA 2K27's shape.** Each club's best five is picked by rating; the season's starters at
  each group, ranked by value, read their ratings off NBA 2K27's starters at the same group (the
  built-in basketball season's fives, each NBA club's best as many as the EuroLeague's clubs start
  there), and a bench player rates as a starter of his value would, past the starters' range along
  their least-squares line. The fives are picked again by these ratings until they settle, or
  until a set of fives comes round again (two teammates a point apart can take the last place in
  turn, as each one's starting moves the curve under them both): then that set, rated from itself.
- **Level: 6.1 points below NBA 2K27.** The players both NBA 2K and the EuroLeague rate set it:
  the 48 on this season's rosters with a EuroLeague game in the window whose names NBA 2K24–2K27
  rate (`scripts/data/euroleague-anchors.json`, from 2K Archive's pinned copy by
  `scripts/build-euroleague-anchors.mjs`; Devin Booker of Milano left out, a namesake of the
  Suns' guard). They average 72.4 in their last NBA 2K, and rated with no shift they would average
  78.6: 6.1 lower, they average 72.5 here. Before, 47 of them, the leaderboard's, at 72.5.

Why NBA 2K27's shape. The straight line had to have its slope tuned by simulation: neither
reference gives one (NBA 2K rates the fringe of its league, where EuroLeague players come from,
close together, a slope of 0.25; the curated national ratings, 0.31). A rank mapping takes the
spread from a game-rated basketball season instead, and the built-in one is the season the engine
and the realism harness are calibrated on: the NBA's records spread as the EuroLeague's do (an SD
of winning shares of 0.12–0.16 against 0.13–0.16). Ranking within groups also takes out PIR's
lean toward big men, which rebound and draw fouls: the best guard rates as the best NBA guard
does, less the level. The cost is the top: a EuroLeague star reads the NBA's stars' ratings, less
6.1, so Jonas Valančiūnas, 79 in NBA 2K26, rates 91 here and Sasha Vezenkov 89 against NBA 2K24's
75. A rating says how good a player is in the EuroLeague, on the NBA's spread at a level its NBA
players set, not what NBA 2K would rate him.

Rated so, Jean Montero and Valančiūnas rate 91, Elijah Bryant and Nikola Milutinov 90, Vezenkov and
Nadir Hifi 89; the 100 starters run from 70 to 91 and average 77.9 (76.3 before); the rostered
players with no EuroLeague game in the window rate 59 to 67.

**Positions.** The EuroLeague lists guards, forwards and centres only. A player's two places come
from that, his height and his box score per 36 minutes, as a coach would read them:

| EuroLeague | Rule | Positions |
| --- | --- | --- |
| Guard | 5.5 assists, or 4 at 188 cm or less | `PG` (7.5 assists), else `PG/SG` |
| Guard | 4 assists | `SG/PG` |
| Guard | 198 cm or more | `SG/SF`, else `SG` |
| Forward | 201 cm or less, or 204 with under 6.5 rebounds and 3 three-point attempts | `SF/PF` (200 cm or 6 rebounds), `SF/SG` (3.5 assists or 196 cm or less), else `SF` |
| Forward | taller | `PF/C` (207 cm or 9 rebounds), else `PF/SF` |
| Centre | 2.5 three-point attempts or 205 cm or less | `C/PF`, else `C` |

A player with no EuroLeague minutes is placed by height alone. Every club's best five fits its
positions: nobody plays out of position.

**Names.** EuroLeague spells names in capitals, "SURNAME, FIRST NAME". The game shows them in
title case (initials as "T.J.", "Mc" names, Jr. and IV, "de" inside a surname), takes its accented
spelling where it has one ("Ömer Kutluay") and its own mixed-case surname ("Miller-McIntyre"),
and `scripts/data/euroleague-teams.json` (`names`) spells the starters it gets wrong
(Valančiūnas, Šarić, LeDay, Horton-Tucker…).

**The clubs** (`npm run build:euroleague`, `scripts/build-euroleague.mjs`, `--check`) are
`src/data/clubs.euroleague.js`: each club's best five, the strongest lineup its players' positions
allow, as the NBA franchises', and a strength that is the five's mean. Their names leave out
sponsors (`euroleague-teams.json` `clubs`: "Crvena Zvezda", not "Crvena Zvezda Meridianbet
Belgrade"), with EuroLeague's broadcast codes. `docs/design/euroleague-audit.json` lists every
rostered player as rated: PIR, games, rating, positions, and whether he starts. Basketball's club
list is the NBA's and these (`basketball.clubs`); an earlier basketball season has the NBA's of its
year and, from 2000/01, the EuroLeague's (below, "Earlier seasons").

| | Strength | |
| --- | --- | --- |
| Olympiacos | 84 | Montero 91, Milutinov 90, Vezenkov 89 |
| Dubai Basketball, Hapoel Tel Aviv, Valencia Basket | 81 | Kabengele 86; Bryant 90; Mirotić 86 |
| Panathinaikos, Real Madrid, Žalgiris | 80 | Francisco 87; Maledon 87; Valančiūnas 91 |
| Crvena Zvezda | 79 | Moneke 87 |
| Anadolu Efes, Fenerbahçe | 78 | |
| FC Barcelona, Paris Basketball | 77 | Hifi 89 |
| ASVEL, Bayern Munich, Maccabi Tel Aviv, Olimpia Milano | 76 | |
| Beşiktaş, Virtus Bologna | 75 | |
| Baskonia, Partizan | 74 | |

**Crests** come from each basketball club's own Wikipedia article, by its Wikidata item
(`scripts/data/club-logos.json` `items`; ASVEL's is read from its file page, `pages`): Real Madrid
Baloncesto's, not Real Madrid CF's.

## The EuroLeague's rules

EuroLeague games play FIBA's rules: four ten-minute quarters and five-minute overtimes, the same
model as the nations' and the NBA's (`euroleagueBasketball`, `src/sports/basketball.js`, picked by
`matchSport` for the EuroLeague's map). Its own figures:

- **pace** 74.2 possessions, 2025/26's;
- **scoring** 1.025: the estimated fives then score the league's 86.2 points a team, as an NBA
  season's ORtg scales its franchises (1.03 for the straight line's fives, which averaged 1.6
  points less);
- **home** edge 0.06 a possession (the nations' 0.024): EuroLeague home sides win 61–66% of
  their games each season, far more than the NBA's 54–58%;
- **buzzer**: a side one or two behind at the end of regulation levels 10% or 5% of the time
  (the NBA's 30% and 20%), as only 3.3–5.2% of EuroLeague games go to overtime. The live
  win-probability model takes the rulebook's own buzzer.

`npm run simulation:realism` plays twelve seasons of the 20 clubs, 38 games each, beside the
real regular seasons of 2021/22–2025/26 (computed 2026-11-08 from every game in the API):

| | Simulated | Before 2026-11-18 | Real |
| --- | --- | --- | --- |
| Points a team | 86.3 | 86.1 | 84.1–86.2 (77.2 in 2021/22) |
| Overtime | 4.1% | 4.1% | 3.3–5.2% |
| Mean margin | 10.5 | 10.3 | 10.2–10.8 |
| Decided by 20 or more | 13.5% | 12.7% | 10.5–15.8% |
| Spread of winning shares (SD) | 0.157 | 0.140 | 0.126–0.159 |
| Home sides' wins, Home advantage on | 62.4% | 63.6% | 61.1–65.5% |
| Decided by 3 or fewer | 19.7% | 20.3% | 15.0–19.3% |
| Best and worst records, per 38 games | 30.7, 8.6 | 30.7, 10.2 | 26–30.2, 5.6–8.9 |

The second column is the straight line's (above), by the same twelve seasons. The last two rows
are known gaps, reported and not tested (`scripts/simulation-realism.test.mjs`): a few too many
close games, as in the NBA, if fewer than before, and the best club a little above any real club
of the last five seasons; the worst now comes within the real range. Any one run moves with a
rating point here or there: a copy of the same season played with eight other seeds, 40 seasons
each, has games within three at 19.4–20.0% (19.9–20.7% before), the best record at 30.8–31.5
(29.7–30.6) and the worst at 8.5–9.2 (9.0–10.6). The built-in season is being played, so its clubs
are not moved toward their results, and Olympiacos holds three of the league's six best players by
these ratings (Montero, Milutinov, Vezenkov).

## The EuroLeague's map

`public/domestic/euroleague.json` is a Europe map like football's (docs/design/domestic-campaigns.md,
"The Europe maps"), built by the same `scripts/build-europe-maps.mjs` (`--only=euroleague`) from
the clubs' arenas (`scripts/data/europe-clubs.json`, `el-` rows, placed by hand) with the same
rules: a club alone in its country holds all of it, clubs sharing one split it along its regional
borders, and a country with no club stays grey. Its index entry (`src/data/europeMaps.js`) has
`sport: 'basketball'` and no football `theatre`. 20 clubs in 10 countries:

- alone: Bayern Munich (Germany), Žalgiris (Lithuania), Dubai Basketball (the United Arab
  Emirates, far to the south-east: the opening camera frames it with the rest);
- Spain's four and Italy's and France's two each split their countries by region;
- Istanbul's three: Anadolu Efes keeps Thrace, Fenerbahçe and Beşiktaş grow over Anatolia,
  Beşiktaş starting across the Bosphorus (141 km from its arena; 99 km before the levels went
  down to the communes on 2026-11-15);
- Athens and Piraeus: Panathinaikos holds more of Greece than Olympiacos;
- Belgrade's two and Tel Aviv's two: each city is one unit of its country's finest layer, so it
  joins a neighbouring region and one club starts next door. Serbia's levels are its districts and
  municipalities, Israel's its districts and sub-districts (`COUNTRIES` in
  `scripts/lib/admin-levels.mjs`): neither source goes below the city.

## Setup

Basketball's Clubs offer two theatres in the built-in season: **NBA** (its map of the USA and
Canada) and **EuroLeague** (its map of Europe), each with its own description; the sport card
reads "Nations · NBA and EuroLeague clubs". The EuroLeague's map is a Europe map with no
`theatre` (src/data/europeMaps.js), so basketball is a theatre sport like football
(`hasTheatreMaps`) and `theatreMapsOf` lists the NBA's map, then the EuroLeague's. `setClubScope`
keeps the EuroLeague from season to season: the built-in one's map, or an earlier season's own
(below); a season before 2000/01 goes to its era's NBA map, and another sport to its own. Challenge
links carry `theatre=domestic:euroleague`; a save names the map and its version as any club map's does.

## Earlier seasons, 2000/01 to 2025/26

Asked for on 2026-11-14 ("give earlier basketball seasons their EuroLeague"). Every earlier
basketball season from 2000/01 on offers the EuroLeague beside the NBA: that season's clubs, rated
by the built-in season's rule, on a map of Europe of their own, at that season's pace and scoring
rate. The user chose the range (every season the API holds), the rating scale (each season put on
2025/26's level) and the crests (code badges for clubs the game had none for, then each club's crest
of its day on 2026-11-15, under **The clubs**).

**Coverage.** The EuroLeague's API holds every season of its own competition from its first,
2000/01 (`E2000`), to 2025/26 (`E2025`), and nothing before it: `E1999` lists no club, and its
statistics answer HTTP 404. Every season has its clubs and their rosters, every player's box score
with PIR, the clubs' team totals and every game with its score and venue. 2000/01 is the split
year's ULEB EuroLeague, without Panathinaikos, Maccabi, CSKA and Efes, who played FIBA's
SuproLeague; 2001/02 had 32 clubs, 2016/17 to 2018/19 16; 2021/22's Russian clubs, suspended in
February 2022, play their whole season here.

**Source.** `npm run sync:euroleague-seasons` (`scripts/sync-euroleague-seasons.mjs`, through
`scripts/lib/euroleague-api.mjs` and polite-fetch, cached in `data-src/euroleague/`; about 800
requests) writes `scripts/data/euroleague-seasons/E2000.json` … `E2025.json` (1.1 MB in all): each
season's clubs, with their record in every game and in the regular season; its league figures, with
the average team's PIR, assists, rebounds and three-point attempts a game; every player with a
game, 8,378 player-seasons in all, as `[code, name, club, position, height, nationality, line,
extra]`; and, since 2026-11-18, every game it played, 6,655 in all, as `[phase, local club, road
club, local score, road score, venue]` (a last 1 where the API marks the venue neutral).

- **Every player.** EuroLeague's per-game leaderboard lists only the players it qualifies (155 of
  343 in 2009/10), which would leave the clubs knocked out early with nobody; sorted by totals
  (`statisticSortMode=accumulated`) the same list has every player with a game. The built-in
  season's snapshot still reads the leaderboard (see Known limitations).
- **Players who moved.** 102 player-seasons were for two clubs ("TEL;PAN"). Each counts once, for
  the club he played the most minutes for (then the most games, then the club listed first), as an
  NBA season's traded players do: his own season page (`/v2/people/{code}/stats`) splits his games
  and minutes by club. Wenyen Gabriel's 2024/25 is Panathinaikos's (23 games), not Maccabi's (9).
- **Positions** are his club's roster's that season, else another roster's, the nearest season
  first. 62 players no roster lists (a game or two, mostly in the 2000s) are placed by their box
  score per 36 minutes: a guard with 4 assists, a centre with 9 rebounds and few threes, else a
  forward. 559 have no height, so they are placed by the box score alone.

**The ratings** are the built-in season's (`scripts/lib/euroleague-ratings.mjs`, read by
`scripts/lib/euroleague-seasons.mjs`): a player's window is the season and the two before it
(2000/01 has none before it, 2001/02 one), its priors and blend weights the ones every pair of
seasons measured, its starters ranked within their groups and read off NBA 2K27's starters 6.1
points lower. Each season's box scores are first put on 2025/26's level, column by column: its PIR
times 2025/26's average team PIR a game over its own (95.2 against 77.3 in 2010/11, a factor of
1.23), and its assists, rebounds and three-point attempts likewise (assists were counted far more
sparingly then: 10.7 a team a game in 2000/01, 18.8 in 2025/26). The ranks do not need it, but a
window spans seasons, and the positions read the box score per 36 minutes: unscaled, some 80
fives of the 2000s would have had nobody to play the point; scaled, 5 fives play someone out of
position (listed in the audit). Every season's starters average 77.6 to 78.0, as the built-in's
77.9.

**The results.** A completed season's clubs are then moved toward what they did that season
([computed-ratings.md](computed-ratings.md), step 5; the user chose the full move on 2026-11-17):

- **S**, each club's Simple Rating System, the margins of every game it played that season by
  least squares with a home edge: its regular season, Top 16 and playoffs, and the Final Four at a
  neutral venue unless a club played it in its own arena (Virtus Bologna in 2001/02, Maccabi in
  2003/04, Panathinaikos in 2006/07, Real Madrid in 2014/15). A club's arena is the venue of most of
  its regular-season home games. The snapshots keep every game for this (`games`, 6,655 in all,
  written by the same sync from its cache), so the move rebuilds without the API. Every game,
  because the 2000s' regular seasons were groups that no game connected. Its reliability r runs
  from 0.73 (2002/03, 2021/22) to 0.90 (2018/19), the home edge from 2.6 to 5.4 points.
- **m**, what the engine gives for a lineup point at that season's pace and scoring rate: 1.31
  (2010/11) to 1.51 (2025/26) points a game, measured by 16,000 simulated games a season, each
  played twice on the same random draws, at the gap and between even fives, so the luck they
  share cancels (games played once leave it ±2.4%, these ±0.3%).
- **Target** T = μ + √r × S ÷ m, μ the season's mean strength before the move. **Move**: every
  player of the five by a whole number, its best few one more (`clubMoveOf` on the strength the
  engine plays, offence weighted to the guards and defence to the bigs), until the club is
  nearest its target; no player passes one rated above him. Every club ends within 0.11 of it.

The largest moves: the London Towers of 2001/02 (0–14, SRS −27.9) by −12.4; Ovarense and the
Skyliners Frankfurt of 2000/01 (0–10, 1–9) by −9.8; Baskonia's 2000/01 (to the ULEB final, SRS
+14.1) by +9.2; FC Barcelona's 2008/09 (SRS +15.0) by +8.2; Khimki's 2020/21 (4–30) by −7.6.
ASVEL's 2024/25, fourth strongest by its box scores at 13–21, moves −4.2 to seventeenth of
eighteen. The stars of the best clubs end highest: Juan Carlos Navarro 98 in 2008/09.

Moved, the clubs' strengths rank them against their real regular-season records at a Spearman
correlation of 0.89 in the median season (0.66 in 2000/01 to 0.96 in 2025/26;
`docs/design/euroleague-seasons-audit.json`, `clubsAgainstRecords`), from 0.62 (0.33–0.81) under
the straight line and 0.65 for the new ratings before the move (`beforeTheMove`). The record is
the regular season's and the move follows every game, so it stays short of 1: 2000/01's groups
were of unequal strength. Replaying each season's own games (every fixture at its venue, 40
times), the clubs' winning shares spread as the real ones did, 0.174 on average against 0.178
(0.139 under the straight line, 0.149 before the move; each season within 0.009 of its own, from
0.040), and the simulated standings follow the real ones at 0.79 (0.42). The best and worst clubs
win 0.796 and 0.142 of their games against the real 0.799 and 0.137 (0.753 and 0.216 before),
the margins average 11.2 points against 11.0, and 18.4% of the games end within three against
17.2% (20.4%).

**The clubs.** 89 clubs played the EuroLeague from 2000/01 to 2025/26. Today's 20 keep their
identity in every season (Baskonia, not Tau Cerámica; Anadolu Efes, not Efes Pilsen); the 69
others (`scripts/data/euroleague-teams.json` `history`) are named by the EuroLeague's own
sponsor-free name for the club (its `clubPermanentAlias`), with their accents: CSKA Moscow, Siena,
Benetton Treviso, Unicaja, Arka Gdynia. One code was two clubs: EuroLeague files Ülkerspor (2001/02
to 2005/06) under the code Fenerbahçe has played under since, so those seasons play Ülkerspor
(`eras`). Each club's arena of those seasons is placed by hand (`scripts/data/europe-clubs.json`).
Every club wears its crest of the day ([period-marks.md](period-marks.md), "Coverage"): 91 period
crests from Wikipedia, Commons and the Wayback Machine's copies of them, for the 69 and for today's
20 where theirs differed (Barcelona's F.C.B. crest of 1975 to 2002, Efes's four logos, Valencia's
2017 badge before 2026/27's). ASVEL's seasons since 2019/20 wear its crest of today, the LDLC
ASVEL logo. Where no allowed source pictures or dates a club's crest of a season, it shows its
code, as the NRL's gone clubs do: 44 of the 568 club-seasons, among them CSKA Moscow 2001/02 to
2005/06, Olimpija 2000/01 to 2005/06 and Siena 2002/03 to 2005/06.

**Where they live.** Each season's EuroLeague clubs ride in its NBA season's file
(`public/basketball/nba-2k01.json` … `nba-2k26.json`), after the NBA's, `euroleague` naming their
map: `npm run build:nba-seasons` builds both from the same snapshots, and the loader
(`src/engine/footballSets.js`) checks them against their map and marks every EuroLeague rating as
an estimate. So a season loads in one request, and its version covers both leagues (a save holds
its teams, so it resumes whatever its file's version). `npm run build:euroleague` writes the
seasons' league figures (`src/data/euroleagueLeagueAverages.js`) and the audit.

**The rules.** A season's EuroLeague plays the built-in's rules at its own pace and scoring rate
(`euroleagueBasketballIn`, `src/sports/basketball.js`): its possessions a game (69.9 to 75.3) and a
scoring rate of 1.025 times its points per 100 possessions over 2025/26's 115.9, so its clubs, rated
on 2025/26's level, score its own points (74.3 a team in 2010/11 to 86.2 in 2025/26; the simulated
seasons come within 1.1, the test allowing 2.5, `scripts/basketball-simulation.test.mjs`). The home
edge and the buzzer are the built-in's: home sides won 55% to 70% of a season's regular-season
games, 63% on average.

**The maps.** One map of Europe for each run of seasons with the same clubs, built by
`scripts/build-europe-maps.mjs` with the same rules, named after the run's first season as the
NBA's era maps are: 24 maps for 26 seasons, `el2001` to `el2026`, 2019/20 and 2020/21 sharing
`el2020` and 2022/23 and 2023/24 `el2023` (143 to 159 KB each, loaded only when chosen). New
countries share their land: Russia (Moscow's clubs, Khimki, Kazan, Krasnodar, Nizhny Novgorod,
Perm and St Petersburg), Croatia (Cibona and Zadar), Slovenia (Olimpija and Krka) and Lithuania
(Žalgiris with Rytas or Neptūnas); Poland, Montenegro, Ukraine, Switzerland, Portugal and England
(the London Towers) each had one club at a time, and AS Monaco holds France's land, as in football.

- **European Russia.** Its clubs hold European Russia only, as football's earlier seasons' do
  (`within: 'EUROPEAN_RUSSIA'` in `COUNTRIES`: the federal subjects of its five federal districts
  west of the Urals), so the rest of Russia lies grey beneath, an obstacle no club claims (the map's
  `partial`), and the camera frames Europe, not Siberia. geoBoundaries' Russian districts leave out
  Moscow and St Petersburg, federal cities, so each is a gap in them; a gap holding clubs' grounds
  goes to the nearest of those clubs (`fitToOutline`'s `homes`, in European Russia only), so Moscow
  is CSKA's even where Khimki's land lies nearer (seven maps, 2009/10 to 2020/21), and football's
  maps are unchanged by it. In 2006/07 Dynamo Moscow's arena lies in that gap too, so it starts in
  CSKA's Moscow, 4 km from its own land, as football's other Moscow clubs do. (This branch first cut Russia its own way, west of 60°E; on merging
  main, whose football maps shipped European Russia first, its maps moved onto main's, so both
  sports draw the same Russia.)
- **Crowded cities.** As Beşiktaş does today, a club crowded into Istanbul or Athens can start next
  door, mostly the weakest of the city's clubs: Beşiktaş in 2012/13 (141 km from its arena),
  Galatasaray across the Bosphorus in 2011/12, 2013/14, 2014/15 and 2016/17 (136 km; in 2011/12
  and 2013/14 ahead of the weaker Anadolu Efes), Darüşşafaka in 2015/16, 2016/17 and 2018/19 (101
  to 144 km), Ülkerspor in 2001/02 to 2005/06 (102 km); AEK Athens, Peristeri, Panionios and
  Maroussi a suburb or two away (11 to 54 km), and Panathinaikos or Olympiacos in some seasons from
  2001/02 to 2009/10 (16 to 54 km). Each map's build log lists them. Which club gives way follows
  the season's strengths and arenas, so the re-rating of 2026-11-18 moved some (Olympiacos, 4–10
  in 2004/05, starts outside Athens's core), and since the levels went down to the communes
  (2026-11-15) Istanbul's clubs start farther out: about 100 km before (136 in 2016/17), and
  Ülkerspor 11 km.

**Setup.** An earlier season's club theatres are its NBA era's map and its EuroLeague's; the
EuroLeague carries over between seasons (2009/10's map, then 2019/20's), and a season before
2000/01 has the NBA alone. Challenge links carry `season=nba-2k10&theatre=domestic:el2010`, and a
link naming another season's EuroLeague map plays the season's own. A save of an earlier season may
name its EuroLeague's map, and no other season's. In passing, the seasons 2014/15 to 2025/26, which
play on today's NBA map, listed stray theatres (All, Elite and NBA) instead of the NBA's map; they
now list the NBA's and their EuroLeague's.

## EuroBasket

`SCOPES` (src/data/teams.js) gains **EuroBasket**, offered in basketball only (`sports`; the rule
is `nationTheatres` in src/data/scopes.js, which also wants four real sides, and all 24 have
one): the 24 nations of EuroBasket 2025 (`EUROBASKET_2025`), framed on Europe as the UEFA
theatre is. Its filter reads the nation's id, not its confederation, so exactly those 24 play
(the scope filters now get `{ id, conf }`). Another sport keeps the choice in its setup but plays its heartland
(football's Europe), as for any theatre a sport lacks, and basketball finds EuroBasket again; a
link to it in another sport is ignored.

Seventeen of the 24 already had a curated five. The other seven (Belgium, Cyprus, Estonia, Great
Britain, Iceland, Portugal, Sweden) now field the five who started or played most for them at
EuroBasket 2025 (FIBA's and be-basketball's box scores, their clubs as of November 2026), by
`scripts/fiba-squads.json`'s rules: NBA players rated by NBA 2K27 (Neemias Queta 80, Pelle
Larsson 78), the others curated on the file's scale for minor nations (62–71), at most one
naturalised player. Belgium's Mwema, retired from the national team in November 2025, is
replaced by Guissé. Every EuroBasket five is real; Iceland's Kristinn Pálsson, a guard who played
the four in Iceland's small lineups, is its power forward.

## Known limitations

- Every EuroLeague rating is an estimate from minutes and PIR. Ranking within position groups
  takes out PIR's lean toward rebounding big men, and minutes carry the coach's view, but within
  his group a three-and-D wing still rates lower than his coach would rate him.
- A rating reads the NBA's spread at a level the NBA-rated players set, so a EuroLeague star reads
  an NBA star's rating less 6.1: up to 91 in the built-in season (Montero, Valančiūnas), 98 after an
  earlier season's move (Navarro in 2008/09). It says how good he is in the EuroLeague, not what
  NBA 2K would rate him (Valančiūnas was 79 in NBA 2K26).
- The built-in season is being played, so its clubs are not moved toward their results; its best
  club wins more of a simulated season than any real club of the last five (above).
- The national fives' EuroLeague players play at these estimates (since 2026-11-14), so the
  estimates' limits are their countries' too: 42 of the fives' 235 players, among them Andreas
  Obst (78 curated, 73 by his EuroLeague games) and Chima Moneke (74 curated, 87). The switch
  moved 14 of the 47 nations' strengths by one or two points (Slovenia, Latvia and Italy down
  two, South Sudan up two); the re-rating of 2026-11-18 moved 12 again, Israel down two, Nigeria
  up two and ten others by one.
- Great Britain's new five makes it a real basketball side, so it now fields a team in
  basketball as in both tennis games, as Great Britain under the Union Jack on the United
  Kingdom's shape (`playsAs`); football still plays England. Basketball fields 47 nations (40
  before).
- Rosters are as of 8 November 2026. The earlier seasons are built from box scores too (NBA 2K's
  EuroLeague teams of 2K14–2K17 are not on 2K Archive's page).
- The built-in season's snapshot read EuroLeague's per-game leaderboard, which lists only the
  players it qualifies. Its window's 2024/25 and 2025/26 now come from the earlier seasons'
  snapshots, which list every player, but a player below the line in the season under way still
  counts as having played none of it; the snapshot will read every player when it is next
  refreshed.
- Earlier seasons' names are EuroLeague's, title-cased: its API spells most players without their
  accents (Jasikevicius, Tomasevic), and only today's starters have spellings of their own.
- 44 of the earlier seasons' 568 club-seasons show the club's code: no allowed source pictures or
  dates its crest of that season.
- ASVEL's crest of today (the built-in season's) is read from its file page, not from Wikipedia's
  API like the other clubs' (`pages` in `scripts/data/club-logos.json`,
  `npm run sync:club-logos -- --pages`): the sync may no longer ask that API, and its cached
  answers name the club's 2011–2018 logo, which none of its EuroLeague seasons wore. It is the LDLC
  ASVEL logo the club has worn since 2018/19, which its seasons from 2019/20 wear too. Another
  club's new crest of today would come the same way.
- Dubai, the frame's south-east corner, opens partly under the map's zoom buttons (about a third of
  its land at 1024×768); zooming or panning shows it whole. More room in the map's `focus` barely
  moves it, as the camera keeps to the map's backdrop.

To refresh: `npm run sync:euroleague -- --refresh`, `node scripts/build-euroleague-anchors.mjs` (it
reads 2K Archive's pinned copy, as `npm run build:nba-seasons` does; `npm run build:euroleague`
stops if the anchors no longer put the level at `LEVEL`, to a tenth), `npm run build:euroleague`,
`npm run build-basketball` (the national fives' EuroLeague players),
`node scripts/build-europe-maps.mjs --only=euroleague`, then `npm test`. The earlier seasons:
`npm run sync:euroleague-seasons`, `npm run build:euroleague`, `npm run build-basketball` (the
built-in season's window reads 2024/25 and 2025/26 from them), `npm run build:nba-seasons` (it needs
the NBA seasons' caches), `node scripts/build-europe-maps.mjs --only=el2001,…,el2026`, then `npm test`.
