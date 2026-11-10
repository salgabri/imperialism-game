import { readFile } from 'node:fs/promises';
import { pickFootballSquad } from '../../src/data/footballSquad.js';

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

/**
 * The built-in season's EA and FM records, resolved to persons (resolvePersons): one record per real player, each in
 * one nation. `bridge` is readReepBridge's result (null: the name matcher alone), `overrides` readIdentityOverrides'.
 * Nation conflicts go to the source dated later (EA's snapshot against FM's database date).
 */
export async function loadFootballData(eaFilename, fmFilename, { bridge = null, overrides = { same: [], distinct: [], nations: [] } } = {}) {
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
  // The name matcher runs on every FM record against its nation's EA records once: its one-to-one matches are the
  // linking check's fuzzy pairs, and resolvePersons uses the matches only between records no key pairs.
  const pairs = [], matches = new Map(), ageDate = fmAgeDate(databaseDate);
  for (const player of fmPlayers) {
    const found = (eaByNation.get(player.nation) || []).filter(candidate => mayBeSamePlayer(candidate, player, ageDate));
    if (found.length) matches.set(player.sourceInfo.id, found);
    if (found.length === 1) pairs.push({ ea: found[0], fm: player });
  }
  // The source dated later decides a nation conflict: EA FC 27 (2026-11-01) postdates FM 26 26.3.0 (2026-03-30).
  const eaDate = ea.players.reduce((latest, player) => (player.sourceInfo.snapshotDate > latest ? player.sourceInfo.snapshotDate : latest), '');
  const fresher = eaDate > databaseDate ? 'ea' : 'fm';
  const identity = resolvePersons({ ea: ea.players, fm: fmPlayers, matches, bridge, overrides, fresher, ageDate });
  const fmHeads = identity.persons.filter(person => person.player.sourceInfo.source === 'football-manager').length;
  // players: one record per person (EA first), each with personKey; persons also carry the arbitrated nation, which
  // may differ from that record's own.
  return { players: identity.persons.map(person => person.player), persons: identity.persons, identity, ea, fm: snapshot.source,
    ageDate, fresher, fmCount: fmPlayers.length, duplicateCandidates: fmPlayers.length - fmHeads, unknownAbility,
    linking: { ...linkingCheck(pairs), reep: linkingCheck(identity.reepPairs) } };
}

/** A player's person: the key resolvePersons gives it (a Reep id, else its heading record's id), else its record's id. */
export const personKeyOf = player => player.personKey ?? player.sourceInfo.id;

/**
 * The committed Reep bridge (scripts/data/reep-bridge.json, npm run sync:reep-bridge) as a map from record id to Reep
 * id, 'ea:158023' and 'fm:7458500' -> 'rp8a503e860b7abe', and from Reep id to the person's record ids in every
 * snapshot the bridge covers: 'rp8a503e860b7abe' -> { ea: ['ea:158023'], fm: ['fm:7458500'] }. Links the reducer
 * rejected are absent (their FM id left the person).
 */
export function readReepBridge(bridge) {
  if (bridge?.source?.provider !== 'Reep' || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(bridge.source.release || '') || !Array.isArray(bridge.persons)) {
    throw new Error('Not a reduced Reep bridge (npm run sync:reep-bridge)');
  }
  const keys = new Map(), persons = new Map();
  for (const [reepId, ea, fm] of bridge.persons) {
    if (!/^rp[0-9a-f]{14}$/.test(reepId)) throw new Error(`Invalid Reep id ${reepId}`);
    const person = { ea: ea.map(id => `ea:${id}`), fm: fm.map(id => `fm:${id}`) };
    for (const id of [...person.ea, ...person.fm]) {
      if (keys.has(id)) throw new Error(`The Reep bridge links ${id} to ${keys.get(id)} and ${reepId}`);
      keys.set(id, reepId);
    }
    persons.set(reepId, person);
  }
  return { release: bridge.source.release, keys, persons, rejected: bridge.rejected || [] };
}

/**
 * scripts/data/football-identity-overrides.json, hand-verified and each with its evidence: `same`, records of one
 * person; `distinct`, records of different people; `nations`, a person's nation where its records disagree and the
 * fresher-source rule would choose wrong (`ids`, every record of the person, and `nation`, a map nation's name).
 */
