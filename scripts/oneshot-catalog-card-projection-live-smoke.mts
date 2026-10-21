import { performance } from "node:perf_hooks";
import { readCatalogFacets, searchOffers } from "../apps/web/lib/catalog/storage.ts";

async function timed<T>(name: string, fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round((performance.now() - start) * 10) / 10;
  return { name, value, ms };
}
const between = (v:number,a:number,b:number) => v >= a && v <= b;
const out:any[] = [];

const base = await timed("europe.market.page48", () => searchOffers({ market:"europe", page:1, pageSize:48, sort:"updatedAt" }));
if (!base.value.items.length) throw new Error("europe_empty");
if (base.value.items.some((x:any) => x.market !== "europe" || Number(x.year||0) < 2020)) throw new Error("europe_base_invariant");
if (base.value.items.some((x:any) => !(Number(x.totalRub||0) > 0))) throw new Error("projected_visible_price_missing");
if (base.value.items.some((x:any) => !Array.isArray(x.images) || !x.images[0]?.url)) throw new Error("projected_card_image_missing");
const projectionShardUsed = (r:any) => Array.isArray(r.usedIndexShards) && r.usedIndexShards.some((x:string) => x.includes("/indexes/projection/"));
if (!projectionShardUsed(base.value)) throw new Error(`base_projection_not_used:${JSON.stringify(base.value.usedIndexShards)}`);
out.push({name:base.name,ms:base.ms,total:base.value.total,returned:base.value.items.length,usedIndexShards:base.value.usedIndexShards});
const sample:any = base.value.items.find((x:any)=>String(x.make||"").trim() && String(x.model||"").trim()) || base.value.items[0];

const cases = [
 {name:"europe.year.2024-2026",params:{market:"europe",yearFrom:2024,yearTo:2026,page:1,pageSize:48,sort:"updatedAt"},check:(xs:any[])=>xs.every(x=>between(Number(x.year||0),2024,2026))},
 {name:"europe.budget.1_5-4m",params:{market:"europe",budgetFrom:1_500_000,budgetTo:4_000_000,page:1,pageSize:48,sort:"totalRub"},check:(xs:any[])=>xs.every(x=>between(Number(x.totalRub||0),1_500_000,4_000_000))},
 {name:"europe.power.80-160",params:{market:"europe",powerFrom:80,powerTo:160,page:1,pageSize:48,sort:"updatedAt"},check:(xs:any[])=>xs.every(x=>between(Number(x.powerHp||0),80,160))},
 {name:"europe.mileage.to100k",params:{market:"europe",mileageTo:100_000,page:1,pageSize:48,sort:"mileage"},check:(xs:any[])=>xs.every(x=>Number(x.mileageKm||0)<=100_000)},
 {name:"europe.make.sample",params:{market:"europe",make:sample.make,page:1,pageSize:48,sort:"updatedAt"},check:(xs:any[])=>xs.every(x=>String(x.make).toLowerCase()===String(sample.make).toLowerCase())},
 {name:"europe.model.sample",params:{market:"europe",make:sample.make,model:sample.model,page:1,pageSize:48,sort:"updatedAt"},check:(xs:any[])=>xs.every(x=>String(x.make).toLowerCase()===String(sample.make).toLowerCase()&&String(x.model).toLowerCase()===String(sample.model).toLowerCase())},
 {name:"china.year.power",params:{market:"china",yearFrom:2023,yearTo:2027,powerTo:160,page:1,pageSize:48,sort:"updatedAt"},check:(xs:any[])=>xs.every(x=>between(Number(x.year||0),2023,2027)&&Number(x.powerHp||0)<=160)},
];
for (const test of cases) {
 const r = await timed(test.name,()=>searchOffers(test.params as any));
 if (!test.check(r.value.items)) throw new Error(`${test.name}:filter_mismatch`);
 if (r.value.generationId !== base.value.generationId) throw new Error(`${test.name}:generation_changed`);
 if (!projectionShardUsed(r.value)) throw new Error(`${test.name}:projection_not_used:${JSON.stringify(r.value.usedIndexShards)}`);
 out.push({name:r.name,ms:r.ms,total:r.value.total,returned:r.value.items.length,usedIndexShards:r.value.usedIndexShards});
}
const facetsBase = await timed("facets.europe.base",()=>readCatalogFacets({market:"europe"}));
const facetsYear = await timed("facets.europe.year",()=>readCatalogFacets({market:"europe",yearFrom:2024,yearTo:2026}));
if (!facetsBase.value.makes.includes(sample.make)) throw new Error("market_facets_missing_sample_make");
if (facetsBase.value.makes.length > 100) throw new Error(`market_facets_suspicious_global:${facetsBase.value.makes.length}`);
if (!facetsYear.value.makes.length) throw new Error("filtered_facets_empty");
const timings = [...out.map(x=>x.ms),facetsBase.ms,facetsYear.ms];
console.log(JSON.stringify({generationId:base.value.generationId,sample:{make:sample.make,model:sample.model},results:out,facets:[{name:facetsBase.name,ms:facetsBase.ms,makes:facetsBase.value.makes.length},{name:facetsYear.name,ms:facetsYear.ms,makes:facetsYear.value.makes.length,models:facetsYear.value.models.length}],maxMs:Math.max(...timings),over2s:[...out,{name:facetsBase.name,ms:facetsBase.ms},{name:facetsYear.name,ms:facetsYear.ms}].filter(x=>x.ms>2000).map(x=>({name:x.name,ms:x.ms})),passed:true},null,2));
