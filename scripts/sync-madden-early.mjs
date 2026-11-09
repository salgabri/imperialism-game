// Snapshot the NFL seasons of Madden NFL 99, 2000 and 2001 (docs/design/american-football.md, "Madden NFL 99 to 2001")
// from NFL Draft Buzz's copy of EA's data into scripts/data/madden-early/<season>.json (committed), for the earlier
// American football seasons to build from:
//
//   1998  Madden NFL 99     EA's attributes, no overall: the overall ours (conversion)
//   1999  Madden NFL 2000   EA's attributes, no overall: the overall ours (conversion)
//   2000  Madden NFL 2001   EA's overall, unchanged
//
// Each club's players come from its team page (/madden/team/<nickname>/<edition>); the three clubs that have moved
// since (the Raiders, Rams and Chargers), whose team pages are empty for these editions, from the position lists
// (/madden/year/<edition>/<group>), which leave out a few odd position labels (LLB, LT/RT), and their kickers' power and
// accuracy from their player pages. The site's synthetic overall (OVR*) is never read. Where an edition kept no
// overall, each player's attributes are weighted as Madden NFL 2001 weights them (least squares on its EA overall, by
// position group), ranked within the season at his game position and read off Madden NFL 2002's overalls at that
// position (scripts/lib/nfl-reference.mjs), as the Tecmo seasons' are. Every check (maddenratings.net's team overalls
// and 99 and 100 overall clubs, nflverse's rosters, the lists against the team pages) is written into the snapshot.
//
// The pages stay in the gitignored data-src/ndb-madden/ (and the checks' sources in data-src/research/ and
// data-src/research80s/), each read only when it is the file scripts/data/ndb-pages.json pins by SHA-256.
//
// Usage: node scripts/sync-madden-early.mjs [--season=<year>] [--check] [--pin]
//   --season  one season only
//   --check   rebuild the snapshots and compare them byte for byte; writes nothing
//   --pin     write scripts/data/ndb-pages.json from the pages in data-src/ (after fetching more of them)
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FORMATION, shortOf, squadOf, teamsOf } from './lib/nfl.mjs';
import { maddenReferencePlayers, positionOveralls } from './lib/nfl-reference.mjs';
import {
  ATTRIBUTES, EDITIONS, FRANCHISE_OF_CODE, FRANCHISE_OF_SLUG, LIST_GROUPS, LIST_ONLY, firstLabel, groupOf, leastSquares, normaliseAttributes,
  parseList, parsePlayerEdition, parseTeamPage, positionOf, roundWeights, scoreOf, spearman,
} from './lib/ndb-madden.mjs';
import { parseCsv } from './lib/tecmo.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataSrc = path.join(root, 'data-src');
const outDir = path.join(root, 'scripts/data/madden-early');
const pinsFile = path.join(root, 'scripts/data/ndb-pages.json');
const SITE = 'https://www.nfldraftbuzz.com';
const NDB = 'ndb-madden';
const NFLVERSE = 'research80s/american-football/nflverse-rosters-1980-2000';
const MR = 'research/american-football/maddenratings-net/pages';
const MR_PAGE = { 1999: 'madden-nfl-99.html', 2000: 'madden-nfl-2000.html', 2001: 'madden-nfl-2001.html' };
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
// The edition the weights are fitted on: the nearest that kept EA's overall.
const FIT_EDITION = 2001;
const EXAMPLES = 12;
// The places of the game's lineup a club has too few natural players for, by season and franchise, and why: the game
// fills them out of position (no player is added), and any other shortfall stops the sync.
const GAPS = {
  // Madden NFL 99: the Cardinals carry three receivers, two of them under Rob Moore's name (the other, #20, is left out).
  // The site's copy lacks the Dolphins' other receivers (O.J. McDuffie, Lamar Thomas, Oronde Gadsden), a Panthers lineman,
  // and the Colts' and 49ers' kickers (Mike Vanderjagt, Wade Richey).
  1998: { 'nfl-arizona-cardinals': { WR: 1 }, 'nfl-carolina-panthers': { OL: 1 }, 'nfl-indianapolis-colts': { K: 1 },
    'nfl-miami-dolphins': { WR: 2 }, 'nfl-san-francisco-49ers': { K: 1 } },
  // Madden NFL 2000: the site's copy lacks a Colts receiver, the Eagles' tight ends but one and their kicker, and
  // Washington's kicker.
  1999: { 'nfl-indianapolis-colts': { WR: 1 }, 'nfl-philadelphia-eagles': { TE: 1, K: 1 }, 'nfl-washington-commanders': { K: 1 } },
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
const round3 = v => Math.round(v * 1000) / 1000;

let PINS = null;
const cache = new Map();
/** A pinned input's text (by its path under data-src/); throws when it is missing or not the pinned file. */
async function pinned(file) {
  if (cache.has(file)) return cache.get(file);
  PINS ??= JSON.parse(await readFile(pinsFile, 'utf8')).files;
  if (!(file in PINS)) throw new Error(`${file} is not pinned in scripts/data/ndb-pages.json`);
  const full = path.join(dataSrc, file);
  if (!existsSync(full)) throw new Error(`data-src/${file} is missing`);
  const bytes = await readFile(full);
  if (sha256(bytes) !== PINS[file]) throw new Error(`data-src/${file} is not the pinned file (SHA-256 ${sha256(bytes)})`);
  const text = bytes.toString('utf8');
  cache.set(file, text);
  return text;
}

// ---------- nflverse ----------

// nflverse's team codes, 1996–2000, as today's franchises.
const NFLVERSE_CODE = {
  ARI: 'nfl-arizona-cardinals', ATL: 'nfl-atlanta-falcons', BAL: 'nfl-baltimore-ravens', BUF: 'nfl-buffalo-bills', CAR: 'nfl-carolina-panthers',
  CHI: 'nfl-chicago-bears', CIN: 'nfl-cincinnati-bengals', CLE: 'nfl-cleveland-browns', DAL: 'nfl-dallas-cowboys', DEN: 'nfl-denver-broncos',
  DET: 'nfl-detroit-lions', GB: 'nfl-green-bay-packers', IND: 'nfl-indianapolis-colts', JAX: 'nfl-jacksonville-jaguars', KC: 'nfl-kansas-city-chiefs',
  OAK: 'nfl-las-vegas-raiders', SD: 'nfl-los-angeles-chargers', STL: 'nfl-los-angeles-rams', RAM: 'nfl-los-angeles-rams', MIA: 'nfl-miami-dolphins',
  MIN: 'nfl-minnesota-vikings', NE: 'nfl-new-england-patriots', NO: 'nfl-new-orleans-saints', NYG: 'nfl-new-york-giants', NYJ: 'nfl-new-york-jets',
  PHI: 'nfl-philadelphia-eagles', PIT: 'nfl-pittsburgh-steelers', SF: 'nfl-san-francisco-49ers', SEA: 'nfl-seattle-seahawks',
  TB: 'nfl-tampa-bay-buccaneers', TEN: 'nfl-tennessee-titans', HOU: 'nfl-tennessee-titans', WAS: 'nfl-washington-commanders',
};
const SAFETY = new Set(['FS', 'SS', 'S', 'SAF']);

/** nflverse's roster of season `season`: by franchise, its rows `{ name, plain, position, depth, no, status }`. */
async function nflverseOf(season) {
  const [header, ...rows] = parseCsv(await pinned(`${NFLVERSE}/roster_${season}.csv`));
  const col = name => header.indexOf(name);
  const out = new Map();
  for (const cells of rows) {
    const franchise = NFLVERSE_CODE[cells[col('team')]];
    if (!franchise) throw new Error(`nflverse ${season}: unknown team ${cells[col('team')]}`);
    if (!out.has(franchise)) out.set(franchise, []);
    out.get(franchise).push({ name: cells[col('full_name')], plain: plain(cells[col('full_name')]), position: cells[col('position')],
      depth: cells[col('depth_chart_position')], no: Number(cells[col('jersey_number')]) || null, status: cells[col('status')] });
  }
  return out;
}
// nflverse's statuses of a player who left a club during the season (traded, cut).
const LEFT_CLUB = new Set(['TRD', 'CUT']);

// ---------- the pages ----------

/** Every player an edition rates, by franchise: `{ franchise, name, href, listed, no, attributes, overall?, from }`. */
async function editionPlayers(edition, teams) {
  const lists = [];
  for (const group of LIST_GROUPS) {
    const list = parseList(await pinned(`${NDB}/lists/madden-year-${edition}-${group}.html`));
    if (list.edition !== edition) throw new Error(`The ${group} list is Madden NFL ${list.edition}'s, not ${edition}'s`);
    // Madden NFL 2001's lists also carry its free agents, who play for no club.
    lists.push(...list.rows.filter(row => row.code !== 'FREEAGENT').map(row => ({ ...row, franchise: FRANCHISE_OF_CODE[row.code] })));
  }
  const unknown = lists.filter(row => !row.franchise);
  if (unknown.length) throw new Error(`${edition}: list teams ${[...new Set(unknown.map(row => row.code))].join(', ')} are no franchise`);
  const players = [], listChecks = { compared: 0, identical: 0, differences: [], notListed: [] };
  for (const team of teams) {
    const slug = Object.keys(FRANCHISE_OF_SLUG).find(key => FRANCHISE_OF_SLUG[key] === team.franchise);
    if (LIST_ONLY.has(team.franchise)) {
      const rows = lists.filter(row => row.franchise === team.franchise);
      for (const row of rows) {
        let { attributes, overall } = row;
        attributes = normaliseAttributes(attributes);
        // A kicker the list shows without his power and accuracy: his player page has them.
        if (firstLabel(row.listed) === 'K' && !EDITIONS[edition].overall) {
          const page = parsePlayerEdition(await pinned(`${NDB}/players/${row.href.split('/').pop()}.html`), edition);
          if (!page || plain(page.name) !== plain(row.name)) throw new Error(`${edition}: no player page row for ${row.name}`);
          attributes = { ...attributes, KPW: page.attributes.KPW, KAC: page.attributes.KAC };
        }
        players.push({ franchise: team.franchise, name: row.name, href: row.href, listed: row.listed, no: null, attributes, overall, from: 'list' });
      }
      continue;
    }
    const page = parseTeamPage(await pinned(`${NDB}/${edition}/${slug}.html`));
    if (page.edition !== edition || page.season !== EDITIONS[edition].season) throw new Error(`${slug} ${edition} is Madden NFL ${page.edition}'s ${page.season}`);
    if (!page.rows.length) throw new Error(`${edition}: the ${slug} page has no players`);
    for (const row of page.rows) {
      let attributes = normaliseAttributes(row.attributes), from = 'team page';
      // A player the page lists under two positions sits in its "Other" table, which shows no blocking or catching: where
      // the overall is ours, his player page gives the edition's values the group needs.
      const position = positionOf(row.listed);
      const needs = !EDITIONS[edition].overall && position && ATTRIBUTES[groupOf(position, row.listed)];
      if (needs && needs.some(name => !Number.isFinite(attributes[name]))) {
        const own = parsePlayerEdition(await pinned(`${NDB}/players/${row.href.split('/').pop()}.html`), edition);
        if (own && plain(own.name) !== plain(row.name)) throw new Error(`${edition}: ${row.href} is ${own.name}'s page, not ${row.name}'s`);
        // A page with no row for the edition leaves him as the team page has him (and so out, below).
        if (own) {
          for (const name of needs) if (!Number.isFinite(attributes[name]) && Number.isFinite(own.attributes[name])) attributes[name] = own.attributes[name];
          from = 'team page and player page';
        }
      }
      players.push({ franchise: team.franchise, name: row.name, href: row.href, listed: row.listed, no: row.no,
        attributes, overall: row.overall, from });
      // The lists against the team page: every value both show.
      const listed = lists.find(item => item.franchise === team.franchise && item.href === row.href);
      if (!listed) { listChecks.notListed.push(`${row.name} (${slug} ${row.listed})`); continue; }
      const theirs = { ...normaliseAttributes(listed.attributes), ...(listed.overall !== undefined ? { OVR: listed.overall } : {}) };
      const ours = { ...normaliseAttributes(row.attributes), ...(row.overall !== undefined ? { OVR: row.overall } : {}) };
      const shared = Object.keys(theirs).filter(key => key in ours);
      listChecks.compared++;
      if (shared.every(key => theirs[key] === ours[key]) && listed.listed === row.listed) listChecks.identical++;
      else if (listChecks.differences.length < EXAMPLES) listChecks.differences.push(`${row.name} (${slug})`);
    }
  }
  return { players, listChecks };
}

// ---------- maddenratings.net ----------

const MR_NAME = { 'Washington Redskins': 'nfl-washington-commanders', 'Tennessee Oilers': 'nfl-tennessee-titans', 'Houston Oilers': 'nfl-tennessee-titans',
  'Oakland Raiders': 'nfl-las-vegas-raiders', 'San Diego Chargers': 'nfl-los-angeles-chargers', 'St. Louis Rams': 'nfl-los-angeles-rams' };
/** maddenratings.net's page of an edition: each club's team overall by franchise, and its 99 and 100 overall clubs. */
async function maddenratings(edition, franchises) {
  const html = await pinned(`${MR}/${MR_PAGE[edition]}`);
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const byName = new Map(Object.entries(franchises).map(([id, team]) => [team.name, id]));
  const overall = {};
  lines.forEach((line, i) => {
    const m = /^(\d+) OVR$/.exec(lines[i + 1] ?? '');
    const franchise = MR_NAME[line] ?? byName.get(line);
    if (m && franchise) overall[franchise] = Number(m[1]);
  });
  const clubs = lines.filter(line => /^(?:100|99) Overall Club:/.test(line)).flatMap(line => line.replace(/^.*?Club:\s*/, '').split(/,\s*/))
    .map(entry => /^([A-Z]+) (.+?) \(/.exec(entry)).filter(Boolean).map(([, pos, name]) => ({ pos, name }));
  return { overall, clubs };
}

// ---------- the conversion ----------

/** Least squares of Madden NFL 2001's EA overall on each group's attributes, over its team pages' players. */
function fitWeights(players) {
  const weights = {}, quality = {};
  for (const [group, names] of Object.entries(ATTRIBUTES)) {
    const rows = players.filter(p => p.group === group && Number.isInteger(p.overall) && names.every(name => Number.isFinite(p.attributes[name])));
    const w = roundWeights(leastSquares(rows.map(p => names.map(name => p.attributes[name])), rows.map(p => p.overall)));
    weights[group] = w;
    const scores = rows.map(p => scoreOf(group, weights, p.attributes));
    quality[group] = { players: rows.length, spearman: spearman(scores, rows.map(p => p.overall)) };
  }
  return { weights, quality };
}

/** The position a player plays: his label's, a generic defensive back (DB) a safety when nflverse lists him at safety that season. */
function placed(player, nflverse) {
  const position = positionOf(player.listed);
  if (position) return { position, rule: null };
  const row = (nflverse.get(player.franchise) ?? []).find(r => r.plain === plain(player.name));
  return SAFETY.has(row?.depth) ? { position: 'S', rule: 'nflverse safety' } : { position: 'CB', rule: row ? 'nflverse corner or DB' : 'not in nflverse' };
}

// ---------- a season ----------

async function snapshotOf(year, manifest, franchises, fit) {
  const source = manifest.sources[year];
  const edition = source.ndbEdition;
  const meta = EDITIONS[edition];
  if (meta.season !== year) throw new Error(`Madden NFL ${edition} rates ${meta.season}, not ${year}`);
  const teams = teamsOf(franchises, manifest, year);
  const nflverse = await nflverseOf(year);
  const { players: raw, listChecks } = await editionPlayers(edition, teams);

  // One player of the site's on two rows of a club, the rows' values apart: its matcher gave two game rows one name, and
  // who the other was nobody can say. The row in the jersey nflverse gives him that season stays (else the first, as the
  // site lists a club by depth); the other is left out.
  const left = [], players = [];
  const rowsOf = new Map();
  for (const player of raw) {
    const key = `${player.franchise}|${player.href ?? plain(player.name)}`;
    if (!rowsOf.has(key)) rowsOf.set(key, []);
    rowsOf.get(key).push(player);
  }
  const kept = new Set();
  for (const rows of rowsOf.values()) {
    const no = (nflverse.get(rows[0].franchise) ?? []).find(r => r.plain === plain(rows[0].name))?.no;
    const matching = rows.filter(row => no && row.no === no);
    const keep = matching.length === 1 ? matching[0] : rows[0];
    kept.add(keep);
    for (const row of rows.filter(r => r !== keep)) {
      left.push(`${row.name} (${row.franchise} ${row.listed}${row.no ? ` #${row.no}` : ''}): a second game row under the name of ${keep.name} #${keep.no ?? '?'}${matching.length === 1 ? ' (nflverse\'s number)' : ' (the first listed)'}; who he was is unknown`);
    }
  }
  // One player of the site's on two clubs of an edition, the rows' values apart: its matcher named another club's game row
  // after him too, and a player plays for one club. The row on the club, in the jersey, nflverse gives him that season
  // stays; where nflverse has him on both (he moved during the season), the row of the club he left, as the launch roster
  // had him. The other is left out; anything nflverse does not settle stops the sync.
  const clubsOf = new Map();
  for (const row of raw.filter(r => kept.has(r) && r.href)) {
    if (!clubsOf.has(row.href)) clubsOf.set(row.href, []);
    clubsOf.get(row.href).push(row);
  }
  for (const rows of clubsOf.values()) {
    if (new Set(rows.map(row => row.franchise)).size < 2) continue;
    const listing = row => (nflverse.get(row.franchise) ?? []).find(r => r.plain === plain(row.name) && (!r.no || !row.no || r.no === row.no));
    const listed = rows.filter(listing);
    const moved = listed.filter(row => LEFT_CLUB.has(listing(row).status));
    const keep = listed.length === 1 ? listed[0] : moved.length === 1 ? moved[0] : null;
    if (!keep) throw new Error(`${year}: ${rows[0].name} is on ${rows.map(row => row.franchise).join(' and ')}, and nflverse does not settle which`);
    for (const row of rows.filter(r => r !== keep)) {
      kept.delete(row);
      left.push(`${row.name} (${row.franchise} ${row.listed}${row.no ? ` #${row.no}` : ''}): another club's game row under the name of ${keep.name} of ${keep.franchise} #${keep.no ?? '?'} (nflverse's ${listed.length === 1 ? 'club and number' : 'club he left that season'}); who he was is unknown`);
    }
  }
  for (const player of raw.filter(row => kept.has(row))) {
    const { position, rule } = placed(player, nflverse);
    if (position === 'P' || position === 'LS') continue;
    const group = groupOf(position, player.listed);
    const lacking = meta.overall ? [] : ATTRIBUTES[group].filter(name => !Number.isFinite(player.attributes[name]));
    if (lacking.length) { left.push(`${player.name} (${player.franchise} ${player.listed}): the edition did not track his ${lacking.join(' and ')}`); continue; }
    players.push({ ...player, position, rule, group });
  }
  // Two names on one club with the same attributes, every one of them: the site's matcher named one game row twice.
  const twins = [];
  const byClub = new Map();
  for (const player of players) {
    const key = `${player.franchise}|${player.listed}|${JSON.stringify(Object.entries(player.attributes).sort())}`;
    if (Object.keys(player.attributes).length >= 5 && byClub.has(key)) twins.push([byClub.get(key), player]);
    else byClub.set(key, player);
  }
  for (const pair of twins) for (const player of pair) {
    if (players.includes(player)) { players.splice(players.indexOf(player), 1); left.push(`${player.name} (${player.franchise} ${player.listed}): the same attributes as ${pair.find(p => p !== player).name}, one game row under two names`); }
  }

  // The overall: EA's, or ours.
  const clubs = teams.length;
  let conversion = null;
  if (meta.overall) {
    const missing = players.filter(p => !Number.isInteger(p.overall));
    if (missing.length) throw new Error(`${year}: no overall for ${missing.slice(0, 5).map(p => p.name).join(', ')}`);
  } else {
    const reference = {};
    for (const player of players) player.score = scoreOf(player.group, fit.weights, player.attributes);
    for (const position of POSITIONS) {
      const at = players.filter(p => p.position === position);
      const { overall, reference: madden } = positionOveralls(at, clubs, fit.madden, position);
      for (const player of at) player.overall = overall.get(player.score);
      reference[position] = { players: at.length, perClub: Math.round(at.length / clubs * 100) / 100, madden };
    }
    conversion = {
      overall: `Ours, not the game's: Madden NFL ${edition === 1999 ? '99' : edition} kept its players' attributes but no overall. Each player's attributes are weighted as Madden NFL 2001's overall weights them (least squares on its EA overall, by group: ${Object.entries(ATTRIBUTES).map(([group, names]) => `${group} ${names.join(' ')}`).join('; ')}), ranked among the season's players at his game position (mid-rank percentile, ties sharing one) and read off Madden NFL 2002's overalls at that position (the 2001 season: maddenratings.net's 31 team spreadsheets, punters left out), as many of each Madden team's best as the season carries per club, by linear interpolation; rounded and held to 1–99. A generic defensive back (DB) plays safety where nflverse lists him at safety that season, else corner.`,
      fit: { edition: 'Madden NFL 2001', site: SITE, clubs: fit.clubs, players: fit.players, groups: fit.quality },
      attributes: ATTRIBUTES,
      weights: fit.weights,
      reference: { game: 'Madden NFL 2002', season: 2001, positions: reference },
    };
  }

  // The clubs as they were that season, and their lineups.
  const eraOf = new Map(teams.map(team => [team.franchise, { era: team.id, name: team.name, code: team.code }]));
  const gaps = {}, strength = {};
  for (const team of teams) {
    const pool = players.filter(p => p.franchise === team.franchise).map(p => ({ name: p.name, pos: p.position, rating: p.overall }));
    const documented = GAPS[year]?.[team.franchise] ?? {};
    const short = shortOf(pool);
    if (JSON.stringify(Object.entries(short).sort()) !== JSON.stringify(Object.entries(documented).sort())) {
      throw new Error(`${year} ${team.name} is short of ${JSON.stringify(short)}; GAPS documents ${JSON.stringify(documented)}`);
    }
    if (Object.keys(short).length) gaps[team.franchise] = short;
    const { str } = squadOf(pool, `${year} ${team.name}`, { gaps: documented });
    strength[team.franchise] = str;
  }

  // The checks.
  const mr = await maddenratings(edition, franchises);
  const rated = teams.filter(team => mr.overall[team.franchise] !== undefined);
  const checks = [];
  checks.push({ name: `maddenratings.net's ${meta.edition} team overalls`, url: `https://www.maddenratings.net/${MR_PAGE[edition].replace('.html', '')}.html`,
    clubs: rated.length, spearman: spearman(rated.map(t => strength[t.franchise]), rated.map(t => mr.overall[t.franchise])),
    about: 'Spearman\'s rank correlation between each club\'s strength here (its lineup rating) and the team overall maddenratings.net lists for it.' });
  const ranked = position => players.filter(p => p.position === position).sort((a, b) => (b.score ?? b.overall) - (a.score ?? a.overall) || a.name.localeCompare(b.name));
  checks.push({ name: `maddenratings.net's ${meta.edition} 99 and 100 overall clubs`, players: mr.clubs.map(({ pos, name }) => {
    const player = players.find(p => plain(p.name) === plain(name));
    if (!player) return `${pos} ${name}: not on a club here`;
    const list = ranked(player.position);
    return `${pos} ${name}: ${list.indexOf(player) + 1} of ${list.length} at ${player.position} (${player.overall})`;
  }) });
  const inRoster = players.filter(p => (nflverse.get(p.franchise) ?? []).some(r => r.plain === plain(p.name)));
  checks.push({ name: `nflverse's ${year} rosters`, players: players.length, sameClub: inRoster.length,
    about: 'Players nflverse lists on the same club that season under the same name (accents, case, punctuation and suffixes aside).' });
  checks.push({ name: 'the position lists against the team pages', compared: listChecks.compared, identical: listChecks.identical,
    differences: listChecks.differences, notListed: listChecks.notListed.length, notListedExamples: listChecks.notListed.slice(0, EXAMPLES),
    about: 'Every player of a team page the lists also carry, every value both show. The lists leave out players with some position labels (LLB, RLB, LT/RT): those come from the team pages, except for the three clubs whose team pages are empty.' });
  const dbs = players.filter(p => p.rule);
  const files = [...cache.keys()].filter(file => file.includes(`/${edition}/`) || file.includes(`madden-year-${edition}-`) || file.includes('/players/')
    || file === `${NFLVERSE}/roster_${year}.csv` || file === `${MR}/${MR_PAGE[edition]}` || (!meta.overall && (file.startsWith(`${NDB}/${FIT_EDITION}/`))))
    .sort().map(file => [file, PINS[file]]);
  const sourceBlock = {
    edition: meta.edition, ndbEdition: edition, season: year, site: SITE, url: `${SITE}/madden/year/${edition}`, retrieved: source.retrieved,
    ratings: 'EA SPORTS (Madden NFL)', compiler: 'NFL Draft Buzz, Madden Ratings Database (June 2026): EA\'s ratings, its compilation; the players\' names its matcher\'s (name, team, position and jersey against Pro-Football-Reference ids)',
    clubs: teams.length, players: players.length,
    teamPages: teams.filter(t => !LIST_ONLY.has(t.franchise)).length, listOnly: teams.filter(t => LIST_ONLY.has(t.franchise)).map(t => t.name),
    files: Object.fromEntries(files),
    defensiveBacks: { generic: dbs.length, safeties: dbs.filter(p => p.position === 'S').length,
      rules: Object.fromEntries([...new Set(dbs.map(p => p.rule))].sort().map(rule => [rule, dbs.filter(p => p.rule === rule).length])) },
    left,
  };
  const order = new Map(teams.map((team, i) => [team.franchise, i]));
  players.sort((a, b) => order.get(a.franchise) - order.get(b.franchise) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
    || b.overall - a.overall || (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  const rowOf = p => [p.name, p.franchise, p.listed, p.position, p.overall, {
    ...(p.no != null ? { no: p.no } : {}), ...(p.score !== undefined ? { score: p.score } : {}), from: p.from, attributes: p.attributes }];
  const head = {
    note: `${meta.edition} rates the ${year} NFL season. Every player of its ${teams.length} clubs but the punters and long snappers, as NFL Draft Buzz's copy of EA's data lists them: [name, franchise (scripts/data/nfl-teams.json), the site's position, game position, overall, { no: jersey, score, from: team page or list, attributes }], written by scripts/sync-madden-early.mjs.${meta.overall ? ' The overall is EA\'s.' : ' The overall is ours, not the game\'s (conversion).'}`,
    source: sourceBlock, ...(conversion ? { conversion } : {}), checks,
    teams: Object.fromEntries([...eraOf]), lineup: { needs: FORMATION, gaps },
  };
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const list = (key, items) => `  ${JSON.stringify(key)}: [${items.length ? `\n${items.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ` : ''}]`;
  return { text: `{\n${[...lines, list('players', players.map(rowOf))].join(',\n')}\n}\n`, players, checks, strength, teams };
}

/** The weights, fitted once on Madden NFL 2001's team pages. */
async function fitOf(manifest, franchises) {
  const teams = teamsOf(franchises, manifest, EDITIONS[FIT_EDITION].season).filter(team => !LIST_ONLY.has(team.franchise));
  const players = [];
  for (const team of teams) {
    const slug = Object.keys(FRANCHISE_OF_SLUG).find(key => FRANCHISE_OF_SLUG[key] === team.franchise);
    const page = parseTeamPage(await pinned(`${NDB}/${FIT_EDITION}/${slug}.html`));
    for (const row of page.rows) {
      const position = positionOf(row.listed);
      // A generic defensive back is left out of the fit: the corners and safeties fit their own weights.
      if (!position || position === 'P' || position === 'LS') continue;
      players.push({ group: groupOf(position, row.listed), overall: row.overall, attributes: normaliseAttributes(row.attributes) });
    }
  }
  const { weights, quality } = fitWeights(players);
  const madden = maddenReferencePlayers(JSON.parse(await readFile(path.join(root, 'scripts/data/madden-seasons/2001.json'), 'utf8')));
  return { weights, quality, madden, clubs: teams.length, players: players.length };
}

async function writePins() {
  const files = {};
  const walk = async dir => {
    for (const entry of await readdir(path.join(dataSrc, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.name.endsWith('.html')) files[rel] = sha256(await readFile(path.join(dataSrc, rel)));
    }
  };
  await walk(NDB);
  for (const season of [1998, 1999, 2000]) files[`${NFLVERSE}/roster_${season}.csv`] = sha256(await readFile(path.join(dataSrc, NFLVERSE, `roster_${season}.csv`)));
  for (const page of Object.values(MR_PAGE)) files[`${MR}/${page}`] = sha256(await readFile(path.join(dataSrc, MR, page)));
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const doc = {
    note: 'The inputs of npm run sync:madden-early, by their path under the gitignored data-src/, each by its SHA-256: NFL Draft Buzz\'s Madden Ratings Database pages (https://www.nfldraftbuzz.com/madden; team pages, position lists and the few player pages read, saved with curl one request every 8 s on 2026-11-09; robots.txt carries only a Sitemap line; the site states no terms of use), nflverse\'s rosters (CC-BY 4.0) and maddenratings.net\'s edition pages (the checks).',
    files: sorted,
  };
  await writeFile(pinsFile, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`Pinned ${Object.keys(sorted).length} files in ${path.relative(root, pinsFile)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const only = args.find(arg => arg.startsWith('--season='))?.slice('--season='.length);
  const unknown = args.filter(arg => arg !== '--check' && arg !== '--pin' && !arg.startsWith('--season='));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  if (args.includes('--pin')) return writePins();
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-seasons.json'), 'utf8'));
  const franchises = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-teams.json'), 'utf8')).teams;
  const years = manifest.seasons.filter(year => manifest.sources[year]?.kind === 'ndb' && (!only || String(year) === only));
  if (!years.length) throw new Error(`No NFL Draft Buzz season ${only ?? ''}`);
  const fit = await fitOf(manifest, franchises);
  const differs = [];
  for (const year of years) {
    const { text, players, checks } = await snapshotOf(year, manifest, franchises, fit);
    const file = path.join(outDir, `${year}.json`);
    console.log(`${year} ${manifest.sources[year].edition}: ${players.length} players; ${checks.map(c => `${c.name}: ${c.spearman ?? c.sameClub ?? c.identical ?? ''}`).join('; ')}`);
    if (checkOnly) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    } else {
      await mkdir(outDir, { recursive: true });
      await writeFile(file, text);
    }
  }
  if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
  console.log(checkOnly ? `Verified ${years.length} Madden NFL 99–2001 snapshots byte for byte.` : `Wrote ${years.length} snapshots to ${path.relative(root, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
}
