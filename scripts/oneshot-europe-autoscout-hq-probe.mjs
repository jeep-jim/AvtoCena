const { readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { AutoScoutHqAdapter } = await import("../apps/web/lib/catalog/autoscout-hq-source.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");

const rows = (await readMarketOffers("europe")).filter((row) => String(row?.sourceId || "") === "autoscout_europe_open").slice(0, 12);
if (!rows.length) throw new Error("autoscout_rows_missing");
const adapter = new AutoScoutHqAdapter();
const results = [];
for (const row of rows) {
  try {
    const offer = structuredClone(row);
    const images = credibleCatalogImages(await adapter.fetchImages(offer));
    const ok = images.length >= 5
      && images.every((image) => Number(image.width || 0) >= 900 && Number(image.height || 0) >= 600)
      && images.every((image) => String(image.url || "").includes(`/listing-images/${row.sourceOfferId}_`));
    results.push({ id: row.id, sourceOfferId: row.sourceOfferId, ok, count: images.length, first: images[0] ? { url: images[0].url, width: images[0].width, height: images[0].height } : null, galleryVerified: offer.operational?.galleryVerified === true, photoIdentityVerified: offer.operational?.photoIdentityVerified === true, photoResolutionVerified: offer.operational?.photoResolutionVerified === true });
  } catch (error) {
    results.push({ id: row.id, sourceOfferId: row.sourceOfferId, ok: false, error: String(error?.message || error) });
  }
}
const report = { checkedAt: new Date().toISOString(), total: results.length, success: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length, results };
console.log(JSON.stringify(report, null, 2));
await (await import("node:fs/promises")).writeFile("europe-autoscout-hq-probe.json", JSON.stringify(report, null, 2));
if (report.success < Math.min(10, report.total)) process.exitCode = 1;
