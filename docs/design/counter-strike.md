# Counter-Strike

Status: implemented 2026-11-15; its B-Tier events, the same day; each region's newcomers at that region's level (below,
"Regions"), 2026-11-21; its earlier seasons, every year from 2001 to 2025, and the reading they asked for (women's events
left out, renamed players joined, five maps within the year: below, "The reading of 2026-11-25"), 2026-11-25. The second esport and the eleventh sport: Counter-Strike 2, as its tier-one events
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
2. Under "Add pages from category", add `S-Tier Tournaments` and `A-Tier Tournaments`, and for another file
   `B-Tier Tournaments` (the wiki names its tiers, "S-Tier", where Rocket League's numbers them).
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
as redirects). A fourth, that afternoon, held 3,147 pages: the B-Tier category (2,704 events) and 519 of the 620 titles
the first three left to export. The four make 6,061 pages: 2,969 events of CS:GO and CS2 that count (3,007 with the
women's, left out since 2026-11-25), 57,632 series and 109,313 maps from 2012-09-21 to 2026-11-15; and 536 events of 1.6
and Source, 8,337 series and 9,912 maps from 2000-12-08, for the earlier seasons (below). Their list for a further export
holds 2,420 titles: the pages of 73 players rated today or at an earlier season's end with no country, none of them a
nation's best five, then 2,344 stage pages, most of them the B-Tier events' groups and qualifiers.

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
  default, if it began after CS:GO's release on 2012-08-21); wingman (2v2) and solo events and showmatches are left out,
  and so are women's (the infobox's `restrictions=female`: below, "The reading of 2026-11-25"). Counter-Strike 1.6, with
  the Counter-Strike before it and Condition Zero, and Source are read apart, for the seasons before 2013 (below,
  "Earlier seasons"); Counter-Strike Online, Nexon's, is left out.
- **Maps.** A map's rounds are its `score1` and `score2`, else its halves' sum, as the wiki's module counts them; a
  forfeit plays none. Its format is its first half's rounds where the wiki records its halves (twelve: CS2's MR12; fifteen:
  CS:GO's MR15), else its event's game; a score neither format gives (a map cut short, a typo) is not used for the round
  model, though its winner still counts for the Elo.
- **Teams.** As Rocket League's, with one more way for a series' team template to meet its event's roster: by a word of
  the team's name ("eclot" for Dynamo Eclot, "betboom" for BetBoom Team, the "unity" of "unity.sk" for UNiTY esports), which
  the Counter-Strike wiki writes often. Rocket League's reading leaves it out, so its ratings are as they were. Of the
  exports' series, 5,522 name a team with no roster of five near it (494 of the last two years': mostly open qualifiers'
  and leagues' teams the wiki lists without their players) and are left out.
- **Players.** A player is his page or his name, his spellings folded as Rocket League's are, and a player the wiki
  renamed is one (below, "The reading of 2026-11-25"). Counter-Strike's team cards since about 2017 name no flags (the
  wiki takes each from the player's page), so a player's country is his page's, else his older cards' flags.
- **Nations.** A player plays for the nation he last played for in a national-team event (the Esports Nations Cup, WESG,
  the IESF's world championships, or an event most of whose teams bear a country's name, "Team Denmark" as Denmark; 47
  events in the exports, 1,528 players), else
  his page's country. The Esports Nations Cup of November 2026 was not played by the stars: France fielded Brooxsy, Djoko,
  Ex3rcice, drac and Tarkky, so ZywOo and apEX play for France by their pages, not by that roster. Great Britain plays as
  one, as in tennis and Rocket League.

## Ratings

Rocket League's (docs/design/rocket-league.md, "Ratings"), map by map: a team plays at the mean of its five starters'
Elo, the winner of a map takes K × (1 − E) from the loser, and each player moves by his team's amount; a player's K is
180 / (maps + 5)^0.4, never below 8. A newcomer starts at his region's level (below, "Regions").

K was chosen by scoring the exports' last 180 days (6,487 maps), each map before it was played
(`npm run sync:counter-strike -- --tune`): log loss 0.6502 at K 60, 0.6445 at 110, 0.6422 at 140, 0.6408 at 180, 0.6410
at 240, 0.6436 at 320, 0.6479 at 400. Re-run on 2026-11-21 with the regions' levels (fitted on the maps before those
days): 0.6498, 0.6442, 0.6419, 0.6406, 0.6408, 0.6434 and 0.6476, so K stays 180. A map is a noisier test of two teams
than a Rocket League game (0.5759 there), and Counter-Strike's K is under three fifths of its 320. At 180 the predictions
are calibrated: maps it gave 55% went 56%, 65% went 63%, 75% went 76%, 84% went 85%.

