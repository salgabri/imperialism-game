# Domestic campaigns: a country's top clubs on its own map

Status: implemented, 2026-10-19. This describes the system as built; the code
comments in the files named below are the detailed reference.

## Goal

In club mode, with football, the player can pick **one country**. Its top 100
Football Manager 26 clubs (fewer when the database has fewer viable clubs) fight
over **that country's map**, split into one section per club and built from the
country's real administrative divisions. Each club starts on the section around
its home town. Conquest follows the existing rules: the winner annexes
everything the loser holds and claims one player.

The world campaigns (nations, the 132-club European layer, NBA clubs, both
sports) are unchanged: same geometry, seeded outcomes, saves and rendering.

**What ships:** 128 countries (of the game's 170 nations; the other 42 have fewer
than 10 viable clubs), **6,205 clubs**, 22 countries with the full 100, the
smallest with 10. Maps total 17.9 MB (6.2 MB gzipped), 22–248 KB per country,
fetched only when chosen. The generated index is 20 KB.

## Pipeline

Two offline stages; nothing is fetched from these services at runtime.

| File | Role |
| --- | --- |
| `scripts/sync-domestic-clubs.mjs`, `scripts/lib/domestic-sync.mjs`, `scripts/lib/domestic-locate.mjs` | Stage 1 (network, cached): EFEM clubs and squads, home towns → snapshots. |
| `scripts/data/domestic/<id>.json`, `survey.json` | Committed snapshot per nation (written only when N ≥ 10); the survey records every nation's club-list estimate. |
| `scripts/data/domestic-locations.json` | Manual home-town overrides, keyed by FM club id. |
| `scripts/data/domestic-names.json` | Real names for FM's placeholder club names, keyed by FM club id. |
| `scripts/build-domestic.mjs`, `scripts/lib/domestic-boundaries.mjs`, `scripts/lib/domestic-partition.mjs` | Stage 2 (cached downloads, worker threads): boundaries + snapshot → sections. `--only=826,724`, `--jobs=N`, `--check`, `--dry-run`. |
| `public/domestic/<id>.json` | Shipped country file (format 1, below). |
| `public/domestic/ATTRIBUTION.txt` | Generated: every country's boundary source, licence, cuts and fills, plus GeoNames, Wikidata, Natural Earth and EFEM notes. |
| `src/data/domestic.js` | Generated index `{ id, name, clubs, version, level, top }` for the setup screen. |
| `docs/design/domestic-audit.json` | Generated build report: layer, units, splits, drops, cuts, fills, placed clubs, home-in-section, sizes. |
| `src/data/fmPlayers.js` | FM conversion shared by scripts and browser (`FM_ROLES`, `fmGameRating`, `expandFmTuple`). |
| `src/engine/domestic.js`, `src/data/domesticScope.js` | Runtime loader, cache, surroundings and scope helpers. |

Every download is cached under the ignored `data-src/` (`domestic/efem`,
`domestic/wikidata`, `domestic/geonames`, `boundaries/gb`, `boundaries/ne`,
`boundaries/geonames`), so reruns are offline. Requests send the User-Agent
`imperialism-game-build/1.0 (offline data build)`. EFEM: three at a time, 0.5 s
apart per slot, three retries with backoff on network errors, 429, 5xx and empty
bodies. Wikidata: one at a time, 1 s apart. Boundary downloads: one at a time
(worker threads ask the main thread), 0.5 s apart, four tries. Nominatim is never
used. From a warm cache the sync takes about 25 s and the build about 37 s.

## Stage 1: clubs, squads, home towns

### Sources

| Need | Source | Licence / terms |
| --- | --- | --- |
| Clubs, reputation, competition | EFEM.club FM26 `api/clubs/filter`, version 26.3.0 | as the existing FM supplement; not affiliated with SI or EFEM |
| Squads | EFEM.club FM26 `api/players/filter`, every male 26.3.0 player | as above |
| Home towns | Wikidata SPARQL; GeoNames `cities1000`; manual overrides | CC0; CC BY 4.0 (attributed) |

