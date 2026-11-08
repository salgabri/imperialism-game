# Match simulation model and verification

The football and basketball models resolve matches quickly while keeping team
quality meaningful and outcomes uncertain. Each sport prepares its selected
lineups, samples a score and tie break, and builds a timeline for that result.
Pre-match odds use the same score sampler with an independent random stream.
They avoid generating scorers or commentary for every trial.
Extreme estimates display as `<1%` or `>99%` so rounded percentages do not imply
that a match result is guaranteed.

## Football scoring and penalties

The 4-4-2 lineup supplies separate attacking and defensive ratings. Forwards
provide 56% of attacking strength, midfielders 36% and defenders 8%. Defence
uses defenders 58%, goalkeeper 24%, midfielders 16% and forwards 2%. These are
design weights applied to the roster's overall ratings; the data does not contain
individual finishing, passing or penalty attributes.

Each side's attacking quality faces the opponent's defence. This sets a positive
goal rate using an exponential relationship, with smooth saturation for extreme
rating gaps. A shared tempo affects both teams, while match-day form shifts the
advantage between them. Independent Poisson draws supply scoring luck, including
at Predictable uncertainty. Underdogs retain a positive chance to score.

Form's spread is 0.28 in log scoring rate at Balanced and grows with the square
of the Upsets drama: 0.03 under Defend, 0.94 under an all-out Attack, 1.12 at
Wild. Goals are already Poisson luck, so the old linear 0.45 at Balanced made one
equal game in eleven a four-goal rout and cut league draws to 18–20%; the square
keeps Wild and Attack as swingy as before, and leaves a favourite that defends
steadier odds than one that plays Balanced. Real scores also hold more 0-0 and
1-1 draws, and fewer 1-0 wins, than two independent Poisson counts: a score in
that block is redrawn from its Dixon–Coles masses (ρ = −0.12; Dixon and Coles,
1997), which keeps both sides' means and so their chances in a shoot-out.

Level regulation scores go directly to penalties under the existing game rules.
Taker quality and the opposing goalkeeper affect conversion: about 73% of kicks
are scored, as across the World Cups (68.6%) and the Euros (77.0%). Either team
may take the first kick. The shootout ends when the opponent cannot catch up
within its first five kicks; later sudden-death rounds require equal kick counts.
These termination rules follow
[IFAB Law 10](https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/).
After an exceptionally long tied sequence, a bounded decisive pair uses both
teams' conditional conversion chances and records both kicks.

Only selected starters score in the timeline: forwards by weight 5, midfielders
1.7, defenders 0.6 and the goalkeeper 0.06, times the rating above 55, so
forwards score about half the goals, midfielders a third and defenders one in
eight, as in Europe's top leagues. Goal minutes favour the last third of the
match using design weights of 29%, 33% and 38% (45.5% of goals before half-time);
multiple goals may share a displayed minute.

## Basketball scoring and overtime

One model plays two rulebooks. National teams play FIBA matches: four ten-minute
quarters, with both sides sharing a sampled possession count around 73. Clubs are
NBA franchises and play NBA matches: four twelve-minute quarters at their season's
league pace. A club campaign picks the NBA rules for its season (`matchSport` in
`src/sports/index.js`). The NBA clock runs faster, 79 ms a minute against 95, so a
match lasts about as long on screen. Guard and wing ratings carry more offensive
weight, while big players contribute more to defence. Expected points per
possession depend on offence and the opposing defence, under either rulebook.

Each NBA season plays at its league's pace and scoring rate, from
Basketball-Reference's league averages (`src/data/nbaLeagueAverages.js`): 90.1
possessions and 102.9 points per 100 in 2003/04, 99.4 and 115.7 in 2025/26. The
built-in 2026/27 season plays at 2025/26's until its own season is complete. 2K
rates players against their own era, so ratings alone give an NBA starting five
about 1.14 points a possession in every edition. The season's rate over 114
scales that, which brings each season's games to its league's points a game,
overtime included. Across the 26 seasons the clubs average within 1.9 points of
their league, level with it on average: 93 a side in 2003/04, 101 in 2013/14, 114
in 2023/24.

