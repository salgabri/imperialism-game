// Build ice hockey's built-in earlier seasons (docs/design/hockey.md, "Earlier seasons").
//
//   node scripts/build-nhl-seasons.mjs           writes public/hockey/nhl-<year>.json, src/data/hockeySeasons.js and
//                                                docs/design/hockey-seasons-audit.json
//   node scripts/build-nhl-seasons.mjs --check   builds every file and compares it byte for byte, writes nothing
//
// Each season is one EA edition's committed snapshot (scripts/data/nhl-seasons/<id>.json, node
// scripts/sync-nhl-seasons.mjs): its NHL clubs, as the NHL's codes of that season name them (scripts/data/nhl-seasons.json
// `teams`), and its nations by birth country. The lineups, depth and nations follow the built-in season's rules
// (scripts/lib/nhl.mjs), except that nothing is estimated: a player the edition does not rate is not there, and a club
// short of a lineup fields what it has. Each season names the era map its clubs play on, which
// node scripts/build-club-maps.mjs --league=nhl builds from the same manifest.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME_NATIONS, selectLineup } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.hockey.js';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { colourFor } from './lib/club-identity.mjs';
import { nationsOf, nationStrength } from './lib/nhl.mjs';
import { clubSquadOf, mapOf, nationOf, quantileRescale, ratingsOf, teamsOf } from './lib/nhl-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/hockey');
const listingFile = path.join(root, 'src/data/hockeySeasons.js');
const auditFile = path.join(root, 'docs/design/hockey-seasons-audit.json');

const seasonLabel = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
const tupleOf = p => [p.name, p.pos, p.rating];
const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];
// A squad as the files list it: by position, then rating; within a rating, the game's own order, then the name.
const byPlace = (a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos) || b.rating - a.rating || b.game - a.game || a.name.localeCompare(b.name);

