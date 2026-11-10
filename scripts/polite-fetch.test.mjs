// The data scripts' network rules (scripts/lib/polite-fetch.mjs, README.md "Network requests"): one generic
// User-Agent, robots.txt read first and obeyed as RFC 9309 reads it (for this agent and Anthropic's crawlers' names),
// a never list, checked redirects; GitHub files from raw.githubusercontent.com (Git LFS objects checked against their
// pointer); Wikidata's SPARQL sent to QLever in a form it answers quickly (scripts/lib/wikidata-sparql.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPoliteFetch, crawlDelay, fetchFile, FetchRefused, lfsPointer, NEVER_FETCHED, parseRobots, rawGithubUrl, robotsAllow, ROBOTS_AGENTS,
  USER_AGENT,
} from './lib/polite-fetch.mjs';
import { forQlever, spreadHead } from './lib/wikidata-sparql.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowed = (robots, target, agent = 'imperialism-game-data') => robotsAllow(parseRobots(robots), agent, target);
const allowedForAll = (robots, target) => ROBOTS_AGENTS.every(agent => allowed(robots, target, agent));

test('the agent is generic: a product token and a version, no address, account or URL', () => {
  assert.match(USER_AGENT, /^[a-z-]+\/\d+\.\d+$/);
  assert.deepEqual(ROBOTS_AGENTS, ['imperialism-game-data', 'ClaudeBot', 'anthropic-ai', 'Claude-Web']);
});

test('robots.txt rules: the longest match decides, Allow wins a tie, * and $ are patterns', () => {
  const robots = `# comment
User-agent: *
Disallow: /private/
Allow: /private/public
Disallow: /*.pdf$
Disallow: /tie
Allow: /tie
Disallow: /search?q=
Disallow:
`;
  assert.equal(allowed(robots, '/private/x'), false);
  assert.equal(allowed(robots, '/private/public/x'), true, 'the longer Allow wins');
  assert.equal(allowed(robots, '/doc.pdf'), false);
  assert.equal(allowed(robots, '/doc.pdf?x=1'), true, '$ anchors the end');
  assert.equal(allowed(robots, '/tie'), true, 'an Allow as long as a Disallow wins');
  assert.equal(allowed(robots, '/search?q=x'), false, 'the query is part of the path');
  assert.equal(allowed(robots, '/anything'), true, 'no rule matches, an empty Disallow forbids nothing');
  assert.equal(allowed('User-agent: *\nDisallow: /\n', '/robots.txt'), true, 'robots.txt itself is always allowed');
  assert.equal(allowed('', '/x'), true);
});

