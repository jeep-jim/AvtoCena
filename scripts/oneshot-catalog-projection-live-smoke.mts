import { performance } from "node:perf_hooks";
import { readCatalogFacets, searchOffers } from "../apps/web/lib/catalog/storage.ts";

const cases: Array<{ name: string; params: any; validate?: (items: any[]) => void }> = [];
const between = (value: number, min: number, max: number) => value >= min && value <= max;

async function timed<T>(name: string, fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round((performance.now() - start) * 10) / 10;
  console.log(JSON.stringify({ event: "catalog_smoke_timing", name, ms }));
  return { value, ms };
}

const baseline = await timed("europe.market.page48", () => searchOffers({ market: "europe", page: 1, pageSize: 48, sort: "updatedAt" }));
if (!baseline.value.items.length) throw new Error("europe_market_empty");
if (baseline.value.items.some((x: any) => x.market !== "europe" || Number(x.year || 0) < 2020)) throw new Error("europe_market_invariant_failed");
const sample = baseline.value.items.find((x: any) => String(x.make || "").trim() && String(x.model || "").trim()) || baseline.value.items[0];

cases.push(
  {
    name: "europe.year.2024-2026",
    params: { market: "europe", yearFrom: 2024, yearTo: 2026, page: 1, pageSize: 48, sort: "updatedAt" },
    validate: (items) => { if (items.some((x: any) => !between(Number(x.year || 0), 2024, 2026))) throw new Error("year_filter_mismatch"); },
  },
  {
    name: "europe.budget.1_5-4m",
    params: { market: "europe", budgetFrom: 1_500_000, budgetTo: 4_000_000, page: 1, pageSize: 48, sort: "totalRub" },
    validate: (items) => { if (items.some((x: any) => !between(Number(x.totalRub || 0), 1_500_000, 4_000_000))) throw new Error("budget_filter_mismatch"); },
  },
  {
    name: "europe.power.80-160",
    params: { market: "europe", powerFrom: 80, powerTo: 160, page: 1, pageSize: 48, sort: "updatedAt" },
    validate: (items) => { if (items.some((x: any) => !between(Number(x.powerHp || 0), 80, 160))) throw new Error("power_filter_mismatch"); },
  },
  {
    name: "europe.mileage.to100k",
    params: { market: "europe", mileageTo: 100_000, page: 1, pageSize: 48, sort: "mileage" },
    validate: (items) => { if (items.some((x: any) => Number(x.mileageKm || 0) > 100_000)) throw new Error("mileage_filter_mismatch"); },
  },
  {
    name: "europe.make.sample",
    params: { market: "europe", make: sample.make, page: 1, pageSize: 48, sort: "updatedAt" },
    validate: (items) => { if (items.some((x: any) => String(x.make).toLocaleLowerCase("ru-RU") !== String(sample.make).toLocaleLowerCase("ru-RU"))) throw new Error("make_filter_mismatch"); },
  },
  {
    name: "europe.model.sample",
    params: { market: "europe", make: sample.make, model: sample.model, page: 1, pageSize: 48, sort: "updatedAt" },
    validate: (items) => { if (items.some((x: any) => String(x.make).toLocaleLowerCase("ru-RU") !== String(sample.make).toLocaleLowerCase("ru-RU") || String(x.model).toLocaleLowerCase("ru-RU") !== String(sample.model).toLocaleLowerCase("ru-RU"))) throw new Error("model_filter_mismatch"); },
  },
  {
    name: "china.year.power",
    params: { market: "china", yearFrom: 2023, yearTo: 2026, powerTo: 160, page: 1, pageSize: 48, sort: "updatedAt" },
    validate: (items) => { if (items.some((x: any) => !between(Number(x.year || 0), 2023, 2026) || Number(x.powerHp || 0) > 160)) throw new Error("china_year_power_filter_mismatch"); },
  },
);

const results: any[] = [{ name: "europe.market.page48", ms: baseline.ms, total: baseline.value.total, returned: baseline.value.items.length, generationId: baseline.value.generationId, usedIndexShards: baseline.value.usedIndexShards }];
for (const test of cases) {
  const result = await timed(test.name, () => searchOffers(test.params));
  test.validate?.(result.value.items);
  if (result.value.items.length > 48) throw new Error(`${test.name}:page_size_exceeded`);
  if (String(result.value.generationId) !== String(baseline.value.generationId)) throw new Error(`${test.name}:generation_changed`);
  results.push({ name: test.name, ms: result.ms, total: result.value.total, returned: result.value.items.length, usedIndexShards: result.value.usedIndexShards });
}

const facetsBase = await timed("facets.europe.base", () => readCatalogFacets({ market: "europe" }));
const facetsFiltered = await timed("facets.europe.year", () => readCatalogFacets({ market: "europe", yearFrom: 2024, yearTo: 2026 }));
if (!facetsBase.value.makes.length) throw new Error("facets_base_makes_empty");
if (!facetsFiltered.value.makes.length) throw new Error("facets_filtered_makes_empty");
if (facetsBase.value.generationId !== baseline.value.generationId || facetsFiltered.value.generationId !== baseline.value.generationId) throw new Error("facets_generation_mismatch");

const projectionCases = results.filter((row) => /year|budget|power|mileage/.test(row.name));
for (const row of projectionCases) {
  if (!Array.isArray(row.usedIndexShards) || !row.usedIndexShards.some((x: string) => x.includes("/indexes/projection/"))) throw new Error(`${row.name}:projection_shard_not_reported`);
}

const allTimings = [...results.map((x) => x.ms), facetsBase.ms, facetsFiltered.ms];
const report = {
  generationId: baseline.value.generationId,
  sample: { make: sample.make, model: sample.model },
  results,
  facets: [
    { name: "facets.europe.base", ms: facetsBase.ms, makes: facetsBase.value.makes.length },
    { name: "facets.europe.year", ms: facetsFiltered.ms, makes: facetsFiltered.value.makes.length, models: facetsFiltered.value.models.length },
  ],
  maxMs: Math.max(...allTimings),
  slowOver2s: results.filter((x) => x.ms > 2000).map((x) => ({ name: x.name, ms: x.ms })),
  passed: true,
};
console.log(JSON.stringify(report, null, 2));
