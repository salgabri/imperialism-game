# Domestic campaigns: a country's top clubs on its own map

Status: implemented. Format 1 (one section per club, 128 countries) shipped on
2026-10-19; since 2026-10-24 every map is format 2: 100 sections shared out in
club groups, 163 countries. This describes the system as built; the code comments
in the files named below are the detailed reference.

## Goal

In club mode, with football, the player can pick **one country**. Its top 100
Football Manager 26 clubs (fewer when the database has fewer viable clubs) fight
over **that country's map**, built from the country's real administrative
divisions and always split into **100 sections**. Clubs are real only: no club or
player is generated. With N clubs, each club starts on a contiguous **group** of
`floor(100/N)` or `ceil(100/N)` sections around its home town (one section each
when N = 100). Conquest follows the existing rules: the winner annexes everything
the loser holds and claims one player, so a starting group always changes hands
whole.

The world campaigns (nations and the 132-club European layer, both sports) are
unchanged: same geometry, seeded outcomes, saves and rendering. NBA clubs, which
used to be dealt across the world map, now play on a map of their own: the USA
and Canada split into one territory per franchise (see "The NBA map" below).

**What ships:** 163 countries of the game's 170 nations, **6,364 clubs**, 16,300
sections. Maps total 23.9 MB (8.2 MB gzipped), 34–250 KB per country, fetched
only when chosen; the generated index is 28 KB.

| Clubs N | Countries | Sections per club |
| --- | --- | --- |
| 100 | 22 | 1 |
| 51–99 | 31 | 1 or 2 |
| 34–50 | 16 | 2 or 3 |
| 21–33 | 22 | 3 to 5 |
| 10–20 | 37 | 5 to 10 |
| 5–9 | 14 | 11 to 20 |
| 2–4 | 21 | 25 to 50 |

The median N is 24. Nine countries have two clubs (Belize, Central African Rep.,
Eq. Guinea, Guyana, Lesotho, Madagascar, Pakistan, Suriname, Yemen). The 35
countries with N below 10 are new in format 2; the other 128 kept their clubs.

**Seven nations cannot ship**, because fewer than two clubs pass the unchanged
viability rules (`survey.json` records each reason as `why`):

| Nation | N | Why |
| --- | --- | --- |
| Sri Lanka | 0 | all 79 listed clubs have fewer than 11 players |
| Cuba | 0 | all 18 clubs have fewer than 11 players |
| Eritrea | 0 | all 18 clubs have fewer than 11 players |
| Bahamas | 0 | 8 clubs have fewer than 11 players; Western Warriors and Westside Renegades have 11 but no natural goalkeeper |
| Afghanistan | 1 | only Abu Muslim FC; the other 29 have fewer than 11 players |
| Namibia | 1 | only African Stars; FC Civics Windhoek has no natural goalkeeper |
| Sierra Leone | 1 | only Bo Rangers; East End Lions has no natural goalkeeper |

The survey's club-list estimate (`estN`) counts two clubs each for Bahamas,
Namibia and Sierra Leone; only the full sync checks for 11 natural-position
players including a goalkeeper, which those clubs lack.

## Pipeline

Two offline stages; nothing is fetched from these services at runtime.

| File | Role |
| --- | --- |
| `scripts/sync-domestic-clubs.mjs`, `scripts/lib/domestic-sync.mjs`, `scripts/lib/domestic-locate.mjs` | Stage 1 (network, cached): EFEM clubs and squads, home towns → snapshots. |
| `scripts/data/domestic/<id>.json`, `survey.json` | Committed snapshot per nation (written only when N ≥ 2, `MIN_CLUBS`); the survey records every nation's club-list estimate `estN` and the full sync's `n`, `ships` and, for a nation that does not ship, `why`. |
| `scripts/data/domestic-locations.json` | Manual home-town overrides, keyed by FM club id. |
| `scripts/data/domestic-names.json` | Real names for FM's placeholder club names, keyed by FM club id. |
| `scripts/build-domestic.mjs`, `scripts/lib/domestic-boundaries.mjs`, `scripts/lib/domestic-partition.mjs` | Stage 2 (cached downloads, worker threads): boundaries + snapshot → 100 sections in club groups. `--only=826,724`, `--jobs=N`, `--check`, `--dry-run`. |
| `public/domestic/<id>.json` | Shipped country file (format 2, below). |
| `public/domestic/ATTRIBUTION.txt` | Generated: every country's boundary source, licence, cuts and fills, plus GeoNames, Wikidata, Natural Earth and EFEM notes. |
| `src/data/domestic.js` | Generated index `{ id, name, clubs, sections: 100, version, level, top }` and `DOMESTIC_FORMAT` for the setup screen. |
| `docs/design/domestic-audit.json` | Generated build report: layer, units, splits, drops, cuts, fills, placed clubs, groups, home-in-section, sizes. |
| `src/data/fmPlayers.js` | FM conversion shared by scripts and browser (`FM_ROLES`, `fmGameRating`, `expandFmTuple`). |
| `src/engine/domestic.js`, `src/data/domesticScope.js` | Runtime loader, cache, surroundings and scope helpers. |

