# Women's football

Status: implemented 2026-11-07; clubs on maps of their own since 2026-11-09; computed seasons before EA's, 1991/92 to
2014/15, built 2026-11-14 ([Computed seasons](#computed-seasons)). A sport of its own in the setup, played under football's
rulebook: the same match model, squad shape, tie-break and vocabulary (`src/sports/womensFootball.js`
spreads `football`), with the women's game's own players from EA SPORTS FC 27. Football's
rule holds: **nothing is invented.**

## Data

`npm run sync:ea-fc-women` (`scripts/sync-ea-fc-women.mjs`) reads the same public ratings API
as the men's sync, with `gender=1`, cached in the ignored `data-src/ea-fc27-women/`, and
reduces it to the men's columns in `scripts/data/ea-fc27-women.csv` (committed): 1,940 players,
pulled 2026-11-07. The `drop-referrer` header matters: without it the CDN serves the
previous edition's 1,645.

The API gives sponsors' league names and some shortened or garbled club names ("BK Hcken",
"Spurs"). `scripts/data/ea-women-leagues.json` gives each league its real name, a number of the
game's own and its country, and each such club its full name. A league or nationality
missing from those tables stops the sync.

`npm run build-womens-football` (`scripts/build-womens-football.mjs`) writes
`src/data/rosters.womens-football.js` and `src/data/clubs.womens-football.js`, through the
same squad pick and compact modules as the men's; `--check` rebuilds both byte for byte.

## Nations

By EA's nationality, 78 nations have at least one rated player; 27 can field a full XI. Spain
(88), England (86), France, Germany and the United States (85) lead.

- **A nation short of eleven starts short-handed**: Zambia has Barbra Banda and two others, and
  each empty shirt counts 40. The squad screen says so. Earlier football seasons work the same
  way.
- **A nation with no rated player fields no team**, and her land stays neutral
  (`territory.inactive`). A generated squad would need women's names the game does not have,
  and would be invented. With so much neutral land, more nations reach their rivals by transit
  treaty than in men's football: on the world map Zambia's only targets are by treaty, though
  DR Congo, Tanzania and Malawi border her, because the engine asks for a direct route line.
- England, Scotland, Wales and Northern Ireland play separately, as in football.

## Clubs

84 clubs, each with its best XI in a 4-4-2, ids `w-<slug>`. EA licenses five leagues whole: the
Women's Super League (14), the NWSL (16), Liga F (16), the Frauen-Bundesliga (14) and the
Première Ligue (12). Its other twelve clubs, a club or two of each smaller league (Juventus, Roma,
Ajax, Twente, Häcken, Rosengård, Slavia Praha, Benfica, Brann, Zürich, Glasgow City, Breiðablik),
are the **Rest of Europe** league. There are no one-country maps: those hold the men's clubs.

## Club maps

Since 2026-11-09 every club holds land only in its own country, as the men's do. Until then
women's clubs were dealt across the world map (`seedClubs`: each country's strongest club took its
own, every other the nearest free country), so 70 of the 84 started abroad in All Leagues, and
11 to 15 in each of the five whole leagues: Manchester City held France, Angel City Costa Rica. Asked on
2026-11-09, the user chose Europe's clubs together, with no single-league theatres, and the NWSL
apart. So the setup offers three theatres:

| Theatre | Clubs | Map |
| --- | --- | --- |
| **Europe** (the default) | 68: every European club EA rates | `weu`, 13 countries |
| **Elite 32** | the 32 strongest European clubs | `weu32`, 6 countries |
| **NWSL** | 16 | `nwsl`, the USA |

