# Counter-Strike

Status: implemented 2026-11-15. The second esport and the eleventh sport: Counter-Strike 2, as its tier-one events
play their playoffs. Two nations' teams of five meet in a series of maps, best of three; a map is first to 13 rounds,
twelve a half, the sides switching at half-time, and a map level at 12–12 goes to overtime: six rounds, three a half,
first to four, another at 3–3. Nations only, on the world map, for now. Everything outside the match (territory, the
draw, targeting, conquest, signings, saves) is the game's own, unchanged.

The player chose (2026-11-15): Counter-Strike after Rocket League, of the esports surveyed that day (CS2, Valorant,
Dota 2, League of Legends, Rainbow Six, Overwatch, the mobile and fighting games; battle royales and Trackmania play no
two-sided match); ratings from Liquipedia's results, the export made by hand as Rocket League's was; and Liquipedia over
Valve's own Regional Standings (below), which would have needed no export.

## The Liquipedia export

Liquipedia's robots.txt shuts Anthropic's crawlers out of every wiki (`User-agent: ClaudeBot`: `Disallow: /`), so no
script fetches anything from it (docs/design/rocket-league.md, "The Liquipedia export"): the pages are saved by a person,
in a browser, with the wiki's own export, into `data-src/liquipedia-counterstrike/` (ignored by git).

1. Open <https://liquipedia.net/counterstrike/Special:Export>.
2. Under "Add pages from category", add `S-Tier Tournaments` and `A-Tier Tournaments` (the wiki names its tiers, "S-Tier",
   where Rocket League's numbers them).
3. Keep "Include only the current revision, not the full history" and "Save as file" ticked; leave "Include templates"
   unticked. Export, and save the `.xml` into the folder.
4. `npm run sync:counter-strike` reads every `.xml` there, fetches nothing, and writes `next-export.txt` beside them: the
   stage pages the exports' events link to but lack (a Major's stages, a qualifier's groups and opens; none of an event
   yet to begin), the newest first, then the pages of the rated players it has no nation for. Paste the list into the same
   page's "Add pages manually" box for another file (in halves, if it is long), and run the sync again.
5. `npm run build-counter-strike` writes the nations from the snapshot.

The first export, of 2026-11-15, held 1,338 pages: both tier categories in one file (497 S-Tier and 795 A-Tier events,
of every Counter-Strike since 2000). Its events link 1,439 stage pages it lacked, and its rated players had no country (the
wiki's team cards here name no flags), so a second export followed the same morning in two halves of the sync's list: 776
of the first half's 822 titles and 800 of the second's 821 (its last 204 the rated players' pages, 199 of them found, 21
as redirects). The three make 2,914 pages: 1,439 events of CS:GO and CS2 that count, 29,114 series and 52,015 maps from
2012-10-02 to 2026-11-15. Their list for a further export holds 620 titles: 565 stage pages, most of them the qualifiers
and the earlier years' stages, and the pages of 55 rated players with no country, none of them a nation's best.

What the reader expects was read from Liquipedia's open-source modules (github.com/Liquipedia/Lua-Modules, through
GitHub's API and raw.githubusercontent.com): Counter-Strike's Match2 input (`Module:MatchGroup/Input/Custom`) gives a map's
rounds as `score1` and `score2`, or as its halves, `t1firstside` (`ct` or `t`) and each side's rounds in each half
(`t1ct`, `t1t`, `t2t`, `t2ct`), then each overtime's the same under `o1`, `o2`…; `Module:Info` names the games (`cs16`,
`css`, `csgo`, `csgocs2`, `cs2`…, CS:GO the default); `Module:Tier/Data` the tiers by name.

Liquipedia's content is CC BY-SA 3.0. The game credits it in the setup (the Season note) and the README, the snapshot and
the nations derived from it are shared under the same licence, and each player's source links his Liquipedia page.

### Valve's Regional Standings, the road not taken

Valve publishes its Regional Standings on GitHub (ValveSoftware/counter-strike_regional_standings), which the project's
fetcher may read. Checked 2026-11-15: monthly snapshots since August 2024, each roster's matches over the six months
before it (date, opponent, won or lost, the five who played, LAN or not), and a sample of 7,902 matches of 2022–23 with
their maps' scores. But after 2023 it gives series won and lost, not maps or rounds; no player's country; no national
team; and the repository has no licence. The round model needs CS2's maps round by round, and the nations need countries,
so Liquipedia it is.

## Reading the export

