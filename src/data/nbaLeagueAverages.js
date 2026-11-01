// NBA league averages per regular season, from Basketball-Reference's league averages table
// (https://www.basketball-reference.com/leagues/NBA_stats_per_game.html, read 2026-11-01): `pace` is possessions
// per 48 minutes, `rating` points per 100 possessions (ORtg) and `points` points a game. Club basketball plays each
// season at its own pace and scoring rate (src/sports/basketball.js); `points` is what the tests hold it to.
// 2026/27 is left out until it has a full season behind it.
export const NBA_LEAGUE_AVERAGES = Object.freeze({
  '1999/00': Object.freeze({ pace: 93.1, rating: 104.1, points: 97.5 }),
  '2000/01': Object.freeze({ pace: 91.3, rating: 103.0, points: 94.8 }),
  '2001/02': Object.freeze({ pace: 90.7, rating: 104.5, points: 95.5 }),
  '2002/03': Object.freeze({ pace: 91.0, rating: 103.6, points: 95.1 }),
  '2003/04': Object.freeze({ pace: 90.1, rating: 102.9, points: 93.4 }),
  '2004/05': Object.freeze({ pace: 90.9, rating: 106.1, points: 97.2 }),
  '2005/06': Object.freeze({ pace: 90.5, rating: 106.2, points: 97.0 }),
  '2006/07': Object.freeze({ pace: 91.9, rating: 106.5, points: 98.7 }),
  '2007/08': Object.freeze({ pace: 92.4, rating: 107.5, points: 99.9 }),
  '2008/09': Object.freeze({ pace: 91.7, rating: 108.3, points: 100.0 }),
  '2009/10': Object.freeze({ pace: 92.7, rating: 107.6, points: 100.4 }),
  '2010/11': Object.freeze({ pace: 92.1, rating: 107.3, points: 99.6 }),
  '2011/12': Object.freeze({ pace: 91.3, rating: 104.6, points: 96.3 }),
  '2012/13': Object.freeze({ pace: 92.0, rating: 105.8, points: 98.1 }),
  '2013/14': Object.freeze({ pace: 93.9, rating: 106.6, points: 101.0 }),
  '2014/15': Object.freeze({ pace: 93.9, rating: 105.6, points: 100.0 }),
  '2015/16': Object.freeze({ pace: 95.8, rating: 106.4, points: 102.7 }),
  '2016/17': Object.freeze({ pace: 96.4, rating: 108.8, points: 105.6 }),
  '2017/18': Object.freeze({ pace: 97.3, rating: 108.6, points: 106.3 }),
  '2018/19': Object.freeze({ pace: 100.0, rating: 110.4, points: 111.2 }),
  '2019/20': Object.freeze({ pace: 100.3, rating: 110.6, points: 111.8 }),
  '2020/21': Object.freeze({ pace: 99.2, rating: 112.3, points: 112.1 }),
  '2021/22': Object.freeze({ pace: 98.2, rating: 112.0, points: 110.6 }),
  '2022/23': Object.freeze({ pace: 99.2, rating: 114.8, points: 114.7 }),
  '2023/24': Object.freeze({ pace: 98.5, rating: 115.3, points: 114.2 }),
  '2024/25': Object.freeze({ pace: 98.8, rating: 114.5, points: 113.8 }),
  '2025/26': Object.freeze({ pace: 99.4, rating: 115.7, points: 115.6 }),
});

/** The latest full season: the built-in season plays at its pace until its own season is complete. */
export const LATEST_NBA_SEASON = Object.keys(NBA_LEAGUE_AVERAGES).at(-1);
