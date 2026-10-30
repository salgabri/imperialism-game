// Football data sets beyond the built-in season (docs/design/football-years.md). A
// Championship Manager 01/02 Data folder, read by src/data/cm0102.js, becomes one season's
// national squads, top-flight clubs and territory. No I/O here, and only src/ imports, so
// the same build runs in Node and in the browser: scripts/build-football-set.mjs reads the
// folder and writes the results, and tests build sets from synthetic folders.
// Every player written is a stored CM record that rebuilds exactly from its tuple; a
// nation with fewer than eleven natural players keeps exactly the ones it has.
import { NATIONS, selectLineup } from './teams.js';
import { CM_CONVERSION, CM_SCALE, cmNaturalPositions, cmTupleOf, expandCmTuple } from './cmPlayers.js';
import { cmMonthDay, decodeCmDate, fileSignature, readCm0102 } from './cm0102.js';
import { CM0102_RELEASES } from './cm0102Releases.js';
import { CM0102_NATIONS } from './cm0102Nations.js';
import { FOOTBALL_FEDERATIONS } from './footballFederations.js';
import { pickFootballSquad } from './footballSquad.js';
import { sha256 } from './sha256.js';

export const FOOTBALL_SET_FORMAT = 1;
export const SET_ID = /^cm0102-\d{4}-\d{2}(?:-[a-z0-9]+)?$/;
/** Seasons ending earlier use the Soviet Union, Yugoslavia and both Germanys: they need identity overrides first. */
export const FIRST_YEAR = 2002;
/** The last season-end year the game loads (isDataYear in src/engine/footballSets.js). */
export const LAST_YEAR = 2100;
export const NO_TEAM = 'noTeam';
const DEFAULT_PROVIDER = 'CM 01/02 Update Team';
const CLUB_SIZE = 11;

// The built-in league ids and map shapes (scripts/build-clubs.mjs FOOTBALL_LEAGUES), so a club theatre means the same
// in every set. Each is found by its stored CM name or CM0102Patcher's rename, in a competition of that nation.
export const LEAGUES = {
  'Premier League': { country: '826', names: ['English Premier Division', 'English Premier League'] },
  'La Liga': { country: '724', names: ['Spanish First Division', 'Spanish La Liga'] },
  'Serie A': { country: '380', names: ['Italian Serie A'] },
  Bundesliga: { country: '276', names: ['German First Division', 'German Bundesliga'] },
  'Ligue 1': { country: '250', names: ['French First Division', 'French Ligue 1'] },
  Eredivisie: { country: '528', names: ['Dutch Premier Division', 'Dutch Eredivisie'] },
  'Liga Portugal': { country: '620', names: ['Portuguese Premier League', 'Liga Portugal 1'] },
};

