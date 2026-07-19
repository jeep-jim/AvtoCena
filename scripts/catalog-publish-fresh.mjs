import fs from "node:fs/promises";
import path from "node:path";

const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { persistCatalogOffers } = await import("../apps/web/lib/catalog/storage.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const target = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET || 250));
const markets = ["korea", "china", "japan", "uae", "europe"];
const all = [];
const files = [];
const byMarket = {};
const reports = {};

for (const market of markets) {
  const filename = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(filename, "utf8"));
  const rows = Array.isArray(payload?.offers) ? payload.offers : [];
  const valid = rows.filter((offer) => offer?.market === market && isCrediblePublicOffer(offer));
  if (valid.length < target) throw new Error(`fresh_publish_under_target_${market}_${valid.length}_of_${target}`);
  const selected = valid.slice(0, target);
  all.push(...selected);
  files.push(filename);
  byMarket[market] = selected.length;
  reports[market] = payload.report || {};
}

const unique = new Map();
for (const offer of all) {
  if (unique.has(offer.id)) throw new Error(`fresh_publish_duplicate_offer_id_${offer.id}`);
  unique.set(offer.id, offer);
}

for (const market of markets) {
  const count = [...unique.values()].filter((offer) => offer.market === market).length;
  if (count !== target) throw new Error(`fresh_publish_market_count_${market}_${count}_expected_${target}`);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const offers = [...unique.values()];
const manifest = await persistCatalogOffers(offers);
const publishedAt = new Date().toISOString();
const report = {
  publishedAt,
  generationId: manifest.generationId,
  total: offers.length,
  byMarket,
  files,
  imageStats: offers.reduce((stats, offer) => {
    const count = Array.isArray(offer.images) ? offer.images.length : 0;
    stats.min = Math.min(stats.min, count);
    stats.max = Math.max(stats.max, count);
    stats.total += count;
    return stats;
  }, { min: Number.POSITIVE_INFINITY, max: 0, total: 0 }),
  marketReports: reports,
};
if (!Number.isFinite(report.imageStats.min)) report.imageStats.min = 0;
report.imageStats.average = offers.length ? Number((report.imageStats.total / offers.length).toFixed(2)) : 0;
await fs.writeFile(process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-fresh-publish-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
