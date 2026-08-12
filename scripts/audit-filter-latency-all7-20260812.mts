import { performance } from "node:perf_hooks";
import { readCatalogFacets, searchOffers } from "../apps/web/lib/catalog/storage.ts";

const MARKETS = ["korea", "china", "japan", "uae", "europe", "georgia", "kyrgyzstan"] as const;
const JAPAN_MIN_YEAR = new Date().getFullYear() - 15;

async function timed<T>(name: string, fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  return { name, value, ms: Math.round((performance.now() - start) * 10) / 10 };
}
function norm(value: unknown) { return String(value || "").trim().toLocaleLowerCase("ru-RU"); }
function positive(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function between(value: unknown, min: number, max: number) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max; }
function utilizationPowerHp(row: any) {
  const kw = positive(row.utilizationPowerKw);
  if (kw) return kw * 1.35962;
  const kind = norm(row.powertrainKind);
  const fuel = norm(row.fuel);
  if (["electric", "series_hybrid", "other_hybrid"].includes(kind) || /electric|hybrid|phev|hev|bev|электро|гибрид/.test(fuel)) return 0;
  return positive(row.powerHp);
}

const report: any = { storage: [], filters: [], facets: [], publicHttp: [], violations: [] };
let generationId = "";

for (const market of MARKETS) {
  const result = await timed(`${market}.base48`, () => searchOffers({ market, page: 1, pageSize: 48, sort: "updatedAt" }));
  const rows: any[] = result.value.items as any[];
  if (!rows.length) report.violations.push({ type: "empty_market", market });
  if (rows.some((row) => row.market !== market)) report.violations.push({ type: "cross_market", market });
  const minYear = market === "japan" ? JAPAN_MIN_YEAR : 2020;
  const ageBad = rows.filter((row) => Number(row.year || 0) < minYear);
  if (ageBad.length) report.violations.push({ type: "age", market, count: ageBad.length, samples: ageBad.slice(0, 5).map((row) => ({ id: row.id, year: row.year })) });
  if (market === "japan") {
    const notAuction = rows.filter((row) => !Boolean(row.auctionDate || row.auctionGrade));
    if (notAuction.length) report.violations.push({ type: "japan_projection_without_auction_marker", count: notAuction.length, samples: notAuction.slice(0, 5).map((row) => row.id) });
  }
  const cardImageMissing = rows.filter((row) => !Array.isArray(row.images) || !row.images[0]?.url);
  if (cardImageMissing.length) report.violations.push({ type: "card_image_missing", market, count: cardImageMissing.length });
  if (!generationId) generationId = String(result.value.generationId || "");
  if (String(result.value.generationId || "") !== generationId) report.violations.push({ type: "generation_changed", market, got: result.value.generationId, expected: generationId });
  report.storage.push({ name: result.name, ms: result.ms, total: result.value.total, returned: rows.length, usedIndexShards: result.value.usedIndexShards });
}

const georgia = await timed("georgia.sample", () => searchOffers({ market: "georgia", page: 1, pageSize: 48, sort: "updatedAt" }));
const sample: any = (georgia.value.items as any[]).find((row) => norm(row.make) && norm(row.model));
if (!sample) throw new Error("georgia:no_make_model_sample");

