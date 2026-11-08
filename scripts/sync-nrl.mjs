// Snapshot rugby league's players: Big Ant's Rugby League 26 rating of every NRL player, as Zero Tackle listed them on
// the game's release (17 July 2025), each player's position, birthplace and Test eligibility from his Zero Tackle
// profile, and from NRL.com's match centre the 2025 season's team lists (where each player started) and its Tests (whom
// he played for). Every response is cached in the ignored data-src/nrl/, so a rerun reads the cache instead of the
// sites; only the snapshot is committed.
//
// The same match centre gives every NRL game of the regular seasons 2021–2025, which the sync sums into the real
// league's figures the match model is checked against (scripts/simulation-realism.mjs, REAL.nrl): `--seasons` prints them.
//
// Usage: node scripts/sync-nrl.mjs [--refresh] [--seasons]
//   --refresh  download everything again
//   --seasons  also print each regular season's scoring, margins and standings
// Output: scripts/data/rugby-league-26.json (committed), read by scripts/build-rugby-league.mjs.
//
// A snapshot row is [Zero Tackle slug, name, club, rating, position, other positions started in 2025, birthplace,
// eligibility, 2025 Test nation, NRL.com player id, goals, field goals]: the club the game lists him at, Rugby League
// 26's overall, Zero Tackle's position, every other position he started at least twice in the 2025 NRL season, Zero
// Tackle's place of birth and the nations and states he is eligible for, the nation he played a Test for in 2025 (null
// if none), his NRL.com id (null for one who played no NRL game in 2025), and the goals (conversions and penalty goals)
// and field goals he kicked in the 2025 NRL season.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/nrl');
const output = path.join(root, 'scripts/data/rugby-league-26.json');
const RATINGS = 'https://www.zerotackle.com/rugby-league-26-every-nrl-players-rating-224314/';
const ZT = 'https://www.zerotackle.com';
const NRL = 'https://www.nrl.com';
const PREMIERSHIP = 111, INTERNATIONALS = 133, PACIFIC = 195;
const RATED_SEASON = 2025;
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const PAUSE_MS = 250, PARALLEL = 4;
const UA = 'Mozilla/5.0 (compatible; imperialism-game data sync)';

// The list's own links, where one goes astray: Manly's Nathan Brown links to the coach of that name, Sione Katoa and
// Daine Laurie to retired namesakes (a hooker born in 1995, a prop born in 1984), and Clint Gutherson's profile has moved
// to his full name. Zero Tackle's index of current players (the player pages' own menu) has the right ones.
const SLUG_FIXES = { 'nathan-brown-coach': 'nathan-brown', 'clint-gutherson': 'clinton-gutherson', 'sione-katoa': 'sione-katoa-2',
  'daine-laurie-2': 'daine-laurie' };
// A position a player started at this often in the rated season leads Zero Tackle's, which is the player's position today.
const STARTS_TO_LEAD = 3;
// Zero Tackle's positions, and NRL.com's (the match centre's team lists), as the game's codes.
const POSITION_OF = {
  Fullback: 'FB', Winger: 'WG', Wing: 'WG', Centre: 'CE', 'Five-Eighth': 'FE', 'Five-eighth': 'FE', 'Five Eighth': 'FE',
  Halfback: 'HB', Prop: 'PR', Hooker: 'HK', '2nd Row': 'SR', 'Second Row': 'SR', 'Second-Row': 'SR', 'Second-row': 'SR', Lock: 'LK',
};
// The Test sides of 2025 on NRL.com, by the name the match centre gives them. A prime minister's XIII is no Test.
const TEST_SIDES = {
  Kangaroos: 'Australia', England: 'England', Kiwis: 'New Zealand', 'Toa Samoa': 'Samoa', 'Tonga XIII': 'Tonga',
  'PNG Kumuls': 'Papua New Guinea', 'Fiji Bati': 'Fiji', 'Cook Islands Aitu': 'Cook Islands', Rhinos: 'South Africa',
};
// The list's club headings → NRL.com's nicknames.
const NICKNAME_OF = {
  'Brisbane Broncos': 'Broncos', 'Canberra Raiders': 'Raiders', 'Canterbury Bulldogs': 'Bulldogs', 'Cronulla Sharks': 'Sharks',
  'Gold Coast Titans': 'Titans', 'Manly Sea Eagles': 'Sea Eagles', 'Melbourne Storm': 'Storm', 'Newcastle Knights': 'Knights',
  'New Zealand Warriors': 'Warriors', 'North Queensland Cowboys': 'Cowboys', 'Parramatta Eels': 'Eels', 'Penrith Panthers': 'Panthers',
  'South Sydney Rabbitohs': 'Rabbitohs', 'St George Illawarra Dragons': 'Dragons', 'Sydney Roosters': 'Roosters', 'The Dolphins': 'Dolphins',
  'Wests Tigers': 'Wests Tigers',
};

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--refresh' && arg !== '--seasons');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const refresh = args.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One response's body, from the cache unless `refresh`; `keep` trims it to what is cached. */
async function fetched(file, url, { json = true, keep = body => body } = {}) {
  const at = path.join(cacheDir, file);
  if (!refresh && existsSync(at)) return JSON.parse(await readFile(at, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = keep(json ? await response.json() : await response.text());
      const result = { url, fetchedAt: new Date().toISOString(), body };
      await mkdir(path.dirname(at), { recursive: true });
      await writeFile(at, JSON.stringify(result));
      await sleep(PAUSE_MS);
      return result;
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * 8 * (attempt + 1));
    }
  }
}

