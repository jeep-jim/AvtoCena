from pathlib import Path

path = Path("scripts/catalog-live-recovery-market.mjs")
text = path.read_text()

replacements = [
    (
        'const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");',
        'const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, selectCatalogModelYearCoverageFirst } = await import("../apps/web/lib/catalog/inventory-quota.ts");',
    ),
    (
        '  while (pages < maxPages && accepted.size < target && Date.now() < deadline) {',
        '  while (pages < maxPages && Date.now() < deadline) {',
    ),
    (
        '      if (!offer.sourceOfferId || ((!offer.make || !offer.model) && !detailBoundIdentity)) { reject(rejections, "identity"); return null; }\n      if (!hostAllowed(source.sourceId, offer.operational?.sourceUrl)) { reject(rejections, "source_url"); return null; }',
        '      if (!offer.sourceOfferId || ((!offer.make || !offer.model) && !detailBoundIdentity)) { reject(rejections, "identity"); return null; }\n      // Coverage scanning continues after the output target. Once a model-year\n      // already has 20 successfully prepared rows from earlier pages, skip its\n      // expensive detail/gallery work. This is not a speculative reservation:\n      // failed rows never occupy quota.\n      if (!detailBoundIdentity) {\n        const quotaKey = catalogModelYearQuotaKey(offer, market);\n        if (quotaKey && Number(acceptedModelYearCounts.get(quotaKey) || 0) >= maxOffersPerModelYear) {\n          reject(rejections, "model_year_quota");\n          return null;\n        }\n      }\n      if (!hostAllowed(source.sourceId, offer.operational?.sourceUrl)) { reject(rejections, "source_url"); return null; }',
    ),
    (
        '  if (Date.now() >= deadline) stopReason = "time_limit";\n  else if (accepted.size >= target) stopReason = "target_reached";',
        '  if (Date.now() >= deadline) stopReason = "time_limit";\n  else if (!finished && pages >= maxPages && stopReason === "source_exhausted") stopReason = "page_limit";',
    ),
    (
        'const offers = [...globalOffers.values()].sort(qualityOrder).slice(0, target);',
        'const discoveredOffers = [...globalOffers.values()];\nconst offers = selectCatalogModelYearCoverageFirst(discoveredOffers, target, qualityOrder);',
    ),
    (
        '  version: 1,\n  mode: "live_market_exact_calculated_recovery",\n  market,\n  sourceIds: sources.map((source) => source.sourceId),\n  target,',
        '  version: 2,\n  mode: "live_market_exact_calculated_recovery",\n  market,\n  sourceIds: sources.map((source) => source.sourceId),\n  target,\n  discoveredCount: discoveredOffers.length,\n  discoveredModelYears: new Set(discoveredOffers.map((offer) => catalogModelYearQuotaKey(offer, market)).filter(Boolean)).size,',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

path.write_text(text)
