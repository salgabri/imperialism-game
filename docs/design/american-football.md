# American football (NFL)

Status: implemented 2026-10-31; touchdown tries, safeties and the NFL's key margins
2026-11-01 (simulation version 3); 2026-11-02 (version 4), an overtime side a
touchdown down no longer settles for a field goal. A third sport beside football and basketball: the
32 NFL franchises, rated by Madden NFL 27, fight over the USA. It is played with
clubs only, on the NFL's own map ([domestic-campaigns.md](domestic-campaigns.md#the-nfl-map)).
Everything outside the match (territory, the draw, targeting, conquest, signings,
saves) is the game's own, unchanged.

## Data

**Source.** EA SPORTS' Madden NFL ratings site (`https://www.ea.com/games/madden-nfl/ratings`)
lists every player of the current edition, 100 to a page, with his team, Madden
position and overall. The site renders each page on the server and embeds its
players as JSON (`__NEXT_DATA__`); `npm run sync:madden` (`scripts/sync-madden.mjs`)
reads that JSON as data, page by page, 1.5 s apart, and never runs the page's
scripts. The public ratings API behind the site (`drop-api.ea.com/rating/madden-nfl`)
still answers with Madden NFL 26 and no teams, so the pages are the only source of
the current edition.

The snapshot `scripts/data/madden-nfl-27.json` (85 KB, committed) holds one update:
**Week 7 Ratings** (`madden-ratings-week-7`, retrieved 2026-10-30), 1,946 players of
the 32 teams, each `[EA id, name, team id, Madden position, overall, jersey]`. The
raw pages are cached in the ignored `data-src/madden/<update>/`. EA's own rights
are not cleared, as for the built-in EA FC 27 and NBA 2K27 data.

**Franchises.** `scripts/data/nfl-teams.json` names each franchise (EA shortens the
New York teams to "NY Giants" and "NY Jets"), gives its scoreboard code, the place
its territory is named after, its stadium and the point the map places it at.
Codes are three capitals, as the game's maps require: the NFL's own abbreviations
where they have three letters, and GBP, KCC, LVR, NEP, NOS, SFO and TBB for the
seven with two (GB, KC, LV, NE, NO, SF, TB). Two pairs share a stadium (the Rams
and Chargers at SoFi Stadium, the Giants and Jets at MetLife Stadium), and the map
cannot divide a state from one point, so those four are placed at their training
grounds: Warner Center in Woodland Hills, The Bolt in El Segundo, the Quest
Diagnostics Training Center in East Rutherford and the Atlantic Health Jets
Training Center in Florham Park. Their stadium stays named.

**Clubs.** `npm run build-nfl` (`scripts/build-nfl.mjs`) writes
`src/data/clubs.american-football.js`; `--check` rebuilds it byte for byte.

- Madden's positions are grouped into the game's ten: QB; RB (halfbacks and
  fullbacks); WR; TE; OL (both tackles, both guards and the centre); DL (both
  edges and the tackles); LB (Sam, Mike and Will); CB; S (free and strong); K.
  Punters and long snappers have no place in the lineup and are left out.
- Each franchise fields the lineup the game itself picks from its whole roster
  (`selectLineup`), then keeps its best backups: one QB, RB, WR, TE, LB, CB and S,
  and two OL and DL. That is 34 players, 23 of them starters.
- Ratings are Madden's overalls, unchanged. A franchise's strength (`str`) is its
  lineup rating; the 2026 build runs from the Rams' 85.1 to the Dolphins' 76.5.

## The lineup

Twenty-three starters: eleven on offence (QB, RB, three WR, TE, five OL), eleven
on defence in the nickel (four DL, two LB, three CB, two S) and the kicker. The
three-receiver set and the nickel are the NFL's most common personnel. Strength
is the mean effective rating of those 23, as in the other sports.

Positions are far more specialised than in football or basketball: a tight end on
the offensive line or a receiver at cornerback is an emergency, not a rotation. So
American football's out-of-position penalty is **25** rating points
(`outOfPositionPenalty` in `src/data/teams.js`; football and basketball keep 12, baseball 20). With 12,
the optimiser started a tight end at guard for the Giants rather than a 69-rated
guard. Every franchise fields all 23 at natural positions.

## The match model

`src/sports/americanFootball.js`, possession by possession.

- **Ratings.** Each side's offence is a weighted mean of its starters by group
  (QB 30%, OL 30%, WR 24%, RB 8%, TE 8%), its defence the same over DL 32%, CB 30%,
  S 20% and LB 18%. A side's **edge** is its offence minus the opposing defence.
  Tactics and Upsets act through the same effective-strength offset as the other
  sports.
