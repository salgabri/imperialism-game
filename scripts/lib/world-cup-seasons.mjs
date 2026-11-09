// A computed World Cup season (docs/design/football-years.md, "Computed World Cup seasons"): a World Cup's finalists, each
// rated from its Elo the day after the final, its XI chosen and ordered by the players' records of the tournament, in the
// data set format the game loads (src/engine/footballSets.js, kind 'wc'). No I/O: scripts/build-world-cup-seasons.mjs
// reads the committed facts (scripts/lib/world-cup-facts.mjs) and the manifest, and writes the files. Every constant is
// the manifest's, so a later change of the built-in data changes nothing; nothing is invented: every player is one of
// the World Cup squad, and his rating follows from the nation's Elo and the rule.
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import {
  FOOTBALL_SET_FORMAT, NO_TEAM, contentHash, dayNationResolver, identitiesFor, nationResolver, serializeFootballSet, territoryFor,
} from '../../src/data/footballSetBuild.js';

/** A computed player's `source`, as his record names it. */
export const WORLD_CUP_SOURCE = 'world-cup';
export const seasonOfYear = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;

const byMinutes = (a, b) => b.minutes - a.minutes || b.starts - a.starts || a.shirt - b.shirt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The XI: for each role of `xi` ({ GK: 1, DF: 4, MF: 4, FW: 2 }) the squad's players of that position with the most
 * minutes (then starts, then the lower shirt number); a role the squad cannot fill takes the most-used players left,
 * whatever their position. → { eleven, filled } (filled: those who took another role's place).
 */
export function pickEleven(squad, xi) {
  const picked = [];
  for (const [role, count] of Object.entries(xi)) picked.push(...squad.filter(player => player.position === role).sort(byMinutes).slice(0, count));
  const size = Object.values(xi).reduce((sum, count) => sum + count, 0);
  const filled = squad.filter(player => !picked.includes(player)).sort(byMinutes).slice(0, size - picked.length);
  if (picked.length + filled.length !== size) throw new Error(`A squad of ${squad.length} cannot field ${size}`);
  return { eleven: [...picked, ...filled], filled };
}

/** A player's Ballon d'Or points over the season's two years, and his World Cup awards' points (`weights`). */
export const ballonDorPoints = player => Object.values(player.ballonDor).reduce((sum, points) => sum + points, 0);
export const awardPoints = (player, weights) => player.awards.reduce((sum, award) => {
  if (!Object.hasOwn(weights, award)) throw new Error(`No weight for the award ${award}`);
  return sum + weights[award];
}, 0);

/**
 * The XI strongest first: by Ballon d'Or points, then World Cup awards, then goals a minute (none without minutes),
 * then minutes, then the lower shirt number.
 */
export function orderEleven(eleven, weights) {
  const rate = player => (player.minutes ? [player.goals, player.minutes] : [0, 1]);
  const goalsAMinute = (a, b) => { const [ga, ma] = rate(a), [gb, mb] = rate(b); return gb * ma - ga * mb; };
  return eleven.slice().sort((a, b) => ballonDorPoints(b) - ballonDorPoints(a) || awardPoints(b, weights) - awardPoints(a, weights)
    || goalsAMinute(a, b) || byMinutes(a, b));
}

/** The nation's strength from its Elo: best − perHundredElo × (E_best − E) / 100. */
export const strengthOf = (elo, bestElo, { best, perHundredElo }) => best - perHundredElo * (bestElo - elo) / 100;

/**
 * The XI's ratings, strongest first: T + D_k for the k-th of the profile, rounded by largest remainders so they sum to
 * round(11 × T): each rounded down, then the largest fractions (the earlier first on a tie) up. So the XI's mean is
 * within 1/22 of T, rounds as T does, and the order never inverts.
 */
export function elevenRatings(strength, profile) {
  const exact = profile.map(d => strength + d);
  const ratings = exact.map(Math.floor);
  const up = Math.round(profile.length * strength) - ratings.reduce((sum, r) => sum + r, 0);
  const order = exact.map((x, k) => [x - ratings[k], k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  if (up < 0 || up > profile.length) throw new Error(`Cannot round ${strength} to a sum of ${Math.round(profile.length * strength)}`);
  for (const [, k] of order.slice(0, up)) ratings[k]++;
  if (ratings.some(r => r < 1 || r > 99)) throw new Error(`Ratings ${ratings.join(', ')} fall outside 1–99`);
  return ratings;
}

/**
 * public/football/ATTRIBUTION-world-cup.txt: the licence of the season files and the credits the CC BY-SA 4.0 data asks
 * for (author, notice, licence and source links, the changes made), naming every season's version and every
 * Wikipedia revision read.
 */
export function attributionText(manifest, docs) {
  const { worldCup, results, ballonDor, lineups, crossCheck } = manifest.sources;
  const pages = list => list.map(page => `    ${page.title}, revision ${page.revision} (https://en.wikipedia.org/w/index.php?oldid=${page.revision})`).join('\n');
  return `Computed World Cup seasons (public/football/wc-<year>.json)
Generated by scripts/build-world-cup-seasons.mjs; do not edit.

Seasons: ${docs.map(doc => doc.version).join(', ')}

These files are licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0,
${worldCup.licenceUrl}), as the data they are derived from asks. Their ratings are computed by this
project, not a game's: each finalist's strength from its Elo the day after the final, its eleven the players of its
World Cup squad with the most minutes, ordered by their records (docs/design/football-years.md, "Computed World Cup
seasons"; scripts/data/world-cup-seasons.json).

${worldCup.name}
  ${worldCup.notice}
  ${worldCup.url} (commit ${worldCup.commit})
  Licence: ${worldCup.licence} (${worldCup.licenceUrl})
  Used: the men's World Cups of ${manifest.seasons[0].year} to ${manifest.seasons.at(-1).year}: squads, positions and shirt numbers;
  appearances, substitutions and sendings-off (from 1970); goals; awards; the players' dates of birth and Wikipedia links.
  Changes: minutes and starts summed per player; each squad reduced to an eleven, ordered and given a computed rating;
  names written given name first.

Wikipedia (English), by its contributors, ${ballonDor.licence} (${ballonDor.licenceUrl})
  Ballon d'Or voting tables (the votes are France Football's):
${pages(ballonDor.pages)}
  Starting line-ups of 1962 and 1966:
${pages(lineups.pages)}
  Changes: the votes summed into points per player and year, and the line-ups into starts and minutes per player.

${results.name}
  ${results.url} (commit ${results.commit}), ${results.licence}
  Used: every men's full international to 1994, rated by the World Football Elo formula eloratings.net publishes.

${crossCheck.name} (${crossCheck.url}) served only to check the computed Elo: nothing of theirs is in these files.
`;
}

const round2 = x => Math.round(x * 100) / 100;
const plus = x => (x > 0 ? `+${x.toFixed(1)}` : x === 0 ? '0.0' : `−${(-x).toFixed(1)}`);

/** The rule as a season's source names it. */
export function conversionText(manifest, facts) {
  const { best, perHundredElo } = manifest.strength;
  const roles = Object.entries(manifest.xi).map(([role, count]) => `${count} ${role}`).join(', ');
  return `T = ${best} − ${perHundredElo} × (E_best − E) / 100, E the nation's Elo on ${facts.elo.date} (the day after the final) and E_best `
    + `the best of the teams active in the four years before (${facts.elo.best.team}, ${facts.elo.best.elo}); the XI (${roles}, the most minutes) `
    + 'ordered by Ballon d\'Or points, World Cup awards, goals a minute and minutes; its k-th player T + D_k, '
    + `D = ${manifest.profile.map(plus).join(', ')}, rounded so the XI sums to round(11 × T)`;
}

/**
 * Build one season from its facts and the manifest. Each finalist plays as the game nation its name resolves to in that
 * year (dayNationResolver: the Soviet Union, West Germany, Yugoslavia, Czechoslovakia and Zaire are their holders);
 * one without a map shape (East Germany) fields no team, and one whose shape the year merges or leaves out stops the
 * build. Territory and identities are the year's, with only the finalists fielding a side.
 * → { doc, text, audit, listing }
 */
export function buildWorldCupSeason(facts, manifest, { federations = FOOTBALL_FEDERATIONS } = {}) {
  const { year } = facts;
  const season = manifest.seasons.find(entry => entry.id === facts.id);
  if (!season || season.year !== year) throw new Error(`${facts.id} is not a season of the manifest`);
  const resolve = dayNationResolver(nationResolver(manifest.names.nations), federations, year);
  const plain = territoryFor(federations, year);
  const entries = [], dropped = [];
  for (const nation of facts.nations) {
    const id = resolve(nation.team);
    if (id === NO_TEAM) { dropped.push({ team: nation.team, why: 'no shape on the map' }); continue; }
    if (id == null) throw new Error(`${facts.id}: ${nation.team} is no game nation; add it to the manifest's names.nations`);
    if (Object.hasOwn(plain.merged, id) || plain.inactive.includes(id)) throw new Error(`${facts.id}: ${nation.team} (${id}) has no federation of its own in ${seasonOfYear(year)}`);
    if (entries.some(entry => entry.id === id)) throw new Error(`${facts.id}: two finalists are ${NATIONS[id][0]}`);
    entries.push({ id, nation });
  }
  const fielded = new Set(entries.map(entry => entry.id));
  const fields = id => fielded.has(id);
  const territory = territoryFor(federations, year, { fields });
  const identities = identitiesFor(federations, year, { fields });
  const edition = `${year} World Cup, computed`;

  const nations = {}, nationAudit = [];
  for (const id of Object.keys(NATIONS).filter(fields)) {
    const { nation } = entries.find(entry => entry.id === id);
    const strength = strengthOf(nation.elo, facts.elo.best.elo, manifest.strength);
    const { eleven, filled } = pickEleven(nation.squad, manifest.xi);
    const order = orderEleven(eleven, manifest.awards);
    const ratings = elevenRatings(strength, manifest.profile);
    const players = order.map((player, k) => [player.name, player.position, ratings[k], {
      id: `wc:${player.id}`, source: WORLD_CUP_SOURCE, edition, snapshotDate: facts.elo.date,
      ...(player.wikipedia ? { url: player.wikipedia } : {}),
      team: nation.team, shirt: player.shirt, teamElo: nation.elo, xiRank: k + 1,
      minutes: player.minutes, starts: player.starts, goals: player.goals,
      ...(player.awards.length ? { awards: player.awards } : {}),
      ...(Object.keys(player.ballonDor).length ? { ballonDor: player.ballonDor } : {}),
      ...(player.born ? { dateOfBirth: player.born } : {}),
    }]);
    if (new Set(players.map(([name]) => name)).size !== players.length) throw new Error(`${facts.id} ${nation.team}: two players of the XI share a name`);
    const lineup = selectLineup({ sport: 'football', squad: players.map(([name, pos, rating]) => ({ name, pos, rating })) });
    nations[id] = [Math.round(lineup.rating), nation.squad.length, players];
    nationAudit.push({
      id, name: identities[id]?.name ?? NATIONS[id][0], team: nation.team, elo: nation.elo, rank: nation.rank, T: round2(strength),
      strength: nations[id][0], mean: round2(ratings.reduce((sum, r) => sum + r, 0) / ratings.length),
      outOfPosition: lineup.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.player.name} (${slot.player.pos} as ${slot.position})`),
      filled: filled.map(player => `${player.name} (${player.position}, ${player.minutes}')`),
      eleven: order.map((player, k) => `${player.name} ${player.position} ${ratings[k]}${ballonDorPoints(player) ? ` BdO ${ballonDorPoints(player)}` : ''}`
        + `${player.awards.length ? ` ${player.awards.join('/')}` : ''} ${player.goals}g ${player.minutes}'`),
    });
  }
  const all = nationAudit.flatMap(entry => nations[entry.id][2].map(([, , rating]) => ({ T: entry.T, rating })));
  const meanOf = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const teamVariance = meanOf(all.map(x => x.T ** 2)) - meanOf(all.map(x => x.T)) ** 2;
  const withinVariance = meanOf(all.map(x => (x.rating - x.T) ** 2));
  const coverage = {
    players: all.length, nations: entries.length,
    completeXIs: nationAudit.filter(entry => !entry.outOfPosition.length).length, clubs: 0, leagues: 0,
  };
  const { worldCup, results, ballonDor, lineups } = manifest.sources;
  const doc = {
    format: FOOTBALL_SET_FORMAT, kind: 'wc', id: facts.id, version: '', year, season: seasonOfYear(year),
    label: `Computed · ${year} World Cup`, local: false,
    source: {
      provider: 'Computed', edition, method: 'computed', computed: true, snapshotDate: facts.elo.date, retrieved: manifest.retrieved,
      url: `${worldCup.url}/tree/${worldCup.commit}`, rawScale: 'Elo', conversion: conversionText(manifest, facts),
      licence: manifest.licence, attribution: 'public/football/ATTRIBUTION-world-cup.txt',
      squads: { name: worldCup.name, author: worldCup.author, commit: worldCup.commit, licence: worldCup.licence },
      results: { name: results.name, commit: results.commit, licence: results.licence },
      wikipedia: {
        ballonDor: Object.fromEntries(season.ballonDor.map(y => [y, ballonDor.pages.find(page => page.title === `${y} Ballon d'Or`).revision])),
        ...(season.lineupPages ? { lineups: Object.fromEntries(season.lineupPages.map(title => [title, lineups.pages.find(page => page.title === title).revision])) } : {}),
      },
    },
    nations, clubs: [], territory, ...(Object.keys(identities).length ? { identities } : {}), coverage,
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, tournament: facts.tournament, elo: facts.elo,
    teamShare: round2(teamVariance / (teamVariance + withinVariance)), dropped,
    identities, merged: Object.keys(territory.merged).length, inactive: territory.inactive.length,
    nations: nationAudit.sort((a, b) => b.T - a.T || (a.id < b.id ? -1 : 1)),
    unmatchedVotes: facts.unmatchedVotes,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}
