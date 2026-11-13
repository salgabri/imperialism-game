// The names, codes and flags nations played under in a season of another day (docs/design/historic-maps.md, "Names of
// the day"), for the seasons whose files name none of their own. A season's file may carry its own (`identities`: men's
// football from 1961/62 to 1995/96, written by its builders from src/data/footballFederations.js), and those win.
//
// Each entry plays a holder shape under its name, code and flag from season-end year `from` to `through` (either open)
// in the sports it lists (every sport where it lists none). A sport lists a federation of the day only where its
// seasons already field the federation's players as one team and give it its members' land (tennis's nations of the
// day, docs/design/tennis.md; ice hockey's earlier seasons, scripts/lib/nhl-seasons.mjs FEDERATIONS; football's from
// 1996/97, whose seasons hold Montenegro in Serbia's empire): the name is all that was missing. A plain renaming holds
// in every sport. The holder keeps its land's own name ("Ukraine, held by Soviet Union"); the team, its map label, its
// flag and the chronicle play under the name of the day.

const TENNIS = Object.freeze(['tennis', 'womens-tennis']);
// The sports whose seasons play the federations of the day: tennis's and ice hockey's.
const FEDERATIONS = Object.freeze([...TENNIS, 'hockey']);

export const NAMES_OF_THE_DAY = Object.freeze([
  // The federations of the day (docs/design/tennis.md "Nations of the day", the table of tennis's seasons' builder,
  // scripts/lib/tennis-seasons.mjs, which ice hockey's follows): the Davis Cup's and the Fed Cup's teams of their years,
  // and the NHL's players by the state they were born in then.
  { shape: '203', name: 'Czechoslovakia', code: 'TCH', flagId: '203', through: 1992, sports: FEDERATIONS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1383702424' },
  { shape: '643', name: 'Soviet Union', code: 'URS', flagId: 'URS', through: 1991, sports: FEDERATIONS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384615907' },
  { shape: '643', name: 'CIS', code: 'CIS', flagId: 'CIS', from: 1992, through: 1992, sports: FEDERATIONS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384484443' },
  { shape: '688', name: 'Yugoslavia', code: 'YUG', flagId: 'YUG', through: 1991, sports: FEDERATIONS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1383935133' },
  { shape: '276', name: 'West Germany', code: 'FRG', flagId: '276', through: 1990, sports: FEDERATIONS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384613198' },
  // Egypt kept the United Arab Republic's name and flag after Syria left it in 1961, until it became the Arab Republic
  // of Egypt on 11 September 1971 (United Arab Republic, Wikipedia, revision 1381605934).
  { shape: '818', name: 'United Arab Republic', code: 'UAR', flagId: 'UAR', through: 1971, sports: TENNIS,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1381605934' },
  // FR Yugoslavia (Serbia and Montenegro) from 1992, renamed Serbia and Montenegro on 4 February 2003, until Montenegro's
  // independence in June 2006 (Serbia and Montenegro, Wikipedia, revision 1384922977). Football's seasons to 1995/96
  // carry it themselves (footballFederations.js FRY); those from 1996/97 were built before identities.
  { shape: '688', name: 'FR Yugoslavia', code: 'YUG', flagId: 'FRY', from: 1992, through: 2002, sports: [...FEDERATIONS, 'football'],
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384922977' },
  { shape: '688', name: 'Serbia and Montenegro', code: 'SCG', flagId: 'FRY', from: 2003, through: 2006, sports: [...FEDERATIONS, 'football'],
    source: 'https://en.wikipedia.org/w/index.php?oldid=1384922977' },
  // Renamings, in every sport: Swaziland became Eswatini on 19 April 2018 (Eswatini, Wikipedia, revision 1380745431),
  // before the end of the 2017/18 season, and Macedonia (FIFA's "FYR Macedonia") North Macedonia on 12 February 2019
  // (North Macedonia, Wikipedia, revision 1380023340). Their flags did not change then. Macedonia's flag of 1992 to 1995
  // (the Vergina sun) is not the game's: 1993/94 and 1994/95 fly today's.
  { shape: '748', name: 'Swaziland', code: 'SWZ', flagId: '748', through: 2017,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1380745431' },
  { shape: '807', name: 'Macedonia', code: 'MKD', flagId: '807', through: 2018,
    source: 'https://en.wikipedia.org/w/index.php?oldid=1380023340' },
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
