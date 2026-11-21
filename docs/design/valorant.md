# Valorant

Status: implemented 2026-11-16. The third esport and the thirteenth sport: Valorant, as the VCT plays its playoffs. Two
nations' teams of five meet in a series of maps, best of three; a map is won by the first to thirteen rounds, and at twelve
all it goes to overtime, won by two clear rounds. Nations only, on the world map, for now. Everything outside the match
(territory, the draw, targeting, conquest, saves) is the game's own, unchanged.

The player asked (2026-11-15) for other esports than Rocket League. A survey of where each game's results can be read
(below, "Sources") left Valorant and League of Legends as the two whose results sites let the project's fetcher in;
Counter-Strike, rated from Liquipedia exports saved by hand, came in beside them (docs/design/counter-strike.md).

## Sources

There is no game's rating list for an esport, so a player's rating is an Elo built from his results, as Rocket League's
is. Valorant's results are read from [vlr.gg](https://www.vlr.gg), whose robots.txt disallows only its search box and
`/rr/`, for every agent. The scripts fetch through `scripts/lib/polite-fetch.mjs`, as every data script does (README,
"Network requests"), one page at a time and 0.6 seconds apart, and keep each page gzipped in `data-src/vlr/` (ignored by
git), so a page is fetched once and every later run reads the cache.

Liquipedia, Rocket League's source, is off-limits to the fetcher (its robots.txt shuts Anthropic's crawlers out of the
whole site). The other sites checked for Valorant, Counter-Strike, League of Legends, Dota 2 and StarCraft II on the same
day: OpenDota, DatDota, Oracle's Elixir and Aligulac shut ClaudeBot out; Steam's Web API shuts every agent out; HLTV and
Leaguepedia answer the fetcher with a bot challenge; STRATZ and start.gg want a person's API token.

1. `npm run sync:valorant -- --fetch` reads vlr.gg's events listing for VCT (tier 60: the franchised leagues, Masters,
   Champions, and the Challengers stages of 2021–2022), Challengers (tier 61: every region's second tier since 2023) and
   the off-season (tier 67: invitationals, the Esports World Cup, the Esports Nations Cup); Game Changers, collegiate
   events and the third tier are left out. It keeps the events from VCT 2023's LOCK//IN São Paulo on, when the franchised
   leagues began, and leaves out the open qualifiers (an event that says so, or a qualifier of more than 300 matches: the
   VCT 2027 Kickoff's European qualifier had 685, amateur teams for the most part). Then each event's matches, and each
   completed match's page.
2. Without `--fetch`, the sync reads only the cache, rates every player and writes `scripts/data/valorant-elo.json`.
3. `npm run build-valorant` writes the nations, `src/data/rosters.valorant.js` (`--check` compares byte for byte).

On 16 November 2026 the cache held vlr.gg's 835 events of those tiers (792 completed, 14 under way, 29 to come), the match
lists of the 545 from LOCK//IN on and all 21,899 of their completed matches' pages: 21,142 matches with maps to rate,
44,939 maps from 15 September 2022 (2023's first Challengers qualifiers) to 15 November 2026. Fetching took about three
and a half hours, a page every 0.6 seconds, over two runs: a dropped connection ended the first, and the second carried
on from the cache. Each page's parsed result is copied before it is kept (`structuredClone`): the strings read off a page
are slices of it, and some 20,000 pages held whole ran the ratings out of memory.

## Reading the pages

`scripts/lib/vlr.mjs` reads three kinds of page:

- **The events listing** (`/events/?tier=…&page=…`): each event's id, title, status (completed, ongoing, upcoming), dates
  and host country's flag.
- **An event's matches** (`/event/matches/<id>/…/?series_id=all`): each match's id and whether it is completed.
- **A match page**: its date, the two teams, the score in maps and the format (Bo1, Bo3, Bo5), then each map: its name and
  which team picked it, both teams' rounds, every round one by one (the winner, the side it won on, how it ended: an
  elimination, the spike defused or exploded, the time run out) and both teams' five players, each with his vlr.gg page and
  the flag vlr.gg files him under. A forfeit has no maps. vlr.gg's flag "un" is no country.

## Ratings

`scripts/lib/valorant.mjs` turns the pages into what the ratings play, and `scripts/lib/esports-elo.mjs` (shared with
League of Legends) plays them:

- **Games.** Every map is one Elo game between the ten who played it: a side plays at its five players' mean Elo, the
  winner takes K × (1 − E) from the loser, and each of a side's players moves by his side's amount. A player's K shrinks
  with his maps: K_SCALE / (maps + 5)^0.4, never below 8.
- **Players.** A player is his vlr.gg page (`vlr:<id>`), so a renamed player stays one; his name is the one his maps give
  most.
- **Circuits.** A circuit is a franchised league's VCT region ("VCT EMEA": its Kickoff and Stages), a Challengers league's
  subregion ("Challengers Japan", "Challengers Türkiye"), or an EMEA- or Pacific-wide Challengers stage as that region's;
  China's Evolution Series is China's second tier, and the international events (Masters, Champions, the off-season) and
  Ascension belong to none. A player's home circuit is the one he has played most maps in; one who has played in no
  circuit's events (3,955 of the 18,179 players, most of them only at the off-season's invitationals) calls home the
  circuit most of his country's players call home (`homesOf`, `byCountry`). Since 2026-11-21 a newcomer starts at his home
  circuit's level, as in League of Legends (`circuitLevels`; docs/design/league-of-legends.md, "Ratings"), the levels held
  by a normal prior of 100 Elo around the players' mean (`LEVEL_SPREAD`). Before, every newcomer started at 1500, and each
  circuit's players stayed around 1500 whatever its strength (below, "Circuits on one scale").

K was tuned on the last 180 days' maps, from 19 May 2026 (3,836 of them, 797 between two circuits' sides), each scored
before it was played (`--tune`, the levels fitted on the maps before):

