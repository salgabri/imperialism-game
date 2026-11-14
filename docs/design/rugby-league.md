# Rugby league

Status: implemented 2026-11-08. An eighth sport: the 17 NRL clubs fight over Australia and New Zealand on the NRL's
own map, each holding its own state, territory or region
([domestic-campaigns.md](domestic-campaigns.md#the-nrl-map)), and the nations field the NRL's players of each country.
Everything outside the match (territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

**Why rugby league and not union.** Asked for "rugby", the player chose league on 2026-11-08: no game or site publishes
player ratings for rugby union (Big Ant's Rugby 25 keeps its own in the game), while Rugby League 26's are public for
every NRL player. Nothing here is estimated or invented: every rating is the game's.

## Data

**Source.** `npm run sync:nrl` (`scripts/sync-nrl.mjs`) joins three public sources, cached in the ignored
`data-src/nrl/`, into the snapshot `scripts/data/rugby-league-26.json` (74 KB, committed):

- Big Ant Studios' Rugby League 26 overall for every NRL player, as Zero Tackle listed them on the game's release,
  17 July 2025 ([the article](https://www.zerotackle.com/rugby-league-26-every-nrl-players-rating-224314/)): 597
  players at the 17 clubs of 2025, 26 to 40 a club, rated 64 to 93. The game has had no ratings update since.
- Each player's Zero Tackle profile, which the list links: his position, place of birth and the nations and states he
  is eligible for. One link goes astray (Manly's Nathan Brown points at the coach of that name) and one has moved (Clint
  Gutherson's, to his full name): `SLUG_FIXES`.
- NRL.com's match centre (`/draw/data` and each game's `…/data`): every 2025 team list (who started where, and who
  kicked the goals and field goals), and the 2025 Tests: the Ashes and the Pacific Championships.

Positions are Zero Tackle's, plus any other the player started at least twice in 2025 (117 players have two or more).
A profile with no position takes the one he started at most. Six players have neither (no profile position and no NRL
game in 2025) and are left out rather than given one: `source.unplaced` in the snapshot. 591 players remain. The
2025 goal-kickers (58 players kicked a goal) are kept too, so each side's kicker is a real one.

NRL.com spells a few first names in full (Nicholas Hynes, Samuel Stonestreet): the sync matches by full name, then by
surname at the same club with a first name that starts the same, and prints the loose matches. 106 listed players
played no NRL game in 2025; they keep Zero Tackle's position and no Test.

**Clubs.** `scripts/data/nrl-teams.json` names each club, its code (the NRL's own), the place its territory is named
after, its main ground and the point its territory grows from: the ground, except for the three clubs that share one
(the Rabbitohs and Bulldogs both play at Accor Stadium, the Wests Tigers at three grounds), which grow from their
training bases. `npm run build-rugby-league` (`scripts/build-rugby-league.mjs`, rules in `scripts/lib/nrl.mjs`) writes
`src/data/clubs.rugby-league.js` and `src/data/rosters.rugby-league.js`; `--check` rebuilds both byte for byte. Each club
fields the matchday 17 the game picks from its whole list, then its best players left, up to 24. The build runs from
the Storm's 85.1 to the Dragons' and Cowboys' 81.8: Rugby League 26 rates the clubs close together.

**Nations.** A player plays for the nation he played a Test for in 2025 (105 players); without a Test, for the country
he was born in (432); born off the map or where Zero Tackle does not say, for the first nation on the map he is
eligible for (12). The 42 left (no place of birth and no eligibility on the map, or born in Hong Kong) play for none.
Tonga, Samoa and the Cook Islands, whose 46 Test players were the reason to put them on the world map
([pacific-islands.md](pacific-islands.md)), field their own. Eight nations field NRL players: Australia (90), New
Zealand (86), Samoa (85), Tonga (83), England (74), Fiji (69), Papua New Guinea (58) and the Cook Islands (55). A lineup
place a nation's own players cannot fill is the game's to fill with a generated player at the nation's strength, as in
hockey; a nation with no NRL players is a minnow at the baseline, 45. Since 2026-11-09 a nation whose NRL players hold
less than half the matchday 17 fields no team (`fieldedNations`): the first six play, while Papua New Guinea, the Cook
Islands and every nation with no NRL player stay neutral. England, Scotland and Wales play as themselves;
Ireland is the whole island, so Northern Ireland's shape starts in Ireland's empire.

## The lineup

The matchday 17 (`LINEUP_PLANS['rugby-league']`): fullback, two wings, two centres, the five-eighth and halfback, two
props and a hooker, two second-rowers and a lock, and an interchange bench of a utility hooker, two props and a lock.
Of each position's places, the best-rated players start (`onField`); the rest are the bench, who play about half a
game. Strength is the mean effective rating of the seventeen, as in the other sports.

Positions group into units: the outside backs (fullback, wing, centre), the halves, the hooker and the pack. A move
within a unit costs 4 points; a common move between units costs 8 (a centre to the second row, a half to fullback or
hooker, a hooker to the halves or into the pack, a forward to hooker); anything else, a winger in the front row, say,
costs 15. A position a player has started in counts as his own.

## The match model

`src/sports/rugbyLeague.js`, in sixteen five-minute slices, so the score can decide how each is played.

- **Ratings.** A side's **attack** is 35% its outside backs, 30% its halves and 35% its forwards; its **defence** 25%,
  15% and 60%. The forwards count the bench at half weight. Each try rate is `3.75·exp(1.4·tanh(0.14·edge/1.4))` in
  eighty minutes, the edge being its attack minus the opposing defence, saturating as football's does.
- **Scoring.** A try is four points, converted (two more) 75.5% of the time, the NRL's rate: Rugby League 26's overall
  says nothing of a goal-kicker's boot. Penalty goals come at 0.39 a side between equals. Slightly more is scored after
  half-time (×1.03, before it ×0.97): 48.5% of the points come before the break, as in the NRL.
- **Score effects.** From the 60th minute a side up to a converted try behind chases (tries ×1.15) and the leader
  protects (×0.92); both take the two points of a penalty when the margin is −2 to +4 (×1.8), and a side further behind
  runs them (×0.5). At any time a side twenty or more up eases off (×0.92). In the last ten minutes a side kicks for a
  field goal by its lead: level 30% a slice, six up 14% (to lead by more than a converted try), twelve up 6%, one down
  10%.
- **Golden point.** Level after eighty, five-minute halves of extra time in which the first score wins: 0.62 scores a
  side a half between equals (scaled by the root of its try rate), 62% of them field goals, 12% penalty goals and 26%
  tries (with no conversion: the try has won). The NRL calls a regular-season game still level after ten minutes a
  draw; a campaign needs a winner, so golden point runs on as in the finals, and after four halves a last field goal
  decides it, close to a coin flip (`logistic(0.04·difference)`).
- **Form.** One match-day draw in log rate moves both sides' try rates apart: 0.2 at Balanced, growing with the square
  of the drama, as football's does. Tactics and Upsets act through the same effective-strength offset as the other sports.
- **Home advantage.** The option moves the two try rates 0.16 apart in log: home sides win 57.2% of an NRL season's
  games (real 53.6–58.9%), and equal sides 58%, about 3.5 points a game.
- **Who scores.** Tries by position from the NRL's 2023–2025 tries, by the scorer's place in the team list: wingers 15
  (as a share in percent each), fullback 10, centres 8.3, five-eighth 6.7, second-rowers 5, halfback 4.8, hooker 3.1,
  props 1.85, lock 2, each bench player 3, times the rating above 60. Penalty goals go to the starter who kicked the most
  goals in 2025 (else the halfback, five-eighth or fullback), field goals to the halfback.

**Rating points count for more here than in any other sport.** Rugby League 26 rates the 17 clubs within 3.3 points of
each other, but the NRL's standings spread as widely as the NFL's, so the scale (0.14 per point) is steep: at Balanced a
5-point edge between 55-rated sides wins 94% of the time (ice hockey 76%, football 71%), and the best club beats the
worst about 91%. Nations, whose gaps are far wider, are rarely upset; Wild and the Upsets option are there for that.

Measured over 40 seeded seasons of the 17 clubs, 24 games each with byes (`npm run simulation:realism`), against the
league's five regular seasons 2021–2025, computed on 2026-11-08 from every game in NRL.com's draw and match centre
(`scripts/lib/nrl-seasons.mjs`):

| Measure | Model | NRL |
| --- | --- | --- |
| Points a team | 22.8 | 21.6–23.5 |
| Tries a team | 3.99 | 3.80–4.11 |
| Conversions made | 75.7% | 73.8–76.6% |
| Penalty goals a team | 0.38 | 0.38–0.44 |
| Field goals a game | 0.11 | 0.08–0.20 |
| Golden point | 3.1% | 1.6–4.9% |
| Mean margin | 15.5 | 14.6–18.3 |
| Won by 1 / by 1–6 / by 1–12 | 3.9% / 27.5% / 49.6% | 3.4–6.9% / 21.9–33.8% / 39.1–53.9% |
| Won by 13 or more / 25 or more | 50.4% / 19.5% | 45.6–60.9% / 18.1–30.2% |
| Held scoreless / 40 or more (a team game) | 2.3% / 10.7% | 1.0–3.6% / 7.8–12.8% |
| First-half points | 48.5% | 48.1–50.1% |
| Win% spread of the standings | 0.162 | 0.154–0.223 |
| Best and worst records (wins of 24) | 19.6, 5.5 | 18–21, 3–6 |
| Tries: wings / centres / fullback / second row / bench | 29.6 / 15.8 / 11.1 / 10.9 / 11.7% | 29.2–30.0 / 15.5–18.4 / 8.6–11.4 / 10.4–11.1 / 11.1–13.4% |

2021, played in hubs, was the NRL's most lopsided season (mean margin 18.3, 30% of games won by 25 or more); the model
sits nearer 2023–2025's. The seasons also had 2-point field goals from 40 metres (one to five a season), which the model
leaves out.

## The clock

Minutes, as in football ("38'"), with half-time at 40 and a tick every twenty on the win chart. Golden point's scores
read in minutes past eighty, the chart's axis "GP". A game decided in golden point reads "in golden point", short "GP";
the feed's live line says "golden point" past full time, and its rows "Golden point — PEN 18–18 MEL".

## Live win probability

`src/engine/winProbability.js`, kind `tries`, built from the model's own slices as hockey's: the remaining slices are
played out backwards from each margin, each side's points in a slice the exact mix of its tries (four or six), penalty
goals and field goal at the means `sliceMeans` gives, the slice in progress scaled by the time it has left, then golden
point (`goldenRate`, `deciderOdds`). Form is integrated with seven-point Gauss–Hermite quadrature. At kick-off the chart
is within half a point of the fixture's simulated odds; a match's tables build in about 10 ms.

## Interface

- **Setup.** A sport card, "Nations · 17 NRL clubs". Clubs have one theatre, **NRL · Australia and New Zealand**. The
  note under Season names Rugby League 26 and the 2025 season, and how nations are picked.
- **Squad.** The field: the half the side attacks, the posts at the top, the pack up front, the halves, centres and
  wings across it and the fullback at the back, and the interchange bench below halfway. Groups read Outside backs,
  Halves, Front row and Back row; the profile Backs, Halves and Forwards. A player's source reads "Rugby League 26".
- **Feed.** "TRY — Reece Walsh (BRI)", "PENALTY GOAL — Nathan Cleary (PEN)", "FIELD GOAL — …": a conversion is the try's,
  so a try event is four or six points. The scorer line ranks by points scored: "To'o 2 tries · Cleary 2 PG, 1 FG".
- **Crests and colours.** All 17 from Wikipedia (the NRL is Wikidata's Q1140630; the Dolphins' and Manly's items are named
  in `scripts/data/club-logos.json`, as Wikidata labels them "The Dolphins" and "Manly-Warringah"). Four colours are
  corrected: the Storm's purple, the Raiders' lime, the Rabbitohs' green and the Bulldogs' blue.

## Earlier seasons

Status: built 2026-11-08: **2008**, the NRL's sixteen clubs as Rugby League 2: World Cup Edition (Sidhe,
PlayStation 2, 2008) rates them, on a map of their own day (`nrl2008`). Clubs only: its nations are checked but not fielded
(**Nations**, below). The game rates attributes, not players: the overall is ours, a documented conversion, as the Tecmo
seasons' is ([american-football.md](american-football.md#tecmo-seasons)), then shifted club by club by the game's own team
ratings. The user chose this on 2026-11-08 ("Build 2008", then "Adjust by team ratings"). The seasons from 2009 to 2024,
which no game rated, are computed from NRL.com's match stats ([Computed seasons](#computed-seasons-20092024), built
2026-11-09), and so are 1998 to 2007, the NRL's first ten seasons, with the clubs of their day
([Computed seasons, 1998–2007](#computed-seasons-19982007), built 2026-11-13): every NRL season from 1998 is playable.

- **The database.** `RLDatabase.xml`, the game's own database, extracted from its data pak by Wouldubeinta and posted on
  rugbyleaguemods.net (thread "Data pak File", post 570, 30 March 2012, attachment 56), read from the Wayback Machine's raw
  copy. The zip is pinned by SHA-256 in `scripts/data/rugby-league-seasons-sources.json` and the XML inside it in
  `scripts/data/rugby-league-seasons.json`; both stay in the ignored `data-src/rugby-league-seasons/`. It holds 1,180
  players and 69 teams; the sixteen NRL clubs list 24 to 33 players each, 462 in all. A team's list names a player by his
  place in the file: six entries an editor copied keep the copied entry's `db_index` (Chaz I'Anson's is Braith Anasta's),
  so only the place tells them apart. A `\x20` joins a first name's words ("Jeremy\x20J Smith"); one name has an encoding
  slip ("Taufa垒ao", mended to Taufa'ao by `nameFixes`).
- **Positions** are the game's `primary_position`, in its own order, read off the 2008 clubs: 0 fullback (Slater,
  Minichiello), 1 halfback (Cronk, Kimmorley), 2–3 wing, 4–5 centre, 6 five-eighth (Lockyer, Marshall, Thurston), 7 and 9
  prop, 8 hooker (Cameron Smith, Buderus), 10–11 second row, 12 lock. One position each: the file's
  `position_categories` are not positions (Cameron Smith's first is a five-eighth's), so they are not read.
- **Who is kept.** A club's player is kept when the Rugby League Project (rugbyleagueproject.org; its robots.txt allows the
  season, competition and player pages read, one request every three seconds) lists him at that club in 2008: its
  first-grade page (premiership, finals and the World Club Challenge) or its National Youth Competition one. Names fold
  case, accents, spaces, hyphens and apostrophes (Nu'uausala, Seu Seu); a name RLP spells otherwise is his only by the same
  surname and initial, or the same first name and a surname a letter off, when one listed player fits, and with RLP's date
  of birth on his player page like the database's (the same, or one field off in the same year). Ten are named so, each
  page pinned, and play under RLP's spelling, as the Tecmo seasons take nflverse's (Danny Williams for the database's Dan,
  Daryl Millard for Darryl, Micheal Luck, David Fa'alogo, Aidan Guerra for Adrian …; the snapshot's `spelled` keeps the
  database's).
  **414 of the 462 are kept**, 22 to 30 a club. The 48 left out, each with its reason in
  `docs/design/rugby-league-seasons-audit.json`: 1 on the wrong club (Luke Harlen, a Cowboy in 2008, listed at the Wests
  Tigers), 1 a near name with another birth date (Joel Rapana, RLP's Jordan Rapana born 1989), 12 who played first grade
  in 2007 but not in 2008 (11 for the same club: Craig Frawley, George Rose …), and 34 with no first-grade or youth game for
  any NRL club in 2007 or 2008 (Hutch Maiava, Ben MacDougall …), not shown to be real players of the club.
  No duplicates: no RLP player is named twice.
- **The overall is ours.** Twelve attributes, 1 to 10: fitness, speed, acceleration, aggressiveness, agility, break
  tackle, tackle, pass, offload, general kick, goal kick and catch. A player's score at his position is the weighted mean
  of the attributes its job asks for (`WEIGHTS`, per cent; a reason for each weight in `REASONS`, both in
  `scripts/lib/rugby-league-seasons.mjs` and the snapshot). Three values are the database's defaults, not ratings —
  fitness 7 (336 of the 462), general kick 4 (303) and goal kick 3 (350) — and a default (or an omitted 0) never counts:
  its weight goes to the player's other attributes. Goal-kicking counts nowhere (the match model converts every try at
  the NRL's rate, and kicking goals is no position's job); general kicking only for the halves.

  | | Weights (per cent) | Why |
  | --- | --- | --- |
  | FB | catch 20, speed 15, agility 15, break tackle 15, acceleration 10, tackle 10, fitness 10, pass 5 | fields the kicks, returns them into contact, the last line |
  | WG | speed 25, catch 20, break tackle 15, tackle 15, acceleration 10, agility 10, fitness 5 | finishes on the edge, takes the bombs, defends the corner |
  | CE | break tackle 20, tackle 20, speed 10, acceleration 10, agility 10, pass 10, catch 10, offload 5, fitness 5 | strike runner and edge defender, the winger's provider |
  | FE | pass 25, kick 15, agility 15, speed 10, acceleration 10, tackle 10, break tackle 5, catch 5, fitness 5 | second receiver, second kicker, a running game |
  | HB | pass 30, kick 30, agility 10, acceleration 10, fitness 10, tackle 5, catch 5 | runs the attack and kicks in general play |
  | HK | pass 30, tackle 25, fitness 15, acceleration 10, agility 10, catch 5, aggressiveness 5 | passes from every ruck, tackles most |
  | PR | break tackle 25, tackle 25, offload 15, aggressiveness 15, fitness 10, acceleration 5, catch 5 | the hit-up and the middle defence |
  | SR | tackle 25, break tackle 20, speed 10, offload 10, aggressiveness 10, fitness 10, acceleration 5, agility 5, catch 5 | edge runner and edge defender |
  | LK | tackle 30, break tackle 15, pass 15, fitness 15, offload 10, aggressiveness 10, catch 5 | leads the middle defence, links forwards and backs |

  Then each position's scores among the 2008 clubs' kept players are ranked (mid-rank percentiles, ties sharing one) and
  read off Rugby League 26's overalls at that position (the built-in snapshot, `scripts/data/rugby-league-26.json`, by each
  player's first position), as many of each 2025 club's best there as the 2008 clubs carry per club (fullbacks 1.44 a
  club, props 5.5 …), so a 2008 backup meets 2025's backups; by linear interpolation, rounded and held to 1–99: the
  player's **attribute overall**. The rule is monotonic and keeps the built-in season's spread at each position, the
  match model's tuning: the 2008 players run 68–93 (median 81). The locks run 82–92 because Rugby League 26 lists only its
  best middle forwards as locks. The snapshot holds the weights, the defaults, every position's 2025 reference and 2008
  scores, so every overall is recomputed from it alone (the test does).
- **The club shift** (the user's choice, 2026-11-08: "Adjust by team ratings"). The attribute overalls leave the clubs
  80.8–84.3 in an order unlike 2008's (**The real 2008**, below), while the database rates each side too, by five parts
  from 1 to 10 — willingness to attack, attack, defence, flair and support — with no overall. Its all-star sides (the NRL
  and Super League dream teams, and Sidhe's own) have 10 in all five, so all five measure a side, and a club's **team
  rating** is their equal-weight mean, a rule fixed before any result was read: no part is chosen or weighted by how it
  tracks 2008 (the parts had been compared with the 2008 ladder before, which is why none is). The sixteen team ratings
  are ranked (mid-rank percentiles, ties sharing one) and read off the built-in 2025 NRL clubs' strengths (81.8–85.1,
  what the match model was tuned on) by linear interpolation: each club's **target**. Every player of the club then moves
  by the one whole number (the **shift**) that brings its lineup's strength closest to the target (of two as close, the
  smaller move), held to 1–99, so a club's players keep their order. Real results only check it.

  | Club | Team rating (W/A/D/F/S) | Target | Shift | Strength |
  | --- | --- | --- | --- | --- |
  | Sydney Roosters | 8.0 (8/9/8/8/7) | 85.08 | +3 | 82.5 → 85.5 |
  | Brisbane Broncos | 7.8 (8/9/7/6/9) | 84.28 | +1 | 82.8 → 83.8 |
  | Wests Tigers | 7.8 (9/8/6/8/8) | 84.28 | 0 | 84.1 |
  | Manly Warringah Sea Eagles | 7.6 (7/8/9/7/7) | 83.87 | +1 | 82.9 → 83.9 |
  | Melbourne Storm | 7.6 (8/8/9/8/5) | 83.87 | 0 | 83.8 |
  | North Queensland Cowboys | 7.6 (9/7/6/8/8) | 83.87 | 0 | 83.8 |
  | Gold Coast Titans | 7.2 (8/8/7/7/6) | 83.32 | +1 | 82.4 → 83.4 |
  | New Zealand Warriors | 7.0 (7/5/8/7/8) | 83.20 | +2 | 81.2 → 83.2 |
  | Bulldogs | 6.8 (7/7/6/6/8) | 83.20 | +1 | 81.9 → 82.9 |
  | Cronulla-Sutherland Sharks | 6.6 (7/6/8/5/7) | 82.76 | +2 | 80.8 → 82.8 |
  | Newcastle Knights | 6.6 (6/6/7/6/8) | 82.76 | +1 | 81.5 → 82.5 |
  | Penrith Panthers | 6.6 (7/7/7/6/6) | 82.76 | −2 | 84.3 → 82.3 |
  | St. George Illawarra Dragons | 6.6 (6/7/7/6/7) | 82.76 | 0 | 83.1 |
  | Parramatta Eels | 6.4 (7/6/6/7/6) | 82.13 | 0 | 81.8 |
  | Canberra Raiders | 6.0 (6/7/6/5/6) | 81.83 | +1 | 81.3 → 82.3 |
  | South Sydney Rabbitohs | 5.6 (6/5/5/5/7) | 81.80 | −1 | 82.6 → 81.6 |

  The clubs now run 81.6–85.5 and the players 67–94 (median 81). Each player's row in the snapshot ends with his
  attribute overall and his club's shift; the season file holds the sum. `source.conversion` states both steps.
- **The star value.** Each player also has a "star" value, 0 to 100 (Lockyer 100, Benji Marshall 98), which the game
  does not explain. It is a cross-check only: it ranks with the overall (Spearman 0.50; 0.31 for hookers to 0.78 for
  fullbacks), and picks out the clubs' 76 players of 2008's Origin and Australia and New Zealand Tests a little better
  (area under the curve 0.753 against the overall's 0.734; any 2008 Test, 0.656 against 0.616). Nothing reads it.
- **Clubs of their day.** The sixteen of 2008, no Dolphins. Each keeps today's id, code and colour, and wears its crest
  of the day ([period-marks.md](period-marks.md)), except the **Bulldogs**, as the club was named from 2000 to 2009
  (`nrl-bulldogs`, code BUL, the game's own; no crest of today, the cartoon bulldog head of 1998-2009 as its crest of the
  day). Grounds are
  RLP's 2008 home venues: Olympic Park Stadium (the Storm, until 2010), Dairy Farmers Stadium (the Cowboys, until 2020),
  Parramatta Stadium and the Sydney Football Stadium of 1988 (both rebuilt since, on their sites); a ground still played at
  keeps its present name. Clubs that shared a ground grow from where they trained: the Bulldogs moved theirs to Sydney
  Olympic Park, beside their ground, early in 2008 (the territory "Homebush"); the Rabbitohs from Redfern Oval, their
  training ground from 1988 to 2023 (it was rebuilt during 2008; where they trained meanwhile is not recorded); the Wests
  Tigers from Concord Oval, as today (they played at Accor Stadium, Campbelltown and Leichhardt).
- **The map** `nrl2008` (`node scripts/build-club-maps.mjs --league=nrl`, from the manifest's `teams` and `maps`) follows
  today's rule: a club holds its own state, territory or region, New South Wales (ten clubs) and Queensland (three) are
  split between theirs, every other state and region stays empty. With no Dolphins the Broncos hold Redcliffe. The
  Bulldogs at Olympic Park share the City of Parramatta with the Eels, and the Rabbitohs at Redfern the City of Sydney with
  the Roosters: `maxGapKm` 0.5 cuts each council between its two (today's map is byte for byte the same with it). Since
  2026-11-09 it serves 2009 too, whose clubs and grounds are 2008's: its `seasons` and version changed, not its shapes.
- **Nations: not fielded.** The database's ten 2008 World Cup squads (Australia, New Zealand, England, France, Papua New
  Guinea, Fiji, Samoa, Tonga, Scotland and Ireland) pass the same check against RLP's World Cup squads and 2008 Tests:
  188 players kept, 11 (Fiji) to 25 (Australia) a nation. But they mix the NRL's players with Super League's, and the
  database rates Super League's on a kinder scale: its players score higher at seven positions of nine (centres 7.09
  against the NRL's 6.58, props 6.92 against 6.45; tackling 7.27 against 6.69, break tackle 6.83 against 6.09, the
  snapshot's `scales`), though the NRL was the stronger league. Read off the clubs' scale, England (all Super League)
  would be the strongest nation, 89 to Australia's 87 (Australia beat England 52–4 at the World Cup); limited to NRL
  players, as the built-in nations are, England and France would have none: minnows at the baseline, below Scotland
  (three NRL players, 51) and Ireland (one, 47). Neither is 2008, so the season has clubs only (`nations: false`), and a
  nations game plays the built-in 2025 nations. The squads stay in the snapshot; the audit shows both readings. The
  database's Great Britain, Wales, Cook Islands, Lebanon, Russia, Malta, South Africa and United States squads look
  carried over from the 2005 edition and are not read.
- **The real 2008**, from RLP's results (192 regular-season games): Melbourne the minor premiers on points difference
  (17–7, +302) from Manly and Cronulla (17–7); the Cowboys and Bulldogs 5–19; one draw (Brisbane and Penrith). 40 seeded
  seasons of the 2008 clubs, 24 games each at a neutral venue (`node scripts/build-rugby-league-seasons.mjs --realism`),
  at their attribute overalls and with the club shift:

  | Measure | Attribute overalls | Shifted (played) | NRL 2008 |
  | --- | --- | --- | --- |
  | Points a team (SD) | 22.8 (12.8) | 22.9 (12.8) | 21.5 (11.4) |
  | Mean margin | 15.9 | 15.9 | 14.7 |
  | Won by 1 / 1–6 / 1–12 | 3.9 / 27.0 / 48.9% | 3.8 / 26.9 / 48.6% | 6.8 / 29.7 / 47.4% |
  | Won by 13+ / 25+ | 51.1 / 20.8% | 51.4 / 20.5% | 52.1 / 16.7% |
  | Held scoreless / 40 or more | 2.4 / 11.3% | 2.2 / 11.1% | 1.8 / 6.8% |
  | Win% spread | 0.171 | 0.162 | 0.153 |
  | Best and worst records (wins of 24) | 18.7, 4.4 | 19.1, 5.1 | 17, 5 |
  | Rank correlation of the model's wins with 2008's | −0.12 | 0.33 | |

  The scoring is the built-in season's, a little above 2008's, and the spread is 2008's, before the shift and after it.
  The order is what the shift changes. At the attribute overalls the model's strongest clubs were the Wests Tigers,
  Melbourne and the Cowboys (16.8–17.3 wins) and its weakest Cronulla (6.2), whose real record was 17–7: the player
  attributes do not order the 2008 clubs, nor does the star value, which suggests the 2008 edition rerated its teams and
  kept older editions' player attributes. Shifted, the Roosters lead (18.6 wins; real 15), Melbourne and Manly are second
  and fourth (15.6 and 15.0; real 17 each) and the Rabbitohs last (6.7; real 8); the clubs' strengths rank with the real
  wins at 0.36 (−0.16 before). The team rating is the database's view of each side, not 2008's: the Cowboys (14.4 wins;
  real 5) and the Bulldogs (12.8; real 5) still play above their record, and Cronulla (11.0; real 17) below it.
- **Files.** `scripts/sync-rugby-league-seasons.mjs` (`--fetch`, `--pin`, `--check`) writes
  `scripts/data/rugby-league-seasons/nrl-2008.json` (the kept players with their attributes, score, attribute overall and
  club shift, each club's team rating, target and shift, each club's and nation's RLP evidence, the left-out with their
  reasons, the conversion and the real season);
  `scripts/build-rugby-league-seasons.mjs` (`--check`, `--realism`) writes `public/rugby-league/nrl-2008.json` (kind
  `nrl`, `source.conversion` required, as Tecmo's), `src/data/rugbyLeagueSeasons.js` and the audit; rules in
  `scripts/lib/rugby-league-seasons.mjs`. Tests: `scripts/rugby-league-seasons.test.mjs`.
- **Limits.** Every kicker converts at the NRL's rate, and with no goal tally a 2008 side's goals go to its halfback (the
  database's own `goal_kicker` is not read). A club the database leaves short of a position plays someone out of it
  (Manly has no five-eighth: Brett Stewart plays there, Steve Matai at fullback). Squad players show no source line.
  Rugby League 2's first edition (2006) and the Rugby League Live games keep their ratings inside the games: 2008 is the
  only earlier season a game rates (Rugby League Live 3 and 4's databases, for 2015 and 2017, survive only as a
  cross-check of the computed seasons, below).

## Computed seasons, 2009–2024

Status: built 2026-11-09. Sixteen NRL seasons that no game rated, **2009 to 2024**, computed from what NRL.com's match
centre recorded of them, each labelled "Computed from NRL.com match stats" and each on a map of its day. Clubs only, as
2008. The user asked on 2026-11-09 to cover every sport's missing years ("In some sports there are individual rankings
you can use to make ratings"); the research pass planned the method, and these decisions were taken that day:

- one method for all sixteen seasons; Rugby League Live 3 (2015) and Live 4 (2017) only as a cross-check;
- each club moved by its season's Simple Rating System (real margins, adjusted for the opponents), read off the built-in
  clubs' strengths: the season's results set each club's level, while its players keep their order;
- the venue rules R1–R3 (three new maps, below); clubs only; nrl-2008 kept as shipped; nothing before 2008 (1998–2007
  followed on 2026-11-13, [below](#computed-seasons-19982007)).

### The source

NRL.com's match centre, the same endpoints the built-in season reads (`scripts/sync-nrl.mjs`): the draw of every round
(`https://www.nrl.com/draw/data?competition=111&season=<year>&round=<n>`) and each finished game's reply (its
`matchCentreUrl` + `data`): team lists (each player's place and jersey) and every player's stats. NRL.com keeps them from
1998, with the eleven stats counted here from 2003 and NRL Fantasy's own points from 2013.

- **Terms.** robots.txt (read 2026-11-09): `User-agent: *` with no Disallow. The terms of use redirect to an account
  sign-in, which was not followed, so they were not read; the replies state no licence. The data are the NRL's: each
  season names NRL.com as its `source.provider` and the setup note says where the ratings come from. The manifest
  records both sources' terms (`nrlcom.terms`, `rlpTerms`).
- **Download.** Every premiership game of 2007 to 2026 (each computed season and the two either side): 4,036 games and
  613 draw pages, into the ignored `data-src/rugby-league-seasons/nrlcom/` (`draw/111-<season>[-<round>].json`,
  `match/nrl-premiership_<season>_<round>_<game>.json`), each reply kept as received. 2,606 requests on 2026-11-09, one
  at a time and at least 1.2 seconds apart, fetched the games of 2009–2013, 2018–2023 and 2026, most of 2007, and the
  draws of 2007 and 2026 (every reply 200; `FETCH-LOG.tsv` beside them). The rest the research pass had downloaded the
  same day by the same endpoints (the games of 2008, 2014–2017, 2024 and 2025, the draws of 2008–2025), copied after
  checking each against its SHA-256 list (`SOURCE.txt`). `node scripts/sync-rugby-league-seasons.mjs --fetch` downloads
  whatever is missing.
- **Pins.** A reply carries stamps and image links that change between requests, and old replies name grounds by
  today's names (the 2009 Cowboys at "1300SMILES Stadium"), so a pin covers what is read, as JSON: a season's rounds
  (`nrlcom/<season>`) and each round's finished games in its draw with their team lists and stats
  (`nrlcom/<season>/<round>`), 613 pins in `scripts/data/rugby-league-seasons-sources.json`, one input a line. Grounds
  come from the manifest, never from the replies.
- **The Rugby League Project** (rugbyleagueproject.org, robots.txt read 2026-11-09: no query strings, no
  `/matches/Custom` or `/matches/s|m|p|r/`), one request every three seconds, only for the players NRL.com never shows
  starting (below): his club's season page (`seasons/nrl-<year>/<club>/players.html`) for his RLP id, then his player
  page for its "Position(s)". 370 requests, every one answered: 354 pages, of which the sync now reads and pins 352 by
  the part read (the other two, Parramatta's 2012 list and Pat O'Hanlon's page, served his 2012 id before it was
  aliased, below), and each season's summary page, whose club links gave the manifest's `rlp` slugs. A player page's
  pin (shared with 2008's) now covers his name, date of birth and positions, so 2008's 20 player pins changed; its
  snapshot did not.
- **One player, two ids.** NRL.com lists the Titans' Ben Nakubuwai under two ids in 2017 (503511 in round 24, 100007912
  in round 26); the Rugby League Project's 2017 Titans list has him once. It also gives two players a new id for one
  season: Parramatta's Pat O'Hanlon is 500987 in 2011 and 2013 but 500233 in 2012, South Sydney's Matt King 501172 in
  2012 but 501830 in 2013 (RLP's lists have each under one id), which lost each his season before and Pat O'Hanlon his
  seasons either side. `nrlcom.aliases` in the manifest plays each later id as the first, and the sync stops on any
  other name a club lists under two ids in a season, or under another id in the season either side when neither id
  plays in the other's season.

### The method

`scripts/lib/rugby-league-seasons.mjs` ("the computed seasons"), step by step, as each season's `source.conversion`
states it.

1. **Players.** Everyone NRL.com lists taking the field in a premiership game of the season, regular season and finals.
   A player listed at a position started there (`tookField`); one named off the field at kick-off (`Interchange`, the
   18th man's `Replacement`, the 19th's `Reserve`) played only if NRL.com gives him minutes or any counted stat: an
   unused 18th man has neither. Minutes are missing for some bench players (344 in 2013, 334 of them with stats) and for
   both sides of one 2017 game, so the stats decide there. His club is the one he played most games for; of two as many,
   the one he played for last.
2. **Position.** The position he started at most that season, by the team lists, whatever his jersey: the lists give
   the place at kick-off (a starting prop may wear 15; in the 2022 qualifying final the Panthers' number 9, Apisai
   Koroisau, is listed on the interchange and their 14, Mitch Kenny, at hooker). Of two as often, the one he started at
   last. A player who never started takes his most-started position in the seasons either side, then two
   either side (NRL.com's player ids hold across seasons), then the first of his career positions on the Rugby League
   Project, matched by name at his club that season (the whole name, or the surname and initial when one player fits;
   "Utility Forward" names no position); else he is left out, and the audit says why.
3. **Value: core points a club game.** NRL Fantasy's points for the eleven stats NRL.com has kept since 2003 (`CORE`;
   least squares on NRL.com's own fantasy totals, 7,344 player-games of 2025, recovers each weight). Goals and field
   goals count nowhere, as in 2008's overall: the match model converts every try at the NRL's rate, whoever kicks.

   | Stat | Points | Why |
   | --- | --- | --- |
   | Try | 8 | what the game is played for |
   | Try assist | 5 | the last pass or kick before a try |
   | Line break | 4 | a run through the defensive line |
   | Line-break assist | 2 | the pass that puts a runner through |
   | Tackle | 1 | defence, most of the middle forwards' work |
   | Missed tackle | −2 | lets the attack through |
   | Tackle break | 2 | beating a tackler in contact |
   | Offload | 4 | keeps the ball alive through the tackle |
   | Error | −2 | hands the ball over |
   | Run metres | 1 every 10 | the forwards' and outside backs' work |
   | Kick metres | 1 every 30 | territory, the halves' and fullbacks' work |

   NRL.com's replies of 2013–2015 record no errors at all (`errors` is 0 for every player of every game), only handling
   errors (`handlingErrors`, about 17 a game against some 20 errors a game in the seasons around them): in a game whose
   reply gives no player an error, a player's handling errors count as his errors (`matchRecord`), so all eleven stats
   count in every season. The replies' `goals` is empty in every season; a player's goals are his conversions and
   penalty goals, as `scripts/sync-nrl.mjs` counts them.

   A player's value is his season's core points over his club's games that season (the mean of his clubs' where he
   played for two), with the season before at half weight when he played in it: (P + ½·P₋₁) / (G + ½·G₋₁). Counting club
   games, not his own, rewards the player who was there every week; the season before softens an injury year. Points are
   added in thirtieths, so they are exact; the value keeps six decimals.
4. **Overall.** The value's mid-rank percentile among the season's players at his position (ties share one), read off
   Rugby League 26's overalls at that position by linear interpolation, as many of each 2025 club's best there as the
   season's clubs carry per club (the quota, 2008's rule: a 2016 backup meets 2025's backups), rounded and held to 1–99.
5. **Club shift.** The season's results set each club's level, while its players keep their order. Each club's Simple
   Rating System is fitted to its regular season by least squares (margin = home rating − away rating + one home edge,
   the ratings summing to zero, solved exactly; `srsOf`), so a club that lost to strong sides by little rates above one
   that beat weak sides by little. The sixteen (or seventeen) ratings are ranked (mid-rank percentiles) and read off the
   built-in 2025 clubs' strengths (81.8–85.1): each club's target. Every player of the club then moves by the one whole
   number that brings its matchday 17's strength closest to the target (of two as close, the smaller move), held to
   1–99: 2008's shift, with the season's own margins where 2008 used the game's team rating. Margins, not ladder points:
   the 2010 Storm, stripped of their points for salary-cap breaches, rate by their play, as do the 2016 Eels, docked 12.

The snapshot `scripts/data/rugby-league-seasons/nrl-<year>.json` holds the weights with their reasons, every player's
summed stats for the season and the season before, his clubs and games, value, overall and shift, each club's games,
SRS, target and shift, the quota and reference at each position, the players left out, and the regular season's
results, so the test recomputes every overall and every shift from it alone.

### The seasons

| Season | Games | Players | Placed by: season / ±1 / ±2 / RLP | Left out | Clubs, shifted | Shifts | Home edge | Clubs against wins: stats → shifted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2009 | 201 | 449 | 398 / 30 / 11 / 10 | 4 | 81.7–85.2 | −2 to +2 | 3.8 | 0.48 → 0.72 |
| 2010 | 201 | 448 | 395 / 31 / 6 / 16 | 5 | 81.5–85.1 | −2 to +2 | 4.3 | 0.06 → 0.82 |
| 2011 | 201 | 465 | 417 / 32 / 9 / 7 | 3 | 81.4–84.9 | −1 to +2 | 3.2 | 0.55 → 0.92 |
| 2012 | 201 | 436 | 388 / 32 / 6 / 10 | 2 | 81.5–84.9 | −1 to +1 | 1.8 | 0.45 → 0.91 |
| 2013 | 201 | 457 | 400 / 32 / 11 / 14 | 4 | 81.4–85.5 | −1 to +2 | 4.1 | 0.59 → 0.93 |
| 2014 | 201 | 461 | 404 / 30 / 7 / 20 | 2 | 81.4–84.7 | −1 to +1 | 4.4 | 0.54 → 0.86 |
| 2015 | 201 | 445 | 381 / 29 / 19 / 16 | 2 | 81.4–85.2 | −1 to +1 | 3.5 | 0.78 → 0.88 |
| 2016 | 201 | 448 | 397 / 28 / 4 / 19 | 1 | 81.7–84.8 | −2 to +2 | 1.7 | 0.64 → 0.92 |
| 2017 | 201 | 440 | 379 / 33 / 11 / 17 | 3 | 81.5–84.8 | −1 to +1 | 0.3 | 0.57 → 0.86 |
| 2018 | 201 | 437 | 383 / 35 / 13 / 6 | 3 | 81.4–84.9 | −1 to +1 | 2.4 | 0.54 → 0.84 |
| 2019 | 201 | 451 | 398 / 36 / 9 / 8 | 1 | 81.9–84.7 | −2 to +1 | 3.3 | 0.44 → 0.87 |
| 2020 | 169 | 466 | 419 / 26 / 6 / 15 | 1 | 81.5–84.9 | −1 to +1 | 2.4 | 0.83 → 0.87 |
| 2021 | 201 | 494 | 437 / 27 / 11 / 19 | 0 | 82.2–84.7 | −1 to +1 | 1.1 | 0.89 → 0.93 |
| 2022 | 201 | 476 | 412 / 37 / 11 / 16 | 0 | 81.6–85.1 | −2 to +1 | 2.7 | 0.75 → 0.87 |
| 2023 | 213 | 500 | 445 / 30 / 6 / 19 | 2 | 81.8–84.8 | −1 to +1 | 2.0 | 0.67 → 0.88 |
| 2024 | 213 | 507 | 445 / 34 / 5 / 23 | 1 | 81.4–85.5 | −1 to +2 | 2.4 | 0.40 → 0.85 |

Home edge in points a game; the last column is the rank correlation of the clubs' strengths with their regular-season
wins, from the players' stats alone and after the shift (a check: the shift is fitted to margins, not wins). Every club
had 22 to 36 players and fields its matchday 17 from its own, each place from the place's own unit but one: the 2009
Wests Tigers had one hooker, Robbie Farah, so a centre, Dene Halatau, is their bench hooker. The players rate 66–95 as
played (overalls 67–93, median 79–80). The 34 left out are bench players of one to ten games: 22 whose Rugby League Project page gives no
position (some say only "Utility Forward"), 12 whom it lists under another name (Sione Kite is its John Kite). The
audit (`docs/design/rugby-league-seasons-audit.json`) names every one, every player RLP placed, each club's SRS and
shift, and the best-rated dozen.

**Calibration** (cross-checks only; nothing here sets a rating):

- **Against Rugby League 26.** The same method run on 2025 (its seasons either side, 2023–2026; the 30 players NRL.com
  never shows starting not looked up) against the game's ratings of the 2025 players: 449 players, Spearman 0.761 within
  position (Rugby League 26's positions), mean error 2.72 points; the value alone 0.765.
- **Against the games of 2015 and 2017.** Rugby League Live 3 and 4 rate players inside the games; their databases
  survive in Blobset-Tools' save editor on GitHub (Big Ant's data, no licence, so only read for this check), with the
  editor's own overall formulas. Matched once by name: 2015, 415 of 445 players, Spearman 0.70 within position (0.69 by
  the game's positions); 2017, 421 of 440, 0.74 (0.71). The two games agree with each other at 0.53 (the research
  pass's figure, 227 players): the computed ratings track each game better than the games track each other.
- **Year to year.** The same player at the same position in consecutive seasons: Spearman 0.68–0.82 within position
  (276–339 players a pair), a mean change of 2.4–2.9 points.
- **Realism.** 40 seeded seasons of each (`--realism`, 24 games at a neutral venue): the model's wins rank against the
  real season's at 0.73–0.94 (2008's: 0.32). Points a team 22.9–23.4 (real 19.6–23.4: the model is tuned on 2021–2025,
  and the 2010s scored less), mean margin 15.7–17.0 (real 12.8–18.3), win% spread 0.156–0.187 (real 0.124–0.226), best
  and worst records 18.9–20.1 and 4.0–5.7 wins of 24 (real 16–21.6 and 1–8).

**Spot checks against the record** (NRL.com's results; the grand finals from its finals games). The strongest club of
each computed season is its best by margin, its SRS (in 2016 level with North Queensland). That is the premier in 2010
(the Dragons), 2011 (Manly), 2012 (Melbourne), 2013 (the Roosters), 2014 (the Rabbitohs), 2017 (Melbourne), 2018 (the
Roosters), 2022 and 2023 (Penrith); in 2009, 2015, 2016, 2019, 2020 and 2021 it is the minor premier (the Dragons, the
Roosters, Melbourne three times, Penrith), the premiers second by margin (2009, 2019–2021) or fourth (2015, 2016); in
2024 the Roosters, ahead of Melbourne (minor premiers), Cronulla and Penrith (premiers) by margin. The 2009 Bulldogs, 18
wins but docked two points (the Rugby League Project's ladder), are third by margin, as are the 2010 Storm, 14 wins and
stripped of every point. The shift moves a club by whole points, about a point of strength, while neighbouring targets
lie a fifth of a point apart, so the strengths keep the margins' order only roughly: the 2009 Bulldogs play fifth
(83.8), the 2010 Storm fourth, the premiers of 2019 and 2020 third, North Queensland in 2015 fifth. The best-rated dozen
of each season (the audit's `best`) are the period's stars, with the box score's leanings: Cooper Cronk and Billy Slater
(2009–2012) and Cameron Smith (2011–2019) of Melbourne; Daly Cherry-Evans in every season from his first, 2011 (top
three in ten of them); Andrew Fifita (2013, 2016–2019); Greg Inglis and Sam Burgess (2013–2014); Jarryd Hayne (2011,
2014); James Tedesco (2017–2024); Payne Haas (2020–2023); Nathan Cleary (2020, 2021, 2023); Isaah Yeo (2018, 2021, 2023,
2024). Johnathan Thurston, the halfback of North Queensland's 2015 title, rates 90 that year, only twelfth: the box score
sees his kicking as metres and his goals not at all.

### Clubs and maps

The sixteen clubs of 2008 play every season to 2022, the Dolphins join in 2023 (seventeen). Every club keeps today's id,
name, code and colour (its crest is the one of its day: [period-marks.md](period-marks.md)), except the Bulldogs in
2009, still "Bulldogs" (`nrl-bulldogs`, BUL) as in 2008;
from 2010 they are Canterbury-Bankstown again. `teams` in `scripts/data/rugby-league-seasons.json` lists each season's
clubs with its NRL.com nickname (`list`), its Rugby League Project slug that season (`rlp`) and its ground; `nrlcom`
names each NRL.com team id's club, the same in every season. A club grows from its own ground, or from its training base
when it shares one (the Bulldogs and Rabbitohs at Accor Stadium, the Wests Tigers at three grounds), as today. Three
rules keep the maps few (decided 2026-11-09, as the research proposed):

- **R1, a ground being rebuilt stays the club's.** The built-in season does the same for the 2025 Panthers. The Eels
  played at ANZ Stadium in 2017 and 2018 while Parramatta Stadium was rebuilt, and the Roosters at the SCG from 2019
  until the new Allianz Stadium opened in August 2022: both keep their own sites.
- **R2, COVID-19 relocations are ignored:** the Warriors at Gosford in 2020 and 2021 and at Redcliffe in 2022, the Storm on
  the Sunshine Coast in 2020. Otherwise New Zealand and Victoria would be empty and the Storm a Queensland club.
- **R3, a rename on the same site does not split a map:** Dairy Farmers Stadium became 1300SMILES Stadium in 2013, the
  Sydney Football Stadium became Allianz Stadium in 2012, and the new Western Sydney Stadium (2019) stands on Parramatta
  Stadium's site. A ground no longer played at keeps its name of the era's first season; one still played at, its
  present name (NRL.com's replies use today's names for old grounds, so names come from the manifest).

| Map | Seasons | Grounds and bases that set it apart |
| --- | --- | --- |
| `nrl2008` | 2008, 2009 | the Bulldogs ("Bulldogs") train at Sydney Olympic Park, the "Homebush" territory; the Storm at Olympic Park Stadium |
| `nrl2010` (new) | 2010, 2011 | Canterbury-Bankstown, still at Sydney Olympic Park until October 2011; the Storm at AAMI Park from its opening |
| `nrl2012` (new) | 2012–2019 | the Bulldogs back at Belmore Sports Ground ("Canterbury"); the Cowboys at Dairy Farmers Stadium; the Roosters at the old stadium (Allianz Stadium) |
| `nrl2020` (new) | 2020–2022 | the Cowboys at the North Queensland Stadium (Queensland Country Bank Stadium); the Roosters' new stadium; the Eels at CommBank Stadium; the Rabbitohs still at Redfern Oval |
| `nrl` (today's) | 2023, 2024 | the Dolphins at Kayo Stadium, the Rabbitohs at the Heffron Centre (from April 2023): today's clubs and grounds |

`node scripts/build-club-maps.mjs --league=nrl` builds them (about 134 KB each). Its `nrlSpecs` checks that every season
of a map has the same clubs at the same grounds, and that the seasons of `nrl` are today's (`scripts/data/nrl-teams.json`),
which it builds once, as `nflSpecs` does for the NFL. Adding 2009 to `nrl2008` changed that map's `seasons` and version,
not its shapes; a saved 2008 campaign is moved club by club onto the new version, as any rebuilt map's is.

### Season quirks

- **2010.** The Storm were stripped of every competition point for salary-cap breaches: their ladder says 0, their play
  14 wins. The SRS reads margins, so they rate by their play.
- **2016.** The Eels were docked twelve points for the same: again the margins decide.
- **2020.** Twenty rounds (169 games, the COVID-19 season). A value is points a club game, so the short season rates on
  the same scale as the others; the season before still weighs half its games.
- **2021.** Played largely in Queensland hubs, the most lopsided season of the period (mean margin 18.3); the SRS takes it
  as it was.
- **2023–2024.** Seventeen clubs and a bye each round.

### Files

`scripts/sync-rugby-league-seasons.mjs` (`--fetch`, `--pin`, `--check`) writes `scripts/data/rugby-league-seasons/
nrl-2009.json` … `nrl-2024.json` (and `nrl-1998.json` … `nrl-2007.json`, below); `scripts/build-rugby-league-seasons.mjs` (`--check`, `--realism`) writes
`public/rugby-league/nrl-<year>.json` (kind `nrl`, `source.method` "computed" with `metric` and `conversion`, which the
loader requires), the listing `src/data/rugbyLeagueSeasons.js` and the audit; rules in
`scripts/lib/rugby-league-seasons.mjs`. The audit, `docs/design/rugby-league-seasons-audit.json`, gives each season's
players by how they were placed, the players left out and why, each club's SRS, target and shift, the best-rated players,
and the real season's figures.

### Limits

- **A computed rating is a box-score rating.** It sees what the match centre counts: a forward's tackles and metres
  more than a half's organising, a fullback's kick returns more than his positioning, and nothing of a kicker's goals.
  It agrees with Rugby League 26 at 0.76 within position on 2025, not exactly.
- **Injured stars rate low** in a season they missed much of: the value counts club games, and only the season before
  softens it.
- **The club order comes from the results** (decided 2026-11-09): unlike 2008's, a computed season's club strengths are
  fitted to the season they play, so a campaign's strongest clubs are the season's best by margin.
- **Positions are one each,** the most-started; a utility plays where he started most. A player NRL.com never shows
  starting in five seasons takes the Rugby League Project's first career position.
- **Every kicker converts at the NRL's rate:** the season file has no goal tally (the snapshot keeps each player's goals,
  his conversions and penalty goals, and his field goals, which nothing reads yet), so a computed side's penalty goals go
  to its halfback, as 2008's do.
- **Errors in 2013–2015 are handling errors:** NRL.com kept no other count of errors for those seasons (about 17 a game,
  against some 20 errors a game in the seasons around them). A season's players are ranked against each other, so what
  counts is who made them; 2014–2016 also read them in their season before.
- **No nations.** A nations game plays the built-in 2025 nations; the season's Tests (NRL.com competitions 133, 131 and
  195) could field them later.

## Computed seasons, 1998–2007

Status: built 2026-11-13. The NRL's first ten seasons, **1998 to 2007**, computed by the 2009–2024 method above from
what NRL.com's match centre kept of them, each labelled "Computed from NRL.com match stats" and each on a map of its day
with the clubs of its day: rugby league now has every NRL season from 1998 to 2025. The user asked on 2026-11-13 to
cover the year gaps in every sport; the session that took the rest of the gaps left this one for its own pass, as it
needed a new download and maps with clubs that no longer exist. The decisions of 2026-11-09 stand: one method, each club
moved by its season's Simple Rating System, clubs only, the ratings labelled computed.

### The source

NRL.com's match centre keeps every premiership game's team list and its players' stats from **1998**: the draw of every
round and each game's reply, as for 2009–2024. Its replies for 1997 and before give scores only (1997's first game,
checked 2026-11-13; the research pass's census of 1990, 1995 and 1997 found the same), and 1997 had two competitions, so
1998 is where NRL.com's record, and this pass, begins (the manifest's `nrlcom.from`): 1998 has no season before, and
1998 and 1999 no seasons two before.

- **Download.** The draws and games of 1998–2006 (2007's were cached), 2,073 requests on 2026-11-13 and 3 more for 1997's first game, every one through
  `scripts/lib/polite-fetch.mjs` (robots.txt read for its agent and Anthropic's crawlers, a generic user agent), one at a
  time, at least 1.2 seconds apart, no retries; every reply 200. They stay in the ignored `data-src/rugby-league-seasons/nrlcom/`
  under the sync's file names, with `FETCH-LOG.tsv`; pins as for 2009–2024 (what is read of each season's rounds and each
  round's games). 278 Rugby League Project pages (each season's summary for its clubs' slugs, 101 club lists and 168
  player pages for the players NRL.com never shows starting), one every three seconds at least, the same way.
- **Team ids.** NRL.com gives the clubs that are gone ids of their own (10002 the North Sydney Bears, 10029 Illawarra,
  10031 the Gold Coast Chargers, 10043 the Adelaide Rams, 10053 the Northern Eagles, 10059 Balmain, 10060 Western
  Suburbs; its filter lists number them otherwise, its draws and match replies agree), and files St. George's 1998 games
  under the St. George Illawarra Dragons' team (500022): the 1998 Dragons are an era of that club, as NRL.com has them.

### What NRL.com recorded

NRL.com did not keep all eleven counted stats from the start. A stat counts in a season when it appears in at least 95%
of the season's games with team lists (`RECORDED_SHARE`; from 2003 every stat appears in 96% or more, so 2003–2024
count all eleven, and nothing of 2009–2024 changes), less one the manifest marks as recorded in part:

| Season | Stats counted | Not counted |
| --- | --- | --- |
| 1998 | six: tries, line breaks, tackles, missed tackles, offloads, errors | try assists, line-break assists, tackle breaks, kick metres (only in a few finals); run metres, given in every game but only for some runs (1,108 of the regular season's 8,148 player-games, 136 metres a game against 2,443 in 1999: `nrlcom.partial`) |
| 1999–2001 | eight: those and try assists and run metres | line-break assists, tackle breaks, kick metres |
| 2002 | the same eight | line-break assists, in 92.6% of games at 3 a game (6 from 2003), and tackle breaks and kick metres |
| 2003 on | all eleven | |

A season's points count only its own stats, so its players are ranked on one footing. The season before counts at half
weight only when NRL.com recorded the same stats in it: a season before with fewer would pull down every player who
played in it against a newcomer. So **1998, 1999 and 2003 are their seasons alone** (no season before on NRL.com; 1998's
six against 1999's eight; 2002's eight against 2003's eleven), 2000–2002 blend with the season before on their eight, and
2004 on as 2009–2024. The thinner sets lose little: counted on the 2016 and 2024 snapshots' sums, a season's points a
club game from 1998's six stats rank its players against all eleven at Spearman 0.97 within position, and from the
eight of 1999–2002 at 0.99 (the research pass's 0.987–0.991). Each snapshot keeps the census behind this
(`conversion.stats`: the games each stat appears in, the season's and the season before's), and the season's
`source.metric` and conversion say what it counts.

### The clubs

| Season | Clubs |
| --- | --- |
| 1998 | twenty: the sixteen of 2007 but the Titans, the Wests Tigers and St. George Illawarra, with the Adelaide Rams, the Gold Coast Chargers, the Illawarra Steelers, the St. George Dragons, the North Sydney Bears, the Balmain Tigers and the Western Suburbs Magpies |
| 1999 | seventeen: Adelaide and the Chargers excluded, St. George and Illawarra joined as the St. George Illawarra Dragons |
| 2000, 2001 | fourteen: Balmain and Western Suburbs joined as the Wests Tigers, Manly and North Sydney as the Northern Eagles, South Sydney excluded |
| 2002 | fifteen: South Sydney readmitted |
| 2003–2006 | fifteen: Manly in place of the Northern Eagles |
| 2007 | sixteen: the Gold Coast Titans |

- **Names of the day.** A club plays under its name that season: the Canterbury Bulldogs in 1998 and 1999 and the
  Bulldogs from 2000 (`nrl-canterbury-bulldogs`, CBY; `nrl-bulldogs`, BUL, as in 2008), the Sydney City Roosters to 1999
  (`nrl-sydney-city-roosters`), the Auckland Warriors to 2000 (`nrl-auckland-warriors`, AKL), the Sharks from 1999 to 2002
  (`nrl-sharks`, SHA, Rugby League 2's code for the club) and the St. George Dragons of 1998 (`nrl-st-george-dragons`,
  STG), each an era of today's club with its colour, by English Wikipedia's club and season articles.
- **The defunct clubs** (`defunct`): the Adelaide Rams (ADE), the Balmain Tigers (BAL), the Gold Coast Chargers (GCC),
  the Illawarra Steelers (ILL), the North Sydney Bears (NSB), the Northern Eagles (NEA) and the Western Suburbs Magpies
  (WSM), no club of today's continuing them, each under its own id (which is its `franchise` too). The codes are ours; the
  colour is the club's own hashed hue, as every built-in club's and the NHL's Seals' (`colourFor`). None has a crest of
  today; four wear the crest of their day (the Rams, the Chargers, the Steelers, the Northern Eagles:
  [period-marks.md](period-marks.md)), and Balmain, Norths and Wests, whose logos of 1998-1999 no source dates, show
  their code.

### Grounds and maps

A club grows from the ground of most of its regular-season home games that season, by NRL.com's draw (level counts keep
the season before's), or from its training base when it shares that ground with another club's, as today. Two
joint ventures split their home games between their founders' grounds every season: the Wests Tigers (Leichhardt and
Campbelltown, from 2003 Stadium Australia too; no ground more than 7 of 12 or 13) grow from Concord Oval, as in 2008 and
today (where they trained before 2008 is not recorded); St. George Illawarra from WIN Stadium, as in 2008, where most of
its home games were in every season but 2000 and 2007 (6 each with Sydney). The third, the Northern Eagles, follows the
rule: Gosford in 2000 and 2001 (7 of 13), Brookvale in 2002 (9 of 12). Names follow the R3 rule: a ground no club
plays at today keeps its name of the era's first season (ANZ Stadium for the Broncos' Queen Elizabeth II Jubilee Sports
Centre to 2002, Malanda then Dairy Farmers Stadium in Townsville, the Sydney Football Stadium and from 2002 Aussie
Stadium, Colonial Stadium, the Sydney Showgrounds Main Arena, NorthPower Stadium at Gosford, Carrara Stadium), one
still played at its present name (Accor Stadium for Stadium Australia, Jubilee Stadium for Kogarah, WIN Stadium,
Campbelltown Sports Stadium). Every ground's name of the day and point come from English Wikipedia's articles at the
revisions the manifest pins (`wikipedia`, 53 articles); the season articles list each club's ground.

| Map | Seasons | What sets it apart |
| --- | --- | --- |
| `nrl1998` | 1998 | twenty clubs, thirteen of them in New South Wales; the Rams hold South Australia; Canterbury at Belmore; the Rabbitohs, tenants at the Roosters' Sydney Football Stadium, from Redfern Oval (in every season) |
| `nrl1999` | 1999 | seventeen: St. George Illawarra at Wollongong; the Canterbury Bulldogs at Stadium Australia, Homebush, from its opening |
| `nrl2000` | 2000 | fourteen: the Wests Tigers from Concord, the Northern Eagles at Gosford (7 of 13 home games), no Rabbitohs |
| `nrl2001` | 2001 | the New Zealand Warriors by name; the Storm at Colonial Stadium (all 13); the Bulldogs at the Sydney Showground |
| `nrl2002` | 2002 | the Rabbitohs back; the Northern Eagles at Brookvale (9 of 12) in their last season; the SFS as Aussie Stadium |
| `nrl2003` | 2003–2005 | Manly again; the Broncos at Suncorp Stadium from its reopening (8 of 12 in 2003); the Bulldogs at Stadium Australia |
| `nrl2006` | 2006 | the Rabbitohs move to Stadium Australia, the Bulldogs' ground: both grow from their training grounds, Redfern and Belmore |
| `nrl2007` | 2007 | sixteen: the Titans at Carrara Stadium (10 of 12) before Robina opened in 2008 |

`node scripts/build-club-maps.mjs --league=nrl` builds them (132–134 KB each); `nrlSpecs` ranks the defunct clubs after
today's, in `defunct`'s order, and refuses any other club that is no franchise of today's. The Bulldogs at Homebush
(1999–2005) cut the City of Parramatta with the Eels, as in 2008.

### The seasons

| Season | Games | Players | Placed by: season / ±1 / ±2 / RLP | Left out | Clubs, shifted | Shifts | Home edge | Clubs against wins: stats → shifted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1998 | 253 | 576 | 487 / 43 / 6 / 40 | 24 | 81.9–85.2 | −1 to +2 | 4.9 | 0.83 → 0.85 |
| 1999 | 213 | 506 | 449 / 35 / 8 / 14 | 10 | 81.5–84.6 | −1 to +1 | 3.9 | 0.67 → 0.83 |
| 2000 | 191 | 448 | 387 / 46 / 9 / 6 | 8 | 81.8–85.5 | −2 to +2 | 7.3 | 0.36 → 0.79 |
| 2001 | 191 | 421 | 372 / 35 / 6 / 8 | 10 | 81.6–84.8 | −1 to +1 | 3.9 | 0.58 → 0.75 |
| 2002 | 189 | 454 | 412 / 27 / 5 / 10 | 13 | 81.7–85.3 | −1 to +1 | 4.8 | 0.68 → 0.87 |
| 2003 | 189 | 460 | 396 / 40 / 10 / 14 | 16 | 81.5–85.4 | −2 to +2 | 2.0 | 0.70 → 0.91 |
| 2004 | 189 | 468 | 416 / 30 / 11 / 11 | 9 | 81.9–85.4 | −1 to +1 | 5.3 | 0.66 → 0.91 |
| 2005 | 189 | 428 | 381 / 35 / 8 / 4 | 3 | 82.0–84.8 | −1 to +1 | 5.3 | 0.36 → 0.86 |
| 2006 | 189 | 430 | 379 / 31 / 14 / 6 | 8 | 81.9–84.8 | −1 to +2 | 1.8 | 0.40 → 0.85 |
| 2007 | 201 | 463 | 417 / 34 / 6 / 6 | 6 | 81.7–84.8 | −1 to +1 | 5.1 | 0.64 → 0.61 |

Columns as for 2009–2024. Every club had 23 to 43 players and fields its matchday 17 from its own. The players rate 66–94
as played (overalls 67–93, median 79–80). The 107 left out are bench players of one to nine games (two the median): 102
whose Rugby League Project page gives no position, or only "Utility Forward", and 5 it lists under another name; 1998 has
the most (24 of 600), as NRL.com has no season before it to place its bench players. The shifted strengths follow each
season's SRS at Spearman 0.93–0.97, against 0.53–0.79 from the stats alone; against the season's wins they rank at
0.75–0.91 but in 2007, when margins and wins parted most (the Cowboys won 15 of 24 games and conceded 618 points to 547;
Cronulla lost 14 with a positive difference): the SRS itself ranks against 2007's wins at 0.73, the shifted strengths at
0.61, the stats at 0.64.

**Realism** (40 seeded seasons of each, `--realism`): points a team 22.7–23.1 (real 20.1–24.4), mean margin 15.0–16.6
(real 14.0–17.0), win% spread 0.144–0.183 (real 0.104–0.194), best and worst records 17.9–20.2 and 4.3–5.5 wins of 24
(real 16–21 and 3–8). The model's wins rank against the real season's at 0.68–0.92, 2007's at 0.52.

**Spot checks against the record.** The strongest club by margin, the SRS's first, is the premier in 1998 and 2000 (the
Broncos) and 2007 (Melbourne, its title stripped in 2010), and the minor premier in 1999 (the Sharks), 2001 and 2005 (the
Eels), 2004 (the Roosters, level on wins with the Bulldogs) and 2006 (Melbourne). In 2002 it is the Bulldogs, 20 wins
before they lost their points; in 2003 the Bulldogs too, the Panthers, premiers and minor premiers on close wins, fourth.
The best-rated of each season (the audit's `best`) are the period's stars with the box score's leanings: Andrew Johns and
Darren Lockyer (2000), Stacey Jones (1999, 2001), Nathan Hindmarsh (2000, 2001, 2005–2007), Brett Finch (2002, 2004,
2005), Cameron Smith (2005, 2006), Shane Webcke and Alan Tongue (2006), and the busiest tacklers of weak sides
(Western Suburbs' hooker Ciriaco Mescia in 1999, the Gold Coast Chargers' Jamie Goddard in 1998).

### Season quirks

- **1998.** Twenty clubs of 24 games each (240 regular-season games) and a top-ten finals series (13 games): 600
  players took the field. Each position's quota is the season's players there per club, so with twenty clubs a 1998
  backup still meets 2025's backups.
- **1999 and 2002–2006.** An odd number of clubs (seventeen, fifteen) and a bye each round, as in 2023 and 2024.
- **2000 and 2001.** Fourteen clubs of 26 games each, South Sydney excluded (readmitted in 2002).
- **2002.** The Bulldogs, leading the competition, were stripped of their 37 points for salary-cap breaches and finished
  last; the New Zealand Warriors were minor premiers. The SRS reads margins, so the Bulldogs rate by their play.
- **2003.** The Broncos moved to Suncorp Stadium when it reopened, mid-season.

### Limits

- **Fewer stats before 2003**, and a different season before: 1998 ranks its players on six stats, run metres among the
  missing, so a forward's carries count only through his line breaks and offloads; 1999–2002 on eight, without
  tackle breaks or kick metres (a half's kicking counts nowhere). 1998, 1999 and 2003 stand on their own season.
- **Three clubs since gone have no crest** (Balmain, Norths and Wests: no source dates their logos of 1998-1999), and
  every gone club plays in a colour of its own; their codes are ours.
- **Grounds by the majority of home games**: a club that moved during a season (the Rams from Adelaide Oval to
  Hindmarsh, the Broncos to Suncorp in 2003) plays the whole season at the ground of most of them.
- **Today's rules:** golden point came in 2003 (a level regular-season game was a draw before), but a campaign needs a
  winner, so every season plays it, as every season since 2008 does.

## Tests

`scripts/rugby-league.test.mjs`: the data rebuilds byte for byte; every rating and position is the snapshot's; the
nation rule; lineups, depth and the position penalties; nations and minnows; 4,000 games with a winner, a feed that adds
up and golden point ending at its score; score effects; odds and home advantage; the copy, clock and scorer line; the
feed's half-time and golden point; the live chart against the odds; the map and its campaigns; setup, the field and the
kicker; the running App launching on the map and saving. `scripts/simulation-realism.test.mjs` holds the NRL ranges above
and its home sides, `scripts/home-advantage.test.mjs` the edge and the live chart at home, `scripts/club-maps.test.mjs`
the map's state rule with Australian and New Zealand towns. `npm run smoke` adds an NRL duel with the live ticker and a
rugby league nations blitz of Asia and Oceania.

`scripts/rugby-league-seasons.test.mjs` covers the earlier seasons: all twenty-seven rebuild byte for byte, and their
snapshots from the pinned inputs when `data-src/rugby-league-seasons/` is present. For 2008, the reader, the naming
check, the weights and every overall, the club shift and the map. For the computed seasons: NRL Fantasy's eleven
weights with a reason each and the season before at half weight; the stats each season counts, NRL.com's census of
them, and the season before only where it recorded the same (1998, 1999 and 2003 alone); who took the field (a prop in
15 started, an unused 18th man has no game) and the order positions come from; errors read as handling errors where a
game records none, and goals as conversions and penalty goals, every season keeping both; every value, overall, SRS,
target and shift recomputed from each snapshot; the clubs of every season, twenty in 1998 down to fourteen and the
Dolphins from 2023, each under its name of that season, the defunct ones by their own ids and colours, every article
behind them pinned; each era's grounds and map, and on the maps of 1998–2007 every club holding the point it grows
from; the City of Parramatta cut only while the Bulldogs trained at Olympic Park or played at Homebush; six seasons
played 40 times with the model's wins ranking against the real ones at 0.6 or better; the loader's rules; and the App
launching a 2015 campaign on `nrl2012` and a 1998 one with its twenty clubs on `nrl1998`, saving and resuming each, and
a 2023 one on today's map.

## Known limits

- **The 2025 season.** Rugby League 26 has had one ratings release, July 2025, so the clubs are 2025's: the Perth Bears
  (2027) are not in it, and players who have moved since play for their 2025 clubs.
- **NRL players only.** Super League's players are not in the list (Zero Tackle published only each club's best), so
  England is thin and fills three places with generated players, Fiji five, Papua New Guinea eleven and the Cook Islands
  twelve.
- **Nations campaigns are Australia's to lose.** Eight nations field NRL players and the rest are minnows, so Australia
  wins 84% of Elite 32 campaigns and 78% of world wars, New Zealand, Samoa and Tonga the rest (`probeCampaign` in
  `scripts/balance.mjs`: 200 and 40 seeded campaigns); in Asia and Oceania Australia won all 200. Since 2026-11-09
  only the six real sides play, on the world and in Asia & Oceania; rugby league offers no Elite 32.
- **Tiny Sydney territories.** Ten clubs share New South Wales, eight of them in Sydney. Hemmed in by their neighbours,
  the Roosters (50 km²), the Rabbitohs (133 km²) and the Wests Tigers (145 km²) start with an inner-Sydney council area or
  two, smaller even than Washington's District of Columbia; Parramatta and Penrith take the west of the state.
- **One conversion rate.** Every kicker converts 75.5%: the game's overall says nothing of goal-kicking.
- **No two-point field goals, sin bins or penalty counts:** a try, a goal and a field goal are all there is.
- **Nothing before 1998.** NRL.com's replies before 1998 carry scores only (no team lists, no player stats), and 1997
  had two competitions, the ARL's and Super League's. Earlier seasons would need the Rugby League Project's team lists
  and scorers and a selection-based rating (the research pass's estimate: 0.77 against Rugby League 26 in 2025's
  conditions), with all-Sydney maps of the NSWRL.
