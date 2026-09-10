# Interface verification

## Follow-up: gently arched names and coastal allowance

Empire names now follow a shallow upward quadratic SVG text path, rising by 5.5% of the name width. A final on-land fallback softens the rise to 2.5% for otherwise-hidden cramped names. The fit envelope includes the bend, angled end glyphs and stroke halo. Path IDs are unique per map and stable per owner through camera changes. The game UI skill guided the restrained cartographic treatment, readable type size, owner-level hierarchy and non-interactive text layer.

Readable wholly on-land placements take priority. If none fits, the label engine can use a bounded coastal fallback: the anchor remains owned, no more than 22% of the padded envelope is water, and its overhang stays within 10 screen pixels of owned land. Rival and neutral land remain forbidden, including tiny enclaves that a point-sampling-only check could miss. The stricter straight, land-only engine defaults remain available; only the game renderer opts into the new behavior. Country geometry, flags, hit targets, strength and campaign state are unchanged.

All 20 label tests passed, including nine new curved/coastal cases. Independent checks cover the full quadratic glyph ribbon, exact sea area, overhang distance, foreign/neutral land and tiny enclaves, strict-land preference, the gentler inland fallback, real England/Portugal geometry, and cache/pan stability. The 33 geography, territory and regional-flag tests also passed. A cold curved/coastal world layout took 273ms; 30 cached frames took 3ms. Production build and diff checks passed. The full smoke suite passed in 108.1 seconds without console warnings, including seven complete campaigns, four resumes, and targeted nation/club checks of SVG text paths, owner-stable references, coastal limits, state preservation and conquest updates.

Browser QA verified visible arches in both map modes and a coastal England name previously omitted by strict fitting (11px text, approximately 13–14% padded envelope over water). Other visible desktop names retained wholly on-land fits. A 390px phone-width check had no horizontal overflow, preserved the 11px minimum, and revealed more names on zoom. The final desktop preview has valid text-path references, no browser warnings/errors, and non-interactive labels. The saved campaign remains at round 27 with 19 owners and all 85 activity entries; Flags mode and Activity are open. No matches were advanced.

## Follow-up: date-line coastline repair

Russia's diagonal cuts were caused by splitting projected rings at a fixed 300-unit horizontal jump, then independently closing each open fragment with `Z`. The mainland's first and last fragments were never reconnected, removing real land and painting triangles over the Sea of Okhotsk. Closed geographic rings now unwrap and clip at ±180° before projection. Artificial seam edges are subdivided along the curved map meridian; winding, holes, disconnected islands and polar closures are preserved. The game UI skill guided keeping the painted coastline, owner flag clipping, label containment and interactive territory outline aligned.

The original source topology, shared-arc adjacency, raw fit geometry, capitals and historical area/anchor metadata remain separate and unchanged. SHA-256 comparisons of every country's simulation-facing values match the pre-fix results for both 50m/110m atlases and world/European fits. Only displayed rings and their bounds use the repaired geometry.

All 12 new geography regressions pass, including independent source-atlas land/ocean grids, Kamchatka, Khabarovsk, Magadan, both sides of Chukotka, Fiji/Alaska, fit/scale invariance, cyclic ring-start rotation, nonzero-winding holes, polar loops and Antarctica. Four real-geometry checks failed against the old implementation; they detect actual source/paint disagreement rather than merely confirming internal consistency. All 32 existing label, territory and regional-flag tests also pass. Production build and diff checks passed. The full smoke suite passed unchanged in 99.0 seconds without console warnings: seven complete campaigns, four resumes, and all prior flag, Swiss-island, label, strength/gain, animation-race and territory-conservation checks.

Live browser QA verified the recovered coastline in both Flags and Political modes. The longest Russian SVG edge fell from 109.23 units (an artificial closing diagonal) to 4.67 units. Kamchatka hit-tests as Russia, held by Ukraine; the Sea of Okhotsk hit-tests as map background. The saved European campaign remains at round 27 with 19 owners and all 85 activity entries. No matches were advanced, no browser warnings/errors appeared, and the preview remains in Flags mode with Activity open, framed on the repaired Far East.