// Real birthdays of players spread across the database era, to check the stored birth-year shift. Players only,
// because the reader returns players (so no managers such as Alex Ferguson).
export const FAMOUS_BIRTHDAYS = [
  ['Ryan Giggs', '1973-11-29'], ['Thierry Henry', '1977-08-17'], ['Gianluigi Buffon', '1978-01-28'],
  ['Frank Lampard', '1978-06-20'], ['Steven Gerrard', '1980-05-30'], ['John Terry', '1980-12-07'],
  ['Iker Casillas', '1981-05-20'], ['Cristiano Ronaldo', '1985-02-05'], ['Luka Modric', '1985-09-09'],
  ['Wayne Rooney', '1985-10-24'], ['Sergio Ramos', '1986-03-30'], ['Lionel Messi', '1987-06-24'],
  ['Gareth Bale', '1989-07-16'], ['Mohamed Salah', '1992-06-15'], ['Harry Kane', '1993-07-28'],
  ['Erling Haaland', '2000-07-21'], ['Bukayo Saka', '2001-09-05'], ['Jude Bellingham', '2003-06-29'],
];

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Club codes must be three capitals (src/engine/footballSets.js), and makeCode keeps letters such as Ü.
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const signed = n => (n < 0 ? String(n) : `+${n}`);
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// ---- Club presentation: copied from scripts/build-clubs.mjs, and must stay in step with it ----

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A club's three-letter code, unique within `taken` (which it extends), as build-clubs makes it. */
export function makeCode(name, taken) {
  const words = name.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(de|do|da|of|the|fc|cf|ac|sc|as|ss|us|club|calcio|deportivo)$/i.test(w));
  const candidates = [];
  if (words.length >= 3) candidates.push(words.slice(0, 3).map(w => w[0]).join(''));
  if (words.length >= 2) candidates.push(words[0][0] + words[1].slice(0, 2));
  if (words.length >= 2) candidates.push(words[0].slice(0, 2) + words[1][0]);
  if (words.length) candidates.push(words[0].slice(0, 3));
  candidates.push(name.replace(/[^A-Za-z]/g, '').slice(0, 3));
  for (const c of candidates) {
    const code = c.toUpperCase().padEnd(3, 'X').slice(0, 3);
    if (code.length === 3 && !taken.has(code)) { taken.add(code); return code; }
  }
  for (let i = 0; i < 999; i++) {
    const code = (name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() + i).slice(0, 3);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  return 'CLB';
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A club's colour from its id, as build-clubs gives it. */
export const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;

/**
 * A set's club rows, strongest first, from `built` ([{ name, league, country, str, squad }], each squad player
 * carrying its `tuple`): `f-<slug>` ids (a clash gets a suffix, and a warning), three-capital codes and colours, as
 * build-clubs makes them. Shared by the CM 01/02 and EA season builders.
 */
export function presentClubs(built, warn) {
  const codes = new Set(), ids = new Set();
  return built.slice().sort((a, b) => b.str - a.str || byText(a.name, b.name)).map(club => {
    const base = `f-${slug(club.name)}`;
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    if (id !== base) warn(`Two clubs make the id ${base}; the weaker is ${id}`);
    ids.add(id);
    const code = makeCode(ascii(club.name), codes);
    if (!/^[A-Z0-9]{3}$/.test(code)) throw new Error(`No three-capital code for the club ${club.name} (got ${code})`);
    return { id, name: club.name, code, league: club.league, country: club.country, col: colourFor(id),
      str: club.str, squad: club.squad.map(p => p.tuple) };
  });
}

// ---- Identification ----

/** The manifest entry whose club.dat and staff.dat sizes match, with the matching signature, or null. */
export function identifyDatabase(signature, databases) {
  for (const database of databases) {
    const match = database.signatures.find(s => s.club === signature.clubSize && s.staff === signature.staffSize);
    if (match) return { database, match };
  }
  return null;
}

/** '2025/26' -> 2026, the season-end year a set is filed under. */
export function seasonYear(season) {
  const m = /^(\d{4})\/(\d{2})$/.exec(String(season));
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) throw new Error(`Season "${season}" is not like 2025/26`);
  return Number(m[1]) + 1;
}

