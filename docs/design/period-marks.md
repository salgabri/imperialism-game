# Flags and crests of the day

Status: implemented 2026-11-10 to 2026-11-13, when the user asked: "as we go back in
time make sure the logos and flag match those years versions!"; rugby league's
computed seasons of 1998-2007 added 2026-11-14.

A season of another day shows every nation under the flag it flew then, and every
club under the crest it wore then. Before this, every season flew today's flags and
crests: Rhodesia played the 1970s Davis Cup as Zimbabwe, Spain flew today's arms in
1966, the 1996 Toronto Raptors wore their 2021 logo, and a club under a former name
(the St. Louis Hawks, the Hartford Whalers) had only its monogram.

## Nations

A season's flags are those flown on its **cutoff, 30 June of its year** (a split
season's year is the one it ends in), the day the football federations' tables
already count by. A season of today (the built-in one, no data set) flies today's.

- **Names of the day** (`src/data/namesOfTheDay.js`, shared with the historic maps
  work on branch claude/historical-maps-game-rules-659c0f, whose table this is, kept
  identical): the Davis Cup's and the Fed Cup's federations (Czechoslovakia, the
  Soviet Union, the CIS, Yugoslavia, West Germany, the United Arab Republic), FR
  Yugoslavia and Serbia and Montenegro in football from 1996/97, Swaziland,
  Macedonia; added here: Zaire (1972-1996, for the seasons whose files do not name
  it), Rhodesia (to 1978) and Zimbabwe Rhodesia (1979). South Vietnam's Davis Cup
  side of 1964 and 1965 is left to the historic maps work, which gives it a shape of
  its own (RVN); here it still plays on Vietnam's shape under today's name and flag.
  `seasonSport` (`src/engine/footballSets.js`) plays them as `playsAs`; a men's
  football season's own `identities` win.
