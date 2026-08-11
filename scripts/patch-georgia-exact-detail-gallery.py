from pathlib import Path

# AUTO.GE adapter: source_urls_only must return the exact detail-gallery URLs directly.
p = Path('apps/web/lib/catalog/auto-georgia-strict-source.ts')
s = p.read_text()
marker = '''function listingImageUrls(markup: string, base: string, listingId: unknown) {\n  return imageUrls(markup, base).filter((url) => autoGeorgiaImageBelongsToListing(url, listingId));\n}\n'''
addition = '''function sourceCatalogImage(urlValue: string): CatalogImage | null {\n  const url = String(urlValue || "").trim();\n  const extension = url.match(/\\.(jpe?g|webp|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();\n  if (!url || !extension) return null;\n  return {\n    id: "", url, objectKey: "", checksum: "", size: 0,\n    mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",\n  };\n}\n'''
if addition not in s:
    if marker not in s: raise SystemExit('listingImageUrls marker missing')
    s = s.replace(marker, marker + addition, 1)
old = '''    offer.operational.gallerySourceImageCount = urls.length;\n    const saved: CatalogImage[] = [];\n    for (const url of urls.slice(0, limit * 4)) {\n      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);\n      if (image && image.size > 8_000) saved.push(image);\n      if (saved.length >= limit) break;\n    }\n    return saved;\n'''
new = '''    urls = urls.filter((url) => autoGeorgiaImageBelongsToListing(url, row.id)).slice(0, limit);\n    offer.operational.gallerySourceImageCount = urls.length;\n    (offer.operational.raw as any).images = urls;\n    (offer.operational.raw as any).listingBoundImages = urls.length > 0;\n    (offer.operational.raw as any).photoIdentityVerified = urls.length > 0;\n    (offer.operational.raw as any).exactDetailGallery = true;\n\n    // Live recovery deliberately uses source_urls_only. AUTO.GE serves its exact\n    // listing galleries from a public DigitalOcean Spaces origin whose URL embeds\n    // /ad<listingId>/. Do not discard those already identity-verified source photos\n    // just because the generic binary cache host allow-list is narrower.\n    if (String(process.env.CATALOG_IMAGE_STORAGE_MODE || "") === "source_urls_only") {\n      return urls.map(sourceCatalogImage).filter((image): image is CatalogImage => Boolean(image));\n    }\n\n    const saved: CatalogImage[] = [];\n    for (const url of urls) {\n      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);\n      if (image && image.size > 8_000) saved.push(image);\n      if (saved.length >= limit) break;\n    }\n    return saved;\n'''
if old not in s: raise SystemExit('AUTO.GE fetchImages tail missing')
s = s.replace(old, new, 1)
p.write_text(s)

# Direct recovery: enrich Georgia with exact detail gallery before calculating/publishing.
p = Path('scripts/catalog-live-recovery-direct-exact.mjs')
s = p.read_text()
old = '''    const exactImages = rawBoundImages(offer);\n    if (!exactImages.length) { reject(rejections, "exact_images"); continue; }\n    offer.images = exactImages;\n'''
new = '''    let exactImages = rawBoundImages(offer);\n    if (market === "georgia") {\n      try {\n        const detailImages = credibleCatalogImages(await source.fetchImages(offer));\n        if (detailImages.length > exactImages.length) exactImages = detailImages.slice(0, 30);\n      } catch (error) {\n        errors.push({ stage: "exact_gallery", sourceOfferId: offer.sourceOfferId, error: String(error?.message || error) });\n      }\n    }\n    if (!exactImages.length) { reject(rejections, "exact_images"); continue; }\n    offer.images = exactImages;\n'''
if old not in s: raise SystemExit('direct recovery exactImages block missing')
s = s.replace(old, new, 1)
p.write_text(s)

print('georgia_exact_detail_gallery_patch_ok')
