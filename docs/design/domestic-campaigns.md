# Domestic campaigns: a country's top clubs on its own map

Status: implemented. Format 1 (one section per club, 128 countries) shipped on
2026-10-19; since 2026-10-24 every map is format 2: 100 sections shared out in
club groups, then 163 countries. Since 2026-10-29 a country's club count follows
its league's tier (Tiers, below) rather than 100 for every country that has them.
Since 2026-11-07 a country needs ten clubs for a map (What ships), which brings
back format 1's 128 countries. Since 2026-11-16 every earlier football season with
clubs has its own country maps, that season's top clubs ("Earlier seasons" below).
This describes the system as built; the code comments in the files named below are
the detailed reference.

## Goal

In club mode, with football, the player can pick **one country**. Its top
Football Manager 26 clubs fight over **that country's map**: 100 for the biggest
leagues, fewer for smaller leagues and smaller nations (Tiers, below), and fewer
still when the database has fewer viable clubs. A country with fewer than ten has
no map. The map is built from the country's real administrative divisions and
always split into **100 sections**.
Clubs are real only: no club or player is generated. With N clubs, each club
starts on a contiguous **group** of `floor(100/N)` or `ceil(100/N)` sections
around its home town (one section each when N = 100). Conquest follows the
existing rules: the winner annexes everything the loser holds and claims one
player, so a starting group always changes hands whole.

The world campaigns of nations (both sports) are unchanged: same geometry, seeded
outcomes, saves and rendering. Clubs, which used to be dealt across the world map,
now play on maps of their own: Europe's football clubs each in their own country
("The Europe maps" below), and NBA clubs on the USA and Canada, where each franchise
holds its own state or province ("The NBA map"). Women's football's clubs have no map of
their own and are still dealt across the world ([womens-football.md](womens-football.md)).

### Tiers

`src/data/domesticTiers.js` puts every game nation in one tier, which caps how
many of its top clubs its map takes: **N = min(tier, viable clubs)**. The tiers
weigh the league's standing, the depth of its pyramid and the nation's size, so
a strong league in a small nation (Croatia, Denmark) sits below a big one, and a
large nation with a modest league (China, India) above a small one. Each tier
lists its nations in priority order, by confederation (UEFA, CONMEBOL,
CONCACAF, CAF, AFC, OFC) and then standing; the setup screen lists the
countries in that order, and the European leagues follow their countries'.

| Tier | Clubs | Roughly | Nations |
| --- | --- | --- | --- |
| 1 | 100 | three or four professional divisions | England, Spain, Germany, Italy, France, Turkey, Brazil, Argentina, Mexico, United States |
| 2 | 60 | about three divisions | Portugal, Netherlands, Belgium, Russia, Poland, Japan, Saudi Arabia, China |
| 3 | 40 | about two divisions | Austria, Switzerland, Czechia, Denmark, Norway, Greece, Sweden, Croatia, Serbia, Ukraine, Romania, Hungary, Bulgaria, Israel; Colombia, Uruguay, Chile, Ecuador, Paraguay, Peru; Egypt, Morocco, Algeria, Tunisia, South Africa, Nigeria; South Korea, Australia, Iran, UAE, Qatar, Uzbekistan, Iraq, Thailand, Indonesia, India |
| 4 | 24 | the top flight and the best of the second | 51 nations, from Slovakia, Slovenia and Cyprus to Côte d'Ivoire, Jordan and New Zealand |
| 5 | 16 | about one top flight | the other 65, from Luxembourg and Estonia to Fiji |

A nation missing from the table would get the smallest tier; the data test
requires every nation of `NATIONS` exactly once. A tier caps a map but does not
grant one: 48 of these nations have no map (What ships). Mexico (58 viable clubs)
and the United States (81) stay below their tier; so do many smaller nations.

**What ships:** 128 countries of the game's 176 nations, **4,184 clubs**, 12,800
sections. Maps total 18.8 MB (6.6 MB gzipped), 46–250 KB per country, fetched
only when chosen; the generated index is 23 KB.

| Clubs N | Countries | Sections per club |
| --- | --- | --- |
| 100 | 8 | 1 |
| 51–99 | 10 | 1 or 2 |
| 34–50 | 32 | 2 or 3 |
| 21–33 | 34 | 3 to 5 |
| 10–20 | 44 | 5 to 10 |

The median N is 24. The tiers cut 71 maps to their tier on 2026-10-29 (6,364 clubs
before, 22 countries with 100); their snapshots keep the same clubs in the same
order, only fewer of them, and the other 92 maps of that day were unchanged.

**A country needs ten clubs** (`MIN_CLUBS`). A map has 100 sections whatever N, so
two clubs can fill one, and from 2026-10-24 to 2026-11-07 every nation with two or
more had a map. But a two-club campaign is one match and a nine-club one eight,
too short to be worth a country of their own, so those 35 maps were retired on
2026-11-07 with their snapshots and crests. The list is format 1's 128 countries
again, and their maps did not change. The sync deletes the snapshot of a nation
below the floor, and the next full build retires its map. (Sync with `--only=` the
survey's ids: a plain sync also asks for Scotland's clubs, which are not cached, and
stops there without EFEM's permission.)

**48 nations have no map**, and all of them still play as nations where their sport fields
them. Scotland, Wales and Northern Ireland became nations of their own after the last sync,
and Tonga, Samoa and the Cook Islands joined the map later still, so they have no snapshot.
The other 42 have fewer than ten clubs that pass the unchanged
viability rules (`survey.json` records each reason as `why`):

| N | Nations |
| --- | --- |
| 9 | Bhutan |
| 8 | Gabon, Puerto Rico, Solomon Islands, Somalia, Timor-Leste, Turkmenistan |
| 7 | Benin |
| 6 | Guinea-Bissau, Haiti, Mauritania, Papua New Guinea |
| 5 | Mali, Philippines |
| 4 | Burundi, Djibouti, Liberia, Mongolia, Nepal, South Sudan, Sudan |
| 3 | Chad, Congo, Guinea, Malawi, Niger |
| 2 | Belize, Central African Rep., Eq. Guinea, Guyana, Lesotho, Madagascar, Pakistan, Suriname, Yemen |

Seven more could not fill a map at any floor, with fewer than two viable clubs:

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
| `scripts/sync-domestic-clubs.mjs`, `scripts/lib/domestic-sync.mjs`, `scripts/lib/domestic-locate.mjs` | Stage 1 (network, cached; EFEM only with `--efem-permission-granted`): EFEM clubs and squads, home towns → snapshots. |
| `scripts/data/domestic/<id>.json`, `survey.json` | Committed snapshot per nation (written only when N ≥ 10, `MIN_CLUBS`; a nation below it loses any earlier snapshot); the survey records every nation's club-list estimate `estN` and the full sync's `n`, `ships` and, for a nation that does not ship, `why`. |
| `scripts/data/domestic-locations.json` | Manual home-town overrides, keyed by FM club id. |
| `scripts/data/domestic-names.json` | Real names for FM's placeholder club names, keyed by FM club id. |
| `scripts/build-domestic.mjs`, `scripts/lib/domestic-boundaries.mjs`, `scripts/lib/domestic-partition.mjs` | Stage 2 (cached downloads, worker threads): boundaries + snapshot → 100 sections in club groups. `--only=826,724`, `--jobs=N`, `--check`, `--dry-run`. |
| `public/domestic/<id>.json` | Shipped country file (format 2, below). |
| `public/domestic/ATTRIBUTION.txt` | Generated: every country's boundary source, licence, cuts and fills, plus GeoNames, Wikidata, Natural Earth and EFEM notes. |
| `src/data/domesticTiers.js` | Hand-kept tiers: each nation's club cap (read by the sync) and the priority order of the setup lists. |
| `src/data/domestic.js` | Generated index `{ id, name, clubs, sections: 100, version, level, top }` and `DOMESTIC_FORMAT` for the setup screen. |
| `docs/design/domestic-audit.json` | Generated build report: layer, units, splits, drops, cuts, fills, placed clubs, groups, home-in-section, sizes. |
| `src/data/fmPlayers.js` | FM conversion shared by scripts and browser (`FM_ROLES`, `fmGameRating`, `expandFmTuple`). |
| `src/engine/domestic.js`, `src/data/domesticScope.js` | Runtime loader, cache, surroundings and scope helpers. |

Every download is cached under the ignored `data-src/` (`domestic/efem`,
`domestic/wikidata`, `domestic/geonames`, `boundaries/gb`, `boundaries/ne`,
`boundaries/geonames`), so reruns are offline. Every request goes through
`scripts/lib/polite-fetch.mjs`: the generic User-Agent `imperialism-game-data/1.0`,
and each host's robots.txt read first and obeyed (README.md, "Network requests").
EFEM: three at a time, 0.5 s
apart per slot, three retries with backoff on network errors, 429, 5xx and empty
bodies, and only with `--efem-permission-granted`: efem.club/robots.txt disallows
`/api/` (checked 18 October 2026), so without the flag the sync replays cached
responses and refuses any EFEM request; with it, EFEM's written permission is the one
exception to its robots.txt. Wikidata: one at a time, 1 s apart, by SPARQL from
QLever's Wikidata endpoint (`qlever.dev/api/wikidata`, which has no robots.txt), since
the Wikidata Query Service's robots.txt disallows `/sparql` for every agent (read
2026-11-10). Each query keeps the Query Service's text, which names its cache file, so
the cache filled from the Query Service stays valid; QLever is sent it with the
prefixes declared and the item list moved into each UNION branch
(`scripts/lib/wikidata-sparql.mjs`), and gave Germany's cached names back unchanged
(580 of 580). GeoNames: only the cached dumps, since download.geonames.org's robots.txt
disallows every path for every agent (read 2026-11-10); a missing file stops the sync
or the build, and `--refresh=all` keeps them. Boundary downloads: one at a time
(worker threads ask the main thread), 0.5 s apart, four tries. Nominatim is never
used. From a warm cache the sync of every nation takes about 30 s. A full build
takes about 2.5 minutes with 12 jobs (the default: up to 8, one fewer than the CPU's
threads): nearly all of it is Canada, whose partition is redone for clubs boxed in
(see Partition), about 150 s; Russia and Chile take about 60 s, no other country
more than about 40 s. `--check` takes as long, so run both in the background.

## Stage 1: clubs, squads, home towns

### Sources