A player is rated once he has 20 maps behind him and has played five within a year of the export's last map: 1,522 of
14,241. On the game's scale a rating is Elo / 25 − 2, as in Rocket League: a European newcomer, at 1,500, is 58, and the
best players, huNter- (Bosnia and Herzegovina, 2,336), torzsi (Hungary) and Aleksib (Finland), are 91. Each nation names
its seven best; it needs five for a team, so a nation with fewer fields none and its land stays neutral. 40 nations field
a team, from Russia (83.2: Boombl4, magixx, sh1ro, robo, frontales), Ukraine (80.8), France (80.2: apEX, ZywOo, Lucky,
Ex3rcice, Neityu) and Brazil (79.2) down to Mexico (53.8); the B-Tier events brought Bosnia and Herzegovina (huNter-,
NiKo), South Africa, Norway, Uzbekistan and Mexico up to five. Left out: 32 rated players with no country (none a
nation's best), two of countries off the map (Singapore, Hong Kong), and 54 of nations of fewer than five, Uruguay's four
among them. Counter-Strike offers every nation theatre, the Elite 32 included. Held out on the last 180 days (6,476
maps, the reading of 2026-11-25), log loss 0.6402: maps it gave 55% went 56%, 65% went 63%, 75% went 76%.

## Regions

Changed 2026-11-21, at the user's request: "just because one team is a national or a country a continental champion
they might still be quite weak in comparison to other areas". Until then every newcomer started at 1,500, so a scene
whose teams mostly play each other kept its newcomers' level whatever it was worth: South Africa's best, who play South
Africa's leagues and almost nobody else, stood with Germany's (73.2 to 74.4).

**Measured.** Each map between two regions' sides (a side is a region's when three of its five are), scored before it was
played, each region's offset fitted by maximum likelihood against Europe's, over the three years to the export's last
map, each year scored with the levels fitted on the maps before it (14,099 of 35,437 maps; ± one standard error; 25 Elo
is a rating point):

| Region (nations) | Maps | Before | After |
| --- | --- | --- | --- |
| CIS (Russia, Ukraine, Kazakhstan…) | 10,645 | +8 ± 4 | +4 ± 4 |
| South America | 2,164 | −4 ± 8 | +1 ± 8 |
| Asia (China, Mongolia…) | 1,362 | −9 ± 11 | +25 ± 11 |
| North America | 1,213 | −27 ± 11 | −6 ± 11 |
| Oceania | 484 | −74 ± 19 | −41 ± 19 |
| Middle East and North Africa | 219 | +7 ± 25 | +29 ± 25 |
| Africa | 4 | none to measure | none to measure |

A negative offset is a region its ratings overrate: Oceania's sides lost about three points' worth more than their
ratings said, North America's one. Africa's sides met another region four times in the three years; over the whole
record, each map scored before it was played, they did 108 ± 27 Elo worse than their ratings said (224 maps, most of
2014–2019). Log loss over the three years: 0.6478 → 0.6468 (all maps), 0.6426 → 0.6415 (within a region), 0.6557 →
0.6547 (between two).

**What changed.** A newcomer starts at his region's level. His region is his nation's (`regionOfNation` in
scripts/lib/counter-strike.mjs: its confederation's, with the former Soviet states the CIS's, Australia Oceania's, the
Arab states and Iran the Middle East's), else the region whose events he played most maps in: 58% of the maps are at
events that name no region, South Africa's leagues among them, and 97% of the players have a country. Each region's level
is fitted at once with every player's own strength, as League of Legends' circuits are (`regionLevels` in
scripts/lib/liquipedia-elo.mjs, after `circuitLevels`): a player plays at his region's level plus his own offset (a normal
prior of spread 250 Elo), a region's level has a prior of 150 Elo about the players' mean (a region a handful of maps
place stays near the middle), and every map counts for what it says. The levels are then moved together so that Europe's
is 1,500, where every newcomer started before, so the rating formula is unchanged. On every map of the record: Europe
1,500, the CIS 1,550, South America 1,445, North America 1,331, Asia 1,325, Middle East 1,304, Oceania 1,260, Africa
1,216 (a newcomer of no known region: the players' mean, 1,441; the reading of 2026-11-25: before it 1,553, 1,458,
1,359, 1,326, 1,307, 1,264, 1,231 and 1,447).

