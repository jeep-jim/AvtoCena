const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { mutateSourcePolicy } = await import("../apps/web/lib/catalog/policy.ts");

const targetPerMarket = Math.max(1, Number(process.env.CATALOG_TARGET_PER_MARKET || 1000));
const detailsPerSource = Math.max(targetPerMarket, Number(process.env.CATALOG_SOURCE_DETAILS_LIMIT || targetPerMarket));
const pagesPerSource = Math.max(250, Number(process.env.CATALOG_SOURCE_PAGES_LIMIT || targetPerMarket));
const requested = new Set(String(process.env.CATALOG_DAILY_SOURCE_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const selected = catalogImportSources.filter((source) => !requested.size || requested.has(source.sourceId));
const updated = [];

for (const source of selected) {
  const policy = await mutateSourcePolicy(source, (current) => ({
    ...current,
    maxPagesPerRun: Math.max(Number(current.maxPagesPerRun || 0), pagesPerSource),
    maxOffersPerRun: Math.max(Number(current.maxOffersPerRun || 0), targetPerMarket),
    maxDetailsPerRun: Math.max(Number(current.maxDetailsPerRun || 0), detailsPerSource),
  }));
  updated.push({
    sourceId: source.sourceId,
    market: source.market,
    enabled: policy.enabled,
    blockedUntil: policy.blockedUntil,
    maxPagesPerRun: policy.maxPagesPerRun,
    maxOffersPerRun: policy.maxOffersPerRun,
    maxDetailsPerRun: policy.maxDetailsPerRun,
  });
}

console.log(JSON.stringify({ targetPerMarket, detailsPerSource, pagesPerSource, updated }, null, 2));
