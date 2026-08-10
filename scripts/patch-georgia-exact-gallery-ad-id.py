from pathlib import Path

p = Path('apps/web/lib/catalog/auto-georgia-strict-source.ts')
s = p.read_text()

old = '''function imageUrls(markup: string, base: string) {\n  const values: string[] = [];\n  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\\s*=\\s*["']([^"']+)["'][^>]*>/gi)) values.push(match[1]);\n  for (const match of markup.matchAll(/(?:data-srcset|srcset)\\s*=\\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\\s+/)[0]));\n  for (const match of markup.matchAll(/https?:\\\\?\\/\\\\?\\/[^"'\\\\\\s<>]+?\\.(?:jpe?g|png|webp|avif)(?:\\?[^"'\\\\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\\\\//g, "/"));\n  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];\n}\n'''
new = old + '''\nexport function autoGeorgiaImageBelongsToListing(value: string, listingId: unknown) {\n  const id = String(listingId || "").trim().toLocaleLowerCase("en-US");\n  if (!id) return false;\n  try {\n    const pathname = decodeURIComponent(new URL(String(value || "")).pathname).toLocaleLowerCase("en-US");\n    return pathname.includes(`/ad${id}/`);\n  } catch { return false; }\n}\nfunction listingImageUrls(markup: string, base: string, listingId: unknown) {\n  return imageUrls(markup, base).filter((url) => autoGeorgiaImageBelongsToListing(url, listingId));\n}\n'''
if old not in s:
    raise SystemExit('imageUrls block not found')
s = s.replace(old, new, 1)

old = '''      images: imageUrls(card, pageUrl).slice(0, 30),'''
new = '''      images: listingImageUrls(card, pageUrl, id).slice(0, 30),'''
if old not in s:
    raise SystemExit('listing images assignment not found')
s = s.replace(old, new, 1)

old = '''        raw: { ...row, images: row.images, listingBoundImages: true, photoIdentityVerified: true },'''
new = '''        raw: {\n          ...row,\n          images: row.images.filter((url) => autoGeorgiaImageBelongsToListing(url, row.id)),\n          listingBoundImages: row.images.length > 0 && row.images.every((url) => autoGeorgiaImageBelongsToListing(url, row.id)),\n          photoIdentityVerified: row.images.length > 0 && row.images.every((url) => autoGeorgiaImageBelongsToListing(url, row.id)),\n        },'''
if old not in s:
    raise SystemExit('raw identity flags assignment not found')
s = s.replace(old, new, 1)

old = '''    let urls = [...new Set((row.images || []).map(String).filter(Boolean))];'''
new = '''    let urls = [...new Set((row.images || []).map(String).filter((url) => autoGeorgiaImageBelongsToListing(url, row.id)))];'''
if old not in s:
    raise SystemExit('fetchImages initial urls not found')
s = s.replace(old, new, 1)

old = '''        urls = [...new Set([...urls, ...imageUrls(detail.markup, detail.response.url || detailUrl)])];'''
new = '''        urls = [...new Set([...urls, ...listingImageUrls(detail.markup, detail.response.url || detailUrl, row.id)])];'''
if old not in s:
    raise SystemExit('detail image append not found')
s = s.replace(old, new, 1)

old = '''        (offer.operational.raw as any).detailIdentityVerified = true;'''
new = '''        (offer.operational.raw as any).detailIdentityVerified = true;\n        (offer.operational.raw as any).listingBoundImages = urls.length > 0;\n        (offer.operational.raw as any).photoIdentityVerified = urls.length > 0;'''
if old not in s:
    raise SystemExit('detail identity marker not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('georgia_exact_gallery_ad_id_patch_ok')
