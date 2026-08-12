from pathlib import Path
import re

path = Path("apps/web/lib/catalog/storage.ts")
text = path.read_text()

if "const [manifest, current] = await Promise.all([readManifest(), readCurrentOfferShard(id)]);" not in text:
    get_pattern = re.compile(
        r'export async function getOffer\(id: string\) \{\n'
        r'  const current = await readCurrentOfferShard\(id\);\n'
        r'  if \(current\.generationId\) \{\n'
        r'    const offer = \(current\.items \|\| \[\]\)\.find\(\(item\) => item\.id === id && isPublicOffer\(item\)\);\n'
        r'    if \(offer\) return offer;\n'
        r'  \}\n'
        r'  const manifest = await readManifest\(\);'
    )
    replacement = (
        'export async function getOffer(id: string) {\n'
        '  const [manifest, current] = await Promise.all([readManifest(), readCurrentOfferShard(id)]);\n'
        '  if (current.generationId === manifest.generationId) {\n'
        '    const offer = (current.items || []).find((item) => item.id === id && isPublicOffer(item));\n'
        '    if (offer) return offer;\n'
        '  }'
    )
    text, count = get_pattern.subn(replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"getOffer patch count={count}")

scope = '  const currentProjectionScope = params.market && params.market !== "any" ? String(params.market) : CURRENT_ALL_MARKETS_PROJECTION;\n'
parallel = '  const [manifest, current] = await Promise.all([\n    readManifest(),\n    readCurrentSearchProjection(currentProjectionScope),\n  ]);\n'
if parallel not in text:
    start_at = text.find(scope)
    if start_at < 0:
        raise SystemExit("searchOffers scope target not found")
    marker = '  const manifest = await readManifest();\n'
    manifest_at = text.find(marker, start_at)
    if manifest_at < 0:
        raise SystemExit("searchOffers manifest target not found")
    old = text[start_at:manifest_at + len(marker)]
    if "readCurrentSearchProjection(currentProjectionScope)" not in old:
        raise SystemExit("searchOffers current projection target missing")
    new = '''  const currentProjectionScope = params.market && params.market !== "any" ? String(params.market) : CURRENT_ALL_MARKETS_PROJECTION;
  const [manifest, current] = await Promise.all([
    readManifest(),
    readCurrentSearchProjection(currentProjectionScope),
  ]);
  if (current.generationId === manifest.generationId) {
    const modelKeys = await projectionModelKeys(params);
    const rows = (current.items || []).filter((row) => catalogSearchProjectionMatches(row, params, modelKeys));
    if (needsProjection) catalogSearchProjectionSort(rows, params.sort || "updatedAt");
    else rows.sort((a, b) => projectionFreshness(b) - projectionFreshness(a) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    if (pageRows.every(projectionCanRenderCard)) {
      return {
        generationId: current.generationId, total, page, pageSize,
        items: pageRows.map(publicOfferFromProjection),
        usedIndexShards: [currentProjectionPath(currentProjectionScope)],
      };
    }
  }
'''
    text = text[:start_at] + new + text[manifest_at + len(marker):]

path.write_text(text)