## Follow-up: compact activity feed

Activity entries now use 6px vertical padding, 30px minimum rows, tighter column gaps and 1.4 line spacing, retaining the existing 12px text. Longer messages wrap naturally without clipping or hiding any event. The game UI skill guided retaining round labels, status dots, readable text and keyboard scrolling; only Activity spacing changed.

Browser QA verified all 85 displayed events remain identical and in the same order. List height fell from 4542px to 3230px; fourteen full entries now fit where ten did before. One-line rows are 30px instead of 43.6px, two-line rows 46.6px instead of 62.2px, with no horizontal overflow. Build and diff checks passed. The campaign was not advanced and Activity remains open in the preview.

## Follow-up: compact squad list

Squad rows now have a 30px minimum height instead of 43px (roughly 47px for transferred players). Transfer origin sits beside the name rather than taking a second line, and the squad header/summary spacing is tighter. The game UI skill guided retaining the existing 12px names, 13px ratings, position colors and generated-player disclosure. Long names can still wrap and increase row height; rows are noninteractive, so touch controls retain their existing sizes. Changes are scoped to `.fi-squad`, leaving the roomy victory roster unchanged.

Browser QA on the saved Ukraine squad measured all 16 rows at 30px, with list height reduced from 707px to 480px. Fully visible rows increased from eight to thirteen in the same sidebar. Names and ratings retained their font sizes, transfer origins remained visible inline, and there was no horizontal overflow. Production build and diff checks passed; no game-state or roster changes were made.

## Follow-up: remove the rectangular country-focus frame

The black/white rounded frame was Chromium's native pointer-focus outline on a focusable SVG country path (`outline: auto 5px`). The existing reset applied only to `:focus-visible`, so mouse focus retained a large zoom-scaled bounding box. The map now suppresses the outline for every focused country path. The game UI skill guided retention of an accessible keyboard-only coastline stroke; `vector-effect: non-scaling-stroke` keeps that cue at 2.4 screen pixels without altering ordinary zoom-compensated country borders.

Live browser checks reproduced the pointer-focus box before the change and verified `outline-style: none` afterward on the active pointer-focused territory. Keyboard Tab focus retains the pale coastline stroke, 2.4px width and non-scaling vector effect. Country selection still opens the owning squad. Build and diff checks passed. This is a scoped CSS change; flag grouping, labels, game rules and saves are untouched.

## Follow-up: continuous regional flags, without island stickers

The next screenshot showed why strictly separate landmass flags were still visually wrong: Corsica, Sardinia and Sicily each restarted a complete Swiss cross. A flag-only regional index now joins nearby same-owner coasts across gaps of up to 180 projected kilometers, using the existing fixed map scale. The mainland and those islands sample one continuous Swiss banner; faraway Greenland, Iceland and French Guiana stay in separate regions. This supersedes the island-by-island treatment below. The game UI skill guided visual coherence at campaign zoom rather than maximizing the number of individually recognizable tiny flags.

The index normalizes exact landmass geometry once, precomputes coast proximity with spatial and segment-boundary checks, then groups only current same-owner neighbors. Nearby island chains connect transitively; enemy or neutral land cannot act as a bridge. Bounding boxes alone cannot establish proximity. Regional bounds only size a flag image: unchanged country rings still clip the fill, holes remain empty, and the original keyboard/mouse country targets remain intact. Neither name placement nor conquest adjacency changes. Camera zoom does not change the geographical threshold or retile flags.

Browser inspection of the saved round-27 European campaign confirmed the miniature island crosses are gone, the Swiss cross remains visible across mainland France/Italy, and Germany retains all three bands. The map now uses 42 regional flag canvases rather than 319 per-landmass canvases, with no flags on neutral land. Zoom preserves every pattern's bounds. Keyboard selection of France opens Switzerland's squad, and Political/Flags switching removes/restores the flag layer. An intermediate duplicate pattern-key issue was caught and corrected before the final checks; all final pattern IDs are unique, with no new browser warnings or errors during final interactions. The campaign was not advanced; Standings and Flags mode were restored.

