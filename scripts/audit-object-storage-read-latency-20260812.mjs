const { getJsonStorage, resetJsonStorageForTests } = await import('../apps/web/lib/data.ts');

const markets = ['korea','china','japan','uae','europe','georgia','kyrgyzstan'];
const paths = [
  'catalog/public/facets.json',
  'catalog/public/projection/all.json',
  ...markets.map((market) => `catalog/public/projection/${market}.json`),
];

const timed = async (label, fn) => {
  const started = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - started;
    console.log(JSON.stringify({ event: 'storage_read', label, ok: true, ms: Number(ms.toFixed(1)), ...value }));
    return { ok: true, ms, value };
  } catch (error) {
    const ms = performance.now() - started;
    console.log(JSON.stringify({ event: 'storage_read', label, ok: false, ms: Number(ms.toFixed(1)), error: String(error?.message || error) }));
    return { ok: false, ms, error };
  }
};

resetJsonStorageForTests();
const storage = getJsonStorage();
console.log(JSON.stringify({ event: 'storage_driver', driver: storage.driver, node: process.version }));

if (storage.listObjects) {
  const listing = await timed('list:catalog/public', async () => {
    const objects = await storage.listObjects('catalog/public');
    const wanted = new Map(paths.map((path) => [path, true]));
    const rows = objects
      .filter((object) => wanted.has(object.key.replace(/^.*?(catalog\/public\/)/, '$1')) || paths.some((path) => object.key.endsWith(path)))
      .map((object) => ({ key: object.key, size: Number(object.size || 0), lastModified: object.lastModified || '' }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return { count: objects.length, rows };
  });
  if (listing.ok) console.log(JSON.stringify({ event: 'storage_objects', rows: listing.value.rows }));
}

for (const path of paths) {
  await timed(`cold:${path}`, async () => {
    const value = await storage.readJson(path, null);
    const count = Array.isArray(value?.items) ? value.items.length : Array.isArray(value?.makes) ? value.makes.length : 0;
    return { count };
  });
}

for (const path of ['catalog/public/projection/china.json', 'catalog/public/projection/europe.json', 'catalog/public/projection/all.json']) {
  for (let repeat = 1; repeat <= 5; repeat++) {
    await timed(`repeat${repeat}:${path}`, async () => {
      const value = await storage.readJson(path, null);
      const count = Array.isArray(value?.items) ? value.items.length : 0;
      return { count };
    });
  }
}

const concurrentStart = performance.now();
const concurrent = await Promise.all(paths.map((path) => timed(`parallel:${path}`, async () => {
  const value = await storage.readJson(path, null);
  const count = Array.isArray(value?.items) ? value.items.length : Array.isArray(value?.makes) ? value.makes.length : 0;
  return { count };
})));
console.log(JSON.stringify({
  event: 'storage_parallel_summary',
  totalMs: Number((performance.now() - concurrentStart).toFixed(1)),
  maxMs: Number(Math.max(...concurrent.map((row) => row.ms)).toFixed(1)),
  ok: concurrent.every((row) => row.ok),
}));