| Need | Source | Licence / terms |
| --- | --- | --- |
| Clubs, reputation, competition | EFEM.club FM26 `api/clubs/filter`, version 26.3.0 | as the existing FM supplement; not affiliated with SI or EFEM |
| Squads | EFEM.club FM26 `api/players/filter`, every male 26.3.0 player | as above |
| Home towns | Wikidata by SPARQL (from QLever's Wikidata endpoint); GeoNames `cities1000` (cached copy only); manual overrides | CC0; CC BY 4.0 (attributed) |

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
**N = min(tier, viable)**, the nation's tier from `src/data/domesticTiers.js`
(Tiers); a nation ships when N ≥ 10. Every excluded club ranked above the cut is
listed with its reason in the snapshot.

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
   `name`. 888 entries (446 in use; most of the rest belong to clubs below the
   tiers' cuts, and 40 to nations below the floor). Points are GeoNames towns unless
   the note cites another source; a note starting `approximate:` marks a region-level
   point from the club's competition or a province in its name (28 in use).
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

Coverage: 3,237 Wikidata, 446 override, 464 GeoNames, **37 with no home** (the
build places them, Stage 2 step 5). The sync warns about points far from any
town and provinces with no matching town; four warnings remain (Cobresal,
Wolmido, Nedjm Chabab Magra, 31–44 km from a town; Espoir du Burkina,
unlocated).

## Stage 2: sections

Inputs besides the snapshots: geoBoundaries gbOpen layers (per-layer licence),
Natural Earth 10m admin-1 v5.1.2 (public domain), GeoNames `cities1000` and
country files (CC BY 4.0), and the game's own world map `public/countries-50m.json`
(world-atlas 2.0.2, Natural Earth 1:50m).

Where a missing input comes from (`scripts/lib/domestic-boundaries.mjs`, through
`scripts/lib/polite-fetch.mjs`): the geoBoundaries metadata from
`www.geoboundaries.org/api/` (its robots.txt allows it, 10 s apart). The metadata names
each layer's file as `github.com/wmgeolab/geoBoundaries/raw/<commit>/…`, a path
github.com's robots.txt disallows (`/*/raw/`), so the file is read from
`raw.githubusercontent.com` at the same commit; the layers are kept in Git LFS, so that
answers with a pointer, and the object itself comes from `media.githubusercontent.com`
and must have the pointer's SHA-256 and size (neither host has a robots.txt; NZL ADM1,
downloaded this way on 2026-11-10, was its cached copy byte for byte, and the cached USA
ADM1 layer has its pointer's SHA-256). The outputs still cite the metadata's link.
Natural Earth from `raw.githubusercontent.com`. GeoNames' dumps never: their host's
robots.txt disallows every path, so only the cached copies are read and a missing one
stops the build. `--check` reads only the caches and never reaches the network.

Every map has `DOMESTIC_SECTIONS = 100` sections. The build first grows one
**territory** per club, exactly as format 1 grew one section per club, then cuts
each territory into that club's group. A group is therefore one territory and
stays contiguous on land. With N = 100 nothing is cut: those 8 maps equal their
format-1 build except for `format` and the one-entry `sections` lists.

### Units

1. **Layer.** gbOpen layers listed in the cached geoBoundaries metadata (file URLs
   pinned to release commit `9469f09`), skipping licences marked "Other – Direct
   Permission". A layer must cover the country: its area within 10% of the median
   of the country's layers (Uruguay's municipios cover a third of it). Rule, for
   the 100 sections whatever N: the coarsest layer with ≥ 200 units, else the
   finest with ≥ 100, else the finest; a loaded layer's real unit count replaces
   the listed one and the rule runs again. Natural Earth 10m admin-1 is the
   fallback, then ADM0. Shipped: ADM2 79, ADM3 36, ADM1 8, ADM4 3, Natural Earth
   1 (New Caledonia), and England's districts (below).
   **England** (826) takes the Office for National Statistics' 317 local authority
   districts (December 2019, generalised to 20 m and clipped to the coast; Open
   Government Licence v3.0) since 2026-11-18: geoBoundaries' GBR layers stop at the
   counties and unitary authorities (its ADM3 repeats ADM2), 151 units for England,
   so a club in the shires held a whole county (Lincoln City all of Lincolnshire)
   while a city club held a borough. The ONS's feature service winds rings clockwise;
   the loader winds them the other way round, as geoBoundaries' are. The file comes
   from the cache (`data-src/boundaries/ons/`), the same one the Europe maps' branch
   reads, and the constants and loader are worded as there.
2. **Fill.** Each polygon of the next coarser layer that the chosen layer mostly
   misses joins as a unit, minus the chosen units, when the missing land is at
   least 5 km² and 0.001% of the country (Moscow and Saint Petersburg in RUS
   ADM2). 26 maps; recorded in `boundaries.filled`.
3. **Mask.** The game's 826 is England: its districts are those with E codes.
   Scotland's, Wales's and Northern Ireland's season maps keep the mask: GBR ADM2
   units whose centroid lies in that nation's polygon of GBR ADM1.
4. **Other associations.** China drops polygons mostly within 3 km of Natural
   Earth's Taiwan, Hong Kong and Macau (`boundaries.excluded`).
5. **Foreign land.** The game's world map (`public/countries-50m.json`) decides
   whose land is whose. Polygon samples lying in another country's shape more
   than 3 km beyond the host's 1:50m border are grouped by proximity; a group
   holding at least 20 km² is cut (polygon minus that shape, keeping a 3 km strip
   along the host border; an almost wholly foreign polygon is dropped). Lone
   exclaves below that stay (Ceuta, Melilla, Llívia), islands missing from the
   world map are never foreign, and Åland counts as Finland's. 78 maps have cuts,
   recorded in `boundaries.foreign` and ATTRIBUTION (India −Pakistan 77,765 km²,
   Morocco −W. Sahara east of the berm, Ukraine −Crimea, Cyprus −N. Cyprus).

### Partition (`partitionCountry`)

**Territories.** Steps 1–10 grow one territory per club. Where every club starts
on two or more sections (N ≤ 50, "grouped" below), extra rules keep territories
near their fair share of land and keep clubs crowded into one city from being shut
in; maps with N from 51 to 99 use the format-1 rules unchanged. Since 2026-11-18
every country map shares out its land as "Balanced land" (below) describes: the
grouped rules for every map, and step 9's growth replaced. The steps below still
describe the club maps (NBA, NFL and the others), the Europe maps, and how a club's
land is cut into its sections (Groups).

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
   land nearer to them than to any other start. 37 clubs are placed.
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
   holds it, else next to the centre. 901 clubs in 203 fans (Brunei's twelve,
   Dhaka's ten, Tbilisi's eight, Limassol's four, Graz's two). A cluster whose
   zone would take in more than 12 clubs is not fanned, since its sectors would be
   slivers: Asunción (29 linked clubs) and Cairo (17) are not; their boxed-in
   clubs start outside instead (step 7).
7. **Moved starts** (grouped; `moveBoxedStarts`). A club needs about 6 px of land
   across at the opening fit per section (`minSectionKm2 = (6·extent/900)²` km²,
   so its room is that times its group size). Strongest first, a club keeps its
   home as its start when the land nearest it that it can grow into (same
   landmass, not through another club's start unit or fan sector) gives it that
   room and leaves every stronger club its room. Otherwise it starts at the place
   or admin-unit centre nearest its home with four times that room (else, of the
   first 200 tried, the one with the most), outside every fan zone, at least the
   square root of its room from other starts and within `√(area/N)` of home: the
   stronger clubs keep the city. 201 clubs start this way.
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
   Pieces are named after the unit with one compass suffix ("Verona (north-west)").
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
    shut in by its neighbours' land as they grow (Port Vila's clubs). After
    growth, a club whose territory is under half its room
    (`BOXED = 0.5 × minSectionKm2 × group size`) is boxed in. One not yet fanned
    is fanned with its city when another club's home lies within the link
    distance (fans may then be pairs), and otherwise, or if that did not help,
    starts outside; a fan with boxed members gives up as many of its weakest
    members, which start outside. The partition is then redone from the same
    units, until no club escalates; the attempt whose boxed clubs fall least short
    (sum of squared shortfalls, the earliest of equals) is kept, with only its log
    lines, so no map ends worse than its first attempt. 23 maps retried (Canada,
    Egypt, Paraguay and Vanuatu among them); maps without a boxed club are
    unaffected.

**Groups** (`subdivideTerritories`, N < 100).

11. **Sizes** (`groupTargets`): `floor(100/N)` or `ceil(100/N)`, the stronger
    clubs the larger, exactly `100 mod N` of them. A club whose territory is too
    small for the larger size (under `minSectionKm2` per section: a club hemmed
    in by its city) hands it to the strongest smaller-sized club with room. 150
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
    Latin-script names count. Of the 8,616 extra sections, 8,181 are built
    around a place and 435 around a unit centre or land sample.
13. **Cut and grow.** Units holding several starts are crowd-cut (`crowdAll`), and
    a territory with fewer units than starts has its largest unit halved. Each
    territory then grows its own sections from its starts with the step-9 rules,
    on its own units only.

### Balanced land

On 2026-11-18 the user asked why some territories "stretch out long and narrow"
(Italy) and to be "more generous towards tiny clubs and less to big" (England).
The causes, all in step 9's growth:

- **Fingers.** Smallest first, each turn hands the smallest territory its nearest free
  unit wherever that lies. Around land no club starts on, every club bordering it
  takes turns, each heading straight for it, so they enter it in parallel fingers:
  Perugia's arm to the Lazio coast, Arezzo's and Siena's tails into the land around
  Viterbo, Triestina along the lagoon west of Trieste. The reach bound only caps a
  finger's length.
- **Clubs in a row.** Verona, Vicenza and Padua, or Parma, Reggio and Modena, stand
  about 25 km apart on one line with no club beside them in the Alps, the Apennines
  or the Po plain: split by nearness, each takes a strip from mountains to river.
- **No size rules** on maps with 51 to 100 clubs (no caps, fans or moved starts), so
  a club in a crowded city held a borough; and England's units were whole counties.

`BALANCE` in `scripts/lib/domestic-build.mjs` (`{ room: 0.25, beta: 0.3 }`) makes
`partitionCountry` share out the land so:

1. **Fans everywhere, no moved starts.** Every map takes fans and the boxed-in retry,
   each club needing a quarter of a typical club's land (or the 6 px of before, where
   that is more): `room`, the same for every club whatever its group's size. A
   typical club's land is the smaller of its fair share and the median land nearest a
   club's home, so a country's empty quarter (Siberia, the Amazon, the deserts) does not
   make every club of its settled part count as boxed in. No club ever starts away from
   its city: on 2026-11-19 the user asked to "keep cities in their cities". (Moved
   starts, tried first with that room, sent 916 clubs to a town near their city:
   Lokomotiv and Dinamo out of Moscow, Fulham, West Ham and Brentford out of London.)
   Instead a city's crowd fans out from it: clubs link within four tenths of a typical
   club's width (at most 30 km; else a tenth of a fair share's width, at most 15 km), a
   fan still holds up to 12 clubs, a fanned club starts as near its own home as its
   sector goes (from the centre, Nordsjælland started 36 km from Farum, Bucheon 55 km
   from home), and a club still boxed in after growth is fanned with the clubs of its
   city. 1,564 clubs are fanned.
