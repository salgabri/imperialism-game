# Football year by year: sources

Status: research, 2026-10-24. The CM 01/02 backbone chosen from it is
implemented as local data sets ([football-years.md](football-years.md)). This
records which
real sources could supply a football world for each year from 2026 back, how to
get them and under what terms, so that the year picker can be planned.

Every claim below was probed on the day: a page, API, file listing or downloaded
dataset was read, and the load-bearing claims were then checked a second time by
someone trying to refute them. Counts were recomputed with the repo's own
`loadEaPlayers` / `pickFootballSquad` / `selectLineup` where the data allowed.
Where something could not be observed it says so.

## Goal and year convention

The user picks a **year**. The game then plays with that year's national squads,
clubs and player ratings, under the existing rules: real players only, source
ids, URLs, edition, date and raw rating kept on every player, build-time
snapshots, deterministic offline rebuilds.

**Year N means the season ending in N.** Game editions already work this way:
FIFA 07, FM 2007 and CM 01/02 each carry the database for the season that ends in
the year they are named for. So the data that ships today (EA FC 26 update 4 and
FM 26 26.3.0, both 2025/26) is **2026**, and the season now being played,
2026/27, is **2027**. Every snapshot also keeps its real date, because a "year"
has several rosters (launch, winter, final).

## The short answer

- **Player data exists for every season back to 2002, with ratings for almost
  every nation.** The Championship Manager 01/02 community has published one
  database per season, in one binary format, from SI's own 2001/02 data to
  May 2026. The 2026/27 release is due on 25 October 2026. Each holds 100k+
  players from about 230 nation records, with ability (1–200) and position
  ratings. 2005 and 2007 exist only as files whose author is unknown or whose
  host is offline. Not yet measured: how many of our 170 nations get a natural
  4-4-2 from each file. The files need a forum login, so none was parsed.
- **EA FIFA/FC data exists for 2005–2027 but never covers the map.** In every
  edition only about 65–81 of the 170 nations can field a natural 4-4-2 from EA
  players. EA always needs a second source to fill the other nations, just as
  FM fills them today.
- **Before 2002 there are a few rated "special" years.** These are 1997
  (Sensible World of Soccer 96/97: 143 national squads, 129 of our nations) and
  1985 (the community's 1984/85 CM 01/02 database: 72k players and
  186 nationalities, of which 137 of our nations have 11+ players). Partial
  years from SI-derived community databases (1994, 1996, 1999) cover about
  11–16 nations' leagues.
- **Before about 1985 no source rates players for most nations.** Real squads
  without ratings (Wikidata, World Cup squads) and team strength (Elo from CC0
  results, back to 1872) remain. The rule that no rating is invented means
  those years could only offer team-level strength.
