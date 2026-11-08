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
It has one season, 2026/27.

## Tests

`scripts/womens-football.test.mjs`: the data rebuilds byte for byte; every player is EA's with
its overall and source; the rulebook is football's own; short-handed nations; nations without a
team; the leagues and Rest of Europe; crests; match scores; setup; the squad screen; the running
App launching and saving. `scripts/home-advantage.test.mjs` plays it at home too. `npm run smoke`
adds a nations duel and an NWSL blitz.

## Known limits

- One season. The Kaggle export behind football's earlier seasons has a women's table, not yet
  read: that is the way to earlier seasons if they are wanted.
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
