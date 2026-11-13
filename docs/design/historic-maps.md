# Earlier maps

Added 2026-11-10, when the user asked that "over time the maps are historically correct (example west vs east
germany)". A season of another day plays the world map as it stood then, and its nations under the names they played
under.

## East Germany

East Germany (the German Democratic Republic, 7 October 1949 to 3 October 1990) had no shape on the map: a season before
reunification played West Germany on the whole of Germany, and East Germany fielded no team (decided 2026-11-09, before
this request). Now every season ending in 1990 or before has it.

**The border.** `scripts/lib/historic-shapes.mjs` reads the inner German border off Natural Earth 1:10m admin-1
(v5.1.2, public domain, the file `scripts/build-home-nations.mjs` already pins for the home nations): the line the six
eastern states (Mecklenburg-Vorpommern, Brandenburg, Berlin, Saxony-Anhalt, Thuringia, Saxony) share with the western
ones, one line of 1,384 edges from the Baltic at Priwall (10.906°E, 53.961°N) to the tripoint with Czechoslovakia near
Prex (12.101°E, 50.314°N). The build walks it out from its middle to each atlas's coarser outline: where Natural
Earth's end lies inside that outline, the border goes on to the nearest point of the arc that end belongs on (the
Baltic coast, the border with Czechia). It is simplified to the outline's own detail (a quarter of the mean segment),
put on the atlas's grid, and checked to touch the outline only at its ends. On the 110m rules map East Germany is one
polygon (16 border points); on the 50m display map its mainland, Rügen and its share of Usedom, while Fehmarn, Sylt and
Föhr stay West German.

- Berlin is a point at the map's scale, so East Germany holds it whole. West Berlin, West German in practice, is not
  drawn.
- Amt Neuhaus, east of the Elbe, was East Germany's and joined Lower Saxony in 1993. Natural Earth follows today's
  border there, a few kilometres from the river; at the map's scale the difference does not survive simplification.

**Today's map untouched.** Both atlases keep today's shapes in `countries` as they were. The historic shapes go into a
GeometryCollection of their own, `historic`: West Germany (276), East Germany (278) and Czechoslovakia (203), each with
`properties.through` 1990. Their new arcs (the border, and the Baltic coast and the Czech border each read in two
pieces at the border's ends) are appended after every arc of today's map, so today's decode reads exactly the arcs it
always did (`scripts/historic-maps.test.mjs` checks every other shape decodes point for point). Czechoslovakia's copy
is today's Czechia read with its border arc in two pieces, so it still shares that border, and so its adjacency, with
both Germanys. The atlases grew by 0.8 KB (110m) and 2.6 KB (50m). `npm run build:home-nations -- --check` rebuilds both
byte for byte.

**The map of a year.** `src/engine/historicMap.js`: `atlasOfYear(atlas, year)` is the atlas itself when no historic shape
stands in that year (today's season has no year), else one copy per era whose `countries` read each standing historic
shape in place of today's of its id, and a new id after it. `capitalsOfYear` anchors West Germany on Bonn while East
Germany stands (East Berlin is East Germany's, `CAPITALS['278']`). The app keeps the rules atlas from boot and decodes an
era's world geometry the first time a setup or campaign of that year needs it (`App.worldGeometry`), and `useGeometry`
takes the year: the setup map, the opening, a launch and a restore all play the map of `mapYearOf(settings)`
(`src/app/shared.js`: the season's end year, or null for today's).

| Map | Seasons | Germany |
| --- | --- | --- |
| Up to 1990 | every season ending in 1990 or before: football to 1989/90, tennis to 1990, ice hockey to 1989/90, baseball to 1990 | West Germany (276, anchored on Bonn) and East Germany (278, East Berlin) |
| Today's | every later season and the built-in ones | Germany (276, Berlin) |

**The nation.** `NATIONS['278']` is East Germany (GDR, UEFA), a nation of the map's earlier years (`HISTORIC_NATIONS`,
last year `HISTORIC_THROUGH['278'] = 1990`). Its flag is Wikimedia Commons' "Flag of East Germany.svg" (revision
1291263799; public domain: an official work, section 5 of the German Copyright Act, as the file page states), redrawn
on the game's 4:3 canvas by `scripts/build-historic-flags.mjs` (whose recipe now draws out the file's `<use>`
references and measures arcs and rectangles), with its hammer and compass kept upright on the map
(`src/data/flagSymbols.js`). On the political map it takes its flag's gold, chosen against its neighbours on the map of
1990 (`scripts/build-nation-colours.mjs`), nobody else's colour changing. Its team colour is the blue of its first
colours (East Germany national football team, Wikipedia, revision 1377070853).

