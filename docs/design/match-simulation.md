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

Level regulation scores go directly to penalties under the existing game rules.
Taker quality and the opposing goalkeeper affect conversion. Either team may take
the first kick. The shootout ends when the opponent cannot catch up within its
first five kicks; later sudden-death rounds require equal kick counts. These
termination rules follow [IFAB Law 10](https://www.theifab.com/laws/latest/determining-the-outcome-of-a-match/).
After an exceptionally long tied sequence, a bounded decisive pair uses both
teams' conditional conversion chances and records both kicks.

Only selected starters score in the timeline. Goal minutes favour the last third
of the match using design weights of 28%, 32% and 40%; multiple goals may share a
displayed minute.

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
about 1.14 points a possession in every edition. The season's rate over 113 scales
that, which brings each season's games to its league's points a game, overtime
included. Across the 26 seasons the clubs average within 1.7 points of their
league, 0.1 below it on average: 93 a side in 2003/04, 101 in 2013/14, 114 in
2023/24.

An aggregate scoring distribution represents shooting luck without running every
possession. Each team receives independent form variation, which persists into
overtime. Equal 74-rated teams average approximately 81 points each in a FIBA
regulation and 113 in a 2025/26 NBA one; ratings and opponents change that
expectation. Every pairing of the built-in NBA clubs averages about 116 points a
side, against the league's 115.6 in 2025/26; under FIBA rules they averaged 84.
Scores have no arbitrary floor or ceiling.

Tied regulation scores lead to five-minute overtime periods, from 40' under FIBA
rules and from 48' in the NBA. Every period's points appear within its own clock
interval and contribute to the final score. After four tied periods, a sampled
decisive scoring play keeps execution bounded; it can favour either side and
belongs to the last period. Commentary groups points into short runs, with a
single point allowed for a free throw, and labels each run with its quarter.

## Statistical verification

The checked-in [report](match-simulation-report.json) samples 200,000 outcomes per
pairing, eight million outcomes overall, plus 20,000 complete timelines for timing.
It covers three uncertainty settings, five rating gaps, equal teams and eight
pairings built from national rosters, so its basketball figures are FIBA's. These
equal-team results use 75-rated starters and Balanced uncertainty. The NBA rules
are checked in `scripts/basketball-simulation.test.mjs` and
`scripts/win-probability.test.mjs`.

| Measure | Football | Basketball |
| --- | --- | --- |
| Combined regulation score | 2.79 goals | 162.64 points |
| Regulation tie rate | 22.24% | 2.55% |
| Attacking side wins | 49.93% | 50.01% |
| Attacking side wins after a tie | 50.03% | 49.71% |

Synthetic stronger-team win rates against a 55-rated lineup with Balanced
uncertainty were:

| Rating advantage | Football | Basketball |
| --- | --- | --- |
| 5 | 68.56% | 65.12% |
| 10 | 82.96% | 78.25% |
| 20 | 96.23% | 94.04% |
| 40 | 99.56% | 99.90% |

At a ten-point advantage, Predictable and Wild produced 87.23% and 75.64%
football win rates, and 81.46% and 72.29% basketball win rates. Increasing
uncertainty raises upset chances while retaining a meaningful strength advantage.

Historical reference anchors inform broad scoring targets: Qatar 2022 recorded
172 goals in 64 matches, or 2.69 per match, according to
[FIFA's tournament summary](https://publications.fifa.com/en/annual-report-2022/2022-at-a-glance/fifa-world-cup-qatar-2022-summary/).
The [FIBA 2023 scouting report](https://assets.fiba.basketball/image/upload/documents-corporate-studies-and-facts-fiba-scouting-report-fiba-basketball-world-cup-2023.pdf)
reports 169 combined points per game on page 3. These aggregates include mixed
opponent strengths and additional periods. Synthetic tests use broad design bands;
the model has not been fitted to historical results or validated as a forecast.

## Performance and reproduction

The recorded Windows Node 24 run sampled approximately 3.4 million prepared
outcomes per second for each sport. Complete timelines ran at approximately
31,000 football and 95,000 basketball matches per second. A fresh 1,024-sample
odds estimate took 1.20 ms for football and 0.39 ms for basketball. These are
local timing observations, separate from live ticker presentation delays,
and are not timing requirements in the tests.

All randomness comes from the injected campaign generator. Identical seeds,
settings, model version and manager choices reproduce campaigns. RNG state
resumes from saves; existing generated match outcomes remain stored. Football and
FIBA basketball have simulation version 2; NBA basketball has version 4. Club
campaigns played FIBA rules before version 3, and version 3 played every season
at one pace. New results from an older seed can differ after upgrading the model.

Run `npm run test:simulation` for distribution, symmetry, positional strength,
seed replay, RNG endpoint, penalty/overtime and event-accounting checks. React
ticker tests verify that batched scoring callbacks preserve every event and
penalties reveal in the sampled order. `npm test` includes these regressions;
`npm run smoke` plays production App campaigns to completion.
To reproduce the diagnostic report, run:

```bash
npm run simulation:report -- --samples=200000 --full=10000 --out=docs/design/match-simulation-report.json
```
