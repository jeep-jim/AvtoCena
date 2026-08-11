from pathlib import Path

# Shared public quality gate
p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
if 'export const CATALOG_MIN_YEAR = 2015;' not in s:
    marker = 'const BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP = 160;\n'
    if marker not in s:
        raise SystemExit('offer-quality marker missing')
    s = s.replace(marker, marker + 'export const CATALOG_MIN_YEAR = 2015;\n', 1)
s = s.replace('if (year < currentYear - 15 || year > currentYear + 1) return false;', 'if (year < CATALOG_MIN_YEAR || year > currentYear + 1) return false;')
p.write_text(s)

# Generic source recovery
p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = CATALOG_MIN_YEAR;')
p.write_text(s)

# Direct UAE/Georgia recovery
p = Path('scripts/catalog-live-recovery-direct-exact.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = CATALOG_MIN_YEAR;')
p.write_text(s)

# Japan Prestige conversion
p = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = CATALOG_MIN_YEAR;')
p.write_text(s)

# Shared cumulative publisher incl. preservation of other markets
p = Path('scripts/catalog-live-recovery-publish.mjs')
s = p.read_text()
s = s.replace('const { credibleCatalogImages, isCatalogOfferBusinessLiquid } = await import("../apps/web/lib/catalog/offer-quality.ts");', 'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, CATALOG_MIN_YEAR } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s = s.replace('const minYear = new Date().getFullYear() - 15;', 'const minYear = CATALOG_MIN_YEAR;')
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
        if 'CATALOG_MIN_YEAR = 2015' not in text or 'year < CATALOG_MIN_YEAR' not in text:
            raise SystemExit(f'2015 gate missing in {path}')
    else:
        if 'const minYear = CATALOG_MIN_YEAR;' not in text:
            raise SystemExit(f'2015 gate missing in {path}')

print('catalog_min_year_2015_patch_ok')