### Club lists

One nation, male, by reputation, in pages of 100 (exact FM nation name; the FM
name differs for 16 nations, e.g. `China PR`, `Türkiye`; Chinese Taipei uses a
contains match because EFEM's filter parser rejects parentheses):

```
/api/clubs/filter?filterString=pageSize=100&page=<p>&version=26.3.0
  &filter=gender%3D0,nation%3D<FM nation>&orderBy=reputation%20desc
```

EFEM orders clubs of equal reputation differently on every request, so a tie
across a page boundary repeats some clubs and drops others. The reputation at the
end of each page is therefore re-read whole (`...,reputation=<v>`, `pageSize=2000`).
The lister throws when a page and its re-read disagree, when a club repeats
outside a re-read, or when the distinct total differs from `count` once every page
is read. Rows are kept only when `nation.nationCode` matches (Lebanon, Mongolia,
Sudan and Kosovo accept a second code), then sorted by reputation, `efemScore`,
`clubId`.

### Players

The player grid's `clubName` filter matches FM's internal short names
(`R. Madrid`), so name searches miss squads, and paging a Current Ability sort
skips tied players. Instead every male player is read once, in slices that fit
one page: `playerbase.gender=0`, an exact `currentAbility`, and an age range
halved until the slice is at most 5,000 (`pageSize=1` probes first). That is 215
slices covering all 489,968 players of 29,118 clubs; squads are grouped by exact
`clubId`. The list carries only the contract club, so **loans are not applied**
(see Limitations).

### Selection

A club is **viable** when it is male; not an all-star, age-group (U-21, Sub-20),
or school/university side (school words count only outside senior competitions:
Orbit College plays top-flight football); not a reserve, B/II, `Jong`, academy,
`Development`, `Akatemia`, `Amateurs`, youth or `Juunior` side of a *stronger club
of the same nation* (so Willem II and Negombo Youth stay); has at least 11 listed
players; and has at least 11 natural-position players (FM proficiency ≥ 90)
including a natural goalkeeper. `EXCLUDED_CLUBS` in `domestic-sync.mjs` takes
clubs the rules miss (currently none). A club without an FM competition stays in,
shown as "Regional football". Viable clubs are taken in rank order up to
**N = min(100, viable)**; a nation ships when N ≥ 10. Every excluded club ranked
above the cut is listed with its reason in the snapshot.

**Squads.** Up to 16 players: the strongest natural 4-4-2 in the game's own roles
(`FM_ROLES`, so wingers are forwards), seated in Current Ability order by
augmenting paths so a two-role player never blocks a shirt only someone else can
wear; then the best remaining by Current Ability. Tuples are
`[fmId, name, currentAbility, 'natural,keys', nationCode|null]`, exactly what
`expandFmTuple` reads (rating `round(CA × 99 / 100)`).

**Names.** FM's own names, except FM placeholders replaced from
`domestic-names.json` (12 entries: seven Portuguese, e.g. `BRG` → SC Braga, and
five Indian), whose FM names are kept as `fmName`/`fmShort`. Nine genuine
all-capitals names (AIK, GAIS, ÍBV, …) are listed without a replacement. The sync
stops on a taken club named in 2–5 capitals with no entry, and when an entry's FM
name has changed.

### Home towns

Layered and deterministic; each location records its `source`:

1. **Override** (`override`): `{ lon, lat, note }` or `{ qid }`, plus a reader's
   `name`. 848 entries (839 in use). Points are GeoNames towns unless the note
   cites another source; a note starting `approximate:` marks a region-level
   point from the club's competition or a province in its name (97 in use).
2. **Wikidata** (`wikidata:Q..`, with `via`): items with `P31/P279* Q476028`, or
   sports clubs (`Q847017`) with sport football, and `P17` = the country (plus Q55
   for the Netherlands); labels and aliases in English, `mul`, the official
   languages and a few regional ones. Point priority: venue `P115/P625`, `P625`,
   HQ `P159/P625`, `P131/P625`; a point more than 50 km from every GeoNames town
   of the country is skipped. Matching: multi-word exact or core-name matches
   first, then one-word and leading-word subset matches pooled by sitelinks,
   dissolved items last and women's items never; each item is used once, in
   reputation order; Brazilian state hints (`(SP)`). When the club name holds a
   town, the item's first point within 50 km of it is used, and a weak match
   whose own names hold another town must lie within 15 km of the club's town.
3. **GeoNames** (`geonames:<id>`): the longest `cities1000` place name inside the
   club name. A place's own name beats other places' alternate names; alternate
   names count only from places with a population, and shortened ones are weakest
   (unless the place is a big city). Generic words (real, united, rovers, dinamo,
   Slavic old/new/upper/lower, …) never name a town; German adjectival `-er` and
   Finnish genitives are undone; a saint's name after "de" counts as a town. A
   province named in the club name or competition limits the search to it, and a
   club with no town there stays unlocated (with a warning).

Coverage: 4,135 Wikidata, 839 override, 1,145 GeoNames, **86 with no home**. The
sync warns about points far from any town and provinces with no matching town;
four warnings remain (Cobresal, Wolmido, Nedjm Chabab Magra, 31–44 km from a
town; Espoir du Burkina, unlocated).

## Stage 2: sections

Inputs besides the snapshots: geoBoundaries gbOpen layers (per-layer licence),
Natural Earth 10m admin-1 v5.1.2 (public domain), GeoNames `cities1000` and, for
garbled layers, country files (CC BY 4.0), and the game's own world map
`public/countries-50m.json` (world-atlas 2.0.2, Natural Earth 1:50m).

### Units

1. **Layer.** gbOpen layers listed in the cached geoBoundaries metadata (file URLs
   pinned to release commit `9469f09`), skipping licences marked "Other – Direct
   Permission". A layer must cover the country: its area within 10% of the median
   of the country's layers (Uruguay's municipios cover a third of it). Rule: the
   coarsest layer with ≥ 2N units, else the finest with ≥ N, else the finest; a
   loaded layer's real unit count replaces the listed one and the rule runs again.
   Natural Earth 10m admin-1 is the fallback, then ADM0. Shipped: ADM2 95, ADM3 19,
   ADM1 11, ADM4 2, Natural Earth 1 (New Caledonia).