| K_SCALE | log loss | with the circuits' levels | maps between circuits | between, with the levels |
| ---: | ---: | ---: | ---: | ---: |
| 80 | 0.6539 | 0.6539 | 0.6533 | 0.6411 |
| 120 | 0.6465 | 0.6460 | 0.6500 | 0.6385 |
| 160 | 0.6419 | 0.6414 | 0.6495 | 0.6391 |
| 200 | 0.6393 | 0.6388 | 0.6506 | 0.6413 |
| 240 | 0.6379 | **0.6376** | 0.6527 | 0.6443 |
| 320 | 0.6379 | 0.6379 | 0.6584 | 0.6516 |
| 400 | 0.6406 | 0.6407 | 0.6653 | 0.6598 |

K_SCALE stays 240, the best over all the maps with the levels or without. The held-out log loss is 0.6376 with the levels
fitted on the maps before the holdout (0.6352 with the whole record's, as the snapshot keeps it), and Elo's odds hold by
tenths: favourites at 0.55 won 0.53 of 870 maps, at 0.65 0.66 of 689, at 0.75 0.71 of 384 and at 0.84 0.85 of 175.

A player is rated once he has 20 maps behind him and has played within a year of the last map: 2,437 of the 18,179
players vlr.gg's maps name. On the game's scale a rating is Elo / 25 − 2, so a rating point is 25 Elo points, as in
Rocket League and tennis, and the match model plays Elo's own odds. The best are Team Heretics' RieNs (97), M80's Kyu
(95), 100 Thieves' Timotino and vora and G2's jawgemo (94), then Team Vitality's PROFEK, LOUD's erde and LEVIATÁN's Neon
(93).

### Circuits on one scale

Checked and fixed on 2026-11-21, at the user's request that a nation's rating not stand high only because its players
dominate a weaker circuit. Every figure here is one map scored before it was played; a circuit's offset is the Elo its
sides' edge needed in the maps against other circuits' sides to make their expected wins their wins (maximum
likelihood, its error clustered by series), 25 Elo a rating point. A side's circuit is the home (counted over the maps
before) of three of its five; a map is between circuits when its two sides' differ, and seasoned when each of the ten had
20 maps behind him, as every rated player has. `npm run sync:valorant -- --tune --rolling` prints the held-out figures.

