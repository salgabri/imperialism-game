# Flags and crests of the day

Status: implemented 2026-11-10 to 2026-11-13, when the user asked: "as we go back in
time make sure the logos and flag match those years versions!"; rugby league's
computed seasons of 1998-2007 and of 1960-1997 added 2026-11-14; the EuroLeague's clubs of
2000/01 to 2025/26 added 2026-11-15; round 3, every club and nation of every season, the
same day, when the user asked: "for clubs and countries, all of them, in all sports, you
have to be accurate with the logo or flag for that year" (below, "Round 3").

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
  stars in 1960) and Venezuela (seven stars). Round 3 checked every fielded
  nation-year again and added eight, each a change a viewer sees at about 64 px
  (design, emblem, or a clearly different colour): Egypt (the Federation of Arab
  Republics' hawk, 1972-1984), DR Congo (royal blue, 1966-1971), Puerto Rico (the dark
  blue triangle, to 1995), Zambia (the darker green, to 1995), Russia (white, azure and
  scarlet, 1991-1993: hockey's, football's and tennis's 1992/93), Ethiopia (the 1996
  emblem, to 2009), the Philippines (the navy of 1936, to 1998) and Poland (vermilion,
  to 1980). Left out as proportion changes or shades too close to tell at that size
  (36 in all, listed in the research): Lithuania, Japan, Oman, North Korea, South Korea
  1949-2011, Serbia 2004-2010, Italy 2003-2006 and others; flag-icons draws Costa Rica
  and Peru without the arms whose changes would show. Argentina flies its state flag
  with the sun throughout, though private bodies flew the plain civil flag before 1985,
  as Iran and Greece fly their state flags.
