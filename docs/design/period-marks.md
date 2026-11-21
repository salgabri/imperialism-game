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
researcher's "none" for want of any source) keep today's crest, as before, unless a
pictured crest follows them directly: that picture, the club's earliest dated one,
stands for them (the reach-back rule), since today's crest may have come later. Retired
caricatures of Native Americans are left out, as the game already leaves out
Washington's retired name: Washington's logo to 2019, Cleveland's Chief Wahoo to 2018,
the Philadelphia Warriors' to 1962 and, by the same rule since round 3, the Milwaukee
Braves' laughing brave of 1960-1965 (round 2 had shown the cap's M, not the logo) and the
Atlanta Braves' of 1966 show the monogram. The user confirmed this when round 3 asked
("Keep monograms", 15 November 2026). Cleveland's block C stays the 2019-2021 crest only:
sources disagree on whether it was the primary logo from 2014, and the club's own
article says it was secondary until 2019.

Since round 4 a crest known to differ from a pictured one only as a variant of it (a star
more or fewer, another colouring or trim, small lettering, a one-season anniversary or
jubilee logo) shows that nearest picture, the variant's own design, rather than a monogram
that would hide the club altogether: Panathinaikos's ball with two and three stars shows
its four-star picture, Chelsea's lion in red its yellow colouring of 1996-1999, the Mets'
first skyline roundel today's. A crest of another design with no picture keeps the
monogram.

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

As of round 4 (16 November 2026): 1,062 period crests for 908 club ids, every club id of
every season file researched, and every one rechecked under the 64 px rule. Of the 12,340
club-seasons in the season files (each club id in each season year it plays, all before
today's season; college football and the esports play today's season only):

| Sport | Period crest | Today's crest, researched | Today's crest, undated | Monogram |
|---|---|---|---|---|
| Football (men's) | 59% | 39% | 1% | 1% |
| American football | 54% | 42% | 0% | 4% |
| Basketball (NBA) | 76% | 24% | 0% | 0% |
| Basketball (EuroLeague) | 65% | 28% | 1% | 7% |
| Baseball | 54% | 40% | 0% | 6% |
| Ice hockey | 48% | 52% | 0% | 0% |
| Rugby league | 70% | 18% | 0% | 12% |
| Women's football | 30% | 70% | 0% | 1% |

Round 3 had left 52% of the club-seasons under a period crest and 451 under a monogram;
round 4 leaves 59% and 387. The monograms are of three kinds. 128 are the retired
caricatures of Native Americans above (Washington 1960-2019, Cleveland 1960-2018, the
Milwaukee Braves, the Atlanta Braves of 1966, the Philadelphia Warriors). Some clubs had no
emblem of their own: Eastern Suburbs before 1967, Balmain before 1964, the Bills before
1962. The rest are crests of another design that a source describes but no allowed source
pictures: the NFL's of 1960-1967 (Denver, the Colts' 1960, Chicago's and San Francisco's
1960-1961, Green Bay's 1960); MLB's Atlanta Braves of 1967-1986 (no source names a
primary logo before today's of 1987), Baltimore's of 1960-1965 and 1989-1997 and Texas's
1983; rugby league's Sydney logos of 1960-1977 (Balmain, Norths, St. George, Wests,
Parramatta to 1979, Penrith), the Sydney Tigers' of 1996 and the Perth Reds' of 1997;
football's Valladolid 1993/94-1997/98, Sporting Gijón 1993/94-1996/97, Groningen
1993/94-1995/96, NEC 1994/95-1996/97, CSKA Moscow 2001/02-2003/04, two seasons each of
Málaga, NAC and Wisła and eleven single seasons; the EuroLeague's codes of 2000/01-2006/07
(below); Badalona's women of 2023/24-2024/25. The undated seasons (30) keep today's crest:
no source says which crest the club wore (mostly Dutch, Portuguese and Spanish clubs
before 2005). Twelve football ids of the Championship Manager seasons are undated too
but have no crest of today under that id and no picture right after (Osasuna, Las Palmas,
Numancia, Extremadura, Norwich City of 1993/94-1994/95, Servette, Gaziantepspor and five
Portuguese clubs since fallen away): their 21 club-seasons show the monogram rather than
a guess.

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
as a new logo may have come that summer. So 37 of the 568 club-seasons keep the club's
code: CSKA Moscow 2001/02 to 2005/06 (a logo first seen in August 2006) and Olimpija
2000/01 to 2004/05 (round 3 found its dragon roundel in a Slovenian file citing a
2005/06 source), Dynamo Moscow 2006/07 (July 2007), AEK's 1997 emblem
(2000/01 to 2003/04, no picture), and fourteen clubs of the first seasons whose logo no
source shows or dates (Zadar, PAOK, Pesaro, the London Towers…). Round 4 pictured
Siena's Montepaschi logo from 2002/03 (French Wikipedia's copy of the club's file of
2008), and the Opel Skyliners, whose logo changed only its lettering, show the
Skyliners' logo of 2000/01.

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

