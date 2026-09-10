# Imperialism interface direction

## Intent

Simplify the existing sports-conquest simulation with the readable management interface of Football Manager and the political cartography of Europa Universalis. Desktop mouse/keyboard first, with an adaptive single-column phone layout and touch-accessible controls. Keep the existing sports, national/club layers, campaign rules, roster data, and saves working.

## Screens and decisions

- Setup: choose sport, teams, theatre; optionally expand match settings; launch or resume.
- Campaign: understand territory ownership, advance a match or autoplay, inspect standings/activity/squads, switch map mode, zoom/pan.
- Match: see both teams and scores, live events or a final result, then territory gained and the player transferred.
- Victory: see the champion and campaign totals, inspect the map or start another campaign.

## Visual specification

The current visual reference is `ledger-concept.png`; its tokens, copy and review are recorded in [the ledger restyle](ledger-restyle.md). It supersedes the earlier `gameplay-concept.png` and `setup-concept.png` styling while preserving their information architecture. The design combines a football match ledger with a campaign atlas. The generated cartographic paper remains the sole production raster asset; the new concept is documentation, not a screenshot shipped as UI.

- Colors: graphite header #202725, settings/setup #29322e, unchanged ocean #1d323b; flat paper sidebar #e7e6dc, ink #28312d, secondary #606860, ruled separators #b5bab1. Warm-white primary controls. Green #286540 for gains on paper; light green retained over dark map surfaces.
- Type: self-hosted Archivo for body/controls, Archivo Narrow for operational headings and scores, Alegreya 500 for atlas names only. Tabular numerals for comparisons. Body/control text 12–14px; headings 18–32px; scoreboard 40px. Map font loading explicitly synchronizes measurement and rendering.
- Containers: 64px header, open map, one responsive 340–438px sidebar (28.5% at the 1536px reference size); compact 540px setup dialog. 0–2px corners, shared table rules, no stacks of boxed cards.
- Map: national flags are the default territory background, including setup. During a campaign, only participating territories fly flags. Each geographic owner-region uses one continuous flag across old borders and nearby islands, avoiding repeated miniature emblems on archipelagos. Fixed coast-to-coast links of up to 180 projected kilometers group only same-owner land; they do not change conquest adjacency. Distant possessions remain separate so they cannot stretch a mainland's stripes or emblem out of sight. Countries outside the active campaign are neutral and unflagged, per the user's continental-game follow-up. Political colors remain an optional view. Names and capitals stay readable over flags; subdued paper ocean texture. Preserve geographic SVG paths as an intentional requirement for accurate clickable territories, ownership, and zoom. No sprites are appropriate to this map simulation.
- Empire names: one uppercase serif name per visible owner, fitted to the combined territory rather than the largest original country's centroid. Grow and gently rotate names into usable land, verify their full padded footprint against borders, and omit illegible tiny labels until zoomed in. Cache placement work and keep camera changes stable. See `empire-labels.md` for the algorithm; capitals and targeting remain separate.
- Results: compact horizontal team / score / team composition, 48px flags or club monograms, plain rule, left-aligned winner and concrete spoils. Persistent sidebar result with small contextual map notifications. The idle state has factual copy and no trophy illustration.
- Controls: warm-paper primary action, connected square command segments, quiet secondary buttons, 44px targets, clear focus and disabled states; advanced settings disclosed on demand.
- Motion: brief score/result entrance, restrained territory highlight; honor reduced motion.
- Icons: restrained 17–21px outline SVGs, current-color strokes, consistent rounded joins; filled play triangle, outlined pause/arrow/zoom/settings and territory/player metaphors. Actual flags remain locally vendored SVG assets; clubs use color-coded monograms because the source data has no crests.

## Allowed primary copy

Imperialism; Football / Nations (dynamic sport/layer); Europe (dynamic theatre); Round; remaining; The European campaign (dynamic theatre title); Latest match; Ready; No match in progress; Choose Next match to draw the next fixture.; Full time (sport-dependent); Standings; Activity; Squad (needed for existing inspection); Political; Flags; Next match; Finish match; Play campaign; Pause; 1×; Settings.

Setup: Football / Nations (dynamic sport/layer); Start your campaign; Choose your sport, teams and theatre.; Sport; Football; Basketball; Teams; Nations; Clubs; Theatre; Match settings; One by one; Live ticker; Launch campaign; Progress saved after every match. Resume and confirmation copy are conditional functional states.

Illustrative team names, scores and counts in the concept are replaced with real campaign data. Existing Natural Earth geometry and actual theatre framing take precedence over the concept's illustrative map, including England rather than UK and the existing excluded shapes. Mobile stacks map above the sidebar; the concept's desktop proportions do not apply to phone widths. The world projection is preserved, so setup shows more ocean than the illustrative concept. Ocean captions are geographically anchored, not screen-positioned. Land is accurate solid-fill SVG; the generated paper texture is used on the ocean without a tinted overlay. Labels use a subtle halo and collision suppression for readable coastlines.

Functional copy retained beyond the concept: EFF and player ratings/positions, Terr. (compact territory heading), Squad inspection, generated-player disclosure, round queues, map scale/coordinates/largest empire, conditional empty/live/tie/upset/victory states, and saved-game/overwrite confirmations. These expose existing game data and controls, not invented metrics or sections. The theatre changes through New campaign confirmation rather than an in-campaign dropdown that would silently replace the current war.

## Verification checklist

Check setup, match/live/final, transfers, standings, activity, squads, victory, settings, flag/political modes, zoom/pan, keyboard focus, phone layout, and resume. Compare screenshots for composition, type, palette, controls, results and texture; record concrete deviations and fixes in the verification note.

## Standings follow-up

The standings follow the user's later requirement: always sort by current overall strength (the existing EFF metric), descending, then team name for stable ties. Territory count remains visible but is not a ranking factor. The column is labelled Strength and exposes its descending order to assistive technology. Rank numbers remain sequential beyond 99.

Standings use compact 31px desktop rows with 20px flags and tighter padding, retaining readable 12–13px text and separate aligned strength/gain values. Coarse-pointer devices retain 44px team buttons, and the focus outline is inset to stay visible within dense rows.

The sidebar squad list uses 30px minimum rows with inline transfer origins and tighter summary spacing, retaining 12px names and 13px ratings. Long names wrap naturally instead of being clipped. These noninteractive rows stay compact on touch screens while buttons retain their existing targets; the victory roster remains roomy.

Activity follows the same density: 30px minimum rows, 6px vertical padding and column gaps, unchanged 12px message text, and natural wrapping for longer updates. Round labels and event-color dots remain visible; no events are collapsed or removed.

Positive overall gains now appear as a green `+N` beside Strength, measured from the team's campaign-start rating and formatted to one decimal. A separate Overall strength row in the latest match reports that conquest's before/after rating and individual gain, or No change in neutral text. Cumulative and per-match gains are deliberately distinguished. The existing strength formula is unchanged; no bonus is awarded merely for territory count.

## Downloaded skill provenance

- game-design: https://github.com/sickn33/agentic-awesome-skills/tree/main/skills/game-development/game-design
- game-ui-design: https://github.com/jeremylongworth-source/AgentSkills/tree/main/skills/game-ui-design

Installed into the user's Codex skills directory after reviewing the skill markdown. Their influence is the visible action-feedback-reward loop, a protected map, progressive disclosure, and complete focus/paused/result states.