All 10 regional geometry tests and the 22 existing geometry/label tests passed, including both European/world fits of the exact Swiss-island case, German bands with Greenland/Iceland isolated, coastline-versus-box proximity, ownership barriers, holes, threshold boundaries, coordinate scaling and cache stability. World graph construction took 162ms, and 100 cached frames took 3ms. Production build and diff checks passed. The full smoke suite passed in 98.3 seconds without console warnings: seven complete campaigns, four resumes, all previous strength/gain/label/race checks, the earlier Germany/Greenland/Japan/Fiji regressions, and the new Swiss mainland/islands shared-canvas and Guiana-remote fixture. The island fixture also verifies unchanged unrelated ownership/squads and map-mode behavior.

## Follow-up: recognizable connected-territory flags

The user's screenshot exposed a flaw in the owner-wide flag canvas: Germany's Greenland possession pulled the black/red bands away from Europe, leaving almost entirely gold; French Guiana similarly displaced Switzerland's cross. Flag bounds now follow connected owned landmasses. Conquered neighbors still share one continuous image across old borders, while detached islands and overseas possessions have separate complete flags. This supersedes the earlier globally stretched flag approach below. The game UI skill guided recognition of ownership, preservation of country hit targets and keeping non-participating land neutral.

The flag layout reuses the label engine's exact rendered-ring connectivity, including nonzero-winding holes and date-line splits, without invoking label rasters. Current ownership results and SVG path data are cached across hover and camera updates. Each country retains its original accessible hit target and border above non-interactive flag parts; setup uses the same mainland/island treatment. Game rules, strength, squads and saves are unchanged.

Browser inspection of the saved round-27 European campaign confirmed Germany's black/red/gold bands and Switzerland's white cross across their contiguous conquests. None of the 130 neutral countries has flag parts. Keyboard country selection opens Squad, Political mode removes all flag parts and patterns, and switching back restores them. Zoom leaves every flag tile's bounds unchanged. Standings, zoom and Flags mode were restored without advancing the campaign; browser logs contained no warnings or errors.

All 11 connected-territory tests and all 11 existing label tests passed, including real Germany/Greenland, France/Guiana, holes, ownership changes and both display/fallback date-line geometry. World component grouping took 132ms; 100 cached frames took 1ms. Production build and diff checks passed. The full smoke suite passed in 113.2 seconds with no console warnings: seven complete campaigns, four resumes, three owner-label scenarios and the connected-flag fixture covering adjacent and overseas conquests, Greenland, date-line islands, strict local bounds, zoom, resize and reload. Existing strength, gains, clubs, territory conservation and animation-race checks remain passing.

## Follow-up: expanding empire names

Replaced the fixed-size largest-country-centroid labels with a dedicated ownership-union label solver. Exact rendered rings supply nonzero-winding land and holes; component-aware interior candidates, shape-aligned angles and actual font measurements fit a padded text area inside the borders. Names grow within an 11–32px screen range, while cramped nations wait for more zoom. Layouts are cached through match updates, hover and map styling. The game UI skill informed the owner-level hierarchy, readable minimum, stable camera behavior and non-interactive label layer. Detailed algorithm notes and tradeoffs are in `empire-labels.md`.

Browser QA on the saved round-27 European campaign verified Germany over its continental conquests, Switzerland across France/Swiss territory, and angled Swedish/Finnish names. Final desktop labels ranged from 14.3px to 32px, with no overlapping text bounds. Political and Flags modes both remained readable. At 390px, Ukraine stayed legible and zooming revealed additional names; there was no horizontal overflow. Desktop framing was restored, the campaign save was preserved, and the app was left in Flags mode. Browser logs had no warnings or errors.

