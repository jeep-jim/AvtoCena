const { autoGeorgiaStrictSource, autoGeorgiaImageBelongsToListing } = await import("../apps/web/lib/catalog/auto-georgia-strict-source.ts");

const own = "https://fra1.digitaloceanspaces.com/www.auto.ge-65438c79a5d95/listings/01-2026/ad1417232/honda-cr-v-487605184.webp";
const foreign = "https://fra1.digitaloceanspaces.com/www.auto.ge-65438c79a5d95/listings/04-2025/ad1172383/lexus-is-is-2010030178.webp";
if (!autoGeorgiaImageBelongsToListing(own, "1417232")) throw new Error("own_image_not_bound");
if (autoGeorgiaImageBelongsToListing(foreign, "1417232")) throw new Error("foreign_image_not_rejected");

const page = await autoGeorgiaStrictSource.fetchPage("1");
if (!Array.isArray(page.items) || page.items.length < 3) throw new Error(`weak_listing_page:${page.items?.length || 0}`);
let rowsWithImages = 0;
const samples = [];
for (const raw of page.items.slice(0, 20)) {
  const id = String(raw?.id || "");
  const images = Array.isArray(raw?.images) ? raw.images.map(String) : [];
  if (images.length) rowsWithImages++;
  const foreignImages = images.filter((url) => !autoGeorgiaImageBelongsToListing(url, id));
  if (foreignImages.length) throw new Error(`listing_cross_image:${id}:${foreignImages[0]}`);
  const offer = autoGeorgiaStrictSource.normalizeOffer(raw);
  if (!offer) throw new Error(`normalize_failed:${id}`);
  const normalizedRaw = offer.operational?.raw || {};
  const normalizedImages = Array.isArray(normalizedRaw.images) ? normalizedRaw.images.map(String) : [];
  if (normalizedImages.some((url) => !autoGeorgiaImageBelongsToListing(url, id))) throw new Error(`normalized_cross_image:${id}`);
  if (samples.length < 5) samples.push({ id, images: images.length, sourceUrl: offer.operational?.sourceUrl });
}
if (!rowsWithImages) throw new Error("no_listing_bound_images_found");
console.log(JSON.stringify({ pageItems: page.items.length, rowsChecked: Math.min(20, page.items.length), rowsWithImages, samples }, null, 2));
