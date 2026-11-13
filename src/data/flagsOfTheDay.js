// The flags nations flew in a season of another day (docs/design/period-marks.md): a team that flies its own shape's
// flag flies the one that shape flew on the season's cutoff, 30 June of its year (a split season's year is the one it
// ends in), the day the football federations' tables count by (src/data/footballFederations.js). Spain under the eagle
// of 1977, Canada under the Red Ensign before 1965, the United States with 49 stars in 1960. The names a team plays
// under are src/data/namesOfTheDay.js's; a federation of the day (the Soviet Union) and Great Britain keep their own
// flags. A season of today (no data set) flies today's.
//
// FLAGS_OF_THE_DAY: shape → the flags it flew before today's, oldest first, each until the last day it flew (the
// first also covers everything before it, unless it has a `from`). Each flag id is src/data/flags.js's; the flags are
// Wikimedia Commons drawings (public domain, six CC BY-SA) pinned in scripts/data/historic-flags.json (with each
// flag's dates, source and licence) and drawn on flag-icons' 4:3 canvas by `npm run build:historic-flags`.

/** The day a season's flags are read on: 30 June of its year. */
export const cutoffOf = year => `${String(year).padStart(4, '0')}-06-30`;

const at = (until, flagId, from) => Object.freeze({ until, flagId, ...(from ? { from } : {}) });
const periods = (...list) => Object.freeze(list);

// Each date is the day a flag was last flown (the next one's adoption, a day earlier), from the flag's Wikipedia
// article; where it gives only a year, its 1 January is used, as FIFA's dates are (src/data/footballFederations.js).
// A table reaches back only as far as the seasons that field the nation: earlier flags are left out.
export const FLAGS_OF_THE_DAY = Object.freeze({
  // Albania: the red star came off the flag on 7 April 1992.
  '008': periods(at('1992-04-06', 'ALB-1946')),
  // Brazil: a 22nd star in 1960 (Guanabara), a 23rd in 1968 (Acre), 27 from 11 May 1992.
  '076': periods(at('1968-05-27', 'BRA-1960'), at('1992-05-10', 'BRA-1968')),
  // Bulgaria: the people's republic's arms of 1948, of 5 January 1967 and of 21 May 1971, until 27 November 1990.
  '100': periods(at('1967-01-04', 'BUL-1948'), at('1971-05-20', 'BUL-1967'), at('1990-11-26', 'BUL-1971')),
  // Burma, 3 January 1974 to 20 October 2010.
  '104': periods(at('2010-10-20', 'MYA-1974', '1974-01-03')),
  // Belarus's white-red-white flag, from 19 September 1991 to the referendum's flag of 7 June 1995.
  '112': periods(at('1995-06-06', 'BLR-1991', '1991-09-19')),
  // Canada: the Red Ensign until the Maple Leaf of 15 February 1965.
  '124': periods(at('1965-02-14', 'CAN-1957')),
  // The People's Republic of the Congo, 1970 to 10 June 1991.
  '178': periods(at('1991-06-09', 'CGO-1970', '1970-01-01')),
  // DR Congo, after Zaire (src/data/namesOfTheDay.js): 17 May 1997 to 19 February 2006.
  '180': periods(at('2006-02-19', 'COD-1997', '1997-05-17')),
  // The People's Republic of Benin, 30 November 1975 to 1 August 1990.
  '204': periods(at('1990-07-31', 'BEN-1975', '1975-11-30')),
  // Ethiopia's plain tricolour, from 28 May 1991 to 6 February 1996.
  '231': periods(at('1996-02-05', 'ETH-1991', '1991-05-28')),
  // Georgia, 14 November 1990 to 14 January 2004.
  '268': periods(at('2004-01-13', 'GEO-1990', '1990-11-14')),
  // Greece's land flag: the cross with the crown until 18 August 1969, the stripes (today's) until 7 June 1975, the
  // plain cross until 22 December 1978.
  '300': periods(at('1969-08-17', 'GRE-1863'), at('1975-06-06', '300'), at('1978-12-21', 'GRE-1822')),
  // Haiti: black and red from 21 May 1964 to 25 February 1986.
  '332': periods(at('1986-02-24', 'HAI-1964', '1964-05-21')),
  // Honduras: turquoise from 27 January 2022 until navy blue came back on 27 January 2026.
  '340': periods(at('2026-01-26', 'HON-2022', '2022-01-27')),
  // Iran: the lion and sun, drawn anew in 1964, until 29 July 1980.
  '364': periods(at('1963-12-31', 'IRN-1933'), at('1980-07-28', 'IRN-1964')),
  // Iraq: 1963's three stars, the takbir added on 14 January 1991, redrawn on 28 July 2004, today's from 22 January 2008.
  '368': periods(at('1991-01-13', 'IRQ-1963', '1963-07-31'), at('2004-07-27', 'IRQ-1991'), at('2008-01-21', 'IRQ-2004')),
  // Lesotho, 20 January 1987 to 4 October 2006.
  '426': periods(at('2006-10-03', 'LES-1987', '1987-01-20')),
  // Libya's plain green, 11 November 1977 to the United Nations' recognition of 16 September 2011.
  '434': periods(at('2011-09-15', 'LBY-1977', '1977-11-11')),
  // Mexico: the arms of 1934 until 16 September 1968.
  '484': periods(at('1968-09-15', 'MEX-1934')),
  // Romania: the people's republic's arms of 1952, the socialist republic's of 21 August 1965, until 27 December 1989.
  '642': periods(at('1965-08-20', 'ROU-1952'), at('1989-12-26', 'ROU-1965')),
  // Russia, where a season plays it as itself (hockey's birthplaces): the Russian SFSR's flag until 22 August 1991.
  '643': periods(at('1991-08-21', 'RUS-1954')),
  // South Africa: the flag of 1928 until 27 April 1994.
  '710': periods(at('1994-04-26', 'RSA-1928')),
  // Rhodesia (src/data/namesOfTheDay.js): the Federation's flag to 1963, Rhodesia's of 1964 and of 11 November 1968,
  // Zimbabwe Rhodesia's of 1 June 1979, until British rule from 12 December 1979 (no season's cutoff falls in it).
  '716': periods(at('1963-12-31', 'RNY-1953'), at('1968-11-10', 'RHO-1964'), at('1979-05-31', 'RHO-1968'), at('1979-12-11', 'ZRH-1979')),
  // Spain: the eagle of 1945, the eagle of 21 January 1977, until today's arms of 5 October 1981.
  '724': periods(at('1977-01-20', 'ESP-1945'), at('1981-10-04', 'ESP-1977')),
  // Syria: the United Arab Republic's flag again from 30 March 1980, until today's, adopted on 13 March 2025.
  '760': periods(at('2025-03-12', 'UAR', '1980-03-30')),
  // Macedonia: the Vergina sun, 11 August 1992 to 5 October 1995.
  '807': periods(at('1995-10-04', 'MKD-1992', '1992-08-11')),
  // The United States: 49 stars from 4 July 1959 to 3 July 1960.
  '840': periods(at('1960-07-03', 'USA-1959', '1959-07-04')),
  // Venezuela: seven stars until the eighth of 12 March 2006.
  '862': periods(at('2006-03-11', 'VEN-1930')),
});

/** The flag id shape `id` flew in season year `year`, or null for today's flag (or no year: a season of today). Pure. */
export function flagOfTheDay(id, year) {
  if (year == null) return null;
  const date = cutoffOf(year);
  for (const entry of FLAGS_OF_THE_DAY[id] || []) {
    if ((entry.from == null || entry.from <= date) && date <= entry.until) return entry.flagId;
  }
  return null;
}
