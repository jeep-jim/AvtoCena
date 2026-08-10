const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");

const market = String(process.env.DIAG_MARKET || "china").trim();
const rows: any[] = await readMarketOffers(market);
const perSource = new Map<string, any>();
const thumbRe = /(?:[_-]\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp|avif))|\/(?:small|thumb|thumbnail)\/|[?&](?:w|width|h|height)=\d{2,4}\b|imageView2|x-oss-process)/i;
const tinyTokenRe = /(?:[_-](?:60x45|80x60|100x75|120x90|160x120|180x135|240x180|320x240|400x300)(?=\.)|\/(?:small|thumb|thumbnail)\/)/i;
const samples: any[] = [];
for (const offer of rows) {
  const sourceId = String(offer?.sourceId || "unknown");
  const images = Array.isArray(offer?.images) ? offer.images : [];
  const urls = images.map((img: any) => String(img?.url || "")).filter(Boolean);
  const item = perSource.get(sourceId) || { sourceId, count: 0, below5: 0, oneImage: 0, imageTotal: 0, thumbUrlCount: 0, tinyTokenCount: 0, samples: [] as any[] };
  item.count++;
  item.imageTotal += urls.length;
  if (urls.length < 5) item.below5++;
  if (urls.length === 1) item.oneImage++;
  item.thumbUrlCount += urls.filter((u: string) => thumbRe.test(u)).length;
  item.tinyTokenCount += urls.filter((u: string) => tinyTokenRe.test(u)).length;
  if ((urls.length < 5 || urls.some((u: string) => thumbRe.test(u))) && item.samples.length < 5) {
    item.samples.push({ id: offer.id, sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model, year: offer.year, imageCount: urls.length, urls: urls.slice(0, 8), sourceUrl: offer?.operational?.sourceUrl });
  }
  perSource.set(sourceId, item);
  if ((String(offer?.id) === "b010e9b57f52ca96a2c93a28" || String(offer?.sourceOfferId) === "68589") && samples.length < 10) {
    samples.push({ target: true, id: offer.id, sourceId, sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model, imageCount: urls.length, urls, sourceUrl: offer?.operational?.sourceUrl });
  }
}
const sourceStats = [...perSource.values()].map((x) => ({ ...x, imageAverage: Number((x.imageTotal / Math.max(1, x.count)).toFixed(2)) })).sort((a,b) => b.below5 - a.below5 || b.count - a.count);
const report = {
  market,
  count: rows.length,
  below5: rows.filter((o) => (o?.images?.length || 0) < 5).length,
  oneImage: rows.filter((o) => (o?.images?.length || 0) === 1).length,
  thumbUrls: rows.reduce((sum,o) => sum + (o?.images || []).filter((i:any) => thumbRe.test(String(i?.url || ""))).length, 0),
  sourceStats,
  targetSamples: samples,
};
console.log(JSON.stringify(report, null, 2));
await (await import("node:fs/promises")).writeFile(`diag-public-image-quality-${market}.json`, JSON.stringify(report, null, 2));