Every download is cached under the ignored `data-src/` (`domestic/efem`,
`domestic/wikidata`, `domestic/geonames`, `boundaries/gb`, `boundaries/ne`,
`boundaries/geonames`), so reruns are offline. Requests send the User-Agent
`imperialism-game-build/1.0 (offline data build)`. EFEM: three at a time, 0.5 s
apart per slot, three retries with backoff on network errors, 429, 5xx and empty
bodies. Wikidata: one at a time, 1 s apart. Boundary downloads: one at a time
(worker threads ask the main thread), 0.5 s apart, four tries. Nominatim is never
used. From a warm cache the sync of every nation takes about 30 s. A full build
takes 4.5 to 6.5 minutes: nearly all of it is Canada, whose partition runs three
times (see Partition), about 275 s with 8 jobs (the default: up to 8, one fewer
than the CPU's threads) and 389 s when 12 jobs compete for the CPU; no other
country takes more than about 35 s. `--check` takes as long, so run both in the
background.

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
**N = min(100, viable)**; a nation ships when N ≥ 2. Every excluded club ranked
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

**Survey.** `--survey` reads club list pages only and estimates N (`estN`) by name
and listed player count; it keeps the `n`, `ships` and `why` a full sync wrote, and
a full sync (or `--only`) updates them for its own nations.

### Home towns

Layered and deterministic; each location records its `source`:

1. **Override** (`override`): `{ lon, lat, note }` or `{ qid }`, plus a reader's
   `name`. 888 entries (879 in use). Points are GeoNames towns unless the note
   cites another source; a note starting `approximate:` marks a region-level
   point from the club's competition or a province in its name (99 in use).
   Overrides also correct wrong automatic points (a national or league stadium
   for a club from another town, a sponsor's town in the name, GeoNames listing
   "Puerto Rico" as an alternate name of San Juan).
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

Coverage: 4,240 Wikidata, 879 override, 1,158 GeoNames, **87 with no home** (the
build places them, Stage 2 step 5). The
sync warns about points far from any town and provinces with no matching town;
four warnings remain (Cobresal, Wolmido, Nedjm Chabab Magra, 31–44 km from a
town; Espoir du Burkina, unlocated).

## Stage 2: sections

Inputs besides the snapshots: geoBoundaries gbOpen layers (per-layer licence),
Natural Earth 10m admin-1 v5.1.2 (public domain), GeoNames `cities1000` and
country files (CC BY 4.0), and the game's own world map `public/countries-50m.json`
(world-atlas 2.0.2, Natural Earth 1:50m).

Every map has `DOMESTIC_SECTIONS = 100` sections. The build first grows one
**territory** per club, exactly as format 1 grew one section per club, then cuts
each territory into that club's group. A group is therefore one territory and
stays contiguous on land. With N = 100 nothing is cut: those 22 maps equal their
format-1 build except for `format` and the one-entry `sections` lists.

### Units

1. **Layer.** gbOpen layers listed in the cached geoBoundaries metadata (file URLs
   pinned to release commit `9469f09`), skipping licences marked "Other – Direct
   Permission". A layer must cover the country: its area within 10% of the median
   of the country's layers (Uruguay's municipios cover a third of it). Rule, for
   the 100 sections whatever N: the coarsest layer with ≥ 200 units, else the
   finest with ≥ 100, else the finest; a loaded layer's real unit count replaces
   the listed one and the rule runs again. Natural Earth 10m admin-1 is the
   fallback, then ADM0. Shipped: ADM2 103, ADM3 48, ADM1 8, ADM4 3, Natural Earth
   1 (New Caledonia).
2. **Fill.** Each polygon of the next coarser layer that the chosen layer mostly
   misses joins as a unit, minus the chosen units, when the missing land is at
   least 5 km² and 0.001% of the country (Moscow and Saint Petersburg in RUS
   ADM2). 31 maps; recorded in `boundaries.filled`.
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
   world map are never foreign, and Åland counts as Finland's. 105 maps have cuts,
   recorded in `boundaries.foreign` and ATTRIBUTION (India −Pakistan 77,765 km²,
   Morocco −W. Sahara east of the berm, Ukraine −Crimea, Cyprus −N. Cyprus).

### Partition (`partitionCountry`)

**Territories.** Steps 1–10 grow one territory per club. Where every club starts
on two or more sections (N ≤ 50, "grouped" below), extra rules keep territories
near their fair share of land and keep clubs crowded into one city from being shut
in; maps with N from 51 to 99 use the format-1 rules unchanged.

1. **Explode** multi-part units into one unit per polygon, so territories stay
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
   land nearer to them than to any other start. 87 clubs are placed.
