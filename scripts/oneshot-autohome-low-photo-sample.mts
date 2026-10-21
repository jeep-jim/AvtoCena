import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality.ts";
import { rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality.ts";
import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS = "30000";

const rows:any[] = (await readMarketOffers("china")).filter((offer:any) => String(offer.sourceId||"") === "autohome_new_china_open" && credibleCatalogImages(offer.images || []).length < 5);
const sampleSize = Math.min(80, rows.length);
const sampled:any[] = [];
for (let i=0;i<sampleSize;i++) sampled.push(rows[Math.min(rows.length-1, Math.floor((i + 0.5) * rows.length / sampleSize))]);
let cursor = 0;
const results:any[] = new Array(sampled.length);
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= sampled.length) return;
    const original = sampled[index];
    const probe:any = structuredClone(original);
    let images:any[] = [];
    let error = "";
    try { images = await autohomeNewExactSource.fetchImages(probe); }
    catch (e:any) { error = String(e?.message || e); }
    const ranked = rankedCatalogImageUrls({ images });
    const direct = ranked.filter((url:string)=>/^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i.test(url));
    results[index] = { id:original.id, sourceOfferId:original.sourceOfferId, year:original.year, make:original.make, model:original.model, before:credibleCatalogImages(original.images||[]).length, fetched:images.length, ranked:ranked.length, directFullSize:direct.length, refreshable:direct.length>=5, error };
  }
}
await Promise.all(Array.from({length:Math.min(4,sampled.length)},()=>worker()));
const errors:any = {};
for (const row of results) if (row.error) { const key = row.error.replace(/:\d+.*/,"").slice(0,120); errors[key] = Number(errors[key]||0)+1; }
const histogram:any = {};
for (const row of results) histogram[row.directFullSize] = Number(histogram[row.directFullSize]||0)+1;
console.log(JSON.stringify({checkedAt:new Date().toISOString(),population:rows.length,sampleSize:results.length,refreshable:results.filter(x=>x.refreshable).length,refreshRate:results.length?Math.round(results.filter(x=>x.refreshable).length/results.length*1000)/10:0,directHistogram:histogram,errors,samples:results.slice(0,20),passed:true},null,2));
