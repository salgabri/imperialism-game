# Ice hockey

Status: implemented 2026-11-07. A sixth sport: the 32 NHL clubs fight over the USA and
Canada on the NHL's own map, each holding its own state or province
([domestic-campaigns.md](domestic-campaigns.md#the-nhl-map)), and the nations field the NHL's
players of each country. Everything outside the match
(territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.
Since 2026-11-09 every NHL season from 1966/67 to 2025/26 but the cancelled 2004/05 is built in
("Earlier seasons", "NHL 08 and NHL 09", "Computed seasons", "Eras").

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
  and Canada**. The note under Season says which ratings are estimates, which seasons are converted
  or computed and from what (crediting the Hockey Databank and MoneyPuck.com), and that nations play
  from 1977/78. A season to 1976/77 has clubs only: choosing it takes the clubs.
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

Fifty-nine earlier seasons, every NHL season from 1966/67 to 2025/26 but the cancelled 2004/05,
each with its clubs on the map of its day ("Eras"):

| Seasons | Ratings | Source |
| --- | --- | --- |
| 1992/93, 1993/94, 1994/95, 2006/07, 2021/22 | an EA edition's (below) | NHLPA 93, NHL 94, NHL 95, NHL 07, NHL 22 |
| 2007/08, 2008/09 | EA's attributes, the overall converted ("NHL 08 and NHL 09") | IGN's NHL 08 and NHL 09 pages |
| 1966/67–1991/92, 1995/96–2003/04, 2005/06, 2009/10 (37) | computed from the players' statistics ("Computed seasons") | the Hockey Databank |
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

The other 52 seasons have no game's ratings anyone published in full (decided 2026-11-09). NHL 96 to NHL 2006 and NHL 10
to NHL 21 published none; NHLRatings.net's NHL 23 to 26 pages are stale or partial; EA's own lists stop at its top 20 to
320 players. Their ratings are **computed from the players' regular-season statistics** by the rule below, labelled as
computed wherever they are shown. They are no game's ratings.

**Sources.** Only open sources whose sites allow this project's agents. The NHL's own statistics API (api.nhle.com,
api-web.nhle.com), which the plan meant to use, turns away ClaudeBot, anthropic-ai and Claude-Web in its robots.txt and
limits its use to non-commercial personal use: nothing of it is used for these seasons, not even for the calibration.

| Source | Seasons | What it gives | Terms |
| --- | --- | --- | --- |
| The Hockey Databank, version 13.0 (10 July 2018), as published at github.com/rippinrobr/hockey-databank (commit de59443) | 1964/65–2009/10 here (it runs to 2017/18) | each player's games and points per club (Scoring), goalies' games, minutes, goals against and, from 1982/83, shots against (Goalies), name, position and birth place (Master) | free use, a commercial product included, with its attribution statement displayed in its entirety |
| MoneyPuck.com's season summaries (moneypuck.com/data.htm) | 2008/09–2025/26 | each player's games, points, time on ice; goalies' shots on goal and goals against; position | free for non-commercial use, crediting MoneyPuck.com |
| MoneyPuck.com's game-by-game player files (its download host, peter-tanner.com) | the 15 seasons computed from MoneyPuck | each player's team in every game, for his club | the same |
| MoneyPuck.com's player lookup | 2010/11–2025/26 | each player's nationality (the NHL's) and birth date | the same |

The databank's own sources are the NHL's guides and record books, Total Hockey and others (its readme). Its statement:
"The information used herein was obtained free of charge from and is copyrighted by the Hockey Databank project. For
more information about the Hockey Databank project please visit http://sports.groups.yahoo.com/group/hockey-databank".
It is in `public/hockey/ATTRIBUTION.txt` and in each of its seasons' `source.attribution`; the sync checks the readme
still asks for it word for word. raw.githubusercontent.com and peter-tanner.com have no robots.txt rules; moneypuck.com's
robots.txt only defines Cloudflare's content signals. Every download (4 databank files, 36 MoneyPuck season summaries,
the lookup and 30 game-by-game archives of 329 MB in all) is pinned by SHA-256 in `scripts/data/nhl-seasons-sources.json`.

**The rule** (`scripts/lib/nhl-computed.mjs`, the built-in season's estimate rule carried back in time):

- *A season's value.* A forward's is 8 × points a game, a defender's 5 × points a game, each line starting from a
  replacement player's ten games at 0.1 points a game. Where the source keeps time on ice (MoneyPuck, from 2008/09) the
  value adds minutes a game, the line starting from those ten games at 9 minutes.
- *A goalie's.* 1000 × his save percentage above the league's, his line starting from 600 shots at 12 points under the
  league's, plus 6 × his share of the season's games (the most any skater played; at most 1). Before 1982/83 no shots
  against were kept, so a season whose three seasons are not all from 1982/83 on compares goals against instead:
  1000 × (the league's goals against per 60 minutes − his) / 30 shots, his line starting from 1,200 minutes at 0.36 goals a
  game over the league's (the same 600 shots at 12 points under, at 30 shots a game).
- *The score.* The mean of the values of the season itself, the season before and the one before that, weighted 1:2:1
  over the seasons he played; 2004/05 is skipped (2003/04 comes before 2005/06).
- *Club and position.* The club he played most games for (a tie: the later one); the position of his longest stint
  (the databank) or MoneyPuck's.
- *Ratings.* Provisional ratings (each score's mid-rank in its group over every player of the season) let the game's
  own lineup picker choose each club's squad, as the built-in season does. Then every squad player's rating is his
  score's mid-rank in his group over the season's squad players, read off NHL 27's built-in squads in that group (433
  forwards, 236 defenders, 64 goalies of 2026-11-07, frozen in `computed.histograms`): every computed season plays on
  NHL 27's scale. Ties stay ties and nobody passes anybody in a group. A nation's player outside every squad takes the
  rating of the highest squad score in his group not above his.
- *Nations.* The databank's birth country, a birth it files in the USSR, Czechoslovakia or Yugoslavia counting for the
  country its city is in today, and a birth city it files under a country the city is not in (Bratislava and eleven more
  Slovak cities under the Czech Republic, Ceske Budejovice and Havlickuv Brod under Slovakia, Sverdlovsk under Ukraine,
  Kharkiv, Pavlodar and Vost under Russia, Naliboki under Poland) counting for the city's country: Stan Mikita and the
  Stastnys count for Slovakia, Nikolai Khabibulin for Russia. The MoneyPuck seasons take the nationality its lookup
  gives, the NHL's (Olaf Kolzig counts for Germany there); where it gives none, the databank's birth country of the one
  player of 2008/09 to 2017/18 with that name (Pavel Datsyuk, Chris Pronger and 25 more in 2010/11). None to one player a
  season to 2017/18 is left without a nation, 5 to 37 after (2025/26's mostly rookies); they play for no nation.
- *Namesakes.* Two players of one season who share a name carry their birth year ("Sebastian Aho (1997)"), or their
  birth date where that is shared too ("Steve Smith (1963-04-04)").
- *Dropped letters.* MoneyPuck's files from its 2022/23 season on drop every letter of a name that is not plain ASCII
  ("Tim Sttzle", "Alexis Lafrenire", "Matj  Blmel"). The 17 players this hits in 2022/23 to 2025/26 take back their
  names (`computed.moneypuckNames`, by NHL id): as MoneyPuck spelled them in its earlier files, else as the built-in NHL
  27 season does, in plain letters like every other MoneyPuck name ("Tim Stutzle"). The sync checks each is MoneyPuck's
  name with only letters put back, and stops on any other name with a run of spaces. One more, "Nathan Lgar", in no
  squad, has no such spelling and stays as MoneyPuck gives it.

**Calibration**, measured 2026-11-09 against the five full EA editions (`scripts/data/nhl-seasons/calibration.json`
holds their players with their lines from these sources; `docs/design/hockey-seasons-audit.json` `calibration` records
every figure). Both the edition's overalls and the computed scores are read off NHL 27's squads group by group, then
compared: Spearman per group, the mean gap per player, and clubs as their best 12 forwards, 6 defenders and 1 goalie.

| Edition | Stats | Forwards | Defenders | Goalies | Goalies by goals against | Player gap | Clubs ρ | Club gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NHLPA 93 (1992/93) | databank, points | 0.84 (322) | 0.76 (168) | 0.60 (62) | 0.66 | 2.78 | 0.78 | 1.69 |
| NHL 94 (1993/94) | databank, points | 0.90 (345) | 0.83 (202) | 0.83 (55) | 0.77 | 2.04 | 0.79 | 0.66 |
| NHL 95 (1994/95) | databank, points | 0.88 (361) | 0.81 (195) | 0.73 (53) | 0.71 | 2.23 | 0.82 | 0.69 |
| NHL 07 (2006/07) | databank, points | 0.90 (509) | 0.79 (259) | 0.73 (83) | 0.66 | 2.21 | 0.63 | 0.47 |
| NHL 22 (2021/22) | MoneyPuck, minutes | 0.92 (397) | 0.89 (212) | 0.66 (64) | — | 1.88 | 0.89 | 0.45 |
| NHL 22 (2021/22) | MoneyPuck, points only | 0.91 | 0.86 | 0.66 | — | 1.92 | 0.81 | 0.59 |

The figures are within 0.01 of the research's, made from the NHL's API (NHLPA 93 0.84/0.76/0.60, NHL 22 0.92/0.89/0.67),
except NHL 07's defenders: the databank keeps no time on ice, and minutes a game rank them better (0.87 in the research). Goals
against rank goalies within 0.02 of save percentage on average (0.70 against 0.72), so the seasons before 1984/85 use
them. EA's own published players, cross-checks only, within their narrow tops: NHL 27's top 300 against 2025/26 and
2024/25 weighted 2:1, F 0.84, D 0.73, G 0.67; NHL 23's launch lists (66) against the computed 2022/23, F 0.84, D 0.55,
G 0.22 (10 goalies); NHL 24's (120) against 2023/24, F 0.76, D 0.61, G 0.74; NHL 25's 20 against 2024/25, F 0.91; NHL
26's first 50 against 2025/26, F 0.77, D 0.73, G 0.99 (6). These cross-checks are not in the audit: NHL 27's top 300 are
in `scripts/data/nhl-27.json`, but the NHL 23 to 26 lists are the research's unpinned copies of EA's pages (rank
correlations of the computed scores, re-measured 2026-11-10 for NHL 23, 24 and 27).

**Results**, from the audit (`best`, `clubs`):

- 1966/67: Bobby Hull 99, Stan Mikita 95; Doug Mohns and Pierre Pilote the best defenders, Bobby Orr 90 as a rookie;
  Chicago, first that season, the strongest club (84.9).
- 1970/71 to 1974/75: Phil Esposito the best forward, Bobby Orr the best defender every season. 1974/75: the expansion
  Kansas City Scouts and Washington Capitals the weakest clubs (78.6, 77.9).
- 1976/77: Guy Lafleur 99; the Canadiens, who lost 8 of 80, the strongest club.
- 1979/80 to 1988/89: Wayne Gretzky the best player every season (Mario Lemieux in 1989/90); Paul Coffey the best
  defender from 1983/84 to 1990/91.
- 2019/20: Connor McDavid, Leon Draisaitl, Nathan MacKinnon.
- Nations: Canada the strongest every season (the USA level with it from 2022/23); the USA second through the 1980s
  and 1990s (Sweden level in 1979/80); Czechia, Russia and the USA within a point of one another behind Canada from
  2000/01 to 2005/06 (the Jagr and Hasek years); Sweden second in 2010/11 and 2011/12.

**Club spread.** The rule regresses: its clubs sit closer together than an edition's, at about 0.6 to 0.8 of their
spread (club strengths' standard deviation 0.99 against 1.26 for NHL 22's players, 0.65 against 0.87 for NHL 07's).
The MoneyPuck seasons, where every club's top line logs the same minutes, run 0.6 to 0.9 points of standard deviation,
the databank's 0.7 to 2.3, widest in the 1970s (NHL 27 itself: 1.09). A season's surprise club is underrated (the
weights lean on the seasons before, as the games' ratings do), and the order at the top is loose: the 2019/20 Coyotes,
with Darcy Kuemper in goal, come out first by 0.1. A club's squad is picked from everyone who played most of his games
for it that season, so a club that went through many players fields stars it never had at once: the 2005/06 Penguins,
29th of 30, come out strongest by 1.4 with Mario Lemieux and Ziggy Palffy, who retired in January, and Mark Recchi,
traded in March. Skaters ranked by points alone (before 2010/11) undervalue a defensive club: the 1987/88 Canadiens,
second in the league, come out last of 21.

Over 20 seeded seasons of 82 games (the measures of `npm run simulation:realism` on each season's clubs; NHL range in
brackets):

| Season | Clubs | Win% spread (0.082–0.127) | Best, worst wins (55–65, 19–25) | Goals a team (3.01–3.14) | Won by five or more (5.5–6.5%) | Top scorer (52–69) |
| --- | --- | --- | --- | --- | --- | --- |
| NHL 27 (built in) | 32 | 0.099 | 58, 24 | 3.05 | 6.5% | 59 |
| 1967/68 | 12 | 0.121 | 57, 23 | 3.11 | 6.9% | 52 |
| 1976/77 | 18 | 0.118 | 61, 25 | 3.25 | 7.8% | 57 |
| 1984/85 | 21 | 0.106 | 55, 23 | 3.17 | 7.2% | 56 |
| 1999/00 | 28 | 0.110 | 55, 17 | 3.03 | 6.7% | 58 |
| 2007/08 (NHL 08) | 30 | 0.104 | 59, 24 | 2.62 | 5.0% | 79 |
| 2015/16 | 30 | 0.082 | 54, 26 | 3.05 | 6.0% | 59 |
| 2025/26 | 32 | 0.088 | 56, 25 | 3.04 | 6.3% | 58 |

The early seasons are allowed outside today's ranges (fewer clubs spread wider; the 1970s' blowouts), and are documented
rather than forced. So are the closest-packed modern seasons, just under the range's floor when re-measured 2026-11-10
(the harness's seed 20261101): 2005/06 at 0.079 and 2012/13 at 0.075 (best 55, worst 29 wins), while 1974/75 runs over
its ceiling at 0.161 (worst 14 wins; the Capitals won 8 of 80). NHL 08 plays on NHL 07's scale, like NHL 07 (2.73
goals a team, top scorer 80).

**Nations before 1977/78.** A season fields nations only where at least three play a real side (`fieldedNations`: their
own players hold at least half the lineup). By the databank's birth countries, Canada alone does until 1970/71, the
USA joins in 1971/72 and Sweden in 1977/78 (Bob Nystrom, Borje Salming, Inge Hammarstrom, Stefan Persson and seven more).
So the seasons to 1976/77 have clubs only: the loader's id test (`clubsOnly` in `src/engine/footballSets.js`) reads
`/^nhl-19(?:6\d|7[0-7])$/`, moved from 1979/80 to 1977/78 by this count (the research's sample of the NHL's bios had
missed 1977/78 and 1978/79), and the build fails if the test and the count disagree.

**Pipeline.** `node scripts/sync-nhl-seasons.mjs` (`--fetch`, `--pin`, `--check` as for the editions) reads the pinned
downloads under `data-src/nhl-seasons/` (`hockey-databank/`, `moneypuck/`, `moneypuck-games/`) and writes each
computed season's snapshot: the window's league figures (`leagues`: save percentage, goals against per 60, most games),
the form (`form`: points or minutes a game, saves or goals against) and every player of the season, `[source key, name,
club, position, country, lines]`, a line `[season, games, points, seconds on the ice]` or, a goalie's, `[season, games,
seconds, goals against, shots against]`. `node scripts/build-nhl-seasons.mjs` computes the rule from them, so the
snapshots (4.3 MB with the editions') are all a rebuild needs. No season waits on the NHL's own statistics: the
databank and MoneyPuck cover every one, so the `sync-nhl-stats.mjs` the plan offered as a fallback was not written. The
NHL's API would add time on ice for 1997/98 to 2009/10 and goalies' shots against before 1982/83, if the player ever
wants to run that download himself.

## Eras

Every season's clubs come from `scripts/data/nhl-seasons.json` `eras` (decided 2026-11-09): each franchise's identities
and arenas by season, from 1966/67, and the five editions' `teams` lists, which the eras reproduce exactly (tested).
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
`nhl1967`; `nhl1968` (to 1969/70: the Rangers' move to the fourth Garden, 1.4 km, keeps it); `nhl1971` (1970/71–1971/72);
`nhl1973`; `nhl1975`; `nhl1977`; `nhl1979`; `nhl1980`; `nhl1981` (1980/81–1981/82); `nhl1983` (1982/83–1985/86: the
Saddledome 0.2 km from the Corral); `nhl1987` (1986/87–1990/91, the Blackhawks' new spelling); `nhl1992`; `nhl1996`;
`nhl1997`; `nhl1998`; `nhl1999`; `nhl2000`; `nhl2001` (2000/01–2002/03: the Stars' new arena 2 km away); `nhl2004`
(2003/04, 2005/06); `nhl2012` (2011/12–2013/14); `nhl2015`; `nhl2016` (2015/16–2016/17); `nhl2018`; `nhl2019`
(2018/19–2020/21); `nhl2023` (2022/23–2023/24); `nhl2025`. `nhl2007` now serves 2006/07 to 2010/11 (the Devils' move to
Newark, 12 km within New Jersey, and the Penguins' 0.2 km keep it): its version changed, and a 2006/07 campaign saved
on it resumes through the existing remap path (tested). 2025/26 plays on today's `nhl` map, and the builder checks its
clubs and arenas are today's. The five maps of the editions are unchanged.

## Tests

`scripts/hockey-seasons.test.mjs`: the 59 seasons rebuild byte for byte (and from the pinned
downloads, when they are on the computer); the listing, the era maps and the loader's refusals;
the classic facts (Gretzky 87, Lemieux's cap, Chambers's 1, the Rangers from Segathon, the short
clubs); the rescale (the frozen NHL 27 reference, every rating the rescaled game overall of its
player, the order holding and ties staying ties, NHL 07 and NHL 22 unconverted); NHL 22 against
EA's lists; the name matching; and the running App launching a 1993/94 nations campaign and a
2006/07 clubs campaign on its map, and resuming.

`scripts/hockey-computed.test.mjs`: the rule by hand (both skater forms, both goalie forms, the
weights, 2004/05 skipped, the club by most games); the mid-rank ratings, ties and the step rule; every
computed rating NHL 27's and every group's order kept; the stars and clubs of known seasons; the
calibration against the five editions (F ≥ 0.84, D ≥ 0.75, G ≥ 0.59, players ≤ 2.8 and clubs ≤ 1.7
apart; minutes a game better for NHL 22; goals against within 0.03 of save percentage); nations from
1977/78; the birth-city rule; the names MoneyPuck dropped letters from put back; NHL 08 and NHL 09
(the attribute lists, the 255 rows, the three rows broken pages hide, NHL 07's self-check from the
pinned pages); the eras (club counts, the Seals and Barons, the 1979/80 Whalers at Springfield, the
editions' lists reproduced); every map serving its seasons; the loader's refusals; and the running
App playing a 1967/68 clubs campaign, a 1985/86 nations campaign, a 2025/26 clubs campaign on today's
map and a 2007/08 nations campaign (each saved and the last two resumed), and resuming a 2006/07
campaign saved on `nhl2007` before it served more seasons.

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
- NHL players only, by nationality or birth country.
- 52 seasons are computed, not rated by any game ("Computed seasons"): their clubs sit closer together than an
  edition's, goalies rank worst (Spearman 0.60 to 0.83 against the editions), and before 2010/11 defenders rank by
  points alone, so a shutdown defender rates low. No time on ice before 2008/09 and no goalies' shots against before
  1982/83 are in the open sources; the NHL's API has both, but turns this project's agents away.
- Terms. MoneyPuck.com's data, behind the 15 seasons from 2010/11, is free for non-commercial use only, as the NHL's own
  statistics behind the built-in season are; with ads on, the game should ask MoneyPuck. The Hockey Databank asks for
  its statement to be displayed prominently and in its entirety on the product: it is whole in
  `public/hockey/ATTRIBUTION.txt` and each season's source, but the game shows neither; the Season note, which the setup
  shows only as the Season list's tooltip, credits the databank in short. No screen shows it in full yet: the player's
  call before these seasons ship.
- Names: the Hockey Databank and MoneyPuck spell names without accents ("Borje Salming", "Tim Stutzle"), and the
  databank in its own way (Raymond Bourque); NHL 08 and NHL 09 keep IGN's spellings.
- NHL 09's attributes are EA's before release; neither NHL 08's nor NHL 09's overall is EA's.
- Nations campaigns are top-heavy. Half the elite 32 are minnows at the baseline, so the
  United States, Canada and Russia win about four titles in five (`npm run balance`, 1,200
  campaigns). Since 2026-11-09 no minnow plays: the seven real sides play the world and Europe,
  and hockey offers no Elite 32.
- No power plays, penalties or fights: a goal is a goal.
