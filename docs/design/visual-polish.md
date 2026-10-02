# Visual polish — 2 October 2026

This pass implements the authorized 26-item backlog from the design review. The atlas already had the strongest identity: dark ocean, territorial flags, curved names and a warm-paper ledger. The main gaps were management-screen identity and hierarchy, implicit playback state, rewards disconnected from squad inspection, and a phone layout that stacked the map above too much information.

Football Manager informs readable comparisons and team dossiers; Europa Universalis informs ownership and map hierarchy; Crusader Kings informs recognizable teams and memorable acquisitions. The existing [accepted ledger direction](ledger-restyle.md) and `ledger-concept.png` remain the baseline. Actual campaign data, geography, lineups and outcomes govern every display.

## Connection to the review

| Review finding | Delivered behavior |
| --- | --- |
| Team dossiers felt less developed than the atlas | Stronger identity header, actual positional starters and depth, acquired-player origin, latest acquisition and its real impact. |
| Autoplay dominated the manual next action | Next/Finish match is primary in manual play; playback state, manual match resume and campaign autoplay remain distinguishable. |
| Flags and many borders competed with ownership | Shared geographic edges separate outer empire boundaries from quieter internal borders; selection connects the map, standings and dossier. |
| Supporting text was too small | Shared type scale, 12px captions, 13–14px operational text and aligned tabular values. |
| Full-time results lost sporting context | Completed and archived reports retain supplied events; team and player links open the corresponding squad; rewards have a consistent order. |
| The phone composition was too tall | Map/Details switching, a persistent score/playback strip and one scrolling ledger keep inspection and control close together. |

## Implementation ledger

Paths below are relative to the repository root. “Retained” identifies existing behavior verified as part of this pass, rather than a new algorithm or gameplay feature.

