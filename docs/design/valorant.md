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
  Ascension belong to none. A player's home circuit is the one he has played most maps in. League of Legends starts each
  newcomer at his home circuit's level, fitted at once with every player's strength (`circuitLevels`;
  docs/design/league-of-legends.md, "Ratings"), because its leagues meet too seldom for Elo to place them. Valorant's do
  meet: the VCT's teams play the Challengers' at the off-season's events, and a promoted team plays a VCT season on its
  Challengers ratings. Elo places them itself, and a newcomer starting at 1500 predicts the held-out maps better than the
  levels at every K (below), so `CIRCUIT_LEVELS` is off.

K was tuned on the last 180 days' maps, from 19 May 2026 (3,836 of them), each scored before it was played (`--tune`, the
levels fitted on the maps before):

| K_SCALE | log loss | with the circuits' levels |
| ---: | ---: | ---: |
| 80 | 0.6539 | 0.6582 |
| 120 | 0.6465 | 0.6503 |
| 160 | 0.6419 | 0.6454 |
| 200 | 0.6393 | 0.6425 |
| 240 | **0.6379** | 0.6410 |
| 320 | 0.6379 | 0.6408 |
| 400 | 0.6406 | 0.6432 |

K_SCALE is 240. The two tiers looked uneven before the holdout: in their 2,057 meetings the VCT's sides beat the
Challengers' more often than Elo expected, worth an offset of 80 Elo fitted on them. Over the held-out half-year, though,
the VCT's sides won 271 of their 526 meetings against 284.4 expected, and that offset made those meetings' log loss worse
(0.6825 → 0.7180): the players just up from Challengers (100 Thieves' Timotino and vora, LEVIATÁN's Neon) beat their Elo
rather than fall short of it. So no offset between the tiers is kept. The held-out log loss is 0.6379 (Brier 0.2240), and
Elo's odds hold by tenths: favourites at 0.55 won 0.53 of 884 maps, at 0.65 0.66 of 688, at 0.75 0.73 of 373 and at
0.84 0.84 of 159.

A player is rated once he has 20 maps behind him and has played within a year of the last map: 2,437 of the 18,179
players vlr.gg's maps name. On the game's scale a rating is Elo / 25 − 2, so a rating point is 25 Elo points, as in
Rocket League and tennis, and the match model plays Elo's own odds. The best are Team Heretics' RieNs (96), Team
Vitality's PROFEK (93), LEVIATÁN's Neon and 100 Thieves' Timotino (91), then G2's jawgemo, 100 Thieves' vora, M80's Kyu
and S8UL's SkRossi (90).

## Nations

A player plays for the nation he last played for at the Esports Nations Cup (its 2026 qualifiers, each team a country:
448 players), else the flag vlr.gg files him under most often; a player whose only flag is "un" plays for nobody, and so
does one from a country the map does not draw (Singapore, Hong Kong, Macau). Taiwan's "tw" is Chinese Taipei's. Great
Britain plays as one, as in Rocket League and tennis. A gamer tag that is an insult or an obscenity (one rated player's
reads "bitch, you'd better be ready" in Chinese) plays for nobody, so the game never shows it (`isOffensiveName`).

Each nation names its seven best; it needs five for a team, so a nation with fewer fields none and its land stays
neutral. 63 nations field a team. Turkey leads (88.2: RieNs, NAVI's Ruxic and the best of Challengers Türkiye), then
Canada (87.8: Timotino, vora, Kyu), South Korea (86.2), Russia (83.6), the Philippines (83.4) and Japan (83.0); the
United States and Brazil are ninth and tenth (81.6), their strength spread over many teams. The weakest are Jordan
(62.0), Greece and Austria (61.4), Kuwait and Switzerland (60.2). Every theatre has its four real sides: the world,
Europe, South America, Africa, Asia, North and Central America, and the Elite 32.

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
sixteen strongest nations' series end 2–0 58.8% of the time (58.9% of the real best-of-threes) and 2–1 41.2% (41.1%).

**Home advantage.** In the 1,607 maps of the LANs where one side was the host nation's, that side did 22.8 ± 8.6 Elo better
than Elo expected: the only esport so far whose host nations show an edge beyond its error (Rocket League's +11.8 ± 7.6,
Counter-Strike's −5.2 ± 5.5). So Valorant offers the campaign's Home advantage rule, a rating point (25 Elo, `HOME_EDGE`):
at home an equal side wins 55% of its best-of-threes, within the real LANs' 51.2–58.6% (the edge two errors each way), and
among the sixteen strongest nations the hosts win 53.3% of their series (49.6% at a neutral venue). Computer signings is
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
| 2023 | 1,810 | 48 | United States 82.8, Turkey 79.6, Canada 79.4 | 2,397 | 21.29 | 11.9% | Haven, Ascent, Lotus, Bind, Split, Sunset, Breeze |
| 2024 | 2,437 | 60 | South Korea 84.4, Turkey 83.6, Indonesia 82.8 | 4,786 | 21.15 | 11.5% | Haven, Bind, Sunset, Ascent, Abyss, Pearl, Split |
| 2025 | 2,277 | 61 | Turkey 88.2, South Korea 85.2, Canada 84.4 | 4,994 | 21.15 | 11.3% | Haven, Split, Bind, Sunset, Abyss, Pearl, Corrode |

2023's United States are The Guard's neT and Evil Geniuses' Demon1, the year EG won Champions; 2024's South Korea leads
behind Gen.G's Lakia.

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
