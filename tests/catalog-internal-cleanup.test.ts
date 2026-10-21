import test from 'node:test';
import assert from 'node:assert/strict';
import { planInternalChunkCleanup } from '../scripts/lib/catalog-internal-cleanup.mjs';

const now = Date.parse('2026-09-26T04:00:00Z');
const cutoff = now - 6 * 3600000;
const old = 'gen_1788253861283_old';
const current = 'gen_1790368992861_current';
const previous = 'gen_1790355593950_previous';
const key = (gen: string, chunk = 1) => `catalog/internal/offers/source/${gen}-chunk-${String(chunk).padStart(4, '0')}.json`;
const row = (gen: string, chunk = 1, lastModified = '2026-09-01T00:00:00Z') => ({key: key(gen, chunk), lastModified, size: 100});
const manifest = {generationId: current, sources: {source: {count: 1, chunks: [key(old)]}}};
const protectedIds = new Set([current, previous]);

test('orphan survives no longer just because its public generation directory was already removed', () => {
  const orphan = row(old, 2);
  const result = planInternalChunkCleanup([row(old), orphan], manifest, protectedIds, cutoff);
  assert.deepEqual(result.candidates, [orphan]);
  assert.equal(result.summary.referencedBytes, 100);
  assert.equal(result.summary.candidateBytes, 100);
});

test('referenced old chunks, rollback, current, fresh writes and unknown paths are retained', () => {
  const objects = [row(old), row(current), row(previous), row(old, 3, new Date(now).toISOString()),
    row(old, 4, 'invalid'), row(`gen_${now}_staging`),
    {key: 'leads/keep.json', size: 10, lastModified: '2026-01-01T00:00:00Z'}];
  assert.deepEqual(planInternalChunkCleanup(objects, manifest, protectedIds, cutoff).candidates, []);
});

test('missing, malformed or incomplete internal manifest fails before authorizing deletions', () => {
  for (const bad of [null, {}, {...manifest, sources: []}, {...manifest, sources: {source: {count: 1, chunks: []}}},
    {...manifest, sources: {source: {count: 1, chunks: ['other/file.json']}}}]) {
    assert.throws(() => planInternalChunkCleanup([row(old, 2)], bad, protectedIds, cutoff), /internal_manifest_invalid/);
  }
  assert.throws(() => planInternalChunkCleanup([row(old, 2)], manifest, protectedIds, cutoff), /internal_manifest_invalid/);
});
