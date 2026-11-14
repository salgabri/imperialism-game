# Women's tennis

Status: implemented 2026-11-08, with 53 earlier seasons back to 1973 the same day, five more, 1968–1972, on
2026-11-09, and five more, 1963–1967, the Federation Cup's first years, on 2026-11-14 (Earlier seasons, below). The ninth
sport: the women's game by the rules of the Billie Jean King Cup, with the WTA's players rated by their Elo. Nations
only, on the world map. It is a sport card of its own beside Tennis, as women's
football is beside football, and it plays [tennis](tennis.md)'s rules and match model, changed only where the women's
tour plays differently: its serve.

Three choices follow the men's game, where the user made them: five rubbers rather than the Finals' three, Elo ratings
only with nothing estimated, and Russia and Belarus fielding teams although both are barred from the cup today.

## The format

Since 2026 the Billie Jean King Cup's qualifiers (April) and play-offs (November) play the Davis Cup's tie
([billiejeankingcup.com](https://www.billiejeankingcup.com/en/more/format), read 2026-11-08): two singles on day one,
the doubles first on day two and then the two reverse singles, first to three. The Fed Cup's old World Group put the
doubles last; the cup moved it. So the women's tie is the men's, in the men's order: day one, each side's No. 1 plays
the other's No. 2; day two, the doubles, then No. 1 against No. 1 and No. 2 against No. 2. Every rubber is a
best-of-three match of tie-break sets, and dead rubbers are not played, so a tie ends 3–0, 3–1 or 3–2. The Finals (two
singles and a doubles on one day, first to two) are not offered, as the Davis Cup's Final 8 is not. That is the built-in
season's format; an earlier season plays its own year's, three-rubber ties and advantage sets included
([Format by year](#format-by-year)).

## Format by year

Status: implemented 2026-11-10, with the men's ([tennis.md](tennis.md#format-by-year)). An earlier season plays the
cup of its year, the Federation Cup to 1994, the Fed Cup to 2019 and the Billie Jean King Cup after: `matchSport` asks
the sport for its season's rules (`rulesFor`) and `FED_CUP_FORMATS` in `src/sports/tennis.js` answers, one sport object
a format. Every rubber is best of three sets in every year; what changed is the tie and the tie-break.

| Seasons | Tie | Sets | Source |
| --- | --- | --- | --- |
| 1963–1975 | Three rubbers, first to two, at one venue in one week: the No. 2s' singles, the No. 1s', the doubles | Advantage sets | [Billie Jean King Cup](https://en.wikipedia.org/w/index.php?oldid=1380349265): "a team championship played over one week"; [1995 Fed Cup](https://en.wikipedia.org/w/index.php?oldid=1369040089): "Two singles rubbers were added to the ties" in 1995; for 1963–1967 the cup's pages of each year ([1963–1967](#19631967)) |
| 1976 | The same | Tie-break sets | [1976 Federation Cup](https://en.wikipedia.org/w/index.php?oldid=1368553932): "The tiebreaker also was used for the first time" |
| 1977–1979 | The same | Advantage sets | The match files |
| 1980–1994 | The same | A tie-break in the first two sets, the third an advantage set | The match files |
| 1995–1999 | Five rubbers over two days, home and away: No. 1 against No. 2 each way, the reverse singles, the doubles last | The same | [1995 Fed Cup](https://en.wikipedia.org/w/index.php?oldid=1369040089); [Billie Jean King Cup](https://en.wikipedia.org/w/index.php?oldid=1380349265): "The final match is a doubles" |
| 2000–2001 | Three rubbers: the World Group in round-robin pools at one venue | The same | [2000 Fed Cup](https://en.wikipedia.org/w/index.php?oldid=1369039908); [2001 Fed Cup](https://en.wikipedia.org/w/index.php?oldid=1369040095) |
| 2002–2017 | Five rubbers, the doubles last | The same | The match files; the Billie Jean King Cup article on the World Group of 2005 |
| 2018–2024 | Five rubbers, the doubles last: the qualifiers and play-offs, home and away (the Finals of 2020–2024 played three-rubber ties) | Tie-break sets | The match files; [2024 qualifying round](https://en.wikipedia.org/w/index.php?oldid=1370525899): rubbers 1–4 singles, 5 the doubles |
| 2025 | Three rubbers: the qualifiers and play-offs in round-robin groups of three at one venue each | Tie-break sets | [2025 qualifying round](https://en.wikipedia.org/w/index.php?oldid=1322355180); [2025 play-offs](https://en.wikipedia.org/w/index.php?oldid=1324057027) |
| 2026 (built-in) | Five rubbers over two days, the doubles third, as in the Davis Cup | Tie-break sets | [2026 Billie Jean King Cup](https://en.wikipedia.org/w/index.php?oldid=1382241565): "with doubles rubber moved to the third game, coinciding with Davis Cup" |

The revisions were read on 2026-11-10, each article page fetched once under `/wiki/`. Jeff Sackmann's match files (the
pinned archive of Earlier seasons) hold the singles of every tie and bear the rest out, as `node
scripts/tennis-formats-real.mjs` counts them (2026-11-10):

- **Three rubbers.** Every World Group tie of 1968–1994 has two singles, numbered 1 and 2, so the doubles came third (as
  the 2025 qualifying round's ties list it); the first singles is the weaker pair's (the No. 2s') in 560 of the 571 ties
  of 1975–1994 whose four players have a ranking, and in 29 of the 30 round-robin ties of 2000–2001.
- **Five rubbers.** All 357 World Group and play-off ties of 1995–2022 number their singles 1 to 4: the doubles came
  fifth. The first reverse singles is the No. 1s' in 259 of the 275 of them whose players have a ranking.
- **Tie-breaks.** None of the 1,124 Fed Cup sets of 1968–1975 ended 7–6, and 68 went past 7–5. Of 1976's 158, twelve
  ended 7–6 and none went past it. In 1977–1979, 31 of 547 went past 7–5 and two ended 7–6. From 1980 to 2017 the World
  Group's first two sets ended 7–6 (459 of 5,600) and never went past it, while 70 of its 761 deciding sets went past
  7–5 and the six that ended 7–6 were all dead rubbers. From 2018 none of 1,715 sets went past 7–5.
- **The first cups, 1963–1967** (Wikipedia's pages of each year, singles and doubles, as `node
  scripts/tennis-formats-real.mjs` counts them, 2026-11-14): 77 ties, each two singles and the doubles third; none of
  their 520 sets ended 7–6 and 42 went past 7–5 (57% of them 8–6, the longest 13–11). The doubles was played even
  where the singles had decided the tie, in all 57 such ties; the game, as for 1968–1975, plays no dead rubber, which
  changes no tie's result. Which singles came first is not clear: by the players' Elo at the season's end, the pages
  list both sides' No. 1s first in 33 ties, both No. 2s first in 15 (29 mixed), the No. 1s mostly in 1963–1965 (23 to
  2) and the No. 2s in 1967 (8 to 3). By the same measure the match files number the No. 1s' singles first in 1973–1975
  too (28 ties to 1, 10 mixed; those ties have no rankings) and the No. 2s' from 1976. Both singles are played in every
  tie, so the order changes no tie's odds, and every three-rubber year keeps the No. 2s first.

**The model.** The men's ([tennis.md](tennis.md#format-by-year)), at the WTA's serve:

- **Three rubbers.** The No. 2s, the No. 1s, then the doubles, first to two: a tie ends 2–0 or 2–1, and its clock is
  two rubbers long (40 units) with the third as overtime, so the chart ticks R1 and R2, then R3 once it is played, and the
  feed reads "rubber 2 of 3". Fewer rubbers mean more upsets: by the live model's exact odds, 1985's sixteen strongest
  nations' favourites win 77.2% of their three-rubber ties, 80.7% were they today's five-rubber ones.
- **Advantage sets**, game by game until a side is two clear, with the WTA's holds: of the sets that play on past 7–5,
  about 46% end 8–6 (the men's 32%), as women break more often.
- **The doubles last** changes no tie's odds: the rubbers are the same, only which of them go unplayed.

**Realism** (`npm run simulation:realism`, "The cups by year": each season's sixteen strongest nations, 40 seasons, 4,800
ties; real: the World Group's singles, every tie's, in the match files):

| Measure | 1972 | Real, 1968–1975 | 1985 | Real, 1980–1994 | 2005 | Real, 1995–2017 |
| --- | --- | --- | --- | --- | --- | --- |
| Ties won 2–0 / 2–1 | 72.2 / 27.8% | 64.8 / 35.2% | 61.9 / 38.1% | 57.6 / 42.4% | — | — |
| Ties won 3–0 / 3–1 / 3–2 | — | — | — | — | 40.8 / 33.6 / 25.6% | 38.5 / 34.0 / 27.5% |
| Rubbers to a third set | 29.9% | 23.6% | 33.1% | 23.8% | 33.6% | 31.6% |
| Sets that reached 6–6 | 10.1% | 6.0% | 10.4% | 7.2% | 10.6% | 10.3% |
| Sets past 7–5 ending 8–6 / 9–7 / longer | 47.5 / 23.4 / 29.1% | 54.5 / 21.2 / 24.2% (with 1977–1979) | 43.1 / 26.1 / 30.7% | 38.6 / 24.3 / 37.1% (deciding sets, 1980–2017) | 45.9 / 25.0 / 29.1% | the same |

The real samples (`scripts/tennis-formats-real.mjs`): 250, 806 and 265 ties; 1,118, 3,607 and 2,399 sets; 99 sets and
70 deciding sets past 7–5. The Federation Cup to 1994 was an open event, every entrant in one draw rather than sixteen of
the strongest: its rubbers were more one-sided (fewer went to a third set) and more of its ties split the two singles
(2–1) than the model's. The World Group of 1995–2017, a field of the strongest like the game's, lands within three points.

## Data

**Source.** Tennis Abstract (Jeff Sackmann) publishes Elo ratings for the women it has enough recent matches for,
updated weekly: [wta_elo_ratings.html](https://tennisabstract.com/reports/wta_elo_ratings.html), 505 players on
2026-11-02, from Elena Rybakina's 2159 (Aryna Sabalenka 2159, Coco Gauff 2124) down to 1076. Its WTA rankings report
([wtaRankings.html](https://tennisabstract.com/reports/wtaRankings.html), 1,551 players) gives each player's country,
the IOC code the WTA files her under, and her birth date. Every rated woman is in it, so no player page was needed.

`npm run sync:womens-tennis` is the men's sync with `--tour=wta` (`scripts/sync-tennis.mjs`): it caches the two pages in
the ignored `data-src/tennis/` and writes `scripts/data/womens-tennis-elo.json` (committed), rows of
`[key, name, country, birth date, Elo, hard, clay, grass, Elo rank, WTA rank]`. The men's snapshot rebuilds from its own
cache byte for byte. Tennis Abstract's spelling is kept as it is, without diacritics (Iga Swiatek, Karolina Muchova).

**Ratings.** A player's rating is her Elo on the men's scale, Elo / 25 + 4, rounded (`scripts/lib/tennis.mjs`):
Rybakina and Sabalenka 90, Gauff 89, the list's last 47. A rating point is 25 Elo points, so the match model plays
Elo's own odds. The women never meet the men, so the two lists need no common level. Each player's source reads "Tennis
Abstract Elo", her raw Elo in its title, her WTA rank beside it (`wtaRank`, where the men's has `atpRank`) and a link to
her page (`wplayer.cgi`, Tennis Abstract's women's pages).

**Nations.** `npm run build-womens-tennis` (`scripts/build-tennis.mjs --tour=wta`, `--check` rebuilds byte for byte)
writes `src/data/rosters.womens-tennis.js`: each nation's five best by Elo, as a captain nominates five. It needs two
for a tie. 45 nations field a team, from the United States (87.1: Gauff 89, Jessica Pegula 88, Iva Jovic 82, Amanda
Anisimova 81, Emma Navarro 80), Russia (84), Czechia (83.5), Ukraine (82.9) and Poland (81.6) down to India (55). Left
out:

- five from a country the map does not draw or from no country of their own: Malta, Andorra, Liechtenstein and Hong
  Kong one each, and Carol Young Suh Lee, filed under Pacific Oceania (POC), the islands' combined team;
- thirteen who are their nation's only rated player: Alexandra Eala (Philippines), Clara Tauson (Denmark), Mayar Sherif
  (Egypt), Lulu Sun (New Zealand), Danka Kovinic (Montenegro), Elena Malygina (Estonia), Sada Nahimana (Burundi), Yasmine
  Kabbaj (Morocco), Lina Gjorcheska (North Macedonia), Justina Mikulskyte (Lithuania), Raluka Serban (Cyprus), Lina
  Glushko (Israel) and Mell Elizabeth Reasco Gonzalez (Ecuador).

A nation without a team stays neutral land, as in women's football; with no African nation fielding two, Africa is
neutral. Two IOC codes the men's list never needed are mapped (Slovenia's SLO, Indonesia's INA). A player plays for the
country Tennis Abstract files her under, which follows the WTA, not cup nominations: Daria Kasatkina plays for Australia,
Varvara Gracheva for France, Kamilla Rakhimova and Polina Kudermetova for Uzbekistan. Great Britain plays the cup as one,
so the home nations' shapes start in the United Kingdom's empire, which plays as Great Britain (GBR) under the Union Jack.

## The team

The men's: `tennisLineup` in `src/data/teams.js` (both sports are `TENNIS_SPORTS`, tested with `isTennisSport`). The two
best play the singles, the next two the doubles, and a team of two plays its singles players in the doubles as well:
Armenia's doubles are Alina Charaeva and Elina Avanesyan. Strength weighs each place by its rubbers. There are no doubles
ratings: a pair is its players' singles mean.

## The match model

`src/sports/tennis.js` builds both sports with `tennisSport({ id, name, blurb, rosters, tour })`;
`src/sports/womensTennis.js` is the women's, with `tour: WTA`. A rubber's odds, the tie's form, the day form inside a
rubber, the clock, the feed and the live chart are the men's. The tour changes the games inside the sets:

- **The serve.** Jeff Sackmann's match files count the WTA's servers winning 56.7% of their service points and holding
  65.7% of their games, against the ATP's 64.0% and 79.9% (tour-level best-of-three singles, 2022–2025: 10,229 completed
  WTA matches and 9,454 ATP ones, the files of the archive's mirror
  [Aneeshers/tennis-sackmann-archive](https://github.com/Aneeshers/tennis-sackmann-archive), read into the ignored
  `data-src/research/womens-tennis/`). The women's sets are played at 56.7% (`WTA.serve`), the men's at 64%; the two
  servers still split the difference so that the better player wins a set exactly as often as Elo says (`serveEdge`).
  Women break more, so fewer of their sets reach a tie-break and more end 6–0. Who wins a set, a rubber or a tie does
  not change.
- **Day form stays the men's.** The WTA's best-of-three matches go to a third set 33.7% of the time, the ATP's 35.9%,
  but like for like the gap nearly closes: between two top-20 players 35.8% and 36.1%, two top-50 players 36.6% and
  37.8%. The WTA's lower share is mostly its more lopsided draws, which the Elo gaps already carry, so the women keep
  the men's spread of 1 in the log-odds of a set, and the live chart (`kind: 'rubbers'`) is the same for both.
- **Home advantage** is the Davis Cup's: 1.8 rating points in a singles rubber, 0.7 in the doubles. No study of the
  Fed Cup's or the Billie Jean King Cup's hosts was found, and Sackmann's files do not say who hosted a tie. The host
  picks the surface and fills the stands in both cups.

## Realism

`npm run simulation:realism` plays the sixteen strongest nations against each other, each pair once a season, 40
seasons (4,800 ties), beside the Davis Cup's:

| Measure | Model | Real (WTA tour, 2022–2025) |
| --- | --- | --- |
| Ties won 3–0 / 3–1 / 3–2 | 29.2% / 36.0% / 34.8% | — |
| Rubbers to a third set | 36.4% | 33.7% of the matches; 35.8% between two top-20 players |
| Sets decided in a tie-break | 11.5% | 11.1% |
| Sets won 6–0 | 3.8% | 5.0% |
| Favourite wins the tie | 75.3% | — |
| Host wins, Home advantage on | 56.3% (50.2% neutral) | the Davis Cup's 55–62% |

Set by set, a probe of the same field (each pair 40 times, 19,460 rubbers) lands within about a point of the tour's
sets:

| Set score | Model | WTA tour |
| --- | --- | --- |
| 6–4 | 22.8% | 21.4% |
| 6–3 | 21.9% | 22.0% |
| 6–2 | 18.0% | 18.0% |
| 6–1 | 11.7% | 12.9% |
| 7–6 | 11.5% | 11.1% |
| 7–5 | 9.8% | 9.4% |
| 6–0 | 4.3% | 5.0% |

The men's, played at their own serve, stay as they were (18.6% tie-break sets against the ATP's 19.1%, 1.6% 6–0
against 2.0%). The women's favourites win more often than the Davis Cup's (75.3% against 72.1%): their top sixteen are
further apart.

**Campaigns.** `probeCampaign` (`scripts/balance.mjs`) over the elite 32, 200 campaigns under each of the blitz, chaos
and one-by-one draws with a single and a best-of-three final (1,200), neutral and then at home: every campaign
completes; attackers win 45.4% of fixtures (39.7% at home); the United States win 29% of the titles (25% at home),
then Russia 14–16%, Ukraine 10–12%, Czechia 8–11% and Poland 9%; a champion started fifth on average, and 18 to 20
nations win a title in each 200. The men's, by the same probe the same day, are unchanged: Italy and Spain about 62%.

## Interface

- **Setup.** A Women's tennis card after Tennis, with Tennis's racket, as women's football has football's ball. It is
  nations only (`nationsOnly`): the Clubs choice is off and a challenge link's `teams=clubs` is ignored. Its Season
  choice lists the built-in 2026, then the 63 earlier seasons back to 1963. Nine sports no longer split into two even rows, and five across would squeeze
  "Basketball" out of its tile on a desktop's setup column (a 74px word in a 62px tile), so the tiles sit in three rows
  of three (`sportColumns` in `SetupOverlay.jsx`), trimmed to what the icon and name need and still 44px targets. On a
  360×640 phone with a notice line (Resume, a challenge link) step 1's heading then gives way, as step 2's does for
  More rules. Checked in Chrome at 360×640, 375×667, 390×664, 768×1024, 1024×768, 1280×720 and 1440×900 with a save
  waiting: no label overflows its tile and nothing scrolls.
- **Squad, match, ledger.** The men's court, rubbers feed, Singles and Doubles profile and tale of the tape, for any
  `isTennisSport` id.

## Tests

`scripts/womens-tennis.test.mjs`: both tours' nations rebuild byte for byte; every rating is the player's Elo / 25 + 4,
with her WTA rank and women's page; the 45 nations and who is left out and why (the combined team, the off-map, the
nations of one); the territory and Great Britain; the lineup and Armenia's doubling; the WTA's serve (holds, the serve
edge, fewer tie-breaks and more 6–0 sets than the men's at the same odds, the same share of third sets); a tie in the
cup's order, the fast path and the full tie agreeing seed for seed, and the same seed scoring differently with the men's
serve; the odds and the live chart; setup, the season, challenge links; the court and the doubling note; the running
App launching the world, playing the United States against Russia and saving it. `scripts/setup-wizard.test.mjs` holds
the three rows of tiles; `scripts/home-advantage.test.mjs` and `scripts/simulation-realism.test.mjs` the host's edge;
`npm run smoke` adds a Billie Jean King Cup campaign of the world. `scripts/womens-tennis-seasons.test.mjs` holds the
earlier seasons (below), and `scripts/tennis-formats.test.mjs` their formats by year with the men's: the cup's format of
each year, a 1990 tie of three rubbers (the No. 2s first, first to two, the third set an advantage set) and a 1997 one
with the doubles last, the live chart and the clock of a three-rubber tie, the feed's "rubber 2 of 3", the win chart's
ticks, and the running App playing a 1985 season in three-rubber ties.

## Known limits

- **The built-in season is 2026**, as of Tennis Abstract's update of 2 November; the earlier seasons have their own
  limits (Earlier seasons, below).
- **No doubles specialists**, as in the men's game: a pair is its players' singles mean.
- **No surfaces**: the host's choice is in the home edge, not played. The snapshot keeps each player's hard, clay and
  grass Elo.
- **The home edge is the Davis Cup's**, not measured for the women's cup.
- **Players by the country Tennis Abstract files them under**, not by cup nominations.
- **A three-rubber year's team strength** still weighs its places as five rubbers do (`TENNIS_WEIGHTS` in
  `src/data/teams.js`: the No. 1 and No. 2 two rubbers each, the pair one), so the strength shown before a tie of
  1968–1994, 2000–2001 or 2025 leans a little more on the singles than its rubbers do; the ties themselves play each
  rubber by its own players' ratings.
- **Every year at today's serve**, as the men's: the Fed Cup's sets reached 6–6 less often than the model's (7.2% in
  1980–1994, 10.4% in the model's 1985).
- **Licence**: Tennis Abstract's reports and Sackmann's match files are CC BY-NC-SA 4.0 (credit "Jeff Sackmann / Tennis
  Abstract", non-commercial), as the men's ratings are; the ads question in the men's notes applies here too.

## Earlier seasons

Status: built 2026-11-08, when the user asked for them after the sport shipped; 1968–1972 added 2026-11-09 (1968–1972,
below) and 1963–1967 on 2026-11-14 (1963–1967, below). The Season choice lists 63 earlier seasons, 2025 back to 1963,
each the WTA's women (before 1968 the amateurs) at the end of a year and the Fed Cup nations of that day, nations only
(set ids `wta-<year>`, kind `wta`, `public/womens-tennis/wta-<year>.json`). They follow the men's seasons
([tennis.md](tennis.md), "Earlier seasons") and the user's choices for them: Tennis Abstract's own published lists where
they exist, earlier years computed from Jeff Sackmann's match results by Tennis Abstract's published method, on today's
scale and labelled as computed. The same scripts build both tours (`--tour=wta`), and the men's files rebuild byte for
byte. Since 2026-11-10 each season plays its year's cup format ([Format by year](#format-by-year)).

### Sources

- **2016–2025: Tennis Abstract's year-end WTA reports**, as the Wayback Machine archived them, the last update of each
  season: 28 November 2016, 25 December 2017, 26 November 2018, 2 December 2019, 9 November 2020, 20 December 2021,
  26 December 2022, 25 December 2023, 23 December 2024 and 29 December 2025. No capture holds a later 2020 update, so that
  list misses the season's last event, Linz, and says so ("Tennis Abstract Elo, 9 November 2020, before Linz"). 2024 takes
  the update of 23 December, as the men's does: the next one, 30 December, may already hold the 2025 United Cup.
- **Countries** of the published seasons come from Tennis Abstract's WTA rankings report, by player key, from the capture
  nearest the list's date (ten, November 2016 to January 2026). Two captures the Wayback Machine redirects are pinned at
  the capture it serves (2 March 2018, 26 January 2025). Tennis Abstract has renamed 26 keys since (married and legal
  names: `CoriGauff` is `CocoGauff`, `DariaGavrilova` `DariaSaville`, `StormSanders` `StormHunter`, `KaterynaKozlova`
  `KaterynaBaindl`): `keyAliases` joins each to the current one, which also finds the player in the match files and links
  her page. Its own report gives Megan Mccray the country "rc=" in 2016–2018 (`garbled`, skipped). One woman of its 2023
  list, Tatiana Barkova, is in no match file and plays for nobody.
- **1973–2015: Elo computed** from Jeff Sackmann's WTA match results, 1968 to 2025: the tour-level files (with the Fed
  Cup) and the ITF and qualifying files. The original repository is gone and no fork of it was found; the archive
  [Aneeshers/tennis-sackmann-archive](https://github.com/Aneeshers/tennis-sackmann-archive) at commit `8373358` holds its
  files (`wta/`), pinned, and its Hugging Face mirror the same. Labels read "Elo from match results, end of 1985"; the
  player's source is "Elo from match results", with her Elo in its title.
- **1963–1972: a second run** of the same method on the same files, warmed up on the four majors' women's singles of
  1960–1967 and the Federation Cup of 1963–1967 as English Wikipedia's article pages record them (1963–1967, below).
  1963–1967 are those results alone, labelled "Amateur Elo, end of 1965 (rough)".
- **Pins.** `scripts/data/womens-tennis-seasons.json` holds the SHA-256 of all 117 archive files and the 20 captures, and
  (`wikipedia`) the revision, SHA-256 and size of each of the 165 Wikipedia pages and of Wikidata's answer.
- **Licence.** As the men's: CC BY-NC-SA 4.0, the computed ratings derived data under the same terms;
  `public/womens-tennis/ATTRIBUTION.txt` credits both, and Wikipedia's contributors for the results of 1960–1967 (the
  pages' text is CC BY-SA 4.0; only the results, which are facts, are used, and none of the text is in a file).

`npm run sync:womens-tennis-seasons` reads the pinned inputs from the ignored `data-src/womens-tennis-seasons/`
(downloading any that are missing; a Wikipedia page fetched again is its current revision and will not match its pin,
so that cache, `wikipedia/` and `wikidata/`, is the record) and writes one snapshot a season to
`scripts/data/womens-tennis-seasons/<year>.json` (1.4 MB in all, committed) and `validation.json`. `npm run
build:womens-tennis-seasons` builds the season files, `src/data/womensTennisSeasons.js`, the attribution and
`docs/design/womens-tennis-seasons-audit.json`. Both have `--check` and rebuild byte for byte.

### The method

The men's engine (`scripts/lib/tennis-elo.mjs`): the same expected score, K, layoff penalty, season ends and ten counted
matches a season. Two things are the women's own:

- **What counts** (`wtaLevelOf`), by Tennis Abstract's report ("tour-level, tour-level qualifying ... or ITF $50K+
  matches"): tour-level main draws (the tour's W events, the majors, the Fed Cup and Billie Jean King Cup, the Olympics,
  the Finals, the Tiers of 2000–2008, Premier and International), tour-level qualifying, and the main draws of the WTA
  125s and of ITF events of $50K or more. Not the files' exhibitions, junior events or ITF circuits under $50K, nor the
  qualifying of a 125 or an ITF event. Before 1994 the files name no ITF event's prize (they are satellites, futures and
  "ITF" events of every size), so none of them counts.
- **Where a newcomer starts.** 1330 at tour level, 1275 at a 125, an ITF event or in qualifying (the men's 1450 and
  1275). Tennis Abstract publishes neither. With the men's 1450, the 1970s and 1980s came out about 100 points high:
  before 1994 every newcomer's first counted match is at tour level, and a weak newcomer starting high gives her points to
  the stars. 1330 was fitted on the career peaks of the 17 women of Tennis Abstract's Tennis 128 (2022) whose peaks fall
  in 1973–2000: computed minus published, −0.4 on average, root mean square 42.7 (1970s +7.5, 1980s +29.8, 1990s −18.3);
  the 14 later peaks −4.7. Graf comes out +5, Seles +4, Mandlikova −1, Navratilova +30, Evert +34; the 1970s are rough
  (Austin +93, Goolagong +75, Wade −86), and Hingis, whose 2001 peak lies outside the fit, −121. The men's fit was closer
  (15.1): Tennis Abstract's women's database reaches back to the 1920s, these files only to 1968.

**Validation** (`scripts/data/womens-tennis-seasons/validation.json`; the Elo of the same women, computed minus
published, over Tennis Abstract's top hundred):

| List | Matched | Mean difference | Correlation | Slope | Top ten shared | Listed by both |
| --- | --- | --- | --- | --- | --- | --- |
| 2016, pre-2018 method | 97 | −5.3 | 0.995 | 1.02 | 8 | 136 of 148 |
| 2017, pre-2018 method | 97 | +6.7 | 0.992 | 1.01 | 8 | 135 of 173 |
| 2018, tour level only | 96 | +27.8 | 0.911 | 1.10 | 8 | 174 of 194 |
| 2019 | 100 | +28.2 | 0.966 | 1.07 | 8 | 296 of 302 |
| 2020 | 100 | −9.7 | 0.905 | 0.77 | 6 | 186 of 192 |
| 2021 | 100 | −10.2 | 0.972 | 0.93 | 9 | 312 of 317 |
| 2022 | 100 | +0.4 | 0.977 | 1.00 | 8 | 398 of 409 |
| 2023 | 100 | +2.2 | 0.988 | 0.98 | 9 | 429 of 441 |
| 2024 | 100 | +4.8 | 0.987 | 0.99 | 10 | 513 of 522 |
| 2025 | 100 | +0.9 | 0.978 | 0.99 | 7 | 477 of 519 |

The 2016 and 2017 rows run the same engine with the method Tennis Abstract used before May 2018 (tour-level matches only,
everyone starting at 1500, no layoff penalty), a check of the engine itself. From 2021 the current method agrees with
Tennis Abstract's own lists to within ten points, closer than the men's (+21 to +44). 2018 and 2019 are as far off as the
men's of those years; 2020's list stops a week short of the season.

**Scale.** A rating is the Elo on the game's scale, `round((Elo + 100) / 25)`, as in 2026. Where a season's best player
would be over 99 the whole season is shifted down until she is 99, which keeps every match's odds: 26 seasons, by up to
nine points (Navratilova's 2575 in 1985 and Graf's 2600 in 1989, both 107). The shift is the season's `source.shift`;
each player keeps her Elo as `rawRating`.

### Nations of the day

As the men's (`scripts/lib/tennis-seasons.mjs`), with the Fed Cup's ties for the Davis Cup's: a computed season's player
plays for the nation she played the Fed Cup for in the nearest season (within six), read from the ties' names in the
match files ("Fed Cup WG F: USA vs AUS"; 349 rubbers place nobody, among them the Wightman Cup's and the Billie Jean King
Cup's of 2024–2026, whose names give no sides), else for her country by Sackmann's player file; then as that season's state knew it, with the men's
federations (Czechoslovakia, the Soviet Union, the CIS, Yugoslavia, FR Yugoslavia, West Germany) and their land, under
their own names and flags since 2026-11-10 (src/data/namesOfTheDay.js). East Germany never played the Fed Cup: its players
play for nobody before 1991, and its land, on the map of every season to 1990, stays neutral.

- **Barred:** South Africa from 1978 until 1991 (the files have no South African tie from 1978 until 1992; it played the
  1977 cup), and FR Yugoslavia in 1993 and 1994 (none in those years; back in 1995).
- **Fixes** (`nations.fixes`), for women who changed country with no Fed Cup row to show it: Martina Navratilova American
  from 1976 (she defected in 1975; her rows are Czechoslovakia's to 1975 and the United States' from 1982), Hana
  Mandlikova Australian from 1988, Monica Seles Yugoslav until 1993 (the player file lists her as American), Rosalyn
  Fairbank South African (her 1993 rows), Hu Na American from 1983 (she defected in 1982).
- **A nation needs two.** Monica Seles plays for Yugoslavia in 1989 and 1990. In 1991 and 1992 she was its only rated
  player, so it fields no team, and FR Yugoslavia is barred in 1993: the world's No. 1 of 1991–1992 is not in those
  seasons, by the rule that leaves out every nation of one. The audit names her.

Among the computed seasons only 13 women change country outside the federations' successions, each one as her Fed Cup
rows say (Manuela Maleeva to Switzerland in 1991, Patricia Hy to Canada, Sesil Karatantcheva to Kazakhstan).

### 1968–1972

Added 2026-11-09, when the user asked for every sport's missing years and the 1960s and 1970s; since 2026-11-14 made by
the second run of 1963–1967 (below). Sackmann's archive holds nothing of the women's game before 1968 (no amateur file,
as the men's has), so on 2026-11-09 these seasons came from the first run, which began in January 1968 with every woman
new at 1330: 1968 and 1969 were the roughest, a list that starts from nothing a year earlier, and King, Tingay's first of
1968, was seventh. The second run reads the same files after the pages' results of 1960–1967, so its women of 1968 bring
their ratings with them; its seasons from 1973 are within a point and a half of the first run's (the seam, below), and
1973–2025 stay the first run's, unchanged byte for byte. They are labelled rough, as 1973–1979 are.

| Season | Rated | Nations | Best (rating) | Strongest three | Tingay's ten shared | Rank correlation |
| --- | --- | --- | --- | --- | --- | --- |
| 1968 | 160 | 16 | Margaret Court (88) | United States, Great Britain, Australia | 8 (7 before) | 0.76 (0.66) |
| 1969 | 152 | 16 | Margaret Court (93) | United States, Great Britain, Australia | 9 (9) | 0.66 (0.58) |
| 1970 | 158 | 17 | Margaret Court (93) | United States, Australia, Great Britain | 8 (8) | 0.67 (0.73) |
| 1971 | 132 | 18 | Billie Jean King (95) | United States, Australia, Great Britain | 8 (8) | 0.60 (0.60) |
| 1972 | 167 | 19 | Billie Jean King (96) | United States, Australia, Great Britain | 9 (9) | 0.84 (0.81) |

**What moved.** The warm-up moves 1968 most and fades by 1971: over each season's top eight, the second run's Elo less the
first's is −11 to +194 in 1968 (King +194, now second behind Court where she was seventh), −6 to +16 in 1969, −5 to +9
in 1970 and −8 to 0 in 1971 and 1972, where King now edges Court as 1972's best (both 96). The five seasons share 8.4 of
Tingay's ten (8.2 before), rank correlation 0.71 (0.68). Court ends 1971 at 2,256 (2,262 before) and peaks at 2,394 in
December 1973 (2,403): Tennis Abstract puts her peak at 2,389 in 1971 (The Tennis 128, from a database that reaches back
to the 1920s), and the open era's many matches, not the warm-up, set her 1971.

**Validation** (`validation.json`'s `checks`, inputs in the manifest's `checks`; nothing from them is in a season file):
Lance Tingay's year-end tens from Wikipedia's "Top ten ranked female tennis players (1921–1974)", revision 1376153875
(22 September 2026, CC BY-SA 4.0). They match Tingay's columns on the article page of that revision, fetched once under
`/wiki/`, which Wikipedia's robots.txt allows (SHA-256 `c9d49c88…`); the research pass had first read them from the raw
wikitext through `/w/index.php`, a path robots.txt disallows, and nothing here uses that copy or fetches `/w/`. Each
name is kept with its match-file id, married
names joined by hand: Kerry Melville is Kerry Reid in the player file, Nancy Richey Gunter Nancy Richey, Lesley Turner
Bowrey Lesley Turner, Annette Van Zyl duPlooy Annette Van Zyl. Every one of the fifty is rated in her season. The Fed Cup
bears the nations out: Australia and the United States lead every season, and won every cup of these years but 1972's,
South Africa's, which plays all five seasons (it is barred only from 1978).

- **Nations.** The rule of the later seasons, unchanged; the second run's cup rows include the pages' cups of 1963–1967,
  within six seasons of 1968–1972. The 1971 cup is all but missing from the files (five rubbers, without tie names): its
  players take the nation of the cups around it. The player file decides for the rest (84 of 160 women in 1968; 96 in
  the first run).

### 1963–1967

Added 2026-11-14, when the user's session asked for every year from each sport's first season, the Federation Cup's first
year being 1963. No public file holds the women's game before 1968, so these seasons read English Wikipedia's article
pages: the four majors' women's singles draws of 1960–1967 (from 1960 so that the ratings warm up) and the Federation Cup
of 1963–1967. Each page was fetched once under `/wiki/`, which Wikipedia's robots.txt allows (`/w/` and its API are
disallowed), through `scripts/lib/polite-fetch.mjs`, and is pinned (the manifest's `wikipedia`). They are the second run's
seasons (`method.early`), labelled "Amateur Elo, end of 1965 (rough)": every woman of the 1960s was an amateur.

**The measure first.** Before building, the pages were measured against the stop line the work was given (fewer than two
rated players for most cup nations): counting three matches a season, as the men's amateurs, 41 of the 82 cup nations of
1963–1967 had two rated cup players, half; with two matches 58, with one all 82. The user chose (2026-11-14) to list the
women with three counted matches in the season or a singles rubber in that year's cup, so that every cup nation fields
the women who played it.

**What the pages hold** (`scripts/lib/tennis-wikipedia.mjs`). Wikipedia serves an article as Parsoid HTML, where each
bracket (`16TeamBracket-Compact-Tennis3-Byes`, the finals' `8TeamBracket-Tennis3`) and each tie (`FedCupbox3`, its
rubbers `TennisMatch3`) is a template whose wikitext sits in a `data-mw` attribute: the draws are read from the
templates' parameters, not from the rendered table.

- **The draws.** Wimbledon's and Paris's in full, Melbourne's of 32 or 64 lines; the U.S. Championships' pages show only
  their last eight, but 1966's a quarter of its draw too. A section's rounds are numbered back from its last (a
  "Fourth round" is the round before the finals' quarter-finals, a "Quarterfinals" label its own), and a match that a
  section and the finals bracket both show is counted once (they must agree on its winner). The winner is the bold
  name, else the side with more sets. A walkover, a retirement (a score's `ret.` or superscript r) or a default is not
  counted, as in the open era's files.
- **The dates.** Each major's matches are dated the first day of its women's singles, from its tournament's own article
  (`TennisEventInfo`, Wimbledon's `Infobox tennis tournament year`; the U.S. Championships of 1960 played the singles
  from 2 September, after the doubles' week), and each cup rubber its tie's day. A cup's rounds follow its days.
- **The cup.** Rubbers 1 and 2 are the singles and count; the doubles, rubber 3, rates nobody (the files hold no
  doubles either). 77 ties: 16 nations in 1963, 20 in 1964, 11 in 1965 (in Melbourne), 20 in 1966 and 15 in 1967.
- **In all** 1,991 singles, 1,882 counted (109 walkovers, retirements and defaults), from 37 pages.

**Who is who.** A player cell is a link (to an article, a redirect, or a missing article: a red link) or a name written
without one. A woman is her article, a redirect followed to it (96 redirects, each fetched under `/wiki/` once: its page
is the article, with `wgRedirectedFrom`), a red link's title, or a name with its flag (`Name|CODE`): 592 keys. Reviewed
by hand on 2026-11-14 (`method.early.aliases`, 45 rows): 39 keys of one woman written once with a link and once without,
or with and without diacritics (`name`, checked by the script: one plain name, one country), and six of spellings
(`spelling`, each explained: Carol and Carole Newman; Lyn and Lynn Bellamy; María José Aubet, whose red link garbles é
as ú, and her initials; Mimi Henreid with her middle initial; Patsy Belton, misspelt Pasty). Never merged: two women
who played each other, and pairs with nothing but a surname in common (Margot Anne Smith of New Zealand and Margaret
Court; Irène and Isabelle de Lansalut; Madonna and Maree Schacht). 547 women remain. A woman is Sackmann's player, under his id, so that
she carries on into the open era, when her article's Wikidata item is the player file's `wikidata_id` (158: QLever's
answer for the 248 articles, pinned), or when a reviewed row says so (`method.early.joins`, 120, all `name`: her name or
a name her cells show is the player file's, in one country, as Carmen Mandarino is the player file's Carmen Coronado and
Janice Wainwright its Janice Townsend). Not joined: Maria Ayala (Chile, 1960) and Mary Habicht (the United States), whose
namesakes in the player file are of other countries. 278 of the 547 are Sackmann's; the rest keep an id of their own
(`wp:<key>`), with the name of their article or link and the country their flags give most often.

**The method.** The first run's, with the men's two changes for a warm-up. Newcomers of the pages start at 1325, fitted
to five points so that the run carries on as the shipped one: over the first run's top 50 of each season 1973–1980 the
second run's Elo of the same women differs by +0.1 on average (the mean absolute difference 1.2 at most a season), and on
Tennis Abstract's 17 targets of 1973–2000 it is −0.3 Elo on average, root mean square 42.8, where the first run is −0.4
and 42.7; 1320 puts the seam at −0.4, 1330 at +1.4, 1280 at −9.5 and 1380 at +14.8. A layoff that begins before 1968 is
charged only when it ends before 1968 and lasts 13 weeks or more (the pages hold the majors and the cup alone). Against
Tingay's tens of 1963–1967 the layoff barely matters: rank correlation 0.72 with eight weeks, 0.76 with 13, 0.72 with
26, 39 or no charge. A gap across 1968 (Court's year away, 1967) is never charged.

| Season | Rated | Nations | Best (rating) | Strongest three | Tingay's ten shared | Rank correlation |
| --- | --- | --- | --- | --- | --- | --- |
| 1963 | 65 | 16 | Margaret Court (80) | Australia, United States, Great Britain | 9 | 0.57 |
| 1964 | 67 | 20 | Margaret Court (82) | Australia, United States, Great Britain | 6 | 0.45 |
| 1965 | 69 | 13 | Margaret Court (85) | Australia, United States, Great Britain | 8 | 0.88 |
| 1966 | 78 | 20 | Margaret Court (83) | Australia, United States, Great Britain | 6 | 0.95 |
| 1967 | 72 | 17 | Billie Jean King (83) | United States, Great Britain, Australia | 7 | 0.93 |

**Validation.** Tingay's tens of 1963–1967, read from the same saved page of his lists (the manifest's `checks`): 7.2 of
his ten shared a season, rank correlation 0.76. Every one of his women is rated in her season but Nancy Richey, his
ninth of 1963: the pages give her one match (the U.S. Championships' pages show their last eight only). 1964 agrees least
(six shared, 0.45): Carole Caldwell Graebner, his fourth, is 16th and Helga Schultze, his fifth, 17th, each on the few
matches the pages give her. Court leads Australia in 1963–1966 and is away in 1967, as she was; King leads 1967.

**Nations of the day.** Every cup nation of every year fields a team, and every woman who played a cup singles rubber
plays for the nation she played it for, in its five but one: in 1966 Australia fields its five best, Court, Turner,
Ebbern, Tegart and Krantzcke, and Gail Sherriff, who played the cup with Tegart and Krantzcke, is sixth. A woman of
1963–1967 plays for her fix, else her cup nation of the nearest season (the pages' cups and the files' together, within
six), else the country her draws' flags give her in the nearest season of the pages (`how` 'flag': the pages flag a
woman by her country of the day, where the player file gives her latest), else the player file's; 93 of the 351 rows
take their flag. A nation needs two: Maria Bueno, Brazil's only rated woman in 1963, 1964,
1966 and 1967, plays only in 1965, when Maureen Schwartz played the cup with her (as Seles sits out 1991–1992). Two
nations field a team without a cup of that year: Czechoslovakia and the Netherlands in 1965, Czechoslovakia and the
Soviet Union in 1967 (Galina Baksheeva and Anna Dmitrieva, before the Soviet Union's first cup in 1968, holding the other
republics). Rhodesia plays its cups of 1966 and 1967 on Zimbabwe's land, under its name of the day; Czechoslovakia holds
Slovakia, West Germany plays under its own name.

**The format.** The cup of 1968–1975: three rubbers, the doubles third, advantage sets ([Format by year](#format-by-year)).

### Tests

`scripts/womens-tennis-seasons.test.mjs`: the build and (with the inputs cached) the sync rebuild byte for byte, the
men's too; every input pinned, the Wikipedia pages and Wikidata's answer among them; the counted levels; the listing,
2025 back to 1963, and its labels; every season decodes, two to five women a nation, each rating her Elo on the game's
scale less the season's shift, the best at 99 where shifted, the seasons before 1968 citing their cup's page; Graf and
Navratilova shifted; 1985's Czechoslovakia holding Slovakia with Mandlikova, West Germany with Kohde-Kilsch and Graf,
South Africa barred from 1978 and back in 1992; the Soviet Union, the CIS and Serbia and Montenegro; the fixes and
Seles's seasons, and the flags' rule only before 1968; Tennis Abstract's own lists and renamed keys; the validation
thresholds; 1963–1972 with Court and King leading Australia and the United States, Court away in 1967, South Africa
playing, the 1971 nations from the cups around it, Tingay's tens (Richey's 1963 the one woman unrated), King second in
1968, Court's peak, the seam and fit of the second run and its counts; the pages read (a draw's rounds numbered back,
the finals' repeat counted once, walkovers and retirements, the dates, the links' kinds; a cup's singles and doubles; the
women: redirects, Wikidata's and the reviewed joins, the checks of a reviewed row, opponents never one woman); every cup
nation of 1963–1967 fielding a team, the Soviet Union of 1967, Bueno only in 1965, Rhodesia, and (with the pages cached)
every cup singles player listed, for her cup's nation, in its five but Gail Sherriff in 1966; the loader refusing damaged
files; a season binding the women's sport and serve; the running App listing the seasons, loading one, launching 1985 with
Slovakia in Czechoslovakia's empire, 1968 with South Africa playing and 1963 with the first cup's sixteen, and resuming
the saves; and a challenge link to a season. `scripts/tennis-formats.test.mjs` holds the cup of 1963 to the ties of 1968.

### Limits

- **1963–1979 are rough**, as the men's 1960–1979: the ratings start from nothing in 1960, while Tennis Abstract's reach
  back to the 1920s, and Court's 1971 is 133 points under Tennis Abstract's.
- **1963–1967 hold the majors and the cup alone**, as Wikipedia records them: no other event of the women's amateur
  circuit, and of the U.S. Championships only the last eight (but 1966's quarter). A woman of a few matches keeps an
  uncertain rating (Carole Caldwell Graebner, Tingay's fourth of 1964, is 16th), Nancy Richey is unrated in 1963, and a
  cup nation's women who played the cup alone are rated on their one to four rubbers, near a newcomer's start.
- **Who is who** before 1968 is the pages' links and names, joined by Wikipedia's redirects, Wikidata and a review by
  hand: a woman written under two names the review did not find (a maiden name and a married one, neither linked) counts
  as two, and a red link's title is her name where no article gives a better one.
- **The order of the cup's two singles** of 1963–1967 is not the pages' to settle ([Format by year](#format-by-year)).
- **Nothing before 1963**, the cup's first year; 1960–1962 only warm the ratings up.
- **No ITF events before 1994**, whose prize the files do not name: a player who played only those is not rated then.
- **Names** are the player file's, the latest a woman used (Manuela Maleeva Fragniere in 1985), and the published lists'
  as Tennis Abstract wrote them that year (Cori Gauff in 2023).
- **No surfaces**, as the men's.
- **Russia and Belarus** play in 2022–2025, as in 2026 by the user's choice, though barred from the cup since 2022.
