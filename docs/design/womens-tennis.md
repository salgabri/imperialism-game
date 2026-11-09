# Women's tennis

Status: implemented 2026-11-08, with 53 earlier seasons back to 1973 the same day and five more, 1968–1972, on
2026-11-09 (Earlier seasons, below). The ninth
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
singles and a doubles on one day, first to two) are not offered, as the Davis Cup's Final 8 is not.

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
  choice lists the built-in 2026, then the 58 earlier seasons back to 1968. Nine sports no longer split into two even rows, and five across would squeeze
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
earlier seasons (below).

## Known limits

- **The built-in season is 2026**, as of Tennis Abstract's update of 2 November; the earlier seasons have their own
  limits (Earlier seasons, below).
- **No doubles specialists**, as in the men's game: a pair is its players' singles mean.
- **No surfaces**: the host's choice is in the home edge, not played. The snapshot keeps each player's hard, clay and
  grass Elo.
- **The home edge is the Davis Cup's**, not measured for the women's cup.
- **Players by the country Tennis Abstract files them under**, not by cup nominations.
- **Licence**: Tennis Abstract's reports and Sackmann's match files are CC BY-NC-SA 4.0 (credit "Jeff Sackmann / Tennis
  Abstract", non-commercial), as the men's ratings are; the ads question in the men's notes applies here too.

## Earlier seasons

Status: built 2026-11-08, when the user asked for them after the sport shipped; 1968–1972 added 2026-11-09 (1968–1972,
below). The Season choice lists 58 earlier seasons, 2025 back to 1968, each the WTA's women at the end of a year and the
Fed Cup nations of that day, nations only
(set ids `wta-<year>`, kind `wta`, `public/womens-tennis/wta-<year>.json`). They follow the men's seasons
([tennis.md](tennis.md), "Earlier seasons") and the user's choices for them: Tennis Abstract's own published lists where
they exist, earlier years computed from Jeff Sackmann's match results by Tennis Abstract's published method, on today's
scale and labelled as computed. The same scripts build both tours (`--tour=wta`), and the men's files rebuild byte for
byte.

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
- **1968–2015: Elo computed** from Jeff Sackmann's WTA match results, 1968 to 2025: the tour-level files (with the Fed
  Cup) and the ITF and qualifying files. The original repository is gone and no fork of it was found; the archive
  [Aneeshers/tennis-sackmann-archive](https://github.com/Aneeshers/tennis-sackmann-archive) at commit `8373358` holds its
  files (`wta/`), pinned, and its Hugging Face mirror the same. Labels read "Elo from match results, end of 1985"; the
  player's source is "Elo from match results", with her Elo in its title.
- **Pins.** `scripts/data/womens-tennis-seasons.json` holds the SHA-256 of all 117 archive files and the 20 captures.
- **Licence.** As the men's: CC BY-NC-SA 4.0, the computed ratings derived data under the same terms;
  `public/womens-tennis/ATTRIBUTION.txt` credits both.

`npm run sync:womens-tennis-seasons` reads the pinned inputs from the ignored `data-src/womens-tennis-seasons/`
(downloading any that are missing) and writes one snapshot a season to `scripts/data/womens-tennis-seasons/<year>.json`
(1.3 MB in all, committed) and `validation.json`. `npm run build:womens-tennis-seasons` builds the season files,
`src/data/womensTennisSeasons.js`, the attribution and `docs/design/womens-tennis-seasons-audit.json`. Both have `--check`
and rebuild byte for byte.

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
federations (Czechoslovakia, the Soviet Union, the CIS, Yugoslavia, FR Yugoslavia, West Germany) and their land. East
Germany never played the Fed Cup: its players play for nobody before 1991.

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

Added 2026-11-09, when the user asked for every sport's missing years and the 1960s and 1970s. The archive holds nothing
of the women's game before 1968 (no amateur file, as the men's has; the Fed Cup of 1963–1967 is in no public file), so
the women go back to 1968 and no further. The seasons are the same run's (`seasons.computed` now starts in 1968): it
always began in January 1968, every woman new then at 1330, and its seasons from 1973 are unchanged byte for byte. They
are labelled rough, as 1973–1979 are, and 1968 and 1969 are the roughest: a list that starts from nothing a year
earlier.

