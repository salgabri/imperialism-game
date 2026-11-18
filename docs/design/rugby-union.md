# Rugby (union)

Status: implemented 2026-11-18. The fifteenth sport, shown as **Rugby**: rugby union's Six Nations and Europe's clubs.
The user asked on 2026-11-18 that "rugby league should be just rugby. It should offer a six nations option. it should
present european clubs". The Six Nations and Europe's clubs play rugby union, a different sport from the game's rugby
league (13 a side, the NRL, Rugby League 26), so the user was asked which "Rugby" should be, and chose **"Union as
Rugby"**: a new 15-a-side sport card, "Rugby", with a Six Nations theatre and the Premiership's, Top 14's and URC's
clubs, ratings computed from real match statistics, while the NRL sport stays as it was, named "Rugby league". Sport id
`rugby-union`; it sits before rugby league in the sport list.

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
  British and Irish Lions' 2025 tour): 1,999 games, each with full team sheets and stats. A season runs from 1 August to
  31 July.

## The snapshot

`scripts/data/rugby-union-2025-26.json` (650 KB, committed), one game or player a line:

- `teams`: RugbyPass's team id → its name and kind (club or Test).
- `games`: every game of the window: id, season, competition, date, sides, score, venue, and each side's tries,
  conversions, penalty goals, drop goals and penalty tries (RugbyPass counts a penalty try among the tries, at seven).
- `tryPlaces`: each competition season's tries by the scorer's place in the team sheet (a starter's position, or the bench).
- `players`: every player who took the field for a club of the 2025/26 Premiership, Top 14 or URC (1,947), with each of
  his three seasons: his teams (games, starts and minutes with each), the positions he started at (by his number: 1 and 3
  prop, 2 hooker, 4 and 5 lock, 6 and 7 flanker, 8 number eight, 9 scrum-half, 10 fly-half, 11 and 14 wing, 12 and 13
  centre, 15 fullback), his appearances off the bench by RugbyPass's label, and his totals (tries, try assists,
  conversions, penalty goals, drop goals, defenders beaten, metres carried, tackles, turnovers won, penalties conceded,
  yellow and red cards). A player's minutes are his time on the field by his substitutions (a starter from kick-off, a
  blood or front-row replacement off and on again), to the game's last event (extra time included).

## The method

`scripts/lib/rugby-union.mjs` (`seasonOf`), `npm run build-rugby-union` (`scripts/build-rugby-union.mjs`, `--check`
rebuilds byte for byte), the audit of every step in `docs/design/rugby-union-audit.json`. The steps are
[computed-ratings.md](computed-ratings.md)'s.

1. **Who is in the squad.** A player counts for the club of the three leagues he played the most minutes for in 2025/26
   (the later of two as many). His position is the one he started at most in his latest season with a start; one who
   never started takes his commonest bench label (RugbyPass's back row reads flanker, its outside back wing). He also
   plays every other position he started at at least twice, and the scrum-half's or hooker's place he sat on the bench
   for twice: the other bench labels follow the shirt's usual place as often as the player's (the Top 14's 23 reads
   "Prop"), so they name none. Nobody is left out (1,947 of 1,947 placed).
2. **What is collected.** Results (every game's score and venue), selection (minutes with his club, minutes in Tests and
   the Lions'), production (the totals above).
3. **Value.** Three signals over the window, the season itself 3, the one before 2, the one before that 1, pooled by
   exposure:
   - **Club selection**: his club minutes over his club's minutes available (80 × its league and European cup games).
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
   the sport, so nothing tunes the weights. Club selection is the least stable (rel 0.32 at prop, 0.39 at fly-half: injuries,
   rotation, moves), Test minutes the most (0.68, 0.84), production between (0.66, 0.68): at fly-half the weights come out
   0.11, 0.62 and 0.27.
4. **Rating.** Each value's mid-rank percentile within its position, read off the default shape of a sport no game has
   rated: the clubs' matchday places at the position (the plan's count there × the clubs) at 73/76/80/84/90 for
   p5/p25/p50/p75/p95 (`SHAPE`), everyone below them on a straight line from 60 up to where that starts (`DEPTH`).
5. **Results.**
   - **Clubs** move by their 2025/26 results: a Simple Rating System of every club game of the season, the leagues and
     both European cups (which tie the three leagues together), a home edge fitted (9.6 points: the largest of any sport the
     game plays) and a game away from the home side's usual ground neutral. Reliability 0.87. Each club's target is the
     clubs' mean strength + √r × its rating ÷ m, m the engine's margin a point of strength (3.88, `perPointOf` with
     `marginOfGap`), and every player of the club moves by a whole number, the best few by one more, until the strength the
     model plays (its matchday 23's, `rugbyUnionStrength`) reaches it. The URC's four South African sides move too: their
     players play for South Africa. Moves run −6 (Benetton) to +4 (the Stormers).
   - **Nations** move by their Tests, from their players' own ratings before any club move: the order inside a nation's
     squad comes from the players' evidence, its level from its results ([computed-ratings.md](computed-ratings.md),
     "National teams drawn from many leagues"). A Simple Rating System of 2025/26's Tests (104 among the nations France's
     games connect; reliability 0.94, home edge 3.1). Only a nation whose 2025/26 Test minutes the clubs' players played at
     least 75% of (`COVERED`) moves: France, Ireland, Italy, Scotland and England (100%), Wales (98%) and Argentina (87%).
     South Africa (65%), Georgia (35%), Fiji (28%) and the rest field squads that are not the sides their results were won
     with (many Springboks play in Japan, New Zealand's and Australia's players at home), so their players keep their own
     ratings.
   - Why the two apart. Moved by its club's results, a Leinster international would carry a URC season in which he rested
     through most of it: Leinster's results rate its rotated side, not its Test XV. Moved from his own rating, Ireland's
     squad is ordered by its players' evidence and set at its Test level. A player can therefore rate a point or two
     differently for club and country. Tried first, and dropped: moving each club by its minutes-weighted side (who played
     its games) kept Leinster's players high but spread the clubs' best 23s 20% wider than their results (the realism
     harness's table spread 0.199 against 0.162–0.184).

**The season, as built:** clubs from Stade Toulousain (83.6), Bath (83.1), Northampton (82.4), Saracens (82.1) and Leinster
(81.7) down to Zebre Parma (75.9), Newcastle (74.8) and US Montauban (71.6, last of the Top 14 with an SRS of −32). Nations:
France 92, England and Ireland 89, Argentina and Scotland 88, South Africa 87, Italy 85, Wales 84; then Fiji, Georgia,
Samoa, Tonga and Australia, whose clubs' players hold half a matchday 23 or a little more (the game fills their other places
with generated players at their strength). Thirteen nations field a team; New Zealand (three players), Japan and the rest
stay neutral.

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
seasons 2023/24–2025/26 pooled (`REAL.union`, computed from the snapshot by `realFigures`):

