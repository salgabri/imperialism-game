# Tennis

Status: implemented 2026-11-08. A seventh sport, played by the rules of the Davis Cup: two
nations' teams meet in a tie of five rubbers, first to three. Nations only, on the world map:
tennis has no clubs. Everything outside the match (territory, the draw, targeting,
conquest, signings, saves) is the game's own, unchanged.

The player chose the format and the data: the home-and-away ties' five rubbers (rather than
the Final 8's three, or the old best-of-five sets), and Elo ratings only, with nothing
estimated.

## Data

**Source.** There is no video-game ratings list for tennis. Tennis Abstract (Jeff
Sackmann) publishes Elo ratings for the men it has enough recent matches for, updated
weekly: [atp_elo_ratings.html](https://tennisabstract.com/reports/atp_elo_ratings.html),
547 players on 2026-11-02, from Jannik Sinner's 2297 down to 1050. The same site's ATP
rankings report ([atpRankings.html](https://tennisabstract.com/reports/atpRankings.html),
2,301 players) gives each player's country (the IOC code the ATP files him under) and birth
date; the three rated players it no longer lists have their country read from their own page.

`npm run sync:tennis` (`scripts/sync-tennis.mjs`) caches the pages in the ignored
`data-src/tennis/` and writes the snapshot `scripts/data/tennis-elo.json` (50 KB,
committed): `[key, name, country, birth date, Elo, hard, clay, grass, Elo rank, ATP rank]`.
The surface Elos are kept but not played (see Known limits). Tennis Abstract's spelling is
kept as it is: no diacritics (Jiri Lehecka), "Alex De Minaur", "Christopher Oconnell".

**Ratings.** A player's rating is his Elo on the game's scale, Elo / 25 + 4, rounded:
Sinner 96, Alcaraz 91, a 1700 player 72, the list's last 46 (`scripts/lib/tennis.mjs`). A
rating point is then 25 Elo points, so the match model plays Elo's own odds. Nothing is
estimated: a player Tennis Abstract does not rate is not in the game.

**Nations.** `npm run build-tennis` (`scripts/build-tennis.mjs`, `--check` rebuilds byte for
byte) writes `src/data/rosters.tennis.js`. Each nation names its five best by Elo, as a Davis
Cup captain nominates five. Left out:

- the three the ATP no longer ranks (Gael Monfils, Kei Nishikori, Khumoun Sultanov);
- two from a country the map does not draw (Monaco's Valentin Vacherot, Hong Kong's Coleman
  Wong);
- twelve who are their nation's only rated player (Paraguay, Luxembourg, Jordan, Lebanon,
  the Dominican Republic, Moldova, Côte d'Ivoire, Morocco, Malaysia, Uzbekistan, Latvia,
  Jamaica): a tie needs two.

That leaves 52 nations, from Spain (86.1) and Italy (86) down to Thailand (58.5). A nation
without a team stays neutral land, as in women's football. Great Britain plays the Davis Cup
as one, so the home nations' shapes start in the United Kingdom's empire, which plays as Great
Britain (GBR) under the Union Jack, as in basketball, baseball and hockey. Russia and Belarus,
out of today's Davis Cup, play here.

## The team

`LINEUP_PLANS.tennis` is two singles places and two doubles places (`SGL`, `DBL`), filled by
`tennisLineup` in `src/data/teams.js` rather than by the assignment the other sports use: the
two best play the singles, the No. 1 first, and the next two the doubles. Any player plays
either, so nobody is out of position. A team of two or three plays its singles players in the
doubles too, as small nations do: Norway's doubles are Durasovic and Ruud. That place holds a
second copy of the player, marked `doubling`; `starters` lists each player once. The team's
strength weighs each place by its rubbers: the No. 1 and No. 2 two each, the pair one between
them, so (2·No.1 + 2·No.2 + ½·each doubles player) / 5.

There are no doubles ratings: the pair is the mean of its two players' singles ratings.

## The match model

`src/sports/tennis.js`.

- **The tie.** Day one: each side's No. 1 plays the other's No. 2 (the attacker's No. 1
  first). Day two: the doubles, then No. 1 against No. 1 and No. 2 against No. 2. Once a side
  has three rubbers the rest are dead and are not played, so a tie ends 3–0, 3–1 or 3–2.
- **A rubber's odds** are Elo's for the gap between the players (or the pairs), tactics,
  Upsets and the venue included: `1 / (1 + 10^(−gap·25/400))`, 64% at 4 points, 76% at 8,
  91% at 16.
- **Form.** One draw for the tie, in rating points, on every rubber: 1.5 at Balanced,
  growing with the square of the drama as in the other sports, so Predictable plays Elo's
  odds and Wild swings ties.
- **Home advantage.** The host picks the surface and fills the stands. From 2003 to 2016
  hosts won 60.9% of 322 World Group ties where Elo expected 53.1%, and the edge was larger
  in the singles than in the doubles
  ([Tennis Abstract](https://www.tennisabstract.com/blog/?p=2091)). The model gives the host
  1.8 rating points (45 Elo) in a singles rubber and 0.7 in the doubles: among the sixteen
  strongest nations that lifts the host's share of ties by 7.7 points, and equal teams' hosts
  win 60.5%.
- **Sets.** Every rubber is a best-of-three match of tie-break sets, played game by game:
  each server holds with the chance his point odds give (`holdChance`), the tie-break point by
  point, the servers alternating every game across the sets after a toss. The two players'
  point odds split the difference around the tour's 64% on serve (`serveEdge`) so that the set
  odds come out right; who serves first does not change a set's odds.
- **Day form.** With independent sets, about 44% of the ATP's best-of-three matches would go
  to a third set; about 35% do (Tennis Abstract, 2014 and 2023). So each rubber draws the
  day's form, a spread of 1 in the log-odds of winning a set, and its mean is set so that the
  match odds stay Elo's (`setLogitFor`). Between players 8 points apart a third set then comes
  35% of the time, between equals 41%.
- **One score, two paths.** The odds' fast path (`sampleResult`) draws the form and then one
  number a rubber. The full tie (`simulateTie`) makes the same draws first, so a seed gives
  the same score on both, then plays each rubber's sets given its winner, exactly: the day's
  form given the result, which sets the winner takes given the form, then each set's games
  given its winner (`playMatchWon`).
- **Walkovers.** An empty place concedes its rubber. The built-in teams have none; a custom
  or damaged save might.

## The clock and the feed

Each rubber has twenty clock units, 70 ms each at normal speed; its sets end at their share
of its games, the deciding set at the end of the block. Three rubbers make the shortest tie,
about four seconds; a fourth and a fifth extend it as overtime periods do in other sports, so
the chart's axis grows only when they are played. The clock shows the rubber ("R2 · LIVE"),
the chart ticks at the end of each ("R1", "R2", "R3"), and there is no half-time.

The score counts rubbers (`labels.score` "RUBBERS"). Every set won is an event: `pts` 1 for
the set that wins its rubber, 0 for the others, so the feed tells the story set by set while
the score moves by rubbers:

- `SET 1 — Jannik Sinner (ITA) 7–6(5)`
- `SINGLES — Jannik Sinner (ITA) 7–6(5) 3–6 6–4`, the sets from the winner's side
- `DOUBLES — Cobolli/Berrettini (ITA) 6–4 6–4`, the pair by surname, the stronger first

The scorer line under each side lists who won its rubbers: "Sinner · Cobolli/Berrettini".
`src/viewModels/match.js` keeps a set's 0 points as 0 (it used to read any falsy `pts` as 1),
and reads the archived rubber lines back for a finished tie's scorer line.

## Live win probability

`src/engine/winProbability.js`, kind `rubbers`, exact rather than approximated: the model holds
the five rubbers' gaps; the events say which rubbers and which sets of the one in play each
side has won. P(A wins) is that rubber's chance from its sets, each day-form node weighed by
how likely it made the sets already played, then the rubbers left. Match-day form is integrated
with seven-point Gauss–Hermite quadrature, as hockey's is. Games inside a set do not move the
chart; a set or a rubber always does. At the first serve it sits within sampling error of the
tie's simulated odds.

## Interface

- **Setup.** A Tennis card with a racket icon. Tennis is nations only (`nationsOnly` on the
  sport): the Clubs choice is off, a challenge link's `teams=clubs` is ignored, and the
  season reads 2026.
- **Squad.** A court from above: the No. 1 and No. 2 at the near baseline, the doubles pair
  across the net. The list groups Singles and Doubles, a player who doubles up appears in
  both, and a note says so. The profile reads Singles and Doubles, as does the tale of the
  tape before a tie. Each player's source is "Tennis Abstract Elo", with his raw Elo in the
  title and a link to his page.
- **Tactics.** A reserve supports Attack and Defend at half weight either way
  (`SUPPORT.tennis`); the options work as in the other sports.

## Realism

`npm run simulation:realism` plays the sixteen strongest nations against each other, each
pair once a season, 40 seasons (4,800 ties):

| Measure | Model | Real |
| --- | --- | --- |
| Ties won 3–0 / 3–1 / 3–2 | 26.8% / 41.0% / 32.2% | — |
| Rubbers to a third set | 36.0% | about 35% of the ATP's best-of-three matches |
| Sets decided in a tie-break | 18.6% | — |
| Sets won 6–0 | 1.6% | — |
| Favourite wins the tie | 72.1% | — |
| Host wins, Home advantage on | 58.1% (49.7% neutral) | 60.9% where Elo expected 53.1% |

The rubber odds are Elo's by construction, so who wins a rubber is as well calibrated as
Tennis Abstract's ratings are. The tie scores, the tie-break share and the favourites' share
have no real figure here: real Davis Cup ties often play their dead rubbers, which hides when a
tie was decided, and tennis-data.co.uk's match files (which would give the tour's set scores)
were not downloaded.

## Tests

`scripts/tennis.test.mjs`: the data rebuilds byte for byte; every rating is Elo / 25 + 4; who
is left out and why; the lineup and its doubling; holds, tie-breaks and sets, the same
whoever serves first; Elo's odds kept with day form, and about a third of rubbers to a third
set; 2,000 ties in the Davis Cup's order with a feed that adds up; the fast path and the full
tie agreeing seed for seed; walkovers; the copy and the clock; the live chart against the odds
and moving only with sets and rubbers; setup with nations only and challenge links; the court;
the running App launching, playing a tie and saving it. `scripts/home-advantage.test.mjs` and
`scripts/simulation-realism.test.mjs` hold the host's edge; `npm run smoke` adds a Davis Cup
campaign of Europe with the live ticker.

## Known limits

- No doubles ratings: a pair is its players' singles mean, so doubles specialists (Bolelli and
  Vavassori, Granollers, Pavić) are not in the game, and a nation's No. 3 and No. 4 play its
  doubles.
- One season, 2026, as of Tennis Abstract's update of 2 November. Its Elo report lists only the
  current ratings, and Jeff Sackmann's match archive, which would rebuild earlier seasons, is
  no longer public.
- Men only: the Billie Jean King Cup would take Tennis Abstract's women's Elo report.
- No surfaces: a host's choice of surface is in the home edge, not played. The snapshot keeps
  each player's hard, clay and grass Elo for that.
- Players by the country Tennis Abstract files them under, not by Davis Cup nominations.