- **Flags of the day** (`src/data/flagsOfTheDay.js`): the flags a shape flew before
  today's, each until its last day. `nationIdentity` (`src/data/teams.js`) gives a
  team under its own shape's flag (`flagId` the shape's id, as Rhodesia's and West
  Germany's names of the day have) the flag of the season's year; a federation's
  flag (the Soviet Union's) and Great Britain's stay as they are. 38 flags, for the
  nations that field a side in years their flag differed: Albania, Brazil (22 and 23
  stars), Bulgaria (three arms), Burma, Belarus (white-red-white), Canada (the Red
  Ensign), the Congo and Benin (people's republics), DR Congo (1997-2006),
  Ethiopia, Georgia, Greece (the land flag with the crown to 1969, the plain cross
  1975-1978), Haiti (black and red), Honduras (turquoise 2022-2025), Iran (the lion
  and sun), Iraq (three flags), Lesotho, Libya, Mexico (the arms of 1934), Romania
  (two arms), Russia as itself (the Russian SFSR's flag, hockey's 1990/91 birthplace
  team), South Africa (1928-1994), Rhodesia (the Federation's, 1964's, 1968's,
  Zimbabwe Rhodesia's), Spain (the eagles of 1945 and 1977), Syria (the United Arab
  Republic's flag, 1980-2025), Macedonia (the Vergina sun), the United States (49
  stars in 1960) and Venezuela (seven stars). Shade and proportion changes too small
  to see in a chip are left out (South Korea before 1984, Zambia before 1996, Oman
  before 1995, Russia 1991-1993, Serbia 2004-2010, Lithuania before 2004).
- **Today's flags** are flag-icons', except Honduras's: navy blue again since 27
  January 2026 (`hn-1949`); flag-icons draws the turquoise flag of 2022-2026, which
  flies in the seasons of 2022 to 2025. Syria's (flag-icons') is already the flag
  adopted on 13 March 2025.

A team is built with its name, code and flag of the day, so the setup wall, the
campaign, the map's Flags mode, the chronicle and a saved campaign all show them;
land keeps its geographic name ("Ukraine, held by Soviet Union").

### Flag files

`scripts/data/historic-flags.json` pins each flag: its Commons file page and
revision, the original's SHA-256, its licence as the page states, its dates; the
original is committed under `scripts/data/historic-flags/`. `npm run
build:historic-flags` draws each on flag-icons' 640 x 480 canvas into
`public/flags/`: the eight federation and state flags of the maps work by their own
recipes, every flag of the day whole inside a viewport that fits the original's
aspect to 4:3 (`fit`: `slice` cuts evenly from both sides, for bands with a
centred emblem; `slice-hoist` cuts at the fly, for an emblem in the canton;
`stretch` scales each axis on its own, for vertical bands and ensigns, where
cutting would lose part of the design). A drawing bigger than 40 KB once nested (a
coat of arms in hundreds of paths: Bulgaria's 677 KB, Spain's 539 KB, Rhodesia's
569 KB) ships as that drawing's 640 x 480 WebP inside the same SVG, a few kilobytes,
which a chip and the map's bitmaps (`src/engine/flagRaster.js`) draw far sooner.
`--check` rebuilds every vector flag byte for byte and compares a bitmap flag by its
pixels (another system's libvips may draw a shade apart). The builder also writes
`public/flags/SOURCES-historic.tsv`: every historic flag's source, licence and page.

Licences: most are public domain (the countries' official-symbol exemptions, or
simple geometry). Commons has no public-domain drawing of Spain's 1945 and 1977
arms, of Bulgaria's three people's-republic arms or of Rhodesia's flag of 1964:
those six are CC BY-SA (Spain's and Bulgaria's also GFDL, at the reuser's choice) by
SanchoPanzaXXI, Miguillen, Scroch and Greentubing, credited in
`SOURCES-historic.tsv`, and their 4:3 versions keep that licence.

Wikimedia's image server refuses bulk downloads of original files (HTTP 429, "use
thumbnail images in sizes listed", Retry-After 600). The flags pinned after it did
(those whose `source` ends `.1280px.png`, 24 of them) come from its standard 1280px
thumbnail of the same Commons file and ship as bitmaps; the rest from the original
SVG.

## Clubs

`src/data/crests.js`. A club wears, in a season, the crest it wore that season where
that was not today's, else today's (`src/data/clubLogos.js`). `CREST_ERAS`
(`src/data/clubCrestEras.js`, generated) lists, by club id, the seasons whose crest
was another: `[first year, last year, file]` in the season years the game uses. The
file is a period crest (`public/club-logos/<club id>.<first year>.webp`), another
id's crest of today (a club spelled two ways by two data sources), or **null**:
the club wore a crest the game has no picture of, so it shows its monogram rather
than a crest it did not have yet.

Only a crest known to have been another is null. A redraw that looks the same at
chip size (a tidied outline, another shade, a star added) is the same crest, so
Calgary's flaming C with its black trim (1995-2020), Pittsburgh's penguin in Vegas
gold (2003-2016) and Buffalo's crest in navy (2011-2020) show today's. Seasons no
source dates (a researcher's "none" for want of any source) keep today's crest, as
before. Three retired caricatures of Native
Americans are left out, as the game already leaves out Washington's retired name:
Washington's logo to 2019, Cleveland's Chief Wahoo to 2018 and the Philadelphia
Warriors' to 1962 show the monogram.

The season on screen reaches every mark through `SeasonYear`
(`src/components/seasonYear.js`): App provides the campaign's `dataYear`, or the
season chosen in setup; `TeamMark` and `SquadFlag` read it. The map's Flags mode
(and its warm-up), the setup card, the share image and the installed app's offline
copy (`teamMarkUrls`) take the year from the campaign or setup directly.

### Sources

Period crests come only from sources whose robots.txt allows automated access:

- Wikipedia articles and file pages in any language (`/wiki/` pages; never the API
  under `/w/` or `/api/`, never `Special:` pages), Wikimedia Commons file and
  category pages, and original files on upload.wikimedia.org (never Commons'
  `/archive/` of old file versions, which its robots.txt disallows; older versions
  of German and Russian Wikipedia's own files, which it allows, were read to date a
  few crests, and none ships).
- The Wayback Machine's captures of Wikipedia articles and files, where a team's
  article of 2004-2016 showed the logo it wore then: the thumbnail the archived page
  showed, fetched with the `id_` or `im_` flag (both serve the archived bytes as they
  were), its capture named in `crest-eras.json`.

SportsLogos.net disallows ClaudeBot and Logopedia (logos.fandom.com) refuses bots,
so neither is used; a few Wikipedia files name one of them as where their uploader
found the logo, and those are fetched from Wikipedia only. English Wikipedia keeps
few historical logos (its non-free content policy removed most); French, German and
Italian Wikipedia and Commons hold many old football badges, and German Wikipedia's
own files many Dutch and Portuguese ones. Where no picture of a crest known to differ
exists, the club shows its monogram in those seasons.

The research (data-src/crest-eras/: the briefs, the club lists, each league's
findings and the cached originals) is ignored by git. `npm run sync:crest-eras`
reads `scripts/data/crest-eras.json` (each period crest's club, years, source file,
licence and SHA-256; each club's eras) and the originals cached under
`data-src/crest-eras/files/`, and writes the WebPs (trimmed, fitting 128 x 128, as
`npm run sync:club-logos` draws today's), `public/club-logos/SOURCES-eras.tsv` and
`src/data/clubCrestEras.js`. `--check` rebuilds them byte for byte where the cache
is present. `sync:club-logos` leaves period crests alone.

### Coverage

As of 14 November 2026: 557 period crests for 637 club ids, every club the game has
researched. Of the club-seasons before today's season (each club id in each season
year it plays):

| Sport | Period crest | Today's crest, researched | Today's crest, unverified | Monogram |
|---|---|---|---|---|
| Football (men's) | 41% | 45% | 1% | 9% |
| American football | 36% | 52% | 0% | 12% |
| Basketball (NBA) | 29% | 37% | 0% | 34% |
| Baseball | 25% | 57% | 0% | 18% |
| Ice hockey | 29% | 56% | 4% | 11% |
| Rugby league | 63% | 36% | 0% | 0% |
| Women's football | 5% | 73% | 0% | 22% |

The rest of men's football (4%) are club ids with no crest today and no dated one: a
monogram. The unverified seasons are those no source dates, mostly Dutch and
Portuguese ones before 2005, when Wikipedia's articles began to show their crests;
the NBA's monograms are mostly logos of 1961-2005 that no allowed source still shows.
Rugby league's rest (1%) are three clubs of 1998-1999 that no source dates a logo
for (below); its one monogram is the Warriors' anniversary logo of 2015.

A second round (13-14 November 2026) researched the 71 English, Dutch and Portuguese
clubs the first had left, the Spanish, Italian, German, MLB and NFL seasons it had
left undated, the 2003/04 football season and the NHL's 1960/61 to 1965/66, and
corrected two of its findings (Venezia's crests since 2022, Reggina's gallery
captions).

Rugby league's computed seasons of 1998-2007 came next (14 November 2026), with the
clubs they bring: the era names (the Auckland Warriors, the Sydney City Roosters, the
Canterbury Bulldogs, the Sharks, the St. George Dragons of 1998) and the seven clubs
since gone. English Wikipedia's club articles date most of their logos by gallery;
those they no longer show come from the Wayback Machine, above all the National Rugby
League article as captured on 25 June 2006, whose tables showed every club's logo of
the day and the gone clubs' too. Nineteen period crests came of it, and eight of the
first round's now begin earlier, so their files carry the new first year (the
Panthers' of 2000-2012 is `nrl-penrith-panthers.2000`). Two first-round findings were
corrected: Parramatta wore a yellow eel from 2004 to 2010, not today's crest from 2008,
and the Bulldogs' cartoon head of 1998-2009 has a picture (2008 and 2009 showed the
monogram). Where a club's article and its gallery, or an older version of it, disagree
by a year (Parramatta's eels of 2000 and 2004, the Cowboys' star of 2003), the article
as it stands is used. Four clubs since gone wear their crest (the Adelaide Rams, the
Gold Coast Chargers, the Illawarra Steelers, the Northern Eagles); the Balmain Tigers,
the North Sydney Bears and the Western Suburbs Magpies, whose logos of 1998-1999 no
source dates, keep their monogram.

Crests are the clubs' trademarks; as with today's crests (the user's choice of
Wikipedia crests, 2026-10-25), many are non-free files that Wikipedia hosts under
its non-free content policy, and `SOURCES-eras.tsv` records each one's licence as
its file page states. Three rugby league logos (Souths' oval, Parramatta's two eels)
were deleted from Wikipedia with file pages no archive holds: they are recorded as
non-free English Wikipedia uploads, and for two of them an earlier upload of the same
logo states fair use.

## Checks

`scripts/period-marks.test.mjs`: the tables (every flag period in order and
vendored, every name of the day's flag vendored, every crest era's file shipped, a
source row for each period crest); the cutoff rule; a team under its own flag
flying the flag of the day while a federation keeps its own; tennis 1975
(Czechoslovakia, the Soviet Union, Yugoslavia, West Germany), 1992 (the CIS) and
1993 (Russia, Czechia); football 1996/97 to 2005/06 (FR Yugoslavia, then Serbia and
Montenegro); rugby league's 1998 to 2007 (every club of each season under a crest
the game ships, era names and gone clubs too, except the three undated ones; the
logos of the day and the first round's two corrections by name); and TeamMark and
SquadFlag drawing the crest of the season on screen.
`npm run test:flag-symbols` runs `build-historic-flags --check`.
