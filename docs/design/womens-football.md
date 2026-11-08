# Women's football

Status: implemented 2026-11-07. A sport of its own in the setup, played under football's
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

84 clubs, each with its best XI in a 4-4-2, ids `w-<slug>`. EA licenses five leagues whole, and
each is a theatre: the Women's Super League (14), the NWSL (16), Liga F (16), the
Frauen-Bundesliga (14) and the Première Ligue (12). Its other twelve clubs, a club or two of
each smaller league (Juventus, Roma, Ajax, Twente, Häcken, Rosengård, Slavia Praha, Benfica,
Brann, Zürich, Glasgow City, Breiðablik), play together as **Rest of Europe**. Clubs are dealt
onto the world map from their home countries, as the men's were before their maps of Europe.
There are no one-country maps or maps of Europe: those hold the men's clubs.

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
- The loader (`src/engine/footballSets.js`, kind `eaw`) holds EA's tuples as the men's seasons
  do, lists only the nations with a rated player and makes every other one inactive, and checks
  the leagues and `w-<slug>` ids against the built-in women's clubs. Saves pack players as the
  men's EA seasons do. `docs/design/womens-seasons-audit.json` lists each season's nations, clubs
  and warnings.

## Tests

`scripts/womens-football.test.mjs`: the data rebuilds byte for byte; every player is EA's with
its overall and source; the rulebook is football's own; short-handed nations; nations without a
team; the leagues and Rest of Europe; crests; match scores; setup; the squad screen; the running
App launching and saving. `scripts/home-advantage.test.mjs` plays it at home too. `npm run smoke`
adds a nations duel and an NWSL blitz.
`scripts/womens-seasons.test.mjs`: the earlier seasons rebuild byte for byte; each is EA's women of its
edition, with only its rated nations; clubs keep their ids across seasons under that year's names; the
loader refuses files the builder did not write; challenge links; the running App choosing, launching and
resuming a season of national teams and one of clubs.

## Known limits

- Nothing before FIFA 16: no earlier EA game rated women.
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
