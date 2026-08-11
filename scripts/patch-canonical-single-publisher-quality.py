from pathlib import Path
p=Path('scripts/catalog-live-recovery-publish.mjs')
s=p.read_text()
s=s.replace('const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");','const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed, hasCredibleOfferContent } = await import("../apps/web/lib/catalog/offer-quality.ts");')
s=s.replace('''function publicExistingStillValid(offer) {\n  return /^https?:\\/\\//i.test(String(offer?.operational?.sourceUrl || ""))\n    && Number(offer?.sourcePrice || 0) > 0\n    && Boolean(String(offer?.sourceCurrency || "").trim())\n    && publishableCalculation(offer)\n    && isCatalogOfferBusinessLiquid(offer);\n}''','''function publicExistingStillValid(offer) {\n  return hasCredibleOfferContent({ ...offer, status: "active" })\n    && publishableCalculation(offer)\n    && isCatalogOfferBusinessLiquid(offer);\n}''')
s=s.replace('''  if (!isCatalogOfferBusinessLiquid(offer)) { reject("business_liquidity"); continue; }\n  if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }''','''  if (!isCatalogOfferBusinessLiquid(offer)) { reject("business_liquidity"); continue; }\n  if (!hasCredibleOfferContent({ ...offer, status: "active" })) { reject("public_quality"); continue; }\n  if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }''')
s=s.replace('''.filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))''','''.filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && publicExistingStillValid(offer))''')
p.write_text(s)
if 'hasCredibleOfferContent' not in s or 'reject("public_quality")' not in s:
    raise SystemExit('canonical publisher patch missing')
print('canonical_single_publisher_quality_patch_ok')
