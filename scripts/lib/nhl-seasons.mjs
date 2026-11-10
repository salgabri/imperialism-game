// Ice hockey's earlier seasons (docs/design/hockey.md, "Earlier seasons"): the sources' parsers, the classic games'
// overall formulas, the joins with the NHL's own rosters, and the clubs and nations each season fields. No I/O here:
// scripts/sync-nhl-seasons.mjs reads the pinned downloads and writes the snapshots, scripts/build-nhl-seasons.mjs builds
// the seasons from them.
//
// Every rating is the source's. Two editions publish attributes but no overall: NHL '94 (KinGraph's sheet of the
// cartridge's 0–6 attributes), whose overall is the game's own rule (nhl94Overall), and NHLPA Hockey '93 (the
// cartridge's 0–15 attributes), whose overall is NHL '94's weights on its displayed values (nhlpa93Overall). Both are
// documented in docs/design/hockey.md.
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { parseCsv } from './football-data.mjs';
import { nationOfBirth, ROSTER_SIZE, rosterOf } from './nhl.mjs';

export { parseCsv };

// Letters NFD does not decompose fold by hand, as scripts/sync-nhl.mjs folds them.
const FOLD = { ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };
/** A name as the sources may spell it differently: no accents, case or punctuation. */
export const norm = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[øđðłıßæœþ]/g, c => FOLD[c])
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- the classic games' overall ----------

/** NHL '94's weights on its skaters' 0–6 attributes (forum.nhl94.com topics 228 and 19828). */
export const NHL94_SKATER_WEIGHTS = Object.freeze({ agility: 2, speed: 3, offence: 3, defence: 2, shotPower: 1, checking: 2,
  stickHandling: 3, shotAccuracy: 2, endurance: 1, passing: 1 });
/** Its goalies': agility, defensive awareness and puck control weigh 4.5 each, the stick and glove sides 1 each. */
export const NHL94_GOALIE_WEIGHTS = Object.freeze({ agility: 4.5, defence: 4.5, puckControl: 4.5, stickRight: 1, stickLeft: 1,
  gloveRight: 1, gloveLeft: 1 });

/** A sum to the game's overall: below 50 it is 25 + half of it, rounded down; 99 at most (wboy's rule, topic 228). */
const overallOfTotal = total => Math.min(99, total < 50 ? Math.floor(25 + total / 2) : Math.floor(total));

/**
 * NHL '94's own overall from a player's 0–6 attributes, as wboy reverse-engineered it (forum.nhl94.com topic 228): the
 * weighted sum of NHL94_SKATER_WEIGHTS (a goalie's: each 4.5 term rounded down, plus the four sides), then
 * overallOfTotal.
 */
export function nhl94Overall(attributes, goalie) {
  if (goalie) {
    const { agility, defence, puckControl, stickRight, stickLeft, gloveRight, gloveLeft } = attributes;
    return overallOfTotal(Math.floor(4.5 * agility) + Math.floor(4.5 * defence) + Math.floor(4.5 * puckControl)
      + stickRight + stickLeft + gloveRight + gloveLeft);
  }
  return overallOfTotal(Object.entries(NHL94_SKATER_WEIGHTS).reduce((sum, [key, weight]) => sum + weight * attributes[key], 0));
}

/** NHLPA '93 shows a 0–15 attribute as floor(v × 20 / 3), 0 to 100. */
export const nhlpa93Displayed = value => Math.floor(value * 20 / 3);

/**
 * NHLPA Hockey '93's overall, which the cartridge's attributes do not give: NHL '94's weights on its displayed values,
 * a weighted mean rounded down (floor(Σ w·floor(v·20/3) / Σ w)). It gives Shawn Chambers, whose attributes are almost
 * all zero, the 1 he is remembered for. A goalie's weights are NHL '94's goalie weights, the same way; 99 at most, as
 * NHL '94 caps its own.
 */
export function nhlpa93Overall(attributes, goalie) {
  const weights = goalie ? NHL94_GOALIE_WEIGHTS : NHL94_SKATER_WEIGHTS;
  const total = Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * nhlpa93Displayed(attributes[key]), 0);
  const weight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return Math.min(99, Math.floor(total / weight));
}

