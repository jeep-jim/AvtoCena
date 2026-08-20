import fs from "node:fs/promises";

const { readCurrentPublicCatalogProjection, readMarketOffers, publishCurrentCatalogReadModels } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { hasCredibleOfferContent, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { applyEncyclopediaDisplayIdentityBatch } = await import("../apps/web/lib/catalog/display-identity.ts");
const { catalogPublicPriority, findCatalogPriceOutliers } = await import("../apps/web/lib/catalog/public-priority.ts");
const { deduplicatePublicCatalogOffers } = await import("../apps/web/lib/catalog/public-offer-deduplication.ts");

const APPLY = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_DISPLAY_IDENTITY_APPLY || ""));
const OUTPUT = process.env.CATALOG_DISPLAY_IDENTITY_REPORT || "catalog-current-display-identity-refresh.json";

function clean(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function publicEligible(offer) {
  return offer?.status === "active"
    && isCatalogYearAllowed(offer?.year, offer?.market)
    && hasCredibleOfferContent(offer)
    && catalogPublicPriority(offer).eligible;
}

function countMarkets(rows) {
  return Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, rows.filter((row) => row.market === market).length]));
}

function identityPair(row) {
  return `${clean(row?.make)}\u0000${clean(row?.model)}`;
}

const marketRows = await Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => ({
  market,
  rows: (await readMarketOffers(market)).filter(publicEligible),
})));
const sourceRows = marketRows.flatMap((entry) => entry.rows);
const sourceIds = sourceRows.map((row) => String(row?.id || ""));
if (sourceIds.some((id) => !id)) throw new Error("display_identity_refresh_offer_id_missing");
if (new Set(sourceIds).size !== sourceIds.length) throw new Error("display_identity_refresh_offer_id_duplicate");

const identifiedRows = await applyEncyclopediaDisplayIdentityBatch(sourceRows);
if (identifiedRows.length !== sourceRows.length) throw new Error(`display_identity_refresh_count_changed:${sourceRows.length}:${identifiedRows.length}`);
const identifiedIds = new Set(identifiedRows.map((row) => String(row?.id || "")));
for (const id of sourceIds) if (!identifiedIds.has(id)) throw new Error(`display_identity_refresh_offer_id_missing_after:${id}`);

const sourceMarketCounts = countMarkets(sourceRows);
const identifiedMarketCounts = countMarkets(identifiedRows);
if (JSON.stringify(sourceMarketCounts) !== JSON.stringify(identifiedMarketCounts)) throw new Error("display_identity_refresh_market_counts_changed");

const priceOutliers = findCatalogPriceOutliers(identifiedRows);
const rejectedPriceIds = new Set(priceOutliers.map((outlier) => String(outlier?.id || "")).filter(Boolean));
const priceEligibleRows = identifiedRows.filter((row) => !rejectedPriceIds.has(String(row?.id || "")));
const deduplicated = deduplicatePublicCatalogOffers(priceEligibleRows);
const publicRows = deduplicated.rows;
const publicMarketCounts = countMarkets(publicRows);

const changedRows = identifiedRows.flatMap((after, index) => {
  const before = sourceRows[index];
  const beforeMake = clean(before?.make);
  const beforeModel = clean(before?.model);
  const afterMake = clean(after?.make);
  const afterModel = clean(after?.model);
  if (beforeMake === afterMake && beforeModel === afterModel) return [];
  return [{
    id: after.id,
    market: after.market,
    beforeMake,
    beforeModel,
    afterMake,
    afterModel,
    match: after?.encyclopediaDisplayIdentity?.match || null,
  }];
});

const currentProjection = await readCurrentPublicCatalogProjection();
if (currentProjection.rows.length > sourceRows.length) {
  throw new Error(`display_identity_refresh_current_projection_count_exceeds_source:${currentProjection.rows.length}:${sourceRows.length}`);
}

const beforePairs = new Set(sourceRows.map(identityPair));
const afterPairs = new Set(identifiedRows.map(identityPair));
const report = {
  version: 1,
  mode: APPLY ? "apply" : "dry_run",
  generatedAt: new Date().toISOString(),
  generationId: currentProjection.generationId,
  total: sourceRows.length,
  publicTotal: publicRows.length,
  marketCounts: sourceMarketCounts,
  publicMarketCounts,
  identity: {
    changed: changedRows.length,
    brandChanged: changedRows.filter((row) => row.beforeMake !== row.afterMake).length,
    modelChanged: changedRows.filter((row) => row.beforeModel !== row.afterModel).length,
    makeModelPairsBefore: beforePairs.size,
    makeModelPairsAfter: afterPairs.size,
    sample: changedRows.slice(0, 100),
  },
  priceOutliers: {
    rejected: priceOutliers.length,
    sample: priceOutliers.slice(0, 50),
  },
  semanticDuplicates: {
    rejected: deduplicated.removed.length,
    sample: deduplicated.removed.slice(0, 100),
  },
  applied: false,
};

if (APPLY) {
  const published = await publishCurrentCatalogReadModels();
  if (published.generationId !== currentProjection.generationId) throw new Error(`display_identity_refresh_generation_changed:${currentProjection.generationId}:${published.generationId}`);
  if (published.total !== publicRows.length) throw new Error(`display_identity_refresh_published_count_mismatch:${published.total}:${publicRows.length}`);
  if (published.allProjectionCount !== publicRows.length) throw new Error(`display_identity_refresh_projection_count_mismatch:${published.allProjectionCount}:${publicRows.length}`);
  if (published.priceOutliersRejected !== priceOutliers.length) throw new Error(`display_identity_refresh_outlier_count_mismatch:${published.priceOutliersRejected}:${priceOutliers.length}`);
  if (published.semanticDuplicatesRejected !== deduplicated.removed.length) throw new Error(`display_identity_refresh_duplicate_count_mismatch:${published.semanticDuplicatesRejected}:${deduplicated.removed.length}`);
  if (JSON.stringify(published.markets) !== JSON.stringify(publicMarketCounts)) throw new Error("display_identity_refresh_published_market_counts_changed");
  report.applied = true;
  report.published = published;
}

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
