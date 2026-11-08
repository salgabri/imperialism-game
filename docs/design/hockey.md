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

## Earlier seasons

Five earlier seasons, each one EA edition's ratings of an NHL season: its clubs on the map of
their day, its nations by birth country. **Nothing in them is estimated**: a player the
edition does not rate is not there, and a club it leaves short fields what it has (the lineup
picker moves a defender up front, or leaves an empty shirt at its floor; a backup goalie the
picker would put on a forward line is left out of the squad instead).

| Season | Edition | Source | Players | Clubs | The game's overalls | Played at |
| --- | --- | --- | --- | --- | --- | --- |
| 2021/22 | NHL 22 | NHLRatings.net's team pages (CommonCrawl, Jan–May 2022) | 679 | 32 (8 one to three players short) | 70–95, median 82 | the same |
| 2006/07 | NHL 07 | IGN's NHL 07 pages of EA's ratings (Wayback Machine) | 858 | 30 | 54–96, median 74 | the same |
| 1994/95 | NHL 95 | Jon Morris's NHL 95 sheet (nhl-95.com); Segathon for the Rangers | 616 | 26 | 33–99, median 55 | 71–99, median 82 |
| 1993/94 | NHL 94 | KinGraph's sheet of the cartridge's attributes | 605 | 26 (Anaheim, Florida 3 forwards short) | 29–99, median 54 | 71–97, median 82 |
| 1992/93 | NHLPA 93 | The cartridge's attributes (forum.nhl94.com) | 556 | 24 (Ottawa, Tampa Bay 2 forwards short) | 1–99, median 52 | 71–97, median 82 |

The three 1990s seasons are played rescaled onto NHL 27's ratings, by the player's choice
("The scale", below); NHL 07 and NHL 22 are played at EA's own numbers.

**Pipeline.** `node scripts/sync-nhl-seasons.mjs` reads the downloads (cached in the ignored
`data-src/nhl-seasons/`, every one pinned by SHA-256 in `scripts/data/nhl-seasons-sources.json`;
`--fetch` downloads a missing one, a CommonCrawl page from its WARC record) and writes one
snapshot per season, `scripts/data/nhl-seasons/nhl-<year>.json`: each player's name, club,
position, overall, birth country and NHL id, and the source's players it leaves out, with why.
`node scripts/build-nhl-seasons.mjs` builds `public/hockey/nhl-<year>.json`,
`src/data/hockeySeasons.js` and `docs/design/hockey-seasons-audit.json` from the snapshots and
the manifest `scripts/data/nhl-seasons.json`; both have `--check`. The lineups, depth (23) and
nations are the built-in season's rules (`scripts/lib/nhl.mjs`), shared code.

**The NHL's own rosters** (`api-web.nhle.com/v1/roster/{team}/{season}`) give every player his
position and birth country, matched by name on his club (the cartridges' abbreviated
spellings, "Alexnder Mogilny", "John Vanbiesbrk", are aliases in the manifest), then by name
anywhere that season, then in the seasons beside it for a player who did not play. A
namesake is never taken twice (the two Petr Sykoras of 2006/07). The club is always the
edition's: its roster at release, with the players it still carried who did not play that
season (Brian Leetch's Bruins in NHL 07, Shea Weber's Canadiens in NHL 22) and without the
trades that came after. A player no NHL roster names in or beside the season has no
position or birth country to give him and is left out (Mike McNeill in NHLPA '93, five in
NHL 07); NHL 22's six such players keep EA's position from the site.

**The classic games' overall.**

- *NHL '94* stores 0–6 attributes and computes its overall: KinGraph's de-duplicated sheet of
  the cartridge (forum.nhl94.com topic 19828) holds the attributes, and the overall is the
  game's own rule as wboy reverse-engineered it (topic 228): skaters' agility ×2, speed ×3,
  offensive awareness ×3, defensive awareness ×2, shot power, checking ×2, stickhandling ×3,
  shot accuracy ×2, endurance and passing; goalies' agility, defensive awareness and puck
  control ×4.5 each (each term rounded down) and the four stick and glove sides; a sum below
  50 halves and adds 25, rounded down; 99 at most. Gretzky is 87; Lemieux's 100 caps at 99.
  NHL94.com's and KinGraph's own overall columns round a half up (about 120 weak players one
  point high) and are not used.
