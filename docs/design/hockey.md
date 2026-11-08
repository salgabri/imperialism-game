# Ice hockey

Status: implemented 2026-11-07. A sixth sport: the 32 NHL clubs fight over the USA and
Canada on the NHL's own map, each holding its own state or province
([domestic-campaigns.md](domestic-campaigns.md#the-nhl-map)), and the nations field the NHL's
players of each country. Everything outside the match
(territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

**This is the one sport whose ratings are partly estimates.** EA publishes NHL 27 ratings
for its top 300 players only, and 32 clubs need about 600 for full lineups. The player
chose to have hockey with the rest estimated, each estimate marked wherever it is shown,
rather than wait for a fuller list. Every other sport keeps the rule that no rating is
invented; hockey's generated players, as in baseball, are a separate thing, for a nation's
empty places, and are marked as generated.

## Data

**Source.** `npm run sync:nhl` (`scripts/sync-nhl.mjs`) joins three public sources, cached
in the ignored `data-src/nhl/`, into the snapshot `scripts/data/nhl-27.json` (57 KB,
committed):

- EA's ratings API (`drop-api.ea.com/rating/nhl`, behind `www.ea.com/games/nhl/ratings`):
  300 players, 84 and up, with overall, position, team and nationality. It needs the
  `drop-referrer` header, or the CDN can serve the previous edition.
- The NHL's rosters (`api-web.nhle.com/v1/roster/{team}/current`): 795 players with
  position and birth country, retrieved 2026-11-07.
- The NHL's statistics (`api-web.nhle.com/v1/club-stats/{team}/{season}/2`) for 2025/26
  and the season under way: games, minutes, points; for goalies, shots faced and saves.

EA's and the NHL's names differ now and then (Matthew Boldy, Matt Boldy): the sync matches
by full name, then surname on the same team, then a surname unique in the league, and
prints the loose matches for checking. **Two pairs share a name**, the Canucks' two Elias
Petterssons and two Sebastian Ahos, so a shared name goes by team and by group (forward,
defender, goalie). Three rated players are on no current roster (Larkin, Barzal,
Edvinsson): they keep EA's team.

**Estimates** (`scripts/lib/nhl.mjs`). Every player EA leaves out is ranked within his
group, and that order is spread evenly from 83, just under EA's cut-off of 84, down to 72
for skaters and 70 for goalies.

- Forwards rank by minutes a game + 8 × points a game, defenders by minutes a game + 5 ×
  points a game, goalies by save percentage.
- A few games prove little: each line starts from a replacement player's numbers (ten
  games at nine minutes and a point every ten games; 300 shots at .880).
- EA's own ratings are never changed.

The floors are a judgement: EA's depth players are not public, and 72 to 83 is where
third- and fourth-liners have sat in the editions whose full lists have been seen. An
order within a group is what the estimates can claim, not a number a player would get
from EA. On the built-in rosters a club's lineup holds 4 to 13 estimates of its 19
places, 9.7 on average.

**Clubs.** `scripts/data/nhl-teams.json` names each club, its code (the NHL's own), the
place its territory is named after, its arena and the arena's location. New York's three
are Manhattan, Long Island and Buffalo. `npm run build-hockey` (`scripts/build-hockey.mjs`)
writes `src/data/clubs.hockey.js` and `src/data/rosters.hockey.js`; `--check` rebuilds both
byte for byte. Each club fields the lineup the game picks, then a backup goalie and the
best skaters left, up to 23. The 2026/27 build runs from Carolina's 84.5 to Vancouver's
80.4.

**Nations.** A player EA rates plays for EA's nationality, anyone else for his birth
country. 16 nations field players, from Canada (92) and the United States (91) down. A
lineup place a nation's own players cannot fill is the game's to fill with a generated
player at the nation's strength, as in baseball; a nation with no NHL players is a minnow
at the baseline, 45. Great Britain plays as one, so the home nations' shapes start in the
United Kingdom's empire. This is the NHL's players only: no KHL, SHL or Liiga, so Czechia,
Slovakia and Switzerland are thinner than their real teams.

## The lineup

Nineteen starters: four centres, four left wings, four right wings, six defenders and the
goalie (`LINEUP_PLANS.hockey`). The NHL lists one position for players who play several,
so a forward on another forward's place costs only 4 points; a forward on the blue line or
a defender up front costs 15, and a skater in goal or a goalie skating 40. Strength is the
mean effective rating of the nineteen, as in the other sports.

## The match model

`src/sports/hockey.js`, in twenty three-minute slices, so the score can decide how each is
played.

- **Ratings.** A side's **attack** is 85% its forwards and 15% its defenders, its
  **defence** half the goalie and half its skaters (30% forwards, 70% defenders). Lines and
  pairs weigh by their minutes: 36, 30, 21 and 13% for the lines, 42, 35 and 23% for the
  pairs. Each goal rate is `3.06·exp(1.2·tanh(0.058·edge/1.2))` in sixty minutes, the edge
  being its attack minus the opposing defence, saturating as football's does.
- **Score effects.** Two independent rates would send one game in six to overtime; the NHL
  sends nearly one in four. From the 40th minute a level game tightens up (both rates ×
  0.72), and a side a goal down pushes (× 1.38) while the leader sits back (× 0.82). In the
  last slice a side one or two down pulls its goalie (× 1.5) and the leader gains 0.55 goals
  into the empty net. A side three or more up eases off (× 0.8) at any time.
- **Overtime.** Level after sixty, five minutes of sudden death at three on three, the
  rates × 2.4: about two in three end there, and the game stops at the goal. Still level, a
  **shoot-out**: nearly a coin flip (`logistic(0.03·difference)`), its winner one goal up on
  the final score, as the NHL counts it, with one event, nobody's goal in the scorer line.
- **Form.** One match-day draw in log rate moves both sides' rates apart: 0.1 at Balanced,
  growing with the square of the drama, as football's does. Tactics and Upsets act through
  the same effective-strength offset as the other sports.
- **Home advantage.** The option moves the two rates 0.1 apart in log, after the
  saturation, at any rating gap: equal sides win about 55% at home, and home sides 54.6% of
  a league season's games (NHL: 52.2–56.3%).
- **Scorers.** Forwards by the rating above 74, defenders at 0.3 of that weight, goalies
  never.

Measured over 40 seeded seasons of the 32 clubs (`npm run simulation:realism`) against the
league's five seasons 2021/22 to 2025/26, computed on 2026-11-07 from every game in the NHL's
own API:

| Measure | Model | NHL |
| --- | --- | --- |
| Goals a team | 3.05 | 3.01–3.14 |
| Overtime or shoot-out | 23.2% | 20.7–24.9% |
| Shoot-outs | 7.5% | 5.9–9.1% |
| Overtimes decided before a shoot-out | 67.7% | 63.5–71.6% |
| Won by one | 42.8% | 38.1–43.2% |
| Won by two | 19.2% | 17.5–21.9% |
| Won by three or more | 38.0% | 39.3–41.7% |
| Won by five or more | 6.4% | 5.5–6.5% |
| Mean margin | 2.22 | 2.20–2.31 |
| Shutouts a team game | 5.7% | 4.3–5.8% |
| Win% spread of the standings | 0.097 | 0.082–0.127 |
| Best and worst records (wins of 82) | 57, 24 | 55–65, 19–25 |
| Top scorer (goals) | 60 | 52–69 |
| Goals by defenders | 15.7% | about 15% |

Wins by three or more run a point and a half low: the last gap left, by choice. Closing it
pushes the five-goal wins out of their range. With Home advantage on, those go just over it
(6.7%).

## The clock

Minutes, as in football ("38'"), with a tick at the end of each period on the win chart. No
half-time. Overtime's goals read in minutes past sixty; a shoot-out reads "SO" on the
clock and the chart. A game decided after sixty reads "in overtime" or "in a shoot-out",
short "OT" or "SO" (`overtime` on the sport; the shoot-out counts as a second overtime
"period", so saves and the ledger need no new shape).

## Live win probability

`src/engine/winProbability.js`, kind `periods`, built from the model's own slices rather
than a curve: the remaining slices are played out backwards from each margin with the same
`sliceMeans`, the slice in progress scaled by the time it has left, form integrated with
seven-point Gauss–Hermite quadrature, then the overtime and the shoot-out. At puck drop the
chart is within half a point of the fixture's simulated odds.

## Interface

- **Setup.** A sport card, "Nations · 32 NHL clubs". Clubs have one theatre, **NHL · USA
  and Canada**. The note under Season says which ratings are estimates.
- **Squad.** A rink: the goalie in his crease, three pairs below the blue line, four lines
  above it. Groups read Centres, Wings, Defence and Goalie; the profile Attack, Defence and
  Goaltending.
- **The marks.** An estimate is an open disc on the rink (EA's are solid), "Estimated" as
  a tag on its row and in the Source column, `*` in the match lineups, "(estimated)" on a
  signing, with a note under the squad counting them. All use `src/data/estimates.js`.
- **Crests and colours.** All 32 from Wikipedia, matched by English label ("Montreal
  Canadiens", hence the spelling). Three colours are corrected: the Blackhawks' red, the
  Flyers' orange and the Predators' gold.

## Tests

`scripts/hockey.test.mjs`: the data rebuilds byte for byte; EA's ratings unchanged, every
other rating marked and under the cut-off; namesakes apart; lineups, depth and the position
penalties; nations; 4,000 games with a winner, a feed that adds up and sudden death ending at
its goal; score effects; odds; the copy and clock; the live chart against the odds; the map;
setup, the rink and the marks; the running App launching on the map and saving its marks.
`scripts/simulation-realism.test.mjs` holds the NHL ranges above and its home sides,
`scripts/home-advantage.test.mjs` the edge and the live chart at home. `npm run smoke` adds an NHL
duel campaign with the live ticker and a hockey nations campaign.

## Known limits

- About half of a lineup's ratings are estimates, and the depth players' order is only as
  good as ice time and scoring. A shutdown defender rates low.
- One season, 2026/27: EA's site shows only the current edition, and a past list of even
  300 is not public. Each rollover needs a new pull.
- NHL players only, by nationality or birth country.
- Nations campaigns are top-heavy. Half the elite 32 are minnows at the baseline, so the
  United States, Canada and Russia win about four titles in five (`npm run balance`, 1,200
  campaigns).
- No power plays, penalties or fights: a goal is a goal.
