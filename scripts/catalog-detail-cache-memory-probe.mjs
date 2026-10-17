// Offline diagnostic: synthetic ~9 MB blocks, no production traffic or writes.
// node --expose-gc --max-old-space-size=1024 --import tsx scripts/catalog-detail-cache-memory-probe.mjs [checkout]
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.argv[2] || '.');
const require = createRequire(path.join(root, 'package.json'));
process.env.JSON_STORAGE_DRIVER = 'local';
const { getJsonStorage } = require('./apps/web/lib/data.ts');
const { getOfferFromCurrentShard, currentOfferShardName, resetCatalogReadCachesForTests } = require('./apps/web/lib/catalog/storage.ts');
const ids = new Map();
for (let i = 0; ids.size < 64; i++) {
  const id = `offline-probe-${i}`;
  const prefix = currentOfferShardName(id);
  if (!ids.has(prefix)) ids.set(prefix, id);
}
const serialized = JSON.stringify({generationId: 'probe', items: Array.from({length: 250}, (_, i) => ({
  id: i === 0 ? 'PROBE_ID' : `other-${i}`, market: 'china', description: 'x'.repeat(36_000),
}))});
let reads = 0;
getJsonStorage().readJsonWithMeta = async (key) => {
  if (key === 'catalog/manifest.json') return {found: true, value: {generationId: 'probe', markets: {}}};
  const prefix = key.match(/^catalog\/public\/offers\/([a-f0-9]{2})\.json$/)?.[1];
  assert.ok(prefix && ids.has(prefix), `unexpected read: ${key}`);
  reads++;
  return {found: true, value: JSON.parse(serialized.replace('PROBE_ID', ids.get(prefix)))};
};
const memory = () => {
  global.gc?.();
  const m = process.memoryUsage();
  return {heapMiB: +(m.heapUsed / 1048576).toFixed(1), rssMiB: +(m.rss / 1048576).toFixed(1)};
};
const before = memory();
for (const id of ids.values()) assert.equal((await getOfferFromCurrentShard(id))?.id, id);
console.log(JSON.stringify({synthetic: true, blockBytes: Buffer.byteLength(serialized), distinctBlocks: ids.size, reads, before, after: memory()}));
resetCatalogReadCachesForTests();