| # | Implementable item | Components | Completion / verification |
| --- | --- | --- | --- |
| 1 | Shared typography scale | `src/index.css`, `src/components/polish.css` | Common caption, body, control, panel and score sizes applied across the interface. |
| 2 | Readable small text | `polish.css` | Important supporting text is 12px; operational text is 13–14px; short desktop and phone layouts inspected. |
| 3 | Consistent numeric presentation | `MatchCard.jsx`, `PlayerRow.jsx`, `Sidebar.jsx`, `App.jsx`, `polish.css` | Tabular numerals and aligned strength/gain columns; strength uses consistent decimal formatting and scores retain actual values. |
| 4 | Shared sidebar spacing and rules | `Sidebar.jsx`, `polish.css` | Common inset and section rhythm; the entire ledger scrolls, keeping results and lower tabs reachable without a competing content scroll. |
| 5 | Compact idle latest-match block | `Sidebar.jsx`, `polish.css` | Empty state reduced to a 102px minimum, giving standings more room. |
| 6 | Manual action hierarchy | `PlaybackBar.jsx`, `App.jsx` | Next/Finish match receives primary emphasis in manual mode; busy, paused and completed steps remain disabled. |
| 7 | Visible playback state | `PlaybackBar.jsx`, `App.jsx` | Ready, drawing, live, paused and completed states are communicated beside the controls. |
| 8 | Consistent control feedback | `src/index.css`, `polish.css`, `controls.css` | Shared dimensions, icons, hover, pressed, disabled and visible keyboard focus states; touch targets remain usable. |
| 9 | Outer versus internal empire borders | `WorldMap.jsx`, `src/engine/mapBorders.js` | Ownership resolves shared edges into stronger outer borders and quieter internal lines; automated border checks pass. |
| 10 | Selection across surfaces | `App.jsx`, `WorldMap.jsx`, `Sidebar.jsx`, `polish.css` | Selected empire outline, standings row and dossier refer to the same campaign identity. |
| 11 | Label readability at different zooms | `EmpireLabels.jsx`, `src/engine/empireLabels.js`, `WorldMap.jsx` | Existing measured fonts, halos and adaptive placement retained; quieter borders support contrast; Flags/Political presentation checked. |
| 12 | Team identity and campaign progress | `Sidebar.jsx`, `polish.css` | Header identifies the team/code/layer, strength, territory count, conquests and acquisitions. |
| 13 | Position-grouped rosters | `Sidebar.jsx` | Football and basketball use their respective position headings and counts. |
| 14 | Actual starters versus depth | `App.jsx`, `Sidebar.jsx`, `PlayerRow.jsx`, `src/data/teams.js` | Dossier uses `selectLineup` output; emergency assignments display their penalty-adjusted rating; acquired depth is distinct. |
| 15 | Latest-acquisition highlight | `Sidebar.jsx`, `polish.css` | Recorded player, previous team, round, current lineup/depth role, replacement and actual strength effect are inspectable. |
| 16 | Scoreboard composition | `MatchCard.jsx`, `polish.css` | Names wrap, team/score/strength are separated, and basketball 123–101 scores remain intact; long identity layouts checked. |
| 17 | Retained completed reports | `MatchCard.jsx` | Native expandable report contains supplied events after full time and in history; live log keeps its scroll reference. |
| 18 | Team-to-squad inspection | `App.jsx`, `Sidebar.jsx`, `MatchCard.jsx` | Latest and archived team links use campaign IDs, including clubs and eliminated opponents; flag artwork never supplies the destination. |
| 19 | Ordered conquest consequences | `MatchCard.jsx`, `polish.css` | Territory, acquisition and strength change appear in order; player opens the winning squad; “No change” remains explicit. |
| 20 | Phone Map/Details composition | `App.jsx`, `polish.css` | Switching views removes the long vertical map/ledger stack; selecting a team opens Details. |
| 21 | Accessible score and playback strip | `PlaybackBar.jsx`, `App.jsx`, `polish.css` | Phone playback remains fixed with a compact score/status summary, safe-area clearance and manual pause/resume. |
| 22 | Setup grouping and actions | `SetupOverlay.jsx`, `polish.css` | Choices and optional settings are grouped; setup body scrolls while Launch stays in its footer; Resume has clear emphasis. |
| 23 | Squad focus and return path | `App.jsx`, `Sidebar.jsx` | Selection focuses and reveals the dossier, including repeated inspection of the same team; Escape/Back restores the selected standings button. |
| 24 | Keyboard ownership and map inspection | `WorldMap.jsx`, `App.jsx` | Country labels announce current ownership; arrow navigation uses one map tab stop; focused-country tooltips are positioned; the phone skip link opens Details before focusing it. |
| 25 | Restrained motion and reduced motion | `src/index.css`, `polish.css`, `results.css`, existing map/event components | Existing result, capture and acquisition feedback retained; consistent pressed feedback added; global reduced-motion behavior covers animations, transitions and scrolling. Dedicated score-change animation is not added in this pass. |
| 26 | Verify complete interface states | Test scripts, production build, Browser/IAB | Setup, idle, drawing, live, full time, squad, settings and victory exercised through automated and browser checks described below. |

## Verification evidence

- Full existing `npm test`: **217/217 passed** before the six new visual interaction checks were added.
- Targeted visual/map/UI checks: **22/22 passed**, including **6/6** in `scripts/visual-polish.test.mjs`. These cover campaign IDs, real supplied reports, three-digit basketball scores, acquisition navigation, dossier focus/Escape restoration, positional lineup/depth and manual resume versus autoplay.
- Production build and `git diff --check` passed.
- All smoke scenarios passed in **148.9 seconds**, with no console warnings.
- Browser/IAB inspection at **1280 × 720**, **320 × 640** and **390 × 844** used actual game fixtures. Checked setup/footer reachability, manual draw pause, dossiers, rewards, Map/Details switching, scrolling and keyboard paths.
- Final production-build checks also covered **820 × 1024** and the baseline concept's native **1672 × 941** size. Long basketball club names, scoreboard-to-club navigation and sport-specific position groups were verified. Flags/Political switching and zoom/reset remained usable.
- At 320px, a completed/unsaved header fixture verified that Results, Settings and the save warning fit without overflow. The exceptional header uses two rows; its settings popover remains within the viewport. The temporary fixture was removed.
- Expanded setup and saved-campaign replacement confirmation remain within a 320 × 640 viewport. The scrollable body shrinks while every confirmation and save action stays reachable.

