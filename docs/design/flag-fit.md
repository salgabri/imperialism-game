# Whole-flag fitting

Flags mode painted every flag without a separated emblem ([flag-symbols.md](flag-symbols.md)) over
its region's bounding box, stretched to it on both axes. Two things went wrong with
that, both visible on the 1971/72 Europe board:

- **The flag missed its own land.** A flag's middle lands at its box's middle. Norway
  runs diagonally, so the middle of its box is in Sweden: Norway showed plain red with
  a scrap of cross in the far north. Croatia's chequy shield flew over Bosnia, Greece's
  canton over the Ionian Sea, Chile's star over Argentina.
- **Shapes were distorted.** Stretched to a box of another shape, Sweden's cross arms
  differed fivefold in thickness, Serbia's and Bulgaria's arms were squeezed, the US
  stars and India's chakra became ovals and Vietnam's star a yellow streak.

`src/engine/flagFit.js` now places every such flag (crests and the 20 symbol-aware
flags keep their own fitter).

## What may stretch

`scripts/build-flag-fits.mjs` renders each flag in `public/flags` with sharp and
sorts it by its pixels (`src/data/flagFits.js`, 234 flags):

| Kind | Rule | Flags | Placement |
| --- | --- | --- | --- |
| rows | every row one colour | 28 (Germany, Russia, the Netherlands) | spans the body's height, the whole region's width |
| cols | every column one colour | 11 (France, Italy, Ireland) | spans the body's width, the whole region's height |
| grid | a few straight edges, every block one colour | 14 (Nordic crosses, Greece, England) | at most 25% out of its proportions |
| free | anything else | 180 (emblems, stars, diagonals, cantons with stars) | its own proportions, never stretched |
| plain | one colour | 1 (Libya 1977) | the region's box |

Stretching a row flag sideways changes nothing, so it can take any width; a grid flag's
straight edges survive a little stretch (a Nordic cross's arms differ by a quarter at
most); a free flag's curves do not survive any.

## Where it goes

The **body** is the region's land in pieces at least a quarter the size of its largest
piece, counted on the same coarse land grid the emblem fitter uses
(`src/engine/landRaster.js`). Mainland Greece is the body, Crete is not; Luzon and
Mindanao are, the Visayas are not.

A grid or free flag fills the body's box as far as its proportions allow, centred,
when the middle of that box is on the body, or when the body is in pieces (an
archipelago's middle is sea, and its flag should still span it). A body of one piece
whose middle is not its own (Norway, Croatia, Chile, Vietnam) gets instead the largest
box, centred on a cell of the body, of which at least 60% is body: southern Norway,
Croatia's north, Tonkin.

A free flag contained in the body's box is as wide as the box and short of its height,
or the reverse. It grows towards covering the box only as far as the sides it would
lose past the box are plain stripe: the build measures, for each side, how many units
in every row (or column) is only its edge colour drawn out. Argentina's and India's
bands then span their countries with the sun and the chakra round; the United States
grows a little and keeps every star of its canton; the Philippines' hoist triangle
stays at the body's edge while its fly grows past it.

Nothing depends on the camera. Layouts are kept per region object and fit, like the
emblem layouts, so the Flags warm-up builds them ahead of the click.

## Beyond the flag

Land beyond the flag (islands, the north of Norway, Sweden's south) is painted by
**strips** in the colours along the flag's own edges, read by the build as colour runs:
a side strip is one colour or a hard-edged gradient of the edge's stripes, padding past
its ends into the corners. A Nordic cross's arms therefore run on through the strips,
stripes continue, and a corner takes the corner's colour. Row and column flags need
only their outer stripe's colour.

Two seams are hidden. Each strip reaches 4% of the flag's shorter side under the flag,
so the flag's soft edge blends into its own colours rather than the banner colour. And
an SVG flag's layers each blend their own edge pixel (the field's, then a stripe's over
it), a dark or light line along the flag: while the SVG is drawn (before its bitmap, or
zoomed past it) a lip in the strip's colours straddles the edge, reaching 1.5 device
pixels each way (at least one flag unit, at most the underlap), clear of a canton's
stars. A bitmap is one layer and needs none.

A row flag's bitmap is the same at any width and a column flag's at any height, so
`FlagArt` keeps the bitmap however long those flags are drawn along their stripes.

## Data and checks

The fits are 21 KB (5 KB compressed) in the first download. A flag added or redrawn
needs `npm run build:flag-fits`: the file records a digest of `public/flags`, and
`scripts/flag-fit.test.mjs` fails until it matches. The kinds are read from pixels,
not guessed from file names; colour runs use each run's commonest pixel, so they are
the SVG's own colours. An edge is read just inside any see-through sliver its drawing
leaves (flag-icons starts Papua New Guinea's triangles a unit and a half in, the
Bahamas' stripes two units down), at most four units in. Only Nepal's pennant is
see-through at its edges; there the banner's own colour shows past it, as before.

`npm run preview:flag-fits` writes [flag-fit-review.html](flag-fit-review.html): 35
before/after pairs on real geography with the production renderer, including three
conquered empires. The tests check every region on the real map, every nation's own
flag and one owner holding the world, for painted coverage, proportions by kind,
Norway's cross on Norway and Croatia's shield on Croatia.