An aggregate scoring distribution represents shooting luck without running every
possession: a period's points vary by possessions × (0.36 + 0.25 × efficiency),
and both sides share the game's conditions (a 0.042 points-a-possession swing:
whistle, flow, garbage time). Each team also receives independent form variation,
0.0095 points a possession per point of drama, which persists into overtime, and
each rating point of offence is worth 0.012 points a possession, of the opposing
defence 0.0078. Between equal NBA sides the regulation margin then varies by about
14 points and the total by about 19 at Balanced. A season of the built-in clubs
ends games 12.6 points apart, 16% within three and 21% by twenty or more, and
spreads the standings from about 67 wins to 19, as the NBA's last seasons did; the
old spreads made a third of games 20-point routs while bunching the standings
between 59 wins and 25. Equal 74-rated teams average approximately 81 points each
in a FIBA regulation and 112 in a 2025/26 NBA one; ratings and opponents change
that expectation. Every pairing of the built-in NBA clubs averages about 116
points a side, against the league's 115.7 in 2025/26; under FIBA rules they
averaged 84. Scores have no arbitrary floor or ceiling.

A side one or two points behind at the end of regulation draws level at the
buzzer 30% or 20% of the time (a putback, a free throw, a foul-line two), and that
basket is regulation's last event, a starter's. About one NBA game in twenty goes
to overtime, as in the league (4.7–6.4% in 2021/22–2024/25), twice what the
margin's spread alone gives. Tied regulation scores
lead to five-minute overtime periods, from 40' under FIBA rules and from 48' in
the NBA. Every period's points appear within its own clock interval and contribute
to the final score. After four tied periods, a sampled decisive scoring play keeps
execution bounded; it can favour either side and belongs to the last period.

Commentary groups points into short runs, with a single point allowed for a free
throw, and labels each run with its quarter. A side's points over a period follow
a random walk tied to its total: four-minute stretches each score their share with
the shooting luck of their possessions (a Gaussian bridge), and a run falls when
that path reaches its middle point. Evenly spaced runs drew every lead as a
straight line to the final score, so the side ahead at half-time won nine games in
ten; now it wins about four in five. The datasets name each side's starting five
only, so 32% of the runs go to the "Bench", which with the buzzer's baskets a
starter's scores about 30.8% of the points (NBA benches: 30.1% and 31.2% in
2023/24 and 2024/25). Each starter holds a share of the rest for the match: the
best player's is the largest, each rating point below him takes 7.5% off, guards
and wings shoot a little more, and a hot or cold hand moves it about a third
either way. Each run goes to someone still short of his share, so a starter's
points follow it as a box score's do: the league's leading scorers average 28 to
34 a night, one side in sixteen has a 40-point scorer and one in 140 a 50-point
one, as in the NBA. Crediting each whole run at random among the five gave the top
scorer 40 points a night. The scorer line under the score names the top two
players, never the bench.

## Statistical verification

The checked-in [report](match-simulation-report.json) samples 200,000 outcomes per
pairing, twenty-eight million outcomes over the seven sports, plus 10,000 complete
timelines a sport for timing. It covers three uncertainty settings, five rating
gaps, equal teams and four pairings a sport built from national rosters, so its
basketball figures are FIBA's. These equal-team results use 75-rated starters and
Balanced uncertainty. The NBA rules are checked in
`scripts/basketball-simulation.test.mjs` and `scripts/win-probability.test.mjs`.

| Measure | Football | Basketball | Ice hockey | Tennis |
| --- | --- | --- | --- | --- |
| Combined regulation score | 2.65 goals | 162.76 points | 6.30 goals | 4.11 rubbers |
| Regulation tie rate | 27.42% | 7.05% | 23.43% | none: a tie is never level |
| Attacking side wins | 50.17% | 50.04% | 50.07% | 50.05% |
| Attacking side wins after a tie | 49.97% | 49.67% | 50.21% | — |

Synthetic stronger-team win rates against a 55-rated lineup with Balanced
uncertainty were:

| Rating advantage | Football | Basketball | Ice hockey | Tennis |
| --- | --- | --- | --- | --- |
| 5 | 70.65% | 74.40% | 76.30% | 79.05% |
| 10 | 85.63% | 90.48% | 91.48% | 94.44% |
| 20 | 97.11% | 99.57% | 98.97% | 99.83% |
| 40 | 99.61% | 100.00% | 99.89% | 100.00% |