The Europe maps follow [football's rules](domestic-campaigns.md#the-europe-maps): a country's only
club holds all of it (Glasgow City Scotland, Benfica Portugal), clubs that share a country split it
along its regional borders, and a country with no club stays grey. Clubs stand at the women's own
grounds, from Wikidata and Wikipedia (Manchester United at Leigh, Chelsea at Kingston). On
[the NWSL map](domestic-campaigns.md#the-nwsl-map) each club holds its stadium's state, California is
split three ways, and Boston Legacy, in Rhode Island until White Stadium opens in 2028, holds
Massachusetts too. European and American clubs never meet: a map of both, with the Atlantic
between, was offered and turned down. Each earlier season with clubs has its own maps (below).

A campaign saved on the world before then still loads and plays there, under its old name;
a new setup or challenge link naming an old theatre plays the map that replaced it (`all` and
the European leagues Europe, `elite` Elite 32, `NWSL` the NWSL's).

## Crests

A club with a men's side wears its crest (`twins` in `scripts/data/club-logos.json`, 55 clubs),
and a club without one has its own from Wikipedia (`items`, 23: the NWSL, OL Lyonnes, London City,
Madrid CFF and others). Six keep their monogram: Badalona Women (no item found), Costa Adeje
Tenerife (Wikidata's item is another club's), Glasgow City (no usable image), US Saint-Malo, and
Union Berlin and Brann, whose men's crests the sync rejects for their shape.

## In the code

`REAL_PLAYERS_ONLY` in `src/data/teams.js` is what stops `buildTeam` generating players, the one
place the two games must agree beyond the rulebook. `LINEUP_PLANS`, the tactical `SUPPORT` table,
the squad screen's pitch and its shape ("4-4-2"), and the built-in season list carry the sport's id.

## Earlier seasons

Eleven more seasons ship beside the built-in 2026/27, one per EA edition back to FIFA 16, the first
to rate women. Each is `public/womens-football/eaw-<edition>.json` (kind `eaw`), built by
`npm run build:womens-seasons` from committed snapshots by the built-in season's rules
(`scripts/lib/ea-women-seasons.mjs`); `--check` rebuilds every file byte for byte, offline.
`npm run sync:womens-seasons` writes the snapshots from their sources
(`scripts/data/ea-women-seasons.json` names each, with its SHA-256):

| Seasons | Edition | Source | Nations | Clubs |
| --- | --- | --- | --- | --- |
| 2025/26 | EA FC 26 | EA's ratings API, read 8 November 2026 | 70 | 74, six leagues |
| 2024/25 | EA FC 25 | Kaggle `nyagami` (EA's website, 26 Sep 2024) | 62 | 71, six leagues |
| 2023/24 | EA FC 24 | Kaggle `stefanoleone992`, women's table (launch roster) | 67 | 71, six leagues |
| 2022/23 | FIFA 23 | the same | 52 | 24: WSL and D1 Arkema |
| 2015/16 – 2021/22 | FIFA 16 – FIFA 22 | the same (FIFA 16 and FIFA 19: the compiler's file of every roster update, update 3) | 12 – 17 | none |

- **EA FC 26** is the previous edition, which EA's API serves to a request without the ratings
  site's referrer (`pullPages` takes the headers; its cache can mix the two editions for ten
  minutes, so the sync checks the count and every rating). EA's site never changed FC 26's
  ratings in season (the game's own updates did), so these are its launch-window ratings, and
  players link to SoFIFA's launch roster, 260004, as the men's EA FC 26 does. The API now names
  no club for the 126 players of the seven clubs EA has dropped since (Leicester City,
  Saint-Étienne, SGS Essen, Levante, Dijon, Carl Zeiss Jena, Alhama) and gives some clubs FC 27's
  names, so every player's club and league come from a copy taken during the season (Kaggle
  `flynn28`, GPL-3 as its compiler set it; `v1shalsb` re-uploaded its first version as CC0), which
  must rate all 1,645 players as the API does.
- **EA FC 25** is EA's website a week after release, as the men's EA FC 25: no dates of birth, full
  names or club ids. A club takes its EA team id from FC 26 or FC 27 by name, or from
  `siteClubs` (renamed and relegated clubs, by the FIFA 16 – EA FC 24 export's ids). Players
  link to SoFIFA's release roster, 250002.
- **FIFA 19 and FIFA 16 take roster update 3.** The export's update 2 of FIFA 19 (21 August
  2018) is a pre-release roster still carrying FIFA 18's ratings (Rapinoe 89, Kerr 89; 23 of 304
  overalls match the released game); update 3 (20 September 2018, Rapinoe 92, Kerr 92) is the
  first after release. FIFA 16's update 3 (25 September 2015) has the same ratings as update 2
  with full 23-woman squads. Both come from the same compiler's file of every roster update
  (Kaggle `stefanoleone992/fifa-23-complete-player-dataset`).
- **National teams only before FIFA 23.** EA rated 12 to 17 national teams a year (FIFA 16's are
  the United States, France, Germany, Canada, Brazil, Sweden, Australia, China, Italy, Mexico,
  England and Spain); every other nation fields no team, as in the built-in season, so those
  campaigns are small. Choosing Clubs with one of these seasons goes back to the built-in season.
- **Clubs of their day.** A club keeps the game's id for its EA team id, so its crest and colour
  follow it from season to season, under the name EA gave it that year: Olympique Lyonnais in
  2024/25, OL Reign and the Chicago Red Stars in 2023/24. A club EA rates with fewer than eleven
  players is left out (the audit lists them). Leagues are the built-in ones; EA's other clubs play
  as the Rest of Europe.
- **Maps of their day.** Each season with clubs plays its own maps: Europe (`weus<year>`), Elite
  32 (`weu32s<year>`) and the NWSL (`nwsls<year>`, its clubs at that season's stadiums: Kansas
  City, Kansas, in 2023). FIFA 23 rated 24 European clubs and no NWSL, so it has Europe only.
- The loader (`src/engine/footballSets.js`, kind `eaw`) holds EA's tuples as the men's seasons
  do, lists only the nations with a rated player and makes every other one inactive, and checks
  the leagues and `w-<slug>` ids against the built-in women's clubs. Saves pack players as the
  men's EA seasons do. `docs/design/womens-seasons-audit.json` lists each season's nations, clubs
  and warnings.

## Computed seasons

Built 2026-11-14, asked for under the user's request of 2026-11-13 to cover the year gaps in every sport. No game rated
women before FIFA 16, so the seasons before 2015/16 are **computed**, as men's football's World Cups of 1962 to 1994 are
([football-years.md](football-years.md#computed-world-cup-seasons)), under the user's approval of 2026-11-09 for computed
football ratings from Elo, labelled as computed. Claude chose the rest, which the user has not confirmed: the women's World
Cups and Olympic tournaments only, the men's method and constants but for the scale's top and the XI's profile, which come
from the built-in women's season, and the Olympic tournament weighed as the World Cup is in the Elo.

| Season | Id | Tournament | Finalists | Strongest (T) | Team share |
| --- | --- | --- | --- | --- | --- |
| 1991/92 | `wwc-1991` | 1991 World Cup, China (80-minute matches) | 12 | United States 88, Sweden 84.7, China 84.7 | 77% |
| 1994/95 | `wwc-1995` | 1995 World Cup, Sweden | 12 | Norway 88, United States 86.0, Germany 82.9 | 83% |
| 1996/97 | `wol-1996` | 1996 Olympic tournament, Atlanta | 8 | United States 88, Norway 88.0, China 85.0 | 83% |
| 2003/04 | `wwc-2003` | 2003 World Cup, United States | 16 | Germany 88, United States 84.8, Sweden 82.6 | 86% |
| 2004/05 | `wol-2004` | 2004 Olympic tournament, Athens | 10 | Germany 88, United States 87.7, Brazil 81.7 | 91% |
| 2007/08 | `wwc-2007` | 2007 World Cup, China | 16 | Germany 88, United States 86.0, Brazil 83.4 | 85% |
| 2008/09 | `wol-2008` | 2008 Olympic tournament, Beijing | 12 | United States 88, Germany 85.8, Brazil 85.6 | 87% |
| 2010/11 | `wwc-2011` | 2011 World Cup, Germany | 16 | United States 88, Brazil 87.5, Germany 86.9 | 87% |
| 2012/13 | `wol-2012` | 2012 Olympic tournament, London | 12 | United States 88, Japan 82.3, Brazil 78.2 | 91% |
| 2014/15 | `wwc-2015` | 2015 World Cup, Canada | 24 | United States 88, Germany 82.7, France 81.5 | 88% |

An id names the tournament's year, the file its season's: a tournament whose final falls by 31 July is the season ending
that year (the 1995 World Cup, 1994/95), one from August the season it opens (the 1991 World Cup, 1991/92; the Olympic
tournaments, whose finals fell on 1 to 26 August). So no two tournaments share a season. Each is a data set of kind
`wwc` or `wol`, nations only, labelled "Computed · 1991 World Cup" or "Computed · 2012 Olympics", which the Season list
shows as "1991/92 · computed".

### Feasibility, and what is not covered

Checked before building, as asked:

- **Results for the Elo.** [martj42/womens-international-results](https://github.com/martj42/womens-international-results)
  is a work in progress by its own account: every major tournament and its qualifiers, few friendlies (128 of the
  5,813 matches to the 2015 final). Every World Cup and Olympic match is there (26, 26, 32 … 52; 16, 20, 26, 26), and so
  are the continental championships and their qualifiers. What the missing friendlies cost is measured against FIFA's
  women's ranking, a modified Elo over every women's full international since 1971 (below): the computed Elo ranks
  FIFA's top 48 with a Spearman of 0.82 to 0.92 and its top 20 with 0.92 to 0.99 at each of FIFA's 52 releases from July
  2003 to December 2015, about as well as the men's computed Elo ranks eloratings.net's (0.86 to 0.96). FIFA published
  nothing before July 2003, so the 1990s' Elo, which rests on the tournaments and their qualifiers, cannot be checked so.
- **Squads and minutes.** The Fjelstul World Cup Database holds every women's World Cup from 1991: squads, positions,
  appearances, substitutions, goals and awards, but no appearances for 1999. The Olympic tournaments' squads are on
  Wikipedia's pages; their line-ups are on RSSSF's match details for 1996 (no minutes), 2004 and 2008, and on Wikipedia's
  match pages for 2012.
- **Not built: the 1999 World Cup and the 2000 Olympic tournament.** Neither the database, Wikipedia (the 1999 final
  only) nor RSSSF has their line-ups, and their squad pages give caps for 3 of 16 and 3 of 8 teams. Soccerdonna has
  1999's line-ups, but its terms (12.1) forbid reading it by bots or scraping and reserve text and data mining.
- **Not built: the years between the tournaments.** Wikidata records 2,947 women's national-team stints starting by
  2015, and only 2 to 9 nations a year from 1991 to 2015 have eleven players with caps (QLever, 2026-11-14), against
  the 37 to 81 nations of men's football's computed national-team seasons. Seasons of so few nations, from caps so thin,
  would not be defensible. A fill would need the national-team stints of each squad player's Wikipedia article (about
  2,000 pages) and would still field only the nations that reached a tournament.

### Sources

| Source | Pinned | Use | Licence |
| --- | --- | --- | --- |
| The Fjelstul World Cup Database ([jfjelstul/worldcup](https://github.com/jfjelstul/worldcup)) | the men's World Cup seasons' commit and files | The World Cups' squads, appearances, substitutions, sendings-off, goals and awards | CC BY-SA 4.0 |
| [martj42/womens-international-results](https://github.com/martj42/womens-international-results), `results.csv` | commit `d2aa1d5` (2026-10-31), SHA-256 | Every women's international it holds, for the Elo | Unlicense (CC0 on Kaggle) |
| English Wikipedia: each Olympic tournament's "… Women's team squads" and match pages | 11 revisions, saved 2026-11-14 | The Olympic squads (numbers, positions, dates of birth, articles), their goals, and 2012's line-ups | CC BY-SA 4.0 |
| RSSSF's Olympic match details, 1996, 2004, 2008 | 3 pages by SHA-256 | The line-ups and substitutions (2004's and 2008's with minutes) | free to copy with acknowledgement of the author |
| FIFA's Women's World Ranking, as [hlynurhallgrims/FIFA-Womens-Rankings](https://github.com/hlynurhallgrims/FIFA-Womens-Rankings) collected it | commit `34e7138`, SHA-256 | A cross-check of the Elo only, never an input | none stated |

Every download went through `scripts/lib/polite-fetch.mjs`: GitHub's files from raw.githubusercontent.com (the commits
from api.github.com, which has no robots.txt), Wikipedia's article paths 2 s apart, RSSSF's pages (no robots.txt) 3 s apart.
`scripts/data/womens-tournament-seasons.json` pins all of it, and `public/womens-football/ATTRIBUTION-computed.txt` gives
the credits CC BY-SA asks for and licenses the season files under it.

### How a season is made

- **Elo** by the men's engine and constants (`scripts/lib/football-elo.mjs`), with the women's tournaments' names: K 60
  at the World Cup and the Olympic tournament (a full international tournament for women, weighed alike in FIFA's women's
  ranking), 50 at the continental championships (the Euro, the AFC and African championships, the CONCACAF Gold Cup,
  the Copa América, the OFC's), 40 in any qualification and the Olympic qualifying tournaments, 20 in friendlies, 30
  elsewhere (the Algarve Cup and the other invitational tournaments, the unofficial championships before 1991). Every
  women's side starts at 1300. The Elo is read the day after the final.
- **Strength.** T = 88 − 3.2 × (E_best − E) / 100: 88 is the strongest built-in women's nation (Spain, EA FC 27), 3.2
  the men's line, which gives the game's football model Elo's expected score, and E_best the best of the teams that
  played in the four years before.
- **The XI**, by the men's rule: one GK, four DF, four MF and two FW by the squad's positions, of those who played, the
  most minutes first, then starts, then the lower number; a role short of them takes the most-used left. 1996's line-ups
  give no minutes, so the most starts, then appearances. 1991's matches lasted 80 minutes, 100 with extra time (Wikipedia,
  "1991 FIFA Women's World Cup knockout stage", revision 1385546027). A squad page's position is the player's, as the
  database's is: Great Britain's Kim Little, a forward there, competes for its two forward places.
- **Order and ratings.** By World Cup awards (the men's weights), then goals a minute (an appearance in 1996), then
  minutes; no Ballon d'Or before 2018, and FIFA's World Player of the Year votes (from 2001) are left out, so every
  season is ordered alike. The k-th player is T + D_k, D = +4.9, +2.6, +1.9, +1.2, +0.3, −0.2, −0.7, −1.3, −1.7, −2.7,
  −4.3: the mean sorted deviation from the XI's mean of the 16 strongest built-in women's XIs, rounded by largest
  remainders to sum to 0. The eleven are rounded together to sum to round(11 × T), as the men's are.
- **The Olympic line-ups' names.** RSSSF writes surnames ("Hamm(Gabarra)"), capitals ("JOENSSON Caroline") or numbers
  ("18-Erin McLeod"), in ASCII and with slips. A name is a squad player's by her article, by the same words (Jönsson as
  Joensson), by her number where the name shares a word, by her surname and initial, or, where two share it, a registered
  player before an unenrolled alternate. 17 names no rule matches were checked by hand and pinned in the manifest
  (`names.lineupSpellings`: "Fabta" is Fanta, "Takakua" Takakura, Greece's Giatrakis Yatrakis), and one slip
  (`names.lineupErrors`: RSSSF has Ljungberg replaced by Ljungberg in 2004, so no one gets her last 22 minutes). Every
  match looser than her article or the same words is listed in `scripts/data/womens-tournament-seasons/lineup-names.json`
  for review: Denmark's "Pedersen" of 23 July 1996 is Christina Petersen, who started both other matches as
  "C.Pedersen".
- **Nations and names of the day.** A finalist plays as the game nation its name resolves to (the squad pages' China PR
  as China), on the map of its season's year with only the finalists fielding, under women's football's names of the
  day (`src/data/namesOfTheDay.js`); none of them played as a federation of the day. Great Britain (2012) plays on the United Kingdom's shape with the home
  nations' land, under its own name and the Union Jack (`identities`, the only one a women's season may carry), and is
  rated from England's Elo: it played that tournament only, with England's squad but for two Scots.
- **Rules of the day.** A level game goes to extra time, then to its season's tie-break (`womensKnockoutIn` in
  `src/sports/womensFootball.js`): the golden goal in 1996/97 and 2003/04, as the 1996 Olympic tournament and the 2003
  World Cup played it; penalties in every other season. The 1995 World Cup played both halves of extra time, and the IFAB
  took the golden goal out of the Laws after Euro 2004, before that August's Olympic tournament.

### Calibration and checks

- **Against FIFA's women's ranking** (`scripts/data/womens-tournament-seasons/elo-crosscheck.json`): Pearson 0.79, top-48
  Spearman 0.88 and top-20 Spearman 0.96 on average over 52 releases; at the release after each season's final from 2003,
  top-48 Spearman 0.86 to 0.92. The Pearson over every team both rank is lower than the men's (0.90), as FIFA's ranking
  holds many small nations the results rate from few matches.
- **The champions.** The strongest nation by Elo the day after each final is the champion but in 2004/05 (Germany, the
  bronze medallist, 11 points ahead of the United States) and 2010/11 (the United States, runners-up, ahead of Brazil,
  Germany and the champions Japan, fourth, as FIFA's ranking had them that July). In 1996/97 the bronze medallists
  Norway are 1.3 points behind the United States.
- **The stars.** Each XI's first is the tournament's: Michelle Akers (1991), Hege Riise (1995), Birgit Prinz (2003, 2004),
  Marta for Brazil (2007), Homare Sawa for Japan (2011), Carli Lloyd (2015), Abby Wambach (2012).
- **Saves.** A computed player is a plain record, as the men's are; the largest season (2015, 24 nations) is 85 KB.

### Files and commands

```bash
npm run sync:womens-tournament-seasons -- --fetch   # download what data-src/ lacks, 2 s apart, then sync
npm run sync:womens-tournament-seasons -- --pin     # record the SHA-256 of every source after a deliberate new download
npm run sync:womens-tournament-seasons              # data-src/ → scripts/data/womens-tournament-seasons/ (--check compares)
npm run build:womens-tournament-seasons             # facts → public/womens-football/<id>.json, the listing, the audit (--check)
```

- `scripts/data/womens-tournament-seasons.json`: the manifest (sources and pins, constants, names, seasons).
- `scripts/data/womens-tournament-seasons/<id>.json`: the committed facts of each tournament (each finalist's Elo and
  rank, every squad player's minutes or appearances, starts, goals, awards, date of birth and article), with
  `elo-crosscheck.json` and `lineup-names.json`. The build reads only these and the manifest, so it rebuilds offline.
- `public/womens-football/wwc-<year>.json`, `wol-<year>.json`: `nations` lists the finalists, each `[strength, squad size,
  eleven]`, a player `[name, 'GK' | 'DF' | 'MF' | 'FW', rating, source]`; the source names her (`wc:P-…`, the database's
  id; `ol:<year>-<code>-<number>` at an Olympic tournament), her team, its Elo and its day, her place in the XI and her
  record, and links her Wikipedia article. Names are their source's: the database writes given name first ("Ailing
  Liu"), Wikipedia as the player is known ("Sun Wen").
- `docs/design/womens-tournament-seasons-audit.json`: per season each nation's Elo, rank, T, strength and XI.
- The loader (`KINDS.wwc`, `KINDS.wol`, `validateWomensTournamentSeason` in `src/engine/footballSets.js`) refuses a
  season that does not say it is computed, a nation without eleven or out of order, a player whose source does not name
  her, her team's Elo, her place and her record (minutes, or appearances where there are none), any Ballon d'Or or club,
  and any identity but Great Britain's at an Olympic tournament. `src/data/womensFootballSeasons.js` is written alike by
  both women's builders (`scripts/lib/womens-seasons-listing.mjs`).

## Tests

`scripts/womens-football.test.mjs`: the data rebuilds byte for byte; every player is EA's with
its overall and source; the rulebook is football's own; short-handed nations; nations without a
team; the leagues and Rest of Europe; crests; match scores; setup; the squad screen; the running
App launching and saving. `scripts/womens-club-maps.test.mjs`: the club maps' fields, places and
land, the setup's three theatres, challenge links, campaigns on them and old world saves.
`scripts/home-advantage.test.mjs` plays it at home too. `npm run smoke` adds a nations duel, an
NWSL blitz and an Elite 32 duel, each club theatre on its map.
`scripts/womens-seasons.test.mjs`: the earlier seasons rebuild byte for byte; each is EA's women of its
edition, with only its rated nations; clubs keep their ids across seasons under that year's names; the
loader refuses files the builder did not write; challenge links; the running App choosing, launching and
resuming a season of national teams and one of clubs on its map of Europe.
`scripts/womens-tournament-seasons.test.mjs`: the computed seasons' Elo constants and profile, the cross-check, the facts
and seasons rebuilt byte for byte, RSSSF's and Wikipedia's readers, the name rules and the reviewed names, history's spot
checks, each season's tie-break and Great Britain, the loader's refusals, and a 2012/13 campaign launched as Great
Britain, saved and resumed without the season's file. `scripts/football-knockouts.test.mjs` checks every women's
season's tie-break.

## Known limits

- No game rated women before FIFA 16: the seasons before it are computed, from the World Cups and Olympic tournaments
  alone, finalists only, and not 1999's or 2000's ([Computed seasons](#computed-seasons)).
- 51 of the 78 nations are short of eleven, some badly: nations follow club rosters, and EA rates
  few leagues outside Europe and the USA.
- **The match model is the men's, not calibrated to the women's leagues.** Measured on
  2026-11-07, every pairing of a league's clubs at Balanced, against one real season of each:

  | League | Goals a game: model / real | Draws: model / real | Home wins, rule on: model / real |
  | --- | --- | --- | --- |
  | Women's Super League 2024/25 | 2.91 / 3.21 | 22.9% / 19.7% | 45.1% / 47.7% |
  | Frauen-Bundesliga 2024/25 | 2.81 / 3.11 | 24.6% / 13.6% | 44.8% / 47.0% |
  | Liga F 2024/25 | 2.95 / 2.82 | 22.7% / 21.7% | 45.1% / 41.7% |
  | NWSL 2024 | 2.85 / 2.65 | 25.6% / 17.6% | 45.2% / 47.3% |

  So the model draws too often, by up to eleven points, and its leagues score more alike than
  the real ones, while its home wins are about right. The real figures are
  [Futbol24's](https://www.futbol24.com/national/England/Womens-Super-League/2024-2025/statistics)
  season pages; no equivalent was found for the Première Ligue. One season each is too little to
  tune on: the other sports are calibrated over four or five.
