// Sharing a campaign (README §Sharing a campaign) in the app: the share card's model, App's wiring of challenge links and
// the share image, and the setup and results controls that copy a link or share the image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { bundleApp, bundleComponents, findElement, syncAppFixture, withDom } from './lib/app-harness.mjs';
import { SHARE_CARD, buildShareCard, shareLine } from '../src/viewModels/shareCard.js';
import { challengeUrl } from '../src/screens/setup/challenge.js';
import { V4 } from '../src/theme.js';

await bundleApp();
const { SetupOverlay, VictoryOverlay } = await bundleComponents({
  SetupOverlay: 'src/components/SetupOverlay.jsx', VictoryOverlay: 'src/components/VictoryOverlay.jsx',
});

const SETUP = {
  sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker', preset: 'standard',
  seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'manager', managedTeamId: '', acquisitionPolicy: 'highest-rated',
  rosterPreset: 'authentic', turnOrder: 'random', targeting: 'compass', dataSet: null,
};
const TEAMS = [{ id: '250', name: 'France', rating: 86.1 }, { id: '276', name: 'Germany', rating: 85.4 }];
const LINK = 'https://imperialism-game.vercel.app/?seed=42';
const buttonNamed = (host, label) => [...host.querySelectorAll('button')].find(button => button.textContent.trim() === label);
const click = async element => { await act(async () => { element.click(); }); };

// ---------- the share card ----------

test('the share card frames the campaign’s land and paints the champion’s', () => {
  const shapes = [
    { id: 'a', d: 'M0 0h10v10H0z', bbox: { x: 100, y: 50, w: 40, h: 20 } },
    { id: 'b', d: 'M0 0h10v10H0z', bbox: { x: 140, y: 60, w: 20, h: 30 } },
    { id: 'c', d: 'M0 0h10v10H0z', bbox: { x: 600, y: 400, w: 50, h: 50 } },
    { id: 'empty' },
  ];
  const card = buildShareCard({ shapes, own: { a: 'x', b: 'x' }, championId: 'x', championName: 'Real Madrid', fill: '#c4917c',
    kicker: 'Campaign complete · Round IV', line: 'has conquered Spain in 9 battles', site: 'example.test', seed: 77 });
  assert.equal(card.width, SHARE_CARD.width);
  assert.equal(card.height, SHARE_CARD.height);
  assert.deepEqual(card.land.map(shape => shape.fill), ['#c4917c', '#c4917c', V4.landNeutral], 'held land in the champion’s colour');
  // Framed on the held land (100–160 × 50–90): its centre is the map's centre, inside the margin.
  const { scale, tx, ty } = card.transform;
  assert.ok(Math.abs((130 * scale + tx) - card.map.w / 2) < 1e-9 && Math.abs((70 * scale + ty) - card.map.h / 2) < 1e-9);
  assert.ok(60 * scale <= card.map.w - SHARE_CARD.pad * 2 + 1e-9 && 40 * scale <= card.map.h - SHARE_CARD.pad * 2 + 1e-9);
  assert.equal(card.border.width * scale, 0.9, 'borders stay 0.9 card pixels wide');
  assert.equal(card.title, 'REAL MADRID');
  assert.equal(card.filename, 'imperialism-real-madrid-77.png');
  // The campaign's opening camera wins; with nothing held the whole chart shows.
  const framed = buildShareCard({ shapes, own: { a: 'x' }, championId: 'x', frame: { x: 0, y: 0, w: 100, h: 100 } });
  assert.equal(framed.transform.scale, (framed.map.h - SHARE_CARD.pad * 2) / 100);
  assert.equal(buildShareCard({ shapes }).transform.scale, Math.min((SHARE_CARD.width - 56) / 960, (framed.map.h - 56) / 540));
  assert.equal(buildShareCard({ championName: 'Atlético de Madrid' }).filename, 'imperialism-atletico-de-madrid.png');
});