/** Run `task` over `items`, PARALLEL at a time, keeping their order. */
async function inParallel(items, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

const decode = text => text.replace(/&#8217;|&#039;|&#39;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#8211;/g, '–').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'");
const plain = html => decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
// Names compared without accents, apostrophes, hyphens or case: Olakau'atu, Olakauatu.
const norm = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`.]/g, '')
  .replace(/[^a-z]+/g, ' ').trim();

await mkdir(cacheDir, { recursive: true });

// ---------- Rugby League 26's ratings ----------

const { body: article, fetchedAt: listedAt } = await fetched('ratings.json', RATINGS, {
  json: false,
  // The article itself, from its first club heading to the end of its list.
  keep: html => html.slice(html.indexOf('<h3>Brisbane Broncos</h3>'), html.indexOf('</div>', html.indexOf('<h3>Wests Tigers</h3>'))),
});
const published = '2025-07-17';
const rated = [];
for (const section of article.split('<h3>').slice(1)) {
  const club = decode(section.slice(0, section.indexOf('</h3>')).trim());
  if (!NICKNAME_OF[club]) throw new Error(`Unknown club heading "${club}"`);
  for (const line of section.slice(section.indexOf('</h3>') + 5).split(/<br\s*\/?>|<\/p>/)) {
    const text = plain(line).trim();
    const match = /^(.+?)\s+[-–]\s+(\d{2})$/.exec(text);
    if (!match) continue;
    const link = /href="https:\/\/www\.zerotackle\.com\/(?:players|coaches)\/([a-z0-9-]+)\/"/.exec(line)?.[1];
    const slug = SLUG_FIXES[link] || link || norm(match[1]).replace(/ /g, '-');
    rated.push({ slug, name: match[1].trim(), club, rating: Number(match[2]) });
  }
}
const slugs = new Set(rated.map(player => player.slug));
if (rated.length < 590 || new Set(rated.map(player => player.club)).size !== 17) throw new Error(`Expected about 597 players at 17 clubs; got ${rated.length}`);
if (slugs.size !== rated.length) throw new Error(`Duplicated players: ${rated.filter((p, i) => rated.findIndex(q => q.slug === p.slug) !== i).map(p => p.slug)}`);
console.log(`Rugby League 26: ${rated.length} players at 17 clubs, listed ${published} (fetched ${listedAt.slice(0, 10)})`);

// ---------- Zero Tackle's profiles ----------

/** The profile's facts: position, height and weight, date and place of birth, eligibility, as one line of text. */
function profileFacts(html) {
  const text = plain(html);
  const start = text.indexOf(' Position ');
  const end = text.indexOf('Player Contracts', start);
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] || '';
  return { title: decode(title), facts: start >= 0 ? text.slice(start, end > start ? end : start + 400).trim() : '' };
}
const profiles = await inParallel(rated, player => fetched(`zt/${player.slug}.json`, `${ZT}/players/${player.slug}/`, { json: false, keep: profileFacts })
  .catch(error => { console.log(`  no profile: ${error.message}`); return { body: { title: '', facts: '' } }; }));
const field = (facts, label, next) => {
  const at = facts.indexOf(`${label} `);
  if (at < 0) return null;
  const rest = facts.slice(at + label.length + 1);
  const stop = next.map(word => rest.indexOf(` ${word}`)).filter(i => i >= 0);
  return (stop.length ? rest.slice(0, Math.min(...stop)) : rest).trim() || null;
};
// The profile's labels, and the social handles that can follow the last of them.
const LABELS = ['Position', 'Weight', 'Height', 'Date of Birth', 'Eligibility', 'Place of Birth', 'Debut', 'Twitter', 'Instagram',
  'Facebook', 'TikTok', 'YouTube'];
for (const [i, player] of rated.entries()) {
  const { facts } = profiles[i].body;
  const position = field(facts, 'Position', LABELS);
  player.position = POSITION_OF[position] || null;
  player.listedPosition = position;
  player.birthplace = field(facts, 'Place of Birth', LABELS);
  player.eligibility = (field(facts, 'Eligibility', LABELS) || '').split(',').map(s => s.trim()).filter(Boolean);
}

// ---------- NRL.com: the 2025 season's team lists, the Tests, and the regular seasons 2021–2025 ----------

/** A match centre reply cut to what the snapshot and the season figures read. */
function matchKeep(body) {
  const team = side => ({
    id: side.teamId, nick: side.nickName, score: side.score,
    players: (side.players || []).map(p => [p.playerId, `${p.firstName} ${p.lastName}`, p.position, p.number]),
    scoring: side.scoring || null,
  });
  return {
    matchId: body.matchId, state: body.matchState, round: body.roundNumber, title: body.roundTitle, seconds: body.gameSeconds,
    extraTime: !!body.hasExtraTime, home: team(body.homeTeam), away: team(body.awayTeam),
    events: (body.timeline || []).filter(e => /Try|Goal|FieldGoal/i.test(e.type))
      .map(e => [e.type, e.title, e.gameSeconds, e.teamId, e.playerId ?? null]),
  };
}

/** Every finished game of a competition's season: the draw round by round, then each game's match centre. */
async function seasonGames(competition, season) {
  const { body: first } = await fetched(`draw/${competition}-${season}.json`, `${NRL}/draw/data?competition=${competition}&season=${season}`);
  const rounds = (first.filterRounds || []).map(round => round.value).sort((a, b) => a - b);
  const fixtures = [];
  if (!rounds.length) fixtures.push(...first.fixtures);
  for (const round of rounds) {
    const { body } = await fetched(`draw/${competition}-${season}-${round}.json`, `${NRL}/draw/data?competition=${competition}&season=${season}&round=${round}`);
    fixtures.push(...body.fixtures.map(fixture => ({ ...fixture, roundValue: round, roundName: (first.filterRounds.find(r => r.value === round) || {}).name })));
  }
  const played = fixtures.filter(f => f.type === 'Match' && f.matchState === 'FullTime' && f.matchCentreUrl);
  const games = await inParallel(played, fixture => {
    const file = `match/${fixture.matchCentreUrl.replace(/^\/draw\//, '').replace(/\/$/, '').replace(/\//g, '_')}.json`;
    return fetched(file, `${NRL}${fixture.matchCentreUrl}data`, { keep: matchKeep });
  });
  // The draw's score is the result; a few match centre replies have no scoring (three 2021 games read 0-0).
  return games.map((game, i) => ({ ...game.body, roundName: played[i].roundTitle || played[i].roundName,
    result: [played[i].homeTeam.score, played[i].awayTeam.score] }));
}

const nrlSeasons = {};
for (const season of SEASONS) nrlSeasons[season] = await seasonGames(PREMIERSHIP, season);
const tests = [...await seasonGames(INTERNATIONALS, RATED_SEASON), ...await seasonGames(PACIFIC, RATED_SEASON)]
  .filter(game => TEST_SIDES[game.home.nick] && TEST_SIDES[game.away.nick]);
console.log(`NRL.com: ${SEASONS.map(s => `${s} ${nrlSeasons[s].length}`).join(', ')} games; ${tests.length} Tests in ${RATED_SEASON}`);

// Who played where in 2025: NRL.com's id → name, the clubs he played for, the positions he started at, and the goals
// (conversions and penalty goals) and field goals he kicked.
const seen = new Map();
const kicks = new Map();
for (const game of nrlSeasons[RATED_SEASON]) {
  for (const [type, title, , , playerId] of game.events) {
    if (playerId == null || /miss/i.test(type) || /miss/i.test(title)) continue;
    const kind = type === 'Goal' ? 'goals' : /FieldGoal/i.test(type) ? 'fieldGoals' : null;
    if (!kind) continue;
    const tally = kicks.get(playerId) || { goals: 0, fieldGoals: 0 };
    tally[kind]++;
    kicks.set(playerId, tally);
  }
  for (const side of [game.home, game.away]) {
    for (const [id, name, position, number] of side.players) {
      const entry = seen.get(id) || { id, name, clubs: new Map(), starts: new Map() };
      entry.clubs.set(side.nick, (entry.clubs.get(side.nick) || 0) + 1);
      const code = POSITION_OF[position];
      // The thirteen starters wear 1 to 13; the bench's positions say "Interchange".
      if (code && number <= 13) entry.starts.set(code, (entry.starts.get(code) || 0) + 1);
      seen.set(id, entry);
    }
  }
}
const testNation = new Map();
for (const game of tests) {
  for (const side of [game.home, game.away]) for (const [id, name] of side.players) testNation.set(id, { nation: TEST_SIDES[side.nick], name });
}

// ---------- each rated player's NRL.com id ----------

const byName = new Map();
for (const entry of seen.values()) byName.set(norm(entry.name), [...(byName.get(norm(entry.name)) || []), entry]);
// Names spelt otherwise on NRL.com (a shortened first name, say): the list's spelling → NRL.com's.
const NAME_FIXES = {};
const unmatched = [];
for (const player of rated) {
  const key = norm(NAME_FIXES[player.name] || player.name);
  let candidates = byName.get(key) || [];
  if (!candidates.length) {
    // The same surname at the same club, with a first name that starts the same way (Sam, Samuel).
    const parts = key.split(' ');
    candidates = [...seen.values()].filter(entry => {
      const other = norm(entry.name).split(' ');
      return other.slice(1).join(' ') === parts.slice(1).join(' ') && entry.clubs.has(NICKNAME_OF[player.club])
        && (other[0].startsWith(parts[0].slice(0, 3)) || parts[0].startsWith(other[0].slice(0, 3)));
    });
  }
  const atClub = candidates.filter(entry => entry.clubs.has(NICKNAME_OF[player.club]));
  const entry = atClub.length === 1 ? atClub[0] : candidates.length === 1 ? candidates[0] : null;
  if (!entry) { unmatched.push(`${player.name} (${player.club})${candidates.length > 1 ? ` — ${candidates.length} namesakes` : ''}`); continue; }
  player.nrlId = entry.id;
  if (norm(entry.name) !== norm(player.name)) console.log(`  matched loosely: ${player.name} = ${entry.name} (${player.club})`);
}
console.log(`${rated.length - unmatched.length} players matched to NRL.com's 2025 team lists; ${unmatched.length} played no NRL game in 2025:`);
for (const line of unmatched) console.log(`  ${line}`);

// ---------- the snapshot ----------

const allRows = rated.map(player => {
  const entry = player.nrlId ? seen.get(player.nrlId) : null;
  // The game plays the 2025 season: the place a player started at most that season leads, if he started there at least
  // three times; else Zero Tackle's. Every other place he started twice or more, and Zero Tackle's, are his too.
  const starts = entry ? [...entry.starts.entries()].sort((a, b) => b[1] - a[1]) : [];
  const led = starts[0] && starts[0][1] >= STARTS_TO_LEAD ? starts[0][0] : null;
  const position = led || player.position || starts[0]?.[0] || null;
  const others = [...new Set([...starts.filter(([, n]) => n >= 2).map(([code]) => code), player.position])]
    .filter(code => code && code !== position);
  const test = player.nrlId ? testNation.get(player.nrlId)?.nation ?? null : null;
  const kicked = (player.nrlId && kicks.get(player.nrlId)) || { goals: 0, fieldGoals: 0 };
  return [player.slug, player.name, player.club, player.rating, position, others, player.birthplace, player.eligibility, test,
    player.nrlId ?? null, kicked.goals, kicked.fieldGoals];
});
// A player neither source places (no position on his profile, or no profile, and no NRL game in 2025) is left out: a
// position would have to be made up.
const unplaced = allRows.filter(row => !row[4]);
const rows = allRows.filter(row => row[4]);
if (unplaced.length) console.log(`Left out, with no position anywhere: ${unplaced.map(row => `${row[1]} (${row[2]})`).join(', ')}`);
const source = {
  game: 'Rugby League 26 (Big Ant Studios)',
  ratings: RATINGS,
  published,
  profiles: `${ZT}/players/<slug>/`,
  teamLists: `${NRL}/draw/ (match centre, the ${RATED_SEASON} NRL season and Tests)`,
  retrieved: listedAt.slice(0, 10),
  listed: allRows.length,
  unplaced: unplaced.map(row => row[1]),
  columns: ['slug', 'name', 'club', 'rating', 'position', 'positions', 'birthplace', 'eligibility', 'test', 'nrlId', 'goals',
    'fieldGoals'],
};
// One player a line, so a resync's diff reads player by player.
const sourceJson = JSON.stringify(source, null, 2).replace(/\n/g, '\n  ');
await writeFile(output, `{\n  "source": ${sourceJson},\n  "players": [\n${rows.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]\n}\n`);
console.log(`Wrote ${path.relative(root, output)}: ${rows.length} players, ${rows.filter(r => r[8]).length} with a 2025 Test`);

// ---------- the real league ----------

if (args.includes('--seasons')) {
  const { seasonFigures } = await import('./lib/nrl-seasons.mjs');
  for (const season of SEASONS) console.log(season, JSON.stringify(seasonFigures(nrlSeasons[season])));
}
