from pathlib import Path

# Shared public quality gate: Japan keeps rolling 15-year window; all other markets are 2020+.
p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
s = s.replace('export const CATALOG_MIN_YEAR = 2015;\n', '')
start = s.find('export function isCatalogYearAllowed')
if start >= 0:
    end = s.find('\n}\n', start)
    if end < 0:
        raise SystemExit('existing year helper end missing')
    s = s[:start] + s[end + 3:]
marker = 'const BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP = 160;\n'
helper = '''export const CATALOG_NON_JAPAN_MIN_YEAR = 2020;\nexport const CATALOG_JAPAN_MAX_AGE_YEARS = 15;\nexport function catalogMinYearForMarket(marketValue: unknown) {\n  const market = String(marketValue || "").trim().toLowerCase();\n  return market === "japan" ? new Date().getFullYear() - CATALOG_JAPAN_MAX_AGE_YEARS : CATALOG_NON_JAPAN_MIN_YEAR;\n}\nexport function isCatalogYearAllowed(yearValue: unknown, marketValue?: unknown) {\n  const year = Number(yearValue || 0);\n  const currentYear = new Date().getFullYear();\n  return Number.isFinite(year) && year >= catalogMinYearForMarket(marketValue) && year <= currentYear + 1;\n}\n'''
if 'export function catalogMinYearForMarket' not in s:
    if marker not in s:
        raise SystemExit('offer-quality marker missing')
    s = s.replace(marker, marker + helper, 1)
s = s.replace('if (!isCatalogYearAllowed(year)) return false;', 'if (!isCatalogYearAllowed(year, offer.market)) return false;')
p.write_text(s)

# Generic source recovery: current market determines floor.
p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = CATALOG_MIN_YEAR;', 'const minYear = catalogMinYearForMarket(market);')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = catalogMinYearForMarket(market);')
p.write_text(s)

# Direct UAE/Georgia recovery: both are 2020+.
p = Path('scripts/catalog-live-recovery-direct-exact.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = CATALOG_MIN_YEAR;', 'const minYear = catalogMinYearForMarket(market);')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = catalogMinYearForMarket(market);')
p.write_text(s)

# Japan Prestige conversion retains rolling 15-year window.
p = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, catalogMinYearForMarket } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = CATALOG_MIN_YEAR;', 'const minYear = catalogMinYearForMarket("japan");')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = catalogMinYearForMarket("japan");')
p.write_text(s)

# Shared cumulative publisher. Critical: preserved other markets use THEIR OWN floor.
p = Path('scripts/catalog-live-recovery-publish.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages, isCatalogOfferBusinessLiquid, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const { credibleCatalogImages, isCatalogOfferBusinessLiquid } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = CATALOG_MIN_YEAR;', 'const minYear = catalogMinYearForMarket(market);')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = catalogMinYearForMarket(market);')
s = s.replace('if (year < minYear || year > new Date().getFullYear() + 1) { reject("year"); continue; }', 'if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }')
s = s.replace('if (year < minYear || year > new Date().getFullYear() + 1 || !offer.make || !offer.model || !offer.images.length) continue;', 'if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || !offer.images.length) continue;')
s = s.replace('.filter((offer) => offer.id && offer.make && offer.model && Number(offer.year || 0) >= minYear && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))', '.filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))')
p.write_text(s)

for path in [
    'apps/web/lib/catalog/offer-quality.ts',
    'scripts/catalog-live-recovery-market.mjs',
    'scripts/catalog-live-recovery-direct-exact.mjs',
    'scripts/catalog-live-recovery-japan-prestige.mjs',
    'scripts/catalog-live-recovery-publish.mjs',
]:
    text = Path(path).read_text()
    if path.endswith('offer-quality.ts'):
        required = ['CATALOG_NON_JAPAN_MIN_YEAR = 2020', 'CATALOG_JAPAN_MAX_AGE_YEARS = 15', 'catalogMinYearForMarket', 'isCatalogYearAllowed']
        if any(x not in text for x in required):
            raise SystemExit(f'market year gate missing in {path}')
    elif path.endswith('catalog-live-recovery-japan-prestige.mjs'):
        if 'const minYear = catalogMinYearForMarket("japan");' not in text:
            raise SystemExit(f'Japan year gate missing in {path}')
    else:
        if 'catalogMinYearForMarket' not in text:
            raise SystemExit(f'market year gate missing in {path}')

print('catalog_market_year_gate_patch_ok')
