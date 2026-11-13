// A computed national-team season (docs/design/football-years.md, "Computed national-team seasons"): a season between
// two computed World Cups, every nation whose Wikidata records name eleven players of that season, each rated from its
// Elo on 1 July of the season's end year by the World Cup seasons' line, its XI the players with the most caps a year,
// ordered by Ballon d'Or votes and caps, in the data set format the game loads (src/engine/footballSets.js, kind 'nt').
// No I/O: scripts/build-national-team-seasons.mjs reads the committed facts (scripts/sync-national-team-seasons.mjs) and
// the manifest, and writes the files. Every constant is the manifest's; nothing is invented: every player is one of
// Wikidata's for his team that season, and his rating follows from the nation's Elo and the rule.
import { HISTORIC_NATIONS, HISTORIC_THROUGH, NATIONS, selectLineup } from '../../src/data/teams.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import {
  FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, dayNationResolver, identitiesFor, nationResolver, serializeFootballSet, territoryFor,
} from '../../src/data/footballSetBuild.js';
import { elevenRatings, seasonOfYear, strengthOf } from './world-cup-seasons.mjs';

/** A computed player's `source`, as his record names it. */
export const WIKIDATA_SOURCE = 'wikidata';
export const NATIONAL_TEAMS_LABEL = 'Computed · national teams';
const qidNumber = qid => Number(qid.slice(1));
const round2 = x => Math.round(x * 100) / 100;

/**
 * A stint's caps by the end of `year`: all of them once it has ended, none before it starts, else its share of the
 * years it has run, caps spread evenly over its years.
 */
export const capsBy = (from, to, caps, year) => (caps == null || year < from ? 0 : year >= to ? caps : caps * (year - from + 1) / (to - from + 1));

/** Whether a stint covers the season ending in `year`: how many of its two calendar years (0, 1 or 2). */
export const coverOf = (from, to, year) => [year - 1, year].filter(y => from <= y && y <= to).length;

/**
 * The season's pools, by game nation: every named player with a position and a stint covering year − 1 or year for a
 * team `nationOf` gives a nation (one taking part that season), each with his figure (the stint's caps a year, halved
 * when it covers one of the two years) and his caps for the nation by the end of the season (`total`, capsBy over all
 * his stints for its teams). A player in two nations' pools stays only in the one where his figure is higher (then the
 * later stint, then the lower team id); two teams of one nation (the Soviet Union and the CIS in 1991/92) share a pool.
 * → Map(nation → [{ qid, name, born, title, positions, team, from, to, caps, goals, ended, figure, total }])
 */
export function seasonPools({ players, stints }, year, nationOf) {
  const person = new Map(players.filter(([, name, , , positions]) => name && positions.length)
    .map(([qid, name, born, title, positions]) => [qid, { qid, name, born, title, positions }]));
  const totals = new Map();
  for (const [player, team, from, to, caps] of stints) {
    const nation = nationOf(team);
    if (nation) totals.set(`${player}|${nation}`, (totals.get(`${player}|${nation}`) || 0) + capsBy(from, to, caps, year));
  }
  const best = new Map(); // player → his entry of the season
  for (const [player, team, from, to, caps, goals, ended] of stints) {
    const nation = nationOf(team), cover = coverOf(from, to, year);
    if (!nation || !cover || !person.has(player)) continue;
    const figure = (caps ?? 0) / (to - from + 1) * cover / 2;
    const entry = { ...person.get(player), nation, team, from, to, caps, goals, ended, figure, total: totals.get(`${player}|${nation}`) };
    const held = best.get(player);
    if (!held || figure > held.figure || (figure === held.figure && (from > held.from || (from === held.from && qidNumber(team) < qidNumber(held.team))))) best.set(player, entry);
  }
  const pools = new Map();
  for (const entry of [...best.values()].sort((a, b) => qidNumber(a.qid) - qidNumber(b.qid))) {
    if (!pools.has(entry.nation)) pools.set(entry.nation, []);
    pools.get(entry.nation).push(entry);
  }
  return pools;
}

