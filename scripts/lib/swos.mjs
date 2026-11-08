// The 1996/97 football season from Sensible World of Soccer 96/97 (docs/design/football-years.md, "SWOS 96/97"): each
// national team's own record of its sixteen players becomes that nation's squad, in the data set format the game loads
// (src/engine/footballSets.js, kind 'swos'). Nations only: at club level the database names some players at two
// clubs, so its clubs are not one moment's. No I/O here: scripts/build-retro-seasons.mjs reads the database and writes
// the files, and tests build seasons from invented rows. Every rating is SWOS's own price step, converted by
// src/data/swosPlayers.js; nothing is generated.
import { NATIONS, PACIFIC_ISLANDS, selectLineup } from '../../src/data/teams.js';
import { SWOS_ROLES, SWOS_SCALE, SWOS_SKILLS, expandSwosTuple, swosTupleOf } from '../../src/data/swosPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, nationResolver, serializeFootballSet, territoryFor } from '../../src/data/footballSetBuild.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';

/** The game's id of this season and how many players each national team has. */
export const SWOS_ID = 'swos-9697';
export const SWOS_SQUAD = 16;
const CLUB_SIZE = 11;

/**
 * SWOS's national team names as the game names its nations. A name equal to a game nation's (without accents, case or
 * extra spaces) needs no entry. `noTeam` are SWOS's teams with no shape on the game's map; their players are left out,
 * as nations-only seasons have no clubs for them to play for.
 */
export const SWOS_NATIONS = {
  aliases: {
    Holland: '528', 'Czech Republic': '203', 'Republic Ireland': '372', 'Ivory Coast': '384', Yugoslavia: '688', Macedonia: '807',
    Swaziland: '748', Surinam: '740', Taiwan: '158', 'Trinidad-Tobago': '780', 'United Arab Emis': '784',
  },
  noTeam: ['Bahrain', 'Bermuda', 'Faroe Isles', 'Hong Kong', 'Liechtenstein', 'Malta', 'Mauritius', 'San Marino', 'Singapore', 'St. Vincent'],
};

// ---- Names ----

// SWOS writes names in capitals. They are set in the case of the player's own country: each word capitalised, also
// after a hyphen or full stop ("Omam-Biyik", "S.M. Aslam"), "Mc" names as "McCoist", and the particles of a surname
// in lower case where that country writes them so (Dutch "van der Sar", Spanish "de la Peña", Portuguese "da Silva",
// German "von"), but not in Italy ("Del Piero", "Di Matteo"), in Belgium ("Van der Elst": the first one capitalised) or
// anywhere else. Only the case changes, so the name in capitals is SWOS's exactly.
const PARTICLES = {
  dutch: new Set(['van', 'der', 'den', 'de', 'ten', 'ter', 'het']),
  flemish: new Set(['van', 'der', 'den', 'de', 'vande', 'vanden']),
  spanish: new Set(['de', 'del', 'la', 'las', 'los', 'y']),
  portuguese: new Set(['da', 'das', 'de', 'do', 'dos', 'e']),
  german: new Set(['von', 'van', 'der', 'den', 'zu']),
};
/** SWOS's nationality codes by the way their country writes surname particles. */
const PARTICLE_STYLE = {
  HOL: 'dutch', BEL: 'flemish', GER: 'german', AUT: 'german', POR: 'portuguese', BRA: 'portuguese', ANG: 'portuguese', MOZ: 'portuguese',
  ESP: 'spanish', ARG: 'spanish', BOL: 'spanish', CHL: 'spanish', COL: 'spanish', CRC: 'spanish', ECU: 'spanish', ELS: 'spanish',
  GUA: 'spanish', HON: 'spanish', MEX: 'spanish', NIC: 'spanish', PAN: 'spanish', PAR: 'spanish', PER: 'spanish', VNZ: 'spanish',
};
/** Names the rule above would set wrongly, in capitals: the case they take. */
export const SWOS_NAME_EXCEPTIONS = {};

