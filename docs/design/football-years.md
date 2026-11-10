# Football years: data sets beyond the built-in season

Status: implemented for local CM 01/02 data sets, 2026-10-24; the built-in
earlier seasons from EA's FIFA 15 – EA FC 24 launch rosters and an
always-visible Season choice, 2026-10-30; FIFA 07 – FIFA 14 from two scrapes of
EA's rosters, and the earlier basketball seasons from 2K Archive's NBA 2K
ratings, on maps of their eras, 2026-10-30; FIFA 05 and FIFA 06, nations only,
2026-11-07; five seasons before them, 2002/03 to 1996/97, from SI's CM 01/02, CM3
and CM 97/98 databases and SWOS 96/97's national squads, 2026-11-08; the federations
of every season from 1961/62, with those of their day (the Soviet Union, the CIS,
Yugoslavia, FR Yugoslavia, Czechoslovakia, West Germany and Zaire) under their own
names and flags, 2026-11-09 ([Federations of the day](#federations-of-the-day-196162-to-199596));
2000/01 and 1999/00 from SI's own CM 00/01 and CM 99/00 databases, read from their
retail CDs, SWOS 94/95 and 95/96 with their clubs, read from the game's own team
files, and the two fan-made CM databases of 1993/94 and 1989/90, 2026-11-09; the basketball
seasons no game rated, 1960/61 to 1997/98, computed from Basketball-Reference's
statistics, 2026-11-09; the nine World Cups from 1961/62 to 1993/94 as computed
seasons, 2026-11-10 ([Computed World Cup seasons](#computed-world-cup-seasons)). The CM 01/02
path now runs on real databases (SI's own and the CM3 port); the community's
still need a forum login. Sources and terms are in
[football-year-sources.md](football-year-sources.md); the permission requests in
[football-year-permissions.md](football-year-permissions.md).

## Goal

A football campaign can be played on a **data set** other than the built-in one.
A data set is one dated database turned into nations and clubs. There are two
kinds:

- **The built-in earlier seasons** (2004/05 to 2025/26): one EA FIFA / FC
  roster each, committed under `public/football/ea-*.json` and offered in every
  setup. See [Built-in earlier seasons](#built-in-earlier-seasons). Before them,
  eleven more from 2002/03 back to 1989/90: SI's own CM 01/02, CM 00/01 and CM
  99/00 databases, its CM3 and CM 97/98 data, three editions of Sensible World of
  Soccer, and two fan-made CM databases. See [Seasons before FIFA 05](#seasons-before-fifa-05).
  Before those, the World Cups of 1962 to 1994, nations only, their ratings computed
  from the nations' Elo and the players' records. See [Computed World Cup seasons](#computed-world-cup-seasons).
- **Local CM 01/02 seasons**: a Championship Manager 01/02 database the user has
  downloaded, built on their computer. Until the database authors allow
  redistribution these stay local: the user puts the database in the ignored
  `data-src/cm0102/`, and the command-line builder writes the data set to
  `public/football/cm0102-*.json`, which git ignores (all but the three built-in
  ones, which the builder neither writes nor lists). When permission arrives,
  those files can be committed by removing one `.gitignore` line, and its scope
  should be recorded in the permissions note first.

The built-in data is the current season and the default: 2026/27, EA FC 27 + FM 26
for football and NBA 2K27 for basketball (until 1 November 2026 it was 2025/26,
EA FC 26 + FM 26, and 2024/25, NBA 2K25; both now play as earlier seasons, below).

## Terms

- **Data set id**: `cm0102-<yyyy>-<mm>`, from the database's release month, e.g.
  `cm0102-2026-05` (May 2026 update, season 2025/26). Two releases in one month
  take their variant as a suffix (`cm0102-2012-03-odb`, `cm0102-2012-03-sim`).
  An EA season is `ea-fifa-<nn>` or `ea-fc-<nn>` after its edition
  (`ea-fifa-18`, `ea-fc-24`). The built-in data has no id (`null`).
- **Year**: the season-end year, as in the sources note. `cm0102-2026-05` is year
  2026 and season "2025/26", like the EA FC 26 season, so a season can have several
  data sets (EA's, CM's December and May updates).
- **Version**: `<id>-<8 hex>`, the first 8 hex of the SHA-256 of the data set
  file's content without its `version` field. A save names the version it was
  built from.

## Pipeline

```
data-src/cm0102/<folder>/Data/*.dat        user's own download (ignored)
        │  npm run build:football-set -- --cm0102=data-src/cm0102/<folder>
        ▼
src/data/cm0102.js        parse the binary files (pure; Node and browser)
src/data/footballSetBuild.js  build the data set (pure; Node and browser), from:
src/data/cm0102Releases.js   known databases: label, season, release date, topic URL, DOB shift, file signature
src/data/cm0102Nations.js    CM nation name → game nation id, plus names deliberately without a team
src/data/footballFederations.js  per year: shapes held by another federation, shapes with no federation
        ▼
public/football/cm0102-<id>.json  one data set (ignored)
public/football/index.json  every local data set present (ignored), rebuilt each run
        ▼
src/engine/footballSets.js  list (with the built-in earlier seasons), load, validate, decode; year-bound sport
```

The builder fails rather than guess:

- It stops on a file that does not match the documented layout.
- It stops on a nation name that is neither mapped nor listed as having no team.
- It stops on a database it cannot identify unless `--label`, `--released`,
  `--url` and `--dob-shift` are given.

It never invents a player or a rating. A nation with fewer than eleven natural
players keeps exactly the players it has, as with the built-in data.
`--allow-unmapped` turns the unmapped-nation stop into a report, and those
players are then left out, not guessed.

The format is in [cm0102-format.md](cm0102-format.md). A database is identified
by the sizes of its `club.dat` and `staff.dat`, a pair that is unique across the
48 releases in `cm0102Releases.js`. The manifest gives each release's season,
release month, forum topic, author and per-field date shifts, and SI's own 3.9.x
databases are recognised the same way, as are SI's CM 99/00 and CM 00/01 files
([below](#sis-cm-0001-and-cm-9900-read-from-their-cds-200001-and-199900)). The builder also estimates the birth-year
shift from famous players' known birthdays, counting each person once. For an
unknown folder, a conclusive estimate that disagrees with `--dob-shift` stops
the build. For a known release, it raises a loud warning and the manifest's shift
is kept.

**Seasons ending before 1962 are refused** (`FIRST_YEAR`). 1961/62, the first
World Cup season the game covers, is the first one accepted, and the federations
table covers every year from then on, with the federations of the day a season
of 1961/62 to 1995/96 plays under their own names and flags
([below](#federations-of-the-day-196162-to-199596)). Until 2026-11-09 the first
year was 1997.

### Federations by year

A game nation takes part in year Y if its association was a FIFA member by
30 June Y, the end of season Y. Before then its shape is held by another
federation (`heldBy`), until `heldUntil` where that federation lost it earlier
(by the same cutoff), or neutral. From 1997 that affects these shapes
(`src/data/footballFederations.js`, each date from FIFA's page for the
association, read 2026-11-08):

| Shape | Until | Before then |
| --- | --- | --- |
| Bosnia and Herzegovina (070) | 1996 | neutral. FIFA member 3 Jul 1996, so it plays in every season shipped |
| Eritrea (232) | 1997 | neutral. FIFA member 1998 (FIFA gives 1 January, the year only) |
| Palestine (275) | 1997 | neutral. FIFA member 1998 (as Eritrea) |
| Mongolia (496) | 1998 | neutral. FIFA member 29 Jul 1998, after 1997/98's cutoff |
| Bhutan (064) | 2000 | neutral. FIFA member 1 Aug 2000 |
| Montenegro (499) | 2006 | held by Serbia (688): FR Yugoslavia, then Serbia and Montenegro. FIFA member 31 May 2007 |
| New Caledonia (540) | 2003 | held by France (250), as a French territory. FIFA member 2004 |
| Timor-Leste (626) | 2005 | neutral (Indonesia's occupation until 1999 was never recognised by the United Nations). FIFA member 12 Sep 2005 |
| South Sudan (728) | 2011 | held by Sudan (729) to independence. FIFA member 25 May 2012 |
| Kosovo (KOS) | 2015 | held by Serbia (688), FR Yugoslavia, until the United Nations took over its administration on 10 June 1999 (Security Council resolution 1244), so in 1996/97 and 1997/98; neutral from 1998/99, whose cutoff falls after that day. FIFA member 13 May 2016 |

Every other game nation's association was a FIFA member before 1996: the Soviet,
Yugoslav and Czechoslovak successor states by 1994. In the seasons from 1996/97,
built before identities, Serbia keeps its modern name and flag in its FR
Yugoslavia and Serbia and Montenegro years. The seasons before 1996/97 are below.

### Federations of the day (1961/62 to 1995/96)

Decided 2026-11-09, for the seasons before 1996/97 that the computed World Cup
seasons, SWOS 94/95 and 95/96 and the fan-made CM databases add (SWOS's and the
fan-made ones ship: [Seasons before FIFA 05](#seasons-before-fifa-05); so do the
computed World Cup seasons, [below](#computed-world-cup-seasons)).
`FIRST_YEAR` is 1962, and `src/data/footballFederations.js` gives every
season from 1961/62 its federations, as the state on its cutoff (30 June of the
season-end year), in three parts. Every year from 1996/97 keeps exactly the
territory it had, and has no identity, so every season the game ships rebuilds
byte for byte.

**Admissions** (`shapes`). Every game nation whose association joined FIFA after
30 June 1962 has its date, 79 shapes from Australia (1963) and Algeria (1964) to
Kosovo (2016), each from FIFA's page for the association ("FIFA member since",
read 2026-11-09; `scripts/data/fifa-member-associations.json` keeps all 176 game
nations', and a test checks the table against it). FIFA gives 1 January where
it knows only the year, and that day is used, so such a nation counts from the
season ending in that year. Slovenia alone has a day from elsewhere: FIFA gives
1992, its association's article (Wikipedia, revision 1372391120) 3 July 1992,
the day Croatia and Ukraine were admitted. Before its admission a shape is
neutral, colonies included (the map has no colonial empires), unless it was part
of another game nation, which holds it, as Sudan holds South Sudan: Eritrea is
Ethiopia's until it became independent in fact on 24 May 1991, Bangladesh
Pakistan's until the surrender of 16 December 1971.

**Federations of the day** (`federations`). Each plays on its holder's shape
under its own name, FIFA code of the day (List of FIFA country codes, Wikipedia,
revision 1383938499) and flag, and holds its members' shapes, whatever their own
dates:

| Federation | Code | Flag | Holder | Holds | Seasons |
| --- | --- | --- | --- | --- | --- |
| Soviet Union | URS | `su` (new) | Russia (643) | the other 14 republics | to 1990/91 |
| CIS | CIS | `cis-1992` (new) | Russia (643) | Ukraine, Belarus, Georgia, Armenia, Azerbaijan, Kazakhstan, Uzbekistan, Turkmenistan, Tajikistan, Kyrgyzstan, Moldova | 1991/92 |
| Yugoslavia | YUG | `yu` (new) | Serbia (688) | Croatia, Slovenia, Bosnia, North Macedonia, Montenegro, Kosovo | to 1990/91 |
| FR Yugoslavia | YUG | `yu-1992` (new) | Serbia (688) | Montenegro, Kosovo (their own entries) | 1991/92 to 1995/96; barred to 1993/94 |
| Czechoslovakia | TCH | Czech (`cz`) | Czechia (203) | Slovakia | to 1992/93 |
| West Germany | FRG | German (`de`) | Germany (276) | nothing | to 1989/90 |
| Zaire | ZAI | `zr` (new) | DR Congo (180) | nothing | 1971/72 to 1995/96 |

- **The Soviet Union and the CIS** (Soviet Union and CIS national football team,
  Wikipedia, revisions 1384615907 and 1384484443). The Soviet team's last match
  was on 13 November 1991, and the Soviet Union ceased to exist on 26 December
  1991. The team played on as the CIS, approved by FIFA on 13 January 1992, until
  Euro 1992 (18 June 1992): twelve former republics, the eleven CIS members and
  Georgia, then outside the CIS, but not the Baltic states. Their associations
  take part from 1991/92 under FIFA's dates (1923); Estonia's first FIFA match
  after the Soviet years was on 3 June 1992. Ukraine joined FIFA on 3 July 1992,
  Belarus, Georgia and Armenia in 1992, the other seven in 1994, so 1992/93 has
  those seven neutral.
- **Yugoslavia** (revision 1378612036). The dates the work was asked to check
  decide 1991/92: by its cutoff FR Yugoslavia had adopted its constitution (27
  April 1992; Serbia and Montenegro, Wikipedia, revision 1384622516) and its
  association had been barred under the United Nations sanctions (31 May 1992),
  and Croatia and Slovenia joined FIFA only on 3 July 1992. So SFR Yugoslavia's
  last season is 1990/91 (its last match was on 25 March 1992), and in 1991/92 no
  shape of the old Yugoslavia fields a team. Croatia and Slovenia play from
  1992/93, North Macedonia from 1993/94 (16 June 1994), Bosnia from 1996/97.
- **FR Yugoslavia** (revision 1366001746) is barred to 1993/94 and plays from
  1994/95, its first match after the sanctions on 23 December 1994, under its
  name and its blue, white and red flag. Its identity stops with 1995/96: the
  seasons from 1996/97 were built before identities and play it as Serbia.
- **Czechoslovakia** (revision 1375198257) ended on 31 December 1992, but its team
  played the rest of the 1994 World Cup qualifiers as the Representation of Czechs
  and Slovaks until 17 November 1993, after 1992/93's cutoff. The Czech Republic
  and Slovakia played from February 1994, and FIFA dates Slovakia's association
  from 1994 (the Czech one from 1907), so 1993/94 has them apart. It flies the
  Czech flag.
- **West Germany** (Germany FR, FRG, revision 1384613198) until reunification on 3
  October 1990 (German reunification, revision 1383934904), after 1989/90's
  cutoff: its name and code only, under Germany's flag. **East Germany** has no
  shape on the map, so it fields no team (decided 2026-11-09: no new shape), and
  1973/74 has one World Cup finalist fewer.
- **Zaire** (revision 1383080856): the DR Congo was renamed on 27 October 1971 and
  renamed back in May 1997, before 1996/97's cutoff.

A nation in a database named after a federation of its year plays for the
holder (`dayNationResolver`): SI's 'Soviet Union', 'Czechoslovakia', 'West
Germany', 'Zaire' and 'Commonwealth of Soviet States' (the CIS's `aliases`),
which `cm0102Nations.js` lists as having no team, as they have in any other year.

**Suspensions** (`suspensions`). A suspended association's shapes are neutral, and
so is every shape it holds:

| Association | From | To | No team |
| --- | --- | --- | --- |
| South Africa | 26 Sep 1961, suspended | January 1963, lifted | 1961/62 |
| South Africa | October 1964, suspended; expelled in 1976 | 3 Jul 1992, readmitted | 1964/65 to 1991/92 |
| FR Yugoslavia | 31 May 1992, the United Nations sanctions | December 1994 | 1991/92 to 1993/94, Montenegro and Kosovo too |
| China PR | 8 Jul 1958, left over Taiwan | 7 Jul 1980, readmitted by the 42nd Congress | to 1979/80 |

South Africa's dates come from its national team's article (revision 1384091000),
its expulsion at the Montreal Congress on 16 July 1976 from the South African
Football Association's (revision 1370236747), and its readmission from South
African History Online (`sahistory.org.za`, whose robots.txt allows ClaudeBot);
FIFA gives only the year of the new association, 1992. China's are from the
Chinese Football Association's article (revision 1375920796); the national team's
gives only the year 1979 for its return. A date known only to the month is kept
so ('1963-01'); none falls in a cutoff's June, so no day would change a season.
Suspensions from 1996/97 on are not listed: they would change the seasons already
shipped.

**Territory** (`territoryFor(table, year, { fields })`): a suspended shape is
neutral; a federation's member is merged into its holder in its years; any other
shape is held or neutral until its admission, as before; and a merged shape
whose holder is neutral, held itself, or, given `fields` (a nation id → whether
the season fields its team), fields no side, is neutral. A builder whose source
has no team for a holder passes `fields`: SWOS 94/95 has no FR Yugoslavia squad,
so Serbia, Montenegro and Kosovo are all neutral there.

**Identities** (`identitiesFor(table, year, { fields })`): `{ shape: { name,
code, flagId } }` for each federation of the year whose holder takes part and,
given `fields`, fields a side:

| Seasons | Identities |
| --- | --- |
| 1961/62 to 1970/71 | Soviet Union, Yugoslavia, Czechoslovakia, West Germany |
| 1971/72 to 1989/90 | the same and Zaire |
| 1990/91 | Soviet Union, Yugoslavia, Czechoslovakia, Zaire |
| 1991/92 | CIS, Czechoslovakia, Zaire |
| 1992/93 | Czechoslovakia, Zaire |
| 1993/94 | Zaire |
| 1994/95, 1995/96 | FR Yugoslavia, Zaire |
| from 1996/97 | none |

A season file carries them as `identities` (below). The loader checks them for
every men's football kind (`validateIdentities`): each names a nation the season
fields (listed with players, neither merged nor inactive), a name and a code of
three capitals that no other nation of the season plays under, and a flag in
`src/data/flags.js`; another sport's season may not have them. `decodeFootballSet`
keeps a frozen copy as `meta.identities`, and `seasonSport` plays it as
`playsAs`, as Great Britain plays on England's shape (`src/data/teams.js`
`nationIdentity`). So `buildTeam` names and flags the
holder's team, and the setup wall, the campaign, its map labels, Flags mode, the
chronicle and the saves show the Soviet Union with its flag; the land keeps its
name ("Ukraine, held by Soviet Union"). A saved team keeps its name, code and
flag, so a campaign resumes without the season file.

The CM 01/02 builder writes a season's identities (its holders with players),
fields a federation's members' players for it (`federationTeamOf`: a Ukrainian of
a 1989/90 database plays for the Soviet Union, a Slovak for Czechoslovakia), and
records both in its audit (`federations: { identities, pooled }`). A shape merged
into a nation without an identity (New Caledonia into France) keeps its players
apart, as before.

**Flags.** flag-icons has none of these, so five public-domain SVGs from
Wikimedia Commons are pinned in `scripts/data/historic-flags.json` (file page
revision, the original's SHA-256, licence) and committed under
`scripts/data/historic-flags/`. `npm run build:historic-flags` redraws each on
flag-icons' 640 × 480 canvas into `public/flags/`, keeping every original path:
the flag is scaled by its height to 480 and cut to 640 wide, at the fly for the
Soviet flag (its emblem is in the canton), evenly for the others; a plain field
becomes rectangles. `--check` rebuilds them byte for byte, and `npm run
test:flag-symbols` runs it.

| Flag id | File | Commons file | Licence (as the file page states) | Emblem kept upright on the map |
| --- | --- | --- | --- | --- |
| URS | `su` | Flag of the Soviet Union.svg | PD-RU-exempt | hammer, sickle and star |
| CIS | `cis-1992` | Flag of the CIS (UEFA Euro 1992).svg | PD-textlogo | the letters C.I.S. |
| YUG | `yu` | Flag of Yugoslavia (1946-1992).svg | PD-ineligible, PD-shape, PD-Yugoslavia | the star, its gold edge included |
| FRY | `yu-1992` | Flag of Serbia and Montenegro (1992–2006).svg | PD-SCGGov, PD-ineligible, PD-shape | none: three bands |
| ZAI | `zr` | Flag of Zaire (1971–1997).svg | PD-Democratic Republic of the Congo, PD-ineligible | the disc with arm and torch |

The four emblems have symbol profiles (`src/data/flagSymbols.js`; split by
`scripts/build-flag-symbols.mjs`, whose files for them name their public-domain
source). Their bounds are measured by `build-historic-flags.mjs` (the drawn
extent, the Yugoslav star's mitred gold tips included, rounded outward with a
one-unit margin), which checks the profiles against them. `npm run sync-flags`
leaves the five alone. `docs/design/flag-symbols-review.html` shows them on the
Soviet Union's, the CIS's, Yugoslavia's and Zaire's land.

**Checks.** `scripts/football-federations.test.mjs` (in `npm run
test:football-sets`): the table against FIFA's dates; territory and identities
of 1969/70 (the Soviet Union holding Ukraine and the Baltic states), 1973/74
(Zaire, no East Germany), 1981/82 (Yugoslavia holding Croatia), 1989/90
(Czechoslovakia holding Slovakia), 1991/92 and 1992/93 to 1995/96; the
suspensions; every year 1961/62 to 1995/96 consistent and none from 1996/97 with
an identity; the CM 01/02 builder's pooling and names; the loader's refusals; and
a 1969/70 campaign launched, drawn, flagged, saved and resumed as the Soviet
Union. `scripts/flag-symbol-layout.test.mjs` fits each historic emblem on its
federation's real land.

Spot check against history (2026-11-09): every one of the 176 men's World Cup
finalists of 1962 to 1994 (the Fjelstul World Cup Database's qualified teams)
takes part in its season, none neutral or held, but East Germany in 1974, which
has no shape. They play as the Soviet Union in 1962, 1966, 1970, 1982, 1986 and
1990, Yugoslavia in 1962, 1974, 1982 and 1990, Czechoslovakia in 1962, 1970,
1982 and 1990, West Germany in every one from 1962 to 1990, and Zaire in 1974;
the 1994 finalists, Russia and Germany among them, all under their own names.

## Data set file (format 1)

```json
{
  "format": 1,
  "id": "cm0102-2026-05",
  "version": "cm0102-2026-05-1a2b3c4d",
  "year": 2026,
  "season": "2025/26",
  "label": "CM 01/02 · May 2026",
  "local": true,
  "source": {
    "provider": "CM 01/02 Update Team",
    "edition": "CM 01/02",
    "version": "May 2026",
    "snapshotDate": "2026-05",
    "url": "https://www.champman0102.co.uk/viewtopic.php?t=10604",
    "rawScale": 200,
    "conversion": "round(ca * 99 / 200)",
    "dobShift": 24
  },
  "nations": { "<nation id>": [strength, poolSize, [tuple, ...]] },
  "clubs": [ { "id", "name", "code", "league", "country", "col", "str", "squad": [tuple, ...] } ],
  "territory": { "merged": { "<shape id>": "<holder nation id>" }, "inactive": ["<shape id>"] },
  "identities": { "<holder nation id>": { "name": "Soviet Union", "code": "URS", "flagId": "URS" } },
  "coverage": { "players": 0, "nations": 0, "completeXIs": 0, "clubs": 0, "leagues": 0 }
}
```

- `nations` has an entry for **every** one of the 176 nations, even an empty
  one, so the hand-tuned built-in `fallbackStrength` never applies to another
  season (a computed World Cup season lists its finalists only, each with its
  eleven: [below](#computed-world-cup-seasons)). A set built before the map had the home nations lists none of
  `SCO`, `WAL` and `NIR`: it still loads, and England holds their land. An empty entry is `[40, 0, []]`, which is what `build-rosters` writes
  for an empty pool. Tonga, Samoa and the Cook Islands (`776`, `882`, `184`) are
  all listed or none: a builder lists them only when its source rates one of their
  players, and a set that lists none of them (every EA season, and any set built
  before they were on the map) fields no team of theirs, so their land stays
  neutral, as it would on the map the set was built for
  ([Pacific islands](pacific-islands.md)).
- A **player tuple** is `[cmId, name, fullName, ca, positionKeys, nationality,
  club, dateOfBirth]`:
  - `fullName` is `0` when it equals `name`.
  - `positionKeys` is a comma list of CM-derived keys (`gk`, `sw`, `lb`, `cb`,
    `rb`, `lwb`, `rwb`, `dm`, `lm`, `cm`, `rm`, `am`, `lw`, `rw`, `st`).
  - `club` is `''` without a club, and `dateOfBirth` is the real date (un-shifted)
    or `''`.

  `expandCmTuple` in `src/data/cmPlayers.js` rebuilds the game's
  `[name, pos, rating, sourceInfo]` from it, and the builder writes only tuples
  that rebuild exactly.
- **League ids** are the built-in ones (`Premier League`, `La Liga`, `Serie A`,
  `Bundesliga`, `Ligue 1`, `Eredivisie`, `Liga Portugal`), so a club theatre id
  means the same thing in every data set and saved theatre names resolve.
- `territory.merged` gives a shape to another nation's empire at kick-off.
  Montenegro is with Serbia until 2006, the same as Greenland with Denmark.
  `territory.inactive` shapes have no federation that year (Kosovo before 2016,
  Timor-Leste before 2006). They stay neutral land, as non-participants do in a
  continental theatre. Both come from `footballFederations.js`, keyed by
  year.
- `identities` (optional, men's football seasons of 1961/62 to 1995/96 only) names
  the federations of the day the season plays: its holder's team takes that name,
  code and flag ([Federations of the day](#federations-of-the-day-196162-to-199596)).
  A season without it plays every nation under its own.

### Ratings and positions

`rating = round(ca * 99 / 200)`, at least 1, from CM's current ability (1–200).
The raw value and scale stay in `sourceInfo`, as for FM. CM ratings are the
Update Team's own assessments, calibrated to the 2001 engine. They are not FM or
EA values, and the conversion does not claim they are equivalent.

A CM player is natural in a role when the position rating is at the natural
threshold and the side rating is too. Those keys map to the game's roles exactly
as FM's do: wingers count as forwards, wing-backs as defenders.

### Source evidence

```json
{ "id": "cm:<staff id>", "fullName": "...", "positions": ["DF", "MF"], "source": "cm0102",
  "edition": "CM 01/02", "version": "May 2026", "snapshotDate": "2026-05",
  "url": "<database topic>", "rawRating": 152, "rawScale": 200,
  "conversion": "round(ca * 99 / 200)", "nationality": "Bulgaria", "club": "PAOK",
  "dateOfBirth": "1996-11-11", "naturalPositions": ["rw", "rm"],
  "provider": "CM 01/02 Update Team" }
```

`expandCmTuple` builds the record. The loader's `expandSetPlayer` then adds the
database's `provider`, because five known releases come from other authors:
Sports Interactive's 3.9.x, Sawczuk's October 2003 and Helvete's September 2005.
The Source column reads "CM 01/02" and links to the database topic. The tooltip
names the provider and reads "Game rating converted from CM current ability".

## Built-in earlier seasons

Twenty-two seasons ship with the game, every season from 2004/05 to 2025/26
(and eleven before them, [below](#seasons-before-fifa-05)).
[EA FC 25](#ea-fc-25) and [FIFA 07 to FIFA 14](#fifa-07-to-fifa-14) are described
below, and so are [FIFA 05 and FIFA 06](#fifa-05-and-fifa-06),
which have nations only. Ten, 2014/15 to 2023/24, are the launch roster
(update 2) of each EA edition from FIFA 15 to EA FC 24, from one Kaggle export
(`stefanoleone992/ea-sports-fc-24-complete-player-dataset`, `male_players.csv`,
180,021 rows, labelled CC0 by its compiler; EA's own rights are not cleared, as
for the built-in EA FC 27 data). `scripts/data/ea-seasons.json` names the export,
its download link and SHA-256, and the editions. 2025/26 is EA FC 26 update 4
(19 September 2025), the committed snapshot `scripts/data/ea-fc26.csv` the
built-in season came from until 2026/27 (manifest `snapshots`, pinned by
SHA-256). Like the other EA seasons it has EA's players only, so 80 nations
field a full XI where the built-in 2025/26 filled all 173 with FM. Its 316
generated players (EA's unlicensed Brazilian clubs, Mohammedan SC and Western
United, all born on 29 February) stay out, as they did from the built-in data.

`npm run build:ea-seasons` (`scripts/build-ea-seasons.mjs`, logic in
`scripts/lib/ea-seasons.mjs`) stops on any other file, so every season rebuilds
byte for byte. It writes:

- `public/football/<id>.json`, one data set per edition (about 310 KB), with
  `kind: 'ea'` (below);
- `src/data/footballSeasons.js`, the listing the setup shows before anything is
  fetched;
- `docs/design/football-seasons-audit.json`, per season: rows, coverage, the
  players of nations without a team, clubs per league and the clubs short of an
  XI.

How a season is made:

- **One roster.** An edition's rows must share one roster id (from each
  player's SoFIFA link, `/player/<id>/<slug>/<roster>`, absolute in older rows
  and relative in newer ones) and one roster date, or the build stops.
- **Nations by EA nationality.** The built-in rosters' aliases plus EA's older
  spellings (`Czech Republic`, `Guinea Bissau`, `Korea DPR`, `Swaziland`,
  `Brunei Darussalam`) and its website's `Holland` map nationalities to game nations. `EA_NO_TEAM` lists the
  nationalities without a shape on the map (Malta, the Faroe Islands and other
  small states); their players still play for their clubs. Scotland, Wales and
  Northern Ireland have shapes and teams. Any other unmapped name stops the build. Each nation fields
  its best natural XI with the squad pick the built-in rosters use. EA rates
  only part of the world, so 73–82 nations a season field a full XI and the rest
  keep the players they have (an empty nation plays at 40).
- **Clubs by competition id.** The export names each club's league as it is in a
  later edition (FIFA 15's Burnley is in "Championship"), but its `league_id` is
  the edition's own, so clubs are taken from ids 13, 53, 31, 19, 16, 10 and 308,
  the seven big leagues. A club needs a natural XI, as build-clubs
  requires: 132–134 clubs a season, of which the strongest 124 and 32 play on the
  season's own [Europe maps](domestic-campaigns.md#the-europe-maps). Ids, codes and colours come from the same
  `presentClubs` as the CM builder.
- **Territory** is `territoryFor(FOOTBALL_FEDERATIONS, year)`, as for CM sets:
  Kosovo has no team before 2015/16, and Sudan holds South Sudan in the older seasons.
- **Ratings** are EA's overall, 1–99, unchanged.

An EA set's `source` is `{ provider: 'EA Sports', edition: 'FIFA 18', update: 2,
roster: '180002', snapshotDate: '2017-09-18', url: <the export's page>, rawScale:
99 }`, with no `conversion`. A player tuple is `[eaId, name, fullName | 0,
overall, 'ST,LW', nationality, club, dateOfBirth, slug]`. `expandEaTuple` in
`src/data/eaPlayers.js` rebuilds the game's `[name, pos, rating, sourceInfo]`,
with `source: 'ea-fc'`, the edition, update, snapshot date and the player's
SoFIFA page for that roster, and `eaTupleOf` folds it back. The Source column
reads "FIFA 18" and links to that page.

### EA FC 25

No export of SoFIFA's kind has EA FC 25, the edition between the FIFA 15 – EA FC 24
export and the EA FC 26 snapshot, so 2024/25 joins two Kaggle files by EA's player
id (`scripts/lib/ea-site-seasons.mjs`, manifest `site`, run by the same
`npm run build:ea-seasons` through the same `assembleEaSeason`):

- **Ratings, nationality and club** from an export of EA's own ratings website
  (`nyagami/ea-sports-fc-25-database-ratings-and-stats`, `male_players.csv`,
  16,161 players, Apache-2.0 as set by its compiler), dated 26 September 2024, a
  week after the release. It has EA's overall, positions, name, nationality,
  league and club, and EA's age, but no date of birth.
- **Date of birth, full name and the clubs' usual names** from a SoFIFA scrape of
  3 June 2025 (`aniss7/fifa-player-data-from-sofifa-2025-06-03`, MIT as set by its
  compiler, no nationality). 85 of its rows are two fields short (a description
  spills over) and are skipped; 39 ids are listed twice, identically.

How they are joined:

- **The same person.** A player takes the June file's date of birth and full
  name only where EA's age agrees with it on 26 September 2024: the same age, or a
  year less, since EA's website counts from an earlier day of the year (427
  players). 13,451 of the 16,161 join; 2 are set aside because the ages differ by
  more, and the other 2,708 are not in the June file. Those keep EA's name as full
  name and have no date of birth (147 of the 2,306 players the season fields).
- **Full names** in the June file often end in the same name in another script
  ("Hakim Ziyechحكيم زياش"). The Latin part stands (1,359 names); a name with
  no Latin part of its own is not used.
- **Club names.** EA's website names some clubs its own way, among them the clubs
  it had no licence for: Inter is "Lombardia FC", Atalanta "Bergamo Calcio", Lazio
  "Latium", Paris Saint-Germain "Paris SG". Each club in the seven leagues takes the
  June name most of its launch players carry, more than half of them (Rennes is
  closest, at 15 of 25), so the club ids match the other seasons' and a winter
  transfer moves nobody. 44 clubs are renamed (`clubNames` in the audit). The build
  stops on a club the June file cannot name, and on two clubs that would share one
  name. A player of a club outside the seven leagues keeps EA's club name.
- **Spellings.** EA's website writes `Holland`, `Curaçao`, `St. Kitts and Nevis`
  and `St. Lucia`; the first is the Netherlands, the others have no team.
- **Roster.** Players link to SoFIFA's release roster of the edition, 250002
  (20 September 2024; SoFIFA's version menu, as archived on 24 September and 15
  October 2024, lists 250001 of 7 August, then 250002, 250003 of 26 September and
  so on), like FIFA 15 – EA FC 24's update 2. The season's date is the export's.
  EA's own website only ever shows the current edition, so its links would not.

Result: 75 nations field a full XI, 139 have players, and all 132 clubs of the
seven leagues are there, the strongest 124 and 32 on the season's two Europe maps.
Four of its Top 124 clubs had no ground in `scripts/data/europe-clubs.json` under
these names (UD Las Palmas, CD Leganés, Montpellier HSC, Holstein Kiel); each takes
the row its country map gives, as the same clubs' rows under other names already do.

### FIFA 07 to FIFA 14

No single export covers the editions before FIFA 15, so these eight seasons
join two scrapes of EA's rosters by EA's player id
(`scripts/lib/ea-legacy-seasons.mjs`, run by the same `npm run build:ea-seasons`
through the same `assembleEaSeason`):

- **Ratings** from a FIFA Index mirror on Kaggle
  (`daguizer/fifa-2021-to-2005-complete-player-attributes`, licence "other" as
  set by its compiler; FIFA Index's terms forbid scraping): EA's overall,
  positions, full name and date of birth, but no nationality or club.
- **Nationality and club** from a SoFIFA scrape on GitHub (`Big-Data-FC/datasets`
  at commit `c6da23f`, no licence stated): nationality, club, league, short name
  and the player's SoFIFA page. Its own rating (`bov`) is SoFIFA's best overall
  at any position, not EA's, and is never read.
- **Roster dates** from a list of SoFIFA's dates per roster (`dates.json`,
  pinned by SHA-256; it has no source link).

`scripts/data/ea-seasons.json` (`legacy`) pins every file by SHA-256 and names,
per edition, the roster each file holds and the evidence for it. A player
missing from either file is left out, and nothing is borrowed from another
edition. Clubs come from each edition's seven SoFIFA league names (the same
seven every year, such as `Portuguese Liga ZON SAGRES`): 132 clubs a season.
`Turks and Caicos Islands` joins `EA_NO_TEAM`.

- **Two rosters for FIFA 07 to FIFA 11.** The ratings file holds the August
  launch roster (`070001` …) and the clubs file the February winter update
  (`070002` …): the clubs file has players EA added in winter, and the six
  FIFA 08 players whose attributes changed in February keep their August values
  in the ratings file. These seasons carry `ratingsDate` (August) beside
  `snapshotDate` (February). Ratings barely moved in between: attributes agree
  for all but one of 10,149 FIFA 07 players and ten of 12,004 FIFA 08 players.
- **One roster for FIFA 12 to FIFA 14**: `120002` (February 2012), and each
  edition's last roster for FIFA 13 and 14, `130034` and `140052`. SoFIFA dates
  those September 2013 and 2014, but their squads are the season's: Bale is at
  Tottenham in 2012/13 and Vidić at Manchester United in 2013/14.
- **Positions.** FIFA Index's older codes map onto EA's current ones
  (`LEGACY_POSITIONS`: `SW` to `CB`, `LWM` / `RWM` to `LM` / `RM`, `LF` / `RF` to
  `CF`, and the side variants of central roles to the central role).
- **Invented names left out.** EA gave some players stand-in names (Mutu
  appears as "Teodor Petrovici" and "Andrei Murgu"). The manifest lists 33 such
  records of 10 people with the evidence for each: the same EA id under the real
  name in another edition, a second database naming the stand-in, or, for four
  FIFA 08–11 names, the same club, nationality and birth year as a proven FIFA 07
  stand-in. The build stops if a listed id or name is missing from its edition.
- **Damaged text stops the build**, except FIFA 12 player 168649, whose short name
  the scrape garbled: the build uses the ratings file's full name ("Aleksejs
  Višŋakovs", as spelt there) and records it in the audit.

A legacy season's `source` adds `clubsUrl` (the SoFIFA scrape) to `url` (the
ratings mirror), and `ratingsDate` where the two rosters differ. Full XIs run
from 49 (FIFA 09) to 69 (FIFA 12) of 173 nations.

### FIFA 05 and FIFA 06

SoFIFA starts with FIFA 07, so the scrape above has nothing for 2004/05 and
2005/06. The FIFA Index mirror does: EA's overall, positions, name and date of
birth. These two seasons are built from it
(`scripts/lib/ea-early-seasons.mjs`, run by the same `npm run build:ea-seasons`
through the same `assembleEaSeason`), and they differ from every other season in
two ways: they have no clubs, and a player's nationality comes from elsewhere.

- **Nations only.** Nothing here says which club anyone played for that season, so
  `clubs` is empty. `setHasClubs` knows these seasons by their ids, so the setup
  needs no file to tell. Choosing one takes Nations, and choosing Clubs goes back
  to the built-in season, as an NBA season does the other way round.
- **Nationality from the nearest later edition.** This is the one place a season
  takes a field from another edition, and FIFA 07 to FIFA 14 still take nothing.
  The same EA id in FIFA 07 or later gives the nationality. Nationality rarely
  changes: tried on FIFA 07, where the real one is known, it is wrong for 82 of
  8,872 players (0.92%), and for 2 of the 1,262 rated 75 or more.
- **The id must still name that person.** EA reused ids: FIFA 06's Anis Boussaidi,
  a Tunisian, has the id of FIFA 07's Ibrahim Said, an Egyptian. So the two records
  must have the same birth date, or names that agree word by word, an initial or a
  shortening counting as agreement ("C. Ronaldo", "Josh" for "Joshua"). A shared
  surname is not enough (`D. Brivio` and `Pierluigi Brivio`). 8 FIFA 06 and
  27 FIFA 05 rows fail this and are treated as having no later edition.
- **Wikidata for the rest.** Players who had retired by FIFA 07, among them Zidane,
  Bergkamp and Shearer, have no later edition. `npm run sync:early-nationalities`
  asks Wikidata (CC0), and `scripts/data/ea-early-nationalities.json` commits the
  answers (2,520 players), pinned by SHA-256 like every other input, so the seasons
  build offline. A player is matched to a footballer born the same day whose name
  agrees. 1 January is left out of that: it is usually a placeholder in the files,
  and it is where Wikidata keeps a date known only to the year. A player rated 70
  or more who is still unmatched, and whose name has at least two words, is looked
  up by name, and needs exactly one footballer of that name aged 17 to 42 that
  season. The nationality is the senior national team (P54), else the country for
  sport (P1532) where citizenship backs it, else a youth or B national team, else
  citizenship (P27). Country for sport comes after the team because it can be
  wrong: Wikidata has Demis Nikolaidis, a Greece international, and Robson Ponte, a
  Brazilian, as Germany's. The answer must settle on one nation, so a citizen of the
  United Kingdom with no team stays unmatched, and so does anyone with two countries
  and nothing to choose between them. An entry names the spelling it was matched to,
  so it never reaches another person under the same id in the other edition. Tried
  on 447 FIFA 06 players whose FIFA 07 nationality is known, this agrees for 427
  (95.5%). Most of the others are young players who chose another federation after
  2006 (Assou-Ekotto, Folly, Ndjeng), which a player retired by then cannot do.
- **Checked by hand.** Seven real players these rules cannot settle (`early.checked`
  in the manifest, each with its reason), such as Pochettino, whose birth date is a
  day off under a one-word name, and Naybet, whose name the files misspell. The sync
  writes them as `evidence: "checked"`. A real player can still be left out when
  nothing settles them: Arie van Lent has two citizenships and no national team.
- **Left out.** A player with neither is left out, 745 of FIFA 06's 10,151 and
  1,290 of FIFA 05's 10,970. EA's stand-ins are among them: FIFA 06 renames
  Mutu "Petrovici Teodor" and Materazzi "Valerio Bernado" (see the FIFA 07
  exclusions in the manifest), and those names match nothing. Their real players are
  in FIFA 05 under their own names.
- **Birth dates.** Both files have many wrong ones, for the English leagues
  especially (Teddy Sheringham, born in 1966, is born in 1984). Where a later
  edition or a name-only Wikidata match has another date for the same person, that
  one stands (`datesCorrected` in the audit: 242 and 385).
- **Federations of that year.** A nationality from a later edition can be one that
  had no federation yet. Montenegro's players count for Serbia, which held its
  shape until 2006, and so for any nation `territoryFor` merges. Where no nation
  held the shape (Kosovo) they have no team, and with no club are left out.
- **One roster each.** FIFA Index lists one roster per edition, and SoFIFA has
  none so old. The roster id follows SoFIFA's pattern (`060001`), so saves and the
  loader treat these seasons like any other, and `snapshotDate` is the game's
  release in Europe (2005-09-30, 2004-10-08).
- **Links.** A player links to their page for that edition on FIFA Index
  (`https://fifaindex.com/players/1397-zinedine-zidane/fifa06`), where a later
  edition's player links to SoFIFA. FIFA Index's terms forbid scraping, and nothing
  here reads the site.
- **Names** are the mirror's full name, the only one it has, so a season can read
  "Manuel Cesar Rui Costa" beside "Ronaldinho".

The file's rows hold one field more than its header names, after every column
read (`readRatingsRows`' `extraFields`). A season's `source` adds `nationalities`, a
line naming where they come from. The audit counts each source of nationality,
lists the reused ids and names the best players left out. Full XIs: 54 in each of
FIFA 06 and FIFA 05 of 173, against 49–52 for FIFA 07–09; 119 and 116 nations have
at least one player. FIFA 06 takes 8,131 nationalities from later editions and
1,275 from Wikidata, FIFA 05 7,569 and 2,111. Each file is about 75 KB.

## Seasons before FIFA 05

Eleven more seasons ship with the game, from 2002/03 back to 1989/90, one source
each. `npm run build:retro-seasons` (`scripts/build-retro-seasons.mjs`, manifest
`scripts/data/retro-seasons.json`, audit `docs/design/football-retro-seasons-audit.json`)
reads every source from the gitignored `data-src/`, pinned by SHA-256 and by the
commit it was downloaded from (SWOS's files, from a server without commits, by
SHA-256 alone; the two read from CDs, by the CD image they were read from), and
`--check` rebuilds the eleven files, the listing
`src/data/footballSeasons.js` (which `npm run build:ea-seasons` writes alike) and
the audit byte for byte. None of these sources grants redistribution. The user
chose to ship 2002/03, 2001/02, 1998/99, 1997/98 and 1996/97 on 2026-11-08, and
the two fan-made databases on 2026-11-09; Claude added 2000/01, 1999/00, 1995/96
and 1994/95 on 2026-11-09, under the user's request to cover every missing
season, and the user has not confirmed them: shipping CM 00/01's and CM 99/00's
data, from games never made free, is open for the user. All eleven are credited
to their makers: each season's source block names
its maker (`provider`), who compiled or ported it (`compiler`), where it comes from
(`url`) and when it was read (`retrieved`; a season read later than the others
names its own day in the manifest). The manifest's `reader` names the builder
where a kind is read from two kinds of source (SWOS: a database, or the game's
team files; CM: a zip, or a CD's tables).

| Season | Id | Source | Nations with players (full XIs) | Clubs |
| --- | --- | --- | --- | --- |
| 2002/03 | `cm0102-2002-11` | SI's CM 01/02 3.9.68 | 162 (108) | 129 |
| 2001/02 | `cm0102-2001-09` | SI's CM 01/02 3.9.60 | 143 (96) | 130 |
| 2000/01 | `cm-0001` | SI's CM 00/01 3.81, from its UK retail CD | 134 (82) | 130 |
| 1999/00 | `cm-9900` | SI's CM 99/00 3.70, from its UK retail CD | 123 (74) | 130 |
| 1998/99 | `cm0102-2020-11-cm3` | SI's CM3 data, ported to CM 01/02 | 113 (64) | 130 |
| 1997/98 | `cm-9798` | SI's CM 97/98, extracted to JSON | 102 (52) | 124 |
| 1996/97 | `swos-9697` | Sensible World of Soccer 96/97's national squads | 133 (133) | nations only |
| 1995/96 | `swos-9596` | Sensible World of Soccer 95/96's team files | 132 (132) | 134 |
| 1994/95 | `swos-9495` | Sensible World of Soccer's team files (the original, v1.0) | 131 (131) | 134 |
| 1993/94 | `cm0102-2020-11-cm93` | Cam F's fan-made 93/94 for CM 01/02 | 124 (77) | 130 |
| 1989/90 | `cm0102-2017-04-cm89` | Simon Treanor's fan-made 89/90 for CM 01/02 | 137 (88) | nations only |

The nine seasons with clubs play on their own Europe maps (`eu124s2003`,
`eu32s2003` … `eu124s1994`, `eu32s1994`), built by `npm run build:europe-maps`
like the EA seasons'. Of 1995/96's, 1994/95's and 1993/94's (built 2026-11-09),
21 club names needed a ground row: 11 take a country map's row (Albacete, Foggia,
Padova, Reggiana, Dynamo Dresden under two names, Uerdingen under two, Tirsense,
Felgueiras, and 1993/94's VfB Leipzig at its successor Lokomotive's
Bruno-Plache-Stadion), 5 repeat the row of another name of the club (Caen,
Farense, Gil Vicente, Cambuur, VVV), and 5 are placed by hand from their grounds'
Wikidata coordinates (P625): Martigues (Stade Francis-Turcan, Q118955), Gueugnon
(Stade Jean-Laville, Q1569474), Wattenscheid (Lohrheidestadion, Q880075), and
Logroñés at Las Gaunas (Q1369314, the stadium of 2002, built beside the old one)
under both its names. The
earlier seasons' clubs' grounds are 114 new rows of
`scripts/data/europe-clubs.json`: a club the table already placed under another
name takes that row (`Real Madrid C.F.`, `F.C. Barcelona`; for 2000/01 and
1999/00 `C.D. Numancia`, `As.Troyes Aube Champagne`, `Sporting Clube Farense`
and `Futebol Clube Paços de Ferreira`), 17 take a country map's row (2000/01 and
1999/00 add Bradford City at Valley Parade, SpVgg Unterhaching and SSV Ulm 1846),
and 11 are placed by hand from their grounds' Wikidata or Wikipedia
coordinates (Varzim, Salgueiros, Leça, Mérida, Extremadura, Compostela,
Salamanca, RBC Roosendaal, and Wimbledon at Selhurst Park, which it shared with
Crystal Palace from 1991 to 2003). `--boundaries=<dir>` reads another worktree's
boundary cache.

### SI's CM 01/02 databases: 2002/03 and 2001/02

- **Source**: SI's own 3.9.68 and 3.9.60 database files, as nckstwrt's CM0102
  Starter Kit ships them (`data/patched_data.zip` and `data/original_data.zip`,
  commit `e658af1`, 9 June 2021). Their `club.dat` and `staff.dat` are byte for
  byte SI's untouched files, whose sizes and SHA-256 `cm0102Releases.js` lists.
- **Built** by the CM 01/02 builder as known releases, exactly as a local
  database is (above): `round(ca * 99 / 200)`, natural positions, the seven
  leagues' top divisions with eleven rated players. They are `local: false`, and
  the builder adds `compiler` and `retrieved` to their source. `.gitignore`
  keeps every other `public/football/cm0102-*` local, and
  `npm run build:football-set` neither writes nor lists a built-in id.
- Both rate players of the Pacific: 3.9.68 two of Tonga, five of Samoa and nine
  of the Cook Islands, 3.9.60 one of the Cook Islands, so those three nations are
  listed and field what the database rates.
- **Rights**: Eidos made CM 01/02 free to download in December 2008, for
  personal, non-commercial use; the data's rights are reserved.

### SI's CM 00/01 and CM 99/00, read from their CDs: 2000/01 and 1999/00

- **Source**: SI's own databases of Championship Manager: Season 00/01
  (original release 3.81; the UK CD was mastered on 6 October 2000 and the game
  released on 27 October) and Season 99/00 (original release 3.70; CD mastered on
  16 November 1999, released on 3 December 1999), from users' uploads of the
  retail CDs to archive.org: [cm-0001-rel](https://archive.org/details/cm-0001-rel)
  (`CM0001_rel.iso`, 702,269,440 bytes, 2048-byte sectors) and
  [championship-manager-season-9900](https://archive.org/details/championship-manager-season-9900)
  (`CM9900_REL.bin`, 806,512,560 bytes, raw MODE1/2352 sectors). Neither game was
  made free, unlike CM 01/02. On 2026-11-09 Claude decided to ship both, under
  the user's request to cover every missing season, credited to SI with the
  archive.org item as the source link, as for the CM3 port and CM 97/98. The user
  has not confirmed it: whether data from these never-free CDs ships is open for
  the user.
- **The same tables**: both CDs' untouched Data files are CM 01/02's tables, with
  SI's format-1 staff (157-byte people) as in 3.9.60 and 3.9.68, so the CM 01/02
  reader and builder read them unchanged, as known releases of
  `cm0102Releases.js`: ids `cm-0001` and `cm-9900`, editions `CM 00/01` and
  `CM 99/00`, labels `3.81` and `3.70`. A `cm-<season>` id is kind `cm`, as CM
  97/98's is, and the builder writes `kind: 'cm'` into such a set (the retro
  build passes the manifest's kind, which must agree).
- **Read from the CDs, data only**: `npm run sync:retro-cds`
  (`scripts/sync-retro-cds.mjs`) fetches each season's eleven tables into
  `data-src/cm0001-cd/` and `data-src/cm9900-cd/`. A CD installs its data from an
  InstallShield 5 cabinet (`DATA1.CAB` and its header `DATA1.HDR`). The sync reads,
  by HTTP range requests at least a second apart, only the volume descriptors and
  the root directory (`scripts/lib/cd-image.mjs`), the header whole, and the
  compressed bytes of the eleven tables (`scripts/lib/installshield5.mjs`): 15
  requests and 4.9 MB for CM 00/01, 3.8 MB for CM 99/00. It checks the image's
  size (the `Content-Range` total), its sector layout, volume name and creation
  time, where the header and cabinet start, the header's SHA-256, each inflated
  table's MD5 against the header, and each table's size and SHA-256 against the
  manifest before writing it. No executable and no whole image is downloaded, and
  nothing is run. `--image=<file>` reads a local copy of the same CD instead.
  archive.org's robots.txt (read 2026-11-09) disallows only `/control/` and
  `/report/`.
- **Second copies**: the Dutch CM 99/00 CD (archive.org `cm-9900-nl`) has a
  byte-identical cabinet header, so the same MD5 for every data file. CM 00/01
  exists in two SI pressings: the UK one of 6 October 2000, read here, and a later
  European one (archive.org `cm-0001`), which agrees on 96.3% of current abilities
  (39,382 players matched by name and date of birth) and rates 1,866 more players,
  with a few later transfers (Weah at Marseille rather than Manchester City).
  Claude chose the UK release-day database, as the EA seasons take the launch roster.
- **One scale** with the seasons around them, so the conversion is CM 01/02's,
  `round(ca * 99 / 200)`, with no offset (unlike CM 97/98's). For players matched
  by name and real date of birth:

  | From | To | Matched | Same CA | Mean change | Correlation |
  | --- | --- | --- | --- | --- | --- |
  | CM3 port (1998/99) | CM 99/00 | 15,637 | 70.5% | +2.0 | 0.947 |
  | CM 99/00 | CM 00/01 | 22,544 | 61.8% | +2.6 | 0.931 |
  | CM 00/01 | SI 3.9.60 (2001/02) | 35,810 | 50.3% | +0.7 | 0.924 |

- **Dates of birth** are stored as real: the famous-player check finds 7 of 7
  agreeing on a shift of 0 in both. CM 99/00 has 46,460 players, 28,020 rated;
  CM 00/01 71,641, 48,617 rated, and four with a current ability below 0, unrated
  and left out.
- **Its own names**: CM 99/00 names the Eredivisie after its sponsor of the season,
  `Dutch KPN-Telecompetition` (one more stored name in the builder's `LEAGUES`),
  and spells Burkina Faso `Burkino Faso` (an alias in `cm0102Nations.js`). Its
  `Zaire` placeholder (two players) fields no team, as in SI's later databases.
- **Clubs**: the seven leagues whole, 130 clubs in each season (Premier League
  and La Liga 20, the others 18). CM 00/01 rates one player of the Cook Islands,
  so Tonga, Samoa and the Cook Islands are listed (176 nations); CM 99/00 rates
  none of theirs (173).
- **Checked against history**: 1999/00's strongest clubs are Juventus (86), Lazio
  and Parma (85), Internazionale (84), Barcelona and Bayern (83); Monaco lead
  Ligue 1; Vieri is at Inter, Anelka at Real Madrid, Shevchenko at Milan;
  Sunderland, Bradford City and Watford are up in the Premier League, Bielefeld,
  Unterhaching and Ulm in the Bundesliga, Saint-Étienne, Troyes and Sedan in
  Ligue 1. Its strongest nations are Italy (89), France (88), Brazil (87) and
  Argentina (85). 2000/01's strongest clubs are Lazio (87), Roma and Juventus
  (86), Internazionale (85), Milan and Manchester United (84); Figo is at Real
  Madrid, Crespo at Lazio, Batistuta at Roma and Anelka back at Paris
  Saint-Germain; Charlton, Manchester City and Ipswich are up, so are Köln,
  Bochum and Cottbus, and Lille, Guingamp and Toulouse.
- **Territory**: in 1999/00 Kosovo is under the United Nations and Bhutan not yet
  a FIFA member (both neutral), and FR Yugoslavia holds Montenegro. Bhutan is a
  member from 2000/01, but CM 00/01 rates none of its players, so it fields no
  team and its land stays neutral then too.
- **Rights**: both games are SI's and Eidos's (now SEGA's and Square Enix's). The
  archive.org items are users' uploads of the retail CDs (the 99/00 item's Public
  Domain Mark and the 00/01 item's "open source software" collection do not apply
  to the games), and the data's rights are reserved.

### SI's CM3 data, ported: 1998/99

- **Source**: Championship Manager 3's data (SI; the game was released on 26
  March 1999), in the CM 01/02 format: Cam F's "Season 98/99 for 0102 (CM3)"
  ([forum topic](https://www.champman0102.co.uk/viewtopic.php?t=1547), 28 November
  2020; Gio made the conversion about 2011), as the CM0102 Starter Kit ships it
  (`data/cm3_data.zip`). Not Cam F's later rework of it to September 1998. A
  release entry in `cm0102Releases.js` identifies it by its signature:
  `cm0102-2020-11-cm3`, after the forum release's month with the variant `cm3`,
  edition `CM3`, snapshot `1999-03`.
- **Birth years** are stored three years late, so that the game starts in 2001:
  the release's `shifts.birth` is −3, and the famous-player check agrees (6 of 6).
  Its joined and contract shifts were not measured; the builder does not read them.
- **Trailing bytes**: its `staff.dat` carries 230 bytes after its last table (22
  bytes of 0xFF, then four repeated preferences records), which stop the strict
  reader. The signature records them (`staffTrailing: 230`), and the builder cuts
  exactly those bytes, only from the file whose SHA-256 the release names, before
  reading.
- 10,535 players have no current ability (0 or below): unrated, they are left
  out, as in every CM database.
- **Cross-check** (not shipped): Winning Eleven 4 / ISS Pro Evolution rates 53
  national squads of 22 in spring 1999 (two transcriptions agree). Of CM3's 547
  national XI players of those nations, 293 (54%) are in them by surname: England
  and Ireland 10 of 11, Netherlands, France, Croatia, Wales, Norway and Northern
  Ireland 9; lower where WE4 shortens or invents names (Hungary and South Korea 1).
- **Rights**: CM3 is SI's and Eidos's; the port names no licence.

### SI's CM 97/98: 1997/98

- **Source**: Championship Manager 97/98 (SI; released 31 October 1997) as
  baskeyx extracted its database to JSON: [baskeyx/cm9798](https://github.com/baskeyx/cm9798),
  commit `06bdd2b` (5 October 2026), `src/players.json` (19,359 players) and
  `src/teams.json` (2,085 teams). The package's code is MIT; the data is not, and
  its rights stay with SI and Eidos.
- **Provenance limits**, also in the source block's `provenance`: the extraction
  names neither the tool that read the game's files nor the game's version (2.81
  or 2.93); it holds Scandinavian, Japanese, Turkish and MLS divisions the UK
  release did not play, so it may come from another release or an edited
  database; and no second copy of its values exists. Known transfers date it:
  the summer's and September 1997's are in (Overmars at Arsenal, Ravanelli at
  Marseille, Yeboah at Hamburg), Karembeu's to Real Madrid (September) is not,
  and none after (Klinsmann is still at Sampdoria, Davids at Milan, Asprilla at
  Newcastle, Gascoigne at Rangers). No sign of a later edit or an invented name
  was found.
- **Kind `cm`** (`cm-<season>`): an SI database before CM 01/02, its players CM
  01/02's tuples and source block (`KINDS.cm`, `SET_PACKS.cm`).
- **Ids**: 627 of the extraction's ids are shared by unrelated players, so a
  player's id is his place in `players.json` (1 for its first record; the file is
  ordered by ability), stable while the file is the pinned one.
- **Ratings**: ability is current ability on 1–200, converted as a CM 01/02
  database's is, `round(ca * 99 / 200)`. 5,170 players with ability 0 are unrated
  and left out. Potential and the attributes are not read, so the 635 null
  potentials and the 10 records with a null attribute change nothing (the audit
  counts them).
- **A higher scale**: for the same players, CM 97/98's abilities run about 9
  points above the next season's (110.9 against 101.4 in the CM3 port for 7,435
  players matched by name and nation, correlation 0.69, 27% identical; 9.5 above
  SI's 3.9.60), so 1997/98's ratings sit about 4.7 higher across the board. The
  rule stays CM 01/02's: a uniform offset changes no gap within the season, and
  the match model plays rating gaps (attack against defence), so 1997/98 plays
  like the other CM seasons (below). The source block's `provenance` says so.
- **Positions**: 0 (no), 1 (can play there) or 2 (natural) for goalkeeper,
  sweeper, defence, anchor, midfield, support and attack, and for the right, left
  and central sides. They become CM 01/02 ratings (2 → 20, 1 → 10) that
  `cmNaturalPositions` reads: natural where position and side are both 2; a 1 is
  below CM 01/02's accomplished 15. CM 97/98 has no wing-back. Five values
  outside 0–2 (Des Hamilton's central 3, Anthony Barness's right 11 and three
  more) are read as 0 and listed in the audit.
- **Names** are the first and second name as stored. Spanish and Brazilian
  players known by one name have it as the second ("González Blanco Raúl").
- **No dates of birth**: the extraction has none, as FIFA 05 and 06.
- **Nationalities**: CM 01/02's names plus CM 97/98's own spellings
  (`CM9798_NATIONS`). Its "Republic of Congo" is the former Zaire, DR Congo today
  (Roger Lukaku, Nzelo Lembi and Jean-Claude Mukanya are its players); its
  "Congo" and "The Congo" are Congo-Brazzaville.
- **Clubs**: the seven leagues' top divisions (EPR, SP1, ISA, GD1, FD1, HD1,
  PD1), each club needing eleven rated players: 124, exactly the Top 124
  (Premier League 20, La Liga 20, Serie A 18, Bundesliga 18, Ligue 1 18,
  Eredivisie 17, Liga Portugal 13). A player whose club text is neither of a
  team's two names in the extraction resolves through three aliases
  (`Newcastle U`, `Sheff W`, `Schalke`), the game's other names for those
  teams, which the extraction dropped; any other keeps the text as his club.
  Retired players play for nobody; free agents and the "Minor Team", "Non League"
  and "Schoolboy" records for no club.

### Sensible World of Soccer 96/97: 1996/97, nations only

- **Source**: Sensible Software's SWOS 96/97 (1996; published by Renegade and GT
  Interactive, now Codemasters'), its national teams' records as Whiteulver's
  database holds them, in xflea's spreadsheet v1.1 (December 2018), as
  keyser1884's [SWOS-MCP](https://github.com/keyser1884/SWOS-MCP) holds it
  (`swos_database.db`, commit `ac15d74`, 9 July 2025; MIT code, the game's data
  not). Its Swedish club records equal the game's own team file (304 of 304
  players), and its national squads gazchap's database (64 of 64 checked). A SWOS
  United thread (2021) says some minor nations' squads and nationalities in the
  game predate 1996.
- **Nations only**, as FIFA 05 and 06: at club level 688 full names appear at two
  clubs (Bierhoff at both Ascoli and Udinese), so the clubs are not one moment's.
  Each nation plays its own national team record of sixteen, and its best XI by
  SWOS's positions; a player's club records are not read.
- **Kind `swos`** (`swos-<season>`, `nationsOnly`). A tuple is
  `[swosId, name, 0, value, position, nationality, '', '', skills]`
  (`src/data/swosPlayers.js`): a CM tuple's layout, whose full name, club and
  date of birth SWOS's national records do not have, plus the seven skill digits.
  `swosId` is the database's row id; `nationality` its national team's name.
- **Rating**: SWOS rates no player overall. Each has a price, one of 50 value
  steps (1 = 25K … 48 = 15M; 49 = 16M is unused). An outfield player's step is
  the sum of his seven skills, 0–7 each (passing, velocity, heading, tackling,
  control, speed, finishing), from 1 to 48; a goalkeeper has no skills, and his
  price is his only rating (the spreadsheet's GK figure is his step, 0 for the
  cheapest). So the step is SWOS's one rating for everyone, and the game lays the
  50 steps evenly from 40, the strength it gives an empty shirt, to 99:
  `round(40 + value * 59 / 49)` (25K → 41, 700K → 57, 2.25M → 83, 9M → 94,
  15M → 98). Each skill point counts the same, as in SWOS's own prices, and no
  rated player is weaker than a shirt nobody rates. The step, price and skills
  stay in each player's source record.
- **Positions**: SWOS gives one, mapped G → GK; RB, LB, D → DF; RW, LW, M → MF;
  A → FW. SWOS's 4-4-2 has its wingers in midfield (a CM or EA winger is a
  forward). Every one of the 133 national teams on the map fields a natural
  4-4-2.
- **Names** are in capitals in SWOS. They are set in the case of the player's
  country: each word capitalised, also after a hyphen or full stop
  ("Omam-Biyik", "S.M. Aslam"); "Mc" names as McManaman; surname particles in
  lower case in Dutch ("van der Sar"), Spanish ("del Solar") and Portuguese
  names, and German "von", but capitalised in Italy ("Di Matteo"), in Belgium
  ("De Bilde", the first of several: "Van der Elst") and elsewhere. Only the case
  changes, so the name in capitals is SWOS's own; the audit lists the eight names
  the particle rule sets.
- Ten SWOS teams have no shape on the map (Malta, San Marino, the Faroe Islands,
  Liechtenstein, Bahrain, Bermuda, Hong Kong, Mauritius, Singapore, St. Vincent)
  and field no team; the 43 game nations SWOS has no team for (Bosnia,
  Kazakhstan, DR Congo and others) play with an empty squad, at 40.

### Sensible World of Soccer 94/95 and 95/96: nations and clubs

Decided 2026-11-09 by Claude, under the user's request to cover every missing
season, and not yet confirmed by the user: both seasons ship, with their nations
and their clubs on four Europe maps; 1995/96 is SWOS 95/96's launch edition, not
its European Championship Edition; SWOS 96/97 stays as it is, nations only.

- **Source**: Sensible Software's Sensible World of Soccer, the original game
  (`swos-9495`, v1.0, whose READ.ME is Sensible Software's note of Christmas 1994;
  labelled SWOS 94/95 after its season) and SWOS 95/96 (`swos-9596`, the launch
  edition; its European Championship Edition of spring 1996 differs in 585 of
  2,272 national players). Each is the game's own team files, as the SWOS United
  community server keeps them for its tools (`cern.swos.eu/data/amiga/v1.0/` and
  `/9596/`; no robots.txt, no licence or terms stated): the six national team
  files (TEAM.080 to 085) and the seven league files (TEAM.008 England, 013
  France, 014 Germany, 020 Italy, 025 Holland, 029 Portugal, 035 Spain), 26 files
  fetched one at a time late on 2026-11-09 (UTC; the season's `retrieved`), pinned
  by bytes and SHA-256, and equal to the research pass's copies of the same day.
  The v1.1 update of early 1995 has
  v1.0's national teams and later club squads. **Rights**: Sensible Software's,
  now Codemasters'; the data's rights are reserved.
- **Reader** (`scripts/lib/swos-files.mjs`, the layout codemeyer's SwosPlayerFinder,
  MIT, reads): two header bytes (0, then the number of teams), then 684 bytes a
  team: 76 header bytes (the file's number, the team's place in it, its name in
  bytes 5–23, its division in byte 25, 0 for the top one) and sixteen players of
  38 bytes (nationality, shirt number, name, the position in the top three bits
  of byte 26, the seven skills three bits each in bytes 28–31, the price step in
  byte 32). It stops on any byte the layout does not explain. A player's id is
  the file's number, the team's place and his slot (`swosFileId`: 80,001 is the
  first player of TEAM.008's first team).
- **Read as 96/97 is**: SWOS 96/97's own files, read the same way, agree with the
  shipped 96/97 database for 1,441 of its 1,463 national players; the other 22 are
  that database's price step 0 stored as 25K, Maldini's and Shearer's step 49
  stored as 15M, and namesakes. So steps are read as that database stores them, 0
  as 1 and 49 as 48: 63 players in 1994/95 (Roberto Baggio and Romário at 49,
  national and club records alike) and 51 in 1995/96, each listed in the audit
  (`clamped`). The rating, positions and names are 96/97's (above), the names now
  also set after an apostrophe that follows a word's first letter or an Italian
  "Dall'" or "Dell'" ("N'Doram", "L'Ami", "Dall'Oglio"; "Preud'homme" keeps his
  small h).
- **Nations**: 141 national teams in 1994/95 and 142 in 1995/96 (Yugoslavia's
  returns), the same ten with no shape on the map leaving 131 and 132, every one a
  natural 4-4-2. The federations of the day as far as SWOS fields them
  (`territoryFor` and `identitiesFor` with `fields`, the nations SWOS has a squad
  for): 1994/95 has no Yugoslavia squad (FR Yugoslavia was barred until December
  1994), so Serbia, Montenegro and Kosovo are all neutral; in 1995/96 FR
  Yugoslavia plays under its own name and flag, holding Montenegro and Kosovo.
  SWOS has no Zaire squad, and Bosnia joined FIFA on 3 July 1996: both neutral.
- **Clubs**: each league file's top division (division 0), 134 clubs a season,
  the leagues' real top divisions: 1994/95 Premier League 22, La Liga 20, Serie A
  18, Bundesliga 18, Ligue 1 20, Eredivisie 18, Liga Portugal 18; 1995/96 20, 22,
  18, 18, 20, 18, 18. Each plays its own sixteen, its best natural XI by SWOS's
  positions, its strength their mean. SWOS files 18 names (1994/95) and 20
  (1995/96) at two top-division clubs, mostly namesakes (João Pinto at Benfica and
  Porto) and a few a record left at an old club (Martin Kree at Leverkusen and
  Dortmund in 1994/95); 1995/96 lists Jean-Luc Dogon twice at Bordeaux, with
  different skills. Each club keeps its own sixteen, so both play; the audit lists
  them (`collisions`). A club player's nationality is SWOS's three-letter code for
  his nationality byte (`SWOS_NATIONALITIES`: the code SWOS 96/97's database
  records for the 7,650 players of 96/97's own team files matched by team and
  name, two of them disagreeing; Chad and Iran, which no 96/97 player carries,
  as SwosPlayerFinder names them); a national squad's is its team's name, as in
  96/97.
- **Club names and ids** (`SWOS_CLUBS`): SWOS writes 17 capitals (`MANCHESTER UTD`,
  `BOR. DORTMUND`, `DEP. LA CORUNA`). Each club takes the name of a club the
  ground table already places, its id that name's slug (`presentClubs`), so it
  keeps its id, colour and crest from season to season: where several rows are one
  club, the one whose crest the game shows, unless that row has a name the club
  took later (RC Strasbourg Alsace, Estrela da Amadora's refounded club); else CM
  97/98's name for it, else the CM3 port's, else CM 01/02's or EA's. Thirteen
  clubs no season had take new names: Albacete Balompié, CD Logroñés, Foggia,
  Padova, Reggiana, Dynamo Dresden, Bayer 05 Uerdingen and, renamed in 1995, KFC
  Uerdingen 05, FC Martigues, FC Gueugnon, FC Tirsense, FC Felgueiras and Sporting
  Clube Campomaiorense (which needs no ground row: it is never among a season's
  strongest 124).
- **Kind `swos`**: `nationsOnly` names `swos-9697` alone, and the manifest's
  `reader: 'swos-files'` builds these two (`scripts/build-retro-seasons.mjs`).
- **Spot check against history** (2026-11-09): 1994/95 has Klinsmann at Tottenham,
  Cantona at Manchester United, Romário at Barcelona, Baggio at Juventus, Weah at
  Paris Saint-Germain and Gullit at Sampdoria; 1995/96 Klinsmann at Bayern, Baggio
  at Milan, Gullit at Chelsea and Bergkamp at Arsenal. The strongest clubs are
  Milan (87), Barcelona (87), Parma, Juventus, Lazio, Manchester United and Real
  Madrid (83) in 1994/95, and Milan (86), Barcelona, Liverpool (85) and Real Madrid
  in 1995/96; that season's champions rank lower, SWOS pricing their players
  below Italy's and Spain's stars: Blackburn 78 (fifteenth) and Ajax 77
  (seventeenth) in 1994/95. Italy (87) and Brazil (87, then 86) are the strongest
  nations, Germany and the Netherlands next.

### The fan-made databases: 1993/94 and 1989/90

Decided 2026-11-09 by the user ("Yes, ship both"): the CM0102 Starter Kit's two
fan-made retro databases ship, credited to their makers, their labels saying they
are fan-made and their source blocks (`provenance`) that the ratings are the
makers', fans', not Sports Interactive's. Both are CM 01/02-format databases,
nckstwrt's Starter Kit's `data/cm93_data.zip` and `data/cm89_data.zip` (commit
`e658af1`, pinned by SHA-256), each read by the CM 01/02 builder as a known
release (`cm0102Releases.js`, by its files' sizes and SHA-256): CM 01/02's
conversion, `round(ca * 99 / 200)`, natural positions, edition `CM 01/02`, the
maker as `provider`. Their birth years are stored as they were (the Starter Kit's
loader starts the game in 1993 or 1989): shift 0. **Rights**: fan-made databases
for Eidos's freeware CM 01/02 (free since December 2008 for personal,
non-commercial use) that name no licence; the data's rights are reserved.

- **1993/94** (`cm0102-2020-11-cm93`, "CM 01/02 · 93/94 by Cam F, fan-made"): Cam
  F's "Season 93/94 For 0102" ([forum topic](https://www.champman0102.co.uk/viewtopic.php?t=1546),
  28 November 2020). Its abilities are Cam F's: against SI's own CM 93/94 data
  for 1,452 English-league players matched by name (ben-clarke's
  championship-manager-93-tools export) they correlate 0.72, 74 are equal, and
  Cam F's run 19 lower on average. One rating is wild: Olympiakos's defender
  Vassilis Ioannidis has the database's highest ability, 200 (rated 99, above
  Roberto Baggio's 198), so he leads Greece's XI; it ships as Cam F set it. 124
  nations with players (77 full XIs) and 130 clubs (Premier League 20, La Liga 20,
  Serie A 18, Bundesliga 18, Ligue 1 18, Eredivisie 18, Liga Portugal 18), on
  `eu124s1994` and `eu32s1994`. It keeps CM 01/02's league sizes, not 1993/94's,
  and the builder takes a database's own top divisions: its Premier Division has
  20 clubs (Oldham Athletic and Swindon Town, of the real 22, are in its First
  Division) and its French First Division 18 (Angers and Martigues are in its
  Second; 1993–94 FA Premier League and French Division 1 on Wikipedia, revisions
  1371793527 and 1366136574). The famous-player
  check agrees at +0 (5 of 6). Federations: Zaire alone plays under a name of its
  day; FR Yugoslavia is barred (Montenegro and Kosovo neutral with it), the Czech
  Republic and Slovakia play apart, and North Macedonia (16 June 1994) and the
  seven joiners of 1994 play.
- **1989/90** (`cm0102-2017-04-cm89`, "CM 01/02 · 89/90 by Simon Treanor,
  fan-made"): Simon Treanor's "Championship Manager 1989/90 update for CM 01/02",
  Beta 5 of 8 April 2017 (its readme; [cm8990.wordpress.com](https://cm8990.wordpress.com/)).
  Its readme calls it a beta in which many teams keep squads of the early 2000s,
  and names the English, Scottish, German and Italian leagues complete. Its birth
  years are 1989/90's: ten players of the day (Maradona, Baresi, Lineker,
  Matthäus, Gullit, van Basten, Klinsmann, Romário, Roberto Baggio, Maldini; the
  manifest's `birthdays`) agree at +0, where the builder's own famous players find
  only Ryan Giggs.
  - **Nationalities are today's** (Ukraine, Croatia, Slovakia; East Germans as
    'Germany'), so the season plays 1989/90's federations (`territoryFor` and
    `identitiesFor` of 1990, the builder's `federationTeamOf`): the Soviet Union
    fields 1,806 players of the other fourteen republics, Yugoslavia 1,182 (Croats,
    Slovenes, Macedonians and Bosnians), Czechoslovakia 191 Slovaks, and West
    Germany and Zaire play under their own names.
  - **East Germans**: a 'Germany' player at an East German club is East German, of
    a federation with no shape on the map, and plays for no nation (the manifest's
    `noNationAt`; `buildFootballSet` keeps him for his club): 1,431 players. A
    club is East German when its stadium's city, by the database's own stadium and
    city records, is one GeoNames' `cities1000` (CC BY 4.0; a copy of 18 October
    2026 pinned by SHA-256) places only in the five eastern states, or
    `scripts/lib/east-german-clubs.mjs` lists it by hand: East Berlin's Dynamo,
    Union, KWO, Rotation and Bergmann-Borsig, and Halle, Mühlhausen, Neustadt
    (Dosse) and Markkleeberg, which the gazetteer names twice or not at all. That
    is 67 clubs, committed in the manifest; a test rebuilds the list from its
    sources when they are in `data-src/`. A club neither places in the east counts
    as West German. So Sammer (Dynamo Dresden), Thom (Dynamo Berlin) and Kirsten
    play for no nation, and West Germany's XI is Matthäus, Klinsmann, Brehme and
    the rest of the Bundesliga's and Serie A's West Germans.
  - **Nations only** (`SET_KINDS.cm0102.nationsOnly`; the builder's `clubs:
    false`, its leagues kept in the audit). The rule set on 2026-11-09: clubs only
    if every one of the seven leagues' top divisions could be 1989/90's from the
    database's own players and clubs. Spain's and Portugal's cannot: their first
    divisions in it are 1989/90's (1989–90 La Liga and Primeira Divisão on
    Wikipedia, revisions 1337764526 and 1374234667), but Logroñés (7 rated
    players), Castellón and Tenerife (10 each) and eight of Portugal's eighteen
    (Chaves, Feirense, Marítimo, Nacional, Penafiel, Portimonense, Tirsense, União
    da Madeira) cannot field eleven. (Its German First Division also holds Dynamo
    Berlin, Chemnitz, Dynamo Dresden and Hansa Rostock where 1989–90's Bundesliga
    had St. Pauli, Bochum, Waldhof Mannheim and Homburg, revision 1363459514; those
    four it rates fully.) 137 nations have players, 88 full XIs.
  - **Spot check** (2026-11-09): Italy (86) and West Germany (85) are the
    strongest nations, then the Netherlands, Brazil and England; Yugoslavia is Red
    Star's Stojković, Pančev, Savićević and Prosinečki, the Soviet Union Belanov,
    Dasayev and Zavarov, Czechoslovakia Kubík, Chovanec and Skuhravý. One rating
    is wild: Helsingborg's 36-year-old goalkeeper Jan Möller has the database's
    highest ability, 198 against a potential of 140 (rated 98, above Maradona's
    193), so he keeps Sweden's goal ahead of Thomas Ravelli (160, rated 79); it
    ships as Simon Treanor set it.

### How they play

Each season's clubs, league by league, played as double round-robins (twenty
seasons, neutral venue, Balanced; measured 2026-11-08 beside the realism
harness's real range of 2.50–3.28 goals a game and 20.3–29.5% draws):

| Season | Goals a game | Draws | Goalless |
| --- | --- | --- | --- |
| 2002/03 (3.9.68) | 3.40 | 19.5% | 5.6% |
| 2001/02 (3.9.60) | 3.41 | 19.8% | 5.7% |
| 2000/01 (CM 00/01) | 3.52 | 19.2% | 5.2% |
| 1999/00 (CM 99/00) | 3.56 | 18.5% | 5.1% |
| 1998/99 (CM3) | 3.56 | 18.8% | 5.2% |
| 1997/98 (CM 97/98) | 3.36 | 19.6% | 5.9% |
| 1995/96 (SWOS 95/96) | 3.90 | 17.3% | 3.8% |
| 1994/95 (SWOS 94/95) | 3.95 | 17.7% | 3.7% |
| 1993/94 (Cam F's, fan-made) | 3.55 | 18.9% | 5.3% |
| 2006/07, 2011/12, 2017/18, 2023/24 (EA) | 2.82–3.13 | 22.8–24.6% | 6.6–8.6% |

(2000/01 and 1999/00 measured 2026-11-09 the same way, 45,800 games each; the
same run gives 3.9.60 3.41 goals, 19.7% draws and 5.7% goalless.)

1997/98 plays like the other CM seasons, its higher scale notwithstanding. All
six score more and draw less than EA's seasons and than real leagues, because
CM's current ability spreads a league's clubs wider: their strengths' standard
deviation within a league is 5.4–5.9 rating points on average (6.2 in 1999/00),
against 3.4–3.8 in EA's seasons. That is the CM conversion's, as in any local
CM 01/02 set, and nothing corrects it. SWOS 96/97's 133 nations, all against all, score 4.15 a game with
11.9% draws, as CM 01/02's 107 to 119 nations do (4.17–4.23, 12.3–12.7%): the
world's minnows meet its giants.

The seasons of 2026-11-09, measured the same way the same day (the same harness
gives CM 97/98 3.35 and 19.8%, and SWOS 96/97's nations 4.13 and 12.3%): SWOS's
clubs score most and draw least of all, nearly four goals a game, its price
steps spreading a league's clubs as wide as CM's ability does and wider at the
top (Milan and Barcelona at 86–87 against a league's last at 54–58). Cam F's
1993/94 plays like the SI databases. Their nations, all against all: SWOS 95/96's
132 score 4.10 a game with 12.6% draws and 94/95's 131 4.03 and 13.0%; Cam F's
91 that take part 4.44 and 11.3%, and Simon Treanor's 104 of 1989/90 4.38 and
10.3%.

## Computed World Cup seasons

Decided 2026-11-09, shipped 2026-11-10. No game rates the players of most nations
before 1994 in a form the game can read, so the nine World Cups from 1962 to 1994
are **computed**: each finalist's strength from its Elo the day after the final,
its eleven the players of its World Cup squad with the most minutes, ordered by
their records. The user approved computed football ratings for the 1960s to
1980s on 2026-11-09: national-team Elo adjusted per player, labelled as
computed. Claude chose the rest under that request, and the user has not
confirmed it: World Cup squads only (no Wikidata pools), the strength from Elo by
the line below (not by rank), the Elo of the day after the final, and the
federations of the day under their own names and flags. Each season is a data
set of `kind: 'wc'`, nations only, labelled "Computed · 1970 World Cup", and the
setup's Season note says those seasons are computed.

| Season | Id | Finalists fielded | Identities | Theatres | Strongest (T) | Team share |
| --- | --- | --- | --- | --- | --- | --- |
| 1961/62 | `wc-1962` | 16 | Soviet Union, Yugoslavia, Czechoslovakia, West Germany | World, Europe, South America | Brazil 87, Soviet Union 81.2, Czechoslovakia 80.4 | 76% |
| 1965/66 | `wc-1966` | 16 | Soviet Union, West Germany | World, Europe, South America | England 87, West Germany 85.4, Soviet Union 84.8 | 70% |
| 1969/70 | `wc-1970` | 16 | Soviet Union, Czechoslovakia, West Germany | World, Europe | Brazil 87, West Germany 83.0, England 82.3 | 78% |
| 1973/74 | `wc-1974` | 15 (no East Germany) | Yugoslavia, West Germany, Zaire | World, Europe, South America | West Germany 87, Netherlands 84.6, Poland 84.1 | 74% |
| 1977/78 | `wc-1978` | 16 | West Germany | World, Europe | Brazil 87, Netherlands 84.3, Argentina 83.7 | 66% |
| 1981/82 | `wc-1982` | 24 | Soviet Union, Yugoslavia, Czechoslovakia, West Germany | World, Europe, South America | Brazil 87, Italy 85.4, West Germany 84.4 | 70% |
| 1985/86 | `wc-1986` | 24 | Soviet Union, West Germany | World, Europe, South America | Argentina 87, France 86.2, Brazil 86.2 | 66% |
| 1989/90 | `wc-1990` | 24 | Soviet Union, Yugoslavia, Czechoslovakia, West Germany | World, Europe, South America | West Germany 87, Italy 85.7, Brazil 84.7 | 70% |
| 1993/94 | `wc-1994` | 24 | none | World, Europe, South America | Brazil 87, Italy 85.9, Germany 84.5 | 68% |

"Team share" is the nation's part of the variance of the season's XI ratings:
the ratings are mostly about the team.

### Sources

| Source | Pinned | Use | Licence |
| --- | --- | --- | --- |
| The Fjelstul World Cup Database ([jfjelstul/worldcup](https://github.com/jfjelstul/worldcup)), `data-csv/` | commit `35a8667` (2026-06-11); nine files by SHA-256 | Squads (position GK/DF/MF/FW, shirt number), appearances, substitutions and sendings-off from 1970, goals, awards, players' dates of birth and Wikipedia links | CC BY-SA 4.0: credit "Joshua C. Fjelstul, Ph.D.", "© 2023 Joshua C. Fjelstul, Ph.D.", links to the licence and the repository, changes indicated |
| [martj42/international_results](https://github.com/martj42/international_results), `results.csv` | commit `b0948cb` (2026-10-31), SHA-256 | Every men's full international to 1994, for the Elo | CC0-1.0 |
| English Wikipedia, "<year> Ballon d'Or" | 18 revisions, 1961–1994 (the two years of each season) | The voting tables: points per player | CC BY-SA 4.0 (the votes are France Football's) |
| English Wikipedia, "1962 / 1966 FIFA World Cup Group 1–4" and "… knockout stage" | 10 revisions | The starting line-ups, before the database's appearances begin | CC BY-SA 4.0 |
| eloratings.net year-end tables 1962–1994 | 9 tables and `en.teams.tsv` by SHA-256 | A cross-check of the computed Elo only, never an input; no rating of theirs is kept | none stated |

The Wikipedia pages were saved from their article paths (`/wiki/<title>`), one
every 2 seconds on 2026-11-09: robots.txt disallows `/w/` and `/api/` to every
user agent, the parse API included, and has no rule for ClaudeBot. A page saved
again shows its pinned revision but not always the same bytes, so `--check`
needs the saved copies. The research pass's copies of eloratings.net's tables
(fetched 3 s apart; the site has no robots.txt) and of the two repositories are
reused, each checked against its SHA-256. `scripts/data/world-cup-seasons.json`
pins all of it, and `public/football/ATTRIBUTION-world-cup.txt` gives the credits
CC BY-SA asks for and licenses the season files under it.

### How a season is made

- **Elo** (`scripts/lib/football-elo.mjs`), by the formula eloratings.net
  publishes: R' = R + K × G × (W − We), We = 1 / (1 + 10^(−dr / 400)), dr the
  rating gap plus 100 for a home side (none at a neutral venue). K is 60 at the
  World Cup finals; 50 at the Euro, the Copa América, the African Cup of Nations,
  the Asian Cup, the Gold Cup, the CONCACAF Championship, the Oceania Nations
  Cup, the Confederations Cup and the Finalissima; 40 in any qualification and
  the Nations Leagues; 20 in friendlies; 30 elsewhere. G is 1 for a margin of 0
  or 1, 1.5 for 2, 1.75 for 3 and 1.75 + (N − 3) / 8 from 4. A match level after
  extra time is a draw, whatever its shoot-out. A team starts at 1500, or 1300
  when its first match is in a year after 1930. The Soviet Union and the CIS are
  `Russia` in the results, West Germany `Germany`, Zaire `DR Congo`.
- **Strength.** The Elo is read the day after the final (every match up to the
  final's day). T = 87 − 3.2 × (E_best − E) / 100: E is the nation's Elo, E_best
  the best of the teams that played in the four years before (each season's best
  is a finalist), and 87 today's strongest built-in nation.
- **The XI.** From the squad of 22: one GK, four DF, four MF and two FW by the
  database's positions, of the players who played (minutes, or a start), the
  most minutes first, then the most starts, then the lower shirt number. A role
  short of them takes the most-used players left, whatever their position:
  everyone who played comes before anyone who did not, and every finalist used
  twelve players or more, so no XI holds a player who never played. 29 places in
  21 XIs are filled so: 1962's Czechoslovakia lists two midfielders, and Chile
  and 1982's Hungary three, one of whom never played; the other eighteen list
  enough for the role but not enough who played (Brazil's 1962 midfielders
  Zequinha and Mengálvio never played, and its forwards Zagallo and Amarildo
  take their places). From 1970, minutes come from the appearances,
  substitutions, sendings-off and extra time. For 1962 and 1966 every starter of
  Wikipedia's line-ups plays the whole match (no substitutes were allowed), 120
  minutes with extra time: the line-up is matched to the squad by team and
  shirt number, and the eleven names spelt otherwise on the page (Li Chan-myung
  for Chang-myung Lee) are checked and listed in the manifest.
- **Order.** By Ballon d'Or points of the season's two calendar years (1969 and
  1970 for 1969/70), then World Cup awards (Golden Ball 3, Silver 2, Bronze 1,
  Golden Boot 2, Silver and Bronze Boot 1, Golden Glove 1, Best Young Player 1),
  then goals a minute, then minutes. A vote is the player's by his article, else
  by name and nation, else by one of seven names the manifest pins after a check
  by hand (Wikipedia's "Igor Belanov" is the database's "Ihor Belanov").
- **Ratings.** The k-th player of the order is T + D_k, D = +5.3, +3.3, +2.1,
  +1.0, 0.0, −0.4, −1.0, −1.7, −2.1, −2.7, −3.9: the mean sorted deviation from
  the XI's mean of the 32 strongest built-in XIs of 2026/27, to one decimal. The
  eleven are rounded together so they sum to round(11 × T) (each rounded down,
  the largest fractions up), so the XI's mean is T within 1/22 and rounds as T
  does. The nation's strength in the file is its lineup's, as for every football
  set: T, less 12 a place for a player out of position.
- **Nations and federations.** A finalist plays as the game nation its name
  resolves to in its year (`dayNationResolver`: the Soviet Union 643, West
  Germany 276, Yugoslavia 688, Czechoslovakia 203, Zaire 180, the Republic of
  Ireland 372 by the manifest's alias); the build stops on a finalist whose shape
  the year merges or leaves out, and none does. East Germany (1974) has no shape
  and fields no team. Territory and identities are `territoryFor` and
  `identitiesFor` of the season-end year with only the finalists fielding
  (`fields`): a federation of the day holds its members' land only where it is a
  finalist (the Soviet Union in 1969/70 holds Ukraine and the Baltic states;
  Yugoslavia, not a finalist, holds nothing, and its republics are neutral), and
  plays under its name and flag. A nation that is not a finalist fields no team.
- **Theatres** follow the existing rule: the world, and a continent with four
  finalists of its own (South America in all but 1969/70 and 1977/78, which have
  three). Never the Elite 32.

All constants are the manifest's, not read from the built-in data, so a later
rollover of the built-in season changes nothing.

### Calibration and checks

- **3.2 points per 100 Elo** gives the game's football model (rate
  1.28·e^(1.5·tanh(0.075Δ / 1.5)), Poisson goals) Elo's expected score within
  0.0015 for gaps of 50 to 300 Elo; the research pass found the same slope, 3.20,
  regressing today's 173 built-in strengths on their 2026 Elo from the same
  results (r 0.895).
- **Against eloratings.net** (year-end tables, cross-check only,
  `scripts/data/world-cup-seasons/elo-crosscheck.json`): Pearson 0.872–0.917 and
  top-48 Spearman 0.858–0.957, 0.898 and 0.915 on average over the nine years,
  the same leader every year. The computed scale is narrower than theirs (slope
  0.58), and the 3.2 is measured on it.
- **Against SWOS 94/95** (the original SWOS, December 1994, its national squads,
  cross-check only, measured once on 2026-11-10 outside the build: no script or
  audit file keeps these figures): for 1993/94's 24 finalists, Pearson 0.76 and
  Spearman 0.77 between the nations' strengths, and 0.63 for the 178 XI players
  found in SWOS's squads by surname (a re-check that kept only surnames one SWOS
  player of the nation has found 147, at 0.65). The computed strengths run 5.5
  points higher on average: SWOS rates Mexico, Saudi Arabia and South Korea at
  60–65 where their results make them 77–81.
- **How they play.** Each season's finalists, all against all (a hundred
  rounds, neutral venue, Balanced, measured 2026-11-10): 2.93–3.16 goals a
  game, 20.6–23.2% draws and 6.2–7.7% goalless, within the realism harness's
  real range and as EA's seasons play; the stronger side wins 72–77% of decided
  games.
- **Saves.** A computed player is a plain record (no `playerPack` kind), its
  source inline: 24 squads take about 105,000 characters, and a whole 1989/90
  world campaign stays within the checkpoint budget (`scripts/save-size.test.mjs`).

### Files and commands

```bash
npm run sync:world-cup-seasons            # data-src/ → scripts/data/world-cup-seasons/<id>.json (--check compares)
npm run build:world-cup-seasons           # facts → public/football/wc-<year>.json, the listing, the audit (--check)
```

- `scripts/data/world-cup-seasons.json`: the manifest (sources, constants, the
  reviewed spellings and Ballon d'Or names, the seasons).
- `scripts/data/world-cup-seasons/wc-<year>.json`: the committed facts of each
  World Cup (the finalists' Elo and rank, every squad player's minutes, starts,
  goals, awards, Ballon d'Or points, date of birth and article, and the votes for
  players in no squad), CC BY-SA 4.0. The sync needs `data-src/`; the build reads
  only these and the manifest, so it rebuilds offline.
- `public/football/wc-<year>.json`: `nations` lists the finalists only, each
  `[strength, squad size, eleven]`, a player `[name, 'GK' | 'DF' | 'MF' | 'FW',
  rating, source]` strongest first; `clubs` is empty; `territory` and
  `identities` as above. A player's source is `{ id: 'wc:P-38906', source:
  'world-cup', edition: '1970 World Cup, computed', snapshotDate, url, team,
  shirt, teamElo, xiRank, minutes, starts, goals, awards?, ballonDor?,
  dateOfBirth? }`: the Source column reads "1970 World Cup, computed" and links
  to his Wikipedia article, and its tooltip names the Elo the rating comes from
  ("Team Elo 1995.3 on 1970-06-22"), not a database snapshot. The season's
  source block says `method: 'computed'`, `computed: true`, `rawScale: 'Elo'`,
  the Elo's day, the rule (`conversion`), the licence and the commits and
  revisions read.
- `docs/design/football-world-cup-seasons-audit.json`: per season each nation's
  Elo, rank, T, strength, XI and fill-ins, the team share, and the votes matched
  to no squad player.
- The loader (`KINDS.wc` in `src/engine/footballSets.js`) refuses a season whose
  source does not say it is computed, a nation without eleven players or out of
  order, a player whose source does not name him, his team's Elo, his place and
  his record, any club, and a holder that fields no team.

### Spot checks (2026-11-10)

The strongest nation by Elo the day after each final is the winner, but in
1977/78 and 1981/82 Brazil (unbeaten and third in 1978). Each XI's first is its
star of the day: Garrincha for Brazil and Masopust (1962's Ballon d'Or) for
Czechoslovakia in 1961/62, Eusébio in 1965/66, Jairzinho (93) and Pelé (90) for
Brazil and Gerd Müller for West Germany in 1969/70, Cruyff in 1973/74, Kempes in
1977/78, Paolo Rossi in 1981/82, Maradona in 1985/86, Matthäus (93) in 1989/90
and Roberto Baggio in 1993/94.

## Earlier basketball seasons

Basketball has 66 earlier seasons, every one from 1960/61 to 2025/26. The 36
that no game rated, 1960/61 to 1997/98 but 1983/84 and 1991/92, are computed
from Basketball-Reference's statistics
([below](#computed-seasons-196061-to-199798)); 1983/84, 1991/92 and 1998/99
come from NBA 2K27's MyNBA Eras and NBA Live 99
([below](#before-nba-2k-198384-199192-and-199899)); then every one from 1999/00
to 2025/26: the NBA
clubs of each NBA 2K edition from NBA 2K to NBA 2K26, as compiled by
[2K Archive](https://2karchive.com/) (NBA 2K12 by The Real 2K Insider, below). The built-in basketball clubs are NBA
2K27's (2026/27), from the same page (`builtIn` in the manifest, built by
`npm run build-clubs`), and its NBA ratings rate the built-in national fives
(`npm run build-basketball`). The compilation names no licence, and 2K's own
rights are not cleared. Its page holds every edition's
ratings as one table (`const YEARS = {...}`: name, overall, position and team
code per player). `scripts/data/nba-seasons.json` pins one saved copy of the
page by SHA-256 and maps each edition's team codes to franchises by season.
`npm run build:nba-seasons` (`scripts/build-nba-seasons.mjs`, logic in
`scripts/lib/nba-seasons.mjs`) reads the table as data, cutting the object
literal out by matching braces and parsing it as JSON, so nothing on the page
runs. It stops on any other copy of the page and writes:

- `public/basketball/nba-2k<nn>.json`, one data set per edition (about 12 KB),
  with `kind: 'nba2k'` (below), `nba-eras-1984.json`, `nba-eras-1992.json`
  and `nba-live-99.json`, and `nba-stats-<season end year>.json` for the
  computed seasons (3 to 9 KB);
- `src/data/basketballSeasons.js`, the listing, each entry naming its map;
- `docs/design/basketball-seasons-audit.json`, per season: rows, the positions
  filled from another edition, the players left out and any five's player
  out of position. `--check` rebuilds all three byte for byte and writes nothing.

How a season is made:

- **Franchises of the season.** Each team code maps to a franchise for a span of
  seasons. A franchise that kept its id keeps the game's code and colour
  (`b-boston-celtics`). One that has since moved gets its own id, name and
  arena: the Vancouver Grizzlies until 2000/01, the Seattle SuperSonics until
  2007/08, the New Jersey Nets until 2011/12, the Charlotte Bobcats from 2004/05
  to 2013/14, and the Hornets in New Orleans, then Oklahoma City for 2005/06 and
  2006/07. Its code comes from `makeCode` and its colour from `colourFor`, both
  in `footballSetBuild.js`. Every code in an edition must be a franchise of that
  season and every franchise must have players, or the build stops. Free agents
  play for nobody.
- **The best five.** Each franchise fields the strongest lineup its players'
  positions allow (`selectLineup`, as build-clubs picks the built-in fives). A
  listed second position that is not the first's neighbour is dropped, as the
  game allows. A blank position takes the player's own from the nearest edition
  that lists him, earlier first. A player with no position in any edition is
  left out, never guessed.
- **Ratings** are 2K's overall, 1–99, unchanged (NBA Live 99's go on 2K's scale
  by one line, below). A club's `str` is its five's mean.
- **NBA 2K12 (2011/12) comes from another compiler.** 2K Archive lists one
  Philadelphia and two San Antonio players for it (its source page shows another
  team's ratings for both), so no five could be fielded. The Real 2K Insider
  transcribed 2K's launch ratings video team by team on 27 September 2011: 425
  rated players on all 30 teams (12 to 15 each, every position on every team)
  and 27 free agents, on the lockout's launch rosters (the 2010/11 teams), as
  2K Archive's are. The manifest's `extra` pins the Wayback Machine's capture of that page
  of 14 October 2011 by SHA-256 (`data-src/bball-2k12/`; the live page's markup changes
  from one fetch to the next, its list does not), and `parseInsiderRatings` reads its list as data:
  team nickname, position heading, "overall – name (2K11 ratings)". The season
  comes from that list whole; the audit counts how many of 2K Archive's 2K12
  players it rates the same (387 of the 391 both list, on the same teams; Ryan
  Anderson is 63 there, 73 in 2K Archive). Its source block names its compiler.
  2011/12 had the franchises and arenas of 2010/11, so it plays on `nba2009`.

A basketball set has clubs only: no national team is rated, so `nations` and
`territory` are absent and a basketball season is played with clubs alone. Its
`source` is `{ provider: '2K Sports', edition: 'NBA 2K8', compiler: '2K Archive',
url, rawScale: 99 }`, and each club holds `[name, 'PG/SG', rating]` players, the
built-in clubs' shape. Saves hold them as plain records, as for the built-in
clubs, so no `playerPack` is needed.

### Before NBA 2K: 1983/84, 1991/92 and 1998/99

Three seasons come from other games, each a season of the manifest's `extra`
with a `format`, its files pinned by SHA-256 in `data-src/` (ignored). Every
player is checked against Basketball-Reference's regular seasons: the
manifest's `check`, Sumitro Datta's CC0 copy (`Player Totals.csv`, version 57),
read only for who played for which club and for how long.
`readSeasonSources` reads them; `build-clubs` and `build-basketball` never do.

- **1983/84 and 1991/92: NBA 2K27's MyNBA Eras** ('Magic vs Bird Era', 'Jordan
  Era'), as 2kratings.com lists them: `nba-eras-1984` and `nba-eras-1992`,
  labelled 'NBA 2K27 (Magic vs Bird era)' and 'NBA 2K27 (Jordan era)'.
  `parseErasPage` reads each team card's players with 2K's own overall and
  position (298 and 364 rows, 23 and 27 clubs) as data. These are 2K's
  opening-night rosters, filled up with made-up bench players (an initial and a
  surname), and 2K lists no player it has no licence for. A player stays if
  Basketball-Reference has him playing for his club that season (`rule:
  'club'`), under his own name or a spelling in `aliases` (Micheal Ray
  Richardson). 2K also lists a few real 1991/92 players by an initial; the
  manifest's `roster` gives each his name and evidence (Wikipedia's season
  articles, by revision): Magic Johnson ('M. Johnson', 89: on opening night, he
  retired on 7 November 1991), Bernard King (82), John Williams, Mark Alarie,
  Roy Hinson, Richard Dumas and Trent Tucker, on their clubs' rosters without
  playing, and Chris Jackson (Basketball-Reference's Mahmoud Abdul-Rauf). An
  entry stands only if Basketball-Reference has him in the NBA the season
  before or after. Everyone else is left out, 60 of 1983/84's rows and 46 of
  1991/92's, and none of them would have started; the audit lists each, with
  the club a real player of that initial and surname played for (George
  Johnson, Clay Johnson, Trent Tucker...). Kept: 238 and 318.
  - Where 2K has no licence, a five is weaker than the real club's: the 1983/84
    76ers without Andrew Toney, the Bulls without Orlando Woolridge, the
    Bullets without Greg Ballard; the 1991/92 76ers without Charles Barkley and
    the Pacers without Reggie Miller (George McCloud, 74, starts). Nothing
    fills them. The audit's `notListed` names every real player of 1,000
    minutes or more for his club whom 2K does not list: 23 in 1983/84, 12 in
    1991/92.
  - Indiana's 1983/84 roster has no power forward: by the game's own rule
    (`selectLineup`), George Johnson (SF, 77) plays there.
- **1998/99: NBA Live 99** (`nba-live-99`, label 'NBA Live 99'): EA's own
  roster files from the PC CD-ROM, the NLSC's 'NBA Live 99 Original 1998
  Rosters'. Because of the lockout the game shipped with the final 1997/98
  rosters plus the trades of May and June 1998, and no 1998 draft pick. The
  season is the edition's, 1998/99, as NBA 2K12 carries 2011/12 on the
  lockout's 2010/11 rosters. `readDbf` reads PLAYERS.DBF and TEAMS.DBF (dBase
  III) as data, and nothing from the archive runs. `parseLive99` takes each
  player's name, position (POSITION and POSITION2) and club: 396 players of 29
  clubs, free agents and All-Stars left out. A player stays if
  Basketball-Reference has him playing in the NBA (`rule: 'league'`; ten of
  EA's formal names are aliased, Tyrone to Muggsy Bogues...). That leaves out
  the made-up 'Roster Player' and Serge Zwikker, a draft pick who never played.
  Clubs are EA's.
  - **Its scale.** NBA Live 99's overall (OVERALLRTG) is the rounded mean of 17
    of its ratings: it runs 28–71 and undervalues specialists (Shaquille
    O'Neal's 61 is below Kevin Garnett's, Tim Duncan's and Jason Kidd's 64).
    One straight line puts it on NBA 2K's scale: the least-squares line of NBA
    2K's overall (2K Archive's NBA 2K, 1999/00) on NBA Live 99's, through the
    296 players both rate, so rating = round(20.22 + 1.089 × raw), and no
    player passes another (Scottie Pippen 70 → 96, Kidd 64 → 90, O'Neal 61 →
    87). On those players it is 3.95 points out on average (root mean square
    4.84, bias −0.03; correlation 0.819). Fitted on either half of them, it does
    as well on the other (3.99 and 4.07). The raw overall plus 30 would be 6.02
    out and 5.35 too high, and over 99 at the top. The manifest fixes the line;
    the build fits it again and stops if it has changed. The audit holds every
    raw overall's rating and each five's raw overalls. The file's `source`
    names the line in `conversion`, which the loader requires of an NBA Live
    season and refuses for NBA 2K's.
- Their sources name the game and who listed it: `{ provider: '2K Sports',
  edition: 'NBA 2K27', compiler: '2kratings.com', url, rawScale: 99 }` and
  `{ provider: 'EA Sports', edition: 'NBA Live 99', compiler: 'The NLSC', url,
  rawScale: 99, conversion: 'round(20.22 + 1.089 * raw): …' }`. Each plays at its own league averages
  (`src/data/nbaLeagueAverages.js`: 101.4 possessions and 110.1 points a game in
  1983/84, 96.6 and 105.3 in 1991/92, 88.9 and 91.6 in 1998/99), and its clubs
  score within half a point of them.

### Computed seasons: 1960/61 to 1997/98

No game rates the NBA's seasons before 1983/84 or those between the three
above: NBA Live 95 to 97 kept their ratings inside the game executables and the
NLSC offers only fan rosters and patches for them (it answered this client with
a 403 on 2026-11-09); MyNBA Eras starts in 1983/84; NBA 2K27's classic teams
give one to four teams a season. So, by the user's decision of 2026-11-09
(computed NBA seasons back to 1960, not further: the floor is 1960/61), the 36
seasons 1960/61 to 1982/83, 1984/85 to 1990/91 and 1992/93 to 1997/98 are
computed from Basketball-Reference's player seasons, `nba-stats-<season end
year>`, labelled 'Basketball-Reference (computed)'. 1983/84, 1991/92 and 1998/99
keep their games' ratings (Claude's decision). No BAA, no ABA, no 1959/60.
Claude's decisions here and below were taken that day under the user's request
to cover every missing season, and the user has not confirmed them.

- **Source.** Sumitro Datta's 'NBA Stats (1947-present)' on Kaggle, version 57
  (updated 1 November 2026): a CC0 copy of Basketball-Reference's regular
  seasons, downloaded anonymously from Kaggle's API on 2026-11-09. The
  manifest's `computed.files` pins seven of its tables by SHA-256 in
  `data-src/research-gaps/basketball/kaggle-sumitrodatta-v57/` (ignored):
  Advanced (position, games, minutes, PER, WS/48, DWS), Player Totals (points,
  rebounds, assists; the file `check` pins too), All-Star Selections, End of
  Season Teams (All-NBA), Player Career Info (career position), Team Summaries
  (team names, SRS, the league's pace and offensive rating) and Team Stats Per
  Game (the league's points a game). Nothing was fetched from
  basketball-reference.com. PER, WS/48 and DWS are Basketball-Reference's own
  calculations, and Sports-Reference's data-use terms forbid scraping that harms
  its sites, building a competing database and AI training with its data, and
  say facts are not copyrightable; Claude chose on 2026-11-09 to use them,
  computed and labelled, with the CC0 copy and Basketball-Reference credited.
  The CC0 label is the copy's compiler's, not Sports-Reference's, so whether
  these seasons ship under Sports-Reference's terms is open for the user.
  Each season's `source` is `{ provider: 'Basketball-Reference', edition:
  '1975/76 NBA regular season', compiler: 'Sumitro Datta, NBA Stats
  (1947-present), Kaggle, CC0, version 57', url, rawScale: 99, method:
  'computed', conversion }`, `conversion` stating the whole rule; the loader
  requires `conversion` of an `nba-stats` season.
- **The score.** One formula for every season, on inputs that exist from
  1951/52: score = −1.91373 + 0.0541565 × PER′ + 0.342456 × WS/48′ +
  0.00592352 × MPG + 0.00000972204 × MPG² + 0.0683889 × PPG + 0.0254284 × RPG +
  0.0709854 × APG + 0.264524 × All-Star + 0.0486592 × All-NBA + 0.111944 × DWS.
  PER′ and WS/48′ are shrunk toward a bench player's 11 and 0.050 by 400
  minutes ((value × minutes + prior × 400) / (minutes + 400)), so a few good
  minutes count for little; All-Star is 1 if picked, All-NBA 3, 2 or 1 for the
  first, second or third team; every input is the player's whole season. Every
  coefficient is positive.
- **Its fit.** The coefficients are the least-squares fit of NBA 2K's overall,
  as a z-score within each edition, on those inputs from each player's season
  before (2K rates a season's players from the season before): 2K Archive's NBA
  2K (1999/00) to NBA 2K26 (2025/26), its own NBA 2K12 included, players matched
  by name and, where two share one, by club: 9,970 pairs. In sample the score
  correlates 0.904 with the z-scores (Spearman 0.876). The manifest fixes the
  coefficients, the training editions (2000 to 2026), the spread's edition
  (2027) and its 390 ratings (`spread.counts`); the build fits the score again
  and stops if a coefficient differs at six significant figures or the spread
  has moved, so a later copy of 2K Archive's page cannot move a season unseen.
  The research pass measured it leaving each edition out in turn (its scratch
  scripts, in `data-src/research-gaps/basketball/_scratch/`, reproduce every
  figure): Spearman 0.882, Pearson 0.906, 2.51 points mean error (2.26 for each
  club's top five), weakest on 2004/05 (0.81). Against the same season's launch
  ratings it does worse (0.78, 3.38 points): launch ratings come before the
  season they rate. A score on BPM gained nothing and cannot go before 1973/74;
  age terms gained nothing and learn 2K's ageing; box-score facts alone (no PER,
  WS or DWS) reach 0.871 but order clubs worse (0.53 to 0.66 against SRS).
- **The ratings.** Each season, each club's 13 players with the most minutes
  are rated. A player traded during the season counts once, for the club he
  played the most minutes for (then the most games, then the earlier club):
  Claude's decision of 2026-11-09. The league is ranked by score, lowest first
  (scores in millionths, ties by Basketball-Reference's player id), and the
  player at rank quantile (rank − 0.5) / N takes NBA 2K27's rating at that
  quantile of its ratings of each club's 13 best (2K Archive's 2026/27 table: 390
  ratings from 69 to 97; 72 at 5%, 74 at 25%, 78 at the median, 81 at 75%, 90 at
  95%). No player passes another, and every season has NBA 2K27's spread, as the
  1990s hockey seasons have NHL 27's. No input is a team's result: no SRS,
  record or point margin (Claude's decision of 2026-11-09: a team-results term
  ordered clubs a little better, 0.75 to 0.87 against SRS, but would choose
  ratings by real results). Basketball-Reference's defensive win shares, and so
  WS/48, do start from each club's points allowed, so some of a club's defence
  reaches its players' scores.
- **Positions and fives.** A player's first position is the season's
  (Basketball-Reference lists PG, SG, SF, PF or C), else the first his career
  position implies (G is PG/SG, F SF/PF, C C, G-F SG/SF, F-G SF/SG, F-C PF/C,
  C-F C/PF). His second is the neighbouring position he was listed at in his
  other seasons, the one with the most minutes there (then the latest), else the
  neighbour his career position implies. A player with no position would be left
  out; none is. Of two teammates with one name the one with fewer minutes is
  left out, since a five names its players by name alone: 1988/89's Bullets had
  two Charles Joneses, and the one with 516 minutes is out. Each club fields the
  strongest five its players' positions allow (`selectLineup`); no five plays
  anyone out of position.
- **Checks.** Each season's teams must be Basketball-Reference's, by name, and
  its league averages (pace, offensive rating and points a game) those of
  `src/data/nbaLeagueAverages.js`; the build stops otherwise. The audit gives
  how many players each season rates (its clubs' 13s by minutes, 8,884 player
  seasons in all), every traded player and his club, each five with each
  player's score, the season's league
  averages, and how its clubs' strengths follow its real SRS. Run end to end on
  the two seasons NBA 2K27's MyNBA Eras rate, the rule rates them as 2K does:
  1983/84's 233 players whom both rate at Spearman 0.95, 1.94 points mean error
  and 1.40 points too high on average; 1991/92's 297 at 0.94, 2.10 and 1.85. The
  research pass found the same on 378 players of 2K27's 34 classic teams from
  1964/65 to 1999/2000 (0.91 and 2.82 points; before 1980, 0.93 and 2.42): Jerry
  West 93 against 2K's 93 in 1964/65, Kareem Abdul-Jabbar 97 against 97 in
  1970/71. The bias is mostly bench players: 2K27's spread starts at 69, and the
  eras' benches reach the low 70s.
- **Clubs.** A club's strength follows its season's SRS at 0.79 on average,
  from 0.51 in 1964/65 (Wilt Chamberlain counts for the Warriors, who traded him
  in January) and 0.56 in 1975/76 and 1976/77 to 0.93 in 1963/64 and 1966/67.
  Strengths spread less than the games' seasons do (a standard deviation of 1.37
  to 2.37 a season, against 1.80 to 3.70), so computed seasons play a little
  more evenly. Spot checks, each the season's best record: the strongest clubs
  are the 1961/62 Celtics (86, Bill Russell 93), the 1967/68 76ers (87, Wilt
  Chamberlain 97), the 1971/72 Lakers (88: Jerry West 96, Chamberlain 91, Gail
  Goodrich 90), the 1972/73 Celtics (89: Dave Cowens 96, John Havlicek 95) and
  the 1982/83 76ers (88: Moses Malone 97, Julius Erving 94); Oscar Robertson is
  92 as a rookie in 1960/61, and Kareem Abdul-Jabbar 97 in 1971/72.
- They play at their own league averages (127.7 possessions and 118.1 points a
  game in 1960/61, 115.1 and 112.4 in 1970/71, 90.3 and 95.6 in 1997/98), from
  the same CC0 copy (Team Summaries' League Average pace and ORtg, Team Stats Per
  Game's points), which the build checks against `src/data/nbaLeagueAverages.js`.
  Played every pairing four times, their clubs score from 1.3 points a game
  under the league (1960/61) to 1.6 over (1987/88), 0.7 over on average; the
  games' seasons run from 2.1 under to 1.9 over. The match engine is unchanged
  (Claude's decision): see [Known limits](#known-limits).

### Era maps

A season plays on the map of its own era: the franchises of that season, each
holding the state or province of the arena it played in, by the
[NBA map](domestic-campaigns.md#the-nba-map)'s rule. A season's `map` names
it. `npm run build:nba-map` builds today's map and one map per era of the
manifest's `maps`. Before 1999/00 an arena moved almost every season, so most
seasons have a map of their own: `nba1961` to `nba1981`, but `nba1965`
(1964/65, 1965/66) and `nba1969` (1968/69, 1969/70); `nba1984` (1981/82 to
1983/84, the same franchises in the same arenas); `nba1985`, `nba1986` (1985/86
to 1987/88), `nba1989`, `nba1990`, `nba1991`, `nba1992` and `nba1993` to
`nba1999`; then `nba2000` (1999/00 and 2000/01), `nba2002`, `nba2003` (2002/03,
2003/04), `nba2005`, `nba2006` (2005/06, 2006/07), `nba2008`, `nba2009`
(2008/09 to 2010/11), `nba2013` and `nba2014`: 42 era maps, 30 of them new on
2026-11-09 (158 to 162 KB each, 4.8 MB in all). Every season of an era must have the same
franchises in the same cities and arenas, or the build stops (Claude kept
this rule on 2026-11-09 rather than share a map when a club alone in its state
moves within its city, which would save three maps). From 2014/15 the
franchises are today's, so those seasons play on today's map (`nba`), whose file
is unchanged. `nba1984`'s file gained 1981/82 and 1982/83 and so a new version;
its land is the same, and a 1983/84 campaign saved on the old version resumes on
the new one club by club (`fitDomesticCampaign`).

Before 1999/00 the manifest's `teams` give every franchise, from 1960/61, the
arena it played in that season: before 1980/81 the arena Basketball-Reference's
team summaries name (in the CC0 copy), its point from the manifest or from
English Wikipedia's coordinates (each such era's `source` names the article and
the revision read, 20 arenas: the Cincinnati Gardens, the Detroit Olympia, Cobo
Arena, the 1925 Madison Square Garden, Philadelphia's Convention Hall, the Kiel
Auditorium, the Onondaga War Memorial, the International Amphitheatre, the
Chicago Coliseum, the Cow Palace, the San Francisco Civic Auditorium, the
Baltimore Civic Center, the Alexander Memorial Coliseum, the Buffalo Memorial
Auditorium, the Cleveland Arena, Hofheinz Pavilion, the Municipal Auditoriums of
Kansas City and New Orleans, the Superdome and the Nassau Coliseum); from
1980/81 Basketball-Reference's league pages and Wikipedia's arena articles, as
before. So 1960/61 has the Warriors in Philadelphia, the Nationals in Syracuse,
the Royals in Cincinnati and the Hawks in St. Louis; the Warriors play at the
Cow Palace (Daly City) in 1962/63, 1963/64 and 1967/68, in San Francisco between,
and in Oakland from 1968/69; the Bullets in Chicago (Packers, Zephyrs), Baltimore
and Landover; the Kansas City-Omaha Kings hold Missouri alone (one arena a
season: Basketball-Reference's main one, as for Buffalo's games in Toronto and
Cincinnati's in Omaha); the New York Nets of 1976/77 play at Uniondale, and the
New Jersey Nets at Rutgers from 1977/78. Seattle's arena is missing from
Basketball-Reference for 1978/79 to 1984/85 and is the Kingdome, as the manifest
had it. The Milwaukee Arena and MECCA are one building, named MECCA Arena
throughout; the Forum, Oakland's arena and the Richfield Coliseum keep the
manifest's names. In 1983/84 the Kansas City Kings, the San Diego Clippers, the
Washington Bullets at Landover (Maryland, so the Bullets hold Maryland), the
Pistons at Pontiac and the Cavaliers at Richfield; in 1998/99 the Lakers at the
Great Western Forum, the Hawks at the Georgia Dome and the Raptors at the Air
Canada Centre. From 1999/00 a franchise that kept its name and city takes
today's arena, as before. An era map ranks its teams as their franchises rank
today: the Kings, Clippers and Bullets as Sacramento, Los Angeles and Washington,
and the 1960s' and 1970s' by Basketball-Reference's codes (`LINEAGE` in
`scripts/build-club-maps.mjs`): the Philadelphia and San Francisco Warriors as
Golden State, the Syracuse Nationals as Philadelphia, the Cincinnati Royals and
Kansas City-Omaha Kings as Sacramento, the St. Louis Hawks as Atlanta, the
Packers, Zephyrs, Baltimore and Capital Bullets as Washington, the San Diego
Rockets as Houston, the Buffalo Braves as the Clippers, the New Orleans Jazz as
Utah and the New York Nets as Brooklyn.

An era map's file and index entry have `seasons` (the set ids it serves). Its
club rows name their franchise and carry no code, strength or squad: those come
from the season at kick-off, when each row takes its season club's name, code,
strength and five and keeps the map's land and colour. The loader accepts such a
map only with a sport. The index entry has no `top`: the setup names the chosen
season's own three strongest clubs once it has loaded.

## Earlier baseball seasons

Baseball has eight earlier seasons from MLB The Show, 2018 to 2025, one per edition (18
to 25): 2021 to 2025 read from each edition's own public API, 2018 to 2020 from the
fan site ShowZone's copies of Sony's cards (docs/design/baseball.md); the built-in
2026 is MLB The Show 26's. Each plays on its era's map (`mlb2018`, `mlb2019`,
`mlb2020`, `mlb2021`, `mlb2022`, `mlb2025`). They are data sets of `kind: 'show'` (`mlb-the-show-<nn>`), and unlike
an NBA season they field **nations** as well as clubs: `nations` holds each nation
with MLB players born there (`[strength, players, squad]`, the built-in shape), a
nation it does not list fielding no team (a minnow before 2026-11-09), and `clubs` the MLB of that year,
each `[name, 'SS/2B', rating]`, on its era's map (`mlb2021`, `mlb2022` for 2022–24,
`mlb2025`). A season's `season` is its calendar year ('2024'), not football's
'2023/24'. The built files, era maps, the Oakland Athletics and the edition whose
birthplaces are wrong are described in [baseball.md](baseball.md#earlier-seasons).

Before them come 58 seasons, 1960 to 2017 (`mlb-war-<year>`, the same `kind: 'show'`,
since 2026-11-09), which no game rated: each player's rating is computed from his WAR
and put on MLB The Show 18 to 24's scale rank for rank within his role. Their source
block says so (`computed: true`, `method`, `conversion`, `rawScale: 'WAR'`, which the
loader requires of an `mlb-war-` id), they are listed "Computed from WAR, end of
<year>", and they play on 37 era maps of their own (`mlb1960` to `mlb2017`). See
[baseball.md](baseball.md#seasons-before-2018-computed-from-war).

## Runtime

- `src/engine/footballSets.js`:
  - `loadFootballSetIndex()` lists the built-in earlier seasons of both sports
    (`BUILT_IN_SETS`, from `src/data/footballSeasons.js` and
    `src/data/basketballSeasons.js`; `setSportOf(id)` tells them apart) and the
    CM 01/02 sets built on this computer (`football/index.json`, read once;
    missing means none). A local file never stands in for a built-in season,
    and never adds a basketball one.
  - `loadFootballSet(id)` and `getLoadedFootballSet(id)` follow
    `src/engine/domestic.js`: one shared promise per id, failed loads not cached,
    a small LRU, and strict validation of format, id, version and tuples. A set
    is fetched from its sport's folder (`football/` or `basketball/`). A
    basketball set must name a basketball club map that serves it (an era map
    listing it, or today's) and have exactly that map's number of clubs.
  - `seasonSport(set)` returns `{ ...football, rosters, clubs, dataSet, dataVersion, dataYear, dataSeason, territory }`,
    or for a basketball season `{ ...basketball, clubs, clubMap, dataSet, … }`.
    It is memoised per decoded set, not per version, so an evicted set does not
    stay in memory. A men's football season with `identities` also gets
    `playsAs` from them (the Soviet Union on Russia's shape).
  - `sportOf(settingsOrSetup)` returns that sport, or the built-in sport for no
    set. A set plays only in its own sport, and a basketball one only with
    clubs.
- **Setup**:
  - Step 1 always has a **Season** dropdown for football (`#setup-season`, a
    native select): the built-in season, then each data set newest first,
    listed before any fetch. Options name the season alone ("2017/18"); a set
    that shares its season with another keeps its source ("2001/02 · CM 01/02
    · Test 2002"). A note says the earlier seasons use EA ratings and that
    nations without eleven rated players start short-handed.
  - Picking a set loads it, with the same loading, error and Retry block as a
    country map, and Launch waits for it.
  - A season with nations only (2005/06, 2004/05) takes Nations when chosen, and
    choosing Clubs goes back to the built-in season. With no Europe maps it keeps
    the plain theatre (`all` or `elite`), so Clubs opens on the built-in season's
    map of it. A challenge link that asks for clubs with such a season has its
    `teams` ignored.
  - Country maps are built from the built-in FM data, so the "One country" group
    is not offered for another set.
  - Basketball has its own Season dropdown: the built-in 2026/27, then its
    earlier seasons ("2007/08"), with a note that they use 2K Archive's NBA 2K
    ratings, that those no game rated, back to 1960/61, are computed from
    Basketball-Reference's statistics, fitted to NBA 2K and put on NBA 2K27's
    scale, and that they have NBA clubs only. Picking one switches Teams
    to clubs and the theatre to its map (`domestic:nba2008`); picking nations
    goes back to the built-in season. The map and the set load side by side, and
    Launch waits for both.
  - Changing sport resets a set of the other sport.
  - Setup caches key on the set version.
- **Launch**: `opening()` builds teams from `sportOf(setup)` and applies
  `territory`. Settings record `dataSet`, `dataVersion`, `dataYear` and
  `dataSeason`. The campaign name, map caption and saved-campaign rows carry
  the season (for example "Football 2007/08 · Europe"), only for set campaigns.
  While a chosen set loads, step 1 shows no built-in counts, and Launch waits for
  it.
- **Saves are self-contained.** A campaign never re-reads roster data after
  kick-off. The one exception is the v4 source index, which is built from the
  built-in rosters: a CM player never matches it, and an EA season's player
  shares at most an id with an FC 27 record, never its edition. (The index also
  lists its editions in each checkpoint, `sourceEditions`: a reference rebuilds
  only from a record of an edition its checkpoint named, so a checkpoint saved
  on the EA FC 26 built-in data never takes an FC 27 record's evidence.) So a set's
  players are packed the way country campaigns pack FM players: the set's own
  tuples under one `playerPack` header with `kind: 'cm0102'` or `kind: 'ea'`
  (whose source names the edition, update, snapshot date and roster), rebuilt
  exactly on load. Resuming
  or importing a set campaign needs no fetch, and works on a machine without
  that data set.
- **Same draw** and **New draw** (the elimination dialog's Try again, once
  Retry this setup) do need the set. They load the set first, show the
  loading state and any error in the elimination dialog, and proceed only if
  that dialog is still open. It plays the version of the set loaded now, which
  can differ from the saved `dataVersion`, as country maps can.
- `parseCampaign` accepts `dataSet` (`^cm0102-\d{4}-\d{2}(-[a-z0-9]+)?$`,
  `^cm-\d{4}$`, `^swos-\d{4}$`, `^wc-\d{4}$`, `^ea-(fifa|fc)-\d{2}$` or `^nba-2k\d{2}$`, among
  the other sports' kinds),
  `dataVersion` (`<dataSet>-<8 hex>`), `dataYear` (an integer from 1872 to 2100)
  and `dataSeason` (the season of `dataYear`), all four or none. It also rejects
  a set of another sport, a football set on a country map, a season with nations
  only played with clubs, a basketball set with nations or on any map but its
  own, and an era map without its season.

## Known limits

- The flag map behind the setup wizard shows every shape with its own flag.
  Step 1's theatre map card and the launched board apply the set's territory:
  merged federations are held by their holder, and inactive shapes are
  unclaimed.
- Serbia keeps its modern name and flag in its FR Yugoslavia and Serbia and
  Montenegro years from 1996/97, which were built before identities; 1995/96
  shows FR Yugoslavia, and 1994/95, whose SWOS has no Yugoslavia squad, leaves
  Serbia neutral.
- Seasons ending before 1962 are refused.
- East Germany has no shape on the map, so it never fields a team, and its
  players, where a database lists them as Germany's, play for West Germany, but
  in Simon Treanor's 1989/90, where a 'Germany' player at an East German club
  plays for no nation. That rule places a club by its stadium's city: an East
  German playing in the West (Andreas Thom joined Leverkusen in December 1989; the
  database still has him at Dynamo Berlin) would count as West German, and
  Berlin's clubs are placed by hand (the database gives Hertha's reserves the
  Jahn-Sportpark, in the east; they count as West German).
- Only the seven federations of the day play under names of their own. Other
  nations of 1961/62 to 1995/96 play under today's names and flags (Swaziland as
  Eswatini, Burma as Myanmar, Upper Volta as Burkina Faso), and so does the DR
  Congo before Zaire.
- FIFA dates many admissions by the year alone (1 January). A nation admitted
  after 30 June of that year counts one season early.
- Colonies stay neutral until their association joined FIFA; the map draws no
  colonial empires. Rhodesia's standing with FIFA from 1970 to 1980 has no dated
  source here and is not encoded: Zimbabwe counts from 1964/65, FIFA's date.
- Suspensions from 1996/97 on are not encoded: they would change the seasons
  already shipped.
- The CIS's flag is the one Wikipedia shows for its team at Euro 1992 (Commons:
  Flag of the CIS (UEFA Euro 1992).svg), drawn by the Commons user B1mbo.
- League detection uses stored competition names and CM0102Patcher's renames. A
  top division renamed some other way is reported missing, not guessed.
- EA seasons cover the nations EA rates: 91–124 of the 173 field fewer than
  eleven natural players each season, more in the older editions (EA never rated
  a Tongan, Samoan or Cook Islands player, so those three field no team). Seasons before
  2004/05 have no EA source here (the FIFA Index mirror starts with FIFA 05);
  2002/03 to 1994/95 come from SI's and Sensible Software's databases instead,
  1993/94 and 1989/90 from fans', and 2003/04 from none the game ships (SI's CM
  03/04 database is in a format no one has documented).
- CM 00/01 and CM 99/00 are read from users' uploads of the retail CDs to
  archive.org, which can go dark; the pinned SHA-256 and MD5 digests let any copy
  of the same CD feed the build (`--image`). CM 00/01 is the UK release-day
  database, a few transfers short of SI's later European pressing.
- 2005/06, 2004/05, 1996/97 and 1989/90 have no clubs, and a local CM 01/02
  database is the only way to clubs in 2005/06 and 2004/05.
- 1993/94 and 1989/90 rate as their makers rated, fans, not as any game's maker
  did, and 1993/94 keeps CM 01/02's league sizes (a 20-club Premier League, an
  18-club French First Division). Simon Treanor's 1989/90 is a beta whose readme
  says many teams keep squads of the early 2000s. Each has one wild rating at its
  top, shipped as its maker set it: 1993/94's Vassilis Ioannidis (99, Greece) and
  1989/90's Jan Möller (98, Sweden's goalkeeper).
- SWOS 94/95 and 95/96 keep each club's own sixteen, so a player SWOS files at two
  top-division clubs plays for both (18 and 20 names, mostly namesakes), and
  1995/96's Bordeaux fields Jean-Luc Dogon's two records. Their clubs score nearly
  four goals a game ([How they play](#how-they-play)).
- The CM seasons' clubs score more and draw less than EA's and than real
  leagues (3.4–3.6 goals a game and 18–20% draws), CM's current ability spreading
  a league wider ([How they play](#how-they-play)); CM 97/98's scale also runs
  about 4.7 rating points above CM3's for the same players.
- SWOS 96/97 rates by price alone: its keepers have no other rating, and every
  player's rating follows the sum of his skills, not how a position uses them.
  Some minor nations' squads in it predate 1996.
- CM 97/98 comes from an extraction of unknown tool and game version, with no
  second copy to check its values against; its names are stored first name
  first ("González Blanco Raúl"), and it has no dates of birth.
- A nationality from a later edition can differ from the one EA gave that year,
  as it does for 0.92% of FIFA 07's players. A player who changed federation later
  plays for the later one.
- An EA season's XI is the best by EA nationality, like the built-in data, not
  the squad a national coach picked.
- In FIFA 07 to FIFA 10 wingers play as midfielders: FIFA Index has no `LW` /
  `RW` in those editions, and its `LWM` / `RWM`, its label for EA's wingers
  (C. Ronaldo, Robben, Joaquín), map to `LM` / `RM`.
- The Source column shows a season's `snapshotDate`: for FIFA 07 to FIFA 11 the
  February roster's date, though the ratings are August's (`ratingsDate`).
- FIFA Index's FIFA 07 and FIFA 08 overalls are one point lower than a second
  database's (the European Soccer Database on Kaggle) for about 35–40% of
  players; the build uses FIFA Index's.
- Basketball seasons have no national teams, and none before 1960/61 (the
  user's floor; no BAA or ABA). 36 of them are computed, not a game's ratings
  ([Computed seasons](#computed-seasons-196061-to-199798)), and their limits are
  the score's:
  - Specialists rate low and scorers on weak clubs high, as PER and win shares
    see them: in 1995/96 Dennis Rodman is not in the Bulls' five (Toni Kukoč
    starts), so the 72–10 Bulls are only the fourth-strongest club (86, behind
    Orlando's 89); in 1996/97 (69–13) four clubs match their 86, behind Houston
    and Seattle; and nine clubs rate above the 63–19 champion Pistons of
    1988/89 (84).
  - A player traded during a season counts only for the club he played the most
    minutes for, 5.6% of all starters: Wilt Chamberlain plays 1964/65 for the
    San Francisco Warriors, not the 76ers he finished it with; Clyde Drexler
    1994/95 for Portland, not the champion Rockets; Bob McAdoo 1976/77 for the
    Knicks.
  - A club's 13 by minutes can hold a player who missed most of the season, and
    he is rated on the games he played (PER and WS/48 are shrunk by minutes, his
    points, rebounds and assists a game are not), so he starts all season: 56 of
    the 3,515 starters played under 40% of the season's games, among them Bob
    Rule (4 games in 1970/71, rated 85), Larry Bird (6 in 1988/89, 83) and David
    Robinson (6 in 1996/97, 82).
  - Club strengths spread less than the games' seasons (standard deviation 1.37
    to 2.37 against 1.80 to 3.70), and follow real results least in 1964/65,
    1975/76, 1976/77 and 1977/78 (0.51 to 0.61 against SRS).
  - Positions are Basketball-Reference's modern labels given retroactively, and
    the second position is derived. Names are Basketball-Reference's too, each
    player's latest: Kareem Abdul-Jabbar in 1969/70 and 1970/71, when he played
    as Lew Alcindor, and Hakeem Olajuwon before 1991, when he was Akeem. Ratings
    use NBA 2K27's spread, so a 1960s league plays with today's distribution of
    talent.
  - Neighbouring seasons mix sources: 1983/84 and 1991/92 (MyNBA Eras) lack the
    players 2K has no licence for (Andrew Toney; Charles Barkley and Reggie
    Miller), while the computed 1982/83, 1984/85, 1990/91 and 1992/93 have them.
  - The match engine is today's NBA one at each season's pace and scoring rate:
    a fourth overtime's deciding basket can be a three before the NBA had the
    three-point line (1979/80), the bench takes the modern 32% of a side's points
    though 1960s starters played more, and 1960s games run near 127 possessions,
    inside the engine's range but far from the seasons it was tuned on.
  - One arena per franchise and season: a split home schedule (the Kansas
    City-Omaha Kings, the Braves' games in Toronto, the Royals' in Omaha) plays
    at Basketball-Reference's main arena, so a franchise holds one state.
- Era maps follow franchises that changed city, not moves within one area:
  seasons from 2014/15 use today's arenas, so the Warriors' territory is named
  San Francisco though they played in Oakland until 2019, and the Clippers'
  Inglewood though they played in Los Angeles until 2024. The New Jersey Nets
  are placed at East Rutherford for their Newark season (2010/11), and the
  Pistons at Detroit for their Auburn Hills years (until 2016/17).
- A franchise's code and colour are the game's when it kept its id; a moved one
  gets a code and colour of its own, not its historic ones.
- The computed World Cup seasons (1961/62 to 1993/94) rate the team more than the
  player: the nation's Elo explains 66–78% of a season's rating variance, and the
  gaps inside an XI are today's average shape (D), not a measurement of the day.
  Before 1995 the Ballon d'Or voted on Europeans only, so a non-European XI is
  ordered by World Cup awards, goals a minute and minutes (Pelé, 90, follows
  Jairzinho, 93, in 1969/70), and goals a minute lifts a substitute who scored.
- Their XI is a 4-4-2 by the database's positions. A 4-2-4 or 4-3-3 side loses
  its third forward (Tostão in 1969/70), and a role short of players who played
  (a WM side's midfield, or one whose listed players sat out) takes the
  most-used players left, out of position, 12 points below their rating in the
  lineup: 29 of the 1,925 XI places, 21 of them in 1961/62 and 1965/66. Each
  such place costs the nation about 1.1 of its strength: Brazil's 1962 XI, with
  Zagallo and Amarildo for Zequinha and Mengálvio, who never played, is 85
  strong for a T of 87, and Pelé (180 minutes) sits out. A tie goes to the lower
  shirt number, so Mexico's 1966 midfield takes Antonio Carbajal, a goalkeeper
  who played one match, before four outfielders who also played one.
- They field only the World Cup's 15–24 finalists, so no Elite 32, and Africa,
  Asia and North America never reach four sides. The Elo is computed from results
  alone: Asian and North American sides rate higher than SWOS's ratings of autumn
  1994 put them, and the scale is narrower than eloratings.net's.
- East Germany, with no shape, fields no team, so 1973/74 has 15 finalists.

## Invariants kept

- Data sets leave the built-in data path alone: building or loading one never
  regenerates `src/data/rosters.js` or `clubs.football.js`, and the seed-replay
  golden, save-size budgets and roster tests pass unchanged. (Moving the
  built-in season to 2026/27 regenerated those files, and the golden with them.)
- No CM 01/02 data set file, database file or derived player list is committed,
  but for the five built-in ones the user chose to ship (SI's 3.9.68 and 3.9.60,
  the CM3 port, and Cam F's and Simon Treanor's fan-made databases), with CM
  00/01's, CM 99/00's, CM 97/98's and the three SWOS editions': the seasons, not the database files. The EA seasons are committed on the same terms as the built-in EA FC 27
  data.
- The domestic pack format is unchanged. A pack without `kind` is FM.
