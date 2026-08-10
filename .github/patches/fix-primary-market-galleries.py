from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one block in {path}, got {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# Encar: existing designated gallery helper = listing cover + photos/PhotoList.
p = Path("apps/web/lib/catalog/adapters.ts")
text = p.read_text()
start = text.index("export function extractEncarImageUrls")
end = text.index("\n}\n", start) + 3
block = text[start:end]
if ".slice(0, 10);" not in block:
    raise SystemExit("encar image helper cap anchor missing")
block = block.replace(".slice(0, 10);", ".slice(0, 30);", 1)
p.write_text(text[:start] + block + text[end:])

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

# KCar: current code deliberately takes only /extra/ frames. Keep exact car-id
# binding but collect every exact-car HQ image and prioritize non-extra/main set.
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
  return [...primary, ...extra].slice(0, 30);
}
'''
p.write_text(text[:start] + new_block + text[end:])
replace_once(
    "apps/web/lib/catalog/kcar-exact-source.ts",
    '          gallerySafetyMode: "kcar_vrvo_v_src_show_exact_car_id_hq_v1",',
    '          gallerySafetyMode: "kcar_exact_car_id_primary_then_extra_hq_v2",',
)

# Autohome: accept official full-size product image hosts and merge the exact
# spec-bound gallery page into the exact spec page images.
replace_once(
    "apps/web/lib/catalog/autohome-new-exact-source.ts",
    r'const PRODUCT_IMAGE_RE = /^https:\/\/g\.autoimg\.cn\/@img\/car\d?\/cardfs\/product\/.+\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$/i;',
    r'const PRODUCT_IMAGE_RE = /^https:\/\/(?:g|car\d+)\.autoimg\.cn\/(?:@img\/car\d?\/)?cardfs\/product\/.+\.(?:jpe?g|png|webp|avif)(?:[?#].*)?$/i;',
)
replace_once(
    "apps/web/lib/catalog/autohome-new-exact-source.ts",
    "    const gallery = exactProductImages(specPage.body, specPage.response.url || specUrl(specId));\n    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)), verifiedGallery = gallery.length >= minimum;",
    """    const specImages = exactProductImages(specPage.body, specPage.response.url || specUrl(specId));
    const galleryPage = listing?.galleryUrl
      ? await fetchDecoded(listing.galleryUrl, specPage.response.url || specUrl(specId)).catch(() => null)
      : null;
    const galleryImages = galleryPage
      ? exactProductImages(galleryPage.body, galleryPage.response.url || listing?.galleryUrl || specUrl(specId))
      : [];
    const gallery = [...new Set([...specImages, ...galleryImages])].slice(0, 30);
    const minimum = Math.max(5, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)), verifiedGallery = gallery.length >= minimum;""",
)
p = Path("apps/web/lib/catalog/autohome-new-exact-source.ts")
text = p.read_text()
old_mode = 'gallerySafetyMode: "autohome_spec_product_images_v1"'
if text.count(old_mode) != 2:
    raise SystemExit(f"autohome gallery mode expected twice, got {text.count(old_mode)}")
p.write_text(text.replace(old_mode, 'gallerySafetyMode: "autohome_spec_full_product_gallery_v2"'))

# Temporary live source smoke, never committed.
Path("scripts/tmp-gallery-source-smoke.ts").write_text(r'''import { encarCompleteSource } from "../apps/web/lib/catalog/encar-complete-source.ts";
import { kcarKoreaExactSource } from "../apps/web/lib/catalog/kcar-exact-source.ts";
import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= 3; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      console.warn(label, `attempt=${i}`, String((e as Error)?.message || e));
      if (i < 3) await new Promise((resolve) => setTimeout(resolve, 2500 * i));
    }
  }
  throw last;
}

const encarPage: any = await retry("encar_page", () => encarCompleteSource.fetchPage(null));
const encarRaw: any = encarPage.items?.[0];
if (!encarRaw) throw new Error("encar_no_live_row");
const encarOffer: any = encarCompleteSource.normalizeOffer(encarRaw);
if (!encarOffer) throw new Error("encar_normalize_failed");
const encarImages: any[] = await retry("encar_gallery", () => encarCompleteSource.fetchImages(encarOffer));
console.log(JSON.stringify({ source: "encar", id: encarOffer.sourceOfferId, count: encarImages.length, first: encarImages[0]?.url, mode: encarOffer.operational?.gallerySafetyMode }));
if (encarImages.length < 5 || encarOffer.operational?.gallerySafetyMode !== "encar_source_cover_photolist_v3") throw new Error("encar_source_gallery_not_verified");

const kcarPage: any = await retry("kcar_page", () => kcarKoreaExactSource.fetchPage("1"));
const kcarRows: any[] = Array.isArray(kcarPage.items) ? kcarPage.items : [];
const kcarPrimary = kcarRows.filter((row: any) => Array.isArray(row?.images) && row.images.length >= 5 && !/\/extra\//i.test(String(row.images[0] || "")));
console.log(JSON.stringify({ source: "kcar", rows: kcarRows.length, primaryFirstRows: kcarPrimary.length, sampleFirst: kcarPrimary[0]?.images?.[0] || kcarRows[0]?.images?.[0] || null }));
if (!kcarRows.length) throw new Error("kcar_no_live_rows");
if (!kcarPrimary.length) throw new Error("kcar_primary_gallery_not_found_in_exact_detail");

const ahOffer: any = autohomeNewExactSource.normalizeOffer({
  specId: "1014485",
  trimTitle: "2023款2.5T柴油手动四驱智享型JE4D25Q6A",
  year: 2023,
  priceWan: 12.88,
  sourcePriceCny: 128800,
  sourceUrl: "https://www.autohome.com.cn/spec/1014485/",
});
if (!ahOffer) throw new Error("autohome_test_offer_failed");
const ahImages: any[] = await retry("autohome_gallery", () => autohomeNewExactSource.fetchImages(ahOffer));
console.log(JSON.stringify({ source: "autohome", id: ahOffer.sourceOfferId, count: ahImages.length, first: ahImages[0]?.url, mode: ahOffer.operational?.gallerySafetyMode }));
if (ahImages.length < 8 || ahOffer.operational?.gallerySafetyMode !== "autohome_spec_full_product_gallery_v2") throw new Error(`autohome_full_gallery_too_small:${ahImages.length}`);
''')
