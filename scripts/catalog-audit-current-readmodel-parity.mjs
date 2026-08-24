import fs from "node:fs/promises";

const { readDataJson } = await import("../apps/web/lib/data.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const OUTPUT = process.env.CATALOG_CURRENT_READMODEL_PARITY_OUTPUT || "catalog-current-readmodel-parity.json";

function fail(code, report) {
  const error = new Error(code);
  error.report = report;
  throw error;
}

const manifest = await readDataJson("catalog/manifest.json", { generationId: "", markets: {} });
const generationId = String(manifest?.generationId || "");
if (!generationId) fail("catalog_current_readmodel_manifest_missing", { generationId });

const allProjection = await readDataJson("catalog/public/projection/all.json", { generationId: "", items: [] });
const allItems = Array.isArray(allProjection?.items) ? allProjection.items : [];
const expectedByMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Math.max(0, Number(manifest?.markets?.[market]?.count || 0))]));
const actualAllByMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, allItems.filter((item) => String(item?.market || "") === market).length]));
const expectedTotal = Object.values(expectedByMarket).reduce((sum, value) => sum + value, 0);

const marketProjectionReports = {};
const mismatches = [];

if (String(allProjection?.generationId || "") !== generationId) {
  mismatches.push({ scope: "all", reason: "generation", actual: String(allProjection?.generationId || ""), expected: generationId });
}
if (allItems.length !== expectedTotal) {
  mismatches.push({ scope: "all", reason: "count", actual: allItems.length, expected: expectedTotal });
}

for (const market of PUBLIC_CATALOG_MARKETS) {
  const expected = expectedByMarket[market];
  const allCount = actualAllByMarket[market];
  const projection = await readDataJson(`catalog/public/projection/${market}.json`, { generationId: "", items: [] });
  const items = Array.isArray(projection?.items) ? projection.items : [];
  const projectionGenerationId = String(projection?.generationId || "");
  marketProjectionReports[market] = {
    expected,
    allProjectionCount: allCount,
    marketProjectionCount: items.length,
    generationId: projectionGenerationId,
  };
  if (allCount !== expected) mismatches.push({ scope: market, reason: "all_projection_count", actual: allCount, expected });
  if (projectionGenerationId !== generationId) mismatches.push({ scope: market, reason: "generation", actual: projectionGenerationId, expected: generationId });
  if (items.length !== expected) mismatches.push({ scope: market, reason: "market_projection_count", actual: items.length, expected });
}

const report = {
  version: 1,
  checkedAt: new Date().toISOString(),
  generationId,
  expectedTotal,
  allProjectionCount: allItems.length,
  expectedByMarket,
  actualAllByMarket,
  marketProjections: marketProjectionReports,
  mismatches,
  ok: mismatches.length === 0,
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));

if (mismatches.length) {
  const first = mismatches[0];
  fail(`catalog_current_readmodel_manifest_mismatch:${first.scope}:${first.reason}:${first.actual}:${first.expected}`, report);
}
