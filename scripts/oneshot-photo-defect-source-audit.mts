import { readMarketOffers } from "../apps/web/lib/catalog/storage.ts";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality.ts";

const markets = ["china", "kyrgyzstan", "europe"];
const thumbRe = /(?:g\.autoimg\.cn\/@img\/.*\/(?:240|300|320|360|400)x0_|_(?:small|medium)(?=\.(?:jpe?g|png|webp|avif))|_\d{2,4}x\d{2,4}\.)/i;
const results:any = {};
for (const market of markets) {
  const rows:any[] = await readMarketOffers(market);
  const low = rows.filter((offer:any) => credibleCatalogImages(offer.images || []).length < 5);
  const bySource:any = {};
  for (const offer of low) {
    const source = String(offer.sourceId || "unknown");
    const entry = bySource[source] ||= { count: 0, thumbnailRows: 0, imageCounts: {}, samples: [] as any[] };
    entry.count++;
    const images = (offer.images || []).map((x:any) => String(x?.url || "")).filter(Boolean);
    if (images.some((u:string) => thumbRe.test(u))) entry.thumbnailRows++;
    const count = credibleCatalogImages(offer.images || []).length;
    entry.imageCounts[count] = Number(entry.imageCounts[count] || 0) + 1;
    if (entry.samples.length < 8) entry.samples.push({ id: offer.id, sourceOfferId: offer.sourceOfferId, year: offer.year, make: offer.make, model: offer.model, credible: count, images: images.slice(0, 5) });
  }
  results[market] = { total: rows.length, below5: low.length, bySource };
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
