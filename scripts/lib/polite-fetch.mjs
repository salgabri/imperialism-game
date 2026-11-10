// Every request the data scripts send goes through politeFetch (README.md, "Network requests"):
//   - one generic User-Agent, USER_AGENT, which names no person, address or account; a caller's own is replaced;
//   - never a host the project has ruled out (NEVER_FETCHED: the Sports-Reference sites and the NHL's APIs), whatever
//     its robots.txt says;
//   - each host's robots.txt read first (once per run) and obeyed as RFC 9309 reads it, for this agent and for the
//     names of Anthropic's crawlers too (ROBOTS_AGENTS): a path any of them may not fetch is refused, its Crawl-delay
//     kept between requests, and every redirect checked the same way before it is followed;
//   - a host whose robots.txt cannot be read (a server or network error) is not fetched from at all.
// A site's written permission (`permission`: the host that gave it) stands in for that host's robots.txt only; the
// one use is EFEM.club, whose /api/ the domestic and FM syncs read only with --efem-permission-granted.
import { createHash } from 'node:crypto';

export const USER_AGENT = 'imperialism-game-data/1.0';
const PRODUCT = 'imperialism-game-data';
// The agents whose robots.txt groups bind these requests: this one's product token, and Anthropic's crawlers'.
export const ROBOTS_AGENTS = [PRODUCT, 'ClaudeBot', 'anthropic-ai', 'Claude-Web'];
// Never fetched, robots.txt or not: the Sports-Reference family and the NHL's own APIs.
export const NEVER_FETCHED = /(^|\.)(sports-reference\.com|baseball-reference\.com|basketball-reference\.com|pro-football-reference\.com|hockey-reference\.com|fbref\.com|stathead\.com|api\.nhle\.com|api-web\.nhle\.com)$/i;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;
const ROBOTS_REDIRECTS = 5; // RFC 9309 2.3.1.2
const ROBOTS_BYTES = 500 * 1024; // RFC 9309 2.5: at least 500 KiB must be parsed

/**
 * Refused by a robots.txt or by the never list (`fatal`: retrying will not help), or for want of a readable robots.txt
 * (`retry`: a server or network error, so a later try reads it again).
 */
export class FetchRefused extends Error {
  constructor(message, { retry = false } = {}) {
    super(message);
    this.name = 'FetchRefused';
    this.fatal = !retry;
  }
}

// ---- robots.txt (RFC 9309) ----

const UNRESERVED = /[A-Za-z0-9\-._~]/;
/** A path or pattern as RFC 9309 2.2.2 compares them: non-ASCII percent-encoded, escapes upper-cased, unreserved ones decoded. */
function normalize(text) {
  return String(text)
    .replace(/%([0-9a-fA-F]{2})/g, (match, hex) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
    })
    .replace(/[^\x00-\x7f]+/g, text => encodeURIComponent(text));
}

/** A rule's pattern as a RegExp anchored at the path's start: `*` any run of characters, a final `$` the path's end. */
function compile(pattern) {
  let text = normalize(pattern);
  if (!text.startsWith('/') && !text.startsWith('*')) text = `/${text}`; // a pattern written without its slash
  const anchored = text.endsWith('$');
  const body = (anchored ? text.slice(0, -1) : text).split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return { regex: new RegExp(`^${body}${anchored ? '$' : ''}`), length: text.length };
}

/** The product token a User-agent line names, lower-cased ('*' for every agent). */
const agentToken = value => (value.trim() === '*' ? '*' : (/^[A-Za-z_-]+/.exec(value.trim())?.[0] ?? '').toLowerCase());

/**
 * robots.txt text → its groups, `{ agents, rules, delay }`: `agents` the lower-cased product tokens of the group's
 * User-agent lines, `rules` its Allow and Disallow lines in order, `delay` its Crawl-delay in seconds (or null). Lines
 * that are not records, and records outside any group (Sitemap, Host, Content-Signal), are ignored.
 */