**Before: every newcomer at 1500.** Over the 3,456 seasoned maps between circuits from 2023 to November 2026:

- The VCT's sides beat the Challengers' more often than Elo expected in each year: +137 ± 52 Elo in 2023, +54 ± 22 in
  2024, +68 ± 21 in 2025, +44 ± 20 in 2026, +59 ± 12 in all (1,093 maps), in the VCT leagues against the promoted teams
  (+56 ± 16) and at the off-season's events (+76 ± 23) alike.
- Each region's Challengers stood too high against the circuits they met: EMEA's −86 ± 24, the Pacific's −65 ± 22, the
  Americas' −44 ± 19.
- The weakest circuits most of all: South Asia −193 ± 56, Oceania −179 ± 64, MENA −144 ± 38, LATAM −140 ± 42, Portugal
  −131 ± 40, Vietnam −105 ± 48. India's sides −216 ± 69 (8.6 rating points), Australia's −174 ± 67, Portugal's
  −136 ± 40; South Korea's +49 ± 18, Turkey's +44 ± 17, the United States' +41 ± 17.
- The regions against each other (Masters, Champions, the off-season's international events) stood within their errors
  (China −41 ± 26, EMEA −16 ± 21, the Pacific +9 ± 18, the Americas +25 ± 19), and so did Indonesia's sides (+2 ± 25),
  Japan's (−16 ± 28), the Philippines' (+11 ± 28), Thailand's (+18 ± 23) and France's (+4 ± 32).

**The fix.** A newcomer starts at his home circuit's level, fitted at once with every player's strength, as League of
Legends' are; the levels get a prior of their own (100 Elo); a player of no circuit takes his country's usual home
(without it the players met only at the off-season's invitationals, in a tenth of all maps, came in at 1500 whatever their
circuit). It was judged on each half-year from July 2024 (cut-offs 1 July 2024, 1 January and 1 July 2025, 1 January and
19 May 2026), the levels fitted on the maps before each:

| Held-out log loss | all (25,230) | between circuits (3,691) | within (21,539) | between, seasoned (2,793) | within, seasoned (8,877) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Every newcomer at 1500 | 0.6452 | 0.6525 | 0.6440 | 0.6660 | 0.6666 |
| League of Legends' levels as they were | 0.6455 | 0.6471 | 0.6453 | 0.6604 | 0.6664 |
| With the levels' prior | 0.6452 | 0.6470 | 0.6449 | 0.6604 | 0.6663 |
| And homes by country (shipped) | **0.6446** | **0.6441** | 0.6447 | **0.6570** | **0.6656** |

The maps within a circuit between seasoned players are better predicted too; the within column's small loss (0.6440 →
0.6447) is all in maps with a player of fewer than 20 maps, most of it November 2026's Türkiye Kickoff qualifier and the
North American Challengers' third stage of 2024, college teams among them, whose amateurs now start at a strong
circuit's level. K stays 240 (200 and 320 do worse with the levels). Tried and dropped, on the same windows: a looser
prior on the players' own offsets (400: between 0.6455, but VCT EMEA's level then fell below Challengers France's); with
homes by country, the levels' prior at 75, 150, 200 or none and a players' prior of 250 (between 0.6436–0.6445, all maps
0.6445–0.6451, as good as the shipped within their noise); starts chosen so that each circuit's sides come out right
(between 0.6455, within 0.6468); levels moved by every map between circuits (between 0.6476–0.6503, within
0.6441–0.6564); offsets added after the Elo (within, seasoned, 0.6670 or worse); and newcomers' maps moving their rivals
less (within 0.6493 or worse).