Rocket League's old regional starts, each region's start moved by its sides' surprise at the international events,
foresee almost nothing here, between two regions as overall (0.6555 against 0.6557 without them, over the same three
years and fitted on the maps before each): that is what dropped them on 2026-11-15, and it holds on the maps between
regions too. Their CIS 250 to 380 points below Europe was the 18 events that name the CIS (806 maps: its qualifiers and
Minors), not its players, whose events mostly name Europe; by nation the CIS stands 53 above Europe.

**The nations.** Every nation lost about a point: Europe's best had been gaining from beating sides their ratings
overrated (the best player 93 → 91). Against Germany, before → after: South Africa −1.2 → −6.2 (73.2 → 67), Australia
−3.6 → −5.2 (70.8 → 68), Mexico −15.4 → −18.4 (59 → 54.8), Argentina −1.4 → −1.8 (71.4), Brazil +6.8 → +6.6 (79.8),
Mongolia +5.2 → +5.4 (78.6), China +0.2 → +0.4 (73.6), Spain −1.4 → −1.2 (72), Denmark +6.0 → +6.0 (79.2).

**Still there.** Oceania's sides still lose more than their ratings say (−41 ± 19; by year −28, −40, −61): one level
stands for 2012–2026, and Oceania's has fallen. Asia's are now a point underrated (+25 ± 11). Africa's level rests on the
maps of 2014–2019.

**A correction on top, tested and not adopted (2026-11-21).** Each player's rating plus his region's offset, fitted only
on the maps between two regions before each held-out year (maximum likelihood, a normal prior of 25, 50 or 100 Elo, or
the prior empirical Bayes gives; on every earlier map, or on the year before only), held fixed through the year. The rule,
set before the run: adopt it if the maps between regions do better, those within a region no worse than the bootstrap
error of the difference (series as clusters), and no region's offset ends beyond two errors the other way. Between two
regions (0.6547 without it): every earlier map, +0.0001 to +0.0002 at each prior, worse; the year before, prior 25,
−0.00002 ± 0.00006, a third of its error and the best of the eight tried, while within a region +0.00004 ± 0.00001, so it
fails; 50 and 100 worse. Empirical Bayes finds the offsets' spread inside their noise and fits none: the levels already
take up what the maps before each year say about a region, and what is left moves from year to year. Fitted on the whole
record it would have moved every region by under a third of a point (every map, prior 50); the year before alone, Oceania
−1.2, North America −0.7, Asia +0.6.

## The reading of 2026-11-25

Three faults the earlier seasons showed, and the built-in season with them, mended on the user's "can you add more seasons
of counter strike" (2026-11-25). Each was measured on the maps it would foresee, every map scored before it was played.

- **Women's events are left out.** The women's circuits (ESL Impact, the women's Copenhagen Games and WESG; 38 events of
  CS:GO and CS2, 25 of 1.6) play among themselves: their best, rated on their own results from a newcomer's start, stood
  in the men's squads, GooseBreeder fifth for Canada in 2020, refinnej and Emy for the United States. Left out, every
  span of the record foresees as well or better (2021–2023 0.6461 → 0.6455, 2024–2026 0.6474 → 0.6466). A woman who
  plays the mixed events is rated on them as anyone is.
