# Campaign playtest protocol

Use five new players for the first pass. Run the short preset with a recorded seed so sessions can be compared. Test both sports and both roles across the group. Observe before explaining the game; stop to help only if the participant cannot progress for 60 seconds. For the follow-up pass, counterbalance normal and Express pacing: half of the participants play normal first and half Express first. Keep sport, seed, format and management policy matched between comparisons.

## Tasks

1. From setup, explain what wins the campaign, what one match changes and what the chosen role controls. Choose a session and estimate how long it will take.
2. In manager mode, choose a team before launch and explain that commitment. Launch, inspect its starting lineup, bench and strength, then follow another team. Confirm that changing the followed team preserves the managed team.
3. Advance a live match, pause during the ticker, wait five seconds, then resume. Repeat during a draw. Explain what the odds mean.
4. Follow a team, enable its pause alerts and start autoplay. Identify the next match involving that team and the cue that stopped playback.
5. Before a managed match, choose a tactical approach and explain its benefit, risk and why it fits the opponent. After a conquest, choose a signing and explain the tradeoff between immediate lineup gain and the other candidates. Show the lineup comparison. Use View conquest to inspect the gained land, then Back to previous view to return to the original camera.
6. Filter History by a team, open an earlier match and locate an event and its conquest rewards. Inspect a squad from that report and return with Back or Escape. Confirm the filter and report remain selected; filter to a team with no matches and confirm the old report disappears.
7. Export progress, return to setup, cancel replacement and resume. Preview an imported campaign in a fresh tab before replacing an existing one. Compare the restored state and named slots. Simulate a same-campaign update from another tab and confirm the conflict offers reload or fork.
8. Complete a campaign, inspect the final recap, view the map and reopen campaign results. Try a best-of-three finale in at least one session. In a manager run that loses, explain the personal ending and choose between spectator continuation and retrying the setup.
9. On a 390×844 phone viewport, scroll to Squad and History and control playback. Using only the keyboard, skip the map, navigate territories with arrows, select a squad and make a capture choice.

## Record

| Measure | Initial success target | Notes |
| --- | --- | --- |
| Explain the three core rules | At least 4/5 without help | Record exact misconceptions. |
| First match reached | Within 90 seconds | Exclude deliberate reading time. |
| Time to first meaningful manager decision | Record launch-to-tactic and launch-to-signing separately | Distinguish elapsed time, active viewing, pauses and time waiting for input. |
| Understand spectator vs manager | At least 4/5 | Ask what decisions they expect next. |
| Explain tactical choice | At least 4/5 identify one benefit and one risk without prompting | Record the opponent and whether the next choice changes for a different opponent. |
| Explain signing choice | At least 4/5 cite a lineup or tactical consequence | Record offered gains, option positions, chosen option, decision time and exact explanation. A higher rating alone does not establish a tradeoff. |
| Explain lineup impact of an acquisition | At least 4/5 | Include a candidate that adds no strength. |
| Pause/resume, history and map-focus tasks | At least 4/5 without help | Record unexpected continuing motion or lost focus. |
| Save confidence | All participants locate current save state | Simulate blocked storage in a separate developer check. |
| Session length expectation | Active playback time within the displayed range | Record wall-clock time, active viewing, decision waits, deliberate pauses, away time and skipped matches separately. |
| Remembered campaign moments | Record at least one unprompted moment and why it mattered | Ask immediately after play and again after a short unrelated task; identify transfer, upset, tactical outcome or elimination. |
| Replay intent | Record intent and reason; do not set an arbitrary quota | Ask whether the player would replay the same setup with a different decision, try another team or leave. |
| Abandonment | Record phase, elapsed and active time, reason and last action | A faster completed campaign can still be less engaging; compare recall and replay intent alongside completion. |

Record abandoned clicks, scrolling to find playback, misunderstood abbreviations and how often a player checks their followed team. Ask which transfer or upset they remember at the end. Treat a beautiful map with no remembered campaign moment as a narrative-feedback failure. Keep player explanations alongside the local campaign metrics export: automated measurements can identify long waits or repeated choices, but cannot establish that a player understood the decision.

## Decision and pacing comparisons

- Compare signing policies on the same captured squads: highest rating, best immediate lineup fit and a tactical-choice policy. Report how often the offered choices are tied or one choice dominates all displayed consequences. Count distinct reasons given for selecting each option.
- Compare tactical approaches on the same opponents and matched random seeds. Look for situations where each approach is useful, and confirm players can predict a consequence before seeing the score.
- Compare normal and Express sessions with matched setups. Report completion, active time, skipped matches, remembered moments and replay intent together. Do not interpret shorter elapsed time alone as improved engagement.
- Report basketball authentic and competitive formats separately. Expand beyond Elite national teams to clubs and disconnected theatres, and include all uncertainty settings. Use at least 100 seeds for dominance claims, paired seeds for policy comparisons and confidence intervals for champion share and useful recruitment rate.

## Release checks

- Run supported theatres to completion in all pacing modes; use multiple seeds and include clubs spread across disconnected land.
- Compare balanced/predictable/wild upset frequency and starting-strength champion share across repeated seeded campaigns. Review dominance and comeback frequency before changing tunables.
- Verify a two-win final: one conquest, one capture and one champion; no early annexation after the first series game.
- Block or fill local storage: display the failure, export still works, retry can recover without restarting the campaign.
- Import malformed team references, pending choices, queued fixtures and random state: reject before replacement and preserve the current campaign. Corrupt a save in a separate developer session: offer raw export or last-valid recovery instead of silently treating it as absent.
- Open two tabs on one campaign and advance independently: detect revision conflict and retain both campaigns when the player forks. Confirm different named slots never overwrite each other.
- Verify same seed/settings/manager decisions produce the same draw/results after save/resume and import.
- Confirm focus traps in manager choice and victory, return focus on close, reduced-motion behavior, long team/player names and phone safe areas.
- Confirm campaign rules stay fixed during committed play and between finale games; following another team changes neither manager control nor an active series.
