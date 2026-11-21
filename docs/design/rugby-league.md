# Rugby league

Status: implemented 2026-11-08. An eighth sport: the 17 NRL clubs fight over Australia and New Zealand on the NRL's
own map, each holding its own state, territory or region
([domestic-campaigns.md](domestic-campaigns.md#the-nrl-map)), and the nations field the NRL's players of each country.
Everything outside the match (territory, the draw, targeting, conquest, signings, saves) is the game's own, unchanged.

**On Rugby's card (2026-11-19).** The user chose one Rugby card ([rugby-union.md](rugby-union.md)): the NRL is chosen on
it, beside union's European clubs, and rugby league is named "Rugby", clubs only. Its nations (below) are no longer set
up, as Rugby's nations are union's, but still play the campaigns saved with them; a setup made from one opens on the NRL.

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
- **Earlier seasons** play their own day's points (a try three before 1983, a field goal two before 1971), their league's
  tries, field goals and points, and before 2003 the finals' extra time in place of golden point ("Rules by era", below).
  Everything else in this section is today's model, the built-in season's.
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
is within half a point of the fixture's simulated odds; a match's tables build in about 10 ms. An earlier season's chart
plays its own points, kicks and extra time ("Rules by era").

## Interface

- **Setup.** Rugby's card (2026-11-19; until then a card of its own, "Nations · 17 NRL clubs"): Clubs list union's
  European clubs, then **NRL · Australia and New Zealand**, which sets up rugby league, clubs only. The note under Season
  names Rugby League 26 and the 2025 season.
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
Before it, the premierships of 1960–1997 (the NSWRFL's, the NSWRL's, the ARL's and Super League's of 1997) are computed
from the Rugby League Project's record of who started, where and how often
([Computed seasons, 1960–1997](#computed-seasons-19601997), built 2026-11-14): every premiership season from 1960.

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

  The table was measured at the built-in season's scoring, a little above 2008's. Since the rules by era (2026-11-14) 2008
  plays its own points, its tries and penalty goals scaled alike: 21.6 points a team (SD 12.3), mean margin 15.1, win%
  spread 0.165, best and worst records 19.9 and 5.3, the model's wins against 2008's 0.35. The spread is 2008's, before
  the shift and after it.
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
  clubs' strengths: the season's results set each club's level, while its players keep their order (since 2026-11-15 they
  set how far apart the clubs play too: [The spread](#the-spread));
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
5. **Club shift.** The season's results set each club's level and how far apart the clubs play, while its players keep
   their order. Each club's Simple Rating System is fitted to its regular season by least squares (margin = home rating
   − away rating + one home edge, the ratings summing to zero, solved exactly; `srsOf`), so a club that lost to strong
   sides by little rates above one that beat weak sides by little. Its target is that rating turned into the match
   model's strength at the season's scoring, scaled to the clubs' own spread (the ratings' spread less their games'
   luck), around the built-in 2025 clubs' mean ([The spread](#the-spread)). Every player of the club then moves by a
   whole number, and its best few by one more, whichever brings its model strength nearest the target. Margins, not
   ladder points: the 2010 Storm, stripped of their points for salary-cap breaches, rate by their play, as do the 2016
   Eels, docked 12. Until 2026-11-15 the ratings were ranked and read off the 2025 clubs' strengths (81.8–85.1) and
   every player moved by one whole number, 2008's shift: every season then spread as 2025 does.

The snapshot `scripts/data/rugby-league-seasons/nrl-<year>.json` holds the weights with their reasons, every player's
summed stats for the season and the season before, his clubs and games, value, overall and move, each club's games,
SRS, target and move, the season's reliability, scoring and spread, the quota and reference at each position, the
players left out, and the regular season's results, so the test recomputes every overall and every move from it alone.

### The seasons

| Season | Games | Players | Placed by: season / ±1 / ±2 / RLP | Left out | Clubs, shifted | Shifts | Reliability | Home edge | Clubs against wins: stats → shifted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2009 | 201 | 449 | 398 / 30 / 11 / 10 | 4 | 81.0–84.3 | −2 to +1 | 0.63 | 3.8 | 0.51 → 0.77 |
| 2010 | 201 | 448 | 395 / 31 / 6 / 16 | 5 | 82.1–84.4 | −2 to +1 | 0.55 | 4.3 | 0.14 → 0.80 |
| 2011 | 201 | 465 | 417 / 32 / 9 / 7 | 3 | 81.6–84.6 | −2 to +1 | 0.75 | 3.2 | 0.64 → 0.98 |
| 2012 | 201 | 436 | 388 / 32 / 6 / 10 | 2 | 81.8–84.4 | −2 to +1 | 0.64 | 1.8 | 0.55 → 0.95 |
| 2013 | 201 | 457 | 400 / 32 / 11 / 14 | 4 | 80.7–85.0 | −1 to +1 | 0.82 | 4.1 | 0.76 → 0.96 |
| 2014 | 201 | 461 | 404 / 30 / 7 / 20 | 2 | 81.8–84.3 | −1 to +1 | 0.71 | 4.4 | 0.68 → 0.87 |
| 2015 | 201 | 445 | 381 / 29 / 19 / 16 | 2 | 81.8–85.2 | −1 to +1 | 0.69 | 3.5 | 0.78 → 0.92 |
| 2016 | 201 | 448 | 397 / 28 / 4 / 19 | 1 | 79.8–85.1 | −2 to +2 | 0.83 | 1.7 | 0.74 → 0.93 |
| 2017 | 201 | 440 | 379 / 33 / 11 / 17 | 3 | 82.1–85.1 | −2 to +1 | 0.68 | 0.3 | 0.52 → 0.84 |
| 2018 | 201 | 437 | 383 / 35 / 13 / 6 | 3 | 81.6–84.6 | −2 to +1 | 0.55 | 2.4 | 0.56 → 0.91 |
| 2019 | 201 | 451 | 398 / 36 / 9 / 8 | 1 | 81.3–85.4 | −2 to +1 | 0.77 | 3.3 | 0.48 → 0.96 |
| 2020 | 169 | 466 | 419 / 26 / 6 / 15 | 1 | 80.4–85.6 | −2 to +1 | 0.85 | 2.4 | 0.84 → 0.93 |
| 2021 | 201 | 494 | 437 / 27 / 11 / 19 | 0 | 80.8–86.5 | −2 to +2 | 0.89 | 1.1 | 0.92 → 0.94 |
| 2022 | 201 | 476 | 412 / 37 / 11 / 16 | 0 | 80.6–85.2 | −2 to +1 | 0.86 | 2.7 | 0.80 → 0.94 |
| 2023 | 213 | 500 | 445 / 30 / 6 / 19 | 2 | 81.0–85.1 | −2 to +1 | 0.80 | 2.0 | 0.72 → 0.90 |
| 2024 | 213 | 507 | 445 / 34 / 5 / 23 | 1 | 81.1–84.9 | −2 to +1 | 0.73 | 2.4 | 0.63 → 0.92 |

Clubs, shifted: the matchday 17's ratings the season shows. Shifts: the whole numbers a club's players move by (its best
few one more). Reliability: how much of the SRS's spread is the clubs' own rather than their games' luck ([The
spread](#the-spread)). Home edge in points a game; the last column is the rank correlation of the clubs' model strengths
with their regular-season wins, from the players' stats alone and after the shift (a check: the shift is fitted to
margins, not wins). Every club
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
- **Realism.** 40 seeded seasons of each under its own scoring (`--realism`, 24 games at a neutral venue; "Rules by
  era"): the model's wins rank against the real season's at 0.82–0.97 (2008's: 0.35), by each club's expected wins at
  0.77–0.98. Points a team 19.7–23.4 (real 19.6–23.4), tries 3.32–4.09 (real 3.33–4.10), mean margin 13.6–18.6 (real
  12.8–18.3), win% spread 0.132–0.212 (real 0.124–0.226), each season's within 0.031 of its own, best and worst records
  17.5–21.2 and 3.0–6.5 wins of 24 (real 16–21.6 and 1–8). Before its clubs spread as its own results did ([The
  spread](#the-spread)) every season's win% spread was 0.144–0.189, whatever its record's.

**Spot checks against the record** (NRL.com's results; the grand finals from its finals games). The strongest club of
each computed season is its best by margin, its SRS (in 2016 level with North Queensland). That is the premier in 2010
(the Dragons), 2011 (Manly), 2012 (Melbourne), 2013 (the Roosters), 2014 (the Rabbitohs), 2017 (Melbourne), 2018 (the
Roosters), 2022 and 2023 (Penrith); in 2009, 2015, 2016, 2019, 2020 and 2021 it is the minor premier (the Dragons, the
Roosters, Melbourne three times, Penrith), the premiers second by margin (2009, 2019–2021) or fourth (2015, 2016); in
2024 the Roosters, ahead of Melbourne (minor premiers), Cronulla and Penrith (premiers) by margin. The 2009 Bulldogs, 18
wins but docked two points (the Rugby League Project's ladder), are third by margin, as are the 2010 Storm, 14 wins and
stripped of every point. The shift lands each club within six hundredths of a point of its target, so the model's
strengths keep the margins' order: the 2009 Bulldogs and the 2010 Storm play third, the premiers of 2019 and 2020
second, North Queensland in 2015 fourth (whole-point shifts left them fifth, fourth, third and fifth until 2026-11-15).
The ratings the season shows weigh the bench as the starters and may order neighbours otherwise: the 2010 Storm show
fourth (83.5). The best-rated dozen
of each season (the audit's `best`) are the period's stars, with the box score's leanings: Cooper Cronk (2009–2012), Billy
Slater (2010–2012) and Cameron Smith (2011–2019) of Melbourne; Daly Cherry-Evans in every season from his first, 2011, but
2019 (top three in eight of them); Andrew Fifita (2013, 2016–2018); Greg Inglis (2013–2014) and Sam Burgess (2014);
Jarryd Hayne (2011, 2014); James Tedesco (2017–2024); Payne Haas (2020, 2021, 2023); Nathan Cleary (2020, 2021, 2023);
Isaah Yeo (2018, 2021, 2023, 2024). Johnathan Thurston, the halfback of North Queensland's 2015 title, rates 91 that year,
only eighth: the box score sees his kicking as metres and his goals not at all.

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
  fitted to the season they play, so a campaign's strongest clubs are the season's best by margin; since 2026-11-15 so is
  how far apart they play ([The spread](#the-spread)).
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

| Season | Games | Players | Placed by: season / ±1 / ±2 / RLP | Left out | Clubs, shifted | Shifts | Reliability | Home edge | Clubs against wins: stats → shifted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1998 | 253 | 576 | 487 / 43 / 6 / 40 | 24 | 80.4–86.0 | −2 to +2 | 0.87 | 4.9 | 0.87 → 0.94 |
| 1999 | 213 | 506 | 449 / 35 / 8 / 14 | 10 | 78.7–85.6 | −3 to +1 | 0.89 | 3.9 | 0.64 → 0.91 |
| 2000 | 191 | 448 | 387 / 46 / 9 / 6 | 8 | 81.5–85.1 | −3 to +2 | 0.65 | 7.3 | 0.38 → 0.87 |
| 2001 | 191 | 421 | 372 / 35 / 6 / 8 | 10 | 82.0–85.5 | −2 to +1 | 0.78 | 3.9 | 0.55 → 0.86 |
| 2002 | 189 | 454 | 412 / 27 / 5 / 10 | 13 | 80.6–85.3 | −2 to +1 | 0.85 | 4.8 | 0.61 → 0.89 |
| 2003 | 189 | 460 | 396 / 40 / 10 / 14 | 16 | 81.9–85.5 | −3 to +2 | 0.75 | 2.0 | 0.69 → 0.95 |
| 2004 | 189 | 468 | 416 / 30 / 11 / 11 | 9 | 81.6–85.3 | −2 to +1 | 0.77 | 5.3 | 0.74 → 0.95 |
| 2005 | 189 | 428 | 381 / 35 / 8 / 4 | 3 | 82.1–84.2 | −2 to +1 | 0.60 | 5.3 | 0.39 → 0.90 |
| 2006 | 189 | 430 | 379 / 31 / 14 / 6 | 8 | 81.4–84.8 | −1 to +2 | 0.57 | 1.8 | 0.41 → 0.89 |
| 2007 | 201 | 463 | 417 / 34 / 6 / 6 | 6 | 82.1–84.4 | −2 to +1 | 0.72 | 5.1 | 0.51 → 0.73 |

Columns as for 2009–2024. Every club had 23 to 43 players and fields its matchday 17 from its own. The players rate 66–94
as played (overalls 67–93, median 79–80). The 107 left out are bench players of one to nine games (two the median): 102
whose Rugby League Project page gives no position, or only "Utility Forward", and 5 it lists under another name; 1998 has
the most (24 of 600), as NRL.com has no season before it to place its bench players. The shifted model strengths follow
each season's SRS at Spearman 0.99–1.00, against 0.38–0.87 from the stats alone; against the season's wins they rank at
0.86–0.95 but in 2007, when margins and wins parted most (the Cowboys won 15 of 24 games and conceded 618 points to 547;
Cronulla lost 14 with a positive difference): the SRS itself ranks against 2007's wins at 0.73, the shifted strengths at
0.73, the stats at 0.51.

**Realism** (40 seeded seasons of each under its own scoring, `--realism`; "Rules by era"): points a team 20.0–24.6 (real
20.1–24.4), tries 3.48–4.30 (real 3.49–4.27), mean margin 14.1–17.6 (real 14.0–17.0), win% spread 0.135–0.198 (real
0.104–0.194), each season's within 0.034 of its own (2005, the most level season of all, 0.138 against 0.104), best and
worst records 17.5–20.3 and 2.2–6.1 wins of 24 (real 16–21 and 3–8); 1998–2002 level at full time 2.3–3.0% of the time
(the league's draws 2.0–5.5%). The model's wins rank against the real season's at 0.78–0.95, by its clubs' expected wins
at 0.70–0.96 (2007's 0.70, 0.49 before its clubs spread as its own results did: [The spread](#the-spread)).

**Spot checks against the record.** The strongest club by margin, the SRS's first, is the premier in 1998 and 2000 (the
Broncos) and 2007 (Melbourne, its title stripped in 2010), and the minor premier in 1999 (the Sharks), 2001 and 2005 (the
Eels), 2004 (the Roosters, level on wins with the Bulldogs) and 2006 (Melbourne). In 2002 it is the Bulldogs, 20 wins
before they lost their points; in 2003 the Bulldogs too, the Panthers, premiers and minor premiers on close wins, fourth.
The best-rated of each season (the audit's `best`) are the period's stars with the box score's leanings: Andrew Johns and
Darren Lockyer (2000), Stacey Jones (1999, 2001), Nathan Hindmarsh (2000, 2001, 2005–2007), Brett Finch (2002, 2004,
2005), Cameron Smith (2005, 2006), Shane Webcke and Alan Tongue (2006). The busiest tacklers of weak sides were among them
(Western Suburbs' hooker Ciriaco Mescia in 1999, the Gold Coast Chargers' Jamie Goddard in 1998) until their clubs played
as far below the rest as their results put them ([The spread](#the-spread)).

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
- **Extra time before 2003:** a level regular-season game was a draw until golden point came in 2003; a campaign needs a
  winner, so 1998–2002 play the finals' extra time ("Rules by era").

## Computed seasons, 1960–1997

Status: built 2026-11-14. The premierships before the NRL, **1960 to 1997**: the NSWRFL's to 1983, the NSWRL's from 1984
to 1994, the ARL's from 1995, and in 1997 Super League's beside the ARL's, both kept as two seasons of one year, as the
NFL's and the AFL's of the 1960s are. Each is computed from the Rugby League Project's record of who started, where and
how often, labelled "NSWRFL (computed)", "NSWRL (computed)", "ARL (computed)" or "Super League (computed)", and plays on a
map of its day with the clubs of its day: rugby league now has every premiership season from 1960 to 2025. The user asked
on 2026-11-13 to cover every sport's year gaps, and approved computed ratings where they are documented and labelled; the
sessions on it took this one last, once 1998–2007 were done.

### Can the record rate players?

NRL.com keeps nothing before 1998. The Rugby League Project (RLP) keeps every premiership game's team lists by position,
its scorers and its ground, and each season's list of its players: the games each started at each position, came off the
bench, won, lost and drew, and his tries and goals. Tackles, metres and line breaks were never recorded, so the stats
method above cannot be run, and the question was whether selection, who started and how often, rates players as well.
It was measured on 2025 against Rugby League 26, the yardstick the stats method meets: RLP's own lists of 2025 and 2024,
465 players matched by name to the game's, pooled Spearman within Rugby League 26's positions.

| A player's value | Spearman against RL26 |
| --- | --- |
| starts a club game, 2025 alone | 0.682 |
| starts a club game, 2024 at half weight | 0.742 |
| and 2 for each try (0.766 at ½ a try, 0.774 at 1, 0.778 at 2, flat to 4) | 0.778 |
| and representative games counted as starts (State of Origin, Tests) | 0.785 |
| NRL.com's core points, the stats method's value (the research pass's measure) | 0.797 |

Through the whole method (percentile at the position read off Rugby League 26 by the quota, then the club shift), on
the 426 players RLP places at a position: Spearman 0.743 within position before the shift and 0.731 after, mean error 2.72
and 2.83 points; the stats method's finished overall meets the game at 0.761, mean error 2.72 (449 players, "Calibration"
above). The research pass of 2026-11-09 had estimated 0.77. So the record supports a computed rating, a little looser than
the stats method's: it ranks a club's regulars above its fringe and the try-scorers among its backs, and leans on the
selectors for the best.

Two choices the measure guided. **Representative games count as selections**, because Test and interstate players of
the 1960s and 1970s missed club rounds for them: counted as starts, they give back what the club lost (+0.007 on 2025,
when Origin players miss few). **A try weighs two starts at today's rate of four tries a team game** (2025's: 4.01),
scaled to the season's own rate, so that a try keeps its weight against a start in every era: the seasons ran from 2.06
tries a team game (1967) to 3.64 (1995). Goals count nowhere, as in every other season: the overall says nothing of a
kicker's boot.

### The source

- **The Rugby League Project**, 446 requests on 2026-11-14, every reply 200, through `scripts/lib/polite-fetch.mjs` (its
  robots.txt allows the season, competition and calendar pages; it disallows only some `/matches/` searches and query
  strings), one every three seconds: each season's players list and results, 1958 to 1999 (the season before and the two
  either side of each), Super League's league games alone (`results-league.html`: its season also held the World Club
  Challenge), the calendar of each year for its competitions, and each representative competition's players: a table
  (the Tests), a one-match competition's team lists (NSW City v Country, the 1980 and 1981 State of Origin), or a series'
  squads with each player's appearances (the interstate series to 1981, State of Origin from 1982). RLP states no data
  licence; it is read for facts only, who played, where and how often, as for 1998–2007 (`rlpTerms`). The World Cups are
  left out, their games being Tests already, and so are Super League's two Test series of 1997 (every player in them is
  in 1997's Test Matches with as many games).
- **English Wikipedia**, 53 articles more, read as `/wiki/` pages and pinned by revision (`wikipedia`): the 38 season
  articles of 1960–1997 and Super League's, whose Teams sections name each club's ground; the grounds no club plays at
  today (Henson Park, the Sydney Sports Ground, Pratten Park, Lidcombe Oval, Sutherland Oval, Seiffert Oval, Seagulls
  Stadium, Topper Stadium, under its article today, the WACA Ground, the SCG); and the clubs gone (Newtown, the
  Crushers, the Western Reds, under WA Reds today, the Hunter Mariners).
- **Pins**: 202 inputs more in `scripts/data/rugby-league-seasons-sources.json`, each RLP page by the part read (a
  season's or competition's players table, `list` and `tests`; a series' squads; the results table).

### The method

The 1998–2024 method with selection for its value (`scripts/lib/rugby-league-seasons.mjs`: `rlpSeasonList`,
`clubsByCode`, `selectionValue`; the sync's `selectionSnapshotOf`):

1. **Players.** Everyone RLP lists as taking the field in the season, its finals included; his club the one he played
   most games for (of two as many, the first RLP lists). The list and the results must agree: every code the list names
   is a club of the results (`RLP_CLUB_CODES`: a code keeps its club throughout, but NEW is Newtown's to 1983 and
   Newcastle's from 1988), and no player of one club played, won, drew or lost more than his club did.
2. **Position.** The one he started at most that season (the bench is no start), else in the seasons either side, then two
   either side; else he is left out (682 of 15,622 across the 39 seasons, fringe players of a game or two).
3. **Value.** (Starts + representative games + 2 × tries × 4 ÷ the season's tries a team game) per club game, the season
   before at half weight when he played in it (its own try rate; 1960's is 1959's NSWRFL, 1997's both the ARL's of 1996).
4. **Overall** and **club shift**: as 1998–2024, the season's Simple Rating System from its regular rounds' scores.

Each snapshot keeps every player's starts, representative games and tries, and his season before, so the tests
recompute every value, overall and shift.

### The clubs

| Seasons | Clubs |
| --- | --- |
| 1960–1966 | ten, all Sydney's: Balmain, Canterbury-Bankstown, Eastern Suburbs, Manly-Warringah, Newtown, North Sydney, Parramatta, South Sydney, St. George, Western Suburbs |
| 1967–1981 | twelve: Cronulla-Sutherland and Penrith join |
| 1982, 1983 | fourteen: Canberra and Illawarra |
| 1984–1987 | thirteen: Newtown gone |
| 1988–1994 | sixteen: Brisbane, the Gold Coast and Newcastle |
| 1995, 1996 | twenty in the ARL: the Auckland Warriors, the North Queensland Cowboys, the South Queensland Crushers and the Western Reds |
| 1997 | the ARL's twelve, and Super League's ten: Brisbane, Canberra, Canterbury, Cronulla, Penrith, Auckland and North Queensland with the Adelaide Rams, the Hunter Mariners and the Perth Reds |

- **Names of the day**, from the clubs' articles: the Canterbury-Bankstown Berries to 1977
  (`nrl-canterbury-bankstown-berries`; the Bulldogs from 1978), the Sydney Bulldogs of 1995 (`nrl-sydney-bulldogs`), the
  Canterbury Bulldogs of 1996 and 1997; the Eastern Suburbs Roosters to 1994 (`nrl-eastern-suburbs-roosters`, EAS), the
  Sydney City Roosters after; the Newtown Bluebags to 1972 (`nrl-newtown-bluebags`; the Jets from 1973); Balmain as the
  Sydney Tigers in 1995 and 1996 (`nrl-sydney-tigers`, SYT); the Gold Coast-Tweed Giants of 1988 and 1989 and the Gold
  Coast Seagulls to 1995 (`nrl-gold-coast-tweed-giants`, GCT; `nrl-gold-coast-seagulls`, GCS), the Chargers after; the
  Western Reds as the Perth Reds in Super League (`nrl-perth-reds`). Each is an era of its club, in its colour.
- **The clubs gone** (`defunct`, four more): the Newtown Jets (NTN), the South Queensland Crushers (SQC), the Western Reds
  (WRD) and the Hunter Mariners (HUN), each under its own id, in a colour of its own; their codes are ours. Balmain,
  North Sydney, Western Suburbs, Illawarra, the Gold Coast and Adelaide were already among them. None has a crest of
  today; each wears the crest of its day where a source shows and dates one ([period-marks.md](period-marks.md)).
- **Names** come from RLP's lists, which print a surname in capitals: each is written as a name is (Beetson, McArthur,
  O'Connor, Addo-Carr; a particle in lower case, "de", stays so).
- **The premiership of the day** (2026-11-14), as the AFL's seasons of the 1960s name theirs: each season's clubs and its
  map name its competition, the manifest's `competition` (`leagueOf` in `scripts/lib/rugby-league-seasons.mjs`; the NRL
  from 1998), so a 1962 setup lists the NSWRFL's theatre of ten clubs (its card read "10 NSWRFL clubs" until
  the NRL moved onto Rugby's card) and its campaign "NSWRFL · Australia and New Zealand · 1962"; the NSWRL from 1984, the ARL from 1995, and Super League for its 1997. The seasons from 1998 and
  today's map keep "NRL". A map's seasons share one competition, which `nrlSpecs` checks; `LEAGUES.nrl.eraLeagues`
  lists the four, so building another league's maps keeps their index entries.

### Grounds and maps

A club grows from the ground of most of its regular-season home games by RLP's results, as from 1998, with what that era
needs on top:

- **The league's showpiece grounds.** Until the Sydney Football Stadium opened in 1988 the league staged its match of
  the round at the SCG or the Sydney Sports Ground, whoever was at home (St. George played 6 of 9 home games at the SCG in
  1962): those games count for no club's ground, but Eastern Suburbs' at the Sports Ground, its own, and a club that
  played every home game at them (Eastern Suburbs at the SCG in 1977).
- **A ground being rebuilt stays its club's (R1)**: Parramatta at Belmore from 1982 to 1985 while Cumberland Oval was
  rebuilt as Parramatta Stadium (named so throughout); St. George at the SCG and Belmore from 1986 to 1988 while Kogarah
  had its new grandstand; Eastern Suburbs at Henson Park in 1987 while the Sports Ground became the Sydney Football Stadium.
- **A club on another's ground grows from its own**: Balmain at Eastern Suburbs' Sports Ground in 1971 and 1972 (from
  Leichhardt), South Sydney at the Sydney Football Stadium from 1988 (from Redfern, as after 1998; alone there in 1990,
  when Eastern Suburbs played most home games at Henson Park, as the ground's article records), the Sydney Bulldogs and the
  Sydney Tigers at Parramatta Stadium in 1995 (from Belmore and Leichhardt), the Tigers again in 1996.
- **Canberra played at Seiffert Oval, in Queanbeyan, until 1989**: over the border in New South Wales, so the Raiders
  hold a corner of New South Wales and the Australian Capital Territory is nobody's until Bruce Stadium in 1990. The Gold
  Coast's club began at Seagulls Stadium, Tweed Heads, in New South Wales too, and holds the Tweed until Carrara in 1996.

| Map | Seasons | What sets it apart |
| --- | --- | --- |
| `nrl1960` | 1960–1966 | ten clubs, all in Sydney; Western Suburbs at Pratten Park, Parramatta at Cumberland Oval |
| `nrl1967` | 1967 | twelve: Cronulla-Sutherland at Sutherland Oval, Penrith; Western Suburbs at Lidcombe |
| `nrl1968` | 1968–1970 | Cronulla-Sutherland at Endeavour Field |
| `nrl1971` | 1971–1972 | Balmain at the Sports Ground, from Leichhardt |
| `nrl1973` | 1973–1976 | the Newtown Jets; Balmain back at Leichhardt |
| `nrl1977` | 1977 | Eastern Suburbs at the SCG |
| `nrl1978` | 1978–1981 | the Canterbury-Bankstown Bulldogs |
| `nrl1982` | 1982–1983 | fourteen: Canberra (Queanbeyan), Illawarra (Wollongong); Parramatta keeps its ground (R1) |
| `nrl1984` | 1984–1986 | thirteen, without Newtown; St. George keeps Kogarah (R1) |
| `nrl1987` | 1987 | Western Suburbs at Campbelltown; Eastern Suburbs keeps its ground (R1) |
| `nrl1988` | 1988–1989 | sixteen: the Broncos at Lang Park, the Giants at Tweed Heads, the Knights; the Rabbitohs from Redfern |
| `nrl1990` | 1990 | Eastern Suburbs at Henson Park; Canberra at Bruce Stadium; the Seagulls |
| `nrl1991` | 1991–1992 | Eastern Suburbs back at the Sydney Football Stadium |
| `nrl1993` | 1993–1994 | the Broncos at ANZ Stadium |
| `nrl1995` | 1995 | the ARL's twenty: Auckland, Townsville, Lang Park for the Crushers, Perth; Parramatta Stadium three clubs' |
| `nrl1996` | 1996 | the Canterbury Bulldogs at Belmore, the Chargers at Carrara |
| `nrl1997` | 1997 | the ARL's twelve |
| `sl1997` | Super League 1997 | ten: Adelaide holds South Australia, the Perth Reds Western Australia, the Mariners the Hunter |

Ground names follow the rule of 1998–2007 (a ground no club plays at today keeps its name of the day: Henson Park, the
Sydney Sports Ground, Cumberland Oval, Seiffert Oval, Stockland Stadium; one still played at, its name today: Ocean
Protect Stadium for Endeavour Field, GIO Stadium for Bruce, Suncorp Stadium for Lang Park, 4 Pines Park for Brookvale).

### The seasons

| Seasons | Clubs | Players a season | Left out | Shifts | Reliability | Clubs against wins: selections → shifted | Tries a team game | Real points a team |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1960–1966 | 10 | 254–272 | 0–6 | −4 to +3 | 0.77–0.86 | 0.36–0.91 → 0.90–1.00 | 2.11–2.87 | 12.3–15.7 |
| 1967–1981 | 12 | 308–364 | 3–22 | −5 to +2 | 0.52–0.90 | 0.26–0.85 → 0.78–0.99 | 2.06–3.26 | 14.2–17.3 |
| 1982–1987 | 13–14 | 421–452 | 22–36 | −4 to +2 | 0.47–0.91 | 0.48–0.83 → 0.73–0.98 | 2.52–3.16 | 15.9–19.3 |
| 1988–1994 | 16 | 490–509 | 28–39 | −4 to +2 | 0.67–0.89 | 0.15–0.81 → 0.81–0.95 | 2.51–3.56 | 14.9–20.5 |
| 1995–1997, ARL | 12–20 | 344–622 | 17–40 | −2 to +1 | 0.86–0.92 | 0.81–0.89 → 0.91–0.94 | 3.28–3.64 | 19.0–21.1 |
| 1997, Super League | 10 | 274 | 11 | −2 to +1 | 0.71 | 0.69 → 0.90 | 3.60 | 21.3 |

14,940 players placed over the 39 seasons: 13,684 by their own season, 1,049 by a season either side, 207 by two. Shifts
and reliability as for 1998–2024: the dominant clubs and the stragglers of the 1960s and 1970s move furthest, the 1963 St.
George Dragons (15 wins of 18, 16.9 points a game better than the average club) up to a model strength of 90.0 (88.8
shown), the 1966 Eastern Suburbs Roosters (no win in 18) down to 78.7, eight points below that season's Dragons. Clubs
against wins, as for 1998–2024, is a check only: the selections alone rank the clubs' model strengths loosely (median
0.59), as the value says who a club picked, not how good it was; the shift by the season's results brings them to a
median of 0.93.

**Realism** (40 seeded seasons of each under its own rules, `--realism`, 24 games at a neutral venue; "Rules by era"):
each season scores as its record, 12.4–21.3 points a team (real 12.3–21.3: 12–16 in the 1960s, a try worth three), within
0.05 of its tries and 0.02 of its field goals, and its mean margin of 10.4–17.9 points sits by the real 8.6–17.9, most
seasons a point above their own. Its standings spread as its record's ([The spread](#the-spread)): a win% spread of
0.131–0.218 (real 0.125–0.247), each season within 0.026 of its own but 1964 (0.203 against 0.247, the widest of all),
best and worst records 17.4–22.2 and 1.4–6.8 wins of 24 (real 16–21.8 and 0–7). The model's wins rank against the real
season's at 0.74–0.99, median 0.93 (under 0.8 in 1980 and 1986 alone), by each club's expected wins at 0.71–0.99. Until
2026-11-15 every season's spread was today's, 0.133–0.181 whatever its record's, the 1960s' and 1970s' standings too close
and the ranking 0.58–0.95.

**Spot checks.** The best-rated of each season (the audit's `best`) are its stars: Reg Gasnier, Kevin Ryan and Eddie
Lumsden of St. George in its run of eleven premierships (1962), Gasnier again in 1964; Kevin Junee (from 1967), Ron Coote
(1969, 1975), Johnny Mayes (1973–1975) and Bob Fulton (1973–1976); Ray Price (1978, 1979); Steve Roach (1984, 1985), Greg Alexander
(1986, 1989, 1991) and Sam Backo (1987, 1988); Paul Harragon (1994), Gary Freeman (1995) and Allan Langer (1996); and
Super League's David Peachey, Ian Roberts and Stacey Jones.

### Limits

- **Selection, not play.** A player rates by how often he was picked and scored, read onto 2025's ratings at his
  position: a regular of a weak club meets a regular of a strong one until the club shift, and a forward who never
  scores rates by his starts and his representative games alone.
- **A season's spread is read from one season's margins** ([The spread](#the-spread)): its luck is taken out on average,
  not season by season, so 1964's standings still spread less than its record's (0.203 against 0.247), and every
  season's margins run a little wider than its own, as the model's games are a little more open than the real ones.
- **Crests of the day where a source dates them** ([period-marks.md](period-marks.md)): the clubs' articles and their
  copies on the Wayback Machine date most logos (Cronulla's four from 1967, the Roosters' "Easts to Win" and Eastern
  Suburbs shield, Canterbury's CB shield and snarling bulldog, Souths' oval of 1959, Manly's and Penrith's, the first
  logos of the clubs of 1982-1997). Eastern Suburbs had no logo before 1967, and Parramatta's crests to 1979, Penrith's
  mark before 1978 and Wests' before 1978 survive in no usable picture: those seasons show the club's monogram, as do
  Balmain (and the Sydney Tigers), Norths, St. George, Newtown, Wests after 1989 and the Perth Reds, whose logos of the
  time no source dates. Souths' seasons of 1980-1997, undated, wear today's crest. Since 21 November 2026 none shows a monogram: each
  of those seasons shows the club's nearest picture, the logo it wore next (period-marks.md, "No club without a crest").
- **Clubs only**, as every earlier season: a nations game plays the built-in nations.

## Rules by era

Status: built 2026-11-14, so that the computed seasons score like their record (the user's request of 2026-11-13 to
cover every sport's year gaps; "Today's scoring" was the first limit of 1960–1997). Every earlier season plays its own
day's points, scoring and extra time (`rugbyLeagueIn`, read through `matchSport`: one rules object a season, simulation
version 2). The built-in 2025 plays today's rules: `rugbyLeague` itself, version 1, untouched (13,572 seeded matches and
99,384 points of the live chart compared before and after, every one the same).

**Points** (`rulesOf`). A try was worth three points until 1983, a field goal two until 1971; a conversion and a penalty
goal two throughout. The Rugby League Project's season lists add up so: in every season from 1960 to 1997 a list's points
are its tries at three to 1982 and four from 1983, its goals at two, and its field goals at two to 1970 and one from 1971.
A score effect's reach is the converted try of the day (five points before 1983): a side a converted try or less behind
chases, a leader that close protects, and a late field goal is kicked for what it does (level, to edge ahead; a converted
try up, to lead by more than one; two up, by more than two; a field goal or less behind, to level or lead), the same
chances as today's.

**Scoring.** `src/data/nrlLeagueAverages.js` (`node scripts/build-nrl-league.mjs`, `--check` to verify, about 30 seconds)
holds each earlier season's points a team a game in its regular season (its snapshot's real season), and its tries and
field goals a team a game over all its games, finals included, at its regular season's level (× its points over the whole
season's): to 1997 from RLP's season list, the one its ratings read (each checked against its pin; without
`data-src/rugby-league-seasons/` the committed figures are kept), from 1998 from the NRL.com stats its snapshot keeps.
2008, rated by a game that keeps no stats, has its points alone. The seasons ran from 2.1 tries a team game (1965, 1967)
to 4.3 (2002), from 12.3 points (1963) to 24.4 (2001), and from no field goals at all (1960, 1961, 1963, 1964) to 0.74 a
team a game in 1968: the four-tackle rule of 1967 made one the last tackle's play until it was worth a point. A season's
`scoring` is solved over every pairing of its clubs under its own rules, 16,000 games a round for six rounds
(`solveScoring` in `scripts/lib/nrl-league.mjs`):

- `tries` scales both try rates to the season's tries: 0.51 (1967) to 1.06 (2002).
- `fieldGoals` scales the late field-goal chances, today's at most, to the season's field goals, and `openFieldGoals`
  adds open play's beyond them: 0.40–0.69 a side in eighty minutes from 1967 to 1970, under 0.2 after, none before 1967,
  whose late chances fall to under half (to none in four seasons).
- `penalties`, a side's penalty goals in eighty minutes between equals, make up the points left, every conversion at
  today's 75.5%: 1.0–1.95 in the 1960s, 0.8–1.7 from 1970 to 1983, 0.1–0.95 from 1984 (2018's penalty blitz 0.99; today
  0.39).
- 2008 scales tries and penalty goals alike to its points: today's mix.

**Extra time.** Golden point came in 2003 (the 2003 NRL season's article, revision 1372950954); before it a level
regular-season game was a draw, 0 to 7.8% of a season's games. The finals played twenty minutes of extra time in two
halves, played in full, and replayed a game still level: the season articles tell of extra time in a 1960 minor semi, the
1977 grand final's twenty minutes and its replay, 1978's replayed semi-final and grand final, 1985's play-off for fifth
place won 10–7 in extra time, 1989's grand final, the first since 1977 to go into same-day extra time, and a 1998
preliminary final won 32–20 in it (English Wikipedia, revisions 1285648128, 1381606813, 1385457039, 1366072587, 1381796218 and 1376325924). A
campaign needs a winner, so a level game plays the finals' extra time, as hockey plays its playoffs' overtime: twenty
minutes in full, its slices the score effects of a game's last twenty (`extraSlice`: the chase, the protected lead, the
late field goals); still level, extra time again, standing in for the replay a campaign cannot wait for, at most three
times, and a game still level after the third ends with a field goal on its last minute, near a coin flip, as golden
point's last. The model's games are level at full time 2.1–4.2% of the time (the league's draws 0–7.8% a season); 90% of
them are settled in the first period of extra time, 9% in the second, and one in a thousand (three games in 100,000) goes
to the last field goal.

**The clock** (`EXTRA_TIME`): extra time's periods on the chart ("ET" at 100', then "2ET"), each score at its minute
("92'"), the result "after extra time" or "after a second extra time", short "ET" and "2ET"; the feed's row "Extra time —
PEN 6–6 MAN" and its live line "· extra time"; a period is played to its end (`clock.sudden` false). The scorers' line
ranks by the day's points (`scoreValues`: 1968's two field goals outrank a try). Golden point's seasons read as today's.

**The live chart.** `liveModelFor` carries an earlier season's points and kicks (`points` [try, field goal], `kicks`
[penalty goals, the late field goals' scale, open play's]) and, before golden point, extra time (`extra`, `ot` 20, `maxOt`
3). Its slices give each side's points at the day's values, open play's field goals beside the late one; extra time's
slices are played backwards period by period, a lead at a period's end has won, and the third's level end goes to the last
field goal. At kick-off the chart is within 0.01 of the fixture's simulated odds (1965–2005). Today's model names none of
these fields, so its chart reads as it always has.

**Results.** 40 seeded seasons of each season's clubs under its own rules (`--realism`, 24 games at a neutral venue);
the real figures in brackets. Before golden point the scores count at full time, as the league counted them, a level game
a draw, extra time deciding only who wins.

| Seasons | Points a team | Tries a team | Field goals a team | Level at full time | Mean margin | Win% spread | Best and worst records (wins of 24) | Wins against the real: 40 seasons / expected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1960–1966 | 12.4–15.7 (12.3–15.7) | 2.10–2.94 (2.10–2.91) | 0.00–0.03 (0.00–0.03) | 2.9–3.8% (0.0–7.8%) | 10.7–12.5 (8.6–11.6) | 0.161–0.209 (0.170–0.247) | 18.7–22.2 and 2.5–5.9 (17.3–20.0 and 0.0–5.3) | 0.85–0.97 / 0.89–0.98 |
| 1967–1970 | 14.2–16.2 (14.2–16.3) | 2.08–2.75 (2.08–2.77) | 0.47–0.76 (0.46–0.74) | 2.5–3.2% (1.5–6.1%) | 10.4–11.5 (9.5–10.5) | 0.166–0.197 (0.179–0.199) | 18.4–19.7 and 3.2–6.0 (17.5–19.6 and 2.2–5.5) | 0.90–0.98 / 0.94–0.98 |
| 1971–1982 | 15.3–17.4 (15.2–17.3) | 2.84–3.30 (2.82–3.28) | 0.04–0.13 (0.04–0.12) | 2.2–2.8% (1.5–5.3%) | 10.7–13.1 (10.4–12.5) | 0.137–0.216 (0.143–0.236) | 17.4–20.4 and 1.4–6.6 (16.4–21.8 and 2.2–6.5) | 0.77–0.99 / 0.78–0.99 |
| 1983–1987 | 16.1–19.2 (16.0–19.3) | 2.53–3.15 (2.52–3.16) | 0.10–0.24 (0.10–0.23) | 2.6–2.9% (1.3–4.5%) | 11.6–14.5 (10.9–14.0) | 0.131–0.182 (0.125–0.192) | 17.7–20.1 and 3.8–6.8 (16.0–20.3 and 1.0–7.0) | 0.74–0.98 / 0.71–0.98 |
| 1988–1994 | 14.9–20.4 (14.9–20.5) | 2.48–3.57 (2.48–3.58) | 0.09–0.14 (0.10–0.13) | 2.4–3.1% (1.1–5.1%) | 12.3–16.2 (11.3–16.2) | 0.143–0.204 (0.137–0.213) | 18.5–20.9 and 2.6–5.9 (17.5–19.6 and 1.1–6.5) | 0.81–0.98 / 0.82–0.97 |
| 1995–1997, ARL | 19.2–21.0 (19.0–21.1) | 3.30–3.68 (3.29–3.69) | 0.06–0.12 (0.06–0.12) | 2.1–2.7% (1.4–4.5%) | 14.8–17.9 (13.1–17.9) | 0.178–0.218 (0.165–0.234) | 18.5–21.3 and 2.9–4.0 (16.4–21.8 and 2.2–4.4) | 0.87–0.94 / 0.91–0.93 |
| 1997, Super League | 21.3 (21.3) | 3.65 (3.66) | 0.09 (0.09) | 2.3% (2.2%) | 14.6 (14.1) | 0.155 (0.149) | 18.4 and 6.0 (18.7 and 6.7) | 0.89 / 0.90 |
| 1998–2002 | 20.0–24.6 (20.1–24.4) | 3.48–4.30 (3.49–4.27) | 0.05–0.08 (0.05–0.08) | 2.3–3.0% (2.0–5.5%) | 14.1–17.6 (14.7–17.0) | 0.143–0.198 (0.122–0.194) | 18.2–20.3 and 2.2–6.1 (16.6–20.0 and 3.0–6.5) | 0.81–0.95 / 0.83–0.96 |
| 2003–2007 | 21.4–24.3 (21.4–24.2) | 3.73–4.27 (3.73–4.25) | 0.07–0.10 (0.07–0.10) | golden point 2.2–2.9% | 14.7–16.9 (14.0–16.5) | 0.135–0.174 (0.104–0.176) | 17.5–18.9 and 4.4–6.1 (16.0–21.0 and 3.0–8.0) | 0.78–0.95 / 0.70–0.95 |
| 2008 | 21.6 (21.5) | 3.78 | 0.05 | golden point 2.8% | 15.1 (14.7) | 0.165 (0.153) | 19.9 and 5.3 (17.0 and 5.0) | 0.35 / 0.34 |
| 2009–2024 | 19.7–23.4 (19.6–23.4) | 3.32–4.09 (3.33–4.10) | 0.06–0.12 (0.06–0.12) | golden point 2.3–3.0% | 13.6–18.6 (12.8–18.3) | 0.132–0.212 (0.124–0.226) | 17.5–21.2 and 3.0–6.5 (16.0–21.6 and 1.0–8.0) | 0.82–0.97 / 0.77–0.98 |

Every season's points a team land within 0.2 of its record, and since 2026-11-15 its standings spread as its record's
([The spread](#the-spread): 0.13–0.19 before, whatever the record's). **The ranking holds:** the last column's first figure
is the 40 seasons' tally, the realism's measure before; the second ranks each club's expected wins, its chance against
every other club over 2,000 games each way (`expectedWins`), which no seed moves. A tally swaps close neighbours from one
seed to the next, most in a level season: 1986's reads 0.74, 0.58 before its clubs spread as its own results did. By
expected wins every computed season ranks at 0.70 or better, median 0.93: 2007 at 0.70, when margins and wins parted
most ("Computed seasons, 1998–2007"; 0.49 before), 1986 at 0.71; 2008, rated by a game, at 0.34. A season's own scoring
changes no club's expected order beyond a neighbour's swap. `npm run simulation:realism` plays five eras whole on their own
schedules (1968, 1977, 1986, 1995, 2005: `NRL_ERAS`), each within 0.25 of its points a team, 0.05 of its tries and 0.04 of
its standings' spread.

**Not modelled.** One conversion rate in every season, today's 75.5%: RLP's lists give each goal's kick only from 1986
(60–70% of all kicks then, 77–79% in 2024 and 2025), so a season's goals beyond its conversions at today's rate are its
penalty goals, and a season whose kickers converted fewer (1997's ARL: 0.1 penalty goals a side) plays its goals as
conversions. The 2-point field goal from 40 metres (2021 on) counts as one, as today's model counts it. A level game is
never left a draw.

**Saves.** A campaign of an earlier season saved before plays its next matches under version 2: their scores, extra time
and clock follow the season's day. The built-in season's campaigns are unchanged.

## The spread

Status: built 2026-11-15, the follow-up "Rules by era" left: each computed season's clubs (1960–2007, 2009–2024) now
play as far apart as its own results put them, its standings spread as its record's, and the ranking holds. Until then
a club's target was its Simple Rating System's rank read off the built-in 2025 clubs' strengths, so every season spread
as 2025 does: the model's win% spread was 0.13–0.19 whatever the record's (0.10 in 2005 to 0.25 in 1964), unrelated to
it season by season (correlation −0.04), the 1960s' and 1970s' dominant sides and stragglers too close, 1986, 2005 and
2014 too far apart. 2008, rated by a game, keeps that rule.

**Three ways weighed.** (1) Read the target off 2025's strengths scaled by the season's spread of margins against
2025's: each season would keep 2025's shape, its outliers (the 1963 Dragons, the 2016 Knights' one win in 24) only 2025's
first and last. (2) A per-season rating scale in the match model, multiplying the gap between two sides as `tries`
multiplies their try rates: the ratings would keep 2025's spread, a 1963 Dragons showing 85 and playing like 90, and
every reader of a rating (the odds, the live chart, the squad screen, a player taken in conquest) would need the season's
scale. (3), chosen: turn each club's own rating into the match model's strength, so the ratings shown carry the spread
and each season keeps its own shape.

**The target.** Each club's target is the strength the match model plays (`rugbyLeagueStrength`: the mean of its attack
and defence, backs 0.3, halves 0.225, forwards 0.475 with the bench forwards at half):

  target = 83.883 + √reliability × SRS ÷ margin

- **83.883**, the built-in 2025 clubs' mean model strength (`clubShift.mean`; `reference` lists all seventeen): every
  season's average club is a 2025 average club, as before.
- **Reliability**, the share of the ratings' variance that is the clubs' own rather than their games' luck (`srsOf`): one
  less each rating's error variance, σ² times its diagonal entry of the inverse of the constrained least-squares fit's
  normal matrix, averaged over the clubs, over the ratings' variance; σ is the margins' spread about the fit (9.9 points a
  game in 1962 to 18.4 in 2004). It runs from 0.47 (1986) and 0.52 (1981) to 0.91 (1982) and 0.92 (1995): in a level
  season most of the margins' spread is luck. Its square root, not itself: r × SRS is each club's best single estimate,
  but those estimates spread √r as wide as the clubs did (tried: the model's standings then spread 6% less than the
  record's on average).
- **Margin**, the points a game one point of model strength is worth at the season's scoring: 0.9 times the first order,
  2 × 0.14 × its tries a team game × a try's points with a conversion at 75.5% (`marginPerStrength`; 2.3 points a point in
  1967 to 5.9 in 2002). The 0.9 (`SPREAD.matched`) is the model's own, measured on all 65 computed seasons (1,500 games
  each way of every pairing under the season's rules): its margin for a point of strength is 0.949 of the first order
  (SD 0.026 across seasons; the late game's score effects, the chase, the protected lead and the eased rout, take the
  rest), and its games' margins spread 1.062 times the real game's about the SRS (SD 0.060): 0.949 ÷ 1.062 = 0.896. So a
  gap in strength gives two clubs the chance against each other that the same gap in margins gave them, and the
  standings follow. The test measures it again on six seasons.
- **The model's strength, not the rating shown.** The setup shows a club's matchday 17's rating, all seventeen alike;
  the model weighs the halves and forwards more and the bench less, so a club with a thin bench plays above the rating
  it shows. Aimed at the rating shown, the same rule (tried with the scoring solved again) would keep the shown order on
  the margins (0.98 or better) but play the model's own at 0.80–1.00 against them, the expected wins down to 0.66
  (1986), the standings within 0.016 of the record's (9 seasons more than 0.03 off) and the margins 9% wide. Aimed at the
  model's strength, every one of those is closer (below); the rating shown parts from the margins instead.

**The move.** Every player of the club moves by a whole number (`shift`), and its `plus` best (overall, then value, then
id) by one more, held to 1–99, whichever brings its model strength nearest the target; of two as near, the smaller move.
Nobody passes a player rated above him, and the club moves in steps of about a seventeenth of a point. A whole number for
all moved clubs by whole points while a level season's targets lie a tenth apart, so its order was left to rounding (the
strengths against the SRS at 0.73–0.82 in 1981, 2006 and 2018); forcing the order with whole numbers alone climbs a
staircase of half a point a club; and the unrounded overall plus tenths moves almost nothing, as Rugby League 26's
ratings at a position tie so often that most unrounded overalls are whole numbers. Every club lands within 0.06 of its
target, and the model strengths follow each season's SRS at 0.99–1.00. The moves run from −5 (the 1978 Newtown Jets, 2
wins in 22, to 79.3) to +3 (the 1963 Dragons, to 90.0).

**Results** (`--realism`, 40 seasons of each, and each club's expected wins; the 65 computed seasons):

| Measure | Before (2025's spread) | After (the season's own) |
| --- | --- | --- |
| Win% spread against the record's: mean distance | 0.030 | 0.014 |
| Seasons whose spread is more than 0.03 off / within 0.02 | 30 / 24 | 4 / 47 |
| The model's spread against the record's, season by season (correlation) | −0.04 | 0.83 |
| Best and worst records against the record's: mean distance (wins of 24) | 1.32, 1.88 | 1.06, 1.05 |
| Expected wins against the record's: lowest, median | 0.49 (2007), 0.86 | 0.70 (2007), 0.93 |
| 40 seasons' wins against the record's: lowest, median | 0.48 (2007), 0.86 | 0.74 (1986), 0.93 |
| Points a team: furthest from the record | 0.30 | 0.20 |
| Mean margin against the record's | +2% | +6% |

The scoring is solved again on the moved clubs (`npm run build:nrl-league`), so every season keeps its points, tries and
field goals. The four seasons more than 0.03 off: 1964 (0.203 against 0.247), 2013 (0.185 against 0.154), 2020 (0.195
against 0.226) and 2005 (0.138 against 0.104), the most level season of all.

**Limits.**

- **The rating shown can order neighbours otherwise** in a level season: it weighs the bench as the starters, the model
  does not. Against the SRS it ranks at 0.71 in 1986 and 2000, 0.72 in 2010, median 0.93; the model's strengths at
  0.99–1.00. In 21 of the 65 seasons the club shown strongest is not the season's best by margin (2 before), though the
  model plays that best club first in 63: the 2016 Storm, minor premiers, show 84.3 and Canberra 85.1, and the Storm play
  first. Before, it was the other way round: the shown order followed the margins and the model played another club
  first in 13 seasons. Showing rugby league's strength as the model weighs it would close the gap; that is the game's
  wider choice (2025's clubs show and play in nearly the same order, 0.97, as 2025 spreads them over 3.3 points).
- **Margins run 6% wider than the record's** (2% before): the model's games are 6% more open than the real ones, so to
  give the clubs their chances it plays them that much further apart.
- **One season's results.** The reliability takes the luck out on average, not season by season: 1964's standings still
  spread less than its record's, 2005's more.
- **Saves.** A campaign keeps its clubs as it saved them; a new one plays the seasons as they are now.

## Tests

`scripts/rugby-league.test.mjs`: the data rebuilds byte for byte; every rating and position is the snapshot's; the
nation rule; lineups, depth and the position penalties; nations and minnows; 4,000 games with a winner, a feed that adds
up and golden point ending at its score; score effects; odds and home advantage; the copy, clock and scorer line; the
feed's half-time and golden point; the live chart against the odds; the map and its campaigns; setup, the field and the
kicker; the running App launching on the map and saving. The rules by era: the built-in season the very same sport, each
earlier one its own rules object, its day's points (a try three to 1982, a field goal two to 1970, golden point from
2003) at its own scoring; 1968's games with three-point tries, two-point field goals and extra time played in full,
scoring 1968's points, tries and field goals; a game still level after a third extra time ending with a field goal on
its last minute, near a coin flip; extra time's clock, feed, scorers' line and tie-break texts; the live chart of 1965
against the odds, a lead in extra time won only at a period's end, malformed rules refused. The spread: the strength the
model plays, its attack and defence's mean, moving point for point with every player, a point of it worth its
first-order margin at any scoring.
`scripts/simulation-realism.test.mjs` holds the NRL ranges above and its home sides, five earlier seasons played whole
(`NRL_ERAS`) within their record's points, tries, field goals, draws, margins and standings' spread, `scripts/home-advantage.test.mjs` the edge and the live chart at home, `scripts/club-maps.test.mjs`
the map's state rule with Australian and New Zealand towns. `npm run smoke` adds an NRL duel with the live ticker, its map
chosen on Rugby's card (until 2026-11-19 it also ran a rugby league nations blitz of Asia and Oceania, now union's).

`scripts/rugby-league-seasons.test.mjs` covers the earlier seasons: all sixty-six rebuild byte for byte, and their
snapshots from the pinned inputs when `data-src/rugby-league-seasons/` is present. For 2008, the reader, the naming
check, the weights and every overall, the club shift and the map. For the computed seasons: NRL Fantasy's eleven
weights with a reason each and the season before at half weight; the stats each season counts, NRL.com's census of
them, and the season before only where it recorded the same (1998, 1999 and 2003 alone); who took the field (a prop in
15 started, an unused 18th man has no game) and the order positions come from; errors read as handling errors where a
game records none, and goals as conversions and penalty goals, every season keeping both; every value, overall, SRS,
reliability, target and move recomputed from each snapshot, each club within 0.06 of its target and its model strengths
in the SRS's order, nobody passing a player rated above him; the clubs of every season, twenty in 1998 down to fourteen and the
Dolphins from 2023, each under its name of that season, the defunct ones by their own ids and colours, every article
behind them pinned; each era's grounds and map, and on the maps of 1998–2007 every club holding the point it grows
from; the City of Parramatta cut only while the Bulldogs trained at Olympic Park or played at Homebush; six seasons
played 40 times with the model's wins ranking against the real ones at 0.6 or better and their standings spreading within
0.035 of their record's; the spread's 0.9 measured again on the model, six seasons' slope over their luck within 0.04; the loader's rules; and the App
launching a 2015 campaign on `nrl2012` and a 1998 one with its twenty clubs on `nrl1998`, saving and resuming each, and
a 2023 one on today's map. For the seasons before 1998: the 39 of them, their labels, kind and RLP seasons, Super League's
1997 under its own id and map; the reading of RLP's lists (starts by position, the bench no start, surnames as written, a
list checked against its results, every club code's slugs); every value recomputed from starts, representative games
and tries at the season's try rate, every overall and shift; the names of the day, the clubs gone, every ground rule (the
showpiece grounds, R1, the bases) and every cited article pinned; the eighteen maps, each club holding the point it grows
from (or, its ground on an estuary, the section of its town), Sydney's clubs alone until 1982 and the Territory empty
until Canberra moved to Bruce; each season's clubs, and each map's file, index entry and attribution, naming its
premiership; and the App launching a 1975 campaign on `nrl1973` and saving and resuming it, and Super League's 1997 on
`sl1997`, each playing its own rules, and the setup and campaign naming the NSWRFL in 1962, the NSWRL in 1990, the ARL
and Super League in 1997 and the NRL in 1998 and 2024. The rules by era: every season's points its snapshot's, its
tries and field goals its record's (recomputed from NRL.com's stats, and from RLP's pinned lists when they are on the
computer, each list adding up as its day scored), its scoring the solver's for 1968, 1997 and 2008; every season's clubs
scoring within 0.45 of its points, 0.1 of its tries and 0.05 of its field goals under its own rules, level at full time
1–6% of the time before 2003; the seasons played 40 times scoring within 0.6 of their points; and 1980, 1986, 2007 and
2009, the lowest, ranking their clubs at 0.6 or better by expected wins.

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
- **Nothing before 1960**, the floor the other sports keep: the Rugby League Project's record goes back to 1908, and the
  selection method of 1960–1997 would run on it.
- **One conversion rate in every season**, today's: a season's other goals are its penalty goals ("Rules by era").
- **Extra time stands in for the replay.** Before 2003 a campaign plays the finals' twenty minutes of extra time, and
  again where the finals replayed a game; a level game is never a draw.
