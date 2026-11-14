# Basketball's European competitions: the EuroLeague and EuroBasket

Status: implemented 2026-11-08, merged with main's code split and nation-theatre rule
2026-11-10. Asked for as "in basketball can you add euroleague and european championship (the
main ones)": Europe's main club competition and its national championship.

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
one comes from his EuroLeague box scores"). The national fives' EuroLeague players keep the
curated ratings they had (`scripts/fiba-squads.json`), so a player can rate differently for his
club and his country: see Known limitations.

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

**The rating** (`scripts/lib/euroleague.mjs`) is linear in a player's PIR a game:

- PIR a game over the three seasons, each game counting 0.5 in 2024/25, 1 in 2025/26 and 1.5
  in the season under way, drawn towards a bench player's PIR of 4 as if he had also played
  four games at it. A player with no EuroLeague game rates there (67).
- **Level**: PIR 9 rates 73, between the two references, which nearly agree. The 47 rostered
  players who were in a recent NBA 2K (2K24–2K27) rated 72.5 there, at a EuroLeague PIR of 8.4;
  the 30 EuroLeague players in the national fives carry a curated 73.6 at 9.2.
- **Slope**: 1.3 rating points a point of PIR, so the league's clubs spread as the real ones do.
  Neither reference can give it: NBA 2K rates the fringe of its league, where EuroLeague players
  come from, close together (a slope of 0.25), and the curated national ratings (0.31) follow
  reputation more than form. At 1.3 a simulated season of the 20 fives has the real league's
  spread of records, margins and blowouts (below).
- Bounded to 60–88. Sasha Vezenkov (PIR 21.7 a game over 87 games) rates 88, Elijah Bryant 85,
  Mike James, Mathias Lessort and Jean Montero 84; the 100 starters average 76.3.

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
| Olympiacos, Panathinaikos | 81 | Vezenkov 88, Montero 84; Lessort 84, Francisco 83 |
| Dubai Basketball | 80 | Kabengele 83 |
| Hapoel Tel Aviv, Real Madrid | 78 | Bryant 85; Tavares 81 |
| Anadolu Efes, Crvena Zvezda, Fenerbahçe, Maccabi Tel Aviv, Valencia, Žalgiris | 77 | |
| FC Barcelona, Olimpia Milano, Partizan | 75 | |
| ASVEL, Bayern Munich, Beşiktaş, Paris Basketball | 74 | |
| Baskonia, Virtus Bologna | 73 | |