- **A renamed player is one.** The wiki moves a page when a player renames himself (Magiskb0Y to Magisk) or tells a
  namesake apart (JT to "JT (South African player)" and back), and rosters link whichever title their editor knew. An
  export holds no redirect it was not asked for, so 277 such titles were players of their own, each starting again from
  his region's level: Device and Dev1ce both in Denmark's squads of 2014 to 2017, KSCERATO's first 40 maps as "Ksc".
  Two keys are one player (`renameOf` in scripts/lib/liquipedia-elo.mjs) when their names are alike (the same but for a
  disambiguation, case and punctuation; the same with the digits written for letters, "Dev1ce"; one part of the other;
  or a typing slip apart), their nations do not clash, no roster lists both and no event both in two teams (an
  all-star match among a hundred shared line-ups aside), and the rosters show it: line-ups of three team-mates or more
  shared within 200 days, at most one roster in two teams within a month to twenty of them (the surer the name, the more
  the evidence asked: two line-ups for a name part of another, three and no clash for a slip), or for the same name the
  new title's first roster within a year of the old one's last, both of one nation (his, else half his team-mates').
  A name told apart by a person's name ("Seb (Sebastian Dietrich)") has namesakes, so it asks ten line-ups, in both
  orders. Over every game's events at once (`foldRenames`), so pasha of 1.6 is the pashaBiceps of Global Offensive. The
  folds foresee a little better in every span (2024–2026 0.6466 → 0.6463, 2018–2020 0.6346 → 0.6344).
- **Five maps within the year.** A player long retired who turned out for a map or two kept the Elo of his prime and
  played for his nation: Zeus and Skadoodle in 2021 (one map each), Edward and olofmeister in 2023. A player is rated
  only with five maps in the year to the season's last day (`minRecent`); at ten, today's season would lose Norway,
  South Africa, the Netherlands and Bosnia and Herzegovina, at five none.

Today's season moved by under a point a nation but Slovakia (68.2 → 66.4: frozen's first maps, as "Frozen (Slovak
player)", now his), and none was lost: Russia 82.8 → 83.2, Ukraine 81 → 80.8, France 80 → 80.2, Brazil 79.8 → 79.2
(KSCERATO 75 → 82, his first maps his), Denmark 79.2 → 78.8. The held-out maps: 0.6405 → 0.6402.

## Earlier seasons

