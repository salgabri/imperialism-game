# Basketball's European competitions: the EuroLeague and EuroBasket

Status: implemented 2026-11-08. Asked for as "in basketball can you add euroleague and european
championship (the main ones)": Europe's main club competition and its national championship.

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
list is the NBA's and these (`basketball.clubs`); an earlier basketball season has NBA clubs only.

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
keeps the EuroLeague while the season is the built-in one, the only season its map serves; an
earlier season goes to its era's NBA map, and another sport to its own. Challenge links carry `theatre=domestic:euroleague`; a save names the
map and its version as any club map's does.

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
- Rosters are as of 8 November 2026; the EuroLeague's earlier seasons are not built (NBA 2K's
  EuroLeague teams of 2K14–2K17 are not on 2K Archive's page).
- Dubai, the frame's south-east corner, opens partly under the map's zoom buttons (about a third of
  its land at 1024×768); zooming or panning shows it whole. More room in the map's `focus` barely
  moves it, as the camera keeps to the map's backdrop.

To refresh: `npm run sync:euroleague -- --refresh`, `npm run build:euroleague`,
`node scripts/build-europe-maps.mjs --only=euroleague`, then `npm test`.
