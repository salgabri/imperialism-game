# Imperialism

A world-conquest simulation where sport decides borders. Every nation starts
holding its own territory. Win a match and you annex **everything** the loser
holds and claim one player. Spectators automatically sign the highest-rated
player; managers choose from three candidates ranked by lineup improvement.
Last team standing takes the map.

Pick your sport at kick-off:

| Sport | Lineup | Clock | Level game |
| --- | --- | --- | --- |
| Football, and women's football | XI in a 4-4-2 | 90 minutes | penalty shootout |
| Basketball | starting five | 40 minutes for nations and EuroLeague clubs (FIBA), 48 for NBA clubs | overtime periods |
| American football | 23 starters: 11 on offence, the nickel defence, the kicker | 60 minutes | overtime periods |
| Baseball | the batting order's nine (with a designated hitter), the starter and three relievers | 9 innings | extra innings |
| Ice hockey | four lines, three pairs and the goalie | 60 minutes | sudden-death overtime, then a shoot-out |
| Tennis, and women's tennis | a Davis Cup (or Billie Jean King Cup) team: No. 1 and No. 2 in the singles, a doubles pair | five rubbers, first to three, each best of three sets | none: a tie always has a winner |
| Rugby league | the matchday 17: thirteen and four on the bench | 80 minutes | golden point |

And pick who fights:

- **Nations** — 176 nations on the map, each team starting on its own homeland. England,
  Scotland, Wales and Northern Ireland are four teams on four shapes, as in football.
  Basketball, baseball, ice hockey and both tennis games field them as one team, Great Britain
  (GBR), under the Union Jack. A sport fields 173 at most: those four play Great Britain
  as one, and football leaves out Tonga, Samoa and the Cook Islands, whose players no
  source rates ([Pacific islands](docs/design/pacific-islands.md)). A nation fields a team
  only with a **real side**, its own rated players holding at least half the lineup, and
  every other nation's land stays neutral: 173 nations play football, 52 tennis, 45
  women's tennis, 47 basketball, 36 women's football, 12 baseball, 7 ice hockey and 6
  rugby league. No team is made up of generated players or nearly empty.
