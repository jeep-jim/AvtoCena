from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one block in {path}, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Encar: use only the designated listing cover + source photo list, not a recursive
# scrape of every image-like field in the detail JSON (inspection/engine/etc.).
replace_once(
    "apps/web/lib/catalog/encar-complete-source.ts",
    'import { EncarDirectAdapter, buildEncarImageUrl } from "./adapters";',
    'import { EncarDirectAdapter, buildEncarImageUrl, extractEncarImageUrls } from "./adapters";',
)
replace_once(
    "apps/web/lib/catalog/encar-complete-source.ts",
    "    const detailUrls = uniqueUrls(collectImageValues(detail), limit * 4);\n    const gallery = detailUrls.slice(0, limit).map(urlImage);",
    "    const detailUrls = uniqueUrls(extractEncarImageUrls(offer, detail), limit * 2);\n    const gallery = detailUrls.slice(0, limit).map(urlImage);",
)
replace_once(
    "apps/web/lib/catalog/encar-complete-source.ts",
    '      gallerySafetyMode: "encar_detail_only_v2",',
    '      gallerySafetyMode: "encar_source_cover_photolist_v3",',
)

# KCar: exact-detail data can contain a VR/extra set that should not become the
# public cover. Collect only exact car-id HQ images, put the non-/extra/ primary
# set first, and reject the gallery if no primary frame exists.
p = Path("apps/web/lib/catalog/kcar-exact-source.ts")
text = p.read_text()
start = text.index("function exactVehicleGallery(data: KCarDetailData, carCd: string) {")
end = text.index("\n}\n\nfunction parseExactDetail", start) + 3
new_block = r'''function collectExactKCarImages(value: unknown, numericId: string, output: string[] = [], depth = 0) {
  if (value == null || depth > 12) return output;
  if (typeof value === "string") {
    const candidates = value
      .split(",")
      .map((item) => item.trim().replace(/^[\'\"]+|[\'\"]+$/g, "").trim());
    const matcher = new RegExp(`^https://img\\.kcar\\.com/3dcarpicture/\\d{4}/\\d{2}/\\d+/${numericId}_[0-9]+/.+?_hq\\.(?:jpe?g|webp)(?:[?#].*)?$`, "i");
    for (const candidate of candidates) if (matcher.test(candidate)) output.push(candidate);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectExactKCarImages(item, numericId, output, depth + 1));
    return output;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectExactKCarImages(item, numericId, output, depth + 1));
  }
  return output;
}

function exactVehicleGallery(data: KCarDetailData, carCd: string) {
  const numericId = carCd.replace(/^[^0-9]+/, "");
  if (!numericId) return [];
  const unique = [...new Set(collectExactKCarImages(data, numericId))];
  const primary = unique.filter((url) => !/\/extra\//i.test(url));
  const extra = unique.filter((url) => /\/extra\//i.test(url));
  if (!primary.length) return [];
  return [...primary, ...extra].slice(0, 30);
}
'''
p.write_text(text[:start] + new_block + text[end:])
replace_once(
    "apps/web/lib/catalog/kcar-exact-source.ts",
    '          gallerySafetyMode: "kcar_vrvo_v_src_show_exact_car_id_hq_v1",',
    '          gallerySafetyMode: "kcar_exact_car_id_primary_then_extra_hq_v2",',
)

print("korea_primary_gallery_patch_ok")
