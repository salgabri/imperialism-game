// The overall the NFL seasons no game rated with one get (docs/design/american-football.md, "Tecmo seasons", "Madden
// NFL 99 to 2001" and "Computed seasons"): each game position's scores, whatever made them (a Tecmo edition's position
// score, a Madden edition's weighted attributes, a season's computed value), ranked within the season and read off
// Madden NFL 2002's overalls at that position, the 2001 season and the earliest Madden season the game ships. No I/O here.
//
// The reference is maddenratings.net's 31 team sheets of Madden NFL 2002 (punters out), as many of each team's best at the
// position as the season carries per club, so that a backup meets Madden's backups rather than its practice squad.

/** Madden NFL 2002's positions as the game's (punters left out). */
export const MADDEN_POSITION = {
  QB: 'QB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  LE: 'DL', RE: 'DL', DT: 'DL', LOLB: 'LB', MLB: 'LB', ROLB: 'LB', CB: 'CB', FS: 'S', SS: 'S', K: 'K',
};

/**
 * The Madden NFL 2002 overalls a game position's players are read against, lowest first: as many of each team's best at
 * the position as the season carries per club (`quota`, which may be fractional: every team's first whole number of
 * players, then the best of the next rank across the league), so that a backup meets Madden's backups rather than its
 * practice squad. `madden`: `[{ team, position, overall, name }]` with game positions.
 */
export function referenceOf(madden, position, quota) {
  const byTeam = new Map();
  for (const player of madden.filter(p => p.position === position)) {
    if (!byTeam.has(player.team)) byTeam.set(player.team, []);
    byTeam.get(player.team).push(player);
  }
  const ranked = [];
  for (const players of byTeam.values()) {
    players.sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
    players.forEach((player, depth) => ranked.push({ ...player, depth }));
  }
  ranked.sort((a, b) => a.depth - b.depth || b.overall - a.overall || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  const count = Math.round(quota * byTeam.size);
  return ranked.slice(0, count).map(player => player.overall).sort((a, b) => a - b);
}

/**
 * Each score's overall: its percentile among `scores` (mid-rank, ties sharing one), read off `reference` (ascending)
 * by linear interpolation, rounded and held to 1–99. A higher score never gets a lower overall. → Map score → overall.
 */
export function overallsOf(scores, reference) {
  if (!reference.length) throw new Error('No reference overalls');
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length, m = reference.length;
  const out = new Map();
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const p = ((i + j) / 2 + 0.5) / n;
    const h = Math.min(Math.max(p * m - 0.5, 0), m - 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    const value = reference[lo] + (reference[hi] - reference[lo]) * (h - lo);
    out.set(sorted[i], Math.min(99, Math.max(1, Math.round(value))));
    i = j + 1;
  }
  return out;
}

/**
 * Madden NFL 2002's rostered players from the committed snapshot of its launch roster (scripts/data/madden-seasons/
 * 2001.json, the same 31 sheets the Tecmo sync reads from data-src/): `[{ team, position, overall, name }]`, punters
 * left out, each team its EA id. Throws on a position Madden NFL 2002 does not have.
 */
export function maddenReferencePlayers(snapshot) {
  if (snapshot?.source?.edition !== 'Madden NFL 2002') throw new Error('The reference is Madden NFL 2002\'s launch roster');
  return snapshot.players.filter(([, , listed]) => listed !== 'P').map(([name, team, listed, overall]) => {
    const position = MADDEN_POSITION[listed];
    if (!position) throw new Error(`Madden NFL 2002: unknown position ${listed}`);
    return { team: String(team), position, overall, name };
  });
}

/**
 * The overall of each player of a season's game position, `players` (`[{ score }]`, `clubs` clubs): their scores read
 * off the reference at the position by percentile (overallsOf) → `{ overall: Map score → overall, reference }`.
 */
export function positionOveralls(players, clubs, madden, position) {
  const reference = referenceOf(madden, position, players.length / clubs);
  return { overall: overallsOf(players.map(p => p.score), reference), reference };
}
