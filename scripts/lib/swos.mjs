// The football seasons from Sensible World of Soccer (docs/design/football-years.md, "Sensible World of Soccer 96/97" and
// "Sensible World of Soccer 94/95 and 95/96"): each national team's own record of its sixteen players becomes that nation's squad, in the data set
// format the game loads (src/engine/footballSets.js, kind 'swos'), and each of the seven big leagues' top-division clubs
// plays its own sixteen, all read from the game's own team files (scripts/lib/swos-files.mjs). Every division of every
// league file SWOS has (SWOS_LEAGUE_FILES) gives the seasons' own country maps their clubs (`everyClubRows`,
// scripts/build-season-countries.mjs). No I/O here: scripts/build-retro-seasons.mjs reads the sources and writes the
// files, and tests build seasons from invented rows. Every rating is SWOS's own price step, converted by
// src/data/swosPlayers.js; nothing is generated.
import { NATIONS, HISTORIC_NATIONS, PACIFIC_ISLANDS, selectLineup } from '../../src/data/teams.js';
import { SWOS_ROLES, SWOS_SCALE, SWOS_SKILLS, expandSwosTuple, swosTupleOf } from '../../src/data/swosPlayers.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import {
  FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, identitiesFor, nationResolver, presentClubs, serializeFootballSet, strongestBuilt, territoryFor,
} from '../../src/data/footballSetBuild.js';
import { EUROPEAN_LEAGUES } from '../../src/data/footballLeagues.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';

/** The id a season built with no id of its own takes (SWOS 96/97's), and how many players each team has. */
export const SWOS_ID = 'swos-9697';
export const SWOS_SQUAD = 16;
const CLUB_SIZE = 11;

/** The leagues of SWOS's team files, by file number: the game's league each top division plays in, and its shape. */
export const SWOS_LEAGUES = Object.freeze({
  '008': ['Premier League', '826'], '035': ['La Liga', '724'], '020': ['Serie A', '380'], '014': ['Bundesliga', '276'],
  '013': ['Ligue 1', '250'], '025': ['Eredivisie', '528'], '029': ['Liga Portugal', '620'],
});

/**
 * Every league team file SWOS rates a country's clubs in, by number, and the game's nation those clubs play for: the
 * seven of SWOS_LEAGUES and every other league, whose top divisions give the season files Europe's strongest clubs
 * (SWOS_EUROPE_LEAGUES) and whose every division the seasons' own country maps read. A file's country is that of its
 * clubs and nearly all their players, and the one codemeyer's
 * SwosPlayerFinder names for its number (Countries.cs, its team countries): TEAM.033 is Scotland, 038 Turkey, 041 Serbia
 * and Montenegro (the game's Serbia, as SWOS_NATIONS reads Yugoslavia). Left out: 011, 024 and 032 (the Faroe Islands,
 * Malta and San Marino, which have no shape on the map) and 072, SWOS's own invented teams (Amiga Power, Sensible
 * Elect), whose players' nationality byte that table names CUSTOM.
 */
export const SWOS_LEAGUE_FILES = Object.freeze({
  '000': '008', '001': '040', '002': '056', '003': '100', '004': '191', '005': '196', '006': '203', '007': '208', '008': '826',
  '010': '233', '012': '246', '013': '250', '014': '276', '015': '300', '016': '348', '017': '352', '018': '372', '019': '376',
  '020': '380', '021': '428', '022': '440', '023': '442', '025': '528', '026': 'NIR', '027': '578', '028': '616', '029': '620',
  '030': '642', '031': '643', '033': 'SCO', '034': '705', '035': '724', '036': '752', '037': '756', '038': '792', '039': '804',
  '040': 'WAL', '041': '688', '042': '012', '043': '032', '044': '036', '045': '068', '046': '076', '048': '152', '049': '170',
  '050': '218', '051': '222', '055': '392', '060': '484', '062': '554', '064': '600', '065': '604', '066': '740', '067': '158',
  '069': '710', '071': '858', '073': '840', '075': '356', '076': '112', '077': '862', '078': '703', '079': '288',
});
for (const [file, country] of Object.entries(SWOS_LEAGUE_FILES)) {
  if (!NATIONS[country]) throw new Error(`SWOS_LEAGUE_FILES: TEAM.${file}'s ${country} is no game nation`);
}
for (const [file, [, country]] of Object.entries(SWOS_LEAGUES)) {
  if (SWOS_LEAGUE_FILES[file] !== country) throw new Error(`SWOS_LEAGUE_FILES gives TEAM.${file} another country than SWOS_LEAGUES`);
}

/**
 * The league files whose top division is one of Europe's first divisions as the game names them
 * (src/data/footballLeagues.js), by file number: [league, country]. A SWOS season's club layer is Europe's strongest
 * clubs of these top divisions, as every other season's is (since 17 November 2026; before, the seven of SWOS_LEAGUES
 * alone): the seven big leagues' and 24 more, from Scotland's and Turkey's to Luxembourg's. SWOS's leagues of Albania,
 * Belarus, Estonia, Iceland, Israel, Latvia, Lithuania, Slovakia and Slovenia are none of those first divisions, so
 * their clubs play on their countries' maps only.
 */
// Each country's first league EUROPEAN_LEAGUES names: SWOS's seasons are FR Yugoslavia's, not Serbia's alone.
const LEAGUE_OF_COUNTRY = new Map();
for (const [league, country] of Object.entries(EUROPEAN_LEAGUES)) if (!LEAGUE_OF_COUNTRY.has(country)) LEAGUE_OF_COUNTRY.set(country, league);
export const SWOS_EUROPE_LEAGUES = Object.freeze(Object.fromEntries(Object.entries(SWOS_LEAGUE_FILES)
  .filter(([, country]) => LEAGUE_OF_COUNTRY.has(country)).map(([file, country]) => [file, Object.freeze([LEAGUE_OF_COUNTRY.get(country), country])])));
