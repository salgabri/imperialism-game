# Football squad gate

Added 2026-11-10, ported from the squad-years work of 18–19 October 2026 (branch
`claude/football-rating-strategy-ef71dc`: the validator of 2beb88b, 2cc07a7, 29d198f and 05244bf, the engine-scale
gate, and the design notes of 873f549). It asks of a season's national squads what the game can check against the
real world: do the strengths rank nations as World Football Elo does, do they forecast real matches as well as Elo
did on the day the ratings are dated, and do they keep the match engine's odds, upsets and campaign length where
they were. The branch used it to decide which squad years setup could offer; main ships every season by choice, so
here the verdicts are a report. A failing built-in is the signal to look before a rollover ships it.

```bash
npm run validate:football       # score the seasons and write docs/design/football-gate/validation.json
npm run engine-scale:football   # measure the built-in squads and write docs/design/football-gate/engine-scale.json (about a minute)
npm run test:football-gate      # the gate's tests (also part of npm test)
```

## Seasons and dates

`scripts/data/football-gate.json` lists the seasons scored, newest first: the built-in 2026/27 (`src/data/rosters.js`,
EA FC 27 + FM 26) and the 2025/26 season file (`public/football/ea-fc-26.json`, EA FC 26 alone). Each season has two
dates, which the validator checks against the data:

- **D_Y, the ratings date** (`ratingsDate`): the EA snapshot the ratings date from. 2026-11-01 and 2025-09-19.
- **R_Y, the information date** (`informationDate`): the release of the newest input. FM 26's database (30 March
  2026) is older than EA FC 27's snapshot, so R_Y is also 2026-11-01; a season of one source has R_Y = D_Y.

A season's forecast window is (R_Y, R_next], up to the next newer season's information date, so every match is scored
by the newest squads whose inputs were all released before it, and the newest season's window is open. Only nations
that field a side in the season count (`fieldedNations`): all 173 for the built-in, 112 for EA FC 26, whose thin
nations field no team. Russia is marked suspended (since February 2022) and stays out of the statistics.

## Provisional gate

- **Build checks** from the shipped data: every fielded nation has a squad of 1 to 11 players (the built-in, exactly
  11), ratings are whole numbers 1–99, strengths are numbers, statuses name real nations.
- **Cross-section**: Spearman of XI strength against World Football Elo at D_Y over the gate set, at least 0.90.
  Reported beside it: Pearson, the seeded bootstrap 95% interval (2,000 nation resamples), within-confederation
  Spearman, the Elo top 50, OFC alone, and the nations ranked furthest above and below their Elo.
- **Linking**: the built-in audit's mean EA − FM rating over one-to-one name matches, at most 1 point in absolute
  value ([football-squad-identity.md](football-squad-identity.md)). A season of one source has nothing to link (not
  applicable, which neither passes nor fails a gate).

## Full gate

The provisional gate, plus:

- **Reep linking**: the same mean over Reep-linked pairs, at most 1.
- **Forecast**: martj42's full internationals in (R_Y, R_next] between fielded nations, scored by an ordered logit
  `z = β·(Z_home − Z_away) + h·[not neutral]`, P(home) = σ(z − c), P(away) = σ(−z − c), with Z the strength
  standardised within the season. The roster model passes when its log loss is no worse than the same model on Elo
  frozen at R_Y by more than 2 SE, with at least 100 matches in two or more windows and β > 0 (a reversed ranking can
  fit a negative β and score well). β, h and c are fitted by k-fold cross-validation grouped by match window (each
  finals tournament is one window; friendlies, qualifiers and Nations Leagues split at date gaps over 10 days), every
  match scored out of fold. The SE is the larger of two block bootstraps of the paired per-match difference,
  clustered by match window and by team pair; below 8 clusters it is a jackknife and the margin takes t(G − 1).
  Friendlies are reported apart. A window results.csv does not yet cover keeps its verdict, marked partial.
- **Engine scale** (the built-in): the starters' effective-rating SD within ±10% and their 10/50/90% quantiles within
  1 point; the SD of XI strengths within ±10%; in a seeded probe of every pair inside a confederation, the favourite's
  win rate and the upset rate inside the reference's Wilson 95% intervals; and in `scripts/production-balance.mjs`'s
  11 football campaigns of the coverage matrix (40 seeds each), mean matches within ±10% and the pooled completion and
  top-five-champion shares inside the reference's intervals. The reference is the built-in these squads replaced: when
  `src/data/rosters.js` changes, its committed measurement becomes the reference, so a rebuild or a rollover is
  measured against what shipped before it although the old rosters leave the repo.
- **Audit XIs**: the incomplete XIs are listed (the built-in audit's coverage row per nation, a season file's own
  coverage counts) and agree with the squads.

## Results, 10 November 2026

