import fs from "node:fs/promises";

const { readDataJson } = await import("../apps/web/lib/data.ts");
const {
  CATALOG_CHUNK_SIZE,
  chunkName,
  offerPath,
  readMarketOffers,
} = await import("../apps/web/lib/catalog/storage.ts");

const market = String(process.env.RECOVERY_RESTORE_MARKET || "").trim();
const generationId = String(process.env.RECOVERY_RESTORE_GENERATION || "").trim();
const output = String(process.env.RECOVERY_RESTORE_OUTPUT || `catalog-rebuild-${market}.json`).trim();
const reportOutput = String(process.env.RECOVERY_RESTORE_REPORT || `catalog-restore-${market}-generation-report.json`).trim();
const minimumGenerationCount = Math.max(1, Number(process.env.RECOVERY_RESTORE_MIN_COUNT || 1));
const maxChunks = Math.max(1, Math.min(1_000, Number(process.env.RECOVERY_RESTORE_MAX_CHUNKS || 100)));

if (!market) throw new Error("recovery_restore_market_missing");
if (!/^gen_[a-zA-Z0-9_-]+$/.test(generationId)) throw new Error("recovery_restore_generation_invalid");

const generationRows = [];
const chunkPaths = [];
for (let index = 1; index <= maxChunks; index += 1) {
  const chunk = chunkName(index);
  const path = offerPath(generationId, market, chunk);
  const rows = await readDataJson(path, []);
  if (!Array.isArray(rows)) throw new Error(`recovery_restore_chunk_invalid:${path}`);
  if (!rows.length) break;
  generationRows.push(...rows);
  chunkPaths.push(path);
  if (rows.length < CATALOG_CHUNK_SIZE) break;
}

const invalidGenerationRows = generationRows.filter((offer) => !offer?.id || String(offer?.market || "") !== market);
if (invalidGenerationRows.length) throw new Error(`recovery_restore_generation_rows_invalid:${invalidGenerationRows.length}`);
if (generationRows.length < minimumGenerationCount) {
  throw new Error(`recovery_restore_generation_count_below_min:${generationRows.length}<${minimumGenerationCount}`);
}

const currentRows = await readMarketOffers(market);
const merged = new Map();
for (const offer of generationRows) merged.set(String(offer.id), offer);
for (const offer of currentRows) {
  if (!offer?.id || String(offer?.market || "") !== market) continue;
  merged.set(String(offer.id), offer);
}
const offers = [...merged.values()];
if (offers.length < generationRows.length) {
  throw new Error(`recovery_restore_merge_shrank:${offers.length}<${generationRows.length}`);
}

const report = {
  version: 1,
  mode: "restore_market_from_immutable_generation",
  market,
  generationId,
  generationCount: generationRows.length,
  currentCount: currentRows.length,
  mergedCount: offers.length,
  duplicateCount: generationRows.length + currentRows.length - offers.length,
  chunkPaths,
  output,
};

await fs.writeFile(output, JSON.stringify({ market, offers }, null, 2));
await fs.writeFile(reportOutput, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
