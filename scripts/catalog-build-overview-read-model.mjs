const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");
const { readCatalogFacets, searchOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_OVERVIEW_PATH, buildCatalogOverviewPayload } = await import("../apps/web/lib/catalog/overview.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const candidatesPerMarket = Math.min(48, Math.max(6, Number(process.env.CATALOG_OVERVIEW_CANDIDATES_PER_MARKET || 24)));

async function readManifestGeneration() {
  const manifest = await readDataJson("catalog/manifest.json", { generationId: "" });
  return String(manifest?.generationId || "");
}

const generationBefore = await readManifestGeneration();
if (!generationBefore) throw new Error("catalog_overview_manifest_missing");

const [facets, marketEntries] = await Promise.all([
  readCatalogFacets(),
  Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => {
    const result = await searchOffers({ market, page: 1, pageSize: candidatesPerMarket, sort: "updatedAt" });
    return [market, result];
  })),
]);

const generationAfterReads = await readManifestGeneration();
if (generationAfterReads !== generationBefore) {
  throw new Error(`catalog_overview_generation_changed_during_read:${generationBefore}:${generationAfterReads}`);
}
if (facets.generationId !== generationBefore) {
  throw new Error(`catalog_overview_facets_stale:${generationBefore}:${facets.generationId}`);
}

const markets = {};
for (const [market, result] of marketEntries) {
  if (String(result?.generationId || "") !== generationBefore) {
    throw new Error(`catalog_overview_market_stale:${market}:${generationBefore}:${String(result?.generationId || "")}`);
  }
  markets[market] = {
    total: Number(result?.total || 0),
    items: Array.isArray(result?.items) ? result.items : [],
  };
}

const payload = buildCatalogOverviewPayload(generationBefore, facets, markets);
await getJsonStorage().writeJson(CATALOG_OVERVIEW_PATH, payload);

const generationAfterWrite = await readManifestGeneration();
if (generationAfterWrite !== generationBefore) {
  throw new Error(`catalog_overview_generation_changed_after_write:${generationBefore}:${generationAfterWrite}`);
}

console.log(JSON.stringify({
  ok: true,
  generationId: generationBefore,
  path: CATALOG_OVERVIEW_PATH,
  candidatesPerMarket,
  total: Object.values(markets).reduce((sum, entry) => sum + Number(entry.total || 0), 0),
  markets: Object.fromEntries(Object.entries(markets).map(([market, entry]) => [market, { total: entry.total, candidates: entry.items.length }])),
}, null, 2));
