// Europe's first divisions as the game names them, each with the world shape its clubs hold land in (the Welsh clubs of
// the Premier League hold Wales instead: scripts/data/europe-clubs.json `shape`). The club layer of every season, the
// built-in one (scripts/lib/first-divisions.mjs) and each earlier one (scripts/build-ea-seasons.mjs,
// scripts/build-retro-seasons.mjs), takes Europe's strongest clubs from these leagues' top divisions, and a season's club
// must play in one of them (src/engine/footballSets.js), so a club's league reads the same in every season. A league
// that changed its name keeps today's (the Süper Lig, the Eliteserien); FR Yugoslavia's, which no source after 2004 holds,
// keeps its own. See docs/design/domestic-campaigns.md, "The Europe maps".
export const EUROPEAN_LEAGUES = Object.freeze({
  'Premier League': '826',
  'La Liga': '724',
  'Serie A': '380',
  Bundesliga: '276',
  'Ligue 1': '250',
  Eredivisie: '528',
  'Liga Portugal': '620',
  'Süper Lig': '792',
  'Belgian Pro League': '056',
  'Greek Super League': '300',
  'Czech First League': '203',
  'Scottish Premiership': 'SCO',
  'Danish Superliga': '208',
  Eliteserien: '578',
  'Ukrainian Premier League': '804',
  'Croatian HNL': '191',
  Ekstraklasa: '616',
  'Swiss Super League': '756',
  'Austrian Bundesliga': '040',
  'Azerbaijan Premier League': '031',
  'Hungarian NB I': '348',
  'Romanian Liga I': '642',
  'Cypriot First Division': '196',
  Allsvenskan: '752',
  Veikkausliiga: '246',
  'League of Ireland': '372',
  'Bulgarian First League': '100',
  'Russian Premier League': '643',
  'Yugoslav First League': '688',
  'Irish League': 'NIR',
  'Welsh Premier League': 'WAL',
  'Luxembourg National Division': '442',
  // Since 21 November 2026 an earlier season's field is Europe's strongest clubs by results (scripts/lib/europe-field.mjs),
  // from every country with a shape on the map, so every other first division is named too.
  'Serbian SuperLiga': '688',
  'Montenegrin First League': '499',
  'Slovak First League': '703',
  'Slovenian PrvaLiga': '705',
  'Premier League of Bosnia and Herzegovina': '070',
  'Macedonian First League': '807',
  'Kategoria Superiore': '008',
  'Belarusian Premier League': '112',
  'Moldovan Super Liga': '498',
  'Israeli Premier League': '376',
  'Kazakhstan Premier League': '398',
  'Erovnuli Liga': '268',
  'Armenian Premier League': '051',
  'A Lyga': '440',
  'Latvian Higher League': '428',
  'Meistriliiga': '233',
  'Besta deild': '352',
  'Kosovo Superleague': 'KOS',
});

/** The seven big leagues: every season with clubs fields clubs from each of them. */
export const BIG_LEAGUES = Object.freeze(['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Eredivisie', 'Liga Portugal']);

// Each shape's first division, the first EUROPEAN_LEAGUES names for it (FR Yugoslavia's before Serbia's own).
const FIRST_DIVISION = new Map();
for (const [league, country] of Object.entries(EUROPEAN_LEAGUES)) if (!FIRST_DIVISION.has(country)) FIRST_DIVISION.set(country, league);

/**
 * The first division of the country of shape `country` in the season ending in `year`, as the game names it, or null:
 * FR Yugoslavia's league (and Serbia and Montenegro's, which keeps its name) for Serbia's and Montenegro's clubs up to
 * 2005/06, then each country's own.
 */
export function firstDivisionOf(country, year) {
  if (country === '688' || country === '499') return year <= 2006 ? 'Yugoslav First League' : country === '688' ? 'Serbian SuperLiga' : 'Montenegrin First League';
  return FIRST_DIVISION.get(country) ?? null;
}