Visual QA caught and fixed the Greenland-priority edge case: selecting a large visible island by surface area could still beat a more readable continental label. The final solver compares the best validated fits across visible components, and a regression uses the exact European atlas fit, German ownership and camera from the browser. Returning from a Greenland-focused view also restores the mainland name.

Production build and diff checks passed. All 11 independent geometry tests passed, including old-border-spanning growth, concavities, enclaves, long names, islands/date-line geometry, exact real-world Germany/Greenland placement, camera stability and eliminated owners. Cold world setup plus conquest layout took 359ms; unchanged cached frames were effectively immediate. The full smoke suite passed in 48.9 seconds without console warnings: seven campaigns, four save/resumes and three owner-label integration scenarios, retaining all strength, gain, flag and animation-race checks.

## Follow-up: compact standings

Standings now use 30px desktop buttons (31px rows including borders), 20px flags, smaller gaps and reduced header/footer padding without shrinking the existing 12–13px text. Numeric columns keep room for three-digit ranks and aligned strength/gain values. The game UI skill guided the density change, inset keyboard-focus outline and 44px buttons for coarse-pointer touch devices; other tabs and match displays are unchanged.

The same resumed desktop campaign now shows 15 complete rows instead of 9, with row height reduced from 48px to 31px. Browser checks confirmed no clipped ranks/ratings or overlapping green gains, keyboard Enter opening the correct squad, and a 390px viewport with no horizontal overflow. Desktop view was restored afterward; no browser warnings or errors appeared. Production build, diff check and targeted strength/standings/gain regressions passed.

## Follow-up: one continuous flag per empire

All territory held by the same national team now shares one flag image and one world-space pattern. Its bounds grow to include every owned polygon, including detached territory, islands and dependencies, after each conquest. Small bounds padding keeps rounded SVG coordinates inside that single tile. The game UI skill informed ownership-driven grouping while retaining clickable country borders, readable labels and the existing neutral treatment for non-participants. This supersedes the earlier repeated, mainland-sized flag tiles; it does not change conquest rules or map navigation.

The resumed European campaign at round 27 rendered exactly 19 flag patterns for 19 owners across 47 participating territories. All ten Ukrainian territories referenced the same flag, and every rendered owned-land coordinate lay within its owner's single tile. No neutral country used a flag. Browser visual inspection and Political/Flags switching plus zoom passed, with no browser warnings or errors. The saved campaign was preserved and left open in Flags mode.

Build and diff checks passed. The complete smoke suite passed in 37.2 seconds without console warnings: seven campaigns and four resume scenarios, plus a focused France/Japan/Fiji conquest fixture checking shared images, expanding bounds, date-line islands, zoom, portrait resize and reload. Both detailed display geometry and the low-resolution fallback contain every rendered coordinate within the flag bounds, with a 1e-6 tolerance. Existing continental neutrality, strength, gains, clubs and animation-race checks remain passing.

## Follow-up: hide non-participating flags

During a campaign, non-participating countries now render as neutral land without flag fills or flag patterns. Flag visibility follows current territory ownership, so conquered countries keep the winner's flag and participating dependencies remain flagged. Setup retains its full national-flag preview; club colors and world campaigns are unchanged. This supersedes the earlier subdued-neutral-flag treatment and uses the game UI skill's clear distinction between active and inactive territory.

The resumed European browser campaign showed 47 flagged participating territories and 130 neutral shapes, with zero flag fills or patterns on neutral land. Visual inspection confirmed neutral North Africa and Middle East while all participating territory retained its current owner's flag. Build and diff checks passed.

The complete smoke suite passed in 35.6 seconds without console warnings: seven campaigns and four resumes, with neutral-flag checks at kickoff, first conquest, victory and reload, plus participating-dependency and world-flag coverage. All existing strength, gain, ownership and animation-race regressions remain passing.

## Follow-up: conquest strength gains

