// The built-in earlier basketball seasons (docs/design/football-years.md): one NBA 2K edition's ratings, as compiled by
// 2K Archive, become that season's NBA clubs, each with its best five, in the data set format the game loads
// (src/engine/footballSets.js, kind 'nba2k'). Clubs only: no source rates the national teams' other players. No I/O
// here: scripts/build-nba-seasons.mjs reads the page and writes the files, scripts/build-nba-map.mjs takes each era's
// teams and arenas from `teamsOf`, and tests build seasons from invented players. Every rating is 2K's, unchanged.
import { selectLineup } from '../../src/data/teams.js';
import { colourFor, contentHash, makeCode, serializeFootballSet } from '../../src/data/footballSetBuild.js';

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const SET_ID = /^nba-2k\d{2}$/;
const FIVE = 5;

const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
/** 2000 → 'NBA 2K', 2008 → 'NBA 2K8': the edition named for the season ending that year. */
export const editionOf = year => `NBA 2K${year === 2000 ? '' : year - 2000}`;
export const seasonIdOf = year => `nba-2k${String(year - 2000).padStart(2, '0')}`;

/**
 * The page's ratings: `const YEARS = { "2000": [{ n, o, p, t, ... }], ... }`, read as data. The object literal is cut
 * out by matching braces outside strings and parsed as JSON; nothing on the page runs.
 */
export function extractYears(html) {
  const at = html.indexOf('const YEARS =');
  if (at < 0) throw new Error('The 2K Archive page has no YEARS table');
  const start = html.indexOf('{', at);
  let depth = 0, quoted = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('The YEARS table on the 2K Archive page never closes');
}

/**
 * The teams of season `year` from the manifest (scripts/data/nba-seasons.json), as `{ code, id, name, city, arena,
 * home }`. A team that kept its name and city takes its city and arena from `arenas` (scripts/data/nba-arenas.json,
 * by club id); one that has moved since names its own.
 */
export function teamsOf(manifest, year, arenas) {
  const teams = [];
  for (const [code, eras] of Object.entries(manifest.teams)) {
    const era = eras.find(e => (e.from ?? -Infinity) <= year && year <= (e.to ?? Infinity));
    if (!era) continue;
    const here = era.home ? era : arenas[era.id];
    if (!here) throw new Error(`No arena for ${era.name} in ${year}`);
    teams.push({ code, id: era.id, name: era.name, city: here.city, arena: here.arena, home: here.home });
  }
  return teams;
}

/** The era map season `year` plays on. */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(m => m.seasons.includes(year));
  if (!map) throw new Error(`No map for the season ending ${year}`);
  return map.id;
}

/** 'SF/PF' → ['SF', 'PF']; a second position that is not the first's neighbour is dropped, as the game allows. */
export function positionsOf(listed) {
  const [first, second] = String(listed).split('/');
  if (!POSITIONS.includes(first)) return null;
  if (second == null || !POSITIONS.includes(second) || Math.abs(POSITIONS.indexOf(first) - POSITIONS.indexOf(second)) !== 1) return [first];
  return [first, second];
}

/** A pool's best five, the strongest lineup its positions allow (build-clubs' startingFive). */
function startingFive(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return selectLineup({ sport: 'basketball', squad: byRating }).starters
    .map(starter => byRating[starter.originalIndex])
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

/**
 * Build season `year`. `years` is the page's whole table (a player whose position is blank takes the one 2K gave him
 * in the nearest edition, earlier first); `builtIn` are the game's NBA clubs, whose codes and colours a club that
 * kept its id keeps. Returns `{ doc, text, audit, warnings }`; throws when the edition's teams are not the manifest's.
 */
export function buildNbaSeason(years, year, manifest, { arenas, builtIn = [] }) {
  const warnings = [];
  const players = years[String(year)];
  if (!Array.isArray(players)) throw new Error(`2K Archive has no ${editionOf(year)}`);
  const teams = teamsOf(manifest, year, arenas);
  const byCode = new Map(teams.map(team => [team.code, team]));
  const codes = new Set(players.map(p => p.t).filter(code => code !== 'FA'));
  const unknown = [...codes].filter(code => !byCode.has(code));
  const absent = teams.filter(team => !codes.has(team.code)).map(team => team.code);
  if (unknown.length || absent.length) throw new Error(`${editionOf(year)}: teams ${unknown.join(', ') || 'none'} are not the manifest's; missing ${absent.join(', ') || 'none'}`);

  // A blank position takes the player's own from the nearest edition that lists him.
  const nearest = name => {
    for (let d = 1; d <= 30; d++) {
      for (const other of [year - d, year + d]) {
        const listed = (years[String(other)] || []).find(p => p.n === name && positionsOf(p.p));
        if (listed) return { positions: positionsOf(listed.p), from: other };
      }
    }
    return null;
  };
  const filled = [], dropped = [], narrowed = [];
  const pools = new Map(teams.map(team => [team.code, []]));
  for (const p of players) {
    if (p.t === 'FA') continue;
    if (!Number.isInteger(p.o) || p.o < 1 || p.o > 99 || typeof p.n !== 'string' || !p.n.trim()) {
      throw new Error(`${editionOf(year)}: player ${JSON.stringify(p)} has no name or a rating outside 1-99`);
    }
    let positions = positionsOf(p.p);
    if (!positions && p.p) throw new Error(`${editionOf(year)}: ${p.n} has position ${JSON.stringify(p.p)}`);
    if (!positions) {
      const near = nearest(p.n);
      if (!near) { dropped.push(p.n); continue; }
      positions = near.positions;
      filled.push(`${p.n} ${positions.join('/')} (${editionOf(near.from)})`);
    } else if (String(p.p).includes('/') && positions.length === 1) narrowed.push(`${p.n} ${p.p}`);
    pools.get(p.t).push({ name: p.n.trim(), pos: positions[0], positions, rating: p.o });
  }

  const known = new Map(builtIn.map(club => [club.id, club]));
  const taken = new Set(teams.filter(team => known.has(team.id)).map(team => known.get(team.id).code));
  const clubs = teams.map(team => {
    const squad = startingFive(pools.get(team.code));
    if (squad.length < FIVE) throw new Error(`${editionOf(year)}: ${team.name} has ${squad.length} players`);
    const club = known.get(team.id);
    return { id: team.id, name: team.name, code: club ? club.code : makeCode(team.name, taken), league: 'NBA', country: '840',
      col: club ? club.col : colourFor(team.id), str: Math.round(squad.reduce((sum, p) => sum + p.rating, 0) / squad.length),
      squad: squad.map(p => [p.name, p.positions.join('/'), p.rating]) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  if (dropped.length) warnings.push(`${dropped.length} players with no position in any edition were left out`);

  const edition = editionOf(year);
  const doc = { format: 1, kind: 'nba2k', id: seasonIdOf(year), version: '', year, season: seasonOf(year), label: edition, local: false,
    source: { provider: '2K Sports', edition, compiler: manifest.source.name, url: manifest.source.url, rawScale: 99 },
    map: mapOf(manifest, year), clubs, coverage: { players: clubs.length * FIVE, clubs: clubs.length } };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = { id: doc.id, version: doc.version, edition, rows: players.length, map: doc.map, clubs: clubs.length,
    filledPositions: filled, droppedNoPosition: dropped, narrowedPositions: narrowed.length, warnings };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}
