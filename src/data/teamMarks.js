// The image files a campaign's teams are drawn with, which the installed app keeps offline (src/serviceWorker.js
// keepCampaignMarks).
// They are the files TeamMark, Flag and the map's Flags mode (src/app/mapMethods.jsx) show.
import { clubLogoUrl } from './clubLogos.js';
import { FLAG_CODES, flagUrl } from './flags.js';
import { FLAG_SYMBOLS } from './flagSymbols.js';

/**
 * Every crest and flag file `teams` (a campaign's id → team) shows, each once: a club's crest, found by its id or
 * else its origin, and a nation's flag with the field and emblem the map lays a flag out from when it has them.
 * A club without a crest keeps its monogram and needs no file. Pure.
 */
export function teamMarkUrls(teams) {
  const urls = new Set();
  for (const [id, team] of Object.entries(teams || {})) {
    if (team?.kind === 'club') {
      const crest = clubLogoUrl(team.id ?? id) || clubLogoUrl(team.origin);
      if (crest) urls.add(crest);
      continue;
    }
    const flag = flagUrl(team?.flagId);
    if (!flag) continue;
    urls.add(flag);
    const symbol = FLAG_SYMBOLS[FLAG_CODES[team.flagId]];
    if (symbol) {
      urls.add(`${import.meta.env.BASE_URL}${symbol.fieldFile}`);
      urls.add(`${import.meta.env.BASE_URL}${symbol.symbolFile}`);
    }
  }
  return [...urls];
}