Green one-decimal `+N` values now accompany the current Strength in standings, showing total improvement from campaign start. The real result handler records strength before and after acquiring the player, and the result panel separately shows that conquest's gain. Zero increases are labelled No change without positive green styling. These are displays of the unchanged team-strength formula, not new strength bonuses. The game UI skill informed the cumulative/per-conquest distinction, accessible gain descriptions, numeric alignment and green/neutral treatment.

Browser inspection verified seven resumed cumulative gains with computed color `rgb(132, 197, 160)` and explanatory accessible labels, including Ukraine +2.5 and Switzerland +2.1. A real completed conquest reported 86.4 to 86.4 and No change, rather than inventing an increase for acquiring a lower-rated player. The score column remains strength-sorted, with rating and delta in separate numeric spans.

Build and diff checks passed. Targeted tests verified +1.8 from each of two real acquisitions, +3.6 cumulative gain, zero-change styling, no duplicate award or territory multiplier, and reload persistence. All seven full campaigns and four resume scenarios passed in 34.7 seconds without console warnings.

## Follow-up: strength-ranked standings

The user requested standings always track overall strength. The table now sorts by live team EFF, descending, with alphabetical/id tie-breaks independent of territory count. Its Strength header declares `aria-sort="descending"`, and ranks no longer truncate after 99. Existing game UI styling and interactions are preserved; the game UI skill informed the clearer metric label and accessible sort indication. A resumed browser campaign displayed France (87.6, one territory) first and Montenegro (73.7, four territories) at rank 30, confirming that size no longer overrides strength. The header fits the existing sidebar, and the flag map remains enabled.

Build and diff checks passed. The complete smoke suite passed in 34.4 seconds with no console warnings: seven campaigns, four resume scenarios, strength ordering throughout play, restored rankings, tie-breaks, all 170 rank numbers and immediate reranking after a real player acquisition. A live browser table check also confirmed descending strengths and sequential ranks as the campaign progressed.

## Follow-up: flag backgrounds

The user subsequently requested flags as each country's background. Flags are now the default in setup, fresh campaigns and resumed sessions, explicitly superseding the original concept's political-color default. Unowned nations retain subdued native flags; conquered territories use the current owner's flag. Political remains an optional view, and club-owned territory keeps its club colors. Browser inspection confirmed Flags selected, 171 country/dependency flag fills, and no owned national territory missing its flag. Existing outlined labels remain readable over the flags. The game UI skill guided this ownership and contrast treatment; no new concept artwork was needed for an existing map-display option.

Follow-up verification: production build passed; all seven full campaigns and four resume scenarios passed in 34.1 seconds without console warnings. The updated checks verify exact flag asset URLs in setup, kickoff, neutral land, conquests and resumes, while preserving Political-mode and club-color assertions. Browser switching returned zero flag fills in Political and 171 in Flags; the preview was left in Flags.

## References and method

Design references: `gameplay-concept.png` and `setup-concept.png`, generated for this project. The live Vite app was exercised in the Codex in-app browser using semantic locators and actual pointer/keyboard interactions. Screenshots were captured with the browser screenshot API, including the concepts' native **1536 × 1024** size and **390 × 844** phone size; **1280 × 800** was also used for resizing. The final normal browser viewport, **1148 × 912**, was checked after resetting the temporary override. Both concepts and the final desktop, setup and phone captures were inspected with `view_image`. Temporary implementation captures are removed after review; the design references remain as the durable specification.

## Fidelity ledger

