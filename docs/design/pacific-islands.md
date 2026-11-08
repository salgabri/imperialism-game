# Tonga, Samoa and the Cook Islands

Added 2026-11-08. Three Pacific nations that field national teams had no shape on the rules map, so no sport
could play them. Rugby league is the reason to add them: 46 NRL players are Test players for Tonga, Samoa or the
Cook Islands (Payne Haas, Eliesa Katoa), and without these three a rugby league nations campaign is Australia
against New Zealand. All three are also FIFA members (Samoa since 1986, Tonga and the Cook Islands since 1994).

## The map

The game reads two atlases (README, Map geometry). `public/countries-50m.json` (Natural Earth 1:50m) draws them
and has always had all three; `public/world-110m.v1.json` (1:110m), which decides which shapes are on the board,
their adjacency, capitals and distances, has none. `scripts/build-home-nations.mjs`, which already cuts the
United Kingdom into the home nations in both files, now also copies each island ring from the pinned 50m
atlas onto the 110m grid. Each ring is an arc of its own (they border nobody), appended after every upstream
shape in the order Tonga, Samoa, Cook Islands, and added to the land object. Nothing else in either file
changes, and `--check` still rebuilds both byte for byte.

| Shape | Polygons on the map | km² on the map | Capital |
| --- | --- | --- | --- |
| Tonga (776) | Tongatapu, ʻEua, Vavaʻu | 403 | Nukuʻalofa, on the city |
| Samoa (882) | Upolu, Savaiʻi | 2,631 | Apia is just north of Upolu's generalised coast: centroid |
| Cook Islands (184) | Rarotonga, the only island at 1:50m | 58 | Avarua, on the city |

Rarotonga is the smallest shape on the map. Luxembourg, the smallest before, is 1,174 km² on the 110m map. At
the world fit Upolu and Savaiʻi are each about as wide as Luxembourg (1.5 of the map's 960 units), Tongatapu half
that and Rarotonga a fifth. Measured in the app on a 1280-pixel window: at the world fit Samoa covers 3 × 2 pixels
(Luxembourg 2 × 2) and Rarotonga 0.2; zoomed in, Samoa is 36 × 18 pixels at 11× and Tonga's islands are as easy
to click, but Rarotonga is still a 3-pixel dot under its capital marker at the 16× limit. It can be clicked there
with care; the Choose a target list and the keyboard reach it more easily. The nearest other land is 552 km away
(Tonga and Samoa from each other; the Cook Islands are 1,465 km from Samoa), so every attack on them, or by them,
crosses the sea. The map does not wrap at the date line, so they sit at its left edge, and their sea routes run
east to the Americas or across to each other, never west to Fiji or New Zealand. Capitals now resolve for 171 of
176 nations; Samoa joins Vanuatu, Djibouti, Equatorial Guinea and the Bahamas on the centroid, and its route
anchor lies on its own land in both atlases (`geography.test.mjs`). Tongatapu is under one map unit wide at the
world fit, and its painted outline, rounded to 0.1 units, passes just south of Nukuʻalofa: Tonga's anchor is at
sea there, as Finland's, Lesotho's and Tunisia's are. A straight line to it from the north (Samoa's) misses
Tongatapu, so Samoa's direct strikes do not include Tonga, though Tonga's include Samoa. The final-two probes in
`campaign-reachability.test.mjs` hold Tonga and the Cook Islands reachable, alone against everyone else, in every
sport.