### Round 4

After round 3 the user asked to go through all the clubs in the game again and search
for their historical logos (15 November 2026). Round 4 rechecked the 664 club ids round
3 had not touched: those of rounds 1 and 2 and of the EuroLeague's research, whose 373
eras of today's crest (about 3,800 club-seasons) had been judged at chip size, now under
the 64 px rule; and it searched again for the crests round 3 knew of but could not
picture. Eleven researchers took a league or region each (`data-src/crest-eras/ROUND4.md`);
`tools/merge-round3.mjs --round 4` replaced the research of each club they changed, and
round 3's curator patches were applied again (`work/round3/curator-patches.txt`).

It drew 103 period crests and retired 15 (pictures re-dated under a new first year, or
crests found to be today's or a variant of another picture), so 1,062 ship: 48 more in
football (Arsenal's crests of 1994/95-2001/02 and its 125th-anniversary crest of 2011/12,
Juventus's J from 2017/18, Paris Saint-Germain's of 2013/14, Lens's,
Sassuolo's, Braga's, Benfica's emblem of 1999), 17 in MLB (the Tigers', the Pirates', the
Angels'), 10 each in the NFL (the Cowboys' star of 1960, the Rams' of 2020) and NHL (the
Bruins', the Islanders', the North Stars'), 9 in the EuroLeague (Panathinaikos's stars,
Siena's, Crvena zvezda's of 2014-2018), 4 in the NBA (the Hawks' of 1970 and 2016), 3 in
rugby league and 2 for women's sides. Fenerbahçe's basketball side wore the sports
club's emblem (the football club's crest of today) to 2016/17 and one star from 2017/18;
its second star (2025) is on its crest of today.

The variant rule (above) gave 22 eras their nearest picture instead of the monogram:
Panathinaikos's two and three stars, Chelsea's red lion, Sheffield United's crest in
white on black, the jubilee logos of Utrecht and Volendam, Valencia's centenary
colouring, the Mets' first roundel, the Angels' gold halo, the White Sox's Gothic SOX in
black and navy, the Reds' first C's, the Royals' crowned shield, the Chargers' helmet of
1974-1987, the Golden Seals' script in green and gold, the Auckland Warriors' mask, the
anniversary logos of North Queensland, Penrith, Souths and Wests, the Opel Skyliners and
IFK Göteborg's crest of the Reebok years. The reach-back rule (above) gave seven undated
eras the picture worn right after them: PSV's 1993/94-1995/96 (today's crest has the
stars of 2020), St. Pauli's of the 1990s (today's brown is of 2018), Racing Santander's
before 2004 and Valencia's before 2005 under both their ids, and De Graafschap's early
2000s. The Atlanta Braves' seasons of 1967-1986, whose research keeps the monogram but
whose wording ("No source read names a primary logo") had read as undated, had shown
today's logo of 1987 since round 3; they show the monogram.