| Area | Concept evidence | Render evidence and resolution |
| --- | --- | --- |
| Composition | Open political map, one right rail, slim header | 64px header and 28.5% desktop rail preserve the map-first composition. Enlarged the rail from its initial 360px limit to 438px at the reference size. No card grid or additional navigation. |
| Result hierarchy | Team marks flank a prominent score; green winner, two reward rows | Increased marks to 72px and desktop scores to 44px. Final results persist and show actual territory gained plus transferred player, position and rating. |
| Typography | Serif identity/headings; plain readable management controls | Georgia headings, Inter/system controls, deliberate table/control sizes and tabular scores. Raised desktop result/table type and corrected Full time and singular territory copy. |
| Palette | Cool dark header/rail, teal paper sea, subdued political colors, warm gold CTA | Theme tokens match the specified cool palette. New paper asset supplies the ocean; no overlay washes it out. Accurate SVG land uses stable owner colors. |
| Controls and icons | Political/Flags and zoom left, playback right; quiet settings | All controls work. Consistent vector icons replace mixed text glyphs. Setup keeps advanced controls behind Match settings. Desktop control wrapping adapts to available map width. |
| Map detail and labels | Recognizable detailed European geography, fine borders and calm labels | Added a 50m display atlas while retaining 110m rule topology. Fixed coastline-label contrast and collision suppression; mobile collision check reports zero overlaps. Zoom/pan do not alter ownership. |
| Container spacing | One quiet sidebar and a compact setup panel | Borders and 4–8px corners stay restrained. The setup panel includes a conditional resume section, so it is taller when a save exists. |
| Responsive layout | Desktop concept with a protected primary map | At 390px, map then results form one column without horizontal overflow. Main map controls use 44px phone targets. Notifications are raised above both control rows. |
| Camera and motion | Map is navigable; animation supports match flow | Pointer-anchored wheel zoom, drag and explicit reset verified. Resizing preserves camera center and relative zoom. Reduced-motion styling suppresses decorative transitions. |

## Copy audit and intentional deviations

The above-the-fold headings, tabs and primary actions were compared with the allowed-copy inventory in `direction.md`. No unrelated marketing copy, fake statistics, extra dashboard sections, or decorative badges were introduced. Dynamic teams, scores and standings replace the illustrative concept data. Existing functional EFF, Squad, ratings, map scale and saved-game states are documented additions. The in-campaign theatre dropdown is omitted because changing theatre requires a new campaign confirmation. Country labels and world framing follow real data, not the concept's illustrative geography. Clubs use monograms, not fabricated crests. Accurate, interactive SVG geography is an intentional alternative to raster map art; the generated texture remains a production asset.

The implementation was faithfully verified against this design direction, with these explicit functional/geographic deviations. No remaining material visual mismatch was identified in the checked layouts.

## Interactive browser checks

- Setup sport/layer changes, theatre options, collapsed/expanded match settings, and saved-game resume.
- Next match, live ticker, Finish match, final score, territory/player consequences, playback speed, Play/Pause.
- Standings and Activity tabs; keyboard Enter on a country opens the correct Squad.
- Political/Flags switches, zoom buttons, wheel zoom, pointer drag without unintended squad selection, explicit reset.
- Settings open/close and real match-display changes; responsive camera persistence.
- Phone setup and game layout, no horizontal overflow, no overlapping visible map labels.

## Automated checks

The smoke harness exercises seven complete campaigns and four save/reload variants across football, basketball, nations and clubs, plus model/roster/geography invariants. It checks territory conservation, one elimination and player transfer per match, owner fills and flags, actual UI controls, structured results, victory dismissal, and rapid Play/Pause. Test-only seeded roster/match randomness and 80× playback do not change production timers or randomness.

An intermittent repeat-run stall exposed a real delayed-animation race: an old frame could restore the spinner after kickoff and block the next match. A deterministic batched-update regression failed on the original method and passed after the scoped fix (keyed duel callbacks, functional state update and post-commit scheduling). The final complete smoke run passed in **33.3 seconds**, without console warnings; all seven champions had no spinner or simulation timers remaining, and all four resume checks passed. `npm run build` and `git diff --check` also passed.

A fresh browser reload followed by Resume → Next match → Finish match → territory/player result completed successfully with **no new browser warnings or errors**. During development, adding hooks briefly triggered a hot-reload hook-order error; it did not recur after a clean reload and is not a production-render error. The final preview is paused on a real result, not left autoplaying.
