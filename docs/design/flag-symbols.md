# Symbol-aware territory flags

The desktop/touch strategy map must make ownership recognizable at a glance.
This pass uses the game-UI skill's recognition and occlusion guidance: a national
emblem is meaningful information, not a texture to stretch or a new UI badge.
Map controls, keyboard focus, mouse/touch hit targets and campaign rules remain
unchanged. Fields and symbols are inert paint below map labels and controls.

## One banner, two fitting rules

The previous renderer mapped every flag through a normalized 4×3 pattern into
the region's bounding box. Both axes could scale independently, stretching
circles, crosses and coats of arms. Bounding-box centres could also place the
emblem over water or a foreign enclave.

Reviewed flags now have two assets derived from the original SVG:

- The **field** continues across the whole geographic region, including nearby
  islands. It can stretch to cover land; there are no blank rectangles or badges.
- The **emblem** is placed once, with one uniform scale, inside a certified
  on-land rectangle. It keeps the original paths, proportions and internal detail.

The fitter uses a bounded geographic raster to propose locations, then validates
the entire rectangle against the vector land union. Coastlines, holes, enclaves
and thin islands are checked; four safe corners alone are insufficient. Internal
conquered borders are not obstacles. Substantial land is preferred over a tiny
island near the bounding-box centre, with a little coastal breathing room.

Native emblem registration is preserved: Portugal's coat of arms remains over
the green/red seam, for example. Field-size constraints retain Canada's two red
panels and Slovenia's three bands; these may require a smaller emblem. Symbols
can become small on narrow land, rather than being distorted or cut in half.

SVG patterns use geographic tile origins and tile-local artwork coordinates,
without an anisotropically scaled parent viewBox. Pattern bounds still cover
exactly one padded region, so the banner never repeats across individual islands.

## Coverage and preserved behavior

Fourteen explicitly reviewed designs are supported: Albania, Brazil, Canada,
Switzerland, Spain, Japan, Kazakhstan, Moldova, Montenegro, Portugal, Slovenia,
Slovakia, Turkey and Kosovo. Other flags retain their original full artwork.
Nordic crosses and US cantons are structural flag layouts, not guessed isolated
emblems. Adding a profile requires inspecting that source, not applying a
first-path-is-background heuristic. Original flags in standings and result cards
are unchanged.

Setup previews, active campaigns, conquest and restored campaigns use the same
fitter. Political mode and clubs bypass the symbol layer. Out-of-theatre land
remains neutral. Nearby owned land shares one regional banner; remote holdings
keep separate banners. No flag grouping, territory ownership, player strength,
targeting or save format changes are introduced.

Layouts are cached by region and profile, including field constraints. Zoom,
pan, hover and screen resizing cannot retile or reposition the emblem. A changed
territory refits it deterministically. If no safe layout exists, the complete
original flag remains the fallback.

## Assets and verification

`scripts/build-flag-symbols.mjs` uses explicit element selections and source
SHA-256 fingerprints. It preserves SVG definitions, inherited transforms,
internal references, colours and path data. Canada has a reviewed split of its
combined side-panel/maple-leaf path; Kazakhstan retains the hoist ornament in
its field. No runtime XML injection, network service or new dependency is used.
The derived assets include their MIT license.

The browser measured the 14 symbol bounds before final cropping. The
[asset comparison](flag-assets-review.html) shows originals and reassembled
artwork. The [territory comparison](flag-symbols-review.html) uses the production
pattern renderer on 15 real-map fixtures, including Swiss expansion across
France/Italy, Portugal, Japan and Canada.

Run `npm run test:flag-symbols` for asset integrity, fitting and renderer checks;
`npm run preview:flag-symbols` regenerates the territory comparison. Existing
regional smoke assertions now check exact original-owner provenance, field and
symbol assets, native emblem aspect ratio, single-banner layer counts, land
coverage and unchanged placement after zoom/resize/reload. The 145-test project
suite and production build pass. All seven campaign smoke scenarios and four
save/resume scenarios also pass without console warnings. Browser review covered the existing
round-34 campaign without playing a test match or changing its saved results.