| Season | Rated | Nations | Best (rating) | Strongest three | Tingay's ten shared | Rank correlation |
| --- | --- | --- | --- | --- | --- | --- |
| 1968 | 160 | 16 | Margaret Court (87) | Great Britain, Australia, United States | 7 | 0.66 |
| 1969 | 152 | 16 | Margaret Court (93) | United States, Australia, Great Britain | 9 | 0.58 |
| 1970 | 158 | 17 | Margaret Court (93) | United States, Australia, Great Britain | 8 | 0.73 |
| 1971 | 132 | 18 | Billie Jean King (95) | United States, Australia, Great Britain | 8 | 0.60 |
| 1972 | 167 | 19 | Margaret Court (96) | United States, Australia, Great Britain | 9 | 0.81 |

**Validation** (`validation.json`'s `checks`, inputs in the manifest's `checks`; nothing from them is in a season file):
Lance Tingay's year-end tens from Wikipedia's "Top ten ranked female tennis players (1921–1974)", revision 1376153875
(22 September 2026, CC BY-SA 4.0), read once from the research pass's copy of the raw wikitext (SHA-256 `cc0c6df4…`;
Wikipedia's robots.txt disallows `/w/`, so nothing re-fetches it). Each name is kept with its match-file id, married
names joined by hand: Kerry Melville is Kerry Reid in the player file, Nancy Richey Gunter Nancy Richey, Lesley Turner
Bowrey Lesley Turner, Annette Van Zyl duPlooy Annette Van Zyl. Every one of the fifty is rated in her season; the
seasons share 8.2 of the ten on average, rank correlation 0.68. 1968 is the weakest: King, Tingay's first, is seventh,
Court first. Tennis Abstract puts Court's peak at 2,389 in 1971 (The Tennis 128, from a database that reaches back to
the 1920s); here she is 2,262 at the end of 1971 and peaks at 2,403 in December 1973. The Fed Cup bears the nations
out: Australia and the United States lead every season but 1968, and won every cup of these years but 1972's, South
Africa's, which plays all five seasons (it is barred only from 1978).

- **Nations.** The rule of the later seasons, unchanged. The 1971 cup is all but missing from the files (five rubbers,
  without tie names): its players take the nation of the cups around it, within six seasons. The player file decides
  for the rest (96 of 160 women in 1968).

### Tests

`scripts/womens-tennis-seasons.test.mjs`: the build and (with the inputs cached) the sync rebuild byte for byte, the
men's too; every input pinned; the counted levels; the listing, 2025 back to 1968, and its labels; every season decodes,
two to five women a nation, each rating her Elo on the game's scale less the season's shift, the best at 99 where
shifted; Graf and Navratilova shifted; 1985's Czechoslovakia holding Slovakia with Mandlikova, West Germany with
Kohde-Kilsch and Graf, South Africa barred from 1978 and back in 1992; the Soviet Union, the CIS and Serbia and
Montenegro; the fixes and Seles's seasons; Tennis Abstract's own lists and renamed keys; the validation thresholds;
1968–1972 with Court and King leading Australia and the United States, South Africa playing, the 1971 nations from the
cups around it, Tingay's tens and Court's peak; the loader refusing damaged files; a season binding the women's sport
and serve; the running App listing the seasons, loading one, launching 1985 with Slovakia in Czechoslovakia's empire and
resuming the save; and a challenge link to a season.

### Limits

- **1968–1979 are rough**, as the men's 1960–1979: the ratings start from nothing in 1968, while Tennis Abstract's reach
  back to the 1920s. 1968 and 1969 are the roughest (King seventh at the end of 1968, Tingay's first), and Court's 1971
  is 127 points under Tennis Abstract's.
- **Nothing before 1968**: the archive has no women's match before the open era, and no public file holds the Fed Cup of
  1963–1967.
- **No ITF events before 1994**, whose prize the files do not name: a player who played only those is not rated then.
- **Names** are the player file's, the latest a woman used (Manuela Maleeva Fragniere in 1985), and the published lists'
  as Tennis Abstract wrote them that year (Cori Gauff in 2023).
- **No surfaces**, as the men's.
- **Russia and Belarus** play in 2022–2025, as in 2026 by the user's choice, though barred from the cup since 2022.
