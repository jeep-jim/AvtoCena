import fs from "node:fs/promises";
import path from "node:path";

const { appendChunkedDataJson, getDataRoot } = await import("../apps/web/lib/data.ts");

const collections = [
  { relativePath: "catalog/vehicle-knowledge/models.json", label: "models" },
  { relativePath: "catalog/vehicle-knowledge/variants.json", label: "variants" },
];

const report = { version: 1, syncedAt: new Date().toISOString(), collections: {} };
for (const collection of collections) {
  const filename = path.join(getDataRoot(), collection.relativePath);
  const rows = JSON.parse(await fs.readFile(filename, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`vehicle_knowledge_seed_not_array_${collection.label}`);
  let processed = 0;
  for (const row of rows) {
    if (!row?.id) continue;
    await appendChunkedDataJson(collection.relativePath, row);
    processed++;
  }
  report.collections[collection.label] = { seedRows: rows.length, processed };
}

console.log(JSON.stringify(report, null, 2));
