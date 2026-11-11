// Bounded source -> detail diagnostic. No catalog, cursor or object-storage writes.
import fs from "node:fs/promises";
const market = process.env.CATALOG_PILOT_MARKET;
const markets = ["japan", "china", "korea", "uae", "europe", "georgia"];
if (!markets.includes(market)) throw new Error("Invalid CATALOG_PILOT_MARKET");
process.env.CATALOG_REBUILD_MARKET = market;
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
const { catalogImportSources } = await import("../apps/web/lib/catalog/importer.ts");
const { REQUIRED_CATALOG_SOURCES } = await import("../apps/web/lib/catalog/required-catalog-sources.ts");
const { sourceListingSnapshot } = await import("../apps/web/lib/catalog/source-listing-snapshot.ts");
const report = { version:1, market, generatedAt:new Date().toISOString(), productionWrites:false,
  mode:"one_page_two_details_per_source", sources:[], observations:[] };
const output = `catalog-specification-pilot-${market}.json`;
async function checkpoint() { await fs.writeFile(output, JSON.stringify(report, null, 2)); }
await checkpoint();
for (const required of REQUIRED_CATALOG_SOURCES[market]) {
  const source = catalogImportSources.find(row => row.sourceId === required.sourceId);
  const result = { sourceId:required.sourceId, sourceUrl:required.canonicalUrl, role:required.role,
    listingRows:0, detailAttempts:0, observations:0, status:"not_requested", errors:[] };
  report.sources.push(result);
  if (!source) { result.status = "adapter_missing"; await checkpoint(); continue; }
  try {
    const page = await source.fetchPage();
    result.listingRows = Array.isArray(page.items) ? page.items.length : 0;
    result.health = page.health;
    if (page.health?.blocked) { result.status = "blocked"; await checkpoint(); continue; }
    result.status = result.listingRows ? "list_received" : "empty_or_unavailable";
    const seen = new Set();
    for (const raw of (page.items || [])) {
      let offer;
      try { offer = source.normalizeOffer(raw); } catch { continue; }
      if (!offer?.id || offer.market !== market || seen.has(offer.id)) continue;
      seen.add(offer.id);
      const listing = sourceListingSnapshot(offer, "listing");
      report.observations.push(listing);
      result.observations++;
      result.detailAttempts++;
      await checkpoint();
      try {
        const images = await source.fetchImages(offer);
        if (images?.length) offer.images = images;
        report.observations[report.observations.length - 1] = sourceListingSnapshot(offer, "detail");
      } catch (error) {
        result.errors.push({ offerId:offer.id, stage:"detail", message:String(error?.message || error) });
        if (error?.blocked || /(?:http[_: ](?:401|403|429)|bot.?challenge|captcha)/i.test(String(error?.message || error))) {
          result.status = "blocked";
          break;
        }
      }
      await checkpoint();
      if (result.detailAttempts >= 2) break;
    }
  } catch (error) {
    result.status = error?.blocked ? "blocked" : "list_failed";
    result.errors.push({stage:"list",message:String(error?.message || error)});
  }
  await checkpoint();
}
report.completedAt = new Date().toISOString();
report.summary = { observations:report.observations.length,
  withNamedTables:report.observations.filter(row => row.offer.operational?.sourceSpecifications?.groups?.length).length,
  sourceFailures:report.sources.filter(row => ["adapter_missing","blocked","list_failed","empty_or_unavailable"].includes(row.status)).length };
await checkpoint();
console.log(JSON.stringify({market,...report.summary,output}));