export function readIdentityOverrides(overrides) {
  const result = {};
  for (const kind of ['same', 'distinct', 'nations']) {
    result[kind] = overrides?.[kind] ?? [];
    if (!Array.isArray(result[kind])) throw new Error(`football-identity-overrides.json: ${kind} must be a list`);
    for (const entry of result[kind]) {
      const least = kind === 'nations' ? 1 : 2;
      if (!Array.isArray(entry.ids) || entry.ids.length < least || new Set(entry.ids).size !== entry.ids.length
        || entry.ids.some(id => !/^(ea|fm):\d+$/.test(id))) throw new Error(`football-identity-overrides.json: ${kind} entry ${JSON.stringify(entry.ids)} needs ${least === 1 ? 'one' : 'two'} or more distinct ea:/fm: ids`);
      if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) throw new Error(`football-identity-overrides.json: ${entry.ids.join(' ')} has no evidence`);
      if (kind === 'nations' && (typeof entry.nation !== 'string' || !entry.nation.trim())) throw new Error(`football-identity-overrides.json: nations entry ${entry.ids.join(' ')} names no nation`);
    }
  }
  const same = new Set(result.same.flatMap(entry => entry.ids.flatMap(a => entry.ids.map(b => `${a} ${b}`))));
  const clash = result.distinct.find(entry => entry.ids.some(a => entry.ids.some(b => a !== b && same.has(`${a} ${b}`))));
  if (clash) throw new Error(`football-identity-overrides.json: ${clash.ids.join(' ')} are listed as both one person and two`);
  const named = result.nations.flatMap(entry => entry.ids);
  if (new Set(named).size !== named.length) throw new Error('football-identity-overrides.json: a record is in two nations entries');
  return result;
}

/** How a person's nation is chosen when its records disagree (audit text). */
export const NATION_ARBITRATION = 'Each person enters exactly one nation\'s pool before any XI is picked. When its records name different nations, the first rule that applies decides. '
  + '(a) override: a nations entry of scripts/data/football-identity-overrides.json, checked by hand against the person\'s senior caps. '
  + '(b) fresher-ea / fresher-fm: the nationality of the source dated later; EA\'s when its snapshot postdates the FM database (EA FC 27 of 2026-11-01 against FM 26 26.3.0 of 2026-03-30), else FM\'s primary nationality. '
  + '(c) ea-nationality: otherwise (several EA or several FM nations) the best-rated EA record\'s nationality, or with no EA record the best-rated FM record\'s. '
  + 'A person whose chosen nation is off the map (Scotland, Wales) enters no pool. The person keeps one record in the pool, EA first, whatever nation won.';

// Club names differ between EA and FM ("Standard de Liège", "Standard"); words that many clubs share do not count.
const CLUB_WORDS = new Set(['club', 'clube', 'calcio', 'city', 'united', 'real', 'sporting', 'athletic', 'atletico', 'deportivo',
  'racing', 'union', 'inter', 'olympique', 'sport', 'sports', 'football', 'futbol', 'futebol', 'esporte', 'association']);
const clubWords = name => normalName(name || '').split(' ').filter(word => word.length >= 3 && !CLUB_WORDS.has(word));
/** Whether an EA and an FM club name share a distinctive word. */
export const clubsAgree = (a, b) => clubWords(a).some(word => clubWords(b).includes(word));

/** An EA record's normalised names: long, legal (ratings-API rows) and short, unless the short name is abbreviated
 * ("A. Dieng"). */
export const eaNameForms = player => [...new Set([player.sourceInfo.fullName, player.referenceFullName,
  /^\p{L}\.\s/u.test(player.name) ? null : player.name].filter(Boolean).map(normalName))];
const bestRecord = records => records.slice().sort((a, b) => b.rating - a.rating || a.sourceInfo.id.localeCompare(b.sourceInfo.id))[0];

