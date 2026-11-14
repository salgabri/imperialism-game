// Build rugby league's built-in earlier seasons (docs/design/rugby-league.md, "Earlier seasons").
//
//   node scripts/build-rugby-league-seasons.mjs             writes public/rugby-league/<id>.json, src/data/rugbyLeagueSeasons.js
//                                                           and docs/design/rugby-league-seasons-audit.json
//   node scripts/build-rugby-league-seasons.mjs --check     builds every file and compares it byte for byte, writes nothing
//   node scripts/build-rugby-league-seasons.mjs --realism   also plays 40 seeded seasons of each season's clubs and prints
//                                                           them beside the real season (writes nothing more)
//
// Each season is its committed snapshot (scripts/data/rugby-league-seasons/<id>.json, node
// scripts/sync-rugby-league-seasons.mjs): its NRL clubs, as scripts/data/rugby-league-seasons.json names them that
// season, every player one the Rugby League Project shows at the club that year, with the overall the snapshot converted
// from the game's attributes. The lineups and depth follow the built-in season's rules (scripts/lib/nrl.mjs), except
// that nothing is added: a club the database leaves short fields what it has. A season fields clubs only: the snapshot's
// World Cup squads, checked as the clubs are, mix Super League's players, whom the database rates on a kinder scale
// than the NRL's, so their nations cannot be rated on the clubs' scale (docs/design/rugby-league.md, "Earlier
// seasons"); the audit shows what they would be. Each season names the era map its clubs play on, which
// node scripts/build-club-maps.mjs --league=nrl builds from the same manifest.
//
// The computed seasons (1998–2007 and 2009–2024, `method` "computed"; docs/design/rugby-league.md, "Computed seasons")
// are built the same way from their snapshots: every player NRL.com shows taking the field for the club that season, at
// the overall computed from his match stats and his club's shift. Clubs only, as 2008; the clubs of 1998–2007 that no
// club of today's continues (the manifest's `defunct`) play in colours of their own.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CLUBS } from '../src/data/clubs.rugby-league.js';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { colourFor } from './lib/club-identity.mjs';
import { clubSquadOf, mapOf, nationSquadOf, playSeasons, spearman, teamsOf } from './lib/rugby-league-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/rugby-league');
const listingFile = path.join(root, 'src/data/rugbyLeagueSeasons.js');
const auditFile = path.join(root, 'docs/design/rugby-league-seasons-audit.json');

