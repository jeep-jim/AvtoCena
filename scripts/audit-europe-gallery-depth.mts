import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { otomotoEuropeExactSource } from "../apps/web/lib/catalog/otomoto-exact-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";

const all: any[] = await readMarketOffers("europe");
const rows = all.filter((row: any) => Number(row?.year || 0) >= 2020);
const below = rows.filter((row: any) => (Array.isArray(row?.images) ? row.images.length : 0) < 5);
const bySource = Object.fromEntries([...new Set(below.map((row: any) => String(row?.sourceId || "unknown")))].sort().map((sourceId) => [sourceId, below.filter((row: any) => String(row?.sourceId || "unknown") === sourceId).length]));
const limit = Math.max(1, Math.min(40, Number(process.env.AUDIT_LIMIT || 30)));
const sample = below.slice().sort((a: any,b: any) => String(a?.id || "").localeCompare(String(b?.id || ""))).slice(0, limit);
const results: any[] = [];
for (const row of sample) {
  const before = Array.isArray(row?.images) ? row.images.length : 0;
  const sourceId = String(row?.sourceId || "");
  const rawImages = Array.isArray(row?.operational?.raw?.images) ? row.operational.raw.images.length : Array.isArray(row?.operational?.raw) ? 0 : Array.isArray(row?.operational?.raw?.parsed?.images) ? row.operational.raw.parsed.images.length : 0;
  if (sourceId !== "otomoto_europe_exact") {
    results.push({id:row.id,sourceOfferId:row.sourceOfferId,sourceId,year:row.year,make:row.make,model:row.model,before,rawImages,forcedDetailFetched:null,note:"no_refetch_adapter_for_sparse_source"});
    continue;
  }
  const clone = structuredClone(row);
  const raw: any = clone?.operational?.raw || {};
  // Force the existing exact adapter down its detail-page path even when the stale stored row has 3-4 URLs.
  // This is diagnostic only; no object-store persist occurs in source_urls_only mode.
  clone.operational = {...(clone.operational || {}), raw: {...raw, images: []}};
  try {
    const images = await otomotoEuropeExactSource.fetchImages(clone);
    results.push({id:row.id,sourceOfferId:row.sourceOfferId,sourceId,year:row.year,make:row.make,model:row.model,before,rawImages,forcedDetailFetched:images.length,fetchedSizes:images.slice(0,5).map((image:any)=>Number(image?.size||0))});
  } catch (error:any) {
    results.push({id:row.id,sourceOfferId:row.sourceOfferId,sourceId,year:row.year,make:row.make,model:row.model,before,rawImages,forcedDetailFetched:0,error:String(error?.message||error)});
  }
}
const otomoto = results.filter((row) => row.sourceId === "otomoto_europe_exact");
const report = {
  checkedAt:new Date().toISOString(),
  publicEuropeCount:all.length,
  currentBelow5:below.length,
  below5BySource:bySource,
  probed:results.length,
  otomotoProbed:otomoto.length,
  otomotoImprovedTo5:otomoto.filter((row)=>Number(row.forcedDetailFetched||0)>=5).length,
  otomotoDeep10:otomoto.filter((row)=>Number(row.forcedDetailFetched||0)>=10).length,
  otomotoFailures:otomoto.filter((row)=>row.error).length,
  samples:results,
};
console.log(JSON.stringify(report,null,2));
