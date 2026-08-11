from pathlib import Path

p = Path('scripts/catalog-live-recovery-publish-batch.mjs')
s = p.read_text()

s = s.replace(
    'const { credibleCatalogImages, isCatalogOfferBusinessLiquid } = await import("../apps/web/lib/catalog/offer-quality.ts");',
    'const { credibleCatalogImages, isCatalogOfferBusinessLiquid, hasCredibleOfferContent, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");',
)
s = s.replace('const minYear = new Date().getFullYear() - 15;\n', '')

old = '''function publicExistingStillValid(offer) {\n  return /^https?:\\/\\//i.test(String(offer?.operational?.sourceUrl || ""))\n    && Number(offer?.sourcePrice || 0) > 0\n    && Boolean(String(offer?.sourceCurrency || "").trim())\n    && publishableCalculation(offer)\n    && isCatalogOfferBusinessLiquid(offer);\n}'''
new = '''function canonicalPublic(offer) {\n  return hasCredibleOfferContent({ ...offer, status: "active" });\n}\nfunction publicExistingStillValid(offer) {\n  return canonicalPublic(offer) && publishableCalculation(offer) && isCatalogOfferBusinessLiquid(offer);\n}'''
if old not in s:
    raise SystemExit('publicExistingStillValid block missing')
s = s.replace(old, new, 1)

s = s.replace(
    'if (year < minYear || year > new Date().getFullYear() + 1) { reject("year"); continue; }',
    'if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }',
)
needle = '    if (!publishableCalculation(offer)) { reject("calculation"); continue; }\n    incoming.set(offer.id, offer);'
replacement = '    if (!publishableCalculation(offer)) { reject("calculation"); continue; }\n    if (!canonicalPublic(offer)) { reject("public_quality"); continue; }\n    incoming.set(offer.id, offer);'
if needle not in s:
    raise SystemExit('incoming canonical marker missing')
s = s.replace(needle, replacement, 1)

s = s.replace(
    'if (year < minYear || year > new Date().getFullYear() + 1 || !offer.make || !offer.model || !offer.images.length) continue;',
    'if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || !offer.images.length) continue;',
)

old_preserve = '    .filter((offer) => offer.id && offer.make && offer.model && Number(offer.year || 0) >= minYear && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))'
new_preserve = '    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && canonicalPublic(offer) && isCatalogOfferBusinessLiquid(offer))'
if old_preserve not in s:
    raise SystemExit('preservation filter marker missing')
s = s.replace(old_preserve, new_preserve, 1)

s = s.replace('    minYear,\n', '    minYear: catalogMinYearForMarket(market),\n')

required = [
    'hasCredibleOfferContent',
    'catalogMinYearForMarket',
    'isCatalogYearAllowed(year, market)',
    'reject("public_quality")',
    'isCatalogYearAllowed(offer.year, other)',
    'minYear: catalogMinYearForMarket(market)',
]
for marker in required:
    if marker not in s:
        raise SystemExit(f'missing patched marker: {marker}')
if 'const minYear = new Date().getFullYear() - 15;' in s:
    raise SystemExit('legacy batch minYear remains')

p.write_text(s)
print('batch_publisher_public_gate_patch_ok')
