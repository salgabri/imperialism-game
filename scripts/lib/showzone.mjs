// ShowZone's cached answers (scripts/data/mlb-seasons.json `showzone`, data-src/showzone/): each file checked against
// its SHA-256 pin, and an edition's Live cards read page by page. Nothing here fetches.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { editionOf } from './mlb.mjs';

const POSITIONS = new Set(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP', 'CP']);

/** The JSON of the cached file `name` (data-src/showzone/<name>), which must be the file `showzone.sha256` pins. */
export async function pinnedShowzone(root, showzone, name) {
  const pin = showzone.sha256[name];
  if (!pin) throw new Error(`data-src/showzone/${name} is not pinned in scripts/data/mlb-seasons.json`);
  const file = path.join(root, 'data-src/showzone', name);
  if (!existsSync(file)) throw new Error(`data-src/showzone/${name} is missing: ShowZone's answers are cached there (scripts/data/mlb-seasons.json \`showzone\`)`);
  const bytes = await readFile(file);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== pin) throw new Error(`data-src/showzone/${name} is not the pinned file (sha256 ${sha})`);
  return JSON.parse(bytes.toString('utf8'));
}

/**
 * Every Live card ShowZone lists for the edition of `year`, page by page as cached, each page and the whole checked:
 * ShowZone's own records ({ tsnId, name, team, position, allPositions, overall, born, batHand, throwHand, ... }).
 */
export async function showzoneCards(root, showzone, year) {
  const { pages } = showzone.editions[year];
  const dir = `mlb${editionOf(year)}`;
  const files = (await readdir(path.join(root, 'data-src/showzone', dir))).filter(name => name.endsWith('.json'));
  if (files.length !== pages) throw new Error(`data-src/showzone/${dir} holds ${files.length} pages, not ${pages}`);
  const cards = [];
  for (let page = 1; page <= pages; page++) {
    const body = await pinnedShowzone(root, showzone, `${dir}/live_p${page}.json`);
    if (body.page !== page || body.totalPages !== pages) throw new Error(`${dir} page ${page} is page ${body.page} of ${body.totalPages}`);
    cards.push(...body.docs);
    if (page === pages && cards.length !== body.totalDocs) throw new Error(`${dir}: ${cards.length} cards, ShowZone counts ${body.totalDocs}`);
  }
  const uuids = new Set();
  for (const card of cards) {
    const at = `${dir} ${card.name} (${card.tsnId})`;
    if (!/^[0-9a-f]{32}$/.test(card.tsnId) || typeof card.name !== 'string' || !card.name.trim() || card.name !== card.name.trim()) throw new Error(`${at}: no uuid or name`);
    if (uuids.has(card.tsnId)) throw new Error(`${at} is listed twice`);
    uuids.add(card.tsnId);
    if (card.series !== 'Live' || card.event || card.isLegend || card.isFlashback) throw new Error(`${at} is not a Live series card`);
    if (!Number.isInteger(card.overall) || card.overall < 1 || card.overall > 99) throw new Error(`${at} has no overall`);
    if (!POSITIONS.has(card.position)) throw new Error(`${at}: unknown position ${card.position}`);
    const all = card.allPositions || [];
    if (all[0] !== card.position || new Set(all).size !== all.length || !all.every(pos => POSITIONS.has(pos))) {
      throw new Error(`${at}: positions ${JSON.stringify(all)} do not start with the primary ${card.position}`);
    }
    if (card.born != null && (typeof card.born !== 'string' || !card.born.trim())) throw new Error(`${at}: birthplace ${JSON.stringify(card.born)}`);
  }
  return cards;
}