Every year from 2001 to 2025 is a season of its own (`cs-2001` to `cs-2025`, chosen under Season in setup): its players
as the Elo of Liquipedia's results stood on its last day, each newcomer at his region's level as the maps to that day
alone measure it, rated by today's rules (20 maps behind him, five of them within the year), each nation's seven best
with its five best playing. A player plays for the nation his record gives him, whichever year it is (a country is a
person's), for the team he played for that December.

**Global Offensive's and Counter-Strike 2's**, from 2013: the built-in season's Elo, up to that year's end. Its record
begins on 2012-09-21, so at the end of 2012 only 19 players had twenty maps. 2013's newcomers start from what they brought
(`carriedOver`): as far above their region's level as they stood above it in 1.6 or Source, the one they had played more of,
if they had ten maps there and the last within three years (a namesake of ten years later is another person), and the
maps behind it count toward the twenty. That foresees Global Offensive's first maps far better: scored map by map, 0.571
→ 0.521 in 2012 and 0.574 → 0.561 in 2013 (1.6's and Source's ratings together, at full weight, did better than either
alone or at less weight). As a season plays them, frozen at the year's end, 2013's players foresee the next half-year's
maps better so (0.766 → 0.744, 262 maps), and from 2014 on worse (0.647 → 0.655, 0.670 → 0.677, 0.648 → 0.652): a year of
their own maps says more, so only 2013 carries them. It is marked rough.

**1.6's and Source's**, to 2012: an Elo of each (`older` in scripts/lib/counter-strike.mjs), from 2000-12-08. Their record
holds a tenth of the maps of Global Offensive's years, so a player needs ten maps there (five within the year), and a
series that records a winner but no map (a best of one's score alone, as the wiki's older brackets often keep it) counts as
one map, its winner's: that foresees the maps the wiki does record far better (log loss 0.5813 → 0.5758, 6,230 maps of
2003–2012; K 180 is as good there as in Global Offensive's years, 0.5758 against 0.5720 at 270 and 0.5795 at 150). A
player of both games is rated in the one he played more of that year. Their scenes never met, but Global Offensive's first
years put them on one scale: in 531 maps of 2012–2014 between a side of Source players and one of 1.6 players (three of
five, each of ten maps or more), the Source side did as Elo expected (+16 ± 17 Elo). 1.6 and Source fed one Elo, the
maps of each foresee worse (1.6's 2009–2012 0.5508 → 0.5521, Source's 0.5891 → 0.5962), so each is its own. 2001 to 2004,
whose ratings rest on a dozen or two events a year, are marked rough.

**How well a season foresees.** Frozen at its end, each season's ratings against the next year's maps between ten players
it rates: the favourite won 60.9% of 1.6's (1,308 maps of 2006–2012) and 58.1% of Global Offensive's (43,770 of 2014–2026).
A year on, the gaps foresee best at about half their size (0.6874 → 0.6717): teams change. The series' form takes up
some of that (below, "The match").

| Season | Games | Rated | Nations | Strongest | First to | Momentum | Real maps | Rounds, real (model) | Overtime, real (model) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2001 (rough) | 1.6 | 111 | 9 | Sweden 71, Finland 66.2, Canada 66 | 13 | 0.96 | 1 | — | — |
| 2002 (rough) | 1.6 | 125 | 8 | Sweden 71.6, Norway 68.4, Germany 65.6 | 13 | 0.96 | 11 | — | — |
| 2003 (rough) | 1.6 | 233 | 15 | Sweden 77.6, Norway 72.8, Germany 69.2 | 13 | 0.96 | 49 | 20.22 (20.55) | 6.1% (8.9%) |
| 2004 (rough) | 1.6 | 196 | 15 | Sweden 76.4, Norway 72.6, United States 68.2 | 13 | 0.96 | 26 | — | — |
| 2005 | 1.6 | 249 | 15 | Sweden 75.8, Norway 71.4, China 70.8 | 16 | 0.96 | 121 | 25.69 (25.90) | 5.0% (8.4%) |
| 2006 | 1.6, Source | 287 | 18 | Sweden 77.2, China 73.4, Poland 71.4 | 16 | 0.96 | 244 | 25.30 (25.94) | 6.1% (8.5%) |
| 2007 | 1.6, Source | 339 | 18 | Sweden 78.6, United States 75.8, China 72.8 | 16 | 0.96 | 221 | 25.94 (25.85) | 6.3% (8.3%) |
| 2008 | 1.6, Source | 349 | 16 | Sweden 77.6, Denmark 76.4, South Korea 74.4 | 16 | 0.96 | 189 | 25.68 (25.92) | 5.3% (8.4%) |
| 2009 | 1.6, Source | 478 | 22 | Sweden 79.2, Denmark 76.6, Great Britain 73.6 | 16 | 0.96 | 274 | 26.41 (25.84) | 7.3% (8.3%) |
| 2010 | 1.6, Source | 519 | 27 | Sweden 78.6, Ukraine 78.2, Denmark 77 | 16 | 0.96 | 469 | 25.82 (25.76) | 5.8% (8.1%) |
| 2011 | 1.6, Source | 418 | 22 | Sweden 80.8, France 77.4, Poland 77.4 | 16 | 0.96 | 310 | 24.93 (25.66) | 3.2% (7.9%) |
| 2012 | 1.6, Source | 403 | 18 | Sweden 82.2, Ukraine 77.2, Finland 75.2 | 16 | 0.96 | 221 | 25.88 (25.64) | 5.4% (7.9%) |
| 2013 (rough) | CS:GO | 283 | 15 | Sweden 84.6, France 80.6, Denmark 80.2 | 16 | 0.78 | 343 | 25.93 (26.01) | 5.0% (8.5%) |
| 2014 | CS:GO | 298 | 15 | Sweden 81.4, France 79.4, Denmark 78.6 | 16 | 0.91 | 986 | 25.85 (25.86) | 7.0% (8.3%) |
| 2015 | CS:GO | 632 | 27 | France 80, Denmark 79.8, Sweden 79.6 | 16 | 0.95 | 2,886 | 25.70 (25.69) | 6.6% (8.0%) |
| 2016 | CS:GO | 825 | 35 | France 81.2, Denmark 79.2, Sweden 78.4 | 16 | 0.89 | 3,070 | 25.97 (25.94) | 8.3% (8.4%) |
| 2017 | CS:GO | 985 | 41 | France 80.8, United States 78.6, Brazil 78 | 16 | 0.89 | 3,645 | 26.17 (25.99) | 9.6% (8.5%) |
| 2018 | CS:GO | 1,081 | 44 | Denmark 81.6, France 80.6, United States 77.8 | 16 | 0.87 | 4,661 | 26.23 (26.07) | 9.1% (8.7%) |
| 2019 | CS:GO | 1,030 | 42 | Denmark 81.6, France 80, Finland 79.6 | 16 | 0.71 | 4,578 | 26.71 (26.48) | 10.0% (9.4%) |
| 2020 | CS:GO | 1,237 | 43 | France 82.6, Denmark 81, Russia 80 | 16 | 0.66 | 6,361 | 26.88 (26.64) | 11.4% (9.7%) |
| 2021 | CS:GO | 1,258 | 41 | Russia 83.2, France 80.6, Denmark 80.2 | 16 | 0.62 | 6,482 | 26.86 (26.73) | 10.5% (9.9%) |
| 2022 | CS:GO | 1,280 | 39 | Russia 82.2, Denmark 80.6, Brazil 79.2 | 16 | 0.57 | 5,236 | 27.17 (26.85) | 12.0% (10.2%) |
| 2023 | CS:GO, CS2 | 1,451 | 40 | Russia 81.2, France 80.6, Denmark 79.8 | 16 | 0.57 | 6,508 | 26.98 (26.87) | 10.9% (10.2%) |
| 2024 | CS2 | 1,288 | 37 | Russia 82.2, France 80.8, Ukraine 80.6 | 13 | 0.55 | 7,333 | 21.77 (21.62) | 12.2% (11.5%) |
| 2025 | CS2 | 1,328 | 37 | Russia 83.2, Ukraine 81.2, Brazil 80 | 13 | 0.57 | 8,954 | 21.84 (21.60) | 12.7% (11.5%) |

The squads read as their years did: SK's and NiP's Sweden leads every year to 2014 (HeatoN, Potti, ahl and fisker; then
f0rest, GeT_RiGhT and Xizt; in 2014 fnatic's KRiMZ, olofmeister, JW, flusha and pronax), Pentagram's Poland comes third in
2006, mTw's Denmark and eSTRO's South Korea second and third in 2008, Na'Vi's Ukraine second in 2010, Source's VeryGames
(RpK, SmithZz, NBK) France's best in 2011 and 2012, Astralis's Denmark first in 2018 and 2019, and Russia first since 2021.
Rated players with no country: none to 2017, eight to twenty-three a year since (none a nation's best five).

**Rounds by year.** Each season plays the format most of its year's maps on the wiki were played in (`formatOf`: a map's
first half, else its game, else the format its score alone fits, else its event's): first to 13 (MR12) to 2004, as the
CPL, the ESWC and the World Cyber Games played, first to 16 (MR15) from 2005 to 2023, and first to 13 again from 2024,
Counter-Strike 2's. Overtimes are six rounds throughout, as most of the record's are (the MR5 overtimes of 2013–2014 were
fewer). Its momentum is the one that makes the year's real maps between seasoned players (all ten with 20 maps behind them;
ten in 1.6 and Source) likeliest by their loser's rounds or overtime, each played through the model at its own pre-map Elo
odds (scripts/build-counter-strike-seasons.mjs, as MOMENTUM was fitted): 0.78 in 2013, 0.89–0.95 from 2014 to 2018, when a
round lost cost a team most of its weapons, then 0.71, 0.66, 0.62 and 0.57 as the economy of 2019 eased the losers' buys,
and 0.55–0.57 in Counter-Strike 2, today's. 1.6's and Source's years, 100 to 470 maps each, share one, fitted on all of
theirs: 0.96. The audit (docs/design/counter-strike-seasons-audit.json) holds each season's maps and the model's at their
odds. The model runs a little short of the real overtimes, as today's does, and of 1.6's sides' long halves (a map's CT
and T sides differ more there than the model knows). Who wins a map is Elo's in any rounds, so a season's odds are
today's: only its rounds and its clock differ (32 units a map in MR15, 26 in MR12), and the live chart plays the season's.

`npm run build:counter-strike-seasons` writes each season's file (`public/counter-strike/cs-<year>.json`, format 1, kind
`cs`), `public/counter-strike/ATTRIBUTION.txt` (Liquipedia, CC BY-SA 3.0), the listing `src/data/counterStrikeSeasons.js`,
the rounds table `src/data/counterStrikeRules.js` (`counterStrikeIn` plays it) and the audit, from the sync's
`scripts/data/counter-strike-seasons/<year>.json`; `--check` compares them byte for byte.

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
every rated player has: 27,271 of them, 21.77 rounds a map, 12.4% to overtime (27,427, 21.78 and 12.4% in the reading of
2026-11-25, whose fit is again 0.57) (of those 3,372, 2,364 went to one
overtime, 695 to two, 227 to three, 86 to four or more). The sync keeps them by the favourite's pre-map Elo odds (1%
bins), each bin's maps, the favourite's wins, the overtimes and the loser's rounds in regulation, so the model can be
played at each real map's own odds. Momentum is fitted by maximum likelihood over the loser's rounds (0 to 11, or
overtime): 0.57 (0.56 on the first three exports' 8,277 maps).

| | Model, momentum 0.57 | Model, none | Real |
| --- | --- | --- | --- |
| Rounds a map | 21.60 | 22.85 | 21.77 |
| Maps to overtime | 11.5% | 15.1% | 12.4% |
| Lost 13–0 to 13–3 | 8.9% | 2.7% | 9.3% |
| Lost 13–4 to 13–7 | 33.1% | 26.2% | 32.5% |
| Lost 13–8 to 13–11 | 46.5% | 55.9% | 45.8% |

Without momentum the rounds are coin tosses at the map's odds and the maps run long and close; with it the losers' rounds
come within a point of the real maps' at every score. The halves, which the fit never saw, check it: the favourite's rounds
in a first half spread across 0 to 12 as the real maps' do, within a point at each score, a standard deviation of 2.26
rounds in the model against 2.33.

Series are far less predictable than their maps. In the same events' 10,394 best-of-threes with a favourite, its odds 0.624
a map before the first, the favourite won 63.9%: about as often as a single map, where independent maps at those odds would
win it 68%. The scorelines are likeliest with match-day form of 5 rating points (125 Elo) at Balanced, which gives the
favourite 65.0%, a 2–0 40.6% (39.0% real) and a 0–2 against it 17.9% (17.9%). Form grows with the square of the drama, as in
every sport.

The harness (`npm run simulation:realism`) plays the sixteen strongest nations twice a season (re-run 2026-11-25, the
reading of that day): 21.38 rounds a map (real, the seasoned maps above, 21.78; the test's range 21.2 to 22.4), 10.8% to
overtime (12.4%), 27.9% of maps won 13–5 or wider (25.9%) and 25.1% 13–10 or 13–11 (27.2%), 58.3% of series won 2–0 (the
real best-of-threes 56.8%), the favourite 66.9%. An earlier season plays its own year's rounds (above, "Earlier
seasons"), held against its year's real maps in the audit.

**No home advantage.** At the exports' LANs, 3,372 maps between seasoned players had one side of the host nation (three of
its five players); those sides did as Elo expected, within the error (+4.4 ± 5.7 Elo in the reading of 2026-11-25; +4.1 ±
5.7 before it, −3.0 ± 5.7 before the regions' levels). Over every LAN map (5,553) the host sides did worse than Elo
expected (−9.7 ± 4.3; −16.4 before the levels): small local
LANs' newcomers, who lose more than their start says, not a crowd against them, so the edge is measured between seasoned
players, as the rounds and series are. So
Counter-Strike offers no Home advantage rule, as Rocket League offers none, and a home venue changes nothing. Computer signings is left out too: any player plays any role, so the
best-rated player is always the one who most improves a lineup.

## Known limits

- Nations only: the orgs (Vitality, Spirit, FURIA…) need a map of their own.
- The earlier seasons count only the S-, A- and B-Tier events the exports hold: 1.6's and Source's records are thin (100
  to 470 maps a year between seasoned players), and 3,082 of their series name a team with no roster of five near it
  (events the wiki lists without their players). Their rounds are a model's at one shared momentum.
- A season's format is its year's majority: 2003's and 2004's MR15 maps (a third) play MR12, 2023's last months of
  Counter-Strike 2 play MR15.
- Renamed players are joined by evidence, not by the wiki's redirects: a pair the rule misses stays two (poizon, whose
  "poiz0n" rosters overlap his new team's by three weeks), and namesakes the wiki never told apart (two "Doc"s of Brazil
  twenty years apart) are one key, as they were before.
- The maps are generic: a map's rounds do not depend on which map it is (Mirage or Nuke), its sides (CT or T) or its veto.
- A country is a player's page's: a player whose page the exports lack, or whose page names none, plays for nobody (33
  rated players, none of them a nation's best). A player who changed his name is two players unless an export holds his old
  name's redirect.
- A newcomer's region is his nation's wherever he plays (a Brazilian in North America's events starts at South America's
  level), and one level stands for each region from 2012 to 2026 (above, "Regions": Oceania's has fallen since).
- Between seasoned players the Elo is a little too sure of its favourites (CS2 maps it gave 70% went 67%), where over every
  map it is calibrated: the B-Tier events' mismatches are easier to call than tier one's close maps. The series' form,
  fitted to the seasoned players' best-of-threes, takes up most of it.
- A team's players move together, so a player's rating is his teams' results, not his own play: Aleksib, who led NAVI to a
  Major, rates above ZywOo.