2. **Fill.** Each polygon of the next coarser layer that the chosen layer mostly
   misses joins as a unit, minus the chosen units, when the missing land is at
   least 5 km² and 0.001% of the country (Moscow and Saint Petersburg in RUS
   ADM2, Bubiyan in KWT ADM2). 25 maps; recorded in `boundaries.filled`.
3. **Mask.** The game's 826 is England: GBR ADM2 units whose centroid lies in the
   GB-ENG polygon of GBR ADM1.
4. **Other associations.** China drops polygons mostly within 3 km of Natural
   Earth's Taiwan, Hong Kong and Macau (`boundaries.excluded`).
5. **Foreign land.** The game's world map (`public/countries-50m.json`) decides
   whose land is whose. Polygon samples lying in another country's shape more
   than 3 km beyond the host's 1:50m border are grouped by proximity; a group
   holding at least 20 km² is cut (polygon minus that shape, keeping a 3 km strip
   along the host border; an almost wholly foreign polygon is dropped). Lone
   exclaves below that stay (Ceuta, Melilla, Llívia), islands missing from the
   world map are never foreign, and Åland counts as Finland's. 81 maps have cuts,
   recorded in `boundaries.foreign` and ATTRIBUTION (India −Pakistan 77,765 km²,
   Morocco −W. Sahara east of the berm, Ukraine −Crimea, Cyprus −N. Cyprus).

### Partition (`partitionCountry`)

1. **Explode** multi-part units into one unit per polygon, so sections stay
   contiguous.
2. **Frame.** Shift negative longitudes by 360° when that makes the country
   narrower (Russia, Fiji, New Zealand).
