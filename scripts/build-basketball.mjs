// Generates src/data/rosters.basketball.js from the curated FIBA squad list plus
// the built-in season's NBA 2K ratings, as 2K Archive compiles them
// (scripts/data/nba-seasons.json; the pinned page in data-src/bball-2karchive/),
// and the built-in EuroLeague's estimates (scripts/data/euroleague-2026-27.json).
//
//   npm run build-basketball               writes the rosters and docs/design/basketball-nations-audit.json
//   npm run build-basketball -- --check    builds both and compares them byte for byte, writes nothing
//
// The audit reads FIBA's results (scripts/data/fiba-results.json, npm run sync:fiba-results): where each nation's
// results put its five against the nations the NBA and the EuroLeague rate, what moving its curated players would do,
// and how that predicts games held out (scripts/lib/fiba-nations.mjs; docs/design/euroleague.md, "The nations' level
// against FIBA's results"). The curated ratings are not moved: no rule that moves them predicted held-out games better.
//
// Why the split: no public dataset carries both current basketball ratings and
// nationality. 2K has real 1-99 overalls but no country; NBA bio datasets with a
// country column stop in 2014. FIBA eligibility follows the federation anyway,
// so nationality and positions are curated in fiba-squads.json and ratings are
// resolved by name: from 2K for an NBA player, from the EuroLeague's estimate for
// a EuroLeague one (each under his club's spelling of his name, so a five and a
// club agree), and from the curated rating for anyone else.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS, selectLineup } from '../src/data/teams.js';
import { BASELINE } from '../src/sports/basketball.js';
import { colourFor } from './lib/club-identity.mjs';
import { euroleagueClubs } from './lib/euroleague.mjs';
import { playerRecords, readSnapshots } from './lib/euroleague-seasons.mjs';
import { editionOf, readArchive } from './lib/nba-seasons.mjs';
import { CURATED_SHARE, YEAR_WEIGHTS, engineHomeEdge, engineMarginPerPoint, gamesOf, lineBand, nationOfName, nationsFit, regionOf, validation,
  windowEffect } from './lib/fiba-nations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SQUAD_SIZE = 5; // a starting five
const MAX_RATING = 99;
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Accent- and punctuation-insensitive, so "Doncic" matches "Dončić". */
const norm = s =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** "PG/SG" → ['PG', 'SG']: one position, or two neighbouring ones with the primary first. */
function parsePositions(listed, where) {
  const positions = String(listed).split('/');
  const at = positions.map(pos => POSITIONS.indexOf(pos));
  if (positions.length > 2 || at.includes(-1) || (positions.length === 2 && Math.abs(at[0] - at[1]) !== 1)) {
    throw new Error(`${where}: expected one of ${POSITIONS.join(' ')} or two neighbouring positions like PG/SG, got ${JSON.stringify(listed)}`);
  }
  return positions;
}

const curated = JSON.parse(await readFile(path.join(root, 'scripts', 'fiba-squads.json'), 'utf8'));
// The built-in season's NBA 2K, as 2K Archive compiles it: the page the NBA clubs come from (scripts/build-clubs.mjs).
const { manifest, years } = await readArchive(root);
const nba = years[String(manifest.builtIn.year)];
if (!Array.isArray(nba)) throw new Error(`2K Archive has no ${manifest.builtIn.edition}`);