/** Every known release from July on starts a season, and earlier ones update the season in progress. */
export function seasonOfRelease(released) {
  const [year, month] = released.split('-').map(Number);
  const start = month >= 7 ? year : year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

const FLAGS = { id: '--id', label: '--label', provider: '--provider', season: '--season', released: '--released', url: '--url', dobShift: '--dob-shift' };

/**
 * Who made the folder and for which season: a known database by its signature, or an unknown one named by the
 * identity flags (label, released, url and dobShift required; id, season and provider derived when left out).
 */
export function resolveDatabase(signature, databases, identity = {}) {
  // A flag of only spaces is not given: the game refuses a set with a blank label or provider.
  const flag = Object.fromEntries(Object.keys(FLAGS).map(key => [key, identity[key] == null ? '' : String(identity[key]).trim()]));
  const given = Object.keys(FLAGS).filter(key => flag[key] !== '');
  const found = identifyDatabase(signature, databases);
  if (found) {
    const { database, match } = found;
    return {
      known: true, id: database.id, label: database.label, provider: database.provider, season: database.season,
      year: database.year, released: database.released, url: database.url, dobShift: database.shifts.birth, match,
      ignored: given.map(key => FLAGS[key]), defaulted: [],
    };
  }
  const missing = ['label', 'released', 'url', 'dobShift'].filter(key => !given.includes(key));
  if (missing.length) {
    throw new Error(`Unknown CM 01/02 database (club.dat ${signature.clubSize} bytes, staff.dat ${signature.staffSize} bytes, `
      + `staff format ${signature.staffFormat}): it is not in src/data/cm0102Releases.js. Name it with `
      + `${missing.map(key => `${FLAGS[key]}=...`).join(' ')} (and optionally --id, --season, --provider)`);
  }
  const { label, released, url } = flag;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(released)) throw new Error(`--released=${released} is not a month like 2026-05`);
  if (!/^https:\/\/\S+$/.test(url)) throw new Error(`--url=${url} is not an https URL`);
  // Digits only, so a hex or exponent spelling is not read as a number.
  const dobShift = /^[+-]?\d{1,3}$/.test(flag.dobShift) ? Number(flag.dobShift) : NaN;
  if (Number.isNaN(dobShift) || Math.abs(dobShift) > 100) throw new Error(`--dob-shift=${flag.dobShift} is not a whole number of years from -100 to 100`);
  const season = given.includes('season') ? flag.season : seasonOfRelease(released);
  const year = seasonYear(season);
  if (year > LAST_YEAR) throw new Error(`Season ${season} ends after ${LAST_YEAR}, the last year the game loads`);
  const id = given.includes('id') ? flag.id : `cm0102-${released}`;
  if (!SET_ID.test(id)) throw new Error(`--id=${id} is not like cm0102-2026-05 (or cm0102-2012-03-odb)`);
  const clash = databases.find(d => d.id === id);
  if (clash) throw new Error(`Data set id ${id} belongs to the known database ${clash.label}, which this folder is not; give it its own --id, such as ${id}-custom`);
  return {
    known: false, id, label, provider: given.includes('provider') ? flag.provider : DEFAULT_PROVIDER,
    season, year, released, url, dobShift, match: null, ignored: [],
    defaulted: ['id', 'season', 'provider'].filter(key => !given.includes(key)).map(key => FLAGS[key]),
  };
}

function fileNamed(files, name) {
  const key = Object.keys(files).find(k => k.toLowerCase() === name);
  return key ? files[key] : null;
}

// ---- Mapping, territory, birth shift ----

/** CM nation name -> game nation id, NO_TEAM, or null when neither cm0102Nations.js nor a game nation's name knows it. */
export function nationResolver({ aliases = {}, noTeam = [] } = {}) {
  const map = new Map(Object.entries(NATIONS).map(([id, rec]) => [fold(rec[0]), id]));
  for (const [name, id] of Object.entries(aliases)) {
    if (!NATIONS[id]) throw new Error(`cm0102Nations.js maps "${name}" to ${id}, which is not a game nation`);
    map.set(fold(name), id);
  }
  for (const name of noTeam) {
    if (map.has(fold(name))) throw new Error(`cm0102Nations.js lists "${name}" as having no team, but it maps to ${map.get(fold(name))}`);
    map.set(fold(name), NO_TEAM);
  }
  return name => map.get(fold(name)) ?? null;
}

/**
 * Shapes merged into another nation's empire, and shapes with no federation, in season-end year `year`: an
 * association takes part once it was a FIFA member by the cutoff (30 June) of that year.
 */
