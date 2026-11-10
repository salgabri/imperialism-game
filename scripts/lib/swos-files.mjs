// Sensible World of Soccer's own team files (docs/design/football-years.md, "SWOS 94/95 and 95/96"): the game's
// TEAM.nnn files of one edition, as the SWOS United server keeps them for its tools (https://cern.swos.eu/data/amiga/),
// read into the rows scripts/lib/swos.mjs builds a season from. No I/O here: scripts/build-retro-seasons.mjs reads the
// pinned files, and tests read invented ones. Nothing is generated: every name, position, skill and price is the file's.
//
// The layout, as codemeyer/SwosPlayerFinder (MIT, Fredrik Meyer) reads it and as the files bear out: two header bytes
// (0, then the number of teams), then 684 bytes a team. A team is 76 header bytes (byte 0 the file's number, 1 the
// team's place in the file, 5-23 its name, 25 its division, 0 for the top one) and sixteen players of 38 bytes: byte 0
// the nationality, 2 the shirt number, 3-25 the name, 26 the position in its top three bits (G, RB, LB, D, RW, LW, M,
// A), 28-31 the seven skills, three bits each (PA; VE and HE; TA and CO; SP and FI, the first of a pair in the high
// nibble) and 32 the price step, 0 to 49 (src/data/swosPlayers.js).
import { SWOS_PRICES, SWOS_SCALE, SWOS_SKILLS } from '../../src/data/swosPlayers.js';

export const SWOS_TEAM_BYTES = 684;
const TEAM_HEADER = 76, PLAYER_BYTES = 38, PLAYERS = 16;
export const SWOS_POSITIONS = Object.freeze(['G', 'RB', 'LB', 'D', 'RW', 'LW', 'M', 'A']);
/** The national team files: Europe, Africa, South America, North and Central America, Asia, Oceania. */
export const SWOS_NATIONAL_FILES = Object.freeze(['080', '081', '082', '083', '084', '085']);

/**
 * SWOS's nationality byte as the game shows it, a three-letter code: the code the shipped SWOS 96/97 database
 * (Whiteulver's, scripts/data/retro-seasons.json swos-9697) records for the players whose record in SWOS 96/97's own
 * national and seven league files carries that byte (7,650 players matched by team and name; two disagree, a Welshman
 * at Cardiff and an Argentine at Pisa whom the files give the byte of England and of Italy). Bytes 95 and 128, which
 * no 96/97 player carries, are named as SwosPlayerFinder's table names them (Chad, Iran). The code only sets a name's
 * case (properCase) and is kept as a club player's nationality; a national squad's players take their team's name.
 */
export const SWOS_NATIONALITIES = Object.freeze({
  0: 'ALB', 1: 'AUT', 2: 'BEL', 3: 'BUL', 4: 'CRO', 5: 'CYP', 6: 'TCH', 7: 'DEN', 8: 'ENG', 9: 'EST', 10: 'FAR', 11: 'FIN', 12: 'FRA',
  13: 'GER', 14: 'GRE', 15: 'HUN', 16: 'ISL', 17: 'ISR', 18: 'ITA', 19: 'LAT', 20: 'LIT', 21: 'LUX', 22: 'MLT', 23: 'HOL', 24: 'NIR',
  25: 'NOR', 26: 'POL', 27: 'POR', 28: 'ROM', 29: 'RUS', 30: 'SMR', 31: 'SCO', 32: 'SLO', 33: 'SWE', 34: 'TUR', 35: 'UKR', 36: 'WAL',
  37: 'YUG', 38: 'BLS', 39: 'SVK', 40: 'ESP', 41: 'ARM', 42: 'BOS', 43: 'AZB', 44: 'GEO', 45: 'SUI', 46: 'IRL', 47: 'MAC', 49: 'LIE',
  50: 'MOL', 51: 'CRC', 53: 'GUA', 54: 'HON', 56: 'MEX', 57: 'PAN', 58: 'USA', 59: 'BAH', 60: 'NIC', 61: 'BER', 62: 'JAM', 63: 'TRI',
  64: 'CAN', 65: 'BAR', 66: 'ELS', 67: 'SVC', 68: 'ARG', 69: 'BOL', 70: 'BRA', 71: 'CHL', 72: 'COL', 73: 'ECU', 74: 'PAR', 75: 'SUR',
  76: 'URU', 77: 'VNZ', 78: 'GUY', 79: 'PER', 80: 'ALG', 81: 'SAF', 82: 'BOT', 83: 'BFS', 84: 'BUR', 85: 'LES', 86: 'ZAI', 87: 'ZAM',
  88: 'GHA', 89: 'SEN', 90: 'CIV', 91: 'TUN', 92: 'MLI', 94: 'CMR', 95: 'CHAD', 96: 'UGA', 97: 'LIB', 98: 'MOZ', 99: 'KEN', 100: 'SUD',
  101: 'SWA', 102: 'ANG', 103: 'TOG', 104: 'ZIM', 105: 'EGY', 106: 'TAN', 107: 'NIG', 108: 'ETH', 109: 'GAB', 110: 'SIE', 111: 'BEN',
  112: 'CON', 113: 'GUI', 114: 'SRL', 115: 'MAR', 116: 'GAM', 117: 'MLW', 118: 'JAP', 119: 'TAI', 120: 'IND', 121: 'BAN', 122: 'BRU',
  123: 'IRA', 124: 'JOR', 125: 'SRI', 126: 'SYR', 127: 'KOR', 128: 'IRAN', 129: 'VIE', 130: 'MLY', 131: 'SAU', 132: 'YEM', 133: 'KUW',
  134: 'LAO', 135: 'NKR', 136: 'OMA', 137: 'PAK', 138: 'PHI', 139: 'CHI', 140: 'SGP', 141: 'MAU', 142: 'MYA', 143: 'PAP', 146: 'QAT',
  147: 'UAE', 148: 'AUS', 149: 'NZL', 150: 'FIJ', 151: 'SOL',
});

