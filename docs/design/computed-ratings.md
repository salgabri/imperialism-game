# Computed ratings: rosters and ratings from real statistics

How to build a season's rosters and ratings when nothing rates its players: no game, no fan database, no published list.
The repo already computes seasons this way in every sport but college football, each sport with its own rule. This
document turns what those rules learned, plus a new back-test, into one method for the next gap. Tuning it needs no game data. Written 2026-11-17 at the
user's request: "a good strategy for roster building and rating building when all else is missing … based on real data
and real statistics".

The evidence is reproducible from committed data, with no network: `node scripts/computed-ratings-backtest.mjs`
(`--json` for the full report). Figures quoted from earlier work name the design doc they come from.

## Ground rules (unchanged)

- **Real players only.** A team fields only when its own rated players hold at least half its lineup (`fieldsRealSide`,
  src/data/teams.js). A nation or club the data cannot fill does not play. No names are generated.
- **Facts in, our rating out.** Inputs are facts: who played, how often, what they produced, what their team won. They
  come from sources whose robots.txt and terms allow it, fetched through `scripts/lib/polite-fetch.mjs`, pinned by SHA-256,
  and rebuilt byte for byte with `--check`.
- **Labelled.** The Season list says "computed", and `source.conversion` states the formula and its constants.

## What the evidence says

Every figure below is Spearman's rank correlation with a game's overall, within position group, unless it says otherwise.
A game's rating is a stand-in for true ability, so these figures measure agreement with how a game rated the players.

| Measured against a game | Selection only | Production only | Both (data-weighted) | Repo's tuned rule |
| --- | --- | --- | --- | --- |
| Hockey forwards, 5 EA editions (1,934 players) | 0.559 (ice time 0.787, NHL 22) | 0.869 | **0.886** | 0.887 |
| Hockey defencemen (1,036) | 0.617 (ice time 0.815, NHL 22) | 0.772 | **0.840** | 0.814 |
| Hockey goalies (317) | 0.766 | 0.589 | **0.799** | 0.708 |
| NFL 2000 against Madden NFL 2002, 10 positions (1,234) | 0.662 (QB 0.791, K 0.324) | n/a | n/a | 0.745 |
| MLB hitters 2015–17 against The Show 18 (564) | 0.772 | 0.823 | 0.817 | 0.842 |
| MLB starters (199) | 0.614 | 0.745 | 0.720 | 0.768 |
| MLB relievers (349) | 0.623 | 0.707 | 0.665 | 0.744 |
| Rugby league 2025 against RL26 (rugby-league.md) | 0.682; 0.742 with 2024 at ½ | 0.797 | n/a | 0.761 (stats), 0.743 (selection) |

How the columns are built:
- **Selection** is the share of the club's games or minutes a player had.
- **Production** is his scoring or WAR rate, shrunk toward replacement level by a prior measured from the data.
- **Both** adds the two as z-scores, each weighted by its own year-to-year stability.
- The repo's rules were tuned against the games themselves. Baseball's was tuned on The Show 18–24, which includes the
  edition tested here, so its figure is partly in-sample.

What the numbers show:

1. **Selection carries most of the signal, and it is the evidence that goes back furthest.** Who played, and how much,
   alone reaches 0.56–0.79 for most groups. Rugby league's team lists show the same: 0.68 from one season, 0.74 with the
   season before. A coach's selection is a judgement made with far more information than any box score, and team lists
   exist decades before box scores do.
2. **Production adds where it measures the job and hurts where it is mostly luck.** Points a game is a forward's job:
   0.87 against usage's 0.56. A goalie's save percentage correlates only 0.12–0.44 from one season to the next, so on its
   own it ranks goalies worse (0.59) than how often they were picked (0.77). Kickers are the reverse: starts mean
   nothing (0.32), field goals everything (rule 0.85).
3. **The prior that shrinks a rate can be measured, not guessed.** It is noise variance divided by talent variance,
   computed among regulars by the method of moments:
   - Points a game: forwards 5.0–7.4 games, defencemen 6.6–10.4. The repo's hand-set prior is 10 games.
   - Save percentage: 661–980 shots for 1992/93–2006/07, and 2,279 for 2021/22, when goalies differed less. The repo's
     hand-set prior is 600 shots, too weak for the modern game.
   - WAR, whose noise is neither Poisson nor binomial: from its year-to-year reliability r at the typical playing time
     n̄, k = n̄(1 − r)/r. That gives hitters 1,113 PA, starters 242 IP and relievers 613 IP.
