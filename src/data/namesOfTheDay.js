// The names, codes and flags nations played under in a season of another day (docs/design/historic-maps.md, "Names of
// the day"), for the seasons whose files name none of their own. A season's file may carry its own (`identities`: men's
// football from 1961/62 to 1995/96, written by its builders from src/data/footballFederations.js), and those win.
//
// Each entry plays a holder shape under its name, code and flag from season-end year `from` to `through` (either open)
// in the sports it lists (every sport where it lists none). A sport lists a federation of the day only where its
// seasons already field the federation's players as one team and give it its members' land (tennis's nations of the
// day, docs/design/tennis.md; football's from 1996/97, whose seasons hold Montenegro in Serbia's empire): the name is
// all that was missing. A plain renaming holds in every sport. The holder keeps its land's own name ("Ukraine, held by
// Soviet Union"); the team, its map label, its flag and the chronicle play under the name of the day.

const TENNIS = Object.freeze(['tennis', 'womens-tennis']);

export const NAMES_OF_THE_DAY = Object.freeze([
  // Tennis's federations of the day (docs/design/tennis.md "Nations of the day", the table of the seasons' builder,
  // scripts/lib/tennis-seasons.mjs): the Davis Cup's and the Fed Cup's teams of their years.
  { shape: '203', name: 'Czechoslovakia', code: 'TCH', flagId: '203', through: 1992, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1383702424' },
  { shape: '643', name: 'Soviet Union', code: 'URS', flagId: 'URS', through: 1991, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384615907' },
  { shape: '643', name: 'CIS', code: 'CIS', flagId: 'CIS', from: 1992, through: 1992, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384484443' },
  { shape: '688', name: 'Yugoslavia', code: 'YUG', flagId: 'YUG', through: 1991, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1383935133' },
  { shape: '276', name: 'West Germany', code: 'FRG', flagId: '276', through: 1990, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384613198' },
  // Egypt kept the United Arab Republic's name and flag after Syria left it in 1961, until it became the Arab Republic
  // of Egypt on 11 September 1971 (United Arab Republic, Wikipedia, revision 1381605934).
  { shape: '818', name: 'United Arab Republic', code: 'UAR', flagId: 'UAR', through: 1971, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1381605934' },
  // FR Yugoslavia (Serbia and Montenegro) from 1992, renamed Serbia and Montenegro on 4 February 2003, until Montenegro's
  // independence in June 2006 (Serbia and Montenegro, Wikipedia, revision 1384922977). Football's seasons to 1995/96
  // carry it themselves (footballFederations.js FRY); those from 1996/97 were built before identities.
  { shape: '688', name: 'FR Yugoslavia', code: 'YUG', flagId: 'FRY', from: 1992, through: 2002, sports: [...TENNIS, 'football'],
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384922977' },
  { shape: '688', name: 'Serbia and Montenegro', code: 'SCG', flagId: 'FRY', from: 2003, through: 2006, sports: [...TENNIS, 'football'],
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384922977' },
  // Renamings, in every sport: Swaziland became Eswatini on 19 April 2018 (Eswatini, Wikipedia, revision 1380745431),
  // before the end of the 2017/18 season, and Macedonia (FIFA's "FYR Macedonia") North Macedonia on 12 February 2019
  // (North Macedonia, Wikipedia, revision 1380023340). Their flags did not change then. Macedonia's flag of 1992 to 1995
  // (the Vergina sun) is not the game's: 1993/94 and 1994/95 fly today's.
  { shape: '748', name: 'Swaziland', code: 'SWZ', flagId: '748', through: 2017,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1380745431' },
  { shape: '807', name: 'Macedonia', code: 'MKD', flagId: '807', through: 2018,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1380023340' },
  // States of another name, in every sport, under their flags of the day (src/data/flagsOfTheDay.js, which a flag id of
  // the shape's own reads): Zaire from 27 October 1971 to 17 May 1997, for the seasons whose files do not name it
  // (football's from SWOS 94/95; football's to 1995/96 name it themselves); Rhodesia, then Zimbabwe Rhodesia from
  // 1 June 1979, until Zimbabwe on 18 April 1980 (the Davis Cup's and the Fed Cup's teams of those years).
  { shape: '180', name: 'Zaire', code: 'ZAI', flagId: 'ZAI', from: 1972, through: 1996,
    source: 'https://en.wikipedia.org/wiki/Zaire' },
  { shape: '716', name: 'Rhodesia', code: 'RHO', flagId: '716', through: 1978,
    source: 'https://en.wikipedia.org/wiki/Rhodesia' },
  { shape: '716', name: 'Zimbabwe Rhodesia', code: 'RHO', flagId: '716', from: 1979, through: 1979,
    source: 'https://en.wikipedia.org/wiki/Zimbabwe_Rhodesia' },
].map(entry => Object.freeze(entry)));

const inYears = (entry, year) => (entry.from ?? -Infinity) <= year && year <= (entry.through ?? Infinity);

/**
 * The names of the day of sport `sportId`'s season ending in `year` → `{ shape: { name, code, flagId } }` (empty for the
 * built-in season, which has no year).
 */
export function namesOfTheDay(sportId, year) {
  if (!Number.isInteger(year)) return {};
  return Object.fromEntries(NAMES_OF_THE_DAY.filter(entry => (!entry.sports || entry.sports.includes(sportId)) && inYears(entry, year))
    .map(({ shape, name, code, flagId }) => [shape, Object.freeze({ name, code, flagId })]));
}
