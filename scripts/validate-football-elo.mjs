// How well each game-rated football season's national XIs agree with World Football Elo on the day the season starts
// (docs/design/roster-audit.md, "Ratings against results"): the Spearman correlation of the strength each fielded
// nation plays at with its Elo rating, by the squad gate's own code (scripts/football-validate.mjs crossSectional).
// The gate scores only the built-in season and EA FC 26; this scores every season a game or a database rates. The
// computed seasons (nt-, wc-) are built from match results, so results cannot check them, and are left out.
//
//   npm run validate:football-elo                  fetches the Elo files it lacks, scores every season, writes the report
//   npm run validate:football-elo -- --offline     never fetches (a season without its files is listed as unscored)
//   npm run validate:football-elo -- --check       recomputes offline and exits 1 when the committed report differs
//   npm run validate:football-elo -- --elo-dir=<d> the Elo cache elsewhere (default data-src/validation/elo)
//
// Elo is eloratings.net's yearly TSVs, cached in the ignored data-src/validation/elo/ through the gate's loader
// (loadEloFiles: robots.txt first, the generic User-Agent, 1.5 s apart). Elo on a day is the previous year-end table
// replayed through that year's results to the day, checked against the year's own table. The report carries
// correlations and ranks only, never an Elo value, as the gate's does.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';
import { fieldedNations } from '../src/engine/footballSets.js';
import { ELO_CODES } from './lib/elo-codes.mjs';
import { loadSeasons } from './lib/roster-audit.mjs';
import { crossSectional, eloAtRatingsDate, loadEloFiles, replayFiles, spearman } from './football-validate.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPORT_FILE = 'docs/design/football-elo-agreement.json';
/** Seasons built from match results, which results cannot check. */
const COMPUTED = /^(?:nt|wc)-/;
/**
 * World Football Elo's codes of a nation's earlier names, which its tables of those years use: tried, in order, when
 * today's code (ELO_CODES) is not in the table of the day. Without them 1989/90 scored no West Germany, Soviet Union
 * or Yugoslavia, and 26 seasons no Macedonia.
 */
export const PERIOD_ELO_CODES = Object.freeze({
  276: ['WG'], // West Germany, to 1990
  278: ['DD'], // East Germany
  643: ['SU'], // the Soviet Union, to 1991
  688: ['RM', 'YU'], // Serbia and Montenegro (2003–2006), Yugoslavia (to 2002)
  203: ['CS'], // Czechoslovakia, to 1993
  180: ['ZR'], // Zaire, to 1997
  807: ['MK'], // Macedonia, to 2019
  748: ['SZ'], // Swaziland, to 2018
});

/** Each nation's code in Elo table `ratings` (a Map by code): today's, else the first earlier one the table holds. */
export const codesIn = ratings => Object.fromEntries(Object.keys(NATIONS).map(id => [id,
  [ELO_CODES[id], ...(PERIOD_ELO_CODES[id] ?? [])].find(code => code && ratings?.has(code)) ?? ELO_CODES[id] ?? null]));

/** The day a season starts, YYYY-MM-DD: 1 July of its first year ('1993/94' → 1993-07-01), or 1 January of a calendar year. */
export const startOf = ({ year, season }) => (String(season).includes('/') ? `${year - 1}-07-01` : `${year}-01-01`);

/**
 * One season scored: `elo` is eloAtRatingsDate's answer for the season's start. Returns the report's row: the nations
 * fielded and scored, Spearman and Pearson over all of them, the 95% bootstrap interval, the weighted
 * within-confederation Spearman and the top 50 by Elo, and the three XIs placed furthest above and below their Elo.
 */
