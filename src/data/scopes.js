// Theatre choices for a club campaign: one league, everything, or the elite.
// Nation theatres live in SCOPES in teams.js.

export function CLUB_SCOPES(sport) {
  const leagues = [...new Set(sport.clubs.map(c => c.league))];
  return [
    {
      id: 'all',
      name: 'All Leagues',
      desc: 'Every club in the game, fighting for the whole map.',
      filter: () => true,
    },
    {
      id: 'elite',
      name: 'Elite 32',
      desc: 'The 32 strongest clubs on the board, whatever their league.',
      filter: (c, i, arr) => arr.slice().sort((a, b) => b.str - a.str).slice(0, 32).includes(c),
    },
    ...leagues.map(league => ({
      id: league,
      name: league,
      desc: `${sport.clubs.filter(c => c.league === league).length} clubs contest their own continent.`,
      filter: c => c.league === league,
    })),
  ];
}