- **Teams under a flag other than their state's** (names of the day): Chinese Taipei's
  teams have flown the Chinese Taipei Olympic flag since 1981, so it flies that in every
  season, today's too (flag-icons' Republic of China flag is no longer the game's), and
  its football teams of 1990-2005 the Chinese Taipei Football Association's flag (its
  Commons page has carried a deletion nomination since March 2026, "Fails TOO Taiwan":
  the licence recorded is the page's, with that note). Russia played the 2021 Davis Cup
  Finals and the 2020-21 Billie Jean King Cup as RTF under the Russian Tennis
  Federation's flag (an English Wikipedia file, public domain as text and shapes).
  Russia's and Belarus's suspensions from 2022 (the Davis Cup, the Billie Jean King Cup,
  FIFA) are rosters, not flags: their seasons still field them.
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
cutting would lose part of the design). The nested viewport carries the original's root
paint (a `fill` on the root that unpainted shapes inherit: Puerto Rico's white stripes
and star, the Philippines' gold sun, which drew black before round 3 kept it). RTF's
flag is an English Wikipedia file, pinned the same way (`commons` names its page there).
A drawing bigger than 40 KB once nested (a
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

Only a crest known to have been another is null. Since round 3 a crest is another
when someone comparing the two at about 64 px would see it: another design, emblem,
lettering, star count or colour scheme, including a changed trim (Calgary's flaming C
with its black trim of 1995-2020, Pittsburgh's penguin in Vegas gold of 2003-2016 and
Buffalo's crest in navy of 2011-2020, which rounds 1 and 2 had shown as today's "at
chip size", now show their own pictures). Only a redraw no one could tell apart at that
size (a tidied outline, a nearby shade) is the same crest. Seasons no source dates (a
researcher's "none" for want of any source) keep today's crest, as before. Retired
caricatures of Native Americans are left out, as the game already leaves out
Washington's retired name: Washington's logo to 2019, Cleveland's Chief Wahoo to 2018,
the Philadelphia Warriors' to 1962 and, by the same rule since round 3, the Milwaukee
Braves' laughing brave of 1960-1965 (round 2 had shown the cap's M, not the logo) and the
Atlanta Braves' of 1966 show the monogram. The user confirmed this when round 3 asked
("Keep monograms", 15 November 2026). Cleveland's block C stays the 2019-2021 crest only:
sources disagree on whether it was the primary logo from 2014, and the club's own
article says it was secondary until 2019.

A period picture saved on a solid white box (an archived thumbnail, a PNG of a scan)
names the box in `crest-eras.json` (`"background": "#ffffff"`), and
`scripts/lib/crest-image.mjs` clears it: a fill from the picture's edges through every
pixel near that colour, so the crest's own white inside its outline stays. 152 period
crests clear a box this way, each checked before and after on a contact sheet; two keep
theirs (ASVEL's Adecco logo of 2002, whose white field is the design, and Newtown's N
shield of 1960, whose white body touches the picture's edge).

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

As of round 3 (15 November 2026): 974 period crests for 870 club ids, every club id of
every season file researched. Of the 12,340 club-seasons in the season files (each club id
in each season year it plays, all before today's season):

| Sport | Period crest | Today's crest, researched | Today's crest, undated | Monogram |
|---|---|---|---|---|
| Football (men's) | 52% | 45% | 1% | 2% |
| American football | 47% | 49% | 0% | 5% |
| Basketball (NBA) | 75% | 25% | 0% | 0% |
| Basketball (EuroLeague) | 59% | 33% | 1% | 8% |
| Baseball | 43% | 49% | 1% | 7% |
| Ice hockey | 42% | 58% | 0% | 0% |
| Rugby league | 69% | 18% | 0% | 12% |
| Women's football | 18% | 81% | 0% | 1% |

The monograms (451 club-seasons) are of three kinds. 128 are the retired caricatures of
Native Americans above (Washington 1960-2019, Cleveland 1960-2018, the Milwaukee Braves,
the Atlanta Braves of 1966, the Philadelphia Warriors). Some clubs had no emblem of
their own: Eastern Suburbs before 1967, Balmain before 1964, the Bills before 1962. The
rest are crests a source describes but no allowed source pictures: the NFL's of
1960-1967 (Denver, the Colts' 1960, Chicago, Green Bay's 1960, San Francisco) and San
Diego's of 1974-1987; MLB's Atlanta Braves of 1967-1986 (no source names a primary logo),
Baltimore's of 1960-1965 and 1989-1997, Cincinnati's of 1960-1966 and Kansas City's of
1969-2001; rugby league's Sydney logos of 1960-1977 (Balmain, Norths, St. George, Wests,
Parramatta to 1979, Penrith), the Sydney Tigers' of 1996 and two 90th-season badges of
1997; football's Groningen 1994-1996, NAC 1994-1996, MVV 1994-2000, Chelsea's lions of
1994-1995 and 2000-2005, Crystal Palace 1995-2013, Aberdeen 1994-1997, Derby 1996-1997,
Wisła 1994-1999 and a few single seasons; the EuroLeague's codes of 2000/01-2006/07
(below). The undated seasons (64) keep today's crest: no source says which crest the club
wore (mostly Dutch, Portuguese and Spanish clubs before 2005).

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

Rugby league's computed seasons of 1960-1997 came last (14 November 2026), with their
names of the day (the Canterbury-Bankstown Berries, the Eastern Suburbs Roosters, the
Newtown Bluebags and Jets, the Sydney Tigers and Bulldogs, the Gold Coast-Tweed Giants
and Seagulls, the Perth Reds) and the clubs gone since. Today's club articles date many
logos of those years in their galleries and captions: Cronulla's four from its first
season (Captain Cook's Endeavour in 1967, a shark in an oval in 1968-1969, a black shark
in a ring to 1977, the blue shark of 1978-1997), the Roosters' "Easts to Win" rooster
of 1967 and its Eastern Suburbs shield of 1978-1994 (the club had no logo before 1967,
and shows its monogram), Canterbury-Bankstown's CB shield to 1977, Penrith's panther of
1978-1990, Manly's circle of 1980-1997, the first logos of Canberra (1982), Brisbane,
Newcastle and the Gold Coast Seagulls, North Queensland's steer head of 1995-1997, and
the clubs of 1995-1997 that had one name and one logo (the South Queensland Crushers, the
Western Reds, the Hunter Mariners). The Wayback Machine's copies of the clubs' articles
of 2006-2016 show the rest, in files Wikipedia has deleted since: Canterbury's snarling
bulldog of 1978-1997 (the 1995 Sydney Bulldogs' and 1996-1997 Canterbury Bulldogs' too),
Souths' green oval of 1959 ("throughout the 1960s and 1970s"), Manly's sea eagle over an
MW football of 1960-1979 (a gallery of 2016), the Gold Coast-Tweed Giants' giant of
1988-1989, Illawarra's logo of its years to 1997, and Wests' magpie shield of 1978,
shown in its article's section on the 1980s. Seven crests of the 1998 research begin
earlier and carry their new first year (`nrl-brisbane-broncos.1988`).

Where an article's text and its gallery or file description disagree, the text is used:
the "Easts to Win" logo is captioned 1967 and described as 1967-1975, but the text keeps
the mantra until the shield of 1978 (and the article of 2009-2013 called it "The original
Eastern Suburbs logo"). Where today's article is silent, an older version is used:
Illawarra's last logo began in 1998 by its gallery of 2012-2016, though its file page of
2006 said 1997. A year in a file's name dates nothing on its own; Souths' red and green
oval, worn to 2007, is named 1988 but no source dates it, so Souths' seasons of 1980-1997
keep today's crest. Parramatta's crests after Parramatta City's, before its eel of 1980
(today's crest), Penrith's mark before 1978 (today's crest is its 60th-anniversary logo
of 2026) and Wests' magpie on a branch of 1960 (a 43 px thumbnail) are known but shown by
no usable picture: those seasons show the monogram. Balmain (the Sydney Tigers of 1995
and 1996 too), Norths, St. George before 1998, Wests after 1989, Newtown and the Perth
Reds have logos of the time that no source dates, so they keep their monogram: most of
these clubs still play under those names, and their articles show today's logos.

The EuroLeague's seasons of 2000/01 to 2025/26 came next (15 November 2026): the 69
clubs not in today's EuroLeague, which until then showed their code, and today's 20
where their crest of those seasons was another. Each club's articles in its own
language and English, their galleries and the Wayback Machine's captures of them gave
92 period crests; 91 ship, as ASVEL's LDLC ASVEL logo of 2018/19 on became its crest of
today the same day (read from its file page, README "Club crests"). Real Madrid wore the club's plain crest (the football club's of
today) to 2008/09, Galatasaray and Zenit their sports club's emblem (Galatasaray's plain GS since
round 3: the stars over the club's crest of today are its football team's); Valencia's 40th-year
crest and Virtus Bologna's centenary crest are 2026/27's, so 2025/26 shows the badges
they replaced, and Efes's 50th-year logo is 2025/26's. Where a club's primary logo was a
sponsor's team logo and no crest of its own was in use (Baskonia's TAU Cerámica, Siena's
Montepaschi, the Brose Baskets, ASVEL's Adecco and LDLC), that logo is its crest; where
the club's own emblem stood beside the sponsor's (Joventut's beside DKV's, Fortitudo's
beside Climamio's), the emblem is. A crest first seen by 30 June of a season the club
played (the cutoff flags use) covers that season and the club's earlier seasons of that
run where no source shows another: Unicaja's and Ülkerspor's, first seen in 2005/06, from
2001/02. A logo first seen only in a summer after a club's seasons does not reach back,
as a new logo may have come that summer. So 43 of the 568 club-seasons keep the club's
code: CSKA Moscow 2001/02 to 2005/06 (a logo first seen in August 2006) and Olimpija
2000/01 to 2004/05 (round 3 found its dragon roundel in a Slovenian file citing a
2005/06 source), Dynamo Moscow 2006/07 (July 2007), AEK's 1997 emblem
(2000/01 to 2003/04, no picture), Siena 2002/03 to 2005/06, and fifteen clubs of the
first seasons whose logo no source shows or dates (Zadar, PAOK, Pesaro, the London
Towers, the Skyliners as Opel Skyliners…).

Barcelona's basketball section wore the club's crest, and its F.C.B. crest of
1975-2002 is one the football research had found no picture of. Football's Barcelona
(FC Barcelona, and F.C. Barcelona in most Championship Manager seasons) now wears it
from 1993/94 to 2001/02 instead of its monogram: eight club-seasons of the table and
1996/97, too few to move its rounded figures.

### Round 3

On 15 November 2026 the user asked: "for clubs and countries, all of them, in all
sports, you have to be accurate with the logo or flag for that year". A census of every
club id in every season file found about 3,000 club-seasons wrong or missing: 133
football ids never researched (the clubs of all Europe's leagues the EA and Championship
Manager seasons had gained, and 1996/97's), crests dated in earlier rounds but never
pictured (the NBA's monograms above all), the chip-size rulings, rugby league's
1960-1997 crests (researched on 14 November but not yet on main) and the women's sides.
Twelve researchers took a league or a region each (`data-src/crest-eras/ROUND3.md`),
and a thirteenth the flags (`FLAGS-ROUND3.md`). Their findings replaced each club's
research whole (`tools/merge-round3.mjs`), and `tools/curate.mjs` built
`crest-eras.json` from them; a key era naming a crest no image era draws any more
(Oakland's 1983 logo, the Padres' of 1990) keeps the crest as shipped.

Round 3's researchers worked from archived Wikipedia infoboxes (a crest current between
2004 and today is very likely in one: `data-src/crest-eras/tools/wb-infobox.mjs`),
archived season articles and logo galleries of 2005-2012, and other languages' galleries
and file pages (French, Italian, Hebrew, Finnish and Russian above all). Where nothing
dates a club's crest of the 1990s, its earliest dated picture stands for the seasons
before it, as for the EuroLeague (below), and each such era says so in its evidence.
Several pictures are archived thumbnails of 50-250 px (Wikipedia deleted the originals
under its non-free content policy); their licence is recorded as the archived file page
stated, or as a non-free English Wikipedia upload where no archive holds the page.

Every crest of today was also compared with its club's English Wikipedia infobox as it
stands (3,158 files): 109 differ, mostly the same crest in another file, and 19 were
crests a club had replaced, added a star to or redrawn; they now come from their file
pages (README, "Club crests"). Where a club's earlier seasons wore the crest being
replaced (Rosenborg's two stars of 2007-2010), those seasons picture it as a period
crest first. Tottenham's 2024 cockerel without the wordmark (French Wikipedia only) and
a Turkish file of Ankaraspor's 1978 crest are left: the English articles still show the
crests the game has.

Crests are the clubs' trademarks; as with today's crests (the user's choice of
Wikipedia crests, 2026-10-25), many are non-free files that Wikipedia hosts under
its non-free content policy, and `SOURCES-eras.tsv` records each one's licence as
its file page states. Five rugby league logos (Souths' oval, Parramatta's two eels,
Manly's sea eagle of 1960-1979, Wests' shield of 1978) were deleted from Wikipedia with
file pages no archive holds: they are recorded as non-free English Wikipedia uploads,
and for two of them an earlier upload of the same logo states fair use. Three survive
only as the articles' thumbnails (Souths' oval at 150 px, Illawarra's logo to 1997 and
Wests' shield at 125 px).

## Checks

`scripts/period-marks.test.mjs`: the tables (every flag period in order and
vendored, every name of the day's flag vendored, every crest era's file shipped, a
source row for each period crest); the cutoff rule; a team under its own flag
flying the flag of the day while a federation keeps its own; tennis 1975
(Czechoslovakia, the Soviet Union, Yugoslavia, West Germany), 1992 (the CIS) and
1993 (Russia, Czechia); football 1996/97 to 2005/06 (FR Yugoslavia, then Serbia and
Montenegro); rugby league's 1998 to 2007 (every club of each season under a crest
the game ships, era names and gone clubs too; the logos of the day and the first
round's two corrections by name); rugby league's 1960
to 1997, the ARL's and Super League's 1997 both (every club under a crest the game
ships but the seasons listed to show the monogram; the logos of the day by name); the
EuroLeague's 2000/01 to 2025/26 (every club of each season under a crest the game ships,
except the 43 club-seasons named with their code; Ülkerspor, Real Madrid's plain crest,
Valencia's and Efes's last seasons, football Barcelona's F.C.B. crest of 1993/94 to
2001/02 and others by name); round 3's flags (each new flag of the day in the seasons
that field the nation, Egypt's, Puerto Rico's and Russia's in real seasons' teams) and
teams under another flag (Chinese Taipei's Olympic flag today and its football flag of
1996/97, RTF in tennis's 2021); round 3's crests in every sport by name, the retired
caricatures as monograms and the crests of today read from file pages; and TeamMark and
SquadFlag drawing the crest of the season on screen. `scripts/historic-maps.test.mjs`
checks every name of the day sourced, Chinese Taipei's and RTF's among them.
`npm run test:flag-symbols` runs `build-historic-flags --check`.
