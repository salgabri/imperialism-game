# Compact pass: less text, no scrolling

Record of the November 2026 pass over the whole interface (setup, map column, match preview, Match, Squad, Ledger,
Chronicle, conquest, elimination, results, settings and the phone More sheet). It refines the
[v4 redesign](v4-redesign.md) and wins over it where they differ.

The brief was to cut the words on screen and keep every screen inside the window: no page scroll and no
scrolling panels, at desktop, tablet and phone sizes.

## Rules

1. **Nothing scrolls in a normal state.** A screen is sized to the window, and every list or wall inside it is
   sized to its own box.
2. **Long lists page.** They show as many whole rows as fit and turn with a pager (`‹ 2 / 5 ›`). Fields of teams
   become flag walls (crests for clubs) whose cells shrink until the field fits. Below a minimum cell size the wall
   pages instead.
3. **Labels, not sentences.** A sentence that explains a control moves to its `title`, and to `sr-only` text or
   `aria-describedby` for screen readers. What's left on screen is a name and a value.
4. **A fact is said once.** If the masthead, the fronts table, the ticker or a heading already shows something,
   it isn't repeated elsewhere ("Full time" under a "Result" heading, strengths on the result card, "Latest
   results" beside the ticker, the full XI twice in "Lineup changes").
5. **Below 1200px, side-by-side columns become panels.** A segmented control switches them (Standings · Map
   share · Fallen; Matches · Result · Story; Result · Squad; Chart · Lineups).
6. **Short windows give up extras before controls.** The map, standfirsts, recaps and the lineup of results are
   the first to go. `overflow:auto` stays only as a fallback for windows too short for 44px touch targets.

## Mechanisms

