# Football years: data sets beyond the built-in season

Status: implemented for local data sets, 2026-10-24; seasons added in the
browser (Add a season…) and an always-visible Season choice, 2026-10-30. Not yet
run on a real database (the files need a forum login). Sources and terms are in
[football-year-sources.md](football-year-sources.md); the permission requests in
[football-year-permissions.md](football-year-permissions.md).

## Goal

A football campaign can be played on a **data set** other than the built-in one.
A data set is one dated database turned into nations and clubs. Today the only
source is a Championship Manager 01/02 database the user has downloaded. The
built-in data (EA FC 26 + FM 26, season 2025/26) stays the default and does not
change: same files, same seeds, same saves.

Until the database authors allow redistribution, data sets are **local**. The
user downloads a database and either adds it in the game (**Add a season…**,
which keeps the data set in the browser's IndexedDB) or puts it in the ignored
`data-src/cm0102/`, where the command-line builder writes the data set to the
ignored `public/football/`. Nothing derived from the database is committed. When
permission arrives, the built files can be committed by removing one
`.gitignore` line, and its scope should be recorded in the permissions note
first.

## Terms

- **Data set id**: `cm0102-<yyyy>-<mm>`, from the database's release month, e.g.
  `cm0102-2026-05` (May 2026 update, season 2025/26). Two releases in one month
  take their variant as a suffix (`cm0102-2012-03-odb`, `cm0102-2012-03-sim`).
  The built-in data has no id (`null`).
- **Year**: the season-end year, as in the sources note. `cm0102-2026-05` is year
  2026 and season "2025/26", like the built-in data, so a season can have several
  data sets (the built-in one, CM's December and May updates).
- **Version**: `<id>-<8 hex>`, the first 8 hex of the SHA-256 of the data set
  file's content without its `version` field. A save names the version it was
  built from.

## Pipeline

```
data-src/cm0102/<folder>/Data/*.dat        a Data folder chosen with Add a season…
        │  npm run build:football-set            │  src/engine/seasonImport.js (lazy chunk)
        ▼                                        ▼
src/data/cm0102.js        parse the binary files (pure; Node and browser)
src/data/footballSetBuild.js  build the data set (pure; Node and browser), from:
src/data/cm0102Releases.js   known databases: label, season, release date, topic URL, DOB shift, file signature
src/data/cm0102Nations.js    CM nation name → game nation id, plus names deliberately without a team
src/data/footballFederations.js  per year: shapes held by another federation, shapes with no federation
        ▼                                        ▼
public/football/<id>.json (ignored)      IndexedDB imperialism-football-sets
public/football/index.json (ignored)       (src/engine/localSets.js)
        ▼                                        ▼
src/engine/footballSets.js  list both, load (the browser's copy first), validate, decode; year-bound sport
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

## Adding a season in the browser

**Add a season…** builds a data set from a Data folder the player chooses, with
the same builder and manifests as the command line, so both make the same file.

- **Choosing the folder.** The button opens a folder picker (`webkitdirectory`).
  `dataFolderOf` groups the chosen files by folder and takes the one folder that
  holds all ten files the reader opens (`CM_DATA_FILES` in `src/data/cm0102.js`:
  index, continent, nation, club, club and nation competitions, the three name
  tables and staff), matching base names in any case. Picking the game folder
  around `Data` works. Two complete Data folders are refused rather than
  guessed between, and a packed `.zip`, `.rar` or `.7z` gets a hint to extract
  it. Only those ten files are read, so histories and stadiums stay unread.
- **Known releases only.** The browser has no flags to name an unknown database,
  so a folder that is not one of the 48 known releases is refused, with a
  pointer to the command-line builder. Every known release ends in 2002 or later.
- **Building.** `src/engine/seasonImport.js` reports `reading`, then `building`,
  and waits for a paint (or 100 ms when the page is not drawn) before the
  synchronous build. Unmapped nations do not stop the build
  (`allowUnmapped: true`): their players are left out and counted in the
  status line. The digests of `club.dat` and `staff.dat` are checked as on the
  command line, and a mismatch is reported as a possibly edited copy. The doc
  must pass `decodeFootballSet` before it is stored.
- **Storage.** `src/engine/localSets.js` keeps one IndexedDB database
  (`imperialism-football-sets`, version 1) with two object stores written in
  one transaction: `listing` (the index entry plus `addedAt`, keyed by `id`) and
  `sets` (the data set file). The Season list reads only `listing`. Where
  IndexedDB is missing or refuses to open, seasons are kept in memory and the
  status line says the season lasts until the page closes.
- **Listing and loading.** `loadFootballSetIndex()` reads `football/index.json`
  once and the browser's listing on every call, marks the browser's sets
  `added: true` and lets one stand in for a file with the same id.
  `loadFootballSet(id)` reads the browser's copy first and fetches the file only
  without one. A 404 says the set is neither in this browser nor built on this
  computer, as for a season added in another browser.
- **After an import** the listing is read again, the new season is chosen, and
  the status line reads "Added 2007/08 · CM 01/02 · November 2007. N of 170
  nations field a full XI; M clubs from L leagues.", from the set's coverage.
  Adding the same
  folder again says "Already added"; a different build of the same release says
  "Updated". **Remove from this browser** appears for a chosen added season; it
  deletes both records, and a setup on that season goes back to the built-in one.

## Runtime

- `src/engine/footballSets.js`:
  - `loadFootballSetIndex()` lists the sets built on this computer
    (`football/index.json`, missing means none) and those added in this browser.
  - `loadFootballSet(id)` and `getLoadedFootballSet(id)` follow
    `src/engine/domestic.js`: one shared promise per id, failed loads not cached,
    a small LRU, and strict validation of format, id, version and tuples.
  - `footballSport(set)` returns `{ ...football, rosters, clubs, dataSet, dataVersion, dataYear, dataSeason, territory }`.
    It is memoised per decoded set, not per version, so an evicted set does not
    stay in memory.
  - `sportOf(settingsOrSetup)` returns that sport, or the built-in sport for no
    set.
- **Setup**:
  - Step 1 always has a **Season** choice for football: the built-in season,
    then each data set newest first, then **Add a season…** with its status
    line, and **Known seasons**, a collapsed list of the 48 releases (latest
    first) that links each to its forum download page and marks the ones
    added. The Season list has its own classes (`.setup-season`), so
    `.setup-theatre` still means a Theatre row.
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
  built-in rosters and so never matches a CM player. So a set's players are
  packed the way country campaigns pack FM players: `[cmId, …]` tuples under one
  `playerPack` header with `kind: 'cm0102'`, rebuilt exactly on load. Resuming
  or importing a set campaign needs no fetch, and works on a machine without
  that data set.
- **Retry this setup** does need the set. It loads the set first, shows the
  loading state and any error in the elimination dialog, and proceeds only if
  that dialog is still open. It plays the version of the set loaded now, which
  can differ from the saved `dataVersion`, as country maps can.
- `parseCampaign` accepts `dataSet` (`^cm0102-\d{4}-\d{2}(-[a-z0-9]+)?$`),
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
- Add a season… builds on the page's main thread. With the padded test folder
  (44 MB) it takes under a second; a real database has not been timed yet.
- A season added in the browser lives in that browser profile only. A save
  exported to another browser still resumes (saves are self-contained), but
  Retry this setup there needs the season added again.
- Browsers may clear IndexedDB under storage pressure; the game does not ask
  for persistent storage.

## Invariants kept

- The built-in data path is untouched: `src/data/rosters.js` and
  `clubs.football.js` are not regenerated, and the seed-replay golden,
  save-size budgets and roster tests pass unchanged.
- No data set file, database file or derived player list is committed.
- The domestic pack format is unchanged. A pack without `kind` is FM.
