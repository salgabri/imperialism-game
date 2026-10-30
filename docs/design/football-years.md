# Football years: data sets beyond the built-in season

Status: implemented for local CM 01/02 data sets, 2026-10-24; the built-in
earlier seasons from EA's FIFA 15 – EA FC 24 launch rosters and an
always-visible Season choice, 2026-10-30. The CM 01/02 path has not yet run on a
real database (the files need a forum login). Sources and terms are in
[football-year-sources.md](football-year-sources.md); the permission requests in
[football-year-permissions.md](football-year-permissions.md).

## Goal

A football campaign can be played on a **data set** other than the built-in one.
A data set is one dated database turned into nations and clubs. There are two
kinds:

- **The built-in earlier seasons** (2014/15 to 2023/24): one EA FIFA / FC launch
  roster each, committed under `public/football/ea-*.json` and offered in every
  setup. See [Built-in earlier seasons](#built-in-earlier-seasons).
- **Local CM 01/02 seasons**: a Championship Manager 01/02 database the user has
  downloaded, built on their computer. Until the database authors allow
  redistribution these stay local: the user puts the database in the ignored
  `data-src/cm0102/`, and the command-line builder writes the data set to
  `public/football/cm0102-*.json`, which git ignores. When permission arrives,
  those files can be committed by removing one `.gitignore` line, and its scope
  should be recorded in the permissions note first.

The built-in data (EA FC 26 + FM 26, season 2025/26) stays the default and does
not change: same files, same seeds, same saves.

## Terms

- **Data set id**: `cm0102-<yyyy>-<mm>`, from the database's release month, e.g.
  `cm0102-2026-05` (May 2026 update, season 2025/26). Two releases in one month
  take their variant as a suffix (`cm0102-2012-03-odb`, `cm0102-2012-03-sim`).
  An EA season is `ea-fifa-<nn>` or `ea-fc-<nn>` after its edition
  (`ea-fifa-18`, `ea-fc-24`). The built-in data has no id (`null`).
- **Year**: the season-end year, as in the sources note. `cm0102-2026-05` is year
  2026 and season "2025/26", like the built-in data, so a season can have several
  data sets (the built-in one, CM's December and May updates).
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
databases are recognised the same way. The builder also estimates the birth-year
shift from famous players' known birthdays, counting each person once. For an
unknown folder, a conclusive estimate that disagrees with `--dob-shift` stops
the build. For a known release, it raises a loud warning and the manifest's shift
is kept.

**Seasons ending before 2002 are refused for now.** SI's own 2001/02 database is
the first one accepted (year 2002), and its 3.9.68 patch carries 2002/03 squads
(year 2003). Earlier seasons come from retro databases (1984/85 and others) that
use the Soviet Union, Yugoslavia, Czechoslovakia and East and West Germany.
Those need identity overrides (name, code, flag) as well as territory, which
comes next.

### Federations by year

A game nation takes part in year Y if its association was a FIFA member by
30 June Y, the end of season Y. From 2002 that affects five shapes:

| Shape | Until | Before then |
| --- | --- | --- |
| Montenegro (499) | 2006 | held by Serbia (688): FR Yugoslavia, then Serbia and Montenegro. FIFA member 31 May 2007 |
| New Caledonia (540) | 2003 | held by France (250), as a French territory. FIFA member 2004 |
| Timor-Leste (626) | 2005 | neutral. FIFA member 12 Sep 2005 |
| South Sudan (728) | 2011 | held by Sudan (729) to independence. FIFA member 25 May 2012 |
| Kosovo (KOS) | 2015 | neutral. FIFA member 13 May 2016 |

Serbia keeps its modern name and flag in those years. Showing "Serbia and
Montenegro" needs the same identity overrides as the pre-2002 seasons.

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
  "coverage": { "players": 0, "nations": 0, "completeXIs": 0, "clubs": 0, "leagues": 0 }
}
```

- `nations` has an entry for **every** one of the 173 nations, even an empty
  one, so the hand-tuned built-in `fallbackStrength` never applies to another
  season. A set built before the map had the home nations lists none of
  `SCO`, `WAL` and `NIR`: it still loads, and England holds their land. An empty entry is `[40, 0, []]`, which is what `build-rosters` writes
  for an empty pool.
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

Ten seasons ship with the game, 2014/15 to 2023/24: the launch roster (update 2)
of each EA edition from FIFA 15 to EA FC 24, from one Kaggle export
(`stefanoleone992/ea-sports-fc-24-complete-player-dataset`, `male_players.csv`,
180,021 rows, labelled CC0 by its compiler; EA's own rights are not cleared, as
for the built-in EA FC 26 data). `scripts/data/ea-seasons.json` names the export,
its download link and SHA-256, and the editions. `npm run build:ea-seasons`
(`scripts/build-ea-seasons.mjs`, logic in `scripts/lib/ea-seasons.mjs`) stops on
any other file, so every season rebuilds byte for byte. It writes:

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
  `Brunei Darussalam`) map nationalities to game nations. `EA_NO_TEAM` lists the
  nationalities without a shape on the map (Malta, the Faroe Islands and other
  small states); their players still play for their clubs. Scotland, Wales and
  Northern Ireland have shapes and teams. Any other unmapped name stops the build. Each nation fields
  its best natural XI with the squad pick the built-in rosters use. EA rates
  only part of the world, so 73–82 nations a season field a full XI and the rest
  keep the players they have (an empty nation plays at 40).
- **Clubs by competition id.** The export names each club's league as it is in a
  later edition (FIFA 15's Burnley is in "Championship"), but its `league_id` is
  the edition's own, so clubs are taken from ids 13, 53, 31, 19, 16, 10 and 308,
  the club layer's seven leagues. A club needs a natural XI, as build-clubs
  requires: 132–134 clubs a season. Ids, codes and colours come from the same
  `presentClubs` as the CM builder.
- **Territory** is `territoryFor(FOOTBALL_FEDERATIONS, year)`, as for CM sets:
  Kosovo has no team in 2014/15.
- **Ratings** are EA's overall, 1–99, unchanged.

An EA set's `source` is `{ provider: 'EA Sports', edition: 'FIFA 18', update: 2,
roster: '180002', snapshotDate: '2017-09-18', url: <the export's page>, rawScale:
99 }`, with no `conversion`. A player tuple is `[eaId, name, fullName | 0,
overall, 'ST,LW', nationality, club, dateOfBirth, slug]`. `expandEaTuple` in
`src/data/eaPlayers.js` rebuilds the game's `[name, pos, rating, sourceInfo]`,
with `source: 'ea-fc'`, the edition, update, snapshot date and the player's
SoFIFA page for that roster, and `eaTupleOf` folds it back. The Source column
reads "FIFA 18" and links to that page.

## Runtime

- `src/engine/footballSets.js`:
  - `loadFootballSetIndex()` lists the built-in earlier seasons (`BUILT_IN_SETS`,
    from `src/data/footballSeasons.js`) and the CM 01/02 sets built on this
    computer (`football/index.json`, read once; missing means none). A local file
    never stands in for a built-in season.
  - `loadFootballSet(id)` and `getLoadedFootballSet(id)` follow
    `src/engine/domestic.js`: one shared promise per id, failed loads not cached,
    a small LRU, and strict validation of format, id, version and tuples.
  - `footballSport(set)` returns `{ ...football, rosters, clubs, dataSet, dataVersion, dataYear, dataSeason, territory }`.
    It is memoised per decoded set, not per version, so an evicted set does not
    stay in memory.
  - `sportOf(settingsOrSetup)` returns that sport, or the built-in sport for no
    set.
- **Setup**:
  - Step 1 always has a **Season** dropdown for football (`#setup-season`, a
    native select): the built-in season, then each data set newest first,
    listed before any fetch. Options name the season alone ("2017/18"); a set
    that shares its season with another keeps its source ("2001/02 · CM 01/02
    · Test 2002"). A note says the earlier seasons use EA ratings and that
    nations without eleven rated players start short-handed.
  - Picking a set loads it, with the same loading, error and Retry block as a
    country map, and Launch waits for it.
  - Country maps are built from the built-in FM data, so the "One country" group
    is not offered for another set.
  - Basketball has no sets and resets the choice.
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
  shares at most an id with an FC 26 record, never its edition. So a set's
  players are packed the way country campaigns pack FM players: the set's own
  tuples under one `playerPack` header with `kind: 'cm0102'` or `kind: 'ea'`
  (whose source names the edition, update, snapshot date and roster), rebuilt
  exactly on load. Resuming
  or importing a set campaign needs no fetch, and works on a machine without
  that data set.
- **Retry this setup** does need the set. It loads the set first, shows the
  loading state and any error in the elimination dialog, and proceeds only if
  that dialog is still open. It plays the version of the set loaded now, which
  can differ from the saved `dataVersion`, as country maps can.
- `parseCampaign` accepts `dataSet` (`^cm0102-\d{4}-\d{2}(-[a-z0-9]+)?$` or
  `^ea-(fifa|fc)-\d{2}$`),
  `dataVersion` (`<dataSet>-<8 hex>`), `dataYear` (an integer from 1872 to 2100)
  and `dataSeason` (the season of `dataYear`), all four or none. It also rejects
  a set on basketball or on a country map.

## Known limits

- The flag map behind the setup wizard shows every shape with its own flag.
  Step 1's theatre map card and the launched board apply the set's territory:
  merged federations are held by their holder, and inactive shapes are
  unclaimed.
- Serbia keeps its modern name and flag in its Serbia and Montenegro years.
- Seasons ending before 2002 need historic federations and are refused.
- League detection uses stored competition names and CM0102Patcher's renames. A
  top division renamed some other way is reported missing, not guessed.
- EA seasons cover the nations EA rates: about 95 of the 173 field fewer than
  eleven natural players each season. Seasons before 2014/15 have no EA source
  and need a local CM 01/02 database.
- An EA season's XI is the best by EA nationality, like the built-in data, not
  the squad a national coach picked.

## Invariants kept

- The built-in data path is untouched: `src/data/rosters.js` and
  `clubs.football.js` are not regenerated, and the seed-replay golden,
  save-size budgets and roster tests pass unchanged.
- No CM 01/02 data set file, database file or derived player list is committed.
  The EA seasons are committed on the same terms as the built-in EA FC 26 data.
- The domestic pack format is unchanged. A pack without `kind` is FM.
