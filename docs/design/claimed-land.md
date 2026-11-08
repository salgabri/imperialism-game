# Claimed land

Status: implemented 2026-11-08 on branch `claude/landlocked-territory-conquest-49fe8a`.

The request: "for scenarios like nba or limited amount of nations, or clubs, where some states/countries are empty,
make a strategy so when challenging in a direction or when the "inhabited" country is landlocked by a playing country
that piece of land gets colored by the country, or when it travels across it to challenge another country it also
conquers that (without being added as a real territory)".

## The rule

Empty land is land in a theatre that no team plays on. It takes a team's colour (it is **claimed**) in two ways, and
never becomes territory.

**Crossing.** The empty land a match's line of attack passes over goes to the winner of that match. The challenger
travels across it; if the challenger loses, the defender takes all of its land anyway, so the trail ends with whoever
survives the match either way, and the settlement can stay where every other change of land happens
(`applyConquest`). A leg must travel `MIN_CROSSING` (0.5 map units) inside a shape to claim it, so grazing a corner
claims nothing. Land a third team already claimed is not taken by a crossing: claims only change hands with their
holder (or by enclosure, below), so a colour never flips back and forth as lines pass over it. Duels use the route
the draw drew; blitz, chaos and the best-of-three final draw no line, so they use the route the attacker would take to
that opponent (`chosenRoute`, on the isolated route cache that chosen targets use).

**Landlocked.** A patch of empty land (one shape, or a run of neighbouring empty shapes of one colour) is landlocked by
a team when:

1. that team is the only owner it borders, by its territory or its claims, and
2. its edge is mostly land: its open edge (coast, and land outside the theatre) is at most `MAX_OPEN_EDGE` (half)
   of its whole edge, borders between the patch's own shapes left out.

The patch is then that team's, as territory is counted in Go. Condition 2 is what "landlocked" asks: without it an
island or peninsula hanging off one team fills at kick-off. With it, Lesotho is South Africa's from kick-off in
tennis (which fields no Lesotho), while Ireland (touching only Great Britain's Northern Ireland, in tennis), Denmark
(only Dortmund's land on Elite 32), New Zealand's North Island (only the Warriors) and the Malay archipelago (only
Thailand, in tennis) stay empty. The sea and land
outside the theatre border nobody, so they never block a patch; they only count as open edge. A patch one team claimed
passes to another team that landlocks it. After each fill the patches are found again from the first id, so a fill
that closes another patch in fills that one too, and no patch is judged on colours a fill has since changed.

Enclosure runs at kick-off, after every conquest (with the crossing) and when a save resumes.

**Never territory.** Claims are display only. `own`, `board()`, routes, reach, neighbours, the fronts, territory
counts, the standings, the ledger and the chronicle read none of them. A team's claims pass to whoever beats it,
together with its land, and a claim by a team that is no longer on the map is dropped.

## Where the empty land comes from

`App.claimLand(st)` (`src/app/claimMethods.js`) builds `createLand(...)` (`src/engine/claims.js`): the claimable ids,
each one's borders with lengths, its open edge, its painted outline (for crossings and drawing) and its name.

| Map | Empty land | Borders and edges |
| --- | --- | --- |
| A sport's own map (NBA, NFL, MLB, NHL, NRL) | `topology.objects.empty`: states and provinces without a club | Shared arcs of one topology holding sections and empty land (`emptyBorders` in `domestic.js`, `arcBorders` in `geo.js`); an arc of its own is coast or the map's edge (the Mexican border on the NBA map). |
| A Europe map (`meta.theatre`: Top 124, Elite 32) | The atlas's UEFA countries that lie beneath it as foreign land | The sections come from other boundaries than the atlas, so `touchingLand` probes just beyond each edge (0.4, 1.2, then 2.4 map units): sections first, then the atlas's shapes; nothing beyond is coast. The atlas's exact land borders are added with no length, so a short one the probes miss still joins its countries. About 30 ms per map and fit. |
| The world | Countries of the theatre no team holds: a confederation's nations and their dependencies; the world, the elite and clubs on the world take every country. Never the shapes nobody owns (`EXCLUDED_SHAPES`) | The 110m topology's shared arcs (`geo.borders`, `geo.edges`), so lengths are in degrees of latitude; outlines from the 50m display paths the routes test. |
| A country map | None: every section is held and its neighbours are other countries | |

Lands are cached per map and fit (domestic) or per routing paths and claimable ids (world). On the world map the
claimable ids are the theatre's countries missing from `own`, whose keys never change in a campaign.

## Drawing

Claimed land looks exactly like its holder's territory; only the tooltip tells them apart.

- **A world map's claimed nation** is one of its own country shapes. `paintedOwnership` (`mapMethods.jsx`) adds it to
  the ownership the map paints in its holder's name, so its fill (`mapCountries`, row field `claimOwnerId`), its flag
  in Flags mode (`mapFlags`), and the borders, outlines and labels (`mapOwnership`, read by the border mesh and
  `EmpireLabels`) are the holder's. The row's `ownerId` stays nobody, so it takes no click, tab stop or target, and the
  your-turn veil follows its holder.
- **A country map's claimed land** lies in the backdrop. `mapClaims` gives `[{ id, ownerId, d, fill, onEnter, onLeave }]`
  filled as the holder's territory is in the current mode (identity fills included), and `WorldMap` paints it over the
  backdrop with the backdrop's own thin lines, beneath the sections. New claims fade in; a change of holder recolours.

While a signing is chosen, the map shows the claims the conquest will settle. Hovering claimed land reads "Claimed by
<team>" and "Not a territory". The share image paints the champion's claims in its colour too.

## Saves

`claims` (land id → team id) is a checkpoint key. `parseCampaign` refuses a claim by an unknown or eliminated team;
the map's own ids are checked when it is shown (a claim on land the map no longer has is dropped). A save from before
claims has none: resuming runs enclosure on its holdings. A match keeps the land its line crosses (`match.crossed`),
so a reload mid-match settles the same claims; an older match has none.

## Tests

`scripts/claimed-land.test.mjs`: the rules on a made-up map (enclosure, the open edge, capture, crossing order and
grazing, settlement, probes), the NBA, Elite 32 and world maps as shipped, saves, the tooltip, and a match on the NBA
map in the running App that colours Maryland for the winner without a territory changing hands.

## Choices

- Claimed land looks exactly like territory: the user asked for no colour difference (2026-11-08), after first keeping
  a lighter shade (60% over the land beneath).
- `MAX_OPEN_EDGE` is one half. The NBA's interior states have no coast, Maryland 46%, Washington 52%, Nova Scotia 99%.
- With one team left, a coastal patch it alone borders still stays empty unless it was crossed: the final map is not
  filled to the coast. Ignoring the open edge for the champion would fill it.
