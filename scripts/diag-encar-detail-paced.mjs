process.env.CATALOG_RAW_LISTING_MODE ||= "1";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_ENCAR_DIRECT_LIST_RPM ||= "10";
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES ||= "5";
process.env.CATALOG_SOURCE_TIMEOUT_MS ||= "35000";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS ||= "25000";

const detailGapMs = Math.max(0, Number(process.env.ENCAR_DIAG_DETAIL_GAP_MS || 2000));
const detailCount = Math.max(1, Math.min(50, Number(process.env.ENCAR_DIAG_DETAIL_COUNT || 20)));
const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const source = catalogImportSources.find((candidate) => candidate.sourceId === "encar_direct");
if (!source) throw new Error("encar_direct_missing");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const firstStarted = Date.now();
const first = await source.fetchPage();
const rawRows = Array.isArray(first?.items) ? first.items : [];
const rows = rawRows.map((raw) => source.normalizeOffer(raw)).filter(Boolean);
console.log(JSON.stringify({event:"first_page", elapsedMs:Date.now()-firstStarted, rawRows:rawRows.length, normalizedRows:rows.length, nextCursor:first?.nextCursor || null, detailGapMs, detailCount}));
if (!rows.length || !first?.nextCursor) throw new Error("encar_first_page_missing");

let detailOk = 0;
let detailErr = 0;
const detailStarted = Date.now();
for (let index = 0; index < Math.min(detailCount, rows.length); index += 1) {
  const offer = rows[index];
  const started = Date.now();
  try {
    const images = await source.fetchImages(offer);
    detailOk++;
    console.log(JSON.stringify({event:"detail_ok", index, id:offer.sourceOfferId, images:images.length, elapsedMs:Date.now()-started}));
  } catch (error) {
    detailErr++;
    console.log(JSON.stringify({event:"detail_error", index, id:offer.sourceOfferId, elapsedMs:Date.now()-started, name:error?.name || null, message:String(error?.message || error), cause:String(error?.cause?.message || error?.cause || "")}));
  }
  if (index + 1 < Math.min(detailCount, rows.length) && detailGapMs) await sleep(detailGapMs);
}
console.log(JSON.stringify({event:"detail_batch", detailOk, detailErr, elapsedMs:Date.now()-detailStarted, effectiveRequestRatePerMinute:Number((60000 / Math.max(1, detailGapMs)).toFixed(2))}));

const nextStarted = Date.now();
try {
  const next = await source.fetchPage(first.nextCursor);
  console.log(JSON.stringify({event:"next_page_after_paced_details", ok:true, rows:Array.isArray(next?.items)?next.items.length:0, nextCursor:next?.nextCursor || null, elapsedMs:Date.now()-nextStarted}));
} catch (error) {
  console.log(JSON.stringify({event:"next_page_after_paced_details", ok:false, elapsedMs:Date.now()-nextStarted, name:error?.name || null, message:String(error?.message || error), cause:String(error?.cause?.message || error?.cause || "")}));
  process.exit(1);
}
