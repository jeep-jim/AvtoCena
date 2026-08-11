from pathlib import Path

# Canonical/public quality gate: AutoHome new cards need >=5 exact source-bound photos.
p = Path('apps/web/lib/catalog/offer-quality.ts')
s = p.read_text()
old = '''function minimumImageCount(offer: VehicleOffer) {\n  // Japan remains strict because auction-sheet/gallery identity is part of the\n  // completed-lot contract. Normal live-market listings are valid with one\n  // source-bound vehicle photo and may enrich the same card with more later.\n  // Do not use the current workflow's global image threshold for other markets:\n  // a strict Japan publisher must never purge preserved UAE/Georgia/KG rows.\n  if (offer.market === "japan") return offer.sourceId === "jpauc_japan_past_open" ? 3 : 5;\n  return 1;\n}'''
new = '''function minimumImageCount(offer: VehicleOffer) {\n  // AutoHome exact-trim cards are customer-facing stock/config cards, so do not\n  // keep rows whose exact spec page/gallery exposes fewer than five verified\n  // source-bound photos. Never borrow another trim/series gallery to pad depth.\n  if (offer.sourceId === "autohome_new_china_open") return 5;\n  // Japan remains strict because auction-sheet/gallery identity is part of the\n  // completed-lot contract. Other live-market sources remain source-specific and\n  // are tightened separately only after their exact-gallery contracts are proven.\n  if (offer.market === "japan") return offer.sourceId === "jpauc_japan_past_open" ? 3 : 5;\n  return 1;\n}'''
if old not in s:
    raise SystemExit('minimumImageCount block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# Recovery collector: reject weak exact AutoHome galleries before expensive enrichment/calculation.
p = Path('scripts/catalog-live-recovery-market.mjs')
s = p.read_text()
old = '''      if (!offer.images.length) { reject(rejections, "images"); return null; }\n      if (!photoBound(offer)) { reject(rejections, "photo_identity"); return null; }'''
new = '''      if (!offer.images.length) { reject(rejections, "images"); return null; }\n      if (source.sourceId === "autohome_new_china_open" && offer.images.length < 5) {\n        reject(rejections, "exact_gallery_below_5");\n        return null;\n      }\n      if (!photoBound(offer)) { reject(rejections, "photo_identity"); return null; }'''
if old not in s:
    raise SystemExit('collector image gate block not found')
s = s.replace(old, new, 1)
p.write_text(s)

print('china_autohome_min5_exact_patch_ok')