**Crests** come from each basketball club's own Wikipedia article, by its Wikidata item
(`scripts/data/club-logos.json` `items`; ASVEL's names its file): Real Madrid Baloncesto's, not
Real Madrid CF's.

## The EuroLeague's rules

EuroLeague games play FIBA's rules: four ten-minute quarters and five-minute overtimes, the same
model as the nations' and the NBA's (`euroleagueBasketball`, `src/sports/basketball.js`, picked by
`matchSport` for the EuroLeague's map). Its own figures:

- **pace** 74.2 possessions, 2025/26's;
- **scoring** 1.03: the estimated fives then score the league's 86.2 points a team, as an NBA
  season's ORtg scales its franchises;
- **home** edge 0.06 a possession (the nations' 0.024): EuroLeague home sides win 61–66% of
  their games each season, far more than the NBA's 54–58%;
- **buzzer**: a side one or two behind at the end of regulation levels 10% or 5% of the time
  (the NBA's 30% and 20%), as only 3.3–5.2% of EuroLeague games go to overtime. The live
  win-probability model takes the rulebook's own buzzer.

`npm run simulation:realism` plays twelve seasons of the 20 clubs, 38 games each, beside the
real regular seasons of 2021/22–2025/26 (computed 2026-11-08 from every game in the API):

| | Simulated | Real |
| --- | --- | --- |
| Points a team | 86.1 | 84.1–86.2 (77.2 in 2021/22) |
| Overtime | 4.1% | 3.3–5.2% |
| Mean margin | 10.3 | 10.2–10.8 |
| Decided by 20 or more | 12.7% | 10.5–15.8% |
| Spread of winning shares (SD) | 0.140 | 0.126–0.159 |
| Home sides' wins, Home advantage on | 63.6% | 61.1–65.5% |
| Decided by 3 or fewer | 20.3% | 15.0–19.3% |
| Best and worst records, per 38 games | 30.7, 10.2 | 26–30.2, 5.6–8.9 |

The last two rows are known gaps, reported and not tested (`scripts/simulation-realism.test.mjs`):
too many close games, as in the NBA, and both ends of the table a little nearer the middle than
the real league's.

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
  Beşiktaş starting across the Bosphorus (99 km from its arena);
- Athens and Piraeus: Panathinaikos holds more of Greece than Olympiacos;
- Belgrade's two and Tel Aviv's two: each city is one unit of its country's finest layer, so it
  joins a neighbouring region and one club starts next door. `COUNTRIES` gained Serbia (districts
  and their municipalities) and Israel (districts and sub-districts).

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
2025/26's level) and the crests (code badges for clubs the game has none for).

**Coverage.** The EuroLeague's API holds every season of its own competition from its first,
2000/01 (`E2000`), to 2025/26 (`E2025`), and nothing before it: `E1999` lists no club, and its
statistics answer HTTP 404. Every season has its clubs and their rosters, every player's box score
with PIR, the clubs' team totals and every game with its score and venue. 2000/01 is the split
year's ULEB EuroLeague, without Panathinaikos, Maccabi, CSKA and Efes, who played FIBA's
SuproLeague; 2001/02 had 32 clubs, 2016/17 to 2018/19 16; 2021/22's Russian clubs, suspended in
February 2022, play their whole season here.

**Source.** `npm run sync:euroleague-seasons` (`scripts/sync-euroleague-seasons.mjs`, through
`scripts/lib/euroleague-api.mjs` and polite-fetch, cached in `data-src/euroleague/`; about 800
requests) writes `scripts/data/euroleague-seasons/E2000.json` … `E2025.json` (924 KB in all): each
season's clubs, with their record in every game and in the regular season; its league figures, with
the average team's PIR, assists, rebounds and three-point attempts a game; and every player with a
game, 8,378 player-seasons in all, as `[code, name, club, position, height, nationality, line,
extra]`.

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

**The ratings** are the built-in season's (`scripts/lib/euroleague-seasons.mjs`, on
`scripts/lib/euroleague.mjs`): a season's PIR a game counting one and a half times, the season
before once and the one before that half, shrunk towards a bench player's, PIR 9 rating 73 and each
point 1.3 more, between 60 and 88. Each season's box scores are first put on 2025/26's level,
column by column, so its clubs spread as today's do: its PIR times 2025/26's average team PIR a game
over its own (95.2 against 77.3 in 2010/11, a factor of 1.23), and its assists, rebounds and
three-point attempts likewise (assists were counted far more sparingly then: 10.7 a team a game in
2000/01, 18.8 in 2025/26). Unscaled, a 2010/11 starter would rate about 4 points below an equal one
of today, and some 80 fives of the 2000s would have had nobody to play the point; scaled, every
season's starters average 76.1 to 78.0 (the built-in's 76.3) and 8 fives play someone out of
position (listed in the audit).

Rated so, the clubs' strengths rank them against their real regular-season records at a Spearman
correlation of 0.62 in the median season (0.33 in 2002/03 to 0.85 in 2015/16;
`docs/design/euroleague-seasons-audit.json`, `clubsAgainstRecords`). PIR alone misreads some clubs:
ASVEL is 2024/25's second strongest at 13–21. Rating each season on its own games alone does worse
(median 0.53), so the blend stays.

**The clubs.** 89 clubs played the EuroLeague from 2000/01 to 2025/26. Today's 20 keep their
identity in every season (Baskonia, not Tau Cerámica; Anadolu Efes, not Efes Pilsen); the 69
others (`scripts/data/euroleague-teams.json` `history`) are named by the EuroLeague's own
sponsor-free name for the club (its `clubPermanentAlias`), with their accents: CSKA Moscow, Siena,
Benetton Treviso, Unicaja, Arka Gdynia. One code was two clubs: EuroLeague files Ülkerspor (2001/02
to 2005/06) under the code Fenerbahçe has played under since, so those seasons play Ülkerspor
(`eras`). Each club's arena of those seasons is placed by hand (`scripts/data/europe-clubs.json`).
The 69 have no crest in the game, so they show their code, as the NRL's defunct clubs do.

**Where they live.** Each season's EuroLeague clubs ride in its NBA season's file
(`public/basketball/nba-2k01.json` … `nba-2k26.json`), after the NBA's, `euroleague` naming their
map: `npm run build:nba-seasons` builds both from the same snapshots, and the loader
(`src/engine/footballSets.js`) checks them against their map and marks every EuroLeague rating as
an estimate. So a season loads in one request, and its version covers both leagues (a save holds
its teams, so it resumes whatever its file's version). `npm run build:euroleague` writes the
seasons' league figures (`src/data/euroleagueLeagueAverages.js`) and the audit.

**The rules.** A season's EuroLeague plays the built-in's rules at its own pace and scoring rate
(`euroleagueBasketballIn`, `src/sports/basketball.js`): its possessions a game (69.9 to 75.3) and a
scoring rate of 1.03 times its points per 100 possessions over 2025/26's 115.9, so its clubs, rated
on 2025/26's level, score its own points (74.3 a team in 2010/11 to 86.2 in 2025/26; the simulated
seasons come within 2.5, `scripts/basketball-simulation.test.mjs`). The home edge and the buzzer are
the built-in's: home sides won 55% to 70% of a season's regular-season games, 63% on average.

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
  door: Galatasaray across the Bosphorus (103 km from its arena in 2011/12), Darüşşafaka in
  2015/16 to 2018/19, Anadolu Efes in 2014/15; AEK Athens, Peristeri, Panionios and Maroussi a
  suburb or two away (30 to 54 km). Each map's build log lists them.

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

- Every EuroLeague rating is an estimate from box scores. PIR rewards rebounding big men more
  than shooters and defenders, so a three-and-D wing rates lower than his coach would rate him.
- The national fives' EuroLeague players keep their curated ratings, so a player can rate
  differently for his club and his country: Kostas Sloukas is 79 for Greece and 77 by his
  EuroLeague games, Andreas Obst 78 for Germany and 73 for Bayern. Switching the fives to these
  estimates would change several nations' strengths.
- Great Britain's new five makes it a real basketball side, so it now fields a team in
  basketball as in both tennis games, as Great Britain under the Union Jack on the United
  Kingdom's shape (`playsAs`); football still plays England. Basketball fields 47 nations (40
  before).
- Rosters are as of 8 November 2026. The earlier seasons are built from box scores too (NBA 2K's
  EuroLeague teams of 2K14–2K17 are not on 2K Archive's page).
- The built-in season's snapshot read EuroLeague's per-game leaderboard, which lists only the
  players it qualifies: a rostered player below its line rates as one with no EuroLeague game. The
  earlier seasons read every player; the built-in one will when it is next refreshed.
- Earlier seasons' names are EuroLeague's, title-cased: its API spells most players without their
  accents (Jasikevicius, Tomasevic), and only today's starters have spellings of their own.
- The 69 clubs not in today's EuroLeague have no crest in the game yet, so they show their code.
- Dubai, the frame's south-east corner, opens partly under the map's zoom buttons (about a third of
  its land at 1024×768); zooming or panning shows it whole. More room in the map's `focus` barely
  moves it, as the camera keeps to the map's backdrop.

To refresh: `npm run sync:euroleague -- --refresh`, `npm run build:euroleague`,
`node scripts/build-europe-maps.mjs --only=euroleague`, then `npm test`. The earlier seasons:
`npm run sync:euroleague-seasons`, `npm run build:euroleague`, `npm run build:nba-seasons` (it needs
the NBA seasons' caches), `node scripts/build-europe-maps.mjs --only=el2001,…,el2026`, then `npm test`.
