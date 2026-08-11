from pathlib import Path

# Avoid full-market reads on overview and ordinary market pages.
p = Path('apps/web/app/(public)/cars/page.tsx')
s = p.read_text()
old = '''      if (!hasFilters) {\n        const rows = balanceBusinessRows((await readMarketOffers(market.id))\n          .filter((offer) => offer.status === "active" && isCrediblePublicOffer(offer)));\n        const start = (page - 1) * pageSize;\n        const visible = await applyActiveBusinessPricingBatch(rows.slice(start, start + pageSize));\n        return {\n          ...market,\n          items: balanceBusinessRows(visible).map(publicOffer),\n          total: rows.length,\n          page,\n          pageSize,\n        };\n      }'''
new = '''      if (!hasFilters) {\n        // Fast path: the generation index already knows the requested page IDs.\n        // Do not deserialize the entire market (8K-30K rows) just to render 6/48 cards.\n        // Overview deliberately oversamples a small fresh window, then applies the same\n        // business/diversity ordering in-memory. A selected market uses the exact page.\n        const indexedPageSize = selectedMarket ? pageSize : Math.min(48, Math.max(pageSize * 4, 24));\n        const indexed = await searchOffers({ market: market.id, page, pageSize: indexedPageSize, sort: "updatedAt" });\n        const candidates = balanceBusinessRows((indexed.items as any[]).filter(isCrediblePublicOffer));\n        const visible = await applyActiveBusinessPricingBatch(candidates.slice(0, pageSize));\n        return {\n          ...market,\n          items: balanceBusinessRows(visible).map(publicOffer),\n          total: indexed.total,\n          page: indexed.page,\n          pageSize,\n        };\n      }'''
if old not in s:
    raise SystemExit('cars page no-filter block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# A market-only route should use the already-built facet index. The previous code treated
# `market` itself as a dynamic facet filter and re-read every offer in that market.
p = Path('apps/web/lib/catalog/storage.ts')
s = p.read_text()
old = '''  const hasFilters = Boolean(params.market || params.make || params.model || params.hasPrice\n    || params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo\n    || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo\n    || params.powerFrom || params.powerTo || params.fuel || params.bodyType\n    || params.transmission || params.drive || params.auctionGrade);'''
new = '''  // `market` alone is not a reason to deserialize the full market merely to draw the\n  // filter UI. Use the generation facet index for the initial/market-only screen.\n  // More selective facet projections are handled separately; this fast path removes\n  // the worst navigation cost immediately.\n  const hasFilters = Boolean(params.make || params.model || params.hasPrice\n    || params.budgetFrom || params.budgetTo || params.yearFrom || params.yearTo\n    || params.mileageFrom || params.mileageTo || params.engineFrom || params.engineTo\n    || params.powerFrom || params.powerTo || params.fuel || params.bodyType\n    || params.transmission || params.drive || params.auctionGrade);'''
if old not in s:
    raise SystemExit('storage facet filter block not found')
s = s.replace(old, new, 1)
p.write_text(s)

print('catalog_page_fastpath_patch_ok')
