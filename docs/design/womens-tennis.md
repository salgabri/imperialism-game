# Women's tennis

Status: implemented 2026-11-08. The ninth sport: the women's game by the rules of the Billie Jean King Cup, with the
WTA's players rated by their Elo. Nations only, on the world map. It is a sport card of its own beside Tennis, as women's
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
  choice lists the built-in 2026 alone. Nine sports no longer split into two even rows, and five across would squeeze
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
`npm run smoke` adds a Billie Jean King Cup campaign of the world.

## Known limits

- **One season**, 2026 (Tennis Abstract's update of 2 November). Earlier seasons could follow the men's: Tennis
  Abstract's year-end WTA reports from the Wayback Machine, and Elo computed from Sackmann's WTA match files before them.
- **No doubles specialists**, as in the men's game: a pair is its players' singles mean.
- **No surfaces**: the host's choice is in the home edge, not played. The snapshot keeps each player's hard, clay and
  grass Elo.
- **The home edge is the Davis Cup's**, not measured for the women's cup.
- **Players by the country Tennis Abstract files them under**, not by cup nominations.
- **Licence**: Tennis Abstract's reports and Sackmann's match files are CC BY-NC-SA 4.0 (credit "Jeff Sackmann / Tennis
  Abstract", non-commercial), as the men's ratings are; the ads question in the men's notes applies here too.