const byFigure = (a, b) => b.figure - a.figure || b.total - a.total || qidNumber(a.qid) - qidNumber(b.qid);

/**
 * The XI: for each role of `xi` ({ GK: 1, DF: 4, MF: 4, FW: 2 }) the pool's players of that position, the highest
 * figure first (then the most caps for the team by then, then the lower id); a role short of them takes the highest figures
 * left, whatever their positions. → { eleven: [{ ...player, role }], filled } (filled: those out of their positions).
 */
export function pickNationalEleven(pool, xi) {
  const picked = [], taken = new Set();
  for (const [role, count] of Object.entries(xi)) {
    for (const player of pool.filter(p => p.positions.includes(role) && !taken.has(p.qid)).sort(byFigure).slice(0, count)) {
      picked.push({ ...player, role });
      taken.add(player.qid);
    }
  }
  const short = Object.entries(xi).flatMap(([role, count]) => Array(count - picked.filter(p => p.role === role).length).fill(role));
  const filled = pool.filter(p => !taken.has(p.qid)).sort(byFigure).slice(0, short.length).map((player, i) => ({ ...player, role: short[i] }));
  if (picked.length + filled.length !== Object.values(xi).reduce((sum, n) => sum + n, 0)) throw new Error(`A pool of ${pool.length} cannot field an XI`);
  return { eleven: [...picked, ...filled], filled };
}

/** A player's Ballon d'Or points over the season's two years: `{ [year]: points }` of `votes` (year → Map(qid → points)). */
export const ballonDorOf = (qid, years, votes) => Object.fromEntries(years.map(y => [y, votes[y]?.get(qid) ?? 0]).filter(([, points]) => points > 0));
const sumOf = record => Object.values(record).reduce((sum, x) => sum + x, 0);

/** The XI strongest first: Ballon d'Or points, then caps for the team by the season's end, then the figure, then the lower id. */
export function orderNationalEleven(eleven) {
  return eleven.slice().sort((a, b) => sumOf(b.ballonDor) - sumOf(a.ballonDor) || b.total - a.total || b.figure - a.figure
    || qidNumber(a.qid) - qidNumber(b.qid));
}

/** The position a player is listed at: the role he fills, then his other positions; his own where he fills another's. */
export function listedPosition(player) {
  if (!player.positions.includes(player.role)) return player.positions.join('/');
  return [player.role, ...player.positions.filter(pos => pos !== player.role)].join('/');
}

/**
 * public/football/ATTRIBUTION-national-teams.txt: the licence of the season files and the credits their sources ask for,
 * naming every season's version and every Wikipedia revision read.
 */
export function nationalTeamsAttribution(manifest, docs) {
  const { wikidata, results, ballonDor } = manifest.sources;
  const pages = ballonDor.pages.map(page => `    ${page.title}, revision ${page.revision} (https://en.wikipedia.org/w/index.php?oldid=${page.revision})`).join('\n');
  return `Computed national-team seasons (public/football/nt-<year>.json)
Generated by scripts/build-national-team-seasons.mjs; do not edit.

Seasons: ${docs.map(doc => doc.version).join(', ')}

These files are licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0,
${ballonDor.licenceUrl}), as the Ballon d'Or tables they are partly derived from ask.
Their ratings are computed by this project, not a game's: each nation's strength from its Elo on 1 July of the
season's end year, its eleven the players of its Wikidata records with the most caps a year that season, ordered by
Ballon d'Or votes and caps (docs/design/football-years.md, "Computed national-team seasons";
scripts/data/national-team-seasons.json).

Wikidata (${wikidata.url}), ${wikidata.licence} (${wikidata.licenceUrl})
  Read through ${wikidata.endpoint} on ${manifest.retrieved}: ${wikidata.name}.
  Changes: each player's stints reduced to the seasons they cover and his caps a year; each team's players reduced to an
  eleven, ordered and given a computed rating.

Wikipedia (English), by its contributors, ${ballonDor.licence} (${ballonDor.licenceUrl})
  Ballon d'Or voting tables (the votes are France Football's):
${pages}
  Changes: the votes summed into points per player and year, and matched to the Wikidata players.

${results.name}
  ${results.url} (commit ${results.commit}), ${results.licence}
  Used: every men's full international to 1993, rated by the World Football Elo formula eloratings.net publishes.
`;
}

