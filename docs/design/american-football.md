# American football (NFL)

Status: implemented 2026-10-31. A third sport beside football and basketball: the
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
are not cleared, as for the built-in EA FC 26 and NBA 2K25 data.

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
(`outOfPositionPenalty` in `src/data/teams.js`; the other sports keep 12). With 12,
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
  `logistic(logit(0.22) + 0.06·edge)`, else in a field-goal try with
  `logistic(logit(0.21) + 0.02·edge)`, made `0.85 + 0.006·(kicker − 80)` of the time
  (between 60% and 97%). A touchdown is 7: the extra point is taken as made. There
  are no safeties or two-point tries.
- **Form.** One match-day draw, `N(0, drama·0.6)` rating points, raises the
  attacker's edge and lowers the defender's, as football's form does. Predictable
  (0) leaves all the drive luck.
- **Overtime**, playoff rules, ten-minute periods: both sides possess once
  (toss for the first); still level, possessions alternate and the next score
  wins, two more each at most. After a third level period a decisive field goal
  goes to either side with `logistic(0.08·(edgeA − edgeD))`, an even coin flip
  between equals, so a match always has a winner.
- **Events.** Each score is logged at the end of its possession, the possessions
  sharing the 60 minutes (or their overtime period) evenly with a little jitter:
  "TD — Travis Kelce (KCC)" or "FG — Harrison Butker (KCC)", by quarter (Q1–Q4,
  OT). Receivers and backs finish most touchdowns (WR 3, RB 2.6, TE 1.8, QB 0.5 by
  weight, times the rating above 50), the defence returns a few, and field goals
  are the kicker's.

Measured over 20,000 seeded games of the 32 franchises: 22.5 points a team in
regulation, 4.4% of games to overtime, a median margin of 11; the commonest finals
are 17, 24, 20, 27, 10 and 13. The strongest franchise beats the weakest 91%
(Predictable), 88% (Balanced) and 84% (Wild) of the time.

## Live win probability

`src/engine/winProbability.js`, kind `drives`: a normal approximation of the
remaining margin over the possessions left (each side's mean and variance per
possession from the drive odds, the spread of the possession count, and how far
form moves both means), with P(level) carrying the overtime chain. The chain is
exact for the model's overtime before form. In overtime a lead is charted as the
trailing side's one possession to answer it: a touchdown answers anything, a field
goal only a field goal. At kickoff the chart is within 0.4 points of the fixture's
simulated odds on average (at most 1.7) under every Upsets setting.

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
  scorer lines such as "Kelce 2 TD · Butker 3 FG", overtime rows.
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
overtime; odds by Upsets setting; the event copy and scorer lines; the live chart
against the odds and through overtime; the map (one territory per franchise, its
stadium inside, New York City a New York team's, campaigns to a champion); setup;
the squad screen; and the running App launching on the NFL map and saving.
`npm run smoke` adds an NFL duel campaign with the live ticker and an NFL resume.

## Known limits

- No national teams: no source rates American football players by nation.
- One season. Madden's earlier editions are not on EA's site; fan compilations
  exist (as 2K Archive does for NBA 2K) but none is pinned here yet.
- The extra point is always good and there are no safeties or two-point tries, so
  scores are sums of 7s and 3s.
- Grouped positions: a left tackle can play centre, an edge rusher defensive
  tackle, without penalty.
