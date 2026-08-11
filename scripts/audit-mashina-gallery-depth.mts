import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { mashinaKyrgyzstanListSource } from "../apps/web/lib/catalog/mashina-kyrgyzstan-list-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";

const all: any[] = await readMarketOffers("kyrgyzstan");
const rows = all.filter((row: any) => String(row?.sourceId || "") === "mashina_kyrgyzstan_exact" && Number(row?.year || 0) >= 2020);
const below = rows.filter((row: any) => (Array.isArray(row?.images) ? row.images.length : 0) < 5);
const limit = Math.max(1, Math.min(80, Number(process.env.AUDIT_LIMIT || 50)));
const sample = below
  .sort((a: any, b: any) => String(a?.id || "").localeCompare(String(b?.id || "")))
  .slice(0, limit);

const results: any[] = new Array(sample.length);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(3, sample.length) }, async () => {
  while (true) {
    const index = cursor++;
    if (index >= sample.length) return;
    const row = sample[index];
    const before = Array.isArray(row?.images) ? row.images.length : 0;
    const rawImages = Array.isArray(row?.operational?.raw?.images) ? row.operational.raw.images.length : 0;
    const clone = structuredClone(row);
    clone.images = [];
    try {
      const images = await mashinaKyrgyzstanListSource.fetchImages(clone);
      results[index] = {
        id: row.id,
        sourceOfferId: row.sourceOfferId,
        year: row.year,
        make: row.make,
        model: row.model,
        before,
        rawImages,
        fetched: images.length,
        gallerySourceImageCount: Number(clone?.operational?.gallerySourceImageCount || 0),
        detailIdentityVerified: clone?.operational?.raw?.detailIdentityVerified === true,
        fetchedSizes: images.slice(0, 5).map((img: any) => Number(img?.size || 0)),
      };
    } catch (error: any) {
      results[index] = {
        id: row.id,
        sourceOfferId: row.sourceOfferId,
        year: row.year,
        make: row.make,
        model: row.model,
        before,
        rawImages,
        fetched: 0,
        error: String(error?.message || error),
      };
    }
  }
}));

const fetched = results.map((row) => Number(row?.fetched || 0));
const report = {
  checkedAt: new Date().toISOString(),
  publicKyrgyzstanCount: all.length,
  mashina2020PlusCount: rows.length,
  currentBelow5: below.length,
  probed: results.length,
  improvedTo5: results.filter((row) => Number(row?.fetched || 0) >= 5).length,
  deep10: results.filter((row) => Number(row?.fetched || 0) >= 10).length,
  stillBelow5: results.filter((row) => Number(row?.fetched || 0) < 5).length,
  identityVerified: results.filter((row) => row?.detailIdentityVerified === true).length,
  failures: results.filter((row) => row?.error).length,
  averageBefore: results.length ? Math.round(results.reduce((sum, row) => sum + Number(row?.before || 0), 0) / results.length * 100) / 100 : 0,
  averageFetched: results.length ? Math.round(fetched.reduce((sum, value) => sum + value, 0) / results.length * 100) / 100 : 0,
  samples: results,
};
console.log(JSON.stringify(report, null, 2));