const plus = x => (x > 0 ? `+${x.toFixed(1)}` : x === 0 ? '0.0' : `−${(-x).toFixed(1)}`);

/** The rule as a season's source names it. */
export function nationalTeamsConversion(manifest, elo) {
  const { best, perHundredElo } = manifest.strength;
  const roles = Object.entries(manifest.xi).map(([role, count]) => `${count} ${role}`).join(', ');
  return `T = ${best} − ${perHundredElo} × (E_best − E) / 100, E the nation's Elo on ${elo.date} and E_best the best of the teams active in the `
    + `four years before (${elo.best.team}, ${elo.best.elo}); the XI (${roles}) the players of the nation's Wikidata stints covering the season `
    + 'with the most caps a year, ordered by Ballon d\'Or points and caps for the team by then; its k-th player T + D_k, '
    + `D = ${manifest.profile.map(plus).join(', ')}, rounded so the XI sums to round(11 × T)`;
}

/**
 * Build one season from the facts (`wikidata`: { teams, players, stints }; `elo`: the season's; `votes`: { [year]:
 * { points } }) and the manifest. Each Wikidata team plays as the game nation its country resolves to that year
 * (dayNationResolver: the Soviet Union, West Germany, Yugoslavia, Czechoslovakia and Zaire are their holders; the
 * manifest's `byYear` names a country's nation where Wikidata keeps one team across two federations); a team whose
 * country has no shape (East Germany, the manifest's `noTeam`) fields no team, nor does a shape the year merges or
 * leaves out, nor a nation with fewer than `least` players with a position, no goalkeeper, or no match in the four
 * years before. A country no game nation answers to stops the build when it has `least` players that season.
 * → { doc, text, audit }
 */