6. **Fans** (grouped; `fanSectors`). Clubs whose homes lie within the link
   distance `clamp(0.1·√(area/N), 3, 15)` km of each other form a cluster. A
   cluster of three or more, or of two sharing a town point (homes under 0.5 km
   apart), is fanned when its zone holds at most 12 clubs (`FAN_MAX`). The zone
   around the cluster's centre is wide enough for one corridor per club and takes
   in every club inside it; it is cut into one sector per club of equal land
   within the zone, in the order of the homes' bearings, starting at the widest
   gap (the sea, for a port). Only its club may take a sector's pieces; beyond the
   zone clubs grow freely, so their land follows the country's shape. A club
   starts in the largest connected part of its sector: at home when that part
   holds it, else next to the centre. 731 clubs in 169 fans (Dhaka's ten clubs,
   Dili's eight, Kathmandu's four, Bangui's two). A cluster whose zone would take
   in more than 12 clubs is not fanned, since its sectors would be slivers:
   Asunción (32 linked clubs) and Cairo (17) are not, nor is any of Brunei's
   clubs; their boxed-in clubs start outside instead (step 7).
7. **Moved starts** (grouped; `moveBoxedStarts`). A club needs about 6 px of land
   across at the opening fit per section (`minSectionKm2 = (6·extent/900)²` km²,
   so its room is that times its group size). Strongest first, a club keeps its
   home as its start when the land nearest it that it can grow into (same
   landmass, not through another club's start unit or fan sector) gives it that
   room and leaves every stronger club its room. Otherwise it starts at the place
   or admin-unit centre nearest its home with four times that room (else, of the
   first 200 tried, the one with the most), outside every fan zone, at least the
   square root of its room from other starts and within `√(area/N)` of home: the
   stronger clubs keep the city. 119 clubs start this way.
8. **Split** (`splitUnits`), until there are at least 100 units:
   - While there are fewer units than sections (slivers below 1% of a median unit
     ignored): cut the unit holding the most starts into one piece per club, else
     halve the largest unit (two k-means centres). When grouped, units larger
     than a hundredth of the country are halved too.
   - While seeding would leave a club more than max(3 km, half the median unit
     side) from its start because stronger clubs share its unit, cut that unit
     into one piece per club, worst gap first.

   A crowd cut is a Voronoi diagram of sites at the starts; clubs sharing one town
   point (closer than a tenth of a cell) share the land around it through k-means
   centres, so they start side by side. When a club's piece would still start
   beyond the gap limit, a **fan of wedges** meeting near the town (sites on a
   ring of a quarter of the limit) replaces it if closer (Hofuf in Al-Ahsa). The
   piece holding a shared home goes to the **strongest** club whose home it is.
   Sites in one straight line (places on a GeoNames grid) can break the diagram,
   one site losing its cell while another's covers the whole unit, so they are
   nudged apart (about a centimetre, ten times more on each of up to four tries)
   until each lies in its own cell and no other.
   Pieces are named after the unit with one compass suffix ("Lancashire (east)").
9. **Seed and grow.** Strongest first, each club claims its start unit; clubs
   whose start unit went to a stronger club take the nearest free unit (its
   neighbours first). Then the smallest territory takes its adjacent free unit
   nearest its seed, but only within reach: the unit lies at most 1.5× as far from
   its seed as from the nearest seed of any club, both distances padded by the
   median unit side; when every bordering claim is out of reach, the least
   stretched claim wins. When grouped, size is land per section of the club's
   group, a club past 1.5× its fair share of land takes more only when no club
   under its cap can (a desert is shared by every club bordering it), and fanned
   clubs have unlimited reach. **Islands**: with no land path left, the free unit
   nearest any assigned unit joins a club holding land within a short hop (the
   larger of twice the nearest hop and the nearest hop plus max(150 km, 3 unit
   sides)); when grouped, clubs under their cap and at most twice as far as the
   nearest come first. Among those, the nearest land within reach wins, else the
   least stretched, so an archipelago does not chain to one club island by island.
10. **Boxed-in retry** (grouped). The estimates in steps 6–7 cannot see a club
    shut in by its neighbours' land as they grow (Bangui's two clubs). After
    growth, a club whose territory is under half its room
    (`BOXED = 0.5 × minSectionKm2 × group size`) is boxed in. One not yet fanned
    is fanned with its city when another club's home lies within the link
    distance (fans may then be pairs), and otherwise, or if that did not help,
    starts outside; a fan with boxed members gives up as many of its weakest
    members, which start outside. The partition is then redone from the same
    units, until no club escalates; the attempt whose boxed clubs fall least short
    (sum of squared shortfalls, the earliest of equals) is kept, with only its log
    lines, so no map ends worse than its first attempt. 16 maps retried (Canada,
    Egypt, Paraguay and Vanuatu among them); maps without a boxed club are
    unaffected.

**Groups** (`subdivideTerritories`, N < 100).

11. **Sizes** (`groupTargets`): `floor(100/N)` or `ceil(100/N)`, the stronger
    clubs the larger, exactly `100 mod N` of them. A club whose territory is too
    small for the larger size (under `minSectionKm2` per section: a club hemmed
    in by its city) hands it to the strongest smaller-sized club with room. 354
    clubs are involved in such hand-overs (donors and takers counted).
12. **Extra seeds** (`territoryExtras`). Each territory gets `size − 1` more
    seeds, one at a time by lazy greedy: the candidate that would take the most
    of the territory's land from the seeds so far, counting land on its own
    landmass only, times its weight. Candidates are GeoNames places inside the
    territory (up to 500, most populous first, weight `max(100, population)^0.3`),
    admin-unit centres (`4^0.3`) and land samples (1), so a town beats a village
    only where it would hold a comparable share and unit centres or samples win
    only where no place fits. A seed must lie at least
    `0.25·√(territory area / size)` from every seed while any candidate does. A
    start unit smaller than a quarter of a section's share of the territory keeps
    its neighbouring units for itself (no extra seed there). Places are
    `cities1000`; where it has fewer than three per extra section, the GeoNames
    country file's populated places are added (feature codes `PPL`,
    `PPLA`–`PPLA4`, `PPLC`, `PPLG`, `PPLL`, `PPLR`, `PPLS`, `PPLF`); only readable
    Latin-script names count. Of the 9,936 extra sections, 9,325 are built around
    a place and 611 around a unit centre or land sample.
13. **Cut and grow.** Units holding several starts are crowd-cut (`crowdAll`), and
    a territory with fewer units than starts has its largest unit halved. Each
    territory then grows its own sections from its starts with the step-9 rules,
    on its own units only.

### Output

- **Order.** Sections are numbered by club rank; within a club its home section
  first, then the others by distance from the club's start. Each club's
  `section` is its home section and `sections` its group, home first.