**After.** Held out, between seasoned sides, the half-years together (before → after):

- The tiers: the VCT's +49 ± 14 → +24 ± 14 (849 maps), no longer beyond its error. No region's tier is: EMEA's
  Challengers −67 ± 27 → −41 ± 27, the Americas' −49 ± 21 → −36 ± 21, the Pacific's −43 ± 23 → −10 ± 23.
- Circuits beyond two errors: 8 of 26 → 4 (the sum of their (offset / error)² 73.6 → 40.8). Left: Oceania −197 ± 69 →
  −183 ± 67, South Asia −200 ± 66 → −163 ± 65, Vietnam −156 ± 54 → −120 ± 57, MENA −130 ± 41 → −92 ± 40.
- Nations: India −241 ± 89 → −216 ± 88 (28 maps), Australia −193 ± 73 → −181 ± 71 (30), South Korea +56 ± 21 →
  +50 ± 20, the United States +34 ± 20 → +11 ± 20, Turkey +38 ± 19 → +22 ± 19, Brazil −40 ± 31 → −11 ± 30; Indonesia
  −10 ± 26, Japan +25 ± 28, the Philippines −14 ± 31, Thailand +13 ± 24, France +8 ± 35, Germany −64 ± 48.

The levels the built-in season starts newcomers at put the VCT on top: VCT Americas 1812, VCT EMEA 1803, VCT Pacific 1781,
VCT China 1664, then Challengers North America 1645, Türkiye 1609 and Korea 1578, France 1562, Brazil 1526, Indonesia
1491, Thailand 1478, the Philippines 1456, Japan 1395, South Asia 1375 and Vietnam 1306. At the end of 2024, the example
that prompted the check, Indonesia went from 82.8 to 81.6 (third to fifth), Japan from 82.2 to 80.6, the Philippines from
80.6 to 78.6, Thailand from 79.0 to 78.8 and India from 77.6 to 75.4 (thirteenth to twenty-first), while France went from
75.4 to 76.6 and Germany from 76.6 to 78.2; the United States (86.2), South Korea (85.0) and Turkey (84.8) lead. Indonesia
and Japan stay above France and Germany: their sides' results against other circuits are what their ratings say (above),
and the two regions' Challengers meet only through the VCT, where the Pacific's come out no further above their results
than EMEA's (−10 ± 23 against −41 ± 27).

What the levels leave: the small, weak circuits' best sides (South Asia, Oceania, Vietnam, MENA) still lose to other
circuits' more than their Elo says, four to seven rating points' worth on 35–103 maps each. A newcomer's start anchors a
circuit as a whole, not the distance between its few strong teams and the rest of it.

**The circuits' offsets: tested, not adopted.** Tested the same day at the coordinator's request, on the setting above:
after the Elo, each player's Elo gets his home circuit's offset, fitted only on the maps between circuits (maximum
likelihood, a normal prior on each offset), refitted before each cut-off and held through the half-year. The rule, fixed
before the run and read as the other esports' audits read it: adopt if (1) the maps between circuits are better
predicted, all and seasoned; (2) the maps within a circuit between seasoned players are worse by no more than the paired
change's error (by series, a thousand resamples); (3) no region's tier ends beyond two errors the other way.

| Held-out log loss | all (25,230) | between circuits (3,691) | within (21,539) | between, seasoned (2,793) | within, seasoned (8,877) |
| --- | ---: | ---: | ---: | ---: | ---: |
| The levels (shipped) | **0.6446** | 0.6441 | **0.6447** | 0.6570 | **0.6656** |
| Offsets, prior 25 | 0.6449 | 0.6431 | 0.6452 | 0.6559 | 0.6662 |
| Offsets, prior 50 | 0.6456 | 0.6428 | 0.6461 | 0.6556 | 0.6674 |
| Offsets, prior 75 | 0.6464 | 0.6432 | 0.6469 | 0.6562 | 0.6684 |
| Offsets, prior 100 | 0.6470 | 0.6439 | 0.6475 | 0.6571 | 0.6690 |

