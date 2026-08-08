import fs from "node:fs/promises";

process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH = "1";
process.env.PRESTIGE_JAPAN_DESIRED_SOLD_PER_FETCH = "20";

const { prestigeJapanExactSource: source } = await import("../apps/web/lib/catalog/prestige-japan-exact-source.ts");

const chunkPages = Math.max(10, Math.min(100, Number(process.env.PRESTIGE_PLAN_CHUNK_PAGES || 60)));
const rawBudget = Math.max(30_000, Number(process.env.PRESTIGE_PLAN_RAW_BUDGET || 100_000));
const maxPartitions = Math.max(1, Math.min(220, Number(process.env.PRESTIGE_PLAN_MAX_PARTITIONS || 120)));
const maxMakes = Math.max(1, Math.min(20, Number(process.env.PRESTIGE_PLAN_MAX_MAKES || 10)));
const commercial = /(?:FORK|FORKLIFT|LOADER|EXCAVATOR|TRACTOR|CRANE|DUMP|TRUCK|BUS|COASTER|DYNA|TOYOACE|DUTRO|CANTER|ELF|FORWARD|GIGA|PROFIA|FD\d|FG\d|FGL|FDL|SDK)/i;

const makes = await source.makes();
const partitions = [];
const models = [];
let plannedRows = 0;
let complete = true;

for (let makeIndex = 0; makeIndex < Math.min(makes.length, maxMakes); makeIndex++) {
  const make = makes[makeIndex];
  const makeModels = await source.models(make);
  for (let modelIndex = 0; modelIndex < makeModels.length; modelIndex++) {
    const model = makeModels[modelIndex];
    if (commercial.test(model.name)) continue;
    let total = 0;
    try {
      const probe = await source.searchPage(make, model, 0);
      total = Math.max(0, Number(probe?.total || 0));
    } catch (error) {
      models.push({ makeIndex, modelIndex, make: make.name, model: model.name, total: 0, error: String(error?.message || error) });
      continue;
    }
    models.push({ makeIndex, modelIndex, make: make.name, model: model.name, total });
    if (!total) continue;
    const step = chunkPages * 20;
    for (let offset = 0; offset < total; offset += step) {
      if (partitions.length >= maxPartitions || plannedRows >= rawBudget) { complete = false; break; }
      const endOffset = Math.min(total, offset + step);
      const id = `m${makeIndex}-d${modelIndex}-o${offset}`;
      partitions.push({
        id,
        makeIndex,
        modelIndex,
        make: make.name,
        model: model.name,
        startCursor: `${makeIndex}:${modelIndex}:${offset}`,
        endOffset,
        maxPages: Math.ceil((endOffset - offset) / 20),
        plannedRows: endOffset - offset,
      });
      plannedRows += endOffset - offset;
    }
    if (!complete) break;
  }
  if (!complete) break;
}

if (!partitions.length) throw new Error("prestige_partition_plan_empty");

const matrix = { include: partitions };
const report = {
  generatedAt: new Date().toISOString(),
  sourceId: "prestige_japan_auctions_open",
  chunkPages,
  rawBudget,
  maxPartitions,
  maxMakes,
  plannedRows,
  partitionCount: partitions.length,
  complete,
  models,
  partitions,
};
await fs.writeFile("prestige-japan-strict-partition-plan.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ plannedRows, partitionCount: partitions.length, complete, first: partitions.slice(0, 5), last: partitions.slice(-3) }, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nplanned_rows=${plannedRows}\npartition_count=${partitions.length}\ncomplete=${complete}\n`);
}
