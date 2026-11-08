# Rugby league

Status: implemented 2026-11-08. A seventh sport: the 17 NRL clubs fight over Australia and New Zealand on the NRL's
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

**Nations.** A player plays for the nation he played a Test for in 2025 (59 players); without a Test, for the country
he was born in (423); born off the map or where Zero Tackle does not say, for the first nation on the map he is
eligible for (14). **Tonga, Samoa and the Cook Islands have no land on the game's world map** (its 1:110m atlas leaves
them out), so their 46 Test players play for no nation, nor do 49 others born there or with no eligibility on the map:
95 in all. Five nations field NRL players: Australia (90), New Zealand (86), England (74), Fiji (69) and Papua New
Guinea (58). A lineup place a nation's own players cannot fill is the game's to fill with a generated player at the
nation's strength, as in hockey; a nation with no NRL players is a minnow at the baseline, 45. England, Scotland and
Wales play as themselves; Ireland is the whole island, so Northern Ireland's shape starts in Ireland's empire.

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

## Tests

`scripts/rugby-league.test.mjs`: the data rebuilds byte for byte; every rating and position is the snapshot's; the
nation rule; lineups, depth and the position penalties; nations and minnows; 4,000 games with a winner, a feed that adds
up and golden point ending at its score; score effects; odds and home advantage; the copy, clock and scorer line; the
feed's half-time and golden point; the live chart against the odds; the map and its campaigns; setup, the field and the
kicker; the running App launching on the map and saving. `scripts/simulation-realism.test.mjs` holds the NRL ranges above
and its home sides, `scripts/home-advantage.test.mjs` the edge and the live chart at home, `scripts/club-maps.test.mjs`
the map's state rule with Australian and New Zealand towns. `npm run smoke` adds an NRL duel with the live ticker and a
rugby league nations blitz of Asia and Oceania.

## Known limits

- **The 2025 season.** Rugby League 26 has had one ratings release, July 2025, so the clubs are 2025's: the Perth Bears
  (2027) are not in it, and players who have moved since play for their 2025 clubs.
- **NRL players only.** Super League's players are not in the list (Zero Tackle published only each club's best), so
  England is thin and fills three places with generated players, Fiji five and Papua New Guinea eleven.
- **No Tonga, Samoa or Cook Islands.** Their Test players sit out the nations game; adding the islands to the world map
  would change every sport's.
- **Nations campaigns are a two-horse race.** Five nations field NRL players and the rest are minnows, so Australia wins
  87% of Elite 32 campaigns and 83% of world wars, New Zealand nearly all the others (`probeCampaign` in
  `scripts/balance.mjs`: 300 and 60 seeded campaigns); in Asia and Oceania Australia won all 300.
- **Tiny Sydney territories.** Ten clubs share New South Wales, eight of them in Sydney. Hemmed in by their neighbours,
  the Roosters (50 km²), the Rabbitohs (133 km²) and the Wests Tigers (145 km²) start with an inner-Sydney council area or
  two, smaller even than Washington's District of Columbia; Parramatta and Penrith take the west of the state.
- **One conversion rate.** Every kicker converts 75.5%: the game's overall says nothing of goal-kicking.
- **No two-point field goals, sin bins or penalty counts:** a try, a goal and a field goal are all there is.
