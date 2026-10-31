// The domestic-club sync's EFEM client (scripts/lib/domestic-sync.mjs): cached
// responses are served without permission, while a request that would reach EFEM
// needs --efem-permission-granted, since efem.club/robots.txt disallows /api/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEfem, playerSliceUrl } from './lib/domestic-sync.mjs';

test('without permission the EFEM client serves its cache and requests nothing', async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'efem-cache-'));
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(JSON.stringify({ count: 1, data: [{ id: 7 }] }), { status: 200 });
  };
  const cachedUrl = playerSliceUrl(70, 20, 21), uncachedUrl = playerSliceUrl(71, 20, 21);
  const keep = row => row;
  try {
    const permitted = createEfem({ cacheDir, permission: true, spacing: 0 });
    assert.deepEqual((await permitted.get(cachedUrl, keep)).data, [{ id: 7 }]);
    assert.deepEqual(calls, [cachedUrl]);

    const efem = createEfem({ cacheDir, spacing: 0 });
    assert.deepEqual((await efem.get(cachedUrl, keep)).data, [{ id: 7 }], 'a cached response needs no permission');
    await assert.rejects(efem.get(uncachedUrl, keep), /robots\.txt disallows \/api\/.*--efem-permission-granted/);
    await assert.rejects(createEfem({ cacheDir, refresh: true, spacing: 0 }).get(cachedUrl, keep), /robots\.txt/,
      'downloading again (--refresh) needs permission too');
    assert.deepEqual(calls, [cachedUrl], 'nothing reached EFEM without permission');
    assert.deepEqual(efem.stats(), { requests: 0, cached: 1 });
  } finally {
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
    await rm(cacheDir, { recursive: true, force: true });
  }
});