Flags come from flag-icons 7.5.0 (`to`, `ws`, `ck`). Team colours are what the sides wear: Tonga red, Samoa blue
and the Cook Islands green (the Cook Islands Football Association's kit). The political map's colours
(`build-nation-colours.mjs`) gain the three, with nobody else's changing: no land is within its 190 km sea gap.
They are OFC nations, culture `pac`, so the Asia & Oceania theatre includes them. FIFA's July 2026 ranking
(Cook Islands 186, Samoa 188, Tonga 200) orders them in the domestic tiers, though none has a country map.

## Who fields them

| Sport | Tonga, Samoa, Cook Islands | Why |
| --- | --- | --- |
| Football | no team; land neutral | No source rates their players (below) |
| Women's football | no team; land neutral | Its existing rule: a nation with no rated player fields no team |
| Basketball, ice hockey, baseball | generated sides | These sports generate players for every nation they have none for, as for Fiji |
| Tennis | no team; land neutral | Its existing rule: no Elo-rated player, no team |
| American football | — | Clubs only |
| Rugby league | their own sides | Their 2025 Test players and the NRL players born there (below) |

Football had fielded every nation on the map, each with eleven source-backed players. EA FC 27 rates no Tongan,
Samoan or Cook Islands player, and the FM 26 snapshot was taken as the top 100 players of each nation then on the
map. EFEM's robots.txt forbids fetching more (`scripts/sync-football-manager.mjs`). So football now applies
women's football's rule: a nation no source rates fields no team (`territory.inactive`). The rule leaves out
exactly these three, and every nation football fields still has eleven source-backed players.

Earlier football seasons were built before the islands and list none of them. The loader treats a set that lists
none of the three as one built for the map without them: they field no team. The EA and CM 01/02 builders list
them only when their source rates a player of theirs, all three or none. No EA edition does, so every EA season
still rebuilds byte for byte. CM 01/02's nation file has all three, which had been on its no-team list; a CM
database with a Tongan player now lists the islands, and he plays for Tonga.

## What changes for existing play

- **Saves.** A campaign saved before has no owner for the islands. It loads with them as neutral land, as a
  theatre's non-participants are. Nobody can conquer neutral land, so the campaign plays on as it was, and nothing
  is migrated (the save version is unchanged).
- **Seeds.** Football, women's football and tennis campaigns replay every seed as before. That was checked on 24
  seeded campaigns, world wars included, from main and from this change: identical outcomes, champions and final
  random state. The seed-replay golden is unchanged.
- **Basketball, ice hockey and baseball nations campaigns play differently from the same seed, in every
  theatre.** The opening builds every nation the sport fields before it filters by theatre, and the islands'
  generated players draw from the campaign's random stream. Their ids sort among the others (184 after DR Congo,
  776 after Togo, 882 after Venezuela), so most nations' generated players change too. All 24 seeded campaigns
  checked in these sports differ from their first match. Challenge links made before this change replay
  differently, as they do after a season update. World and Asia & Oceania fields grow by three (170 to 173, 46 to
  49).
- **Clubs.** Dealing clubs onto the world (women's clubs, earlier football seasons) never reaches the islands:
  every club list is dealt exactly as before.
- **Counts.** The map has 176 nations. A sport fields 173 at most: football leaves out the islands, and
  basketball, ice hockey and baseball play Great Britain as one.

## Rugby league

Rugby league came to main after this, with the islands mapped: `NATION_OF_TEST`, `COUNTRY_OF_PLACE` and the eligibility
table in `scripts/lib/nrl.mjs` give the 2025 Test sides of Tonga, Samoa and the Cook Islands, and the NRL players born
there, their own nations (776, 882, 184). Samoa (85) and Tonga (83) field full matchday 17s behind Australia and New
Zealand; the Cook Islands field five NRL players and the game fills the rest ([rugby-league.md](rugby-league.md)).

## In the code

- `PACIFIC_ISLANDS` in `src/data/teams.js` lists the three ids. The builders, the loader and the tests read it.
- Football's `territory` (`src/sports/football.js`) is computed from its rosters, as women's football's is.
- `scripts/pacific-islands.test.mjs` checks the rings, the nations, which sports field them, and a world war with
  them playing (basketball) and neutral (football, which is also how a campaign saved before them resumes).
  `campaign-reachability.test.mjs` probes Tonga and the Cook Islands alone against everyone else in the final two.