- *NHLPA '93* stores 0–15 attributes and shows no overall. Its overall is NHL '94's weights on
  the values the game displays, floor(v × 20 / 3): the weighted mean, rounded down, 99 at most
  (Ed Belfour's and Patrick Roy's 100 cap at 99). A goalie's weights are NHL '94's goalie
  weights. It gives Shawn Chambers, whose attributes are nearly all zero, the 1 he is
  remembered for; it matches 3 of 6 in-game overalls quoted on the forum. The attributes are the cartridge's (a
  2012 list agrees on 80 of 80 values); the overall is a documented conversion, labelled as one
  in the season's source.
- *NHL 95*: nhl-95.com's sheet gives the Genesis game's overall and positions. Its whole
  Rangers skater block is fan-computed (decimals such as Kovalev's 86.32): those 21 come from
  Segathon's list (Tikkanen 75, Anderson 67); Karpotsev, whom Segathon does not rate, is left
  out. Nine skaters the sheet gives no position take the NHL's.
- *NHL 07*: EA's overall from IGN's pages; a goalie's is an unrounded n/183 and is rounded.
  Nations: EA's Country one year on (IGN's NHL 08 pages) for 543 players, else the NHL's birth
  country.
- *NHL 22*: NHLRatings.net, a fan site that names no source, lists EA's launch ratings club by
  club. Every player EA's own launch lists rate (ratings-api.ea.com v2: the top 50 and the top
  ten at each position) has EA's overall there, 60 of 60. EA's lists add Crosby and Malkin,
  hurt at launch and off the site's Pittsburgh page; Rask, a free agent at launch, plays for
  no club. NHL 24 and NHL 26 were checked and left out: the site's later NHL 24 pages carry
  in-season changes EA's lists do not show, and its NHL 26 pages cover 16 clubs.

**Nations** are by the NHL's birth country (NHL 07: EA's country), not the national team: Brett
Hull counts for Canada, Peter Bondra for Ukraine, Olaf Kölzig for South Africa. Soviet- and
Czechoslovak-born players count for the country the NHL lists today. Great Britain plays as
one. The rule is documented rather than corrected case by case: a correction would need a
national-team source for each player.

**Maps.** `scripts/data/nhl-seasons.json` lists every club of each season by the NHL's code then,
its arena and the arena's location (from the NHL's game records). A club that has moved or been
renamed since has its own id (`nhl-hartford-whalers`, `nhl-quebec-nordiques`,
`nhl-minnesota-north-stars`, `nhl-winnipeg-jets-1979`, `nhl-mighty-ducks-of-anaheim`,
`nhl-phoenix-coyotes`, `nhl-atlanta-thrashers`, `nhl-arizona-coyotes`); one that has not keeps
today's id and colour. `node scripts/build-club-maps.mjs --league=nhl` builds `nhl1993`,
`nhl1994`, `nhl1995`, `nhl2007` and `nhl2022` by the state-and-province rule: Quebec is split
between Montreal and Quebec City, the 1990s Capitals at Landover hold Maryland.

**The scale: rescaled, applied to the three 1990s seasons.** The classic games' overalls run
far wider than NHL 27's (median 54, from 1 to 99), and the match model was tuned on today's
ratings: played at their own numbers, their stars scored a goal a game and their best clubs
won 70 of 82. The player chose (2026-11-08) to rescale them, rank for rank, onto NHL 27's
ratings; NHL 07 and NHL 22, which already play like today's NHL, keep EA's numbers.

