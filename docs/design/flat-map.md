# Flat campaign map

The map now uses equirectangular coordinates with a 30° standard parallel:
`x = longitudeRadians × cos(30°)`, `y = -latitudeRadians`.
Meridians and parallels remain straight, and the world does not taper at the
poles. This supersedes the original projection-preservation note in
`direction.md`. Land no longer casts a drop shadow onto the sea; the existing
paper texture, colours and requested curved nation names remain.

The game-UI review focused on keeping the visible map and interaction geometry
in agreement. Both atlas resolutions, capitals, flag clipping, emblem fitting,
label containment, route blockers and compass endpoints share the new plane.
The repaired date-line rings are unchanged. Hover coordinates use the exact
inverse, and empty margins outside the geographic world clear the readout.
The distance label is explicitly approximate: an equatorial horizontal reference.

Saved ownership, squads, results and geographic capital locations are retained.
Projected distances change, so future target ordering and new club allocations
can differ; routing still cannot cross an intervening foreign country.

## Verification

- All 153 focused tests pass, including eight new projection checks, both source
  atlases, date-line and polar coverage, flags, coastal labels and attack routes.
- The production build and derived flag asset integrity check pass.
- All seven full campaign and four save/resume smoke scenarios pass. The initial
  European label smoke exposed an obsolete four-zoom-ins assumption; the
  clamp-aware test now verifies four real camera changes and all three label
  scenarios pass in 14.23 seconds with no warnings.
- Browser review covers the saved round-34 Europe campaign, the full world and
  a 390×844 phone viewport. A separate test campaign completes a Spain–France
  draw and conquest; the test save is then cleared. The user's campaign remains
  at round 34 with 12 nations and no new match played.
- Browser DOM checks confirm straight grid lines, absence of the land shadow
  and symbol-aware regional patterns; no browser warnings or errors occurred.
- Geographic label regressions derive their cameras from lon/lat instead of
  obsolete projected pixel coordinates. They retain the readable mainland vs.
  Greenland-sliver competition and the return-from-overseas stability checks.

`npm run preview:flag-symbols` regenerates the real-territory comparison under
the new projection. `npm run test:geography` covers projection and coastline
regressions together.
