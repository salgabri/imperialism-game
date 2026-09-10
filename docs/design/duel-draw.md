# Duel draw compass

The draw should answer four questions in order: who attacks, where the needle
settles, who the opponent is, and when the match starts. The existing atlas and
match-ledger design stays intact. This is a code-native SVG instrument, not a
new decorative overlay. Route validation enforces the intended no-leapfrogging
rule without changing match simulation, strength, conquest or batch pacing.

## Selection and geometry

`createDuelDraw` snapshots the valid surviving owners, capital anchors,
ownership, adjacency and immutable visible-land geometry before sampling. It
chooses an attacker uniformly, samples a compass direction, and gives land
neighbours priority within its direction cone; otherwise the nearest reachable
enemy in the widening sea cone wins.

For each opponent, the selector tries owned capital pairs in distance order.
Exact segment/edge intersections and nonzero-winding interior tests reject
routes encountering another owner or neutral country before the target. Holes,
small islands and detached territories are included; merely touching a border
does not count as crossing land. The index is cached by the stable path bundle
and never retains mutable source rings. Countries outside the active campaign
remain blockers, not eligible opponents. With no legal route, the draw pauses
with a message rather than silently attacking through land.

Both the compass pivot and the attack route use the chosen source point. The
route ends just inside the first target territory, avoiding misleading further
travel through foreign enclaves to a distant capital. The needle finishes at
that exact bearing. No world-wrap or curved transport route is introduced. The random
search direction can differ from that bearing; it selects the opponent but is
not presented as a misleading final aim. A third random sample only controls
whole decorative revolutions, leaving target selection independent of speed.

## One clock, explicit stages

The parent owns `ready → spinning → locked → kickoff`. The rendered needle has
no timer of its own. Playback speed is captured once per draw, so changing it
mid-spin cannot clip the current rotation or retime the reveal underneath it.

| Speed | Rotation | Locked opponent reveal |
| --- | ---: | ---: |
| 1× | 1,550 ms | 480 ms |
| 2× | 775 ms | 240 ms |
| 4× | 387.5 ms | 120 ms |

Normal playback uses two animation frames to establish the initial bearing,
then adds 34 ms of paint slack before locking. A guarded 160 ms fallback starts
the draw if a background tab does not deliver those frames. Faster playback
uses fewer whole revolutions. Reduced motion skips rotation and frame staging:
a static bearing holds for 160/speed ms, then reveals the opponent for
320/speed ms. The route's entry fade is also disabled.

Draw identity guards make begin, animate and lock one-shot operations. Scheduled
callbacks verify that identity before acting. Kickoff, reset and unmount cancel
all pending draw frames and timers, including work canceled before React commits.

## Visual and camera behavior

- A 64 px graphite dial, paper-colored needle, quiet tick marks and a north mark
  remain legible against flags and hold their screen size through map zoom.
- On lock, the dial becomes a small source pointer: its outer radius is capped
  at 13 px and 42% of the route length. Short routes therefore retain a visible
  opponent marker. Decorative dial details disappear without another animation.
- A cased, static route terminates in a small target reticle. Long routes are
  dashed; short ones are solid. No endless pulses or moving dashes compete with
  map names. The route and compass render above the labels and ignore pointer input.
- The camera minimally pans, or zooms out when necessary, to reveal the attacker
  and then the route. It never zooms in automatically or repeatedly overrides
  manual panning during the same stage. Existing world clamps remain in force.
- The sidebar names the attacker during the draw and both sides on lock, with
  land-border or overseas context. A polite live status and SVG description
  communicate the same sequence without relying on motion alone.

## Verification

The focused tests cover immutable selection, exact bearing and origin,
unobstructed target policy, speed-independent opponents, reduced motion, all three
playback speeds, duplicate events, hidden-frame fallback, canceled callbacks,
unmount cleanup, SVG presentation and minimal camera reveal. The compass
renderer includes the short-route regression where the old full-size dial
covered the opponent. Full campaign smoke tests also exercise the real draw
flow and interrupt/resume behavior.

Verified on 2026-09-11: all 122 focused project tests pass, the production build
passes, and the seven-campaign/four-resume smoke suite completes without console
warnings. Targeting coverage includes all 360 Netherlands directions against
the reported parties with every visible country retained as a blocker, a full
European candidate-field sweep, conquered German territory, alternate attack
origins and blocked-draw feedback without changing the round or ownership.
Browser checks exercised 1×, 2× and 4× animation timing, a narrow 390×844 viewport,
and a Luxembourg–Belgium reveal clipped to the target border. UI checks used a
separate localhost campaign, which was removed afterward; the user's 127.0.0.1
campaign was not used for test matches or rolled back.