- [`src/hooks/useFit.js`](../../src/hooks/useFit.js)
  - `usePagedList(items, { row, focusIndex, minRows, measureKey })` measures its box with a `ResizeObserver` and
    returns the page that fits. It re-measures when the box resizes, when the list first gets rows, and when its pager
    comes or goes. That last case matters because a pager inside the box moves the rows down without resizing the box.
    `focusIndex` brings a row's page into view (your team in the standings, the selected match in the history), in
    the same render that changes it or the page size, so the focused row stays mounted and keeps the keyboard focus.
    A page of one row keeps the row height measured with more rows: that row is the box's first, which can be a rule
    shorter than the rest, and measured alone it made room for one row too many. That height holds at the box width
    it was measured at, or while it is only a rule taller: a window resized across a breakpoint draws rows of
    another height.
  - Before its first measure a list renders at most (the screen's longer side ÷ 24px) + 1 rows, from its focused row.
    A box with a height of its own overflows with them and is measured exactly as with every row; a box its rows size
    gets every row back. The screen is read because it needs no layout (`innerHeight` lays the page out on Android
    Chrome), and a window taller than its screen only loses the saving.
  - Both hooks measure from their box's callback ref, after React writes the screen and before the browser paints,
    so the first frame shown is already paged. `measureKey` measures again in the commit that changes it: the
    panels below 1200px, the Match view's Chart / Lineups switch and its phone segments, and setup's steps show
    boxes that were hidden when they mounted.
  - `fitWall(width, height, count, { ratio, gap, minCell, maxCell })` is the wall's pure arithmetic: the largest
    cell at which the whole field fits, otherwise whole rows of `minCell` cells per page.
  - `useFitWall(count, options)` applies `fitWall` to a measured box. `options.touch` overrides the rest on a
    phone or a touch screen. The team wall and the fallen wall use 44px **square** cells there, with each 4:3
    flag whole in the middle of its target. `options.focusIndex` (setup's checked team) and `options.measureKey`
    work as the list's do.
  - Without a `ResizeObserver` (jsdom, the server) nothing is measured and everything renders on one page. That is
    what the DOM contracts in the tests read.
- [`src/components/Pager.jsx`](../../src/components/Pager.jsx): `‹ n / N ›`. Its end buttons use
  `aria-disabled`, so a keyboard player keeps focus. It renders nothing for a single page.
- Breakpoint additions, alongside the existing tiers (wide ≥1600 · std 1200–1599 · tablet 700–1199 · phone <700):
  - **Landscape tablet** `(min-width:700px) and (max-width:1199.98px) and (orientation:landscape)`: the map view,
    the conquest article and the match feed sit side by side as on a desktop. Portrait tablets keep the stack.
  - **Phone with its browser bars showing** `(max-width:699.98px) and (max-height:760px)`, for example 390×664: the
    extras give way (standfirsts, recaps, results in the sheet, the Chronicle totals while a result is open, the
    preview's stakes while its lineups are open), and rows tighten.
  - **Smallest phones** `(max-height:660px)`, for example 360×640: a thinner strip of map above the expanded sheet,
    and no round heading on the Chronicle's result.
  - The phone map row is `clamp(150px, 100dvh − 482px, 330px)`, which is whatever the chrome and the collapsed
    sheet leave. The conquest map row works the same way.

## Screen by screen

- **Setup.** The header holds the save actions as icons. A failed save or a refused file grows a strip under the
  header's row; a refused resume shows on the resume card instead. Step 1: a slim notice line (resume, challenge
  link), sport tiles (up to four in a row, up to eight in two rows; since women's tennis, the nine sports in three
  rows of three, tiles trimmed to what the icon and name need but still 44px targets, and on 360×640 with a notice
  line the step's heading gives way, as step 2's does for More rules), Nations | Clubs and the season on
  one row, theatre chips (Europe's Top 124 and Elite 32 for football clubs), the One country · top clubs dropdown,
  and the counts at the foot. The theatre's map fills the side. Below 900px wide (one column, a phone or a narrow tablet)
  the map sits under the controls instead, so since 2026-11-21 setup.css's phone height tiers reach every one-column
  width: up to 760px tall the map and lede give way, and four rows of sports take the compact 44px tiles; on a phone up to
  660px tall the heading gives way too. Since 2026-11-23 a narrow tablet up to 800px tall lays its sports in two rows of
  seven instead, and keeps its heading. A short window in two columns (below 720px tall, or 760 under a finger) does the
  same: the controls column widens to 640px for the two rows of seven, and the map gives up the width. A notice line takes
  the heading's place in one column and on windows up to 840px tall. Football clubs' country row (the country, and how many of its clubs play) shares the line of
  Europe's two chips in one column where it keeps 320px; on a phone it still wraps under them. Under the Season choice, a season whose listing carries a
  credit shows it whole as quiet text, never cut (since 2026-11-10: ice hockey's Hockey Databank statement and MoneyPuck's
  credit, [hockey.md](hockey.md#credits)); the lede gives way to it in one column and on windows up to 800px tall, and the
  heading too with a notice line on a phone or two notice lines on a short window. Step 2: four short draw cards, with
  Show matches and More rules beside them. With More rules open in one column up to 800px tall the cards show their names
  alone and the heading gives way, and on a narrow tablet More rules hold three fields to a row. Step 3: compact role
  cards with the opponent choice in the same row, a flag wall strongest first (arrows, Home, End and type-ahead walk it
  across its pages), and the suggested team as a compact card. The card gives up its best players below 960px tall in one
  column and up to 660 in two, and its fronts below 800 in one column, so the wall keeps its room; on a narrow tablet up
  to 660px tall the step's heading gives way too. The rail's ad shows only at 1600px and wider and at least 740px tall.
- **Map column.** Next fixture puts the approach in its kicker and the odds detail on its title, and the
  "simulate the result" link is now just "Simulate". The result card drops "Full time" and the strengths. Latest
  results repeats the ticker, so it shows only where there's room: on desktops 860px tall or more, on tablets in
  place of the fronts, and in a phone's expanded sheet unless the phone is short. It never shows "No results yet".
  On your turn, **Choose a target** takes the column's height and pages its rows: an empire late in a campaign
  borders more teams than the column holds, and a phone holds about four. The pager sits in the list's head row,
  and the arrow keys walk every row across the pages. In a phone's expanded sheet, Your fronts shows the rows that
  fit, strongest first: a club's long name can wrap the fixture above it.
- **Match preview.** The decision comes first: three approach cards (name, Recommended, strength, variation
  squares, reserves, win chance). Tale of the tape and Lineups share one panel below. "Simulate the result" sits
  in the top row. On a phone, lineups longer than the sheet (ice hockey fields 19, American football 23) page
  together, as on the Match screen.
- **Match.** Chart | Lineups. The XIs show the rows that fit and page together (American football fields 23).
- **Squad.** List, Pitch and Acquisitions. The table columns are Pos · Player · Rtg · Acquired: the natural
  position and the source are on the row's title, and the name links to the source. The depth list is paged in
  the side column. On phones: List · Pitch · Bench.
- **Ledger and Chronicle.** One-line head. Standings, history and activity page. The fallen empires are a grey
  flag wall.
- **Conquest.** The standfirst is the result sentence. **Lineup changes** lists only the places a signing changes,
  or says "Your lineup stays the same." While it's open, the effects, the standfirst and the option details make
  room.
- **Results, elimination, settings.** A one-line recap, compact stats, Result | Squad panels below 1200px. "This
  campaign" is a closed disclosure. The More sheet shows autoplay and speed side by side.

## Measured

Words on screen (visible text, excluding the map) and pixels of vertical overflow, before → after. These were
measured with headless Chromium against the dev server, playing seed 2033 (Europe, manager, round robin, You choose,
Fast-forward). The before figures are from `0bce595`.

| Screen | 1440×900 | 390×844 |
| --- | --- | --- |
| Setup · Campaign | 234 words, 379px → 61, 0 | 215, 1,374px → 59, 0 |
| Setup · Campaign, clubs | 757, 6,193px → 64, 0 | 738, 7,252px → 62, 0 |
| Setup · Rules | 174 → 69 | 151, 342px → 64, 0 |
| Setup · Rules, More rules open | 235 → 76 | 212, 908px → 71, 0 |
| Setup · Your role | 328, 1,603px → 82, 0 | 313, 1,805px → 34, 0 |
| Match preview | 414 → 135 | 306, 915px → 100, 0 |
| Squad | 225 → 119 | 96, 176px → 79, 0 |
| Ledger | 437, 879px → 220, 0 | 328, 2,104px → 88, 0 |
| Settings / More sheet | 161 → 92 | 123, 182px → 65, 0 |
| Live match | 186 → 83 | 58 → 58 |

After the pass, nothing scrolls at 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768, 820×1180, 768×1024,
390×844, 390×664 and 360×640 on the full manager run (setup, map, preview, match, conquest, squad, ledger,
chronicle, elimination, results). The same holds for spectator, American football (NFL), baseball (MLB), club
walls, dark mode, `?ads=preview`, and a football club campaign on the Europe maps (Top 124, measured at all of
those sizes but 1920×1080, 1366×768 and 1280×720). The dark match feed drops its oldest lines at the bottom by
design.

**Season credits** (2026-11-10). Setup's step 1 with the longest credit, ice hockey's 2011/12 (MoneyPuck's and the
Hockey Databank's statement, 254 characters), measured with headless Chromium (Playwright) against the dev server: the
season picked by hand, with a challenge link's notice line, and with Resume's; clubs and nations alike; a coarse pointer
(44px targets) on phones and tablets. The figure is the room left in the controls' column, or the map's height where the
map shares the column (its floor is 120px).

| Size | Credit | No notice | Challenge link | Resume |
| --- | --- | --- | --- | --- |
| 390×664 | 4 lines, 57px | 77 | 56, heading gone | 48, heading gone |
| 360×640 | 4 lines, 55px (10.5px) | 32 | 11 | 3 |
| 1024×768 | 4 lines, 57px | 100 | 42 | 42 |
| 1024×768, touch | 4 lines, 57px | 84 | 26 | 18 |
| 1280×720, touch | 4 lines, 57px | 87 | 29 | 21 |
| 1366×768 | 4 lines, 57px | 135 | 77 | 77 |
| 1440×900 | 4 lines, 57px | 223 | 165 | 165 |
| 1920×1080 | 3 lines, 43px | 432 | 374 | 374 |
| 390×844 | 4 lines, 57px | map 235 | map 214 | map 206 |
| 375×812 | 4 lines, 55px | map 194 | map 173 | map 165 |
| 360×780 | 4 lines, 55px | map 150 | map 129 | map 121 |
| 768×1024 | 2 lines, 29px | map 356 | map 298 | map 290 |
| 820×1180 | 2 lines, 29px | map 512 | map 454 | map 446 |

Nothing scrolls at any of them, nor at 1280×720, 1024×800, 1280×800, 390×780, 412×800 and 360×740, nor in dark mode
(390×664, 360×640 and 1024×768 measured).
Without the lede and heading rules four lines did not fit beside a notice line at 1024×768 (2px short, 18px with a
coarse pointer) or at 1280×720 with a coarse pointer (15px), and pushed the map under its floor on phones 780–812px tall
(by 5 to 59px). At 11px the credit's fourth line had 3px to spare in a 360 phone's column, hence 10.5px below 390 wide.

**Narrow and short tablets** (2026-11-21). Setup's step 1 as it opens (football nations), measured with headless Chromium
against the dev server (dark, device scale 1, a fresh context per size), without and with a challenge link's notice line.
Three sizes scrolled: 800×600 by 134px either way (the map's 120px floor under 457px of controls in a 437px body), 700×800
with the line by 33px (the map under its floor) and 1100×700 with the line by 43px. Now 800×600 has 72px to spare, 18px with
the line; 700×800's map is 158px tall; 1100×700 has 30px to spare. Nothing scrolls, with or without the line, at those three
nor at 1920×1080, 1440×900, 1280×800, 1280×720, 1920×800, 1366×800, 1024×768, 768×1024, 412×915, 390×844, 390×664,
375×667, 360×780 and 360×640 (the phones unchanged to the pixel). Over a grid of widths 700–1280 and heights 600–860, 116 of
220 cases scrolled before and 30 after, none in one column. The hockey credit (2024/25) also fits at every one of those
sizes but 800×600 with the line; under a coarse pointer 1024×768 and 1280×720 with the line fit now too. Football clubs
(`/?teams=clubs`, a challenge link, and the Clubs radio without one) scrolled on main at 8c0b4df0 at 700×800 (77px with
the line, 19px without), 1100×700 (45px with it) and 800×600 (134px either way), and in 128 of the 220 grid cases, 80 of
them in one column, where the country row under the chips cost the map 44px. Now none of those sizes scrolls in clubs
either, and 30 grid cases do, none in one column; 700×800's map is 158px tall with the line, and the phones are unchanged.

**Short windows, steps 1–3** (2026-11-23). Same method, football nations and clubs, without and with a challenge link's
line, at steps 1, 2 (More rules shut and open) and 3 (a manager, the default role without a link), over widths 700–1920
and heights 600–1024. Besides the step's scroll the check counted content run out of its column: into the step's padding,
over the other column, or a wall of flags under 44px. The scroll alone missed the worst case: at 700×800, a listed size,
step 3's wall was 0px tall and the role cards lay over the selected team's card, and nothing scrolled. Before, 115 of 390
grid cases failed in nations (72 scrolled) and 125 in clubs (74):
- Step 1 in two columns. The controls need 536px, 507px with the line in the heading's place, and a tablet's body is the
  window less 163px under its step bar (a desktop's less 120px). Tablets 900–1199px wide scrolled by 85px at 600 tall
  (56px with the line), 45px at 640 (16px) and 25px at 660, and by 13px at 800 tall with the line (the tiles the full
  62px). Desktops scrolled by 42px at 600 (13px) and 2px at 640; 1600 and wider, whose rows are 40px, by 59px at 600 (25px)
  and 19px at 640. Clubs ran 2px more, and under a finger 1100×700 scrolled by 9px. Below 720px tall (760 under a finger)
  the controls column is 640px wide and the sports lie in two rows of seven, the map taking what width is left: 1100×600
  has 28px to spare (38px with the line), 1280×600 71px (81px), 1600×600 55px (69px), 1100×700 under a finger 104px
  (114px), 1100×600 under a finger 4px (14px). At 800px tall the line takes the heading's place: 57px to spare.
- Step 1 in one column: ice hockey's 2024/25 credit with the line scrolled 800×600 by 14px, now 58px to spare. Narrow
  tablets 768px tall had the map on its 120px floor, 4px into the padding; it is 216px tall now.
- Step 2 with More rules open: narrow tablets scrolled by 25px at 600 tall and 9px at 768, phones 761–790px tall by 8px
  at 780 (360×780 is a listed size). Now nothing scrolls; under a finger a narrow tablet 600px tall runs 1px into the padding.
- Step 3: in one column the wall had 0px from 600 to 830 tall (68px of scroll at 600, 28px at 640, 8px at 660) and 11px
  at 860. It is 142px at 800×600 (112px for clubs, in three pages; under a finger 83px, its 44px cells paged), 154px at
  700×800 (124px), 266px at 800×768; 768×1024 keeps the whole card and its 205px wall. In two columns 900–1199 × 600
  scrolled by 25px; it fits now.

Now none of 1,020 grid cases fails in nations or clubs (heights 680, 710, 719 and 780 added), none of 440 under a finger
scrolls (12 of them are that 1px of More rules), and the 17 listed sizes fit at every step with and without the line, in
both (12 of their 68 cases failed before). The phones' step 1 is unchanged to the pixel. At the listed sizes 1100×700 now lays its sports in two rows of
seven, 800×600 has its heading back, and 1280×800, 1366×800 and 1920×800 with the line lose the heading (1920×800 had run
12px into the padding). The other twelve sports fit at 800×600, 800×768, 700×800, 1100×600, 1100×700, 1280×600, 1366×768,
1024×768, 1280×720, 1600×600, 390×664 and 360×640, each layer they have, with and without the line. A save's Resume line
behaves as the link's: alone it failed 9 of 20 short sizes before, and now only 360×780 runs 4px into the padding, as
before (a phone, its map on its floor).

## Limits

- Hover titles don't exist on touch screens. Everything moved to a `title` is also in `sr-only` text or
  `aria-describedby`, but a sighted phone player no longer sees those explanations.
- A phone held sideways (844×390) leaves about 250px under the masthead, too short for 44px targets: the column,
  the conquest article and the results scroll there.
- Long club names ("Paris Saint-Germain") keep to one line, cut with an ellipsis, on phones with their browser bars
  showing: in a result's score header and signing line and in the preview's header, and on the smallest phones
  in a result's headline too. The crests stay beside the names, and the full names are in the screen-reader
  labels and the match list.
- Some content left the screen: the managers' Favourites and Long shots lists in setup, the claimed list and the
  pitch in the Squad side column, Latest results on short windows, the full XIs in the conquest comparison, and
  the preview's XIs (one switch away).
- Two notice lines at once (a save on this browser and a challenge link) were never fitted on phones: setup's step 1
  scrolls there for football clubs by 26px at 390×664 and 41px at 360×640. A hockey season's credit adds to it (2px at
  390×664, 47px at 360×640, 37px at 360×780); short desktops and tablets with two lines fit, the heading giving way,
  but a tablet 600px tall runs 12px into the step's padding with them (it scrolled by 106px before 2026-11-23), and
  700×800's map sits on its floor, 12px into the padding.
- Setup was fitted down to 600px tall (measured 2026-11-23). Shorter windows still run out: in two columns step 1 scrolls
  by 8–18px at 540px tall and up to 58px at 500, and in one column step 2 runs over from 580px.
- Below 720px tall step 1's map gives its width to the controls: it is 240px wide at 900, and under 500px up to 1140 wide
  on a tablet and 1375 on a desktop. A team's preview on so narrow a map lies across it and can cover the zoom buttons
  until it is closed.

## Verifying

`node scripts/test.mjs` covers the arithmetic and the hooks (`scripts/fit.test.mjs`, with a stubbed
`ResizeObserver`), the keyboard walks across pages (the team wall, the target list), and the DOM contracts. The
fit itself is a layout property that jsdom can't measure. Check it in a browser at 375–390 and 768–1024 wide as
well as on desktops, with both short (664, 640) and tall phone heights. Check lists that grow during a campaign
at their longest, not only on the first turn: the target list fit a nations campaign's first turn and still
overflowed a phone in a club campaign, where a club starts with six neighbours in reach.