4. **The blend's weights can come from the data's own stability.** Weight each z-scored signal by √rel ÷ (1 − rel), where
   rel is its rank correlation between consecutive seasons. This uses no game rating, and in hockey it matches or beats
   the rule tuned on EA:
   - forwards 0.886 against 0.887;
   - defencemen 0.840 against 0.814;
   - goalies 0.799 against 0.708.
   In baseball it trails production alone by 0.006–0.042: playing time there is steadier than it is telling. So where any
   game has ever rated the sport, tune these two weights on it once and freeze them, as the NFL, MLB and NBA rules did
   with theirs. Shrinking each rate toward what selection predicts, instead of blending, did worse in hockey (goalies
   0.664, defencemen 0.788) and was dropped.
5. **One season is not enough.**
   - Rugby league's selection value went from 0.682 to 0.742 when the season before was added at half weight.
   - The NBA's single-season score rates Bob Rule 85 from four games, because box-score rates there are not shrunk for
     games missed (football-years.md, "Earlier basketball seasons").
6. **Players alone make clubs too even and partly misordered.** Bottom-up club strengths:
   - follow real results at 0.79 (NBA against SRS), 0.82 (MLB against win share) and 0.62 (EuroLeague against the record);
   - in rugby league, at 0.60 from selections alone;
   - spread too little: NHL computed clubs sit at 0.6–0.8 of an EA edition's spread, and NBA computed seasons have a
     club SD of 1.37–2.37 against the games' 1.80–3.70 (hockey.md, football-years.md, baseball.md, euroleague.md).
   Noise in individual ratings averages out toward the middle, so every computed season plays more evenly than it was.
   Rugby league's shift toward each club's SRS takes it from 0.60 to 0.90. The spread rule on the unmerged branch
   `claude/eager-williamson-546179` (√reliability × SRS) brings each season's win% spread to a mean distance of 0.014
   from the record's, from 0.030 (rugby-league.md on that branch).
7. **Results-only Elo maps linearly when the map is fitted to the engine's own odds.**
   - Football: 3.2 rating points per 100 Elo reproduces the engine's expected score within 0.0015 for gaps of 50–300
     (football-years.md).
   - Tennis: Elo ÷ 25 tracks Tennis Abstract's lists at r 0.96–0.99 (tennis.md).
8. **Each engine has its own scale, so a computed season must use its own sport's.** Starters in the built-in seasons:

   | Built-in season | Starters p5/p25/p50/p75/p95 | Club SD | SD within a lineup |
   | --- | --- | --- | --- |
   | Football (124 clubs) | 65/74/77/80/85 | 3.67 | 3.97 |
   | Women's football (84) | 62/71/75/79/85 | 4.57 | 4.65 |
   | Basketball (30) | 77/80/83/86/94 | 2.48 | 4.10 |
   | American football (32) | 73/76/80/85/95 | 1.94 | 6.09 |
   | College football (138) | 72/76/79/83/89 | 3.34 | 4.02 |
   | Baseball (30) | 69/72/77/81/87 | 2.62 | 4.94 |
   | Hockey (32) | 74/79/83/86/91 | 1.09 | 5.16 |
   | Rugby league (17) | 77/80/84/86/90 | 0.91 | 3.89 |

## The method

Six steps. Each names the rule a computed season follows, and the code to reuse. The steps every sport shares are in
`scripts/lib/computed-ratings.mjs` (tested by scripts/computed-ratings.test.mjs on synthetic data whose truth is known):
`clubOfStints` (step 1); `pooled`, `replacementRate`, `priorFromNoise`, `priorFromReliability`, `shrunkRate`,
`seasonReliability`, `stabilityWeight` and `blend` (step 3); `referenceOf` and `ratingsOf` (step 4); `srsOf`,
`winShareOf`, `resultsTargets`, `perPointOf` and `clubMoveOf` (step 5). A season's builder supplies its sport's facts and
its engine's strength.

### 1. Who is in the squad

- **Club seasons.**
  - Club: a player counts for the club he played the most minutes for (else games); a tie goes to the later club,
    where he finished the season. One club per player has a cost the docs record: the 1964/65 Warriors keep Wilt
    Chamberlain, whom they traded in January.
  - Position: the one he started at most that season; else the seasons either side, then two away; else his career
    position; else he is left out.
  - Squad: the engine's own lineup plan, chosen by `selectLineup` from provisional ratings, then depth up to the sport's
    squad size, best first, as hockey, the NFL and MLB already do.
- **National seasons.**
  - Appearances in the season and the one before (the season itself counts double), ordered by appearances, then
    minutes, then caps to date.
  - Where match line-ups exist (World Cups), the minutes played decide, as in the `wc-*` seasons.
  - Spreading a career stint's caps evenly over its years (`nt-*`) is the fallback of last resort: it ranks young stars
    below veterans (Maradona in 1978/79).
- **Never** a player with no recorded appearance, and never a generated one.

### 2. What to collect

