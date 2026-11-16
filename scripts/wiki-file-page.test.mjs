// scripts/lib/wiki-file-page.mjs: what scripts/sync-club-logos.mjs reads from an English Wikipedia file page for a
// "pages" crest, on markup shaped like the pages' own (file history links, thumbnails, licence templates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { filePageFacts, filePageUrl } from './lib/wiki-file-page.mjs';

const UTM = '?utm_source=en.wikipedia.org&amp;utm_campaign=index&amp;utm_content=original';
const page = ({ file = 'LDLC_ASVEL_Basket.svg', hash = '7/71', licence = 'Fair use', nonFree = true, extra = '' } = {}) => `<!DOCTYPE html>
<html><head><title>File:${file.replace(/_/g, ' ')} - Wikipedia</title>
<link rel="canonical" href="https://en.wikipedia.org/wiki/File:${file}"></head><body>
<div class="fullImageLink" id="file"><a href="//upload.wikimedia.org/wikipedia/en/${hash}/${file}${UTM}"><img src="//thumb.wikimedia.org/wikipedia/en/thumb/${hash}/${file}/250px-${file}.png${UTM}" width="250"></a></div>
<div class="fullMedia"><a href="//upload.wikimedia.org/wikipedia/en/${hash}/${file}${UTM}" class="internal" title="${file.replace(/_/g, ' ')}">Original file</a></div>
<table class="licensetpl fileinfotpl-type-fairuse"><tr><td><span class="licensetpl_nonfree nfur-nonfree">${nonFree}</span><span class="licensetpl_short">${licence}</span></td></tr></table>
<a href="//upload.wikimedia.org/wikipedia/en/archive/${hash}/20250712065300%21${file}${UTM}">10 July 2025</a>
<img src="//thumb.wikimedia.org/wikipedia/en/thumb/c/c3/NotCommons-emblem-copyrighted.svg/60px-NotCommons-emblem-copyrighted.svg.png">
<a href="//upload.wikimedia.org/wikipedia/en/c/c3/NotCommons-emblem-copyrighted.svg">another file</a>${extra}
</body></html>`;

test('a file page gives the original (no thumbnail, archived version or other file), its address and its licence', () => {
  assert.deepEqual(filePageFacts(page(), 'LDLC ASVEL Basket.svg'), {
    original: 'https://upload.wikimedia.org/wikipedia/en/7/71/LDLC_ASVEL_Basket.svg',
    page: 'https://en.wikipedia.org/wiki/File:LDLC_ASVEL_Basket.svg',
    licence: 'Fair use',
    nonFree: true,
  });
  const free = filePageFacts(page({ file: 'Be%C5%9Fikta%C5%9F_logo.png', hash: 'a/ab', licence: 'CC BY-SA 4.0', nonFree: false }), 'Beşiktaş logo.png');
  assert.equal(free.original, 'https://upload.wikimedia.org/wikipedia/en/a/ab/Be%C5%9Fikta%C5%9F_logo.png');
  assert.equal(free.licence, 'CC BY-SA 4.0');
  assert.equal(free.nonFree, false);
});

test('a file page that does not link one original of the file, or lacks its address or licence, stops the sync', () => {
  assert.throws(() => filePageFacts(page(), 'ASVEL Basket logo.svg'), /0 links to the original of ASVEL Basket logo\.svg/);
  const twice = page({ extra: `<a href="//upload.wikimedia.org/wikipedia/commons/7/71/LDLC_ASVEL_Basket.svg">copy</a>` });
  assert.throws(() => filePageFacts(twice, 'LDLC ASVEL Basket.svg'), /2 links to the original/);
  assert.throws(() => filePageFacts(page().replace(/<link rel="canonical"[^>]+>/, ''), 'LDLC ASVEL Basket.svg'), /no canonical link/);
  assert.throws(() => filePageFacts(page().replace(/<span class="licensetpl_short">[^<]*<\/span>/, ''), 'LDLC ASVEL Basket.svg'), /no licence template/);
});

test('a file page\'s address is the one Wikipedia gives it', () => {
  assert.equal(filePageUrl('LDLC ASVEL Basket.svg'), 'https://en.wikipedia.org/wiki/File:LDLC_ASVEL_Basket.svg');
  assert.equal(filePageUrl('Beşiktaş logo.png'), 'https://en.wikipedia.org/wiki/File:Be%C5%9Fikta%C5%9F_logo.png');
  assert.equal(filePageUrl('Sassuolocalcio2026.svg', 'it'), 'https://it.wikipedia.org/wiki/File:Sassuolocalcio2026.svg');
  assert.throws(() => filePageUrl('X.svg', 'it.wikipedia.org/evil'), /not a Wikipedia language/);
});

test('another language\'s file page gives that Wikipedia\'s own upload (Sassuolo\'s crest of 2025 on Italian Wikipedia)', () => {
  const it = page({ file: 'Sassuolocalcio2026.svg', hash: '4/45', licence: 'Marchio', nonFree: false })
    .replace(/wikipedia\/en\//g, 'wikipedia/it/').replace('https://en.wikipedia.org', 'https://it.wikipedia.org');
  assert.deepEqual(filePageFacts(it, 'Sassuolocalcio2026.svg', 'it'), {
    original: 'https://upload.wikimedia.org/wikipedia/it/4/45/Sassuolocalcio2026.svg',
    page: 'https://it.wikipedia.org/wiki/File:Sassuolocalcio2026.svg',
    licence: 'Marchio',
    nonFree: false,
  });
  // Read as English Wikipedia's page, it links no original of its own.
  assert.throws(() => filePageFacts(it, 'Sassuolocalcio2026.svg'), /0 links to the original/);
});
