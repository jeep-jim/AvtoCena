import test from 'node:test';
import assert from 'node:assert/strict';
import { auditStableCatalogSnapshot } from '../scripts/lib/catalog-stable-parity.mjs';

test('parity retries a staging mismatch while the publication lock is active', async () => {
  let calls = 0, clock = 0;
  const report = await auditStableCatalogSnapshot({
    audit: async () => ({ generationId: 'same', ok: ++calls > 1, mismatches: calls > 1 ? [] : ['staging'] }),
    readManifest: async () => ({ generationId: 'same' }), readLock: async () => ({ lockedUntil: new Date(60000).toISOString() }),
    now: () => clock, sleep: async (ms: number) => { clock += ms; },
  });
  assert.equal(report.ok, true); assert.equal(calls, 2);
});

test('parity does not accept a snapshot when its manifest changes during the read', async () => {
  let calls = 0;
  const report = await auditStableCatalogSnapshot({
    audit: async () => ({ generationId: ++calls === 1 ? 'old' : 'new', ok: true }),
    readManifest: async () => ({ generationId: 'new' }), readLock: async () => ({}), sleep: async () => {},
  });
  assert.equal(report.generationId, 'new'); assert.equal(calls, 2);
});

test('a stable mismatch is returned as a failure without retrying or suppressing it', async () => {
  let calls = 0;
  const report = await auditStableCatalogSnapshot({
    audit: async () => { calls++; return { generationId: 'same', ok: false, mismatches: ['lost_rows'] }; },
    readManifest: async () => ({ generationId: 'same' }), readLock: async () => ({}),
    sleep: async () => { assert.fail('must not retry'); },
  });
  assert.equal(report.ok, false); assert.equal(calls, 1);
});

test('a stuck publication cannot turn persistent mismatches into a green audit', async () => {
  let clock = 0;
  await assert.rejects(auditStableCatalogSnapshot({
    audit: async () => ({ generationId: 'same', ok: false }), readManifest: async () => ({ generationId: 'same' }),
    readLock: async () => ({ lockedUntil: new Date(60000).toISOString() }),
    now: () => clock, timeoutMs: 1000, sleep: async (ms: number) => { clock += ms; },
  }), /stability_timeout/);
});