| | Built-in 2026/27 (EA FC 27 + FM 26) | 2025/26 season (EA FC 26) |
| --- | --- | --- |
| Gate set | 172 nations | 111 nations |
| Spearman vs Elo at D_Y | **0.9291** (95% CI 0.896–0.950); before person keys 0.9296 | **0.8457** (0.764–0.898) |
| Pearson | 0.9356 | 0.8154 |
| Within confederation | 0.9111 | 0.8131 |
| Elo top 50 | 0.7523 | 0.7833 |
| EA − FM linking (fuzzy / Reep) | +0.10 / +0.13 | not applicable |
| Provisional gate | **pass** | **fail** (below 0.90) |
| Forecast | not scored: the window opened on 1 November 2026 | **pass** on 600 matches, 2025-09-20 to 2026-10-06 (partial) |
| Engine scale | **pass** against the squads before person keys | not applicable |

The built-in's XIs track Elo about as the branch's EA + FM builds did (0.92–0.93). The largest rank gaps are the
Philippines, India and Congo, whose XIs rank 43–52 places above their Elo, and Belarus, Vietnam and Iran, 48–57 below
(AFC sides are under-rated by both databases: Iran, Oman and the UAE rank as low on FM alone). The person keys of
the same day moved Spearman by −0.0005 and Pearson by −0.0002.

EA FC 26 alone fields 112 nations, 80 of them with a complete natural XI, and ranks them less well: below the 0.90
bar, as the branch measured for EA alone on 2025/26 (0.874 over all 170 nations then). Its forecast still holds: over
the 2025/26 internationals between fielded nations, the 2026 World Cup included, roster log loss is 0.9169 against
0.8935 for Elo frozen at 19 September 2025, a difference of 0.0234 inside the margin 2·SE = 0.0362 (SE 0.0181 by team
pair; 19 match windows, 534 team pairs), and β = 1.06. Elo and roster together reach 0.8781, base rates alone
1.0698. Competitive matches score 0.9011, friendlies 0.9469. The window closes on 1 November 2026, the built-in's
information date; martj42's results at the pinned commit end on 6 October, so it is re-scored when a later file is
pinned.

The engine-scale reference is the built-in of 1 November 2026 before person keys (`e411dece2451`); the current one
(`1ffd9fd55538`) measures starter SD 10.279 (10.276), quantiles 54/69/81 (unchanged), XI-strength SD 9.566 (9.563),
favourite win rate 0.763 (0.762) and upset rate 0.078 (0.078) over 3,603 pairs, and completes every campaign with a
top-five champion share of 0.559 (0.541).

## Inputs and terms

- **World Football Elo** ([eloratings.net](https://www.eloratings.net/)): its static `{Y}.tsv` and `{Y}_results.tsv`
  tables, cached once in the ignored `data-src/validation/elo/` and never shipped: the reports hold aggregates and
  ranks, no Elo value. The site has no robots.txt (404 on 10 November 2026) and its tables carry no licence. The
  validator fetches only missing files, one every 1.5 seconds, through `scripts/lib/polite-fetch.mjs` (README,
  "Network requests": robots.txt read first and obeyed, the generic User-Agent `imperialism-game-data/1.0`), and
  nothing with `--offline` or `--check`. Elo at D_Y replays
  `{Y}_results.tsv` (post-match ratings) over the year-end `{Y-1}.tsv` through matches on or before D_Y, and replaying
  the whole file must reproduce `{Y}.tsv` exactly. A snapshot stands for D_Y only if taken on D_Y or later;
  `sources.json` beside the files records each file's SHA-256, fetch date and how the date was known, and seeded
  files count only with `--trust-seed-dates`. On 10 November eloratings.net had revised two non-FIFA sides'
  ratings (KD, YT) since the 18 October copies, so all five tables were refetched together. `World.tsv` stands in only
  when no replay covers a date, and for Elo at R_Y only if fetched on R_Y itself: a later one has seen results of the
  matches the forecast scores.
- **martj42 international results** ([GitHub](https://github.com/martj42/international_results), CC0): the
  `results.csv` the computed World Cup seasons already pin (commit b0948cb of 31 October 2026, last match 6 October),
  read from the ignored `data-src/martj42-results/` and checked by SHA-256. Team names map to nations through
  `scripts/lib/results-names.mjs`; a name in neither its map nor its off-map list stops the forecast, so a new side
  never drops out silently.

## Research carried over

The branch measured these on its EA FC 26 + FM 26 build of 2025/26 (Elo at 19 September 2025, all 170 nations then
on the map). They are why the builder still puts EA first and fills gaps from FM:

| Variant | Spearman | Within confederation | EA-complete nations (77) |
| --- | --- | --- | --- |
| FM only | 0.932 | 0.917 | 0.831 |
| Average EA and FM, weight 0.5 | 0.930 | 0.913 | 0.822 |
| EA first, FM fills gaps (shipped) | 0.922 | 0.903 | 0.798 |
| EA only | 0.874 | 0.807 | 0.798 |

None of the mixes beat "EA first" significantly (FM only − shipped: +0.010, CI −0.002 to +0.025), most of FM's lead
is coverage, and FM there was six months newer than EA. One roster rating point is worth about 29–30 Elo points. EA
rates Indian players about 12 points above FM (n = 57, all in the Indian Super League); any future EA–FM mix needs a
guard keyed by nation and league for such groups. The branch's forecast on its own 2025/26 build, (30 March, 6
October 2026], found roster log loss 0.8945 against Elo's 0.8939, within 2 SE.