- **Dissolve** each section on the unit topology so borders stay shared; drop
  islets and holes under about 4 px² at the opening fit unless another section
  touches them or they hold a home or an extra seed's place. Visvalingam-simplify
  to 14,000 arc points (shared arcs once, every ring at least four vertices),
  quantize at 1e5; while the file exceeds 250,000 bytes, lower the budget by 15%.
- **Projection.** `lon0` is the area-weighted circular mean of unit centroids,
  `lat0` the middle of the main landmass, both to 0.1°.
- **Focus** (opening camera): the landmass with the most located homes, any other
  with a tenth of the homes or land, and every polygon within max(200 km, 15% of
  that core's diagonal), padded 2%. The Canaries or Azores stay out.
- **Names.** Source names are tidied (mojibake, control characters, Cyrillic
  look-alikes, layer quirks such as NOR ` nor` or CHN `-shi`). A broken or cut-off
  name becomes the best-matching GeoNames place inside the unit, else a
  transliteration (Russian), the most populous place inside, or the Natural Earth
  region. Garbled layers (BEN, CZE and HUN ADM3, QAT, FJI ADM4) check every name
  against the full GeoNames country file, and lost accents are restored (Trenčín,
  Pärnu). A club pushed off its home unit names its town: "Sefton (near
  Liverpool)". An extra section is named after its place, else after the most
  populous place inside it whose name is still free, else after its unit; a unit
  name without letters or not in Latin script takes the nearest town. Repeats take
  their Natural Earth region, then a compass point, then a number; names are
  unique per map.
- **Codes.** Three letters, unique per map: an acronym the club goes by (PSV, CFR),
  then distinctive words (generic and legal-form words, years and club numbers
  left out: Bayer 04 Leverkusen is BLE), then letter patterns. A club number
  appears only as in S04 (one shipped: A20 for ADO '20).
- **Colours.** One per club: 48 OKLCH colours (24 hues × 2 lightness levels),
  assigned greedily in rank order over neighbouring clubs, two clubs being
  neighbours when sections of their groups share an arc **or face each other**
  across water (borders within 3 px at the opening fit, at least 1 km, nothing
  between): best distance to neighbours, then to their neighbours, then the least
  used.
- **Strength** `str` is `selectLineup(buildClub(...)).rating` on the expanded
  squad, so the setup preview and the campaign agree.
- **Version** `<id>-<8 hex>`: sha256 of the document without `version`.
- **Audit.** Besides the format-1 fields, `sections: 100`, `extras` (sections at
  places and at units), `groups` (sizes, `sizeMoved`, `fanned`, `movedStarts`,
  `splitOnLand`, group areas; N < 100 only), each placed club's land share
  (`placed[].areaPct`) and section-area p10/p90.
- **Checks before writing:** the game's `decodeDomestic` loads the file, every
  section decodes to a finite, non-empty shape, and section areas sum to the
  source units' area within 2%.

The build is deterministic: same snapshots and caches give byte-identical files,
whatever `--jobs`. `--check` rebuilds offline and compares every output.

Across the 163 maps: groups split on land 0; a club's home lies in its own home
section for 4,769 of 6,277 located clubs (76.0%; 1,830 of 2,199 on the 100-club
maps), the others being clubs sharing a town point, fanned or moved clubs, and
clubs pushed off their unit by a stronger club.

## File format 2: `public/domestic/<id>.json`

```json
{
"format": 2,
"id": "242",
"name": "Fiji",
"version": "242-7808c767",
"projection": {"lon0":178.5,"lat0":-17.8},
"focus": [176.7,-19.3,181.8,-15.6],
"boundaries": {"provider":"geoBoundaries","iso3":"FJI","level":"ADM4","license":"…","source":"…",
  "units":1599,"areaKm2":20966,"filled":{…}},
"source": {"provider":"EFEM.club","game":"Football Manager 26","edition":"FM 26","version":"26.3.0",
  "snapshotDate":"2026-10-18","rawScale":100,"conversion":"round(currentAbility * 99 / 100)","origin":"https://efem.club"},
"topology": {"type":"Topology","transform":{…},"objects":{"sections":{"type":"GeometryCollection","geometries":[
  {"type":"Polygon","arcs":[[…]],"id":"242-001","properties":{"name":"Vadraulailai Settlement","units":46}},
  {"type":"Polygon","arcs":[[…]],"id":"242-002","properties":{"name":"Soweri Settlement","units":29}}, …]}},"arcs":[…]},
"clubs": [
  {"id":"d242-130055","fm":130055,"name":"Ba FC","short":"Ba","code":"BFC","col":"oklch(0.74 0.15 0)",
   "rep":54,"league":"Fijian Premier League","str":46.9,"section":"242-001",
   "sections":["242-001","242-002","242-003","242-004","242-005","242-006","242-007"],
   "home":[177.6696,-17.5348],"homeSource":"wikidata:Q636797","squad":[[75051036,"Lucas Abarca",56,"cb","CHI"], …]}, …]
}
```

- One top-level field, geometry or club per line, for readable diffs.
- `topology.objects.sections` holds exactly 100 geometries with ids `<id>-001` …
  `<id>-100`, in club rank order and within a club from its home outward, so
  `001` is the top club's home section.
- Each club's `section` is its home section (the one holding or nearest its home
  town; for a fanned or moved club the one nearest its start) and `sections` its
  starting group, home first. The groups list every section exactly once, in id
  order; sizes are `floor(100/N)` or `ceil(100/N)`. A group is contiguous on land
  and may span islands. With N = 100 every `sections` is `[section]` and the file
  equals its format-1 build apart from `format` and those one-entry lists.