/**
 * One person per real player, one nation per person. The key is assigned in this order:
 * 1. Reep: records the bridge gives one Reep id are one person, keyed by it. A `distinct` override detaches a record
 *    from its Reep person.
 * 2. identity-overrides `same` entries join their records.
 * 3. The name matcher within a nation, only between records no key pairs yet (an FM record whose person has no EA
 *    record, an EA record whose person has no FM record), never between two records that both hold Reep ids, and never
 *    when either record's Reep person (in the whole bridge, any snapshot) names a record of the other source that is
 *    not the candidate: mayBeSamePlayer, with FM's age within a year of the EA birth date on the FM age date,
 *    one-to-one. Name matches whose ages differ are two people, logged as near misses. FM records carry no birth date
 *    (EFEM), so an FM name of one word ("Danilo", "Gavi") never joins: with a same-name, same-age EA record it is left
 *    out, logged as a near miss. An FM record matching several such EA records, or one another FM record also
 *    matches, is left out rather than risk fielding one person twice.
 * 4. The name matcher across nations: an FM name of two or more words equal to an unpaired EA record's full, legal or
 *    unabbreviated short name, FM's age within a year of the EA birth date, one-to-one, a shared club word, at most one
 *    Reep id between them and no Reep person naming another record; other such twins are near misses, logged and kept
 *    apart. The within-nation token rules are too loose across 173 nations (FM Eritrea "Ali Suleiman" is a subset of EA
 *    Tanzania's "Haji Suleiman Haji Ali Mnoga"), and initials match namesakes (FM Sierra Leone's Mohamed Kamara, EA
 *    Liberia's M. Kamara).
 * A person with no Reep id is keyed by its best EA record's id, else its FM record's. Its nation follows
 * NATION_ARBITRATION (`fresher`: 'ea' or 'fm', the source dated later) and every conflict is logged. `matches` maps an
 * FM id to the EA records of its nation the name matcher accepts. Player objects gain `personKey`.
 */