2. **Big units halved once**, before the starts are settled: every unit larger than a
   section's share of the land, so no club's land is one whole county or desert
   district. Halving does not depend on the starts, so each redone partition only cuts
   units for its clubs (this keeps Canada's build at about 7 minutes).
3. **Nearest start** (`balanceSections`): every unit goes to the club whose start
   is nearest its centre, measured from a point of the unit the club starts on (its
   home, or when a stronger club holds the home's unit a point inside its own). Land a
   fanned club wins beyond its city's zone goes to the club of that fan whose sector
   points its way from the city's centre, so each sector carries on outward. A club
   keeps the land that hangs together with its start; pieces cut off
   from it are flooded, nearest claim first, from the land around them. Landmasses
   without a start join a club across the sea in step 9's order (`joinIslands`). A club
   past two fair shares then gives up its farthest land (never its start, never cutting
   its land in two) to the clubs around it, nearest claim first, those under two shares
   before any past them, as step 9's caps share a desert out (a club placed inland held
   83% of Gambia); land no other club reaches (an island it was given) stays its own. This is each club's natural land V: compact, with no
   fingers. A club starting on a sliver (a fan's cut left Persija Jakarta a piece of Kota
   Tangerang 2 km by half a km) starts instead on the nearest unit of its own land holding
   a twentieth of a section's share.
4. **Land passes** towards targets T = F^0.7 · V^0.3 (F the club's fair share; β =
   0.3 of the way from equal land to its natural land), scaled to the land of each
   landmass. In rounds, each pair of neighbouring clubs passes one unit from the club
   with more land for its target to the other while that brings land nearer the
   targets (Σ A²/T falls, so it ends): the unit whose square distance from the
   receiver's start least exceeds its square distance from the giver's (as a power
   diagram's border moves), and only one lying against the receiver along at least 30%
   of the shorter of its land border and the receiver's (so land fills hollows and moves
   on a broad front of the receiver's border, never out from a tip: one unit at a time,
   a club would grow a snake along any long border; measured on the unit's border alone,
   a small club could never take a bigger unit beside it), within
   2.5 radii of a disk of its target land from the receiver's start, at most twice as
   far from it as from the giver's, not a start, and not cutting the giver's land in
   two.

Across today's maps (127 measured: each club's whole land, rasterised at about a
million pixels a map; "thin" is land in parts narrower than half the club's own
radius, which an opening of that width removes; the spread is the standard deviation
of the log of each club's land per fair share, its median over the maps):

| | Before | Balanced |
| --- | --- | --- |
| Spread of land per fair share (sd of its log) | 1.15 | 1.21 (51 maps more even, 69 less) |
| Land in thin parts (mean per map) | 23.2% | 17.1% |
| Clubs over 20% thin | 1,422 | 806 |
| Clubs under a quarter of their fair share | 1,102 | 1,243 |
| Clubs over three fair shares | 175 | 171 |
| Clubs starting away from home (moved) | 201 | 0 |
| Homes inside their own home section | 3,135 of 4,147 | 2,896 of 4,147 |

The shapes improve on almost every map. The sizes do not, overall: keeping every club in
its city gives a crowd no land but its city's wedges, while the old rules moved 201
boxed clubs out (moved starts, 916 of them, took the spread to 1.01 and the clubs under a
quarter share to 991). Where clubs are spread out the sizes even out: England (now
districts) has 22 clubs under a quarter share instead of 41 and its largest holds 4.6
fair shares instead of 7.8; Italy's thin land falls from 17% to 13% with 6 clubs under a
quarter share (5 before). The clubs over three fair shares hold peninsulas, islands or
empty land beside other big clubs (Exeter and Plymouth in the south-west, Catania and
Cagliari on Sicily and Sardinia), which no neighbour can take; capitals with 25 clubs or
more (Montevideo, Asunción, Cairo) stay crowded. The earlier seasons' maps, built the
same way, change alike (144 of 1,718 measured): thin land 25.0% → 18.3%, clubs over 20%
thin 1,251 → 679, over three fair shares 114 → 101, but the spread 0.92 → 1.02 and the
clubs under a quarter share 639 → 714.

Dead ends (don't retry): weights on the power diagram tuned to the targets (a small
weight change flips the one unit linking a club's start to the rest of its land, and
Newton steps throw two clubs a few km apart across each other's starts); growth
ordered by distance times land per share (no fingers from racing, but caps then wrap
a small club around a big one, Triestina around Udinese); passing land without the
30% border rule (Arzignano snaked 50 km along the Adige to the Po delta); looser
passing (4 radii, three times as far): 178 clubs over three shares instead of 183, but
more thin land; fans of more than 12 clubs (31 around Asunción made a pinwheel of
slivers, 26 of Paraguay's clubs mostly thin; from 16 the wedges meeting at a city's
centre need more clearly different colours than the palette's 16: 19 around Cairo);
measuring a fanned club from its sector's outer end (that point
crushed the club just beyond the zone: Bray Wanderers beside Dublin); moving any boxed
club with one stronger club near it (Peñarol out of Montevideo, Arsenal out of London).
Uruguay stays the hardest map: its departments are the finest layer that covers it, so
Montevideo is one unit for about 25 clubs, cut between them.



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
  used. Since balanced land (2026-11-20) the clubs with the most neighbours choose
  first, and a club still too close to a neighbour then takes the colour farthest from
  all of them: the palette holds about 16 colours that all differ clearly, and Proxy
  Work, bordering 18 clubs across Egypt's desert, found none free choosing last.
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

Across the 128 maps: groups split on land 0; a club's home lies in its own home
section for 2,896 of 4,147 located clubs (69.8%; 652 of 800 on the 100-club
maps; before balanced land 3,135, 75.6%, and 679), the others being clubs sharing a
town point, fanned clubs whose sector starts beside their home, and clubs pushed off
their unit by a stronger club. No club starts away from its city.

## File format 2: `public/domestic/<id>.json`

```json
{
"format": 2,
"id": "242",
"name": "Fiji",
"version": "242-7370036d",
"projection": {"lon0":178.5,"lat0":-17.8},
"focus": [176.7,-19.3,181.8,-15.6],
"boundaries": {"provider":"geoBoundaries","iso3":"FJI","level":"ADM4","license":"…","source":"…",
  "units":1599,"areaKm2":20966,"filled":{…}},
"source": {"provider":"EFEM.club","game":"Football Manager 26","edition":"FM 26","version":"26.3.0",
  "snapshotDate":"2026-03-30","rawScale":100,"conversion":"round(currentAbility * 99 / 100)","origin":"https://efem.club"},
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
(`getLoadedDomestic` returns null once evicted; callers load again). Starting or
restoring a campaign calls `retainDomestic(ids, 0)` once, so countries browsed on
the setup screen do not stay decoded through the campaign.
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
100 clubs", "Fiji · 16 clubs", value `domestic:<id>`), in the tiers' priority
order (England, Spain, Germany, Italy, France, …), below the group "Europe" and
its two theatres ("The Europe maps" below). The description reads the
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

A save on a country that no longer ships cannot resume either, and is kept: "The
map of Belize is no longer in the game, so the campaign cannot resume. The save
is kept." (Offline, a copy of the map the service worker kept still loads it.) The
setup no longer lists the country, and a challenge link naming it falls back to
the Top 124 ("The Europe maps" below).

## Acceptance checks (as tested)

`npm test` runs every test file below; `npm run test:domestic` runs the four
`domestic-*` files (about 40 s), and `npm run smoke` takes several minutes.

- `scripts/domestic-data.test.mjs`: the index lists every shipped map once, in
  name order, and ATTRIBUTION.txt names every version; every nation sits in
  exactly one tier, and the tiers shrink from 100; a nation ships exactly when N
  reaches `MIN_CLUBS`, and the survey, the snapshots and the maps agree on which
  do. Every shipped map: at most
  250,000 bytes; `format` 2, index entry (`clubs`, `sections: 100`, `level`,
  `top`) and content-hash version; N from 10 to its tier; ids `<id>-001` … `-100`
  equal to the clubs' `sections` concatenated in rank order, home first; group
  sizes `floor`/`ceil(100/N)` with exactly `100 mod N` larger ones; every club,
  squad and home equals its snapshot (placed homes marked); codes letters (a
  club number only as in S04); ratings 1–99; decodes; dissolved and contiguous
  except across water, and no group split on land; neighbouring and facing
  sections of different clubs ΔE ≥ 0.1; readable names unique over the 100; area
  within 2% and no overlaps on a 60×60 sample grid; a home lies only in its own
  group or a stronger club's (0.6 km tolerance), or, when every club has two or
  more sections, within `√(area/N)` of the club's home section; a placed club's
  group at most 6× the average share; world-map foreign land at most max(0.5%,
  50 km²).
- `scripts/domestic-geometry.test.mjs`: projection, scale, antimeridian, interior
  anchors, world defaults unchanged, loader caching and validation for format 1
  and format 2 (a 9-club and a 100-club format-2 file on a test grid, 26 invalid
  cases with their exact errors).
- `scripts/domestic-routing.test.mjs`: anchors inside all
  12,800 shipped sections, no club with land neighbours left with only sea routes,
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
- `scripts/campaign-lifecycle.test.mjs`: a save on a country no longer shipped is
  refused by name, and a shipped map that fails to load still says so.
- `npm run smoke`: England duel and blitz and a Fiji duel campaign, setup
  loading/error/Retry, grouped preview colours and tooltips, inert backdrop,
  restore races and cancellation, England and Fiji interrupt-and-resume to the
  champion, a one-section-per-club save restored onto the 100-section map with
  ownership intact, every shipped map through the runtime loader.
- `node scripts/build-domestic.mjs --check` and a cached rerun of the sync both
  reproduce the committed files byte for byte.

## The NBA map

Status: implemented 2026-10-29. Basketball clubs have one theatre, **NBA**, played
on `public/domestic/nba.json`: the USA and Canada and nothing else. Since 2026-11-07
each of the 30 franchises holds the state or province its arena stands in and nothing
else: a state with several franchises is divided between them, and every state and
province without one stays empty. (From 2026-10-30 a franchise also took the states
nearest its arena, and only those over 1,000 km from every arena stayed empty; the
first build split every county of both countries.) It reuses this whole runtime
(loader, country chart, backdrop, routing, saves) as a format-1 map whose clubs are
the game's own.

**Build** (`npm run build:nba-map`, `scripts/build-club-maps.mjs --league=nba`, 43 minutes with the 42 era maps on 2026-11-09;
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
  franchises), Texas (3), Florida and New York (2 each) stay as counties. `allowed`
  gives a franchise only the land of its own state, so a territory is one whole
  state or province, or its share of a shared one.
- **Empty land**: every region without an arena is left out of the partition:
  28 states and 12 provinces and territories on today's map, from neighbours of a
  franchise's state (Oregon has the Trail Blazers; Washington, next to it, is
  nobody's) to Alaska and the North. Those on the landmass, or within a hop of it by
  the partition's overseas rule (`dropOverseas`: Prince Edward Island stays), go
  into the file as empty land; those farther off (Hawaii, with Puerto Rico and the
  other territories already cut) are dropped.
- **Homes**: each franchise's arena, `scripts/data/nba-arenas.json` (`[lon, lat]`
  to about 100 m, with the city that names the territory).
- **Partition**: `partitionCountry` with one section per club. A franchise alone in
  its state starts on that whole state and has nothing left to take; in a shared
  state the format-1 rules divide the counties (the smallest territory takes the
  adjacent free county nearest its arena, within reach). The two layers draw the
  national border up to ~3 km apart, so `joinKm: 5` links units of different realms
  that come that close (`joinRealms`). Los Angeles County is cut for the Lakers and
  the Clippers. With `spare`, a club passes over a unit that is another club's last
  way out when the unit lies nearer that club's arena: Brooklyn's only land neighbour
  is Queens, and the Knicks, smaller at the start with Manhattan alone, would
  otherwise take it and shut the Nets in. The build fails if land of a state goes to
  another state's franchise.
- **Border fitting** (`fitBorder`): each franchise's land is dissolved per
  country, and each empty region is a piece of its own; every Canadian edge within 3 km of US land is widened into a band, then
  US land and the other Canadian pieces are cut away, and `nodeRings` gives the
  US rings the crossing points. Both sides then share the line vertex for vertex,
  so neighbours across the border are land neighbours in the game (`geo.adj`,
  border routes).
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

**Result** (2026-11-07 build): Portland holds Oregon; Denver Colorado; Toronto Ontario;
Boston Massachusetts; the Knicks all of New York but Brooklyn, Queens and Long Island,
which are the Nets'. California is divided
between the Kings (146,000 km²), the Lakers (100,000), the Clippers (87,000) and the
Warriors (77,000), Texas between the Spurs (292,000), the Mavericks (288,000) and
the Rockets (110,000), and Florida between the Magic (106,000) and the Heat (45,000).
Areas range from the Wizards' 200 km² or so (the District of Columbia is theirs alone,
Maryland and Virginia nobody's) to Toronto's 983,000 km².

**Runtime.** The scope is `domestic:nba`. `domesticIdOf` maps a scope to a map
only for its sport (a football country for football, the NBA map for basketball),
so a world NBA campaign saved before (`clubScope` `all`, `elite` or `NBA`) still
restores on the world. `setClubScope` (App) moves basketball clubs to
`domestic:nba` whatever the setup held, and a football setup left on it to the
Top 124. The setup lists the one row "NBA · 30 clubs", describes the split
("… lead the 30 NBA clubs fighting over the USA and Canada, each starting with only its arena's state or province …"),
loads and previews the map like a country, and titles read "NBA · USA and Canada".
`decodeDomestic` returns the empty land as `empty` (a `WorldGeometry`, only ever
drawn), and `domesticSurroundings` draws it first among the shapes beneath the
map, in the backdrop's neutral grey. It is not an obstacle: like the host shape beneath
England it lies inside the hosts, so a route over it reads as open ground. A franchise
with no land neighbour (the Wizards at kick-off; on the NFL's map the Seahawks) reaches
any rival it has a clear line to, as an island does across the sea, and the words say
so: such a map adds `openLand` to the board, the route line reads "Over open ground —
no shared border" and the fronts note "reached over open ground", the setup's Fronts
"every war crosses open ground", and a route that must bend around rival land is a
"Route around rival land", not a coastal sea route.
The victory names "USA and Canada". Basketball squads are not FM players, so
checkpoints store them in full (no `playerPack`).

**Era maps** (2026-10-30; back to 1960/61 since 2026-11-09). The earlier basketball seasons
([football-years.md](football-years.md#era-maps)) play on maps of their own eras,
built by the same command from `scripts/data/nba-seasons.json`: one map per era of
franchises, cities and arena points (`nba1961` … `nba2014`, 42 in all, 30 of them
added with the computed seasons of 1960/61 to 1997/98), each from that era's
arenas and with section ids in today's strength order (a moved franchise ranks as
its successor: the Syracuse Nationals as the 76ers, the Cincinnati Royals as the
Kings, the Chicago Packers as the Wizards). Such a map adds `seasons` (the set ids
it serves) to its file and index entry, its rows add the franchise's `name`, and
the loader then takes no club from the game's data: the season gives each row its
name, code, strength and five at kick-off. Today's `nba.json` is unchanged and
also serves the seasons from 2014/15, whose franchises are today's. The 1960s and
1970s maps divide the states shared then by county as today's does: New York
between the Knicks and the Syracuse Nationals (1960/61 to 1962/63), the Knicks
and the Buffalo Braves (1970/71 to 1977/78) and, in 1976/77, the New York Nets at
Uniondale too; California between the Lakers and the Warriors from 1962/63, with
the San Diego Rockets (1967/68 to 1970/71) or Clippers (from 1978/79); Ohio
between the Royals and the Cavaliers (1970/71, 1971/72); Texas between the
Rockets and the Spurs from 1976/77. The Kansas City-Omaha Kings hold Missouri
alone.
`nba1984` serves 1981/82 to 1983/84 (one build later than 1983/84's alone: a
campaign saved on the earlier build resumes club by club).

**Checks**: `scripts/nba-map.test.mjs` (in `npm run test:domestic`): file, index,
arenas and clubs agree; the USA and Canada are all the land and the hosts are not
drawn beneath it; the empty regions are exactly the states and provinces without an
arena, drawn but no obstacle, on the sections' arcs; towns of one state fall in one
territory, towns of empty land in none, and New York splits between the Knicks and
the Nets only; on the 1960s and 1970s maps, New York splits between the Knicks and the
Syracuse Nationals (1960/61) and among the Knicks, the Braves and the New York Nets
(1976/77), California among its three franchises of 1967/68, Ohio between the Royals
and the Cavaliers, and the Kansas City-Omaha Kings hold Missouri alone, Nebraska
nobody's; cross-border land neighbours and neighbour colours; a franchise with
no land neighbour still reaches its rivals over open ground, in those words; seeded duel
campaigns on the app board reach a champion without treaties or third-party
crossings; loader refusals; the App sets up, launches and titles an NBA campaign
and keeps an old world NBA save on the world. The smoke's NBA scenarios run
through the country-map checks. `scripts/club-maps.test.mjs` holds every league's
maps, today's and each era's, to the rule: a town of a state with a club lies in a
club's section, one of a state without lies on its own empty land, and no section
reaches into a second state.

## The NFL map

Status: implemented 2026-10-31. American football ([american-football.md](american-football.md))
has one theatre, **NFL**, played on `public/domestic/nfl.json`: the USA, where each
of the 32 franchises holds its own state (since 2026-11-07, as on the NBA's map). It is
built by the same command and partition as the NBA's: `scripts/build-nba-map.mjs` became
`scripts/build-club-maps.mjs`, with one entry per league in `LEAGUES` (`npm run
build:club-maps` builds both; `build:nba-map` and `build:nfl-map` one each, the
index keeping the other league's entries as they are). The NBA maps rebuild byte
for byte; only their attribution files name the new script.

- **Units**: the USA's counties grouped by state, as for the NBA, with no second
  country, so no border fitting. Puerto Rico and the other territories are cut;
  Alaska and Hawaii lie off the landmass and are dropped. The 25 other states without
  a stadium stay empty, from Maine to Oregon.
- **Homes**: `scripts/data/nfl-teams.json`, each franchise's stadium, except the
  four that share one, which grow from their training grounds (see
  [american-football.md](american-football.md#data)).
- **Shared states**: California and Florida (three franchises each), Texas,
  Pennsylvania, Ohio, Maryland and New Jersey (two each) split along county lines.
  MetLife Stadium stands in New Jersey, but the Giants and Jets are New York's, so
  the league joins New York to New Jersey (`joins: { 'US-NJ': ['US-NY'] }`): New
  York's counties go to the Bills or to either New Jersey franchise. The Giants,
  nearer the city, hold Manhattan and Long Island; the Bills western and northern New
  York. Northwest Stadium stands in Maryland, but the Commanders are Washington's, so
  the District of Columbia is joined to Maryland too (`'US-MD': ['US-DC']`), and goes
  to them. Los Angeles County is cut between the Rams and the Chargers.
- **Result** (2026-11-07 build): Denver holds Colorado; Las Vegas Nevada; Kansas City
  Missouri; Seattle Washington; Washington DC and western and southern Maryland; Baltimore
  its city and the Eastern Shore. Texas is divided between
  Houston (358,000 km²) and Dallas (331,000), California between San Francisco
  (211,000), the Chargers (100,000) and the Rams (99,000). Areas range from Washington's
  13,000 km² to Houston's. The file is about 141 KB; the index entry adds
  `venue: "stadium"` and `lines: "state"`, so the setup reads "… each starting with
  only its stadium's state."

**Checks**: `scripts/american-football.test.mjs`: file, index, stadiums and clubs
agree; every stadium (or training ground) lies inside its territory; Manhattan is
the Giants', Buffalo the Bills', Morris County the Jets', the San Fernando Valley
the Rams', San Diego the Chargers' and DC the Commanders'; the empty states are
exactly those without a franchise; seeded duel campaigns reach a champion; the App
launches on the map. The smoke runs an NFL duel and an NFL resume.
`scripts/club-maps.test.mjs` holds it to the rule, as it does the NBA's and MLB's.

**Era maps from 1960** (2026-11-09): the earlier seasons ([american-football.md](american-football.md#computed-seasons))
reach back to 1960 on 20 more NFL maps by the same rule, and the American Football League's ten seasons before the
1970 merger play on ten maps of their own, `afl1960` to `afl1969`, an `afl` entry in `LEAGUES` (league `AFL`, its
clubs only, the NFL's joins; `--league=afl`). A map of another league of its day names its clubs' league, which the
loader accepts (`validateClubsOnMap`). A club whose stadium lies outside its league's joined states holds its own
state alone: the Giants at the Yale Bowl hold Connecticut in 1973–74, which `scripts/club-maps.test.mjs` allows.

## The FBS map

Status: implemented 2026-11-15. College football ([college-football.md](college-football.md)) has one theatre, **FBS**,
played on `public/domestic/cfb.json` (165 KB): the USA, where each of the 138 schools holds the state its stadium stands
in (`LEAGUES.cfb`, `npm run build:cfb-map`, built in about three seconds by the NFL's rule).

- **Homes**: `scripts/data/cfb-teams.json`, each school's stadium (English Wikipedia's list of FBS stadiums and each
  stadium's article). No two schools share a stadium. A territory is named after its college town (`city`); the
  builder requires them distinct, so four towns two schools share carry their state's postal code and the two cities
  with two schools name the side each holds.
- **Shared states**: 33 states hold two schools or more and split along county lines: Texas thirteen, Ohio and
  California eight, Florida and North Carolina seven, Alabama six, Virginia, Michigan, Louisiana and Georgia five. Six
  counties hold two stadiums (Fulton, Harris, Miami-Dade, Los Angeles, Santa Clara, Washtenaw), and `maxGapKm` 0.5 cuts
  each between its two, as the NRL's map cuts its shared councils: Georgia Tech takes the north of Fulton, Georgia
  State the south; Houston the east of Harris, Rice the west; Miami (Hard Rock Stadium) the north of Miami-Dade, FIU the
  south; UCLA (the Rose Bowl) the north of Los Angeles County, USC the south.
- **Hawaii**: the partition drops land overseas unless a club's home stands on it (`dropOverseas`), so Hawaii, the
  Rainbow Warriors' (a stadium in Honolulu), stays, at its true place: the map's opening view runs from −161.6° to −68.1°.
  Moving it nearer as an inset would put it on Mexico, which the map draws beneath as inert land and an obstacle to
  routes. `scripts/club-maps.test.mjs` keeps Honolulu on this map only (`HELD_OVERSEAS`).
- **Empty**: Montana, South Dakota, Maine, New Hampshire, Vermont, Rhode Island and DC; Alaska is dropped. North Dakota
  is North Dakota State's (the Mountain West's from 2026).

**Era maps 2004–2025** (2026-11-18; 2004–2008 2026-11-20): the computed FBS seasons ([college-football.md](college-football.md))
play on 19 maps of their own, `cfb2004` to `cfb2025`, one per run of seasons with the same schools at the same stadiums
(2009–2010, 2015–2016 and 2018–2019 share one each; 2004 to 2008 each have one), built with today's by `npm run build:cfb-map` from
`scripts/data/cfb-seasons.json`: `maps` lists each map's seasons and their `schools`, `venues` the stadiums of the day
(scripts/lib/cfb-maps.mjs reads them). A season's schools are those that played a completed game against another FBS
school and field a squad, 112 in 2004 to 136 in 2025, in today's map's order. Idaho, FBS to 2017 and kept in the
manifest's `schools`, fields 2004–2008 on rosters rebuilt from its signings and no season after (its rosters are too
thin), so Moscow is its own to 2008 and Boise State holds all of Idaho from 2009; Florida A&M, in the manifest for ESPN's
2004, fields none. Each school holds the state of the
stadium it played most of its home games in that season, counted from ESPN's schedule (sportsdataverse's
cfbfastR-cfb-data) without neutral sites, and keeps its town's name. Where that is not today's stadium (a renamed one
is the same), `venues` names it as it was then and places it from its English Wikipedia article at a pinned revision:
Floyd Casey Stadium, Robertson Stadium, the Superdome, Hughes Stadium, the Georgia Dome, Aloha Stadium, Legion Field,
Sam Boyd Stadium, Qualcomm Stadium, Ladd–Peebles Stadium. Where ESPN names no venue, flags a season away from home as
neutral or places games wrongly, the season's own Wikipedia article settles it, noted and pinned in the manifest
(`evidence`): Cal at AT&T Park in 2011, Washington at CenturyLink Field in 2012, Houston at Reliant Stadium in 2013,
North Texas at Fouts Field 2004–2010 and FAU at Lockhart Stadium 2008–2010, Akron at the Rubber Bowl and Minnesota at the
Metrodome to 2008, Miami at the Orange Bowl to 2007 (FIU too in 2007), UCF at the Florida Citrus Bowl to 2006, Tulane at
the Superdome through 2005, when Hurricane Katrina spread its home games over six grounds, Temple at Lincoln Financial
Field in 2004 (ESPN has Franklin Field), San Diego State at Carson in 2020–2021 (ESPN has
Qualcomm Stadium), Hawaii and UAB at their new stadiums from 2021, Northwestern at Martin Stadium in 2024–2025, Kansas
at Arrowhead Stadium in 2024 (in Missouri, so Kansas State holds all of Kansas) and Sam Houston at Shell Energy
Stadium, Houston, in 2025. UMass's three-and-three seasons of 2014–2016 go to the stadium of the season before,
Gillette Stadium. Three schools share Los Angeles County in 2020–2021 and Harris County in 2025, cut as two are.
`scripts/club-maps.test.mjs` holds every era map to the state rule, each school to a territory around its stadium of
the day, and the maps to the season snapshots.

## The MLB map

Status: implemented 2026-11-01. Baseball clubs ([baseball.md](baseball.md)) have one
theatre, **MLB**, played on `public/domestic/mlb.json`: the USA and Canada, where each
of the 30 clubs holds its own state or province (since 2026-11-07, as on the NBA's map),
by the same command and partition (`LEAGUES.mlb` in `scripts/build-club-maps.mjs`;
`npm run build:mlb-map`).

- **Units**: the USA's counties and Canada's economic regions grouped by state and
  province, fitted to the US line, as for the NBA. Every state and province without a
  ballpark stays empty; Hawaii, Puerto Rico and the other territories are dropped.
- **Homes**: `scripts/data/mlb-teams.json`, each club's ballpark at its Wikidata
  coordinates. No two clubs share a ballpark.
- **Shared states**: California (five clubs), New York, Illinois, Texas, Florida, Ohio,
  Pennsylvania and Missouri (two each) split along county lines. Wrigley Field and
  Rate Field both stand in Cook County, 16 km apart, which is under the partition's
  own limit for cutting a shared county (half the grain, about 20 km of US county), so
  the White Sox first started outside their territory. The league sets `maxGapKm: 5`
  instead, and Cook County is cut between the Cubs (the North Side) and the White Sox
  (the South Side). The Yankees (the Bronx) and the Mets (Queens) have counties of
  their own.
- **Result** (2026-11-07 build): Boston holds Massachusetts; Toronto Ontario; Seattle
  Washington; Baltimore Maryland; Atlanta Georgia. Texas is divided between Houston (359,000 km²) and the
  Rangers (331,000), Illinois between the White Sox (85,000) and the Cubs (61,000),
  Missouri about evenly between Kansas City and St. Louis, and California between the
  Athletics (146,000), the Dodgers (95,000), the Giants (74,000), the Angels (73,000)
  and the Padres (23,000). Areas range from the Nationals' 200 km² or so (the District of
  Columbia) to Toronto's 983,000 km². The file is about 162 KB; the index entry adds
  `venue: "ballpark"`, so the setup reads "… each starting with only its ballpark's
  state or province."

**Checks**: `scripts/baseball.test.mjs`: file, index, ballparks and clubs agree; every
ballpark lies inside its territory; Wrigley Field is the Cubs', Rate Field the White
Sox's, Yankee Stadium the Yankees', Citi Field the Mets' and Ottawa the Blue Jays';
seeded duel campaigns reach a champion; the App launches on the map. The smoke runs
an MLB duel and an MLB resume.

**Era maps, 1960–2017** (2026-11-09; [baseball.md](baseball.md#seasons-before-2018-computed-from-war)):
37 more maps, `mlb1960` to `mlb2017`, for the seasons computed from WAR, built from the
franchise eras of `scripts/data/mlb-war-seasons.json` by the same partition. Each club
holds its ballpark's state or province, the ballpark being the one it played most of its
home games in (the Baseball Databank's HomeGames, from Retrosheet's game logs; each map's
attribution credits both). A map serves consecutive seasons with the same clubs,
named alike, in the same places: a ballpark renamed in place keeps its map (named as its
first season knew it), and the map builder now checks every MLB era, MLB The Show's
included, by that rule (`[id, name, territory, base, point]`); mlb2018 to mlb2025 rebuild
byte for byte. Two clubs that shared a ballpark (the Angels at Dodger Stadium in
1962–65, the Yankees at Shea Stadium in 1974–75) cannot share out one county, so the
tenant grows from its own previous ballpark (`base`, as the NFL's shared stadiums grow
from training grounds): Wrigley Field, Los Angeles, and Yankee Stadium. Los Angeles
County is cut between the Dodgers and the Angels in 1961–65, the Polo Grounds Mets' part
of New York State is "Manhattan" in 1962–63, beside the Yankees' Bronx, and before the
Expos of 1969 Canada's provinces are all empty. `scripts/club-maps.test.mjs` holds every
one to the rule; 2017 has its own map (2018's clubs and places), so mlb2018 is unchanged.

## The NHL map

Status: implemented 2026-11-07. Ice hockey clubs ([hockey.md](hockey.md)) have one theatre,
**NHL**, played on `public/domestic/nhl.json`: the USA and Canada, where each of the 32 clubs
holds its own state or province, as on the NBA's map, by the same command and partition
(`LEAGUES.nhl` in `scripts/build-club-maps.mjs`; `npm run build:nhl-map`). Every state and province
without a club stays empty. Homes are `scripts/data/nhl-teams.json`, each club's arena.

- **Shared states**: California and New York (three clubs each), Florida, Pennsylvania, Ontario
  and Alberta (two each) split along county and economic-region lines. The Capitals hold the
  District of Columbia alone, the league's smallest territory by far.
- **Scraps**: the NHL is the first league to split Ontario and to have a New Jersey club beside
  New York's. A scrap of a shared state that only another state's land touches (Staten Island,
  the islands of Lake of the Woods) would go to that state's club, which the map refuses, so
  it stays with its own state's nearest club, across the water. The other leagues' maps have
  no such scraps and rebuild byte for byte.

**Checks**: `scripts/hockey.test.mjs`: file, index, arenas and clubs agree; every arena lies
inside its territory; the shared states are split, Staten Island stays New York's; seeded duel
campaigns reach a champion; the App launches on the map. The smoke runs an NHL duel.

**Era maps** (2026-11-08, then 2026-11-09 for every season back to 1966/67, and 2026-11-13 back to 1960/61): the same
command draws 31 maps of earlier seasons from `scripts/data/nhl-seasons.json` (clubs and arenas by season,
[hockey.md](hockey.md#eras)), `nhl1967` (the Original Six, 1960/61 to 1966/67) to `nhl2025`. A map serves a run of
seasons while the clubs and their names stay the same and each arena stays in its county (in a state or province no other club shares, its state) and within 15 km of the first
season's arena (`NHL_MOVE_KM`); it keeps the first season's arenas and places, and the builder throws when a season
breaks the rule. The defunct Seals and Barons rank after today's 32 franchises. 2025/26 plays on `nhl` itself, and the
builder checks its clubs and arenas are today's. Firsts: the 1979/80 Whalers hold central and western
Massachusetts from Springfield and leave Connecticut empty; the Seals split California with the Kings, the Scouts
Missouri with the Blues; the 2015/16–2017/18 Islanders, at Brooklyn's Barclays Center, hold Brooklyn, Queens and Long
Island.

## The NRL map

Status: implemented 2026-11-08. Rugby league clubs ([rugby-league.md](rugby-league.md)) have one theatre, **NRL**,
played on `public/domestic/nrl.json`: Australia and New Zealand, where each of the 17 clubs holds its own state,
territory or region, by the same command and partition (`LEAGUES.nrl` in `scripts/build-club-maps.mjs`; `npm run
build:nrl-map`). Grounds are `scripts/data/nrl-teams.json`; the Rabbitohs and Bulldogs (who share Accor Stadium) and the
Wests Tigers grow from their training bases.

- **Units**: geoBoundaries gbOpen AUS ADM2 (local government areas, ABS, CC BY 4.0) grouped by ADM1 (states and
  territories), and NZL ADM2 (districts, Stats NZ, CC BY 4.0) grouped by ADM1 (regions). The builder takes the eastern
  hemisphere's side of the antimeridian for this league (`east`), so the Chathams go; the world map's Norfolk Island and
  Indian Ocean Territories are cut. GitHub's raw links answered 504 for three of the four layers on 2026-11-08; the
  same files, pinned to the same commit, came from `media.githubusercontent.com` into the cache, which is now where the
  downloader always reads a layer's LFS object (Stage 2, "Where a missing input comes from").
- **No border to fit**: the Tasman Sea lies between the two countries (`border: null`), so no edge is fitted as the US
  and Canadian ones are; the Warriors reach Australia across the water, as island clubs do on the country maps.
- **Shared states**: New South Wales (ten clubs) and Queensland (four) split along council lines. Eight of New South
  Wales's clubs are in Sydney: the Roosters (50 km²), Rabbitohs (133 km²) and Wests Tigers (145 km²) start hemmed in,
  while Parramatta (309,000 km²) and Penrith (281,000) take the west. Queensland goes to the Cowboys (960,000 km²), the
  Dolphins, the Titans and the Broncos. The Storm hold Victoria, the Raiders the Australian Capital Territory, the
  Warriors the Auckland Region; Western Australia, South Australia, Tasmania, the Northern Territory, Jervis Bay and
  every other New Zealand region stay empty.
- The file is about 134 KB; the index entry adds `venue: "ground"` and `lines: "state or region"`, so the setup reads
  "… fighting over Australia and New Zealand, each starting with only its ground's state or region."

**Checks**: `scripts/rugby-league.test.mjs`: file, index, grounds and clubs agree; every ground lies inside its
territory; Victoria, the ACT and Auckland are one club's, Cairns the Cowboys', Wollongong the Dragons', Hamilton nobody's;
seeded duel campaigns reach a champion across the Tasman; the App launches on the map. `scripts/club-maps.test.mjs`
holds it to the state rule with towns of each state and region. The smoke runs an NRL duel.

**Era maps** (2026-11-08, 2026-11-09, 2026-11-13 and 2026-11-14): the earlier seasons
([rugby-league.md](rugby-league.md#earlier-seasons)) play on maps of their day, built by the same command from `teams`
and `maps` in `scripts/data/rugby-league-seasons.json`, 10 to 20 clubs each, about 134 KB. Rules R1–R3 decide when a
ground change makes a new map: a club keeps its own ground while it is rebuilt (R1), COVID-19 relocations are ignored
(R2), and a rename on the same site does not split a map (R3). For 1998–2007
([rugby-league.md](rugby-league.md#computed-seasons-19982007)) a club plays at the ground of most of its home games that
season, by NRL.com's draw (level counts keep the season before's), named as it was then from English Wikipedia's articles
at pinned revisions; for 1960–1997 ([rugby-league.md](rugby-league.md#computed-seasons-19601997)) by the Rugby League
Project's results the same way, leaving out the games the league staged at the SCG and the Sydney Sports Ground before
1988 (but Eastern Suburbs' at the Sports Ground, its own). The clubs no club of today's continues (the manifest's
`defunct`: the Adelaide Rams, Balmain, the Gold Coast Chargers, Illawarra, North Sydney, the Northern Eagles, Western
Suburbs, Newtown, the South Queensland Crushers, the Western Reds and the Hunter Mariners) keep their own ids and rank
after today's clubs, so section ids still follow one order; `nrlSpecs` refuses any other club that is no franchise of
today's. A season is keyed by its year, but Super League's 1997, which ran beside the ARL's, by its id (`nrl-sl-1997`).
The maps before 1998 name their seasons' premiership in the NRL's place (2026-11-14): `league` is `NSWRFL` to
`nrl1982`, `NSWRL` from `nrl1984`, `ARL` from `nrl1995` and `Super League` on `sl1997`, as the AFL's maps name the AFL,
so the setup's theatre and club count and the campaign's title say the competition of the day; the seasons' clubs carry
the same league. `LEAGUES.nrl.eraLeagues` lists the four, so that building another league's maps keeps their entries.

| Map | Seasons | Grounds and bases that set it apart |
| --- | --- | --- |
| `nrl1960` | 1960–1966 | the NSWRFL's ten, all of them Sydney's: New South Wales split among them, every other state empty; Western Suburbs at Pratten Park, Parramatta at Cumberland Oval, Eastern Suburbs at the Sydney Sports Ground |
| `nrl1967` | 1967 | twelve: Cronulla-Sutherland (Sutherland Oval) and Penrith; Western Suburbs at Lidcombe Oval |
| `nrl1968` | 1968–1970 | Cronulla-Sutherland at Endeavour Field |
| `nrl1971` | 1971–1972 | Balmain at Eastern Suburbs' Sports Ground, growing from Leichhardt Oval |
| `nrl1973` | 1973–1976 | the Newtown Jets; Balmain back at Leichhardt |
| `nrl1977` | 1977 | Eastern Suburbs at the SCG |
| `nrl1978` | 1978–1981 | the Canterbury-Bankstown Bulldogs |
| `nrl1982` | 1982–1983 | fourteen: Canberra at Seiffert Oval in Queanbeyan, so a corner of New South Wales and no Territory; Illawarra at Wollongong; Parramatta keeps Cumberland Oval's site while it is rebuilt (R1) |
| `nrl1984` | 1984–1986 | thirteen, without Newtown; St. George keeps Kogarah while it is rebuilt (R1) |
| `nrl1987` | 1987 | Western Suburbs at Campbelltown; Eastern Suburbs keeps the Sports Ground's site, rebuilt as the Sydney Football Stadium (R1) |
| `nrl1988` | 1988–1989 | sixteen: the Broncos at Lang Park, the Gold Coast-Tweed Giants at Tweed Heads (New South Wales), the Newcastle Knights; the Rabbitohs from Redfern Oval |
| `nrl1990` | 1990 | Eastern Suburbs at Henson Park, the Rabbitohs alone at the Sydney Football Stadium; Canberra at Bruce Stadium, the Territory theirs |
| `nrl1991` | 1991–1992 | Eastern Suburbs back at the Sydney Football Stadium |
| `nrl1993` | 1993–1994 | the Broncos at ANZ Stadium |
| `nrl1995` | 1995 | the ARL's twenty: Auckland, North Queensland, the South Queensland Crushers (Lang Park), the Western Reds (the WACA); the Sydney Bulldogs and Sydney Tigers at Parramatta Stadium, from Belmore and Leichhardt |
| `nrl1996` | 1996 | the Canterbury Bulldogs back at Belmore; the Gold Coast Chargers at Carrara |
| `nrl1997` | 1997 | the ARL's twelve: no Brisbane, Canberra, Canterbury, Cronulla, Penrith, Auckland, North Queensland or Perth |
| `sl1997` | Super League 1997 | Super League's ten: the Adelaide Rams hold South Australia, the Perth Reds Western Australia, the Hunter Mariners (Topper Stadium) the Hunter, the Warriors Auckland |
| `nrl1998` | 1998 | twenty clubs, thirteen in New South Wales: St. George (Kogarah) and Illawarra (Wollongong) apart, the Adelaide Rams holding South Australia, the Gold Coast Chargers, the North Sydney Bears, Balmain (Leichhardt) and Western Suburbs (Campbelltown); Canterbury at Belmore |
| `nrl1999` | 1999 | seventeen: the St. George Illawarra Dragons at Wollongong; Canterbury at Stadium Australia, which cuts the City of Parramatta with the Eels |
| `nrl2000` | 2000 | fourteen: the Wests Tigers from Concord Oval, the Northern Eagles at Gosford, no South Sydney |
| `nrl2001` | 2001 | the New Zealand Warriors by name; the Storm at Colonial Stadium; the Bulldogs at the Sydney Showground |
| `nrl2002` | 2002 | fifteen: the Rabbitohs back, from Redfern Oval; the Northern Eagles at Brookvale in their last season |
| `nrl2003` | 2003–2005 | Manly again; the Broncos at Suncorp Stadium |
| `nrl2006` | 2006 | the Rabbitohs and the Bulldogs share Stadium Australia: both grow from their training grounds, Redfern Oval and Belmore |
| `nrl2007` | 2007 | sixteen: the Gold Coast Titans at Carrara Stadium |
| `nrl2008` | 2008, 2009 | the Bulldogs (as "Bulldogs") train at Sydney Olympic Park and share the City of Parramatta with the Eels; the Storm at Olympic Park Stadium |
| `nrl2010` | 2010, 2011 | Canterbury-Bankstown again, still at Sydney Olympic Park until October 2011; the Storm at AAMI Park |
| `nrl2012` | 2012–2019 | the Bulldogs back at Belmore; the Cowboys still at Dairy Farmers (1300SMILES) Stadium |
| `nrl2020` | 2020–2022 | the Cowboys at the North Queensland Stadium; the Roosters' new stadium; the Rabbitohs still at Redfern Oval; no Dolphins |

2023 and 2024 have today's clubs at today's grounds and play on `nrl.json` itself: `nrlSpecs` checks that they equal
`scripts/data/nrl-teams.json` and builds no copy. Each era's clubs rank as their franchises do today, so section ids
follow the same order on every map. `scripts/rugby-league-seasons.test.mjs` checks the City of Parramatta (cut between
the Bulldogs and the Eels only while the Bulldogs were at Olympic Park or Homebush), Redcliffe (the Broncos' until the
Dolphins came), each era's Rabbitohs, and on the maps of 1998–2007 that every club holds the point it grows from, South
Australia the Rams' in 1998 alone, St. George and Illawarra apart in 1998 only, and the Northern Eagles at Gosford, then
Brookvale; on the eighteen of 1960–1997 the same of every club (or, its ground on an estuary the simplified coast leaves
out, Seagulls Stadium on the Tweed, the section of its town), Sydney's clubs alone until 1982, the Territory empty until
Canberra moved to Bruce Stadium in 1990, and Super League's clubs in Perth, Adelaide, the Hunter and Auckland.

## The NWSL map

Status: implemented 2026-11-09. Women's football's NWSL clubs ([womens-football.md](womens-football.md)) play one of
the sport's three club theatres, **NWSL**, on `public/domestic/nwsl.json`: the USA, where each of the 16 clubs holds the
state its stadium stands in, by the same command and partition (`LEAGUES.nwsl` in `scripts/build-club-maps.mjs`;
`npm run build:nwsl-map`). The other two are maps of Europe (below), so unlike the NBA's this map is not the sport's
only one: `clubMapOf` leaves a sport with Europe maps alone, and the setup lists the NWSL beside them
(`theatreMapsOf` in `src/data/domesticScope.js`).

- **Stadiums**: `scripts/data/nwsl-teams.json`, each point Wikidata's (the club's home venue, or the stadium's own item),
  with `seasons` for the clubs that played elsewhere, or under another stadium name, in an earlier season.
- **Shared state**: California's three clubs (Bay FC 211,000 km², Angel City 105,000, the San Diego Wave 94,000) split it
  along its counties. The Washington Spirit holds only the District of Columbia, as the Wizards and Nationals do.
- **A join**: Boston Legacy FC plays at Centreville Bank Stadium in Pawtucket, Rhode Island, until White Stadium opens in
  2028 (Wikipedia), so `joins: { 'US-RI': ['US-MA'] }` gives it Massachusetts too, as the NFL's Commanders hold DC.
  Gotham FC holds New Jersey only, its stadium's; New York stays empty.
- **Earlier seasons**: `nwsls<year>` for each women's season with NWSL clubs: 2025 (EA FC 26, 14 clubs), 2024 (EA FC
  25, 14) and 2023 (EA FC 24, 12). Each is its season's alone, its clubs in that season's strength order, and the index
  entry names its strongest (`eraTop`), since the setup cannot read them off the season: half its clubs are European. In
  2023 the Current played at Children's Mercy Park in Kansas City, Kansas, so they hold Kansas; the Chicago clubs hold
  Illinois from Bridgeview (2023–24) and Evanston (2025 on).
- The files are about 135 KB; the index entries add `venue: "stadium"` and `lines: "state"`, so the setup reads
  "… fighting over the USA, each starting with only its stadium's state."

**Checks**: `scripts/club-maps.test.mjs` holds every NWSL map to the state rule (Boston Legacy joined to Massachusetts);
`scripts/womens-club-maps.test.mjs` checks the fields, California's three, DC, Kansas in 2023, the setup and a seeded
campaign to a champion. The smoke runs an NWSL blitz.

## The Europe maps

Status: implemented 2026-11-07. Football clubs have two theatres, **Top 124** and
**Elite 32**: the strongest clubs of the season on a map of Europe, each club on land
in its own country. They replace the single-league theatres and the dealing of clubs
across the world map. The map is format 1 (one section per club), with the fields of
"The NBA map" below that a sport's own map adds, and it reuses that runtime: loader,
chart, backdrop, routing, saves.

**The field.** `scripts/build-clubs.mjs` takes the first-division clubs of the 26
European leagues in the EA FC 27 snapshot, plus PFC Ludogorets, which EA lists under
no competition (`scripts/lib/first-divisions.mjs`, which the realism harness also plays
whole leagues from): 309 clubs with a natural XI. The strongest `TOP_CLUBS` (124, in
`src/data/scopes.js`) by the exact mean of that XI are `src/data/clubs.football.js`,
strongest first: 20 clubs each from England and Spain, 19 Italy, 16 Germany, 15 France,
6 the Netherlands, 4 each from Portugal, Turkey, Belgium and Greece, 3 Czechia, 2 each
from Denmark, Ukraine and Scotland, and one each from Norway, Croatia and Bulgaria.
The strongest `ELITE_CLUBS` (32) are the elite. The league names and the map shape each
league's clubs hold land in are `src/data/footballLeagues.js` (`EUROPEAN_LEAGUES`).

**An earlier season's field** (since 14 November 2026) is drawn the same way from its own
source: every European first division the source rates, its clubs with eleven rated players,
and the strongest `TOP_CLUBS` kept in the season's file (`strongestBuilt` in
`src/data/footballSetBuild.js`, by strength then name, as the file lists them). The EA
editions (`scripts/lib/ea-seasons.mjs` `EA_LEAGUES`, by competition id, Russia's 67 among
them; FIFA 07–14 by SoFIFA's league names, FC 25 by its website's) rate 130–177 clubs beyond
the seven big leagues a season, of which 18–27 make the 124; the Championship Manager
databases (`LEAGUES`, by stored competition names; CM 97/98 by division codes) 66–247, of
which 13–31 make it. The elite takes 0–5 of them: Galatasaray, Fenerbahçe and Beşiktaş, Zenit,
CSKA Moscow and Anzhi in FIFA 11–16, Celtic and Rangers in the CM seasons, Spartak Moscow in
1993/94 and 1998/99. A club EA files under Rest of World for want of a licence plays in the
league its id is in in the nearest other edition (FIFA 20's Greek, Russian and Ukrainian
clubs, Dinamo Zagreb, HJK). Two data quirks show: CM 99/00 rates Denmark's clubs like
mid-table Serie A ones (11 make 1999/00's 124), CM 01/02 puts eight or nine Swedish clubs in.
SWOS 96/97, 95/96 and 94/95 come from the game's team files: since 17 November 2026 their
season files read the top division of every league file whose league is one of Europe's first
divisions (`SWOS_EUROPE_LEAGUES` in `scripts/lib/swos.mjs`: 31, every one but Azerbaijan's),
28–29 clubs from beyond the seven big leagues a season make the 124, and the elite takes
Rangers and Anderlecht every season. SWOS rates a club by its sixteen's mean price step, which
leaves dozens of clubs on one rounded strength at the cut, so SWOS's cut goes by the unrounded
mean. Until then they kept the seven big leagues' top divisions whole (134 clubs), the other
league files being uncached.
Until 14 November 2026 (SWOS's: 17 November) an earlier season's file held the seven big
leagues only, and its two fields were the strongest of those; those maps stay for the
campaigns saved on them (below). FIFA 06,
FIFA 05 and Simon Treanor's fan-made 1989/90 (2005/06, 2004/05, 1989/90) and the computed
seasons (1960/61 to 1993/94) have nations only, so they have no maps.

**Build** (`npm run build:europe-maps`, `scripts/build-europe-maps.mjs`, about 30 minutes, most
of it the earlier seasons' maps with Russian clubs, whose 1,557 districts the partition grows over;
`--only=eu124,eu32`, `--check`, `--dry-run`, `--boundaries=<dir>` for another boundary cache).
The maps follow the clubs, so they are rebuilt after `npm run build-clubs`,
`npm run build:ea-seasons` or `npm run build:retro-seasons`; the build stops on a club with
no row in the table below, and the test on a field that has changed. For each of the 32
seasons with clubs (the built-in one and 31 earlier) and each of the two fields:

- **Homes**: `scripts/data/europe-clubs.json`, one row per club of any season: a
  `city` that names its land (repeats take the club: "Rome (Lazio)"), `home`, and
  `shape` where the land is not its league's: the Welsh clubs of the Premier League
  hold `WAL`. Coordinates come from the club's row in a country map (`source`: its
  `d<nation>-<FM id>`, by the crest twin or by name) or by hand. AS Monaco stays in
  France: Monaco's own world shape is a few pixels. The earlier seasons' fields from all of
  Europe added 120 rows (14 November 2026): 22 copy the same club's row under another name
  (CM's Glasgow Celtic is EA's Celtic), 91 take a country map's club by name (a club gone
  since stands at its successor's ground: FC Tirol at Wacker Innsbruck's Tivoli, Herfølge at
  HB Køge's, Lierse SK at Lierse Kempenzonen's), and seven are by hand: Aberdeen, Hearts and
  Hibernian at their grounds, as Scotland has no country map, and Anzhi Makhachkala, Akhisar
  Belediyespor, Gaziantepspor and Manisaspor, on no country map today, at their towns (GeoNames).
- **One club in a country**: the section is the country's world shape, without land
  beyond `OVERSEAS_KM` of its main landmass (French Guiana, the Dutch Caribbean). The
  Azores, Canaries and Svalbard stay; the opening camera leaves them out.
- **Part of a country** (`within`): Russia's clubs hold European Russia only, the 56
  federal subjects of its Central, Northwestern, Southern, North Caucasian and Volga federal
  districts (`WITHIN.EUROPEAN_RUSSIA`, by ISO code, about 4.0 million km²), even a lone club.
  Its whole would give a Moscow club the Pacific and frame Eurasia. Its units are those of
  the regions named; `fitToOutline` leaves out every missed piece of the world outline that
  lies nearer the other regions than the clubs' land (Asian Russia, the slivers along its
  borders), and the map lists Russia in `partial`: the game draws Russia's world shape
  beneath it, grey where no club holds it, and routes go around that as around any
  neighbour. The camera frames the clubs' land (`partShape`), and simplification keeps only
  the world outline's vertices, not the regions' line across the country. Russia's ADM2
  layer leaves out Moscow and St Petersburg, federal cities; until 2026-11-15 each was a
  missed piece, given to the nearest club, and since then both are filled in from ADM1
  (below), so Moscow is a unit its clubs share. A missed piece holding clubs' grounds still
  goes to the nearest of those clubs (`homes`, here only).
- **Several clubs** (since 2026-11-15 down to the communes): `COUNTRIES`
  (`scripts/lib/admin-levels.mjs`) lists every European country's administrative levels,
  coarsest first, down to the finest its sources have: regions, then provinces,
  departments or counties, then communes (municipalities, parishes, cadastral areas).
  France has its régions, départements, arrondissements and communes (Paris, Lyon and
  Marseille by their municipal arrondissements); Italy its regions, provinces and comuni;
  Portugal its districts, municipalities and parishes (freguesias); Czechia goes down to
  its cadastral areas (Prague's Bubeneč and Vršovice), Austria to its municipalities' parts
  (Vienna's districts), and Switzerland and Austria start from their cantons and states.
  Every level geoBoundaries lists for a country is used or skipped with a stated reason,
  and the build stops on one that is neither (`checkLevels`): France's cantons cross
  arrondissement lines (9% of the land), Italy's five groups of regions are statistical,
  Luxembourg's ADM3 is another year's communes. All 49 European nations with a world shape
  have an entry, not only those a map divides today. The home nations have only their
  councils in geoBoundaries, so their groups come from Natural Earth's admin-1 file
  (`region_sub`): England's ceremonial and metropolitan counties (Greater Manchester,
  Merseyside, Lancashire; Natural Earth's Wigan is moved into Greater Manchester), Scotland's
  old regions (Strathclyde's parts, Lothian, Tayside), Wales's North, Mid, South and West.
  England's districts below its two-tier counties come from the ONS (Local Authority
  Districts, December 2019, generalised to 20 m, OGL v3, from the ONS's ArcGIS feature
  service, which has no robots.txt; cached as `data-src/boundaries/ons/`), so Lancashire and
  Cumbria are Preston, Burnley, Eden and the rest. The service winds its rings clockwise, the
  other way round from geoBoundaries and polygon-clipping, so they are rewound: merged with a
  cut piece of Liverpool, Cheshire had come out inside out, and Everton's land with it. Since
  then the build stops when a club's territory differs from the sum of its units. England's
  nine regions are statistical, as Italy's
  groups are, and are left out: as top regions they shut the North West's four clubs and
  London's six in on themselves.
  All geometry comes from the finest layer, merged on its shared arcs, so a coarse unit and
  its neighbour's fine ones share every vertex; the coarser layers only group, each unit by
  its interior point (`regionalUnits`). Land the finest layer leaves out is filled in from
  the level above it, as on the country maps (`fillParents`): Moscow and St Petersburg in
  Russia's districts, so Moscow's clubs split their city rather than the districts around
  it, Bursa and İzmir in Turkey's, Greek and Danish islands. A unit's fragments under
  0.5 km² go (slivers where its coast or estuary is drawn finer than the world outline, which
  the outline's fill gives the nearest club). Where a layer's units come in pieces they
  should not (`pieces`: Portugal, 158 of whose parishes do), each piece is a unit of its own,
  grouped by where it lies: as one unit, a parish touches wherever any of its pieces touches,
  joins land that does not join and scatters its club's land in specks (Mangualde's
  municipality came out in five pieces). Elsewhere a unit's pieces stay one unit, which keeps a
  district on both banks of an estuary one way across it (Halton, Widnes and Runcorn across
  the Mersey, the way from Liverpool into Cheshire). After the split, a detached piece of a
  club's land under 400 km² whose edge lies against one other club's land for at least half
  its length goes to that club (`absorbSpecks`). The limit was 100 km² at first, but a club
  that takes a unit in pieces can take its neighbours through the far piece and shut them in
  with it: Real Madrid's 111 km² of Argés, Cobisa and Layos stood inside Rayo Vallecano's
  land by Toledo. A club's pieces that share a border are judged as one, as the map merges
  them, so an island whose channel the world outline's coarser coast fills goes with its
  fill. The club's largest group stays, and so does the one nearest its ground, however small:
  Belenenses' Restelo stands just outside its parish, and without that the rule left the club
  the Azores and Madeira alone. Only borders shared exactly count, before the map is
  simplified: at 50 m, pieces joined across rivers (the Yare at Great Yarmouth, whose
  district lies on both banks) and hid the specks among them. The rule runs in passes until
  nothing moves, as one move can shut the next piece in, and finds what lies against what on
  a grid of edges (`edgeFinder`), not polygon by polygon. The sources draw their levels
  apart (Portugal's municipalities are a few dozen points each, its parishes thousands), so
  the levels are made to nest (`nestLevels`): a region belongs to the parent holding most of its land, and
  a unit whose region lies in another parent moves to the nearest region of its own. Each
  region is then made one piece where land joins it: a part cut off from the rest of its
  region that borders another region of the same parent joins the one it borders most (a
  part across the water stays). Together these leave no specks of one club in another's
  land: across the 98 maps, no piece of 1 to 400 km² as drawn lies against one other club for
  half its edge, against 1,602 before the levels went down to the communes (the test checks
  1 to 300 km², as simplification can shrink a piece by a sixth). Larger pieces can: 23 of
  400 km² or more (24 before), such as Lokomotiv's Severodvinsk inside Spartak's north
  (1,230 km², six seasons from 2001/02 to 2021/22) and Real Madrid's Cádiz beside Valencia's
  Andalusia (about 7,400 km², four seasons from 1993/94 to 2000/01).
    - A region holding one club stays whole, for that club. Should the club start next door
      (boxed in by its city, below), the region goes to its parent's clubs like an empty one.
    - A region holding two or more is split one level down, and only its clubs may
      take its land (the partition's `allowed`). So on down: a province with one club goes
      whole to it, and only a commune holding two or more clubs is cut (the crowd cut).
    - A region holding none stays whole unless it is larger than a club's share. A top
      region splits above an eighth of the country's share per club (`FREE_TOP`; a quarter
      until 2026-11-15), a
      lower one above half a share of the region it lies in (`FREE_LOWER`; a whole share
      until 2026-11-15), so one neighbour does not take Castile and the districts around a
      crowded city are shared out. Its land goes to any club, or within a shared region to
      that region's. One next to a region holding two or more clubs at its level splits
      one level down whatever its size (since 2026-11-18), so that crowd shares it:
      Moscow Oblast went whole to the first Moscow club to reach it, and CSKA started
      255 km out in 2001/02 and 2018/19; now Moscow's clubs start within 11 km of their
      grounds.
    - A top region whose clubs would hold under a quarter of the country's share per
      club (`TINY_REGION`) joins its largest neighbouring region: Berlin and Brandenburg,
      Bremen and Lower Saxony, Madrid and Castile, Greater Manchester and Lancashire. Their
      clubs share the joined land.
- **Partition**: `partitionCountry` per country, one section per club, with
  `fair: { minKm2 }`: format 1's sections, but the land rules of format 2 where they keep
  a club from being shut in (growth caps at 1.5× a fair share, fans, moved starts, the
  boxed-in retry), and no unit halved for its size, so regions stay whole. A club needs a
  tenth of its country's share per club and at least 1,200 km²: about 35 km across, 6 px
  at the opening fit. One that cannot find it around its ground starts next door, on land
  its region lets it take and never on another club's home unit. Land the
  world outline leaves out (Porto Santo) is dropped first, or a club moved there would end
  up with nothing. The fans keep to the units (`fan: 'units'`, since 2026-11-15): each
  commune or borough of a crowded city's zone goes whole to the club whose ground it holds,
  else to the sector its centre lies in, only as far as it joins that club's ground, and
  only a commune two of the fan's clubs share is cut, between those two (San Siro's Inter
  and Milan, Hammersmith and Fulham's Chelsea and Fulham). Before, the fans' wedges cut
  through every unit near the city. A unit only reaching into the zone stays open to all.
  A country of one level (Moldova, Montenegro) has no regions, so a unit with one neighbour
  goes with it, or whichever club took the larger one would shut it in; England's counties
  do this for its cities (Nottingham goes whole with Nottinghamshire).
- **World outlines** (`fitToOutline`): each territory is clipped to the country's world
  shape, and each piece of the shape they miss joins the nearest territory. So a country
  keeps the borders the rest of the game draws, and meets its grey neighbours exactly.
  `polygon-clipping` can fail on near-coincident edges, so the missed land is found
  against the union of all territories (from the topology) and joined on shared arcs,
  not by another clip, and a failing subject is retried rounded to a centimetre or a
  decimetre. The outline keeps its exact vertices, and `simplifyTopology`'s `keep` holds
  them through simplification, so section and backdrop never part.
- **Output** as the sport maps: 16,000 arc points, quantized at 1e5, colours that differ
  across borders and water. Sections are in rank order, `eu124-001` the strongest. The
  file adds `theatre` (`all` or `elite`), `seasons` for an earlier season's map, and a
  club row's `shape`, and `partial` for a country it holds only part of (Russia). The 64 maps
  in play hold 150–201 KB each, 10.9 MB in all, and the 62 maps of before (below) 10.3 MB, with
  `public/domestic/ATTRIBUTION-europe.txt` and the index `src/data/europeMaps.js`
  (`{ id, sport, league, name, theatre, seasons?, clubs, sections, countries, version, top?, replacedBy? }`).

**Result** (built-in season). Elite 32: Paris Saint-Germain holds France; the Netherlands
and Belgium stay grey; Bayern Munich Bavaria and RB Leipzig the east. Top 124: 17 countries
in colour, the rest of Europe grey, Bodø/Glimt Norway, Dinamo Zagreb Croatia, Ludogorets
Bulgaria. The smallest land is about 1,000 km² (Arsenal's, in London's crowd of clubs;
1,900 km², Rayo Vallecano's, before the levels went down to the communes). Lisbon's two clubs
split their city along its parishes (Benfica's ground had stood 2 km outside its land),
Paris's along its arrondissements, Prague's along its cadastral areas; Milan's comune is
the one place cut, between Inter and AC Milan alone. A club's ground lies in its own land,
except for clubs boxed in by their neighbours, whose land starts next door: at most about
100 km away, for Beşiktaş in the Top 124, which starts across the Bosphorus in Anatolia as
Galatasaray holds Thrace, a thirtieth of the country; Panathinaikos 43 km from its ground,
Nice 30 (Monaco holds it), Crystal Palace and Everton about 26; in the Elite 32 only Everton,
25 km. Earlier seasons crowd more. Their fields from all of Europe (6 to 20 countries a map)
put up to five clubs in Istanbul, so one may start up to about 200 km out (İstanbul
Başakşehir in 2021/22, about 150 km in four other seasons), Copenhagen three, one starting up
to about 120 km away, and the Rhine and Ruhr many, Fortuna Düsseldorf starting about 120 km
out in 2012/13 and 2019/20; Moscow's clubs start within 11 km of their grounds. England's
crowded seasons can leave a club little more than its borough: Everton about 115 to 126 km²
beside Liverpool while Burnley holds all of Lancashire's county council and more (2014/15,
2016/17, 2018/19, 2020/21, 2023/24, 2025/26), Newcastle about 200 km² in six seasons from
1996/97 to 2008/09. Across the 98 maps, 37 club lands are under 800 km² (40 before the
communes) and 285 grounds lie over 5 km outside their club's land (344 before; Russia's 35
down to 4, England's 129 to 94), but 81 lie over 50 km out (74 before), two thirds of them
Turkish clubs'. Russia's clubs share European Russia's 4.0 million km²: in 2015/16's Elite 32
Zenit holds about 1.9 million and CSKA Moscow 2.1, in its Top 124 eight clubs 0.3 to 1.0
million each.

**Maps of before** (`replacedBy`). A saved campaign resumes only on a map with exactly its
clubs (`fitDomesticCampaign` in `src/engine/storage.js` moves one club by club onto a rebuild,
but refuses a map that lost or gained a club). So when the earlier seasons' fields came from
all of Europe, their maps took new ids, `eu124e<year>` and `eu32e<year>`, and the 62 maps of
before, `eu124s<year>` and `eu32s<year>` with the seven leagues' fields, stay as they were:
never rebuilt (the build carries their index entries and reads their files for the
attribution), each entry naming the map that replaced it. The setup never offers one
(`servesSeason` in `src/data/domesticScope.js`), a setup or link that names one moves on to
its replacement (`setClubScope`), and a campaign saved on one still passes the save checks
(`isSeasonTheatreMap`) and resumes there. SWOS's seasons joined them on 17 November 2026
(`eu124e1995` to `eu32e1997`; their six `s` maps are among the 62).

**Runtime.** Scopes are `domestic:eu124`, `domestic:eu32` and `domestic:eu124e2018`.
`setClubScope` keeps a setup on the map of its theatre and season: `all`, `elite`, an old
link's league and another sport's map all land there, and one country's map stays
until a season leaves it. The setup lists the season's two rows ("Europe") above the
countries, known even while a season loads, and describes the rules. A session length
picks between them (Short: Elite 32), and leaves a chosen country as it is. `dataSetOf`
keeps a season on its own maps; `parseCampaign` accepts a set only on its own map
(`isSeasonTheatreMap`). The map's rows take the season's clubs at kick-off, as a basketball
era's do. The victory names "Europe".

**Basketball's EuroLeague** (2026-11-08) plays on a map built by the same script and rules,
`public/domestic/euroleague.json` (`--only=euroleague`): its 20 clubs in 10 countries, with
`sport: 'basketball'` and no football `theatre` in its file and index entry, so it is never one of
football's two. `COUNTRIES` gained Serbia and Israel for it. Its earlier seasons (2026-11-14) have
24 more, `el2001` to `el2026`, one for each run of seasons with the same clubs, each listing the NBA
seasons it serves (`seasons`). `COUNTRIES` gained Croatia, Slovenia and Lithuania for them, and
their Russian clubs hold European Russia only, as football's do (`within`, the map's `partial`).
See [euroleague.md](euroleague.md#earlier-seasons-200001-to-202526).

**Old games.** A world campaign saved before these maps (`clubScope` `all`, `elite` or a
league) has no `domestic:` scope, so it restores on the world with its dealt land, under
its old name ("All Leagues"). "Another team" after a defeat there opens on the map that
replaced it. An old link's `theatre=Premier+League` is reported as not offered.
A CM 01/02 set built on this computer has no maps, so it plays the two theatres on the
world, dealt by `seedClubs` as all clubs once were. A season with nations only (FIFA 05,
FIFA 06, 1989/90, the computed seasons) has no clubs to play: it keeps the plain
theatre, `all` or `elite`, and choosing clubs takes the nearest season with clubs and its map.

**Checks**: `scripts/europe-maps.test.mjs`: index, files, fields and hashes; each club's
land lies in its country and the land sums to the outlines; the only club holds its whole
country; a region with one club goes whole to it; every club holds a fair piece; a
country with no club has no section and is drawn beneath as an obstacle; neighbour
colours; seeded duel campaigns on both built-in maps reach a champion without treaties;
`setClubScope` and `dataSetOf`; the App sets up and launches both a built-in and a season
map, and keeps an old campaign on the world. Each earlier season's field is its file's
strongest, with clubs from beyond the seven big leagues (SWOS's too); each map of before
names its replacement and is never offered; on every map with Russian clubs they hold
Moscow, Kazan and Ufa and nothing east of the Urals, Russia is `partial`, drawn beneath and
an obstacle but never claimed. The smoke runs Elite 32 and Top 124 campaigns and an Elite 32
resume.

**Women's football** (2026-11-09). The same build makes women's football's maps
(`sport: 'womens-football'`), which replaced its single-league theatres and its clubs'
dealing across the world map, where 70 of the 84 clubs started on foreign land. Its
European clubs (`isEuropeanClub`: a UEFA country's) play **Europe**, every one EA rates,
`weu` (68 clubs in 13 countries), and **Elite 32**, the strongest 32, `weu32` (6 countries);
its NWSL clubs play [their own map](#the-nwsl-map). The user chose this over one map per
league and over a transatlantic map that kept all 84 together.

- **Homes** are the women's own grounds (`w-` rows of `scripts/data/europe-clubs.json`):
  the club's Wikidata home venue, else Wikipedia's ground, else the men's club's ground when
  the women play in the same town (`as f-…`), else the town by hand. Wikidata was wrong for
  Granada (a ground in Jerez) and old for Aston Villa (Villa Park since 2024). So Manchester
  United's land is Leigh's, Chelsea's Kingston's, Arsenal's Holloway's (the Emirates). A club has
  one row for every season, as the men's do, so an earlier season's map puts it at today's ground:
  Arsenal at the Emirates in 2022/23, when it still played at Meadow Park.
- **Sweden** joins `COUNTRIES` (ADM2 municipalities in ADM1 counties) for Häcken and Rosengård.
- **Crowding**: England's 14 include seven London clubs, so as in the men's maps some start
  hemmed in or next door: West Ham holds about 900 km² and Chelsea 2,000, Crystal Palace starts
  24 km from its ground (since the levels went down to the communes on 2026-11-15; before,
  Arsenal held about 1,200 km² and Tottenham, West Ham and Charlton started 8–36 km out). The
  Basque Country's four now hold about 17,000 to 33,000 km² each, Alavés starting about 50 km
  out and Eibar 12 km (before, Athletic Club about 2,000 km² and Eibar about 50 km out).
- **Seasons**: `weus<year>` and `weu32s<year>` for EA FC 26, 25 and 24; FIFA 23 rated 24
  European clubs (the WSL and D1 Arkema), so `weus2023` alone: a setup's Elite 32 or NWSL plays
  it. Each women's entry names its three strongest (`top`), seasons too.
- **Names**: the all-Europe theatre is "Europe" (`league` and `name` alike, so `domesticLabel`
  says it once), and the setup describes it as "the 68 European clubs EA rates".
- **Old games**: a world campaign saved on a women's theatre of before (`all`, `elite`, a
  league) restores on the world under its old name ("All Leagues", also for a season's,
  which `worldClubTheatreName` called "Top 124" before). A new setup turns `all` and a
  European league into Europe, `elite` into Elite 32 and `NWSL` into the NWSL map; so does a
  challenge link, though one naming a European league reports the theatre as not offered.
  `CLUB_SCOPES` keeps `all`, `elite` and `NWSL` as the ids those name.

**Checks** (women's): `scripts/europe-maps.test.mjs` holds every women's map to the same
land rules; `scripts/womens-club-maps.test.mjs` checks the fields, the places, single-club
and grey countries, the setup, challenge links, seeded campaigns to a champion, launching
built-in and season maps, refusing a season on another's map, and old world saves. The
smoke runs a women's Elite 32 duel.

## Earlier seasons

Since 16 November 2026 a country's top clubs are those of the season played: the
top 100 of England in 2010/11 are not those of 2020/21. Every earlier football
season with clubs has its own country maps, one per country whose clubs that
season's source rates, ten or more of them (`MIN_CLUBS`, as today's), each
holding that season's strongest min(tier, clubs) of them (Tiers, above) with that
season's players. Choosing a season with a country chosen keeps the country: the
setup moves to that season's map of it (`setClubScope`), or, in a season with
none, to the season's Top 124 as before; going back to the built-in season goes
back to today's map. The "One country · top clubs" list shows the chosen season's
countries only.

**What ships.** 1,718 maps over the 31 seasons with clubs, 41,078 club-seasons, 205.4 MB
(47–249 KB a map, median 119 KB), each fetched only when chosen; the index
`src/data/domesticSeasons.js` is about 20 KB. `docs/design/domestic-seasons-audit.json`
gives every map's layer, clubs, homes and size.

| Seasons | Source of the clubs | Maps | Countries a season |
| --- | --- | --- | --- |
| 2006/07 – 2025/26 (20) | EA's editions, every division EA rates | 483 | 20 – 28 |
| 2007/08 – 2025/26 (19) | the CM 01/02 Update Team's database of each season, for the countries EA does not rate | 826 | 28 – 71 |
| 1993/94, 1997/98 – 2003/04 (8) | Championship Manager's databases, every club with players | 231 | 11 – 51 |
| 1994/95 – 1996/97 (3) | SWOS's team files, every league and division SWOS has | 178 | 59 – 60 |

**The Update Team's countries** (since 17 November 2026, by the user's choice of that day:
[football-year-permissions.md](football-year-permissions.md)). An EA season whose season
has a CM 01/02 Update Team database (`scripts/data/cm0102-updates.json`, its eleven Data
tables fetched by `scripts/sync-cm0102-updates.mjs` into `data-src/cm0102/<release>/Data/`,
pinned by size and SHA-256) also gets a map of every country that database rates ten clubs
of and the EA edition does not: the season's fill (`updateTeamFills` in
`scripts/build-season-countries.mjs`), read by the CM 01/02 builder with every club. Such a
map is `kind: 'cm0102'` with the database's own source (provider and compiler "CM 01/02
Update Team", version the release's label), so its players are credited to the Update Team;
its clubs take `f-` ids after the EA maps' and never a season file club's, whose players are
EA's. One release a season, the autumn one: November 2007, September 2008 to September 2012
(2010 and 2011 the "ODB"), Autumn 2013, October 2014 to October 2019, November 2020, October
2021 to October 2024, from the zips the user downloaded from the champman0102.co.uk forum
(whose attachments need a login; `--zip=`), and December 2025 from archive.org (item `cm-25`,
its Data tables only, by range requests); 2006/07 has none. 826 maps, 17,496 clubs, 93.7 MB:
28 (2016/17) to 71 (2025/26) a season, from Brazil's 98 to 100 in the seasons EA lacks it (2014/15,
2024/25, 2025/26) and Russia's 60 after 2017/18 to the Philippines' and Belize's 10 (countries
today's maps lack, so their maps are a season's only). 35 countries that had no earlier-season
map now have some (Egypt, Morocco, Tunisia, Nigeria, Ghana, Iran, Qatar, the UAE, Thailand,
Vietnam, Canada, Costa Rica, Bosnia, Georgia, Kazakhstan…); 30 of today's still have none,
the databases rating fewer than ten of their clubs in every season. The September 2010 ODB,
October 2014 and October 2016 databases carry 164 to 232 bytes after staff.dat's last table
(0xFF bytes, then stray 52-byte rows), which `src/data/cm0102Releases.js` records
(`staffTrailing`), so the builder cuts exactly those from the pinned files, as it cuts CM3's
port's 230. Each database also rates 19 to 26 of EA's own
countries deeper (Turkey 100 clubs to EA's 18, Argentina 100 to 30); those maps stay EA's.

England has 88 to 90 clubs in an EA season (the four divisions less their Welsh
clubs), 100 in most CM seasons (the four divisions and the Conference's strongest),
68 in CM 97/98 (the rest of its extraction's lower-league clubs have no players)
and 90 in SWOS's. Scotland, Wales and Northern Ireland, which today's maps lack,
have maps where a season rates ten of their clubs: Scotland in 30 seasons (every
season but CM 97/98), Wales in SWOS's three and CM 01/02's three, Northern Ireland in
those and CM 00/01; Suriname, which today's maps lack too, in SWOS's three. SWOS's
seasons field every league it has, Europe's and the Americas', Algeria's, South
Africa's, Japan's, Taiwan's, Australia's and New Zealand's (until 2026-11-16 only the
seven big leagues', the other league files uncached); India's, Ghana's and Canada's
clubs, fewer than ten, have no map, nor 1994/95's and 1995/96's United States. A
club's home lies in its own home section for 32,448 of 39,717 located club-seasons
(81.7%); 1,361 club-seasons are placed (estimates), most of them the Update Team's smaller clubs no source places.

**Clubs** (`scripts/lib/season-country-clubs.mjs`, read through the season
builders, so the players are the season file's own tuples):

- **EA** (`scripts/lib/ea-season-builds.mjs`, whose `assemble` hook hands over each
  edition's player records): a club's competition by EA's own id (FIFA 15 – EA FC 26;
  the export names a league as a later edition does, its id does not), by the SoFIFA
  scrape's league name (FIFA 07 – FIFA 14) or by EA's website's (EA FC 25), each
  mapped to its country (`EA_COMPETITIONS`, `SOFIFA_COMPETITIONS`, `SITE_COMPETITIONS`).
  A club of a competition several countries play in (EA's Rest of World, EA FC 25's
  Libertadores and Sudamericana) plays for the country most of its players are from.
- **CM** (`scripts/lib/retro-season-builds.mjs`, `everyClub`): every live club of the
  database with players, under its own nation (CM files Cardiff City under Wales, as
  FM does), its division's name its league. CM 97/98's JSON lists teams with a
  division code (`CM9798_DIVISION_NAMES`).
- **SWOS**: every division of every league file SWOS has (`SWOS_LEAGUE_FILES`: the
  seven the season file reads and 55 more, pinned for these maps only), each club
  under its file's country; names from `SWOS_CLUBS` and `SWOS_LOWER_CLUBS` in the
  seven big leagues' files and `SWOS_LEAGUE_CLUBS` in the others (names SWOS cuts
  short or abbreviates), else SWOS's own, capitalised but for the letters a club
  writes in capitals or a case of its own (FC, PAOK, VfB, AaB); divisions as they
  were named then (`SWOS_DIVISIONS`), "Non-league" for the teams SWOS keeps outside
  them (`docs/design/football-years.md`, "Every other league").
- A club plays for the country it stands in, whatever league it plays in (`ABROAD`):
  the Welsh clubs of the English leagues, Canada's MLS clubs, Wellington Phoenix and
  Derry City play for Wales, Canada, New Zealand and Northern Ireland, as on today's
  maps; AS Monaco stays on France's. Reserve and youth sides are left out by today's
  maps' rule (`secondTeamReason` in `scripts/lib/season-country-clubs.mjs`, reading
  `nameReason`): a second team's marker (II, B, Amateure, Castilla, Jong, "-2", "-Yuni")
  counts only when the rest of the name is a stronger club of the country, which the
  seasons' sources may shorten or spell a letter apart ("B. Dortmund II", SWOS's "Ath. Bilbao B"
  beside its ATHLETIC BILBAO, CM's "Metalurg-2 Donetsk" beside "Metallurg Donetsk"). So
  Willem II plays every Dutch season (until 17 November 2026 a plain " II" left it out of
  25 maps), and CM's German "Amateure" sides (Bayern München's to St. Pauli's), in before,
  gave way to the senior clubs below them (FC Augsburg, SV Sandhausen, Tennis Borussia
  Berlin, SV Borussia Wuppertal).
- A club is viable with eleven players and a natural goalkeeper in its squad, which
  is the season file's pick (pickFootballSquad's natural 4-4-2 XI), so a club on a
  Europe map and a country map fields the same eleven. Clubs rank by `str`, their
  lineup's rating as the game computes it.
- **Ids.** A club the season file has keeps its id there (same country and name);
  every other one takes `f-<slug of its name>`, numbered after a clash, the strongest
  of the season first.

**Full names and short names.** A club the season's source names in full ("Clube de Regatas
Vasco da Gama") is matched to today's map by its full name, then by its source's short name where one of today's
names is exactly that ("HJK", "Ferencváros"; a short name inside a longer one named the
wrong club too often: "KaPa", "Apollon", "Independiente Mza."). Botafogo and Pumas, whose
full names had matched Brasília's and Guadalajara's clubs on Wikidata, are overrides since
17 November 2026, which moved them on CM's Brazil and Mexico maps of 1993/94 and 2000/01 to
2003/04.

**Homes** (`scripts/lib/season-club-homes.mjs`, written once to
`scripts/data/season-club-homes.json` by `--homes`, offline from the caches): a hand
override (`scripts/data/season-club-locations.json`: a point, a Wikidata item, or
today's map's club it is); the same club on today's map of its country (its name,
short name or FM name, or every word of one inside the other, which ranks above
sharing distinctive words, with EA's abbreviations expanded: "Sheffield Wed",
"Melb. Victory"), whose home is that map's checked one; the Europe maps' club under
the season's id; Wikidata's football clubs of the country and GeoNames' towns, as
today's maps find theirs. A club spelled two ways in two seasons ("St. Johnstone",
"St Johnstone FC") is located once, by its fullest spelling, so Wikidata's item goes
to both. A club none of them places starts at a populous place no other club stands
in, an estimate, as on today's maps. Today's club found is the season club's
`twin`: a club with no crest of its own wears its twin's (`src/data/crests.js`).
A club the homes file already lists keeps its home when `--homes` runs again, unless
an override names it: Wikidata gives each item to one name, so a season added later
would otherwise take it for its own name of a club (SWOS's "MyPa") from another
season's ("Myllykosken Pallo-47") and move clubs on maps already built. The Europe
maps' clubs place a club of a European nation only (New Zealand's Rangers is not
Glasgow's, nor Venezuela's Valencia Valencia CF), and an override can leave a club
`unplaced` where the matching finds the wrong one and its town is not known.

**Maps** (`scripts/build-season-countries.mjs`, through the same builder as today's,
`scripts/lib/domestic-build.mjs`): id `<country>y<year>` ("826y2011", "SCOy2016"),
sections `<id>-001` to `-100`; the file adds `country`, `season` (the season file's
id), `year` and `kind` (its players' kind), and its `source` is the season file's,
so its players rebuild exactly as the season's (`expandSetPlayer`). Scotland, Wales
and Northern Ireland are cut from the UK's layers by their GB-SCT, GB-WLS and GB-NIR
polygons, as England is; Suriname, with no map of today, names its GeoNames country
in `UNMAPPED_GEONAMES`. A season map has fewer clubs than today's of the same
country, so more sections no club starts on: where GeoNames' country file was never
cached (its host's robots.txt forbids fetching it), they grow around cities1000's
places, unit centres and land samples (Saudi Arabia). Each map takes at most 8,000
arc points (today's 14,000), since a country has a map in every season that rates it.

**Runtime.** `src/data/domesticSeasons.js` lists each season's countries and their
club counts; `src/data/domesticScope.js` gives `SEASON_COUNTRY_MAPS`,
`countryMapsOf(season)` and `countryMapOf(country, season)`. The setup lists the
chosen season's countries (`domesticTheatres(dataSet)`), and its description names
the map's three strongest clubs once it has decoded. A campaign on a season's map
plays that season's data set (`dataSetOf` keeps it) and saves it as any season
campaign does; a save on such a map with another season, or none, is refused
(`isSeasonCountryMap`, `isEraMap`).

**Checks.** `scripts/domestic-seasons.test.mjs`: the index, the files and the audit
agree; each map's header, version, sections and groups as today's; its clubs strongest
first, with the season file's squads where the season file has the club, homes as the
homes file has them, and decoded by the game's loader; a setup follows the season and
a campaign plays, saves and resumes on a season's map.

```bash
node scripts/build-season-countries.mjs --homes --data=<EA sources> --retro-data=<CM and SWOS sources>
node scripts/build-season-countries.mjs --data=<EA sources> --retro-data=<CM and SWOS sources> --jobs=12   # about 32 minutes
node scripts/build-season-countries.mjs --seasons=ea-fifa-11 --only=826y2011 ...                          # one season, one map
node scripts/build-season-countries.mjs --check ...                                                        # as long
```

**Limitations.**
- CM 97/98's England has 68 clubs.
- Homes from GeoNames are towns, sometimes namesakes a few towns off (Erzeni Shijak
  at Tirana); 525 club-seasons are placed (EA FC 26's unlicensed "United Tigers SC"
  among them). Tavria Simferopol's home lies in Crimea, which Ukraine's maps leave
  out as today's does, so it starts elsewhere in Ukraine; so do FR Yugoslavia's
  Montenegrin clubs, Borac Banja Luka and Priština on Serbia's maps.
- SWOS's smaller leagues are thinly sourced: 171 of SWOS's 4,006 club-seasons are
  placed, most of them El Salvador's lower divisions (34), Taiwan's clubs (30, whose
  SWOS names say little), South Africa's (21) and Suriname's (14). SWOS's Japanese
  clubs keep the names SWOS scrambled ("Koshema Ontlors"); their overrides give each
  the home and crest of the club it stands for. A few of SWOS's shortened names stay
  as SWOS wrote them where the club is not certain (Paraguay's "G Coronel Oviedo",
  Uruguay's "Central Esp", Mexico's "UN Leon").
- Size: 1,718 maps, 205.5 MB, so a full build takes about 32 minutes with 12 worker
  threads (balanced land, 2026-11-20) and holds about 18 GB of memory.
- Crests: a club with neither a crest of its own nor a twin keeps its monogram (most of
  Scotland's, Wales's and Northern Ireland's, and the lower divisions of the 1990s).
- EA FIFA 07 – FIFA 14's league names are as the scrape found them later, so a club's
  `league` may be a later division of the same country.

## Known limitations

- **Coverage.** 42 nations have fewer than ten viable clubs and do not ship (What
  ships). The unchanged rules cost some of them a top club for which FM lists no
  natural goalkeeper: Horoya AC (Guinea's highest-reputation club), Bantu FC
  (Lesotho), Chemal (Mauritania), Aigle Noir AC (Haiti), Bumamuru (Burundi),
  Fruta Conquerors (Guyana), Khovd (Mongolia) and Sosa (Solomon Islands).
- **Licences.** Section shapes are derived from their boundary layers and keep
  those terms: 32 maps come from ODbL 1.0 layers and 11 from CC BY-SA (2.0 or
  3.0), so those maps are share-alike; most others require attribution (CC BY 3.0
  IGO, CC BY 4.0, OGL, swisstopo, …). `ATTRIBUTION.txt` must ship with the maps.
  GeoNames needs attribution. FM data is used as for the existing FM supplement;
  the game is not affiliated with SI or EFEM.
- **Loans** are not applied: EFEM's player list (views Default, ValueAndWage and
  Profile) has no loan club, so loaned-out players count for their parent club.
  Recorded in every snapshot's `source.loans`.
- **Approximate homes.** 28 overrides in use are region-level and 37 clubs are
  placed at populous places (`placed:`), Alo Egypt at Zagazig among them. Their
  groups hold about 2.7% of all land (2.28% approximate overrides, 0.41% placed
  clubs), but 74% of Laos (7 of its 16 clubs are placed), a quarter of Togo and of
  Eswatini, 21% of China, 19% of Uzbekistan, 17% of Egypt and 12% of Ecuador. Up to
  five clubs share one town point (in eight countries, Bangladesh, Brunei and
  Ethiopia among them); only one can hold the point. Some overrides rest on
  medium-confidence judgement (noted in the file).
- **Crests.** 460 of the 4,184 clubs have no crest (README "Club crests"), holding
  1,985 of the sections (15.5%). 748 clubs gained a crest from Wikipedia's file pages
  on 17 November 2026 (1,208 had none before, 35% of the sections). 36 maps are complete;
  the most left are China's (15 of 60 clubs), Uzbekistan's (13 of 40), South
  Africa's, Tanzania's, Gambia's and Laos's (12 each), mostly clubs with no article
  or an article without a crest; a few were left out for a doubt (a namesake's crest,
  a renamed club's, a file page without a licence template). `SOURCES.tsv` gives each
  crest's file page.
- **Group sizes are not always by strength.** "The stronger clubs take the
  larger groups" holds only where they have room: a club hemmed in by its city
  hands its larger size to the strongest club with room (150 clubs involved).
- **Home sections away from home.** A club's home lies in its own home section
  for 3,135 of 4,147 located clubs (75.6%). For fanned clubs (901) and moved
  starts (201) the home section is the one nearest their start, not the one
  holding their town, and the town may lie in a weaker club's group; `home`
  keeps the real town. Moved starts stay within `√(area/N)` of home, so an
  archipelago capital (Port Vila) keeps its clubs on or near the home island.
- **Uneven sections.** Group sizes are fixed and groups contiguous, so empty
  land bordered by few clubs keeps huge sections: Canada's arctic (one section of
  2.26 million km²), China's west (1.53 million), Algeria's Sahara (392,000 km²),
  Egypt's Western Desert (174,000 km²), Paraguay's Chaco (78,000 km²). Crowded
  cities give tiny sections instead: a tenth of the sections are under 2 km² in
  Brunei, Jamaica, Kuwait, Luxembourg and Qatar, and 12 clubs still have under
  half the land their sections need after the retries: Egypt's Al-Ittihad,
  Ceramica Cleopatra, National Bank and FC Masar; Vanuatu's Tafea and Mauriki
  (Port Vila); Israel's Maccabi Tel Aviv; Iceland's Valur; New Zealand's Auckland
  FC; Norway's Åsane; Australia's Eastern Suburbs; Senegal's Teungueth FC. Per
  map, the 90th/10th percentile section-area ratio has a median of 29 and a 90th
  percentile of 221.
  183 of the 12,800 sections are under 3 px across at the opening fit (area under
  `(3·extent/900)²`).
- **Names.** 382 of the 12,000 sections on maps with fewer than 100 clubs (3.2%)
  keep numbered compass names such as "Abu Dhabi (east 21)", from units cut many
  times.
- **Size and time.** 18.8 MB of maps ship in `dist/`, though a session fetches
  only the country chosen (46–250 KB). A decoded country holds several MB, hence
  the cache bound. A full build or `--check` takes about 2.5 minutes with 12 jobs,
  nearly all of it Canada.
- **Borders.** The 3 km tolerance against the coarse 1:50m world map leaves thin
  strips of land it gives to neighbours (East Jerusalem's core on Israel's map,
  along Cyprus's Green Line). Where a 1:50m outline overlaps sections (N. Cyprus,
  Crimea) sections win in routing. Russia's map has no Crimea (no RUS layer has
  it) and shows blank there. On England, Wales and Scotland are world shapes of
  their own and block routes like any neighbour. On coarse layers a fan zone spills outside its
  circle, since whole units touching it are cut into sectors (Israel ADM2).
- 46 located homes lie outside every shipped section: 36 lie just outside the
  boundary layer and were snapped to it (N. Cyprus refugee clubs, Bishkek's six,
  seven in Portugal among them), and the other 10 fall outside after cutting or
  simplifying. Anchors never assume a home is inside.
- Islands may still chain within reach (Athens's Atromitos holds Chios and
  Lesbos), and Novaya Zemlya goes to Shinnik Yaroslavl because no club is in
  reach.
- A source name could not be repaired (CHN `Congqing`).
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
