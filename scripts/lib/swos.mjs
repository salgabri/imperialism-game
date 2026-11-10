// The football seasons from Sensible World of Soccer (docs/design/football-years.md, "SWOS 96/97" and "SWOS 94/95 and
// 95/96"): each national team's own record of its sixteen players becomes that nation's squad, in the data set format
// the game loads (src/engine/footballSets.js, kind 'swos'). SWOS 96/97 has nations only: at club level its database
// names some players at two clubs, so its clubs are not one moment's. SWOS 94/95 and 95/96, read from the game's own
// team files (scripts/lib/swos-files.mjs), also have the seven big leagues' top-division clubs, each with its own
// sixteen. No I/O here: scripts/build-retro-seasons.mjs reads the sources and writes the files, and tests build seasons
// from invented rows. Every rating is SWOS's own price step, converted by src/data/swosPlayers.js; nothing is generated.
import { NATIONS, PACIFIC_ISLANDS, selectLineup } from '../../src/data/teams.js';
import { SWOS_ROLES, SWOS_SCALE, SWOS_SKILLS, expandSwosTuple, swosTupleOf } from '../../src/data/swosPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import {
  FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, identitiesFor, nationResolver, presentClubs, serializeFootballSet, territoryFor,
} from '../../src/data/footballSetBuild.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';

/** The game's id of SWOS 96/97 (the default season) and how many players each team has. */
export const SWOS_ID = 'swos-9697';
export const SWOS_SQUAD = 16;
const CLUB_SIZE = 11;

/** The leagues of SWOS's team files, by file number: the game's league each top division plays in, and its shape. */
export const SWOS_LEAGUES = Object.freeze({
  '008': ['Premier League', '826'], '035': ['La Liga', '724'], '020': ['Serie A', '380'], '014': ['Bundesliga', '276'],
  '013': ['Ligue 1', '250'], '025': ['Eredivisie', '528'], '029': ['Liga Portugal', '620'],
});

/**
 * SWOS's top-division clubs of 1994/95 and 1995/96 (17-character names in capitals) by the name the game gives each.
 * Its id is that name's slug (presentClubs), and every one is a club scripts/data/europe-clubs.json already places, so
 * a club keeps its id, colour and crest from season to season: where several of its rows are one club, the one whose
 * crest the game shows (src/data/clubLogos.js), unless that row carries a name the club took later (RC Strasbourg
 * Alsace, Estrela da Amadora's refounded club); else CM 97/98's name for it (cm-9798), else the CM3 port's, else CM
 * 01/02's or EA's. Thirteen clubs no season had before take a new name; each that plays on a Europe map has a new row
 * (Sporting Clube Campomaiorense, never among a season's strongest 124, needs none).
 */
