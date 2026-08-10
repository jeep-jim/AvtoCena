from pathlib import Path

p = Path('apps/web/lib/catalog/auto-georgia-strict-source.ts')
s = p.read_text()

old = '''    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl || !row.images.length) return null;'''
new = '''    if (!row?.id || !row.make || !row.model || !row.year || !row.price || !row.detailUrl) return null;'''
if old not in s:
    raise SystemExit('normalize guard not found')
s = s.replace(old, new, 1)

old = '''        raw: { ...row, images: row.images, listingBoundImages: true, photoIdentityVerified: true },'''
new = '''        // Listing-page images are discovery hints only. They are never trusted as public gallery identity.\n        // Exact photo identity is granted only after the vehicle detail page is fetched and matched.\n        raw: { ...row, images: row.images, listingBoundImages: false, photoIdentityVerified: false, gallerySafetyMode: "pending_exact_detail_identity" },'''
if old not in s:
    raise SystemExit('raw identity flags not found')
s = s.replace(old, new, 1)

old = '''    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];\n    if (detailUrl && urls.length < limit) {\n      const detail = await request(detailUrl, detailUrl).catch(() => null);\n      if (detail && identityMatches(detail.markup, row)) {\n        urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];\n        const text = plainText(detail.markup);\n        const cc = integer(text.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);\n        const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);\n        offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);\n        offer.powerHp ||= integer(text.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);\n        (offer.operational.raw as any).detailIdentityVerified = true;\n      }\n    }\n    offer.operational.gallerySourceImageCount = urls.length;'''
new = '''    // Never mix listing-page/card images into the public gallery: adjacent listing markup can\n    // contain images from neighbouring vehicles. Start from an empty set and accept images only\n    // from the exact detail URL after make/model identity is verified against that detail markup.\n    let urls: string[] = [];\n    const opRaw = offer.operational.raw as any;\n    opRaw.listingBoundImages = false;\n    opRaw.photoIdentityVerified = false;\n    opRaw.detailIdentityVerified = false;\n    opRaw.gallerySafetyMode = "pending_exact_detail_identity";\n    if (detailUrl) {\n      const detail = await request(detailUrl, detailUrl).catch(() => null);\n      if (detail && identityMatches(detail.markup, row)) {\n        urls = [...new Set(imageUrls(detail.markup, detail.response.url || detailUrl))];\n        const text = plainText(detail.markup);\n        const cc = integer(text.match(/([0-9][0-9\\s,.']{2,5})\\s*(?:cc|cm3|cm³)/i)?.[1]);\n        const liters = Number(text.match(/\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:L|liter|litre)\\b/i)?.[1]?.replace(",", ".") || 0);\n        offer.engineCc ||= cc || (liters >= 0.3 && liters <= 15 ? Math.round(liters * 1_000) : undefined);\n        offer.powerHp ||= integer(text.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|horsepower)\\b/i)?.[1]);\n        opRaw.detailIdentityVerified = true;\n        opRaw.listingBoundImages = true;\n        opRaw.photoIdentityVerified = true;\n        opRaw.gallerySafetyMode = "auto_georgia_exact_detail_v1";\n        (offer.operational as any).photoIdentityVerified = true;\n      }\n    }\n    offer.operational.gallerySourceImageCount = urls.length;'''
if old not in s:
    raise SystemExit('fetchImages identity block not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('georgia_detail_gallery_identity_patch_ok')
