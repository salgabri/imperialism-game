# Match ledger / campaign atlas

## Accepted direction — 10 September 2026

The user requested a design review and substitutions for common AI-built visual patterns. The internal concept is `docs/design/ledger-concept.png` (1672 × 941). Its layout follows the existing game: a 64px command header, dominant live map, right-hand intelligence ledger, and bottom map/playback controls. No new gameplay or navigation is introduced.

## System and copy lock

- Dark graphite header `#202725`; unchanged dark ocean and geographic flag assets.
- Flat warm-paper intelligence panel `#e7e6dc`; ink `#28312d`, muted ink `#626b64`, ruled separators `#b5bab1`, positive outcomes `#286540`.
- Archivo for readable body/control text; Archivo Narrow for the masthead, operational headings, tabs and scoreboard. Alegreya 500 exclusively for cartographic names/ocean captions. Self-hosted fonts, tabular numbers, explicit fallback metrics.
- Corners 0–2px. Connected command segments, thin shared rules, no decorative pitch divider or trophy empty state. Existing meaningful outline icons remain.
- Desktop standings 31px, squad/activity approximately 30px; touch actions retain 44px targets. Sidebar inset 20px. Preserve flexible wrapping and mobile map-above-ledger layout.
- Header copy remains Imperialism, sport / layer, theatre, Round, remaining and Settings. Uppercase is visual typography, not changed data.
- Map heading remains The European campaign (or the selected theatre); remove Win the match. Take the territory.
- Empty match copy: Latest match; Ready; No match in progress; Choose Next match to draw the next fixture.
- Keep Standings / Activity / Squad, # / Team / Terr. / Strength, real campaign rows and green +N values. The concept's shortened/sample table is not a replacement for live data.
- Keep Political / Flags, zoom controls, Next match / Play campaign / speed, map hints and scale. Keep existing result, settings, save-confirmation and victory actions.
- Setup uses the same operational heading style and left alignment. Replace promotional subtitle with Choose your sport, teams and theatre. Header uses the current sport / layer in setup too.

## Intentional implementation constraints

The real atlas, flags, labels and icons remain SVG/code-native; no replacement raster game assets are appropriate for this geographic strategy game. The existing ocean texture is retained unchanged. Concept geography and example row order are illustrative: real geometry, ownership, strength sorting and full live data take precedence. Typography is implemented with the selected real font families rather than approximating the image generator's glyphs.

## Verification ledger — 11 September 2026

Reviewed the accepted concept through `view_image` and the actual implementation through Browser/IAB screenshots and DOM/computed-style checks. The user campaign was inspected at 1280 × 720; mobile at 390 × 844 (384px document width after scrollbar); an isolated fixture was also checked at the concept's native 1672 × 941. No horizontal overflow was found. Temporary viewport overrides were reset.

| Comparison | Concept / original issue | Render evidence and resolution |
| --- | --- | --- |
| Typography | Condensed operational type replaces the Georgia/Inter pairing | Archivo body, Archivo Narrow masthead/headings/score, Alegreya atlas names. Checked actual SVG family after the 500 face loaded. 40px desktop masthead; 22px latest-match heading; 40px fixture score; 12–13px table text. Font files, weight axes and accented glyph coverage verified. |
| Palette | Paper ledger contrasts with dark atlas; no gold heading hierarchy | Sidebar renders #e7e6dc with #28312d ink, graphite header #202725. Muted text intentionally darkened from #626b64 to #606860 for 4.59:1 contrast; green gains use #286540. No new gradients or map tint. |
| Density and containers | Remove decorative empty-state trophy and rounded-card repetition | Empty match block is 135px, left aligned. Table rows measure 31px after correcting a 1px border-height regression. Shared rules, 0–2px corners, one ledger panel; no additional cards. Squad/activity remain compact. |
| Commands and icons | Connected command rail, factual action hierarchy | Adjacent Next match / Play campaign / speed controls share edges. Paper primary action, dark secondary controls; meaningful existing SVG icons preserved. Mobile actions and tabs measure 44px high. |
| Copy | Remove the map slogan and vague empty-state heading | No map tagline or trophy. Exact idle copy is No match in progress / Choose Next match to draw the next fixture. Setup becomes Choose your sport, teams and theatre. Existing pacing-specific guidance, save confirmations and real data remain. |
| Atlas assets and labels | Preserve territorial flags, accurate geometry and curved nation names | Existing live SVG geometry and ocean texture unchanged. Saved Europe displays Alegreya names including England, Germany and Switzerland; delayed or failed font loads use measured fallback glyphs. Map modes still switch through the real controls. |
| Results and responsive layout | Compact fixture sheet, not a ceremonial result card | An isolated localhost fixture finished Montenegro 1–3 Albania, transferred A. Marušić and displayed the real +0.3 strength gain. 48px flags, plain divider, left-aligned spoils. Phone stacks map above the ledger with full wrapping activity text. |

Above-the-fold copy diff: only the recorded removals/replacements and CSS uppercase treatment changed static copy. No new metrics, navigation, badges or promotional sections. The live standings, not the concept's illustrative shortened table, remain sorted by strength; Finland and other live values retain their actual saved data.

Intentional deviations: real map geography/label placement and full campaign data override the generated illustration. Existing 340–438px sidebar bounds and compact CSS-pixel density are retained at wide viewports instead of scaling every element with the concept raster. Small-text contrast is slightly darker than the initial color brief. SVG flags/map/icons remain code-native, and the existing texture is reused.

Validation: production build passes; 58 focused tests pass (20 labels, 12 geography, 11 territory components, 10 regional flags, 5 asynchronous map-font tests). The full smoke suite passed in 118.2 seconds with no console warnings. A fresh Browser/IAB test origin also reported no warnings/errors. It exercised setup → launch → next match → completed conquest, map-mode switching and new-campaign confirmation. The isolated test save was removed using the real confirmation UI. The user's 127.0.0.1 campaign remains at round 27 with 19 survivors and 85 activity rows.

### Remaining visual-verification limitation

The supported Browser/IAB screenshot interface returns inline images but exposes no local file-export method. Consequently the latest browser render was inspected inline, not reopened as a local file with `view_image`. The concept was reopened with `view_image`. The frontend design skill's strict two-local-image comparison/sign-off gate remains incomplete; this review does not claim a pixel-perfect or 10/10 certified match. No separate browser-control workaround was used. This limitation does not prevent the implemented game or its functional tests from running.