export function parseRobots(text) {
  const groups = [];
  let group = null, open = false; // open: the group still takes User-agent lines
  for (const raw of String(text).slice(0, ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const record = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(raw.replace(/#.*$/, ''));
    if (!record) continue;
    const key = record[1].toLowerCase(), value = record[2];
    if (key === 'user-agent') {
      if (!open) groups.push(group = { agents: [], rules: [], delay: null });
      open = true;
      const token = agentToken(value);
      if (token) group.agents.push(token);
    } else if (group && (key === 'allow' || key === 'disallow')) {
      open = false;
      if (value) group.rules.push({ allow: key === 'allow', pattern: value, ...compile(value) });
    } else if (group && key === 'crawl-delay') {
      open = false;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) group.delay = Math.max(group.delay ?? 0, seconds);
    }
  }
  return groups;
}

/** The groups that bind `agent`: those naming its product token, else those for every agent ('*'). */
function groupsFor(groups, agent) {
  const token = agent.toLowerCase();
  const own = groups.filter(group => group.agents.includes(token));
  return own.length ? own : groups.filter(group => group.agents.includes('*'));
}

/**
 * The rule that decides `target` (a path with its query) for `agent`, or null when none matches: the longest
 * matching pattern, and between an Allow and a Disallow of the same length, the Allow.
 */
export function robotsRule(groups, agent, target) {
  const path = normalize(target);
  if (path === '/robots.txt') return null;
  let best = null;
  for (const group of groupsFor(groups, agent)) {
    for (const rule of group.rules) {
      if (!rule.regex.test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) best = rule;
    }
  }
  return best;
}

/** Whether `agent` may fetch `target` (a path with its query). */
export const robotsAllow = (groups, agent, target) => robotsRule(groups, agent, target)?.allow ?? true;

/** The longest Crawl-delay, in seconds, of the groups binding any of `agents` (0 for none). */
export const crawlDelay = (groups, agents = ROBOTS_AGENTS) =>
  Math.max(0, ...agents.flatMap(agent => groupsFor(groups, agent).map(group => group.delay ?? 0)));

// ---- Fetching ----

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pathOf = url => `${url.pathname}${url.search}`;

/**
 * A fetch that obeys the rules above; `fetchImpl` is the network (the global fetch unless a test gives its own).
 * Takes fetch's arguments plus `permission`; follows redirects itself (unless `redirect` says otherwise), checking each.
 */
export function createPoliteFetch({ fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const robots = new Map(); // origin -> Promise of its groups
  const turns = new Map(); // origin -> Promise of the time its last request went out

  async function readRobots(origin) {
    let url = new URL('/robots.txt', origin);
    for (let hop = 0; hop <= ROBOTS_REDIRECTS; hop++) {
      let response;
      try {
        response = await fetchImpl(url.href, { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
      } catch (error) {
        throw new FetchRefused(`${origin}/robots.txt could not be read (${error.message}): nothing is fetched from ${origin}`, { retry: true });
      }
      const location = REDIRECTS.has(response.status) && response.headers.get('location');
      if (location) {
        await response.body?.cancel().catch(() => {});
        url = new URL(location, url);
        continue;
      }
      if (response.status >= 200 && response.status < 300) return parseRobots(await response.text());
      await response.body?.cancel().catch(() => {});
      // 4xx: no robots.txt, so no restrictions; 5xx (or anything else): assume every path is disallowed.
      if (response.status >= 400 && response.status < 500) return [];
      throw new FetchRefused(`${origin}/robots.txt answered HTTP ${response.status}: nothing is fetched from ${origin}`, { retry: true });
    }
    throw new FetchRefused(`${origin}/robots.txt redirects more than ${ROBOTS_REDIRECTS} times: nothing is fetched from ${origin}`);
  }

  function robotsOf(origin) {
    if (!robots.has(origin)) {
      // A failure is not kept, so a caller's retry reads robots.txt again.
      robots.set(origin, readRobots(origin).catch(error => { robots.delete(origin); throw error; }));
    }
    return robots.get(origin);
  }

  /** Waits for the host's Crawl-delay since the previous request this run sent it. */
  function spaced(origin, seconds) {
    if (!seconds) return null;
    const turn = (turns.get(origin) ?? Promise.resolve(0)).then(async last => {
      const wait = last + seconds * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      return Date.now();
    });
    turns.set(origin, turn.catch(() => Date.now()));
    return turn;
  }

  /** Throws FetchRefused unless `url` may be fetched now; waits out the host's Crawl-delay. */
  async function clear(url, permission) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchRefused(`${url.href}: only http(s) is fetched`);
    if (NEVER_FETCHED.test(url.hostname)) throw new FetchRefused(`${url.hostname} is never fetched (the project's rule), robots.txt or not: ${url.href}`);
    const groups = await robotsOf(url.origin);
    if (permission !== url.hostname) {
      for (const agent of ROBOTS_AGENTS) {
        const rule = robotsRule(groups, agent, pathOf(url));
        if (rule && !rule.allow) {
          throw new FetchRefused(`${url.origin}/robots.txt disallows ${pathOf(url).slice(0, 160)} ("Disallow: ${rule.pattern}" for ${agent === PRODUCT ? 'this agent' : agent}): not fetched`);
        }
      }
    }
    await spaced(url.origin, crawlDelay(groups));
  }

  return async function politeFetch(input, init = {}) {
    const { permission, redirect = 'follow', headers, ...rest } = init;
    const sent = new Headers(headers);
    sent.set('user-agent', USER_AGENT);
    let url = new URL(String(input));
    let options = { ...rest, headers: sent };
    for (let hop = 0; ; hop++) {
      await clear(url, permission);
      const response = await fetchImpl(url.href, { ...options, redirect: redirect === 'follow' ? 'manual' : redirect });
      const location = redirect === 'follow' && REDIRECTS.has(response.status) && response.headers.get('location');
      if (!location) return response;
      await response.body?.cancel().catch(() => {});
      if (hop === MAX_REDIRECTS) throw new Error(`${url.href}: more than ${MAX_REDIRECTS} redirects`);
      // As fetch does: 303, and 301 or 302 after a POST, continue as a GET without the body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(options.method ?? 'GET').toUpperCase() === 'POST')) {
        const { body, ...get } = options;
        const kept = new Headers(get.headers);
        kept.delete('content-type');
        options = { ...get, method: 'GET', headers: kept };
      }
      url = new URL(location, url);
    }
  };
}

/** The scripts' fetch: see the top of this file. */
export const politeFetch = createPoliteFetch();

// ---- Files in GitHub repositories ----

/**
 * github.com's `/<owner>/<repo>/raw/<ref>/<path>`, which github.com's robots.txt disallows for every agent, as the
 * same file on raw.githubusercontent.com, which has no robots.txt; any other URL as it is.
 */
export function rawGithubUrl(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/(.+)$/.exec(String(url));
  return match ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}` : String(url);
}

const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n/;

/** A Git LFS pointer's `{ sha256, size }`, or null for any other file. */
export function lfsPointer(bytes) {
  if (bytes.length > 1024) return null;
  const match = LFS_POINTER.exec(Buffer.from(bytes).toString('utf8'));
  return match ? { sha256: match[1], size: Number(match[2]) } : null;
}

/**
 * A file's bytes, through politeFetch. A GitHub repository's file comes from raw.githubusercontent.com (`url` may be
 * github.com's /raw/ form); one kept in Git LFS comes as a pointer there, and its content is then read from
 * media.githubusercontent.com (no robots.txt either) and must have the pointer's SHA-256 and size. An HTTP error
 * throws with `status` set (and `fatal` for a 404).
 */
export async function fetchFile(url, init = {}) {
  const raw = rawGithubUrl(url);
  const read = async from => {
    const response = await politeFetch(from, init);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`HTTP ${response.status} for ${from}`), { status: response.status, fatal: response.status === 404 });
    }
    return Buffer.from(await response.arrayBuffer());
  };
  const bytes = await read(raw);
  const pointer = lfsPointer(bytes);
  if (!pointer) return bytes;
  const match = /^https:\/\/raw\.githubusercontent\.com\/(.+)$/.exec(raw);
  if (!match) throw new Error(`${url}: a Git LFS pointer, but not from raw.githubusercontent.com`);
  const media = `https://media.githubusercontent.com/media/${match[1]}`;
  const object = await read(media);
  const sha256 = createHash('sha256').update(object).digest('hex');
  if (object.length !== pointer.size || sha256 !== pointer.sha256) {
    throw new Error(`${media}: ${object.length} bytes, SHA-256 ${sha256}; its LFS pointer says ${pointer.size} bytes, ${pointer.sha256}`);
  }
  return object;
}