export function resolvePersons({ ea, fm, matches = new Map(), bridge = null, overrides = { same: [], distinct: [], nations: [] }, fresher, ageDate }) {
  if (!['ea', 'fm'].includes(fresher)) throw new Error(`fresher must be 'ea' or 'fm', not ${fresher}`);
  const records = [...ea, ...fm], byId = new Map(records.map(player => [player.sourceInfo.id, player]));
  const parent = new Map(records.map(player => [player.sourceInfo.id, player.sourceInfo.id])), links = new Map();
  const find = id => { let root = id; while (parent.get(root) !== root) root = parent.get(root); parent.set(id, root); return root; };
  const union = (a, b, kind) => {
    const [ra, rb] = [find(a), find(b)];
    const kinds = new Set([...(links.get(ra) || []), ...(links.get(rb) || []), kind]);
    if (ra !== rb) { parent.set(rb, ra); links.delete(rb); }
    links.set(ra, kinds);
  };
  const apart = new Set(overrides.distinct.flatMap(({ ids }) => ids.flatMap(a => ids.filter(b => b !== a).map(b => `${a} ${b}`))));

  const reepKey = new Map(), groups = new Map();
  for (const player of records) {
    const reep = bridge?.keys.get(player.sourceInfo.id);
    if (reep) groups.set(reep, [...(groups.get(reep) || []), player.sourceInfo.id]);
  }
  for (const [reep, ids] of groups) {
    const kept = [];
    for (const id of ids) if (!kept.some(other => apart.has(`${other} ${id}`))) kept.push(id);
    for (const id of kept) { reepKey.set(id, reep); if (id !== kept[0]) union(kept[0], id, 'reep'); }
  }
  let sameApplied = 0;
  for (const entry of overrides.same) {
    const ids = entry.ids.filter(id => byId.has(id));
    if (ids.length < 2) continue;
    sameApplied++;
    for (const id of ids.slice(1)) union(ids[0], id, 'override');
  }
  const groupsOf = () => {
    const sets = new Map();
    for (const player of records) { const root = find(player.sourceInfo.id); sets.set(root, [...(sets.get(root) || []), player]); }
    return sets;
  };
  let sets = groupsOf();
  const holds = (id, source) => sets.get(find(id)).some(player => player.sourceInfo.source === source);
  // Two records that both hold Reep ids are two people by Reep: the name matcher never joins them (EA "A. Dieng", born
  // 2005, is not FM's Bamba Dieng, 25; Tiago Silva 17 and 32). Nor does it join a record whose Reep person names
  // another record of the candidate's source, in any snapshot of the bridge (FM 26's Danilo of Botafogo is Reep's EA
  // 273106, so he is not EA FC 26's Danilo of Rangers, who has no Reep id).
  const namesOther = (id, candidate) => !!bridge?.persons?.get(reepKey.get(id))?.[candidate.slice(0, 2)].some(other => other !== candidate);
  const reepApart = (a, b) => namesOther(a, b) || namesOther(b, a);
  const fuzzyMay = (a, b) => !(reepKey.has(a) && reepKey.has(b)) && !reepApart(a, b) && !apart.has(`${a} ${b}`);

  const omitted = new Set(), oneWord = new Set(), claims = new Map(), candidatesOf = [], nearMisses = [];
  for (const player of fm) {
    const id = player.sourceInfo.id;
    if (holds(id, 'ea-fc')) continue;
    const named = (matches.get(id) || []).filter(other => !holds(other.sourceInfo.id, 'football-manager') && fuzzyMay(other.sourceInfo.id, id));
    // A name without a matching age is another person (EA's A. Traoré, 20, is not FM's Adama Traoré, 26); the pair
    // is logged, and both stay.
    for (const other of named) if (!agesAgree(other, player, ageDate)) nearMisses.push({ ea: other, fm: player, reason: 'ages differ' });
    const candidates = named.filter(other => agesAgree(other, player, ageDate));
    if (!candidates.length) continue;
    candidatesOf.push([player, candidates]);
    for (const other of candidates) claims.set(other.sourceInfo.id, (claims.get(other.sourceInfo.id) || 0) + 1);
  }
  let withinNation = 0;
  for (const [player, candidates] of candidatesOf) {
    const id = player.sourceInfo.id;
    if (!normalName(player.name).includes(' ')) {
      oneWord.add(id); omitted.add(id);
      for (const other of candidates) nearMisses.push({ ea: other, fm: player, reason: 'one-word FM name' });
    } else if (candidates.length === 1 && claims.get(candidates[0].sourceInfo.id) === 1) { union(candidates[0].sourceInfo.id, id, 'fallback'); withinNation++; }
    else omitted.add(id);
  }

  sets = groupsOf();
  const forms = new Map();
  for (const player of ea) {
    if (holds(player.sourceInfo.id, 'football-manager')) continue;
    for (const name of eaNameForms(player)) forms.set(name, [...(forms.get(name) || []), player]);
  }
  const twinsOf = [], crossClaims = new Map();
  for (const player of fm) {
    const id = player.sourceInfo.id, name = normalName(player.name);
    if (omitted.has(id) || holds(id, 'ea-fc') || !name.includes(' ')) continue;
    // Same-nation twins were the name matcher's to join (step 3).
    const twins = [...new Set(forms.get(name) || [])].filter(other => other.nation !== player.nation && agesAgree(other, player, ageDate)
      && !apart.has(`${other.sourceInfo.id} ${id}`));
    if (!twins.length) continue;
    twinsOf.push([player, twins]);
    for (const other of twins) crossClaims.set(other.sourceInfo.id, (crossClaims.get(other.sourceInfo.id) || 0) + 1);
  }
  // Across nations a name and an age are weak evidence (EA FC 26's Pedro Díaz of Rayo Vallecano and FM's Peruvian
  // Pedro Díaz of Cusco), and a join moves a player between nations, so it also needs a shared club and at most one
  // Reep id. Twins that fail stay two people and are logged as near misses; an override settles any that both XIs
  // field.
  const crossNation = [];
  for (const [player, twins] of twinsOf) {
    const [twin] = twins;
    const reason = twins.length !== 1 || crossClaims.get(twin.sourceInfo.id) !== 1 ? 'ambiguous'
      : reepKey.has(twin.sourceInfo.id) && reepKey.has(player.sourceInfo.id) ? 'two Reep persons'
        : reepApart(twin.sourceInfo.id, player.sourceInfo.id) ? 'Reep names another record'
          : !clubsAgree(twin.club, player.club) ? 'clubs differ' : null;
    if (reason) { for (const other of twins) nearMisses.push({ ea: other, fm: player, reason }); continue; }
    union(twin.sourceInfo.id, player.sourceInfo.id, 'fallback-cross');
    crossNation.push({ ea: twin, fm: player });
  }

  sets = groupsOf();
  const nationOverride = new Map(overrides.nations.flatMap(entry => entry.ids.map(id => [id, entry])));
  const usedNationOverrides = new Set();
  const persons = [], arbitration = [], reepPairs = [];
  for (const [root, group] of sets) {
    const eaRecords = group.filter(player => player.sourceInfo.source === 'ea-fc');
    const fmRecords = group.filter(player => player.sourceInfo.source !== 'ea-fc' && !omitted.has(player.sourceInfo.id));
    if (!eaRecords.length && !fmRecords.length) continue;
    const ea0 = bestRecord(eaRecords), fm0 = bestRecord(fmRecords), player = ea0 || fm0;
    const key = group.map(record => reepKey.get(record.sourceInfo.id)).find(Boolean) || player.sourceInfo.id;
    const eaNations = new Set(eaRecords.map(record => record.nation)), fmNations = new Set(fmRecords.map(record => record.nation));
    let nation = player.nation;
    if (new Set([...eaNations, ...fmNations]).size > 1) {
      const override = group.map(record => nationOverride.get(record.sourceInfo.id)).find(Boolean);
      const fresherRule = fresher === 'fm' ? 'fresher-fm' : 'fresher-ea';
      const rule = override ? 'override' : eaNations.size === 1 && fmNations.size === 1 ? fresherRule : 'ea-nationality';
      nation = rule === 'override' ? override.nation : rule === 'fresher-fm' ? fm0.nation : player.nation;
      if (override) {
        if (!eaNations.has(nation) && !fmNations.has(nation)) throw new Error(`football-identity-overrides.json: ${override.ids.join(' ')} gives ${nation}, which none of the person's records names`);
        if ([...eaRecords, ...fmRecords].some(record => !override.ids.includes(record.sourceInfo.id))) throw new Error(`football-identity-overrides.json: nations entry ${override.ids.join(' ')} must list every record of person ${key}`);
        usedNationOverrides.add(override);
      }
      arbitration.push({ personKey: key, ea: ea0 ? { id: ea0.sourceInfo.id, nation: ea0.nation } : null,
        fm: fm0 ? { id: fm0.sourceInfo.id, nation: fm0.nation } : null, chosen: nation, rule });
    }
    for (const record of group) record.personKey = key;
    if (ea0 && fm0 && reepKey.get(ea0.sourceInfo.id) && reepKey.get(ea0.sourceInfo.id) === reepKey.get(fm0.sourceInfo.id)) reepPairs.push({ ea: ea0, fm: fm0 });
    persons.push({ key, nation, player, ea: eaRecords, fm: fmRecords,
      link: ea0 && fm0 ? [...links.get(root)].sort().join('+') : null });
  }
  // An override that decides nothing is stale: its records agree now, or a snapshot dropped them.
  const unused = overrides.nations.filter(entry => entry.ids.some(id => byId.has(id)) && !usedNationOverrides.has(entry));
  if (unused.length) throw new Error(`football-identity-overrides.json: nations entries that decide no conflict: ${unused.map(entry => entry.ids.join(' ')).join('; ')}`);
  const keyed = source => records.filter(player => player.sourceInfo.source === source && reepKey.has(player.sourceInfo.id)).length;
  return { persons, arbitration, reepPairs, omitted: [...omitted], crossNation, nearMisses,
    stats: { release: bridge?.release ?? null, eaRecords: ea.length, fmRecords: fm.length, persons: persons.length,
      reep: { ea: keyed('ea-fc'), fm: keyed('football-manager'), pairs: reepPairs.length },
      overrides: { same: sameApplied, distinct: overrides.distinct.filter(entry => entry.ids.filter(id => byId.has(id)).length >= 2).length,
        nations: usedNationOverrides.size },
      fallback: { withinNation, crossNation: crossNation.length, omittedAmbiguous: omitted.size - oneWord.size, omittedOneWord: oneWord.size } } };
}

