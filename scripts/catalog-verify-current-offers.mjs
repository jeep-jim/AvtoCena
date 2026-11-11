import fs from "node:fs/promises";

const { getOffer, readCurrentPublicCatalogProjection } = await import("../apps/web/lib/catalog/storage.ts");

const OUTPUT = process.env.CATALOG_OFFER_DETAIL_VERIFY_OUTPUT || "catalog-offer-detail-verify.json";
const requestedMarkets = String(process.env.CATALOG_AUDIT_ASSERT_MARKETS || process.env.CATALOG_REBUILD_MARKETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const samplePerMarket = Math.max(1, Math.min(12, Number(process.env.CATALOG_OFFER_DETAIL_SAMPLE_PER_MARKET || 5)));

const projection = await readCurrentPublicCatalogProjection();
const rows = Array.isArray(projection?.rows) ? projection.rows : [];
const markets = requestedMarkets.length
  ? requestedMarkets
  : [...new Set(rows.map((row) => String(row?.market || "").trim()).filter(Boolean))].sort();

const report = {
  version: 1,
  verifiedAt: new Date().toISOString(),
  generationId: String(projection?.generationId || ""),
  samplePerMarket,
  markets: {},
  errors: [],
};

if (!report.generationId) report.errors.push("current_projection_generation_missing");

for (const market of markets) {
  const marketRows = rows
    .filter((row) => String(row?.market || "") === market && String(row?.id || ""))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const sample = marketRows.slice(0, samplePerMarket);
  const state = {
    projectionCount: marketRows.length,
    sampled: sample.length,
    resolved: 0,
    missing: [],
  };
  if (!marketRows.length) {
    state.missing.push("market_projection_empty");
    report.errors.push(`${market}:market_projection_empty`);
  }
  for (const row of sample) {
    try {
      const offer = await getOffer(String(row.id));
      if (!offer || String(offer.id) !== String(row.id) || String(offer.market || "") !== market) {
        state.missing.push(String(row.id));
        report.errors.push(`${market}:offer_detail_missing:${row.id}`);
      } else {
        state.resolved += 1;
      }
    } catch (error) {
      state.missing.push(String(row.id));
      report.errors.push(`${market}:offer_detail_error:${row.id}:${String(error?.message || error)}`);
    }
  }
  report.markets[market] = state;
}

await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Offer detail read-model verification\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
}
if (report.errors.length) process.exitCode = 1;
