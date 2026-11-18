# Rugby (union)

Status: implemented 2026-11-18. The fifteenth sport, shown as **Rugby**: rugby union's Six Nations and Europe's clubs.
The user asked on 2026-11-18 that "rugby league should be just rugby. It should offer a six nations option. it should
present european clubs". The Six Nations and Europe's clubs play rugby union, a different sport from the game's rugby
league (13 a side, the NRL, Rugby League 26), so the user was asked which "Rugby" should be, and chose **"Union as
Rugby"**: a new 15-a-side sport card, "Rugby", with a Six Nations theatre and the Premiership's, Top 14's and URC's
clubs, ratings computed from real match statistics, while the NRL sport stays as it was, named "Rugby league". Sport id
`rugby-union`; it sits before rugby league in the sport list.

Extended 2026-11-19 ([Super Rugby Pacific and League One](#super-rugby-pacific-and-league-one)): the nations whose players
play at home, New Zealand (three players before), Australia (thirteen), Japan (one) and the Pacific's, now field sides of
their own players, from Super Rugby Pacific's and Japan Rugby League One's clubs, rated within their leagues and set on the
European scale by their nations' Tests. Those clubs play on no map.

Everything outside the match (territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

**No game rates union players.** Big Ant's Rugby 25 keeps its ratings in the game and no site publishes them (the 2026-11-01
and 2026-11-07 surveys, and again on 2026-11-18). So every rating is computed, by the method of
[computed ratings](computed-ratings.md) ("Sports no game rates (rugby union …): steps 1–6 with the default scale, once a
permitted source of results and team lists is found"), and every one is marked an estimate in the game
(`src/data/estimates.js`, league "Rugby union"), as the EuroLeague's are.

## The source

RugbyPass's match centre (rugbypass.com, owned by World Rugby): `scripts/lib/rugbypass.mjs`, `npm run sync:rugby-union`
(`scripts/sync-rugby-union.mjs`).

- **Terms.** Its robots.txt (read 2026-11-18) disallows none of the paths read and names ClaudeBot and anthropic-ai with
  `Allow: /`; its llms.txt asks that results, fixtures and player statistics be attributed to RugbyPass, which the
  snapshot's `source`, the setup note and the README do. Every request goes through `scripts/lib/polite-fetch.mjs`, two at
  a time with 0.9 s between each. ESPN (disallows anthropic-ai), allrugby.com and rugbydatabase.co.nz (disallow ClaudeBot)
  were ruled out; itsrugby.com, the leagues' own sites and Wikipedia allow it but hold less in one place.
- **What is read.** A competition's fixtures page lists its seasons; its fixtures app's season filter (a POST of
  `action=filter-fixtures` to the same page, as the page's own script sends it) answers every game of a season as JSON; each
  game's match centre page (`/live/<path>/?g=<id>`) holds the game, both team sheets (each player's number, position,
  scores, cards and substitutions with their minutes), the key events (every score, by whom and when), the teams' summary
  (tries, conversions, penalty goals, drop goals) and each player's stats (tackles, carries and metres, defenders beaten,
  turnovers won, try assists and more). `gameOf` keeps only that part, as JSON, in the ignored `data-src/rugby-union/games/`.
- **What was downloaded.** 2,061 requests on 2026-11-18 (every one answered 200; `FETCH-LOG.tsv` beside the cache): the
  Premiership, the Top 14, the United Rugby Championship, the Champions Cup and the Challenge Cup of 2023/24, 2024/25 and
  2025/26, and every Test of those seasons (the Six Nations, the internationals of each window, the Rugby Championship, the
  Nations Championship's July 2026 games, the Pacific Nations Cup, the 2023 World Cup, the Rugby Europe Championship and the
  British and Irish Lions' 2025 tour): 1,999 games. Then 596 more the same day (every one answered 200), the robots.txt read
  again: Super Rugby Pacific (`super-rugby`) of 2024, 2025 and 2026 and Japan Rugby League One's Division One
  (`japan-rugby-league-one`) of 2023/24, 2024/25 and 2025/26, 585 games. A season runs from 1 August to 31 July, so Super
  Rugby's season of a year is the season that ends in its July.
- **What RugbyPass does not hold.** 56 games' pages carry the score but no team sheets or stats (`"hasTeamSheets":false`,
  checked again on one page): 35 of Super Rugby 2025's 83 (most from its tenth round to the final), 11 of the 2024 Six
  Nations' 15, nine Tests between nations off the map or far down it (Kenya v Uganda, Albania v Greece …) and the Challenge
  Cup's Cheetahs v Ulster of 11 January 2026 (28–0). The snapshot lists them (`sheetless`); their scores count among the
  results, but no minutes were recorded in them, so they count toward no club's minutes and no nation's Tests (below). The
  same games' try and kick counts are `null` where the page has none.

## The snapshot

`scripts/data/rugby-union-2025-26.json` (920 KB, committed), one game or player a line:

- `teams`: RugbyPass's team id → its name and kind: a club if it played any club game of the window (Super Rugby's four
  Australian sides also met the Lions on their 2025 tour, a Test competition's game), else a Test side. A nation on the map
  never plays as a club (the snapshot stops on one).
- `sheetless`: the games RugbyPass holds no team sheets for (above).
- `games`: every game of the window (2,584): id, season, competition, date, sides, score, venue, and each side's tries,
  conversions, penalty goals, drop goals and penalty tries (RugbyPass counts a penalty try among the tries, at seven).
- `tryPlaces`: each competition season's tries by the scorer's place in the team sheet (a starter's position, or the bench).
- `players`: every player who took the field for a club of the 2025/26 Premiership, Top 14, URC, Super Rugby Pacific or
  League One (2,855), with each of his three seasons: his teams (games, starts and minutes with each), the positions he started at (by his number: 1 and 3
  prop, 2 hooker, 4 and 5 lock, 6 and 7 flanker, 8 number eight, 9 scrum-half, 10 fly-half, 11 and 14 wing, 12 and 13
  centre, 15 fullback), his appearances off the bench by RugbyPass's label, and his totals (tries, try assists,
  conversions, penalty goals, drop goals, defenders beaten, metres carried, tackles, turnovers won, penalties conceded,
  yellow and red cards). A player's minutes are his time on the field by his substitutions (a starter from kick-off, a
  blood or front-row replacement off and on again), to the game's last event (extra time included).

## The method

`scripts/lib/rugby-union.mjs` (`seasonOf`), `npm run build-rugby-union` (`scripts/build-rugby-union.mjs`, `--check`
rebuilds byte for byte), the audit of every step in `docs/design/rugby-union-audit.json`. The steps are
[computed-ratings.md](computed-ratings.md)'s.

1. **Who is in the squad.** A player counts for the club he played the most minutes for in 2025/26 (the later of two as
   many), of the three leagues' clubs and Super Rugby's and League One's alike: 1,938 on the three leagues' scale (the
   URC's South African sides among them), 429 in Super Rugby and 488 in League One. His position is the one he started at
   most in his latest season with a start; one who never started takes his commonest bench label (RugbyPass's back row
   reads flanker, its outside back wing). He also plays every other position he started at at least twice, and the
   scrum-half's or hooker's place he sat on the bench for twice: the other bench labels follow the shirt's usual place as
   often as the player's (the Top 14's 23 reads "Prop"), so they name none. Nobody is left out (2,855 of 2,855 placed).
2. **What is collected.** Results (every game's score and venue), selection (minutes with his club, minutes in Tests and
   the Lions'), production (the totals above).
3. **Value.** Three signals over the window, the season itself 3, the one before 2, the one before that 1, pooled by
   exposure:
   - **Club selection**: his club minutes over his club's minutes available (80 × its league and European cup games with
     team sheets: a game RugbyPass holds none for recorded no one's minutes).
   - **Test selection**: his minutes in Tests a season, for a nation on the map or the Lions (an A side or the
     Barbarians count none).
   - **Production**: his core points a game (80 minutes), shrunk toward replacement level (the pooled rate of his
     position's quarter with the least exposure) by a prior from its reliability at a typical season's games
     (k = n̄(1 − r)/r). Core points are the Six Nations' own game for fans' points table (Guinness Six Nations Fantasy
     Rugby, as Planet Rugby's guide gives it, the 2025 game's fifteen for a forward's try) for every stat RugbyPass records:
     a try 10 (a forward's 15), a try assist 4, a conversion 2, a penalty goal 3, a drop goal 5, a defender beaten 2, a
     point every ten metres carried, a tackle 1, a turnover won 5 (its breakdown steal), a penalty conceded −1, a yellow
     card −3, a red −6. Its 50:22s, lineout steals and player of the match RugbyPass does not count.

   Within each position the three are z-scored and blended by their own stability, √rel ÷ (1 − rel), rel each signal's rank
   correlation between 2024/25 and 2025/26 among players with a quarter season (480 minutes) in both. No game ever rated
   the sport, so nothing tunes the weights. Club selection is the least stable (rel 0.29 at prop, 0.39 at fly-half: injuries,
   rotation, moves), Test minutes the most (0.69, 0.84), production between (0.64, 0.68): at fly-half the weights come out
   0.11, 0.62 and 0.27. Each scale is blended apart: the three leagues' players together, and Super Rugby's and League
   One's each among its own league's. Super Rugby's 2025 gap leaves fewer than eight players with a quarter season in both
   at prop, hooker, number eight, fly-half and fullback, so there each signal takes the method's 0.5 and they weigh alike.
4. **Rating.** Each value's mid-rank percentile within its position and scale, read off the default shape of a sport no
   game has rated: the clubs' matchday places at the position (the plan's count there × the clubs) at 73/76/80/84/90 for
   p5/p25/p50/p75/p95 (`SHAPE`), everyone below them on a straight line from 60 up to where that starts (`DEPTH`). A pool
   league's shape is then moved by its offset ([below](#super-rugby-pacific-and-league-one)).
5. **Results.**
   - **Clubs** move by their 2025/26 results: a Simple Rating System of every club game of the season, the leagues and
     both European cups (which tie the three leagues together), a home edge fitted (9.6 points: the largest of any sport the
     game plays) and a game away from the home side's usual ground neutral. Reliability 0.87. Each club's target is the
     clubs' mean strength + √r × its rating ÷ m, m the engine's margin a point of strength (3.88, `perPointOf` with
     `marginOfGap`), and every player of the club moves by a whole number, the best few by one more, until the strength the
     model plays (its matchday 23's, `rugbyUnionStrength`) reaches it. The URC's four South African sides move too: their
     players play for South Africa. Moves run −6 (Benetton) to +4 (the Stormers). Super Rugby's and League One's clubs move
     the same way within their own leagues, by each league's own 2025/26 SRS (reliability 0.87 and 0.89, home edges 6.3 and
     3.2 points), each league's mean strength kept: −4 (the Fijian Drua) to +3 (the BlackRams). They play nowhere; their
     moves are in the audit.
   - **Nations** move by their Tests, from their players' own ratings before any club move: the order inside a nation's
     squad comes from the players' evidence, its level from its results ([computed-ratings.md](computed-ratings.md),
     "National teams drawn from many leagues"). A Simple Rating System of 2025/26's Tests (104 among the nations France's
     games connect; reliability 0.94, home edge 3.1). The line it is read on is the three leagues' (`anchor`): the nations
     their players cover by themselves, France, Ireland, Italy, Scotland, England, Wales and Argentina, their mean strength
     at their Tests' mean rating, a point of Test rating √0.94 ÷ m (`report.tests.line`). Only a nation whose 2025/26 Test
     minutes the rated players played at least 75% of (`COVERED`) moves to its place on it: the seven (95–100%), and now
     Australia (99%), South Africa (98%), Japan (97%), New Zealand (94%) and Fiji (93%). A nation's Tests are all it played
     that season with team sheets, the Lions' included (Australia's third Test against them fell on 2 August 2025). The
     rule stays at 75%: the covered nations reach 93% or more and the next, Tonga, 56% (Samoa 33%, Georgia 35%), whose
     squads are not the sides their results were won with, so their players keep their own ratings.
   - Why the two apart. Moved by its club's results, a Leinster international would carry a URC season in which he rested
     through most of it: Leinster's results rate its rotated side, not its Test XV. Moved from his own rating, Ireland's
     squad is ordered by its players' evidence and set at its Test level. A player can therefore rate a point or two
     differently for club and country. Tried first, and dropped: moving each club by its minutes-weighted side (who played
     its games) kept Leinster's players high but spread the clubs' best 23s 20% wider than their results (the realism
     harness's table spread 0.199 against 0.162–0.184).

**The season, as built:** clubs from Stade Toulousain (83.7), Bath (83.0), Northampton (82.3), Saracens (82.2) and Leinster
(81.7) down to Zebre Parma (75.9), Newcastle (74.7) and US Montauban (71.6, last of the Top 14 with an SRS of −32). Nations:
South Africa 93, France 92, New Zealand 91, Australia 90, England and Ireland 89, Argentina and Scotland 88, Italy 85, Japan
and Wales 84, Fiji 80, each a whole 23 of its own players; Tonga 79 and Samoa 77 (thirty and twenty-seven of their own,
at their own ratings); Georgia 69, whose 24 rated players leave eight places the game fills with generated players.
Fifteen nations field a team; Spain, the United States and the rest, with seven players or fewer, stay neutral.

## Super Rugby Pacific and League One

Added 2026-11-19, so that the nations whose players play at home field their own: New Zealand's Test players play in
Super Rugby, Australia's mostly, Japan's in League One, and many of Fiji's, Samoa's, Tonga's and South Africa's in one or
the other. Both leagues are read from RugbyPass as the European ones are (585 games, [above](#the-source)) and rated as
pools (`POOL_LEAGUES`): their clubs (`scripts/data/rugby-union-clubs.json`, `europe: false`, Super Rugby's 11 of 2026 and
League One's 12 of 2025/26) play on no map, like the URC's South African sides, and their players play for their nations.

**One scale.** No club game links either league to Europe's, nor the two to each other, so the European clubs' results
cannot place them. Each league is rated within itself by steps 1–4, onto the same shape, which makes each league's median
player an 80 whatever its level; an offset then moves the whole league's shape (`report.tests.offsets`):

- **From the Tests of the nations drawn from it.** New Zealand's and Australia's sides are 81–84% Super Rugby players,
  Japan's 94% League One's, Fiji's 60% Super Rugby's, South Africa's 32% League One's (each the share of its matchday 23's
  strength, as the match model weighs it). A nation's players' own ratings place it somewhere before it moves; its Tests
  say where it should be. The anchor's seven show how the two relate on the European scale (`report.tests.line`): their
  players' own ratings bunch them together, as a Test minute counts alike whoever it is played for (France's stand 4.4
  points below the line, Wales's and Italy's 2.7 and 2.5 above it), their strength rising only 0.03 a point of Test
  rating where the line rises 0.25. A pool league is on the European scale when its nations stand as the anchor's would
  at their Test ratings (`stands` in each nation's move). Its offset is the least-squares answer over the covered nations,
  each counting by its share from the league, solved on unrounded ratings again from each answer's lineups until it
  settles (three solves): **Super Rugby +0.7, League One −1.2**.
- **Not from the line itself.** Asking each nation's players to stand on the line (where it moves to) instead gave Super
  Rugby +0.6 and League One −4.4: the bunching above is in every nation's own ratings, so a weaker Test side (Japan's,
  Fiji's) stands above the line whatever its league, and its league's offset would carry its Test level, not the league's.
- **Against the players who moved.** Players with a quarter season in Europe and one in a pool league in seasons next to
  each other produced (core points a game) 1.28× as much after going to League One (11) and 0.77× after coming from it
  (10): League One is the easier league to produce in, Europe the harder, both ways. Super Rugby's movers disagree with
  each other (1.21× for the 11 going, 0.99× for the 18 coming back), and between the two pool leagues production held level
  both ways (1.02×, 4 and 7 players). The two leagues sit close to each other, as the offsets have them (1.9 points
  apart), and the uncorrected fit's 5.0 apart does not.

So a League One player's rating is a point below what the same evidence earns in Europe, a Super Rugby player's under a
point above. The leagues' clubs, moved by their results, run from the Hurricanes (85.7), Kobe (83.2), the Chiefs (83.1)
and the Crusaders (82.9) to the Urayasu D-Rocks (75.1): the leagues' best about Europe's best. They play nowhere; the
nations take the players.

**What changed for Europe.** The three leagues' scale is read as before, from the same results (their SRS, home edge and
the clubs' targets are unchanged, the level 80.68 within 0.01), but three things move some of its players:

- Nine players who played for both a European club and a pool league's in 2025/26 count for the club they played the
  most minutes for, now that both are read (Pita Ahki from Toulouse to the Blues, Lukhanyo Am from the Sharks to
  Sagamihara, Angus Scott-Young from Northampton to the Waratahs, three of Benetton's short-term signings to the Reds …).
- 54 players of Europe's clubs played Super Rugby or League One in 2023/24 or 2024/25, seasons the snapshot lacked; they
  now count (Langi Gleeson 65 → 74 with his two Waratahs seasons, Ricky Riccitelli 71 → 77, Tom Banks 70 → 74; James
  O'Connor 87 → 84 with his Crusaders and Reds seasons). With them in, the reliabilities at nine positions moved, most by
  0.03 or less (club selection at number eight by 0.08), and some ranks with them.
- Ulster's Challenge Cup game at the Cheetahs has no team sheets and no longer counts toward its minutes available.

381 of the 1,938 European-scale players' ratings moved, 351 of them by one point. The clubs, moved to the same targets,
kept their strengths within 0.3 (Munster's 79.4 → 79.7, most a tenth or none) and their order but for three pairs that
were level or a tenth apart (Leicester and Montpellier, Harlequins and Racing 92, Sale and Munster); the map follows that
order, so it was rebuilt (`rugbyeurope-beb20ff1`): every club keeps its land and its colour, three pairs of sections swap
numbers. The seven anchor nations' targets moved by 0.05 at most.

## The lineup

The matchday 23 (`LINEUP_PLANS['rugby-union']`): the fifteen by their numbers and eight replacements, a hooker, two props,
a lock, a back-rower, a scrum-half, a fly-half and a centre. Of each position's places the best-rated players start
(`onField`). Positions group into units: the props, the hooker, the locks, the back row (flanker, number eight), each half,
the centres and the back three (wing, fullback). A move within a unit costs 4 points; a common move between units costs 8
(a lock in the back row, a prop and a hooker covering each other, a fly-half at centre or fullback, a centre on the wing,
the halves swapping); any other costs 25 (`UNION_CROSSING_PENALTY`), more than rugby league's 15: union's places are more
specialised. At 15 the lineup preferred a strong centre at nine over Ulster's own replacement scrum-half, and a strong
Georgian prop at lock or centre over the generated player the game fields for a nation's empty place. Every club fields a
whole 23 within its units and keeps up to 30; every nation, with its generated players, too (a union nation's fill is looked
at again once in, as a re-picked lineup can move a real player out of his unit to make room).

## The match model

`src/sports/rugbyUnion.js`, rugby league's design ([rugby-league.md](rugby-league.md#the-match-model)): sixteen five-minute
slices, so the score can decide how each is played.

- **Ratings.** A side's attack is 30% its backs, 25% its halves and 45% its forwards; its defence 25%, 10% and 65% (the pack
  wins the set piece and the breakdown). Replacements count at a third of a game (0.35) in their unit. Each try rate is
  `3.53·exp(0.9·tanh(0.1·edge/0.9))` in eighty minutes.
- **Scoring.** A try is five points, converted (two more) 75.6% of the time; penalty goals come at 1.03 a side between
  equals, drop goals at 0.01 in open play and late, level or a drop goal behind, at 7% and 4% a slice in the last ten minutes.
  A little more is scored after half-time (×1.03).
- **Score effects.** Through the second half a side up to two converted tries behind chases (tries ×1.35) and the leader
  protects (×0.8); late, a side level, ahead or a penalty goal behind takes the three points of a penalty (×1.3), one
  further behind kicks for the corner (×0.5); at any time a side fifteen or more ahead eases off (×0.75).
- **Extra time.** A campaign needs a winner, so a game level after eighty is played as a knockout: extra time in sudden
  death, in five-minute quarters up to twenty minutes, the first score winning it (estimated: 0.45 scores a side a quarter
  between equals, 45% penalty goals, 35% drop goals, 20% tries, as no league season reaches extra time often enough to
  measure); after twenty minutes a last drop goal decides it, close to a coin flip. The feed reads "in extra time", short
  "AET".
- **Form.** One match-day draw moves both try rates apart: 0.05 in log at Balanced, small, so the margin between equal sides
  varies by 16 points a game, the leagues' 16.8 about their results' fit.
- **Home advantage** (the option) moves the two try rates 0.48 apart in log: home sides win 68% of a simulated league
  season's games, as the leagues' do (68.4–70.1%).
- **Who scores.** Tries by place from the leagues' 2023/24–2025/26 team sheets (`tryPlaces`): wings 23.6–24.2% of all
  tries, centres 11–13%, the back row 15%, the hooker 7–8.5%, the scrum-half 7%, the fullback 6–7%, locks 4–5%, props 3–4%,
  the fly-half 3–4% and the bench 15–17%, times the rating above 55. Penalty goals and conversions go to the starter who
  kicked the most goals in 2025/26 (else the fly-half, fullback or scrum-half), drop goals to the fly-half.

Measured over twenty seeded seasons of each league with its own clubs (the Premiership's 10 over 18 rounds, the Top 14's
14 over 26, the URC's 12 European clubs over 18), with Home advantage on as the leagues play, against the three leagues'
seasons 2023/24–2025/26 pooled (`REAL.union`, computed from the snapshot by `realFigures`); `npm run simulation:realism --
--seasons=20 --home`, measured again on 2026-11-19 with the clubs as rebuilt then:

| Measure | Model | Leagues |
| --- | --- | --- |
| Points a team | 27.2 | 24.4–27.5 (2025/26 27.5) |
| Tries a team | 3.71 | 3.05–3.74 |
| Conversions made | 75.2% | 73.9–75.8% |
| Penalty goals a team | 1.01 | 1.02–1.49 |
| Drop goals a game | 0.038 | 0.035–0.084 |
| Level after eighty | 2.4% | 1.2–2.6% |
| Mean margin | 17.9 | 13.4–17.3 |
| Won by 1–7 / by 15+ / by 30+ | 27.3% / 50.5% / 19.5% | 32.3–39.4% / 37.4–49.0% / 11.8–19.0% |
| Held scoreless / 40 or more (a team game) | 1.7% / 19.3% | 0.5–1.2% / 11.3–17.9% |
| Home wins | 69.3% | 68.4–70.1% |
| Win% spread of the table | 0.177 | 0.162–0.184 |

Penalty goals fell from 1.49 a team in 2023/24 to 1.02 in 2025/26 and tries rose: the model plays 2025/26, the built-in
season. Known gaps: too few games won by seven or fewer and too many teams held scoreless; the tests hold everything else
in range (`scripts/simulation-realism.test.mjs`).

## Live win probability

`src/engine/winProbability.js`, kind `tries` with `code: 'union'`: rugby league's tables from union's own slices, points and
kicks (`RUGBY_CODES`). At kick-off the chart is within two points of the fixture's simulated odds.

## Interface

- **Setup.** A sport card, "Rugby", "Nations · 36 clubs from 3 leagues", before "Rugby league". Its season is 2025/26 and
  its note says where the ratings come from. Nations offer the world, Europe, the **Six Nations** (a SCOPES entry of
  rugby union alone, `six-nations`, framed on Europe like EuroBasket) and Asia & Oceania (New Zealand, Australia, Japan,
  Fiji, Tonga and Samoa field real sides there); clubs offer the European clubs' map.
- **Squad.** The field, rugby league's: the pack up front attacking the try line at the top, the halves, the centres and wings
  across it, the fullback at the back, the eight replacements along the foot in their numbers' order. Groups read Front row,
  Second row, Back row, Halves, Centres and Back three; the profile Backs, Halves and Forwards.
- **Feed.** "TRY — Louis Bielle-Biarrey (FRA)", "PENALTY GOAL — Thomas Ramos (FRA)", "DROP GOAL — …"; a conversion is the
  try's. The scorers' line: "Bielle-Biarrey 2 tries · Ramos 2 PG, 1 DG".
- **Icon.** A rugby ball with its seam and laces (rugby league keeps the posts).

## The map

The European clubs' map (`rugbyeurope`, an EUROPE_MAPS entry of sport `rugby-union` with no `theatre`, as the
EuroLeague's), built by `scripts/build-europe-maps.mjs` from `scripts/data/rugby-union-clubs.json`: each club's land in its
own country, a country divided between its clubs as the football Europe maps divide theirs; Ulster's is Northern Ireland's.
The URC's four South African sides, Super Rugby Pacific's 11 clubs and League One's 12 are rated but play on no map. The
map's section numbers and version follow the clubs' order by strength, so a ratings change that reorders two clubs means
`node scripts/build-europe-maps.mjs --only=rugbyeurope` again (it did on 2026-11-19; the land did not move).

## Tests

`scripts/rugby-union.test.mjs`: the RugbyPass parsers, minutes and the snapshot's sums on synthetic pages; a pool league's
players kept, a club that meets the Lions still a club, a nation never one; the clubs, nations and audit byte for byte;
every club's whole 23; the positions' costs; the nations' Test levels in their Tests' order, New Zealand's, Australia's and
Japan's whole 23s of their own, the anchor and the offsets; Super Rugby's and League One's clubs off the map, each filling
its 23 and moved to its results; the Six Nations theatre; the match (a winner always, the feed adding up, sudden death);
the score effects; the clubs' margins following their results; favourites and home advantage; the feed copy; the live
chart; the setup and the squad screen; the real figures. `scripts/simulation-realism.test.mjs` holds the model to the
leagues (above); `scripts/nation-theatres.test.mjs` counts fifteen fielded nations, `scripts/pacific-islands.test.mjs`
Tonga and Samoa among them. The smoke plays a Six Nations campaign and one of the 36 European clubs on their map.

## Known limits

- Every rating is computed and marked an estimate; agreement with a game cannot be measured, as none rates the sport.
- No club game links Super Rugby or League One to Europe's leagues, so their offsets come from their nations' Tests and the
  anchor's way of standing to its own (above), not from games between clubs; the players who moved between the leagues
  agree on their order, not on a number.
- A player plays for the side of his latest Test, as in Europe. New Zealand picks its own clubs' players (Ardie Savea and
  Anton Lienert-Brown played its 2025/26 Tests on sabbatical at Kobe), but its 30 also hold League One's TJ Perenara and
  Mark Tele'a, last capped in 2024/25, and Brodie Retallick, Richie Mo'unga and Aaron Smith, not since the 2023 World Cup:
  Retallick starts at lock and Mo'unga is on the bench. New Zealand still plays at its Test level.
- Tonga (56% of its Test minutes covered) and Samoa (33%) keep their players' own ratings, about four points above where
  their Tests would put them (Tonga 80.5 against 76.1, Samoa 78.3 against 74.4 in the model's strength): the rule moves a
  nation only where its rated players played its Tests.
- RugbyPass holds no team sheets for 35 of Super Rugby 2025's games: those players' 2024/25 seasons count only the 48
  it holds, and too few of them reach a quarter season in both of the last two at five positions to measure their own
  reliabilities (above).
- A player can rate a point or two differently for his club and his country (above).
- The model's margins: too few close games (27.9% won by seven or fewer against 32–39%) and too many teams held scoreless.
- Sudden death's scoring and the second half's share of the points are estimates; RugbyPass's key events kept here carry no
  half-time score.
- One season only (2025/26): earlier seasons are a possible follow-up from the same source (back to 2021/22 at least).
