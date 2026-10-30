// The eleven-player squad pick shared by the football data builders: scripts/build-rosters.mjs
// and scripts/build-clubs.mjs (through scripts/lib/football-data.mjs) and the CM 01/02 data set
// builder, src/data/footballSetBuild.js. Pure, so it runs in Node and in the browser.

export const FOOTBALL_FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };

/** Natural-role assignment, preferring EA coverage then maximising ratings.
 * A multi-position player can occupy only one shirt. Thin pools stay honest. */
export function pickFootballSquad(pool) {
  const roles = Object.keys(FOOTBALL_FORMATION), limits = Object.values(FOOTBALL_FORMATION);
  const encode = counts => counts.reduce((key, count, i) => key + count * [1, 2, 10, 50][i], 0);
  const states = new Map([[0, { counts: [0, 0, 0, 0], rating: 0, squad: [] }]]);
  // EA's unchanged overall is the primary rating. FM fills missing coverage;
  // its normalised CA is a different measure and must not displace an EA shirt
  // merely because the two providers' numbers are not directly calibrated.
  const score = player => player.rating + (player.sourceInfo.source === 'ea-fc' ? 1000 : 0);
  const byRating = pool.slice().sort((a, b) => score(b) - score(a) || a.sourceInfo.id.localeCompare(b.sourceInfo.id));
  for (const player of byRating) {
    for (const state of [...states.values()]) {
      for (let i = 0; i < roles.length; i++) {
        if (state.counts[i] >= limits[i] || !player.positions.includes(roles[i])) continue;
        const counts = state.counts.slice(); counts[i]++;
        const key = encode(counts), rating = state.rating + score(player);
        if ((states.get(key)?.rating ?? -Infinity) >= rating) continue;
        states.set(key, { counts, rating, squad: [...state.squad, player] });
      }
    }
  }
  const best = [...states.values()].sort((a, b) => b.squad.length - a.squad.length || b.rating - a.rating)[0];
  const squad = best.squad.slice(), taken = new Set(squad.map(p => p.sourceInfo.id));
  for (const player of byRating) {
    if (squad.length >= 11) break;
    if (!taken.has(player.sourceInfo.id)) { squad.push(player); taken.add(player.sourceInfo.id); }
  }
  return squad.sort((a, b) => b.rating - a.rating || a.sourceInfo.id.localeCompare(b.sourceInfo.id));
}