const ORDER = ['FB', 'WG', 'CE', 'FE', 'HB', 'HK', 'PR', 'SR', 'LK'];
const tupleOf = p => [p.name, p.pos, p.rating];
const byPlace = (a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || b.rating - a.rating || a.name.localeCompare(b.name);

/** Season `entry` of the manifest: its data set document and its audit row. */
function buildSeason(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id) throw new Error(`scripts/data/rugby-league-seasons/${id}.json is ${snapshot.source.id}'s snapshot`);
  // A club's player plays at his attribute overall moved by his club's shift, held to 1–99; a player of no club (a
  // national squad's alone) at his attribute overall.
  const player = new Map(snapshot.players.map(([index, name, pos, born, star, attributes, score, overall, shift]) => {
    if (!Number.isInteger(overall) || overall < 1 || overall > 99) throw new Error(`${id}: ${name} has the overall ${overall}`);
    if (shift !== null && !Number.isInteger(shift)) throw new Error(`${id}: ${name} has the shift ${shift}`);
    return [index, { index, name, pos, born, star, score, overall, shift, rating: Math.min(99, Math.max(1, overall + (shift ?? 0))) }];
  }));
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const teams = teamsOf(manifest, year);
  const clubs = teams.map(team => {
    const row = snapshot.clubs.find(club => club.id === team.id);
    if (!row) throw new Error(`${id}: the snapshot has no ${team.name}`);
    const pool = row.players.map(([index]) => player.get(index));
    if (pool.length < 17) throw new Error(`${id}: ${team.name} keeps ${pool.length} players`);
    if (pool.some(p => p.shift !== row.team.shift)) throw new Error(`${id}: ${team.name}'s players do not all carry its shift`);
    const { squad, lineup, open } = clubSquadOf(pool);
    if (lineup.rating !== row.team.shifted) throw new Error(`${id}: ${team.name}'s lineup is ${lineup.rating}, not the snapshot's ${row.team.shifted}`);
    if (!colours.has(team.franchise)) throw new Error(`${id}: ${team.name}'s franchise ${team.franchise} is no club of the game's`);
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.franchise), str: lineup.rating,
      team: row.team, squad: squad.slice().sort(byPlace), open, listed: row.players.length, outOfPosition: lineup.slots.filter(slot => slot.outOfPosition)
        .map(slot => `${slot.player.name} (${slot.player.pos}) at ${slot.position}`) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  // The World Cup nations as their checked squads would field them at their attribute overalls (a club's shift is the
  // club's), for the audit only.
  const clubIndexes = new Set(snapshot.clubs.flatMap(club => club.players.map(([index]) => index)));
  const nations = snapshot.nations.map(row => {
    const pool = row.players.map(([index]) => ({ ...player.get(index), rating: player.get(index).overall }));
    const all = nationSquadOf(row.id, pool), nrl = pool.some(p => clubIndexes.has(p.index)) ? nationSquadOf(row.id, pool.filter(p => clubIndexes.has(p.index))) : null;
    return { name: all.name, checked: pool.length, nrl: pool.filter(p => clubIndexes.has(p.index)).length, all: all.str, nrlOnly: nrl ? nrl.str : null };
  }).sort((a, b) => b.all - a.all || a.name.localeCompare(b.name));
  const doc = {
    format: 1, kind: 'nrl', id, version: '', year, season: String(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved, rawScale: 10,
      conversion: snapshot.conversion.formula },
    map: mapOf(manifest, year),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NRL', country: c.country, col: c.col, str: c.str, squad: c.squad.map(tupleOf) })),
    coverage: { players: clubIndexes.size, clubs: clubs.length, left: snapshot.left.filter(([team]) => snapshot.clubs.some(club => club.list === team)).length },
  };
  doc.version = `${id}-${contentHash(doc)}`;

  const clubLists = new Set(snapshot.clubs.map(club => club.list));
  const clubPlayers = snapshot.clubs.flatMap(club => club.players.map(([index]) => player.get(index)));
  const range = values => { const sorted = values.slice().sort((a, b) => a - b); return { lowest: sorted[0], median: sorted[sorted.length >> 1], highest: sorted.at(-1) }; };
  const real = new Map(snapshot.real.ladder.map(([club, won, drawn, lost, scored, conceded]) => [club, { won, drawn, lost, scored, conceded }]));
  const audit = {
    id, version: doc.version, season: doc.season, edition: entry.edition, label: entry.label, map: doc.map,
    players: { clubsKept: clubPlayers.length, clubsListed: clubPlayers.length + snapshot.left.filter(([team]) => clubLists.has(team)).length,
      inSquads: doc.clubs.reduce((n, club) => n + club.squad.length, 0) },
    // The attribute overalls, then the ratings played, each club's shift added.
    ratings: { overall: range(clubPlayers.map(p => p.overall)), played: range(clubPlayers.map(p => p.rating)) },
    byPosition: Object.fromEntries(ORDER.map(pos => {
      const at = clubPlayers.filter(p => p.pos === pos), overall = range(at.map(p => p.overall)), played = range(at.map(p => p.rating));
      return [pos, `${at.length} players, overall ${overall.lowest}–${overall.highest} (median ${overall.median}), played ${played.lowest}–${played.highest}`];
    })),
    clubs: clubs.map(c => {
      const r = real.get(c.id);
      return `${c.name} ${c.str} (${c.listed} kept, ${c.squad.length} in the squad${c.open.length ? `; no player of the unit for ${c.open.join(' ')}` : ''}`
        + `${c.outOfPosition.length ? `; out of position: ${c.outOfPosition.join(', ')}` : ''}; 2008: ${r.won}–${r.drawn}–${r.lost}, ${r.scored}–${r.conceded})`;
    }),
    clubShift: clubs.slice().sort((a, b) => b.team.rating - a.team.rating || a.name.localeCompare(b.name)).map(c => `${c.name}: team rating ${c.team.rating} `
      + `(${c.team.parts.join('/')}), target ${c.team.target}, shift ${c.team.shift > 0 ? '+' : ''}${c.team.shift}, strength ${c.team.strength} → ${c.team.shifted}`),
    // A check only: how the clubs' strengths, before the shift and after it, rank against the real season's wins.
    strengthAndResults: Object.fromEntries([['attributes', c => c.team.strength], ['shifted', c => c.str]].map(([key, value]) => [key,
      Math.round(spearman(clubs.map(value), clubs.map(c => { const r = real.get(c.id); return r.won + r.drawn / 2; })) * 1000) / 1000])),
    nations: {
      fielded: false,
      why: "The World Cup squads pass the check, but they mix Super League's players, whom the database rates on a kinder scale than "
        + "the NRL's (`scales`): read off the clubs' scale they make England the strongest nation; limited to NRL players, England "
        + "and France have none. `all` is each nation's strength with its whole checked squad, `nrlOnly` with its NRL players alone "
        + "(a place they cannot fill at the sport's baseline, 45).",
      squads: nations.map(n => `${n.name}: ${n.checked} checked, ${n.nrl} of them NRL players; all ${n.all}, NRL players only ${n.nrlOnly ?? 'none'}`),
      scales: snapshot.conversion.scales,
    },
    carriedOver: snapshot.carriedOver.map(([name, count]) => `${name} (${count} listed): an older edition's squad, not read`),
    left: snapshot.left.map(([team, , name, reason]) => `${team}: ${name}: ${reason}`),
    conversion: { weights: snapshot.conversion.weights, defaults: snapshot.conversion.defaults, quota: snapshot.conversion.quota, star: snapshot.conversion.star,
      clubShift: snapshot.conversion.clubShift },
    real: snapshot.real.figures,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/** Computed season `entry` of the manifest (1998–2007, 2009–2024): its data set document and its audit row. */
function buildComputedSeason(entry, snapshot, manifest) {
  const { id, year } = entry;
  if (snapshot.source.id !== id || snapshot.source.method !== 'computed') throw new Error(`scripts/data/rugby-league-seasons/${id}.json is not ${id}'s computed snapshot`);
  // A player plays at his computed overall moved by his club's shift, held to 1–99.
  const players = snapshot.players.map(([nrlId, name, club, pos, how, games, , , , value, overall, shift]) => {
    if (!Number.isInteger(overall) || overall < 1 || overall > 99) throw new Error(`${id}: ${name} has the overall ${overall}`);
    if (!Number.isInteger(shift)) throw new Error(`${id}: ${name} has the shift ${shift}`);
    return { nrlId, name, club, pos, how, games, value, overall, shift, rating: Math.min(99, Math.max(1, overall + shift)) };
  });
  // A club of today's franchise plays in its colour (an era's too: the Bulldogs, the Auckland Warriors); a defunct club,
  // which no club of today's continues (the manifest's `defunct`), in a colour of its own, as the NHL's Seals do.
  const defunct = new Set(manifest.defunct ?? []);
  const colours = new Map([...CLUBS.map(club => [club.id, club.col]), ...[...defunct].map(club => [club, colourFor(club)])]);
  const clubs = teamsOf(manifest, year).map(team => {
    const row = snapshot.clubs.find(club => club.id === team.id);
    if (!row) throw new Error(`${id}: the snapshot has no ${team.name}`);
    const pool = players.filter(p => p.club === team.id);
    if (pool.length < 17) throw new Error(`${id}: ${team.name} has ${pool.length} players`);
    if (pool.some(p => p.shift !== row.team.shift)) throw new Error(`${id}: ${team.name}'s players do not all carry its shift`);
    const { squad, lineup, open } = clubSquadOf(pool);
    if (lineup.rating !== row.team.shifted) throw new Error(`${id}: ${team.name}'s lineup is ${lineup.rating}, not the snapshot's ${row.team.shifted}`);
    if (!colours.has(team.franchise)) throw new Error(`${id}: ${team.name}'s franchise ${team.franchise} is no club of the game's`);
    return { id: team.id, name: team.name, code: team.code, country: team.country, col: colours.get(team.franchise), str: lineup.rating,
      team: row.team, games: row.games, squad: squad.slice().sort(byPlace), open, listed: pool.length, outOfPosition: lineup.slots.filter(slot => slot.outOfPosition)
        .map(slot => `${slot.player.name} (${slot.player.pos}) at ${slot.position}`) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  const doc = {
    format: 1, kind: 'nrl', id, version: '', year, season: String(year), label: entry.label, local: false,
    source: { provider: entry.provider, edition: entry.edition, compiler: entry.compiler, url: entry.url, retrieved: entry.retrieved, method: 'computed',
      metric: snapshot.conversion.metric, conversion: snapshot.conversion.formula },
    map: mapOf(manifest, year),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'NRL', country: c.country, col: c.col, str: c.str, squad: c.squad.map(tupleOf) })),
    coverage: { players: players.length, clubs: clubs.length, left: snapshot.left.length },
  };
  doc.version = `${id}-${contentHash(doc)}`;

  const range = values => { const sorted = values.slice().sort((a, b) => a - b); return { lowest: sorted[0], median: sorted[sorted.length >> 1], highest: sorted.at(-1) }; };
  const real = new Map(snapshot.real.ladder.map(([club, won, drawn, lost, scored, conceded]) => [club, { won, drawn, lost, scored, conceded }]));
  const wins = c => real.get(c.id).won + real.get(c.id).drawn / 2;
  const placedBy = how => players.filter(p => p.how === how).length;
  const signed = x => `${x > 0 ? '+' : ''}${x}`;
  const audit = {
    id, version: doc.version, season: doc.season, edition: entry.edition, label: entry.label, map: doc.map, method: 'computed',
    games: { played: snapshot.source.games, regular: snapshot.source.regular, withTeamLists: snapshot.source.teamLists },
    players: { placed: players.length, bySeason: placedBy('S'), bySeasonEitherSide: placedBy('S±1'), byTwoEitherSide: placedBy('S±2'), byRlp: placedBy('RLP'),
      left: snapshot.left.length, inSquads: doc.clubs.reduce((n, club) => n + club.squad.length, 0) },
    // The computed overalls, then the ratings played, each club's shift added.
    ratings: { overall: range(players.map(p => p.overall)), played: range(players.map(p => p.rating)) },
    byPosition: Object.fromEntries(ORDER.map(pos => {
      const at = players.filter(p => p.pos === pos), overall = range(at.map(p => p.overall)), played = range(at.map(p => p.rating));
      return [pos, `${at.length} players (${snapshot.conversion.quota[pos]} a club), overall ${overall.lowest}–${overall.highest} (median ${overall.median}), played ${played.lowest}–${played.highest}`];
    })),
    best: players.slice().sort((a, b) => b.rating - a.rating || b.value - a.value || a.name.localeCompare(b.name)).slice(0, 12)
      .map(p => `${p.name} (${clubs.find(c => c.id === p.club).code} ${p.pos}) ${p.rating}`),
    clubs: clubs.map(c => {
      const r = real.get(c.id);
      return `${c.name} ${c.str} (${c.listed} players, ${c.squad.length} in the squad${c.open.length ? `; no player of the unit for ${c.open.join(' ')}` : ''}`
        + `${c.outOfPosition.length ? `; out of position: ${c.outOfPosition.join(', ')}` : ''}; ${year}: ${r.won}–${r.drawn}–${r.lost}, ${r.scored}–${r.conceded})`;
    }),
    clubShift: clubs.slice().sort((a, b) => b.team.srs - a.team.srs || a.name.localeCompare(b.name)).map(c => `${c.name}: SRS ${signed(c.team.srs)}, `
      + `target ${c.team.target}, shift ${signed(c.team.shift)}, strength ${c.team.strength} → ${c.team.shifted}`),
    homeEdge: snapshot.conversion.clubShift.homeEdge,
    // A check only: how the clubs' strengths from the stats alone, and shifted by the season's results, rank against its wins.
    strengthAndResults: Object.fromEntries([['stats', c => c.team.strength], ['shifted', c => c.str]].map(([key, value]) => [key,
      Math.round(spearman(clubs.map(value), clubs.map(wins)) * 1000) / 1000])),
    placedByRlp: snapshot.players.filter(row => row[4] === 'RLP').map(([nrlId, name, club, pos]) => `${club}: ${name}: ${pos} (RLP ${snapshot.rlp[nrlId]})`),
    left: snapshot.left.map(([, name, club, games, reason]) => `${club}: ${name} (${games} game${games === 1 ? '' : 's'}): ${reason}`),
    conversion: { core: snapshot.conversion.core.weights, previous: snapshot.conversion.previous, quota: snapshot.conversion.quota },
    real: snapshot.real.figures,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by scripts/build-rugby-league-seasons.mjs; do not edit.
// The built-in earlier rugby league seasons, newest first: each NRL season's clubs, 2008's overalls converted from Rugby
// League 2's attributes, 1998–2007's and 2009–2024's computed from NRL.com's match stats. Each is
// public/rugby-league/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js), and its clubs play on their
// era's map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_RUGBY_LEAGUE_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

/** 40 seeded seasons of a season's clubs beside the real season's figures, as text. */
function realismText(doc, snapshot) {
  const report = playSeasons(doc.clubs, { seasons: 40, seed: 20261108 });
  // The real records as wins of 24, where a season had another length (2020's twenty rounds).
  const played = snapshot.real.ladder.reduce((sum, [, won, drawn, lost]) => sum + won + drawn + lost, 0) / snapshot.real.ladder.length;
  const real = { ...snapshot.real.figures, bestWins: snapshot.real.figures.bestWins * 24 / played, worstWins: snapshot.real.figures.worstWins * 24 / played };
  const pct = x => `${(100 * x).toFixed(1)}%`;
  const line = (label, model, actual, format) => `  ${label.padEnd(30)} ${format(model).padStart(8)}   ${format(actual)}`;
  const lines = [`${doc.id}: ${doc.clubs.length} clubs, 24 games, 40 seasons at a neutral venue (model, then the real ${doc.season} regular season)`,
    line('points a team', report.pointsPerTeam, real.pointsPerTeam, x => x.toFixed(1)),
    line('team points SD', report.teamPointsSd, real.teamPointsSd, x => x.toFixed(1)),
    line('mean margin', report.marginMean, real.marginMean, x => x.toFixed(1)),
    line('won by 1', report.byOne, real.byOne, pct), line('won by 1–6', report.withinSix, real.withinSix, pct),
    line('won by 1–12', report.withinTwelve, real.withinTwelve, pct), line('won by 13 or more', report.byThirteenPlus, real.byThirteenPlus, pct),
    line('won by 25 or more', report.byTwentyFivePlus, real.byTwentyFivePlus, pct), line('nil (a team game)', report.nilRate, real.nilRate, pct),
    line('40 or more (a team game)', report.fortyPlusRate, real.fortyPlusRate, pct), line('win% SD', report.winPctSd, real.winPctSd, x => x.toFixed(3)),
    line('best record (wins of 24)', report.bestWins, real.bestWins, x => x.toFixed(1)), line('worst record (wins of 24)', report.worstWins, real.worstWins, x => x.toFixed(1)),
    '  each club, its mean wins of 24 in the model, then its real record:'];
  const ladder = new Map(snapshot.real.ladder.map(([club, won, drawn, lost, scored, conceded]) => [club, `${won}–${drawn}–${lost}, ${scored}–${conceded}`]));
  for (const club of report.clubs) lines.push(`    ${club.name.padEnd(30)} ${club.str.toFixed(1)}  ${club.wins.toFixed(1).padStart(5)} wins, ${club.pointsFor.toFixed(1)}–${club.pointsAgainst.toFixed(1)} a game   real ${ladder.get(club.id)}`);
  lines.push(`  rank correlation of model wins and real wins: ${spearman(report.clubs.map(c => c.wins), report.clubs.map(c => Number(ladder.get(c.id).split('–')[0]))).toFixed(3)}`);
  return lines.join('\n');
}

async function main() {
  const check = process.argv.includes('--check'), realism = process.argv.includes('--realism');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check' && arg !== '--realism');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/rugby-league-seasons.json'), 'utf8'));
  const results = [];
  for (const entry of manifest.seasons) {
    const file = path.join(root, `scripts/data/rugby-league-seasons/${entry.id}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${entry.id}: run node scripts/sync-rugby-league-seasons.mjs`);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    results.push({ ...(entry.method === 'computed' ? buildComputedSeason : buildSeason)(entry, snapshot, manifest), snapshot });
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    const played = `(${audit.ratings.played.lowest}-${audit.ratings.played.highest}, median ${audit.ratings.played.median}), ${Math.round(Buffer.byteLength(text) / 1024)} KB`;
    console.log(audit.method === 'computed'
      ? `${doc.id} ${doc.season} computed on ${doc.map}: ${doc.clubs.length} clubs (${doc.clubs.at(-1).str}–${doc.clubs[0].str}), ${audit.players.placed} players ${played}; `
        + `${audit.players.byRlp} placed by RLP, ${audit.players.left} left out; clubs against wins ${audit.strengthAndResults.stats} by stats, ${audit.strengthAndResults.shifted} shifted`
      : `${doc.id} ${doc.season} ${doc.label} on ${doc.map}: ${doc.clubs.length} clubs (${doc.clubs.at(-1).str}–${doc.clubs[0].str}), `
        + `${audit.players.clubsKept} club players ${played}; nations not fielded: ${audit.nations.squads.slice(0, 3).join('; ')}`);
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-rugby-league-seasons.mjs', seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (realism) for (const { doc, snapshot } of results) console.log(realismText(doc, snapshot));
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} rugby league season${results.length === 1 ? '' : 's'}, the listing and the audit byte for byte.`);
    return;
  }
  if (realism) return;
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} season${results.length === 1 ? '' : 's'} to public/rugby-league/, src/data/rugbyLeagueSeasons.js and docs/design/rugby-league-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-rugby-league-seasons: ${error.message}`);
  process.exitCode = 1;
});