The entire ledger now owns its vertical scrolling. Selecting the same team again focuses and scrolls its dossier into view. The mobile map skip link reveals Details before moving focus. Keyboard map focus positions its tooltip beside the focused territory. These corrections address reachability as well as appearance.

## Final visual comparison

The accepted `ledger-concept.png` and the latest production Browser/IAB screenshots were opened with `view_image` in the same QA pass. Desktop was captured at the concept's native 1672 × 941 dimensions; the phone dossier was captured at 390 × 844. Screenshots are [the desktop result](polish-desktop-render.jpg), [the selected squad](polish-squad-render.jpg) and [phone Details](polish-mobile-render.jpg).

| Comparison point | Baseline / requested direction | Final evidence and resolution |
| --- | --- | --- |
| Composition | Flag atlas beside a warm-paper management ledger | Native desktop captures keep the atlas dominant and the right ledger bounded. Whole-ledger scrolling fixes the expanded-report overflow caught in QA. |
| Palette and surface | Dark graphite/ocean, paper #e7e6dc, dark ink, restrained positive green | Original palette and textured ocean retained. Acquisition emphasis uses the existing green and a rule, without a new card system or color wash. |
| Typography | Condensed UI headings, clean data text, serif cartographic names | Archivo Narrow / Archivo / Alegreya retained. Requested shared sizing uses 22px panel headings, 40px scores, 13px data and 12px supporting labels; computed styles were checked. The denser live ledger deliberately differs from the enlarged illustrative baseline. |
| Identity and acquisition | Review required a recognizable dossier and meaningful transfer consequences | Native squad and phone captures show flag/code, team name, 78.7 actual strength, 2 territories, the recorded acquisition and explicit zero gain. Acquired depth remains outside the real starting lineup. |
| Map artwork and boundaries | Territorial flags and geographic owner names define the game | Real clipped flag artwork, measured label placement and hit geometry retained. Selecting Poland outlines both owned countries; the internal seam stays quieter. No floating flag badges from exploration replace the atlas. |
| Controls and state | Manual progress should be easy to see | Next match is the pale primary action; Play remains secondary in manual mode. Full-time status and POL 3–0 BLR persist in the rail. Manual draw pause/resume was checked with autoplay remaining off. |
| Responsive continuation | Backlog requires Map/Details instead of a long stack | Phone capture shows the dossier from its header, one scrolling region and an 82px fixed score/control rail. 320px/390px checks have no horizontal overflow or document scroll. |
| Sporting report | Review required completed match context | The native result has a report disclosure retaining all three actual events. Opening it keeps the ledger and map within the app; archived report retention also has interaction coverage. |
| Icons and focus | Existing restrained SVG family and clear keyboard paths | Back uses the existing SVG arrow; controls keep 44px targets. Inspection focuses the dossier; Escape restores the selected standings row; the phone skip link opens Details. |

Above-the-fold copy comparison preserves Imperialism, Football / Nations, Europe, round/remaining information, the campaign title, Latest match, map modes, Next match and Play campaign. Live team names, scores and outcomes replace illustrative values. Following/History reflect the existing campaign functionality; strength labels, playback status, dossier headings, acquisition information and Map/Details are authorized backlog additions. No invented season, stadium, competition table, player statistics or navigation from the exploratory images was adopted.

The result was visually verified against the accepted atlas/ledger design language and the authorized backlog, with the intentional density and functional additions above. It does not claim a pixel-for-pixel recreation of the illustrative concepts. No material clipping, overflow or unreachable control remained in the checked layouts.

`polish-desktop-concept.png`, `polish-mobile-concept.png` and `polish-squad-concept.png` are exploratory references. They do not authorize invented season/stadium information, additional metrics or navigation. `ledger-concept.png`, the accepted ledger direction and the explicit backlog govern the implementation.
