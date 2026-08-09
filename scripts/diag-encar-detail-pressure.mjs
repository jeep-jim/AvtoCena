process.env.CATALOG_RAW_LISTING_MODE ||= "1";
process.env.CATALOG_IMAGE_STORAGE_MODE ||= "source_urls_only";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_ENCAR_DIRECT_LIST_RPM ||= "10";
process.env.CATALOG_ENCAR_DIRECT_LIST_RETRIES ||= "5";
process.env.CATALOG_SOURCE_TIMEOUT_MS ||= "35000";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS ||= "25000";

const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const source = catalogImportSources.find((candidate) => candidate.sourceId === "encar_direct");
if (!source) throw new Error("encar_direct_missing");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pool(rows, limit, worker) {
  let cursor = 0;
  const result = new Array(rows.length);
  await Promise.all(Array.from({length: Math.min(limit, rows.length)}, async () => {
    while (true) {
      const i = cursor++;
      if (i >= rows.length) return;
      result[i] = await worker(rows[i], i);
    }
  }));
  return result;
}

const firstStarted = Date.now();
const first = await source.fetchPage();
const rawRows = Array.isArray(first?.items) ? first.items : [];
const rows = rawRows.map((raw) => source.normalizeOffer(raw)).filter(Boolean);
console.log(JSON.stringify({event:"first_page", elapsedMs:Date.now()-firstStarted, rawRows:rawRows.length, normalizedRows:rows.length, nextCursor:first?.nextCursor || null, sampleIds:rows.slice(0,3).map((row)=>row.sourceOfferId)}));
if (!rows.length || !first?.nextCursor) throw new Error("encar_first_page_missing");

let detailOk = 0;
let detailErr = 0;
const detailStarted = Date.now();
await pool(rows.slice(0, 50), 6, async (offer, index) => {
  const started = Date.now();
  try {
    const images = await source.fetchImages(offer);
    detailOk++;
    if (index < 3 || index % 10 === 0) console.log(JSON.stringify({event:"detail_ok", index, id:offer.sourceOfferId, images:images.length, elapsedMs:Date.now()-started}));
  } catch (error) {
    detailErr++;
    console.log(JSON.stringify({event:"detail_error", index, id:offer.sourceOfferId, elapsedMs:Date.now()-started, name:error?.name || null, message:String(error?.message || error), cause:String(error?.cause?.message || error?.cause || "")}));
  }
});
console.log(JSON.stringify({event:"detail_batch", detailOk, detailErr, elapsedMs:Date.now()-detailStarted}));

async function tryNext(label) {
  const started = Date.now();
  try {
    const page = await source.fetchPage(first.nextCursor);
    console.log(JSON.stringify({event:label, ok:true, rows:Array.isArray(page?.items)?page.items.length:0, nextCursor:page?.nextCursor || null, elapsedMs:Date.now()-started}));
    return true;
  } catch (error) {
    console.log(JSON.stringify({event:label, ok:false, elapsedMs:Date.now()-started, name:error?.name || null, message:String(error?.message || error), cause:String(error?.cause?.message || error?.cause || "")}));
    return false;
  }
}

const immediate = await tryNext("next_page_after_details");
if (!immediate) {
  console.log(JSON.stringify({event:"cooldown", ms:60000}));
  await sleep(60000);
  const recovered = await tryNext("next_page_after_60s_cooldown");
  if (!recovered) process.exit(1);
}