3. **Overseas.** Drop land-connected groups none of whose centroids is within
   2,500 km of the clubs' median point, unless a group holds a home or lies within
   400 km of kept land (Cocos Islands, Easter Island, Hawaii and Alaska go).
4. **Locate.** Each home falls in a unit; points up to 50 km outside snap to the
   nearest unit, farther ones are discarded (the club is then placed, below).
5. **Place clubs without a home** at the most populous GeoNames places (England:
   ENG only) whose unit hosts no club, at least half a typical cell from every
   home, no farther from the located clubs than they typically are from each
   other, and whose nearest-land share is at most 2× (then 4×, 8×) the average;
   these conditions relax in turn. The file records the place as `home` with
   `homeSource: "placed:<geonameid>"`, an estimate. Placed clubs grow only into
   land nearer to them than to any other start.
6. **Split** (`splitUnits`), two rules in order:
   - While there are fewer units than clubs (slivers below 1% of a median unit
     ignored): cut the unit holding the most homes into one piece per club, else
     halve the largest unit (two k-means centres).
   - While seeding would leave a club more than max(3 km, half the median unit
     side) from home because stronger clubs share its unit, cut that unit into one
     piece per club, worst gap first.

   A crowd cut is a Voronoi diagram of sites at the homes; clubs sharing one town
   point (closer than a tenth of a cell) share the land around it through k-means
   centres, so they start side by side. When a club's piece would still start
   beyond the gap limit, a **fan of wedges** meeting near the town (sites on a
   ring of a quarter of the limit) replaces it if closer (Hofuf in Al-Ahsa). The
   piece holding a shared home goes to the **strongest** club whose home it is.
   Pieces are named after the unit with one compass suffix ("Lancashire (east)").
   384 splits ship.
