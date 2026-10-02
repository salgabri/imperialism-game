// Refresh the small, reproducible FM26 supplement used by the football builders.
// This reads the same public endpoint and filters used by EFEM.club's player grid.
// It deliberately requests Current Ability, never EFEM Score or potential.
// Usage: node scripts/sync-football-manager.mjs [output.json]
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = process.argv[2] || path.join(root, 'scripts/data/fm26-players.json');
const VERSION = '26.3.0';
const PAGE_SIZE = 100;
const LIMIT = 100;
const CONCURRENCY = 4;
const ORIGIN = 'https://efem.club';
const NATURAL_POSITION_MIN = 90;

// FM uses historical/football country names in several places. Broad queries
// are followed by an exact primary-nationality code check, so Congo/Guinea
// queries cannot assign a neighbouring country's player to the wrong nation.
const QUERY_ALIASES = {
  'Bosnia & Herz.': 'Bosnia',
  'Central African Rep.': 'Central African',
  'Dominican Rep.': 'Dominican',
  'Eq. Guinea': 'Equatorial',
  'DR Congo': 'Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'N. Macedonia': 'Macedonia',
  'Myanmar': 'Burma',
  'Eswatini': 'Swaziland',
  'Trinidad & Tobago': 'Trinidad',
  'Czechia': 'Czech',
  'Timor-Leste': 'Timor',
  'Turkey': 'Tür',
};
const CODE_ALIASES = {
  KVX: ['KVX', 'KOS'],
  LIB: ['LIB', 'LBN'],
  MGL: ['MGL', 'MNG'],
};
const POSITIONS = ['gk', 'lb', 'cb', 'rb', 'dm', 'lwb', 'rwb', 'lm', 'cm', 'rm', 'lw', 'am', 'rw', 'st'];

function requestUrl(query, page = 1) {
  const filters = ['playerbase.gender=0', `nationality=*${query}/i`].map(encodeURIComponent).join(',');
  return `${ORIGIN}/api/players/filter?filterString=pageSize=${PAGE_SIZE}&page=${page}&version=${VERSION}&view=Default&filter=${filters}&orderBy=currentAbility%20desc`;
}

async function getPage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!Array.isArray(result.data) || !Number.isInteger(result.count)) throw new Error('Invalid player response');
      return result;
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
    }
  }
}

function validPlayer(player) {
  return Number.isInteger(player.id) && player.id > 0
    && typeof player.name === 'string' && player.name.trim()
    && player.gender === 'Male'
    && Number.isFinite(player.currentAbility) && player.currentAbility > 0 && player.currentAbility <= 100
    && POSITIONS.some(position => player.positionProficiency?.[position] >= NATURAL_POSITION_MIN);
}

async function collectNation([nationId, [nationName, code]]) {
  const acceptedCodes = new Set(CODE_ALIASES[code] || [code]);
  let query = QUERY_ALIASES[nationName] || nationName;
  const players = new Map();
  let count = 0, pages = 0;
  do {
    let result = await getPage(requestUrl(query, ++pages));
    if (pages === 1 && result.count === 0 && query !== nationName) {
      query = nationName;
      result = await getPage(requestUrl(query, pages));
    }
    count = result.count;
    for (const player of result.data) {
      if (players.size >= LIMIT) break;
      if (!acceptedCodes.has(player.primaryNationality?.nationCode) || !validPlayer(player)) continue;
      players.set(player.id, {
        id: player.id,
        name: player.name,
        age: player.age,
        gender: player.gender,
        nationId,
        primaryNationality: player.primaryNationality,
        clubId: player.clubId,
        clubName: player.clubName,
        currentAbility: player.currentAbility,
        positionProficiency: player.positionProficiency,
        url: `${ORIGIN}/players/${player.id}-${encodeURIComponent(player.name.replace(/[\s/]+/g, '-'))}`,
      });
    }
    if (!result.data.length) break;
  } while (players.size < LIMIT && pages * PAGE_SIZE < count);
  console.log(`${nationName}: ${players.size} real players (${count} query candidates; ${pages} pages)`);
  return { nationId, nationName, code, query, queryCount: count, pages, players: [...players.values()] };
}

const nations = Object.entries(NATIONS);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < nations.length) results.push(await collectNation(nations[next++]));
}));
results.sort((a, b) => a.nationId.localeCompare(b.nationId));
const players = results.flatMap(result => result.players).sort((a, b) => a.id - b.id);
if (new Set(players.map(player => player.id)).size !== players.length) throw new Error('Player assigned to multiple primary nationalities');
const data = {
  source: {
    provider: 'EFEM.club',
    game: 'Football Manager 26',
    version: VERSION,
    fetchedAt: new Date().toISOString(),
    url: `${ORIGIN}/players`,
    endpoint: `${ORIGIN}/api/players/filter`,
    ratingField: 'currentAbility',
    ratingScale: '1-100 normalized Current Ability displayed by EFEM.club',
    ratingNote: 'This is the source\'s displayed Current Ability, not raw FM 1-200 CA and not EFEM Score or potential. Preserve it without dividing again.',
    positionField: 'positionProficiency',
    naturalPositionMinimum: NATURAL_POSITION_MIN,
    selection: `Up to ${LIMIT} highest Current Ability male players per map nation; exact primary nationality code; known natural position; no inferred identity or ratings.`,
    identityNote: 'Names are the database display names. The public Default view does not expose date of birth or EA player IDs.',
    updateCommand: 'node scripts/sync-football-manager.mjs',
  },
  nations: results.map(({ players: nationPlayers, ...result }) => ({ ...result, selected: nationPlayers.length, queryUrl: requestUrl(result.query) })),
  players,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, '{\n"source":' + JSON.stringify(data.source) + ',\n"nations":' + JSON.stringify(data.nations)
  + ',\n"players":[\n' + data.players.map(player => JSON.stringify(player)).join(',\n') + '\n]\n}\n');
console.log(`Saved ${players.length} real players from ${results.length} nations to ${path.relative(root, output)}`);