test('robots.txt groups: an agent obeys its own group, merged, else the * group; Crawl-delay belongs to its group', () => {
  const robots = `User-agent: SemrushBot
Crawl-delay: 5
User-agent: *
Disallow: /w/
User-agent: ClaudeBot
Disallow: /only-claude/
User-agent: claudebot/2.0
Disallow: /also-claude/
`;
  assert.equal(allowed(robots, '/w/x'), false);
  assert.equal(allowed(robots, '/w/x', 'ClaudeBot'), true, "ClaudeBot's own groups replace the * group");
  assert.equal(allowed(robots, '/only-claude/x', 'ClaudeBot'), false);
  assert.equal(allowed(robots, '/also-claude/x', 'ClaudeBot'), false, 'groups for one agent merge, case-insensitively');
  assert.equal(allowedForAll(robots, '/only-claude/x'), false, 'a path any of the agents may not fetch is refused');
  assert.equal(crawlDelay(parseRobots(robots)), 0, "SemrushBot's delay is not the * group's");
  assert.equal(crawlDelay(parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow: /admin/\n')), 10);
});

test('robots.txt paths compare percent-encoded, and a pattern without its slash still counts', () => {
  const robots = 'User-agent: *\nDisallow: /wiki/Wikipedia:Löschkandidaten/\nDisallow: index.php?act=Login\n';
  assert.equal(allowed(robots, '/wiki/Wikipedia:L%C3%B6schkandidaten/x'), false);
  assert.equal(allowed(robots, '/wiki/Wikipedia:L%c3%b6schkandidaten/x'), false, 'escapes compare upper-cased');
  assert.equal(allowed(robots, '/index.php?act=Login'), false);
  assert.equal(allowed(robots, '/%7Ewiki'), allowed(robots, '/~wiki'), 'unreserved escapes are decoded');
});

// Excerpts of the robots.txt files the audit of 2026-11-10 read, and what they decide for the scripts' requests.
const ROBOTS_2026_11_10 = {
  'query.wikidata.org': 'User-agent: *\nDisallow: /sparql\nDisallow: /bigdata\n',
  // www.wikidata.org and en.wikipedia.org serve the same file; its User-agent: * group begins so.
  wikimedia: `User-agent: SemrushBot
Crawl-delay: 5
User-agent: *
Allow: /w/api.php?action=mobileview&
Allow: /w/load.php?
Allow: /api/rest_v1/?doc
Allow: /w/rest.php/site/v1/sitemap
Disallow: /w/
Disallow: /api/
Disallow: /trap/
Disallow: /wiki/Special:
`,
  'upload.wikimedia.org': 'User-agent: *\nDisallow: /wikipedia/commons/archive/\n',
  'github.com': 'User-agent: *\nDisallow: /*/archive/\nDisallow: /*/raw/\nDisallow: /*/tree/\nDisallow: */tarball/\nDisallow: /*/*/commits/\n',
  'download.geonames.org': 'User-agent: *\nDisallow: /\n',
  'data.commoncrawl.org': 'User-Agent: *\nDisallow: /\n',
  'www.geoboundaries.org': 'User-agent: *\nCrawl-delay: 10\nDisallow: /admin/\nDisallow: /includes/\n',
  'efem.club': '# *\nUser-agent: *\nAllow: /\nDisallow: /cdn-cgi/\nDisallow: /ingest/\nDisallow: /api/\n',
  'www.rugbyleagueproject.org': 'User-agent: *\nDisallow: /matches/Custom\nDisallow: /matches/s/\nDisallow: /*?\n',
  'tennisabstract.com': 'User-agent: *\nDisallow: /jsfrags/\nDisallow: /jsmatches/\nDisallow: /jsplayers/\n',
  'docs.google.com': 'User-agent: *\nCrawl-delay: 1\nAllow: /$\nAllow: /spreadsheet\nAllow: /document\nDisallow: /templateabuse\nDisallow: /\n',
  'www.ea.com': 'User-agent: *\nDisallow: /results\nDisallow: /*/games/the-sims/the-sims-4/home/\nUser-agent: Bytespider\nDisallow: /\n',
};

test('the audit of 2026-11-10: what the hosts the scripts reached allow', () => {
  const r = ROBOTS_2026_11_10;
  assert.equal(allowedForAll(r['query.wikidata.org'], '/sparql'), false, 'the Wikidata Query Service');
  assert.equal(allowedForAll(r.wikimedia, '/w/api.php?action=wbsearchentities&search=x'), false, "Wikidata's search API");
  assert.equal(allowedForAll(r.wikimedia, '/w/api.php?format=json&formatversion=2&action=query&prop=pageprops'), false, "Wikipedia's API");
  assert.equal(allowedForAll(r.wikimedia, '/api/rest_v1/page/summary/Chelsea_F.C.'), false, "Wikimedia's REST API");
  assert.equal(allowedForAll(r.wikimedia, '/wiki/Special:EntityData/Q42.json'), false);
  assert.equal(allowedForAll(r.wikimedia, '/w/api.php?action=mobileview&page=X'), true, 'the one allowed API path');
  assert.equal(allowedForAll(r['upload.wikimedia.org'], '/wikipedia/en/thumb/a/ab/Crest.svg/250px-Crest.svg.png'), true, 'crest thumbnails');
  assert.equal(allowedForAll(r['github.com'], '/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/USA/ADM1/geoBoundaries-USA-ADM1_simplified.geojson'), false);
  assert.equal(allowedForAll(r['download.geonames.org'], '/export/dump/cities1000.zip'), false, "GeoNames' dumps");
  assert.equal(allowedForAll(r['data.commoncrawl.org'], '/crawl-data/CC-MAIN-2024-10/x.warc.gz'), false, "CommonCrawl's records");
  assert.equal(allowedForAll(r['www.geoboundaries.org'], '/api/current/gbOpen/ALL/ALL/'), true, "geoBoundaries' metadata");
  assert.equal(crawlDelay(parseRobots(r['www.geoboundaries.org'])), 10);
  assert.equal(allowedForAll(r['efem.club'], '/api/players/filter?filterString=pageSize=100'), false, "EFEM's API, read only with its permission");
  assert.equal(allowedForAll(r['www.rugbyleagueproject.org'], '/players/1265'), true);
  assert.equal(allowedForAll(r['www.rugbyleagueproject.org'], '/seasons/nrl-2008/summary.html?x=1'), false, 'no query strings there');
  assert.equal(allowedForAll(r['tennisabstract.com'], '/cgi-bin/player.cgi?p=RafaelNadal'), true);
  assert.equal(allowedForAll(r['tennisabstract.com'], '/jsmatches/RafaelNadal.js'), false);
  assert.equal(allowedForAll(r['docs.google.com'], '/spreadsheets/d/abc/export?format=csv'), true, 'the longer Allow: /spreadsheet wins');
  assert.equal(allowedForAll(r['www.ea.com'], '/games/madden-nfl/ratings?page=2'), true);
});

test('the never list: Sports-Reference and the NHL APIs', () => {
  for (const host of ['www.sports-reference.com', 'www.baseball-reference.com', 'www.basketball-reference.com', 'www.pro-football-reference.com',
    'www.hockey-reference.com', 'fbref.com', 'stathead.com', 'api.nhle.com', 'api-web.nhle.com']) assert.match(host, NEVER_FETCHED, host);
  for (const host of ['www.nhl.com', 'drop-api.ea.com', 'qlever.dev', 'notsports-reference.com.example']) assert.doesNotMatch(host, NEVER_FETCHED, host);
});

/** A fake network: `routes` maps a URL (or origin + '/robots.txt') to a reply `{ status, body, headers }` or a function. */
function network(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', agent: new Headers(init.headers).get('user-agent'), body: init.body, headers: new Headers(init.headers) });
    let reply = routes[url] ?? (url.endsWith('/robots.txt') ? { status: 404 } : { status: 200, body: 'ok' });
    if (typeof reply === 'function') reply = reply(url, init);
    return new Response(reply.status === 204 || (reply.status >= 300 && reply.status < 400) ? null : (reply.body ?? ''), { status: reply.status, headers: reply.headers });
  };
  return { calls, politeFetch: createPoliteFetch({ fetchImpl }) };
}

test('politeFetch reads robots.txt first, once per host, and sends only the generic agent', async () => {
  const { calls, politeFetch } = network({ 'https://a.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /no/\n' } });
  assert.equal(await (await politeFetch('https://a.example/yes/1', { headers: { 'User-Agent': 'Mozilla/5.0 (someone@example.com)' } })).text(), 'ok');
  await politeFetch('https://a.example/yes/2');
  await assert.rejects(politeFetch('https://a.example/no/3'), error => error instanceof FetchRefused && error.fatal
    && /a\.example\/robots\.txt disallows \/no\/3 \("Disallow: \/no\/"/.test(error.message));
  assert.deepEqual(calls.map(call => call.url), ['https://a.example/robots.txt', 'https://a.example/yes/1', 'https://a.example/yes/2']);
  assert.ok(calls.every(call => call.agent === USER_AGENT), 'every request, robots.txt included, carries only the generic agent');
});

test("politeFetch: no robots.txt allows everything; one it cannot read allows nothing, and is asked again next time", async () => {
  let robotsReplies = 0;
  const { calls, politeFetch } = network({
    'https://down.example/robots.txt': () => (++robotsReplies === 1 ? { status: 503 } : { status: 404 }),
  });
  assert.equal((await politeFetch('https://none.example/x')).status, 200);
  await assert.rejects(politeFetch('https://down.example/x'), error => error instanceof FetchRefused && !error.fatal
    && /robots\.txt answered HTTP 503: nothing is fetched/.test(error.message), 'refused, but a retry may succeed');
  assert.equal((await politeFetch('https://down.example/x')).status, 200, 'a failed robots.txt is not kept');
  assert.deepEqual(calls.map(call => call.url), ['https://none.example/robots.txt', 'https://none.example/x', 'https://down.example/robots.txt',
    'https://down.example/robots.txt', 'https://down.example/x']);
});

test('politeFetch never reaches a host on the never list, not even its robots.txt', async () => {
  const { calls, politeFetch } = network({});
  await assert.rejects(politeFetch('https://api-web.nhle.com/v1/roster/TOR/current'), /api-web\.nhle\.com is never fetched/);
  await assert.rejects(politeFetch('https://www.hockey-reference.com/'), FetchRefused);
  assert.deepEqual(calls, []);
});

test('politeFetch checks every redirect against its own host’s robots.txt; manual redirects are left to the caller', async () => {
  const { calls, politeFetch } = network({
    'https://from.example/a': { status: 302, headers: { location: 'https://to.example/b' } },
    'https://from.example/c': { status: 301, headers: { location: 'https://to.example/secret/d' } },
    'https://to.example/robots.txt': { status: 200, body: 'User-agent: ClaudeBot\nDisallow: /secret/\n' },
  });
  assert.equal(await (await politeFetch('https://from.example/a')).text(), 'ok');
  await assert.rejects(politeFetch('https://from.example/c'), /to\.example\/robots\.txt disallows \/secret\/d .*for ClaudeBot/);
  const manual = await politeFetch('https://from.example/a', { redirect: 'manual' });
  assert.equal(manual.status, 302);
  assert.deepEqual(calls.map(call => call.url), ['https://from.example/robots.txt', 'https://from.example/a', 'https://to.example/robots.txt',
    'https://to.example/b', 'https://from.example/c', 'https://from.example/a']);
});

test('politeFetch turns a POST into a GET after a 303, as fetch does, and keeps a 307 a POST', async () => {
  const { calls, politeFetch } = network({
    'https://p.example/form': { status: 303, headers: { location: '/done' } },
    'https://p.example/same': { status: 307, headers: { location: '/again' } },
  });
  await politeFetch('https://p.example/form', { method: 'POST', body: 'query=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  await politeFetch('https://p.example/same', { method: 'POST', body: 'query=y' });
  const done = calls.find(call => call.url === 'https://p.example/done'), again = calls.find(call => call.url === 'https://p.example/again');
  assert.equal(done.method, 'GET');
  assert.equal(done.body, undefined);
  assert.equal(done.headers.get('content-type'), null);
  assert.equal(again.method, 'POST');
  assert.equal(again.body, 'query=y');
});

test("politeFetch: a host's written permission stands in for its own robots.txt only", async () => {
  const { calls, politeFetch } = network({
    'https://efem.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /api/\n' },
    'https://efem.example/api/x': { status: 302, headers: { location: 'https://cdn.example/api/x' } },
    'https://cdn.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /api/\n' },
  });
  await assert.rejects(politeFetch('https://efem.example/api/y'), FetchRefused);
  assert.equal((await politeFetch('https://efem.example/api/y', { permission: 'efem.example' })).status, 200);
  await assert.rejects(politeFetch('https://efem.example/api/x', { permission: 'efem.example' }), /cdn\.example\/robots\.txt disallows/,
    'the permission does not follow a redirect to another host');
  assert.ok(calls.some(call => call.url === 'https://efem.example/robots.txt'), 'robots.txt is still read');
});

test("politeFetch keeps a host's Crawl-delay between its requests", async () => {
  const { politeFetch } = network({ 'https://slow.example/robots.txt': { status: 200, body: 'User-agent: *\nCrawl-delay: 0.3\n' } });
  await politeFetch('https://slow.example/1');
  const started = Date.now();
  await politeFetch('https://slow.example/2');
  assert.ok(Date.now() - started >= 250, `waited ${Date.now() - started} ms`);
});

test('GitHub files: github.com /raw/ links become raw.githubusercontent.com; Git LFS objects are checked against the pointer', async () => {
  const link = 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/USA/ADM1/geoBoundaries-USA-ADM1_simplified.geojson';
  const raw = 'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/USA/ADM1/geoBoundaries-USA-ADM1_simplified.geojson';
  const media = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/USA/ADM1/geoBoundaries-USA-ADM1_simplified.geojson';
  assert.equal(rawGithubUrl(link), raw);
  assert.equal(rawGithubUrl('https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/'), 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/');

  const object = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const sha = createHash('sha256').update(object).digest('hex');
  const pointer = size => `version https://git-lfs.github.com/spec/v1\noid sha256:${sha}\nsize ${size}\n`;
  assert.deepEqual(lfsPointer(Buffer.from(pointer(object.length))), { sha256: sha, size: object.length });
  assert.equal(lfsPointer(object), null);

  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const asked = [];
  let size = object.length;
  globalThis.fetch = async url => {
    asked.push(url);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url === raw) return new Response(pointer(size), { status: 200 });
    if (url === media) return new Response(object, { status: 200 });
    if (url === 'https://raw.githubusercontent.com/o/r/abc/plain.json') return new Response('{"a":1}', { status: 200 });
    return new Response('', { status: 404 });
  };
  try {
    assert.deepEqual(await fetchFile(link), object);
    assert.ok(!asked.some(url => url.startsWith('https://github.com/')), 'github.com is never asked');
    assert.equal((await fetchFile('https://raw.githubusercontent.com/o/r/abc/plain.json')).toString(), '{"a":1}', 'a file not in LFS comes as it is');
    size = object.length + 1;
    await assert.rejects(fetchFile(link), /its LFS pointer says/);
    await assert.rejects(fetchFile('https://raw.githubusercontent.com/o/r/abc/missing.json'), error => error.status === 404 && error.fatal);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});

test('Wikidata queries for QLever: prefixes declared, query hints dropped, the head moved into each UNION branch', () => {
  const names = `SELECT ?club ?name ?k ?lang WHERE {
  VALUES ?club { wd:Q1 wd:Q2 }
  { ?club rdfs:label ?name BIND("l" AS ?k) } UNION { ?club skos:altLabel ?name BIND("a" AS ?k) }
  BIND(LANG(?name) AS ?lang)
  FILTER(?lang IN ("en","mul"))
}`;
  assert.equal(spreadHead(names), `SELECT ?club ?name ?k ?lang WHERE {
  { VALUES ?club { wd:Q1 wd:Q2 } ?club rdfs:label ?name BIND("l" AS ?k) } UNION { VALUES ?club { wd:Q1 wd:Q2 } ?club skos:altLabel ?name BIND("a" AS ?k) }
  BIND(LANG(?name) AS ?lang)
  FILTER(?lang IN ("en","mul"))
}`);
  const byDate = 'SELECT ?p ?dob ?name WHERE { VALUES ?dob { "1972-06-23T00:00:00Z"^^xsd:dateTime } ?p wdt:P569 ?dob ; wdt:P106 wd:Q937857 . '
    + '{ ?p rdfs:label ?name } UNION { ?p skos:altLabel ?name } FILTER(LANG(?name) IN ("en")) }';
  assert.equal(spreadHead(byDate), 'SELECT ?p ?dob ?name WHERE {\n  '
    + '{ VALUES ?dob { "1972-06-23T00:00:00Z"^^xsd:dateTime } ?p wdt:P569 ?dob ; wdt:P106 wd:Q937857 . ?p rdfs:label ?name } UNION '
    + '{ VALUES ?dob { "1972-06-23T00:00:00Z"^^xsd:dateTime } ?p wdt:P569 ?dob ; wdt:P106 wd:Q937857 . ?p skos:altLabel ?name } FILTER(LANG(?name) IN ("en")) }');
  const statements = forQlever('SELECT ?p ?kind ?label WHERE { hint:Query hint:optimizer "None" . VALUES ?p { wd:Q1 }\n'
    + '  { ?p wdt:P27 ?c . ?c rdfs:label ?label . BIND("citizenship" AS ?kind) }\n'
    + '  UNION { ?p wdt:P54 ?t . FILTER NOT EXISTS { ?t wdt:P31 wd:Q135408445 } ?t rdfs:label ?label . BIND("teams" AS ?kind) }\n'
    + '  FILTER(LANG(?label) = "en") }');
  assert.match(statements, /^PREFIX wd: <http:\/\/www\.wikidata\.org\/entity\/>\n/);
  assert.ok(!statements.includes('hint:'), 'no Blazegraph hint');
  assert.match(statements, /\{ VALUES \?p \{ wd:Q1 \} \?p wdt:P27 \?c \. .* UNION \{ VALUES \?p \{ wd:Q1 \} \?p wdt:P54 \?t \. FILTER NOT EXISTS \{ \?t wdt:P31 wd:Q135408445 \} .*\}\n  FILTER\(LANG\(\?label\) = "en"\) \}$/s);
  // Nothing to move: no UNION, a FILTER in the head, or a UNION that does not follow the head.
  const plain = 'SELECT ?c ?logo WHERE { VALUES ?c { wd:Q1 } ?c wdt:P154 ?logo }';
  assert.equal(spreadHead(plain), plain);
  const filtered = 'SELECT ?x WHERE { ?x wdt:P31 wd:Q5 . FILTER(?x != wd:Q1) { ?x rdfs:label ?l } UNION { ?x skos:altLabel ?l } }';
  assert.equal(spreadHead(filtered), filtered);
  assert.equal(forQlever(plain).endsWith(`\n${plain}`), true);
});

test('every script that reaches the network goes through politeFetch, with no agent of its own', () => {
  const files = [...readdirSync(path.join(root, 'scripts')).map(name => `scripts/${name}`), ...readdirSync(path.join(root, 'scripts/lib')).map(name => `scripts/lib/${name}`)]
    .filter(file => /\.mjs$/.test(file) && !/\.test\.mjs$/.test(file));
  // smoke.mjs drives the game's own local server; polite-fetch.mjs is the one place fetch is called.
  const exempt = new Set(['scripts/lib/polite-fetch.mjs', 'scripts/smoke.mjs']);
  const offenders = [];
  for (const file of files) {
    if (exempt.has(file)) continue;
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      if (/(^|[^.\w])fetch\(/.test(line) || /\b(?:https?\.(?:get|request)|node:https?['"]|undici)\b/.test(line)) offenders.push(`${file}:${index + 1} calls the network directly`);
      if (/['"]user-agent['"]\s*:/i.test(line)) offenders.push(`${file}:${index + 1} sets its own User-Agent`);
    }
  }
  assert.deepEqual(offenders, []);
});