const text = (bytes, at, length) => {
  let end = at;
  while (end < at + length && bytes[end] !== 0) end++;
  return Buffer.from(bytes.subarray(at, end)).toString('latin1').trim();
};

/**
 * One TEAM file's teams: `{ number, teams: [{ index, name, division, players: [{ slot, nat, shirt, name, pos, PA, VE,
 * HE, TA, CO, SP, FI, value }] }] }`, `value` the raw price step. `number` is the file's ('080'). Throws on any byte
 * the layout does not explain.
 */
export function readTeamFile(bytes, number) {
  if (!/^\d{3}$/.test(number)) throw new Error(`TEAM file number ${number} is not three digits`);
  const count = (bytes.length - 2) / SWOS_TEAM_BYTES;
  if (!Number.isInteger(count) || count < 1) throw new Error(`TEAM.${number}: ${bytes.length} bytes are not 2 plus whole teams of ${SWOS_TEAM_BYTES}`);
  if (bytes[0] !== 0 || bytes[1] !== count) throw new Error(`TEAM.${number}: its header names ${bytes[1]} teams, its length ${count}`);
  const teams = [];
  for (let index = 0; index < count; index++) {
    const at = 2 + index * SWOS_TEAM_BYTES;
    if (bytes[at] !== Number(number) || bytes[at + 1] !== index) {
      throw new Error(`TEAM.${number} team ${index}: its header gives file ${bytes[at]}, place ${bytes[at + 1]}`);
    }
    const team = { index, name: text(bytes, at + 5, 19), division: bytes[at + 25], players: [] };
    if (!team.name) throw new Error(`TEAM.${number} team ${index} has no name`);
    for (let slot = 0; slot < PLAYERS; slot++) {
      const p = at + TEAM_HEADER + slot * PLAYER_BYTES;
      const name = text(bytes, p + 3, 23);
      if (!name) throw new Error(`TEAM.${number} ${team.name} player ${slot + 1} has no name`);
      const value = bytes[p + 32];
      if (value > SWOS_SCALE) throw new Error(`TEAM.${number} ${team.name} ${name} has price step ${value}`);
      team.players.push({
        slot, nat: bytes[p], shirt: bytes[p + 2], name, pos: SWOS_POSITIONS[bytes[p + 26] >> 5],
        PA: bytes[p + 28] & 7, VE: (bytes[p + 29] >> 4) & 7, HE: bytes[p + 29] & 7, TA: (bytes[p + 30] >> 4) & 7,
        CO: bytes[p + 30] & 7, SP: (bytes[p + 31] >> 4) & 7, FI: bytes[p + 31] & 7, value,
      });
    }
    teams.push(team);
  }
  return { number, teams };
}

/** A player's id in a season built from team files: the file's number, the team's place in it and the player's slot. */
export const swosFileId = (number, index, slot) => Number(number) * 10000 + index * 16 + slot + 1;

/**
 * A file's players as the rows buildSwosSeason reads (as the SWOS 96/97 database holds them): `id`, `name`, `pos`, `nat`
 * (the nationality's code, SWOS_NATIONALITIES), the seven skills, `GK`, `value` in pounds, `team`, `division`, `type`
 * ('NATIONAL' or 'CLUB'). The price step is read as that database stores it: step 0 as 1 (25K) and 49 as 48 (15M);
 * `clamped` lists the players whose step moved. Throws on a nationality byte with no code.
 */
export function swosRows(file, type, clamped = []) {
  return file.teams.flatMap(team => team.players.map(player => {
    const nat = SWOS_NATIONALITIES[player.nat];
    if (!nat) throw new Error(`TEAM.${file.number} ${team.name} ${player.name} has nationality byte ${player.nat}, which SWOS_NATIONALITIES does not name`);
    const step = Math.max(1, Math.min(48, player.value));
    if (step !== player.value) clamped.push(`${team.name} ${player.name} ${player.value} -> ${step}`);
    const skills = Object.fromEntries(SWOS_SKILLS.map(skill => [skill, player[skill]]));
    return { id: swosFileId(file.number, team.index, player.slot), player_no: player.shirt, name: player.name, pos: player.pos, nat, ...skills,
      GK: player.pos === 'G' ? step : 0, value: SWOS_PRICES[step], team: team.name, division: team.division, file: file.number, type };
  }));
}
