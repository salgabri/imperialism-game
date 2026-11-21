// Every European club's strength in each earlier football season, on one scale across every country
// (scripts/lib/club-strength.mjs; docs/design/domestic-campaigns.md, "The Europe maps"), into
// scripts/data/club-strength.json (committed): what the earlier seasons' Top 124 and Elite 32 are drawn by
// (scripts/lib/europe-field.mjs).
//
// The results come from David Schoch's football-data (https://github.com/schochastics/football-data, Open Data Commons
// Attribution License 1.0): data/results/games.parquet, every game of 207 top divisions and the international club
// cups since 1888, at the commit the file pins (`source`), fetched through raw.githubusercontent.com into the gitignored
// data-src/football-results/ and read only when its SHA-256 is the one pinned.
//
// Usage: node scripts/build-club-strength.mjs [--fetch] [--pin=<commit>] [--check]
//   --fetch         download the pinned file when data-src/football-results/ lacks it
//   --pin=<commit>  pin the file at another commit of the repository (download it, record its SHA-256), then build
//   --check         rebuild and compare with the committed file byte for byte; writes nothing
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchFile } from './lib/polite-fetch.mjs';
import { readParquet } from './lib/parquet.mjs';
import { LEAGUE_COUNTRIES, STRENGTH_RULES, clubStrengths } from './lib/club-strength.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'scripts/data/club-strength.json');
const cacheFile = path.join(root, 'data-src/football-results/games.parquet');

const REPOSITORY = 'schochastics/football-data';
const FILE = 'data/results/games.parquet';
// The seasons ranked, by the year each ends: 1993/94 (the first earlier season with clubs) to 2025/26.
export const FIRST_SEASON = 1994, LAST_SEASON = 2026;
// How many clubs each season keeps, strongest first: well past the 124 a field takes, so a club with no squad in the
// season's sources (scripts/lib/europe-field.mjs) leaves room enough below it.
export const KEPT = 300;

/**
 * The results' countries as the game's map shapes (src/data/teams.js NATIONS ids). The six with no shape of their own on
 * the map (Andorra, the Faroe Islands, Gibraltar, Liechtenstein, Malta, San Marino) are null: their clubs hold no land,
 * so none is ranked, though their games still count for their opponents and leagues. So is Kazakhstan, a UEFA member
 * in Asia, whose land would stretch a map of Europe past the Urals to China's border (Astana, Almaty).
 */
export const RESULT_COUNTRIES = Object.freeze({
  albania: '008', andorra: null, armenia: '051', austria: '040', azerbaijan: '031', belarus: '112', belgium: '056',
  'bosnia-herzegovina': '070', bulgaria: '100', croatia: '191', cyprus: '196', 'czech-republic': '203', denmark: '208',
  england: '826', estonia: '233', 'faroe-islands': null, finland: '246', france: '250', georgia: '268', germany: '276',
  gibraltar: null, greece: '300', hungary: '348', iceland: '352', 'ireland-republic': '372', israel: '376', italy: '380',
  kazakhstan: null, kosovo: 'KOS', latvia: '428', liechtenstein: null, lithuania: '440', luxembourg: '442', malta: null,
  moldova: '498', montenegro: '499', netherlands: '528', 'north-macedonia': '807', 'northern-ireland': 'NIR',
  norway: '578', poland: '616', portugal: '620', romania: '642', russia: '643', 'san-marino': null, scotland: 'SCO',
  serbia: '688', slovakia: '703', slovenia: '705', spain: '724', sweden: '752', switzerland: '756', turkey: '792',
  ukraine: '804', wales: 'WAL',
});

const ABOUT = 'How strong each European club was in each earlier football season, on one scale across every country: league levels '
  + 'fitted to every UEFA cup game, plus each club\'s standing in its own league and its European form (scripts/lib/club-strength.mjs). '
  + 'An earlier season\'s Top 124 and Elite 32 are its strongest clubs that the season\'s sources give a squad (scripts/lib/europe-field.mjs). '
  + 'Each season, by the year it ends, lists its strongest clubs that played a top-division game that season: [the results\' club, '
  + 'its map shape, strength in Elo points, and the shape of the league it played in where that is another country\'s]. '
  + 'Computed from David Schoch\'s football-data (Open Data Commons Attribution License 1.0) '
  + 'by scripts/build-club-strength.mjs.';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rawUrl = commit => `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${FILE}`;

/** The pinned results file's bytes, fetched when asked and absent. */
async function resultsFile(source, { fetch }) {
  if (!existsSync(cacheFile)) {
    if (!fetch) throw new Error(`${path.relative(root, cacheFile)} is missing: run node scripts/build-club-strength.mjs --fetch`);
    const bytes = await fetchFile(rawUrl(source.commit));
    if (sha256(bytes) !== source.sha256) throw new Error(`${FILE} at ${source.commit} is not the pinned file`);
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
    console.log(`fetched ${REPOSITORY}/${FILE} at ${source.commit.slice(0, 8)} (${Math.round(bytes.length / 1024)} KB)`);
  }
  const bytes = await readFile(cacheFile);
  if (sha256(bytes) !== source.sha256) throw new Error(`${path.relative(root, cacheFile)} is not the pinned file (SHA-256 ${source.sha256})`);
  return bytes;
}