const capitalised = word => word.toLowerCase().replace(/(^|[-.])([a-z])/g, (_, at, letter) => at + letter.toUpperCase())
  .replace(/^Mc([a-z])/, (_, letter) => `Mc${letter.toUpperCase()}`);

/** A SWOS name in capitals, as its player's country writes it (`nationality` is the player's SWOS code). */
export function properCase(name, nationality) {
  if (Object.hasOwn(SWOS_NAME_EXCEPTIONS, name)) return SWOS_NAME_EXCEPTIONS[name];
  const style = PARTICLE_STYLE[nationality];
  const words = name.split(' ');
  let run = 0;
  const cased = words.map((word, i) => {
    const lower = word.toLowerCase();
    const particle = i > 0 && i < words.length - 1 && style && PARTICLES[style].has(lower);
    if (!particle) { run = 0; return capitalised(word); }
    // Belgium capitalises the first particle of a surname and lowers the rest; elsewhere they are all lower case.
    return style === 'flemish' && run++ === 0 ? capitalised(word) : lower;
  });
  const out = cased.join(' ');
  if (out.toUpperCase() !== name) throw new Error(`Casing ${name} changed more than its case (${out})`);
  return out;
}

// ---- The season ----

const count = (map, key) => { map[key] = (map[key] || 0) + 1; };

/**
 * Build the season from the database's national team records: `rows` are its `players` rows of type NATIONAL (`id`,
 * `name`, `pos`, `nat`, the seven skills, `GK`, `TOT`, `value` in pounds, `team`), `source` the season's source block.
 * Returns `{ doc, text, audit, warnings }`; throws on anything it does not understand rather than guess.
 */
