import { performance } from "node:perf_hooks";
import { readCatalogFacets, searchOffers } from "../apps/web/lib/catalog/storage.ts";

const MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"] as const;
const GEORGIA_SOURCES = new Set(["myauto_georgia_list", "myauto_georgia_exact", "autopapa_georgia_open"]);
const JAPAN_MIN_YEAR = new Date().getFullYear() - 15;

type Timed<T> = { name: string; ms: number; value: T };
async function timed<T>(name: string, fn: () => Promise<T>): Promise<Timed<T>> {
  const start = performance.now();
  const value = await fn();
  return { name, value, ms: Math.round((performance.now() - start) * 10) / 10 };
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function norm(value: unknown) { return String(value || "").trim().toLocaleLowerCase("ru-RU"); }
function between(value: unknown, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

const report: any = { storage: [], filters: [], facets: [], publicHttp: [] };
let generationId = "";

for (const market of MARKETS) {
  const result = await timed(`${market}.base48`, () => searchOffers({ market, page: 1, pageSize: 48, sort: "updatedAt" }));
  const rows: any[] = result.value.items as any[];
  assert(rows.length > 0, `${market}:empty`);
  assert(rows.every((row) => row.market === market), `${market}:cross_market`);
  const minYear = market === "japan" ? JAPAN_MIN_YEAR : 2020;
  assert(rows.every((row) => Number(row.year || 0) >= minYear), `${market}:age_violation`);
  if (market === "japan") {
    assert(rows.every((row) => row.catalogKind === "auction_result" || (row.offerType === "auction" && row.auctionResult === "sold") || Boolean(row.auctionDate || row.auctionGrade)), "japan:not_auction_result");
  }
  if (market === "georgia") {
    assert(rows.every((row) => GEORGIA_SOURCES.has(String(row.sourceId || ""))), "georgia:source_violation");
    assert(rows.every((row) => Array.isArray(row.images) && row.images.length >= 5), "georgia:photo_below5");
  }
  if (!generationId) generationId = String(result.value.generationId || "");
  assert(String(result.value.generationId || "") === generationId, `${market}:generation_changed`);
  report.storage.push({ name: result.name, ms: result.ms, total: result.value.total, returned: rows.length, usedIndexShards: result.value.usedIndexShards });
}

const georgia = await timed("georgia.sample", () => searchOffers({ market: "georgia", page: 1, pageSize: 48, sort: "updatedAt" }));
const sample: any = (georgia.value.items as any[]).find((row) => norm(row.make) && norm(row.model));
assert(sample, "georgia:no_make_model_sample");

const filterCases: Array<{ name: string; params: any; check: (rows: any[]) => boolean; requireRows?: boolean }> = [
  {
    name: "georgia.year.2023-2026",
    params: { market: "georgia", yearFrom: 2023, yearTo: 2026, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.every((row) => between(row.year, 2023, 2026)), requireRows: true,
  },
  {
    name: "georgia.make.sample",
    params: { market: "georgia", make: sample.make, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.every((row) => norm(row.make) === norm(sample.make)), requireRows: true,
  },
  {
    name: "georgia.model.sample",
    params: { market: "georgia", make: sample.make, model: sample.model, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.every((row) => norm(row.make) === norm(sample.make) && norm(row.model) === norm(sample.model)), requireRows: true,
  },
  {
    name: "georgia.budget.1m-6m",
    params: { market: "georgia", budgetFrom: 1_000_000, budgetTo: 6_000_000, page: 1, pageSize: 48, sort: "totalRub" },
    check: (rows) => rows.every((row) => between(row.totalRub, 1_000_000, 6_000_000)), requireRows: true,
  },
  {
    name: "europe.year.power",
    params: { market: "europe", yearFrom: 2023, yearTo: 2026, powerTo: 160, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.every((row) => between(row.year, 2023, 2026) && Number(row.powerHp || 0) > 0 && Number(row.powerHp) <= 160), requireRows: true,
  },
  {
    name: "china.mileage.to100k",
    params: { market: "china", mileageTo: 100_000, page: 1, pageSize: 48, sort: "mileage" },
    check: (rows) => rows.every((row) => Number(row.mileageKm || 0) > 0 && Number(row.mileageKm) <= 100_000), requireRows: true,
  },
];

for (const test of filterCases) {
  const result = await timed(test.name, () => searchOffers(test.params));
  const rows = result.value.items as any[];
  if (test.requireRows) assert(rows.length > 0, `${test.name}:empty`);
  assert(test.check(rows), `${test.name}:filter_mismatch`);
  assert(String(result.value.generationId || "") === generationId, `${test.name}:generation_changed`);
  report.filters.push({ name: test.name, ms: result.ms, total: result.value.total, returned: rows.length, usedIndexShards: result.value.usedIndexShards });
}

const facetsBase = await timed("facets.georgia.base", () => readCatalogFacets({ market: "georgia" }));
assert(facetsBase.value.makes.includes(sample.make), "facets.georgia:missing_sample_make");
assert(facetsBase.value.makes.length > 1, "facets.georgia:makes_too_small");
report.facets.push({ name: facetsBase.name, ms: facetsBase.ms, makes: facetsBase.value.makes.length, models: facetsBase.value.models.length });

const facetsMake = await timed("facets.georgia.make", () => readCatalogFacets({ market: "georgia", make: sample.make }));
assert(facetsMake.value.models.some((model: string) => norm(model) === norm(sample.model)), "facets.georgia.make:missing_sample_model");
report.facets.push({ name: facetsMake.name, ms: facetsMake.ms, makes: facetsMake.value.makes.length, models: facetsMake.value.models.length });

async function httpProbe(name: string, url: string, expectedText: string) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const response = await fetch(url, { headers: { "user-agent": "AvtoCena-readonly-audit/1.0" }, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    const ms = Math.round((performance.now() - start) * 10) / 10;
    assert(response.ok, `${name}:http_${response.status}`);
    assert(body.includes(expectedText), `${name}:missing_expected_text:${expectedText}`);
    samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  report.publicHttp.push({ name, samplesMs: samples, medianMs: samples[1], maxMs: samples[2] });
}

await httpProbe("http.cars.georgia", "https://avtocena.com/cars?market=georgia", "Грузия");
await httpProbe("http.cars.georgia.make", `https://avtocena.com/cars?market=georgia&make=${encodeURIComponent(sample.make)}`, "Грузия");
await httpProbe("http.cars.georgia.model", `https://avtocena.com/cars?market=georgia&make=${encodeURIComponent(sample.make)}&model=${encodeURIComponent(sample.model)}`, "Грузия");

const timingRows = [...report.storage, ...report.filters, ...report.facets].filter((row: any) => Number.isFinite(row.ms));
report.generationId = generationId;
report.sample = { make: sample.make, model: sample.model };
report.maxStorageMs = Math.max(...timingRows.map((row: any) => row.ms));
report.over2s = timingRows.filter((row: any) => row.ms > 2000).map((row: any) => ({ name: row.name, ms: row.ms }));
report.passed = true;
console.log(JSON.stringify(report, null, 2));