- **The binding constraint is the right to commit data, not its existence.**
  No player-rating source grants redistribution. This includes the two the
  repo ships today; see [Rights and terms](#rights-and-terms). Only results,
  Wikidata, openfootball and World Cup squad data are openly licensed, and they
  carry no player ratings.

## Year-by-year coverage

"Rated, global" means a source whose players carry ratings and nationality for
most of the 170 nations. EA counts are nations able to field a natural
1-4-4-2 from EA players alone.

| Year (season) | Rated, global | EA FIFA / FC | Other rated | Open, no ratings |
| --- | --- | --- | --- | --- |
| 2027 (26/27) | CM0102 October 2026 update (due 25 Oct 2026); FM27 from 10 Nov 2026 (free preview 29 Oct) | FC 27: EA ratings-API dump `mikedpad` (2026-09-12, "unofficial, non-commercial"), `samteoid` (ODbL, FIFPlay); SoFIFA 270002. 72–81 nations | — | results/Elo, Wikidata |
| 2026 (25/26) | **Shipping:** FM 26 26.3.0 (EFEM). CM0102 Dec 2025, May 2026 | **Shipping:** FC 26 update 4. 77 nations | — | results/Elo, Wikidata |
| 2025 (24/25) | No FM25 (cancelled 7 Feb 2025). CM0102 Oct 2024 only. Fan FM data: FMInside FMU25 (24.4.0), FM Scout FM24→25 | FC 25: `nyagami` (Apache-2.0, launch window, no club ids or DOB), joinable by EA id to SoFIFA-shaped `aniss7` / `sametozturkk` (MIT, no nationality). 66–72 nations | — | results/Elo, Wikidata |
| 2024 (23/24) | FM24 24.3.0 (EFEM, FMInside); CM0102 Oct 2023, Apr 2024 | FC 24: Leone (CC0). 69–72 nations | — | results/Elo, Wikidata |
| 2021–2023 | FM21–23 on FMInside only; CM0102 each season | Leone (CC0). 71–79 nations | PES 2021 (pesmaster) | results/Elo, Wikidata |
| 2015–2020 | FM only from an owned game (Kaggle uploads of FM17/19/20 have no SI permission); CM0102 each season | Leone (CC0), one file for FIFA 15–FC 24. 65–75 nations | PES 2015–2020 (up to 93 nations); 2018: Wyscout PlayeRank (CC BY 4.0, 47 nations) | results/Elo, Wikidata |
| 2008–2014 | CM0102 each season (Update Team from Nov 2007) | No clean bulk file: FIFA Index scrape mirror `daguizer` (raw rating, positions, **no nationality**) joined by EA id to `Big-Data-FC` (nationality; its own ratings are SoFIFA's derived "best overall", not usable). ~53–67 nations | PES 2008–2014 (54–77 nations; fake names in 2008–2012) | results/Elo, Wikidata |
| 2007 | CM0102 April 2007 (author unknown) | FIFA 07 as above | No PES 6 | results/Elo, Wikidata |
| 2006 | CM0102 Sep 2005 (Helvete) | FIFA 06: `daguizer` only, no nationality | PES 5 (52 nations) | results/Elo, Wikidata |
| 2005 | CM0102 Oct 2004 (Sawczuk): listed in an offline archive, file not found | FIFA 05: `daguizer` only, no nationality | — | results/Elo, Wikidata |
| 2004 | CM0102 Oct 2003 (Sawczuk) | — | — | results/Elo, Wikidata |
| 2003 | SI's own CM 01/02 3.9.68 database (2002/03) | — | — | results/Elo, Wikidata |
| 2002 | SI's own CM 01/02 3.9.60 / 3.9.65 database (2001/02) | — | — | results/Elo, Wikidata |
| 1999–2001 | CM0102 retro: 98/99 (ported from SI's CM3), 99/00, 00/01; World Cup 1998 pack (32 nations) | Road to World Cup 98 had 172 national teams, but only inside the game files | — | results/Elo, Wikidata, World Cup squads |
| 1997 | **SWOS 96/97**: 143 national squads of 16, 129 of our nations, all can field a natural 4-4-2 | — | — | as above |
| 1994–1996 | CM0102 retro: 93/94 (from SI's CM3, 16 nations' leagues), 94/95, 95/96 (from SI's CM2) | — | SWOS 94/95, 95/96 only as game disk images (not usable) | as above |
| 1985–1993 | **CM0102 1984/85 Retro Update**: 72,015 players, 186 nationalities, 137 of our nations with 11+ players (after USSR/Yugoslavia/Czechoslovakia merges). Also 89/90, 91/92 | — | — | as above |
| 1966–1984 | CM0102 65/66 (work in progress, ~10% of 21k players rated), 77/78 (creates new players), 81/82; FM throwbacks (2–15 nations) | — | — | results/Elo (118 nations active by 1970); Wikidata XIs for ~33 nations in 1970 |
| 1930–1965 | none | — | — | World Cup squads (13–16 finalists); Wikidata XIs for ~19–30 nations; results/Elo (55 nations active in 1930) |
| 1872–1929 | none | — | — | results/Elo only (16–31 nations active) |

### What "as far back as possible" looks like

| Tier | Years | What a campaign gets |
| --- | --- | --- |
| Full world, rated | 2002–2027 (26 seasons) | CM0102 for every nation, with EA preferred where present, as FM is today. 2005 and 2007 are weaker (provenance). Per-nation XI coverage is to be measured on the first downloaded file. |
| Rated special years | 1997, 1985 | SWOS 96/97 or the 1984/85 database. Fan or SWOS rating scales, historic federations. |
| Partial rated years | 1994, 1996, 1999 | 11–16 nations' leagues from SI-derived community databases: enough for the club layer, not for 170 nations. |
| Strength only | 1872–2001 | Team strength from Elo, real squads where they exist, no player ratings. Needs a policy decision, because conquest normally claims a player. |

## Sources by family

### Player ratings

| Source | Years | Coverage | Access | Terms (observed) |
| --- | --- | --- | --- | --- |
| Kaggle `stefanoleone992/ea-sports-fc-24-complete-player-dataset`, `male_players.csv` | 2015–2024, launch roster (update 2) of each | 16–19k men per edition; our exact columns except `update_as_of` | Unauthenticated `https://www.kaggle.com/api/v1/datasets/download/<owner>/<slug>/<file>` (302 to a signed URL); 28 MB zip, md5 `9qjk4qIvY4of+AfbEAO0wg==` | Kaggle CC0, set by the compiler; EA's rights are not cleared |
| Kaggle `stefanoleone992/fifa-23-complete-player-dataset`, `male_players (legacy).csv` | 2015–2023 | Exactly our 16 columns (of 110) | as above; 26 MB zip | as above; cross-check only |
| Kaggle `nyagami/ea-sports-fc-25-database-ratings-and-stats` | 2025 (2024-09-26) | 16,161 men, Nation, EA id; no club id or DOB; uses "Holland", "Czech Republic" | Kaggle API | Apache-2.0 (compiler); EA rights not cleared |
| Kaggle `mikedpad/ea-sports-fc27-player-ratings` | 2027 (2026-09-12) | 17,849 men, nationality, birthdate, EA id | Kaggle API | "unofficial, non-commercial snapshot ... belong to Electronic Arts" |
| SoFIFA | FIFA 07–FC 27, every roster | Everything, per roster id `EEUUUU` | Live site is Cloudflare-blocked (403). robots.txt disallows `/api/` and ClaudeBot/CCBot. Wayback holds only top-60 listings and star pages. Common Crawl holds almost nothing | No licence. A partner API (`api.sofifa.net`) is offered to non-commercial sites that show the SoFIFA logo |
| FIFA Index | FIFA 05–24 | FIFA 05: ~10,994 players, 208 nations listed | Cloudflare-blocked; Kaggle mirror `daguizer/fifa-2021-to-2005-complete-player-attributes` (no nationality, no club, no dates) | Terms ban any robot or scraper |
| CM 01/02 Update Team databases (champman0102.co.uk, forum f=73) | 2004, 2006, 2008–2026; 2027 due 25 Oct 2026 | 100k+ players, ~231 nation records, CA/PA 1–200, position ratings 1–20, nationality, club, DOB | Forum attachments need a free account; fixed-record `.dat` files (`staff.dat`, `nation.dat`, `club.dat`, `index.dat`) | No licence. On 20 Jul 2026 the Update Team Director allowed a free browser fan project to *convert* the May 2026 database ("Yes work away"). A request about GitHub (18 Oct 2026) is unanswered |
| SI's original CM 01/02 database (3.9.60 / 3.9.65 / 3.9.68) | 2002, 2003 | ~169k staff, 139,769 players, 213 nation records; covers 165 of our 170 by name (Serbia is "Yugoslavia"; no Montenegro, Kosovo, South Sudan, Timor-Leste) | Same forum, same format | Free download since Dec 2008 (Eidos), for personal, non-commercial use; data rights reserved |
| CM0102 community retro databases | 1951–2001 (patchy) | 84/85: 72,015 players, 186 nationalities. 93/94, 95/96, 98/99 ported from SI's CM2/CM3 | MediaFire/sendspace links in forum threads (many sendspace links expired) | No licence; per-author permission (Cam F and the 84/85 team, bruebous, Simon Treanor, PLM9293) |
| FM throwback databases (tHe MadSCienTiSt and others: fmscout, sortitoutsi, Steam Workshop) | 1952/53–2013/14 | 2–15 playable nations; one 2003/04 database has 62 leagues | `.fmf` / `.fm` files that open only inside a licensed FM | No licence; most attributes copied by hand from SI games. An SI developer called an official retro database "not possible due to licensing" |
| EFEM.club | FM24 24.3.0, FM26 26.0.0 / 26.2.0 (partial) / 26.3.0 | Full FM database per version | Undocumented JSON API | robots.txt `Disallow: /api/` (since mid-2025); Terms 1.1 personal use only, 1.2 no automated access |
| FMInside | FM21 21.0.0, FM22 22.1.0, FM23 23.4.0, FM24 24.0.0 and 24.3.0, FMU25 24.4.0 (fan update), FM26 26.2.0 | Per-player pages | HTML | Terms forbid copying or republishing |
| pesmaster.com | PES 5 (2006), PES 2008–2021 | 52 (PES 5), 54 (2008), 77 (2012), 93 (2020) of our nations; stable Konami ids across editions | HTML, teams by id; no API | robots.txt allows all; no terms page; data is Konami's |
| SWOS 96/97 | 1997 | 1,440 clubs, 143 national teams, 25,328 players; 8 skills on 0–7, value | Community SQLite in `keyser1884/SWOS-MCP` (MIT repo); game on GOG | Data rights with Codemasters |
| Wyscout / PlayeRank (Pappalardo et al., figshare) | 2018 | 3,603 players, 47 nations with a full XI, no goalkeepers rated | figshare | CC BY 4.0, the only openly licensed per-player rating found |

Ruled out: pesdb.net (terms ban automated collection), FUTBIN/FUTHEAD/fifaratings
(blocked, FUT-only), WhoScored/Sofascore/FotMob/Opta (blocked, terms), Kaggle
`jkotov/all-eafc25-ratings` (actually FC 26 data), the hugomathien European
Soccer Database (no nationality, 11 leagues), Transfermarkt values (cover only
players active after ~2012: 23 nations with a valued XI in 2005), PC Fútbol and
FIFA Manager (Spain-only or binary only), Ballon d'Or points and the kicker
Rangliste (20–100 players a year).

### Open backbone (no player ratings)

| Source | Years | Use | Licence |
| --- | --- | --- | --- |
| `martj42/international_results` (`results.csv`, `former_names.csv`) | 1872-11-30 to 2026-10-06, 49,945 matches | Which nations are active in a year; team Elo | CC0-1.0 |
| Our own Elo from those results (eloratings.net formula; start rating 1500 is our assumption) | any date | Strength prior, fallback, sanity check. Pearson 0.89 with today's XI strength (0.92 without OFC, whose sides mostly play each other and rate too high) | ours (CC0 input) |
| Wikidata `P54` stints with `P580`/`P582`/`P1350` | 1930– | Real squads per year. Natural 4-4-2 for ~33 of our nations in 1970, 58 in 1990, ~100 in 2000 | CC0 |
| Fjelstul World Cup Database (GitHub v1.2.0) | 1930–2022 | Exact World Cup squads (GK/DF/MF/FW), starting XIs from 1970 | CC BY-SA 4.0 (the newer WorldCups.ai copy is NC) |
| openfootball | 1930–2014 World Cups; some leagues | Cross-check | public domain |
| FIFA association pages | 1904– | Membership dates for all 170 | factual; hides suspensions (USSR 1946, China 1958–79, South Africa 1961–92, Germany and Japan post-war) |
| eloratings.net, ClubElo | 1872– / 1939– | Offline comparison only | no licence; ClubElo's API returned 502 on every probe |

Club history has no openly licensed structured source before about 2010 outside
England (openfootball, engsoccerdata under GPL).

## Rights and terms

These findings affect the data that **already ships**, not only new years. This
is a record of terms as published, not legal advice.

1. **EFEM (FM26 source today).** robots.txt has disallowed `/api/` since mid-2025,
   and the Terms of Use limit the site to personal, non-commercial use and forbid
   "any automated system ... to access the Website". `sync-football-manager.mjs`
   and `sync-domestic-clubs.mjs` page through `/api/` automatically, and the output
   is committed to this public repository. The contact for consent is
   `info@efem.club` (or the EFEM Discord). EFEM's consent would not cover SI's
   rights in the data.
2. **EA (FC26 source today).** EA's content policy says it does not allow fan
   games and asks creators not to use licensed content. The CC0 and Apache labels on Kaggle datasets come
   from their compilers and do not clear EA's rights. New EA years carry the same
   risk as the current snapshot.
3. **SI.** The SEGA EULA (12 Dec 2024) limits the product "or related information
   or materials" to personal use and forbids derivative works. SI shares its
   database only with professional partners. Permission has been given case by
   case, for example to FM Scout in 2012.
4. **CM 01/02 community data** is the only rated, global, per-season source with
   a precedent of permission for a fan project. That permission covered
   converting the data, not redistributing it. Committing derived snapshots here
   would need an explicit request (to Dermotron, Update Team Director, and Mark,
   Chairman, on champman0102.co.uk). The SI and Eidos rights in the 2001 base data
   would remain.
5. **Open data**: martj42 (CC0), Wikidata (CC0) and openfootball (public domain)
   can be committed. Fjelstul and Wikipedia squads can be committed as separate
   files under CC BY-SA 4.0.

If permission cannot be had, the clean pattern is **bring your own database**
(the approach `Skallerup/cm0102-reborn` takes): the user downloads a database,
the app or a local build step parses it, and nothing derived from it is
committed.

## Data pitfalls found

- **EA fictional Brazilians leak through the current filter in older files.**
  `loadEaPlayers` drops `league_name === 'Série A'`, which matches only the FC 26
  file. From FIFA 17 to FC 24 the generic league is `league_id` 7, labelled
  `Serie A` without the accent. With the current code, the fictional "Ronaldo
  Cabrais" (`ea:230481`, 83) is picked for Brazil's FIFA 23 XI. FIFA 17's five
  generic Série B clubs sit under Rest of World, while FIFA 16's league 7 holds
  real players. The filter has to depend on the edition and the league id.
- **Nationality spellings change by edition.** "Czech Republic" (51–111 players a
  year) costs Czechia its XI in every edition before FC 26. "Holland" drops the
  Netherlands entirely from the EA ratings-API sets. Other mismatches are "Guinea
  Bissau", "Korea DPR", "Swaziland" and "Brunei Darussalam". An unmapped
  nationality is skipped silently today (`build-rosters.mjs`); it should fail the
  build.
- **Multi-edition files are not drop-in.** Each `player_id` repeats per edition,
  so `loadEaPlayers` throws on a duplicate id. The FC 24 file also uses
  `update_as_of` and float versions, and gives absolute `player_url`s for
  FIFA 15–22. The edition label must become `FIFA NN` (today's code would write
  "EA FC 15").
- **CM 01/02 dates of birth are shifted** so the game can start in 2001. From
  Nov 2007, stored year = real year − (season start − 2001). The Oct 2003 file is
  unshifted and Sep 2005 is shifted by 3. On disk, 3.9.68's `staff.dat` uses
  157-byte staff records located through `index.dat`; the 110-byte layout in
  CMScouter is the in-memory one.
- **Community databases can contain invented players or formula ratings.** The
  77/78 author creates new players. About 9,000 zero-rated players in 84/85 were
  filled with a formula (CA = CR − 10). The forum also hosts GPT-generated "legends"
  databases. Each source needs a provenance filter before it meets the
  never-invent rule.
- **PES national squads mix in classics and unmapped fake names.** Many PES 2008
  squads are mostly unmapped fake names: Bulgaria has 23 of 23 and Germany 20 of
  25. Classics carry a `Real ID` different from their id. PES 2010 and earlier
  overalls are computed by the site.
- **SoFIFA dates for FIFA 07–12 are nominal** (every edition: Aug 30 and Feb 22),
  so roster ids, not dates, identify a snapshot.

## Geography and federations

The modern 170-shape map works for every year. Each year it needs a table of
which federation holds which shapes, which generalises `DEPENDENCIES` in
`src/data/teams.js` (today only Greenland goes with Denmark):

- USSR holds its 15 republics to 1991 and the CIS 12 in 1992. Yugoslavia holds
  7 shapes to 1992, FR Yugoslavia / Serbia & Montenegro hold Montenegro to 2006
  and Kosovo to 2016, and Czechoslovakia holds 2 to 1993.
- Shapes with no federation in that year (South Sudan before 2012, Bosnia
  before 1996, Palestine and Eritrea before 1998) stay neutral.
- East Germany and the Saar have no modern shape.
- Scotland, Wales and Northern Ireland were missing from the map (826 was
  England only); they now have shapes of their own (`npm run build:home-nations`). They have 901, 750 and 711 internationals in the results data, and every
  rated source carries their players, so historic years need them as shapes
  (Natural Earth map units can supply them) or an explicit exclusion.
- From 1995 at most about 12 shapes differ from today's map. True historical
  boundaries exist (CShapes 2.0 1886–2019, CC BY-NC-SA; OpenHistoricalMap, CC0)
  but would mean re-deriving capitals, adjacency and routes per year. They are not
  needed.

Nations active in the results data in the four years up to Y (of our 170, with
the historic merges): 1930 55, 1950 79, 1970 118, 1990 137, 2006 168, 2014+ 170.

## Fitting a year into the code

From a read of the current pipeline:

- **Default year stays exactly as today.** `src/data/rosters.js` and
  `clubs.football.js` stay statically imported and byte-identical for 2026, so
  the seed-replay golden, save-size budgets and roster tests stay green.
- **Other years are lazy bundles.** One `public/football/<year>.json` per year
  holds nations and clubs: about 115–205 KB compressed, or 0.5–1.3 MB raw. It is
  loaded like `src/engine/domestic.js` (shared promise, small LRU, strict format
  and version check) and exposed as a year-bound sport
  `{ ...football, rosters, clubs, dataYear }`. The tests already build sports this
  way. Static imports for 20 years would add about 4 MB gzipped to the main bundle.
- **Saves record `settings.dataYear` and a roster content hash.** The v4
  `sourceIndex` (commit 6a2c573) must be keyed by sport, year and hash, because
  EA and FM ids recur across editions; otherwise a save would rebuild one
  year's evidence onto another year's player. A save needs its year bundle loaded
  before `parseCampaign` rebuilds sources, and the boot path parses synchronously
  today (`App.jsx`, boot).
- **Builders take `--year`.** Source snapshots live under
  `scripts/data/football/<year>/` with a manifest (edition, roster id, database
  date, retrieval date, source md5), and each year gets an audit beside
  `football-roster-audit.json`.
- **Clubs key leagues by league id**, not by name, because EA's league names
  change by edition. The football club build must also be split from basketball,
  which needs the ignored `data-src/nba2k.json`.
- **Domestic campaigns are per year and per FM-sized database.** Their sections
  derive from each year's club list (about 18 MB of maps per year), so they would
  stay 2026-only unless the format shares unit geometry across years.
- **Incomplete nations are already handled honestly.** An empty shirt plays at
  40 and an empty squad cannot be stolen from. But `fallbackStrength` (a
  hand-tuned 2025 strength) must never apply to another year. Each year's
  bundle should carry every nation, with team Elo as the only fallback strength.
- **Setup gets a Season control** in step 1, showing per-year coverage, and
  disables layers or theatres a year cannot supply.

## Decisions needed

1. **The current EFEM snapshot.** Ask EFEM for written consent, or replace FM26
   with a source that permits it (CM 01/02 Dec 2025 / May 2026, or a
   bring-your-own import).
2. **Posture for rated history.** (a) Ask the CM 01/02 Update Team, and the
   84/85 retro team, for permission to commit reduced derived snapshots (name,
   positions, CA, nationality, club, ids, credited and linked). (b) Bring your
   own database: parse locally and commit nothing. (c) Commit EA-only years
   (2015–2025, 2027) at the same risk as today and accept about 95 incomplete
   nations a year.
3. **Years with no player ratings** (before 1985, and between the special years):
   offer them as strength-only campaigns, or keep the picker to rated years.
4. **Scotland, Wales and Northern Ireland**: settled. They have shapes and teams
   (`scripts/build-home-nations.mjs`), and CM 01/02 seasons field them.
5. **Which roster represents a year**: the launch roster (start of season, what
   EA editions use) or the final one.
6. **Rating scales**: CM CA 1–200 and SWOS skills 0–7 need a documented
   conversion, as FM's CA does today (`round(ca * 99 / 100)`).

## Next editions to watch

- CM 01/02 October 2026 update (2026/27): due 25 Oct 2026.
- FM27: free Launch Preview 29 Oct–3 Nov 2026, release 10 Nov 2026.
- SoFIFA FC 27 rosters after 270002 (unverifiable while Cloudflare blocks it).