**Who fields it.** A season lists East Germany only when its source rates its players, and the loader refuses one after
1990; `fieldedNations` fields it only in a season of its years. So:

| Season | East Germany |
| --- | --- |
| Football 1973/74 (computed World Cup) | its 1974 finalists: Croy; Bransch, Weise, Kische, Kurbjuweit; Sparwasser, Irmscher, Pommerenke, Lauck; Streich, Hoffmann (strength 80) |
| Football 1989/90 (Simon Treanor's database) | the 1,431 rated 'Germany' players of the 67 East German clubs (`noNationAt.playsFor`): Bräutigam; Rohde, Reich, Böger; Sammer, Doll, Ernst, Scholz, Steinmann; Thom, Kirsten (69) |
| Football 1962/63 to 1988/89 between the World Cups (computed national teams, added 2026-11-13) | its Wikidata players of each season ([football-years.md](football-years.md#computed-national-team-seasons)): in 1975/76 Croy; Weise, Bransch, Kische, Dörner; Lauck, Sparwasser, Weber; Riediger, Hoffmann, Streich (80) |
| The other computed World Cups to 1989/90 | no team: not a finalist; its land neutral |
| Tennis and women's tennis to 1990 | no team: it never played the Davis Cup or the Fed Cup; its land neutral |
| Ice hockey and baseball to 1990 | no team: no NHL or MLB player was born there before; its land neutral |
| Everything later | not on the map |

The 1989/90 database files East Germans as 'Germany', so the club rule decides (`scripts/lib/east-german-clubs.mjs`):
an East German playing in the West counts as West German (Andreas Thom joined Leverkusen in December 1989; the
database still has him at Dynamo Berlin, so he plays for East Germany).

**Saves and seeds.** Nothing of today's map changed, so every campaign of today's season, and every seed, replays as
before. A campaign of a season to 1990 saved before this change has no owner for East Germany: it loads with its land
neutral, as the Pacific islands did, and West Germany keeps what it held of the west. The 1974 and 1989/90 season files
changed (new versions), so their earlier challenge links and saves play the new files' teams from the save's own
packed players, as any season update does.

## South Vietnam

South Vietnam (the Republic of Vietnam, to the fall of Saigon on 30 April 1975; South Vietnam, Wikipedia, revision
1384578494) played the Davis Cup as Vietnam, and the tennis seasons of 1964 and 1965 field its team (Hoang Duc Luu, Van
Bay). It held the whole of Vietnam's shape, under today's name and flag. Now every season ending in 1975 or before cuts
Vietnam the same way as Germany, along the line Natural Earth's provinces of Quảng Trị and southwards share with Quảng
Bình, from the South China Sea (107.007°E, 17.162°N) to the tripoint with Laos (106.534°E, 16.951°N). The 1954
demarcation line followed the Bến Hải river a few kilometres south of it (Vĩnh Linh, between the two, was North
Vietnam's); at the map's scale they are one line. Vietnam (704) keeps its id for the north, today's state's predecessor,
anchored on Hanoi; South Vietnam (RVN) is a nation of the map's earlier years (`HISTORIC_THROUGH.RVN = 1975`), anchored on
Saigon, under its Commons flag (public domain, PD-ineligible), yellow on the political map. Its IOC code of the day is
VNM. Laos's copy reads its border arc with Vietnam in two pieces, so it borders both.

The tennis builder plays a 'VIE' cup player of 1975 or before for South Vietnam (`nations.dayNations` in
`scripts/data/tennis-seasons.json`; the Democratic Republic of Vietnam played neither cup): only `tennis-1964` and
`tennis-1965` change, Vietnam's land in them neutral. No other season fields either Vietnam.

| Map | Seasons | Vietnam |
| --- | --- | --- |
| Up to 1975 | every season ending in 1975 or before | Vietnam (704: the north, Hanoi) and South Vietnam (RVN: Saigon) |
| From 1976 | every later season | Vietnam (704) |

## Names of the day

A season plays a nation under the name, code and flag of its day (`src/data/namesOfTheDay.js`), as football's seasons of
1961/62 to 1995/96 already did from their own files (`identities`, which win). The holder keeps its land's own name
("Ukraine, held by Soviet Union").

| Name of the day | Shape | Years | Sports |
| --- | --- | --- | --- |
| Czechoslovakia (TCH) | Czechia | to 1992 | tennis, women's tennis, ice hockey |
| Soviet Union (URS) | Russia | to 1991 | tennis, women's tennis, ice hockey |
| CIS | Russia | 1992 | tennis, women's tennis, ice hockey |
| Yugoslavia (YUG) | Serbia | to 1991 | tennis, women's tennis, ice hockey |
| West Germany (FRG) | Germany | to 1990 | tennis, women's tennis, ice hockey |
| United Arab Republic (UAR) | Egypt | to 1971 | tennis, women's tennis |
| FR Yugoslavia (YUG) | Serbia | 1992–2002 | tennis, women's tennis, ice hockey, football |
| Serbia and Montenegro (SCG) | Serbia | 2003–2006 | tennis, women's tennis, ice hockey, football |
| Swaziland | Eswatini | to 2017 | every sport |
| Macedonia | North Macedonia | to 2018 | every sport |

Tennis's seasons already fielded these federations' players as one team and gave them their members' land (its nations
of the day, [tennis.md](tennis.md#nations-of-the-day)); only the names and flags were today's. Ice hockey's earlier
seasons do the same since 2026-11-13 (`FEDERATIONS` in `scripts/lib/nhl-seasons.mjs`, held to tennis's table): an NHL
player born in Slovakia plays for Czechoslovakia to 1991/92, one born in another Soviet republic for the Soviet Union to
1990/91 and the CIS in 1991/92, and the federation holds its members' land where it fields a real side, so the 1980s'
seasons field Czechoslovakia and 1989/90 and 1990/91 the Soviet Union ([hockey.md](hockey.md), "Federations of the day"). Football's seasons from
1996/97 hold Montenegro in Serbia's empire, as FR Yugoslavia did. The South Vietnam and United Arab Republic flags are
new (Commons, public domain: PD-ineligible and PD-Egypt), redrawn as the others.

## Known gaps

- **Yemen** was divided until May 1990 (North and South Yemen). No season fields either, so its land is neutral either
  way, and the map keeps one Yemen. Vietnam (704) keeps its name for the north up to 1975: a land keeps its name.
- **Rhodesia** (to 1979) plays as Zimbabwe in the tennis seasons that field it (1963, 1964, 1975, 1978, 1979; women's
  1971, 1972): the Commons drawing of its 1968 flag is 580 KB, too large to ship.
- **Macedonia's flag** of 1992 to 1995 (the Vergina sun): its Commons page offers it under a mix of licences, so
  1993/94 and 1994/95 fly today's.
- Colonies stay neutral, as before: the map has no colonial empires.

## Checks

`scripts/historic-maps.test.mjs`: today's map is the atlas itself, the historic arcs come after today's, the map of 1990
(adjacency, every other shape point for point, Czechoslovakia's outline, the capitals), East Germany's nation, flag,
colour and seasons, the loader's refusal after 1990, `mapYearOf`, and the names of the day by sport and year.
`scripts/campaign-reachability.test.mjs` plays the map of 1974 with every nation and probes East and West Germany alone
against the world; `scripts/geography.test.mjs` checks every capital, Bonn and East Berlin included, lies in its own land
on both maps. `npm run build:home-nations -- --check`, `build:historic-flags -- --check`, `build:flag-symbols -- --check`,
`build:world-cup-seasons -- --check` and `build:retro-seasons -- --check` rebuild everything byte for byte.
`scripts/hockey-computed.test.mjs` holds ice hockey's federations of the day to tennis's and checks who plays for them.
