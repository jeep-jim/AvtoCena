import fs from "node:fs/promises";
import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { autohomeNewExactSource } from "../apps/web/lib/catalog/autohome-new-exact-source.ts";

const limit = Math.max(1, Math.min(1500, Number(process.env.GALLERY_REFRESH_LIMIT || 50)));
const output = String(process.env.GALLERY_REFRESH_OUTPUT || "catalog-autohome-gallery-refresh.json");
const reportOutput = String(process.env.GALLERY_REFRESH_REPORT || "catalog-autohome-gallery-refresh-report.json");
const directRe = /^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i;
const resizedRe = /(?:g\.autoimg\.cn\/@img\/|\/(?:240|300|320|360|400|480)x0[_-]|\/(?:small|thumb|thumbnail)\/)/i;

function urls(offer: any) {
  return (Array.isArray(offer?.images) ? offer.images : []).map((x: any) => String(x?.url || "")).filter(Boolean);
}
function needsRefresh(offer: any) {
  if (String(offer?.sourceId || "") !== "autohome_new_china_open") return false;
  const list = urls(offer);
  return list.length < 8 || list.some((url: string) => resizedRe.test(url)) || !list.every((url: string) => directRe.test(url));
}
function score(offer: any) {
  const list = urls(offer);
  return (list.length < 5 ? 1000 : 0) + list.filter((u: string) => resizedRe.test(u)).length * 20 + Math.max(0, 30 - list.length);
}

const current: any[] = await readMarketOffers("china");
const candidates = current.filter(needsRefresh).sort((a,b) => score(b) - score(a)).slice(0, limit);
const refreshed: any[] = [];
const failures: any[] = [];
const samples: any[] = [];
for (let index = 0; index < candidates.length; index++) {
  const original = candidates[index];
  const probe = structuredClone(original);
  probe.images = [];
  let exactImages: any[] = [];
  let error = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      exactImages = await autohomeNewExactSource.fetchImages(probe);
      break;
    } catch (e: any) {
      error = String(e?.message || e);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1800));
    }
  }
  const exact = exactImages.filter((img: any) => directRe.test(String(img?.url || ""))).slice(0, 30);
  if (exact.length < 5) {
    failures.push({ id: original.id, sourceOfferId: original.sourceOfferId, before: urls(original).length, exact: exact.length, error: error || "exact_gallery_below_5" });
    continue;
  }
  const sourceRaw = original?.operational?.raw || {};
  const probeRaw = probe?.operational?.raw || {};
  const next = {
    ...original,
    images: exact,
    operational: {
      ...(original?.operational || {}),
      photoIdentityVerified: true,
      raw: {
        ...sourceRaw,
        galleryUrl: probeRaw.galleryUrl || sourceRaw.galleryUrl,
        exactGalleryUrl: probeRaw.exactGalleryUrl || sourceRaw.exactGalleryUrl,
        exactGalleryImageCount: exact.length,
        photoIdentityVerified: true,
        listingBoundImages: true,
        recoveryExactSourceUrl: true,
        recoveryExactPhotoIdentity: true,
        recoveryCalculatedRub: true,
        recoveryBodySourceOnly: true,
        galleryRefreshAt: new Date().toISOString(),
      },
    },
  };
  refreshed.push(next);
  if (samples.length < 12 || String(original.sourceOfferId) === "68589") {
    samples.push({ id: original.id, sourceOfferId: original.sourceOfferId, before: urls(original), after: exact.map((x: any) => x.url) });
  }
  if ((index + 1) % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 1200));
}

const payload = { version: 1, mode: "autohome_exact_public_gallery_refresh", market: "china", offers: refreshed };
const report = {
  version: 1,
  market: "china",
  publicCount: current.length,
  candidateCount: current.filter(needsRefresh).length,
  attempted: candidates.length,
  refreshed: refreshed.length,
  failed: failures.length,
  beforeBelow5: current.filter((o) => String(o?.sourceId || "") === "autohome_new_china_open" && urls(o).length < 5).length,
  refreshedBelow5: refreshed.filter((o) => urls(o).length < 5).length,
  samples,
  failures: failures.slice(0, 80),
  passed: candidates.length > 0 && refreshed.length > 0 && refreshed.every((o) => urls(o).length >= 5 && urls(o).every((u: string) => directRe.test(u))),
};
await fs.writeFile(output, JSON.stringify(payload, null, 2));
await fs.writeFile(reportOutput, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