export function buildSwosSeason(rows, { source, year, federations = FOOTBALL_FEDERATIONS, prices }) {
  const warnings = [];
  const resolve = nationResolver(SWOS_NATIONS);
  const valueOf = new Map(prices.map((price, step) => [price, step]));
  const teams = new Map();
  for (const row of rows) {
    if (row.type !== 'NATIONAL') throw new Error(`Row ${row.id} (${row.name}) is not a national team record`);
    (teams.get(row.team) || teams.set(row.team, []).get(row.team)).push(row);
  }
  const seen = new Set(), noTeam = {}, unmapped = [];
  const nationOf = new Map();
  for (const [team, members] of teams) {
    if (members.length !== SWOS_SQUAD) throw new Error(`${team} has ${members.length} players, not ${SWOS_SQUAD}`);
    const teamName = properCase(team, null);
    const id = resolve(teamName);
    if (id == null) unmapped.push(team);
    else if (id !== NO_TEAM && nationOf.has(id)) throw new Error(`${team} and ${nationOf.get(id).team} are both ${NATIONS[id][0]}`);
    if (id && id !== NO_TEAM) nationOf.set(id, { team, teamName, members });
    if (id === NO_TEAM) noTeam[teamName] = members.length;
  }
  if (unmapped.length) throw new Error(`SWOS national teams with no game nation, and not listed as having no team: ${unmapped.join(', ')}. Add them to SWOS_NATIONS`);

  const players = new Map(), names = [];
  for (const { teamName, members } of nationOf.values()) {
    for (const row of members) {
      if (!Number.isInteger(row.id) || row.id < 1 || seen.has(row.id)) throw new Error(`Row id ${row.id} is invalid or repeated`);
      seen.add(row.id);
      const key = String(row.pos).toLowerCase();
      if (!Object.hasOwn(SWOS_ROLES, key)) throw new Error(`${row.name} (${teamName}) has position ${row.pos}`);
      const value = valueOf.get(row.value);
      if (!Number.isInteger(value) || value < 1 || value > SWOS_SCALE) throw new Error(`${row.name} (${teamName}) has price ${row.value}, not a SWOS value step`);
      const skills = SWOS_SKILLS.map(skill => row[skill]);
      if (skills.some(skill => !Number.isInteger(skill) || skill < 0 || skill > 7)) throw new Error(`${row.name} (${teamName}) has skills ${skills.join(',')}`);
      const total = skills.reduce((sum, skill) => sum + skill, 0);
      if (key === 'g') {
        // A goalkeeper has no skills; the database's GK figure is his price step again (0 for the cheapest, 25K).
        if (total !== 0 || !(row.GK === value || (value === 1 && row.GK === 0))) {
          throw new Error(`Goalkeeper ${row.name} (${teamName}) has skills ${skills.join('')} or GK ${row.GK} for price step ${value}`);
        }
      } else if (Math.max(1, Math.min(total, 48)) !== value) {
        // SWOS prices an outfield player by his skills: the step is their sum, from 1 (25K) to 48 (15M).
        throw new Error(`${row.name} (${teamName}) has skills summing to ${total} but price step ${value}`);
      }
      const name = properCase(row.name, row.nat);
      if (name !== capitalisedAll(row.name)) names.push(`${row.name} -> ${name}`);
      const tuple = [row.id, name, 0, value, key, teamName, '', '', key === 'g' ? '' : skills.join('')];
      const [, pos, rating, sourceInfo] = expandSwosTuple(tuple, source);
      if (JSON.stringify(swosTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`SWOS player ${row.id} (${name}) does not rebuild from its tuple`);
      players.set(row.id, { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple });
    }
  }

  const nations = {}, nationAudit = [];
  const islands = PACIFIC_ISLANDS.some(id => nationOf.has(id));
  for (const [id, rec] of Object.entries(NATIONS)) {
    if (!islands && PACIFIC_ISLANDS.includes(id)) continue;
    const pool = (nationOf.get(id)?.members || []).map(row => players.get(row.id));
    const squad = pickFootballSquad(pool);
    const lineup = selectLineup({ sport: 'football', squad });
    nations[id] = [Math.round(lineup.rating), pool.length, squad.map(p => p.tuple)];
    nationAudit.push({ id, name: rec[0], swos: nationOf.get(id)?.team ?? null, pool: pool.length, players: squad.length, strength: nations[id][0],
      naturalLineup: squad.length === CLUB_SIZE && lineup.slots.every(slot => slot.player && !slot.outOfPosition) });
  }
  const territory = territoryFor(federations, year);
  // A shape held by another federation fields no team of its own, so a SWOS team for it would be lost.
  const idle = [...nationOf.keys()].filter(id => Object.hasOwn(territory.merged, id) || territory.inactive.includes(id));
  if (idle.length) throw new Error(`SWOS rates national teams with no federation of their own in ${year}: ${idle.join(', ')}`);

  const written = new Set(Object.values(nations).flatMap(([, , squad]) => squad.map(tuple => tuple[0])));
  const coverage = {
    players: written.size, nations: nationAudit.filter(n => n.players).length,
    completeXIs: nationAudit.filter(n => n.naturalLineup).length, clubs: 0, leagues: 0,
  };
  const doc = { format: FOOTBALL_SET_FORMAT, kind: 'swos', id: SWOS_ID, version: '', year, season: `${year - 1}/${String(year % 100).padStart(2, '0')}`,
    label: source.edition, local: false, source, nations, clubs: [], territory, coverage };
  doc.version = `${SWOS_ID}-${contentHash(doc)}`;
  const audit = {
    id: SWOS_ID, version: doc.version, rows: rows.length, teams: teams.size, noTeam, coverage, territory,
    // Every name whose case the rule sets other than plain capitalisation, for review.
    names, shortNations: nationAudit.filter(n => !n.naturalLineup).map(n => `${n.id} ${n.name} (${n.players})`), warnings,
  };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}

const capitalisedAll = name => name.split(' ').map(capitalised).join(' ');