/** The file's rows as clubStrengths reads them: dates as YYYY-MM-DD. */
function rowsOf(bytes) {
  const rows = readParquet(new Uint8Array(bytes), { columns: ['home', 'away', 'date', 'gh', 'ga', 'full_time', 'competition',
    'home_ident', 'away_ident', 'home_country', 'away_country', 'home_continent', 'away_continent', 'level'] });
  // Clubs by their ident ("Name (Country)"), which tells apart clubs of one name in two countries.
  return rows.map(row => ({ ...row, home: row.home_ident, away: row.away_ident, date: new Date(row.date * 86400000).toISOString().slice(0, 10) }));
}

/** The committed document from the results' rows. */
export function strengthDocument(rows, source) {
  const unknown = [...new Set(rows.filter(row => row.home_continent === 'Europe').map(row => row.home_country))]
    .filter(country => !Object.hasOwn(RESULT_COUNTRIES, country));
  if (unknown.length) throw new Error(`Results countries with no map shape listed: ${unknown.join(', ')}`);
  const seasons = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
  const { seasons: ranked, fit } = clubStrengths(rows, seasons);
  const lastGame = rows.reduce((last, row) => (row.date > last ? row.date : last), '');
  return {
    about: ABOUT,
    source: { ...source, lastGame },
    rules: STRENGTH_RULES,
    fit: { uefaGames: fit.games, homeAdvantage: Math.round(fit.home * 10) / 10, logLoss: Math.round(fit.logLoss * 10000) / 10000 },
    // A club in another country's league (Swansea in England's, Monaco in France's) names that league's shape too.
    seasons: Object.fromEntries(seasons.map(season => [season, ranked[season]
      .filter(entry => RESULT_COUNTRIES[entry.country])
      .slice(0, KEPT)
      .map(entry => {
        const shape = RESULT_COUNTRIES[entry.country];
        const league = RESULT_COUNTRIES[LEAGUE_COUNTRIES[entry.league]?.[0] ?? entry.league] ?? null;
        return [entry.club, shape, Math.round(entry.strength), ...(league && league !== shape ? [league] : [])];
      })])),
  };
}

/** The document as written: two-space JSON, each season's clubs one to a line. */
export function serializeStrengths(doc) {
  const { seasons, ...head } = doc;
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  const lines = Object.entries(seasons).map(([season, clubs]) => `    "${season}": [\n${clubs.map(club => `      ${JSON.stringify(club)}`).join(',\n')}\n    ]`);
  return `${body},\n  "seasons": {\n${lines.join(',\n')}\n  }\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check'), fetch = args.includes('--fetch');
  const pinTo = args.find(arg => arg.startsWith('--pin='))?.slice('--pin='.length);
  const committed = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : null;
  let source = committed?.source && { ...committed.source };
  if (pinTo) {
    if (!/^[0-9a-f]{40}$/.test(pinTo)) throw new Error('--pin takes a full 40-character commit');
    const bytes = await fetchFile(rawUrl(pinTo));
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
    source = { name: 'football-data, results', author: 'David Schoch', url: `https://github.com/${REPOSITORY}`, file: FILE, commit: pinTo,
      sha256: sha256(bytes), licence: 'Open Data Commons Attribution License 1.0 (https://opendatacommons.org/licenses/by/1-0/)',
      retrieved: new Date().toISOString().slice(0, 10) };
    console.log(`pinned ${FILE} at ${pinTo.slice(0, 8)}: ${bytes.length} bytes, SHA-256 ${source.sha256}`);
  }
  if (!source) throw new Error('No pinned results file: run node scripts/build-club-strength.mjs --pin=<commit>');
  delete source.lastGame;
  const started = Date.now();
  const doc = strengthDocument(rowsOf(await resultsFile(source, { fetch })), source);
  const text = serializeStrengths(doc);
  console.log(`${doc.fit.uefaGames} UEFA games, home advantage ${doc.fit.homeAdvantage}, log loss ${doc.fit.logLoss}; last game ${doc.source.lastGame}; `
    + `${Object.keys(doc.seasons).length} seasons in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (check) {
    const current = existsSync(outFile) ? (await readFile(outFile, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== text) throw new Error(`${path.relative(root, outFile)} differs from a rebuild`);
    console.log(`${path.relative(root, outFile)} matches byte for byte`);
    return;
  }
  await writeFile(outFile, text);
  console.log(`wrote ${path.relative(root, outFile)} (${Math.round(text.length / 1024)} KB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
