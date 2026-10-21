import fs from "node:fs/promises";

process.env.CATALOG_KNOWLEDGE_DISABLED = "1";
process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH = "1";
process.env.PRESTIGE_JAPAN_DESIRED_SOLD_PER_FETCH = "20";

const { prestigeJapanExactSource: source } = await import("../apps/web/lib/catalog/prestige-japan-exact-source.ts");
const { mapWithConcurrency, rotatedPrestigePlanCandidates } = await import("../apps/web/lib/catalog/prestige-japan-partition-plan.ts");

const rawBudget = Math.max(1_000, Number(process.env.PRESTIGE_PLAN_RAW_BUDGET || 100_000));
const maxPartitions = Math.max(1, Math.min(500, Number(process.env.PRESTIGE_PLAN_MAX_PARTITIONS || 220)));
const maxMakes = Math.max(1, Math.min(100, Number(process.env.PRESTIGE_PLAN_MAX_MAKES || 100)));
const rawPerModel = Math.max(20, Math.min(200, Number(process.env.PRESTIGE_PLAN_RAW_PER_MODEL || 60)));
const startModelIndex = Math.max(0, Math.min(10_000, Number(process.env.PRESTIGE_PLAN_START_MODEL_INDEX || 0)));
const planConcurrency = Math.max(1, Math.min(8, Number(process.env.PRESTIGE_PLAN_CONCURRENCY || 4)));
const commercial = /(?:FORK|FORKLIFT|LOADER|EXCAVATOR|TRACTOR|CRANE|DUMP|TRUCK|BUS|COASTER|DYNA|TOYOACE|DUTRO|CANTER|ELF|FORWARD|GIGA|PROFIA|FD\d|FG\d|FGL|FDL|SDK)/i;

const makes = await source.makes();
const selectedMakes = makes.slice(0, maxMakes);
const makeLists = await mapWithConcurrency(selectedMakes, planConcurrency, async (make, makeIndex) => {
  const sourceModels = await source.models(make);
  const usableModels = sourceModels
    .map((model, modelIndex) => ({ model, modelIndex }))
    .filter(({ model }) => !commercial.test(String(model?.name || "")));
  return { make, makeIndex, models: usableModels };
});
const candidates = rotatedPrestigePlanCandidates(makeLists, startModelIndex);
console.log(JSON.stringify({ phase: "plan_inventory", makes: makeLists.length, candidates: candidates.length, startModelIndex, planConcurrency }));

const partitions = [];
const models = [];
let plannedRows = 0;
let candidateOffset = 0;

// Round-robin across every available make and model. We deliberately do not
// cap the number of distinct models per make. The final catalog cap is only
// 10–20 offers of the same make+model, which keeps variety without hiding
// Toyota/Nissan/Honda model ranges.
//
// The daily start is circular per make: a high day offset never skips shorter
// model lists. Bounded parallel probes keep the plan below its one-hour job
// timeout without exceeding the collector's existing source concurrency.
while (candidateOffset < candidates.length && partitions.length < maxPartitions && plannedRows < rawBudget) {
  const batch = candidates.slice(candidateOffset, candidateOffset + planConcurrency);
  candidateOffset += batch.length;
  const probes = await mapWithConcurrency(batch, planConcurrency, async ({ make, makeIndex, model, modelIndex }) => {
    try {
      const probe = await source.searchPage(make, model, 0);
      return { make, makeIndex, model, modelIndex, total: Math.max(0, Number(probe?.total || 0)) };
    } catch (error) {
      return { make, makeIndex, model, modelIndex, total: 0, error: String(error?.message || error) };
    }
  });

  for (const probe of probes) {
    const { make, makeIndex, model, modelIndex, total } = probe;
    models.push({ makeIndex, modelIndex, make: make.name, model: model.name, total, ...(probe.error ? { error: probe.error } : {}) });
    if (!total) continue;
    const remainingBudget = rawBudget - plannedRows;
    if (remainingBudget <= 0 || partitions.length >= maxPartitions) break;
    const plannedForModel = Math.max(1, Math.min(total, rawPerModel, remainingBudget));
    partitions.push({
      id: `m${makeIndex}-d${modelIndex}-o0`,
      makeIndex,
      modelIndex,
      make: make.name,
      model: model.name,
      startCursor: `${makeIndex}:${modelIndex}:0`,
      endOffset: plannedForModel,
      maxPages: Math.max(1, Math.ceil(plannedForModel / 20)),
      plannedRows: plannedForModel,
    });
    plannedRows += plannedForModel;
  }
}

if (!partitions.length) throw new Error("prestige_partition_plan_empty");
const complete = candidateOffset >= candidates.length;
const matrix = { include: partitions };
const report = {
  generatedAt: new Date().toISOString(),
  sourceId: "prestige_japan_auctions_open",
  traversal: "round_robin_all_make_models",
  startModelIndex,
  rawBudget,
  rawPerModel,
  maxPartitions,
  maxMakes,
  planConcurrency,
  plannedRows,
  partitionCount: partitions.length,
  complete,
  models,
  partitions,
};
await fs.writeFile("prestige-japan-strict-partition-plan.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ startModelIndex, plannedRows, partitionCount: partitions.length, rawPerModel, maxMakes, complete, first: partitions.slice(0, 12), last: partitions.slice(-6) }, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nplanned_rows=${plannedRows}\npartition_count=${partitions.length}\ncomplete=${complete}\n`);
}