// Each player plays under the name and at the rating the built-in season's clubs give him, so a national five and a
// club never show one man two ways: an NBA player's are NBA 2K's (its spelling, "Nikola Jokić"), a EuroLeague
// player's the built-in EuroLeague's estimate for every rostered player (scripts/lib/euroleague-ratings.mjs, the
// clubs' rule, its window reading the earlier seasons' snapshots). A name two of a source's players share resolves to neither.
const byName = (players, nameOf) => {
  const map = new Map();
  for (const p of players) map.set(norm(nameOf(p)), map.has(norm(nameOf(p))) ? null : p);
  return map;
};
const nbaByName = byName(nba, p => p.n);
const snapshot = JSON.parse(await readFile(path.join(root, 'scripts', 'data', 'euroleague-2026-27.json'), 'utf8'));
const identity = JSON.parse(await readFile(path.join(root, 'scripts', 'data', 'euroleague-teams.json'), 'utf8'));
const euroleagueTeams = Object.fromEntries(Object.entries(identity.clubs).map(([code, team]) => [code, { ...team, col: colourFor(team.id) }]));
const euroleagueByName = byName(euroleagueClubs(snapshot, euroleagueTeams, identity.names, playerRecords(readSnapshots(root))).players, p => p.name);
// A listed NBA player who has left the league since keeps his latest NBA 2K rating, the newest earlier edition first.
const earlierYears = Object.keys(years).map(Number).filter(year => year < manifest.builtIn.year).sort((a, b) => b - a);
function lastNbaRating(name) {
  for (const year of earlierYears) {
    const listed = years[String(year)].find(p => norm(p.n) === name);
    if (listed) return { name: listed.n.trim(), rating: Math.min(MAX_RATING, listed.o), edition: editionOf(year) };
  }
  return null;
}

const rosters = {};
const resolved = [];
const euroleague = [];
const former = [];
const missing = [];
const unknownNations = [];
const stretched = [];

for (const [id, players] of Object.entries(curated)) {
  if (id.startsWith('_')) continue;
  if (!NATIONS[id]) { unknownNations.push(id); continue; }

  const squad = [];
  for (const [name, listed, curatedRating] of players) {
    const positions = parsePositions(listed, `${NATIONS[id][0]}: ${name}`);
    const player = { name, pos: positions[0], positions };
    const fromNba = nbaByName.get(norm(name)), fromEuroleague = euroleagueByName.get(norm(name));
    if (fromNba) {
      squad.push({ ...player, name: fromNba.n.trim(), rating: Math.min(MAX_RATING, fromNba.o), source: 'nba' });
      resolved.push(name);
    } else if (fromEuroleague) {
      squad.push({ ...player, name: fromEuroleague.name, rating: fromEuroleague.rating, source: 'euroleague' });
      euroleague.push(`${NATIONS[id][0]}: ${fromEuroleague.name} ${fromEuroleague.rating} (${fromEuroleague.club})${curatedRating != null && curatedRating !== fromEuroleague.rating ? `, curated ${curatedRating}` : ''}`);
    } else if (curatedRating != null) {
      squad.push({ ...player, rating: Math.min(MAX_RATING, curatedRating), source: 'curated' });
    } else {
      const last = lastNbaRating(norm(name));
      if (last) {
        squad.push({ ...player, name: last.name, rating: last.rating, source: 'former' });
        former.push(`${NATIONS[id][0]}: ${last.name} ${last.rating} (${last.edition})`);
      } else {
        // Listed as an NBA player but in no NBA 2K edition's ratings — usually a
        // name spelling drift. Skip rather than invent a rating; the shirt is generated.
        missing.push(`${NATIONS[id][0]}: ${name}`);
      }
    }
  }
  if (!squad.length) continue;

  // The game fields the five through its lineup optimiser, so each curated five
  // must cover all five positions between its players' natural positions.
  const lineup = selectLineup({ sport: 'basketball', squad });
  for (const slot of lineup.slots) {
    if (slot.outOfPosition) stretched.push(`${NATIONS[id][0]}: ${slot.player.name} (${slot.player.positions.join('/')}) at ${slot.position}`);
  }

  // Strength is the mean of the five, an unfilled shirt at the sport's baseline (45, on every continent: not football's
  // confederation constants, whose order is football's), as hockey and baseball count one; buildTeam generates the
  // missing players from it.
  const ratings = squad.map(p => p.rating);
  const filled = ratings.concat(Array(Math.max(0, SQUAD_SIZE - ratings.length)).fill(BASELINE));
  const str = Math.round(filled.reduce((s, r) => s + r, 0) / filled.length);

  squad.sort((a, b) => b.rating - a.rating);
  rosters[id] = { str, squad };
}