for (const [file, league] of Object.entries(SWOS_LEAGUES)) {
  if (JSON.stringify(SWOS_EUROPE_LEAGUES[file]) !== JSON.stringify(league)) throw new Error(`SWOS_EUROPE_LEAGUES reads TEAM.${file} otherwise than SWOS_LEAGUES`);
}

/**
 * SWOS's top-division clubs of 1994/95 to 1996/97 (17-character names in capitals) by the name the game gives each; SWOS
 * 96/97 spells Espanyol ESPANYOL, the earlier editions ESPANOL, so two names give that one club. Its id is that name's slug (presentClubs), and every one is a club scripts/data/europe-clubs.json already places, so
 * a club keeps its id, colour and crest from season to season: where several of its rows are one club, the one whose
 * crest the game shows (src/data/clubLogos.js), unless that row carries a name the club took later (RC Strasbourg
 * Alsace, Estrela da Amadora's refounded club); else CM 97/98's name for it (cm-9798), else the CM3 port's, else CM
 * 01/02's or EA's. Fourteen clubs no season had before take a new name, SC Espinho (1996/97) the last; each that plays
 * on a Europe map has a new row (Sporting Clube Campomaiorense and SC Espinho, never among a season's strongest 124,
 * need none).
 */
export const SWOS_CLUBS = Object.freeze({
  // England
  ARSENAL: 'Arsenal', 'ASTON VILLA': 'Aston Villa', 'BLACKBURN ROVERS': 'Blackburn Rovers', 'BOLTON WANDERERS': 'Bolton Wanderers',
  CHELSEA: 'Chelsea', 'COVENTRY CITY': 'Coventry City', 'CRYSTAL PALACE': 'Crystal Palace', 'DERBY COUNTY': 'Derby County',
  EVERTON: 'Everton', 'IPSWICH TOWN': 'Ipswich Town', 'LEEDS UNITED': 'Leeds United', 'LEICESTER CITY': 'Leicester City',
  LIVERPOOL: 'Liverpool', 'MANCHESTER CITY': 'Manchester City', 'MANCHESTER UTD': 'Manchester United', MIDDLESBROUGH: 'Middlesbrough',
  'NEWCASTLE UNITED': 'Newcastle United', 'NORWICH CITY': 'Norwich City', "NOTT'M FOREST": 'Nottingham Forest',
  'Q.P.R.': 'Queens Park Rangers', 'SHEFFIELD WED.': 'Sheffield Wednesday', SOUTHAMPTON: 'Southampton', SUNDERLAND: 'Sunderland',
  'TOTTENHAM H.': 'Tottenham Hotspur', 'WEST HAM UNITED': 'West Ham United', WIMBLEDON: 'Wimbledon',
  // Spain
  ALBACETE: 'Albacete Balompié', 'ATHLETIC BILBAO': 'Athletic Club', 'ATLETICO MADRID': 'Atlético Madrid', BARCELONA: 'FC Barcelona',
  BETIS: 'Real Betis Balompié', 'CELTA VIGO': 'RC Celta', COMPOSTELA: 'S.D. Compostela', 'DEP. LA CORUNA': 'RC Deportivo de La Coruña',
  ESPANOL: 'RCD Espanyol', ESPANYOL: 'RCD Espanyol', EXTREMADURA: 'Extremadura C.F.', HERCULES: 'Hércules CF', LOGRONES: 'CD Logroñés',
  MERIDA: 'CP Mérida', OVIEDO: 'Real Oviedo', 'RACING SANTANDER': 'Racing Santander', 'RAYO VALLECANO': 'Rayo Vallecano',
  'REAL MADRID': 'Real Madrid', 'REAL SOCIEDAD': 'Real Sociedad', SALAMANCA: 'UD Salamanca', SEVILLA: 'Sevilla FC',
  'SPORTING GIJON': 'Real Sporting de Gijón', TENERIFE: 'Club Deportivo Tenerife', VALENCIA: 'Valencia CF', VALLADOLID: 'Real Valladolid',
  ZARAGOZA: 'Real Zaragoza',
  // Italy
  'AC MILAN': 'AC Milan', ATALANTA: 'Atalanta', BARI: 'Bari', BOLOGNA: 'Bologna', BRESCIA: 'Brescia', CAGLIARI: 'Cagliari',
  CREMONESE: 'Cremonese', FIORENTINA: 'Fiorentina', FOGGIA: 'Foggia', GENOA: 'Genoa', 'INTER MILAN': 'Inter', JUVENTUS: 'Juventus',
  LAZIO: 'Lazio', NAPOLI: 'Napoli', PADOVA: 'Padova', PARMA: 'Parma', PERUGIA: 'Perugia', PIACENZA: 'Piacenza', REGGIANA: 'Reggiana',
  ROMA: 'Roma', SAMPDORIA: 'Sampdoria', TORINO: 'Torino', UDINESE: 'Udinese', VERONA: 'Hellas Verona FC', VICENZA: 'Vicenza',
  // Germany
  '1860 MUNICH': 'TSV Munich 1860', 'ARM. BIELEFELD': 'DSC Arminia Bielefeld', 'BAYER LEVERKUSEN': 'Bayer 04 Leverkusen',
  'BAYER UERDINGEN': 'Bayer 05 Uerdingen', 'BAYERN MUNICH': 'FC Bayern München', 'BOR. DORTMUND': 'Borussia Dortmund',
  COLOGNE: '1. FC Köln', 'DYNAMO DRESDEN': 'Dynamo Dresden', 'EINTR. FRANKFURT': 'Eintracht Frankfurt',
  'FORT. DUSSELDORF': 'Fortuna Düsseldorf', FREIBURG: 'SC Freiburg', HAMBURG: 'Hamburger SV', 'HANSA ROSTOCK': 'FC Hansa Rostock',
  KAISERSLAUTERN: '1. FC Kaiserslautern', KARLSRUHE: 'Karlsruher SC', 'KFC UERDINGEN': 'KFC Uerdingen 05',
  MONCHENGLADBACH: 'Borussia Mönchengladbach', 'MSV DUISBURG': 'MSV Duisburg', SCHALKE: 'FC Schalke 04', 'ST. PAULI': 'FC St. Pauli',
  'VFB STUTTGART': 'VfB Stuttgart', 'VFL BOCHUM': 'VfL Bochum', 'WERDER BREMEN': 'SV Werder Bremen',
  // France
  AUXERRE: 'AJ Auxerre', BASTIA: 'SC Bastia', BORDEAUX: 'Girondins de Bordeaux', CAEN: 'Stade Malherbe Caen', CANNES: 'AS Cannes',
  GUEUGNON: 'FC Gueugnon', GUINGAMP: 'En Avant Guingamp', 'LE HAVRE': 'Le Havre AC', LENS: 'RC Lens', LILLE: 'Lille OSC',
  LYON: 'Olympique Lyonnais', MARSEILLE: 'Olympique de Marseille', MARTIGUES: 'FC Martigues', METZ: 'FC Metz', MONACO: 'AS Monaco',
  MONTPELLIER: 'Montpellier HSC', NANCY: 'AS Nancy-Lorraine', NANTES: 'FC Nantes', NICE: 'OGC Nice',
  'PARIS ST-GERMAIN': 'Paris Saint-Germain', RENNES: 'Stade Rennais FC', 'SAINT-ETIENNE': 'AS Saint-Étienne',
  SOCHAUX: 'FC Sochaux-Montbéliard', STRASBOURG: 'Racing Club de Strasbourg',
  // The Netherlands
  AJAX: 'Ajax', AZ: 'AZ Alkmaar', 'DE GRAAFSCHAP': 'vbv De Graafschap', DORDRECHT: 'FC Dordrecht', FEYENOORD: 'Feyenoord',
  'FORTUNA SITTARD': 'Fortuna Sittard', 'GO AHEAD EAGLES': 'Go Ahead Eagles', GRONINGEN: 'FC Groningen', HEERENVEEN: 'SC Heerenveen',
  MVV: 'MVV Maastricht', NAC: 'NAC Breda', NEC: 'NEC Nijmegen', PSV: 'PSV', RKC: 'RKC Waalwijk', 'RODA JC': 'Roda JC',
  'SPARTA ROTTERDAM': 'Sparta Rotterdam', TWENTE: 'FC Twente', UTRECHT: 'FC Utrecht', VITESSE: 'Vitesse Arnhem', VOLENDAM: 'FC Volendam',
  'WILLEM II': 'Willem II',
  // Portugal
  'BEIRA MAR': 'Sport Clube Beira-Mar', BELENENSES: 'C.F. Os Belenenses', BENFICA: 'SL Benfica', BOAVISTA: 'Boavista FC',
  BRAGA: 'Sporting Clube de Braga', CAMPOMAIORENSE: 'Sporting Clube Campomaiorense', CHAVES: 'GD Chaves', ESPINHO: 'SC Espinho',
  'ESTRELA AMADORA': 'CF Estrela Amadora', FARENSE: 'SC Farense', 'FC PORTO': 'FC Porto', FELGUEIRAS: 'FC Felgueiras',
  'GIL VICENTE': 'Gil Vicente FC', LECA: 'Leça FC', MARITIMO: 'CS Marítimo', 'RIO AVE': 'Rio Ave FC', SALGUEIROS: 'SC Salgueiros',
  'SPORTING LISBON': 'Sporting CP', TIRSENSE: 'FC Tirsense', 'UNIAO LEIRIA': 'União Desportiva de Leiria',
  'UNIAO MADEIRA': 'União da Madeira', 'VIT. GUIMARAES': 'Vitória SC', 'VITORIA SETUBAL': 'Vitória Futebol Clube',
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
 * season's id. `clubRows`, of type CLUB with their `file` (the league's TEAM file number, SWOS_EUROPE_LEAGUES) and
 * `division`, add the clubs of those leagues' top divisions (division 0), the seven big leagues' named by SWOS_CLUBS
 * and every other by swosClubName, as its country's map names it; `topClubs` keeps Europe's strongest that many of them.
 * Returns `{ doc, text, audit, warnings }`; throws on anything it does not understand rather than guess.
 */
export function buildSwosSeason(rows, { source, year, federations = FOOTBALL_FEDERATIONS, prices, id: seasonId = SWOS_ID, clubRows = [], topClubs = null,
  everyClubRows = null, field = null }) {
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
  // Each record makes its player once: the top divisions' clubs and every division's (`everyClubRows`) share theirs.
  const made = new Map();
  const playerFor = (row, nationality, where) => made.get(row.id) ?? made.set(row.id, playerOf(row, nationality, where)).get(row.id);
  const players = new Map();
  for (const { teamName, members } of nationOf.values()) {
    for (const row of members) players.set(row.id, playerOf(row, teamName, teamName));
  }

  const nations = {}, nationAudit = [];
  const islands = PACIFIC_ISLANDS.some(id => nationOf.has(id));
  for (const [id, rec] of Object.entries(NATIONS)) {
    if (!islands && PACIFIC_ISLANDS.includes(id)) continue;
    // A nation of the map's earlier years (East Germany) is listed only with players of its own.
    if (HISTORIC_NATIONS.includes(id) && !nationOf.has(id)) continue;
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

  const { clubs, leagues: leagueAudit, collisions, field: fieldAudit } = swosClubs(clubRows, playerFor, warn, topClubs, field);
  // Every division's clubs of every league file, for the season's own country maps (scripts/build-season-countries.mjs).
  const allClubs = everyClubRows ? swosLeagueClubs(everyClubRows, playerFor, seasonId, warn) : null;
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
    ...(clubRows.length ? { clubRows: clubRows.length, leagues: leagueAudit, collisions } : {}), ...(fieldAudit ? { field: fieldAudit } : {}),
    // Every name whose case the rule sets other than plain capitalisation, for review.
    names, shortNations: nationAudit.filter(n => !n.naturalLineup).map(n => `${n.id} ${n.name} (${n.players})`), warnings,
  };
  return { doc, text: serializeFootballSet(doc), audit, warnings, ...(allClubs ? { allClubs } : {}) };
}

/**
 * The clubs below the seven big leagues' top divisions whose SWOS names are cut short, to fit 17 characters or to the
 * club's initials (RBC, whose full name another season's map already places), by their full names (Arminia Bielefeld as
 * SWOS_CLUBS names its top-division seasons); every other one reads as SWOS writes it, in the case swosClubName sets
 * ("PORT VALE" is Port Vale).
 */
export const SWOS_LOWER_CLUBS = Object.freeze({
  'CHARLTON ATH.': 'Charlton Athletic', 'COLCHESTER UTD': 'Colchester United', 'HARTLEPOOL UTD': 'Hartlepool United',
  'PETERBOROUGH UTD': 'Peterborough United', 'PRESTON N. END': 'Preston North End', 'SCUNTHORPE UTD': 'Scunthorpe United',
  'WOLVERHAMPTON W.': 'Wolverhampton Wanderers', 'WYCOMBE WDRS': 'Wycombe Wanderers', 'WEST BROMWICH': 'West Bromwich Albion',
  'ATL. MARBELLA': 'Atlético Marbella', "ARMINIA B'FIELD": 'DSC Arminia Bielefeld', 'STUTTGART KICKER': 'Stuttgarter Kickers',
  RBC: 'RBC Roosendaal',
});

/**
 * Every other league file's clubs whose SWOS names are cut short or abbreviated, by file, with their full names: towns
 * cut to an initial or a contraction ("BEROE S. ZAGORA", "RED STAR B'GRADE"), words cut at the seventeenth letter
 * ("MAMELODI SUNDOWN"), abbreviations ("UNIV. CLUJ", "DEP. ESPANOL", Algeria's initials), and a few misspellings of a
 * club another edition spells right (CARALAS for Caracas). Identities taken from the season's league where the
 * abbreviation alone does not settle it: Algeria's J.S.K is JS Kabylie and W.A.M WA Mostaganem, Colombia's DEP. TULIA
 * Cortuluá (of Tuluá), the club of 1995/96's Categoría Primera A it stands for. Where it is not certain which club a
 * shortened name means (Uruguay's CENTRAL ESP, beside CENTRAL ESPANOL; Mexico's UN LEON), SWOS's name stays. SWOS's
 * Japanese clubs carry names it scrambled on purpose (KOSHEMA ONTLORS for Kashima Antlers): those stay as SWOS wrote
 * them, and their homes say which club each is (scripts/data/season-club-locations.json).
 */
export const SWOS_LEAGUE_CLUBS = Object.freeze({
  '000': { 'ILIRIA F-KRUJE': 'Iliria Fushë-Krujë' },
  '001': { 'VSE ST.POLTEN': 'VSE St. Pölten' },
  '003': { 'BEROE S. ZAGORA': 'Beroe Stara Zagora', 'ETAR V. TARNOVO': 'Etar Veliko Tarnovo', 'LOK. GORNA ORIA.': 'Lokomotiv Gorna Oryahovitsa',
    'LOK. PLOVDIV': 'Lokomotiv Plovdiv', "PIRIN BL'GRAD": 'Pirin Blagoevgrad' },
  '004': { 'MARSONIA S. BROD': 'Marsonia Slavonski Brod', 'RADNIK V. GORICA': 'Radnik Velika Gorica' },
  '010': { 'KEEMIK K-J': 'Keemik Kohtla-Järve' },
  '019': { 'BNEI YEHODA': 'Bnei Yehuda', 'HAPOEL BEIT SHAN': "Hapoel Beit She'an", 'HAPOEL P-TIKVA': 'Hapoel Petah Tikva',
    'MACCABI P-TIKVA': 'Maccabi Petah Tikva' },
  '022': { 'EKRANAS PANEVEZS': 'Ekranas Panevėžys', 'ZYDRIUS MARIJAME': 'Žydrius Marijampolė' },
  '023': { "RED BOYS D'DANGE": 'Red Boys Differdange' },
  '026': { 'BALLYCLARE C.': 'Ballyclare Comrades' },
  '028': { 'RAKOW CZESTOCHOA': 'Raków Częstochowa', 'SIARKA T.': 'Siarka Tarnobrzeg', 'ZAWISZA B.': 'Zawisza Bydgoszcz' },
  '030': { 'CEAHLAUL P-N': 'Ceahlăul Piatra Neamț', 'POLITEHNICA T.': 'Politehnica Timișoara', 'SPORTUL STUD.': 'Sportul Studențesc',
    'UNIV. CLUJ': 'Universitatea Cluj', 'UNIV. CRAIOVA': 'Universitatea Craiova' },
  '031': { 'DINAMO G-TYUMEN': 'Dinamo-Gazovik Tyumen', 'KRYLYA S. SAMARA': 'Krylya Sovetov Samara', 'LOK. N. NOVGOROD': 'Lokomotiv Nizhny Novgorod',
    'OKEAN NAKHODNA': 'Okean Nakhodka', 'SPARTAK VLAD.': 'Spartak Vladikavkaz' },
  '033': { 'CALEDONIAN TH.': 'Caledonian Thistle', 'HAMILTON ACAD.': 'Hamilton Academical', 'QUEEN OF SOUTH': 'Queen of the South' },
  '034': { 'MURA M. SOBOTA': 'Mura Murska Sobota', "OLIMPIJA L'JANA": 'Olimpija Ljubljana', 'RUDAR VELNJE': 'Rudar Velenje' },
  '039': { 'METALLIST K.': 'Metallist Kharkov', 'METALLURG Z.': 'Metallurg Zaporozhye', 'TEMP SHETOVKA': 'Temp Shepetovka' },
  '041': { "PARTIZAN B'GRADE": 'Partizan Belgrade', 'RADNICKI N.B.': 'Radnički Novi Beograd', "RED STAR B'GRADE": 'Red Star Belgrade',
    'VOJVODINA N. SAD': 'Vojvodina Novi Sad' },
  '042': { "A.S.AIN-M'LILA": "AS Aïn M'lila", 'C.A.BATNA': 'CA Batna', 'E.S.SETIF': 'ES Sétif', 'J.S.B.M': 'JS Bordj Ménaïel',
    'J.S.K ALGER': 'JS Kabylie', 'M C ORAN': 'MC Oran', 'NASSER HUSSEIN': 'NA Hussein Dey', 'U.S.CHAOUIA': 'US Chaouia',
    'U.S.M. BLIDA': 'USM Blida', 'U.S.M.B.A.': 'USM Bel Abbès', 'U.S.M.H': 'USM El Harrach', 'W.A.B.': 'WA Boufarik',
    'W.A.M': 'WA Mostaganem', 'W.A.TLEMCEN': 'WA Tlemcen' },
  '043': { 'ARGENTINOS JNRS.': 'Argentinos Juniors', 'CHACARITA JNRS.': 'Chacarita Juniors', 'CHACARITA JUNIOS': 'Chacarita Juniors',
    'DEFENSA-JUSTICIA': 'Defensa y Justicia', 'DEP. ESPANOL': 'Deportivo Español', 'DEP. ITALIANO': 'Deportivo Italiano',
    'DEP. LAFERRERE': 'Deportivo Laferrere', 'DEP. MANDIYU': 'Deportivo Mandiyú', FERROCARRIL: 'Ferro Carril Oeste',
    'GIMNASIA-ESG LP': 'Gimnasia y Esgrima La Plata', 'GIMNASIA-ESGRIMA': 'Gimnasia y Esgrima La Plata', 'HUR. CORRIENTES': 'Huracán Corrientes',
    'INST. CORDOBA': 'Instituto Córdoba', 'NEWELLS OLD BOYS': "Newell's Old Boys", 'S.MARTIN TUCUMAN': 'San Martín de Tucumán',
    'TALLERES ESC.': 'Talleres de Remedios de Escalada' },
  '044': { 'BRISBANE STRIKES': 'Brisbane Strikers', 'HEIDELBERG UTD': 'Heidelberg United', 'MARCONI FAIRFIED': 'Marconi Fairfield',
    'MELBOURNE KNIGHS': 'Melbourne Knights', 'MELBOURNE KNIGHT': 'Melbourne Knights', "NEWCASTLE B'KERS": 'Newcastle Breakers',
    'ROCKDALE HINDEN': 'Rockdale Ilinden', 'SALISBURY UTD': 'Salisbury United', 'WARRINGAH DOLPHN': 'Warringah Dolphins',
    'WOLLONGONG UTD': 'Wollongong United' },
  '045': { 'BLOOMING S. CRUZ': 'Blooming Santa Cruz', 'INDEPENDIENTE PS': 'Independiente Petrolero', 'JORGE WILSTERMAN': 'Jorge Wilstermann' },
  '046': { 'ATL PARANAENSE': 'Atlético Paranaense', 'ATLETICO PARANA': 'Atlético Paranaense' },
  '048': { 'DEP. CONCEPCION': 'Deportes Concepción', 'DEP. LA SERENA': 'Deportes La Serena', 'DEPORTES MELIPIA': 'Deportes Melipilla',
    'DESP. IQUIQUE': 'Deportes Iquique', PROVINCIAL: 'Provincial Osorno', 'PROVINCIAL OSORO': 'Provincial Osorno',
    'SANTIAGO WDRS.': 'Santiago Wanderers', 'UNIV. CATOLICA': 'Universidad Católica', 'UNIV. DE CHILE': 'Universidad de Chile' },
  '049': { 'ATL. BUCARAMANGA': 'Atlético Bucaramanga', 'ATL. NACIONAL': 'Atlético Nacional', 'DEP. PEREIRA': 'Deportivo Pereira',
    'DEP. QUINDIO': 'Deportes Quindío', 'DEP. TOLIMA': 'Deportes Tolima', 'DEP. TULIA': 'Cortuluá', 'IND. MEDELLIN': 'Independiente Medellín',
    'IND. SANTA FE': 'Independiente Santa Fe' },
  '050': { 'DEP. EL NACIONAL': 'El Nacional', 'OLMEDO RIO BAMBA': 'Olmedo Riobamba', 'UNIV. CATOLICA': 'Universidad Católica' },
  '051': { 'C.D. FUERTE S F': 'C.D. Fuerte San Francisco', 'C.D.INDEPENDIENE': 'C.D. Independiente' },
  '055': { 'BULLMORE HIR.': 'Bullmore Hiratsuka', 'KYOTO P SANGA': 'Kyoto Purple Sanga' },
  '060': { 'DEPT TEPATITLAN': 'Deportivo Tepatitlán', 'TAMPILO-MADERO': 'Tampico-Madero', 'UNIV.GUADALAJARA': 'Universidad de Guadalajara',
    'VERA CRUZ': 'Veracruz', YULATAN: 'Yucatán', ZALATEPEC: 'Zacatepec' },
  '062': { 'CHRISTCHURCH TEC': 'Christchurch Technical', 'CHRISTCHURCH UTD': 'Christchurch United', 'DUNEDIN TEC': 'Dunedin Technical',
    'NORTH SHORE UTD': 'North Shore United', 'WELLINGTON OLYM.': 'Wellington Olympic', 'WELLINGTON UTD': 'Wellington United' },
  '064': { '8 DICIEMBRE C.': '8 de Diciembre', 'ATL. COLEGIALES': 'Atlético Colegiales', 'DEP. HUMAITA': 'Deportivo Humaitá',
    'DEPORTIVO HUMAIA': 'Deportivo Humaitá', 'DEPORTIVO RECOLA': 'Deportivo Recoleta', 'SPORT TRINIDENSE': 'Sportivo Trinidense',
    'SPORTIVO TRINIDN': 'Sportivo Trinidense' },
  '065': { 'DEP. MUNICIPAL': 'Deportivo Municipal', 'DEP. SIPESA': 'Deportivo Sipesa' },
  '066': { 'SV NAT LEGER': 'SV Nationaal Leger' },
  '069': { 'AFRICAN WANDS.': 'African Wanderers', 'MAMELODI SUNDOWN': 'Mamelodi Sundowns', 'VAAL PROFS': 'Vaal Professionals' },
  '073': { 'COLOMBUS CREW': 'Columbus Crew', 'KANSAS CITY WIZ': 'Kansas City Wizards', 'LA GALAXY': 'LA Galaxy',
    'NEW ENGLAND REV.': 'New England Revolution', 'VANCOUVER 86': 'Vancouver 86ers' },
  '076': { 'LOK VITEBSK': 'Lokomotiv Vitebsk', 'SHAKHTER SOLIGOK': 'Shakhtyor Soligorsk' },
  '077': { 'AT ZAMORA': 'Atlético Zamora', CARALAS: 'Caracas', MARITIMO: 'Marítimo', MARTIMO: 'Marítimo', 'MINEROS DE GUAYA': 'Mineros de Guayana',
    'MINEROS GUAYANA': 'Mineros de Guayana', 'UNI DE LOS ANDES': 'Universidad de Los Andes' },
  '078': { '1.FC KOSICE': '1. FC Košice', 'LOK. KOSICE': 'Lokomotíva Košice', "SLOVAN BR'SLAVA": 'Slovan Bratislava' },
});

// Words a club writes in capitals (FC, AIK, PAOK, CSKA) or in a case of its own (VfB, AaB, KuPS), as SWOS's league files
// carry them, and the particles a club's name joins in lower case inside it (Vasco da Gama, Gimnasia y Tiro, Ried im
// Innkreis, Castel di Sangro).
const CLUB_WORDS = new Map([
  ...('AB AC AEK AEL AGF AIK AK AM APEP APOEL APOP ASK AZ BK BVSC CD CNI CP CR CS CSC CSKA CSM CYC DAG DC EP EPA ETO FAS FBK FC '
    + 'FH FSV GAIS GKS HIT HJK IA IBK IBV IF IFK II IK JAF JC KFC KIM KR KV LASK LDU LKS MC MG MP MSC MSV MTK MVV NAC NEC NJ NK NTV NY '
    + 'OB OFI OFK OTP PAOK PJN PSV PVV RAF RBC RKC RWD SC SD SK SP SPAL SV TE TM TOP TPS TPV UA UD UDC UN UNAM UTA UTC UTS VIF VPS VVV WMC')
    .split(' ').map(word => [word, word]),
  ['AAB', 'AaB'], ['AMAZULU', 'AmaZulu'], ['FINNPA', 'FinnPa'], ['KUPS', 'KuPS'], ['MYPA', 'MyPa'], ['ROPS', 'RoPS'], ['VFB', 'VfB'], ['VFL', 'VfL'],
]);
const CLUB_PARTICLES = new Set(['de', 'del', 'di', 'da', 'do', 'dos', 'das', 'of', 'the', 'y', 'im']);

/** A club's name SWOS writes in capitals, in the case clubs write it: each word (and each part of a hyphenated one) capitalised but for CLUB_WORDS and the particles inside it. */
export const clubCase = team => team.split(' ').map((word, i, words) => {
  if (i > 0 && i < words.length - 1 && CLUB_PARTICLES.has(word.toLowerCase())) return word.toLowerCase();
  return word.split('-').map(part => CLUB_WORDS.get(part) ?? capitalised(part)).join('-');
}).join(' ');

/**
 * A league club's name: SWOS_CLUBS' or SWOS_LOWER_CLUBS' in the seven big leagues' files (not elsewhere: Ecuador's
 * BARCELONA is not FC Barcelona), SWOS_LEAGUE_CLUBS' in every other one, else SWOS's own in clubCase's case.
 */
export function swosClubName(file, team) {
  if (Object.hasOwn(SWOS_LEAGUES, file)) return SWOS_CLUBS[team] ?? SWOS_LOWER_CLUBS[team] ?? clubCase(team);
  return SWOS_LEAGUE_CLUBS[file]?.[team] ?? clubCase(team);
}

/** SWOS's division byte of the teams it keeps outside a file's divisions (England's Halifax Town, then in the Conference). */
export const SWOS_NON_LEAGUE = 4;

/**
 * The divisions of every league file, top first by SWOS's division byte, as they were named in the mid-1990s; a league
 * renamed between the three seasons is named by season (South Africa's became the Premier Soccer League in 1996, the
 * United States' top flight was the APSL, the A-League and from 1996 MLS). Australia's three lower divisions are SWOS's
 * picks of three states' leagues, New Zealand's three its Northern, Central and Southern leagues. null where no name of
 * the day fits (India's clubs before its National Football League, El Salvador's fourth division): the map then says
 * the country's football.
 */
export const SWOS_DIVISIONS = Object.freeze({
  '000': ['Kategoria e Parë'], '001': ['Bundesliga'], '002': ['Eerste Klasse'], '003': ['A Group'], '004': ['Prva HNL'],
  '005': ['First Division'], '006': ['1. liga'], '007': ['Superliga'], '008': ['Premier League', 'Division One', 'Division Two', 'Division Three'],
  '010': ['Meistriliiga'], '012': ['Veikkausliiga'], '013': ['Division 1', 'Division 2'], '014': ['Bundesliga', '2. Bundesliga'],
  '015': ['Alpha Ethniki'], '016': ['Nemzeti Bajnokság I'], '017': ['1. deild'], '018': ['Premier Division'], '019': ['Liga Leumit'],
  '020': ['Serie A', 'Serie B'], '021': ['Virslīga'], '022': ['A Lyga'], '023': ['Division Nationale'], '025': ['Eredivisie', 'Eerste Divisie'],
  '026': ['Irish League'], '027': ['Tippeligaen'], '028': ['I liga'], '029': ['Primeira Divisão', 'Divisão de Honra'], '030': ['Divizia A'],
  '031': ['Top League'], '033': ['Premier Division', 'First Division', 'Second Division', 'Third Division'], '034': ['1. SNL'],
  '035': ['Primera División', 'Segunda División'], '036': ['Allsvenskan'], '037': ['Nationalliga A'], '038': ['1. Lig'], '039': ['Vyshcha Liha'],
  '040': ['League of Wales'], '041': ['First League'], '042': ['Championnat National'], '043': ['Primera División', 'Primera B Nacional'],
  '044': ['National Soccer League', 'South Australian state league', 'New South Wales state league', 'Queensland state league'],
  '045': ['Liga Profesional'], '046': ['Série A'], '048': ['Primera División'], '049': ['Primera A'], '050': ['Serie A'],
  '051': ['Primera División', 'Segunda División', 'Tercera División', null], '055': ['J.League', 'Japan Football League'],
  '060': ['Primera División', 'Primera División A'], '062': ['Northern League', 'Central League', 'Southern League'],
  '064': ['Primera División', 'Segunda División'], '065': ['Primera División'], '066': ['Hoofdklasse'], '067': ['Enterprise League'],
  '069': { 'swos-9495': ['National Soccer League'], 'swos-9596': ['National Soccer League'], 'swos-9697': ['Premier Soccer League'] },
  '071': ['Primera División', 'Segunda División'],
  '073': { 'swos-9495': ['APSL'], 'swos-9596': ['A-League'], 'swos-9697': ['Major League Soccer'] },
  '075': { 'swos-9495': [null], 'swos-9596': [null], 'swos-9697': ['National Football League'] },
  '076': ['Vysheyshaya Liga'], '077': ['Primera División'], '078': ['1. liga'], '079': [null],
});

/** A league file's division as SWOS_DIVISIONS names it in the season: null where it names none, 'Non-league' for SWOS_NON_LEAGUE. */
export function swosDivision(file, division, seasonId) {
  if (division === SWOS_NON_LEAGUE) return 'Non-league';
  const names = SWOS_DIVISIONS[file];
  const list = Array.isArray(names) ? names : names?.[seasonId];
  if (!list || division >= list.length) throw new Error(`SWOS_DIVISIONS names no division ${division} of TEAM.${file}${list ? '' : ` in ${seasonId}`}`);
  return list[division];
}

/**
 * Every division's clubs of every league file (`rows` of type CLUB, from the files of SWOS_LEAGUE_FILES), as
 * scripts/lib/season-country-clubs.mjs takes them: `{ key, name, short, nation, country, league, squad }`, its country
 * its file's, its league its division's name (swosDivision), its name swosClubName's, its squad pickFootballSquad's pick
 * of its own sixteen. Where a file holds two teams of one name (SWOS 95/96's South Africa lists Manning Rangers in its
 * top division and again outside it), the one in the higher division plays and the other is left out, with a warning.
 */
function swosLeagueClubs(rows, playerFor, seasonId, warn) {
  const byPlace = new Map();
  for (const row of rows) {
    if (row.type !== 'CLUB' || !Object.hasOwn(SWOS_LEAGUE_FILES, row.file)) throw new Error(`Row ${row.id} (${row.name}) is no club of SWOS_LEAGUE_FILES' files`);
    if (!Number.isInteger(row.place)) throw new Error(`Row ${row.id} (${row.name}) has no team place`);
    const key = `${row.file}|${row.place}`;
    (byPlace.get(key) || byPlace.set(key, []).get(key)).push(row);
  }
  const teams = [...byPlace.values()].map(members => ({ file: members[0].file, team: members[0].team, place: members[0].place, division: members[0].division, members }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.place - b.place);
  const named = new Map();
  for (const team of [...teams].sort((a, b) => a.division - b.division || a.place - b.place)) {
    const key = `${team.file}|${team.team}`;
    if (named.has(key)) warn(`TEAM.${team.file} lists ${team.team} twice: the one in division ${team.division} is left out`);
    else named.set(key, team);
  }
  return teams.filter(team => named.get(`${team.file}|${team.team}`) === team).map(({ file, team, division, members }) => ({
    key: `swos:${file}:${team}`, name: swosClubName(file, team), short: null, nation: null, country: SWOS_LEAGUE_FILES[file],
    league: swosDivision(file, division, seasonId), squad: pickFootballSquad(members.map(row => playerFor(row, row.nat, team))),
  }));
}

/**
 * The top-division clubs of SWOS's seven league files (`rows` of type CLUB, with `file` and `division`), as the game's
 * clubs: each its own sixteen, its best eleven by SWOS's positions (pickFootballSquad), its strength their mean rating,
 * presented as every other set's clubs are (presentClubs). `playerOf` makes each player, its nationality his code.
 */
function swosClubs(rows, playerOf, warn, topClubs = null, field = null) {
  if (!rows.length) return { clubs: [], leagues: [], collisions: [] };
  const byTeam = new Map();
  for (const row of rows) {
    if (row.type !== 'CLUB') throw new Error(`Row ${row.id} (${row.name}) is not a club record`);
    if (!Object.hasOwn(SWOS_EUROPE_LEAGUES, row.file)) throw new Error(`Row ${row.id} (${row.name}) is in TEAM.${row.file}, not one of SWOS_EUROPE_LEAGUES' files`);
    if (row.division !== 0) throw new Error(`Row ${row.id} (${row.name}) of ${row.team} is not in a top division`);
    const key = `${row.file}|${row.team}`;
    (byTeam.get(key) || byTeam.set(key, []).get(key)).push(row);
  }
  const built = [], leagues = [], heldBy = new Map();
  for (const [file, [league, country]] of Object.entries(SWOS_EUROPE_LEAGUES)) {
    const teams = [...byTeam].filter(([key]) => key.startsWith(`${file}|`));
    // Every big league fields its clubs; another league's file is read only where the season reads every league.
    if (!teams.length && Object.hasOwn(SWOS_LEAGUES, file)) throw new Error(`No ${league} clubs in TEAM.${file}`);
    if (!teams.length) continue;
    const short = [];
    for (const [key, members] of teams) {
      const team = key.slice(file.length + 1);
      if (members.length !== SWOS_SQUAD) throw new Error(`${team} has ${members.length} players, not ${SWOS_SQUAD}`);
      if (Object.hasOwn(SWOS_LEAGUES, file) && !Object.hasOwn(SWOS_CLUBS, team)) throw new Error(`SWOS club ${team} (${league}) has no name in SWOS_CLUBS`);
      // The seven big leagues' clubs by SWOS_CLUBS' names, every other one by the name its country's map gives it.
      const name = swosClubName(file, team);
      const pool = members.map(row => playerOf(row, row.nat, team));
      for (const row of members) {
        const who = `${row.name}|${row.nat}`;
        heldBy.set(who, [...(heldBy.get(who) || []), name]);
      }
      const squad = pickFootballSquad(pool);
      if (squad.length < CLUB_SIZE) { short.push({ name, players: squad.length }); continue; }
      const exact = mean(squad.map(p => p.rating));
      built.push({ name, league, country, str: Math.round(exact), exact, squad });
    }
    leagues.push({ league, file, clubs: teams.length - short.length, short });
  }
  const names = built.map(club => `${club.country}:${club.name}`);
  if (new Set(names).size !== names.length) throw new Error('Two SWOS clubs of one country take one name');
  const collisions = [...heldBy].filter(([, clubs]) => clubs.length > 1).map(([who, clubs]) => `${who.split('|')[0]} (${clubs.join(', ')})`);
  // A season reading every league keeps Europe's strongest `topClubs`, as every other season's club layer does: by results
  // where a `field` is given (scripts/lib/europe-field.mjs), else by their XIs. SWOS's coarse skills leave dozens of
  // clubs on one rounded strength at the cut, so a cut by XIs goes by the unrounded one.
  if (field) {
    const picked = field(built);
    return { clubs: presentClubs(picked.clubs, warn, { ranked: true, idOf: picked.idOf, reserved: picked.reserved }), leagues, collisions, field: picked.audit };
  }
  const kept = topClubs == null ? built : strongestBuilt(built.map(club => ({ ...club, str: club.exact })), topClubs)
    .map(club => ({ ...club, str: Math.round(club.exact) }));
  return { clubs: presentClubs(kept, warn), leagues, collisions };
}

const capitalisedAll = name => name.split(' ').map(capitalised).join(' ');
