from pathlib import Path

p = Path('apps/web/lib/catalog/auto-georgia-source.ts')
s = p.read_text()

needle = '''function collectImages(markup: string, baseUrl: string) {\n  const candidates: string[] = [];\n  for (const match of markup.matchAll(/<(?:img|source|meta)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\\s*=\\s*["']([^"']+)["']/gi)) candidates.push(match[1]);\n  for (const match of markup.matchAll(/(?:data-srcset|srcset)\\s*=\\s*["']([^"']+)["']/gi)) {\n    match[1].split(",").forEach((item) => candidates.push(item.trim().split(/\\s+/)[0]));\n  }\n  for (const match of markup.matchAll(/https?:\\\\?\\/\\\\?\\/[^"'\\\\\\s<>]+/gi)) candidates.push(match[0].replace(/\\\\\\//g, "/"));\n  return [...new Set(candidates\n    .map((item) => absoluteUrl(item, baseUrl))\n    .filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url) && /auto\\.ge|cloudfront|amazonaws|imgix|imagekit/i.test(url)))];\n}\n'''
addition = needle + '''\nexport function autoGeorgiaImageMatchesListing(url: string, listingId: string) {\n  const expected = String(listingId || "").trim();\n  if (!expected) return false;\n  try {\n    const imageUrl = new URL(url);\n    const imageListingId = imageUrl.pathname.match(/\\/ad(\\d+)\\//i)?.[1] || "";\n    return imageListingId === expected;\n  } catch {\n    return false;\n  }\n}\n\nfunction listingBoundImages(urls: string[], listingId: string) {\n  return [...new Set(urls)].filter((url) => autoGeorgiaImageMatchesListing(url, listingId));\n}\n'''
if needle not in s:
    raise SystemExit('collectImages marker not found')
s = s.replace(needle, addition, 1)

old = '''      images: collectImages(card, pageUrl),'''
new = '''      images: listingBoundImages(collectImages(card, pageUrl), id),'''
if old not in s:
    raise SystemExit('parseList images marker not found')
s = s.replace(old, new, 1)

old = '''    const saved: CatalogImage[] = [];\n    for (const url of [...new Set(urls)].slice(0, limit * 4)) {'''
new = '''    urls = listingBoundImages(urls, row.id);\n    const saved: CatalogImage[] = [];\n    for (const url of urls.slice(0, limit * 4)) {'''
if old not in s:
    raise SystemExit('fetchImages marker not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('auto_georgia_gallery_source_id_patch_ok')