- Club ids are `d<id>-<FM club id>`. `homeSource` is `override`, `wikidata:Q..`,
  `geonames:<id>` or `placed:<geonameid>`; `home` is the real home (or the placed
  estimate) and is `null` only if a club could be neither located nor placed (none
  ships). `home` may lie outside the club's own sections. `short` is omitted when
  FM has none.
- `boundaries` may also carry `filled` `{ level, units, license, source, url }`,
  `excluded` with `excludedSource`/`excludedUrl`, `mask` fields, and `foreign`
  `{ source, cut: [{ shape, km2 }] }`. `units` and `areaKm2` describe the source
  units after cuts.
- `section.properties.units` counts the units dissolved into it.

Format 1 was the same without `sections`, with one section per club (N sections).
The loader still reads it and ignores unknown fields, so additions stay
compatible.

## Runtime

**Loader** (`src/engine/domestic.js`). `DOMESTIC_FORMAT = 2` is what the build
writes, `DOMESTIC_FORMATS = [1, 2]` what loads, `DOMESTIC_SECTIONS = 100`.
`loadDomestic(id, { baseUrl, fetch })` fetches `domestic/<id>.json` and resolves
to `{ meta, geo, clubs, sectionNames, focus, startOwners }`; concurrent calls
share one request and failures are not cached. `decodeDomestic(data, id)`
validates and builds: format, id, version pattern, projection and focus on the
sections' extent (nothing near the far-side seam), quantized integer arcs and
in-range rings, section ids exactly `<id>-001` to the section count, at least two
clubs, `[A-Z0-9]{3}` unique codes, `str` 1–99, abilities 1–100, at least 11
players with a natural goalkeeper, positions that are own keys of `FM_ROLES`, and
every section drawable with positive area. Format 1 needs exactly one club per
section and reads each club's start as `[section]` (a `sections` field is
ignored). Format 2 needs exactly 100 sections, at most one club per section, and
each club a non-empty `sections` list starting with its `section`, of existing
ids, with no section listed twice or by two clubs. In both, every section must
be some club's start: there is no neutral land. Equal sizes and contiguity are
build properties, checked by the data test rather than the loader. Any failure
throws an `Error` naming the map and the first offending field (`Domestic map
242: clubs[3] ("Rewa FC") section 242-016 already belongs to clubs[2]`); a failed
fetch or bad JSON says so (`Domestic map 242 failed to load (HTTP 404)`). The
setup shows the message with Retry, and a restore refuses with it and keeps the
save.

Club rows have the `buildClub` shape plus `country`, `homeSection`,
`startSections` (frozen, home first; format 1: `[homeSection]`), `homePoint`, `fm`
and `rep`; `buildClub` uses `homeSection ?? country` as `home` and does not copy
`startSections`, so teams and saves keep their shape. `startOwners` is the frozen
kickoff ownership, section id → club id for every section; callers copy it. Only
home sections anchor at home towns (`hasCapital`, `homeX/homeY`); the other
sections of a group anchor at interior points. The decoded cache is bounded: the
ids passed to `retainDomestic(ids)` plus `DOMESTIC_CACHE_LIMIT = 2` recent others
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
100 clubs", "Fiji · 16 clubs", value `domestic:<id>`). The description reads the
index's `sections` (`clubs` for a format-1 entry): "… 16 clubs fighting over
Fiji, split into 100 sections drawn from its administrative divisions; each club
starts with 6 or 7 of them." An even split names one number, and a 100-club
country keeps the shorter sentence. Choosing one loads it after a 120 ms pause
(Retry on failure), and the setup wizard previews the country in step 1, every
section (not only home sections) in the colour its starting club takes at
kick-off (`startOwners`). The setup-phase tooltip (`tooltipModel` with
`homeClubs`, on the inert map under the opaque wizard) reads "Home of <club>" on
a club's home section and "<club> starts here" on the rest of its group. Session
presets keep the country and the managed club. Launch shows a busy state while
the map is prepared. Titles read "England · top 100 clubs".

**Campaign.** `own = { ...startOwners }`; `team.home` is the home section and
home markers stay there. The map fits the sections and opens on `focus`; every
section is held, so there is no neutral land and never a transit treaty. Attacks
start from any section the club holds. The board adds `obstacles` (the
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
`parseCampaign` validates and expands them (100 `own` keys for any N). England is
about 0.11 MB at kick-off and 0.27 MB at its champion; world saves are
byte-identical to before. Saves are all or nothing; when storage is full a
campaign may drop only its own recovery copy, and Saved campaigns can delete
campaigns (not the one in play). Resume, import and reload load the map first
(the dialog is busy, and closing it, Cancel import or Clear quick resume cancels
the restore).

`fitDomesticCampaign` (`src/engine/storage.js`): with the same version, every
`own` key and home must exist. With another version the save is moved **club by
club**. A club's starting sections always share one holder (a conquest takes
everything), and the old map's ids run in club rank order with each group
starting at its club's home, so the save itself gives the old groups: a section
belongs to the last home at or before it. All of a club's new `startSections` go
to whoever held its old home; `team.home` becomes the new home section;
`conquestIds` and match and history `territoryIds` become the clubs' whole new
groups, without duplicates (`territoryNames` are kept). On resume the app
re-stamps the save with the loaded version, says the map was updated, and drops
the saved draw ("The interrupted draw starts again"). Saves from the format-1
maps (one section per club) move onto the 100-section maps the same way. A save
is refused, and kept, when a club is missing from the map, the map adds a club,
two clubs share a home (or a home is not an `<id>-NNN` id), an `own` key lies
outside `<id>-001` to the number of `own` keys or before the first home, a home
has no holder, or the holdings split a starting group.

