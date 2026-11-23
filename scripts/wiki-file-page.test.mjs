// scripts/lib/wiki-file-page.mjs: what scripts/sync-club-logos.mjs reads from an English Wikipedia file page for a
// "pages" crest, on markup shaped like the pages' own (file history links, thumbnails, licence templates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { filePageFacts, filePageUrl, nonFreeLicence } from './lib/wiki-file-page.mjs';

const UTM = '?utm_source=en.wikipedia.org&amp;utm_campaign=index&amp;utm_content=original';
// `nonFree` is the licensetpl_nonfree marker's text, or null for a template without one.
const page = ({ file = 'LDLC_ASVEL_Basket.svg', hash = '7/71', licence = 'Fair use', nonFree = true, extra = '' } = {}) => `<!DOCTYPE html>
<html><head><title>File:${file.replace(/_/g, ' ')} - Wikipedia</title>
<link rel="canonical" href="https://en.wikipedia.org/wiki/File:${file}"></head><body>
<div class="fullImageLink" id="file"><a href="//upload.wikimedia.org/wikipedia/en/${hash}/${file}${UTM}"><img src="//thumb.wikimedia.org/wikipedia/en/thumb/${hash}/${file}/250px-${file}.png${UTM}" width="250"></a></div>
<div class="fullMedia"><a href="//upload.wikimedia.org/wikipedia/en/${hash}/${file}${UTM}" class="internal" title="${file.replace(/_/g, ' ')}">Original file</a></div>
<table class="licensetpl fileinfotpl-type-fairuse"><tr><td>${nonFree === null ? '' : `<span class="licensetpl_nonfree nfur-nonfree">${nonFree}</span>`}<span class="licensetpl_short">${licence}</span></td></tr></table>
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

/** `page()` as another language's Wikipedia serves it, from its own uploads. */
const onWiki = (html, wiki) => html.replace(/wikipedia\/en\//g, `wikipedia/${wiki}/`).replace('https://en.wikipedia.org', `https://${wiki}.wikipedia.org`);

test('another language\'s file page gives that Wikipedia\'s own upload (Sassuolo\'s crest of 2025 on Italian Wikipedia)', () => {
  // Italian Wikipedia's "Marchio" template has no licensetpl_nonfree marker, but its logos are non-free (kept under its
  // exemption doctrine), as the name says.
  const it = onWiki(page({ file: 'Sassuolocalcio2026.svg', hash: '4/45', licence: 'Marchio', nonFree: null }), 'it');
  assert.deepEqual(filePageFacts(it, 'Sassuolocalcio2026.svg', 'it'), {
    original: 'https://upload.wikimedia.org/wikipedia/it/4/45/Sassuolocalcio2026.svg',
    page: 'https://it.wikipedia.org/wiki/File:Sassuolocalcio2026.svg',
    licence: 'Marchio',
    nonFree: true,
  });
  // Read as English Wikipedia's page, it links no original of its own.
  assert.throws(() => filePageFacts(it, 'Sassuolocalcio2026.svg'), /0 links to the original/);
});

test('a fair-use template without the licensetpl_nonfree marker still makes the file non-free, by its name', () => {
  // Lithuanian Wikipedia's fair-use template has no marker at all; Romanian Wikipedia's marker says "yes", not "true".
  const facts = (wiki, file, licence, nonFree = null) => filePageFacts(onWiki(page({ file, hash: '1/1a', licence, nonFree }), wiki), file.replace(/_/g, ' '), wiki);
  assert.equal(facts('lt', 'Mouna_FC.png', 'Sąžiningo naudojimo').nonFree, true);
  assert.equal(facts('he', 'MaccabiYavne.png', 'שימוש הוגן בסמליל').nonFree, true);
  assert.equal(facts('uk', 'KMK.jpg', 'Добропорядне використання').nonFree, true);
  assert.equal(facts('el', 'PAEEKLogo.png', 'Εύλογη χρήση').nonFree, true);
  assert.equal(facts('pt', 'Renaissance_FC.png', 'Conteúdo restrito').nonFree, true);
  assert.equal(facts('fr', 'SCBA_logo.png', 'marque déposée').nonFree, true);
  assert.equal(facts('lv', 'FK_Jonava_logo.png', 'Fair-use').nonFree, true);
  assert.equal(facts('fi', 'IF_logo.png', 'fair use').nonFree, true);
  assert.equal(facts('ary', 'JSM.Logo.jpg', 'تخدام مقبول').nonFree, true);
  assert.equal(facts('ro', 'CSM_Slatina.svg', 'Utilizare cinstită', 'yes').nonFree, true);
  // The marker alone still decides for a name the list does not know.
  assert.equal(facts('en', 'Club.svg', 'Non-free logo', true).nonFree, true);
  // Free files stay free: Commons-style licences, and German Wikipedia's "Logo" (below the threshold of originality).
  assert.equal(facts('de', 'Logo_SC_Karlsdorf.jpg', 'Logo').nonFree, false);
  assert.equal(facts('en', 'Club.svg', 'Public domain').nonFree, false);
  assert.equal(facts('en', 'Club.svg', 'CC BY-SA 4.0', false).nonFree, false);
});

test('a non-free licence name is told apart from a free one whatever its case, spacing or hyphen', () => {
  for (const name of ['Fair use', 'fair use', 'Fair-use', 'FAIR USE', ' Sąžiningo  naudojimo ', 'Marchio', 'Marque déposée', 'Copyrighted',
    'Добросовестное использование', 'Adil kullanım']) assert.equal(nonFreeLicence(name), true, name);
  for (const name of ['Public domain', 'PD', 'CC0', 'CC BY-SA 4.0', 'Logo', 'GFDL', 'not recorded', '', 'Fair use (non-free, as the file page states)']) {
    assert.equal(nonFreeLicence(name), false, name);
  }
});