| Measure | Model | Leagues |
| --- | --- | --- |
| Points a team | 27.3 | 24.4–27.5 (2025/26 27.5) |
| Tries a team | 3.72 | 3.05–3.74 |
| Conversions made | 75.9% | 73.9–75.8% |
| Penalty goals a team | 1.01 | 1.02–1.49 |
| Drop goals a game | 0.039 | 0.035–0.084 |
| Level after eighty | 2.6% | 1.2–2.6% |
| Mean margin | 17.8 | 13.4–17.3 |
| Won by 1–7 / by 15+ / by 30+ | 27.9% / 49.6% / 19.2% | 32.3–39.4% / 37.4–49.0% / 11.8–19.0% |
| Held scoreless / 40 or more (a team game) | 1.8% / 18.6% | 0.5–1.2% / 11.3–17.9% |
| Home wins | 68.4% | 68.4–70.1% |
| Win% spread of the table | 0.177 | 0.162–0.184 |

Penalty goals fell from 1.49 a team in 2023/24 to 1.02 in 2025/26 and tries rose: the model plays 2025/26, the built-in
season. Known gaps: too few games won by seven or fewer and too many teams held scoreless; the tests hold everything else
in range (`scripts/simulation-realism.test.mjs`).

## Live win probability

`src/engine/winProbability.js`, kind `tries` with `code: 'union'`: rugby league's tables from union's own slices, points and
kicks (`RUGBY_CODES`). At kick-off the chart is within two points of the fixture's simulated odds.

## Interface

- **Setup.** A sport card, "Rugby", "Nations · 36 clubs from 3 leagues", before "Rugby league". Its season is 2025/26 and
  its note says where the ratings come from. Nations offer the world, Europe and the **Six Nations** (a SCOPES entry of
  rugby union alone, `six-nations`, framed on Europe like EuroBasket); clubs offer the European clubs' map.
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
The URC's four South African sides are rated but play on no map.

## Tests

`scripts/rugby-union.test.mjs`: the RugbyPass parsers, minutes and the snapshot's sums on synthetic pages; the clubs, nations
and audit byte for byte; every club's whole 23; the positions' costs; the nations' Test levels and the Six Nations theatre;
the match (a winner always, the feed adding up, sudden death); the score effects; the clubs' margins following their
results; favourites and home advantage; the feed copy; the live chart; the setup and the squad screen; the real figures.
`scripts/simulation-realism.test.mjs` holds the model to the leagues (above). The smoke plays a Six Nations campaign and one of the 36 European clubs on their map.

## Known limits

- Every rating is computed and marked an estimate; agreement with a game cannot be measured, as none rates the sport.
- The nations are the clubs' players: New Zealand, Australia, Japan and most Pacific players play at home, so New Zealand
  fields no team and Australia, Samoa and Tonga field thin ones. Super Rugby Pacific and Japan's League One are not read.
- A player can rate a point or two differently for his club and his country (above).
- The model's margins: too few close games (27.9% won by seven or fewer against 32–39%) and too many teams held scoreless.
- Sudden death's scoring and the second half's share of the points are estimates; RugbyPass's key events kept here carry no
  half-time score.
- One season only (2025/26): earlier seasons are a possible follow-up from the same source (back to 2021/22 at least).