## Acceptance checks (as tested)

`npm test` runs every test file below; `npm run test:domestic` runs the four
`domestic-*` files (about 40 s), and `npm run smoke` takes several minutes.

- `scripts/domestic-data.test.mjs`: the index lists every shipped map once, in
  name order, and ATTRIBUTION.txt names every version. Every shipped map: at most
  250,000 bytes; `format` 2, index entry (`clubs`, `sections: 100`, `level`, `top`)
  and content-hash version; N in 2–100; ids `<id>-001` … `-100` equal to the clubs'
  `sections` concatenated in rank order, home first; group sizes
  `floor`/`ceil(100/N)` with exactly `100 mod N` larger ones; every club, squad and
  home equals its snapshot (placed homes marked); codes letters (a club number
  only as in S04); ratings 1–99; decodes; dissolved and contiguous except across
  water, and no group split on land; neighbouring and facing sections of
  different clubs ΔE ≥ 0.1; readable names unique over the 100; area within 2%
  and no overlaps on a 60×60 sample grid; a home lies only in its own group or a
  stronger club's (0.6 km tolerance), or, when every club has two or more
  sections, within `√(area/N)` of the club's home section; a placed club's group
  at most 6× the average share; world-map foreign land at most
  max(0.5%, 50 km²).
- `scripts/domestic-geometry.test.mjs`: projection, scale, antimeridian, interior
  anchors, world defaults unchanged, loader caching and validation for format 1
  and format 2 (a 9-club and a 100-club format-2 file on a test grid, 26 invalid
  cases with their exact errors).
- `scripts/domestic-routing.test.mjs`: anchors inside all
  16,300 shipped sections, no club with land neighbours left with only sea routes,
  arrows leave the section they start from, obstacle blocking and precedence,
  exclave labelling, border routes, identity without obstacles, real neighbours on
  five maps, the cache bound.
- `scripts/domestic-campaign.test.mjs`: seeded duel, blitz and chaos campaigns to a
  champion with conserved territory, whole starting groups and no transit
  treaties; every country kicks off with legal draws; checkpoints round-trip under
  0.5 MB; club-by-club remap. Fiji (16 clubs) adds group sizes, duel, blitz and
  chaos where each conquest is exactly the loser's groups, a round trip, remaps
  from a shifted rebuild and from a one-section-per-club save, and the refusals.
  A full England campaign on the app board crosses no neighbour.
- `scripts/campaign-storage.test.mjs`: a made-up 3-club, 10-section map for the
  grouped remap (upgrade, reordered rebuild, refusals).
- `npm run smoke`: England duel and blitz and a Fiji duel campaign, setup
  loading/error/Retry, grouped preview colours and tooltips, inert backdrop,
  restore races and cancellation, England and Fiji interrupt-and-resume to the
  champion, a one-section-per-club save restored onto the 100-section map with
  ownership intact, every shipped map through the runtime loader.
- `node scripts/build-domestic.mjs --check` and a cached rerun of the sync both
  reproduce the committed files byte for byte.

## The NBA map

Status: implemented 2026-10-29. Basketball clubs have one theatre, **NBA**, played
on `public/domestic/nba.json`: the USA and Canada and nothing else, split into 30
territories, one per franchise, along state and province lines, with the states
and provinces far from every arena left empty (since 2026-10-30; the first build
split every county of both countries). It reuses this whole runtime (loader, country
chart, backdrop, routing, saves) as a format-1 map whose clubs are the game's own.

**Build** (`npm run build:nba-map`, `scripts/build-nba-map.mjs`, about a minute;
`--check` rebuilds offline and compares, `--dry-run` writes nothing):

- **Units**: geoBoundaries gbOpen USA ADM2 (counties, public domain) and CAN ADM2
  (economic regions, Open Government Canada 2.0), cached like the country maps,
  each tagged with its country (`realm`). Land the world map gives to others is
  cut per country (`cutForeignLand`: Puerto Rico and the other territories go),
  Aleutian parts beyond the antimeridian are dropped and the overseas rule drops
  Hawaii. Alaska stays: it joins Canada by land.
- **States and provinces**: each unit is tagged with the ADM1 region (state,
  province; same sources and licences) holding its interior point. A region that
  hosts at most one arena is merged from its units into one `whole` unit (on their
  shared arcs, so its borders keep their vertices; `explodeUnits` leaves it in one
  piece, so Michigan's two peninsulas go together). The units of California (4
  franchises), Texas (3), Florida and New York (2 each) stay as counties, and
  `allowed` gives them only to that state's own franchises. A territory is
  therefore whole states and provinces, plus its share of its own state when that
  state is shared.
- **Empty land**: a region without an arena whose centroid lies over 1,000 km
  (`EMPTY_KM`) from every arena is left out of the partition: Alaska, Yukon, the
  Northwest Territories, Nunavut, British Columbia, Alberta, Saskatchewan,
  Manitoba, Quebec, and Newfoundland and Labrador (the next nearest, Ontario at
  813 km, is Toronto's home anyway). Those on the landmass go into the file as
  empty land; those off it (Hawaii, with Puerto Rico and the other territories
  already cut) are dropped.
- **Homes**: each franchise's arena, `scripts/data/nba-arenas.json` (`[lon, lat]`
  to about 100 m, with the city that names the territory).
