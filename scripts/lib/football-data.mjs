import { readFile } from 'node:fs/promises';

// The squad pick lives in src/data so the browser's data set builder shares it.
export { FOOTBALL_FORMATION, pickFootballSquad } from '../../src/data/footballSquad.js';
export const ROLE_OF_POSITION = {
  GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
};
export const NATION_ALIASES = {
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Central African Republic': 'Central African Rep.',
  'China PR': 'China', 'Congo DR': 'DR Congo',
  'Dominican Republic': 'Dominican Rep.', 'Equatorial Guinea': 'Eq. Guinea',
  'Korea DPR': 'North Korea', 'Korea Republic': 'South Korea', 'North Macedonia': 'N. Macedonia',
  'Republic of Ireland': 'Ireland', Türkiye: 'Turkey',
  'Trinidad and Tobago': 'Trinidad & Tobago',
};

/** EA's own player pages: `<this><slug>/<EA id>`, the evidence link of a ratings-API pull. */
export const EA_PLAYER_PAGE = 'https://www.ea.com/games/ea-sports-fc/ratings/player-ratings/';

export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function loadEaPlayers(filename) {
  return parseEaPlayers(await readFile(filename, 'utf8'));
}

/** loadEaPlayers from the CSV's text, for a caller that reads the file itself. */
export function parseEaPlayers(text) {
  const [header, ...rows] = parseCsv(text);
  const required = ['player_id', 'player_url', 'fifa_version', 'fifa_update', 'fifa_update_date',
    'short_name', 'long_name', 'player_positions', 'overall', 'nationality_name',
    'club_name', 'club_team_id', 'league_id', 'league_name', 'league_level', 'dob'];
  const columns = Object.fromEntries(required.map(name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`EA CSV is missing "${name}"`);
    return [name, index];
  }));
  for (const [index, row] of rows.entries()) {
    if (row.length !== header.length) throw new Error(`EA CSV row ${index + 2} has ${row.length} fields; expected ${header.length}`);
  }
  // Only in a reduced ratings-API pull (scripts/sync-ea-fc.mjs): the previous edition's legal name of the same player.
  const referenceColumn = header.indexOf('reference_long_name');
  // EA fills unlicensed squads with generated players, all born on 29 February:
  // Brazil's Série A clubs, and in FC 26 also Mohammedan SC and Western United.
  // League names cannot find them (Leone's files call Brazil's and Italy's
  // leagues both "Serie A"), so key on the club: drop a club when at least half
  // its squad is born on 29 February, and drop clubless 29-February players one
  // by one. Isolated 29-February births at real clubs (Ferran Torres) stay.
  const leapDay = row => row[columns.dob].slice(5) === '02-29';
  const clubs = new Map();
  for (const row of rows) {
    const clubId = Number(row[columns.club_team_id]);
    if (!clubId) continue;
    const club = clubs.get(clubId) || { clubId, club: row[columns.club_name], league: row[columns.league_name], players: 0, leapDay: 0 };
    club.players++;
    if (leapDay(row)) club.leapDay++;
    clubs.set(clubId, club);
  }
  const generatedClubs = [...clubs.values()].filter(club => club.leapDay * 2 >= club.players);
  const generatedIds = new Set(generatedClubs.map(club => club.clubId));
  const seen = new Set(), players = [], clubless = [];
  let fictional = 0;
  for (const row of rows) {
    const get = name => row[columns[name]];
    const clubId = Number(get('club_team_id'));
    if (clubId ? generatedIds.has(clubId) : leapDay(row)) {
      fictional++;
      if (!clubId) clubless.push(`ea:${get('player_id')}`);
      continue;
    }
    const id = `ea:${get('player_id')}`;
    if (!/^ea:\d+$/.test(id) || seen.has(id)) throw new Error(`Invalid or duplicate EA player ID: ${id}`);
    seen.add(id);
    const rating = Number(get('overall'));
    if (!get('overall').trim() || !Number.isInteger(rating) || rating < 1 || rating > 99) throw new Error(`Invalid EA overall for ${id}`);
    const natural = get('player_positions').split(',').map(p => p.trim());
    if (!natural.length || natural.some(p => !ROLE_OF_POSITION[p])) throw new Error(`Unknown EA position for ${id}`);
    const positions = [...new Set(natural.map(p => ROLE_OF_POSITION[p]))];
    const name = get('short_name').trim(), fullName = get('long_name').trim();
    if (!name || !fullName || !get('nationality_name') || !/^\d{4}-\d{2}-\d{2}$/.test(get('fifa_update_date'))) throw new Error(`Missing EA identity/date for ${id}`);
    // A SoFIFA export links a site path, a ratings-API pull EA's own player page; either names this player's id.
    const playerUrl = get('player_url'), eaId = get('player_id');
    const url = playerUrl.startsWith(`/player/${eaId}/`) ? `https://sofifa.com${playerUrl}`
      : playerUrl.startsWith(EA_PLAYER_PAGE) && playerUrl.endsWith(`/${eaId}`) ? playerUrl : null;
    if (!url) throw new Error(`Missing EA player URL for ${id}`);
    // The ratings API serves one current roster, so its rows have no update number.
    const update = get('fifa_update').trim() ? Number(get('fifa_update')) : null;
    if (update !== null && !Number.isInteger(update)) throw new Error(`Invalid EA update for ${id}`);
    // The legal name only matches FM identities (loadFootballData); it stays out of the shipped tuple.
    players.push({ name, pos: positions[0], positions, rating, referenceFullName: row[referenceColumn]?.trim() || null,
      nation: NATION_ALIASES[get('nationality_name')] || get('nationality_name'),
      club: get('club_name'), league: get('league_name'), leagueId: Number(get('league_id')), leagueLevel: Number(get('league_level')),
      sourceInfo: { id, fullName, positions, source: 'ea-fc', edition: `EA FC ${get('fifa_version')}`,
        snapshotDate: get('fifa_update_date'), update,
        url, rawRating: rating, rawScale: 99,
        nationality: get('nationality_name'), club: get('club_name'), clubId: Number(get('club_team_id')) || null,
        dateOfBirth: get('dob'), naturalPositions: natural },
    });
  }
  const fictionalFilter = {
    rule: 'Drop clubs (club_team_id) where at least half the squad is born on 29 February, and clubless players born on 29 February.',
    clubs: generatedClubs.map(({ leapDay: _, ...club }) => club),
    clubPlayers: generatedClubs.reduce((total, club) => total + club.players, 0),
    clubless,
    keptRealClubLeapDayBirths: [...clubs.values()].filter(club => !generatedIds.has(club.clubId))
      .reduce((total, club) => total + club.leapDay, 0),
  };
  return { players, fictional, fictionalFilter, rows: rows.length };
}

