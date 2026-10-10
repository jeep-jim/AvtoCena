const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");
const { readCatalogFacets, searchOffers, readCurrentCatalogProjectionSnapshot, backfillCatalogMarketLandings } = await import("../apps/web/lib/catalog/storage.ts");
const { CATALOG_OVERVIEW_PATH, buildCatalogOverviewPayload, catalogOverviewGenerationPath } = await import("../apps/web/lib/catalog/overview.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const candidatesPerMarket = Math.min(48, Math.max(6, Number(process.env.CATALOG_OVERVIEW_CANDIDATES_PER_MARKET || 24)));

async function main() {
async function readManifestGeneration() {
  const manifest = await readDataJson("catalog/manifest.json", { generationId: "" });
  return String(manifest?.generationId || "");
}

const generationBefore = await readManifestGeneration();
// Record the day before filtering; a build crossing midnight must not claim
// that yesterday's age filtering was performed today.
const policyDate = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
if (!generationBefore) throw new Error("catalog_overview_manifest_missing");

// Diagnose the midnight fast-path miss before rebuilding; metadata only.
const storage = getJsonStorage();
const [previousOverview, publicationLock] = await Promise.all([
  storage.readJson(catalogOverviewGenerationPath(generationBefore), null),
  storage.readJson("catalog/import-lock.json", null),
]);
console.log("OVERVIEW_REFRESH", JSON.stringify({
  generationId: generationBefore, expectedPolicyDate: policyDate,
  previousGeneration: previousOverview?.generationId || null,
  previousPolicyDate: previousOverview?.policyDate || null,
  previousBuiltAt: previousOverview?.builtAt || null,
  publicationActive: Date.parse(publicationLock?.lockedUntil || "") > Date.now(),
}));
if (Date.parse(publicationLock?.lockedUntil || "") > Date.now()) {
  throw new Error("catalog_overview_publication_in_progress");
}
if (publicationLock?.lockedUntil && !Number.isFinite(Date.parse(publicationLock.lockedUntil))) throw new Error("catalog_overview_publication_lock_invalid");

// Hourly recovery checks only metadata when this generation/day is already ready.
// Normal publication imports do not opt in: they still rebuild their overview.
if (process.env.CATALOG_OVERVIEW_SKIP_READY === "true"
  && previousOverview?.generationId === generationBefore && previousOverview?.policyDate === policyDate
  && previousOverview?.dailyLandingsVersion === 1 && previousOverview?.facets?.generationId === generationBefore) {
  console.log("OVERVIEW_REFRESH", JSON.stringify({generationId:generationBefore,policyDate,alreadyPrepared:true}));
  return;
}
const landings = await backfillCatalogMarketLandings({refreshDateSensitive:true});
if (landings.generationId !== generationBefore) throw new Error("catalog_overview_landings_generation_mismatch");
console.log("DAILY_MARKET_LANDINGS", JSON.stringify(landings));

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

const [sourceManifest, sourceProjection] = await Promise.all([
  readDataJson("catalog/manifest.json", { generationId: "", markets: {} }),
  readCurrentCatalogProjectionSnapshot(),
]);
if (sourceManifest.generationId !== generationBefore || sourceProjection.generationId !== generationBefore) {
  throw new Error("catalog_overview_source_generation_mismatch");
}
const sourceCounts = new Map();
for (const row of sourceProjection.items) sourceCounts.set(row.market, (sourceCounts.get(row.market) || 0) + 1);
const markets = {};
for (const [market, result] of marketEntries) {
  if (String(result?.generationId || "") !== generationBefore) {
    throw new Error(`catalog_overview_market_stale:${market}:${generationBefore}:${String(result?.generationId || "")}`);
  }
  const sourceTotal = Number(sourceManifest.markets?.[market]?.count || 0);
  if ((sourceCounts.get(market) || 0) !== sourceTotal) throw new Error(`catalog_overview_source_count_mismatch:${market}`);
  markets[market] = {
    sourceTotal,
    total: Number(result?.total || 0),
    items: Array.isArray(result?.items) ? result.items : [],
  };
}

const payload = buildCatalogOverviewPayload(generationBefore, facets, markets, policyDate);
if (new Date(Date.now()+7*3600000).toISOString().slice(0,10) !== policyDate) throw new Error("catalog_overview_date_changed_retry");
const finalLock = await storage.readJson("catalog/import-lock.json", null);
if (finalLock?.lockedUntil && (!Number.isFinite(Date.parse(finalLock.lockedUntil)) || Date.parse(finalLock.lockedUntil)>Date.now())) throw new Error("catalog_overview_publication_in_progress");
payload.dailyLandingsVersion = 1;
await getJsonStorage().writeJson(catalogOverviewGenerationPath(generationBefore), payload);
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
  policyDate,
  total: Object.values(markets).reduce((sum, entry) => sum + Number(entry.total || 0), 0),
  markets: Object.fromEntries(Object.entries(markets).map(([market, entry]) => [market, { total: entry.total, candidates: entry.items.length }])),
  searchPaths: Object.fromEntries(marketEntries.map(([market,result])=>[market,result.usedIndexShards])),
}, null, 2));
}
await main();