export const SWOS_CLUBS = Object.freeze({
  // England
  ARSENAL: 'Arsenal', 'ASTON VILLA': 'Aston Villa', 'BLACKBURN ROVERS': 'Blackburn Rovers', 'BOLTON WANDERERS': 'Bolton Wanderers',
  CHELSEA: 'Chelsea', 'COVENTRY CITY': 'Coventry City', 'CRYSTAL PALACE': 'Crystal Palace', EVERTON: 'Everton',
  'IPSWICH TOWN': 'Ipswich Town', 'LEEDS UNITED': 'Leeds United', 'LEICESTER CITY': 'Leicester City', LIVERPOOL: 'Liverpool',
  'MANCHESTER CITY': 'Manchester City', 'MANCHESTER UTD': 'Manchester United', MIDDLESBROUGH: 'Middlesbrough',
  'NEWCASTLE UNITED': 'Newcastle United', 'NORWICH CITY': 'Norwich City', "NOTT'M FOREST": 'Nottingham Forest',
  'Q.P.R.': 'Queens Park Rangers', 'SHEFFIELD WED.': 'Sheffield Wednesday', SOUTHAMPTON: 'Southampton', 'TOTTENHAM H.': 'Tottenham Hotspur',
  'WEST HAM UNITED': 'West Ham United', WIMBLEDON: 'Wimbledon',
  // Spain
  ALBACETE: 'Albacete Balompié', 'ATHLETIC BILBAO': 'Athletic Club', 'ATLETICO MADRID': 'Atlético Madrid', BARCELONA: 'FC Barcelona',
  BETIS: 'Real Betis Balompié', 'CELTA VIGO': 'RC Celta', COMPOSTELA: 'S.D. Compostela', 'DEP. LA CORUNA': 'RC Deportivo de La Coruña',
  ESPANOL: 'RCD Espanyol', LOGRONES: 'CD Logroñés', MERIDA: 'CP Mérida', OVIEDO: 'Real Oviedo', 'RACING SANTANDER': 'Racing Santander',
  'RAYO VALLECANO': 'Rayo Vallecano', 'REAL MADRID': 'Real Madrid', 'REAL SOCIEDAD': 'Real Sociedad', SALAMANCA: 'UD Salamanca',
  SEVILLA: 'Sevilla FC', 'SPORTING GIJON': 'Real Sporting de Gijón', TENERIFE: 'Club Deportivo Tenerife', VALENCIA: 'Valencia CF',
  VALLADOLID: 'Real Valladolid', ZARAGOZA: 'Real Zaragoza',
  // Italy
  'AC MILAN': 'AC Milan', ATALANTA: 'Atalanta', BARI: 'Bari', BRESCIA: 'Brescia', CAGLIARI: 'Cagliari', CREMONESE: 'Cremonese',
  FIORENTINA: 'Fiorentina', FOGGIA: 'Foggia', GENOA: 'Genoa', 'INTER MILAN': 'Inter', JUVENTUS: 'Juventus', LAZIO: 'Lazio',
  NAPOLI: 'Napoli', PADOVA: 'Padova', PARMA: 'Parma', PIACENZA: 'Piacenza', REGGIANA: 'Reggiana', ROMA: 'Roma', SAMPDORIA: 'Sampdoria',
  TORINO: 'Torino', UDINESE: 'Udinese', VICENZA: 'Vicenza',
  // Germany
  '1860 MUNICH': 'TSV Munich 1860', 'BAYER LEVERKUSEN': 'Bayer 04 Leverkusen', 'BAYER UERDINGEN': 'Bayer 05 Uerdingen',
  'BAYERN MUNICH': 'FC Bayern München', 'BOR. DORTMUND': 'Borussia Dortmund', COLOGNE: '1. FC Köln', 'DYNAMO DRESDEN': 'Dynamo Dresden',
  'EINTR. FRANKFURT': 'Eintracht Frankfurt', 'FORT. DUSSELDORF': 'Fortuna Düsseldorf', FREIBURG: 'SC Freiburg', HAMBURG: 'Hamburger SV',
  'HANSA ROSTOCK': 'FC Hansa Rostock', KAISERSLAUTERN: '1. FC Kaiserslautern', KARLSRUHE: 'Karlsruher SC', 'KFC UERDINGEN': 'KFC Uerdingen 05',
  MONCHENGLADBACH: 'Borussia Mönchengladbach', 'MSV DUISBURG': 'MSV Duisburg', SCHALKE: 'FC Schalke 04', 'ST. PAULI': 'FC St. Pauli',
  'VFB STUTTGART': 'VfB Stuttgart', 'VFL BOCHUM': 'VfL Bochum', 'WERDER BREMEN': 'SV Werder Bremen',
  // France
  AUXERRE: 'AJ Auxerre', BASTIA: 'SC Bastia', BORDEAUX: 'Girondins de Bordeaux', CAEN: 'Stade Malherbe Caen', CANNES: 'AS Cannes',
  GUEUGNON: 'FC Gueugnon', GUINGAMP: 'En Avant Guingamp', 'LE HAVRE': 'Le Havre AC', LENS: 'RC Lens', LILLE: 'Lille OSC',
  LYON: 'Olympique Lyonnais', MARTIGUES: 'FC Martigues', METZ: 'FC Metz', MONACO: 'AS Monaco', MONTPELLIER: 'Montpellier HSC',
  NANTES: 'FC Nantes', NICE: 'OGC Nice', 'PARIS ST-GERMAIN': 'Paris Saint-Germain', RENNES: 'Stade Rennais FC',
  'SAINT-ETIENNE': 'AS Saint-Étienne', SOCHAUX: 'FC Sochaux-Montbéliard', STRASBOURG: 'Racing Club de Strasbourg',
  // The Netherlands
  AJAX: 'Ajax', 'DE GRAAFSCHAP': 'vbv De Graafschap', DORDRECHT: 'FC Dordrecht', FEYENOORD: 'Feyenoord', 'FORTUNA SITTARD': 'Fortuna Sittard',
  'GO AHEAD EAGLES': 'Go Ahead Eagles', GRONINGEN: 'FC Groningen', HEERENVEEN: 'SC Heerenveen', MVV: 'MVV Maastricht', NAC: 'NAC Breda',
  NEC: 'NEC Nijmegen', PSV: 'PSV', RKC: 'RKC Waalwijk', 'RODA JC': 'Roda JC', 'SPARTA ROTTERDAM': 'Sparta Rotterdam', TWENTE: 'FC Twente',
  UTRECHT: 'FC Utrecht', VITESSE: 'Vitesse Arnhem', VOLENDAM: 'FC Volendam', 'WILLEM II': 'Willem II',
  // Portugal
  'BEIRA MAR': 'Sport Clube Beira-Mar', BELENENSES: 'C.F. Os Belenenses', BENFICA: 'SL Benfica', BOAVISTA: 'Boavista FC',
  BRAGA: 'Sporting Clube de Braga', CAMPOMAIORENSE: 'Sporting Clube Campomaiorense', CHAVES: 'GD Chaves', 'ESTRELA AMADORA': 'CF Estrela Amadora',
  FARENSE: 'SC Farense', 'FC PORTO': 'FC Porto', FELGUEIRAS: 'FC Felgueiras', 'GIL VICENTE': 'Gil Vicente FC', LECA: 'Leça FC',
  MARITIMO: 'CS Marítimo', SALGUEIROS: 'SC Salgueiros', 'SPORTING LISBON': 'Sporting CP', TIRSENSE: 'FC Tirsense',
  'UNIAO LEIRIA': 'União Desportiva de Leiria', 'UNIAO MADEIRA': 'União da Madeira', 'VIT. GUIMARAES': 'Vitória SC',
  'VITORIA SETUBAL': 'Vitória Futebol Clube',
});

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
// after a hyphen or full stop ("Omam-Biyik", "S.M. Aslam") and after an apostrophe that follows a word's first letter
// or an Italian "Dall'" or "Dell'" ("N'Doram", "L'Ami", "Dall'Oglio"; not "Preud'homme"), "Mc" names as "McCoist", and
// the particles of a surname
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
  .replace(/^Mc([a-z])/, (_, letter) => `Mc${letter.toUpperCase()}`)
  .replace(/^([A-Z]|D[ae]ll)'([a-z])/, (_, first, letter) => `${first}'${letter.toUpperCase()}`);

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
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Build a season from SWOS's national team records: `rows` are its `players` rows of type NATIONAL (`id`, `name`,
 * `pos`, `nat`, the seven skills, `GK`, `TOT`, `value` in pounds, `team`), `source` the season's source block, `id` the
 * season's id. `clubRows`, of type CLUB with their `file` (the league's TEAM file number, SWOS_LEAGUES) and `division`,
 * add the clubs of the seven leagues' top divisions (division 0), each named by SWOS_CLUBS. Returns `{ doc, text,
 * audit, warnings }`; throws on anything it does not understand rather than guess.
 */
export function buildSwosSeason(rows, { source, year, federations = FOOTBALL_FEDERATIONS, prices, id: seasonId = SWOS_ID, clubRows = [] }) {
  const warnings = [];
  const warn = message => warnings.push(message);
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

  const names = [];
  // One SWOS record as the game's player: its tuple, rating and source. `nationality` is the national team's name, or
  // a club player's SWOS code.
  const playerOf = (row, nationality, where) => {
    if (!Number.isInteger(row.id) || row.id < 1 || seen.has(row.id)) throw new Error(`Row id ${row.id} is invalid or repeated`);
    seen.add(row.id);
    const key = String(row.pos).toLowerCase();
    if (!Object.hasOwn(SWOS_ROLES, key)) throw new Error(`${row.name} (${where}) has position ${row.pos}`);
    const value = valueOf.get(row.value);
    if (!Number.isInteger(value) || value < 1 || value > SWOS_SCALE) throw new Error(`${row.name} (${where}) has price ${row.value}, not a SWOS value step`);
    const skills = SWOS_SKILLS.map(skill => row[skill]);
    if (skills.some(skill => !Number.isInteger(skill) || skill < 0 || skill > 7)) throw new Error(`${row.name} (${where}) has skills ${skills.join(',')}`);
    const total = skills.reduce((sum, skill) => sum + skill, 0);
    if (key === 'g') {
      // A goalkeeper has no skills; the database's GK figure is his price step again (0 for the cheapest, 25K).
      if (total !== 0 || !(row.GK === value || (value === 1 && row.GK === 0))) {
        throw new Error(`Goalkeeper ${row.name} (${where}) has skills ${skills.join('')} or GK ${row.GK} for price step ${value}`);
      }
    } else if (Math.max(1, Math.min(total, 48)) !== value) {
      // SWOS prices an outfield player by his skills: the step is their sum, from 1 (25K) to 48 (15M).
      throw new Error(`${row.name} (${where}) has skills summing to ${total} but price step ${value}`);
    }
    const name = properCase(row.name, row.nat);
    if (name !== capitalisedAll(row.name)) names.push(`${row.name} -> ${name}`);
    const tuple = [row.id, name, 0, value, key, nationality, '', '', key === 'g' ? '' : skills.join('')];
    const [, pos, rating, sourceInfo] = expandSwosTuple(tuple, source);
    if (JSON.stringify(swosTupleOf(name, sourceInfo)) !== JSON.stringify(tuple)) throw new Error(`SWOS player ${row.id} (${name}) does not rebuild from its tuple`);
    return { name, pos, positions: sourceInfo.positions, rating, sourceInfo, tuple };
  };
  const players = new Map();
  for (const { teamName, members } of nationOf.values()) {
    for (const row of members) players.set(row.id, playerOf(row, teamName, teamName));
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
  // The federations of the season's day, as far as SWOS fields them: a shape held by a federation SWOS has no squad for
  // stays neutral (1994/95 has no FR Yugoslavia, so Montenegro and Kosovo are neutral too), and a federation of the day
  // with a squad plays under its own name and flag (FR Yugoslavia in 1995/96).
  const fields = id => nationOf.has(id);
  const territory = territoryFor(federations, year, { fields });
  const identities = identitiesFor(federations, year, { fields });
  // A shape held by another federation fields no team of its own, so a SWOS team for it would be lost.
  const idle = [...nationOf.keys()].filter(id => Object.hasOwn(territory.merged, id) || territory.inactive.includes(id));
  if (idle.length) throw new Error(`SWOS rates national teams with no federation of their own in ${year}: ${idle.join(', ')}`);

  const { clubs, leagues: leagueAudit, collisions } = swosClubs(clubRows, playerOf, warn);
  const written = new Set([...Object.values(nations).flatMap(([, , squad]) => squad), ...clubs.flatMap(club => club.squad)].map(tuple => tuple[0]));
  const coverage = {
    players: written.size, nations: nationAudit.filter(n => n.players).length,
    completeXIs: nationAudit.filter(n => n.naturalLineup).length, clubs: clubs.length, leagues: new Set(clubs.map(club => club.league)).size,
  };
  const doc = { format: FOOTBALL_SET_FORMAT, kind: 'swos', id: seasonId, version: '', year, season: `${year - 1}/${String(year % 100).padStart(2, '0')}`,
    label: source.edition, local: false, source, nations, clubs, territory, ...(Object.keys(identities).length ? { identities } : {}), coverage };
  doc.version = `${seasonId}-${contentHash(doc)}`;
  const audit = {
    id: seasonId, version: doc.version, rows: rows.length, teams: teams.size, noTeam, coverage, territory,
    ...(Object.keys(identities).length ? { identities } : {}),
    // Each league's top division, and the players SWOS files at two of its top-division clubs (namesakes, or one
    // player's record left at his old club): each club keeps its own sixteen.
    ...(clubRows.length ? { clubRows: clubRows.length, leagues: leagueAudit, collisions } : {}),
    // Every name whose case the rule sets other than plain capitalisation, for review.
    names, shortNations: nationAudit.filter(n => !n.naturalLineup).map(n => `${n.id} ${n.name} (${n.players})`), warnings,
  };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}

/**
 * The top-division clubs of SWOS's seven league files (`rows` of type CLUB, with `file` and `division`), as the game's
 * clubs: each its own sixteen, its best eleven by SWOS's positions (pickFootballSquad), its strength their mean rating,
 * presented as every other set's clubs are (presentClubs). `playerOf` makes each player, its nationality his code.
 */
function swosClubs(rows, playerOf, warn) {
  if (!rows.length) return { clubs: [], leagues: [], collisions: [] };
  const byTeam = new Map();
  for (const row of rows) {
    if (row.type !== 'CLUB') throw new Error(`Row ${row.id} (${row.name}) is not a club record`);
    if (!Object.hasOwn(SWOS_LEAGUES, row.file)) throw new Error(`Row ${row.id} (${row.name}) is in TEAM.${row.file}, not one of SWOS_LEAGUES' files`);
    if (row.division !== 0) throw new Error(`Row ${row.id} (${row.name}) of ${row.team} is not in a top division`);
    const key = `${row.file}|${row.team}`;
    (byTeam.get(key) || byTeam.set(key, []).get(key)).push(row);
  }
  const built = [], leagues = [], heldBy = new Map();
  for (const [file, [league, country]] of Object.entries(SWOS_LEAGUES)) {
    const teams = [...byTeam].filter(([key]) => key.startsWith(`${file}|`));
    if (!teams.length) throw new Error(`No ${league} clubs in TEAM.${file}`);
    const short = [];
    for (const [key, members] of teams) {
      const team = key.slice(file.length + 1);
      if (members.length !== SWOS_SQUAD) throw new Error(`${team} has ${members.length} players, not ${SWOS_SQUAD}`);
      if (!Object.hasOwn(SWOS_CLUBS, team)) throw new Error(`SWOS club ${team} (${league}) has no name in SWOS_CLUBS`);
      const name = SWOS_CLUBS[team];
      const pool = members.map(row => playerOf(row, row.nat, team));
      for (const row of members) {
        const who = `${row.name}|${row.nat}`;
        heldBy.set(who, [...(heldBy.get(who) || []), name]);
      }
      const squad = pickFootballSquad(pool);
      if (squad.length < CLUB_SIZE) { short.push({ name, players: squad.length }); continue; }
      built.push({ name, league, country, str: Math.round(mean(squad.map(p => p.rating))), squad });
    }
    leagues.push({ league, file, clubs: teams.length - short.length, short });
  }
  const names = built.map(club => club.name);
  if (new Set(names).size !== names.length) throw new Error('Two SWOS clubs take one name in SWOS_CLUBS');
  const collisions = [...heldBy].filter(([, clubs]) => clubs.length > 1).map(([who, clubs]) => `${who.split('|')[0]} (${clubs.join(', ')})`);
  return { clubs: presentClubs(built, warn), leagues, collisions };
}

const capitalisedAll = name => name.split(' ').map(capitalised).join(' ');