/**
 * A rank-preserving rescale of a season's overalls `values` onto the sorted ratings `reference` (quantile mapping): an
 * overall takes the reference rating at its mid-rank among `values`, the mean of the first and last places it holds in
 * their ascending order as a share of the whole. Every tie stays a tie and nobody passes anybody, though overalls a step
 * apart may meet on a narrower scale. Returns a Map overall → rating.
 */
export function quantileRescale(values, reference) {
  const sorted = values.slice().sort((a, b) => a - b);
  const target = reference.slice().sort((a, b) => a - b);
  const rating = new Map();
  for (const value of new Set(sorted)) {
    const share = sorted.length > 1 ? (sorted.indexOf(value) + sorted.lastIndexOf(value)) / 2 / (sorted.length - 1) : 0.5;
    rating.set(value, target[Math.round(share * (target.length - 1))]);
  }
  return rating;
}

/** A histogram `{ rating: count }` (scripts/data/nhl-seasons.json `rescale.histogram`) as its ratings, ascending. */
export const ratingsOf = histogram => Object.entries(histogram).flatMap(([rating, count]) => Array(count).fill(Number(rating)))
  .sort((a, b) => a - b);

// ---------- the sources ----------

const number = (value, where) => {
  const n = Number(String(value).trim());
  if (String(value).trim() === '' || !Number.isFinite(n)) throw new Error(`${where}: ${JSON.stringify(value)} is not a number`);
  return n;
};
const header = row => row.map(cell => cell.replace(/\s+/g, ' ').trim());

/**
 * KinGraph's "NHL94 Players w Formula" sheet, its Player Data tab (CSV): one row per cartridge player, duplicates
 * removed, `{ name, team, group: 'F'|'D'|'G', attributes }` with the raw 0–6 attributes. Its own overall columns are
 * formulas of the sheet (KinGraph rounds a half up) and are not read.
 */
export function parseKinGraph(text) {
  const [head, ...rows] = parseCsv(text);
  const h = header(head);
  const col = name => {
    const at = h.indexOf(name);
    if (at < 0) throw new Error(`KinGraph's sheet has no column ${JSON.stringify(name)}`);
    return at;
  };
  const C = { name: col('Name'), team: col('Team'), pos: col('pos'), agi: col('Agi'), spd: col('Spd'), ofa: col('OfA'), dfa: col('DfA'),
    shp: col('ShP PcK'), ck: col('Ck'), sth: col('StH'), sha: col('ShA'), end: col('End StR'), rgh: col('Rgh StL'), pas: col('Pas GvR'), agr: col('Agr GvL') };
  return rows.filter(row => row.length > 5 && row[C.name].trim()).map((row, i) => {
    const where = `KinGraph row ${i + 2} (${row[C.name]})`;
    const v = key => number(row[C[key]], where);
    const group = row[C.pos].trim();
    if (!['F', 'D', 'G'].includes(group)) throw new Error(`${where}: position ${JSON.stringify(group)}`);
    const attributes = group === 'G'
      ? { agility: v('agi'), defence: v('dfa'), puckControl: v('shp'), stickRight: v('end'), stickLeft: v('rgh'), gloveRight: v('pas'), gloveLeft: v('agr') }
      : { agility: v('agi'), speed: v('spd'), offence: v('ofa'), defence: v('dfa'), shotPower: v('shp'), checking: v('ck'), stickHandling: v('sth'),
        shotAccuracy: v('sha'), endurance: v('end'), passing: v('pas') };
    return { name: row[C.name].trim(), team: row[C.team].trim(), group, attributes };
  });
}

/**
 * The NHLPA '93 roster CSV (the cartridge's attributes, 0–15, exported by the NHL Hockey Roster Tool): `{ name, team,
 * attributes }` per player, the All-Star teams left out. Its position column is not the players' (every goalie is an
 * F), so positions come from the NHL; `attributes` holds both readings of the columns, a skater's and a goalie's.
 */
