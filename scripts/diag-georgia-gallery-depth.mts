process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_SOURCE_TIMEOUT_MS = "30000";

const { autoGeorgiaStrictSource } = await import("../apps/web/lib/catalog/auto-georgia-strict-source.ts");

const samples: any[] = [];
let cursor: string | null = null;
let pages = 0;
let seen2020 = 0;
const failures: any[] = [];
while (pages < 5 && samples.length < 20) {
  const page = await autoGeorgiaStrictSource.fetchPage(cursor);
  pages++;
  for (const raw of page.items || []) {
    const offer = autoGeorgiaStrictSource.normalizeOffer(raw);
    if (!offer || Number(offer.year || 0) < 2020) continue;
    seen2020++;
    const beforeRaw = Array.isArray((offer.operational?.raw as any)?.images) ? (offer.operational?.raw as any).images.length : 0;
    let images: any[] = [];
    let error = "";
    try { images = await autoGeorgiaStrictSource.fetchImages(offer); }
    catch (e: any) { error = String(e?.message || e); }
    const rawAfter = Array.isArray((offer.operational?.raw as any)?.images) ? (offer.operational?.raw as any).images.length : 0;
    samples.push({
      sourceOfferId: offer.sourceOfferId,
      year: offer.year,
      make: offer.make,
      model: offer.model,
      sourceUrl: offer.operational?.sourceUrl,
      listingCardBoundImages: beforeRaw,
      rawAfter,
      gallerySourceImageCount: offer.operational?.gallerySourceImageCount,
      fetchedImages: images.length,
      imageUrls: images.map((image) => image.url).slice(0, 12),
      error,
    });
    if (error) failures.push({ sourceOfferId: offer.sourceOfferId, error });
    if (samples.length >= 20) break;
  }
  if (!page.nextCursor || page.finished) break;
  cursor = String(page.nextCursor);
}
const histogram = samples.reduce((acc: Record<string, number>, row) => {
  const key = String(row.fetchedImages);
  acc[key] = Number(acc[key] || 0) + 1;
  return acc;
}, {});
const report = {
  checkedAt: new Date().toISOString(),
  pages,
  seen2020,
  sampled: samples.length,
  atLeast5: samples.filter((row) => row.fetchedImages >= 5).length,
  atLeast8: samples.filter((row) => row.fetchedImages >= 8).length,
  averageFetched: samples.length ? Math.round(samples.reduce((sum, row) => sum + row.fetchedImages, 0) / samples.length * 100) / 100 : 0,
  histogram,
  failures,
  samples,
};
console.log(JSON.stringify(report, null, 2));