const filterCases: Array<{ name: string; params: any; check: (rows: any[]) => boolean; describe: (row: any) => any }> = [
  {
    name: "georgia.year.2023-2026",
    params: { market: "georgia", yearFrom: 2023, yearTo: 2026, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.length > 0 && rows.every((row) => between(row.year, 2023, 2026)),
    describe: (row) => ({ id: row.id, year: row.year }),
  },
  {
    name: "georgia.make.sample",
    params: { market: "georgia", make: sample.make, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.length > 0 && rows.every((row) => norm(row.make) === norm(sample.make)),
    describe: (row) => ({ id: row.id, make: row.make }),
  },
  {
    name: "georgia.model.sample",
    params: { market: "georgia", make: sample.make, model: sample.model, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.length > 0 && rows.every((row) => norm(row.make) === norm(sample.make) && norm(row.model) === norm(sample.model)),
    describe: (row) => ({ id: row.id, make: row.make, model: row.model }),
  },
  {
    name: "georgia.budget.1m-6m",
    params: { market: "georgia", budgetFrom: 1_000_000, budgetTo: 6_000_000, page: 1, pageSize: 48, sort: "totalRub" },
    check: (rows) => rows.length > 0 && rows.every((row) => between(row.totalRub, 1_000_000, 6_000_000)),
    describe: (row) => ({ id: row.id, totalRub: row.totalRub }),
  },
  {
    name: "europe.year.power",
    params: { market: "europe", yearFrom: 2023, yearTo: 2026, powerTo: 160, page: 1, pageSize: 48, sort: "updatedAt" },
    check: (rows) => rows.length > 0 && rows.every((row) => between(row.year, 2023, 2026) && utilizationPowerHp(row) > 0 && utilizationPowerHp(row) <= 160.01),
    describe: (row) => ({ id: row.id, year: row.year, powerHp: row.powerHp, utilizationPowerKw: row.utilizationPowerKw, powertrainKind: row.powertrainKind, fuel: row.fuel, utilizationHp: utilizationPowerHp(row) }),
  },
  {
    name: "china.mileage.to100k",
    params: { market: "china", mileageTo: 100_000, page: 1, pageSize: 48, sort: "mileage" },
    check: (rows) => rows.length > 0 && rows.every((row) => positive(row.mileageKm) > 0 && positive(row.mileageKm) <= 100_000),
    describe: (row) => ({ id: row.id, mileageKm: row.mileageKm }),
  },
];

for (const test of filterCases) {
  const result = await timed(test.name, () => searchOffers(test.params));
  const rows = result.value.items as any[];
  const ok = test.check(rows);
  if (!ok) report.violations.push({ type: "filter_mismatch", name: test.name, returned: rows.length, samples: rows.slice(0, 8).map(test.describe) });
  if (String(result.value.generationId || "") !== generationId) report.violations.push({ type: "generation_changed", name: test.name, got: result.value.generationId, expected: generationId });
  report.filters.push({ name: test.name, ms: result.ms, total: result.value.total, returned: rows.length, usedIndexShards: result.value.usedIndexShards });
}

const facetsBase = await timed("facets.georgia.base", () => readCatalogFacets({ market: "georgia" }));
if (!facetsBase.value.makes.includes(sample.make)) report.violations.push({ type: "facets_missing_make", make: sample.make });
if (facetsBase.value.makes.length < 2) report.violations.push({ type: "facets_makes_too_small", count: facetsBase.value.makes.length });
report.facets.push({ name: facetsBase.name, ms: facetsBase.ms, makes: facetsBase.value.makes.length, models: facetsBase.value.models.length });

const facetsMake = await timed("facets.georgia.make", () => readCatalogFacets({ market: "georgia", make: sample.make }));
if (!facetsMake.value.models.some((model: any) => norm(typeof model === "string" ? model : model?.model) === norm(sample.model))) report.violations.push({ type: "facets_missing_model", make: sample.make, model: sample.model });
report.facets.push({ name: facetsMake.name, ms: facetsMake.ms, makes: facetsMake.value.makes.length, models: facetsMake.value.models.length });

async function httpProbe(name: string, url: string, expectedText: string) {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    try {
      const response = await fetch(url, { headers: { "user-agent": "AvtoCena-readonly-audit/1.0" }, signal: AbortSignal.timeout(30_000) });
      const body = await response.text();
      const ms = Math.round((performance.now() - start) * 10) / 10;
      if (!response.ok || !body.includes(expectedText)) report.violations.push({ type: "public_http", name, status: response.status, expectedText, bodyHasExpected: body.includes(expectedText) });
      samples.push(ms);
    } catch (error) {
      report.violations.push({ type: "public_http_error", name, error: String((error as Error)?.message || error) });
    }
  }
  samples.sort((a, b) => a - b);
  report.publicHttp.push({ name, samplesMs: samples, medianMs: samples[1] ?? null, maxMs: samples.at(-1) ?? null });
}

await httpProbe("http.cars.georgia", "https://avtocena.com/cars?market=georgia", "Грузия");
await httpProbe("http.cars.georgia.make", `https://avtocena.com/cars?market=georgia&make=${encodeURIComponent(sample.make)}`, "Грузия");
await httpProbe("http.cars.georgia.model", `https://avtocena.com/cars?market=georgia&make=${encodeURIComponent(sample.make)}&model=${encodeURIComponent(sample.model)}`, "Грузия");

const timingRows = [...report.storage, ...report.filters, ...report.facets].filter((row: any) => Number.isFinite(row.ms));
report.generationId = generationId;
report.sample = { make: sample.make, model: sample.model };
report.maxStorageMs = Math.max(...timingRows.map((row: any) => row.ms));
report.over2s = timingRows.filter((row: any) => row.ms > 2000).map((row: any) => ({ name: row.name, ms: row.ms }));
report.passed = report.violations.length === 0;
console.log(JSON.stringify(report, null, 2));
if (report.violations.length) throw new Error(`audit_violations:${report.violations.length}`);