export function parseNhlpa93(text) {
  const rows = parseCsv(text);
  const goalieHead = header(rows[0]), playerHead = header(rows[1]);
  if (goalieHead[0] !== 'Goalie' || playerHead[0] !== 'Player') throw new Error('The NHLPA 93 CSV does not start with its two header rows');
  const at = (head, name, nth = 0) => {
    let index = -1;
    for (let k = 0; k <= nth; k++) index = head.indexOf(name, index + 1);
    if (index < 0) throw new Error(`The NHLPA 93 CSV has no column ${name}`);
    return index;
  };
  const S = { agility: at(playerHead, 'Agl'), speed: at(playerHead, 'Spd'), offence: at(playerHead, 'OfA'), defence: at(playerHead, 'DfA'),
    shotPower: at(playerHead, 'ShP'), checking: at(playerHead, 'ChK'), stickHandling: at(playerHead, 'StH'), shotAccuracy: at(playerHead, 'ShA'),
    endurance: at(playerHead, 'End'), passing: at(playerHead, 'Pas') };
  const G = { agility: at(goalieHead, 'Agl'), defence: at(goalieHead, 'DfA'), puckControl: at(goalieHead, 'PkC'), stickRight: at(goalieHead, 'StR'),
    stickLeft: at(goalieHead, 'StL'), gloveRight: at(goalieHead, 'GvR'), gloveLeft: at(goalieHead, 'GvL') };
  return rows.slice(2).filter(row => row.length >= playerHead.length && row[1].trim()).map((row, i) => {
    const where = `NHLPA 93 row ${i + 3} (${row[1]} ${row[2]})`;
    const read = map => Object.fromEntries(Object.entries(map).map(([key, index]) => [key, number(row[index], where)]));
    return { name: `${row[1].trim()} ${row[2].trim()}`, team: row[3].trim(), skater: read(S), goalie: read(G) };
  }).filter(player => !['ASE', 'ASW'].includes(player.team));
}

/**
 * nhl-95.com's NHL 95 sheet (Jon Morris), its Player Stats tab (CSV): `{ name, team, pos, overall }` per player, the
 * team as the sheet writes it ('Det', 'VAN'…) and the overall as it shows it (the Genesis game's).
 */
export function parseNhl95Sheet(text) {
  const [head, ...rows] = parseCsv(text);
  const h = header(head);
  const C = { team: h.indexOf('Team'), name: h.indexOf('Name'), pos: h.indexOf('Pos.'), overall: h.indexOf('ST Overall') };
  if (Object.values(C).some(index => index < 0)) throw new Error("nhl-95.com's sheet lacks Team, Name, Pos. or ST Overall");
  return rows.filter(row => row[C.name]?.trim()).map((row, i) => ({ name: row[C.name].trim(), team: row[C.team].trim(), pos: row[C.pos].trim(),
    overall: number(row[C.overall], `nhl-95.com row ${i + 2} (${row[C.name]})`) }));
}