export function territoryFor({ cutoff = '06-30', shapes = {} } = {}, year) {
  const merged = {}, inactive = [];
  for (const [shape, federation] of Object.entries(shapes).sort(([a], [b]) => byText(a, b))) {
    if (!NATIONS[shape] || (federation.heldBy && !NATIONS[federation.heldBy])) throw new Error(`footballFederations.js names ${shape} held by ${federation.heldBy}, not both game nations`);
    if (federation.member <= `${year}-${cutoff}`) continue;
    if (federation.heldBy) merged[shape] = federation.heldBy;
    else inactive.push(shape);
  }
  return { merged, inactive };
}

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const dayIndex = (month, day) => MONTH_START[month - 1] + day;

/** Of two stored copies of one person, the one to keep: at a club, then the higher CA, then the lower id. */
const preferred = (a, b) => (a.club != null) - (b.club != null) || a.ca - b.ca || b.id - a.id;

/**
 * Estimate the birth-year shift (real = stored + shift) from players whose name and stored day and month match a known
 * birthday, within a day of jitter. Conclusive with at least five agreeing famous players making up 80% of those
 * matched. A person stored twice is one witness: the copy de-duplication would keep (`duplicates` counts the others).
 */
export function estimateBirthShift(players, famous = FAMOUS_BIRTHDAYS) {
  const wanted = new Map(famous.map(([name, date]) => [fold(name), { name, date }]));
  const chosen = new Map();
  let duplicates = 0;
  for (const player of players) {
    if (!player.dob) continue;
    const forms = [player.name, player.fullName, player.commonName, [player.firstName, player.secondName].filter(Boolean).join(' ')];
    const known = forms.filter(Boolean).map(form => wanted.get(fold(form))).find(Boolean);
    if (!known) continue;
    const stored = cmMonthDay(player.dob.dayOfYear, player.dob.leap);
    const [, month, day] = known.date.split('-').map(Number);
    if (Math.abs(dayIndex(stored.month, stored.day) - dayIndex(month, day)) > 1) continue;
    const prior = chosen.get(known.name);
    if (prior) duplicates++;
    if (!prior || preferred(player, prior.player) > 0) chosen.set(known.name, { player, known });
  }
  const samples = [...chosen.values()].map(({ player, known }) => ({
    name: known.name, cmId: player.id, stored: player.dob.year, shift: Number(known.date.slice(0, 4)) - player.dob.year,
  }));
  const tally = new Map();
  for (const sample of samples) tally.set(sample.shift, (tally.get(sample.shift) || 0) + 1);
  const [shift = null, agreeing = 0] = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [];
  return { matches: samples.length, shift, agreeing, conclusive: agreeing >= 5 && agreeing * 5 >= samples.length * 4, duplicates, samples };
}

// ---- The data set ----

/** Version hash: the first 8 hex of the SHA-256 of the set's compact JSON without its version field. */
export function contentHash(doc) {
  const { version, ...rest } = doc;
  return sha256(JSON.stringify(rest)).slice(0, 8);
}

export const serializeFootballSet = doc => `${JSON.stringify(doc)}\n`;

/**
 * Build one data set from a Data folder `{ fileName: Uint8Array }`. Options: `databases` (default CM0102_RELEASES),
 * `nationMap` (default CM0102_NATIONS), `federations` (default FOOTBALL_FEDERATIONS), `identity` (the flags for an
 * unknown folder), `allowUnmapped`, `famous` (birthdays for the shift check) and `verifyFiles` (false skips the
 * SHA-256 of a known database's club.dat and staff.dat, tens of MB). Returns `{ doc, text, audit, summary,
 * warnings }`; throws on an unknown layout, an unmapped nation (unless allowed) or an unnamed database.
 */