export function scoreSeason(season, elo, { codes = codesIn(elo?.ratings) } = {}) {
  const fielded = fieldedNations(season.sport);
  const result = crossSectional({ season: { nationStatus: {} }, rosters: season.sport.rosters, nations: NATIONS, fielded, elo, codes });
  const row = { id: season.id, season: season.season, label: season.label, ratingsDate: startOf(season), fielded: fielded.length };
  if (!result.allNations) return { ...row, scored: 0, reasons: result.reasons };
  const gap = ({ name, strengthRank, eloRank }) => `${name} ${strengthRank} by strength, ${eloRank} by Elo`;
  // The nations whose source rates all eleven of their XI: what the ratings say where no empty place (worth 40) does.
  const { rosters } = season.sport, eloOf = id => elo.ratings.get(codes[id]);
  const full = fielded.filter(id => rosters[id]?.[2]?.length === 11 && Number.isFinite(eloOf(id)));
  return {
    ...row,
    scored: result.allNations.n,
    spearman: result.allNations.spearman,
    pearson: result.allNations.pearson,
    fullXIs: { n: full.length, spearman: Math.round(spearman(full.map(id => rosters[id][0]), full.map(eloOf)) * 1e4) / 1e4 },
    spearmanCi95: result.gateSet.spearmanCi95,
    withinConfederation: result.withinConfederation.weightedSpearman,
    top50ByElo: result.top50ByElo.spearman,
    aboveElo: result.rankGaps.squadAboveElo.slice(0, 3).map(gap),
    belowElo: result.rankGaps.squadBelowElo.slice(0, 3).map(gap),
    noElo: result.missingElo.map(id => NATIONS[id]?.[0] ?? id),
    // A team the year's own table holds and the replay cannot is one rated before its first match (Montenegro, seeded
    // in 2006, first played in 2007); none may be a nation the season fields.
    elo: { method: elo.method, replayCheck: elo.check?.teams ? `${elo.check.exact}/${elo.check.teams} exact` : null,
      notReplayed: elo.check?.mismatched ?? [],
      fieldedNotReplayed: fielded.filter(id => elo.check?.mismatched?.includes(codes[id])).map(id => NATIONS[id]?.[0] ?? id) },
    ...(elo.reasons?.length ? { reasons: elo.reasons } : {}),
  };
}

/** Every game-rated football season with national teams, scored. */
export async function runEloAgreement({ root = ROOT, eloDir = path.join(root, 'data-src/validation/elo'), offline = false, log = () => {} } = {}) {
  const seasons = loadSeasons(pathToFileURL(`${root}${path.sep}`), { sports: ['football'] })
    .filter(season => season.nations && !COMPUTED.test(season.id));
  const names = seasons.flatMap(season => Object.values(replayFiles(startOf(season))));
  const files = await loadEloFiles(names, { eloDir, offline, log });
  const rows = seasons.map(season => scoreSeason(season, eloAtRatingsDate(startOf(season), files)))
    .sort((a, b) => a.ratingsDate.localeCompare(b.ratingsDate) || a.id.localeCompare(b.id));
  const scored = rows.filter(row => Number.isFinite(row.spearman));
  const median = values => { const s = values.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  return {
    generatedBy: 'scripts/validate-football-elo.mjs',
    note: 'Each game-rated football season\'s national XIs against World Football Elo (eloratings.net) on the day the season starts: Spearman of the strength each fielded nation plays at with its Elo, by the squad gate\'s crossSectional. Correlations and ranks only, never an Elo value. The computed seasons (nt-, wc-) are built from results and are not scored. docs/design/roster-audit.md reads them.',
    summary: { seasons: rows.length, scored: scored.length, medianSpearman: median(scored.map(row => row.spearman)),
      lowest: scored.slice().sort((a, b) => a.spearman - b.spearman).slice(0, 5).map(row => `${row.id} ${row.spearman}`) },
    seasons: rows,
  };
}

async function main(argv) {
  const args = Object.fromEntries(argv.map(arg => { const [k, v] = arg.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  for (const key of Object.keys(args)) if (!['offline', 'check', 'elo-dir'].includes(key)) throw new Error(`Unknown option --${key}`);
  const eloDir = typeof args['elo-dir'] === 'string' ? path.resolve(args['elo-dir']) : path.join(ROOT, 'data-src/validation/elo');
  const report = await runEloAgreement({ eloDir, offline: !!args.offline || !!args.check, log: line => console.log(line) });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  for (const row of report.seasons) {
    console.log(`${row.id.padEnd(26)} ${row.ratingsDate}  ${String(row.scored).padStart(3)}/${String(row.fielded).padEnd(3)} `
      + `${Number.isFinite(row.spearman) ? `Spearman ${row.spearman.toFixed(3)}` : `unscored: ${(row.reasons ?? []).join('; ')}`}`);
  }
  console.log(`median Spearman ${report.summary.medianSpearman} over ${report.summary.scored} of ${report.summary.seasons} seasons`);
  const file = path.join(ROOT, REPORT_FILE);
  if (args.check) {
    const committed = await readFile(file, 'utf8').catch(() => null);
    if (committed !== text) { console.error(`${REPORT_FILE} differs from a rerun`); process.exit(1); }
    console.log(`${REPORT_FILE} reproduces`);
  } else {
    await writeFile(file, text);
    console.log(`Wrote ${REPORT_FILE}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