const decode = text => text.replace(/&#0*39;|&#x27;|&#8217;|&rsquo;/gi, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const cellText = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tableRows = table => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map(m => [...m[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map(c => cellText(c[2])));

/** Segathon's NHL 95 ratings table (`tablepress-27`), the part of its page that does not change between requests. */
export function segathonTable(html) {
  const table = html.match(/<table id="tablepress-27"[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error("Segathon's page has no ratings table tablepress-27");
  return table;
}

/** Segathon's NHL 95 skaters: `{ name, team, overall }` from its "NHL 95 Overall" column. */
export function parseSegathon(html) {
  const [head, ...rows] = tableRows(segathonTable(html));
  const C = { first: head.indexOf('First'), last: head.indexOf('Last'), team: head.indexOf('Team'), overall: head.indexOf('NHL 95 Overall') };
  if (Object.values(C).some(index => index < 0)) throw new Error("Segathon's table lacks First, Last, Team or NHL 95 Overall");
  return rows.filter(row => row[C.last]).map(row => ({ name: `${row[C.first]} ${row[C.last]}`.trim(), team: row[C.team],
    overall: /^\d+$/.test(row[C.overall]) ? Number(row[C.overall]) : null }));
}

const IGN_POSITION = { Center: 'C', 'Left Wing': 'LW', 'Right Wing': 'RW', Defenseman: 'D', Goalie: 'G' };

/**
 * One of IGN's NHL 07 pages (EA's ratings, sports.ign.com/nhl07/<team>.html, or goalies.html): `{ name, pos, team,
 * overall }` per player, the overall as the page gives it (a goalie's unrounded).
 */
export function parseIgnPage(html) {
  // The ratings table sits inside the page's layout tables: take the innermost table around its header.
  const headAt = html.indexOf('<th>First Name</th>');
  const start = html.lastIndexOf('<table', headAt), end = html.indexOf('</table>', headAt);
  if (headAt < 0 || start < 0 || end < 0) throw new Error("IGN's page has no ratings table");
  const rows = tableRows(html.slice(start, end + '</table>'.length));
  const at = rows.findIndex(row => row.includes('First Name'));
  const head = rows[at];
  const C = { first: head.indexOf('First Name'), last: head.indexOf('Last Name'), pos: head.indexOf('Position'), team: head.indexOf('Team'), overall: head.indexOf('Overall') };
  if (Object.values(C).some(index => index < 0)) throw new Error("IGN's table lacks a name, position, team or overall column");
  return rows.slice(at + 1).filter(row => row.length > C.overall && row[C.last]).map(row => {
    const pos = IGN_POSITION[row[C.pos]];
    if (!pos) throw new Error(`IGN: unknown position ${JSON.stringify(row[C.pos])} (${row[C.first]} ${row[C.last]})`);
    return { name: `${row[C.first]} ${row[C.last]}`.trim(), pos, team: row[C.team], overall: number(row[C.overall], `IGN ${row[C.first]} ${row[C.last]}`) };
  });
}

/** One of IGN's NHL 08 pages (sports.ign.com/nhl08/<team>.html): `{ name, country }` per player, EA's Country field. */
export function parseIgnCountries(html) {
  const headAt = html.indexOf('<th>First Name</th>');
  const start = html.lastIndexOf('<table', headAt), end = html.indexOf('</table>', headAt);
  if (headAt < 0 || start < 0 || end < 0) throw new Error("IGN's NHL 08 page has no player table");
  const rows = tableRows(html.slice(start, end + '</table>'.length));
  const at = rows.findIndex(row => row.includes('First Name'));
  const head = rows[at];
  const C = { first: head.indexOf('First Name'), last: head.indexOf('Last Name'), country: head.indexOf('Country') };
  if (Object.values(C).some(index => index < 0)) throw new Error("IGN's NHL 08 table lacks a name or Country column");
  return rows.slice(at + 1).filter(row => row.length > C.country && row[C.last]).map(row => ({ name: `${row[C.first]} ${row[C.last]}`.trim(), country: row[C.country] }));
}

/**
 * One of IGN's NHL 08 or NHL 09 team pages (EA's attributes, no overall): `{ name, table: 'skater'|'goalie', fields }` per
 * player, `fields` every column the page gives by its header (NHL 08: Country, Position, Birth Date and 24 or 20
 * attributes; NHL 09: 23 or 19 attribute codes). The goalies' table is the one whose header names a goalie's attribute.
 */
export function parseIgnAttributes(page) {
  // The Canadiens' NHL 08 page closes each row's last cell as "</td</tr>".
  const html = page.replace(/<\/td<\/tr>/g, '</td></tr>');
  const out = [];
  let from = 0;
  for (;;) {
    const headAt = html.indexOf('<th>First Name</th>', from);
    if (headAt < 0) break;
    const start = html.lastIndexOf('<table', headAt), end = html.indexOf('</table>', headAt);
    if (start < 0 || end < 0) throw new Error("IGN's page has a header outside a table");
    // Two NHL 08 pages leave a row open: the Devils' goalies' last row (Kevin Weekes) ends at the table's end without its
    // </tr>, and on the Stars' page Jeff Halpern's row starts inside Stu Barnes's last cell, on a line of its own.
    const table = html.slice(start, end + '</table>'.length)
      .replace(/<\/td>(\s*)<\/table>$/, '</td></tr>$1</table>')
      .replace(/(<td>[^<\r\n]*)\r?\n(?=[^<\s])/g, '$1</td></tr><tr><td>');
    const rows = tableRows(table);
    const at = rows.findIndex(row => row.includes('First Name'));
    const head = rows[at];
    const goalies = head.some(h => ['Glove Side High', 'GLVHI', '5 Hole', '5HOLE'].includes(h));
    for (const row of rows.slice(at + 1)) {
      if (row.length !== head.length || !row[head.indexOf('Last Name')]) continue;
      const fields = Object.fromEntries(head.map((h, i) => [h, row[i]]));
      out.push({ name: `${fields['First Name']} ${fields['Last Name']}`.trim(), table: goalies ? 'goalie' : 'skater', fields });
    }
    from = end;
  }
  if (!out.length) throw new Error("IGN's page has no player table");
  return out;
}

/** IGN's NHL 08 positions. */
export const IGN08_POSITION = Object.freeze({ Center: 'C', 'Left Wing': 'LW', 'Right Wing': 'RW', Defense: 'D', Defenseman: 'D', Goalie: 'G' });

/** EA's country names (IGN's NHL 08 pages) as the NHL's codes (ISO 3166 alpha-3). */
export const COUNTRY_CODE = Object.freeze({ Austria: 'AUT', Belarus: 'BLR', Brazil: 'BRA', Canada: 'CAN', 'Czech Republic': 'CZE', Denmark: 'DNK', Finland: 'FIN',
  France: 'FRA', Germany: 'DEU', Italy: 'ITA', Kazakhstan: 'KAZ', Kazakstan: 'KAZ', Latvia: 'LVA', Lithuania: 'LTU', 'Northern Ireland': 'GBR', Norway: 'NOR',
  Poland: 'POL', Russia: 'RUS', Slovakia: 'SVK', 'South Africa': 'ZAF', 'South Korea': 'KOR',
  Slovenia: 'SVN', Sweden: 'SWE', Switzerland: 'CHE', Ukraine: 'UKR', USA: 'USA' });

const NHL_POSITION = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };

/** An NHL roster (api-web.nhle.com/v1/roster/{team}/{season}): `{ id, name, pos, born, team }` per player. */
export function nhlRosterPlayers(body, team) {
  return ['forwards', 'defensemen', 'goalies'].flatMap(group => body[group] || []).map(row => {
    const pos = NHL_POSITION[row.positionCode];
    if (!pos) throw new Error(`Unknown NHL position ${row.positionCode} (${row.id})`);
    return { id: row.id, name: `${row.firstName.default} ${row.lastName.default}`.trim(), last: row.lastName.default, pos, born: row.birthCountry ?? null, team };
  });
}

// ---------- joining a source to the NHL ----------

const groupOf = pos => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');
const editDistance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};

/**
 * The NHL's player for a source's (`name`, `team`, optional `group` F/D/G), among the league's players not `taken`:
 * on his club first (the manifest's `aliases` for the cartridges' abbreviated and misspelt names, the full name, the
 * surname and first initial when one such player fits, a near spelling of the whole name), then, unless
 * `onTeamOnly`, the full name anywhere in the league that season. A goalie never matches a skater. Returns
 * `{ player, how }`, or null.
 */
export function findPlayer(league, { name, team, group }, aliases = {}, { taken = new Set(), onTeamOnly = false } = {}) {
  const wanted = norm(aliases[name] ?? name);
  const fits = p => !group || groupOf(p.pos) === group || (group !== 'G' && p.pos !== 'G');
  const free = league.filter(p => !taken.has(p.id) && fits(p));
  const onTeam = free.filter(p => p.team === team);
  const pick = (list, how) => {
    const exact = list.filter(p => groupOf(p.pos) === group);
    const chosen = exact.length === 1 ? exact : list.length === 1 ? list : [];
    return chosen.length === 1 ? { player: chosen[0], how } : null;
  };
  const full = p => norm(p.name) === wanted;
  const initial = p => norm(p.name)[0] === wanted[0];
  // A surname may be two words ("St. Jacques"), a first name too ("Jean-Sebastien"): the NHL's surname ends the name.
  const surname = p => norm(p.last) && wanted.endsWith(` ${norm(p.last)}`) && initial(p);
  // A misspelt name: two letters off at most (one for a short name), with the same first letter.
  const near = p => initial(p) && editDistance(norm(p.name), wanted) <= (wanted.length >= 10 ? 2 : 1);
  const how = aliases[name] ? 'alias' : null;
  return pick(onTeam.filter(full), how ?? 'name')
    ?? pick(onTeam.filter(surname), 'surname')
    ?? pick(onTeam.filter(near), 'near spelling')
    ?? (onTeamOnly ? null : pick(free.filter(full), how ?? 'name, another club'))
    ?? null;
}

// ---------- the season's clubs and nations ----------

/** The data set id of the season ending in `year`: 'nhl-1994'. */
export const seasonIdOf = year => `nhl-${year}`;

/** The era map the season of `year` plays on (scripts/data/nhl-seasons.json `maps`). */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No NHL map for the season ending in ${year}`);
  return map.id;
}

/**
 * The clubs of the season ending in `year`, by the NHL's code that season: `{ code, id, franchise, name, city, arena,
 * home, country }` (scripts/data/nhl-seasons.json `teams` where it lists the season, else `eras`). A franchise that has
 * moved or been renamed since has an id of its own for its era (`id`); one that has not keeps today's (`franchise`); a
 * defunct one (the Seals and Barons) has no franchise of today's (`franchise` null).
 */
export function teamsOf(manifest, year) {
  const list = manifest.teams[String(year)] ?? erasOf(manifest, year);
  if (!list) throw new Error(`No NHL clubs listed for the season ending in ${year}`);
  const teams = list.map(team => ({ ...team, id: team.id ?? team.franchise }));
  for (const key of ['code', 'id', 'city']) {
    const values = teams.map(team => team[key]);
    if (new Set(values).size !== values.length) throw new Error(`Two NHL clubs of ${year} share a ${key}`);
  }
  return teams;
}

/**
 * The clubs of a season `teams` does not list, from each franchise's era that holds it (scripts/data/nhl-seasons.json
 * `eras`), by code; null for a season not played (`cancelled`: 2004/05, which an era running across it does not hold).
 */
function erasOf(manifest, year) {
  if (manifest.eras?.cancelled?.includes(year)) return null;
  const defunct = new Set(manifest.eras?.defunct ?? []);
  const list = Object.entries(manifest.eras?.franchises ?? {}).flatMap(([franchise, eras]) => {
    const era = eras.find(e => e.from <= year && year <= e.to);
    if (!era) return [];
    const { from, to, ...team } = era;
    if (defunct.has(franchise) && !team.id) throw new Error(`${franchise} (${from}–${to}): a defunct franchise's eras need their own ids`);
    return [{ code: team.code, ...(team.id ? { id: team.id } : {}), franchise: defunct.has(franchise) ? null : franchise, name: team.name, city: team.city,
      arena: team.arena, home: team.home, country: team.country }];
  });
  return list.length ? list.sort((a, b) => a.code.localeCompare(b.code)) : null;
}

