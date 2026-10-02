# Campaign design improvements

The atlas and match ledger remain the visual foundation. The changes below address player purpose, readable consequences, session commitment and control reliability. The target is desktop mouse/keyboard, with complete touch and keyboard paths on the phone layout.

| Priority | Improvement | Completion criterion |
| --- | --- | --- |
| P1 | State the player's role before launch: spectator or manager. Explain conquest, player capture and the last-survivor objective. | A new player can describe the loop without consulting README. Manager choices visibly wait for input. |
| P1 | Give the manager one meaningful decision after a conquest: choose among three captured players using their lineup impact. | Each candidate reports improvement and replacement; only one is claimed; the campaign stays paused until selection. |
| P1 | Evaluate strength from a legal positional lineup, show starters and bench, and penalize players used outside their natural position. | Squad and match strength agree; repeated acquisitions cannot inflate strength merely by growing the bench. |
| P1 | Make Pause freeze draw and ticker clocks, with explicit resume controls for manual matches. | Scores, events and needle progress remain stable until resumed. Pausing never loses or repeats a scheduled event. |
| P1 | Guarantee that a campaign can continue when geography produces no direct challenge, using explained routes and a neutral-transit exception when needed. | Every supported theatre finishes; neutral land is never annexed merely to unblock a draw; routes follow their rendered path. |
| P1 | Report actual save success and failure, retain saved progress through new-campaign setup, and offer JSON export/import. | Storage failure is visible; a saved/exported campaign restores its history and random state; cancelling replacement preserves progress. |
| P2 | Offer short, standard and world presets, show match/duration estimates, and provide express playback. | Setup communicates session commitment before launch and marks durations as estimates at 1× autoplay. |
| P2 | Expose a numeric campaign seed, uncertainty presets and single-match/best-of-three finale. | Matching seed and settings reproduce a campaign; uncertainty changes estimated odds; series conquests resolve only once. |
| P2 | Follow a team persistently and optionally pause for its matches and major events. | The team remains visible as standings reorder; elimination is explicit; manager control is identified. |
| P2 | Show approximate pre-match win chances and concrete conquest consequences. | Strength, odds, captured player, replacement, strength gain and conquered territory names can be inspected. |
| P2 | Preserve a structured history with team filtering, score, ticker and spoils for every match. | Selecting an archived match shows the recorded outcome and events; history survives resume. |
| P2 | Provide a conquest map focus action and distinguish followed holdings. | The action reveals the gained land; the player can still pan and reset freely. |
| P2 | Keep the one playback control available while scrolling the phone sidebar. | At 390×844, playback remains usable from Squad and History, with safe-area clearance. |
| P2 | Reduce keyboard map traversal to one tab stop with arrow navigation and an explicit skip link. | Tab can reach the sidebar without traversing every country; owner and action are announced. |
| P2 | Keep campaign results reopenable after viewing the map; add upset, decisive-match and transfer highlights. | The final reward remains one action away and conveys what made the campaign distinctive. |

## Design boundaries

Manager mode starts with the strongest team and permits changing the managed team through Squad or the pinned selector. It is a light decision layer: the simulation still chooses draws and resolves matches. Spectator mode keeps automatic captures and can follow any team for attention cues.

The best-of-three final applies only to the last two teams. Interim series games do not annex territory or capture players. The deciding game produces the usual conquest reward once.

Estimated odds and duration communicate uncertainty rather than promise outcomes. Express playback compresses presentation waits; it does not alter results. A seed is shareable alongside the sport, layer, theatre and uncertainty choices; manager choices must also match to reproduce later play.

## Verification

See [the completed developer verification](campaign-verification.md) for automated,
desktop/phone browser and 144-campaign balance results.

Use [the playtest protocol](playtest.md) for first-run understanding, agency and pacing. Source interaction coverage is in `scripts/ui-interaction.test.mjs`; campaign, positional lineup, odds, routing and persistence checks cover the underlying rules. Browser verification must include desktop and phone composition, keyboard focus, a live pause/resume, a manager capture, an archived match, export/import and final-result reopening.
