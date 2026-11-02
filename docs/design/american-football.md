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
its territory is named after, its stadium and the point its territory grows from.
Codes are three capitals, as the game's maps require: the NFL's own abbreviations
where they have three letters, and GBP, KCC, LVR, NEP, NOS, SFO and TBB for the
seven with two (GB, KC, LV, NE, NO, SF, TB). Two pairs share a stadium (the Rams
and Chargers at SoFi Stadium, the Giants and Jets at MetLife Stadium), and the map
cannot grow two territories from one point, so those four grow from their training
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

## Known limits

- No national teams: no source rates American football players by nation.
- One season. Madden's earlier editions are not on EA's site; fan compilations
  exist (as 2K Archive does for NBA 2K) but none is pinned here yet.
- Scoring is possession by possession: no defensive returns of a try, no one-point
  safeties, and the side that concedes a safety still gets the next possession
  (there is no free kick). The two-point chart is one chart for every coach.
- Grouped positions: a left tackle can play centre, an edge rusher defensive
  tackle, without penalty.
