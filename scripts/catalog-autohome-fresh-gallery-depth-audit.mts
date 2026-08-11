import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";

const limit = Math.max(10, Math.min(240, Number(process.env.AUDIT_LIMIT || 120)));
const maxPages = Math.max(1, Math.min(40, Number(process.env.AUDIT_MAX_PAGES || 16)));
const minYear = 2020;
const directRe = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;

const rows:any[] = [];
const errors:Record<string,number> = {};
let cursor:string|null = "1";
let pages = 0;
let seen = 0;
let eligible = 0;

function reject(key:string){ errors[key] = Number(errors[key] || 0) + 1; }
function sleep(ms:number){ return new Promise((resolve)=>setTimeout(resolve,ms)); }

while (cursor && pages < maxPages && rows.length < limit) {
  let page:any;
  try {
    page = await autohomeNewExactSource.fetchPage(cursor);
  } catch (error:any) {
    reject(`page:${String(error?.message || error).slice(0,120)}`);
    break;
  }
  pages++;
  const items = Array.isArray(page?.items) ? page.items : [];
  seen += items.length;
  for (const raw of items) {
    if (rows.length >= limit) break;
    const offer = autohomeNewExactSource.normalizeOffer(raw);
    if (!offer) { reject("normalize"); continue; }
    if (Number(offer.year || 0) < minYear) continue;
    eligible++;
    let images:any[] = [];
    let error = "";
    try {
      images = await autohomeNewExactSource.fetchImages(offer);
    } catch (value:any) {
      error = String(value?.message || value);
      reject(error.split(":")[0] || "fetch_images");
    }
    const direct = images.filter((image:any)=>directRe.test(String(image?.url || "")));
    const op:any = offer.operational || {};
    rows.push({
      sourceOfferId: offer.sourceOfferId,
      year: offer.year,
      make: offer.make,
      model: offer.model,
      exact: direct.length,
      exactPhotos: op.exactPhotos === true,
      photoIdentityVerified: op.photoIdentityVerified === true || op.raw?.photoIdentityVerified === true,
      galleryUrl: String(op.raw?.galleryUrl || ""),
      error,
    });
    if (rows.length % 10 === 0) await sleep(650);
  }
  if (page?.finished || !page?.nextCursor) break;
  cursor = String(page.nextCursor);
}

const good = rows.filter((row)=>row.exact >= 5 && row.photoIdentityVerified && row.exactPhotos);
const deep = rows.filter((row)=>row.exact >= 10 && row.photoIdentityVerified && row.exactPhotos);
const shallow = rows.filter((row)=>row.exact < 5);
const modelKeys = new Set(good.map((row)=>`${String(row.make||"").trim().toLowerCase()}|${String(row.model||"").trim().toLowerCase()}`).filter((value)=>value !== "|"));
const distribution:Record<string,number> = {};
for (const row of rows) {
  const bucket = row.exact >= 20 ? "20+" : row.exact >= 10 ? "10-19" : row.exact >= 5 ? "5-9" : row.exact >= 1 ? "1-4" : "0";
  distribution[bucket] = Number(distribution[bucket] || 0) + 1;
}
const report = {
  passed: rows.length >= Math.min(30, limit),
  minYear,
  pages,
  seen,
  eligible,
  attempted: rows.length,
  exactAtLeast5: good.length,
  exactAtLeast10: deep.length,
  shallowBelow5: shallow.length,
  successRatePct: rows.length ? Math.round(good.length / rows.length * 10000) / 100 : 0,
  deepRatePct: rows.length ? Math.round(deep.length / rows.length * 10000) / 100 : 0,
  distinctGoodModels: modelKeys.size,
  exactGallery: {
    min: rows.length ? Math.min(...rows.map((row)=>row.exact)) : 0,
    max: rows.length ? Math.max(...rows.map((row)=>row.exact)) : 0,
    avg: rows.length ? Math.round(rows.reduce((sum,row)=>sum+row.exact,0)/rows.length*100)/100 : 0,
    distribution,
  },
  errors,
  goodSamples: good.slice(0,20),
  shallowSamples: shallow.slice(0,20),
};
console.log(JSON.stringify(report,null,2));
if (!report.passed) process.exit(1);