export const playerTuple = player => [player.name, player.pos, player.rating, player.sourceInfo];

const FM_ROLES = { gk: 'GK', lb: 'DF', cb: 'DF', rb: 'DF', lwb: 'DF', rwb: 'DF',
  dm: 'MF', lm: 'MF', cm: 'MF', rm: 'MF', am: 'MF', lw: 'FW', rw: 'FW', st: 'FW' };

/** EFEM publishes current ability on a 1–100 scale, already normalised from FM.
 * Preserve that value, and scale it once to the game's 1–99 display range. */
export function fmGameRating(currentAbility) {
  if (!Number.isFinite(currentAbility) || currentAbility <= 0 || currentAbility > 100) throw new Error('Invalid FM current ability');
  return Math.max(1, Math.round(currentAbility * 99 / 100));
}

// The duplicate check compares every FM record with every EA record of its nation, so each name is normalised once.
const memo = fn => { const cache = new Map(); return name => { if (!cache.has(name)) cache.set(name, fn(name)); return cache.get(name); }; };
export const normalName = memo(name => name.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[-’']/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim());
/** Name tokens without particles; the array is shared, so never mutate it. */
export const nameTokens = memo(name => normalName(name).split(' ').filter(token => !['al', 'bin', 'de', 'da', 'do', 'dos', 'di', 'van', 'der', 'jr'].includes(token)));

/** Whole years from an ISO birth date to an ISO date (NaN without a birth date). */
export function ageOn(dateOfBirth, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth || '')) return NaN;
  const [year, month, day] = dateOfBirth.split('-').map(Number), [y, m, d] = date.split('-').map(Number);
  return y - year - (m < month || (m === month && d < day) ? 1 : 0);
}
/** EFEM's FM ages count from the FM season's start: the 1 July on or before the database date (26.3.0 of 2026-03-30: 2025-07-01). */
export const fmAgeDate = databaseDate => `${Number(databaseDate.slice(0, 4)) - (databaseDate.slice(5) < '07-01' ? 1 : 0)}-07-01`;
const agesAgree = (ea, fm, ageDate) => Math.abs(ageOn(ea.sourceInfo.dateOfBirth, ageDate) - fm.age) <= 1;

/** The same-name rules on one EA full name: the long name, or for a ratings-API row also its legal name. */
function matchesFullName(fullName, ea, fm, ageDate) {
  const full = normalName(fullName), name = normalName(fm.name);
  if (full === name) return true;
  // Familiar first/surname pairs can omit legal middle names: Vinícius Júnior
  // and Vinícius José Paixão de Oliveira Júnior are the same database identity.
  const fullTokens = nameTokens(fullName), tokens = nameTokens(fm.name);
  if (tokens.length >= 2 && tokens.every(token => fullTokens.includes(token))) return true;
  if (tokens.length === 1 && tokens[0].length >= 4 && tokens[0] === fullTokens[0]) return true;
  // The reverse, for a name shorter in EA than in FM: the ratings API gives first and last name only (EA FC 27
  // "Rahim Alhassane", FM "Abdel Rahim Alhassane"). Every EA token, at least two, in the FM name is the same person
  // only when FM's age fits the EA birth date.
  return fullTokens.length >= 2 && fullTokens.every(token => tokens.includes(token)) && agesAgree(ea, fm, ageDate);
}

