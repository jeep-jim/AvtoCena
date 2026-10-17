import fs from "node:fs/promises";

const { readDataJson } = await import("../apps/web/lib/data.ts");
const { readMarketOffers, rebuildIndexes } = await import("../apps/web/lib/catalog/storage.ts");
const {
  assertEncyclopediaIdentityProductionConnected,
  readEncyclopediaIdentityDataset,
  readEncyclopediaIdentityResolver,
} = await import("../apps/web/lib/catalog/encyclopedia-identity-data.ts");
const { planEncyclopediaIdentityReprojection } = await import("../apps/web/lib/catalog/encyclopedia-identity-reprojection.ts");

const OUTPUT = process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_PUBLISH_REPORT || "catalog-encyclopedia-identity-publish-report.json";
const PUBLISH = String(process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_PUBLISH || "").trim() === "1";

const manifest = await readDataJson("catalog/manifest.json", null);
if (!manifest?.generationId || !manifest?.markets) throw new Error("catalog_identity_publish_manifest_unavailable");

const marketIds = Object.keys(manifest.markets).filter((market) => Number(manifest.markets?.[market]?.count || 0) > 0);
const marketOffers = await Promise.all(marketIds.map(async (market) => ({ market, offers: await readMarketOffers(market) })));
const offers = marketOffers.flatMap((entry) => entry.offers || []);
const expectedPublishedCount = marketIds.reduce((sum, market) => sum + Number(manifest.markets?.[market]?.count || 0), 0);
if (offers.length !== expectedPublishedCount) {
  throw new Error(`catalog_identity_publish_offer_count_read_mismatch:${offers.length}:${expectedPublishedCount}`);
}

const dataset = await readEncyclopediaIdentityDataset();
const resolver = await readEncyclopediaIdentityResolver();
if (!dataset || !resolver) throw new Error("catalog_identity_publish_resolver_unavailable");

const { rows: projectedOffers, report: reprojection } = planEncyclopediaIdentityReprojection(resolver, offers);
if (projectedOffers.length !== offers.length) throw new Error(`catalog_identity_publish_offer_count_changed:${offers.length}:${projectedOffers.length}`);

const beforeIds = new Set(offers.map((offer) => String(offer.id || "")));
const afterIds = new Set(projectedOffers.map((offer) => String(offer.id || "")));
if (beforeIds.size !== offers.length || afterIds.size !== projectedOffers.length) throw new Error("catalog_identity_publish_duplicate_offer_id");
for (const id of beforeIds) if (!afterIds.has(id)) throw new Error(`catalog_identity_publish_offer_id_missing:${id}`);

const brandCollisions = resolver.collisions.filter((collision) => collision.scope === "brand");
const modelCollisions = resolver.collisions.filter((collision) => collision.scope === "model");
if (brandCollisions.length) throw new Error(`catalog_identity_publish_brand_collisions:${brandCollisions.length}`);

const beforeMarketCounts = Object.fromEntries(marketOffers.map(({ market, offers: rows }) => [market, rows.length]));
const afterMarketCounts = Object.fromEntries(marketIds.map((market) => [market, projectedOffers.filter((offer) => offer.market === market).length]));
if (JSON.stringify(beforeMarketCounts) !== JSON.stringify(afterMarketCounts)) throw new Error("catalog_identity_publish_market_counts_changed");

const result = {
  version: 1,
  mode: PUBLISH ? "publish_current_read_models" : "dry_run",
  generatedAt: new Date().toISOString(),
  generationId: manifest.generationId,
  offers: offers.length,
  marketCounts: beforeMarketCounts,
  identity: {
    identityProductionConnected: dataset.manifest.identityProductionConnected === true,
    fullEncyclopediaProductionConnected: dataset.manifest.productionConnected === true,
    brands: dataset.brands.length,
    models: dataset.models.length,
    resolverCollisions: resolver.collisions,
    brandCollisions: brandCollisions.length,
    modelCollisions: modelCollisions.length,
  },
  reprojection,
};

if (PUBLISH) {
  // Deep Encyclopedia release remains independent; only the explicit identity
  // activation flag permits public canonical identity publication.
  assertEncyclopediaIdentityProductionConnected(dataset);

  const byId = await readDataJson(`catalog/generations/${manifest.generationId}/indexes/offers-by-id.json`, { generationId: manifest.generationId, byId: {} });
  const images = await readDataJson(`catalog/generations/${manifest.generationId}/indexes/images-by-id.json`, { generationId: manifest.generationId, imagesById: {} });
  const byIdMap = byId?.byId || {};
  for (const offer of projectedOffers) if (!byIdMap[offer.id]) throw new Error(`catalog_identity_publish_location_missing:${offer.id}`);

  await rebuildIndexes(manifest.generationId, projectedOffers, byIdMap, images?.imagesById || {});

  const [currentFacets, currentProjection] = await Promise.all([
    readDataJson("catalog/public/facets.json", null),
    readDataJson("catalog/public/projection/all.json", null),
  ]);
  if (currentFacets?.generationId !== manifest.generationId) throw new Error("catalog_identity_publish_facets_generation_mismatch");
  if (currentProjection?.generationId !== manifest.generationId) throw new Error("catalog_identity_publish_projection_generation_mismatch");
  if (!Array.isArray(currentProjection?.items) || currentProjection.items.length !== projectedOffers.length) {
    throw new Error(`catalog_identity_publish_projection_count_mismatch:${currentProjection?.items?.length || 0}:${projectedOffers.length}`);
  }
  result.published = {
    facetsMakes: Array.isArray(currentFacets?.makes) ? currentFacets.makes.length : 0,
    projectionItems: currentProjection.items.length,
  };
}

await fs.writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