test('the share line is the results’ standfirst and two counts', () => {
  assert.equal(shareLine({ subtitle: 'has conquered Europe in 45 battles', conquests: '12', steals: '9' }),
    'has conquered Europe in 45 battles · 12 conquests · 9 players claimed');
  assert.equal(shareLine({ subtitle: 'has conquered Fiji in 1 battle', conquests: 1, steals: 1 }),
    'has conquered Fiji in 1 battle · 1 conquest · 1 player claimed');
});

// ---------- App ----------

test('the results get the campaign’s challenge link and the share image callbacks', async () => {
  const f = syncAppFixture({ ids: ['250', '276', '826'], settings: { scope: 'world', pacing: 'blitz' } });
  try {
    f.app.setState({ phase: 'victory', aliveIds: ['250'], own: { '250': '250', '276': '250', '826': '250' }, matches: 2, round: 2 });
    const overlay = findElement(f.app.render(), 'VictoryOverlay');
    assert.equal(overlay.props.challengeLink, challengeUrl('', f.app.state.initialSettings, 728491));
    assert.equal(overlay.props.challengeLink, '?theatre=world&draw=blitz&seed=728491');
    assert.equal(typeof overlay.props.onShareImage, 'function');
    assert.equal(typeof overlay.props.onPrepareImage, 'function');
    // Node has no canvas: no image, and nothing scheduled, sampled or saved for it.
    const rng = f.app.rng.getState(), pending = f.time.pending.size;
    assert.equal(await f.app.shareImageFile(), null);
    assert.equal(await f.app.shareResultImage(), 'This browser could not make the image.');
    assert.equal(f.app.rng.getState(), rng);
    assert.equal(f.time.pending.size, pending);
  } finally { f.close(); }
});

test('setup shares the seed it would launch', () => {
  const f = syncAppFixture({ phase: 'setup', settings: { scope: 'CONMEBOL' } });
  try {
    const setup = findElement(f.app.render(), 'SetupOverlay');
    // A new campaign manages: the link names the role, and no team while the suggested one stands in for a pick.
    assert.equal(setup.props.challengeLink, `?theatre=CONMEBOL&role=manager&seed=${f.app.openingSeed}`, 'a blank seed shares the opening seed');
    f.app.setState({ setup: { ...f.app.state.setup, seed: '99' } });
    assert.equal(findElement(f.app.render(), 'SetupOverlay').props.challengeLink, '?theatre=CONMEBOL&role=manager&seed=99');
  } finally { f.close(); }
});

test('a challenge link’s team stays only if its theatre fields it', () => {
  const f = syncAppFixture({ phase: 'setup', settings: { role: 'manager', managedTeamId: 'XYZ' } });
  try {
    // The fixture's setup fields no teams of its own: the theatre's list as App's setupTeams() gives it.
    f.app.setupTeams = () => TEAMS;
    f.app.setState({ challenge: { seed: '', ignored: ['theatre'] } });
    f.app.challengeTeam = 'XYZ';
    f.app.settleChallengeTeam();
    assert.equal(f.app.state.setup.managedTeamId, '');
    assert.deepEqual(f.app.state.challenge.ignored, ['theatre', 'team']);
    assert.equal(f.app.challengeTeam, null);
    f.app.setState({ setup: { ...f.app.state.setup, managedTeamId: '276' } });
    f.app.challengeTeam = '276';
    f.app.settleChallengeTeam();
    assert.equal(f.app.state.setup.managedTeamId, '276');
    // Choosing another team first settles it: nothing is cleared.
    f.app.challengeTeam = 'XYZ';
    f.app.settleChallengeTeam();
    assert.equal(f.app.state.setup.managedTeamId, '276');
    assert.equal(f.app.challengeTeam, null);
  } finally { f.close(); }
});

// ---------- setup and results controls ----------

async function withClipboard(window, writeText, fn) {
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  try { return await fn(); } finally { delete window.navigator.clipboard; }
}