export function buildFootballSet(files, {
  databases = CM0102_RELEASES, nationMap = CM0102_NATIONS, federations = FOOTBALL_FEDERATIONS, identity = {}, allowUnmapped = false,
  famous = FAMOUS_BIRTHDAYS, verifyFiles = true,
} = {}) {
  const warnings = [];
  const warn = message => warnings.push(message);
  const signature = fileSignature(files);
  const database = resolveDatabase(signature, databases, identity);
  if (database.ignored.length) warn(`${database.label} is a known database, so ${database.ignored.join(', ')} ${database.ignored.length > 1 ? 'are' : 'is'} ignored`);
  if (database.year < FIRST_YEAR) {
    throw new Error(`Season ${database.season} ends in ${database.year}: seasons ending before ${FIRST_YEAR} are refused for now, because `
      + 'they need historic nation identities as well as territory (docs/design/football-years.md)');
  }
  const digests = {};
  if (database.match) {
    for (const key of ['club', 'staff']) {
      const expected = database.match[`${key}Sha256`];
      digests[key] = !expected ? 'not known' : !verifyFiles ? 'not checked'
        : sha256(fileNamed(files, `${key}.dat`)) === expected ? 'match' : 'mismatch';
      if (digests[key] === 'mismatch') warn(`${key}.dat has the size of ${database.label} but not its SHA-256: the folder may have been edited`);
    }
  }

  const parsed = readCm0102(files);
  const oracle = estimateBirthShift(parsed.players, famous);
  const { dobShift } = database;
  const shiftSource = database.known ? 'the manifest' : '--dob-shift';
  if (oracle.conclusive && oracle.shift !== dobShift) {
    if (!database.known) {
      throw new Error(`--dob-shift=${dobShift} disagrees with known birthdays, which give ${signed(oracle.shift)} `
        + `(${oracle.agreeing} of ${oracle.matches} famous players): check the database's season and shift`);
    }
    warn(`BIRTH SHIFT MISMATCH: known birthdays give ${signed(oracle.shift)} (${oracle.agreeing} of ${oracle.matches} famous players), `
      + `but the manifest gives ${database.label} ${signed(dobShift)}; dates of birth use the manifest`);
  } else if (!oracle.conclusive) {
    warn(`Birth shift check inconclusive (${oracle.matches} famous players found, ${oracle.agreeing} agreeing); using ${signed(dobShift)} from ${shiftSource}`);
  }

  const resolve = nationResolver(nationMap);
  const nationRows = parsed.nations.map(n => {
    const id = resolve(n.name);
    return { name: n.name, id: id === NO_TEAM ? null : id, key: id && id !== NO_TEAM ? id : `cm:${fold(n.name)}`, noTeam: id === NO_TEAM, unmapped: id == null };
  });
  const clubByRow = new Map(parsed.clubs.map(c => [c.row, c]));
  const source = {
    provider: database.provider, edition: 'CM 01/02', version: database.label, snapshotDate: database.released,
    url: database.url, rawScale: CM_SCALE, conversion: CM_CONVERSION, dobShift,
  };

  // Eligible players: a CA on the 1-200 scale, natural positions, and a nation that is mapped or deliberately teamless.
  const dropped = { nameless: 0, noAbility: 0, noPositions: 0, noNationality: 0, unmapped: 0, duplicates: 0 };
  const unmapped = {}, noTeam = {};
  const kept = new Map();
  for (const [row, player] of parsed.players.entries()) {
    if (!player.name) { dropped.nameless++; continue; }
    if (!Number.isInteger(player.ca) || player.ca < 1 || player.ca > CM_SCALE) { dropped.noAbility++; continue; }
    const keys = cmNaturalPositions(player.ratings);
    if (!keys.length) { dropped.noPositions++; continue; }
    if (player.nation == null) { dropped.noNationality++; continue; }
    const nation = nationRows[player.nation];
    if (nation.unmapped) { dropped.unmapped++; unmapped[nation.name] = (unmapped[nation.name] || 0) + 1; continue; }
    const dateOfBirth = decodeCmDate(player.dob, dobShift) || '';
    const candidate = { player, keys, nation, dateOfBirth };
    // The same person can be stored twice, with or without diacritics, or once at a club and once unattached. Without
    // a date of birth two namesakes cannot be told from one person, so both stay.
    const key = dateOfBirth ? `${fold(player.fullName || player.name)}|${dateOfBirth}|${nation.key}` : `row:${row}`;
    const prior = kept.get(key);
    if (prior) dropped.duplicates++;
    if (!prior || preferred(player, prior.player) > 0) kept.set(key, candidate);
  }
  const unmappedNames = Object.keys(unmapped).sort(byText);
  if (unmappedNames.length && !allowUnmapped) {
    throw new Error(`CM nations with no game nation, and not listed as having no team: ${unmappedNames.map(name => `${name} (${unmapped[name]} players)`).join(', ')}. `
      + 'Add them to src/data/cm0102Nations.js (aliases or noTeam), or pass --allow-unmapped to leave their players out');
  }
  if (unmappedNames.length) warn(`Left out the players of unmapped nations: ${unmappedNames.map(name => `${name} (${unmapped[name]})`).join(', ')}`);

  const seen = new Set();
  const players = [...kept.values()].sort((a, b) => a.player.id - b.player.id).map(({ player, keys, nation, dateOfBirth }) => {
    if (seen.has(player.id)) throw new Error(`Two eligible players share CM staff id ${player.id}`);
    seen.add(player.id);
    // Players of nations without a team still play for their clubs.
    if (nation.noTeam) noTeam[nation.name] = (noTeam[nation.name] || 0) + 1;
    const tuple = [player.id, player.name, player.fullName && player.fullName !== player.name ? player.fullName : 0, player.ca,
      keys.join(','), nation.name, player.club == null ? '' : clubByRow.get(player.club).name, dateOfBirth];
    const [name, pos, rating, sourceInfo] = expandCmTuple(tuple, source);
    if (JSON.stringify(cmTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`CM player ${player.id} (${player.name}) does not rebuild from its tuple`);
    return { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple, club: player.club, nationId: nation.id };
  });

  const pools = new Map();
  for (const player of players) if (player.nationId) (pools.get(player.nationId) || pools.set(player.nationId, []).get(player.nationId)).push(player);
  const nations = {}, nationAudit = [];
  for (const [id, rec] of Object.entries(NATIONS)) {
    const pool = pools.get(id) || [];
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: 'football', squad });
    nations[id] = [Math.round(lineup.rating), pool.length, squad.map(p => p.tuple)];
    nationAudit.push({ id, name: rec[0], pool: pool.length, players: squad.length, strength: nations[id][0],
      goalkeeper: squad.some(p => p.positions.includes('GK')),
      naturalLineup: squad.length === CLUB_SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }

  const clubPools = new Map();
  for (const player of players) if (player.club != null) (clubPools.get(player.club) || clubPools.set(player.club, []).get(player.club)).push(player);
  const built = [], leagueAudit = [];
  for (const [league, { country, names }] of Object.entries(LEAGUES)) {
    const wanted = new Set(names.map(fold));
    // Members by division, never by club nation (cross-border clubs exist); an extinct club has no players.
    const membersOf = comp => parsed.clubs.filter(club => club.division === comp.row && club.nation != null);
    const comps = parsed.competitions.filter(c => wanted.has(fold(c.name)) && c.nation != null && nationRows[c.nation].id === country)
      .map(comp => ({ comp, members: membersOf(comp) }));
    if (!comps.length) {
      warn(`No ${league} in this database: no ${names.join(' or ')} of ${NATIONS[country][0]}`);
      leagueAudit.push({ league, country, competition: null, members: 0, clubs: 0, short: [] });
      continue;
    }
    const { comp, members } = comps.reduce((best, c) => (c.members.length > best.members.length ? c : best));
    if (comps.length > 1) warn(`${comps.length} competitions could be ${league}; using ${comp.name} (${members.length} clubs)`);
    const short = [];
    for (const club of members) {
      const squad = pickFootballSquad(clubPools.get(club.row) || []);
      if (squad.length < CLUB_SIZE) { short.push({ name: club.name, players: squad.length }); continue; }
      built.push({ name: club.name, league, country, str: Math.round(mean(squad.map(p => p.rating))), squad });
    }
    leagueAudit.push({ league, country, competition: comp.name, members: members.length, clubs: members.length - short.length, short });
  }
  const clubs = presentClubs(built, warn);

  const territory = territoryFor(federations, database.year);
  const written = new Set([...Object.values(nations).flatMap(([, , squad]) => squad), ...clubs.flatMap(club => club.squad)].map(tuple => tuple[0]));
  const coverage = {
    players: written.size, nations: nationAudit.filter(n => n.players).length,
    completeXIs: nationAudit.filter(n => n.naturalLineup).length, clubs: clubs.length, leagues: new Set(clubs.map(c => c.league)).size,
  };
  const doc = {
    format: FOOTBALL_SET_FORMAT, id: database.id, version: '', year: database.year, season: database.season,
    label: `CM 01/02 · ${database.label}`, local: true, source, nations, clubs, territory, coverage,
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;

  const audit = {
    generatedBy: 'scripts/build-football-set.mjs',
    id: doc.id, version: doc.version,
    database: {
      known: database.known, label: database.label, provider: database.provider, season: database.season, released: database.released,
      url: database.url, signature, digests, defaulted: database.defaulted,
    },
    parser: { format: parsed.format, counts: parsed.counts, index: parsed.index, warnings: parsed.warnings },
    birthShift: { used: dobShift, from: shiftSource, oracle },
    players: { read: parsed.players.length, eligible: players.length, written: coverage.players, dropped },
    unmapped, noTeam, leagues: leagueAudit, territory, nations: nationAudit, warnings,
  };
  const summary = [
    `${doc.id}: ${database.label}, season ${database.season} (${database.known ? 'known database' : `named by flags${database.defaulted.length ? `; defaulted ${database.defaulted.join(', ')}` : ''}`})`,
    `National squads: ${coverage.completeXIs}/${Object.keys(NATIONS).length} complete natural XIs, ${coverage.nations} nations with players, ${coverage.players} players written`,
    `Clubs: ${clubs.length} (${leagueAudit.map(l => `${l.league} ${l.clubs}`).join(', ')})`,
    `Birth shift ${signed(dobShift)} from ${shiftSource}; famous players: ${oracle.matches} found, ${oracle.agreeing} agree${oracle.shift == null ? '' : ` on ${signed(oracle.shift)}`}`
      + `${oracle.duplicates ? ` (${oracle.duplicates} more stored ${oracle.duplicates > 1 ? 'copies' : 'copy'} not counted)` : ''}`,
    `Unmapped nations: ${unmappedNames.length ? unmappedNames.map(name => `${name} (${unmapped[name]})`).join(', ') : 'none'}`,
    `Dropped: ${Object.entries(dropped).map(([why, n]) => `${n} ${why}`).join(', ')}`,
  ];
  return { doc, text: serializeFootballSet(doc), audit, summary, warnings: [...parsed.warnings.map(w => `cm0102: ${w}`), ...warnings] };
}

/** index.json for the sets present, newest season first, checking each set's format, id and version. */
export function buildFootballIndex(docs) {
  for (const doc of docs) {
    if (doc?.format !== FOOTBALL_SET_FORMAT || !SET_ID.test(doc.id) || doc.version !== `${doc.id}-${contentHash(doc)}`) {
      throw new Error(`${doc?.id ?? 'A data set'} is not a format-${FOOTBALL_SET_FORMAT} football data set with a matching version`);
    }
  }
  const sets = docs.map(doc => ({ id: doc.id, version: doc.version, year: doc.year, season: doc.season, label: doc.label,
    provider: doc.source.provider, local: doc.local, coverage: doc.coverage }));
  return { format: FOOTBALL_SET_FORMAT, sets: sets.sort((a, b) => b.year - a.year || byText(b.id, a.id)) };
}