- *The reference* is NHL 27 as the game fields it: the 733 players of the built-in clubs'
  squads (`src/data/clubs.hockey.js`, rosters of 2026-11-07, EA's ratings and the marked
  estimates), frozen as a histogram in `scripts/data/nhl-seasons.json` (`rescale`), so a later
  rollover leaves these seasons as they are.
- *The rule* (`quantileRescale` in `scripts/lib/nhl-seasons.mjs`): every overall takes the
  reference rating at its mid-rank among the season's rated players (the mean of the first and
  last places it holds in their ascending order, as a share of the whole). Goalies and skaters
  share one ordering, as in the reference. Ties stay ties and nobody passes anybody; on the
  narrower scale some neighbours meet (NHL '94's 66 distinct overalls become 26 ratings).
- *The squads* are still picked by the games' own overalls (so a tie the rescale makes never
  changes who plays); then every rating is rescaled and the clubs' and nations' strengths are
  taken from the rescaled squads.
- *The games' own overalls stay*: the snapshots keep each player's, the audit maps every one to
  its rating, and each season's `source.conversion` states the whole rule (NHLPA '93: NHL '94's
  formula, then the rescale).

| Player | Game's overall | Played at |
| --- | --- | --- |
| Wayne Gretzky, NHL '94 | 87 | 94 |
| Mario Lemieux, NHL '94 | 99 (100 capped) | 97 |
| Patrick Roy, NHL '94 | 94 | 95 |
| Patrick Roy, NHLPA '93 | 99 (100 capped) | 97 |
| Shawn Chambers, NHLPA '93 | 1 | 71 |
| The median, NHL '94 | 54 | 82 |
| Esa Tikkanen, NHL 95 | 75 | 88 |

Over 20 seeded seasons of each era's clubs (the harness of `npm run simulation:realism`), before
and after:

| Measure (NHL range) | NHLPA 93 | NHL 94 | NHL 95 | NHL 07 | NHL 22 |
| --- | --- | --- | --- | --- | --- |
| Win% spread (0.082–0.127) | 0.265 → 0.178 | 0.236 → 0.160 | 0.212 → 0.125 | 0.091 | 0.103 |
| Best, worst wins of 82 (55–65, 19–25) | 73, 3 → 64, 11 | 71, 4 → 61, 9 | 71, 6 → 60, 17 | 57, 25 | 57, 22 |
| Won by five or more (5.5–6.5%) | 34.5% → 11.0% | 25.8% → 11.1% | 18.2% → 8.1% | 5.3% | 6.3% |
| Goals a team (3.01–3.14) | 3.48 → 3.12 | 3.62 → 3.30 | 3.43 → 3.26 | 2.74 | 2.98 |
| Top scorer's goals (52–69) | 180 → 54 | 202 → 55 | 185 → 56 | 80 | 55 |

The 1990s seasons stay wider than today's league: their expansion clubs were far weaker than
the rest (Ottawa and Tampa Bay in 1992/93, Anaheim and Florida in 1993/94), and the rescale keeps
every club's place.

## Tests

`scripts/hockey-seasons.test.mjs`: the five seasons rebuild byte for byte (and from the pinned
downloads, when they are on the computer); the listing, the era maps and the loader's refusals;
the classic facts (Gretzky 87, Lemieux's cap, Chambers's 1, the Rangers from Segathon, the short
clubs); the rescale (the frozen NHL 27 reference, every rating the rescaled game overall of its
player, the order holding and ties staying ties, NHL 07 and NHL 22 unconverted); NHL 22 against
EA's lists; the name matching; and the running App launching a 1993/94 nations campaign and a
2006/07 clubs campaign on its map, and resuming.

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
- The built-in season, 2026/27: EA's site shows only the current edition, and each rollover
  needs a new pull. The five earlier seasons are fixed files ("Earlier seasons").
- NHL players only, by nationality or birth country.
- Nations campaigns are top-heavy. Half the elite 32 are minnows at the baseline, so the
  United States, Canada and Russia win about four titles in five (`npm run balance`, 1,200
  campaigns).
- No power plays, penalties or fights: a goal is a goal.
