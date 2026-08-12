const { readCatalogFacets, searchOffers } = await import('../apps/web/lib/catalog/storage.ts');

const markets = ['korea','china','japan','uae','europe','georgia','kyrgyzstan'];
const iteration = Number(process.env.ITERATION || 0);
const start = performance.now();

const timed = async (name, fn) => {
  const t0 = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - t0;
    console.log(JSON.stringify({
      event: 'cars_dep',
      iteration,
      name,
      ok: true,
      ms: Number(ms.toFixed(1)),
      count: Number(value?.total ?? value?.makes?.length ?? 0),
    }));
    return value;
  } catch (error) {
    const ms = performance.now() - t0;
    console.log(JSON.stringify({
      event: 'cars_dep',
      iteration,
      name,
      ok: false,
      ms: Number(ms.toFixed(1)),
      error: String(error?.message || error),
    }));
    return null;
  }
};

await Promise.all([
  timed('facets', () => readCatalogFacets({})),
  ...markets.map((market) => timed(`search:${market}`, () => searchOffers({ market, page: 1, pageSize: 24, sort: 'updatedAt' }))),
]);

console.log(JSON.stringify({
  event: 'cars_dep_iteration',
  iteration,
  totalMs: Number((performance.now() - start).toFixed(1)),
}));
