import fs from "node:fs/promises";
import path from "node:path";

const {
  appendChunkedDataJson,
  readChunkedDataJson,
  updateChunkedDataJson,
} = await import("../apps/web/lib/data.ts");

const REFERENCE_PATH = "catalog/power-reference/30-minute-power.json";
const APPLY = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_CERTIFIED_POWER_SEED || "").toLowerCase());
const seedPath = path.join(process.cwd(), "data", REFERENCE_PATH);
const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));

if (!Array.isArray(seed) || seed.length === 0) throw new Error("certified_power_seed_is_empty");
const ids = new Set();
for (const row of seed) {
  if (!row?.id || ids.has(row.id)) throw new Error(`certified_power_seed_invalid_or_duplicate_id:${String(row?.id || "missing")}`);
  ids.add(row.id);
  if (!row.make || !row.model || !row.sourceDocumentId || !row.sourceUrl || !row.verifiedAt || !row.verifiedBy) {
    throw new Error(`certified_power_seed_missing_provenance:${row.id}`);
  }
  if (!(Number(row.power30MinKw) > 0) || Number(row.power30MinKw) !== Number(row.utilizationPowerKw)) {
    throw new Error(`certified_power_seed_invalid_power:${row.id}`);
  }
}

const existing = await readChunkedDataJson(REFERENCE_PATH, []);
let inserted = 0;
let updated = 0;
if (APPLY) {
  for (const row of seed) {
    const changed = await updateChunkedDataJson(REFERENCE_PATH, row.id, (current) => ({ ...current, ...row }));
    if (changed) updated++;
    else {
      await appendChunkedDataJson(REFERENCE_PATH, row);
      inserted++;
    }
  }
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "validate",
  seedCount: seed.length,
  existingCount: existing.length,
  inserted,
  updated,
  finalCount: APPLY ? (await readChunkedDataJson(REFERENCE_PATH, [])).length : existing.length,
}, null, 2));