The best of them, a prior of 50, gains only −0.0013 ± 0.0013 between circuits (−0.0014 ± 0.0015 between seasoned sides)
and costs the seasoned maps within a circuit +0.0019 ± 0.0005, a real worsening; a prior of 25 costs them
+0.0007 ± 0.0002 for −0.0010 between; 100 does not help the seasoned maps between circuits, and an empirical-Bayes prior
shrank every offset to nothing (the free offsets spread no wider than their errors). All of them predict all the maps worse (0.6446 →
0.6449–0.6470). So no snapshot carries offsets. They would have shrunk the gaps below a little (prior 50: South Asia −163
→ −146, Oceania −183 → −139, MENA −92 → −42); `npm run sync:valorant -- --tune --rolling` prints the comparison.

## Nations

A player plays for the nation he last played for at the Esports Nations Cup (its 2026 qualifiers, each team a country:
448 players), else the flag vlr.gg files him under most often; a player whose only flag is "un" plays for nobody, and so
does one from a country the map does not draw (Singapore, Hong Kong, Macau). Taiwan's "tw" is Chinese Taipei's. Great
Britain plays as one, as in Rocket League and tennis. A gamer tag that is an insult or an obscenity (one rated player's
reads "bitch, you'd better be ready" in Chinese) plays for nobody, so the game never shows it (`isOffensiveName`).

Each nation names its seven best; it needs five for a team, so a nation with fewer fields none and its land stays
neutral. 63 nations field a team. Canada leads (91.6: Kyu, Timotino, vora, zander), then Turkey (90.6: RieNs, LewN,
Ruxic), South Korea (89.0), Russia (88.0), the United States (86.4) and Brazil (85.6); the Philippines are eighth (83.4),
Indonesia fourteenth (81.8), Japan eighteenth (80.0) and France twenty-seventh (76.2). Before the circuits' levels
(2026-11-21) Turkey led (88.2) ahead of Canada (87.8), and the Philippines (83.4) and Japan (83.0) stood fifth and sixth
above the United States and Brazil (81.6); the United States, Brazil, Russia and China gained four to five points, Japan
and India lost three. The weakest are Greece (61.8), Jordan (61.0) and Kuwait (58.4). Every theatre has its four real
sides: the world, Europe, South America, Africa, Asia, North and Central America, and the Elite 32.

## The match

`src/sports/valorant.js`. A team plays at its five best players' mean, tactics and upsets included, and wins each map with
Elo's own odds for the gap (`mapOdds`). One match-day form draw for the series moves every map's gap. Three maps are drawn
from the competitive pool for the series: the seven played at vlr.gg's events from mid-October to mid-November 2026, after
the pool's last rotation (Lotus, Haven, Sunset, Summit, Corrode, Abyss and Bind).

A map is played round by round. Each round's odds are the attacker's edge on the logit scale (`beta`) and the economy:

- the first round of each half is a pistol round, even between equals;
- the second goes to the pistol's winner (`PISTOL_FOLLOW`: 87% of them), his rival on an eco;
- the third, when one team won the first two, is the bonus round: the winner plays on saved weapons against a full buy and
  wins it 43% of the time (`BONUS_ROUND`); when the pistol's loser took the second, its rival's economy is broken and the
  second round's winner takes the third 84% of the time (`BROKEN_BUY`);
- every later round leans towards its predecessor's winner (`MOMENTUM`: 59%), the economy and the form of the day
  together;
- overtime's rounds start both teams on the same money, so they have no economy; a team must win two clear.

