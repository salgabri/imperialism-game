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
  - `usePagedList(items, { row, focusIndex, minRows })` measures its box with a `ResizeObserver` and returns the
    page that fits. It re-measures when the box resizes, when the list first gets rows, and when its pager comes or
    goes. That last case matters because a pager inside the box moves the rows down without resizing the box.
    `focusIndex` brings a row's page into view (your team in the standings, the selected match in the history).
  - `fitWall(width, height, count, { ratio, gap, minCell, maxCell })` is the wall's pure arithmetic: the largest
    cell at which the whole field fits, otherwise whole rows of `minCell` cells per page.
  - `useFitWall(count, options)` applies `fitWall` to a measured box. `options.touch` overrides the rest on a
    phone or a touch screen. The team wall and the fallen wall use 44px **square** cells there, with each 4:3
    flag whole in the middle of its target.
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
  and the counts at the foot. The theatre's map fills the side. Under the Season choice, a season whose listing carries a
  credit shows it whole as quiet text, never cut (since 2026-11-10: ice hockey's Hockey Databank statement and MoneyPuck's
  credit, [hockey.md](hockey.md#credits)); the lede gives way to it on phones and on windows up to 800px tall, and the
  heading too with a notice line on a phone or two notice lines on a short window. Step 2: four short draw cards, with
  Show matches and More rules beside them. Step 3: compact role cards with the opponent choice in the same row, a flag wall strongest first
  (arrows, Home, End and type-ahead walk it across its pages), and the suggested team as a compact card. The rail's
  ad shows only at 1600px and wider and at least 740px tall.
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
  390×664, 47px at 360×640, 37px at 360×780); short desktops and tablets with two lines fit, the heading giving way.

## Verifying

`node scripts/test.mjs` covers the arithmetic and the hooks (`scripts/fit.test.mjs`, with a stubbed
`ResizeObserver`), the keyboard walks across pages (the team wall, the target list), and the DOM contracts. The
fit itself is a layout property that jsdom can't measure. Check it in a browser at 375–390 and 768–1024 wide as
well as on desktops, with both short (664, 640) and tall phone heights. Check lists that grow during a campaign
at their longest, not only on the first turn: the target list fit a nations campaign's first turn and still
overflowed a phone in a club campaign, where a club starts with six neighbours in reach.
