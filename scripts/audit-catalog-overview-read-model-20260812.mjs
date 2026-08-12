const { getJsonStorage, resetJsonStorageForTests } = await import('../apps/web/lib/data.ts');

const markets = ['korea','china','japan','uae','europe','georgia','kyrgyzstan'];
const perMarket = 24;
const freshness = (row) => Date.parse(String(row?.sourcePublishedAt || row?.firstSeenAt || row?.updatedAt || '')) || 0;
const sortFresh = (rows) => [...rows].sort((a, b) => freshness(b) - freshness(a) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
const timed = async (label, fn) => {
  const started = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - started;
    console.log(JSON.stringify({ event: 'overview_audit', label, ok: true, ms: Number(ms.toFixed(1)), ...value }));
    return { ok: true, ms, value };
  } catch (error) {
    const ms = performance.now() - started;
    console.log(JSON.stringify({ event: 'overview_audit', label, ok: false, ms: Number(ms.toFixed(1)), error: String(error?.message || error) }));
    throw error;
  }
};

resetJsonStorageForTests();
const storage = getJsonStorage();
if (storage.driver !== 'object') throw new Error(`overview_audit_requires_object_storage:${storage.driver}`);
if (!storage.deleteJson) throw new Error('overview_audit_requires_deleteJson');

const sourceStarted = performance.now();
const [facets, ...projections] = await Promise.all([
  storage.readJson('catalog/public/facets.json', null),
  ...markets.map((market) => storage.readJson(`catalog/public/projection/${market}.json`, null)),
]);
const sourceWallMs = performance.now() - sourceStarted;
if (!facets?.generationId) throw new Error('overview_audit_missing_facets_generation');
const generations = new Set([facets.generationId, ...projections.map((value) => value?.generationId).filter(Boolean)]);
if (generations.size !== 1) throw new Error(`overview_audit_generation_mismatch:${[...generations].join(',')}`);

const byMarket = Object.fromEntries(markets.map((market, index) => {
  const projection = projections[index];
  const items = Array.isArray(projection?.items) ? projection.items : [];
  const top = sortFresh(items).slice(0, perMarket);
  return [market, { total: items.length, items: top }];
}));
const compactFacets = {
  generationId: facets.generationId,
  makes: Array.isArray(facets.makes) ? facets.makes : [],
  models: [],
  markets: Array.isArray(facets.markets) ? facets.markets : markets,
  bodyTypes: Array.isArray(facets.bodyTypes) ? facets.bodyTypes : [],
  fuels: Array.isArray(facets.fuels) ? facets.fuels : [],
  transmissions: Array.isArray(facets.transmissions) ? facets.transmissions : [],
  drives: Array.isArray(facets.drives) ? facets.drives : [],
};
const candidate = { version: 1, generationId: facets.generationId, perMarket, facets: compactFacets, markets: byMarket };
const compactBytes = Buffer.byteLength(JSON.stringify(candidate));
const prettyBytes = Buffer.byteLength(JSON.stringify(candidate, null, 2));
const totalSourceRows = projections.reduce((sum, value) => sum + (Array.isArray(value?.items) ? value.items.length : 0), 0);
const candidateRows = markets.reduce((sum, market) => sum + byMarket[market].items.length, 0);
console.log(JSON.stringify({
  event: 'overview_candidate', generationId: facets.generationId, sourceWallMs: Number(sourceWallMs.toFixed(1)),
  sourceRows: totalSourceRows, candidateRows, compactBytes, prettyBytes,
  markets: Object.fromEntries(markets.map((market) => [market, { total: byMarket[market].total, kept: byMarket[market].items.length }])),
}));

const runId = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z_-]/g, '');
const tempPath = `audit/perf/catalog-overview-${runId}.json`;
try {
  await timed('write_temp_overview', async () => { await storage.writeJson(tempPath, candidate, { ifNoneMatch: '*' }); return { path: tempPath, bytes: prettyBytes }; });
  for (let repeat = 1; repeat <= 7; repeat++) {
    await timed(`read_temp_overview_${repeat}`, async () => {
      const value = await storage.readJson(tempPath, null);
      if (value?.generationId !== facets.generationId) throw new Error('overview_audit_temp_generation_mismatch');
      const rows = markets.reduce((sum, market) => sum + (Array.isArray(value?.markets?.[market]?.items) ? value.markets[market].items.length : 0), 0);
      if (rows !== candidateRows) throw new Error(`overview_audit_temp_row_mismatch:${rows}:${candidateRows}`);
      return { bytes: prettyBytes, rows };
    });
  }
} finally {
  await storage.deleteJson(tempPath).catch((error) => console.log(JSON.stringify({ event: 'overview_audit_cleanup', ok: false, error: String(error?.message || error) })));
}

console.log(JSON.stringify({ event: 'overview_audit_complete', ok: true, generationId: facets.generationId, candidateRows, compactBytes, prettyBytes }));