The edge is solved so that the map, played round by round with its economy and overtime, is the attacker's with exactly
Elo's chance (`mapBeta`, read from a grid of edges): the rounds follow the ratings and the winner is Elo's. The sides
(attack and defence) are left out: defence won 49.4% of the real rounds (216,568 of them), too near half to matter.

On the clock each map has twenty-six units: its twenty-four rounds of regulation (round n at unit n) and two for its
overtime, the first pair of overtime rounds at the twenty-fifth and any later at the twenty-sixth. The shortest series (two
maps) fills 52 units, and a third map extends it as an overtime period does in other sports. The events are each pistol
round's winner, named for a player of the side (`pts` 0, the score counts maps), the side that levels at twelve all, and
each map's end (`pts` 1, the winner's), named for the map's best player: "LOTUS — BRA 13–9 · aspas". The clock reads the
map and the round ("M2 R14"). The live chart (`kind: 'rounds'` in `src/engine/winProbability.js`) knows the maps won and,
at each event, the map in play's score and economy, and holds that value until the next.

## Calibration

The four economy constants were fitted (a coordinate search, each map played at its own odds, exact by dynamic
programming) to the rounds of vlr.gg's 10,287 maps of November 2024 to November 2026 whose ten players had each played 20
maps: the round after a pistol went to its winner 87.1% of the time (the model 87.3%), the bonus round to the team on
saved weapons 43.1% (44.0%), the third round after a broken buy to the second round's winner 84.4% (84.4%), and a later
round to its predecessor's winner 59.0% (62.0%). So fitted, the model plays 21.4 rounds a map (21.2 real) and takes 12.0%
of maps to overtime (11.3%). Among the sixteen strongest nations (`npm run simulation:realism`) a map runs 21.2 rounds,
11.5% go to overtime, 23.4% end 13–10 or 13–11 (23.5% of the real maps) and 14.7% 13–4 or wider (16.0%).

Match-day form (`FORM_AT_BALANCED`) was fitted by maximum likelihood on the 3,388 real best-of-threes between seasoned
players, each at its favourite's odds a map: the favourite won 63.5% of them, no more often than a single map (63.9%), as
in Counter-Strike. The likeliest spread is 6.5 rating points (162 Elo) at Balanced, the favourite then winning 65.4%. The
sixteen strongest nations' series end 2–0 58.8% of the time (58.9% of the real best-of-threes) and 2–1 41.2% (41.1%). With
the circuits' levels (2026-11-21) the same series' favourites won 63.9% at 64.3% a map, so the fit stands.