/**
 * Every pool's XI. resolvePersons puts each person in one nation's pool before any XI is picked, so no person can
 * start twice or for two nations; a person key twice in one pool or in two pools is a builder error. `pools` maps a
 * nation id to its players; the result maps it to { pool, squad }.
 */
export function pickNationSquads(pools) {
  const owner = new Map();
  for (const [id, pool] of Object.entries(pools)) {
    for (const player of pool) {
      const key = personKeyOf(player);
      if (owner.has(key)) throw new Error(`Person ${key} is twice in the pools: ${owner.get(key)} and ${id}`);
      owner.set(key, id);
    }
  }
  return Object.fromEntries(Object.entries(pools).map(([id, pool]) => [id, { pool, squad: pickFootballSquad(pool) }]));
}

/** Mean EA − FM game rating over linked pairs (FM = round(CA × 0.99)), with a normal 95% interval: the fuzzy pairs
 * (one-to-one name matches within a nation), and the Reep-linked pairs as linking.reep. */
export function linkingCheck(pairs) {
  const gaps = pairs.map(pair => pair.ea.rating - pair.fm.rating);
  const n = gaps.length, average = n ? gaps.reduce((total, gap) => total + gap, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(gaps.reduce((total, gap) => total + (gap - average) ** 2, 0) / (n - 1)) : 0;
  const round = value => Math.round(value * 100) / 100 + 0;
  const half = n ? 1.96 * sd / Math.sqrt(n) : 0;
  return { pairs: n, meanEaMinusFm: round(average), ci95: [round(average - half), round(average + half)] };
}