const body = Object.entries(rosters)
  .map(([id, r]) => {
    const players = r.squad.map(p => `[${JSON.stringify(p.name)},'${p.positions.join('/')}',${p.rating}]`).join(',');
    return `  '${id}': [${r.str},${r.squad.length},[${players}]], // ${NATIONS[id][0]}`;
  })
  .join('\n');

const out = `// GENERATED by scripts/build-basketball.mjs — do not edit by hand.
//
// FIBA national starting fives. Each entry is [strength, realCount, squad], where
// squad is [name, positions, rating]. Most players cover two neighbouring
// positions, listed primary first ('PG/SG'). Ratings for NBA players come from
// ${manifest.builtIn.edition} (real 1-${MAX_RATING} overalls, as 2K Archive compiles them);
// EuroLeague players take the built-in EuroLeague's estimate (src/data/clubs.euroleague.js's
// rule), each under the name his club plays him by; other players carry a curated
// rating on the same scale. Nationality and positions are curated — see
// scripts/fiba-squads.json.

export const ROSTERS = {
${body}
};
`;

// ---- The nations' level against FIBA's results: measured, recorded, not applied (the audit's `decision`). ----
const facts = JSON.parse(await readFile(path.join(root, 'scripts', 'data', 'fiba-results.json'), 'utf8'));
const games = gamesOf(facts.games);
const fives = Object.fromEntries(Object.entries(rosters).map(([id, r]) => [id, r.squad]));
const names = {};
for (const game of games) for (const name of [game.a, game.b]) { const id = nationOfName(name); if (id && fives[id]) names[id] = name; }
const unplaced = Object.keys(fives).filter(id => !names[id]);
if (unplaced.length) throw new Error(`FIBA's results name no game of ${unplaced.map(id => NATIONS[id][0]).join(', ')}`);
const perPoint = engineMarginPerPoint();
const engineHome = engineHomeEdge();
const fit = nationsFit(games, fives, names, perPoint, { engineHome });
const tested = validation(games, fives, names, perPoint, { fullHomeEdge: fit.srs.homeEdge, engineHome });
const windows = windowEffect(games, fives, names);
const r2 = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const byCompetition = {};
for (const game of games) byCompetition[game.competition] = (byCompetition[game.competition] ?? 0) + 1;
const audit = {
  about: "Basketball's national fives against FIBA's men's results of 2023–2026 (scripts/build-basketball.mjs, scripts/lib/fiba-nations.mjs; "
    + "docs/design/euroleague.md, \"The nations' level against FIBA's results\"). T is a nation's results in lineup points from the field's mean "
    + "(√r × SRS ÷ the engine's margin a point); five is its five's strength as the engine plays it; stands is where the anchors' relation puts T; "
    + 'gap = stands − five; move is what the method would move its curated players by. Validation scores held-out games through the engine, '
    + 'each pair [the fives as they are, as the rule moves them].',
  facts: { file: 'scripts/data/fiba-results.json', games: games.length, byCompetition, retrieved: facts.source.retrieved },
  weights: { byYear: YEAR_WEIGHTS, competitions: 'the tournaments; the qualifiers only for a fielded nation no tournament rates' },
  srs: { ...fit.srs, homeEdge: r2(fit.srs.homeEdge), sigma: r2(fit.srs.sigma), reliability: r2(fit.srs.reliability, 3) },
  qualifierWindows: { ...windows, nations: Object.fromEntries(Object.entries(windows.nations).map(([id, w]) => [NATIONS[id][0], w])) },
  perPoint: r2(perPoint, 3), perResultsPoint: r2(fit.perResultsPoint, 4), engineHomeEdge: r2(engineHome),
  line: { anchors: fit.line.anchors.map(id => NATIONS[id][0]), level: r2(fit.line.level), centre: r2(fit.line.centre), slope: r2(fit.line.slope, 3),
    residualSd: r2(fit.line.residualSd), atCuratedFives: lineBand(fit) },
  regions: Object.fromEntries(['Europe', 'Americas', 'Africa', 'Asia'].map(region => {
    const curated = Object.entries(fit.nations).filter(([id, n]) => regionOf(id) === region && n.share >= CURATED_SHARE).map(([, n]) => n);
    return [region, { curatedFives: curated.length, meanGap: curated.length ? r2(curated.reduce((s, n) => s + n.gap, 0) / curated.length) : null }];
  })),
  nations: Object.fromEntries(Object.entries(fit.nations).sort((a, b) => b[1].T - a[1].T).map(([id, n]) => [id, {
    name: NATIONS[id][0], fiba: names[id], region: regionOf(id), curated: fives[id].filter(p => p.source === 'curated').length, ...n,
    ...(fit.aligned[id] ? { aligned: { ...fit.aligned[id], on: fit.aligned[id].on.map(j => NATIONS[j][0]) } } : {}) }])),
  marginOffsets: Object.fromEntries(Object.entries(fit.marginOffsets).map(([region, d]) => [region, r2(d)])),
  validation: tested,
  decision: 'not applied: every rule that moves the curated players scores the held-out games worse than the ratings as they are (validation)',
};
const auditText = `${JSON.stringify(audit, null, 1)}\n`;
const rostersFile = path.join(root, 'src', 'data', 'rosters.basketball.js');
const auditFile = path.join(root, 'docs', 'design', 'basketball-nations-audit.json');
if (process.argv.includes('--check')) {
  let differs = false;
  for (const [file, text] of [[rostersFile, out], [auditFile, auditText]]) {
    let current = null;
    try { current = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n'); } catch {}
    if (current !== text) { console.error(`differs: ${path.relative(root, file)}`); differs = true; }
  }
  if (differs) process.exit(1);
  console.log("Verified the basketball rosters and the nations' audit byte for byte.");
  process.exit(0);
}
await writeFile(rostersFile, out);
await writeFile(auditFile, auditText);
console.log(`wrote docs/design/basketball-nations-audit.json: ${games.length} FIBA games, SRS of the tournaments r ${r2(fit.srs.reliability, 3)}, `
  + `anchors' relation ${r2(fit.line.level)} at T ${r2(fit.line.centre)}, slope ${r2(fit.line.slope, 3)}; leave-one-tournament-out log loss `
  + `${tested.rules.nation.leaveOneOut.all.logLoss.join(' → ')} (not applied)`);

const nations = Object.keys(rosters).length;
const players = Object.values(rosters).reduce((s, r) => s + r.squad.length, 0);
const dual = Object.values(rosters).reduce((s, r) => s + r.squad.filter(p => p.positions.length > 1).length, 0);
console.log(`wrote src/data/rosters.basketball.js`);
console.log(`  ${nations} nations, ${players} players (${resolved.length} rated from ${manifest.builtIn.edition}, ${euroleague.length} from the EuroLeague's estimates, `
  + `${former.length} from an earlier NBA 2K, ${players - resolved.length - euroleague.length - former.length} curated)`);
console.log(`  ${dual} of ${players} players cover two positions`);
if (euroleague.length) {
  console.log(`  ${euroleague.length} EuroLeague players at their clubs' ratings:`);
  for (const e of euroleague) console.log(`    ${e}`);
}
if (former.length) {
  console.log(`  ${former.length} listed as NBA but not in ${manifest.builtIn.edition}, so rated by their latest NBA 2K:`);
  for (const f of former) console.log(`    ${f}`);
}
if (stretched.length) {
  console.log(`  ${stretched.length} starters play outside their natural positions — check the curated positions:`);
  for (const s of stretched) console.log(`    ${s}`);
}
if (unknownNations.length) console.log(`  ignored unknown nation ids: ${unknownNations.join(', ')}`);
if (missing.length) {
  console.log(`  ${missing.length} listed as NBA but in no NBA 2K edition — shirt will be generated:`);
  for (const m of missing) console.log(`    ${m}`);
}
