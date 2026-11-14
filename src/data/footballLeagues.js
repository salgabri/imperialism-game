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
});

/** The seven big leagues: every season with clubs fields clubs from each of them. */
export const BIG_LEAGUES = Object.freeze(['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Eredivisie', 'Liga Portugal']);