- **Partition**: `partitionCountry` with one section per club (the format-1
  rules: the smallest territory takes the adjacent free unit nearest its arena,
  within reach). The two layers draw the national border up to ~3 km apart, so
  `joinKm: 5` links units of different realms that come that close
  (`joinRealms`). Los Angeles County is cut for the Lakers and the Clippers. With
  `spare`, a club passes over a unit that is another club's last way out when the
  unit lies nearer that club's arena: Brooklyn's only land neighbour is Queens, and
  the Knicks, smaller at the start with Manhattan alone, would otherwise take it and
  shut the Nets in. The build fails if a shared state's county goes to another
  state's franchise.
- **Border fitting** (`fitBorder`): each franchise's land is dissolved per
  country, and each empty region is a piece of its own; every Canadian edge within 3 km of US land is widened into a band, then
  US land and the other Canadian pieces are cut away, and `nodeRings` gives the
  US rings the crossing points. Both sides then share the line vertex for vertex,
  so a franchise holding land in both countries is one territory and neighbours
  across the border are land neighbours in the game (`geo.adj`, border routes).
- **Output** as the country maps (simplify to 14,000 points, quantize, colours
  that differ across borders and water). Empty land is simplified with the
  sections, in one topology, so the two share every border; it is then moved to
  its own object. Plus `src/data/clubMaps.js` (the setup's
  index entry: `CLUB_MAPS`) and `public/domestic/ATTRIBUTION-nba.txt`. The file is
  about 150 KB.

**File additions** to format 1: `sport: "basketball"`, `league: "NBA"`, `hosts:
["840", "124"]` (the world shapes it covers, never drawn beneath it: the backdrop
shows Mexico, Greenland and the Russian Far East), and `boundaries.layers` (one
entry per source layer; the ADM1 layers carry `use: "grouping"`), and
`topology.objects.empty`: the empty land, one geometry per region with its ISO
code as id (`CA-QC`) and `properties.name`, on the sections' arcs. Clubs are `{ id, col, section, home, arena }`: the id is
a basketball club (`b-boston-celtics`), and the loader takes its name, code,
league, strength and five from the game's data, so a 2K refresh needs no map
rebuild unless a franchise moves. Section ids `nba-001` … `nba-030` follow club
strength. The loader refuses an unknown sport or club, a repeated club, empty
`hosts` and empty land that is not a GeometryCollection of named, uniquely
identified polygons; the FM checks apply to country maps only.

**Result** (2026-10-30 build): Portland holds Washington, Oregon and Idaho;
Minnesota the Dakotas; Utah Montana and Wyoming; Denver Nebraska; Toronto Ontario;
the Knicks upstate New York, New Jersey and Connecticut; Boston New England and
the Maritimes; the Wizards Virginia, West Virginia, Maryland and Delaware. Areas
range from the Nets' 4,000 km² (Brooklyn, Queens and Long Island) to Toronto's
983,000 km².

**Runtime.** The scope is `domestic:nba`. `domesticIdOf` maps a scope to a map
only for its sport (a football country for football, the NBA map for basketball),
so a world NBA campaign saved before (`clubScope` `all`, `elite` or `NBA`) still
restores on the world. `setClubScope` (App) moves basketball clubs to
`domestic:nba` whatever the setup held, and a football setup left on it back to
every club. The setup lists the one row "NBA · 30 clubs", describes the split
("… lead the 30 NBA clubs, each starting on the land nearest its arena …"),
loads and previews the map like a country, and titles read "NBA · USA and Canada".
`decodeDomestic` returns the empty land as `empty` (a `WorldGeometry`, only ever
drawn), and `domesticSurroundings` draws it first among the shapes beneath the
map, in the backdrop's neutral grey. It is not an obstacle: like the UK beneath
England it lies inside the hosts, so a route over it reads as open ground.
The victory names "USA and Canada". Basketball squads are not FM players, so
checkpoints store them in full (no `playerPack`).

**Checks**: `scripts/nba-map.test.mjs` (in `npm run test:domestic`): file, index,
arenas and clubs agree; the USA and Canada are all the land and the hosts are not
drawn beneath it; the empty regions are the expected ten, drawn but no obstacle, on
the sections' arcs; towns of one state fall in one territory, towns of empty land
in none, and New York splits between the Knicks and the Nets only; cross-border
land neighbours and neighbour colours; seeded duel
campaigns on the app board reach a champion without treaties or third-party
crossings; loader refusals; the App sets up, launches and titles an NBA campaign
and keeps an old world NBA save on the world. The smoke's NBA scenarios run
through the country-map checks.

## Known limitations

- **Coverage.** Seven nations have fewer than two viable clubs and do not ship
  (What ships). The unchanged rules also drop some top clubs for which FM lists
  no natural goalkeeper: Horoya AC (Guinea's highest-reputation club), Bantu FC
  (Lesotho), Chemal (Mauritania), Aigle Noir AC (Haiti), Bumamuru (Burundi),
  Fruta Conquerors (Guyana), Khovd (Mongolia) and Sosa (Solomon Islands).
- **Licences.** Section shapes are derived from their boundary layers and keep
  those terms: 34 maps come from ODbL 1.0 layers and 13 from CC BY-SA (2.0, 3.0 or
  4.0), so those maps are share-alike; most others require attribution (CC BY 3.0
  IGO, CC BY 4.0, OGL, swisstopo, …). `ATTRIBUTION.txt` must ship with the maps.
  GeoNames needs attribution. FM data is used as for the existing FM supplement;
  the game is not affiliated with SI or EFEM.
- **Loans** are not applied: EFEM's player list (views Default, ValueAndWage and
  Profile) has no loan club, so loaned-out players count for their parent club.
  Recorded in every snapshot's `source.loans`.