Seven crests of today were brought up to date from their file pages (README, "Club
crests"): Benfica's badge of 31 October 2026, Sassuolo's of 2025 and Athletic's (from
Italian Wikipedia, the only one that has those two), Braga's and Fleury 91's of November
2023 (French Wikipedia), FC Zürich Frauen's two stars and Montpellier's own logo of
today. Where a club's earlier
seasons wore the crest being replaced, those seasons picture it first (Braga's of
1997/98-2017/18, Benfica's women's side under the emblem of 1999). Left as they are:
Tottenham's cockerel of 2024 and Ankaraspor's crest of 1978 (French and Turkish
Wikipedia only), and the stars of Gotham, the North Carolina Courage and Orlando, which
no source dates.

### No club without a crest

On 21 November 2026 the user showed Italy's map of 1999/2000 in Crests mode, a dozen of its
clubs under monograms (Treviso, Savoia, Rimini, Varese, Castel di Sangro, Viterbese,
Fermana), and asked: "make sure that in none of the modes there are missing logos". A census
of every club the game can show (each sport's clubs of today, every map in
`public/domestic/` and every season that plays on one, each club-season resolved as
`src/data/crests.js` resolves it) found 3,756 football clubs without a crest in some
season: 460 of the 4,184 clubs of today's country maps and the rest on the earlier seasons'
country maps (Championship Manager 01/02's Update Team fills above all) and Europe maps, 11,260
of the 55,214 football club appearances (a club on a map in a season), a fifth. Outside
football: 14 EuroLeague clubs of 2000/01-2006/07, three of today's women's sides (Glasgow City,
Badalona Women, Costa Adeje Tenerife), Idaho's college football of 2004-2008, the Perth Reds of
1997 and Western Suburbs before 1974, and the 50 monogram eras.

Three rules changed. A monogram era (a crest known to differ, or no emblem at all, with no
picture of it) now shows the club's nearest picture: the crest worn right after it, else
today's when today's covers the seasons after it, else the next pictured crest or the one
before. So do the seasons no era covers where the club has no crest of today (the
EuroLeague's strict codes of 2000/01-2006/07: CSKA's red-star shield of 2006/07 now stands for
its seasons before). And a club of the earlier seasons with no crest of its own now wears
its crest of today in every season that has none, by the undated rule, read from its
Wikipedia article. The retired caricatures of Native Americans above keep the monogram, as
the user chose; and a club no source pictures at all keeps it too (`NO_PICTURE` in
`scripts/club-crests.test.mjs`).

How the crests were found (the tools stay in the ignored `data-src/crest-missing/`): each
club was matched to its Wikidata item, the one its home on the map came from when its names
fit, else the best-named football club of its country among every football club item
(labels and aliases in thirteen languages, the multi-sport clubs that play football too);
the stalled earlier-seasons crest session's hand mapping came first. The item's article gave
the infobox crest, English Wikipedia's first, then the club's own languages', then any; the
file page gave the original, its licence template and its size; the picture is Wikimedia's
standard thumbnail (330, 250 or 120 px, never wider than the original) or the original when
smaller. Clubs with no match had their article's title guessed (the name, "F.C.", "FC")
on English Wikipedia and their country's. A wrong crest is worse than none, so every match
was checked. Those the stalled session had mapped by hand, and those whose names agreed
closely with the item the club's home came from, were taken (1,929), except 456 whose article
or item carried a word the club's names lack (a town, a "-2"): those, every other match (784)
and the 30 guessed titles were read against their article's lead by reviewers, and 296 turned
out to be another club (a reserve, youth or women's side, a namesake in another town, a merged
or refounded successor, a different club of the same city) or could not be told; 15 of them,
matched to their reserve or women's side, got their first team's crest instead. Every picture
was then looked at on contact sheets, and 86 more went: photographs (grounds, gates, team
pictures), city arms, flags, Italian Wikipedia's colour fields and stripes, league and federation
logos, icons, and crests that plainly name another club (East Stirling's showing Stirling
Albion's, Dinamo-93 Minsk's Dinamo Minsk's). Of 2,760 pictures, 2,393 passed.

Where the crests went: a club of today's country maps through `pages` in
`scripts/data/club-logos.json` (46 clubs: 21 from English Wikipedia's file pages, 25 from
another language's, among them German, Russian, Ukrainian and Turkish); a club of the earlier
seasons through
`scripts/data/crest-eras.json`, wearing the file of today's map club of the same Wikidata
item where it has one, else a crest of today drawn under its own id
(`<club id>.<first year>.webp`, 1,633 of them, `league: "missing"`, 1,306 from English
Wikipedia's file pages, 192 from Commons, 135 from 18 other Wikipedias); Glasgow City's
and Badalona Women's women's sides under their own logos of today (the files their period
crests came from), Costa Adeje Tenerife under CD Tenerife's (`twins`); 12 EuroLeague clubs,
Idaho (gone from the FBS since 2018), the Perth Reds of 1997 and Farnborough Town of
1994-2000 under the picture nearest their seasons, picked by hand from the earlier research
(PAOK's wordmark of 2006, London Towers' LT of 2006, Ural Great's UG of 2008, Farnborough
F.C.'s crest, whose article covers Farnborough Town since 2007). The UK clubs' period crests of
that stalled session (8e88144f, 109 crests read from archived infoboxes) came in first.

That left 1,295 football clubs (2,622 club appearances, 4.7%), and the user asked to do
whatever could be done to find them ("do whatever you can to find those club logos"). A second
pass the same day searched three more ways. Every Wikipedia that has the club's article, not
only the first five, was read for its infobox crest or a crest pictured in the article's body
(a gallery of badges), site, project and sponsor logos set aside (62 infobox and 114 body
pictures passed; Lithuanian Wikipedia alone gave 87, Savoia's own crest came from German
Wikipedia). Reviewers proposed, from what they knew, the article of each club the search had
missed or matched to another club (the 1878 Airdrieonians, East Stirlingshire, Racing de
Santander, Deportes Concepción for CD Concepción and Universidad de Concepción for itself), and
each proposal was fetched and kept only when its lead was about football (217 passed). And the
free logos Commons files by country ("Association football logos of …") were matched by name
(8). Every match was read against its article again and every picture checked on contact
sheets: 401 crests passed, 89 of them for today's map clubs (`pages`) and 272 drawn for the
earlier seasons' clubs. Clubs moved to another city under a new identity keep the monogram
(Persijatim, not Sriwijaya; Putra Samarinda, not Bali United; Sangju Sangmu, not Gimcheon).

What is left. Outside football, only the caricatures and the Saint Petersburg Lions of
2000/01, whose logo no source shows. In football, 887 clubs, 1,755 of the 55,214 club
appearances (3.2%): 325 clubs of today's country maps (China's, Uzbekistan's, Senegal's lower
divisions and the like; 50 of the 128 maps are complete, from 36) and 562 of the earlier
seasons' maps (Italy's of 1999/2000 keeps two of its eleven), mostly lower-division and gone
clubs whose article has no crest (Brescello), whose article is now another club's (Alzano
Virescit's is its merged successor's, Germinal Ekeren's Beerschot's), or which have no article
or free logo at all. They keep the monogram; `scripts/club-crests.test.mjs` holds their number
as a ceiling. Files that their Wikipedia hosts without a licence template (Serbian, Croatian,
Azerbaijani, Fiji Hindi uploads) stay out, as before: 17 clubs. The crests of today
standing for earlier seasons are undated: a club renamed or moved since shows its later
identity's crest (the MetroStars the Red Bulls', Delhi Dynamos Odisha's), as the undated rule
has it everywhere else, until a pass reads their articles' archived infoboxes season by season
as the UK clubs' were read.

## Checks

`scripts/club-crests.test.mjs`: every club of every map, season and sport resolves to a
crest the game ships, but the caricatures and `NO_PICTURE` outside football and at most
1,755 football club appearances; no monogram era outside the caricatures and `NO_PICTURE`.

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
