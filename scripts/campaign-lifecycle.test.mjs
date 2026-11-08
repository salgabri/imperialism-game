// Campaign lifecycle around setup: renaming the quick-resume save, other tabs writing while setup is open, the
// results screen's New campaign and Saved campaigns' Fork. Real bundled App on the synchronous fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleApp, findElement, syncAppFixture } from './lib/app-harness.mjs';
import { CAMPAIGN_INDEX_KEY, campaignMetadata, campaignStorageKey, createCampaignId, loadCampaign, loadSave, parseCampaign,
  writeSave } from '../src/engine/storage.js';
import { SAVE_KEY } from '../src/config.js';

await bundleApp();

/** A saved campaign, then a fresh boot in setup holding it as the quick-resume save (what App.boot() does). */
function bootWithSave(name = 'Original') {
  const first = syncAppFixture();
  first.app.setState({ campaignId: createCampaignId(), campaignName: name });
  first.app.persist();
  const text = first.storage.getItem(SAVE_KEY);
  first.close();
  const f = syncAppFixture({ phase: 'setup', savedText: text });
  const saved = parseCampaign(text);
  f.storage.setItem(campaignStorageKey(saved.campaignId), text);
  f.storage.setItem(CAMPAIGN_INDEX_KEY, JSON.stringify([campaignMetadata(saved)]));
  f.app.saved = loadSave();
  f.app.setState({ hasSave: true, savedMeta: { round: saved.round, alive: saved.aliveIds.length, settings: saved.settings } });
  return { f, id: saved.campaignId };
}

const dialogOf = app => findElement(app.render(), 'CampaignStorageDialog');

test('renaming the quick-resume save, then resuming it, raises no false "changed in another tab" conflict', () => {
  const { f, id } = bootWithSave();
  try {
    const { app } = f;
    assert.equal(app.state.campaignId, null, 'nothing is open yet after a reload');
    app.openStorageDialog('slots');
    dialogOf(app).props.onRename(id, 'Renamed');
    assert.equal(loadCampaign(id).campaignName, 'Renamed');
    assert.equal(app.saved.revision, loadCampaign(id).revision, 'the quick-resume copy carries the new revision');
    app.closeStorageDialog();
    app.resume();
    assert.equal(app.state.storageConflict, false);
    assert.equal(app.state.storageDialog, null);
    assert.equal(app.state.campaignName, 'Renamed');
    assert.equal(app.state.saveStatus.ok, true);
  } finally { f.close(); }
});

test('renaming a slot deleted elsewhere reports it in the dialog instead of throwing', () => {
  const { f, id } = bootWithSave();
  try {
    const { app } = f;
    app.openStorageDialog('slots');
    f.storage.removeItem(campaignStorageKey(id));
    assert.doesNotThrow(() => dialogOf(app).props.onRename(id, 'Gone'));
    assert.match(app.state.storageDialog.error, /no longer available/);
  } finally { f.close(); }
});

test('a campaign on a country no longer shipped is refused by name, while a shipped map that fails to load says so', async () => {
  const f = syncAppFixture({ phase: 'setup' });
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: async () => ({ ok: false, status: 404, json: async () => { throw new Error('Not found'); } }) });
  try {
    const { app } = f;
    const restore = async id => {
      let restored = false;
      await app.withCampaignMap({ settings: { sport: 'football', layer: 'clubs', clubScope: `domestic:${id}` } }, () => { restored = true; });
      assert.equal(restored, false);
      return app.state.saveStatus;
    };
    // Belize (two viable clubs) lost its map to the ten-club floor; Fiji keeps its own.
    assert.deepEqual(await restore('084'), { ok: false, refused: true, message: 'The map of Belize is no longer in the game, so the campaign cannot resume. The save is kept.' });
    assert.deepEqual(await restore('242'), { ok: false, refused: true, message: 'The map of Fiji could not be loaded, so the campaign cannot resume. Domestic map 242 failed to load (HTTP 404)' });
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});

test('another tab saving the outgoing campaign never traps the setup screen in a conflict', () => {
  const f = syncAppFixture();
  try {
    const { app } = f;
    app.setState({ campaignId: createCampaignId() });
    app.persist();
    const id = app.state.campaignId;
    app.newCampaign(); app.newCampaign();
    assert.equal(app.state.phase, 'setup');
    assert.equal(writeSave(loadCampaign(id)).ok, true, 'another tab resumes and saves the same campaign');
    app.handleStorage({ key: campaignStorageKey(id) });
    assert.equal(app.state.storageDialog, null);
    assert.equal(app.state.storageConflict, false);
    // Resuming the now stale quick-resume copy still finds the newer checkpoint.
    app.resume();
    assert.equal(app.state.storageConflict, true);
  } finally { f.close(); }
});

test('the results screen\'s New campaign draws a new seed when the seed field is blank', () => {
  const f = syncAppFixture();
  const realNow = Date.now;
  let clock = 1_700_000_000_000;
  Date.now = () => (clock += 1000);
  try {
    const { app } = f;
    app.newCampaign(); app.newCampaign();
    app.launchCampaign();
    const first = app.state.seed;
    assert.equal(String(app.state.setup.seed || ''), '', 'blank seed field');
    const [champion] = app.state.aliveIds;
    app.clearTimers();
    app.setState({ aliveIds: [champion], own: Object.fromEntries(Object.keys(app.state.own).map(id => [id, champion])),
      phase: 'victory', completedAt: Date.now() });
    findElement(app.render(), 'VictoryOverlay').props.onNew();
    assert.equal(app.state.phase, 'setup');
    app.launchCampaign();
    assert.notEqual(app.state.seed, first, 'a blank seed is a new draw, not a replay of the last campaign');
  } finally { Date.now = realNow; f.close(); }
});

test('Saved campaigns offers no Fork in setup once the quick-resume save is cleared', () => {
  const { f } = bootWithSave();
  try {
    const { app } = f;
    app.openStorageDialog('slots');
    assert.equal(typeof dialogOf(app).props.onFork, 'function', 'the quick-resume save can be forked');
    app.closeStorageDialog();
    app.setState({ teams: { stale: { id: 'stale' } } }); // the outgoing campaign's teams outlive the save
    app.discardSave();
    app.openStorageDialog('slots');
    assert.equal(dialogOf(app).props.onFork, undefined, 'nothing left to fork: no button that silently does nothing');
  } finally { f.close(); }
});