At a ten-point advantage, Predictable and Wild produced 87.39% and 72.61%
football win rates, 93.94% and 83.15% basketball win rates, 92.05% and 83.82%
in ice hockey, and 94.85% and 87.89% in tennis, where every one of a team's players carries the advantage into
each of its rubbers. Increasing uncertainty raises upset chances while retaining a
meaningful strength advantage. Women's football plays football's model, so on the
same 75-rated lineups its figures match football's within sampling error.

Historical reference anchors inform broad scoring targets: Qatar 2022 recorded 172
goals in 64 matches, or 2.69 per match, according to
[FIFA's tournament summary](https://publications.fifa.com/en/annual-report-2022/2022-at-a-glance/fifa-world-cup-qatar-2022-summary/).
The [FIBA 2023 scouting report](https://assets.fiba.basketball/image/upload/documents-corporate-studies-and-facts-fiba-scouting-report-fiba-basketball-world-cup-2023.pdf)
reports 169 combined points per game on page 3. These aggregates include mixed
opponent strengths and additional periods. Synthetic tests use broad design bands;
the next section measures whole league seasons against the real leagues instead.
The model is not a forecast of real fixtures.

## Realism against real leagues

`npm run simulation:realism` (`scripts/simulation-realism.mjs`) plays whole
seasons with the built-in clubs at Balanced: double round robins of Europe's top
five football leagues, 82-game NBA seasons, 17-game NFL seasons, 162-game MLB
seasons and 82-game NHL seasons, the attacker and defender drawn as the round robin
falls. Tennis has no league: the sixteen strongest nations play each other once a season,
in Davis Cup ties ([tennis.md](tennis.md) has its table). Football's club layer keeps only Europe's 124 strongest clubs, so each league
plays whole: its clubs come from the same EA FC 27 snapshot, with the XIs the club
layer gives them (`scripts/lib/first-divisions.mjs`). It sets each
measure beside the real league's range over recent seasons; `REAL` in the script
names the seasons and sources, and `scripts/simulation-realism.test.mjs` holds the
sourced measures the models set out to match. The real figures were gathered on
2026-11-01 from ESPN's and NFL.com's season tables (league totals computed from
the per-team tables), Land of Basketball, StatMuse, TSN, The Analyst, RSSSF,
NFL margin data for 1999–2025 and Laura Albert's NFL analytics recaps
(UW–Madison) for two-point tries.

The first run, before this pass, measured the models as they shipped; "now" is 40
seasons of each league after it (football: the five leagues' mean). Football's "now"
was measured again on 2026-11-08 with the same clubs, listed strongest first, which
reshuffles the seeded draws: in the old order it gives the figures first published
(2.87 goals, 23.9% draws, 7.9% goalless, 45.3% before half-time, champions 84–97).

| Football | Before | Now | Real (2021/22–2024/25) |
| --- | --- | --- | --- |
| Goals a game | 3.01 | 2.88 | 2.50–3.28 |
| Draws | 19.6% | 24.0% | 20.3–29.5% |
| 0-0 | 6.1% | 7.8% | 2.9–9.6% |
| Goals by forwards / midfielders / defenders | 45 / 43 / 12% | 53 / 35 / 12% | about 45–50 / 30–35 / 10–13%, own goals 3% (est.) |
| Goals before half-time | 44.0% | 45.5% | about 45–47% |
| Shoot-out kicks scored | 76% | 74% | 73.1% at the major tournaments |
| Champion's points (per 38 games) | 83–96 | 84–98 | 79–101 |

| NBA | Before | Now | Real (2021/22–2024/25) |
| --- | --- | --- | --- |
| Points a team | 116.7 | 116.8 | 110.6–114.7 (115.7 in 2025/26, the built-in season's) |
| Overtime | 2.1% | 5.2% | 4.7–6.4% |
| Mean margin | 16.1 | 12.6 | 11.2–12.6 |
| Decided by 3 or fewer / by 20 or more | 12.9% / 33.1% | 16.0% / 21.2% | 13.6–15.7% / 15–21% (22.8% in 2025/26) |
| Spread of winning percentages | 0.099 | 0.143 | 0.120–0.161 |
| Best and worst records | 59–25 | 67–19 | 58–68 wins, 14–20 wins |
| Team's top scorer / 40-point games / 50-point games | 39.7 / 45.6% / 12.8% | 27.6 / 6.3% / 0.74% | — / 4.8–8.3% / 0.7–1.0% |
| Bench's share of the points | none | 30.8% | 30.1–31.2% |

The NFL has a third column: its scoring values (touchdown tries, safeties and the
late-game play-calling that sets the key margins, simulation version 3), measured
after the pass.

| NFL | Before | Pass | Now | Real (2021–2025) |
| --- | --- | --- | --- | --- |
| Points a team | 22.6 | 22.3 | 22.7 | 21.8–23.0 |
| Overtime | 4.7% | 5.5% | 5.6% | 4.8–7.7% |
| Mean margin | 13.0 | 11.3 | 11.3 | 11.1 |
| One-score games (8 or fewer) | 41.4% | 47.4% | 53.6% | 50.7–57.6% |
| Decided by exactly 3 / exactly 7 | 8.5% / 11.0% | 10.8% / 13.5% | 15.2% / 7.9% | 15.2% / 7.7% |
| Spread of winning percentages | 0.157 | 0.175 | 0.172 | 0.159–0.215 |
| Touchdowns: WR / RB / TE / QB / returns and defence | 60 / 21 / 12 / 4 / 3% | 38 / 34 / 15 / 8 / 6% | 38 / 34 / 15 / 8 / 6% | 35–40 / 32–35 / 13–17 / 7.5–9 / 5–6% |
| Extra points made | all | all | 94.5% | 93.4–95.9% |
| Touchdowns going for two / made | none | none | 9.9% / 49% | 9.8% (2024) / 40–56.5% |
| Safeties a season | none | none | 13 | 8–17 |

| MLB | Before | Now | Real (2022–2025) |
| --- | --- | --- | --- |
| Runs a team | 4.46 | 4.48 | 4.28–4.62 |
| Extra innings | 9.5% | 9.6% | 8.3–8.9% |
| One-run games | 30.5% | 27.5% | 27.8–29.4% |
| Spread of winning percentages | 0.095 | 0.076 | 0.071–0.089 |
| Best and worst records | 112–51 | 106–56 | 97–111 wins, 41–55 wins |

Ice hockey arrived after this pass, calibrated from the start, so it has no "before".
Its real ranges were computed on 2026-11-07 from every game of the five seasons in
the NHL's own API; [hockey.md](hockey.md) has the whole table.

| NHL | Now | Real (2021/22–2025/26) |
| --- | --- | --- |
| Goals a team | 3.05 | 3.01–3.14 |
| Overtime or shoot-out / shoot-outs | 23.2% / 7.5% | 20.7–24.9% / 5.9–9.1% |
| Won by one / by two | 42.8% / 19.2% | 38.1–43.2% / 17.5–21.9% |
| Won by three or more / five or more | 38.0% / 6.4% | 39.3–41.7% / 5.5–6.5% |
| Spread of winning percentages | 0.097 | 0.082–0.127 |
| Best and worst records | 57 wins, 24 wins | 55–65 wins, 19–25 wins |

Known gaps, reported but not tested:

- **No home advantage by default.** Every sport plays at a neutral venue unless a
  campaign turns on Home advantage (below), so the defending side wins half its
  games. Real home sides win 41–48% of football games in ninety minutes, 54–58% in
  the NBA, 52–56% in the NFL, 52–54% in MLB and 52–56% in the NHL.
- **Football leagues' styles.** Every league scores at one base rate, so La Liga
  (2.5–2.6 goals a game in life) scores like the Bundesliga (3.1–3.2). Top-32
  nations score about 2.9 a game against about 2.5 in World Cup group stages.
- **Shoot-outs straight after 90 minutes.** The game's rules skip extra time, so
  every level knockout game is decided on penalties: about 25% of games between
  strong nations, against about 20% of World Cup knockout games after extra time.
- **MLB's worst clubs** win about 56 games, where the real worst won 41–55: The
  Show's lowest-rated lineups sit closer to the middle than the worst real clubs.
- **The NHL's wins by three or more** run at 38.0%, under the real 39.3–41.7%.
  Closing the gap pushes the five-goal wins out of their range.
- **Women's football is not calibrated.** It plays the men's model and is not in the
  harness. Its leagues draw more often than the four real ones measured (22.7–25.6%
  of games against 13.6–21.7%) and score more alike:
  [womens-football.md](womens-football.md#known-limits) has the figures.

## Home advantage (optional)

Matches are at a neutral venue unless a campaign turns on **Home advantage** at
launch (More rules; off by default, listed under This campaign when on, and
carried by challenge links as `home=on`). On, the defender, which holds the
territory under attack, plays at home. Each sport's edge lives in its prepared
match (`prepareMatch(attacker, defender, effA, effD, { home: true })`), so the
result, the pre-match odds and the live chart read the same edge. The odds add a
`|home` to their cache key and sample seed; a neutral match keeps the key it always
had, so neutral campaigns replay exactly as before. Each edge is sized so that equal
sides win at home about as often as home sides do in the sport's league:

| Sport | The edge at home | Worth | Equal sides win at home | Real home sides |
| --- | --- | --- | --- | --- |
| Football | ±0.15 in log scoring rate: 0.39 goals a game | 2.1 rating points | 44–45% in 90 minutes, 58% after the (even) shoot-out | 40.8–47.9% in 90 minutes |
| Basketball | ±0.012 points a possession: 2.4 points a game (NBA), 1.8 (FIBA) | 1.2 | 57% (NBA), 56% (FIBA) | 54.3–58.0% (NBA) |
| American football | ±0.65 rating points of drive edge: 1.2 points a game | 0.65 | 54% | 51.5–55.7% |
| Baseball | ±1.4 rating points of half-inning edge for the side batting last: 0.34 runs a game | 1.4 | 53% | 52.1–54.3% |
| Ice hockey | ±0.05 in log scoring rate: 0.30 goals a game | 0.9 | 55% | 52.2–56.3% |
| Women's football | Football's | 2 | 45–46% in 90 minutes over each league's pairings, 56–58% after the shoot-out | 41.7–47.7% in 90 minutes (four leagues, one season each) |
| Tennis | 1.8 rating points (45 Elo) in a singles rubber, 0.7 in the doubles | 1.6 | 60% of ties | Davis Cup hosts won 60.9% of World Group ties where Elo expected 53.1% |

"Worth" is the rating advantage an attacker needs for an even match against a home
defender; a manager's Attack approach adds 0.6 rating points, plus up to 1.2 for
bench support.

Whole league seasons with the rule on (`npm run simulation:realism -- --home`, 40
seasons) put every league's home sides inside the real range: 44.7–46.0% home wins
in ninety minutes across the five football leagues (40.8% in the 2024/25 Premier
League to 47.9% in the 2022/23 La Liga, from FootballRates and Statista), 55.9% in
the NBA, 53.4% in the NFL, 53.1% in MLB and 54.6% in the NHL, and Davis Cup hosts among the sixteen strongest tennis
nations win 58.1% of their ties (49.7% at a neutral venue; [tennis.md](tennis.md)). Every other measure
stays in its range, bar two of the NHL's: wins by three or more stay a little low
(38.3%) and wins by five or more edge over the top (6.7%, real 5.5–6.5%). Football's
draws stay at 23–25%. `scripts/simulation-realism.test.mjs` checks the
home sides with the rule on, and half the decided games without it;
`scripts/home-advantage.test.mjs` covers the setting from setup to saves.

### What it does to a campaign

`npm run balance -- --runs=200`, with and without `--home`: the elite 32 nations
under the blitz, chaos and one-by-one draws, each with a single and a best-of-three
final, so 1,200 campaigns a sport. American football's nations are fallback
strengths, as no source rates national teams. Distinct champions are per 200
campaigns:

| Elite-32 nations | Attackers win | Top-five champions | Most frequent champion | Champion's starting rank | Distinct champions |
| --- | --- | --- | --- | --- | --- |
| Football | 47.4% → 39.7% | 42% → 43% | 11% → 11% | 9.9 → 9.8 | 31 → 31 |
| Basketball | 47.2% → 42.6% | 84% → 85% | 65% → 63% | 3.1 → 3.1 | 17 → 17 |
| American football | 49.9% → 46.1% | 34% → 38% | 9% → 9% | 11.6 → 10.8 | 48 → 47 |
| Baseball | 47.4% → 45.0% | 76% → 75% | 33% → 33% | 3.6 → 3.6 | 14 → 15 |
| Women's football | 46.8% → 40.6% | 59% → 59% | 18% → 20% | 5.8 → 5.9 | 20 → 22 |
| Ice hockey | 44.3% → 41.4% | 97% → 96% | 31% → 31% | 2.5 → 2.6 | 7 → 7 |
| Tennis | 46.9% → 40.9% | 75% → 75% | 36% → 40% | 4.3 → 4.2 | 21 → 20 |

Women's football's elite 32 are its strongest rated nations, and England, Spain and
the United States take 9–17% of the titles each. Tennis's are its 32 strongest nations; Italy (Sinner, 96)
and Spain (Alcaraz, 91) take about 62% of the titles between them. Ice hockey's are its 16 NHL nations
and 16 minnows at the baseline of 45, so its titles stay at the top: the United
States, Canada and Russia win 23–31% each, and the champion started in the top five
in 96–97% of campaigns. The probe has routed over the App's merged map since these
two rows (`mergeSharedIds`, `drawnPaths`): unmerged, Australia was the Ashmore and
Cartier reef that shares its id, and one hockey campaign in 200 under the
one-by-one draw ended with no route between its last two. The four rows above them were
measured before that fix; none of their campaigns stalled. Tennis's row routes over the merged map too.

The App's own campaigns (`node scripts/production-balance.mjs --home=off,on`, 80
for each setup: elite nations with a manager, elite European clubs, and the NBA,
NFL and MLB clubs) agree.

- **Campaigns are as long.** Every match still ends with the loser's whole empire
  changing hands, so 32 teams still take 31 matches (32.1–32.5 games with a
  best-of-three final), and the lead changes hands as often. A failed attack hands
  the defender the attacker's territory, so the rule moves conquests from attackers
  to defenders rather than slowing the war.
- **Attacks fail more often**, in every probe and every App setup: by 6 to 9
  points in football, where the edge is worth two rating points, and by 2 to 7
  elsewhere.
- **Champions are as predictable.** The favourites' share of titles, the most
  frequent champion's (basketball's USA) and the champion's starting rank stay
  within a few points. Only American football's fallback nations lean a little
  towards the favourites. At 40 campaigns a setup the champions seemed to spread
  out; at 200 that was noise.
- **A manager's run is unchanged.** In 80 App campaigns a sport (elite nations,
  random one-by-one draw, a mid-ranked team managed by the best displayed odds), the
  managed team plays 1.6–1.8 matches and finishes 13th to 17th either way. Every
  target it picks under "You choose" is now an away match, so the pick matters
  more.
- **A best-of-three final keeps its attacker**, so its defender hosts all three
  games: between equal football sides it wins the series 62% of the time (58% a
  game). Alternating the venue, the second game at the attacker's home, would make
  it 54%; that needs a venue per game rather than per campaign.

The rule stays off by default: whether conquest should favour the defender is a
balance decision, not a realism one.

## Performance and reproduction

The recorded Windows Node 26 run sampled approximately 4.7 million prepared
football outcomes per second, 3.2 million basketball ones, 1.2 million ice hockey
ones and 5.1 million tennis ones. Complete timelines ran at approximately 69,000 football, 57,000 basketball,
9,600 hockey and 1,400 tennis matches per second: a tie plays every rubber game by game. A fresh 1,024-sample
odds estimate took 1.09 ms for football, 0.38 ms for basketball, 2.69 ms for hockey and 0.76 ms for tennis. These are local timing observations, separate from live ticker
presentation delays, and are not timing requirements in the tests.

All randomness comes from the injected campaign generator. Identical seeds,
settings, model version and manager choices reproduce campaigns. RNG state
resumes from saves; existing generated match outcomes remain stored. Football,
FIBA basketball and American football have simulation version 3, NBA basketball
version 5 and baseball version 2 (the realism pass above; American football's
version 3 added its touchdown tries and safeties). Ice hockey, women's football and
tennis are at version 1. Club campaigns played
FIBA rules before NBA version 3, and version 3 played every season at one pace.
New results from an older seed can differ after upgrading the model.

Run `npm run test:simulation` for distribution, symmetry, positional strength,
seed replay, RNG endpoint, penalty/overtime and event-accounting checks. React
ticker tests verify that batched scoring callbacks preserve every event and
penalties reveal in the sampled order. `npm test` includes these regressions;
`npm run smoke` plays production App campaigns to completion.
To reproduce the diagnostic report, run:

```bash
npm run simulation:report -- --samples=200000 --full=10000 --out=docs/design/match-simulation-report.json
```