- **Approximate homes.** 99 overrides are region-level and 87 clubs are placed at
  populous places (`placed:`), South Druk United (Bhutan) among them. Their groups
  hold about 2% of all land (1.45% approximate overrides, 0.60% placed clubs),
  but 84% of Laos (10 of its 21 clubs are placed), about half of Eq. Guinea (15
  de Agosto at Bata), a third of Eswatini, 29% of Uzbekistan, a quarter of Togo
  and 14–19% of Egypt, Finland and Mongolia. Several clubs share one town point (Tallinn 18,
  Montevideo 11, Cork 9); only one can hold the point. Some overrides rest on
  medium-confidence judgement (noted in the file).
- **Group sizes are not always by strength.** "The stronger clubs take the
  larger groups" holds only where they have room: a club hemmed in by its city
  hands its larger size to the strongest club with room (354 clubs involved).
- **Home sections away from home.** A club's home lies in its own home section
  for 4,769 of 6,277 located clubs (76.0%). For fanned clubs (731) and moved
  starts (119) the home section is the one nearest their start, not the one
  holding their town, and the town may lie in a weaker club's group; `home`
  keeps the real town. Moved starts stay within `√(area/N)` of home, so
  archipelago capitals (Honiara, Port Vila) keep their clubs on or near the home
  island.
- **Uneven sections.** Group sizes are fixed and groups contiguous, so empty
  land bordered by few clubs keeps huge sections: Canada's arctic (one section of
  2.26 million km²), China's west (1.32 million), Algeria's Sahara (392,000 km²),
  Egypt's Western Desert (225,000 km²), Paraguay's Chaco (107,000 km²). On maps
  with N from 51 to 99 (no caps or fans) two clubs hold 98% of New Zealand's South
  Island. Crowded cities give tiny sections instead: a tenth of the sections are
  under 2 km² in Brunei, Estonia, Iceland, Kuwait, New Zealand, Qatar and
  Uruguay, and 13 clubs still have under half the land their sections need after
  the retries: Solomon Islands' Henderson Eels, Central Coast, Laugu and Honiara
  City (Honiara wedges); Egypt's Al-Ittihad, Ceramica Cleopatra, National Bank
  and FC Masar; UAE's Arabian Falcons; Vanuatu's Tafea and Mauriki (Port Vila);
  Senegal's Teungueth FC; Paraguay's San Lorenzo. Per map, the 90th/10th
  percentile section-area ratio has a median of 37 and a 90th percentile of 342.
  465 of the 16,300 sections are under 3 px across at the opening fit (area under
  `(3·extent/900)²`).
- **Names.** 662 of the 14,100 sections on maps with fewer than 100 clubs (4.7%)
  keep numbered compass names such as "Abu Dhabi (east 21)", from units cut many
  times.
- **Size and time.** 23.9 MB of maps ship in `dist/`, though a session fetches
  only the country chosen (34–250 KB). A decoded country holds several MB, hence
  the cache bound. A full build or `--check` takes 4.5 to 6.5 minutes, nearly all
  of it Canada.
- **Borders.** The 3 km tolerance against the coarse 1:50m world map leaves thin
  strips of land it gives to neighbours (East Jerusalem's core on Israel's map,
  along Cyprus's Green Line). Where a 1:50m outline overlaps sections (N. Cyprus,
  Crimea) sections win in routing. Russia's map has no Crimea (no RUS layer has
  it) and shows blank there. On England the UK shape is not an obstacle, so Wales
  and Scotland do not block routes. On coarse layers a fan zone spills outside its
  circle, since whole units touching it are cut into sectors (Israel ADM2).
- 81 located homes lie outside every shipped section: 69 lie just outside the
  boundary layer and were snapped to it (N. Cyprus refugee clubs, Xiamen's three,
  FC Sochi, Bishkek's six, twelve in Portugal), and the other 12 fall outside
  after cutting or simplifying. Anchors never assume a home is inside.
- Islands may still chain within reach (Naxos's club holds Chios and Lesbos), and
  Novaya Zemlya goes to Fankom Kirov because no club is in reach.
- A few source names could not be repaired (SVK `Kovice - mestsko cast Juh`, EST
  `Jaarva-Jaani`, CHN `Congqing`).
- **Kuwait** has a gap in its source layer: geoBoundaries KWT ADM2 leaves a band
  about 200 m wide (likely a motorway corridor, 12 km² of land) uncovered, so a
  120 km² block of Kuwait City (Salwa, Rumaithiya, Mishrift, Bayan…) shares no
  border with the rest of the country. It plays as an island holding 5 of the
  18 clubs in 27 small sections (in format 1 it was 5 of 18 sections).
- Simplified borders along rivers can cross in thin slivers, at most about
  0.7 km deep (Canada, Panama, Australia, New Zealand; already in format 1). The
  data test samples overlaps on a 60×60 grid per country, which misses them.
- Arrows in sections under about 0.5 SVG units across stay that short at kickoff.
- Section ids follow club rank, so every rebuild relies on the club-by-club remap.
- The first label layout for 100 owners costs about 300 ms at launch.
