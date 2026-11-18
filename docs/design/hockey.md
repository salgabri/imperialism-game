# Ice hockey

Status: implemented 2026-11-07. A sixth sport: the 32 NHL clubs fight over the USA and
Canada on the NHL's own map, each holding its own state or province
([domestic-campaigns.md](domestic-campaigns.md#the-nhl-map)), and the nations field the NHL's
players of each country. Everything outside the match
(territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.
Since 2026-11-09 every NHL season from 1966/67 to 2025/26 but the cancelled 2004/05 is built in
("Earlier seasons", "NHL 08 and NHL 09", "Computed seasons", "Eras"), and since 2026-11-13 the six Original Six
seasons before it, from 1960/61, as the other North American sports start in 1960; since 2026-11-10 setup shows the
credit its sources ask for under the Season choice ("Credits").

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

The NHL's API is never fetched now: the project's rule rules it out, and
`scripts/lib/polite-fetch.mjs`, which every script's request goes through, refuses it. No
allowed source gives the same rosters and statistics, so the sync reads the NHL's answers
only from `data-src/nhl/` (as cached on 2026-11-07), refuses `--refresh`, and the committed
snapshot stays as it is. EA's ratings API has no robots.txt and is still allowed.

EA's and the NHL's names differ now and then (Matthew Boldy, Matt Boldy): the sync matches
by full name, then surname on the same team, then a surname unique in the league, and
prints the loose matches for checking. **Two pairs share a name**, the Canucks' two Elias
Petterssons and two Sebastian Ahos, so a shared name goes by team and by group (forward,
defender, goalie). Three rated players are on no current roster (Larkin, Barzal,
Edvinsson): they keep EA's team.

**Estimates** (`scripts/lib/nhl.mjs`; since 2026-11-18 by the computed seasons' value,
[computed-ratings.md](computed-ratings.md) step 3). Every player EA leaves out is ranked within
his group by how much his club played him and what he produced over 2025/26 and the season under
way, and the order is read off the shape of NHL 22, the last EA edition published whole, below its
top 300.

- *Selection*: his share of the club's ice time a game (a goalie's, of its minutes).
- *Production*: points a game, a goalie's saves above the league's save percentage a shot, each
  shrunk toward replacement (the rate of the quarter of the group with the least exposure) by the
  prior the league's own regulars give: 6.3 games for forwards, 7.5 for defenders, 1,126 shots for
  goalies.
- *Value*: selection and production as z-scores, weighted 0.2 : 0.8 for forwards, 0.35 : 0.65 for
  defenders, 0.5 : 0.5 for goalies: the computed seasons' weights where ice time is kept, tuned on
  EA's editions ("Computed seasons").
- *The shape*: NHL 22's overalls from its 300th player's (82) down, raised a point so they top out
  at 83, just under EA's cut-off of 84: forwards 71–83 (238 players), defenders 71–83 (137),
  goalies 78–83 (25). The clubs pick their squads first; then the squads' estimates are ranked
  among themselves, as NHL 22's launch rosters were rated, so that a club's depth meets NHL 22's
  depth and not the fringe of a longer roster list. Anyone else EA leaves out takes the estimate of
  the squad player of his group with the highest value not above his.
- EA's own ratings are never changed.

Until 2026-11-18 the order was spread in a straight line from 83 down to 72 (goalies 70). NHL 22's
shape lifts the depth players (the squads' estimated forwards from 78.1 to 80.0 on average,
defenders from 78.1 to 80.2, goalies from 77.6 to 81.9) and brings the clubs closer together: club
strengths' standard deviation 1.09 → 0.95, as the match model plays them 1.47 → 1.18. The built-in
season's standings spread 0.084 (0.097 before; the NHL's 0.082–0.127), its worst club winning 28 of
82 (the NHL's 19–25). Estimates carry noise, noise evens clubs out, and a season still being played
is not moved toward its results ([computed-ratings.md](computed-ratings.md), step 5). An order within
a group is what the estimates can claim, not a number a player would get from EA. On the built-in
rosters a club's lineup holds 4 to 13 estimates of its 19 places, 9.7 on average.

**Clubs.** `scripts/data/nhl-teams.json` names each club, its code (the NHL's own), the
place its territory is named after, its arena and the arena's location. New York's three
are Manhattan, Long Island and Buffalo. `npm run build-hockey` (`scripts/build-hockey.mjs`)
writes `src/data/clubs.hockey.js` and `src/data/rosters.hockey.js`; `--check` rebuilds both
byte for byte. Each club fields the lineup the game picks, then a backup goalie and the
best skaters left, up to 23. The 2026/27 build runs from Carolina's 85.1 to Nashville's
81.7 (84.5 to Vancouver's 80.4 with the straight-line estimates).

**Nations.** A player EA rates plays for EA's nationality, anyone else for his birth
country. 16 nations field players, from Canada (92) and the United States (91) down. A
lineup place a nation's own players cannot fill is the game's to fill with a generated
player at the nation's strength, as in baseball; a nation with no NHL players is a minnow
at the baseline, 45. Since 2026-11-09 a nation whose NHL players hold less than half the lineup, or
none, fields no team (`fieldedNations`), so seven play and the rest of the land stays neutral. Great Britain plays as one, so the home nations' shapes start in the
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
  and Canada**. The note under Season (the choice's title and description) says which ratings are
  estimates, which seasons are converted or computed and from what, and that nations play from 1977/78.
  A season to 1976/77 has clubs only: choosing it takes the clubs. A season the Hockey Databank or
  MoneyPuck.com feeds shows its credit as text under the choice ("Credits").
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

Sixty-five earlier seasons, every NHL season from 1960/61 to 2025/26 but the cancelled 2004/05,
each with its clubs on the map of its day ("Eras"):

| Seasons | Ratings | Source |
| --- | --- | --- |
| 1992/93, 1993/94, 1994/95, 2006/07, 2021/22 | an EA edition's (below) | NHLPA 93, NHL 94, NHL 95, NHL 07, NHL 22 |
| 2007/08, 2008/09 | EA's attributes, the overall converted ("NHL 08 and NHL 09") | IGN's NHL 08 and NHL 09 pages |
| 1960/61–1991/92, 1995/96–2003/04, 2005/06, 2009/10 (43) | computed from the players' statistics ("Computed seasons") | the Hockey Databank |
| 2010/11–2020/21, 2022/23–2025/26 (15) | computed the same way, with minutes a game | MoneyPuck.com |

The Season list labels the converted seasons "NHL 08, converted" and "NHL 09, converted" and the computed ones
"Computed from statistics"; each file's source says how (`method`, `conversion`).

The five EA editions' seasons: their nations by birth country. **Nothing in them is estimated**: a player the
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
`--fetch` downloads a missing one through `scripts/lib/polite-fetch.mjs`, except two kinds now
read only from their pinned copies: the NHL's rosters, since `api-web.nhle.com` is never fetched,
and the pages only CommonCrawl kept, since `data.commoncrawl.org`'s robots.txt disallows every
path for every agent, read 2026-11-10) and writes one
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
between Montreal and Quebec City, the 1990s Capitals at Landover hold Maryland. The other
seasons' clubs and maps are in "Eras".

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

## NHL 08 and NHL 09

2007/08 and 2008/09 (decided 2026-11-09): EA's own attributes, as IGN published them for every club, with the overall
converted, as Tecmo's is for the NFL. Neither edition's overall was ever published in full.

- *NHL 08*: IGN's 30 team pages of September and October 2007 (the Wayback Machine's captures, already pinned for NHL
  07's countries): 24 skater attributes or 20 goalie attributes, EA's position and EA's Country. Three pages break
  their rows, and the parser repairs them: the Canadiens' closes each row's last cell as `</td</tr>`, the Devils' leaves
  its last goalie's row (Kevin Weekes) without its `</tr>`, and the Stars' starts Jeff Halpern's row inside Stu Barnes's
  last cell. 662 players.
- *NHL 09*: IGN's 30 team pages as the Wayback Machine captured them on 16 to 18 August 2008, a month before the game came
  out (fetched again 2026-11-09 from web.archive.org, the same bytes as the research's copies): 23 skater or 19 goalie
  attributes and nothing else. IGN's article of the same week (xbox360.ign.com/articles/898/898201p1.html, captured
  2008-08-15) says EA's overalls were not ready, so it gave the attributes only. A skater's position is his longest
  stint's in the Hockey Databank's 2008/09 season (found by name on his club, then anywhere in 2007/08 to 2009/10, as
  the earlier seasons find the NHL's players), else NHL 08's; Chad Denny (Atlanta), in neither, is left out. 655 players.
- *Nations*: EA's Country on the NHL 08 pages (a year on for NHL 09, where the player is there), else the Hockey
  Databank's birth country. Cristobal Huet's Country reads "Huet" on both pages: he counts for France, where the
  databank has him born.

**The conversion** (`scripts/lib/nhl-computed.mjs`, `converted` in `scripts/data/nhl-seasons.json`). A player's score is
the plain mean of his skill attributes: NHL 08's skaters leave out Aggression, Discipline, Durability, Potential and
Toughness (19 left), its goalies Aggressiveness, Durability, Potential and Puck Playing Frequency (16); NHL 09's skaters
DIS, TGH, AGG and DUR (19), its goalies AGGR, DUR and PUCK (16). A value outside 0–99, EA's unset 255, leaves the player
out: Alexei Zhamnov, Mike Rathje, Rob DiMaio and Jiri Fischer, none of whom played that season. The score's mid-rank in
its group (forwards, defenders, goalies) over the edition's club players is read off NHL 07's EA overalls in that group
(515 forwards, 259 defenders, 84 goalies, frozen as histograms), so the two seasons play on NHL 07's scale, as NHL 07
does. Ties stay ties and nobody passes anybody in a group.

Why it holds: within NHL 07 the same plain mean of the skill attributes (all but Injury, Potential, Fighting, Penalty,
Aggression, Toughness and Intensity) ranks the players like EA's overall, Spearman 0.95 for forwards and 0.94 for
defenders (`scripts/hockey-computed.test.mjs` measures it from the pinned pages). Results: Brodeur 96, Luongo 95, Iginla
95, Crosby 94; Anaheim, the 2007 champions, the strongest club of NHL 08 (80.4) and Phoenix the weakest (72.4); Detroit,
the 2008 champions, the strongest of NHL 09 (78.6).

## Computed seasons

The other 58 seasons have no game's ratings anyone published in full (decided 2026-11-09; the six from 1960/61 to
1965/66 added 2026-11-13 by the same rule). NHL 96 to NHL 2006 and NHL 10 to NHL 21 published none; NHLRatings.net's
NHL 23 to 26 pages are stale or partial; EA's own lists stop at its top 20 to 320 players. Their ratings are **computed
from the players' regular-season statistics** by the rule below, each club then moved toward its real results that
season (since 2026-11-18, by [computed-ratings.md](computed-ratings.md)), labelled as computed wherever they are shown.
They are no game's ratings.

**Sources.** Only open sources whose sites allow this project's agents. The NHL's own statistics API (api.nhle.com,
api-web.nhle.com), which the plan meant to use, turns away ClaudeBot, anthropic-ai and Claude-Web in its robots.txt and
limits its use to non-commercial personal use: nothing of it is used for these seasons, not even for the calibration.

| Source | Seasons | What it gives | Terms |
| --- | --- | --- | --- |
| The Hockey Databank, version 13.0 (10 July 2018), as published at github.com/rippinrobr/hockey-databank (commit de59443) | 1958/59–2009/10 here (it runs to 2017/18) | each player's games and points per club (Scoring), goalies' games, minutes, goals against and, from 1982/83, shots against (Goalies), name, position and birth place (Master) | free use, a commercial product included, with its attribution statement displayed in its entirety |
| MoneyPuck.com's season summaries (moneypuck.com/data.htm) | 2008/09–2025/26 | each player's games, points, time on ice; goalies' shots on goal and goals against; position | free for non-commercial use, crediting MoneyPuck.com |
| MoneyPuck.com's game-by-game player files (its download host, peter-tanner.com) | the 15 seasons computed from MoneyPuck | each player's team in every game, for his club | the same |
| MoneyPuck.com's player lookup | 2010/11–2025/26 | each player's nationality (the NHL's) and birth date | the same |

The databank's own sources are the NHL's guides and record books, Total Hockey and others (its readme). Its statement:
"The information used herein was obtained free of charge from and is copyrighted by the Hockey Databank project. For
more information about the Hockey Databank project please visit http://sports.groups.yahoo.com/group/hockey-databank".
Setup shows it in full under the Season choice for every season that takes anything from the databank ("Credits"); it is
also in `public/hockey/ATTRIBUTION.txt` and in every computed season's `source.attribution`. The sync checks the readme still
asks for it word for word. raw.githubusercontent.com and peter-tanner.com have no robots.txt rules; moneypuck.com's
robots.txt only defines Cloudflare's content signals. Every download (4 databank files, 36 MoneyPuck season summaries,
the lookup and 30 game-by-game archives of 329 MB in all) is pinned by SHA-256 in `scripts/data/nhl-seasons-sources.json`.

**The rule** (since 2026-11-18, [computed-ratings.md](computed-ratings.md) steps 3 to 5; `seasonValues` in
`scripts/lib/nhl-computed.mjs`, the move in `scripts/lib/nhl-reconcile.mjs`). It replaced the rule of 2026-11-09, a
hand-weighted mean of points a game, minutes a game and save percentage over the seasons weighted 1:2:1 (`RULE`,
`scoreOf`, kept for the back-test and the audit's comparison).

- *The window.* The season itself, the season before and the one before that, weighted 3:2:1; 2004/05 is skipped
  (2003/04 comes before 2005/06). Exposure and events are pooled over it.
- *Selection.* His share of the club's ice time a game where the source keeps time on ice (MoneyPuck, from 2008/09),
  else of its games; a goalie's, of its minutes; over the seasons of the window he played.
- *Production.* Points a game; a goalie's saves above the league's save percentage a shot or, where the window is not
  all from 1982/83 on (no shots against were kept before), his goals against under the league's an hour. Each is shrunk
  toward the season's replacement level (the pooled rate of the quarter of its group with the least exposure) by a prior
  measured from the season's own regulars (a quarter of the window's games): Poisson noise for points and goals against,
  binomial for saves, over the talent variance by the method of moments. The prior counts each record's effective
  exposure, (Σ w·e)² ÷ Σ w²·e, the exposure whose plain rate is as noisy as the weighted one: forwards' priors run 5 to
  15 games, defencemen's 7 to 22, goalies' 8 to 58 hours, or 1,100 to 7,000 shots (in 2016/17 save percentages varied no
  more than their noise allows, and the prior runs to 294,000 shots: goalies there rank by saves above replacement, the
  volume and the rate together; a prior of 2,000 or 300,000 shots orders a season's regulars alike, Spearman 0.99).
- *Value.* Selection and production as z-scores over the season's regulars, weighted selection : production 0.15 : 0.85
  for forwards (0.2 : 0.8 by ice time), 0.25 : 0.75 for defencemen (0.35 : 0.65 by ice time), 0.5 : 0.5 for goalies by
  saves, 0.6 : 0.4 by goals against (`BLEND`), tuned once on the five EA editions ("Calibration") and frozen.
- *Club and position.* The club he played most games for (a tie: the later one); the position of his longest stint
  (the databank) or MoneyPuck's.
- *Ratings.* Provisional ratings (each value's mid-rank in its group over every player of the season) let the game's
  own lineup picker choose each club's squad, as the built-in season does. Then every squad player's rating is his
  value's mid-rank in his group over the season's squad players, read off NHL 27's built-in squads in that group (433
  forwards, 236 defenders, 64 goalies of 2026-11-07, frozen in `computed.histograms`: EA's ratings and the straight-line
  estimates of that day, kept when the built-in season's estimates took NHL 22's shape): every computed season plays on
  NHL 27's scale. A player outside every squad takes the rating of the highest squad value in his group not above his.
- *The move toward the season's results* ([computed-ratings.md](computed-ratings.md), step 5, the user's choice of
  2026-11-17). S, each club's results strength in goals a game: the Simple Rating System of every game's score where
  MoneyPuck keeps them (margins by least squares with a home edge, a shoot-out's goal left out), else its goal
  differential a game, × (n − 1) ÷ n as it meets the n − 1 others and never itself, from the databank's Teams.csv (a
  shoot-out's goal taken off both sides) or, in 2012/13 and 2020/21, whose conferences and divisions never met, from the
  games' totals; its reliability r, from the SRS's error or from Poisson goals. m, the match model's margin a game per
  point of a lineup's played strength (the mean of its attack and its defence as the model weighs them), measured under
  the season's late game and overtime by `perPointOf`, each club against itself a few points up and down, at the scoring
  level at which the clubs score the league's goals (within 2% of the factor `build:nhl-league` then solves on the moved
  clubs); the margin a shoot-out's goal less, and to 1982/83, when the league played no overtime, regulation's. Each
  club's target is the clubs' mean played strength + √r × S ÷ m, and every player of the club moves by one whole number,
  the squad's best few one point more, whichever brings the squad's lineup nearest it (`clubMoveOf`): nobody passes
  anybody in his club. r runs 0.50 (2015/16) to 0.95 (1974/75), m 0.27 goals a point (2003/04) to 0.42 (1981/82), the
  moves −4 to +3.
- *Nations.* The databank's birth country, a birth it files in the USSR, Czechoslovakia or Yugoslavia counting for the
  country its city is in today, and a birth city it files under a country the city is not in (Bratislava and eleven more
  Slovak cities under the Czech Republic, Ceske Budejovice and Havlickuv Brod under Slovakia, Sverdlovsk under Ukraine,
  Kharkiv, Pavlodar and Vost under Russia, Naliboki under Poland) counting for the city's country: Stan Mikita and the
  Stastnys count for Slovakia, Nikolai Khabibulin for Russia. Its one "South Wales", Jack Evans's (Morriston; Chicago,
  1960/61 to 1962/63), counts for Great Britain, as its Wales, England and Scotland do. The MoneyPuck seasons take the
  nationality its lookup gives, the NHL's (Olaf Kolzig counts for Germany there); where it gives none, the databank's
  birth country of the one player of 2008/09 to 2017/18 with that name (Pavel Datsyuk, Chris Pronger and 25 more in
  2010/11). None to one player a season to 2017/18 is left without a nation, 5 to 37 after (2025/26's mostly rookies);
  they play for no nation.
- *Federations of the day* (added 2026-11-13). A birth country is then read as the state of the season's day, as
  tennis's seasons read theirs (`FEDERATIONS` and `federationOf` in `scripts/lib/nhl-seasons.mjs`, held to tennis's
  table by test): a player born in Slovakia plays for Czechoslovakia to 1991/92, one born in another Soviet republic for
  the Soviet Union to 1990/91, and in 1991/92 one born in one of the ten other republics of the CIS for the CIS (not the
  Baltic states or Georgia: Arturs Irbe plays for Latvia). Each plays on its largest member's shape under the name and
  flag of its day (`src/data/namesOfTheDay.js`), and where it fields a real side its members' land starts in its empire.
  Czechoslovakia then fields a real side every season from 1982/83 to 1991/92 (Peter Stastny among them), the Soviet
  Union in 1989/90 and 1990/91 (Larionov, Krutov, Makarov, Fetisov, and Helmut Balderis, born in Riga), the CIS in
  1991/92; before, Czechia did in 1982/83 and from 1988/89, Russia from 1990/91. The NHL's birth country still decides
  whose a player is: Peter Bondra, born in Lutsk, plays for the Soviet Union and then the CIS.
- *Namesakes.* Two players of one season who share a name carry their birth year ("Sebastian Aho (1997)"), or their
  birth date where that is shared too ("Steve Smith (1963-04-04)").
- *Dropped letters.* MoneyPuck's files from its 2022/23 season on drop every letter of a name that is not plain ASCII
  ("Tim Sttzle", "Alexis Lafrenire", "Matj  Blmel"). The 17 players this hits in 2022/23 to 2025/26 take back their
  names (`computed.moneypuckNames`, by NHL id): as MoneyPuck spelled them in its earlier files, else as the built-in NHL
  27 season does, in plain letters like every other MoneyPuck name ("Tim Stutzle"). The sync checks each is MoneyPuck's
  name with only letters put back, and stops on any other name with a run of spaces. One more, "Nathan Lgar", in no
  squad, has no such spelling and stays as MoneyPuck gives it.

**Calibration**, measured 2026-11-18 against the five full EA editions (`scripts/data/nhl-seasons/calibration.json`
holds their players with their lines from these sources; `docs/design/hockey-seasons-audit.json` `calibration` records
every figure). An edition comes out before its season (NHL 22 in October 2021), so EA rated what the seasons before it
showed: each edition is compared with the window of the season before its own (`lagWindowOf`: NHL 22 with 2020/21,
2019/20 and 2018/19), and the fixture holds that window's lines too. Spearman's correlation within each group:

| Edition | Forwards | Defencemen | Goalies | Goalies by goals against | Its own season's window (F, D, G) | The rule of 2026-11-09 (F, D, G) |
| --- | --- | --- | --- | --- | --- | --- |
| NHLPA 93 (1992/93) | 0.826 | 0.801 | 0.694 | 0.759 | 0.824, 0.773, 0.710 | 0.843, 0.760, 0.597 |
| NHL 94 (1993/94) | 0.907 | 0.867 | 0.865 | 0.830 | 0.867, 0.822, 0.808 | 0.898, 0.829, 0.828 |
| NHL 95 (1994/95) | 0.896 | 0.843 | 0.880 | 0.891 | 0.869, 0.821, 0.788 | 0.880, 0.807, 0.733 |
| NHL 07 (2006/07) | 0.922 | 0.888 | 0.893 | 0.879 | 0.880, 0.804, 0.857 | 0.897, 0.786, 0.725 |
| NHL 22 (2021/22), by ice time | 0.945 | 0.905 | 0.812 | — | 0.873, 0.859, 0.650 | 0.918, 0.888, 0.657 |
| Mean | **0.899** | **0.861** | **0.829** | 0.840 (four) | 0.863, 0.816, 0.763 | 0.887, 0.814, 0.708 |

- *The weights* were chosen on a grid of 0.05 for the best mean over the editions, then checked by leaving each edition
  out: forwards, defencemen and goalies by saves chose within 0.05 of the frozen weights every time, and the editions
  held out agree at 0.898, 0.858 and 0.825; goalies by goals against, on the four editions the databank covers, 0.4
  (NHL 95, left out, chose 0.3; held out, 0.831). The ice-time weights have one edition to learn from, NHL 22 (forwards
  0.945 by ice time against 0.941 by games, defencemen 0.905 against 0.892); on NHL 27's top 300, against MoneyPuck's
  2025/26, 2024/25 and 2023/24, they lie within 0.01 of the best (forwards 0.902 against 0.910, defencemen 0.749 against
  0.750).
- *No group keeps the old rule*: the blend agrees better with EA in each, by 0.012 (forwards), 0.047 (defencemen) and
  0.121 (goalies). The old rule weighted the season before twice, which suited EA's timing; read in the season's own
  window, as the computed seasons are, the blend's figures fall by 0.03 to 0.07, as anything would against ratings made
  before the season was played. The window weighs the season itself most because a computed season is that season as
  it was played.
- *Goals against* rank the databank's goalies as well as save percentage (0.840 against 0.833 on the four), so the
  seasons before 1984/85 use them.
- Before 2026-11-18, against the same editions in their own season's window: forwards 0.84 to 0.92, defenders 0.76 to
  0.89, goalies 0.60 to 0.83, clubs 0.63 to 0.89 by their best 19 (the last column, `superseded` in the audit).

**Results**, from the audit (`best`, `clubs`, `results`):

- 1960/61 to 1965/66, the Original Six: the best forward each season its scoring champion, Bernie Geoffrion (1960/61,
  with Jean Beliveau 96), Andy Bathgate, Gordie Howe, Stan Mikita (1963/64 and 1964/65) and Bobby Hull (1965/66), at 98
  or 99; Gordie Howe 93 to 99 every season. Pierre Pilote the best defender but in 1962/63 (Doug Harvey, 39 points to his
  26); the best goalie Glenn Hall but in 1964/65 (Charlie Hodge). As the match model plays them, the weakest club is
  the one with the season's worst goal differential (Boston five times, the Rangers in 1963/64) and the strongest the one
  with the best but in 1964/65 (Chicago, a goal behind Detroit); as shown, the strongest is the regular season's
  first-placed club in every one of the six. Six clubs share 149 to 182 players, so a club is now and then a defender or a centre short
  (Chicago and Toronto in 1960/61, Chicago in 1962/63 and 1964/65) and the lineup picker moves another player there.
  Canada alone fields a real side.
- 1966/67: Stan Mikita 99, the scoring champion, and Bobby Hull 97; Doug Mohns and Pierre Pilote the best defenders,
  Bobby Orr 92 as a rookie; Chicago, first that season, the strongest club (85.7).
- 1970/71 to 1974/75: Phil Esposito the best forward, Bobby Orr the best defender every season. 1974/75: the expansion
  Washington Capitals and Kansas City Scouts the weakest clubs as played.
- 1976/77: Guy Lafleur 99; the Canadiens, who lost 8 of 80, the strongest club (88.4).
- 1979/80 to 1987/88: Wayne Gretzky the best player every season, Mario Lemieux in 1988/89 (199 points) and 1989/90;
  Paul Coffey the best defender from 1982/83 to 1990/91.
- 2019/20: Connor McDavid, Leon Draisaitl, Nikita Kucherov; the Bruins, that season's first, the strongest as played.
- Nations: Canada the strongest every season, the USA level with it from 2022/23 (a point ahead in 2023/24); the USA
  second from 1977/78 to 2001/02 (level with Sweden in 1979/80, with Russia in 1995/96); the USA, Czechia and Russia within
  two points of one another behind Canada from 1999/2000 to 2002/03 (the Jagr and Hasek years), Sweden with them in
  2003/04; Sweden second in 2009/10 and 2011/12, level with the USA in 2010/11.

**Club spread and order.** Bottom-up, the rule makes clubs too even and partly misordered: noise in single ratings
averages out within a club. Before the move, the clubs' strengths follow their real results (S) at a median Spearman of
0.71 as shown (the lineup's mean) and 0.74 as the match model plays them; after it, 0.85 and 1.00, the remaining
difference being how much the shown mean undervalues a goalie, who is a quarter of the played strength and a
nineteenth of the shown one. Measured on every computed season, before the move of 2026-11-18 and after it, against
the season's real standings (each club's win share, a tie or a shoot-out half a win):

| | Before | After |
| --- | --- | --- |
| Clubs as played against the standings, median Spearman | 0.60 | 0.95 |
| Clubs as shown against the standings | 0.58 | 0.81 |
| Club strengths' standard deviation as shown, median (NHL 07 1.30, NHL 22 1.92, NHL 27 1.09 since 2026-11-18 0.95) | 1.07 | 1.53 |
| As played (NHL 07 1.37, NHL 22 1.63) | 1.63 | 1.66 |
| Simulated standings' spread against the real one, mean gap (each season's clubs, its own rules and game count, 20 seasons) | 0.012 | 0.008 |

The old rule's failures are gone: the 2019/20 Coyotes, who came out first by 0.1 with Darcy Kuemper in goal, move to
the middle (S +0.11); the 2005/06 Penguins, 29th of 30 but strongest by 1.4 with Mario Lemieux, Ziggy Palffy and Mark
Recchi, who never played together all season, move down 3 points and rank 27th as played; the 1987/88 Canadiens,
second in the league but last of 21 by points alone, move up a point and rank third. The largest moves are four points
down, for clubs whose players' seasons promised more than the club made of them (the 1966/67 Red Wings, the 1967/68 and
1976/77 Black Hawks, the 1970/71 Golden Seals, the 1975/76 Rangers, the 1981/82 Kings, the 1982/83 Penguins and Whalers,
the 2022/23 Ducks), and three up (the 1970/71 Bruins, the 1981/82 and 1985/86 Canadiens, the 1982/83 Flyers, the 1995/96
Red Wings). Across the 1,276 clubs the move averages 0.9 points of played strength.

Over 20 seeded seasons of each season's games (a round robin of its clubs under its own rules, measured 2026-11-18), the
simulated standings' spread against the real one:

| Season | Clubs | Real | Before | After |
| --- | --- | --- | --- | --- |
| 1960/61 | 6 | 0.127 | 0.136 | 0.118 |
| 1967/68 | 12 | 0.080 | 0.118 | 0.096 |
| 1970/71 | 14 | 0.143 | 0.149 | 0.165 |
| 1976/77 | 18 | 0.143 | 0.127 | 0.155 |
| 1981/82 | 21 | 0.117 | 0.122 | 0.124 |
| 1986/87 | 21 | 0.074 | 0.118 | 0.074 |
| 1999/00 | 28 | 0.106 | 0.109 | 0.105 |
| 2003/04 | 30 | 0.097 | 0.083 | 0.103 |
| 2010/11 | 30 | 0.078 | 0.081 | 0.078 |
| 2015/16 | 30 | 0.078 | 0.078 | 0.070 |
| 2025/26 | 32 | 0.081 | 0.092 | 0.089 |

The seasons before overtime (to 1982/83) and before the shoot-out run a little wide: their ties count half a win in the
real standings, where the model always finds a winner. `npm run simulation:realism` plays five seasons whole on their
own schedules: 1970/71 0.165 (the league's 0.143, just past the harness's ±0.02), 1981/82 0.119 (0.117), 2003/04 0.105
(0.097), 2010/11 0.080 (0.083), and the built-in season 0.084 (the NHL's 0.082 to 0.127; "Estimates").

**Nations before 1977/78.** A season fields nations only where at least three play a real side (`fieldedNations`: their
own players hold at least half the lineup). By the databank's birth countries, Canada alone does from 1960/61 to
1970/71, the USA joins in 1971/72 and Sweden in 1977/78 (Bob Nystrom, Borje Salming, Inge Hammarstrom, Stefan Persson
and seven more).
So the seasons to 1976/77 have clubs only: the loader's id test (`clubsOnly` in `src/engine/footballSets.js`) reads
`/^nhl-19(?:6\d|7[0-7])$/`, moved from 1979/80 to 1977/78 by this count (the research's sample of the NHL's bios had
missed 1977/78 and 1978/79), and the build fails if the test and the count disagree.

**Pipeline.** `node scripts/sync-nhl-seasons.mjs` (`--fetch`, `--pin`, `--check` as for the editions) reads the pinned
downloads under `data-src/nhl-seasons/` (`hockey-databank/`, `moneypuck/`, `moneypuck-games/`) and writes each
computed season's snapshot: the window's league figures (`leagues`: save percentage, goals against per 60, most games),
the form (`form`: points or minutes a game, saves or goals against), the season's results (`results`, since
2026-11-18: every club's `[code, games, won, lost, tied, overtime losses, shoot-out wins, shoot-out losses, goals for,
goals against]` from the databank's Teams.csv, or every game's `[game id, home, away, home goals, away goals]` from
MoneyPuck's game-by-game skater files, the Coyotes' home games of 2011/12 to 2013/14 mended where MoneyPuck marks both
sides away, `homeMended`; where both sources cover a season they agree to a goalie's goal or two a club, and
MoneyPuck's files miss 2016/17's 4 games and 2017/18's 2) and every player of the season, `[source key, name, club,
position, country, lines]`, a line `[season, games, points, seconds on the ice]` or, a goalie's, `[season, games,
seconds, goals against, shots against]`. `node scripts/build-nhl-seasons.mjs` computes the rule from them, the
move included (it plays nearly four million games of the match model to measure m, in about ten seconds), so the
snapshots (5 MB with the editions') are all a rebuild needs. Each season's move changes its clubs' goals, so
`node scripts/build-nhl-league.mjs` solves every season's scoring again after it; the move's m never reads that
factor, so the two builds settle in one pass. No season waits on the NHL's own statistics: the
databank and MoneyPuck cover every one, so the `sync-nhl-stats.mjs` the plan offered as a fallback was not written. The
NHL's API would add time on ice for 1997/98 to 2009/10 and goalies' shots against before 1982/83, if the player ever
wants to run that download himself.

## Eras

Every season's clubs come from `scripts/data/nhl-seasons.json` `eras` (decided 2026-11-09): each franchise's identities
and arenas by season, from 1960/61 (from 1966/67 until 2026-11-13, when the Original Six's eras were carried back: the six
clubs kept their names and arenas from 1960/61 to 1966/67, the Detroit Olympia's and the third Madison Square Garden's
pinned articles giving the Red Wings 1927–1979 and the Rangers 1926–1968), and the five editions' `teams` lists, which
the eras reproduce exactly (tested).
From 1980/81 the arenas, cities and points are the research's (Wikipedia's arena and franchise articles, read
2026-11-07), the points the NHL's own where the editions give them; before, Wikipedia's arena articles (Oakland Arena,
Omni Coliseum, Hy-Vee Arena for Kemper, Richfield Coliseum, MassMutual Center for the Springfield Civic Center, Detroit
Olympia, Madison Square Garden (1925)). Codes are the NHL's as Wikipedia's list of NHL team abbreviations gives them
(OAK, CGS, CLE, KCS, CLR, AFM). Every Wikipedia article used, season articles included, is pinned to the revision read
on 2026-11-09 (`eras.wikipedia`).

- *New ids*: `nhl-oakland-seals`, `nhl-california-golden-seals` and `nhl-cleveland-barons` (the defunct franchise merged
  into the North Stars in 1978, ranked after today's 32 on every map), `nhl-kansas-city-scouts`, `nhl-colorado-rockies`,
  `nhl-atlanta-flames`, `nhl-utah-hockey-club` (2024/25). The Chicago Black Hawks (to 1985/86) keep today's id under their
  name of the day. Era ids get no crest, as before.
- *Two arenas in a season*: the one that hosted most of its home games, from Wikipedia's season articles: the 1967/68
  Kings at the Forum (21 of 37; Long Beach and the Sports Arena 16), the 1967/68 Rangers at the third Madison Square
  Garden (26 of 37), the 1979/80 Red Wings at Joe Louis Arena (28 of 40), the 1979/80 Whalers at the Springfield Civic
  Center (22 of 40, until 3 February 1980), the 1995/96 Senators at the Palladium (26 of 41), the 1997/98 Capitals at the
  MCI Center (31 of 41), the 1998/99 Maple Leafs at Maple Leaf Gardens (27 of 41), the 2003/04 Coyotes at Glendale Arena
  (28 of 41), the 2018/19 and 2019/20 Islanders at Nassau Coliseum (21 of 41, 24 of 35 played).
- *The 1979/80 Whalers* (decided 2026-11-09, by the rule): they hold central and western Massachusetts (Springfield,
  Worcester), the Bruins the east, and Connecticut is nobody's that season.

**Maps** (`scripts/build-club-maps.mjs` `nhlSpecs`, decided 2026-11-09). A map serves a run of seasons while the clubs
and their names stay the same and each arena stays in its county (or, in a state or province no other club shares, its
state) and within 15 km of the first season's; the map keeps the first season's arenas and places. 26 new maps:
`nhl1967` (1960/61–1966/67 since 2026-11-13, the Original Six in the same six arenas: its sections are unchanged, its
version changed with its seasons, and a 1966/67 campaign saved on it before resumes through the remap path, tested);
`nhl1968` (to 1969/70: the Rangers' move to the fourth Garden, 1.4 km, keeps it); `nhl1971` (1970/71–1971/72);
`nhl1973`; `nhl1975`; `nhl1977`; `nhl1979`; `nhl1980`; `nhl1981` (1980/81–1981/82); `nhl1983` (1982/83–1985/86: the
Saddledome 0.2 km from the Corral); `nhl1987` (1986/87–1990/91, the Blackhawks' new spelling); `nhl1992`; `nhl1996`;
`nhl1997`; `nhl1998`; `nhl1999`; `nhl2000`; `nhl2001` (2000/01–2002/03: the Stars' new arena 2 km away); `nhl2004`
(2003/04, 2005/06); `nhl2012` (2011/12–2013/14); `nhl2015`; `nhl2016` (2015/16–2016/17); `nhl2018`; `nhl2019`
(2018/19–2020/21); `nhl2023` (2022/23–2023/24); `nhl2025`. `nhl2007` now serves 2006/07 to 2010/11 (the Devils' move to
Newark, 12 km within New Jersey, and the Penguins' 0.2 km keep it): its version changed, and a 2006/07 campaign saved
on it resumes through the existing remap path (tested). 2025/26 plays on today's `nhl` map, and the builder checks its
clubs and arenas are today's. The five maps of the editions are unchanged.

## Rules by era

Added 2026-11-13, for the request of 2026-11-10 that "the rules of the games are correct, the results realistic". An
earlier season plays its own day's scoring, late game and overtime (`hockeyIn`, read through `matchSport`: one rules
object a season, simulation version 2). The built-in season plays today's rules: `hockey` itself, version 1, untouched.

**Scoring.** `src/data/nhlLeagueAverages.js` (`node scripts/build-nhl-league.mjs`, `--check` to verify) holds each
built-in season's goals a club scored a game, a shoot-out's deciding goal left out: to 2017/18 from the Hockey
Databank's Teams.csv (goals for less shoot-out wins, over games), from 2018/19 from MoneyPuck.com's game files (2021/22,
which it keeps no game file of, from its season summary over the 32 clubs' 82 games). Every download is pinned by
SHA-256 in `scripts/data/nhl-seasons-sources.json`. The league scored 2.57 goals a club in 2003/04 and 4.01 in 1981/82;
the Original Six seasons added on 2026-11-13, 1960/61 to 1965/66, 2.78 (1963/64) to 3.04 (1965/66).
A season's `scoring` is the factor on both sides' rates that brings its clubs to its league's goals under its own
overtime, solved over every pairing of its clubs (`solveScoring` in `scripts/lib/nhl-league.mjs`): 0.80 for 2003/04, 1.31
for 1981/82.

**The late game.** Before 1999/2000 a side losing in overtime got nothing, and before 1983/84 there was no overtime, so a
level game late on was a point each to keep, not one the overtime guaranteed, and a goalie came off later. Every late
effect of today's (a level game tightening up, the chase and the sitting back, the pulled goalie, the empty net) plays at
35% of its distance from none (`lateOf`). The model's games over the clubs of 1966/67 to 1982/83 are then level after
sixty 16.3% of the time, against the league's 16.8% (1,817 ties in 10,826 games, the databank), where today's late game
gave 21%. Its empty-net goals come at about 0.1 a game, as the databank's goalies conceded 0.05 to 0.17 then (today 0.25).

**Overtime.** A conquest needs a winner, so a level game is settled as near its day as a winner allows (`overtimeOf`;
Wikipedia's "Overtime (ice hockey)", revision 1380480724, and its 1983–84, 1999–2000, 2005–06 and 2015–16 season
articles, revisions 1377826696, 1374052089, 1374051010 and 1382868437, read 2026-11-10):

| Seasons | The NHL's regular season | The model |
| --- | --- | --- |
| to 1982/83 | no overtime (from November 1942): a tie | the playoffs' overtime |
| 1983/84 to 1998/99 | five minutes of sudden death at five on five, else a tie | the playoffs' overtime |
| 1999/2000 to 2004/05 | five minutes at four on four, else a tie | the playoffs' overtime |
| 2005/06 to 2014/15 | five minutes at four on four, then a shoot-out | the same, the rates × 1.41 |
| 2015/16 on | five minutes at three on three, then a shoot-out | the same, today's (× 2.4) |

- *The playoffs' overtime*, every season before the shoot-out: twenty-minute periods at five on five until a goal. The
  fifth, as deep as any NHL game since 1967 has gone (Keith Primeau's goal of 4 May 2000, 92:01 into overtime), always
  ends in one. Its pace was the playoffs' whatever a season scored, so it plays the clubs' rates as a season of three
  goals a club would (its boost × 3 ÷ the season's goals): 1.17 for the seasons to 1988/89, 0.75 from 1989/90 to
  2003/04. NHL.com's lists of every playoff overtime game (`scripts/data/nhl-playoff-overtimes.json`, from the Wayback
  Machine's copies of 10 November 2012) settle 176 of the 196 of 1967–1989 in the first period (89.8%) and 210 of the
  276 of 1990–2004 (76.1%); the model's level games over those seasons' clubs, 89.4% and 75.1%.
- *Four on four*: 1,306 of the 2,889 level games of 2005/06 to 2014/15 ended in the overtime (45.2%, the databank's
  overtime losses less shoot-out losses); the model's 43.8%, with 14.2% of its games going to a shoot-out (the league's
  13.4%).
- *Three on three*: today's, 66.1% of level games settled in the overtime over the seasons since 2015/16 (the league's
  61–72% a season).

**The clock.** The playoffs' overtime brings its own clock and words (`playoffClock`): the chart ticks each twenty-minute
period ("OT" at 80', then "2OT", "3OT"), a goal keeps its minute ("87'"), and the result reads "in double overtime" up to
"in quintuple overtime", short "2OT". No minute is a shoot-out's, so a goal after the 65th minute is its scorer's, in
the scorers' line too. The match screen, the score header, the feed and the chart read the season's clock (`clockSport`).
Four on four keeps today's clock and words.

**The live chart.** `liveModelFor` carries a season's overtime where it is not today's: the periods' length and number,
their rate (`otBoost`), whether it is the playoffs' (`playoff`), and before 1999/2000 the late game (`late`). In the
playoffs' overtime the next goal wins whenever it comes, so a level game's chance holds through every period and a
lead has won. At puck drop the chart is within two points of the fixture's simulated odds. Today's model names none of
these fields, so a chart saved before reads as it did.

**Results.** Every pairing of each season's clubs, 3,000 games a season (`scripts/hockey-eras.test.mjs`, measured
2026-11-13): every season within 0.055 of its league's goals a club (1970/71 3.10 against 3.12, 1981/82 3.99 against
4.01, 1992/93 3.60 against 3.63, 2003/04 2.58 against 2.57, 2010/11 2.69 against 2.73). `npm run simulation:realism`
plays five seasons whole on their own schedules ([match-simulation.md](match-simulation.md#realism-against-real-leagues)).

**Not modelled.** Power plays and penalties, in any era: a season's rules reach the game only through its goals, its late
game and its overtime. A level game is never left a tie.

**Saves.** A campaign of an earlier season saved before plays its next matches under version 2: their scores, overtime
and clock follow the season's day. The built-in season's campaigns are unchanged.

## Credits

The Hockey Databank's terms ask that its statement be displayed prominently and in its entirety on the product, and
MoneyPuck.com asks for a clear credit (added 2026-11-10). The mechanism is any sport's: a data set's listing entry may carry
a `credit`, the plain text its sources ask to be shown with it. `listing` in `src/engine/footballSets.js` keeps it exactly
as written (an entry with a blank or non-text credit is left out, as any entry the builder would not write); the setup
model passes the chosen season's on (`season.credit`, '' for none); and setup shows it as text right under the Season
choice, while the season loads too, the choice naming it in its `aria-describedby`. The season files carry none, so their
versions, and every save on them, stand. Only ice hockey's seasons carry one so far.

`scripts/build-nhl-seasons.mjs` (`creditOf`) writes each season's into `src/data/hockeySeasons.js`, each text once as a
constant:

| Seasons | Credit |
| --- | --- |
| The 43 computed from the databank, NHL 08 and NHL 09 | the databank's statement |
| 2010/11 to 2024/25 but 2021/22 (14), computed from MoneyPuck's data | "Data: MoneyPuck.com." then the statement |
| 2025/26 | "Data: MoneyPuck.com" |
| The five EA editions | none: their positions and birth countries are the NHL's rosters' |

The statement is `computed.sources.hdb.attribution`, word for word as the databank's readme asks for it (the sync and a
test check the readme still does), two spaces after "project." included: "The information used herein was obtained free
of charge from and is copyrighted by the Hockey Databank project.  For more information about the Hockey Databank project
please visit http://sports.groups.yahoo.com/group/hockey-databank". A season takes it wherever its snapshot draws on the
databank (`usesDatabank`): every line of a season computed from it; NHL 09's skaters' positions (its rosters of 2008/09,
else the seasons beside it); the birth country of a player EA's Country does not place, in NHL 08 (Cristobal Huet's
France, its notes record) and NHL 09; and a MoneyPuck season's birth countries where MoneyPuck's lookup gives no
nationality (`notes.birthFromDatabank`: 27 players in 2010/11 down to one in 2024/25, none in 2025/26).
`public/hockey/ATTRIBUTION.txt` says the same and names where the game shows them.

**On screen.** 11px Archivo in the muted text colour (5.0:1 on the light page, 6.2:1 on the dark), 10.5px below 390px
wide, never cut or clamped. The longest, MoneyPuck's with the statement (254 characters), runs four lines in the controls'
column at every size measured (three at 1920 wide, two across a portrait tablet). It takes the room of step 1's extras
where they compete for height: the lede on every phone and on windows up to 800px tall; the whole heading on a phone with
a notice line (resume, a challenge link) and on a short window with two. Measured in
[compact-pass.md](compact-pass.md#measured): no vertical scrolling from 360×640 to 1920×1080, but for two notice lines at
once on the smallest phones, which already scrolled for football.

**In play** the game names a season (the campaign title, the Ledger's head, Saved campaigns' "Season") but not its
source, save in the passing loading or error line of Retry this setup when the season must be fetched again ("Loading
the Computed from statistics season…"), so the credit shows in setup alone.

## Tests

`scripts/hockey-seasons.test.mjs`: the 65 seasons rebuild byte for byte (and from the pinned
downloads, when they are on the computer); the listing, the era maps and the loader's refusals;
the classic facts (Gretzky 87, Lemieux's cap, Chambers's 1, the Rangers from Segathon, the short
clubs); the rescale (the frozen NHL 27 reference, every rating the rescaled game overall of its
player, the order holding and ties staying ties, NHL 07 and NHL 22 unconverted); NHL 22 against
EA's lists; the name matching; the running App launching a 1993/94 nations campaign and a
2006/07 clubs campaign on its map, and resuming; and the Season choice showing each season's credit
as text under it as the player picks seasons (MoneyPuck's with the statement, MoneyPuck's alone, the
statement, none).

`scripts/hockey-computed.test.mjs`: the superseded rule by hand (as the back-test still reads it), 2004/05 skipped,
the club by most games; the mid-rank ratings, ties and the step rule; a line's facts and a player's value by hand (the
window 3:2:1, the effective exposure, the measured prior, the regulars' z-scores, the frozen weights); results
strength by hand (goal differential, the SRS, divisions that never met, a shoot-out's goal off); MoneyPuck's game
scores with the Coyotes' home games mended and the databank's records; m in its range and the same for the same seed;
every computed rating NHL 27's moved by its club's whole number (its best few one more), nobody passing anybody in his
club; every club within reach of its target and the clubs as played following S (Spearman ≥ 0.94 each season, the
shown strengths ≥ 0.80 in the median one); the stars and clubs of known seasons; the calibration against the five
editions in the window EA saw (F ≥ 0.82, D ≥ 0.80, G ≥ 0.69 each; the blend above the superseded rule in every group;
ice time better for NHL 22; goals against within 0.03 of save percentage) and the frozen weights the ones the editions
choose, each edition left out choosing within 0.05 of them (0.1 for goalies by goals against); nations from
1977/78; the birth-city rule; the federations of the day (tennis's table, no member listing a nation in its
federation's years, the land held only by a real side, Stastny, Balderis, Khristich and Irbe, the names on the teams);
the names MoneyPuck dropped letters from put back; NHL 08 and NHL 09
(the attribute lists, the 255 rows, the three rows broken pages hide, NHL 07's self-check from the
pinned pages); the eras (club counts, the Original Six unchanged from 1960/61 to 1966/67, the Seals
and Barons, the 1979/80 Whalers at Springfield, the editions' lists reproduced); every map serving its
seasons; the loader's refusals; every season's credit (the statement word for word where the season
draws on the databank, MoneyPuck's on its seasons, none on the editions, the season files untouched)
and the databank's readme asking for it, when it is on the computer; and the running App playing a
1960/61 and a 1967/68 clubs campaign, a 1985/86 nations campaign, a 2025/26 clubs campaign on today's
map and a 2007/08 nations campaign (each saved and the 1960/61, 2025/26 and 2007/08 ones resumed),
and resuming a 2006/07 campaign saved on `nhl2007` and a 1966/67 one saved on `nhl1967` before each
map served more seasons.

`scripts/hockey-eras.test.mjs` holds the rules by era: one rules object a season, the built-in season's untouched; the
league's goals sourced and covering every season, and every season's clubs scoring within 0.06 of them; level games
settled at their era's shares, the playoffs' overtime always ending by the fifth period with nothing after its goal; the
playoff overtimes as NHL.com lists them (recomputed from the pinned pages and downloads when they are on the computer);
the clock, feed, texts and chart ticks of the playoffs' periods; the live chart against the odds; and the running App
playing a 1981/82 clubs campaign through the playoffs' overtime. `scripts/simulation-realism.test.mjs` holds the five
seasons the harness plays whole.

`scripts/setup-wizard.test.mjs` holds the generic side: a listed set's credit in the model and on
screen under the Season choice, gone with a season without one, and the CSS that never cuts it and
makes room for it; `scripts/football-sets.test.mjs` the listing keeping a credit word for word.

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
  needs a new pull. The earlier seasons are fixed files ("Earlier seasons").
- NHL players only, by nationality or birth country (in an earlier season, the federation of its day).
- 58 seasons are computed, not rated by any game ("Computed seasons"): goalies and defencemen agree least with EA
  (0.83 and 0.86 against the editions, forwards 0.90), and before 2010/11 skaters' selection is by games alone, so a
  shutdown defender rates low until his club's results move it. The move follows a season's goal differential, not its
  points: a club that won its close games ranks below its standing. As shown (the lineup's mean), a club with a great
  goalie looks weaker than it plays. No time on ice before 2008/09 and no goalies' shots against before
  1982/83 are in the open sources; the NHL's API has both, but turns this project's agents away.
- Terms. MoneyPuck.com's data, behind the 15 seasons from 2010/11, is free for non-commercial use only, as the NHL's own
  statistics behind the built-in season are; with ads on, the game should ask MoneyPuck. Using it was Claude's decision
  of 2026-11-09, under the user's request to cover every missing season, and the user accepted it with the release of 2026-11-10. The Hockey
  Databank's statement and MoneyPuck's credit show in full under the Season choice ("Credits"), in setup only: no screen
  in play names a season's source beyond a passing loading line.
- Names: the Hockey Databank and MoneyPuck spell names without accents ("Borje Salming", "Tim Stutzle"), and the
  databank in its own way (Raymond Bourque); NHL 08 and NHL 09 keep IGN's spellings.
- NHL 09's attributes are EA's before release; neither NHL 08's nor NHL 09's overall is EA's.
- Nations campaigns are top-heavy. Half the elite 32 are minnows at the baseline, so the
  United States, Canada and Russia win about four titles in five (`npm run balance`, 1,200
  campaigns). Since 2026-11-09 no minnow plays: the seven real sides play the world and Europe,
  and hockey offers no Elite 32.
- No power plays, penalties or fights: a goal is a goal.