7. **Seed.** Strongest first, each located club claims its home unit; clubs whose
   home unit went to a stronger club then take the nearest free unit (the home
   unit's neighbours first).
8. **Grow.** The smallest section takes its adjacent free unit nearest its seed,
   but only within reach: the unit lies at most 1.5× as far from its seed as from
   the nearest seed of any club, both distances padded by the median unit side.
   When every bordering claim is out of reach, the least stretched claim wins.
9. **Islands.** With no land path left, the free unit nearest any assigned unit
   joins a club holding land within a short hop (twice the nearest hop, or that
   plus max(150 km, 3 unit sides)), nearest land first among clubs within reach,
   else the least stretched, so an archipelago does not chain to one club island
   by island.

### Output

- **Dissolve** each section on the unit topology so borders stay shared; drop
  islets and holes under about 4 px² at the opening fit unless another section
  touches them or they hold a home. Visvalingam-simplify to 14,000 arc points
  (shared arcs once, every ring at least four vertices), quantize at 1e5; while the
  file exceeds 250,000 bytes, lower the budget by 15%.
- **Projection.** `lon0` is the area-weighted circular mean of unit centroids,
  `lat0` the middle of the main landmass, both to 0.1°.
- **Focus** (opening camera): the landmass with the most located homes, any other
  with a tenth of the homes or land, and every polygon within max(200 km, 15% of
  that core's diagonal), padded 2%. The Canaries or Azores stay out.
- **Names.** Source names are tidied (mojibake, control characters, Cyrillic
  look-alikes, layer quirks such as NOR ` nor` or CHN `-shi`). A broken or cut-off
  name becomes the best-matching GeoNames place inside the unit, else a
  transliteration (Russian), the most populous place inside, or the Natural Earth
  region. Garbled layers (HUN and CZE ADM3, QAT) check every name against the full
  GeoNames country file, and lost accents are restored (Trenčín, Pärnu). A club
  pushed off its home unit names its town: "Sefton (near Liverpool)". Repeats take
  their Natural Earth region, then a compass point, then a number; names are
  unique per map.
- **Codes.** Three letters, unique per map: an acronym the club goes by (PSV, CFR),
  then distinctive words (generic and legal-form words, years and club numbers
  left out: Bayer 04 Leverkusen is BLE), then letter patterns. A club number
  appears only as in S04 (one shipped: A20 for ADO '20).
- **Colours.** 48 OKLCH colours (24 hues × 2 lightness levels), assigned greedily
  in rank order over shared-arc neighbours **plus sections facing each other**
  across water (borders within 3 px at the opening fit, at least 1 km, nothing
  between): best distance to neighbours, then to their neighbours, then the least
  used.
- **Strength** `str` is `selectLineup(buildClub(...)).rating` on the expanded
  squad, so the setup preview and the campaign agree.
- **Version** `<id>-<8 hex>`: sha256 of the document without `version`.
- **Checks before writing:** the game's `decodeDomestic` loads the file, every
  section decodes to a finite, non-empty shape, and section areas sum to the
  source units' area within 2%.

The build is deterministic: same snapshots and caches give byte-identical files,
whatever `--jobs`. `--check` rebuilds offline and compares every output.

## File format 1: `public/domestic/<id>.json`

```json
{
"format": 1,
"id": "826",
"name": "England",
"version": "826-83b8d382",
"projection": {"lon0":-1.5,"lat0":52.9},
"focus": [-6.6,49.7,2,56],
"boundaries": {"provider":"geoBoundaries","iso3":"GBR","level":"ADM2","mask":"GB-ENG",
  "license":"Open Government Licence v3.0","licenseDetail":"…","source":"…","year":"2019",
  "canonical":"Counties and Unitary Authorities","boundaryId":"GBR-ADM2-9080712","url":"…",
  "maskSource":"…","maskLicense":"…","maskUrl":"…","units":151,"areaKm2":130193},
"source": {"provider":"EFEM.club","game":"Football Manager 26","edition":"FM 26","version":"26.3.0",
  "snapshotDate":"2026-10-18","rawScale":100,"conversion":"round(currentAbility * 99 / 100)","origin":"https://efem.club"},
"topology": {"type":"Topology","transform":{…},"objects":{"sections":{"type":"GeometryCollection","geometries":[
  {"type":"Polygon","arcs":[[0,1,2,3,4,5,6]],"id":"826-001","properties":{"name":"Manchester","units":2}}, …]}},"arcs":[…]},
"clubs": [
  {"id":"d826-679","fm":679,"name":"Manchester City","short":"Man City","code":"MCI","col":"oklch(0.74 0.15 0)",
   "rep":95,"league":"English Premier League","str":87,"section":"826-001","home":[-2.2003,53.4831],
   "homeSource":"wikidata:Q50602","squad":[[29179241,"Erling Haaland",94,"st","NOR"], …]}, …]
}
```

- One top-level field, geometry or club per line, for readable diffs.
- Section ids are `<id>-<3-digit rank>`: section `001` is the top club's start.
  Sections and clubs are one-to-one. Club ids are `d<id>-<FM club id>`.
- `boundaries` may also carry `filled` `{ level, units, license, source, url }`,
  `excluded` with `excludedSource`/`excludedUrl`, and `foreign`
  `{ source, cut: [{ shape, km2 }] }`. `units` and `areaKm2` describe the source
  units after cuts.
- `homeSource` is `override`, `wikidata:Q..`, `geonames:<id>` or
  `placed:<geonameid>`; `home` is `null` only if a club could be neither located
  nor placed (none ships). `short` is omitted when FM has none.
- `section.properties.units` counts the units dissolved into it.

The loader ignores unknown fields, so additions stay compatible.

## Runtime

**Loader** (`src/engine/domestic.js`). `loadDomestic(id, { baseUrl, fetch })`
fetches `domestic/<id>.json` and resolves to `{ meta, geo, clubs, sectionNames,
focus }`; concurrent calls share one request and failures are not cached.
`decodeDomestic(data, id)` validates and builds: format, id, version pattern,
projection and focus on the sections' extent (nothing near the far-side seam),
quantized integer arcs and in-range rings, one club per section, `[A-Z0-9]{3}`
unique codes, `str` 1–99, abilities 1–100, at least 11 players with a natural
goalkeeper, positions that are own keys of `FM_ROLES`, and every section
drawable with positive area. Club rows have the `buildClub` shape plus `country`,
`homeSection`, `homePoint`, `fm` and `rep`; `buildClub` uses
`homeSection ?? country` as `home`. The decoded cache is bounded: the ids passed
to `retainDomestic(ids)` plus `DOMESTIC_CACHE_LIMIT = 2` recent others
(`getLoadedDomestic` returns null once evicted; callers load again).
`domesticSurroundings(atlas, domestic, margin)` returns `{ shapes, obstacles }`
for a decoded map and fit, cached with the map: world-map rings near the frame,
projected like the sections. The host shape is drawn only for masked England and
is never an obstacle.

**Geometry** (`src/engine/geo.js`). `new WorldGeometry(topo, anchors, { object,
projection: { lon0, lat0 } })`; defaults keep the world chart bit for bit. A
country chart rotates longitudes by `-lon0`, scales by `cos(lat0)`, is true scale
(`kmPerUnit`) and adapts the graticule; `project`/`invert` serve any chart. A
section's `labelX/labelY` is the interior point of its largest polygon farthest
from any edge. `cx/cy` is the **routing anchor**: the home town when its
clearance from the painted, rounded edge is at least 0.35 of that point's, else
the first point toward it that is (16 steps). `homeX/homeY` is the home marker:
the town where it lies on the painted section, else the anchor.

**Setup.** With Clubs and football, the Theatre list gains the group "One
country · top clubs" (and the `#setup-theatre` mirror its optgroup: "England ·
100 clubs", value `domestic:<id>`). Choosing one loads it after a 120 ms pause
(Retry on failure), and the setup wizard previews the country in step 1, each
section in the colour its starting club takes at kick-off. Session presets keep
the country and the managed club. Launch shows a busy state while the map is
prepared. Titles read "England · top 100 clubs".

**Campaign.** `own[club.homeSection] = club.id`, `team.home` is the section; the
map fits the sections and opens on `focus`; every section is held, so there is no
neutral land and never a transit treaty. The board adds `obstacles` (the
surroundings, the same array every call so the route index stays cached) and
`borderRoutes: true`; world boards get neither. Obstacles block straight routes,
ocean nodes and ocean edges only where no section is painted (the 1:50m outlines
overlap sections along every border). A blocked attack sails around them;
failing that it is `routeKind: 'foreign-transit'`, labelled "Crossing foreign
territory", which only exclaves need (Nakhchivan, Gaza, Kaliningrad). Border
routes aim at points just across a shared border when no anchor line reaches a
land neighbour. The backdrop is inert. Tooltips and results use section names.

**Saves.** `settings.clubScope = 'domestic:<id>'`, `settings.domesticVersion`.
Country checkpoints store FM players as `[fmId, name, CA, 'positions',
nationality|0, clubIdx, extras?]` under one `playerPack` header `{ source,
clubs }`; each tuple is kept only if it rebuilds the record exactly, and
`parseCampaign` validates and expands them. England is about 0.11 MB at kick-off
and 0.27 MB at its champion; world saves are byte-identical to before. Saves are
all or nothing; when storage is full a campaign may drop only its own recovery
copy, and Saved campaigns can delete campaigns (not the one in play). Resume,
import and reload load the map first (the dialog is busy, and closing it, Cancel
import or Clear quick resume cancels the restore). `fitDomesticCampaign`: with
the same version, every `own` key and home must exist; with another version the
save is moved **club by club** (each club's new start goes to whoever held its old
one; `team.home`, `conquestIds` and match and history territory ids are
remapped), re-stamped, and the interrupted draw dropped. A save is refused, and
kept, when a club is missing from the map, the map adds a club, or the save is
inconsistent.

## Acceptance checks (as tested)

- `scripts/domestic-data.test.mjs`, every shipped map: index entry and content-hash
  version; N in 10–100, sections = clubs, rank-ordered ids, bijection; every club,
  squad and home equals its snapshot (placed homes marked); codes letters-only;
  ratings 1–99; decodes; dissolved and contiguous except across water; neighbours
  and facing sections ΔE ≥ 0.1; readable, unique names; area within 2% and no
  overlaps; a home lies only in its own or a stronger club's section (0.6 km
  tolerance); a placed section at most 6× the average share; world-map foreign
  land at most max(0.5%, 50 km²).
- `scripts/domestic-geometry.test.mjs`: projection, scale, antimeridian, interior
  anchors, world defaults unchanged, loader caching and validation.
- `scripts/domestic-routing.test.mjs` (run by `npm test`): anchors inside every
  shipped section, no sea-only clubs with land neighbours, obstacle blocking and
  precedence, exclave labelling, border routes, identity without obstacles, real
  neighbours on five maps, the cache bound.
- `scripts/domestic-campaign.test.mjs`: seeded duel, blitz and chaos campaigns to a
  champion with conserved territory and no transit treaties; every country kicks
  off with legal draws; checkpoints round-trip under 0.5 MB; club-by-club remap;
  a full England campaign on the app board crosses no neighbour.
- `npm run smoke`: England duel and blitz campaigns, setup loading/error/Retry,
  inert backdrop, restore races and cancellation, interrupt and resume to the
  champion, a save from an earlier map build.
- `node scripts/build-domestic.mjs --check` and a cached rerun of the sync both
  reproduce the committed files byte for byte.

## Known limitations

- **Licences.** Section shapes are derived from their boundary layers and keep
  those terms: 31 maps come from ODbL 1.0 layers and 11 from CC BY-SA (2.0 or 3.0),
  so those maps are share-alike; most others require attribution (CC BY 3.0 IGO,
  CC BY 4.0, OGL, swisstopo, …). `ATTRIBUTION.txt` must ship with the maps.
  GeoNames needs attribution. FM data is used as for the existing FM supplement;
  the game is not affiliated with SI or EFEM.
- **Loans** are not applied: EFEM's player list (views Default, ValueAndWage and
  Profile) has no loan club, so loaned-out players count for their parent club.
  Recorded in every snapshot's `source.loans`.
- **Approximate homes.** 97 overrides are region-level and 86 clubs are placed at
  populous places (`placed:`). They hold 0.76% of all land, but 76% of Laos (10
  of 21 clubs), about a quarter of Eswatini and Togo. Several clubs share one city
  point (Cork 7, Montevideo 7, Cape Town 4); only one can hold the point, so
  77.5% of located clubs (4,741 of 6,119) start on their exact home. Some
  overrides rest on medium-confidence judgement (noted in the file).
- **Size.** 17.9 MB of maps ship in `dist/`, though a session fetches only the
  country chosen (22–248 KB). A decoded country holds several MB, hence the cache
  bound.
- **Borders.** The 3 km tolerance against the coarse 1:50m world map leaves thin
  strips of land it gives to neighbours (East Jerusalem's core on Israel's map,
  along Cyprus's Green Line). Where a 1:50m outline overlaps sections (N. Cyprus,
  Crimea) sections win in routing. Russia's map has no Crimea (no RUS layer has
  it) and shows blank there. On England the UK shape is not an obstacle, so Wales
  and Scotland do not block routes.
- Some located homes lie outside every section after cutting or simplifying (N.
  Cyprus refugee clubs, Xiamen, FC Sochi); anchors never assume they are inside.
- Islands may still chain within reach (Naxos's club holds Chios and Lesbos), and
  Novaya Zemlya goes to Fankom Kirov because no club is in reach.
- A few source names could not be repaired (SVK `Kolice I`, `Kovice - okolie`,
  EST `Jaarva-Jaani`, CHN `Congqing`).
- Arrows in sections under about 0.5 SVG units across stay that short at kickoff.
- Section ids follow club rank, so every rebuild relies on the club-by-club remap.
- The first label layout for 100 owners costs about 300 ms at launch.