`scripts/lib/liquipedia.mjs` reads the wikitext, as for Rocket League (its team cards with five places, its maps by
`scripts/lib/counter-strike.mjs`'s `mapOf`); the ratings are the rules every Liquipedia esport shares
(`scripts/lib/liquipedia-elo.mjs`, Rocket League's, now one module), with Counter-Strike's numbers:

- **Events.** 5v5 events of S-, A- and B-Tier in CS:GO or CS2 (an infobox naming no game is CS:GO's, the wiki's
  default, if it began after CS:GO's release on 2012-08-21): Counter-Strike 1.6, Source and the like are left out, and so
  are wingman (2v2) and solo events and showmatches.
- **Maps.** A map's rounds are its `score1` and `score2`, else its halves' sum, as the wiki's module counts them; a
  forfeit plays none. Its format is its first half's rounds where the wiki records its halves (twelve: CS2's MR12; fifteen:
  CS:GO's MR15), else its event's game; a score neither format gives (a map cut short, a typo) is not used for the round
  model, though its winner still counts for the Elo.
- **Teams.** As Rocket League's, with one more way for a series' team template to meet its event's roster: by a word of
  the team's name ("eclot" for Dynamo Eclot, "betboom" for BetBoom Team, the "unity" of "unity.sk" for UNiTY esports), which
  the Counter-Strike wiki writes often. Rocket League's reading leaves it out, so its ratings are as they were. Of the
  exports' series, 3,433 name a team with no roster of five near it (130 of the last two years': mostly open qualifiers'
  teams the wiki lists without their players) and are left out.
- **Players.** A player is his page or his name, his spellings folded as Rocket League's are. Counter-Strike's team cards
  name no flags (the wiki takes each from the player's page), so a player's country is his page's.
- **Nations.** A player plays for the nation he last played for in a national-team event (the Esports Nations Cup, WESG,
  the IESF's world championship, or an event most of whose teams bear a country's name, "Team Denmark" as Denmark), else
  his page's country. The Esports Nations Cup of November 2026 was not played by the stars: France fielded Brooxsy, Djoko,
  Ex3rcice, drac and Tarkky, so ZywOo and apEX play for France by their pages, not by that roster. Great Britain plays as
  one, as in tennis and Rocket League.

## Ratings

Rocket League's (docs/design/rocket-league.md, "Ratings"), map by map: a team plays at the mean of its five starters'
Elo, the winner of a map takes K × (1 − E) from the loser, and each player moves by his team's amount; a player's K is
140 / (maps + 5)^0.4, never below 8. A newcomer starts at his region's level, each region's start solved so that its teams
win as often at the international events as Elo expects (`regionalStarts`: CIS 1,532, Europe 1,519, South America 1,496,
North America 1,484, Asia 1,431, Oceania 1,336).

K was chosen by scoring the exports' last 180 days (2,285 maps), each map before it was played
(`npm run sync:counter-strike -- --tune`): log loss 0.6679 at K 60, 0.6670 at 110, 0.6668 at 140, 0.6670 at 180, 0.6684 at
240, 0.6719 at 320, 0.6770 at 400, regional starts on. A map is a noisier test of two teams than a Rocket League game
(0.5811 there), and Counter-Strike's K is under half of its 320. At 140 the predictions are calibrated: maps it gave 55%
went 56%, 64% went 64%, 74.5% went 75%.

A player is rated once he has 20 maps behind him and has played within a year of the export's last map: 881 of 9,077. On
the game's scale a rating is Elo / 25 − 2, as in Rocket League; the best player, apEX (France, 2,160), is 84, a newcomer at
1,500 is 58. Each nation names its seven best; it needs five for a team, so a nation with fewer fields none and its land
stays neutral. 35 nations field a team, from Russia (78.6: magixx, Boombl4, chopper, donk, nafany), France (76.2: apEX,
NBK-, ZywOo, Lucky, AMANEK), Ukraine (76.2) and Brazil (76) down to the Netherlands (59.2). Left out: 54 rated players with
no country (none a nation's best), one of Singapore, off the map, and 44 of nations of fewer than five, Bosnia and
Herzegovina's huNter- and NiKo and Norway's rain among them. Counter-Strike offers every nation theatre, the Elite 32 included.

## The match

`src/sports/counterStrike.js`. A team plays at its five best players' mean, tactics and upsets included, and wins each map
with Elo's own odds for the gap (`mapOdds`). One match-day form draw for the series moves every map's gap.

A map is played round by round. Each round is the attacker's with the odds of a logit, `c + momentum`: `c` the two
sides' strength, solved for each map (`strengthFor`) so that the map, played to 13 with its overtimes, is the favourite's
with exactly Elo's odds; and `momentum` added for the side that won the round before in the same half, its money and
weapons carrying over while the losers buy less. A half's first round, the pistol round, starts both sides again, as does
each overtime's half. The map's winner is drawn first, at Elo's odds; its rounds are then drawn for that winner exactly
(`playMapWon`: each round from its chance given the map's outcome), so maps drawn this way score as the round chain does.

Each round names its MVP, any of the five, the better player more often (as Rocket League's scorers; Liquipedia records no
MVPs). On the clock each map has 26 units: a round each of regulation's 24 (a map won 13–4 is over at its 17th), then two
for its overtime, its first half in the first and the rest in the second. The shortest series fills 52 units and a third
map extends it as an overtime period does. The events are each round (`pts` 0; the score counts maps) and each map's end
(`pts` 1), named for its winner's MVP of the map. The live chart (`kind: 'maps'` in `src/engine/winProbability.js`) is exact:
the map in play from its state (`mapTable`: the chance from every score and last round), then the maps left, over the form
nodes weighed by how likely each made every round played.

## Calibration

Fitted to the exports' Counter-Strike 2 maps (MR12, from 2023-09-27) whose ten players had each played 20 maps before, as
every rated player has: 8,277 of them, 21.80 rounds a map, 12.5% to overtime (of those 1,034, 744 went to one overtime,
192 to two, 75 to three, 23 to four or five). The sync keeps them by the favourite's pre-map Elo odds (1%
bins), each bin's maps, the favourite's wins, the overtimes and the loser's rounds in regulation, so the model can be
played at each real map's own odds. Momentum is fitted by maximum likelihood over the loser's rounds (0 to 11, or
overtime):

| | Model, momentum 0.56 | Model, none | Real |
| --- | --- | --- | --- |
| Rounds a map | 21.63 | 22.87 | 21.80 |
| Maps to overtime | 11.6% | 15.2% | 12.5% |
| Lost 13–0 to 13–3 | 8.8% | 2.6% | 9.4% |
| Lost 13–4 to 13–7 | 33.0% | 26.1% | 31.8% |
| Lost 13–8 to 13–11 | 46.7% | 56.1% | 46.4% |

Without momentum the rounds are coin tosses at the map's odds and the maps run long and close; with it the losers' rounds
come within a point of the real maps' at every score. The halves, which the fit never saw, check it: the favourite's rounds
in a first half spread across 0 to 12 as the real maps' do, within about a point at each score, a standard deviation of
2.25 rounds in the model against 2.33.

Series are far less predictable than their maps. In the same events' 3,048 best-of-threes with a favourite, its odds 0.621
a map before the first, the favourite won 64.0%: about as often as a single map, where independent maps at those odds would
win it 68%. The scorelines are likeliest with match-day form of 5 rating points (125 Elo) at Balanced, which gives the
favourite 64.5%, a 2–0 40.1% (39.1% real) and a 0–2 against it 18.2% (18.1%). Form grows with the square of the drama, as in
every sport.

The harness (`npm run simulation:realism`) plays the sixteen strongest nations twice a season: 21.40 rounds a map (real,
the seasoned maps above, 21.80; the test's range 21.2 to 22.4), 11.0% to overtime (12.5%), 27.2% of maps won 13–5 or wider
(25.6%) and 24.7% 13–10 or 13–11 (27.5%), 57.9% of series won 2–0 (the real best-of-threes 57.2%), the favourite 66.8%.

**No home advantage.** At the exports' LANs, 3,363 maps had one side of the host nation (three of its five players); those
sides did as Elo expected, within the error (−5.2 ± 5.5 Elo). So Counter-Strike offers no Home advantage rule, as Rocket
League offers none, and a home venue changes nothing. Computer signings is left out too: any player plays any role, so the
best-rated player is always the one who most improves a lineup.

## Known limits

- Nations only: the orgs (Vitality, Spirit, FURIA…) need a map of their own.
- One season, today's: Liquipedia's results to November 2026. CS:GO's years are in the record, so earlier seasons, a
  year each as Rocket League's, are a matter of building them.
- The maps are generic: a map's rounds do not depend on which map it is (Mirage or Nuke), its sides (CT or T) or its veto.
- A country is a player's page's: a player whose page the exports lack, or whose page names none, plays for nobody (54
  rated players, none of them a nation's best). A player who changed his name is two players unless an export holds his old
  name's redirect.
- The Elo is a little too sure of its strongest favourites (maps it gave 83% went 70%, over 47 maps), as Rocket League's is.
