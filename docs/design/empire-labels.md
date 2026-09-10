# Expanding empire names

## Objective

Place one readable, gently arched name over each visible empire. A
conquest should give the name more usable land, not leave it attached to the
centroid of a former country. Labels are display-only: capitals, attack targets,
ownership, saves and team strength keep their existing meaning.

## Placement strategy

1. **Use the painted land.** Work from the exact rounded, antimeridian-split SVG
   rings. Preserve nonzero winding for holes; combine countries by current owner
   so internal borders do not constrain the name.
2. **Separate landmasses.** Treat detached islands and overseas possessions as
   separate candidates. Favor substantial visible land without using an
   empire-wide bounding-box center that may lie in the ocean.
3. **Search useful interiors.** Find broad interior regions and test horizontal
   and shape-aligned orientations. Favor readable angles and enough room for the
   whole name, not just a safe center point.
4. **Fit the actual text.** Measure the uppercase Georgia text, add tracking and
   a gentle upward quadratic arch, then fit a padded envelope containing the
   curved glyphs and their halo. Grow
   the name with the available area, subject to an 11–32px screen-size range.
5. **Prefer land, allow a little water.** First look for a readable wholly on-land
   fit. If none exists, allow limited coastal overhang: no farther than 10 screen
   pixels from owned land and no more than 22% of the padded envelope at sea.
   The anchor remains on owned land. Other countries, including neutral land
   and tiny foreign enclaves, remain forbidden; water is the absence of all
   country shapes, not simply the absence of ownership. Four in-country corners
   alone are insufficient: an enclave could still sit in the middle.
6. **Keep the camera calm.** Reuse geographic candidates through pan/zoom, prefer
   stable placements, choose an alternative visible landmass when needed, and
   omit names that cannot fit legibly even with the bounded coastal allowance.
   Do not turn microstates into ocean labels or bridge distant possessions.

## Practical search and performance

Each connected landmass gets a bounded interior raster (roughly 14,000 cells),
with a distance field and a spread of interior candidates. Principal-axis and
nearby angles provide shape-aware alternatives to horizontal text. A bounded
size search proposes fits; vector boundary checks make the final decision.
This is a deterministic candidate search with placement hysteresis, not a claim
of finding a mathematically global optimum.

Across visible landmasses, compare the best validated text fit rather than
blindly choosing the biggest island. Readable size dominates, with small visible
area and continuity preferences. Up to six leading components plus the previous
component are considered. This prevents a partly visible Greenland from taking
Germany's name away from a larger readable label on its European territory.

Geometry is prepared once per map fit. Ownership groups reuse immutable edges,
and the cache retains active groups plus only eight recent replacements. Match
ticks, hover, selection and flag/political styling do not call layout again;
camera changes reuse the prepared geometry. Strict, straight-label mode remains
available to geometry callers with the default zero `curveRatio` and
`coastalAllowancePx`; the game opts into `.055` and `10`, respectively.

The safe-interior principle is also used by
[Mapbox's polylabel algorithm](https://github.com/mapbox/polylabel), which finds
the point farthest from a polygon boundary rather than its centroid. This game
needs an additional full-text-envelope fit across an ownership union; it does
not simply position a fixed-width name at a polylabel point.

## Presentation and interaction

Names are uppercase serif text with deliberate tracking and a restrained halo,
horizontal where possible or rotated to follow useful land. A symmetric SVG
`textPath` rises by 5.5% of the name's width, producing a shallow cartographic
arch rather than a semicircle. The path's center stays aligned with the fitted
geographic anchor. Owner-stable, map-unique path IDs avoid reference changes
when other labels appear or disappear.
If the preferred arch cannot fit even with the coastal allowance, one final
on-land pass softens the rise to 2.5% before omitting the name. This preserves
cramped inland labels without crossing their neighbors or flattening the text.
Flags remain visible underneath. Labels never intercept mouse/touch input, and
country selection, hover descriptions and keyboard squad access remain intact.
The game UI skill informs the readable minimum size, owner-level hierarchy,
quiet motion and consistent behavior across desktop and phone views.

## Verification

`npm run test:labels` exercises independent winding/footprint checks on adjoining
countries, concave land, enclaves, overseas islands, long names, reordered
ownership, curved envelopes, limited coastal overhang and real atlas geometry.
Integration smoke checks cover the real App,
rendered labels, camera changes, ownership transfers, club names and saved games.
Browser inspection checks actual font rendering and the resumed campaign.