**Home advantage.** In the 1,607 maps of the LANs where one side was the host nation's, that side did 22.8 ± 8.6 Elo better
than Elo expected: the only esport so far whose host nations show an edge beyond its error (Rocket League's +11.8 ± 7.6,
Counter-Strike's −5.2 ± 5.5). So Valorant offers the campaign's Home advantage rule, a rating point (25 Elo, `HOME_EDGE`):
at home an equal side wins 55% of its best-of-threes, within the real LANs' 51.2–58.6% (the edge two errors each way), and
among the sixteen strongest nations the hosts win 53.3% of their series (49.6% at a neutral venue). With the circuits'
levels (2026-11-21) the hosts' edge is 15.3 ± 8.5 Elo, part of the old figure having been their region's: the real LANs'
range is 49.6–56.9%, and `HOME_EDGE`'s 55% still lies inside it, so it stays. Computer signings is
not offered: any player plays any place, so the best-rated player is always the one who most
improves a lineup.

## Earlier seasons

Every year from 2023 to 2025 is a season of its own (`val-2023` to `val-2025`, chosen under Season in setup): its
players as the Elo of vlr.gg's results stood on its last day. The sync runs the same Elo over the maps up to 31 December
only and keeps who was rated then by today's rules, 20 maps behind him and one within the year; each nation names its seven
best and plays its five best, as today. A player plays for the nation the whole record gives him (his Esports Nations Cup
team, else his flags), whichever year it is: a country is a person's, and the record's national-team event is recent. His
team is the one he played for that December. The cache begins in September 2022 with 2023's first Challengers
qualifiers, so 2023 is the first whole year and the first season.

| Season | Rated | Nations | Strongest | Real maps | Rounds a map | Overtime | Map pool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2023 | 1,810 | 48 | United States 86.4, Canada 81.6, Turkey 81.0 | 2,397 | 21.29 | 11.9% | Haven, Ascent, Lotus, Bind, Split, Sunset, Breeze |
| 2024 | 2,437 | 60 | United States 86.2, South Korea 85.0, Turkey 84.8 | 4,786 | 21.15 | 11.5% | Haven, Bind, Sunset, Ascent, Abyss, Pearl, Split |
| 2025 | 2,277 | 61 | Turkey 90.0, Canada 88.6, South Korea 88.4 | 4,994 | 21.15 | 11.3% | Haven, Split, Bind, Sunset, Abyss, Pearl, Corrode |

2023's United States are The Guard's neT and Evil Geniuses' Demon1, the year EG won Champions; 2024's are M80's neT,
RANKERS' canezerra and NRG's Verno, and South Korea's best that year is Gen.G's Lakia. Each season fits its circuits'
levels on the maps up to its 31 December, as the built-in season does on all of them; before 2026-11-21 the seasons'
strongest were the United States (82.8), Turkey and Canada in 2023, South Korea (84.4), Turkey and Indonesia (82.8) in
2024, and Turkey (88.2), South Korea and Canada in 2025.

**Each year's maps.** A season plays its series on its December's pool: the seven maps played most in the year's last
thousand on vlr.gg, which hold exactly seven each year (an eighth, Lotus, appears once in 2025's). Maps come and go:
Sunset came in during 2023, Abyss in 2024 and Corrode in 2025, and Lotus sat out the ends of 2024 and 2025. The rounds
are today's model: each year's real maps between seasoned players went as today's do (the pistol's winner took the next
round 86.7–87.6% of the time, the bonus round went to the team on saved weapons 42–44%, a later round to its
predecessor's winner 58.5–59.2%, and maps went to overtime 11.3–11.9%; only the broken buy moved, from 81% in 2023 and
2024 to 84.5% in 2025). So only the maps' names differ: a season's odds and its simulation version are today's.

`npm run build:valorant-seasons` writes each season's file (`public/valorant/val-<year>.json`, format 1, kind `val`),
`public/valorant/ATTRIBUTION.txt` (vlr.gg), the listing `src/data/valorantSeasons.js`, the pools
`src/data/valorantMapPools.js` and `docs/design/valorant-seasons-audit.json` (each season's nations, who is left out,
its pool and its real maps), from the sync's `scripts/data/valorant-seasons/<year>.json`; `--check` compares them byte
for byte.

## Known limits

- Nations only: the orgs (Fnatic, Sentinels, Paper Rex…) need a map of their own.
- A player's agent role (duelist, controller…) is not modelled: any five play as five.
- 130 rated players play for no nation: Singapore's (Jinggg, STYRON…), Hong Kong's and others' whose country the map does
  not draw, and those vlr.gg files under no country; 55 more are from a nation with fewer than five.
- vlr.gg's events before VCT 2023 are not read (the cache begins with 2023's first Challengers qualifiers, in September
  2022), so the earliest season is the end of 2023.
- The small, weak circuits' best sides still stand above their results against other circuits (held out: South Asia
  −163 ± 65 Elo, Oceania −183 ± 67, Vietnam −120 ± 57, MENA −92 ± 40; India's and Australia's sides −216 ± 88 and
  −181 ± 71 on 28 and 30 maps), and South Korea's below theirs (+50 ± 20). Offsets added after the Elo were tested and not
  adopted: above, "Circuits on one scale".
