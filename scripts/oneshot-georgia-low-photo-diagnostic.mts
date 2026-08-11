import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality.ts";
import { autoGeorgiaImageBelongsToListing, autoGeorgiaStrictSource } from "../apps/web/lib/catalog/auto-georgia-strict-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";

const rows = (await readMarketOffers("georgia")).filter((offer:any) => String(offer.sourceId||"") === "auto_georgia_open" && credibleCatalogImages(offer.images || []).length < 5);
const results:any[] = [];
for (const original of rows) {
  const offer:any = structuredClone(original);
  let images:any[] = [];
  let error = "";
  try { images = await autoGeorgiaStrictSource.fetchImages(offer); }
  catch (e:any) { error = String(e?.message || e); }
  const urls = images.map((image:any) => String(image?.url || "")).filter(Boolean);
  const identityOk = urls.length > 0 && urls.every((url:string) => autoGeorgiaImageBelongsToListing(url, offer.sourceOfferId));
  results.push({ id: offer.id, sourceOfferId: offer.sourceOfferId, year: offer.year, before: credibleCatalogImages(original.images || []).length, exact: urls.length, identityOk, error });
}
const refreshable = results.filter((row) => row.exact >= 5 && row.identityOk);
const blocked = results.filter((row) => row.exact < 5 || !row.identityOk);
const report = { generationCheckedAt: new Date().toISOString(), lowPhotoRows: rows.length, refreshable: refreshable.length, blocked: blocked.length, results, passed: true };
console.log(JSON.stringify(report, null, 2));