const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);

/**
 * One club's squad from its players `pool`: the lineup the game picks, a backup goalie and the best skaters left, up
 * to 23 (scripts/lib/nhl.mjs rosterOf). A club the season's source leaves short fields what it has: a place nobody can
 * take is an empty shirt the game counts at its floor, and a backup goalie the lineup would put on a forward line is
 * left out instead. `open` lists the places no player of its own group fills.
 */
export function clubSquadOf(pool) {
  let { squad } = rosterOf(pool.slice().sort(byRating));
  let lineup = selectLineup({ sport: 'hockey', squad });
  const skatingGoalie = lineup.slots.find(slot => slot.player && slot.position !== 'G' && slot.player.pos === 'G');
  if (skatingGoalie) {
    squad = squad.filter(player => player !== squad[skatingGoalie.player.originalIndex]);
    lineup = selectLineup({ sport: 'hockey', squad });
  }
  if (squad.length > ROSTER_SIZE) throw new Error(`A squad of ${squad.length}`);
  const open = lineup.slots.filter(slot => !slot.player || slot.penalty > 4).map(slot => slot.position);
  return { squad, lineup, open };
}

/** A player's nation by the NHL's birth country (ISO-3), or null for a player the NHL gives none. */
export function nationOf(born) {
  if (born == null) return null;
  const nation = nationOfBirth(born);
  if (!nation || !NATIONS[nation]) throw new Error(`No nation for the birth country ${JSON.stringify(born)}`);
  return nation;
}