| Tier | Facts | Required |
| --- | --- | --- |
| R, results | every game's score, venue and date | always (step 5) |
| S, selection | appearances, starts, minutes / ice time / plate appearances / snaps; national and representative call-ups | always |
| P, production | the sport's box score, counted only where it appears in at least 95% of the season's games (rugby league's `RECORDED_SHARE`) | when it exists |
| H, honours | season honours chosen on that season's play: All-Star, All-league teams, team of the season | optional, top end only |

R and S alone are enough to ship. Rugby league 1960–1997 shows how far they go: 0.73 within position, and clubs at a
median 0.90 against wins once step 5 runs.

### 3. Each player's value

For each signal, within each position group (forwards, defencemen, goalies; hitters, starters, relievers; and so on):

1. **Window.** The season itself 3, the season before 2, the one before that 1. Events and exposure are pooled
   (Σ weight × events ÷ Σ weight × exposure), so a season with few games counts for little.
2. **Replacement level r₀.** The pooled rate of the quarter of the group with the least exposure, measured each season.
   Low-usage players are, on the evidence, worse than average, so a thin record shrinks toward replacement, not toward
   the mean.
3. **Prior k.** Noise per unit of exposure divided by the talent variance, by the method of moments among players with
   at least a quarter of a season. The noise is Poisson for counts, binomial for percentages, and otherwise
   k = n̄(1 − r)/r from year-to-year reliability. `priorExposure` in scripts/computed-ratings-backtest.mjs does this.
4. **Production** p̂ = (Σ w·events + k·r₀) ÷ (Σ w·exposure + k).
5. **Selection** u = the window's weighted share of the club's games, or minutes where the source keeps them. Ice time a
   game ranked NHL 22's skaters at 0.79–0.82, against 0.54–0.65 for games played.
6. **Value** = w_S·z(u) + w_P·z(p̂), where w = √rel ÷ (1 − rel) and rel is the signal's rank correlation between the
   window's two latest seasons, among players with a quarter season in both (`stabilityWeight`).
   - Where a game has rated the sport in any season, tune w_S and w_P once on it, and nothing else, then freeze them.
   - A group whose job has no individual statistic (the offensive line) uses selection and step 5 only, as the NFL's
     credit does.
7. **Honours.** Add 0.25 of the group's standard deviation for a season honour. The NBA fit, made against NBA 2K, puts
   an All-Star pick at +0.26 SD beyond the box score. A pre-1995 Ballon d'Or is used only to order players within a
   nation, because it voted on Europeans only.

### 4. From value to rating

- **Rank, then read off a reference.** Rank by value within the group over the season's squad players. Each player's
  mid-rank quantile reads his rating off the reference, by linear interpolation, rounded and held to 1–99. Ties share a
  rating. scripts/lib/nfl-reference.mjs already does this. The reference is each club's top k at that group, where k is
  the season's players per club in the group.
- **Which reference.** A game-rated season of the same sport. The built-in season is the default, because the engine
  and the realism harness are calibrated on it; the game-rated season nearest the era also works. Today's computed
  seasons read off NHL 27 (hockey), NBA 2K27 (basketball), The Show 18–24 (baseball), Madden NFL 2002 (the NFL) and
  RL26 (rugby league).
- **A sport no game has ever rated.** Use the middle of the eight built-in shapes: starters at about 73/76/80/84/90
  (p5/p25/p50/p75/p95). Then set the engine's sensitivity per rating point in the realism harness, so that simulated
  seasons spread like real ones.
- **Sports rated by Elo** (tennis, the esports) keep the linear map: 25 Elo per point.

### 5. Reconcile clubs with their results

1. **Results strength S.**
   - League seasons: the Simple Rating System (SRS), margins by least squares with a home edge, ratings summing to zero.
     Its reliability r = 1 − error ÷ spread. `srsOf` on the eager-williamson branch computes it; there r runs from 0.47
     (1986) to 0.92 (1995).
   - Sparse schedules (nations, esports): Elo at the season's date, by World Football Elo's rules for nations.
2. **Engine units.** Measure m, the margin (or Elo) the sport's engine gives per lineup point, by simulation. Football's
   is 31.25 Elo a point. Rugby league's is 0.9 × `marginPerStrength` (on the same branch), where 0.9 is the model's
   slope ÷ its game-noise ratio.
3. **Target.** T = μ + √r × S ÷ m, where μ is the season's mean club strength before the move (its ranks were read off
   the reference, so this is the reference's level). The square root of r, not r: r itself left rugby league's
   standings 6% too narrow.
4. **Move.** Shift each club by a whole number, plus one more for its best few, until it reaches its target. A player's
   order inside his club never changes. Rugby league's moves ran −5 to +3. The strength moved is the one the match
   model plays (rugby league's attack-and-defence strength, not the lineup's shown mean, where the two differ).
5. **Completed seasons only.** A season still being played (a built-in season) has too few results to move anything;
   its computed players take steps 1–4 alone.

Three settings, one of them the user's call (see "Decisions"):
- **Full**: as above. This is rugby league's rule.
- **Spread only**: keep the bottom-up order, and rescale each season's club deviations so their SD is √r × SD(S) ÷ m.
- **None**: what the NBA, NHL and MLB computed seasons do today. The NBA's was Claude's decision of 2026-11-09, made
  because a results term "would choose ratings by real results", although it ordered clubs better (0.75–0.87 against
  SRS).

### 6. Check before shipping

- **Agreement with a game.** Where any game has rated an overlapping season, the within-group Spearman, averaged over
  the groups, should be at least 0.72. The shipped rules reach 0.73 (the NFL's 2000 holdout) to 0.88 (the NBA, left
  out one edition at a time).
- **Agreement with results.** Club strength against the season's real results (SRS or win share), Spearman at least
  0.80 in the median season. This holds after step 5; without it, the shipped seasons reach 0.60–0.82.
- **Realism.** The realism harness (`npm run simulation:realism`) keeps win% spreads and scoring inside the sport's real
  ranges.
- **Audits.** Every season rebuilds byte for byte with `--check`; the label and `source.conversion` are written. The
  roster audit (`npm run audit:rosters`) reports 0 errors once it reaches main; when this was written it sat on the
  unmerged branch `claude/roster-validation-quality-0702ce`, with `npm run validate:football-elo`.

## Special cases

- **National teams drawn from many leagues.** Club evidence has to be put on one scale before players can be ranked
  across leagues. Translation factors come from players who changed league between consecutive seasons: the ratio of
  their per-minute production after the move to before it. This is how hockey's NHLe and baseball's Major League
  Equivalencies are built. Failing that, use the leagues' clubs' results against each other. The national XI then comes
  from step 1, the team from Elo (as in `nt-*`), and the order inside the XI from each player's club evidence instead of
  the fixed profile D = [5.3 … −3.9].
- **Results and team lists only.** Selection plus step 5, as in rugby league 1960–1997.
- **Individual sports.** Elo at the season's end, read linearly (tennis).
- **Team esports.** Player Elo built from team results (scripts/lib/liquipedia-elo.mjs).
- **Results with no names.** No team.

## Where it applies now

| Gap | Today | What the method changes |
| --- | --- | --- |
| Hockey built-in, players below EA's top 300 | rank by ice time and points, spread linearly 83 → 72 (scripts/lib/nhl.mjs) | step 3 blend, read off the shape of the last full EA edition (NHL 22) below its top 300 instead of a straight line |
| NHL computed seasons | goalies 0.60–0.83 against EA; clubs 0.6–0.8 of real spread | step 3 blend (+0.09 for goalies, +0.03 for defencemen, measured); step 5 |
| NBA computed seasons | single season, no shrinkage for missed games; club SD 1.37–2.37 against 1.80–3.70 | window, selection signal, step 5 |
| EuroLeague (all seasons) | linear PIR rating; clubs against the record at a median 0.62 | steps 3–5 |
| Football, EA seasons' short national XIs (FIFA 05–09 furthest from Elo: 0.74–0.82) | the nation plays short | fill from capped players by step 1 and Elo, labelled computed |
| Football nations no source rates (Tonga, Samoa, Cook Islands) | the land stays neutral | field them when caps give eleven with a goalkeeper |
| Nations' lineup gaps in baseball, hockey, rugby league, basketball and the NFL | generated "F. Surname" players at confederation constants (UEFA 63 … OFC 48 in `CONF_META`) | replacement level from the data, or real players of that nation from other leagues; this is the last place ratings are made up |
| Sports no game rates (rugby union, cricket, handball, volleyball, the WNBA, the PWHL) | not built | steps 1–6 with the default scale, once a permitted source of results and team lists is found |

## Decisions

Both made by the user on 2026-11-17.

1. **Results in the ratings (step 5): full.** The user chose the full shift, as this document advised over "spread
   only" and "none". Bottom-up clubs follow real results at only 0.6–0.8 and spread too little; the move never reorders
   players inside a club. The cost, accepted: a computed season's favourites are the clubs that actually won. This
   replaces the "no team results" rule the NBA, NHL and MLB computed seasons were built under.
2. **Scope: the computed seasons already shipped are re-rated too**, as well as the new gaps. The user chose to run each
   sport's rebuild in its own session at the same time: NBA 1960–98 (36 seasons), NHL 1961–2026 (58) and the built-in
   season's estimated players, MLB 1960–2017 (58), the EuroLeague (27, its built-in season through steps 1–4 only), and
   the NFL and AFL 1960–2000 (46). Each re-rated sport ships only on the user's own go-ahead, after its rebuild checks,
   the realism harness and the roster audit pass. Rugby league's computed seasons already move toward their results;
   the √reliability form of that move waits on its unmerged branch (`claude/eager-williamson-546179`).