- **Possessions.** About 11 a side (± 1.1, 8 to 15), alternating from a coin toss.
- **A possession** ends in a touchdown with probability
  `logistic(logit(0.22) + 0.075·edge)`, else in a field-goal try with
  `logistic(logit(0.225) + 0.025·edge)`, made `0.85 + 0.006·(kicker − 80)` of the time
  (between 60% and 97%): 2.5 touchdowns and 1.7 field goals a side, as in the NFL's
  2023 and 2024 seasons. About one possession in 450 ends in its own end zone, a
  safety: 2 points to the defence, 13 a season (the NFL's 8–17).
- **Tries.** A touchdown is 6 and its try: the extra point, made
  `0.95 + 0.003·(kicker − 80)` of the time (between 85% and 99%; 94.5% across the
  league, against the NFL's 93.4–95.9%), or two points, made
  `logistic(logit(0.48) + 0.025·edge)` of the time. Early on a side goes for two
  after one touchdown in twelve; over its last three possessions it follows the
  coaches' chart, going for two when the touchdown leaves it up 1, 5 or 12 or down 2,
  5, 10 or 13. One touchdown in ten goes for two and 49% of the tries are made: the
  NFL went for two after 9.8% of its touchdowns in 2024, making 56.5% in 2023 and
  40% in 2024.
- **Form.** One match-day draw, `N(0, drama·0.35)` rating points, raises the
  attacker's edge and lowers the defender's, as football's form does. Predictable
  (0) leaves all the drive luck. With the drive odds' 0.075 per rating point, a
  17-game season spreads the 32 franchises as the NFL's do (from about 14.6 wins
  to 2.4); the old 0.06 and 0.6 bunched them between 13.9 and 2.9 and let the
  rating favourite win 63% of games, against the NFL's two in three.
- **Late-game play-calling.** Over each side's last three possessions of regulation
  the drive odds follow the score before it. Three scores up or down the game is
  played out. Two scores up a side runs the clock (touchdown ×0.6), a score up it
  plays safe (×0.6, field-goal try ×0.8). Level or two down it settles for the field
  goal that wins (touchdown ×0.5, field-goal try ×3), three down for the one that
  draws level (×0.8, ×2). Needing a touchdown it goes for it on fourth down
  (touchdown ×1.25, field-goal try ×0.25); two scores down it chases (×1.5, ×0.5).
  Games end about 11 points apart, more than half within a score and one in seven by
  exactly 3, twice as many as by exactly 7, as the NFL's do. Independent drives left
  them 13 apart, and with every touchdown worth 7 (simulation version 2) more games
  ended by 7 than by 3. Who wins hardly moves.
- **Overtime**, playoff rules, ten-minute periods: both sides possess once
  (toss for the first). The first kicks after a touchdown; the second plays to its
  score (level or a field goal down it plays for three, a touchdown down it needs
  one), and its touchdown wins outright, or is kicked to win after a missed extra
  point or to draw level after a made one. Still level, possessions alternate and
  the next score wins, two more each at most. A score that wins ends the game: a
  touchdown has no try, and a safety wins it for the defence. After a third level
  period a decisive field goal goes to either side with
  `logistic(0.08·(edgeA − edgeD))`, an even coin flip between equals, so a match
  always has a winner. Overtime games end by 3 (a field goal, or a touchdown after
  one) more often than by 6 or 7.
- **Events.** Each score is logged at the end of its possession, the possessions
  sharing the 60 minutes (or their overtime period) evenly with a little jitter:
  "TD — Travis Kelce (KCC)" (6, 7 or 8 points with its try), "FG — Harrison Butker
  (KCC)" or "SAFETY — Chris Jones (KCC)", by quarter (Q1–Q4, OT). Receivers and
  backs finish most touchdowns (RB 4.25, TE 2.1, WR 1.9 each of three, QB 1.1 by
  weight, times the rating above 50) and the defence and returners a few, so
  receivers score about 38% of touchdowns, backs 34%, tight ends 14.5%,
  quarterbacks' own runs 8% and returns or the defence 6%, as in the NFL's 2023–2025
  seasons. Field goals are the kicker's; a safety goes to the pass rush, a defensive
  lineman most often, then a linebacker, now and then a defensive back.

Measured over 20,000 seeded games of the 32 franchises: 22.5 points a team in
regulation, 5.7% of games to overtime, a median margin of 8; the commonest finals
are 17, 20, 24, 13, 27 and 23. The strongest franchise beats the weakest 95%
(Predictable), 94% (Balanced) and 92% (Wild) of the time: the Rams' lineup rates
8.6 points above the Dolphins', far more than any other pairing. Over whole
17-game seasons (`npm run simulation:realism`) 15.2% of games are decided by
exactly 3, 7.9% by exactly 7 and 53.6% by 8 or fewer, against the NFL's 14.2–16.2%,
6.7–8.7% and 50.7–57.6% in 2020–2025.

## Live win probability

`src/engine/winProbability.js`, kind `drives`: a normal approximation of the
remaining margin over the possessions left (each side's mean and variance per
possession from the drive odds, touchdowns with their early-game tries and
safeties included, the spread of the possession count, and how far form moves both
means), with P(level) carrying the overtime chain. Late-game play-calling and the
two-point chart are left out: they shape the margin far more than who wins. The
chain is exact for the model's overtime before form, the second possession at its
late-game odds (`lateCall`). In overtime a lead is charted as the trailing side's
one possession to answer it: a touchdown wins against up to 5 and, with its extra
point, against 6, and levels 7 with the extra point; a field goal wins against 1 or
2 and levels 3. A live model saved before tries (simulation version 2) charts every
extra point as made. At kickoff the chart is within 0.3 points of the fixture's
simulated odds on average (at most 1) under every Upsets setting.

## Interface

- **Setup.** A third sport card, "32 NFL clubs". Choosing it switches Teams to
  clubs and disables Nations ("American football is played by NFL clubs only.");
  the one theatre is **NFL · USA**, and the Season list holds the built-in 2026.
- **Squad.** A field instead of a pitch: the offence below the line of scrimmage,
  the defence above it, the kicker aside, with smaller discs (names hidden on
  phones). Groups read Quarterback, Running back, Receivers, Offensive line,
  Defensive line, Linebackers, Secondary and Kicker; the profile reads Offence,
  Defence and Kicking. The lineup is the "Starting lineup" ("Starters" in short).
- **Match.** Kickoff and Final, quarter ticks on the chart, a marker per score,
  scorer lines such as "Kelce 2 TD · Butker 3 FG" or "Rice 1 TD · Jones 1 safety"
  (ranked by the scores, a touchdown 6 whatever its try, so an archived final reads
  the same from its feed copy), overtime rows.
- **Copy.** Each sport module now carries its `words` (kickoff, end, lineup names),
  which the match, squad, ledger, conquest and masthead view-models read instead
  of testing for basketball.

## Saves

NFL squads are plain records, as the basketball clubs' are, so checkpoints store
them in full. A save names `sport: "american-football"` (the validator now accepts
every registered sport) and `clubScope: "domestic:nfl"` with the map's version.

## Tests

`scripts/american-football.test.mjs`: the clubs rebuild byte for byte and match
the snapshot's ratings; every franchise fields 23 natural starters; the 25-point
penalty; 3,000 games with a winner, a feed that adds up, NFL-like scores and
overtime, every kind of score and more games decided by 3 than by 7; the tries,
safeties and overtime walk-offs; odds by Upsets setting; the event copy and scorer
lines, live and archived; the live chart against the odds, through overtime, from a
model saved before tries, and its overtime chain against simulated overtimes; the
map (one territory per franchise, its stadium inside, New York City a New York
team's, campaigns to a champion); setup; the squad screen; and the running App
launching on the NFL map and saving. `scripts/simulation-realism.test.mjs` holds
whole seasons to the NFL's key margins, one-score share, tries and safeties.
`npm run smoke` adds an NFL duel campaign with the live ticker and an NFL resume.

## Earlier seasons

Twenty-five more seasons ship beside the built-in 2026: 2001 to 2025, Madden NFL 2002 to
Madden NFL 26, each edition's roster at launch (data set `madden-<season>`, kind `madden`;
a season is a calendar year, and Madden NFL 06 rates 2005). Clubs only, as today. Two
editions are called Madden NFL 25: the 2013 one (instead of "14") and the 2024 one. Five
Tecmo Super Bowl seasons, 1990 and 1992 to 1995, go further back ([Tecmo seasons](#tecmo-seasons)),
three more from Madden NFL 99, 2000 and 2001 fill 1998 to 2000 ([Madden NFL 99 to 2001](#madden-nfl-99-to-2001)),
and the seasons no game rated, 1960 to 1989, 1991, 1996 and 1997, are computed from Pro Football
Archives' facts, with the AFL's ten seasons before the merger beside them ([Computed seasons](#computed-seasons)).
Every NFL season from 1960 to 2026 is now there.

- **Sources.** Every launch roster comes from a copy made at the time: EA's ratings services
  now serve rewritten launch iterations, so none is read from them. Of the 1,000 players EA's API
  listed first for Madden NFL 22 on 1 August 2021, today's launch list lacks 63 and rates 40
  differently; Madden NFL 26's base list, refreshed after the August cuts, has 1,866 players
  where launch had 2,367, and rates 81 of the 1,727 both have differently.
  - 2001–2020, 2022 and 2023: maddenratings.net's spreadsheets of each edition's original
    roster, one per team (Madden NFL 2002 to 21, 23 and 24). `scripts/lib/madden-workbooks.mjs`
    reads them: .xlsx with fflate, and Madden NFL 11's .xls with a small BIFF8 reader. Each file
    is taken for its team by its file name and checked against its sheet (the sheets name teams
    by nickname, "Bucs", or a misspelt "Jagaurs").
  - 2021: the Madden NFL 22 launch workbook kellerdevin/Madden-22-Data-Set keeps (65 players a
    team); maddenratings.net has only that edition's final roster.
  - 2024 and 2025: theedgepredictor/nfl-madden-data's raw copies of EA's ratings site at launch
    (Madden NFL 25; Madden NFL 26 as the site listed it on 2 August 2025). Its processed and
    dataset folders are model-imputed and never read.
- **Checks.** Every season is compared with a second source, and the agreement is in the
  audit. EA's own copies agree player for player wherever they survive: Madden NFL 16's list
  (2,326 players) and Madden NFL 17's sheet (2,363), EA's ratings API as the Wayback Machine
  kept it on 1 August 2021 (Madden NFL 22's top 1,000) and in 2022 (all 2,368 of Madden NFL 23),
  and EA's team pages at Madden NFL 25's launch (73 and 70 players). Every other season agrees
  with theedgepredictor's raw files (mostly scraped from maddenratings.net) on 99–100% of the players
  both list.
- **Pinned.** `scripts/data/nfl-seasons.json` pins every source by SHA-256; the copies stay in
  the gitignored `data-src/madden-seasons/<season>/` (a team's spreadsheet as
  `team-<EA team id>`). `npm run sync:madden-seasons` reads them into
  `scripts/data/madden-seasons/<season>.json` (committed: `[name, EA team id, Madden position,
  overall]`, the checks and the notes); `--check` rebuilds them byte for byte where the copies
  are present.
- **Building.** `npm run build:nfl-seasons` builds each season from its snapshot by the built-in
  season's rules, now in `scripts/lib/nfl.mjs`, which `build-nfl.mjs` also uses (its output is
  unchanged): `public/american-football/madden-<season>.json`, the listing
  `src/data/americanFootballSeasons.js` and `docs/design/american-football-seasons-audit.json`.
  `--check` rebuilds every file byte for byte, offline. Older editions call the ends LE and RE
  and the linebackers LOLB, MLB and ROLB: they are DL and LB. On a thin roster of the early
  2000s the game sometimes starts a player out of position before a weak natural one (a
  linebacker kicking for a 48-rated kicker); the natural players it passes over stay in the
  squad, so every club keeps a natural player for every place.
- **Left out, never guessed.** Madden NFL 2004 and 2005 name 45 and 36 players only by position
  and number ("C.#25", "LG #65"): nobody can say who they were, so they are left out (only the
  2003 Chargers' CB C.#25, 72, would have started). The 2010 Vikings' spreadsheet gives RT Phil
  Loadholt no overall and has an empty FB row: both are left out. Two players of one name and
  position on one team are both kept (the Panthers' two LB Jason Williamses in 2011).
- **As the game shipped.** 2011 is Madden NFL 12's default roster, rated before the lockout
  ended: Kevin Kolb is still an Eagle, Matt Hasselbeck a Seahawk, Nnamdi Asomugha a Raider.
  Madden NFL 2002 has 31 teams and no Tom Brady. Madden NFL 06's spreadsheets rate SS Ed Reed and
  P Shane Lechler 99, which the site's own 99 Club note leaves out; no other copy survives to
  settle it.
- **Clubs of their day.** The manifest names the eras in which a franchise played under another
  name or elsewhere: the St. Louis Rams (to 2015), the San Diego Chargers (to 2016), the Oakland
  Raiders (to 2019), each with its own id (so no crest), code (STL, SDC, OAK) and colour; Washington (to 2019,
  `nfl-washington`: its name then was a slur the league has since retired) and the Washington
  Football Team (2020–21); no Houston Texans in 2001, so that season has 31 clubs. The stadiums
  they left: Sun Devil Stadium (Cardinals, to 2005), the Georgia Dome (to 2016), Memorial
  Stadium in Champaign (Bears, 2002), Texas Stadium (to 2008), the Pontiac Silverdome (2001), the
  RCA Dome (to 2007), the Metrodome (to 2013) and TCF Bank Stadium (2014–15), Foxboro Stadium
  (2001), Veterans Stadium (to 2002), Candlestick Park (to 2013), Husky Stadium (2001), the
  Coliseum (Rams, 2016–19), the StubHub Center (Chargers, 2017–19), and Tiger Stadium in Baton
  Rouge, where the Saints played most of their 2005 home games after Hurricane Katrina. The
  franchises that share a stadium grow from their training grounds, as today: the Giants from
  Giants Stadium (to 2009), the Jets from Hofstra University (to 2007), the Rams from California
  Lutheran University in Thousand Oaks and the Chargers from Costa Mesa (2020–23). A stadium a
  club still plays in keeps its present name; one it has left is named as it was best known. The
  eras agree with the franchise research of 1980–2025 on every name, code, city and stadium (to
  a kilometre).
- **Era maps.** `npm run build:nfl-map` also draws thirteen era maps from the manifest: `nfl2001`,
  `nfl2002`, `nfl2003` (2003–04), `nfl2005`, `nfl2006` (2006–07), `nfl2008`, `nfl2009`, `nfl2010`
  (2010–13), `nfl2014` (2014–15), `nfl2016`, `nfl2017` (2017–19), `nfl2020` (2020–21) and
  `nfl2022` (2022–23). A move starts a new map, a rename does not; 2024 and 2025 have today's
  clubs in today's stadiums and play on `nfl`. Clubs rank as their franchises rank today, so
  section ids follow one order on every map. Missouri is divided between the Rams and the Chiefs
  until 2015, and the Coliseum and the StubHub Center are both Los Angeles County's: the NFL's
  `maxGapKm` of 5 km cuts the county between them (today's map is the same with or without it).
  A season's clubs play only on its era's map; saves name the set, its version and its season
  ('2005').
- **Tests.** `scripts/nfl-seasons.test.mjs`: the position groups; squads on invented rosters (the
  passed-over kicker kept, a short roster refused); eras, renames and an absent franchise; the
  readers (repeated headers, unrated and unnamed rows, a synthetic .xlsx, CSV quoting) and the
  checks; every snapshot, season, listing and audit byte for byte, `build-nfl.mjs` too; every
  check's agreement and EA's exact ones; each season decoded against its era's map, its clubs
  named and housed as that year had them; the loader's refusals; and the running App choosing a
  season, launching its clubs on their era's map, saving and resuming.

## Tecmo seasons

Status: data prepared and shipped as five seasons 2026-11-08 (see **Seasons** below). The Tecmo
Super Bowl games rate the 1990 and 1992 to 1995 NFL seasons player by player, by attributes on a
16-step scale (6, 13 … 100), with no overall. `node scripts/sync-tecmo.mjs` reads the games'
roster dumps and writes one committed snapshot a season, `scripts/data/tecmo/<season>.json`, which
the seasons are built from; `--check` rebuilds them byte for byte, `--season=<year>` one of them.

| Season | Game (platform) | Read from | Checked against | Clubs | Players |
| --- | --- | --- | --- | --- | --- |
| 1990 | Tecmo Super Bowl (NES, Dec 1991) | `TSBData.txt` | Tecmo Geek: 839 of 840 identical | 28 | 810 |
| 1992 | Tecmo Super Bowl II: Special Edition (SNES), cartridge season 1 | `TSB2Data.txt` | a second tsbtools dump: 1,036 of 1,036 | 28 | 991 |
| 1993 | Tecmo Super Bowl (SNES, Dec 1993) | `SNES_05_TeamDefense_input.txt` | GameFAQs roster FAQ: 879 of 896 | 28 | 868 |
| 1994 | Tecmo Super Bowl II: Special Edition (SNES), cartridge season 3 | `TSB2Data.txt` | a second tsbtools dump: 1,036 of 1,036 | 28 | 1,002 |
| 1995 | Tecmo Super Bowl III: Final Edition (SNES) | `TSB3Data.txt` | NFTGL's Book of Armaments: 1,101 of 1,107 | 30 | 1,079 |

- **Sources.** The dumps are BAD-AL/tsbtools' (GitHub), each byte for byte the repository's
  git blob, which the sync checks. The 1993 one is a simulation test's input: its names, numbers
  and attributes are the stock cartridge's, only the simulation values changed. TSB II's 1993
  season (cartridge season 2) and the Genesis cartridge are not rating sources: SNES Tecmo Super
  Bowl is the 1993 edition its transcription confirms. TSB II's two seasons rest on one
  extraction: its second dump comes from the same tools and no independent transcription exists,
  which each 1992 and 1994 snapshot states. The 1980s are left out (Tecmo Bowl's 1987 set has
  12 clubs of nine a side), and so is 1991 (no Tecmo edition rates it): both are computed instead
  ([Computed seasons](#computed-seasons)). Every input stays in the
  ignored `data-src/research80s/american-football/` and `data-src/research/american-football/`,
  pinned by SHA-256 in the sync (`PINS`), and each snapshot lists the files it read.
- **Attributes.** Each player keeps the game's values under the screen's names: running speed
  (RS), rushing power (RP), maximum speed (MS), hitting power (HP), body balance (BB, TSB II
  and III), agility (AG, TSB III), passing speed, pass control and accuracy (PS, PC, PA), avoid
  rush (AR; Tecmo Geek's avoid pass block), coolness (CO), ball control (BC), receptions (REC),
  pass interceptions (PI), quickness (QU) and the kicking values (KP, KA, AKB). TSB II and III's
  dumps (and the Book of Armaments) list RP before RS, as TSBM 2000 does: they are swapped back,
  after which every edition gives every quarterback rushing power 69 and every kicker running
  speed 56 and rushing power 81, as NES Tecmo Super Bowl does. John Taylor's receptions are 69 in
  the NES dump and 63 at Tecmo Geek: the dump's are kept.
- **Clubs.** Players are keyed by today's franchise (`scripts/data/nfl-teams.json`), and each
  snapshot names the clubs as `data-src/research/eras/nfl.json` has them that season (the
  Phoenix Cardinals to 1993, the Los Angeles Raiders to 1994, the Houston Oilers, the San Diego
  Chargers, the St. Louis Rams in 1995) with their era id, which the sync checks against that
  file. Washington's club is named Washington, as the Madden seasons name it before 2020 (the
  eras file has `nfl-washington-redskins`). TSB III's free agents (Deion Sanders among them) and
  all-time team are no club.
- **Names.** nflverse's rosters (CC-BY 4.0) name a player when he is on his club's roster that
  season (or the one before or after: the games were made between seasons) under the game's
  name: last names equal, cut short or a letter apart (two in a long name), first names equal,
  the given name nflverse keeps, an initial, a short form or a letter or two apart, never both
  approximate. So `haywood JEFFRIES` is Haywood Jeffires and `m. MERRIWEATHE` Mike
  Merriweather. The rest keep the game's spelling in ordinary capitals (4, 1, 8, 3 and 39 a
  season, most of them TSB III players nflverse does not have on that club in 1995), listed in
  each snapshot.
- **Unlicensed stars.** The games list players outside the players' union licence by position
  and club (`qb BILLS`, `hb BILLS`): 3 in 1990, 60 in 1992, 4 in 1993, 33 in 1994, 16 in 1995.
  One is named only where nflverse lists him on the club that season in the position group and
  the game names nobody else so: by his jersey number, when exactly one such player is shown
  wearing it for the franchise within three seasons (by nflverse or another edition) and nflverse
  gives him no other number that season; without a number (the NES and SNES ones are #0), when he
  is the only such player, or when the other edition rating the season (TSB II's 1993) has him in
  the same slot. Anybody else is left out. Named: 1, 43, 4, 27 and 15 a season (Thurman Thomas,
  Bruce Smith, Derrick Thomas, Joe Montana in 1993 …); left out: QB Bills and QB Browns in 1990
  (nflverse lists two quarterbacks the game does not name for each: Jim Kelly and Gale Gilbert,
  Bernie Kosar and Jeff Francis), 17 in 1992, 6 in 1994 and 1 in 1995. Each decision, with its
  candidates and evidence, is in the snapshot's `placeholders`.
- **Positions.** Slots map onto the game's ten: QB; RB; WR; TE; C, G and T to OL; RE, NT, LE (and
  TSB II and III's second line) to DL; the four linebackers (and LB5) to LB; RCB and LCB to CB;
  FS and SS to S; K. Punters are left out. The nickel and dime slots play where most of their
  players did in the NFL (nflverse's CB, FS, SS or S): SNES DB1 at corner (13 corners, 2
  safeties) and DB2 at safety (8 safeties, 3 corners); TSB II and III DB1 and DB2 at corner (50
  and 36 corners against 2 and 8 safeties over the three seasons) and DB3 at safety (44 safeties,
  5 corners). Defenders play their slot, as the game has them (Cortez Kennedy at inside
  linebacker is a linebacker). Backs, receivers and tight ends play their own position: one-back
  clubs carry a receiver in their second back's slot and a back in their third receiver's, and
  the run-and-shoot clubs receivers in their tight-end slots. NES takes Tecmo Geek's labels
  (Atlanta, Detroit and Houston with six receivers and no tight end); the others nflverse's
  position, where it names the player (12 to 18 players a season).
- **The overall is ours.** Each edition gets one position score from the raw attributes. NES:
  Tecmo Geek's ratings (each attribute against the best at the position, hitting power by bands,
  weighted to 100; backs as rushers, receivers and tight ends as receivers), which the sync
  reproduces for 811 of Tecmo Geek's 812 published ratings (John Taylor's is the other). SNES:
  no agreed formula, and its attributes are NES's: Tecmo Geek's weights and bands, against the
  best SNES values. TSB III: the NFTGL's weighting (The Book of Armaments, 2017 update; the
  league has revised it over the years), each attribute times its weight, summed, as the Book's
  point values; the weights reproduce all 1,147 of them (1,133 at the position the Book lists,
  14 at another back's, receiver's or tight end's). They apply here by the screen's names, so
  the Book's own sums, made in TSBM order, give its RS weight to the screen's RP. Its bonus terms
  (+50 or +100 points over thresholds) are no part of those values and are left out. TSB II: no agreed
  formula; TSB III is its engine with agility added, so the NFTGL weighting applies without
  agility. Then each position's scores are ranked within the season (mid-rank percentiles, ties
  sharing one) and read off Madden NFL 2002's overalls at that position (the 2001 season, the
  earliest Madden season; maddenratings.net's 31 team sheets, punters out), as many of each Madden
  team's best as the season carries per club, so that a Tecmo backup meets Madden's backups. The
  overall is rounded and held to 1–99, never falls as the score rises, and is comparable within
  a season, not across seasons. Each snapshot holds the formula, its maxima, weights and every
  position's Madden overalls, so the overall can be recomputed from the snapshot alone.
- **Lineup gaps.** NES Tecmo Super Bowl fields a 3-4 with two corners: every 1990 club is a
  lineman and a corner short of the game's nickel lineup; SNES Tecmo Super Bowl lists three
  linemen: every 1993 club is a lineman short. The run-and-shoot clubs have no tight end (Atlanta,
  Detroit and Houston in 1990; Atlanta and Houston in 1992 and 1993; Atlanta in 1994), and an
  unlicensed tackle nobody can name leaves Washington (1992) and Carolina (1995) an offensive
  lineman short. No player is added: the game fills the place out of position. `SEASONS` in
  `scripts/lib/tecmo.mjs` documents every gap and the sync stops on any other. The game's lineup
  also puts a back at kicker for a few clubs whose kicker rates more than 25 below their best
  spare back (Cincinnati in 1992, 1994 and 1995 …). The build accepts both: `squadOf` in
  `scripts/lib/nfl.mjs` takes a club's documented gaps and stops on any other shortfall, and an
  emergency kicker is the game's own choice, as in the Madden seasons (the kicker stays in the squad).
- **Snapshots.** `source` (game, platform, release, season, the dump's repository path and blob,
  every input's SHA-256, the check, the names' source, the notes and limits), `conversion` (the
  formula, the attributes' names, the position rules and evidence, and Madden NFL 2002's
  reference by position), `teams` (by franchise: the era id, name and code that season),
  `lineup` (the game's needs and each club's gaps), `placeholders` and `players`, each `[name,
  franchise, Tecmo slot, game position, overall, { rom (the game's spelling), no (jersey), the
  attributes, id (nflverse's gsis id, where it has one) }]`, by club, position and overall.
- **Tests.** `scripts/tecmo.test.mjs`: the rebuild (where `data-src/` has the inputs), the pins,
  every season's clubs, eras and players club by club, the era table against the eras file, every
  unlicensed star's decision and that no generic name survives, the attributes on the scale and
  in the screen's order, the slot rules, every club's lineup or its documented gap (and the game
  filling every place), the formula stated as applied, the overall recomputed from the raw
  attributes, monotonic and within 1–99, the percentile mapping and the Madden reference, the
  checks' agreement, Tecmo Geek's published examples and the NFTGL's, and the readers.
- **Seasons.** `npm run build:nfl-seasons` builds `public/american-football/tecmo-<season>.json`
  (kind `tecmo`, a calendar year) from each snapshot, listed after the Madden seasons in
  `src/data/americanFootballSeasons.js`: "Tecmo Super Bowl (NES)" (1990), "Tecmo Super Bowl II"
  (1992 and 1994, the cartridge's first and third seasons), "Tecmo Super Bowl (SNES)" (1993) and
  "Tecmo Super Bowl III" (1995). Its source names the game and platform (`edition`), the dump's
  repository (`url`), BAD-AL/tsbtools and the overall's sources (`compiler`), the day the inputs
  were read, and the snapshot's `conversion`, the loader's proof that the overall is ours. Each
  club fields its lineup and backups by the Madden seasons' rules, every player and overall as the
  snapshot has them; club strengths run 69.3–82.5 (1990), 71.8–82.2 (1992), 69.5–81.8 (1993),
  71.5–83.5 (1994) and 71.8–84.3 (1995).
- **Out of position.** A documented gap goes to the best spare player, whatever his position (in
  1990 the 49ers' Steve Young lines up on the defensive line). Beyond the gaps, the game starts a
  spare player at kicker where the kicker rates more than 25 below him: 1992's 49ers (Joe
  Montana), Bengals and Patriots, 1994's Cowboys, Browns, Rams, Buccaneers and Bengals, and 1995's
  Chiefs, Rams, Buccaneers, Bengals and Jaguars. It also prefers a spare player to a weak natural
  one in six places: a linebacker at corner (1992 Saints, 1994 Lions), a back at corner (1992
  Seahawks, 1995 Cowboys) and at tight end (1992 Eagles), and a linebacker at tight end (1995
  Seahawks). The natural players stay in the squad, and the audit lists every club's
  out-of-position starters.
- **Era maps.** Four more maps by the same builder and rule: `nfl1990`, `nfl1992` (1992–93),
  `nfl1994` and `nfl1995`. From the franchise research: the Phoenix Cardinals (PHO) to 1993 and the
  Arizona Cardinals from 1994, both at Sun Devil Stadium; the Los Angeles Raiders (RAI, LAR being
  the Rams' code) at the Coliseum and the Los Angeles Rams at Anaheim Stadium to 1994; the Houston
  Oilers at the Astrodome; the Cleveland Browns at Cleveland Municipal Stadium (no Ravens until
  1996, and no Browns 1996–98); the San Diego Chargers; Washington at RFK Stadium, holding only the
  District; Atlanta–Fulton County Stadium (1990), Riverfront Stadium, Mile High Stadium, Three
  Rivers Stadium, the Kingdome and Tampa Stadium. 1995 adds the Carolina Panthers and the
  Jacksonville Jaguars and has the Raiders back in Oakland and the Rams in St. Louis (the Trans
  World Dome for the whole season, though its first four home games were at Busch Stadium). The
  Panthers played that first season at Clemson University's Memorial Stadium, in South Carolina,
  while their Charlotte stadium was finished: by the rule every map follows (a club plays where it
  played its home games that season, as the 2002 Bears in Champaign and the 2005 Saints in Baton
  Rouge), they hold South Carolina in 1995, and North Carolina is nobody's.
- **Season tests.** `scripts/nfl-seasons.test.mjs`: the gaps `squadOf` accepts and refuses; each Tecmo
  season's clubs and players as its snapshot has them, its gaps filled by the game and its
  out-of-position starters in the audit; the eras on their maps (the Coliseum, Anaheim, the
  Astrodome, RFK, Clemson); the loader's refusal of a season without its `conversion`; and a 1990
  campaign launched on its era's map and saved.

## Madden NFL 99 to 2001

Status: built 2026-11-09, on the user's request that day to cover every season it can ("can you do all you
can to cover gaps in every sports year"); the coordinator chose this source for 1998 to 2000. Three seasons,
kind `madden`, clubs only, each on an era map of its own:

| Season | Data set | Edition | Overall | Clubs | Players | Strengths | Team overalls (Spearman) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2000 | `madden-2000` | Madden NFL 2001 | EA's | 31 | 1,504 | 80.9–86.3 | 0.832 |
| 1999 | `madden-1999` | Madden NFL 2000 | ours (converted) | 31 | 1,215 | 68.1–84.6 | 0.903 |
| 1998 | `madden-1998` | Madden NFL 99 | ours (converted) | 30 | 1,180 | 71.7–82.9 | 0.875 |

- **Source.** NFL Draft Buzz's Madden Ratings Database (`https://www.nfldraftbuzz.com/madden`, live since June
  2026) carries EA's per-player data of every edition back to Madden NFL 92, which no archive checked before had
  kept. The ratings are EA SPORTS'; the compilation, and the players' names, are NFL Draft Buzz's: its matcher
  bridges each game row to a Pro-Football-Reference id by name, team, position and jersey. Where it can be checked
  it agrees (its Madden NFL 2002 Bills equal maddenratings.net's workbook). The site states no terms of use and its
  robots.txt carries only a Sitemap line. Its pages were saved with curl, one request every 8 s, on 2026-11-09 (the
  research pass's and this build's alike; Node's fetch is answered with a Cloudflare 403, is not used, and no
  challenge was ever solved): 86 team pages, 27 position lists and 15 player pages, in the ignored
  `data-src/ndb-madden/`, each pinned by SHA-256 in `scripts/data/ndb-pages.json` with the checks' sources (nflverse's
  1998–2000 rosters, CC-BY 4.0, and maddenratings.net's three edition pages). Where an edition recorded no overall the
  site shows its own, marked OVR* (its two best attributes averaged): it is never read. `npm run sync:madden-early`
  (`scripts/sync-madden-early.mjs`, the readers in `scripts/lib/ndb-madden.mjs`) writes one committed snapshot a
  season, `scripts/data/madden-early/<season>.json`; `--check` rebuilds them byte for byte, `--pin` rewrites the pins.
- **Players.** Each club's team page (`/madden/team/<nickname>/<edition>`) lists every player with his position,
  jersey and attributes. The Raiders', Rams' and Chargers' pages are empty for these editions (the site files them
  under today's cities): their players come from the position lists (`/madden/year/<edition>/<group>`), which show
  fewer attributes and leave out a few position labels (LLB, RLB, LT/RT: the 1998 Cowboys' Randall Godfrey and Dexter
  Coakley), and their kickers' power and accuracy from their player pages. A player a team page lists under two
  positions sits in its "Other" table, which shows no blocking or catching: his player page gives the edition's values
  (11 players). The lists agree with the team pages on every value both show for 1,042 of 1,043, 1,073 of 1,075 and
  1,342 of 1,345 players.
- **Positions.** The site's labels map onto the game's ten: two-position labels by their first (LT/RT a lineman), LLB
  and RLB linebackers, NT a lineman. A generic defensive back (DB) plays safety where nflverse lists him at safety that
  season (2, 5 and 34 of 79, 80 and 107), else corner. Punters and long snappers are left out.
- **Left out, never guessed.** Two rows of one club under one of the site's players, their values apart, are one game
  row the matcher named twice: the row in the jersey nflverse gives him that season stays (else the first, as the site
  lists a club by depth), the other is left out (Rob Moore's second row, #20, on the 1998 Cardinals; Kevin Mitchell's,
  Marty Moore's and Marquis Walker's; Todd McClure's and Mark Campbell's, both in their own number). Where the site
  puts one of its players on two clubs of an edition, their values apart, the matcher has named a second club's game
  row after him; which row is his own the site cannot say, so the same rule decides: the row on the club and in the
  jersey nflverse gives him that season stays (where nflverse has him on both, as Marcus Nash on the 1999 Broncos and
  Ravens, the club he left during the season, where the launch roster had him), the other is left out (the 1999
  Ravens' Nash; the 2000 Panthers' Donta Jones, Bengals' Myron Bell and Broncos' Nate Wayne). A player whose
  edition did not track a value his overall needs is left out (Marcus Spriggs, 1999). Each snapshot names them.
- **Lineup gaps.** The site's copy lacks some players: the 1998 Dolphins have one receiver (O.J. McDuffie, Lamar
  Thomas and Oronde Gadsden are missing), the 1998 Colts and 49ers and the 1999 Eagles and Washington no kicker, the
  1998 Panthers four linemen, the 1999 Colts two receivers and the 1999 Eagles no tight end, and the 1998 Cardinals'
  third receiver is Rob Moore's second row. No player is added: the game fills each place out of position, as for the
  Tecmo seasons (`GAPS` in the sync documents them and stops on any other shortfall).
- **The overall of Madden NFL 99 and 2000 is ours.** Each player's attributes are weighted as Madden NFL 2001's
  overall weights them: a least-squares fit of its EA overall on the attributes both the team pages and the lists show
  for a group (QB: THP THA AWR SPD AGI ACC; RB: SPD ACC AGI AWR STR CAR; WR: SPD ACC AGI AWR CTH; TE: SPD ACC AGI AWR
  STR CTH; tackles, guards and centres apart: AWR STR AGI PBK RBK; DL: STR SPD ACC AGI AWR TAK; LB: SPD ACC AGI AWR STR
  TAK; CB and S apart: SPD ACC AGI AWR TAK CTH; K: AWR KPW KAC), over Madden NFL 2001's 28 team pages (1,274
  players; in-sample Spearman 0.73 for kickers, 0.95–0.99 for every other group). The scores are then ranked within the
  season at each game position and read off Madden NFL 2002 exactly as the Tecmo seasons' (`scripts/lib/nfl-reference.mjs`,
  moved there from the Tecmo library; the Tecmo snapshots rebuild byte for byte). Each snapshot stores the weights,
  every player's attributes and score, and the reference, so the overall can be recomputed from it alone. The label
  says so: "Madden NFL 99 (converted)", "Madden NFL 2000 (converted)", and the source block has overall 'converted',
  rawScale 99 and the conversion.
- **Madden NFL 2001 keeps EA's overall**, unchanged (rawScale 99, no conversion). EA rated that edition high: its
  clubs run 80.9–86.3, every one stronger than Madden NFL 2002's weakest, and closer together.
- **Checks.** Club strengths order maddenratings.net's team overalls at Spearman 0.875 (Madden NFL 99), 0.903
  (2000) and 0.832 (2001, EA's own). Of Madden NFL 99's 99 and 100 overall clubs, Jerry Rice, Tony Boselli, Ben Coates
  and Bruce Smith rank first at their positions, Mark Schlereth and Neil Smith second, Barry Sanders fourth, Deion
  Sanders twentieth of 146 corners; Jason Sehorn is not in the site's copy. In Madden NFL 2000 Deion Sanders and
  Dermontti Dawson rank first, Mike Alstott tenth of 137 backs; Barry Sanders, who retired days before its release, is
  not in the site's copy. 98.7%, 98.7% and 89.6% of the players are on nflverse's roster of their club that season.
- **Era maps.** `nfl1998` (the Oilers at Vanderbilt Stadium in Nashville, the Ravens at Camden Yards, the Buccaneers
  at Raymond James Stadium, no Browns), `nfl1999` (the Browns back, the Titans at Adelphia Coliseum) and `nfl2000`
  (the Bengals at Paul Brown Stadium, the Seahawks at Husky Stadium), by the rule every map follows.
- **Tests.** `scripts/madden-early.test.mjs`: the readers on pages laid out as the site's (OVR* never read, an empty
  page, a value not tracked), the positions, the fit, the conversion recomputed from each snapshot, the checks as
  recorded, Madden NFL 2001's overalls unchanged, and the snapshots rebuilt byte for byte where `data-src/` has the
  pages.

## Computed seasons

Status: built 2026-11-09. On the user's request that day (computed seasons from per-player records may go back to
1960, not further) the coordinator chose Pro Football Archives' facts for the seasons no game rated: the NFL's 1960
to 1989, 1991, 1996 and 1997 (data sets `pfa-<season>`) and the AFL's ten seasons before the 1970 merger
(`pfa-afl-<season>`), kind `pfa`, clubs only, labelled "NFL (computed)" and "AFL (computed)" so the Season list
tells the two leagues of a 1960s year apart. The user asked for an Approximate Value: Pro-Football-Reference's own is
off limits (its pages challenge automated clients, and Sports Reference's data-use terms forbid building on scraped
data), so the value here is ours, AV-like.

- **Source.** Pro Football Archives (`https://www.profootballarchives.com`, (c) 2006–2026, a privacy policy and no
  terms of use; robots.txt is HTTP 404) has every NFL and AFL team-season with complete starting lineups (games started
  sum to 22 a game), positions with sides (LOT, RDE, LLB, LCB, and LS and RS for the safeties) and every box-score
  table. Only facts are taken: who played, at which position, in how many games and starts, and the season's totals.
  `npm run fetch:pfa` (`scripts/fetch-pfa.mjs`) saved each season's league index and club pages (the regular season's)
  into the ignored `data-src/pfa/<year>/`, one request every 5 s, on 2026-11-09, and pins every page by SHA-256 in
  `scripts/data/pfa-pages.json`; an answer other than 200 or 404 stops it. The site's owner was not contacted.
  `npm run sync:pfa` (`scripts/sync-pfa.mjs`, the reader and value in `scripts/lib/pfa.mjs`) writes one committed
  snapshot a season, `scripts/data/pfa-seasons/<season>.json` and `afl-<season>.json`, and
  `scripts/data/pfa-seasons/calibration.json`; `--check` rebuilds them byte for byte, `--tune` reruns the weights' search.

- **Positions.** The site's codes map onto the game's ten by a player's first listed position: QB; HB, FB, RB
  backs; FL, SE, OE and WR receivers; TE (and H-back) tight ends; the tackles, guards and centres the line; ends,
  tackles, nose guards and middle guards the defensive line; every linebacker; LCB, RCB, CB, DB and the nickel corners
  CB; LS and RS (before the 1980s the site's left and right safeties; its long snapper is LONG), FS, SS and S
  safeties; K. Punters, long snappers and kick returners have no place in the lineup and are left out. The site's slips
  are read as meant (`SLIPS`: ROG0LOT, RDTLDE, LLLB …), and a code the sync does not know stops it.
- **Kickers.** A player who tried a field goal is a kicker too, and a punter who did is one (P-K). One who also played
  a position (George Blanda at quarterback, Paul Hornung at halfback, Gino Cappelletti at flanker) is listed once, at
  his larger share: where his value stands higher among the league-season's players at that place (the plan's rule).
  Hornung and Blanda stay at their positions in their great seasons, and their clubs' kicking falls to the game, out
  of position.
- **The value.** Each club's credit is its points per game against the league-season's (scored for the offence,
  conceded for the defence), to the power 0.25; each league-season's mean is its own (the AFL's apart from the NFL's).
  It is shared out: the offensive line by starts (each lineman's games started over five a game); quarterbacks, backs,
  receivers and tight ends by their share of the club's production (rushing and receiving yards, 0.2 a passing yard,
  40 a touchdown run, caught or thrown, less 60 an interception thrown, never below nought) plus 0.15 of a game started
  (a tight end 0.3); defenders two thirds by starts (over eleven a game) and one third by their share of the
  defence's plays (2 a sack where the site records them, 1.5 an interception, 1 an opponent's fumble recovered, 1 a
  return touchdown); kickers by field goals made, 0.3 an extra point and 3 a field goal beyond the league's rate.
  Tackles (only from 2001) and Pro-Football-Reference's AV are not used. A player of two clubs that season has his
  values summed and plays for the one he started most for (then played most for); his other clubs are noted.
- **Tuning.** The weights were tuned once on 2001 to 2005, each player's value against his overall in the next
  season's Madden launch roster (Madden NFL 2003 to 07, the committed snapshots; players matched by name), by the mean
  of the ten positions' Spearman correlations: a grid around the plan's draft (pass yard 0.5, touchdown 20,
  interception 45, tight-end blocking 0.5 of the starts …) and a second around the first's best, the club's credit
  linear. Then its power: 1 gave a dominant club's every starter a top place at his position, spreading the computed
  2001 season's clubs over 71.3–88.3 where Madden NFL 2002's 2001 runs 72.7–83.9; 0.25 spreads them 73.5–85.0, the
  nearest in width of 1 to 0.1. Then frozen (`VALUE_WEIGHTS` in `scripts/lib/pfa.mjs`; `npm run sync:pfa -- --tune`
  reruns the search). Against the next season's Madden ratings they order quarterbacks at 0.82, receivers
  0.86, linebackers 0.79, corners 0.78, backs 0.78, safeties 0.76, the defensive line 0.74,
  tight ends 0.71, the offensive line 0.68 and kickers 0.64 (mean 0.757; `calibration.json` has every
  season's).
- **The overall.** Each league-season's players are ranked at their game position by value, then games started, then
  games played, and read off Madden NFL 2002's overalls at that position exactly as the Tecmo seasons' and Madden NFL 99
  and 2000's are. The label says so ("NFL (computed)", "AFL (computed)"), and the source block has method 'computed',
  rawScale 'value' and the conversion. Each snapshot keeps every player's starts, games and value, and the reference,
  so the overall can be recomputed from it alone.
- **The strikes.** 1982's strike cancelled seven weeks: the season is ranked as played, nine games (the site lists a
  cancelled game without a score, and no such game is read). 1987's cancelled one week and was played by replacement
  players for three (4 to 19 October): that season ranks the clubs' own players only. A replacement player is one the
  strike games' box scores (their starters and every player with a statistic; `npm run fetch:pfa` saves the 42 of
  them) name as often as he played, or one who played no more than three games and for no club in 1986 or 1988 (a box
  score names no substitute without a statistic): 1,221 left out, 1,537 kept. The clubs' credit is still their whole
  season's, strike games and all.
- **Lineup gaps.** No player is added: a place a club has too few natural players for is the game's to fill out of
  position, and the snapshot documents it (63 club-seasons of the 43): a third corner for 36 two-corner defences,
  mostly before 1975 (the game's lineup is the nickel); a kicker for 21 clubs whose kicker played a position for his
  larger share (Hornung's Packers, Blanda's Oilers, Cappelletti's Patriots); a third receiver for 9 clubs of the 1960s
  and 1970s; a tight end for the run-and-shoot Lions of 1989 and Oilers of 1991, as in the Tecmo seasons.
- **Results.** Club strengths run 70.8–86.7 over the 43 seasons (the Madden seasons' 69–85) and follow each season's
  results: Spearman 0.58–0.97 against the clubs' winning shares, 0.83 on average, where Madden's launch ratings of
  2001 to 2005 reach 0.15–0.55 (0.36) against theirs: a hindsight rating. The champions or the best records lead: the
  1962 Packers (13–1, 85.2), the 1968 Colts (13–1, 86.5), the 1969 Vikings, the 1972 Dolphins (14–0, 83.8), the 1985
  Bears (15–1, 85.0), the 1989 49ers, the 1991 Washington club (14–2, 85.5), the 1996 Packers, the 1997 Broncos; in
  the AFL the 1960 Oilers, the 1964 Bills, the 1967 Raiders and the 1969 Chiefs. Of the 43 seasons' champions (the
  NFL's and AFL's title winners, the Super Bowl's from 1970), 16 rate first and 29 in the top three. Where they do
  not: the 1979 Steelers, Super Bowl champions at 12–4, fifteenth of 28 (the most points, yet a line and a secondary
  that shared their starts, and a starting line rates mostly by its starts); the 1970 Colts tenth of 26, the 1980
  Raiders ninth and the 1971 Cowboys seventh; the 1960 Eagles, champions at 10–2, sixth of 13 (their receivers and
  corners thin); the 1965 Packers third behind the 49ers, who scored the most and finished 7–6–1; the 1976 Raiders
  (13–1) eighth; and, though not champions, the 1987 49ers (13–2) twelfth of 28, their line and tight ends sharing
  starts. Every season is in the audit with each club's record and points, its gaps and its out-of-position starters.
- **The AFL.** Its ten seasons are computed as the NFL's are, each ranked among its own players, so its clubs read as
  strong as the NFL's of the same year though they were not: the two leagues never meet in the game, and each 1960s
  year has both seasons, labelled "NFL (computed)" and "AFL (computed)". Its clubs are 8 to 1965, 9 in 1966–67 and
  10 in 1968–69; they join the NFL's seasons from 1970.
- **Era maps from 1960.** The franchise eras now run from 1960 (`teams` in `scripts/data/nfl-seasons.json`), every
  existing era unchanged in effect: every season and map before rebuilds byte for byte but `nfl1990`, whose seasons
  are now 1988 to 1991 (no club moved: its shapes are unchanged, its version is new, and a save on it resumes on the
  updated map club by club). A club plays where it played most of its home games that season, which the sync checks
  against Pro Football Archives' scores of every season (where two venues shared them evenly, the eras may name
  either). One second home is not counted, as the franchise research of 1980–2025 has it (`SECOND_HOME` in the sync):
  the Packers' games at Milwaukee's County Stadium, two or three a season to 1977 and three or four from 1978, so they
  stay in Green Bay in 1978 and 1980 (four and four) and in the strike season of 1982, when three of their four home
  games were in Milwaukee (Wisconsin is theirs either way). Stadium points come from the franchise research of
  1980–2025 or the manifest where it has them, else from each stadium's Wikipedia article (read 2026-11-09 from
  `/wiki/` pages, which robots.txt allows; its APIs it does not), to four decimals. A move starts a map, a rename does
  not: 20 new NFL maps,
  `nfl1960`, `nfl1961` (1961–63), `nfl1964` (1964–65), `nfl1966`, `nfl1967` (1967–69), `nfl1970`, `nfl1971`, `nfl1972`,
  `nfl1973` (1973–74), `nfl1975`, `nfl1976` (1976–79), `nfl1980` (1980–81), `nfl1982` (1982–83), `nfl1984` (1984–86),
  `nfl1987`, `nfl1996`, `nfl1997`, `nfl1998`, `nfl1999` and `nfl2000`, and ten AFL maps, `afl1960` to `afl1969` (a
  venue moved every year). The clubs of their day: the St. Louis Cardinals at Busch Stadium (Sportsman's Park) to 1965
  and Busch Memorial Stadium to 1987; the Baltimore Colts at Memorial Stadium to 1983; Washington at Griffith Stadium in
  1960, then RFK Stadium; the Steelers at Forbes Field to 1963 (most home games: 5–1, 6–1, 5–2, 4–3 against Pitt
  Stadium), at Pitt Stadium to 1969; the Bears at Wrigley Field, the Eagles at Franklin Field, the 49ers at Kezar and
  the Cowboys at the Cotton Bowl to 1970 (Texas Stadium from 1971: five of seven home games); the Lions at Tiger
  Stadium to 1974; the Giants at Yankee Stadium to 1972, at the Yale Bowl in 1973 (five of seven) and 1974, so they
  hold Connecticut, and at Shea in 1975 with the Jets, who grow from their Hofstra base (the Giants' own base that
  season is not established; they grow from Shea); the Rams at the Coliseum to 1979; the Saints at Tulane Stadium to
  1974; the Vikings from 1961 at Metropolitan Stadium; the Falcons from 1966, the Saints from 1967, the Seahawks and
  Buccaneers from 1976. 1996 and 1997 add the Ravens at Memorial Stadium (no Browns 1996–98), the Panthers in
  Charlotte, and in 1997 the Tennessee Oilers at the Liberty Bowl in Memphis and Washington at its Maryland stadium.
- **The AFL's clubs.** Eras with `league: 'AFL'` (teamsOf takes the season's league; the NFL's seasons never field
  them): the Boston Patriots at Nickerson Field, Fenway Park (1963–68), Alumni Stadium (1969) and, in the merged NFL,
  Harvard Stadium (1970); the New York Titans and then the Jets (1963) at the Polo Grounds, at Shea from 1964; the
  Dallas Texans at the Cotton Bowl to 1962, then the Kansas City Chiefs at Municipal Stadium; the Oakland Raiders at
  Kezar (1960) and Candlestick Park (1961), both in San Francisco, Frank Youell Field (1962–65) and the Coliseum; the
  Los Angeles Chargers at the Coliseum (1960), then San Diego at Balboa Stadium and San Diego Stadium (1967); the
  Houston Oilers at Jeppesen Stadium, Rice Stadium (1965–67) and the Astrodome; the Bills at War Memorial Stadium; the
  Broncos at Bears (Mile High) Stadium; the Dolphins from 1966 at the Orange Bowl; the Bengals from 1968 at Nippert
  Stadium. Each AFL map's index entry names its league, `AFL`, which the setup shows as the theatre ("AFL · USA").
- **Tests.** `scripts/pfa-seasons.test.mjs`: the reader on pages laid out as the site's (exhibition, playoff and
  cancelled games left out, a slip in a count read past, the draft list not the roster), the positions and the site's
  slips, the kickers' rule, the value on invented clubs (the line by starts, each league its own mean), the 1987 rule,
  ties by starts then games, every season recomputed from its snapshot, every club's lineup or its documented gaps, the
  calibration as recorded, and the snapshots rebuilt byte for byte where `data-src/pfa/` has the pages.
  `scripts/nfl-seasons.test.mjs` adds the seasons from 1960 on their maps (the Texans at the Cotton Bowl, the
  Patriots' four Boston grounds, the Giants holding Connecticut, the Jets growing from Hofstra in 1975, the Oilers in
  Memphis and Nashville, no AFL club in an NFL season nor the reverse, the expansion clubs and the Browns), the loader's
  refusals (a computed season without its conversion, a converted Madden edition without one, an AFL club on an NFL map
  and the reverse) and the running App launching and saving 1965's NFL and AFL seasons. `scripts/club-maps.test.mjs`
  holds the 30 new maps to the state rule.

## Known limits

- No national teams: no source rates American football players by nation.
- Seasons from 1960, not earlier (the user's floor for computed seasons). Only Madden NFL 2001 and
  2002 on carry EA's overall; Madden NFL 99 and 2000 and the Tecmo games' overall is ours, from their
  attributes, and every season before 1998 but the Tecmo ones is computed from what the players did:
  a hindsight rating, which follows that season's results more closely than a game's pre-season
  ratings do. Madden NFL 97 and 98 (1996, 1997) are not used, on the coordinator's choice: the
  research found Madden 98's 1–15 attributes order its team overalls at only 0.58, and Madden 97's
  recorded overall on an odd scale, with nothing to check it against and rows repeated.
- NFL Draft Buzz's copy of Madden NFL 99 to 2001 lacks a few players (documented lineup gaps), and its
  player names are its own matcher's. EA's rights in it are not cleared, as for the other Madden seasons.
- The AFL's seasons are ranked within the AFL: its clubs and the NFL's of the same year cannot be compared,
  and never meet.
- Scoring is possession by possession: no defensive returns of a try, no one-point
  safeties, and the side that concedes a safety still gets the next possession
  (there is no free kick). The two-point chart is one chart for every coach.
- Grouped positions: a left tackle can play centre, an edge rusher defensive
  tackle, without penalty.