function mayBeSamePlayer(ea, fm, ageDate) {
  const name = normalName(fm.name), short = normalName(ea.name);
  if (short === name || short.replaceAll(' ', '') === name.replaceAll(' ', '')) return true;
  if (matchesFullName(ea.sourceInfo.fullName, ea, fm, ageDate)) return true;
  // A ratings-API row also carries the previous edition's legal name (FM "Tyias Browning" is EA "Jiang Guangtai",
  // legally "Jiang Guangtai Tyias Charles Browning"). It is the longer name, so its matches must agree on age as well:
  // FM's Antonio Sanabria, 29, is not "Lorenzo Antonio Melgarejo Sanabria", born 1990.
  if (ea.referenceFullName && matchesFullName(ea.referenceFullName, ea, fm, ageDate) && agesAgree(ea, fm, ageDate)) return true;
  // The EA export often abbreviates a legal name while FM uses a familiar name.
  // Ambiguous initial/surname matches are omitted from supplementation rather
  // than risk fielding the same person twice. IDs remain the actual source IDs.
  const abbreviated = /^([A-Za-z])\.\s+(.+)$/.exec(ea.name);
  return !!abbreviated && name.startsWith(abbreviated[1].toLowerCase()) && name.endsWith(` ${normalName(abbreviated[2])}`);
}

export async function loadFootballData(eaFilename, fmFilename) {
  const ea = await loadEaPlayers(eaFilename);
  const snapshot = JSON.parse(await readFile(fmFilename, 'utf8'));
  const { edition, version, databaseDate } = snapshot.source || {};
  // The database date is the FM data update's release, not when it was fetched.
  if (!edition || !version || !/^\d{4}-\d{2}-\d{2}$/.test(databaseDate || '') || !Array.isArray(snapshot.players)) throw new Error('Missing FM snapshot metadata/players');
  const fmNationNames = new Map(snapshot.nations.map(nation => [nation.nationId, nation.nationName]));
  const seen = new Set(), fmPlayers = [], unknownAbility = [];
  for (const record of snapshot.players) {
    const id = `fm:${record.id}`;
    if (!/^fm:\d+$/.test(id) || seen.has(id)) throw new Error(`Invalid or duplicate FM player ID: ${id}`);
    seen.add(id);
    if (record.gender !== 'Male' && record.gender !== 0) throw new Error(`Unexpected FM gender for ${id}`);
    if (!record.name?.trim() || !record.primaryNationality?.name || !fmNationNames.has(record.nationId)) throw new Error(`Missing FM identity/nation mapping for ${id}`);
    // Ages confirm identities (FM 26 26.3.0: 16 to 49); an implausible one is a bad record.
    if (!Number.isInteger(record.age) || record.age < 10 || record.age > 60) throw new Error(`Invalid FM age for ${id}`);
    // Zero/unknown CA is not a verified rating and must never be manufactured.
    if (!record.currentAbility) { unknownAbility.push(id); continue; }
    const natural = Object.keys(FM_ROLES).filter(pos => record.positionProficiency?.[pos] >= 90)
      .sort((a, b) => record.positionProficiency[b] - record.positionProficiency[a]);
    if (!natural.length) continue;
    const positions = [...new Set(natural.map(pos => FM_ROLES[pos]))];
    const name = record.name.trim();
    // The age only confirms identities; it stays out of the shipped tuple.
    fmPlayers.push({ name, pos: positions[0], positions, rating: fmGameRating(record.currentAbility),
      nation: fmNationNames.get(record.nationId), age: record.age,
      club: record.clubName || '',
      sourceInfo: { id, fullName: name, positions, source: 'football-manager', edition,
        version, snapshotDate: databaseDate,
        url: record.url || `https://efem.club/players/${record.id}-${encodeURIComponent(name.replace(/\s+/g, '-'))}`,
        rawRating: record.currentAbility, rawScale: 100, conversion: 'round(currentAbility * 99 / 100)',
        nationality: record.primaryNationality.name, club: record.clubName || '', naturalPositions: natural },
    });
  }
  const eaByNation = new Map();
  for (const player of ea.players) {
    if (!eaByNation.has(player.nation)) eaByNation.set(player.nation, []);
    eaByNation.get(player.nation).push(player);
  }
  let duplicateCandidates = 0;
  const ageDate = fmAgeDate(databaseDate);
  const supplements = fmPlayers.filter(player => {
    if ((eaByNation.get(player.nation) || []).some(candidate => mayBeSamePlayer(candidate, player, ageDate))) {
      duplicateCandidates++; return false;
    }
    return true;
  });
  return { players: [...ea.players, ...supplements], ea, fm: snapshot.source,
    fmCount: fmPlayers.length, duplicateCandidates, unknownAbility };
}
