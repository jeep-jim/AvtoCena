const fs = await import("node:fs/promises");
const { exactMarketSources } = await import("../apps/web/lib/catalog/exact-market-sources.ts");
const { reliableMarketSources } = await import("../apps/web/lib/catalog/reliable-market-sources.ts");
const { alternateMarketSources } = await import("../apps/web/lib/catalog/alternate-market-sources.ts");
const { publicFallbackSources } = await import("../apps/web/lib/catalog/public-fallback-sources.ts");

const requested = String(process.env.CATALOG_DIAGNOSTIC_SOURCES || "guazi_china_export,otomoto_europe_exact,dubicars_uae_exact")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const all = [...exactMarketSources, ...reliableMarketSources, ...alternateMarketSources, ...publicFallbackSources];
const sources = requested.map((sourceId) => all.find((source) => source.sourceId === sourceId)).filter(Boolean);
const report = { startedAt: new Date().toISOString(), requested, sources: [] };

for (const source of sources) {
  const started = Date.now();
  try {
    const page = await source.fetchPage(null);
    const normalized = page.items.map((item) => source.normalizeOffer(item)).filter(Boolean);
    report.sources.push({
      sourceId: source.sourceId,
      market: source.market,
      ok: true,
      durationMs: Date.now() - started,
      raw: page.items.length,
      normalized: normalized.length,
      nextCursor: page.nextCursor,
      health: page.health,
      samples: normalized.slice(0, 3).map((offer) => ({
        make: offer.make,
        model: offer.model,
        year: offer.year,
        price: offer.sourcePrice,
        currency: offer.sourceCurrency,
        mileageKm: offer.mileageKm,
        fuel: offer.fuel,
        sourceUrl: offer.operational?.sourceUrl,
        rawImages: Array.isArray(offer.operational?.raw?.images) ? offer.operational.raw.images.length : 0,
      })),
    });
  } catch (error) {
    report.sources.push({
      sourceId: source.sourceId,
      market: source.market,
      ok: false,
      durationMs: Date.now() - started,
      error: error?.stack || error?.message || String(error),
    });
  }
}

for (const sourceId of requested) {
  if (!sources.some((source) => source.sourceId === sourceId)) report.sources.push({ sourceId, ok: false, error: "source_not_registered" });
}
report.finishedAt = new Date().toISOString();
await fs.writeFile(process.env.CATALOG_DIAGNOSTIC_REPORT_FILE || "catalog-source-diagnostic-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
