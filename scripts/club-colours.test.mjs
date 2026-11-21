// The club colours (src/data/clubColours.js) are read from the crests by scripts/build-club-colours.mjs, which records a
// digest of what it read (scripts/lib/club-colour-sources.mjs). A crest added, redrawn or removed, or a correction
// changed, without that run leaves the club's land in a hash pastel on the political map: the 748 crests the country
// maps' clubs gained on 17 November 2026 went uncoloured until the next day. The digest is of the files' bytes, so
// this needs no pixel read and holds on every platform.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clubColour } from '../src/data/clubColours.js';
import { colourSources, recordedDigest, sourcesDigest } from './lib/club-colour-sources.mjs';

const sources = await colourSources();

test('the club colours were read from the crests and corrections as they are', async () => {
  const written = readFileSync(new URL('../src/data/clubColours.js', import.meta.url), 'utf8');
  assert.equal(recordedDigest(written), await sourcesDigest(sources),
    'the crests or corrections changed since src/data/clubColours.js was written: run npm run build:club-colours');
});

test('every crest of today colours its club, and every past EuroLeague club read from its crest of the day', () => {
  assert.deepEqual(sources.crests.filter(file => !clubColour(file)), [], 'crests without a colour: run npm run build:club-colours');
  assert.deepEqual(sources.past.filter(([id]) => !clubColour(id)).map(([id]) => id), []);
});
