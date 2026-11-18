# Roster audit

Asked 2026-11-14 ("can you work on validating the quality of the roster informations and ratings across the
app"). The loader (`src/engine/footballSets.js`) already checks every season file's structure strictly: ids,
tuples that rebuild exactly, ratings 1–99, positions, territory. What it cannot see is whether the players it
reads are right: a name damaged on its way from the source, a date of birth that cannot be the season's player,
one man rated two ways, a squad that cannot field its lineup. The roster audit looks at that, for every season of
every sport the game offers, read exactly as a campaign reads it.

```
npm run audit:rosters                          each sport's totals, every error, five of each warning
npm run audit:rosters -- --sport=hockey        one sport (or several, comma-separated)
npm run audit:rosters -- --all                 every finding
npm run audit:rosters -- --write               also writes docs/design/roster-audit.json
npm run test:roster-audit                      the checks on invented players, and no error in any season
npm run validate:football-elo                  every game-rated football season's XIs against World Football Elo
npm run validate:football-elo -- --check       the same offline, from the cached Elo files: the report must reproduce
```

`scripts/lib/roster-audit.mjs` holds the checks; `scripts/audit-rosters.mjs` prints and writes;
`scripts/roster-audit.test.mjs` runs in `npm test`. The whole run reads 584 seasons (each of the fourteen sports'
built-in one and the 570 earlier ones), about 26,400 teams and 332,000 player records, in about two seconds.
`scripts/validate-football-elo.mjs` writes docs/design/football-elo-agreement.json ("Ratings against results" below).

## How a season is read

Each season goes through the game's own pipeline, so the audit sees what play sees: the built-in sports as
`getSport` gives them, every earlier season decoded by `decodeFootballSet` and bound by `seasonSport`, each
nation built by `buildTeam` (generated players and all, though only the source's own players are checked) and
each club by `buildClub`, and each lineup picked by `selectLineup`. A season plays only the layers it has: an NBA,
NFL or NRL season's clubs, never the built-in nations its sport object still carries. Whether a nation takes the
field is `fieldedNations`.

## The checks

**Errors**, which no season may hold (the test fails on any):

| Check | What it finds |
| --- | --- |
| `name-corrupt` | A control or replacement character, mojibake (UTF-8 read as Latin-1: `Ã©`), an HTML entity, a question mark, or a digit outside a birth-year tag the builders add to namesakes (`Sebastian Aho (1997)`). An esport's players go by gamer tags (`HANDLES`: Rocket League's "M0nkey M00n", "Rw9", Counter-Strike's "s1mple", Valorant's "Jamelinho213"), whose digits are their own |
| `name-spacing` | Leading, trailing or doubled whitespace, or whitespace other than a space |
| `rating-range` | A rating that is not a whole number 1–99 (the built-in modules are not loader-checked) |
| `player-repeated` | One player, by source id, twice in one squad |
| `age-impossible` | A date of birth that makes a player younger than 14 or older than 45 (whole years) on the day the season starts: 1 July of its first year, or 1 January of a calendar year's season |
| `name-scripts-glued` | A name or full name in which a Latin letter runs straight into a letter of another script: two spellings of one name glued together (EA FC 26 had 286, below) |
| `player-in-two-teams` | One player, by source id, in two nations or in two clubs of one season |

**Warnings**, counted and shown with examples, which the data may keep:

| Check | What it finds |
| --- | --- |
| `age-unusual` | Younger than 16 or older than 40 when the season starts |
| `name-unusual` | Punctuation beyond hyphens, apostrophes and full stops (gamer tags are not checked: "Q_U_I_E_T_", "bjdn!") |
| `namesakes-in-team` | Two players of one name in one squad |
| `spelling-variant` | One player spelled two ways in one season (same folded name and rating; where both carry source ids, the same id) |
| `rating-conflict` | A name in a national squad and a club of one season at different ratings, with no club record at the national one (by source id where both have one) |
| `lineup-gap` | A team the game fields with an empty lineup place or an outfield player (or skater) in goal |
| `strength-mismatch` | A stored strength more than one point from the lineup the game fields (nations of the sports that fill gaps with generated players excepted: their builders store their own players' strength) |
| `birth-date-disagreement` | A player, by an id that names one person in every season (EA's, Wikidata's), born more than a month from the date most of the other seasons give; a tie goes to the newest season's date. Championship Manager's and SWOS's ids number one database's rows (`cm:59011` is David Weir in one, Gennady Tumilovich in another), so they are not compared |
| `rating-jump` | A player, by EA id, rated 15 or more points apart in editions a year apart |

## The first run, and what changed (2026-11-14)

The first run found 14 errors and 2,017 warnings. Every error was fixed where it came from, in its builder, and
the seasons rebuilt; each builder's `--check` rebuilt the shipped files byte for byte before the change, so every
difference is the fix's.

- **Damaged names.** CM3's 1998/99 database has `"Masashi\r\nMasashi Nakayama"` in Japan's XI and CM 99/00
  `"Medhat Abdel  Hady"` in Egypt's: the CM reader (`src/data/cm0102.js` `nameTable`) now cuts a name record at its
  first line break and makes its spaces single, which changes those two names and nothing else. Pro Football
  Archives' 1981 Dolphins page names `"Bob Baumhower 9SK?"`: the reader (`scripts/lib/pfa.mjs`) cuts a trailing
  note with a digit or question mark, and the committed fact (`scripts/data/pfa-seasons/1981.json`) is corrected to
  match, as a sync would now write it.
- **Children in the fan-made databases.** Cam F's back-dated 1993/94 database keeps later players as children:
  55 of 1993/94's starters, nations' and clubs', were 11 to 15, among them Ibrahim Sunday, 12, in Nigeria's XI
  and Wisła Kraków's, and six of Niger's XI. `MIN_PLAYING_AGE` (`src/data/footballSetBuild.js`): a CM-format
  database's player younger than 16 when its season starts plays for no one. Niger, left with two players, no
  longer takes the field in 1993/94 (Mali and Benin still do, with six and seven); Helsingborgs IF, two of whose XI
  were 14, drops out of Europe's 124 for RFC Seraing, so `eu124e1994` was rebuilt (`npm run build:europe-maps --
  --only=eu124e1994,eu32e1994`; Seraing's ground from Belgium's map, `d056-216`). Simon Treanor's 1989/90 loses 18
  such starters from 13 XIs, and Gambia its side. SI's own databases had none in any XI and change only in pool
  sizes.
- **Wikidata stints a birth date contradicts.** Three computed national-team players: Óscar Ulloa, born 1986, in
  El Salvador's XI from 1988/89 (aged 1 to 5); Rusdi Suparman, born 1973, in Malaysia's 1986/87 XI (13); Antoine
  Tassy, born 1924, Haiti's coach, in its 1970/71 XI as a forward (46). The manifest's `selection.ages` (14 to 45)
  leaves such a stint out of the pool; Raúl Díaz Arce takes Ulloa's place, and Haiti, with 10 players named for
  1970/71, fields no team that season.

Two inconsistencies among the warnings were fixed too, both in the built-in season:

- **Basketball's national fives against its clubs.** Fifteen EuroLeague players were rated one way for their
  country and another for their club (Chima Moneke 74 for Nigeria, 83 at Crvena Zvezda; Andreas Obst 78 and 73),
  and four NBA stars spelled two ways ("Nikola Jokic" for Serbia, "Nikola Jokić" in Denver). `npm run
  build-basketball` now takes an NBA player's name and rating from NBA 2K27 and a EuroLeague player's from the
  built-in EuroLeague's estimate (`scripts/lib/euroleague.mjs`), before the curated rating: 42 of the 235 national
  players, and 14 of the 47 nations' strengths move by one or two points. docs/design/euroleague.md had listed this
  as a known limitation.
- **Hockey's two Elias Petterssons.** The built-in Canucks named two players "Elias Pettersson" (the centre and the
  young defender). `npm run build-hockey` gives namesakes the birth-year tags the 2025/26 season's snapshot gives
  their NHL ids, as every NHL season does: "Elias Pettersson (1998)" and "Elias Pettersson (2004)".

## Seasons added after the first run (2026-11-15)

Merging main brought Rocket League, the ten computed women's World Cup and Olympic seasons (`wwc-`, `wol-`), the
EuroLeague clubs that every NBA season from 2000/01 now carries, and rugby league's 39 premierships from 1960 to
1997 (`nrl-1960` to `nrl-1997` and Super League's `nrl-sl-1997`). Their only errors were Rocket League's: 19 of
its 241 players go by gamer tags with digits ("M0nkey M00n", "2Die4", "o0vvl"), which the name check read as
damage. A tag is the player's own spelling, so the sport is in `HANDLES`: its names are still checked for control
characters, mojibake, HTML entities, question marks and spacing, but may hold digits and other punctuation. The new
seasons add 14 warnings, all of kinds already counted below; the rugby league seasons add none.

Shipping to main (2026-11-17) brought college football, Counter-Strike, Valorant and League of Legends, and SWOS's
Top 124 from all of Europe. Their only errors were the three new esports' gamer tags (192 with digits, "s1mple",
"Jamelinho213"), so those sports joined `HANDLES` too. The run then read 584 seasons with no error and 1,267 warnings.

## The second pass: is the data right? (2026-11-15)

Asked "can you continue validating the quality accuracy of the ratings and informations?". The first pass asked
whether the data arrived whole; this one whether it is right: one person told the same way across seasons and
layers, ratings that move as a player's career does, and teams that rank as their results did.

### Information

- **Placement holds.** No player is in two nations or two clubs of a season (`player-in-two-teams`, 0). All 43,120
  club records name the club they play for. Of 44,161 national records with a nationality, 225 play for a nation
  other than the one their nationality usually lands in, and every one is meant: names of the day (Matthäus for West
  Germany and Sammer for East Germany in 1989/90, Kežman for Serbia and Montenegro), renamings (North Macedonia,
  Eswatini), and two of the built-in season's caps-checked switches (Tiknizyan to Armenia, Gerezgiher to Eritrea).
  Every EA-scale rating equals EA's own.
- **EA FC 26's full names were glued to a second script.** SoFIFA's snapshot behind the 2025/26 season
  (`scripts/data/ea-fc26.csv`) ends 286 long names with the same name in Cyrillic, Arabic or another script, with no
  space ("Kiril Vasilev Despodov" and "Кирил Василев Десподов" as one), and the game shows a full name on hover. The EA
  reader (`scripts/lib/football-data.mjs` `parseEaPlayers`) now keeps the Latin part, as EA FC 25's build already
  did (`latinPart`, moved there from `scripts/lib/ea-site-seasons.mjs`), including Milan Borjan's Serbian copy typed
  partly in Latin look-alikes, which begins where a small letter meets a capital. Only `ea-fc-26.json` changes; the
  built-in rosters and clubs rebuild unchanged. FIFA 15 to EA FC 24 give 471 Chinese players' full names in Chinese
  characters only (王霜 for Wang Shuang): EA's own, kept.
- **Namesakes are not merged.** In the seasons rated from statistics, two players of one name on different clubs
  share a rating no more often than chance: 5 of 131 pairs in the Pro Football Archives seasons (3.5 expected), 4 of
  63 in MLB's WAR seasons (3.5), 2 of 35 in rugby league's (2.1). The two Jeff Robinsons of the 1988 Tigers and
  Pirates are a coincidence the importer's ids (the Baseball Databank's) keep apart.
- **EA's dates of birth move between editions** (`birth-date-disagreement`, 214): 196 in FIFA editions, mostly a date
  EA corrected later (Dominik Livaković 2 September 1995 in FIFA 20, 9 January in seven others), 71 of them a whole
  birth year. The minority date is usually, not always, the wrong one: EA FC 27 corrected Pedro Bigas to 15 May 1990
  after four editions of 15 September. The game shows no age; only the audit and the CM age rule read dates.
- **One EA id, two people?** FIFA 05's id 139068 is "Lourenço", an Angolan forward born 1983 (FIFA Index's own page),
  and Nani's in every later edition. The game never links seasons by id, so nothing follows from it.

### Ratings across editions

The same player (EA id) in editions a year apart: from FIFA 13 against FIFA 14 on, the correlation is 0.93 to 0.98,
a change's standard deviation 1.1 to 2.1 points, and at most 5 changes of 10 a year. From FIFA 05 against FIFA 06 to
FIFA 12 against FIFA 13, EA revised more: 0.87 to 0.93, 2.3 to 4.7 points, and up to 25 changes of 10 or more. The
mean change stays within a point and a half of 0, so the editions share one scale. The women's editions agree at
0.83 to 0.97. The 24 `rating-jump`s are all FIFA 06 to FIFA 12, mostly
players of smaller football nations EA re-rated (Samuel Koejoe of Suriname 56 to 78, Edgar Álvarez of Honduras 53 to
77) and breakthroughs (Manuel Neuer 64 to 80, Marek Mintál 72 to 88).

### Ratings against results

`npm run validate:football-elo` scores each of the 35 game-rated football seasons with national teams (the computed
`nt-` and `wc-` seasons are built from results, so results cannot check them): the Spearman correlation of the
strength each fielded nation plays at with its World Football Elo rating on the day the season starts, by the squad
gate's own `crossSectional` and Elo replay (docs/design/football-squad-gate.md), which rebuilds every year's table
exactly. Its figures for the two seasons the gate scores agree with the gate's (0.927, and 0.832 at 1 July against
0.841 at EA FC 26's snapshot). The yearly tables use the names of their day, so `PERIOD_ELO_CODES` reads West
Germany as WG, the Soviet Union SU, Yugoslavia YU, Serbia and Montenegro RM, Czechoslovakia CS, Zaire ZR, Macedonia MK
and Swaziland SZ; without them 1989/90 scored no West Germany, Soviet Union or Yugoslavia.

| Seasons | All fielded nations | Nations with a full XI |
| --- | --- | --- |
| Built-in 2026/27 (EA FC 27 with FM 26) | 0.927 (173) | 0.927 |
| Championship Manager, 1989/90 to 2003/04 | 0.817 to 0.907 | 0.790 to 0.907 |
| SWOS, 1994/95 to 1996/97 | 0.851 to 0.865 | the same |
| FIFA 05 to FIFA 09 | 0.879 to 0.904 (0.744 to 0.817 before the computed fills) | 0.879 to 0.904 (0.818 to 0.896) |
| FIFA 10 to FIFA 12 | 0.805 to 0.834 (0.779 to 0.835) | 0.805 to 0.834 (0.762 to 0.796) |
| FIFA 13 to EA FC 24 | 0.853 to 0.899 (0.794 to 0.889) | 0.838 to 0.879 (0.808 to 0.865) |
| EA FC 25 and EA FC 26 | 0.814 and 0.845 (0.800 and 0.832) | 0.815 and 0.819 (0.822 and 0.816) |

The median is 0.869 (0.852 before the computed fills). Where EA's seasons fell short it was mostly coverage: EA rates
few players of leagues it has no licence for, so Iran, Egypt, Iraq and Japan (and Russia and Ukraine in FIFA 08) played
with empty places and ranked 44 to 66 places below their Elo, which is why FIFA 05 to FIFA 09 agreed far better over
full XIs only (FIFA 07 0.762 → 0.896). Since 2026-11-18 the computed fills give a fielded nation's empty places to
players capped for it that season, rated from its Elo and marked as estimates
([football-years.md](football-years.md#computed-fills)); the figures above are after them, those in brackets before.
Full XIs now include the filled ones.
The rest is EA's view of players against results: Iceland, Wales and Mali rank about 28 places above their Elo in
FIFA 08, and Bosnia, Ghana and Suriname's Dutch-born XI about 40 in EA FC 25. The built-in season, whose gaps FM 26
fills, agrees best.

## The warnings that remain (994)

Each is a fact of a source or a rule the game chose, not an error:

- **`lineup-gap` (444; 709 before the computed fills).** Football never invents a player, so a nation whose source rates
  fewer than eleven plays short (an empty place counts 40) or with an outfield player in goal: 1 to 30 nations in each
  EA edition, where Wikidata names no capped player for the places (Iran fields nine in EA FC 26, six of them EA's),
  4 to 13 in each of the women's, 11 to 19 in each CM database, and 9 of the 36
  built-in women's nations. A nation takes the field only when its own players hold half its lineup
  (`fieldsRealSide`). Ten NHL clubs (six of NHL 22's, whose source pages CommonCrawl kept incomplete, and four
  expansion clubs of NHLPA 93 and NHL 94) play one to three skaters short, by docs/design/hockey.md's rule
  ("Nothing in them is estimated").
- **`name-unusual` (100).** The birth-year tags the NHL, MLB and national-team builders give namesakes
  ("Petr Sykora (1976)", "Pedro Martinez (1968)", "Avi Cohen (1956)"), SWOS 94/95 and 95/96's own "Joao Pinto(i)"
  and "(ii)", and Madden NFL 11's "Adam "Pacman" Jones".
- **`namesakes-in-team` (80).** Mostly EA's short names, two players under one in a squad (Argentina's
  "L. Martínez", Lautaro and Lisandro; Malawi's "T. Chawinga", the sisters Tabitha and Temwa), and real namesakes
  (the 1976 Packers' two Mike McCoys, the 2017 Panthers' two Charles Johnsons, two Rocket League players tagged
  "Abdullah" for Oman). The match feed shows both alike.
- **`strength-mismatch` (82).** 65 NBA clubs (NBA 2K00 to 2K14, 2K20 and two eras seasons) and 8 EuroLeague clubs of
  the earlier seasons (Siena in NBA 2K14's, Partizan in 2K04's) whose best five has a player out of position: a
  club's `str` is its five's mean, by docs/design/football-years.md's rule, while play takes 12 points off the
  misplaced player, so these clubs play about 2.5 below their listed strength (2012/13's Heat start Ray Allen at
  centre). Nine football clubs are off by 1 to 1.5, where the builder's XI differs from the game's pick.
- **`age-unusual` (50).** Real teenage debutants and veterans: Modrić, Ronaldo and Chhetri at 40 and 41 in the
  built-in season, five of the computed fills' players (Roman Berezovsky, Armenia's keeper, at 41 in 2016/17; Vincent
  Thill at 15 for Luxembourg in 2015/16), Yisa Sofoluwe at 15 for Nigeria in 1982/83, Vitorino Hilton at 42 for Montpellier, and five
  players 15 on 1 July before a women's World Cup and 16 at it (Australia's, Mexico's and North Korea's in 2010/11).
- **`rating-conflict` (8).** MLB namesakes the nation and club layers both name: three Luis Garcías, two
  Francisco Rodríguezes, two Miguel Gonzálezes, two Ryan Brauns.
- **`birth-date-disagreement` (209)** and **`rating-jump` (22)**: EA's own changes between editions, above (fewer since the
  computed fills, which leave out some EA players who played out of position).

## Open questions

- Whether an NBA season's `str` should be the lineup the game plays (the 73 basketball clubs above), as football's is.
- Whether a squad with two players under one EA short name should show their full names.
- Whether NHL 22's six short clubs should borrow the computed seasons' ratings for their missing places, which
  hockey's rule has so far refused.
- Answered on 2026-11-18: the EA seasons' short national XIs are filled from Wikidata's caps and the nation's Elo
  (docs/design/computed-ratings.md, adopted by the user on 2026-11-17; [football-years.md](football-years.md#computed-fills)).