export function buildNationalTeamSeason({ wikidata, elo, votes }, manifest, season, { federations = FOOTBALL_FEDERATIONS } = {}) {
  const { year, id } = season;
  const { least } = manifest.selection;
  const { byYear = {}, ...nationNames } = manifest.names.nations;
  const dayResolve = dayNationResolver(nationResolver(nationNames), federations, year);
  // A country Wikidata keeps one team for across two federations (Yugoslavia; the Soviet Union, then the CIS) names
  // the later one in its years; a span with no nation is a team that did not play that season (`why`).
  const spanOf = country => byYear[country]?.find(entry => entry.from <= year && year <= entry.through);
  const resolve = country => {
    const id = spanOf(country) ? spanOf(country).nation : dayResolve(country);
    // A nation of the map's earlier years (East Germany, to 1990; South Vietnam, to 1975) has no shape after them.
    return HISTORIC_NATIONS.includes(id) && year > HISTORIC_THROUGH[id] ? NO_TEAM : id;
  };
  const plain = territoryFor(federations, year);
  const plainNames = identitiesFor(federations, year);
  const nameOf = nation => plainNames[nation]?.name ?? NATIONS[nation][0];
  const eloOf = new Map(elo.ratings.map(([team, value, rank]) => [team, { value, rank }]));
  const yearVotes = Object.fromEntries(season.ballonDor.map(y => [y, new Map(votes[y]?.points ?? [])]));
  if (season.ballonDor.some(y => !votes[y])) throw new Error(`${id}: no Ballon d'Or facts for ${season.ballonDor.join(', ')}`);

  // Each team's nation this season, or why it has none; then the pools of the nations that take part.
  const named = new Set(wikidata.players.filter(([, name, , , positions]) => name && positions.length).map(([qid]) => qid));
  const sizeOf = team => new Set(wikidata.stints.filter(([player, t, from, to]) => t === team && named.has(player) && coverOf(from, to, year)).map(([player]) => player)).size;
  const countryOf = new Map(wikidata.teams), teamNation = new Map(), dropped = [];
  for (const [team, country] of wikidata.teams) {
    const nation = resolve(country);
    const why = nation === NO_TEAM ? 'no shape on the map'
      : nation == null ? (spanOf(country)?.why ?? null)
        : Object.hasOwn(plain.merged, nation) ? `plays for ${nameOf(plain.merged[nation])} that season`
          : plain.inactive.includes(nation) ? 'takes no part that season' : '';
    if (!why) { if (nation) teamNation.set(team, nation); else if (sizeOf(team) >= least) throw new Error(`${id}: ${country} (${team}) has ${sizeOf(team)} players but no game nation; add it to the manifest's names`); continue; }
    const size = sizeOf(team);
    if (size) dropped.push({ team: country, qid: team, players: size, why });
  }
  const pools = seasonPools(wikidata, year, team => teamNation.get(team) ?? null);
  const entries = [];
  for (const nation of Object.keys(NATIONS)) {
    const pool = pools.get(nation);
    if (!pool) continue;
    const teams = [...new Set(pool.map(player => player.team))].sort((a, b) => qidNumber(a) - qidNumber(b));
    const countries = teams.map(team => countryOf.get(team));
    const results = [...new Set(countries.map(country => manifest.names.results[country] ?? country))];
    if (results.length !== 1) throw new Error(`${id}: ${countries.join(' and ')} are one nation but not one team in the results (${results.join(', ')})`);
    const why = pool.length < least ? `${pool.length} players with a position`
      : !pool.some(player => player.positions.includes('GK')) ? 'no goalkeeper'
        : !eloOf.has(results[0]) ? 'no full international in the four years before' : '';
    if (why) { dropped.push({ team: countries.join(' / '), qid: teams.join(' '), players: pool.length, why }); continue; }
    entries.push({ nation, team: teams.join(' '), country: countries.join(' / '), pool, elo: eloOf.get(results[0]) });
  }
  dropped.sort((a, b) => b.players - a.players || (a.team < b.team ? -1 : 1));
  const fielded = new Set(entries.map(entry => entry.nation));
  const fields = nation => fielded.has(nation);
  const territory = territoryFor(federations, year, { fields });
  const identities = identitiesFor(federations, year, { fields });
  const seasonName = seasonOfYear(year);
  const edition = `${seasonName} national team, computed`;

  const nations = {}, nationAudit = [];
  for (const nation of Object.keys(NATIONS).filter(fields)) {
    const entry = entries.find(e => e.nation === nation);
    const strength = strengthOf(entry.elo.value, elo.best.elo, manifest.strength);
    const { eleven, filled } = pickNationalEleven(entry.pool, manifest.xi);
    const order = orderNationalEleven(eleven.map(player => ({ ...player, ballonDor: ballonDorOf(player.qid, season.ballonDor, yearVotes) })));
    const ratings = elevenRatings(strength, manifest.profile);
    const names = order.map(player => player.name);
    const players = order.map((player, k) => {
      const shared = names.filter(name => name === player.name).length > 1;
      const name = shared ? `${player.name} (${player.born ? player.born.slice(0, 4) : player.qid})` : player.name;
      return [name, listedPosition(player), ratings[k], {
        id: `wd:${player.qid}`, source: WIKIDATA_SOURCE, edition, snapshotDate: elo.date,
        url: player.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(player.title.replace(/ /g, '_'))}` : `https://www.wikidata.org/wiki/${player.qid}`,
        team: countryOf.get(player.team), teamElo: entry.elo.value, xiRank: k + 1,
        ...(player.caps != null ? { caps: player.caps } : {}), ...(player.goals != null ? { goals: player.goals } : {}),
        from: player.from, to: player.to, ...(player.ended ? { toEstimated: true } : {}),
        ...(Object.keys(player.ballonDor).length ? { ballonDor: player.ballonDor } : {}),
        ...(player.born ? { dateOfBirth: player.born } : {}),
      }];
    });
    if (new Set(players.map(([name]) => name)).size !== players.length) throw new Error(`${id} ${entry.country}: two players of the XI share a name`);
    const lineup = selectLineup({ sport: 'football', squad: players.map(([name, listed, rating]) => {
      const [pos, ...others] = listed.split('/');
      return { name, pos, rating, ...(others.length ? { positions: [pos, ...others] } : {}) };
    }) });
    nations[nation] = [Math.round(lineup.rating), entry.pool.length, players];
    nationAudit.push({
      id: nation, name: identities[nation]?.name ?? NATIONS[nation][0], team: entry.country, qid: entry.team, elo: entry.elo.value, rank: entry.elo.rank,
      T: round2(strength), strength: nations[nation][0], pool: entry.pool.length,
      outOfPosition: lineup.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.player.name} (${slot.player.pos} as ${slot.position})`),
      filled: filled.map(player => `${player.name} (${player.positions.join('/')} as ${player.role})`),
      eleven: order.map((player, k) => `${players[k][0]} ${players[k][1]} ${ratings[k]}${sumOf(player.ballonDor) ? ` BdO ${sumOf(player.ballonDor)}` : ''}`
        + ` ${player.caps ?? '?'} caps ${player.from}–${player.to} (${round2(player.figure)})`),
    });
  }
  if (nationAudit.length < 2) throw new Error(`${id}: ${nationAudit.length} nations field a team`);
  const all = nationAudit.flatMap(entry => nations[entry.id][2].map(([, , rating]) => ({ T: entry.T, rating })));
  const meanOf = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const teamVariance = meanOf(all.map(x => x.T ** 2)) - meanOf(all.map(x => x.T)) ** 2;
  const withinVariance = meanOf(all.map(x => (x.rating - x.T) ** 2));
  const coverage = {
    players: all.length, nations: entries.length,
    completeXIs: nationAudit.filter(entry => !entry.outOfPosition.length).length, clubs: 0, leagues: 0,
  };
  const { wikidata: wd, results, ballonDor } = manifest.sources;
  const doc = {
    format: FOOTBALL_SET_FORMAT, kind: 'nt', id, version: '', year, season: seasonName, label: NATIONAL_TEAMS_LABEL, local: false,
    source: {
      provider: 'Computed', edition: `${seasonName} national teams, computed`, method: 'computed', computed: true, snapshotDate: elo.date,
      retrieved: manifest.retrieved, url: wd.url, rawScale: 'Elo', conversion: nationalTeamsConversion(manifest, elo),
      licence: manifest.licence, attribution: 'public/football/ATTRIBUTION-national-teams.txt',
      players: { name: 'Wikidata', endpoint: wd.endpoint, licence: wd.licence, files: Object.fromEntries(wd.files.map(file => [file.name, file.sha256])) },
      results: { name: results.name, commit: results.commit, licence: results.licence },
      wikipedia: { ballonDor: Object.fromEntries(season.ballonDor.map(y => [y, ballonDor.pages.find(page => page.title === `${y} Ballon d'Or`).revision])) },
    },
    nations, clubs: [], territory, ...(Object.keys(identities).length ? { identities } : {}), coverage,
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, elo: { date: elo.date, activeSince: elo.activeSince, active: elo.ratings.length, best: elo.best },
    teamShare: round2(teamVariance / (teamVariance + withinVariance)), dropped,
    identities, merged: Object.keys(territory.merged).length, inactive: territory.inactive.length,
    nations: nationAudit.sort((a, b) => b.T - a.T || (a.id < b.id ? -1 : 1)),
    unmatchedVotes: Object.fromEntries(season.ballonDor.map(y => [y, votes[y].unmatched])),
  };
  return { doc, text: serializeFootballSet(doc), audit };
}