test('setup says a link filled it in, and what the link could not use', async () => {
  await withDom(async ({ mount }) => {
    const view = await mount(SetupOverlay, { setup: SETUP, managerTeams: TEAMS, challenge: { seed: '42', ignored: ['theatre', 'season'] } });
    const note = view.host.querySelector('.setup-challenge');
    assert.equal(note.getAttribute('role'), 'note');
    assert.match(note.textContent, /^Challenge link/);
    assert.match(note.textContent, /This setup and its seed, 42, came from the link you opened\. Launch it as it is/);
    assert.match(note.textContent, /The link’s theatre and season aren’t offered here, so setup keeps the defaults\./);
    await view.render({ setup: SETUP, managerTeams: TEAMS, challenge: null });
    assert.ok(!view.host.querySelector('.setup-challenge'), 'no note without a link');
  });
});

test('Copy challenge link copies the link, or shows it selected where copying is unavailable', async () => {
  await withDom(async ({ window, mount }) => {
    const copied = [];
    await withClipboard(window, async text => { copied.push(text); }, async () => {
      const view = await mount(SetupOverlay, { setup: SETUP, managerTeams: TEAMS, challengeLink: LINK });
      const share = view.host.querySelector('section[data-step="3"] .setup-share');
      assert.match(share.textContent, /Challenge a friend/);
      await click(buttonNamed(share, 'Copy challenge link'));
      assert.deepEqual(copied, [LINK]);
      assert.match(share.querySelector('[role="status"]').textContent, /^Link copied\./);
      // A changed setup is a new link: the old status goes.
      await view.render({ setup: SETUP, managerTeams: TEAMS, challengeLink: `${LINK}0` });
      assert.equal(share.querySelector('[role="status"]').textContent, '');
      await view.unmount();
    });
    await withClipboard(window, null, async () => {
      const view = await mount(SetupOverlay, { setup: SETUP, managerTeams: TEAMS, challengeLink: LINK });
      await click(buttonNamed(view.host, 'Copy challenge link'));
      const field = view.host.querySelector('.share-campaign__field');
      assert.equal(field.value, LINK);
      assert.equal(field.getAttribute('aria-label'), 'Challenge link');
      assert.equal(document.activeElement, field, 'the link is focused for the browser’s own Copy');
      assert.match(view.host.querySelector('.setup-share [role="status"]').textContent, /Copy is unavailable here/);
      // The field sits in setup's form: Enter there must not submit it and launch the campaign.
      const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      field.dispatchEvent(enter);
      assert.equal(enter.defaultPrevented, true);
    });
  });
});

test('the results share the link and the image, which starts drawing as they open', async () => {
  await withDom(async ({ window, mount }) => {
    let prepared = 0, finish;
    const props = { id: '250', code: 'FRA', round: '009', name: 'FRANCE', subtitle: 'has conquered Europe in 9 battles', conquests: '3',
      steals: '3', territories: '10', effNow: '86.0', effBase: '85.0', effGain: { text: '+1.0' }, squad: [], positionColors: {},
      onClose() {}, onNew() {}, challengeLink: LINK, onPrepareImage: () => { prepared += 1; },
      onShareImage: () => new Promise(resolve => { finish = resolve; }) };
    const copied = [];
    await withClipboard(window, async text => { copied.push(text); }, async () => {
      const view = await mount(VictoryOverlay, props);
      assert.equal(prepared, 1);
      await view.render({ ...props, territories: '11' });
      assert.equal(prepared, 1, 'drawn once per results');
      const share = view.host.querySelector('.fi-victory-share');
      assert.match(share.textContent, /Challenge a friend/);
      await click(buttonNamed(share, 'Copy challenge link'));
      assert.deepEqual(copied, [LINK]);
      const image = buttonNamed(share, 'Share image');
      await click(image);
      assert.equal(image.disabled, true);
      assert.equal(share.querySelector('[role="status"]').textContent, 'Making the image…');
      await act(async () => { finish('Image saved as imperialism-france-5.png.'); });
      assert.equal(image.disabled, false);
      assert.equal(share.querySelector('[role="status"]').textContent, 'Image saved as imperialism-france-5.png.');
    });
  });
});
