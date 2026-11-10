// NHL 22 (2021/22) from NHLRatings.net, a fan site that lists EA's ratings club by club without naming a source: its
// 32 team pages as CommonCrawl captured them between January and May 2022, still EA's launch rosters and ratings. EA's
// own launch lists (ratings-api.ea.com v2, its top 50 and its top ten at each position) check them: every player both
// rate, the site has at EA's overall. No I/O here: scripts/sync-nhl-seasons.mjs reads the pinned files.
import { nhlRosterPlayers, norm, teamsOf } from './nhl-seasons.mjs';

const decode = text => text
  .replace(/&#0*39;|&#x27;|&apos;|&#8217;/gi, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ');
const clean = text => decode(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * One NHLRatings.net team page of the NHL 22 layout → `{ title, edition, rows }`, a row per rated player `{ name,
 * positions, overall, overallText, overallClass, nationality, nhlId }`: the overall as the page writes it and the value
 * its box's class carries (they must agree), the nationality the flag's caption, the NHL id the photo's file name. The
 * players whose ratings the page says are unavailable ("--") are not rows.
 */
export function parseTeamPage(html) {
  const title = clean(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const edition = title.match(/\bNHL (\d{2})\b/)?.[1] ?? null;
  const rows = [];
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    if (!/<th[^>]*>Player<\/th>/.test(table[0])) continue;
    for (const tr of table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      if (!/class="counter"/.test(tr[1])) continue;
      const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
      if (cells.length < 3) continue;
      const player = cells[1];
      const name = decode(player.match(/<span class="entry-font[^"]*">\s*<a [^>]*title="([^"]*)"/)?.[1]
        ?? player.match(/<img [^>]*class="position-relative entry-photo[^"]*"[^>]*alt="([^"]*)"/)?.[1] ?? '').trim();
      const photo = (player.match(/data-src="([^"]*\/uploads\/[^"]+)"/)?.[1] ?? '').split('/').pop();
      const nhlId = Number(photo.match(/^(8[45]\d{5})(?:@3x-480x480|-80x80)\.png$/)?.[1]) || null;
      const subtext = player.slice(player.indexOf('entry-subtext-font'));
      const bar = subtext.indexOf('|');
      const positions = [...subtext.slice(0, bar >= 0 ? bar : undefined).matchAll(/<a href="\/lists\/[^"]*" title="[^"]*">([^<]*)<\/a>/g)].map(m => m[1].trim());
      const flag = player.match(/<div class="all-star-badge-list">\s*<img [^>]*src="[^"]*\/[a-z]{2}(?:-[a-z]+)?\.svg"[^>]*alt="([^"]*)"/);
      const overallText = clean(cells[2]);
      const overall = /^\d+$/.test(overallText) ? Number(overallText) : null;
      if (overall === null) continue;
      rows.push({ name, positions, overall, overallText, overallClass: cells[2].match(/class="(\d+(?:\.\d+)?) attribute-box/)?.[1] ?? null,
        nationality: flag ? decode(flag[1]).trim() : null, nhlId });
    }
  }
  return { title, edition, rows };
}

// The site's positions (EA's) and EA's lists' position labels, as the game's.
const SITE_POSITION = { C: 'C', LW: 'LW', RW: 'RW', LD: 'D', RD: 'D', D: 'D', G: 'G' };
const EA_POSITION = { Center: 'C', 'Left Wing': 'LW', 'Right Wing': 'RW', 'Left Defense': 'D', 'Right Defense': 'D', Defense: 'D', Defenseman: 'D', Goalie: 'G' };
/** EA's and the site's nationality names, as the NHL's country codes (ISO 3166 alpha-3). */
const NATION_CODE = { Austria: 'AUT', Belarus: 'BLR', Canada: 'CAN', Czechia: 'CZE', 'Czech Republic': 'CZE', Denmark: 'DNK', Finland: 'FIN', France: 'FRA',
  Germany: 'DEU', 'Great Britain': 'GBR', Italy: 'ITA', Kazakhstan: 'KAZ', Latvia: 'LVA', Lithuania: 'LTU', Netherlands: 'NLD', Norway: 'NOR',
  Russia: 'RUS', 'Russian Federation': 'RUS', Slovakia: 'SVK', Slovenia: 'SVN', Sweden: 'SWE', Switzerland: 'CHE', Ukraine: 'UKR',
  'United Kingdom': 'GBR', 'United States': 'USA', USA: 'USA', Australia: 'AUS', Bulgaria: 'BGR', Japan: 'JPN', Poland: 'POL', Brazil: 'BRA' };
const groupOf = pos => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');

/**
 * NHL 22's players: `{ players, left, notes }` as scripts/sync-nhl-seasons.mjs snapshots them. `season.files`: `pages`
 * (club code → the team page), `ea` (EA's launch lists); the NHL's 2021/22 rosters give positions and birth countries.
 */
export async function assembleNhlRatings(season, { text, json, manifest }) {
  const left = [], notes = { pages: [], typos: [], positionFromSite: [], addedFromEA: [], loose: [], eaCheck: null, nation: null };
  // The NHL's players of the season, by id and by name.
  const nhl = new Map();
  for (const code of Object.keys(season.files.pages)) {
    for (const player of nhlRosterPlayers(await json(`nhl-api/roster-${code}-${season.api}.json`), code)) if (!nhl.has(player.id)) nhl.set(player.id, player);
  }
  const byName = new Map();
  for (const player of nhl.values()) byName.set(norm(player.name), [...(byName.get(norm(player.name)) ?? []), player]);
  // EA's launch lists: one row per player (the first list that names him).
  const ea = new Map();
  for (const file of season.files.ea) {
    for (const doc of (await json(file)).docs) {
      const key = norm(`${doc.firstName} ${doc.lastName}`);
      if (!ea.has(key)) ea.set(key, { name: `${doc.firstName} ${doc.lastName}`.trim(), overall: doc.overall_rating, team: doc.team, pos: EA_POSITION[doc.position], nation: doc.nationalityId, list: file });
    }
  }
  const players = [], seen = new Set();
  let eaNations = 0, birth = 0, siteFlags = 0;
  const nationOf = (player, row) => {
    const fromEa = ea.get(norm(player?.name ?? row.name)) ?? ea.get(norm(row.name));
    if (fromEa?.nation) {
      if (!NATION_CODE[fromEa.nation]) throw new Error(`No code for EA's nationality ${fromEa.nation} (${fromEa.name})`);
      eaNations++;
      return NATION_CODE[fromEa.nation];
    }
    if (player?.born) { birth++; return player.born; }
    const flag = NATION_CODE[row.nationality];
    if (flag) siteFlags++;
    return flag ?? null;
  };
  for (const [code, file] of Object.entries(season.files.pages)) {
    const page = parseTeamPage(await text(file));
    if (page.edition !== season.titleEdition) throw new Error(`${file} is titled ${page.title}`);
    notes.pages.push(`${code}: ${page.rows.length} rated`);
    const onPage = new Map();
    for (const row of page.rows) {
      // An overall the page's own box does not carry is a typo (NHL 24 has an 801): left out.
      if (!(row.overall >= 1 && row.overall <= 99 && Number(row.overallClass) === row.overall)) {
        notes.typos.push(`${row.name} (${code}): ${row.overallText}`); left.push([row.name, code, `the page's overall ${row.overallText} is no rating`]); continue;
      }
      const key = norm(row.name);
      if (onPage.has(key)) {
        if (onPage.get(key).overall !== row.overall) throw new Error(`${row.name} is on ${code}'s page twice with two overalls`);
        continue;
      }
      onPage.set(key, row);
      // The NHL's player: by the id in the photo's name, else by name (on the club when two share it).
      let player = row.nhlId ? nhl.get(row.nhlId) : null;
      if (!player) {
        const named = byName.get(key) ?? [];
        player = named.length === 1 ? named[0] : named.find(p => p.team === code) ?? null;
        if (player) notes.loose.push(`${row.name} (${code}) = ${player.name} (${player.team}): name`);
      }
      const sitePos = SITE_POSITION[row.positions[0]];
      if (!sitePos) throw new Error(`${row.name} (${code}): no position in ${JSON.stringify(row.positions)}`);
      if (player && (player.pos === 'G') !== (sitePos === 'G')) throw new Error(`${row.name} (${code}): the site and the NHL disagree on goalie`);
      // A player the NHL's 2021/22 rosters do not name (hurt all season, retired) keeps EA's position.
      if (!player) notes.positionFromSite.push(`${row.name} (${code}): ${row.positions.join('/')}`);
      const id = player?.id ?? null;
      if (id !== null && seen.has(id)) throw new Error(`${row.name} is on two clubs' pages`);
      if (id !== null) seen.add(id);
      players.push([player?.name ?? row.name, code, player?.pos ?? sitePos, row.overall, nationOf(player, row), id]);
    }
  }
  // A player EA's own launch lists rate on a club whose page leaves him out (Crosby and Malkin, hurt at launch) plays for
  // that club at EA's overall; a free agent in EA's lists (Rask) is on no club.
  // EA and the site spell some names apart (Mitchell and Mitch Marner): a player of EA's club with EA's surname and first
  // initial is the same player.
  const surnameOf = name => norm(name).split(' ').slice(1).join(' ');
  const rowOf = (entry, code) => players.find(p => norm(p[0]) === norm(entry.name))
    ?? players.find(p => p[1] === code && surnameOf(p[0]) === surnameOf(entry.name) && norm(p[0])[0] === norm(entry.name)[0]);
  const listed = new Set(players.map(p => norm(p[0])));
  for (const entry of ea.values()) {
    const key = norm(entry.name);
    const code = teamsOf(manifest, season.year).find(team => team.name === entry.team)?.code ?? null;
    if (listed.has(key) || rowOf(entry, code)) continue;
    if (!code) { left.push([entry.name, entry.team || 'none', "a free agent in EA's launch lists"]); continue; }
    const named = (byName.get(key) ?? []).filter(p => groupOf(p.pos) === groupOf(entry.pos));
    const player = named.length === 1 ? named[0] : named.find(p => p.team === code) ?? null;
    players.push([player?.name ?? entry.name, code, player?.pos ?? entry.pos, entry.overall, nationOf(player, { name: entry.name }), player?.id ?? null]);
    notes.addedFromEA.push(`${entry.name} (${code}): EA ${entry.overall}`);
    listed.add(key);
  }
  // The check: every player EA's lists rate, at the site's overall.
  let compared = 0, equal = 0;
  const mismatches = [];
  for (const entry of ea.values()) {
    if (notes.addedFromEA.some(a => a.startsWith(`${entry.name} (`))) continue;
    const row = rowOf(entry, teamsOf(manifest, season.year).find(team => team.name === entry.team)?.code ?? null);
    if (!row) continue;
    compared++;
    if (row[3] === entry.overall) equal++; else mismatches.push(`${entry.name}: site ${row[3]}, EA ${entry.overall}`);
  }
  notes.eaCheck = { listed: ea.size, compared, equal, mismatches };
  notes.nation = { ea: eaNations, birth, siteFlag: siteFlags };
  return { players, left, notes };
}
