from pathlib import Path
p=Path('scripts/catalog-live-postpersist-audit.mjs')
s=p.read_text()
s=s.replace('const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");', 'const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");\nconst { catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s=s.replace('    olderThan15Count: rows.filter((offer) => Number(offer?.year || 0) < currentYear - 15).length,', '    olderThan15Count: rows.filter((offer) => Number(offer?.year || 0) < currentYear - 15).length,\n    marketMinYear: catalogMinYearForMarket(market),\n    belowMarketMinYearCount: rows.filter((offer) => Number(offer?.year || 0) < catalogMinYearForMarket(market)).length,')
s=s.replace('  if (assertMarkets.has(market) && stats.olderThan15Count > 0) report.failures.push(`${market}:older_than_15:${stats.olderThan15Count}`);', '  if (assertMarkets.has(market) && stats.belowMarketMinYearCount > 0) report.failures.push(`${market}:below_market_min_year:${stats.belowMarketMinYearCount}:min=${stats.marketMinYear}`);')
p.write_text(s)
if 'belowMarketMinYearCount' not in s or 'catalogMinYearForMarket' not in s: raise SystemExit('patch failed')
print('postpersist_market_age_audit_patch_ok')