- **Clubs** — Europe's 124 strongest football clubs on [their map of
  Europe](#the-europe-maps), each on land in its own country, 84 women's clubs (Europe's 68
  on [their maps of Europe](#womens-football-on-the-europe-maps), the NWSL's 16 on [theirs](#the-nwsl-map) of the USA), all 30 NBA
  franchises on [their own map](#the-nba-map) of the USA and Canada, the EuroLeague's 20 clubs
  on [theirs](#the-euroleague-map) of Europe, all 32 NFL
  franchises on [theirs](#the-nfl-map) of the USA, all 30 MLB clubs on
  [theirs](#the-mlb-map) of the USA and Canada, all 32 NHL clubs on
  [theirs](#the-nhl-map), or all 17 NRL clubs on [theirs](#the-nrl-map) of Australia and New Zealand. Real Madrid annexes territory
  exactly the way Spain does. American football is played by clubs only, tennis and
  women's tennis by nations only.
- **One country's clubs** — a country's top football clubs (100 for the biggest
  leagues, fewer for smaller ones) on that country's own map, split into 100
  sections ([domestic campaigns](#domestic-campaigns)).

Everything outside the match — territory, the spinner, targeting, conquest,
autosave, the map — is sport- and layer-agnostic. A sport supplies its own roster
data, lineup shape, match model and vocabulary (`words`) from `src/sports/`; adding
American football took one module, its club file, its lineup plan and its squad
field ([design notes](docs/design/american-football.md)). Baseball added the sport's
own match clock (half-innings, not minutes) and nations by birthplace
([design notes](docs/design/baseball.md)). Ice hockey's ratings are partly estimates, each
marked as one ([design notes](docs/design/hockey.md)), women's football plays
under football's rulebook with its own players ([design notes](docs/design/womens-football.md)), and rugby league plays
Rugby League 26's NRL in five-minute slices to golden point ([design notes](docs/design/rugby-league.md)).
Tennis plays Davis Cup ties between nations, its players rated by their Elo
([design notes](docs/design/tennis.md)), and women's tennis the Billie Jean King Cup's, the WTA's players
by their Elo, with the WTA's serve ([design notes](docs/design/womens-tennis.md)).

Originally implemented from the `Football Imperialism.dc.html` design in the
[Football Imperialism Game](https://claude.ai/design/p/440e3f09-8445-4fa3-8acb-531957f27c9b)
Claude Design project.

The current interface is that project's **v4 redesign**: modern, flat and calm.
It pairs a grand-strategy map (Europa Universalis) with dense football-management
data (Football Manager). Surfaces are light (`#f5f5f2` with white panels) with
square corners and no textures, glows or gradients. One clay accent (`#9c5a43`)
marks your team and the primary action, and cobalt (`#2f54eb`) marks the next
opponent. Archivo and Archivo Narrow are the only faces loaded. They are
self-hosted with their open-font licenses in `public/fonts`, so no external font
service is needed. The Alegreya files and `public/textures/cartographic-paper.png`
remain in the repository but are no longer used. Map names wait for their font
metrics before switching faces. The [v4 redesign record](docs/design/v4-redesign.md)
lists the binding decisions, the architecture and the known deviations. Earlier
notes in `docs/design/` are kept as history.

## Running it

```bash
npm install
npm run dev         # dev server, prints a localhost URL
npm run build       # production bundle into dist/: installable, plays offline
npm run preview     # serve dist/ locally (the dev server has no service worker)
npm test            # complete automated regression suite
npm run smoke       # headless: plays campaigns to completion and checks invariants
npm run smoke -- --scenarios=england # only the smoke scenarios whose names match
npm run smoke -- --campaign-only=7   # one scenario by index (also --resume-only=<i>, --manager-only)
npm run balance -- --runs=12 # seeded odds, acquisitions and campaign balance report
npm run test:simulation # score distributions, RNG, tie-breaks, odds, live ticker and real-league realism
npm run simulation:report -- --samples=200000 --out=docs/design/match-simulation-report.json
npm run simulation:realism -- --seasons=40 # whole league seasons beside the real leagues' figures
npm run test:experience # pause, manager choice, series and checkpoint integration
npm run test:reachability # every offered theatre and disconnected final opponents
npm run test:map-fonts # font-loading, fallback and geographic remeasurement checks
npm run test:duel-draw # selection, staged timing, cancellation and kickoff checks
npm run test:draw-compass # compass, route, zoom and reduced-motion rendering
npm run test:map-viewport # minimal camera reveal and world-edge checks
npm run test:targeting # intervening borders, islands, neutral land and real Europe
npm run test:flag-symbols # symbol proportions, land fitting and generated asset integrity
npm run build:flag-symbols # regenerate reviewed field/emblem assets after source review
npm run sync-flags  # re-vendor flag SVGs after editing src/data/flags.js
npm run build:historic-flags # redraw the federations of the day's public-domain flags (--check to verify)
npm run sync:ea-fc       # snapshot EA FC 27 from EA's ratings API into scripts/data/ea-fc27.csv (network, cached)
npm run build-rosters   # regenerate football squads from an EA FC player CSV
npm run build-basketball # regenerate the basketball fives, rated by the built-in NBA 2K (pinned 2K Archive page)
npm run build-clubs      # regenerate the club layer for both sports
npm run sync:domestic-clubs # country club snapshots from the cache (EFEM requests need permission)
npm run sync:club-logos  # refresh club crests from Wikipedia (network, cached)
npm run build:domestic   # rebuild country maps from snapshots and boundaries (about 5 minutes)
npm run test:domestic    # country maps, sections and seeded country campaigns
npm run build:ea-seasons # rebuild the built-in earlier seasons from the pinned EA export in data-src/ea-leone/
npm run sync:early-nationalities # ask Wikidata for the FIFA 05 and FIFA 06 nationalities no later edition has (network, cached)
npm run sync:world-cup-seasons # read the pinned World Cup, results and Wikipedia sources in data-src/ into scripts/data/world-cup-seasons/
npm run build:world-cup-seasons # rebuild the computed World Cup seasons 1961/62 to 1993/94 from those facts (offline; --check to verify)
npm run build:football-set -- --cm0102=data-src/cm0102/<folder> # local season from your own CM 01/02 database
npm run build:nba-seasons # rebuild the earlier basketball seasons from the pinned 2K Archive page and sources in data-src/
npm run sync:euroleague  # snapshot the EuroLeague's rosters and box scores from its public API into scripts/data/euroleague-2026-27.json (network, cached)
npm run build:euroleague # rebuild the EuroLeague's clubs, every rating an estimate from that snapshot (--check compares byte for byte)
npm run sync:madden      # snapshot Madden NFL ratings from EA's site into scripts/data/madden-nfl-27.json (network, cached)
npm run build-nfl        # rebuild the NFL clubs from that snapshot (--check compares byte for byte)
npm run sync:mlb-the-show # snapshot MLB The Show's Live cards from its public API into scripts/data/mlb-the-show-26.json (network, cached)
npm run build-mlb        # rebuild the MLB clubs and the baseball nations from that snapshot (--check compares byte for byte)
npm run import:mlb-war   # rebuild the 1960–2017 baseball snapshots from the pinned WAR and Baseball Databank files in data-src/mlb-war/ (--check compares byte for byte)
npm run build:mlb-map    # rebuild MLB's maps of the USA and Canada, today's and the 43 of earlier seasons (1–2 minutes a map; --check compares byte for byte)
npm run sync:nhl         # snapshot EA's NHL 27 ratings and the NHL's rosters and statistics into scripts/data/nhl-27.json (network, cached)
npm run build-hockey     # rebuild the NHL clubs and the hockey nations from that snapshot (--check compares byte for byte)
npm run build:nhl-map    # rebuild the NHL's map of the USA and Canada (about 2 minutes; --check compares byte for byte)
npm run sync:nrl         # snapshot Rugby League 26's NRL ratings, Zero Tackle's profiles and NRL.com's 2025 team lists into scripts/data/rugby-league-26.json (network, cached)
npm run build-rugby-league # rebuild the NRL clubs and the rugby league nations from that snapshot (--check compares byte for byte)
npm run build:nrl-map    # rebuild the NRL's map of Australia and New Zealand (seconds; --check compares byte for byte)
npm run sync:ea-fc-women # snapshot EA FC's women's players from its public API into scripts/data/ea-fc27-women.csv (network, cached)
npm run build-womens-football # rebuild the women's nations and clubs from that snapshot (--check compares byte for byte)
npm run sync:tennis      # snapshot Tennis Abstract's men's Elo ratings and countries into scripts/data/tennis-elo.json (network, cached)
npm run build-tennis     # rebuild the tennis nations from that snapshot (--check compares byte for byte)
npm run sync:womens-tennis # snapshot Tennis Abstract's women's Elo ratings and countries into scripts/data/womens-tennis-elo.json (network, cached)
npm run build-womens-tennis # rebuild the women's tennis nations from that snapshot (--check compares byte for byte)
npm run test:football-sets # EA and NBA 2K seasons, CM 01/02 parser and builder, loader, setup and saves
npm run build:icons      # render favicon.ico, apple-touch-icon.png and the app icons from public/favicon.svg
```

The production build installs as an app (Chrome's install button, or Share › Add
to Home Screen on an iPhone) and plays offline. `npm run build` writes
`manifest.webmanifest` and a service worker, `sw.js`, which
[vite-plugin-pwa](https://vite-pwa-org.netlify.app/) builds from `src/pwa.js`.
The worker precaches only the app shell, about 3.5 MB: `index.html`, the hashed
bundle in `assets/` (every sport's players among it), the Archivo fonts and the
two world maps. Everything else in `public/` (about 100 MB) is cached the first
time the game uses it. Seasons and
country maps come from the network while online, so they always match the
deployed build, and from the cache offline. Flags and crests show from the cache
at once and refresh in the background. Starting or resuming a campaign online
also fetches every one of its teams' crests and flags that is not cached yet, a
few at a time, so teams the game never showed online still show offline. A
first visit installs the worker only once the setup screen is up and the page
is idle, or about 10 seconds after the game starts if setup takes longer, so its
downloads leave the game's own alone. After one online visit that got that far,
the game opens offline and plays nations and club campaigns,
plus every country whose map was opened online. A country never opened online
fails to load, with **Retry**, and a flag or crest the game has neither shown
nor kept for a campaign online stays blank.

The first download holds the game and football's players, the default setup's.
Every other sport's players are a file of their own (4 to 43 KB compressed),
loaded the first time that sport is picked, a challenge link names it, or a saved
or imported campaign of it opens. Until they arrive, the sport's card shows as
picked and setup holds its next steps and Launch; picking another sport first
drops the wait. Players that fail to load say so, with **Retry** and **Reload**.

A new version never reloads the page by itself. Its worker downloads in the
background and waits, and a **New version ready** panel offers **Reload** or
**Later**. Reload writes the open campaign's checkpoint, as closing the page
does, and reloads that tab only. Other tabs keep the version they loaded until
they reload, all but the players of a sport they have not loaded yet: the new
version has replaced those files, so picking that sport there fails until
**Reload**. Later hides the panel for that page; closing every tab also updates.
The page looks for a new version every hour and when you return to it.

## Deployment

The game is live at <https://imperialism-game.vercel.app>. Vercel builds every
push to `main`, and the build goes live once its tests pass.

**Continuous integration.** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
runs `npm test`, `npm run build` and `npm run smoke` on Node 26 for every push,
in about eight minutes, as the job **Tests, build and smoke**. GitHub Actions is
free for public repositories. A newer push cancels the older run, and the Actions
tab's **Run workflow** button runs it without a push.

**Deploys wait for the tests.** Vercel's [Deployment Checks](https://vercel.com/docs/deployment-checks)
(project Settings → Build and Deployment → Deployment Checks) require the GitHub
check **Tests, build and smoke**. Vercel still builds each push to `main` itself,
but holds the build back from the production domain until that check passes. A
failed or cancelled run leaves the last good deployment live. **Force Promote** on
a deployment's page skips the wait. The check is matched by the job's name, so
renaming the job means updating the check. Vercel's native **Lint** and
**TypeCheck** checks are listed there too. They are skipped because `package.json`
has no `lint` or `typecheck` script; adding either script would turn them into
real gates. This needs no tokens or secrets. A first attempt that deployed from
CI with the Vercel CLI was dropped on 1 November 2026, because the CLI rejected
the Hobby account's access tokens ("User not found. (404)").

**Caching.** [`vercel.json`](vercel.json) marks the hashed bundle in `/assets/`
immutable for a year. Fonts, flags and club crests are cached for a day and
revalidated in the background for a week; a stale image is harmless.
Everything else revalidates on every load: `index.html`, the maps and the
season and country files keep their names from one release to the next and
must match the code that reads them. That includes `sw.js`, which must never be
cached for long, or players would only see a release once the cache expired.

**Link previews.** `index.html` carries a description, a canonical URL, and
Open Graph and Twitter tags, so a shared link shows a card. Crawlers need
absolute URLs, so the canonical URL and `og:image` name
`imperialism-game.vercel.app`: change them with the address. There is no
`og:url`: Facebook would open every shared challenge link at the address it
names, and without it a share keeps its own.
`public/og-image.png` (1200×630) is a Europe campaign after 29 matches,
captured from the game with its overlays hidden, beside the wordmark.
`public/favicon.svg` is the draw compass's needle on the clay accent, and
`npm run build:icons` renders from it `favicon.ico` (16, 32 and 48 px), the 180 px
`apple-touch-icon.png` and the web app manifest's `icon-192.png` and
`icon-512.png`. The manifest's maskable icon, `icon-maskable-512.png`, shrinks the
needle into the central circle that every icon mask keeps. `public/robots.txt`
allows every crawler.

## How a campaign plays

### Setup

A new campaign is set up in three steps: **Campaign → Rules → Your role**.
Space moves to the next step and launches the campaign from the last one. Every
default suits a first campaign, so pressing Space three times starts one: as the
manager of the theatre's favourite, with decisions from the first match.

1. **Campaign** — choose a sport, nations or clubs, and a **theatre** (where
   the war is fought). Nation campaigns default to Europe (UEFA). The other
   choices are the whole world (173 nations in football), another confederation, or the
   Elite 32. A sport offers a confederation only where it is played: once at least four
   of its nations field a real side, their own rated players holding at least half the
   lineup, and the Elite 32 once 32 nations do. Rugby league offers the world and Asia &
   Oceania, baseball the world and N. & C. America, ice hockey the world and Europe;
   neither tennis game nor women's football has Africa, and an earlier season can offer
   fewer still. A choice the sport doesn't offer plays its heartland, the confederation
   with the most real sides (rugby league's Asia & Oceania), and comes back with a sport
   that offers it. Basketball's nations also offer **EuroBasket**, the 24 nations of EuroBasket 2025.
   Football club campaigns offer Europe's 124 strongest clubs or its
   Elite 32 on [the map of Europe](#the-europe-maps); basketball clubs play the NBA on its own
   map of the USA and Canada or [the EuroLeague](#the-euroleague-map) on its map of Europe, American football (clubs only: choosing it
   switches Teams to clubs and disables Nations) the NFL on its map of the USA,
   baseball clubs MLB on its map of the USA and Canada, ice hockey clubs the NHL on its own and rugby league clubs the NRL
   on its map of Australia and New Zealand. Tennis and women's tennis are nations only
   (choosing either switches Teams to nations and disables Clubs). Women's football's clubs
   offer every European club or its Elite 32 on [maps of Europe](#womens-football-on-the-europe-maps), or the NWSL
   on [its map of the USA](#the-nwsl-map). The step opens on a map of the chosen theatre:
   the board it starts on, each team's land in its kick-off colour, framed as
   the campaign's opening camera frames it (the continent for Europe). The map
   zooms and pans like the campaign's: scroll or pinch, drag, and double-click
   or the −/+/reset buttons (phones pinch). Its **Political** / **Flags** switch
   (**Crests** with clubs) puts each team's flag or club crest on its land, as
   the campaign's Flags mode does. Its foot
   shows the number of teams, the number of matches and the estimated length
   (the length's title names the Show matches mode the estimate assumes). With
   clubs in football, the **One country · top clubs** dropdown under the
   theatres starts a [domestic campaign](#domestic-campaigns), and its map shows that
   country. Football also has a **Season** choice: the built-in 2026/27 (the
   current season), then the [earlier seasons](#football-seasons) 2025/26 back
   to 1989/90 (EA FIFA and FC ratings of each to 2004/05, then SI's
   Championship Manager, Sensible World of Soccer for 1996/97 to 1994/95, and
   fans' databases for 1993/94 and 1989/90; 2005/06, 2004/05, 1996/97 and 1989/90
   have nations only), the World Cups of 1961/62 to 1993/94 (computed from each
   finalist's Elo and its players' records, nations only), and any local
   CM 01/02 season built on this computer. Basketball's lists the built-in
   2026/27, then its [earlier seasons](#basketball-seasons) 2025/26 back to
   1999/00 (NBA 2K ratings of each), then 1998/99 (NBA Live 99), 1991/92 and
   1983/84 (NBA 2K27's MyNBA Eras) and every other season back to 1960/61
   (computed from Basketball-Reference's statistics), which play NBA clubs on the map of their era. American
   football's lists its built-in 2026 season (Madden NFL 27), then its
   [earlier seasons](#american-football-seasons) 2025 back to 2001 (Madden ratings
   of each launch), then 1995 to 1992 and 1990 (Tecmo Super Bowl, the overall
   ours) and every other season back to 1960, with the AFL's of 1960 to 1969
   (computed from Pro Football Archives' facts), NFL or AFL clubs on the map of
   their day, and baseball's its
   built-in 2026 (MLB The Show 26), then its [earlier seasons](#baseball-seasons)
   2025 back to 2018 (MLB The Show of each), then 2017 back to 1960 (computed from
   WAR), with nations or with clubs on the map of their day. Women's football lists its
   built-in 2026/27, then its [earlier seasons](#womens-football-seasons) 2025/26
   back to 2015/16 (EA ratings of each; national teams only before 2022/23), ice
   hockey its built-in 2026/27, then its [earlier seasons](#ice-hockey-seasons)
   2025/26 back to 1966/67 but the cancelled 2004/05 (EA's NHL ratings where an
   edition published them, else converted or computed from the players'
   statistics), nations or clubs on the map of their day, tennis its 2026 (Elo of 2 November) then its
   [earlier seasons](#tennis-seasons) 2025 back to 1960, women's tennis its 2026 (Elo of
   2 November) then its [earlier seasons](#womens-tennis-seasons) 2025 back to 1968, rugby league its built-in 2025
   (Rugby League 26) then [its earlier seasons](#rugby-league-seasons) 2024 back to 2009 (computed from
   NRL.com's match statistics) and 2008 (Rugby League 2, the overall ours), NRL clubs on the map of their day.
   The Season list names a season by its years, adding "· computed", "· converted"
   or "· fan-made" where its label calls its ratings so ("1969/70 · computed"); a
   year with two seasons (football's 1993/94 and 1989/90, the NFL's and AFL's of
   the 1960s) names each by its whole label instead. Only ice hockey's seasons
   carry a credit, the Hockey Databank's and MoneyPuck.com's as their sources ask,
   shown whole as small text under the Season choice. A one-line quick-resume
   strip (**Resume**, the save, ✕) appears when a save exists, and a page opened
   from a challenge link shows a one-line note about the link
   ([Sharing a campaign](#sharing-a-campaign)). The header holds the save actions
   as icons; a failed save or a refused file shows on a strip under it.
2. **Rules of war** — one choice, **The draw** (below). Beside it, **Show
   matches** picks *Live, minute by minute*, *Final score only* or
   *Fast-forward*; it can be changed at any time during play. A collapsed
   **More rules** section holds upsets, the final, computer signings, home
   advantage, basketball team strengths and the seed. Its line reads "Standard",
   or lists only the rules you changed.
3. **Your role** — **Manager** runs one team. You choose an approach before
   its matches and one of up to three signings after its wins, and, under a
   one-match draw, the **Opponent** rule (who picks it). Manager is the default.
   The teams are a wall of flags (crests for clubs), strongest first. A field
   too large for the window pages (‹ 1 / 4 ›), and the arrow keys, Home, End
   and type-ahead walk the wall across its pages. Until you pick a team, the
   theatre's strongest is **Suggested**: checked on the wall and launched if you
   pick none. **Another team** after a defeat turns the suggestion off, so
   Launch waits for a pick. **Spectator** leaves draws, results and signings to
   the game, and you can follow any empire once the campaign starts. **Copy
   challenge link** copies a link to this setup and its seed. **Launch
   campaign** starts it. Saves from before the role existed still load as
   spectator campaigns.

### Rules of war

**The draw** decides how matches are made. Each card stores the existing
`pacing` and `turnOrder` settings:

| Card | Stored | Draw |
| --- | --- | --- |
| Random draw (recommended) | `duel` · `random` | One match per turn. Any surviving empire can be drawn to attack. |
| Round robin | `duel` · `round-robin` | One match per turn. Every surviving empire attacks once per round, strongest first (by starting strength, then name). |
| Blitz round | `blitz` | Pair everyone, preferring neighbours; otherwise use another opponent. An odd team gets a bye. |
| Chaos draw | `chaos` | Draw neighbour-preferred matchups until a name repeats, then resolve the batch. |

Blitz and chaos allow distant pairings without the directional route restrictions
used in one-by-one mode. Neither mode annexes neutral land to connect teams; the
empty land between a pair can only be [claimed](#claimed-land).

A manager under Random draw or Round robin also chooses, on the Your role step,
the **Opponent** rule, which decides who picks the opponent (`targeting`):

| Opponent | Whom they attack |
| --- | --- |
| You choose | On your turns you pick any empire in reach; every other empire spins the compass. |
| Compass | The compass picks the target for every attacker, you included. |

Blitz and chaos always use a random draw and the compass; a manager who picks
one sees a note, with a way back to the draw, instead of the opponent cards.
Spectators never see the choice and always use the compass. A stored *You
choose* becomes the compass when a spectator launches, and again when an
eliminated manager continues as a spectator. Rules are fixed at launch. The
defaults, **random draw × compass**, reproduce the original behaviour exactly.
Every one-by-one turn consumes exactly three campaign random samples in every
mode, so seeds recorded before the rules existed still replay the same campaign.

An empire is **in reach** if it is a land neighbour with a legal direct route.
If there is none, direct sea strikes count; after that, the fallback sea and
treaty routes. If nothing is in reach, that turn uses the compass and the log
says so.

Under round robin, a round is one full cycle. On the Map view a turn strip under
the masthead shows "Turn N of M this round" and the flags in turn order. Played
and fallen empires are dimmed (fallen ones are also struck through), the current
attacker is ringed, and "Next" names the following attacker. A round-robin
attacker with no route at all skips its turn. Under a random draw, spectators
get a strip with the number of empires that can be drawn and the recent
attackers.

On your turn under *You choose*, every empire in reach gets a dashed cobalt
outline and the land out of reach is veiled. The column's **Choose a target**
panel lists flag, name, strength, the territories you would gain and your win
chance. The list is sorted by win chance × territories, with the top row
preselected. When more empires are in reach than the column holds, the list
pages (‹ 1 / 2 ›) and the arrow keys walk it across its pages. A card on the map spells out what winning and losing would mean,
and the primary action becomes **Attack <team>**. The campaign waits for your
choice; no timer runs.

### Match rules

**Show matches** is *Live, minute by minute* (a live ticker), *Final score
only* (an instant final score) or *Fast-forward* (Express playback: final scores,
with shorter pauses for routine matches, but your team's matches still on the live
ticker). It stores the existing `resolution` and `express` settings. Under Live and
Fast-forward your team's match (the managed team, or the followed team while
spectating) plays at 1× whatever the speed, and the chosen speed returns with the
result; a speed picked during the match is kept. Level games go to penalties in football and
overtime in basketball and American football. The draw, the opponent choice, upsets, the final, computer
signings, home advantage and your role are fixed at launch. During a campaign the masthead's
**Settings** button (More on phones) changes Show matches at any time, except
that switching between Live and Final score only waits for the current draw or
match. Under **This campaign** it lists the launch rules as read-only text.
**Upsets** has predictable, balanced and wild presets that adjust match-day
rating variation; even Predictable retains scoring and tie-break randomness.
Football uses the selected forwards and midfield to create chances against the
opposing defence and goalkeeper. Shared match tempo, form and Poisson scoring
produce varied low-scoring games, with as many draws as Europe's top leagues.
Basketball uses shared possessions, positional offence/defence, form and shooting
variance, scaled to the NBA's margins and its share of overtime games. Nations play FIBA's four ten-minute
quarters at about 73 possessions; NBA clubs play the NBA's four twelve-minute
quarters at their season's league pace and scoring rate, so games score like
their season did: about 93 a side in 2003/04, 116 today; EuroLeague clubs play FIBA's quarters at the
EuroLeague's pace and scoring rate, 74 possessions and 86 points a side. American football plays about 11
possessions a side, each ending in a touchdown and its try (the extra point or two points),
a field goal, now and then a safety, or nothing by its offence against the opposing defence,
with late-game play-calling that makes 3 the commonest margin, as in the NFL, and playoff overtime.
Ice hockey plays three-minute slices whose rates follow the score (a level game tightens up late, a side behind
pushes and at the end pulls its goalie), then five minutes of sudden death and a shoot-out. Women's football plays
football's model. Tennis plays a Davis Cup tie: four singles and a doubles, first to three rubbers, each rubber won with
Elo's odds for the gap between the players and played out set by set, game by game. Women's tennis plays the Billie Jean
King Cup's tie the same way, its games with the WTA's serve: more breaks, fewer tie-breaks.
Stronger teams are favourites, while
every Upsets setting retains scoring randomness and possible upsets.
**Home advantage** is off by default: every match is played on neutral ground, so
the defending team wins half of even games. On, the defender plays at home and
wins about as often as home teams do in its sport's league: 45% of even football
games in ninety minutes (58% with the shoot-outs), 56% in basketball (64% in the EuroLeague), 54% in
American football and ice hockey and 53% in baseball. A Davis Cup host picks the surface and fills the stands:
even ties go its way 60% of the time. Attacks fail more often, and a failed
attack hands the defender the attacker's territory, so conquests change hands but
campaigns run as many matches. A best-of-three final keeps its attacker, so its
defender hosts every game.
Pre-match percentages estimate this model with an independent seeded sample.
They do not consume the campaign's random stream.
Odds prepare the two lineups once and sample scores without building hundreds of
event timelines. The [match simulation notes](docs/design/match-simulation.md)
describe the rules, calibration checks and measured performance.

### Masthead and controls

The masthead has two rows. Row 1 holds the wordmark, the dateline ("Round XIX ·
22 of 55 remain"), the screen navigation **Map / Squad / Match / Ledger /
Chronicle**, the one primary action and the Settings button. Row 2 shows your
team (flag, name, "Managed by you") with Strength and its change since Round I,
Territories, Conquests and Claimed. A spectator sees "Spectating · Following
<team>" with Empires, Matches, Upsets and Largest. Row 2 ends with the playback
controls, "Autoplay off · Speed 2×": the first toggles autoplay and the second
cycles 1× / 2× / 4×. Spectators also get a step button there (**Next match** /
**Finish match**).

There is one primary action per screen, and **Space** runs it on desktop. At
1200px and wider the button carries a "SPACE" hint. Focused controls keep their
own Space, and open dialogs block it.

| Primary | When |
| --- | --- |
| **Continue** | Draw the next match, move on after a result, or kick off at a tactical gate with the recommended approach (the best displayed win chance; Balanced on a tie) |
| **Finish match** | Reveal a live ticker match's result |
| **Attack <team>** | Confirm your target under *You choose* |
| **Sign <player>** | Confirm the signing on the conquest screen (the masthead button reads "Sign player") |
| **Pause** / **Resume** | Autoplay is running / the clock is paused |
| **Play campaign** | A spectator's primary (it becomes **Pause** while autoplay runs) |
| **Results** | The campaign is over |

**Pause** freezes the draw, the ticker and scheduled presentation. A pending
target choice or signing holds the screen: only Map stays available in the
navigation. **Fast-forward** (Show matches) compresses routine presentation while
keeping your team's matches live and upsets and finales visible. It uses the same
draw and match results.

### Map view

The map fills the screen next to a campaign column (500px at 1600px and wider,
360px from 1200px). For a manager, the column shows:

- **Next fixture.** Before the draw, round robin shows "<TEAM> to attack" with
  "Compass decides the target" or "You choose the target". A random draw shows
  "Next draw · Any of N empires can be drawn". Once the fixture is known, it
  shows "<A> v <B>", the route when there is no land border ("By sea — no shared
  border") and the odds bar, whose title reads "Strength 82.1 v 78.4 · from N
  simulated matches". When your team plays, the odds bar shows the **recommended
  approach** (the one with the best displayed win chance; Balanced on a tie), and
  the block's kicker names it ("Attack"; its title says Continue kicks off with
  it). **Match preview** opens the approach choice, with that option tagged
  Recommended and focused. **Simulate** reveals this match at once with the
  recommended approach, and **Continue** kicks off with it. During and
  after the match the block holds the compact match card with the score and minute.
  Between your decisions the block offers **Skip to your next match**: every
  match without your team plays at Fast-forward pace (4×, autoplay on) until
  your next tactical gate or target choice, which hands back the speed and
  autoplay you had. While it runs the block reads "Skipping · N matches played"
  with **Stop**; Pause also ends it, and a speed picked meanwhile is the one
  handed back.
- **Your fronts** — neighbouring empires with strength, territories and your
  win chance: green at 60% or more, amber at 45–59%, red below 45%.
- **Latest results** — "Germany beat Austria", the score and the claimed
  player. The ticker already lists them, so the column shows them only where
  there's room: on desktops at least 860px tall, on tablets in place of the
  fronts, and in a phone's expanded sheet unless the phone is short.
  **Chronicle** opens the full history.

A spectator's column shows **This turn** instead: attacker, "compass points
to", defender and the odds, then the live match card. It also shows
**Following**, where you change the followed team and switch on "Pause when
<team> plays", and the autoplay and speed controls.

The map carries a one-line caption (campaign title │ "Map after Round XVIII";
"Your turn │ Pick a neighbour to attack"; the spectator draw and its route), a
key, the map-mode switch and the zoom −/+/reset control. A live
ticker runs along the bottom: a LIVE label and results newest first, such as
"R XVIII  GERMANY 2  AUSTRIA 0 · AUSTRIA OUT". It is static, not a marquee.

Map modes:

| Mode | Shows |
| --- | --- |
| **Political** (default) | A flat pastel of each empire's own colour. A nation takes its own colour, a shade of it or one of its flag's, whichever keeps it apart from its neighbours: the largest nations keep theirs and smaller neighbours make room (`npm run build:nation-colours` solves the world once). A club takes its crest colour (`npm run build:club-colours`, corrected in `scripts/data/club-colours.json`) in one of three lightness steps by team id. White and black teams are grey. Your empire is clay; the next opponent turns cobalt once the fixture is known. |
| **Strength** | Five grey steps by strength percentile; your empire keeps its colour. |
| **Fronts** | Your fronts tinted by your win chance (green / amber / red); other land is neutral. |
| **Flags** | Each empire's flag across its land (see [Flags](#flags)); clubs keep their colours. |

The map mode is not saved: a reloaded campaign opens on Political. The setup
map's own Political / Flags switch does not carry into the campaign. Hovering land
shows its owner, since when it has been held and the deciding result. Clicking
land opens that team's squad.

### Claimed land

Land in a theatre that no team plays on (an American league's states without a
club, a world theatre's nations that field no team, a Europe map's countries
without a club) can be **claimed**. On the map it looks exactly like the team's
territory, in every map mode (a claimed nation flies the team's flag and sits
inside its borders), but it is never territory: it doesn't count in the
standings, can't be targeted or clicked, changes no route or neighbour, and
passes to whoever beats its holder. Land is claimed in two ways:

- **Crossing.** The empty land a match's line of attack passes over goes to the
  match's winner (a loser's land goes to the winner anyway). Blitz, chaos and the
  final series draw no line; they use the route the attacker would take to that
  opponent. A line that only grazes a corner claims nothing, and land another team
  already claimed stays that team's.
- **Landlocked.** A patch of empty land (one shape, or several neighbouring ones)
  that borders one team only, and whose edge is mostly land rather than coast or
  land outside the theatre, is that team's. In tennis, Lesotho (no team) is South
  Africa's from kick-off; Ireland, which touches only Great Britain's Northern
  Ireland but is mostly coast, stays empty. It is checked at kick-off and after every match, and
  a patch one team claimed passes to another team that landlocks it.

Hovering claimed land reads "Claimed by <team> · Not a territory". The share image
shows the champion's claims the same way. A campaign saved before claims existed
works them out when it resumes. Design notes: [claimed-land.md](docs/design/claimed-land.md).

### Match, squad and conquest screens

**Match** shows the live match. A score header holds attack and defence, the
scorers, the score and the minute ("67' · LIVE", then FULL TIME, FINAL for
basketball, or PENALTIES). Below it, a **win-probability chart** follows the
match from your side: the managed team, else the followed team, else the
attacker. It marks goals and half-time. Football uses a Poisson model of the
goals still to come, built from the match's own lineups. Basketball uses a
normal approximation of the remaining margin. **Chart | Lineups** switches to
both lineups, with claimed players tagged and ratings coloured by tier. Lineups
longer than the window (American football's 23) page together. A dark match feed lists
events newest first and has 1× / 2× / 4× speed chips and Pause. When a live
ticker match involving your team (or, as a spectator, the followed team) kicks
off while you are on Map, the game switches to Match, under Fast-forward too; the
match plays at 1×. It returns to Map at the next turn if the switch was
automatic. Fast-forward's routine matches and "simulate the result" never switch.
Without a live match, the screen shows the last finished match, or the
next fixture before the first one.

**Squad** shows one team: the flag, "First team · N players · K claimed in
conquest", the starting-lineup strength and its change, and the claimed count.
Tabs switch between **List**, **Pitch** and **Acquisitions** (phones: List,
Pitch and Bench). The list columns are Pos · Player · Rtg · Acquired, grouped by
position. A player out of position shows the in-role rating with ↓. The natural
positions and the data source are on the row's title, and the name links to the
source. The side column has a strength profile on a 60–95 scale and the squad
depth, paged to fit. The pitch marks claimed players in teal.
Basketball uses a court, Guards / Forwards / Centres and an offence/defence
profile. Squad opens from the navigation, from map land or from a Ledger row;
Back returns to where you came from.

The **conquest screen** appears after your managed team wins, and the campaign
waits for your choice. The map hatches the taken land under a "+N territories
taken" callout. Beside it, an article reads "SERBIA IS OUT", with the result
("Italy beat Serbia 2–0.") and the territory and empire effects. **Claim one
player** lists the candidates, with the best lineup fit preselected. Each one
reads "FW · 86 rating · Starts ahead of <player>" or "Adds depth · the XI is
unchanged", with the strength gain. The position lists every natural position,
so a basketball combo guard reads "PG/SG · 88 rating". A collapsible **Lineup
changes** lists the places the signing changes, before and after, or says the
lineup stays the same. **Sign <player>** confirms. If your
team is knocked out, the same article layout ("ITALY IS OUT") offers
**Continue as spectator**, which follows the team that knocked you out (change it
under Following), or **Try again**: **Same draw** replays the campaign's seed, so
the opening repeats; **New draw** keeps the team and the rules with a fresh seed;
**Another team** opens setup on Your role with the same campaign and rules and no
team chosen. The eliminated campaign stays saved until a new one is launched.
Conquests by other teams never wait: a notice on the map, the ticker and a brief
hatch flash report them.

**Ledger** shows the standings (# · Team · Terr · Strength · Conq · Claimed),
the share of the map and the fallen empires, a wall of grey flags. **Chronicle**
shows the match history, the archived match card, turning points and the
activity feed. The standings, the history and the feed show the rows that fit
and page through the rest. Below 1200px a switch shows one panel at a time:
Standings · Map share · Fallen, and Matches · Result · Story.

### Phones and tablets

Below 700px the masthead shrinks to the flag, wordmark and round over four stat
cells. The map zooms to your empire and the next opponent, with a **Whole map** /
**Your fronts** toggle. The campaign column becomes a bottom sheet with a grab
handle; tapping it expands the sheet to show your fronts and latest results (the
fronts alone on a short phone). A
full-width primary bar sits above a tab bar of **Map · Squad · Match · Ledger ·
More**. While nothing waits on a decision, the bar ends with **Auto** (a manager's
autoplay toggle; a spectator's primary already plays and pauses) and the speed
button (1× / 2× / 4×). A manager also gets **Skip** there (Skip to your next
match), in place of the round, because the sheet's own Skip button sits below
its fold whenever a match card fills it. Under 360px these keep their 44px
targets as icons and figures. **More** holds the Chronicle, the playback controls,
Settings and saves.
From 700px to 1199px a portrait tablet has the map on top and the column
content in two columns below. In landscape the map and the column, the conquest
article and the match feed sit side by side, as on a desktop. No screen scrolls
in a normal state: lists page and team fields become flag walls. On a short
phone (its browser bars showing) the extras give way first: the
[compact pass record](docs/design/compact-pass.md) lists what goes where. Touch
targets are at least 44px. Reduced motion keeps only opacity transitions.

### Finale, seeds and saves

The optional best-of-three finale starts when two teams remain. Interim games
award no territory or player; the second win resolves one conquest. A numeric
seed reproduces a campaign when settings, manager choices and simulation version
match. Updating the model can change future results for older seeds; already
generated matches in saved campaigns retain their outcome and events. A
[challenge link](#sharing-a-campaign) carries a setup and its seed to someone else.

Progress autosaves at every draw, kickoff, final whistle and result, and after
signings, preserving the seed, random state, queue, history and pending manager
choice. A match's outcome is fixed at kickoff, so the goals and kicks revealed since
are written with the next checkpoint, on pause, or when the page is hidden or
closed; a save with nothing new to write is skipped. A fast-forwarded match is
usually written once, with its result: its final score waits like the goals do,
and so does its kickoff when it follows straight on from the last saved result,
since resuming that save draws and plays the same match again. Save status reports
storage errors. Each checkpoint is kept with a recovery copy. A save is all or
nothing: when browser storage is full, a campaign may drop its own recovery copy to
fit, but never another campaign's; otherwise nothing is written and save status
says storage is full. **Saved campaigns** can delete a campaign (after a
confirmation; not the one in play) to free space. Country campaigns store their
players compactly, so a 100-club checkpoint is about 0.1 MB at kick-off and 0.3 MB
at the final. Export/import JSON provides a portable checkpoint, with download
and clipboard copy options. Entering new
campaign setup retains the previous save until a replacement is launched.
Older version-one saves migrate, but their original random stream was never
recorded, so exact continuation from that historical stream cannot be recovered.

Saves live in the browser's `localStorage` for the site, so they belong to one
browser on one device. After its first checkpoint a page asks the browser to keep
them (`navigator.storage.persist()`). Chrome grants that by engagement or
installation without asking; Firefox asks you. Without it a browser may clear the
site's storage when the disk runs low. Safari also clears it after seven days of
Safari use without a visit, unless the game runs from the Home Screen. On an
iPhone or iPad, add Imperialism to the Home Screen to keep campaigns: Home Screen
apps are exempt from the seven-day rule, and Safari 17 weighs them in granting
the request. The Home Screen app has its own storage, apart from Safari's, so
move a campaign into it with Export in Safari and Import in the app. Export any
campaign you can't afford to lose.
Checkpoints stay in `localStorage` rather than IndexedDB. Both sit in the same
storage bucket, so IndexedDB is cleared by the same eviction. Its writes are also
asynchronous, while compare-and-save across tabs, the all-or-nothing write and the
checkpoint written as the page closes all rely on a save that finishes before
the next line runs.

An error while rendering shows a **crash screen** instead of a blank page
(`src/components/ErrorBoundary.jsx`, around the App in `main.jsx`). The App's
autosaves stop with it, so the stored checkpoint is the last good one.
**Reload** returns to setup and its resume card, on the new version when one is
waiting (a plain reload would open the cached one). **Export campaign** downloads
that checkpoint exactly as stored, which Import campaign reads: the campaign this
page was playing, even when another tab has saved since (outside a campaign, the
quick-resume save). A campaign that never saved offers no export. **Report it on
GitHub** opens a new issue with the error filled in, and **Error details** shows
the message and the first stack frames.

The Chronicle's history filters by team and opens full match events and
conquest rewards. **View conquest on map** reveals the gained holdings. Final
results include the biggest upset, the decisive match, the transfer impact, the
leader changes and the elapsed time. A manager whose team fell gets a **Your
campaign** block: the placement ("25th of 49"), who knocked the team out and with
what score, what became of that team, conquests, signings, territories taken and
the biggest haul; a manager who won sees "Managed by you". The playtest timing
(active viewing, time choosing, skipped presentations, acquisitions improving the
lineup) appears only with `?playtest` in the address; exports always carry it.
The masthead trophy reopens the results after you view the map. The map has one
keyboard tab stop, arrow navigation and a skip link.

### Sharing a campaign

Sharing needs no server: a campaign travels in its link.

**Challenge links.** **Copy challenge link** copies a link to the game with a
setup in its query. It is on the last setup step, under **Challenge a friend**,
and on the final results. Opening the link fills in setup without launching it,
and a note at the top of step 1 says so. **Launch campaign** then plays the same
campaign, since a seed replays a campaign when the settings and the manager's
choices match. The setup's link names the seed that setup would launch, so a blank
seed field shares the opening seed. The results' link names the seed that was
played. Where the browser won't copy, the link shows selected for a manual copy.
Each key names a setup choice, and a key left at its default is left out:

| Key | Setup choice | Values | Left out when |
| --- | --- | --- | --- |
| `sport` | Sport | `football`, `womens-football`, `basketball`, `american-football`, `baseball`, `hockey`, `tennis`, `womens-tennis`, `rugby-league` | football |
| `teams` | Teams | `nations`, `clubs` | nations, or clubs-only (American football, an NBA season); tennis and women's tennis are nations only |
| `theatre` | Theatre | `world`, `UEFA`, `CONMEBOL`, `CAF`, `AFC`, `CONCACAF`, `elite` where the sport offers it, and `eurobasket` in basketball; for clubs a map of Europe (`domestic:eu32`; `all` and `elite` still open on them), a country (`domestic:826`), women's football's maps (`domestic:weu32`, `domestic:nwsl`; `all`, `elite` and `NWSL` still open on them), or the EuroLeague's (`domestic:euroleague`) | Europe for nations, the Top 124 for football clubs, Europe for women's football clubs, the NBA's for basketball clubs, a sport's own map (NFL, MLB, NHL) |
| `season` | Season | a built-in earlier season (`ea-fifa-18`, `nba-2k09`, `mlb-the-show-24`) | the built-in season |
| `draw` | The draw | `random`, `round-robin`, `blitz`, `chaos` | Random draw |
| `opponent` | Who picks your opponent | `player` (You choose), `compass` | Compass, and whenever launch would drop it (a spectator, a pairing draw) |
| `show` | Show matches | `ticker`, `instant`, `express` | Live |
| `upsets` | Upsets | `predictable`, `balanced`, `wild` | Balanced |
| `final` | Final | `single`, `best-of-three` | Single match |
| `signings` | Computer signings (not in tennis, where both sign the same player) | `highest-rated`, `best-fit` | Best-rated player |
| `home` | Home advantage | `off`, `on` | Off |
| `strengths` | Team strengths (basketball) | `authentic`, `competitive` | Real-world |
| `role` | Your role | `manager`, `spectator` | Spectator |
| `team` | A manager's team | a team id: `276` (Germany), `f-real-madrid`, `d826-679` | no team chosen |
| `seed` | Seed | 0 to 4294967295 | never |

For example, `https://imperialism-game.vercel.app/?sport=basketball&theatre=CAF&draw=round-robin&role=manager&team=566&seed=4242`
sets up Nigeria's basketball five against Africa under round robin.

A value this version doesn't offer stays at its default: an unknown sport, draw or
seed, a theatre or season no longer built in, a theatre the sport doesn't offer
(rugby league in Africa; with a season, setup falls back once it has loaded), a CM 01/02 season built on another
computer, a country map with an earlier season, team strengths outside basketball,
a team for a spectator. A manager's team is checked once its theatre's teams are
known, after a country map or season has loaded. If the team doesn't play there,
setup asks for one. The note on step 1 lists what the link could not use. Other
query keys (`?playtest`) are left alone, and the address stays as opened.
`src/screens/setup/challenge.js` writes and reads links (`scripts/challenge-link.test.mjs`),
and nothing in it draws from a campaign's random stream.

**Share image.** **Share image** on the final results makes a 1200×630 picture,
drawn at twice that so it stays sharp on a phone. The final map is framed as the
campaign's opening camera framed its theatre (Europe for the UEFA nations, a
country's own frame), with the champion's land in the colour the map gave it (clay
for the team you managed). A band under it holds the champion's flag or crest,
"Campaign complete · Round IX", the champion and one line of stats: "has conquered
Europe in 45 battles · 12 conquests · 9 players claimed". On a phone or tablet
whose browser can share files, the share sheet opens with the image and a line
carrying the challenge link. Elsewhere, or if sharing fails, the image downloads
as `imperialism-<champion>-<seed>.png`. Drawing starts when the results open, so
the share sheet opens straight from the tap. The image is drawn on a canvas from
the map's own paths, without flag patterns or labels (`src/viewModels/shareCard.js`,
`src/engine/shareImage.js`).

### Draw compass, flags and navigation

In one-by-one mode, the [draw compass](docs/design/duel-draw.md) selects an
attacker, slows to the chosen opponent's exact bearing, and briefly reveals the
route before kickoff. The compass and route share the same origin. Animation
and kickoff use one captured playback speed; changing speed during a draw takes
effect after that draw. Off-screen draws are brought into view, and reduced
motion replaces spinning with a short, static directional reveal.

In **Flags** mode each nation has its flag as the territory background, and
conquered land adopts its owner's banner. Countries outside the active campaign
stay neutral without flags. Clubs keep their own colours and fly their
[crest](#club-crests) on them.

Fourteen [symbol-aware flag designs](docs/design/flag-symbols.md) separate the
continuous field from their emblem. Crosses, discs and coats of arms keep their
proportions and fit on owned land instead of stretching across the region's box.
The field remains continuous across nearby islands, and camera movement cannot
relocate or repeat the emblem. Other flags and the small UI flag chips retain
their original artwork.

Scroll to zoom (up to 16×, anchored on the pointer), drag to pan, double-click or
press the zoom readout to reset; the setup screen's map card works the same way. The view is clamped to the world, so the map
cannot be lost off-screen. Borders, labels and markers hold a constant weight on
screen at every zoom level. The v4 map has no scale bar or coordinate readout.

## Squads

Football fields source-backed players; each squad row links to its rating evidence.
Game ratings use a 1–99 display range, with the original source values retained.

**Football** — `src/data/rosters.js` is the current season, 2026/27. It combines
the committed EA SPORTS FC 27 snapshot (EA's ratings site as of 1 November 2026;
17,849 men) with Football Manager 26 database 26.3.0 (released 30 March 2026,
the date shown as its rating date) from [EFEM.club](https://efem.club/players),
retrieved on 2 October 2026. FM is a season behind EA until a Football Manager
27 database is available.
All **173 nations football fields have eleven source-backed players** (1,257 EA and 646 FM
shirts), with natural coverage for a 4-4-2. The map's other three, Tonga, Samoa and the
Cook Islands, field no team, and their land stays neutral, as in women's football: EA FC 27
rates none of their players, and the FM 26 snapshot was taken before they were on the map
([Pacific islands](docs/design/pacific-islands.md)). The builder prioritises unchanged EA
overall ratings and uses FM to fill coverage gaps. It retains database IDs,
full/display names, all natural roles, source URLs, versions, dates and original
ratings through transfers and saves. An FM player fills a gap only when he is not
an EA player of the same nation. EA's ratings site gives first and last names
only, so where FM's name is longer, FM's age must also fit the EA birth date. EA
fills unlicensed clubs with generated players born on 29 February; the builder
drops any club where at least half the squad has that birthday, plus clubless
29-February players. EA's ratings site lists none, so the rule removes nothing
from EA FC 27 (it removed 316 from EA FC 26, now the 2025/26
[earlier season](#football-seasons)). EA FC 27's unlicensed Serie A clubs carry
placeholder names on EA's site (Lombardia FC is Inter, Milano FC AC Milan, Bergamo
Calcio Atalanta). The snapshot keeps each club's EA FC 26 name, so clubs keep the
same id, crest and colour from season to season. Nationalities with no map nation
(18 names, such as Cabo Verde and Malta) are listed in the audit rather than
silently dropped.

EFEM displays FM Current Ability on a normalised 1–100 scale. The game converts
it once using `round(currentAbility * 99 / 100)` and exposes both values in the
rating tooltip. It does not use potential or the site's separate EFEM Score.
EA overall and FM Current Ability remain different measures; the conversion
does not claim an official equivalence. These are **dated fantasy XIs by database
nationality**, including international retirees, rather than current call-ups.
Existing campaigns retain their saved squads; start a new campaign to use the
updated data. A campaign saved on the 2025/26 data keeps every player's name,
positions and rating, but its EA FC 26 players lose their evidence link, because
the game now holds EA FC 27's records (a checkpoint names the source editions it
referenced, and an exported file keeps its sources inline). See
`docs/design/football-roster-audit.json` for per-nation coverage.

**Football data sources and attribution.** `scripts/data/ea-fc27.csv` holds
selected columns of every man in EA SPORTS FC 27. They come from EA's public
ratings API (`drop-api.ea.com`, the data behind EA's ratings site), and
`npm run sync:ea-fc` reduces it with nations, leagues and club names spelt as in
EA FC 26. Squad rows link to each player's page on EA's ratings site as rating
evidence. EA's User Agreement allows non-commercial use only.
`src/data/rosters.js` and `src/data/clubs.football.js` are derived from it.
`scripts/data/ea-fc26.csv` is a reduced copy (selected columns only) of
[*FC 26 (FIFA 26) Player Data*](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data)
by rovnez on Kaggle, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). That dataset was
collected from [sofifa.com](https://sofifa.com), which the 2025/26 season's
squad rows link to. It is the 2025/26 season, and the reference the FC 27
snapshot takes its names from. FM ratings come from Football Manager 26 database
26.3.0 as displayed by EFEM.club.

This project is not affiliated with, endorsed or sponsored by Electronic Arts
(EA SPORTS FC, FIFA, Madden NFL, EA SPORTS NHL), Sports Interactive and SEGA (Football Manager),
2K (NBA 2K), Sony Interactive Entertainment (MLB The Show), Big Ant Studios (Rugby League 26), the NBA, the NFL, MLB, the NHL, the NRL,
or the clubs, leagues and federations it names.
All trademarks, names and ratings belong to their respective owners.

**American football** — `src/data/clubs.american-football.js`, the 32 NFL
franchises of Madden NFL 27 (Week 7 Ratings, retrieved 2026-10-30 from EA SPORTS'
ratings site; `scripts/data/madden-nfl-27.json` holds all 1,946 players). Madden's
positions are grouped into ten (its five line spots are OL, edges and tackles DL,
Sam, Mike and Will LB, both safeties S); punters and long snappers are left out.
Each franchise fields 23 starters at natural positions (QB, RB, three WR, TE, five
OL; four DL, two LB, three CB, two S; K) and keeps eleven backups. Ratings are
Madden's overalls, unchanged. Positions are specialised, so playing out of
position costs 25 points in this sport, not 12. There are no national teams: no
source rates American football players by nation. See the
[design notes](docs/design/american-football.md).

**Baseball** — `src/data/clubs.baseball.js` and `src/data/rosters.baseball.js`, from
MLB The Show 26's Live series as of roster update 26 (2 October 2026), read from the
game's public JSON API (`scripts/data/mlb-the-show-26.json` holds all 2,084 cards). The
30 MLB clubs come from their 40-man rosters; each fields the lineup the game picks (C,
1B, 2B, 3B, SS, LF, CF, RF and a designated hitter; the starter and three relievers)
and keeps the rest of an active roster of 26. Positions are The Show's primary one first,
then the others it lists; any hitter can be the designated hitter. A position outside a
player's list costs 20 points, a hitter pitching or a pitcher hitting 40. The **nations**
are every Live card (free agents included) by **birthplace**: a US state is the United
States', Curaçao and Aruba are the Kingdom of the Netherlands', as in the World Baseball
Classic. 23 nations have MLB players, from the United States (88) and the Dominican
Republic (85) down. The 12 whose players hold at least half the lineup field a team, a
place their own players cannot fill getting a generated player; every other nation's land
stays neutral. Ratings are The Show's overalls, unchanged. See the [design notes](docs/design/baseball.md).

**Ice hockey** — `src/data/clubs.hockey.js` and `src/data/rosters.hockey.js`, from
EA SPORTS NHL 27's ratings and the NHL's rosters and statistics, retrieved 2026-11-07
(`scripts/data/nhl-27.json`). **EA publishes its top 300 players only, so every other rating
is an estimate**, marked as one wherever it is shown: the players EA leaves out are ranked by
ice time and scoring and spread from 83 down to 72 (goalies 70). EA's own ratings are unchanged. The 32 clubs
field the lineup the game picks and keep up to 23; nations field the NHL's players, by EA's
nationality or else birth country, and a place they cannot fill gets a generated player. The seven
whose players hold at least half the lineup field a team; every other nation's land stays neutral. See the
[design notes](docs/design/hockey.md).

**Tennis** — `src/data/rosters.tennis.js`, from the men's Elo ratings Tennis Abstract (Jeff
Sackmann) published on 2026-11-02, with each player's country from its ATP rankings report
(`scripts/data/tennis-elo.json`, 547 players). There is no video-game list for tennis: a rating is
the player's Elo / 25 + 4, rounded (Sinner's 2297 is 96), so the match model plays Elo's own odds,
and nothing is estimated. Each nation names its five best; 52 have the two a tie needs, and the
rest stay neutral. See the [design notes](docs/design/tennis.md).

**Women's tennis** — `src/data/rosters.womens-tennis.js`, from the women's Elo ratings Tennis Abstract
published on 2026-11-02, with each player's country from its WTA rankings report
(`scripts/data/womens-tennis-elo.json`, 505 players), on the same scale (Rybakina's 2159 is 90). Nothing is
estimated: 45 nations have the two a tie needs, and the rest, Denmark and the Philippines among them with one
player each, stay neutral. See the [design notes](docs/design/womens-tennis.md).

**Rugby league** — `src/data/clubs.rugby-league.js` and `src/data/rosters.rugby-league.js`, from Big Ant's Rugby League 26
ratings of every NRL player as Zero Tackle listed them on the game's release (17 July 2025), Zero Tackle's player profiles
and NRL.com's 2025 team lists and Tests (`scripts/data/rugby-league-26.json`). Ratings are the game's overalls, unchanged;
positions are each player's most-started place in 2025, with Zero Tackle's kept as a second. The 17 clubs field their
matchday 17 and keep up to 24. Nations field the NRL's players, by their 2025 Test side, else birthplace. Eight have them,
Australia, New Zealand, Samoa, Tonga, England, Fiji, Papua New Guinea and the Cook Islands; the first six hold at least half
a matchday 17 and field a team, while Papua New Guinea's six and the Cook Islands' five fall short and their land stays
neutral. See the
[design notes](docs/design/rugby-league.md).

**Women's football** — `src/data/clubs.womens-football.js` and
`src/data/rosters.womens-football.js`, from EA SPORTS FC 27's women's players, pulled 2026-11-07
(`scripts/data/ea-fc27-women.csv`, 1,940 players). Ratings are EA's, unchanged, and nothing is
invented: 27 of the 78 nations with a rated player field a full XI. The 36 with at least six, half an
XI, field a team, short-handed below eleven; the rest, and a nation with none, field no team. See the [design notes](docs/design/womens-football.md).

**Basketball** — `src/data/rosters.basketball.js`, 47 federations, 235 players.
No public dataset carries both current basketball ratings *and* nationality: NBA
2K has real 1–99 overalls but no country, and every NBA bio dataset with a
country column stops in 2014. So the split is deliberate — nationality and
position are curated in `scripts/fiba-squads.json`, and ratings are resolved by
name from NBA 2K27 (2026/27, as [2K Archive](https://2karchive.com/) compiles it:
the page the [basketball seasons](#basketball-seasons) come from), with a curated
rating for EuroLeague players it doesn't cover. A listed NBA player who has left
the league since keeps his latest NBA 2K rating: ten of them, such as Valančiūnas
(79, NBA 2K26) and Theis (74, NBA 2K24). Curating nationality is the right call regardless: FIBA squads are not NBA
rosters (Serbia, Spain, Greece and Lithuania field mostly EuroLeague players, and
eligibility follows the federation — Banchero plays for the USA rather than
Italy). The fives were last checked against FIBA records in October 2026: every
player has played for his national team since 2023, players who had retired
from it were replaced by current internationals at the same position, and no
five fields more than the one naturalized player FIBA allows. In November 2026 the
seven nations of EuroBasket 2025 that had no five (Belgium, Cyprus, Estonia, Great
Britain, Iceland, Portugal and Sweden) got the players who started or played most
for them there, so all 24 of the **EuroBasket** theatre field real fives
([design notes](docs/design/euroleague.md#eurobasket)).

**The EuroLeague** — `src/data/clubs.euroleague.js`, its 20 clubs of 2026/27, each
with its best five. No game or dataset rates EuroLeague players, so every rating is
an estimate on NBA 2K's scale from the player's EuroLeague box scores (his PIR a
game over three seasons), marked as one wherever it is shown; the rosters and box
scores come from the EuroLeague's public API (`npm run sync:euroleague`). See the
[design notes](docs/design/euroleague.md).

Basketball positions are fluid, so most players list two neighbouring positions,
primary first: Dončić is PG/SG, Giannis PF/C, Melli PF/C. Pure point guards and
centres such as Calathes and Jokić list one, and so do players whose sources
show a single position. 150 of the 235 national players cover two positions.
Every listed position is one the player really plays, and every five has a
real player for each of the five positions. The lineup optimizer fields each
five from these positions, so Italy starts Pajola (PG/SG) at shooting guard and
Melli at centre.

Nations with no roster in a sport fall back to *that sport's* baseline, never to
another's. Getting this wrong first time ranked England third at basketball.

A team's **strength** is the mean effective rating of its best positional lineup.
An assignment optimizer fills all eleven football, five basketball, 23 American
football, 13 baseball, 19 ice hockey or 17 rugby league slots. Tennis picks its team instead: the two best in the singles, the next two
in the doubles (a team of two or three plays its singles players there too), its strength weighing each place by the
rubbers it plays. Playing outside a natural position costs 12 rating
points (25 in American football, 20 in baseball, where a hitter pitching or a pitcher
hitting costs 40 and any hitter can be the designated hitter; in ice hockey 4 between the forward places, 15
between forwards and defence and 40 in or out of goal; in rugby league 4 within the outside backs, the halves or the
pack, 8 for a common move between them, such as a centre to the second row, and 15 for any other). A player may have
more than one natural position, and each one is penalty-free: a claimed PG/SG
can start at either guard spot. Missing legacy slots
use the team's sport baseline. The same starters determine strength and appear
in match scoring and tie-break events. Squad lists separate starters from bench
and identify positional penalties; bench depth does not directly inflate strength.

Football never invents a missing player or rating: an incomplete future source
is shown as an incomplete squad. The shipped sources cover every football XI.
Basketball is curated to the 47 federations that matter, so **28% of shirts are
real** but every serious basketball nation is. Basketball gaps retain generated
players at the confederation baseline, shown dimmed and asterisked.

To rebuild after swapping datasets:

```bash
npm run build-rosters [path/to/players.csv]   # football
npm run build-basketball                     # basketball
```

Football builders default to the committed reduced source snapshots in
`scripts/data/`, so regeneration works without network access. An optional EA
CSV must also include player IDs/URLs, full names, database version/update/date,
birth dates and club/competition IDs. The original large exports remain in
ignored `data-src/`; only fields used for roster construction and evidence are
retained in the committed snapshots.

**Do not run `npm run sync:football-manager`.** It refreshes the FM supplement
through EFEM's `/api/`, which [efem.club/robots.txt](https://efem.club/robots.txt)
disallows. It must not be run until EFEM grants permission, and it refuses to
fetch without `--efem-permission-granted`.

## The club layer

A club is a combatant with the same shape as a nation — id, code, colour,
strength, lineup — so every rule already in the game applies unchanged.

The one problem clubs create is territory: twenty Premier League sides share one
homeland. So football clubs play on [a map of Europe of their own](#the-europe-maps),
where a club holds land only in its own country: alone it holds all of it, clubs
that share a country split it along its regional borders, and a country with no
club stays grey. Women's football's European clubs play [maps of Europe](#womens-football-on-the-europe-maps) of
their own on the same rule, and each NBA franchise holds its own state or province of
[the USA and Canada](#the-nba-map). Only the strongest clubs of a CM 01/02 database built on your own
computer (see [Football seasons](#football-seasons)) have no map and are still **dealt** onto the world:
working down the strength order, each club claims the nearest country to its homeland that nobody has
taken. So were women's football's until 9 November 2026; a campaign saved on the world then still
plays there.

A club's territory is painted in a generated colour rather than a flag —
identical national flags would tell you nothing — and wherever a nation shows its
flag, a club shows its [crest](#club-crests). Everything else (capital markers,
the power table, squad panels, conquest, player theft) behaves identically.

Each NFL franchise holds its own state of [the USA](#the-nfl-map), each MLB and NHL club its own of
[the USA and Canada](#the-mlb-map) ([the NHL's](#the-nhl-map)), each NRL club its own of
[Australia and New Zealand](#the-nrl-map), and each NWSL club its own of [the USA](#the-nwsl-map).

Club lineups come from the same sources as the national squads:
`clubs.football.js` from the EA FC 27 snapshot: the 124 strongest of its 309
European first-division clubs by the mean of their best XI, from Paris Saint-Germain
to Lecce (17 leagues: 20 clubs each from England and Spain, one each from Norway,
Croatia and Bulgaria), and `clubs.basketball.js` from NBA 2K27 as
2K Archive compiles it. 2K Archive lists each player's positions as 2K gives
them, primary first; a second position that is not the first's neighbour is
dropped, and 123 of the 150 NBA starters cover two positions. Each franchise's
five is then the lineup the game itself would field from its whole roster.

## Domestic campaigns

With **Clubs** and football, a dropdown under the theatres, **One country · top
clubs**, lists the countries biggest leagues first. Pick a country and its top clubs
fight over that country alone. How many depends on the league's tier
(`src/data/domesticTiers.js`): 100 for England, Spain, Germany, Italy, France,
Turkey, Brazil and Argentina; 60 for strong leagues such as Portugal, the
Netherlands and Japan; 40 for established ones such as Austria, Croatia and
Colombia; 24 for smaller leagues; 16 for the smallest nations. A country with
fewer viable sides plays with all of them (Mexico 58, the United States 81), and
every club is real. A country with fewer than ten has no map: its campaign would
be over in a few matches. The map is always
split into 100 sections, built from the country's real administrative divisions.
Each club starts on the section around its home town; with fewer than 100 clubs
it also starts on the sections around that one, a group of 100/N rounded down or
up (the stronger clubs take the extra ones where they have room), so Fiji's 16
clubs start with 6 or 7 sections each and Cambodia's ten with 10. Conquest is
unchanged: the winner annexes everything the loser holds and claims one player,
so a starting group always changes hands whole. Every section is held from
kick-off, so there is no neutral land and no transit treaty. Neighbouring
countries are drawn as muted land beneath the map. They are never territory, but
attacks go around them, by sea if need be; only an exclave (Nakhchivan, Gaza,
Kaliningrad) may have to cross one, labelled "Crossing foreign territory".
Attack routes start from a point well inside each section (the home town when it
is clear of the border), while the home marker shows the town itself. Tooltips
and conquest results use section names, such as "Lancashire (east)", where
Burnley starts.

In the v4 interface, choosing **Clubs** in setup step 1 adds the **One country ·
top clubs** dropdown below Europe's two theatres (football only). Picking a country shows a
preview card: its sections in their starting clubs' kick-off colours over the
neighbouring land, captioned with the number of sections. The sectioned map
uses the same flat style as the world map: pastel section fills, white borders
and the clay and cobalt identity colours. Neighbouring countries form an inert
land-neutral backdrop, and every home town is marked at any zoom. The title
card reads the theatre itself, such as "England · top 100 clubs", and the key
labels the marker **Home town** instead of Capital. Tooltips name the section
and read "Home of Burnley", "Held by … since Round …" or "Unclaimed". The
conquest screen and results name the sections taken. When an exclave's attack
has to cross a neighbour, the Next fixture route line reads "Through foreign
land — never claimed". In Flags mode, clubs keep their own colours and carry their crests.

Each country is one file, `public/domestic/<id>.json`, fetched only when chosen.
The setup screen shows a loading state, and Retry if the fetch fails. The setup
wizard previews the country in step 1, every section in the colour of the club
that starts there, and Launch shows that it is preparing the map. The file holds
the sections as TopoJSON with shared borders, the clubs with their starting
sections and squads, and a projection centred on the country, so distances are
true at the map's centre. The generated index `src/data/domestic.js` lists the
shipped countries. Saves record `clubScope: 'domestic:<id>'` and the map's
version. Resuming, importing or reloading a save loads the map first. The
saved-campaign dialog says so meanwhile, and closing it (or Cancel import, or
Clear quick resume) cancels the restore. A save from another build of the same
map resumes club by club: section ids follow club rank, and a club's starting
sections always share one holder, so all of its new starting sections go to
whoever held its old home section. Saves from the earlier one-section-per-club
maps move onto the 100-section maps the same way. A moved save is re-stamped
with the new version and restarts an interrupted draw. A save whose clubs differ
from the new build's, or whose holdings split a starting group, is refused, and
kept.

**Sources.** All of this is fetched at build time and committed; nothing loads
from these services at runtime.

- **Clubs and squads**: Football Manager 26 database 26.3.0 (released 30 March
  2026, the date shown as its rating date) from
  [EFEM.club](https://efem.club), in reputation order (clubs of equal reputation
  are re-read whole, since EFEM's pages shuffle them). A club is viable if it is a
  men's first team (not a reserve, B, academy or youth side of a stronger club)
  with at least eleven natural-position players, including a goalkeeper. Squads
  keep up to 16 players: a natural 4-4-2 in the game's own roles (wingers count
  as forwards) first, then the best by Current Ability, converted to the 1–99
  range as for nations. Loans are not applied: EFEM lists only a player's
  contract club. FM's placeholder names for unlicensed clubs (Portugal's "BRG")
  are replaced from `scripts/data/domestic-names.json`.
- **Home towns**: manual overrides in `scripts/data/domestic-locations.json`, then
  Wikidata (CC0), then GeoNames `cities1000` (CC BY 4.0). Each club records which
  one placed it. Some overrides are region-level (marked "approximate:"), and the
  38 clubs with no known home start at a populous place no other club holds
  (`homeSource` `placed:<geonameid>`, an estimate).
- **Boundaries**: [geoBoundaries](https://www.geoboundaries.org) gbOpen layers,
  pinned to one commit, with Natural Earth admin-1 (public domain) as a fallback;
  GeoNames places repair broken unit names and name the extra sections. Licences
  differ by country: 34 maps derive from ODbL layers and 13 from CC BY-SA ones,
  and those terms also cover the section shapes. Land the game's own world map
  gives to another country is cut out (Pakistan's side of Kashmir from India,
  Crimea from Ukraine).

`public/domestic/ATTRIBUTION.txt` is generated with every build and lists each
country's boundary source and licence, its cuts and fills, plus the GeoNames,
Wikidata and EFEM notes. 128 of the game's 176 nations ship, with 4,184 clubs (8
countries have 100, four have ten); the maps total 18.8 MB (46–250 KB each), and
a session fetches only the one chosen. 42 nations have fewer than ten viable clubs,
from Bhutan's nine to none in Sri Lanka and Cuba, so they do not ship
([the list](docs/design/domestic-campaigns.md#tiers)), and Scotland, Wales,
Northern Ireland, Tonga, Samoa and the Cook Islands have no club data yet. All of them
still play as nations where a sport fields them.

**How sections are built.** For each country the builder takes the coarsest
boundary level with at least 200 units (twice the 100 sections), or else the
finest level with at least 100, checking each layer's real unit count and
coverage, and fills land a layer misses from the next coarser one (Kuwait's
Bubiyan). England uses the UK's districts inside the England border. Units with
separate parts become one unit per part, and far overseas islands without a club
are dropped. Units are split until there are at least 100: first those holding
the most club homes, by a Voronoi diagram of those homes, then the largest. A
unit shared by clubs is also cut, one piece per club, when a club would
otherwise start far from home, and the piece holding a shared town goes to its
strongest club. In reputation order, each club claims the unit holding its home,
or the nearest free unit. The smallest territory then repeatedly takes an
adjacent free unit, as long as no other club's start is much nearer, until every
unit is claimed; islands join a club within reach. With 100 clubs each territory
is one section. With fewer, each territory is cut into its club's group: extra
sections are seeded at its towns and villages (GeoNames, mildly favouring the
populous ones), and each grows inside the territory only, so a group is always
contiguous on land. Where every club gets two or more sections (50 clubs or
fewer), territories also stop growing at about 1.5 times their fair share of
land, clubs crowded into one city start in wedges fanned out around it (Dhaka's
ten clubs), and a club still boxed in starts just outside its city, never
farther from home than one club's share of the country is wide; when a club
still ends up with too little land, the partition is redone. Each section is
dissolved, simplified and quantized. Names come from the source units, or for an
extra section from the town it was built around, repaired from GeoNames where
broken, and are unique on each map; a club pushed off its home unit names its
town, as in Everton's "Sefton (near Liverpool)". Codes are three letters, and
colours differ between neighbouring clubs' groups, also across straits. The
output is deterministic.

To refresh or rebuild:

```bash
npm run sync:domestic-clubs -- --only=826  # EFEM, Wikidata and GeoNames → scripts/data/domestic/826.json
npm run build:domestic -- --only=826       # boundaries + snapshot → public/domestic/, index, ATTRIBUTION.txt
npm run build:domestic                     # every country: 4.5–6.5 minutes, nearly all of it Canada
npm run build:domestic -- --check          # offline rebuild must match the committed files byte for byte (as long)
npm run test:domestic                      # shipped data, section geometry, seeded country campaigns (about 40 s)
```

Both stages cache downloads under the ignored `data-src/`, so reruns work offline;
from a warm cache the sync of every nation takes about 30 s. The sync is polite:
three requests at a time with pauses and retries. Leave out `--only` to process
every nation. **EFEM's `/api/`, which the sync reads, is disallowed by
[efem.club/robots.txt](https://efem.club/robots.txt)**, so without
`--efem-permission-granted` the sync uses only cached EFEM responses and stops at
any request that would reach EFEM (an uncached nation, or `--refresh`). Do not
pass the flag until EFEM grants permission. A full build or `--check` runs countries in parallel worker threads
(`--jobs=N`, up to 8 by default) and is best run in the background. Country
routing (anchors, foreign land, border routes) is tested by
`scripts/domestic-routing.test.mjs`; `npm test` runs every test file, the domestic
ones included. The [design notes](docs/design/domestic-campaigns.md) give the
sources and queries, the partition, the file format, saves, acceptance checks and
known limitations.

### The NBA map

Basketball clubs have two theatres: **NBA**, here, and [EuroLeague](#the-euroleague-map). In
the NBA the 30 franchises fight over the USA and Canada and nothing else. A franchise holds the state or province its arena
stands in (geoBoundaries) and nothing else, so Portland holds Oregon, Toronto
Ontario and Boston Massachusetts. California, Texas, Florida and New York,
which host two or more franchises, are divided between them along county lines by
the same partition as the country maps (the Nets hold Brooklyn, Queens and Long
Island). Every other state and province stays empty: drawn as land, nobody's. A
club with no land neighbour reaches its rivals over that open ground. The two
layers draw the border slightly apart, so the build fits the Canadian side to the
US line, and neighbours across it share it. Territories are named after their
cities and coloured apart from their neighbours; the franchises keep their own
names, crests and fives. Mexico, Greenland and the rest of the world lie beneath as
inert land. The map is `public/domestic/nba.json`, played through the
country-map runtime; NBA campaigns saved before it still resume on the world map.
Each [earlier season](#basketball-seasons) plays on a map of its own era, drawn
the same way from the arenas of that season: the Grizzlies hold British Columbia
until 2000/01, the SuperSonics Washington until 2007/08 and the Nets New Jersey
until 2010/11; in 1960/61 the Warriors hold Pennsylvania and the Syracuse
Nationals share New York with the Knicks. 42 era maps
(`public/domestic/nba1961.json` to `nba2014.json`) cover 1960/61 to 2013/14;
later seasons have today's franchises and play on this map.

```bash
npm run build:nba-map                      # boundaries + arenas → public/domestic/nba*.json, src/data/clubMaps.js (about 45 minutes)
npm run build:nba-map -- --check           # offline rebuild must match the committed files byte for byte
npm run build:club-maps                    # the NBA's and the NFL's maps together
```

Arenas are in `scripts/data/nba-arenas.json`; the
[design notes](docs/design/domestic-campaigns.md#the-nba-map) cover the border
fitting and the file additions. `scripts/build-club-maps.mjs` builds every
league's map (`--league=nba` or `nfl` for one; the index keeps the other's entries).

### The EuroLeague map

Basketball's other club theatre, **EuroLeague**: the EuroLeague's 20 clubs of 2026/27 on a
map of Europe built by the same rules as football's (below), from their arenas. A club alone
in its country holds all of it (Bayern Munich Germany, Žalgiris Lithuania, Dubai Basketball
the United Arab Emirates); clubs that share a country split it along its regional borders
(Spain's four, Istanbul's three, two each in Italy, France, Greece, Serbia and Israel), and a
country with no club stays grey. Its games are FIBA's forty minutes at the EuroLeague's pace and
scoring rate, with its larger home edge. The map is `public/domestic/euroleague.json`
(`node scripts/build-europe-maps.mjs --only=euroleague`), offered with the built-in season
only: an earlier basketball season has NBA clubs alone. See the
[design notes](docs/design/euroleague.md).

### The Europe maps

Football clubs have two theatres, **Top 124** and **Elite 32**: the 124 and the 32
strongest clubs of the season, on a map of Europe where a club's land lies in its
own country.

- **A country's only club holds all of it**, on the outline the world map gives it:
  Bodø/Glimt holds Norway, Dinamo Zagreb Croatia, and in the Elite 32 Paris
  Saint-Germain holds France.
- **Clubs that share a country split it along its regional borders.** A region with
  one club goes whole to it, and one with two or more is split one level down,
  between them only (Bavaria's clubs share Bavaria along its districts). A region
  with no club goes to whichever neighbour reaches it, whole unless it is larger
  than a club's share. A city-state is too small for its clubs and shares its largest
  neighbour's land too (Berlin and Brandenburg, Madrid and Castile). Where clubs
  are crowded into one city, it is cut into wedges so each has a way out, and a
  club boxed in by the others may start next door: Beşiktaş plays out of Anatolia.
- **A country with no club stays grey**: it is not on the map, only drawn beneath it
  as any country map's neighbours are. It is never territory, and attacks go around
  it, by sea if need be. The Elite 32 has no Dutch club, so the Netherlands stays grey.

Welsh clubs of the Premier League (Swansea, Cardiff, in earlier seasons) hold Wales,
not England. AS Monaco, a Ligue 1 club, holds the land around Monaco in France.

The earlier [football seasons](#football-seasons) hold the seven big leagues only, so
their maps draw on those: the strongest 124 and 32 of that season's 124–134 clubs,
one pair of maps per season. 2005/06, 2004/05, 1996/97, 1989/90 and the nine World
Cups have nations only, so no maps. Football's "One country · top clubs" campaigns are
unchanged. A world campaign saved before these maps stays on the world, and resumes
as it was; a CM 01/02 set built on your own computer has no map of Europe, so it
deals its clubs onto the world.

Each map is `public/domestic/eu<clubs>[s<season year>].json` (60 files, 150–190 KB,
fetched when chosen), with the index `src/data/europeMaps.js`. They follow the clubs, so
rebuild them after `npm run build-clubs`, `npm run build:ea-seasons`, `npm run build:retro-seasons`,
`npm run build-womens-football` or `npm run build:womens-seasons`:

```bash
npm run build:europe-maps                  # about 8 minutes; --only=eu124,eu32 builds just those
npm run build:europe-maps -- --check       # offline rebuild must match the committed files byte for byte
```

Where each club stands comes from `scripts/data/europe-clubs.json`. Boundary layers
and licences are listed in `public/domestic/ATTRIBUTION-europe.txt`, and
[the design notes](docs/design/domestic-campaigns.md#the-europe-maps) describe the build.

#### Women's football on the Europe maps

Women's football's clubs play the same way: **Europe**, every European club EA rates (68 in
2026/27, in thirteen countries), and **Elite 32**, the 32 strongest of them (in six), each on
a map of Europe where a club holds land only in its own country, by the rules above. The NWSL's
clubs play [their own map](#the-nwsl-map) instead, so European and American clubs never meet. Glasgow
City holds Scotland, Benfica Portugal, Brann Norway, Breiðablik Iceland; England's fourteen clubs share
England, seven of them London's. A club stands at the women's own ground, not the men's: Manchester
United's land is Leigh's, Chelsea's Kingston's. The earlier seasons with clubs, 2025/26 back to
2023/24, have their own pair; 2022/23 rated only the WSL and D1 Arkema, so one map of its 24 clubs.
The maps are `public/domestic/weu[32][s<season year>].json` (9 files, 140–170 KB). There are no
single-league theatres any more: a world campaign saved on one before still plays on the world
under its name, and a new setup or challenge link that names one plays Europe.

### The NFL map

American football has one theatre, **NFL**: the 32 franchises fight over the USA,
each holding the state its stadium stands in and nothing else, as on the NBA's map.
California and Florida (three franchises each), Texas, Pennsylvania, Ohio, Maryland
and New Jersey (two each) are divided between their franchises along county lines.
The Giants and Jets share MetLife Stadium in New Jersey, and the Rams and Chargers
SoFi Stadium, so those four are placed at their training grounds; and because the
Giants and Jets are New York's, New York's counties may go to them as well as to the
Bills: the Giants hold Manhattan and Long Island, the Bills western and northern New
York. Northwest Stadium stands in Maryland, but the Commanders are Washington's, so
they hold DC as well. Denver holds Colorado and Kansas City Missouri, and the 25
states without a franchise stay empty. Alaska and Hawaii lie off the map; Canada and
Mexico lie beneath as inert land. The map is `public/domestic/nfl.json` (141 KB);
stadiums are in `scripts/data/nfl-teams.json`.

```bash
npm run build:nfl-map                      # boundaries + stadiums → public/domestic/nfl.json and its index entry (seconds)
npm run build:nfl-map -- --check           # offline rebuild must match the committed files byte for byte
```

### The MLB map

Baseball clubs have one theatre, **MLB**: the 30 clubs fight over the USA and
Canada, each holding the state or province its ballpark stands in and nothing else,
as on the NBA's map. California (five clubs), New York, Illinois, Texas, Florida,
Ohio, Pennsylvania and Missouri (two each) are divided between their clubs along
county lines; Wrigley Field and Rate Field both stand in Cook County, so the map
cuts that county between the Cubs (the North Side) and the White Sox (the South
Side). The Yankees start from the Bronx and the Mets from Queens; Toronto holds
Ontario and Seattle Washington, and every state and province without a club stays
empty. The map is `public/domestic/mlb.json` (162 KB); ballparks are in
`scripts/data/mlb-teams.json`, their coordinates Wikidata's.

```bash
npm run build:mlb-map                      # boundaries + ballparks → public/domestic/mlb.json and its index entry (about 2 minutes)
npm run build:mlb-map -- --check           # offline rebuild must match the committed files byte for byte
```

### The NHL map

Ice hockey clubs have one theatre, **NHL**: the 32 clubs fight over the USA and Canada, each
holding the state or province its arena stands in and nothing else, as on the NBA's map.
California and New York (three clubs each), Florida, Pennsylvania, Ontario and Alberta (two
each) are divided between their clubs, and every state and province without a club stays empty.
A scrap of a divided state that only another state's land touches, such as Staten Island beside
New Jersey, stays with its own state's nearest club. The map is `public/domestic/nhl.json`
(157 KB); arenas are in `scripts/data/nhl-teams.json`.

```bash
npm run build:nhl-map                      # boundaries + arenas → public/domestic/nhl.json and its index entry (about 2 minutes)
npm run build:nhl-map -- --check           # offline rebuild must match the committed files byte for byte
```

### The NRL map

Rugby league clubs have one theatre, **NRL**: the 17 clubs fight over Australia and New Zealand, each holding the state,
territory or region its ground stands in and nothing else. New South Wales (ten clubs, eight of them in Sydney) and
Queensland (four) are divided between their clubs; the Storm hold Victoria, the Raiders the Australian Capital Territory
and the Warriors the Auckland Region, and every other state and region stays empty. The map is `public/domestic/nrl.json`
(134 KB); grounds are in `scripts/data/nrl-teams.json`.

```bash
npm run build:nrl-map                      # boundaries + grounds → public/domestic/nrl.json and its index entry (seconds)
npm run build:nrl-map -- --check           # offline rebuild must match the committed files byte for byte
```

### The NWSL map

Women's football's NWSL clubs have one theatre of their own, **NWSL**, beside [Europe's two](#womens-football-on-the-europe-maps):
the 16 clubs fight over the USA, each holding the state its stadium stands in and nothing else. California's three
(Bay FC, Angel City and the San Diego Wave) divide it along its counties; the Washington Spirit holds only DC, as
the NBA's Wizards do. Boston Legacy FC plays at Centreville Bank Stadium in Pawtucket, Rhode Island, until White
Stadium opens in 2028, so it holds Rhode Island and, as Boston's club, Massachusetts. Gotham FC holds New Jersey,
its stadium's. Every other state stays empty. Each earlier season with NWSL clubs (2025, 2024 and 2023, from EA FC
26, 25 and 24) has its own map, its clubs where they played then: in 2023 the Current played in Kansas City,
Kansas, so they hold Kansas. The maps are `public/domestic/nwsl[s<season year>].json` (about 135 KB each);
stadiums are in `scripts/data/nwsl-teams.json`.

```bash
npm run build:nwsl-map                     # boundaries + stadiums → public/domestic/nwsl*.json and their index entries (seconds)
npm run build:nwsl-map -- --check          # offline rebuild must match the committed files byte for byte
```

## Football seasons

Football can be played on forty-two earlier seasons as well as the built-in
2026/27: every season from 2004/05 to 2025/26, each from EA's FIFA or EA FC of
that season (FIFA 05 to EA FC 26), eleven before them, from 2002/03 back to
1989/90, from the games of their day and two fans' databases ([below](#before-200405)),
and the nine World Cups from 1962 to 1994, computed
([below](#the-world-cups-1962-to-1994-computed)). They ship with
the game: pick one under **Season** in setup. Each is a file in
`public/football/` (52–340 KB) that loads only when chosen.

- **What a season holds:** every nation's best natural XI by EA nationality,
  and the clubs of the seven biggest European leagues (132–134 clubs a season,
  of which the strongest 124 play, on [the season's own maps](#the-europe-maps);
  2005/06 and 2004/05 have nations only). Ratings are EA's overalls, unchanged.
  EA rates only part of the world, so 49–82 nations field a full XI each season (fewer in the older
  editions). A nation with at least six rated players, half an XI, fields the players it has, short-handed
  below eleven; one with fewer fields no team, and its land stays neutral. Scotland, Wales and Northern Ireland field their own
  teams; places with no shape on the map (Malta, the Faroe Islands, …) have
  none, and their players still play for their clubs.
- **Rosters:** EA FC 26 is update 4 of 19 September 2025, the snapshot the
  built-in season came from until 2026/27, so its clubs are the built-in clubs
  of 2025/26; FM no longer fills its nations, so 80 field a full XI. EA FC 25
  has EA's release ratings as its website showed them on 26 September 2024.
  FIFA 15 to EA FC 24 are each edition's launch roster. FIFA 07 to
  FIFA 11 take their ratings from the launch roster and the clubs and
  nationalities from the winter update; FIFA 12 to FIFA 14 use one roster each,
  from later in the season. FIFA 05 and FIFA 06 have the one roster their source
  lists, dated by the game's release.
- **Sources:** EA FC 26 is the committed `scripts/data/ea-fc26.csv` (rovnez on
  Kaggle, CC BY 4.0; its 316 generated players stay out). EA FC 25 joins two
  Kaggle files by EA's player id: an export of EA's ratings website
  (`nyagami/ea-sports-fc-25-database-ratings-and-stats`, Apache-2.0 as set by its
  compiler) for the overall, positions, nationality and club, and a SoFIFA scrape
  of June 2025 (`aniss7/fifa-player-data-from-sofifa-2025-06-03`, MIT) for the
  date of birth, the full name and the clubs' usual names (EA's website calls
  Inter "Lombardia FC"). FIFA 15 – EA FC 24 come from one Kaggle export
  (`stefanoleone992/ea-sports-fc-24-complete-player-dataset`, `male_players.csv`,
  labelled CC0 by its compiler). FIFA 07 – FIFA 14 join two scrapes by EA's
  player id: a FIFA Index mirror on Kaggle
  (`daguizer/fifa-2021-to-2005-complete-player-attributes`, licence "other";
  FIFA Index's terms forbid scraping) for the overall, positions, full name and
  date of birth, and a SoFIFA scrape on GitHub (`Big-Data-FC/datasets`, no
  licence stated) for the nationality and club. SoFIFA's own rating is never
  read, and a player missing from either file is left out. FIFA 05 and FIFA 06
  come from the same FIFA Index mirror; SoFIFA has neither, so they have no
  clubs, and a player's nationality is the one the same EA id has in the nearest
  later edition, else Wikidata's (`scripts/data/ea-early-nationalities.json`, CC0,
  refreshed by `npm run sync:early-nationalities`). A player with neither is
  left out. EA's own rights are
  not cleared, as for the built-in EA FC 27 data. `scripts/data/ea-seasons.json`
  pins every file by SHA-256. To rebuild, download them into the ignored
  `data-src/` (the manifest names each folder) and run:

  ```bash
  npm run build:ea-seasons
  ```

  It writes the season files, their listing `src/data/footballSeasons.js` and
  `docs/design/football-seasons-audit.json`, and every file rebuilds byte for
  byte.

### Before 2004/05

EA has no source here before FIFA 05 (the FIFA Index mirror starts there), so
eleven earlier seasons come from Sports Interactive's Championship Manager, from
Sensible World of Soccer and from two fans' Championship Manager databases, one
source each:

| Season | Source | Nations with a full XI | Clubs |
| --- | --- | --- | --- |
| 2002/03 | SI's Championship Manager 01/02, 3.9.68 | 108 | 129 |
| 2001/02 | SI's Championship Manager 01/02, 3.9.60 | 96 | 130 |
| 2000/01 | SI's Championship Manager 00/01, 3.81 | 82 | 130 |
| 1999/00 | SI's Championship Manager 99/00, 3.70 | 74 | 130 |
| 1998/99 | SI's Championship Manager 3, ported to CM 01/02 | 64 | 130 |
| 1997/98 | SI's Championship Manager 97/98 | 52 | 124 |
| 1996/97 | Sensible World of Soccer 96/97, its national squads | 133 | nations only |
| 1995/96 | Sensible World of Soccer 95/96, the game's own team files | 132 | 134 |
| 1994/95 | Sensible World of Soccer (the original, 1994), the game's own team files | 131 | 134 |
| 1993/94 | Cam F's 93/94 for CM 01/02, fan-made | 77 | 130 |
| 1989/90 | Simon Treanor's 89/90 for CM 01/02, fan-made (Beta 5) | 88 | nations only |

1993/94 and 1989/90 are rated by fans, not by a game's makers, and say so in the
Season choice. 1989/90 plays the federations of its day: the Soviet Union,
Yugoslavia and Czechoslovakia field their republics' players, West Germany plays
as West Germany, and a German at an East German club plays for no nation.

- **Ratings:** CM's current ability (1–200) becomes `round(ca * 99 / 200)`, as
  for a local CM database (below); CM 97/98 rates the same players about five
  game points above CM3. SWOS rates no overall: a player's price step (0–49, an
  outfield player's seven skills summed, a keeper's price alone) becomes
  `round(40 + value * 59 / 49)`, from an empty shirt's 40 to 99. The raw values
  stay with each player.
- **Clubs:** the seven biggest leagues' top divisions, on the season's own
  [Europe maps](#the-europe-maps).
- **Credits and rights:** Championship Manager is Sports Interactive's; Eidos
  made CM 01/02 free to download in December 2008 for personal, non-commercial
  use, the data's rights reserved. 3.9.60 and 3.9.68 are SI's own files as
  nckstwrt's CM0102 Starter Kit ships them; CM 00/01 (3.81) and CM 99/00 (3.70),
  never made free, are SI's own files too, read from users' uploads of the retail
  CDs to archive.org; CM3's data was ported to CM 01/02 by
  Gio and released by Cam F on champman0102.co.uk; CM 97/98's database is as
  baskeyx extracted it. SWOS 96/97 is Sensible Software's (now Codemasters'),
  from Whiteulver's database and xflea's spreadsheet as keyser1884's SWOS-MCP
  holds them; SWOS 94/95 and 95/96 are the game's own team files as the SWOS
  United server keeps them. The fan-made 1993/94 is Cam F's ("Season 93/94 For
  0102") and 1989/90 Simon Treanor's ("Championship Manager 1989/90 update for CM
  01/02", cm8990.wordpress.com), both as the CM0102 Starter Kit ships them. None
  of them grants redistribution: each season's source block names its maker, who
  compiled it, where it comes from and when it was read.
  `scripts/data/retro-seasons.json` pins every file by SHA-256. To rebuild:

  ```bash
  npm run sync:retro-cds        # CM 00/01's and CM 99/00's tables, read by byte range from their CD images
  npm run build:retro-seasons   # the eleven season files, the listing and the audit (--check compares byte for byte)
  ```
- **Missing:** 2003/04: SI's own CM 03/04 database is in a format no one has
  documented, and that season's CM 01/02 database is a fan's update.

Other Championship Manager 01/02 databases, the CM 01/02 Update Team's for
2001/02 to 2025/26, can be built on your own computer: their authors have not
allowed redistribution, so those seasons stay **local**. Download a database
from [champman0102.co.uk](https://www.champman0102.co.uk) (a free forum account
is needed) into the ignored `data-src/cm0102/<folder>/`, then run:

```bash
npm run build:football-set -- --cm0102=data-src/cm0102/<folder>
```

The builder writes the season to `public/football/` (those files are ignored),
where setup lists it beside the built-in ones. It also takes a database it does
not know, once you name its season and date shift (`--label`, `--released`,
`--url`, `--dob-shift`). The
[permission requests](docs/design/football-year-permissions.md) ask the authors
whether those files may be committed, and the
[sources note](docs/design/football-year-sources.md) compares every other source
considered, back to 1872, and their terms.

- **What the CM 01/02 builder does:**
  - It identifies the database from its file sizes (53 known: 48 releases, the
    CM3 port, two fan databases, CM 99/00 and CM 00/01, each with its season,
    author, forum topic and date shifts) and refuses seasons ending before 1962
    (`FIRST_YEAR`).
  - It reads the binary files with the game's own parser (`src/data/cm0102.js`,
    format in [cm0102-format.md](docs/design/cm0102-format.md)).
  - Every one of the 176 nations gets an entry, and clubs come from the seven
    leagues the club layer already uses. Tonga, Samoa and the Cook Islands are
    left out when the database rates none of their players: a season without them
    fields no team of theirs, as in every built-in EA season (none rates one).
  - Ratings are CM's current ability (1–200) converted once with
    `round(ca * 99 / 200)`. Natural positions are the slots rated 20.
  - It never invents a player or a rating. It stops on an unmapped nation unless
    `--allow-unmapped` is given, and then leaves those players out.
- **Federations by year:** a nation plays only once its association was a FIFA
  member by the end of the season. Montenegro is held by Serbia until 2006, New
  Caledonia by France until 2003 and South Sudan by Sudan until 2011. Kosovo is
  Serbia's until June 1999 (1996/97 and 1997/98), then stays neutral until 2015,
  as Timor-Leste does until 2005. Bosnia and Herzegovina plays from 1996/97,
  Eritrea and Palestine from 1997/98, Mongolia from 1998/99 and Bhutan from
  2000/01. The table goes back to 1961/62: a season of then plays the federations
  of its day under their own names and flags (the Soviet Union on Russia's shape,
  holding the other republics, to 1990/91; the CIS in 1991/92; Yugoslavia to
  1990/91; FR Yugoslavia in 1994/95 and 1995/96; Czechoslovakia to 1992/93; West
  Germany to 1989/90; Zaire from 1971/72), leaves suspended associations out (South
  Africa, FR Yugoslavia, China PR) and fields no East Germany, which has no shape.
- **Saves are self-contained:** players are packed as compact EA or CM tuples,
  so a season campaign resumes or imports without its season file.

### The World Cups, 1962 to 1994 (computed)

No game rates the players of most nations before 1994 in a form the game can
read, so nine seasons, 1961/62 to 1993/94, are **computed** and say so in the
Season list ("1969/70 · computed"; in 1993/94 and 1989/90, beside the fan
databases, "1993/94 · Computed · 1994 World Cup"): each World Cup's finalists,
nations only, 15 to 24 of them.

- **Ratings:** a nation's strength comes from its Elo the day after the final,
  `T = 87 − 3.2 × (best Elo − its Elo) / 100`, with the Elo computed from every
  international result to that day (martj42's results, CC0) by eloratings.net's
  formula. Its eleven are the players of its World Cup squad with the most
  minutes in each role (1 GK, 4 DF, 4 MF, 2 FW; a role short of players who
  played takes the most-used left, out of position), ordered by Ballon d'Or
  votes, World Cup awards, goals a minute and minutes, and rated T plus today's
  spread of an XI, so the team's Elo sets most of each rating. Squads, minutes,
  goals and awards come from the Fjelstul World Cup Database, the 1962 and 1966
  line-ups and the Ballon d'Or votes from Wikipedia (all CC BY-SA 4.0, credited
  in `public/football/ATTRIBUTION-world-cup.txt`, which licenses the season
  files the same way).
- **Federations of the day:** the Soviet Union, Yugoslavia, Czechoslovakia, West
  Germany and Zaire play under their own names and flags, holding their members'
  land where they are finalists. East Germany has no shape and fields no team.
- **Theatres:** the world, Europe, and South America where it had four
  finalists; never the Elite 32.
- **Rebuild:** `npm run sync:world-cup-seasons` reads the pinned sources in
  `data-src/` into the committed facts; `npm run build:world-cup-seasons` turns
  them into the season files, offline, and `--check` compares byte for byte.

The [design notes](docs/design/football-years.md) give the file format, the
runtime, the saves and the known limits.

## Basketball seasons

Basketball can be played on 66 earlier seasons as well as the built-in 2026/27:
every season from 1999/00 to 2025/26, each from that season's NBA 2K (NBA 2K to
NBA 2K26), three before them from other games (below: 1998/99 from NBA Live 99,
1991/92 and 1983/84 from NBA 2K27's MyNBA Eras), and the 36 others back to
1960/61, which no game rated, computed from Basketball-Reference's statistics
(below). Pick
one under **Season** in setup; it plays NBA clubs only, so it switches Teams to
clubs. Each season is a file in `public/basketball/` (3 to 12 KB) that loads
only when chosen, with the map of its era.

- **What a season holds:** the franchises of that season, each with the best
  five its players' positions allow. Ratings are 2K's overalls, unchanged.
  Franchises that have moved since keep their name and city of the time: the
  Vancouver Grizzlies, Seattle SuperSonics, New Jersey Nets, Charlotte Bobcats
  and the New Orleans (and, for 2005/06 and 2006/07, Oklahoma City) Hornets.
- **Before NBA 2K:** 1983/84 and 1991/92 are NBA 2K27's MyNBA Eras ('Magic vs
  Bird' and 'Jordan'), as 2kratings.com lists them: 2K's opening-night rosters,
  with 2K's overalls. A player stays only if Basketball-Reference has him
  playing for that club that season (checked against Sumitro Datta's CC0 copy of
  its totals), so 2K's made-up bench players are left out; eight 1991/92 players
  2K lists by an initial are named from evidence (Magic Johnson, on the Lakers'
  opening-night roster before he retired on 7 November 1991). 2K lists no
  player it has no licence for, so some fives are weaker than the real club's
  (the 1991/92 76ers without Charles Barkley, the Pacers without Reggie Miller).
  1998/99 is EA's NBA Live 99, from its own roster files (the NLSC's original
  1998 rosters): the lockout season, so the 1997/98 rosters with the trades of
  May and June 1998. Its overalls run low (28–71), so one line puts them on NBA
  2K's scale, `round(20.22 + 1.089 * raw)`, fitted on the 296 players NBA 2K
  rates in 1999/00 (3.95 points out on average).
- **Computed seasons:** 1960/61 to 1982/83, 1984/85 to 1990/91 and 1992/93 to
  1997/98, labelled 'Basketball-Reference (computed)'. One score per player
  season from Basketball-Reference's statistics in Sumitro Datta's copy on
  Kaggle, whose CC0 label is the compiler's: PER, WS/48 and DWS are
  Basketball-Reference's own figures, under Sports-Reference's data-use terms
  ([Rights and terms](docs/design/football-year-sources.md#rights-and-terms)).
  The score weighs PER and WS/48 shrunk by minutes, minutes, points, rebounds and
  assists a game, All-Star and All-NBA picks and defensive win shares, its
  weights fitted by least squares to NBA 2K's overalls of 1999/00 to 2025/26;
  each club's 13 players with the most minutes are ranked by it and given NBA
  2K27's ratings rank for rank. A player traded during a season plays for the
  club he played the most minutes for. Rated this way, 1983/84 and 1991/92 match
  NBA 2K27's own ratings of them at a rank correlation of 0.95 and 0.94 (about 2
  points out). Specialists rate low (Dennis Rodman does not start for the
  1995/96 Bulls), and the engine plays every season with today's rules at that
  season's pace.
- **What is missing:** any national team (NBA 2K rates NBA players only), and
  any season before 1960/61 (no BAA or ABA).
- **Source:** [2K Archive](https://2karchive.com/), a fan compilation of every
  edition's ratings that names no licence (2K's own rights are not cleared).
  2011/12 comes from [The Real 2K Insider](https://thereal2kinsider.blogspot.com/2011/09/official-nba-2k12-ratings-released.html)'s
  transcription of 2K's NBA 2K12 launch ratings, since 2K Archive's 2K12 table
  lacks two teams; the build pins that page too (`data-src/bball-2k12/`).
  The built-in season, NBA 2K27, comes from the same page.
  `scripts/data/nba-seasons.json` pins one saved copy of its page by SHA-256
  and lists each season's franchises and the arenas of those that moved. To rebuild, save the page as
  `data-src/bball-2karchive/home.html` (ignored) and run:

  ```bash
  npm run build:nba-seasons
  ```

  It writes the season files, their listing `src/data/basketballSeasons.js` and
  `docs/design/basketball-seasons-audit.json`; `npm run build:nba-map` then
  draws the era maps. The computed seasons need the CC0 copy's tables in
  `data-src/research-gaps/basketball/kaggle-sumitrodatta-v57/` (ignored, pinned
  by SHA-256 in the manifest's `computed`).
- **Saves** hold every player as played, so a season campaign resumes without
  its season file. It still needs its era's map, as any NBA campaign does.

The [design notes](docs/design/football-years.md#earlier-basketball-seasons)
give the file format, the era maps and the known limits.

## American football seasons

American football can be played on 76 earlier seasons as well as the built-in
2026: every NFL season from 1960 to 2025, and the AFL's ten seasons before the
1970 merger. 2001 to 2025 come from that season's Madden (Madden NFL 2002 to
Madden NFL 26) as it launched, 1990 and 1992 to 1995 from Tecmo Super Bowl,
and the rest (1960 to 1989, 1991 and 1996 to 2000, and the AFL's) are computed
from what the players did (below). Pick one under **Season** in setup; it
plays the clubs of that season on the map of their day. Each season is a
file in `public/american-football/` (about 30 KB) that loads only when chosen.

- **What a season holds:** every club of that season (from 13 in 1960 to 32
  since 2002; the AFL's 8 to 10), each with the lineup the game picks from its
  whole roster and its best backups, by the built-in season's rules. Madden's
  overalls are used unchanged (Madden NFL 2002 on); every other overall is ours,
  as each season's source block says (and the computed ones' label).
- **Clubs of their day:** the St. Louis Rams until 2015, the San Diego Chargers
  until 2016, the Oakland Raiders until 2019, Washington (named by its city until
  2019) and the Washington Football Team in 2020 and 2021, no Texans in 2001, the
  Saints in Baton Rouge in 2005: each on an era map (`nfl2001` … `nfl2022`; 2024
  and 2025 play on today's `nfl`). A stadium move starts a new map.
- **Sources:** each launch roster from a copy made at the time, because EA has
  since edited its live launch lists: maddenratings.net's per-team spreadsheets
  (2001-2020, 2022, 2023), Madden 22's launch workbook (GitHub `kellerdevin`),
  and EA's site as copied in GitHub `theedgepredictor` (2024, 2025). Where EA's own
  lists survive (Madden 16, 17, 22, 23, 24, 26) they agree player for player.
  2011 is Madden 12's pre-lockout default roster. Placeholder names ("C.#25") are
  left out. All are fan compilations of EA's ratings; EA's rights are not cleared.
  `scripts/data/nfl-seasons.json` pins every file by SHA-256. To rebuild:

  ```bash
  npm run sync:madden-seasons   # the snapshots in scripts/data/madden-seasons/, from the pinned files in data-src/
  npm run build:nfl-seasons     # the season files, src/data/americanFootballSeasons.js and the audit (--check compares byte for byte)
  npm run build:nfl-map         # today's map and the era maps
  ```
- **Tecmo Super Bowl, 1990 and 1992–1995:** the NES game (1990), the SNES one
  (1993), Tecmo Super Bowl II (1992 and 1994, its first and third seasons) and
  III (1995, 30 clubs with the Panthers and Jaguars), read from BAD-AL/tsbtools'
  roster dumps (`npm run sync:tecmo` writes `scripts/data/tecmo/`, `--check`)
  and checked against Tecmo Geek, a GameFAQs transcription and the NFTGL's Book
  of Armaments. Tecmo rates attributes, never a player, so **the overall is
  ours**: a position score by Tecmo Geek's or the NFTGL's weights, ranked within
  the season and read off Madden NFL 2002's overalls at that position, which
  each season's source states. Names come from nflverse's rosters (CC BY 4.0);
  the games' unlicensed stars ("QB BILLS") are named only where nflverse leaves
  no doubt, so the 1990 Bills and Browns start without Jim Kelly and Bernie
  Kosar. The games' 3-4 and one-back lineups leave documented places short
  (every 1990 club a lineman and a corner, every 1993 club a lineman), filled
  out of position as the game always does; nobody is added. Clubs of the day:
  the Phoenix Cardinals, Los Angeles Raiders and Rams, Houston Oilers and the
  first Cleveland Browns, and in 1995 the Panthers at Clemson (holding South
  Carolina) and the St. Louis Rams, on the maps `nfl1990` … `nfl1995`.
- **Computed seasons (1960 to 1989, 1991, 1996 to 2000, and the AFL 1960 to
  1969):** no game's ratings are used, so **the overall is ours**, from Pro
  Football Archives' facts (profootballarchives.com: who played where, games and
  starts, the season's box-score totals): each club's points against the
  league's shared out by starts and production, ranked at each position and
  read off Madden NFL 2002 (labelled "computed"). It is a hindsight rating: it
  follows each season's results more closely than a game's pre-season ratings
  do. 1987 counts the clubs' own players, not the strike games' replacements.
  Each AFL season is ranked within the AFL and plays on a map of its own
  (`afl1960` … `afl1969`); the NFL's seasons before 2001 play on era maps from
  `nfl1960`, with the clubs of their day (the St. Louis Cardinals, Baltimore
  Colts, Boston Patriots, Dallas Texans and New York Titans, the Giants at the
  Yale Bowl holding Connecticut in 1973–74). 1998 to 2000's pages were saved
  apart (`npm run fetch:pfa -- --years=1998-2000 --into=pfa-1998-2000`, into
  `data-src/pfa-1998-2000/`), which the sync reads beside `data-src/pfa/`.
  To rebuild:
  `npm run fetch:pfa` (polite, resumable), `npm run sync:pfa`, then
  `npm run build:nfl-seasons`, `npm run build:nfl-map` and
  `node scripts/build-club-maps.mjs --league=afl`.
- **What is missing:** anything before 1960. Madden NFL 97 and 98 are not used
  (their ratings check poorly, so 1996 and 1997 are computed), nor is NFL Draft
  Buzz's copy of Madden NFL 97 to 2001, because its site refuses automated
  clients (so 1998 to 2000 are computed too), nor are the fan-made Tecmo Super
  Bowl ROM hacks.

## Baseball seasons

Baseball can be played on 66 earlier seasons as well as the built-in 2026:
2018 to 2025, each from that year's MLB The Show (18 to 25) at its last roster
update: 2021 to 2025 read from the game's own public API, 2018 to 2020 from the
fan site ShowZone's copies of Sony's cards; and 1960 to 2017, which no game rated,
computed from the players' WAR (below). Pick one under
**Season** in setup. A baseball season keeps both layers: **Nations** field that
year's players by birthplace, and **Clubs** play that year's MLB on the map of
their day. Each season is a file in `public/baseball/` (17–35 KB) that loads
only when chosen.

- **What a season holds:** every nation with MLB players born there and the
  season's clubs (30 since 1998, 16 in 1960), each club's lineup and active roster of
  26, by the same rules as the built-in season (a club of the computed seasons that
  used fewer than 13 pitchers all season keeps every one it used, so 23 to 25). The
  MLB The Show seasons' ratings are The Show's overalls, unchanged.
- **Clubs of their day:** the Cleveland Indians until 2021, the Oakland Athletics
  until 2024 (the Athletics play in West Sacramento from 2025), the Blue Jays in
  Buffalo in 2020, the Rangers at Globe Life Park until 2019 and the Rays at
  Steinbrenner Field in Tampa in 2025, each on its era's map (`mlb2018`, `mlb2019`,
  `mlb2020`, `mlb2021`, `mlb2022` for 2022–24, `mlb2025`; 2026 plays on today's
  `mlb`).
- **2018 to 2020:** Sony's mlb18 to mlb20 APIs are gone; ShowZone keeps each
  edition's final Live cards, read once through its data API and pinned. ShowZone's
  MLB 21 equals Sony's own snapshot card for card (the import stops otherwise), and
  Sony's archived pages of the last roster updates agree. ShowZone states "All
  Rights Reserved" and gives no terms; its site's robots.txt disallows `/api`, its
  data host has no rules. MLB The Show 18 has no secondary positions and no
  birthplaces: birthplaces come from MLB 19–21 by name, else MLB's Stats API.
- **1960 to 2017 are computed** (listed "Computed from WAR, end of <year>"): ShowZone
  keeps no game's ratings before 2018, and no dataset of every player's ratings for
  those years turned up. Each player's WAR (Neil Paine's JEFFBAGWELL file, the average
  of Baseball-Reference's and FanGraphs' WAR) per playing time over the season and the
  two before it is put rank for rank, within hitters, starters and relievers, on MLB
  The Show 18 to 24's scale; tested on 2018–2024, it misses the Show by about 4.4
  points a player. Names, birthplaces and each club's main ballpark are the Chadwick
  Baseball Bureau's Baseball Databank's (`e9f247e` of November 2023, the latest commit
  its forks hold, read from the fork `infonuum/baseballdatabank`, as the Bureau's own
  repository is gone), with one birthplace corrected from Wikipedia (Elmer Valo's).
  The clubs of their day (the Milwaukee Braves, the Senators, the Expos…) play on 37
  era maps, `mlb1960` to `mlb2017`
  ([design notes](docs/design/baseball.md#seasons-before-2018-computed-from-war)).
  Nothing before 1960.
- **Licence of the computed seasons:** JEFFBAGWELL is MIT; the Baseball Databank is
  CC BY-SA 3.0 (share-alike), so the season files and their snapshots are shared
  under it. `public/baseball/ATTRIBUTION.txt` credits both, repeats the MIT notice,
  the Databank's licence statement and Retrosheet's notice (the Databank's home games
  come from Retrosheet's game logs), and names Baseball-Reference and FanGraphs as the
  WAR's origin.
- **A source error:** MLB The Show 24's API gives the wrong country for players
  born outside the United States (Juan Soto "At Sea", Ronald Acuña Jr. "Slovenia").
  The build takes each such player's birthplace from the nearest sound edition
  and lists every one in `docs/design/baseball-seasons-audit.json`.
- **Source:** the snapshots `scripts/data/mlb-the-show-<nn>.json` (committed),
  each refreshed by `npm run sync:mlb-the-show -- --edition=<nn>` (add
  `--parallel=3` for the older hosts, which take 15–25 s a page). To rebuild:

  ```bash
  npm run import:mlb-showzone   # 2018–2020's snapshots, from the pinned ShowZone cache in data-src/showzone/ (--check)
  npm run sync:mlb-birthplaces  # MLB 18's missing birthplaces from MLB's Stats API, pinned in scripts/data/mlb-birthplaces.json
  npm run import:mlb-war      # 1960–2017's snapshots, from the pinned WAR and Baseball Databank files in data-src/mlb-war/ (--check)
  npm run build:mlb-seasons   # the season files, src/data/baseballSeasons.js and the audits (--check compares byte for byte)
  npm run build:mlb-map       # today's map and the era maps from scripts/data/mlb-seasons.json and mlb-war-seasons.json
  ```
- **Saves** hold every player as played, so a season campaign resumes without
  its season file; a club campaign still needs its era's map.

## Ice hockey seasons

Ice hockey can be played on every NHL season from 1966/67 to 2025/26 but the
cancelled 2004/05, as well as the built-in 2026/27. Five are one EA edition's
ratings of an NHL season: 2021/22 (NHL 22), 2006/07 (NHL 07), 1994/95 (NHL 95),
1993/94 (NHL '94) and 1992/93 (NHLPA '93); 2007/08 and 2008/09 are NHL 08's and
NHL 09's attributes, the overall converted; the other 52 are computed from the
players' statistics, the Hockey Databank's to 2009/10 and MoneyPuck.com's after
([design notes](docs/design/hockey.md#computed-seasons)).
Pick one under **Season** in setup; it plays its nations, by birth country or
by nationality as its source gives them (the seasons before 1977/78 have clubs
only), or its clubs on the map of their day (the Hartford Whalers, Quebec
Nordiques, Minnesota North Stars and the first Winnipeg Jets among them). Each
season is a file in `public/hockey/` that loads only when chosen.

- **Nothing is estimated:** unlike the built-in season, a player the edition
  does not rate is not there, and a club it leaves short fields what it has
  (Anaheim and Florida in 1993/94, Ottawa and Tampa Bay in 1992/93, eight clubs
  in 2021/22). In the seasons from EA's editions each club is the edition's
  roster at release; in a computed season a player plays for the club he played
  most games for.
- **Credits:** setup shows a season's credit as small text under the Season
  choice, whole: the Hockey Databank's statement, as its terms ask, on every
  season that takes anything from it (the 37 computed from it, NHL 08 and NHL
  09, and the MoneyPuck seasons whose birth countries it fills), and "Data:
  MoneyPuck.com" on the 15 computed from MoneyPuck's data, which MoneyPuck allows
  for non-commercial use only. `public/hockey/ATTRIBUTION.txt` lists the sources
  and their terms ([design notes](docs/design/hockey.md#credits)).
- **Sources:** NHL 22 from NHLRatings.net's team pages as CommonCrawl kept them
  (EA's own launch lists agree on all 60 players they rate); NHL 07 from IGN's
  pages of EA's ratings (Wayback Machine); NHL 95 from Jon Morris's sheet
  (nhl-95.com), the Rangers from Segathon's list; NHL '94 from KinGraph's sheet
  of the cartridge and NHLPA '93 from the cartridge's attributes
  (forum.nhl94.com). Positions and birth countries come from the NHL's own
  season rosters. EA's rights are not cleared.
  `scripts/data/nhl-seasons-sources.json` pins every download by SHA-256. To
  rebuild:

  ```bash
  npm run sync:nhl-seasons    # the snapshots in scripts/data/nhl-seasons/ (--fetch downloads a missing source; --check)
  npm run build:nhl-seasons   # the season files, src/data/hockeySeasons.js and the audit (--check compares byte for byte)
  npm run build:nhl-map       # today's map and the era maps
  ```
- **The classic games' overall:** NHL '94 computes one from its 0–6 attributes
  by the game's own rule (as wboy reverse-engineered it); NHLPA '93 shows none,
  so NHL '94's weights are applied to the values it displays. These overalls run
  far wider than NHL 27's (1–99, median about 54), which made the 1990s seasons
  absurdly one-sided (the best club winning 71 of 82, a top scorer of 180
  goals), so NHLPA '93, NHL '94 and NHL 95 play **rescaled onto NHL 27's
  ratings**: each overall takes the NHL 27 rating at its rank, so every player
  keeps his place in the order (Gretzky's 87 in NHL '94 plays as 94, the median
  as 82). The games' own overalls stay in the snapshots and the audit, and each
  season's source states the rule
  ([design notes](docs/design/hockey.md#earlier-seasons)).
- **Missing:** EA's own ratings of the other seasons: no complete copy could be
  checked (NHL 24 and NHL 26 were tried and left out), so those seasons are
  converted or computed.

## Tennis seasons

Tennis can be played on 66 earlier seasons as well as the built-in 2026: the end
of every year from 1960 to 2025, the ATP's men by Elo (before 1968 the amateurs),
the Davis Cup's nations only. Pick one under **Season** in setup. Each season is a
file in `public/tennis/` (13–56 KB) that loads only when chosen.

- **2016 to 2025** are Tennis Abstract's own year-end Elo reports, as the Wayback
  Machine kept them. 2016 and 2017 are on its older, higher scale.
- **1973 to 2015** are Elo computed from Jeff Sackmann's complete ATP match results
  by Tennis Abstract's published method (its season label says "Elo from match
  results"; 1973 to 1979 are marked rough while the ratings settle). Run on 2016
  and 2017 with the method of that time, the same engine reproduces Tennis
  Abstract's lists (r 0.999 and 0.997); on 2019–2025 it runs about 30 Elo higher
  throughout, which moves no match's odds.
- **1960 to 1972** are a second run of the same method, warmed up on Sackmann's
  file of the amateur era (the majors and the Davis Cup, 1877–1967), with its
  duplicate player ids merged: 1960 to 1967 are the amateurs alone ("Amateur Elo"),
  the professionals back from 1968, all marked rough. They share about seven of
  Lance Tingay's year-end ten each season, Laver is first in 1968–1970 as in Tennis
  Abstract's own Elo, and the run meets the shipped seasons from 1973 within a few
  points ([design notes](docs/design/tennis.md#before-1973)).
- **Ratings** are Elo / 25 + 4 as in the built-in season; a season whose best would
  pass 99 (Borg in 1980) is shifted down as a whole, which keeps every match's
  odds. The raw Elo stays with each player.
- **Nations of the day:** a player plays for the nation he played the Davis Cup for
  that year (Lendl for Czechoslovakia in 1985). Czechoslovakia holds Slovakia's land
  through 1992, the Soviet Union the republics' through 1991 (Russia shown), and
  Yugoslavia its six through 1991; West Germany plays as Germany. South Africa
  (1970–1972 and 1979–1992) and FR Yugoslavia (1993–1995), barred from the Davis
  Cup, field no team; the Soviet Union plays from 1962, its first cup.
- **Licence:** Tennis Abstract's ratings and Jeff Sackmann's match data are
  CC BY-NC-SA 4.0 (attribution, non-commercial, share-alike), as for the built-in
  season: `public/tennis/ATTRIBUTION.txt` credits them. `scripts/data/tennis-seasons.json`
  pins the 108 archive files (the GitHub fork Kadantte/tennis_atp at 712be0c, the
  amateur file among them) and the 19 captures by SHA-256. To rebuild:

  ```bash
  npm run sync:tennis-seasons    # the year-end lists in scripts/data/tennis-seasons/, from the pinned archive (--check)
  npm run build:tennis-seasons   # the season files, src/data/tennisSeasons.js and the audit (--check compares byte for byte)
  ```

## Women's tennis seasons

Women's tennis can be played on 58 earlier seasons as well as the built-in 2026: the
end of every year from 1968 to 2025, the WTA's women by Elo, the Fed Cup's nations
only. Pick one under **Season** in setup. Each season is a file in
`public/womens-tennis/` (11–53 KB) that loads only when chosen. They are built as the
men's are, by the same scripts with `--tour=wta`
([design notes](docs/design/womens-tennis.md#earlier-seasons)).

- **2016 to 2025** are Tennis Abstract's own year-end WTA Elo reports, as the Wayback
  Machine kept them. No capture holds the last 2020 update, so that list stops a week
  before the season's end, and says so.
- **1968 to 2015** are Elo computed from Jeff Sackmann's WTA match results by Tennis
  Abstract's published method, counting what its report counts: tour-level matches with
  the Fed Cup, tour-level qualifying, WTA 125s and ITF events of $50K or more (none
  before 1994, when the files start naming an event's prize). A newcomer's start at
  tour level is fitted on the career peaks of Tennis Abstract's Tennis 128 (1330, the
  men's 1450). On 2022–2025 the computed lists agree with Tennis Abstract's to within
  five points; 1968 to 1979 are marked rough (the files start in 1968, so 1968 and
  1969 are the roughest; 1968–1972 share about eight of Lance Tingay's year-end ten).
- **Ratings** are Elo / 25 + 4; a season whose best would pass 99 (Navratilova in 1985,
  Graf in 1989) is shifted down as a whole. The raw Elo stays with each player.
- **Nations of the day:** a player plays for the nation she played the Fed Cup for
  that year (Mandlikova for Czechoslovakia in 1985), with the men's federations and
  their land. South Africa (1978–1991) and FR Yugoslavia (1993–1994), barred from the
  Fed Cup, field no team. Navratilova plays for the United States from 1976, after her
  defection, and Mandlikova for Australia from 1988. Monica Seles, Yugoslav until 1994,
  is Yugoslavia's only rated player in 1991 and 1992, so she sits those seasons out, as
  every nation of one does.
- **Licence:** as the men's: `public/womens-tennis/ATTRIBUTION.txt` credits Jeff
  Sackmann / Tennis Abstract (CC BY-NC-SA 4.0). `scripts/data/womens-tennis-seasons.json`
  pins the 117 archive files (Aneeshers/tennis-sackmann-archive at 8373358) and the
  20 captures by SHA-256. To rebuild:

  ```bash
  npm run sync:womens-tennis-seasons    # the year-end lists in scripts/data/womens-tennis-seasons/ (--check)
  npm run build:womens-tennis-seasons   # the season files, src/data/womensTennisSeasons.js and the audit (--check)
  ```

## Women's football seasons

Women's football can be played on eleven earlier seasons as well as the built-in
2026/27: every season from 2015/16 to 2025/26, each from that season's EA game
(FIFA 16 to EA FC 26), the first of which was the first to rate women. Pick one
under **Season** in setup. Each season is a file in `public/womens-football/`
(15–150 KB) that loads only when chosen.

- **What a season holds:** every nation with a rated player, each with its best
  XI (one with at least six rated players plays, short-handed below eleven; one with
  fewer fields no team and its land stays neutral), and from 2022/23 every club EA rates, the European ones
  on that season's [maps of Europe](#womens-football-on-the-europe-maps), the NWSL's on
  [its own](#the-nwsl-map). Ratings are EA's
  overalls, unchanged. A club keeps its id, crest and colour from season to
  season under the name EA gave it that year (Olympique Lyonnais in 2024/25).
- **National teams only before 2022/23:** EA rated 12 to 17 women's national
  teams a year from FIFA 16 to FIFA 22 and no club, so those campaigns are
  small, and Clubs goes back to the built-in season.
- **Sources:** FIFA 16 to EA FC 24 from the women's table of the same Kaggle
  export as the men's seasons (each edition's launch roster); EA FC 25 from an
  export of EA's ratings website at release (Kaggle `nyagami`); EA FC 26 from
  EA's ratings API, which serves the previous edition to a request without the
  ratings site's referrer, with every club named as a copy taken during the season
  names it (Kaggle `flynn28`). FIFA 19 and FIFA 16 take the first roster after
  release (update 3): FIFA 19's launch roster in the export still carried FIFA 18's ratings. `scripts/data/ea-women-seasons.json`
  pins each download by SHA-256; the reduced snapshots are committed. To rebuild:

  ```bash
  npm run sync:womens-seasons   # the snapshots, from the pinned downloads in data-src/ and EA's API
  npm run build:womens-seasons  # the season files, src/data/womensFootballSeasons.js and the audit (--check compares byte for byte)
  ```

## Rugby league seasons

Rugby league can be played on seventeen earlier seasons as well as the built-in
2025: 2008, from Rugby League 2: World Cup Edition's own database (Sidhe, 2008),
extracted by Wouldubeinta and kept by the Wayback Machine's copy of
rugbyleaguemods.net, and 2009 to 2024, which no game rated, computed from
NRL.com's match centre (below). Pick one under **Season** in setup; it plays the
NRL clubs of that season, clubs only, on the map of their day: the sixteen of
2008 to 2022 (no Dolphins; the Bulldogs under their 2008 name in 2008 and 2009),
the seventeen of 2023 and 2024. Each season is a file in `public/rugby-league/`
(14–16 KB) that loads only when chosen.

- **2008's players:** every one is checked against the Rugby League Project's 2008
  records, so 414 of the database's 462 NRL players are kept and the game's
  padding is left out, each with its reason in the audit.
- **2008's overall is ours**, in two documented steps, because the game rates
  twelve attributes from 1 to 10 and no player: a position-weighted score of
  the attributes (defaults left out, kicking only for the halves) is read off
  Rugby League 26's ratings at that position by percentile; then every player
  of a club moves by one whole number so the club lands where the game's own
  team rating (the mean of its five parts) puts it among the built-in 2025
  clubs' strengths. Real 2008 results only check the outcome: the clubs' order
  follows 2008's only loosely (rank correlation 0.33 in simulated seasons), as
  the game rated some sides well above their year (the Cowboys and Bulldogs
  won 5 games each).
- **2009 to 2024 are computed** (labelled "Computed from NRL.com match stats"):
  NRL.com's match centre keeps every game's team lists and player stats. A
  player's value is NRL Fantasy's points for eleven of those stats (tries, try
  assists, line breaks, tackles, metres and the rest; goals count nowhere) per
  club game, the season before at half weight; his overall is that value's
  percentile at the position he started at most, read off Rugby League 26's
  ratings there, as 2008's score is. Then every player of a club moves by one
  whole number so the club lands where its Simple Rating System, fitted to the
  season's real margins and adjusted for its opponents, ranks it among the
  built-in 2025 clubs' strengths: 2008's shift, with the season's own results in
  place of the game's team rating, so a season's strongest clubs are its best by
  margin. A player NRL.com never shows starting takes his position from the
  seasons either side, else from the Rugby League Project. Run on 2025, the
  method agrees with Rugby League 26 at a rank correlation of 0.76 within
  position.
- **Maps:** each club grows from its ground, or from its training base where it
  shares one, and three rules keep the maps few: a ground being rebuilt stays its
  club's (R1), COVID-19 relocations are ignored (R2), and a rename on the same
  site does not split a map (R3). 2008 and 2009 play on `nrl2008`, 2010 and 2011
  on `nrl2010`, 2012 to 2019 on `nrl2012`, 2020 to 2022 on `nrl2020`, and 2023
  and 2024, with the Dolphins, on today's `nrl`.
- **No nations:** 2008's World Cup squads mix Super League players rated on a
  more generous scale, and the computed seasons rate club games only, so a
  nations game plays the built-in season's.
- **Source:** the database, the Rugby League Project's pages and NRL.com's draws
  and games are pinned by SHA-256 (a page or a reply by the part read) in
  `scripts/data/rugby-league-seasons-sources.json`. To rebuild:

  ```bash
  npm run sync:rugby-league-seasons -- --fetch   # missing inputs into data-src/ (the database, RLP pages, NRL.com's games), then scripts/data/rugby-league-seasons/nrl-<year>.json (--check)
  npm run build:rugby-league-seasons             # the season files, their listing and the audit (--check; --realism plays them)
  npm run build:nrl-map                          # today's map and the era maps nrl2008, nrl2010, nrl2012 and nrl2020
  ```

The [design notes](docs/design/rugby-league.md#earlier-seasons) give the
weights and their reasons, the club shift, the
[computed seasons](docs/design/rugby-league.md#computed-seasons-20092024) and the
known limits.

## Squad economics

Beating a team claims one player. Strength (`EFF`) is the best-lineup rating, so
it only ever climbs; a claimed player who does not make the lineup adds depth
but no strength. The squad screen and the masthead show it against its
kick-off value. The Ledger standings
always rank teams by live overall strength (EFF), highest first, and show strength
gain since the campaign began. Equal strengths are ordered alphabetically;
territory count is informational and never changes the rank order.
Positive campaign gains appear as a green `+N` beside Strength (one decimal);
an unchanged strength reads a muted `±0.0`.
The latest match result also shows the winner's before/after strength and the
gain from that conquest alone. A transfer that does not improve the rating says
`No change`; territory itself adds no artificial strength bonus. Cumulative
gains remain available after resuming a saved campaign.

## Flags

In **Flags** mode, territory is filled with its **owner's** flag, so an empire
reads as one banner spreading across the map — conquered land switches to the
conqueror's colours the moment it is annexed. Political mode, the default,
communicates the same ownership with flat pastel fills. Flags also identify
national teams in the masthead, match results, standings, squads and the
victory screen.

Each **geographic region of an empire** shares one banner. Neighboring
conquered countries and nearby islands sample the same flag continuously:
Corsica, Sardinia and Sicily do not each restart a miniature Swiss cross when
Switzerland owns France and Italy. Regions connect through coast-to-coast gaps
of at most 180 projected kilometers, using the map's fixed distance scale.
Only land with the same owner can join; the flag remains clipped to land.
Distant possessions such as Greenland or French Guiana receive separate flags,
so they cannot stretch European stripes or emblems out of sight. This is a
visual grouping only, not a change to conquest adjacency. Multipart countries
are drawn as separate flag parts beneath a single clickable outline, preserving holes and
country selection. Bounds update after conquest, not on zoom or pan. Only land
reveals the flag; seas and neutral countries stay untouched. A solid rectangle
in the nation's colour is the fallback. Non-participants remain unflagged in
continental campaigns. A club's land keeps its club colour with its crest placed
on it, below.

Each banner is drawn once and shown through the outline of each land part, and
its SVG artwork comes from a bitmap: the first time Flags mode shows a flag, its
SVG is rasterised in the background at 1024 px on the longer side. Wherever a
banner is drawn larger than that, it keeps the SVG, so flags stay sharp at any
zoom. Drawn as SVG `<pattern>` fills, every flag's shapes were re-rendered on
each repaint, and panning, zooming, hovering and the draw compass lagged in
Flags mode.

Drawing an SVG holds the page's own thread, so the rasteriser keeps out of the
way. It draws only flags a banner on the map still shows, the largest first,
and stops when you leave Flags mode; unfinished flags resume when Flags is
shown again. No flag is parsed or drawn within 200 ms of a click, key press,
wheel turn or drag, and only at background priority. Finished bitmaps reach the
map in batches, one re-render for many flags. Bitmaps are lossless WebP in
Chrome and Firefox (Chrome encodes WebP on a worker thread, but PNG on the
page's own thread) and PNG in Safari, which has no WebP encoder: the same pixels
either way.

Run `npm run test:flag-regions` for coastal grouping and island-display
regressions, and `npm run test:territories` for the underlying exact landmass,
overseas, winding, date-line and geometry-cache regressions.

`src/data/flags.js` maps ISO-3166 numeric ids to flag basenames, derived from the
Natural Earth attribute table with football-specific overrides: the home nations
England (`gb-eng`, on the United Kingdom's id), Scotland (`gb-sct`), Wales
(`gb-wls`) and Northern Ireland (`gb-nir`), and Kosovo (`xk`), which has no ISO
numeric code. Great Britain, the United Kingdom's team in the sports that play it
as one, flies the Union Jack (`gb`) under a flag id of its own, `GBR`. The SVGs are vendored into `public/flags/` from the MIT-licensed
[`flag-icons`](https://github.com/lipis/flag-icons) package, so the built app has
no runtime dependency on it. Football's federations of the day fly flags flag-icons
does not have, under flag ids of their own (`URS`, `CIS`, `YUG`, `FRY`, `ZAI`):
public-domain Wikimedia Commons SVGs, pinned in `scripts/data/historic-flags.json`
and redrawn on the same 4:3 canvas by `npm run build:historic-flags`.

### Club crests

A club with a crest shows it wherever a nation shows its flag: the masthead,
popups, standings, fronts, the turn strip, match and squad screens, setup and the
victory screen. In **Flags** mode its land keeps the club colour and carries the
crest, placed like a flag's emblem: one undistorted crest per region, fitted on
owned land at up to about 30% of it. Land too small for one stays plain. The
crest stands in for the club's code there: a club whose crest is on the map has
no code printed over its land, while a club whose crest fits nowhere keeps its
code. A club without a crest keeps its monogram chip and its code on the map.

The crests come from Wikipedia. `npm run sync:club-logos` finds each club's
Wikidata item, takes the lead image of its English Wikipedia article (the infobox
crest, else the item's logo image on Wikimedia Commons), and saves it as a WebP
fitting 128×128 in `public/club-logos/<club id>.webp`. Domestic clubs reuse the
item their home town came from. An all-leagues club shares its domestic twin's
file: the club of its country whose FM26 squad shares at least four players with
its EA lineup, the most of any. The all-leagues clubs are the built-in ones and
those of the earlier seasons no older than the FM26 squads (EA FC 26), so a club
relegated since 2025/26 keeps its crest there. NBA and NFL franchises are matched
by name. Overrides go in `scripts/data/club-logos.json`: `items` maps a club id
to a Wikidata item, `files` maps it to a file name, or to `null` for no crest,
and `twins` names a domestic twin the lineups miss (Venezia, promoted for 2026/27,
shares only three players with its 2025/26 squad). Responses and
images are cached in the ignored `data-src/club-logos/`, so reruns are offline;
`--refresh` asks Wikidata and Wikipedia again.

Crests are the clubs' trademarks, and most are non-free files that Wikipedia
hosts under its non-free content policy. `public/club-logos/SOURCES.tsv` records
each club's file, its licence as Wikipedia records it, and its file page.
`src/data/clubLogos.js` lists which clubs have a crest, so the game never
requests a missing file.

## Capitals

Rule targeting starts at each nation's **capital city**. Candidate routes are
ranked capital-to-capital, but the arrow stops just inside the first target
territory it reaches. It cannot cross a third country's land to reach that
capital. Expanded empires can attack from another holding when their nearest
capital pair is blocked. If every direct route is blocked, the fallback rules
below apply. Display labels use a separate
ownership-aware interior-fit algorithm; their positions never affect targeting.

## Empire names

Names span the current empire rather than staying attached to one original
country. The label engine combines owned land across internal borders, separates
disconnected landmasses, and searches for a safe interior text area. It tests
horizontal and shape-aligned angles, measures the real text (Archivo Narrow,
uppercase, .14em tracking), and gives the name a gentle upward arch rising 5% of
its width. The padded footprint includes the curve and halo.
Cramped inland names can use a softer arch before being omitted.
Coastlines, foreign enclaves, holes and sea gaps are checked against the rendered
vector geometry.

Names grow with usable territory up to 30px at 1600px wide and above, 22px from
1200px, 20px from 700px and 18px on phones. They are hidden below 9px, except
your own empire's name, which can shrink to 6.5px.
On-land fits are preferred. When necessary, a name may extend a little over water:
at most 10 screen pixels from owned land, with no more than 22% of its padded
envelope at sea. Its anchor stays on owned land, and foreign or neutral countries
remain forbidden. Names that still cannot fit wait for more zoom.
Geographic candidates and recent placements are
cached to avoid jitter or repeated geometry work during match playback. Separate
colonies cannot pull a mainland label into the ocean. Flags and map interactions
are unchanged.

See `docs/design/empire-labels.md` for the algorithm and its tradeoffs. Run
`npm run test:labels` for independent geometry regressions and `npm run smoke`
for real-app integration coverage.

## Capital data and dependencies

`src/data/capitals.js` holds lon/lat for all 176. Coastline generalisation at
110m in the rule geometry leaves some real capitals fractionally offshore, so a
capital that misses its own outline is walked toward the country's centre until
it lands; 171 of 176
anchor on the city itself and the rest fall back to the centroid rather than
stranding a marker at sea (Apia, just off Upolu's generalised coast, is one).

Overseas territory is declared in `DEPENDENCIES` in `src/data/teams.js`. It
fields no team of its own, flies its parent's flag, and is annexed and lost with
its parent — Greenland goes with Denmark.

## Targeting rule

A nation may only attack a land neighbour, or strike across the sea at the
**nearest** enemy in the spun direction — it can never leapfrog a closer one.
Land borders come from the TopoJSON itself: two countries that share a topology
arc share a border, so adjacency stays correct as empires absorb territory.
In one-by-one draws, every candidate route is also tested against the visible
country shapes. Intervening rival or neutral land blocks the route, even when
its capital falls outside the search cone. The selector tries another route or
opponent, widening the cone only among unobstructed candidates. If the selected
attacker has no legal straight-line route, a checked coastal sea polyline tries
to connect its holdings to an enemy. If neutral enclosure prevents that route,
an explicitly labelled **neutral transit treaty** permits crossing neutral land
without annexing it (the match's winner [claims](#claimed-land) it, which changes
no rule). The displayed polyline follows the checked route. A draw
retries an unreachable attacker without consuming extra random samples. These
exceptions keep disconnected final opponents playable. Blitz and chaos use the
batch pairing rules described above.

## Map geometry

The map uses a flat equirectangular projection with a 30° standard parallel:
longitude and latitude form a straight rectangular grid, with no polar taper
or raised coastline shadow. Flags, curved names, capitals and attack routes
share this coordinate plane. The scale label is an approximate equatorial
reference, not a uniform real-world distance at every latitude.

The display uses `public/countries-50m.json` from `world-atlas` 2.0.2 for more
detailed coastlines. Its ISC licence is included in
`public/WORLD_ATLAS_LICENSE.txt`. The original `public/world-110m.v1.json` still
drives rule geography, adjacency, capital anchors, and candidate distances.
The detailed display shapes also validate duel routes, so an arrow cannot pass
through a visible country merely because its capital lies elsewhere.

Football nations are not political ones: England, Scotland, Wales and Northern
Ireland each have their own association and team. Both atlases draw one United
Kingdom (826), so `npm run build:home-nations` (`scripts/build-home-nations.mjs`)
cuts it along Natural Earth 1:10m's borders between them (public domain): 826 is
England, and `SCO`, `WAL` and `NIR` are the others. Past the shore each border
follows an estuary's middle (Solway Firth, Dee, Severn) to wherever the coarser
coast leaves the island. Every other shape and arc stays world-atlas's, pinned by
SHA-256; `--check` rebuilds offline and compares. Saves from before the cut (v1–v4)
give the new shapes to whoever held 826, CM 01/02 data sets built before it let
England hold them, and basketball, baseball, ice hockey and both tennis games, where Great
Britain is one team, play the United Kingdom as one. There its team keeps the id 826 and
plays as Great Britain (GBR) under the Union Jack (`playsAs` in each sport,
`GREAT_BRITAIN` in `src/data/teams.js`), while the land keeps its names: the
shape 826 is still England in a tooltip or a list of conquered land. A campaign
saved before this keeps the England it was saved with.

The 110m atlas also leaves out Tonga (776), Samoa (882) and the Cook Islands (184),
which field national teams; the 50m atlas draws all three. The same build copies
each of their rings from the 50m atlas onto the 110m grid, as arcs of their own
after every other shape, so the rules map holds the outline the map draws: Tonga's
Tongatapu, ʻEua and Vavaʻu, Samoa's Upolu and Savaiʻi, and Rarotonga, the only one
of the Cook Islands at 1:50m and the smallest shape on the map (58 km²). They border
nobody, so they are reached by sea. A campaign saved before them has no owner for
them: they load as neutral land, as nations outside a theatre are, and nothing is
migrated. See [Pacific islands](docs/design/pacific-islands.md) for which sports
field them and what that changes.

Closed coastline rings are clipped at ±180° longitude before projection, so
date-line crossings cannot create diagonal closure wedges through Russia or
Pacific islands. New seam edges follow the projected meridian, and the same
rounded rings drive the visible outline, flag clipping and label containment.
Source-ring targeting/anchor metadata is retained separately from repaired
display rings, and is reprojected with the map. Geographic capital anchors and
saved ownership, squads and results are unchanged. Projected-distance ordering
(including new club allocations and future draws) can differ from the former
projection; the first-visible-foreign-land targeting rule remains enforced.
Run `npm run test:geography` for straight-grid/inverse-projection, source-atlas
coastline and date-line regressions.

## Advertising

The game can show AdSense banner ads, and shows none until a build names a
publisher (placeholders can be previewed sooner, below). `src/ads.js` loads
Google's script and reads the switches below;
`src/components/AdSlot.jsx` is the only ad unit. There are no full-screen ad
breaks.

Banners sit only in space the game leaves empty, each under a muted
"Advertisements" kicker (AdSense allows only that label or "Sponsored Links"):

- **Setup:** a 200×200 square at the foot of the step rail, at least 40px below
  the last step and far from the footer's buttons. It shows only where the rail
  is wide enough for it (1600px wide and up) and the window is at least 740px
  tall.
- **Ledger:** a 300×250 unit in the side column, after Share of the map.
- **Chronicle:** a 300×250 unit in the side column, after Turning points and
  above the activity feed.

The game shows at most one banner at a time. Each unit holds its size from the
first paint, so nothing moves when the ad arrives, and asks for an ad only once
it is on screen. It disappears when Google has no ad for it, when the script is
blocked, and (the 300×250 units) on phones narrower than 336px. The map, match,
conquest and squad screens never show a banner. Google asks for at least 150px
between an ad and a game, and on those screens the game is the whole screen.
The Squad side column is also full.

The switches are read at build time, from the environment or a Vite env file
such as `.env.production.local` (ignored by git):

```bash
VITE_ADSENSE_CLIENT=ca-pub-1234567890123456 # your publisher id: turns ads on
VITE_ADSENSE_SLOT=1234567890                # a display ad unit, created as Responsive
VITE_ADSENSE_TEST=on                        # mark requests as tests (also loads ads on a dev server)
```

All three banners share the one ad unit. Create it as a display ad with
**Responsive** size; the game sets each banner's exact size inline on the unit,
as Google's exact-size example does, without its `data-ad-format` line.
`npm run build` checks both ids and writes `dist/ads.txt`. AdSense reads that
file only at the root of the domain, so a game served from a subfolder needs a
copy there. The test bundles have no Vite env, so the tests never load ads.

To see where the banners go before there are any ads, add `?ads=preview` to the
game's address, for example `https://imperialism-game.vercel.app/?ads=preview`.
Every build supports it, with or without a publisher: each banner shows as a
dashed "Ad space" box of its exact size, and nothing is asked of Google.
Players who open the plain address see no banners. `npm run dev` shows the
same placeholders whenever a publisher and a slot are set, unless
`VITE_ADSENSE_TEST=on`. An ad blocker may hide the placeholders too.

In the AdSense account, keep Auto ads off for the site: they would add an anchor
banner over the phone tab bar and drop units into the campaign column. Publish a
European regulations message under Privacy & messaging for visitors in the EEA,
the UK and Switzerland. It runs through the AdSense script the game already
loads, and it needs the URL of a privacy policy that mentions the saves kept in
the browser and the ad cookies. Ads make the game commercial, and much of its
data is licensed for personal or non-commercial use only: see
[Rights and terms](docs/design/football-year-sources.md#rights-and-terms).
Hosting is affected too: Vercel's free Hobby plan allows only non-commercial use
and counts AdSense as commercial, so ads need a paid plan or another host.

## Layout

```
src/
  App.jsx              campaign state, flow, view router, primary action, render;
                       one-line delegates to src/app/
  app/                 App method bodies by area, called as fn.apply(this, args)
    mapMethods.jsx     map fills, flags, labels, tooltip, reach and conquest framing
    columnMethods.jsx  campaign column, map caption and key, ticker
    matchMethods.jsx   live match presentation, minute clock, match card
    squadMethods.jsx   squad view
    conquestMethods.jsx  result, signing gate, conquest screen, elimination
    turnMethods.jsx    turn order, target choice, turn strip, spectator panel
    ledgerMethods.jsx  standings, Ledger, Chronicle, victory, match preview
    shared.js          constants shared by App and the method modules
  viewModels/          pure build*(state, ctx) functions: masthead, campaign,
                       map, match, squad, conquest, turns, ledger, odds, format
  screens/             presentational v4 screens, one folder per area
    campaign/          Next fixture, Your fronts, Latest results, ticker, map overlays
    match/             score header, win-probability chart, XI tables, match feed
    squad/             squad table, pitch/court, strength profile, acquisitions
    conquest/          conquest article and map callout
    turns/             turn strip, Choose a target panel and card, spectator panel
    ledger/            Ledger and Chronicle screens, standings, history
    setup/             setup wizard model (steps, rules of war, summaries)
  styles/
    tokens.css         v4 colour, type and layout tokens (incl. --map-veil)
    primitives.css     shared buttons, kickers, tables, panels
    shell.css          app shell per view and breakpoint, phone chrome
  config.js            simulation tunables (drama, upset threshold, labels), save version
  ads.js               AdSense script and banner settings (off by default)
  theme.js             design tokens for JS (v4 colours, map values, rating tiers)
  sports/              per-sport lineup, match model and vocabulary
    football.js        4-4-2, 90 minutes, penalty shootouts
    basketball.js      starting five, 40 minutes (FIBA: nations, EuroLeague clubs) or 48 (NBA clubs), overtime
    americanFootball.js  23 starters, 60 minutes of possessions, playoff overtime
    baseball.js        nine batters, a starter and three relievers, nine innings, walk-offs, extra innings
    index.js           the registry, and each sport's clock and tie-break copy (clockLabel, overtimeText)
  data/teams.js        176 nations: identity, squad building
  data/rosters.js      GENERATED football squads (npm run build-rosters)
  data/rosters.basketball.js  GENERATED FIBA fives (npm run build-basketball)
  data/clubs.football.js      GENERATED club XIs (npm run build-clubs)
  data/clubs.basketball.js    GENERATED NBA fives (npm run build-clubs)
  data/clubs.euroleague.js    GENERATED EuroLeague fives, every rating an estimate (npm run build:euroleague)
  data/clubs.american-football.js  GENERATED NFL lineups and backups (npm run build-nfl)
  data/clubs.baseball.js      GENERATED MLB lineups and active rosters (npm run build-mlb)
  data/baseballSeasons.js     GENERATED listing of the earlier baseball seasons (npm run build:mlb-seasons)
  data/rosters.baseball.js    GENERATED baseball nations by birthplace (npm run build-mlb)
  data/sourceTable.js  compact player rows of the generated football files: one
                       JSON line per nation or club, metadata keys and shared
                       values written once (scripts/lib/data-module.mjs writes them)
  data/scopes.js       theatre choices: the nation theatres a sport offers (only where it
                       is played) and the club ones (per league, all, elite)
  data/domestic.js     GENERATED index of shipped country maps (npm run build:domestic)
  data/clubMaps.js     GENERATED index of a sport's own club maps: the NBA's, today's and its eras', and the NFL's (npm run build:club-maps)
  data/domesticScope.js  labels for 'domestic:<id>' theatres, and a sport's own map
  data/domesticTiers.js  each nation's club cap and the setup lists' priority order
  data/cm0102.js       CM 01/02 database reader (pure; Node and browser)
  data/cmPlayers.js    CM player tuples, positions and rating conversion
  data/eaPlayers.js    EA player tuples of the built-in earlier seasons
  data/footballSeasons.js  GENERATED listing of the earlier seasons (npm run build:ea-seasons)
  data/basketballSeasons.js  GENERATED listing of the earlier basketball seasons (npm run build:nba-seasons)
  data/footballSetBuild.js  CM 01/02 data set builder (pure; Node and browser)
  data/cm0102Releases.js, cm0102Nations.js, footballFederations.js  its manifests:
                       known releases, CM nation names, federations by year
  data/footballSquad.js  eleven-player squad pick shared by the football builders
  data/sha256.js       synchronous SHA-256 for the data set builder
  data/flags.js        nation id -> flag asset
  data/capitals.js     capital city coordinates
  hooks/               map zoom and pan viewport; useFit (lists that page, team walls that fit)
  engine/
    geo.js             TopoJSON decode, land adjacency, projection, SVG paths
    random.js          sampling shared by every sport
    campaign.js        territory ownership, targeting, round draws
    duelDraw.js        one-by-one draw: attacker, compass bearing, route
    turns.js           round-robin queue, "in reach" targets, launch rules
    winProbability.js  live win-probability model (each sport's)
    liveMinute.js      live match minute store (outside saved state)
    domestic.js        loads and validates a country map: sections and club rows
    footballSets.js    lists, loads and validates earlier seasons of both sports; season-bound sport
    storage.js         autosave, save slots and versions
  components/          masthead (CommandBar), playback, phone chrome, map, setup
                       wizard, match card, dialogs and overlays, crash screen
                       (ErrorBoundary), the ad slot, the pager
public/
  world-110m.v1.json   Natural Earth 110m topology for campaign rules
  countries-50m.json   world-atlas 2.0.2 topology for display
  WORLD_ATLAS_LICENSE.txt  ISC licence for world-atlas
  domestic/            one sectioned map per country, the NBA's (nba.json, nba2000.json …), the NFL's (nfl.json) and the EuroLeague's (euroleague.json), fetched on demand
  football/            the built-in earlier football seasons (ea-*.json, cm*.json, swos-9697.json, swos-9596.json, swos-9495.json, wc-*.json), fetched when chosen
  womens-football/     the built-in earlier women's football seasons (eaw-*.json), fetched when chosen
  basketball/          the built-in earlier basketball seasons (nba-2k*.json, nba-eras-*.json, nba-live-99.json, nba-stats-*.json), fetched when chosen
  american-football/   the built-in earlier NFL and AFL seasons (madden-*.json, tecmo-*.json, pfa-*.json, pfa-afl-*.json), fetched when chosen
  baseball/            the built-in earlier baseball seasons (mlb-the-show-*.json, mlb-war-*.json), fetched when chosen
  hockey/              the built-in earlier ice hockey seasons (nhl-*.json), fetched when chosen
  tennis/              the built-in earlier tennis seasons (tennis-*.json), fetched when chosen
  womens-tennis/       the built-in earlier women's tennis seasons (wta-*.json), fetched when chosen
  rugby-league/        the built-in earlier rugby league seasons (nrl-2008.json to nrl-2024.json), fetched when chosen
  fonts/               self-hosted Archivo and Archivo Narrow (Alegreya unused)
  textures/            former cartographic paper texture (unused since v4)
  flags/               176 vendored flag SVGs
  club-logos/          club crests from Wikipedia, with SOURCES.tsv
  favicon.svg          site icon (npm run build:icons renders favicon.ico and apple-touch-icon.png)
  og-image.png         1200×630 link-preview card
  robots.txt           allows every crawler
scripts/
  test.mjs             runs every scripts/*.test.mjs (npm test)
  lib/app-harness.mjs  shared App/component harness for the jsdom tests
  lib/data-module.mjs  writes the compact generated football data modules
  data/seed-replay.golden.json  determinism golden for seeded campaigns
  smoke.mjs            headless campaign test (jsdom)
  sync-flags.mjs       vendors flag SVGs from flag-icons
  build-historic-flags.mjs  redraws the federations of the day's public-domain flags
  sync-world-cup-seasons.mjs, build-world-cup-seasons.mjs  the computed World Cup seasons: sources → facts → seasons
  build-rosters.mjs    builds football squads from an EA FC export
  build-basketball.mjs builds FIBA fives from NBA 2K + fiba-squads.json
  build-clubs.mjs      builds the club layer for both sports
  sync-domestic-clubs.mjs  snapshots each country's clubs, squads and home towns
  build-domestic.mjs   builds the country maps, index and ATTRIBUTION.txt
  build-club-maps.mjs  builds the NBA's maps of the USA and Canada (today's and each era's), the NFL's of the USA and MLB's of the USA and Canada
  sync-madden.mjs      snapshots Madden NFL ratings from EA's ratings site
  build-nfl.mjs        builds the NFL clubs from that snapshot
  sync-mlb-the-show.mjs  snapshots MLB The Show's Live cards from its public API
  build-mlb.mjs        builds the MLB clubs and the baseball nations from that snapshot
  build-mlb-seasons.mjs  builds the earlier baseball seasons from their snapshots (lib/mlb.mjs holds the shared rules)
  build-nba-seasons.mjs  builds the earlier basketball seasons from the pinned 2K Archive page
  sync-euroleague.mjs  snapshots the EuroLeague's rosters and box scores from its public API
  build-euroleague.mjs builds the EuroLeague's clubs, estimating every rating (scripts/lib/euroleague.mjs)
  sync-club-logos.mjs  vendors club crests from Wikipedia
  build-ea-seasons.mjs  builds the earlier football seasons from the pinned EA export
  build-football-set.mjs  builds a local football season from a CM 01/02 database
  build-icons.mjs      renders the site icons from public/favicon.svg
.github/workflows/ci.yml  tests, build and smoke on every push; Vercel waits for it before going live
vercel.json            cache headers for the deployed site
```

### Tuning

`src/config.js`:

- `matchDrama` (0–12) — default match-day variance in rating points. Campaign
  uncertainty presets use 0, 6 and 12; higher values widen performance variation.
  Scoring and tie-break randomness remains at zero variance.
- `upsetThreshold` (2–15) — rating gap at which a win is flagged as an upset.
- `showLabels` — draw empire names (club codes for clubs) over their largest held
  shape; labels are spaced to remain readable at the current zoom. In Flags mode a
  club whose crest is on the map shows the crest instead of its code.

## Verification

`npm run smoke` boots the real component tree under jsdom and plays **twenty-two full
campaigns** across all three pacings, both resolution modes, all nine sports, and
national, club and domestic teams; two of them are England's top 100 clubs on
their own map, one is Fiji's 16 clubs, each starting on a group of its 100
sections, one the NFL's 32 franchises on theirs, with the live ticker, one MLB's 30
clubs on theirs, also live, one baseball's nations of North and Central America, one the NHL's 32 clubs on
their map, live, one hockey's nations of Europe, one the women's nations of Europe, live, one the NWSL's clubs, one
tennis's Davis Cup nations of Europe, live, one women's tennis's Billie Jean King Cup nations of the world, one the NRL's 17
clubs on their map, live, and one rugby league's nations of
Asia and Oceania. A **manager campaign** (Italy, Europe, round robin × *You
choose*, live ticker) is driven only through the primary action. It covers
target choices, tactical gates, Finish match, signings on the conquest screen,
the automatic switch to Match and back, and Continue as spectator after
elimination. It also checks that every one-by-one turn draws exactly three
campaign samples and that no clock timer runs while a decision is pending.
**Eight interrupt-and-resume scenarios** cover a world-scale national campaign
plus basketball nations, football clubs, NBA clubs, NFL clubs, MLB clubs and England and Fiji
domestic campaigns, which are played on to their champions after the reload.
They verify that settings, ownership, squads, acquired players, and the remaining
match queue survive a reload and that the campaign remains playable. The app's
files are served from `public/` by path, with a 404 for anything missing. The
domestic runs also check the setup's loading, error and Retry states, and that
the neighbouring-land backdrop stays inert. The domestic resume also refuses a
save naming missing sections and a map that cannot load, resumes from a cold
map cache, and restores a one-section-per-club save onto the 100-section map,
each starting group whole with its holder. `npm run test:domestic` kicks off
every shipped country with legal duel draws. A **challenge link** check opens the
app at a link and finds setup filled in but not launched. Copy challenge link
writes the same link back, and Launch plays its settings and seed. A country map's
link keeps its club once the map loads, and a stale link falls back to the
defaults and says so.

The suite asserts that each match eliminates exactly one team, that no territory
is lost or duplicated, and that one player changes shirts per match. It checks
that setup and kickoff open on the Political map, national flag ownership after
switching to Flags, club colours and crests, structured result rewards, the Chronicle,
Ledger and Squad screens opened through the masthead, victory, and absence of
React warnings.

Focused runs skip every other section:

```bash
npm run smoke -- --campaign-only=0   # one of the eleven campaigns (index 0–10; 7 and 8 are England, 9 is Fiji, 10 the NFL)
npm run smoke -- --resume-only=0     # one resume scenario (index 0–6; 4 is England, 5 is Fiji, 6 the NFL)
npm run smoke -- --manager-only      # the manager campaign
npm run smoke -- --scenarios=england # scenarios whose names match; narrows the picks above
```

`npm test` runs every `scripts/*.test.mjs` file. Besides the engine, model and
UI suites listed under [Running it](#running-it), the v4 redesign added:

| Test file | Covers |
| --- | --- |
| `seed-replay` | Seeded campaigns replay the golden outcomes, final random state and decisions (`scripts/data/seed-replay.golden.json`) |
| `contracts` | Static contracts between App, the `src/app/` method modules and the frozen pure modules |
| `view-router` | Derived views, navigation locks, the primary-action table, Space, auto-switch to Match and back |
| `masthead` | Masthead markup and model, playback variants and the phone chrome |
| `turn-order` | Round-robin queue, "in reach" tiers, fixed-attacker and chosen-target draws |
| `turn-panels`, `turn-wiring` | Turn strip, Choose a target, spectator panel, and the turn flow in the real App |
| `win-probability` | The live win-probability model against the football and basketball match models |
| `american-football` | NFL clubs from the Madden snapshot, the match model, its live win probability, the NFL map, setup, squad and the App |
| `euroleague` | The EuroLeague's clubs rebuilt from the snapshot, its estimates, positions and names, its rules, its map, setup, launch, saves and links; the EuroBasket theatre and its fives |
| `save-size` | Save size and storage-quota behaviour for 173-nation campaigns |
| `pacific-islands` | Tonga, Samoa and the Cook Islands: the rules map's rings from the 50m map, their nations, which sports field them, and world wars with them playing or neutral |
| `error-boundary` | The crash screen: a render error shows it with focus on its heading, Export campaign downloads the stored checkpoint unchanged, and the report link carries the error |
| `font-audit` | Only Archivo and Archivo Narrow, no serif, monospace or italics in shipped source |
| `setup-wizard` | Setup steps, rules of war, launch normalisation and Space |
| `campaign-column`, `match-screen`, `squad-screen`, `conquest-screen`, `ledger-chronicle`, `map-v4`, `map-v4-engine` | Each v4 screen's view-models and components |
| `column-wiring`, `match-wiring`, `squad-wiring`, `conquest-wiring`, `ledger-wiring`, `map-wiring` | Each screen wired to the running App |
| `challenge-link` | Challenge links written and read back, and the fallback for unknown and stale values |
| `share-ui` | The share card, App's wiring of links and the share image, and the setup and results controls |

Domestic campaigns add `domestic-data`, `domestic-geometry`, `domestic-campaign`
and `domestic-routing`, which `npm run test:domestic` also runs on their own.

It also checks each sport's match model over 400 simulated games (American
football's over 3,000 in its own test file): that every match
has a winner, that a level score always triggers a tie-break, that the event feed
adds up to the final score, and that scoring lands in the right range for the
sport.

The [improvement checklist](docs/design/improvements.md) records the implemented
design changes. The [playtest protocol](docs/design/playtest.md) covers first-run
understanding, pacing, manager agency and save confidence. `npm run balance`
compares seeded single-match and series finales, champion concentration, leader
turnover and useful signing rates. Model probes and developer interaction checks
do not replace observing new players.
