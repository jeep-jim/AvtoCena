import { performance } from "node:perf_hooks";
import { readCatalogFacets, readMarketOffers, searchOffers } from "../apps/web/lib/catalog/storage.ts";
import { isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality.ts";

const market = String(process.env.SMOKE_MARKET || "europe");
const now = () => performance.now();
async function timed<T>(name: string, fn: () => Promise<T>) {
  const start = now();
  const value = await fn();
  const ms = Math.round((now() - start) * 10) / 10;
  console.log(JSON.stringify({ event: "timing", name, ms }));
  return { value, ms };
}
const lower = (v: unknown) => String(v || "").trim().toLocaleLowerCase("ru-RU");
const positive = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

const legacyTimed = await timed("legacy_market_scan", async () => (await readMarketOffers(market)).filter(isCrediblePublicOffer));
const legacy = legacyTimed.value;
if (!legacy.length) throw new Error(`empty_market:${market}`);

const makeCounts = new Map<string, { label: string; count: number }>();
for (const row of legacy) {
  const key = lower(row.make); if (!key) continue;
  const item = makeCounts.get(key) || { label: String(row.make), count: 0 }; item.count++; makeCounts.set(key, item);
}
const commonMake = [...makeCounts.values()].sort((a,b)=>b.count-a.count)[0]?.label;
if (!commonMake) throw new Error("common_make_missing");
const makeRows = legacy.filter((row) => lower(row.make) === lower(commonMake));
const modelCounts = new Map<string, { label: string; count: number }>();
for (const row of makeRows) {
  const key = lower(row.model); if (!key) continue;
  const item = modelCounts.get(key) || { label: String(row.model), count: 0 }; item.count++; modelCounts.set(key, item);
}
const commonModel = [...modelCounts.values()].sort((a,b)=>b.count-a.count)[0]?.label;
const years = legacy.map((row)=>Number(row.year||0)).filter((n)=>n>0).sort((a,b)=>a-b);
const yearFrom = years[Math.floor(years.length * 0.55)] || 2022;
const prices = legacy.map((row)=>positive(row.totalRub)).filter((n): n is number => Boolean(n)).sort((a,b)=>a-b);
const budgetTo = prices[Math.floor(prices.length * 0.55)] || 5_000_000;
const mileageTo = 100_000;
const powerTo = 160;

const cases = [
  { name: "make", params: { market, make: commonMake }, expected: makeRows.length },
  { name: "year", params: { market, yearFrom }, expected: legacy.filter((row)=>Number(row.year||0)>=yearFrom).length },
  { name: "budget", params: { market, budgetTo }, expected: legacy.filter((row)=>{ const n=positive(row.totalRub); return n !== undefined && n <= budgetTo; }).length },
  { name: "mileage", params: { market, mileageTo }, expected: legacy.filter((row)=>{ const n=positive(row.mileageKm); return n !== undefined && n <= mileageTo; }).length },
  { name: "power", params: { market, powerTo }, expected: legacy.filter((row)=>{ const n=positive(row.powerHp); return n !== undefined && n <= powerTo; }).length },
];
if (commonModel) cases.push({ name: "model", params: { market, make: commonMake, model: commonModel }, expected: modelCounts.get(lower(commonModel))?.count || 0 } as any);

const results: any[] = [];
for (const test of cases) {
  const timedResult = await timed(`search_${test.name}`, () => searchOffers({ ...test.params, page: 1, pageSize: 48 } as any));
  const r: any = timedResult.value;
  const projectionUsed = Array.isArray(r.usedIndexShards) && r.usedIndexShards.some((p: string)=>p.includes(`/indexes/projection/${market}.json`));
  if (!projectionUsed) throw new Error(`projection_not_used:${test.name}:${JSON.stringify(r.usedIndexShards || [])}`);
  if (test.name !== "model" && Number(r.total) !== Number(test.expected)) throw new Error(`count_mismatch:${test.name}:${test.expected}->${r.total}`);
  if (test.name === "model" && (!r.items?.length || r.items.some((x:any)=>lower(x.make)!==lower(commonMake)))) throw new Error(`model_filter_bad:${commonMake}:${commonModel}`);
  results.push({ name: test.name, ms: timedResult.ms, expected: test.expected, total: r.total, projectionUsed });
}

const facetsTimed = await timed("filtered_facets", () => readCatalogFacets({ market, make: commonMake } as any));
const facets: any = facetsTimed.value;
if (!facets.makes?.some((x:string)=>lower(x)===lower(commonMake))) throw new Error(`facet_make_missing:${commonMake}`);
if (!Array.isArray(facets.models) || !facets.models.length) throw new Error(`facet_models_empty:${commonMake}`);

const unfilteredTimed = await timed("unfiltered_page", () => searchOffers({ market, page: 1, pageSize: 48 } as any));
const unfiltered: any = unfilteredTimed.value;
if (Number(unfiltered.total) !== legacy.length) throw new Error(`unfiltered_total_mismatch:${legacy.length}->${unfiltered.total}`);
if (!unfiltered.usedIndexShards?.some((p:string)=>p.includes(`/indexes/projection/${market}.json`))) throw new Error("unfiltered_projection_missing");

console.log(JSON.stringify({
  passed: true,
  market,
  generationId: unfiltered.generationId,
  legacyCount: legacy.length,
  commonMake,
  commonModel,
  thresholds: { yearFrom, budgetTo, mileageTo, powerTo },
  timings: { legacyMarketScanMs: legacyTimed.ms, filteredFacetsMs: facetsTimed.ms, unfilteredPageMs: unfilteredTimed.ms },
  results,
}, null, 2));