/** Season `entry` of the manifest: its data set document and its audit row. */
function buildSeason(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id) throw new Error(`scripts/data/nhl-seasons/${id}.json is ${snapshot.source.id}'s snapshot`);
  const players = snapshot.players.map(([name, team, pos, rating, born, nhlId]) => {
    if (!Number.isInteger(rating) || rating < 1 || rating > 99) throw new Error(`${id}: ${name} has the rating ${rating}`);
    return { name, team, pos, rating, game: rating, nation: nationOf(born), nhlId };
  });
  // A classic season's overalls, rescaled onto NHL 27's (the player's choice, scripts/data/nhl-seasons.json `rescale`):
  // its squads are picked by the game's own overalls, then every rating is rescaled and the strengths taken from those.
  const scale = entry.rescale ? quantileRescale(players.map(p => p.game), ratingsOf(manifest.rescale.histogram)) : null;
  const rated = list => (scale ? list.map(p => ({ ...p, rating: scale.get(p.game) })) : list);
  // A club that kept today's id keeps its colour; one of another era takes its own.
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const clubs = teamsOf(manifest, year).map(team => {
    const pool = players.filter(player => player.team === team.code);
    if (pool.length < 12) throw new Error(`${id}: ${team.name} has ${pool.length} players`);
    const { squad, lineup } = clubSquadOf(pool);
    // Places its own forwards, defenders and goalies cannot fill: the lineup picker moves another player there.
    const count = test => pool.filter(test).length;
    const short = [[12, 'forward', p => ['C', 'LW', 'RW'].includes(p.pos)], [6, 'defender', p => p.pos === 'D'], [1, 'goalie', p => p.pos === 'G']]
      .map(([needed, noun, test]) => [needed - count(test), noun]).filter(([missing]) => missing > 0).map(([missing, noun]) => `${missing} ${noun}${missing > 1 ? 's' : ''}`);
    const listed = rated(squad);
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.id) ?? colourFor(team.id),
      str: scale ? selectLineup({ sport: 'hockey', squad: listed }).rating : lineup.rating, squad: listed, short, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const nations = scale
    ? nationsOf(players).map(n => { const squad = rated(n.squad).sort(byPlace); return { ...n, ...nationStrength(squad), squad }; })
      .sort((a, b) => b.str - a.str || a.name.localeCompare(b.name))
    : nationsOf(players);
  const doc = {
    format: 1, kind: 'nhl', id, version: '', year, season: seasonLabel(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved,
      rawScale: entry.rawScale, overall: entry.overall, ...(scale ? { conversion: conversionOf(entry, manifest, players.length) } : {}),
      nation: entry.nation ?? "the NHL's birth country" },
    map: mapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NHL', country: c.country, col: c.col, str: c.str,
      squad: c.squad.slice().sort(byPlace).map(tupleOf) })),
    // Great Britain plays as one, as in the built-in season: the home nations start in the United Kingdom's empire.
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(home => [home, '826'])), inactive: [] },
    coverage: { players: players.length, clubs: clubs.length, nations: nations.length, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;
  const ratings = players.map(p => p.game).sort((a, b) => a - b);
  const range = list => ({ lowest: list[0], median: list[list.length >> 1], highest: list.at(-1) });
  const audit = {
    id, version: doc.version, season: doc.season, edition: entry.edition, label: entry.label, map: doc.map, players: players.length,
    ratings: range(ratings),
    // The games' own overalls stay here: each one and the rating it became.
    ...(scale ? { rescaled: { ratings: range(ratings.map(v => scale.get(v))), reference: manifest.rescale.reference,
      mapping: Object.fromEntries([...scale].sort((a, b) => a[0] - b[0])) } } : {}),
    clubs: clubs.map(c => `${c.name} ${c.str} (${c.players} players${c.short.length ? `; short of ${c.short.join(', ')}` : ''})`),
    nations: nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`),
    noNation: players.filter(p => p.nation === null).map(p => `${p.name} (${p.team})`),
    left: snapshot.left.map(row => row.join(' | ')),
    notes: snapshot.notes,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/** The whole rule from the edition's numbers to a rescaled season's ratings, as its source states it. */
function conversionOf(entry, manifest, count) {
  const rescale = `rescaled onto NHL 27's ratings rank for rank: each overall takes the rating at its mid-rank among the season's ${count} rated players `
    + `in ${manifest.rescale.reference}; ties stay ties and nobody passes anybody (the game's own overall of every player is in `
    + `scripts/data/nhl-seasons/${entry.id}.json)`;
  return entry.source.kind === 'nhlpa93' ? `${entry.overall}, 99 at most; then ${rescale}` : `the game's overall, ${rescale}`;
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:nhl-seasons; do not edit.
// The built-in earlier ice hockey seasons, newest first: each EA NHL edition's nations and NHL clubs. Each is
// public/hockey/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js), and its clubs play on their era's
// map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_HOCKEY_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nhl-seasons.json'), 'utf8'));
  const results = [];
  for (const entry of manifest.seasons) {
    const file = path.join(root, `scripts/data/nhl-seasons/${entry.id}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${entry.id}: run node scripts/sync-nhl-seasons.mjs --season=${entry.id}`);
    results.push(buildSeason(entry, JSON.parse(await readFile(file, 'utf8')), manifest));
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    console.log(`${doc.id} ${doc.season} ${doc.label} on ${doc.map}: ${doc.clubs.length} clubs, ${audit.nations.length} nations, ${audit.players} players `
      + `(${audit.ratings.lowest}-${audit.ratings.highest}, median ${audit.ratings.median}), ${Math.round(Buffer.byteLength(text) / 1024)} KB; `
      + `strongest ${audit.clubs.slice(0, 2).join(', ')}; ${audit.nations.slice(0, 2).join(', ')}`);
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-nhl-seasons.mjs', seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} hockey seasons, their listing and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/hockey/, src/data/hockeySeasons.js and docs/design/hockey-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-nhl-seasons: ${error.message}`);
  process.exitCode = 1;
});
