// The club ids an earlier season's own country maps already give (public/domestic/<country>y<year>.json,
// scripts/build-season-countries.mjs): a season file keeps them for the same clubs (scripts/lib/europe-field.mjs `ids`),
// and the maps keep them across rebuilds, so a club's id never moves when the season's field of Europe's strongest
// changes, and a campaign saved on either still fits it.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SEASON_MAP = /^(\d{3}|[A-Z]{3})y(\d{4})\.json$/;

/**
 * Every season map's club ids of the season ending in `year`: Map('<country>:<club name>' → id); with `kind`, only the maps
 * of that source (an EA season's own maps are 'ea', those its Update Team database fills 'cm0102'), as a club of one
 * source may share its name with another's (EA's AEK Athens and the Update Team's).
 */
export async function seasonMapIds(root, year, { kind = null } = {}) {
  const dir = path.join(root, 'public/domestic'), ids = new Map();
  if (!existsSync(dir)) return ids;
  for (const file of await readdir(dir)) {
    const match = SEASON_MAP.exec(file);
    if (!match || Number(match[2]) !== year) continue;
    const doc = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (kind && doc.kind !== kind) continue;
    for (const club of doc.clubs) ids.set(`${doc.country}:${club.name}`, club.id);
  }
  return ids;
}
