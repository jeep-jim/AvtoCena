import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { safePublicPricing } from '../apps/web/lib/catalog/safe-public-pricing';
import { countCatalogOffers, catalogSearchProjectionBalanceSources, catalogSearchProjectionMatches, catalogSearchProjectionSort, persistCatalogOffers, readCatalogFacets, resetCatalogReadCachesForTests, searchOffers, searchOffersWithoutBudgetIndexForTests } from "../apps/web/lib/catalog/storage";
import { getJsonStorage, readDataJson, resetJsonStorageForTests, safeStoragePath } from "../apps/web/lib/data";

const modelRoute = fs.readFileSync(new URL("../apps/web/app/api/catalog/models/route.ts", import.meta.url), "utf8");

test("model suggestions merge the live catalog with the curated knowledge base", () => {
  assert.match(modelRoute, /selectedFacets\(modelFilters\)/);
  assert.match(modelRoute, /mergeSuggestions\(knowledgeMatches, catalogFacets\.models, query, limit\)/);
});

test("all catalog filters use the projection when optional categorical shards are absent", async () => {
  const cwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avtocena-filter-search-"));
  fs.mkdirSync(path.join(directory, "data"));
  process.chdir(directory);
  process.env.JSON_STORAGE_DRIVER = "local";
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  resetJsonStorageForTests();

  try {
    const now = new Date().toISOString();
    const images = Array.from({ length: 5 }, (_, index) => ({
      id: `filter-image-${index + 1}`,
      url: `/api/catalog/images/filter-image-${index + 1}`,
      objectKey: `catalog/images/korea/filter-${index + 1}.jpg`,
      width: 1_280,
      height: 960,
      size: 120_000,
      checksum: `filter-${index + 1}`,
      mimeType: "image/jpeg",
    }));
    await persistCatalogOffers([{
      id: "filter-target", sourceId: "encar_direct", sourceOfferId: "FILTER", market: "korea", offerType: "fixed", status: "active",
      make: "Hyundai", model: "Avante (CN7)", year: 2021, sourcePrice: 18_000_000, sourceCurrency: "KRW", priceMode: "fixed", images,
      totalRub: 2_021_912, mileageKm: 61_114, engineCc: 1_598, powerHp: 123, powerDataConfidence:'source_exact', powerDataSource:'synthetic_exact_fixture', fuel: "petrol", transmission: "automatic", drive: "fwd", bodyType: "sedan",
      calculationStatus: "ready", calculationSnapshot: {
        customs: { status: "ready" },
        breakdown: ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"]
          .map((id) => ({ id, amountRub: 1 })),
      },
      firstSeenAt: now, updatedAt: now, operational: { sourceUrl: "https://www.encar.com/dc/dc_cardetailview.do?carid=FILTER", photoIdentityVerified: true,
        semanticEvidence: {fuel:{status:'exact',value:'petrol'},engineCc:{status:'exact',value:1598},powerHp:{status:'exact',value:123}} },
    } as any]);

    const {warmBudgetPriceCaches}=await import('../apps/web/lib/catalog/storage');
    await warmBudgetPriceCaches(['korea']);
    const manifest = await readDataJson<any>("catalog/manifest.json", {});
    const projection = await readDataJson<any>(`catalog/generations/${manifest.generationId}/indexes/projection/korea.json`, {});
    assert.equal(projection.items?.[0]?.bodyType, "sedan");
    assert.equal(safePublicPricing(projection.items[0]).totalRub, 2_021_912, JSON.stringify(safePublicPricing(projection.items[0])));
    const allProjection = await readDataJson<any>("catalog/public/projection/all.json", {});
    assert.deepEqual(allProjection.items?.map((item: any) => item.id), ["filter-target"]);
    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/make/hyundai.json`), { force: true });
    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/model/hyundai-avante-cn7.json`), { force: true });

    const filters = { market: "korea", make: "Hyundai", model: "Avante (CN7)", hasPrice: "yes", budgetFrom: 2_000_000, budgetTo: 2_300_000, yearFrom: 2021, yearTo: 2021, mileageFrom: 60_000, mileageTo: 62_000, engineFrom: 1_500, engineTo: 1_600, powerFrom: 120, powerTo: 160, fuel: "petrol", transmission: "automatic", drive: "fwd", bodyType: "sedan", pageSize: 10 } as const;
    for (const [name, value] of Object.entries(filters)) {
      if (name === "pageSize") continue;
      const isolated = await searchOffers({ market: "korea", [name]: value, pageSize: 10 });
      assert.deepEqual(isolated.items.map((offer) => offer.id), ["filter-target"], `isolated filter failed: ${name}`);
    }
    for(const city of [undefined,'Новокузнецк'])for(const sort of [undefined,'updatedAt','totalRub','totalRubDesc']){
      const params={market:'korea',make:'Hyundai',model:'Avante (CN7)',budgetTo:2_300_000,pageSize:6,city,sort};
      const indexed=await searchOffers(params),reference=await searchOffersWithoutBudgetIndexForTests(params);
      assert.equal(indexed.total,reference.total);
      assert.deepEqual(indexed.items.map(row=>[row.id,row.totalRub]),reference.items.map(row=>[row.id,row.totalRub]),'prepared brand budget preserves exact membership, order and visible prices');
    }
    const filtered = await searchOffers(filters);
    assert.deepEqual(filtered.items.map((offer) => offer.id), ["filter-target"]);
    for (const query of [{}, {city:"Новокузнецк"}, filters, {...filters, city:"Новокузнецк"}, {market:"korea",budgetTo:1}, {market:"korea",yearFrom:2025}]) {
      const [count, search] = await Promise.all([countCatalogOffers(query), searchOffers(query)]);
      assert.equal(count.total, search.total, `count must match results: ${JSON.stringify(query)}`);
    }


    resetCatalogReadCachesForTests();
    const storage = getJsonStorage() as any;
    const originalRead = storage.readJsonWithMeta.bind(storage);
    storage.readJsonWithMeta=async(relativePath:string,fallback:unknown)=>{
      assert.ok(!relativePath.includes('/budget-cards-') && !relativePath.includes('/projection/'), 'engine/power count reads only compact selectors');
      return originalRead(relativePath,fallback);
    };
    try {
      assert.equal((await countCatalogOffers({market:'korea',engineTo:1600,powerTo:160})).total,1);
      assert.equal((await countCatalogOffers({market:'korea',engineTo:1500,powerTo:160})).total,0);
    } finally {storage.readJsonWithMeta=originalRead;resetCatalogReadCachesForTests();}
    await countCatalogOffers({market:'korea',yearFrom:2021});
    let projectionReads = 0;
    let brandProjectionReads = 0;
    storage.readJsonWithMeta = async (relativePath: string, fallback: unknown) => {
      if (relativePath === "catalog/public/projection/korea.json" || relativePath === `catalog/generations/${manifest.generationId}/indexes/projection/korea.json`) projectionReads++;
      if (relativePath.startsWith(`catalog/generations/${manifest.generationId}/indexes/projection-brand/hyundai-`)) brandProjectionReads++;
      assert.ok(!relativePath.startsWith("catalog/public/projection-brand/"), "published generation avoids mutable brand aliases");
      return originalRead(relativePath, fallback);
    };
    try {
      await Promise.all([searchOffers(filters), readCatalogFacets(filters)]);
      assert.equal(projectionReads, 0, "a selected make must not download the whole market");
      assert.equal(brandProjectionReads, 0, "brand and budget use the prepared selector without downloading the brand projection");
    } finally {
      storage.readJsonWithMeta = originalRead;
    }

    resetCatalogReadCachesForTests();
    let allProjectionReads = 0;
    brandProjectionReads = 0;
    let manifestReads = 0;
    storage.readJsonWithMeta = async (relativePath: string, fallback: unknown) => {
      if (relativePath === "catalog/public/projection/all.json" || relativePath === `catalog/generations/${manifest.generationId}/indexes/projection/all.json`) allProjectionReads++;
      if (relativePath.startsWith(`catalog/generations/${manifest.generationId}/indexes/projection-brand/hyundai-`)) brandProjectionReads++;
      assert.ok(!relativePath.startsWith("catalog/public/projection-brand/"), "published generation avoids mutable brand aliases");
      if (relativePath === "catalog/manifest.json") manifestReads++;
      return originalRead(relativePath, fallback);
    };
    try {
      const globalFilters = { ...filters, market: "any" } as const;
      const [globalResults, globalFacets] = await Promise.all([searchOffers(globalFilters), readCatalogFacets(globalFilters)]);
      assert.deepEqual(globalResults.items.map((offer) => offer.id), ["filter-target"]);
      assert.deepEqual(globalFacets.models, [{ make: "Hyundai", model: "Avante (CN7)" }]);
      assert.equal(allProjectionReads, 0, "a selected make must not download all markets");
      assert.equal(brandProjectionReads, 1, "a cold global selector preserves one bounded brand projection instead of loading all markets");
      assert.equal(manifestReads, 1, "the current all-market projection must validate the active manifest generation once");
    } finally {
      storage.readJsonWithMeta = originalRead;
    }

    // An in-flight publisher may stage mutable aliases before switching the manifest.
    const brandFile=fs.readdirSync(safeStoragePath("catalog/public/projection-brand")).find(name=>name.startsWith("hyundai-"))!;
    const brandPath=`catalog/public/projection-brand/${brandFile}`;
    await storage.writeJson(brandPath,{generationId:"future-staging",items:[]});
    resetCatalogReadCachesForTests();
    storage.readJsonWithMeta=async(relativePath:string,fallback:unknown)=>{
      assert.ok(!/^catalog\/public\/projection\//.test(relativePath),"brand search must not fall back to full-market downloads during staging");
      return originalRead(relativePath,fallback);
    };
    try {
      assert.deepEqual((await searchOffers(filters)).items.map(offer=>offer.id),["filter-target"]);
      await storage.writeJson("catalog/public/facets.json",{generationId:"future-staging",makes:[],models:[]});
      resetCatalogReadCachesForTests();
      assert.deepEqual((await searchOffers({market:"korea",yearFrom:2021,yearTo:2021,pageSize:10})).items.map(offer=>offer.id),["filter-target"],"a staged market alias must be skipped before its large body is downloaded");
    } finally { storage.readJsonWithMeta=originalRead; }

    fs.rmSync(safeStoragePath(`catalog/generations/${manifest.generationId}/indexes/projection/korea.json`), { force: true });
    fs.rmSync(safeStoragePath("catalog/public/projection/korea.json"), { force: true });
    resetCatalogReadCachesForTests();
    const legacyFiltered = await searchOffers(filters);
    assert.deepEqual(legacyFiltered.items.map((offer) => offer.id), ["filter-target"], "legacy generations must still apply every filter exactly");
  } finally {
    process.chdir(cwd);
    resetCatalogReadCachesForTests();
    resetJsonStorageForTests();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("catalog make filter accepts several selected brands as OR", () => {
  const audi = { id: "audi", market: "europe", make: "Audi", model: "A4", year: 2024 } as any;
  const bmw = { id: "bmw", market: "europe", make: "BMW", model: "3 Series", year: 2024 } as any;
  const kia = { id: "kia", market: "korea", make: "Kia", model: "K5", year: 2024 } as any;
  assert.equal(catalogSearchProjectionMatches(audi, { make: "Audi,BMW" }), true);
  assert.equal(catalogSearchProjectionMatches(bmw, { make: "Audi,BMW" }), true);
  assert.equal(catalogSearchProjectionMatches(kia, { make: "Audi,BMW" }), false);
});

test("the 160 hp utilization-fee filter uses certified calculation power", () => {
  const certifiedElectric = {
    id: "certified-electric", market: "china", make: "BYD", model: "Seal", year: 2025,
    powerHp: 530, powerKw: 390, powertrainKind: "electric", power30MinKw: 100, utilizationPowerKw: 100,
  } as any;
  const uncertifiedElectric = {
    id: "uncertified-electric", market: "china", make: "BYD", model: "Seal", year: 2025,
    powerHp: 150, powerKw: 110, powertrainKind: "electric",
  } as any;
  const hybridAboveThreshold = {
    id: "hybrid-above", market: "japan", make: "Toyota", model: "Harrier", year: 2024,
    powerHp: 152, powertrainKind: "other_hybrid", power30MinKw: 35, utilizationPowerKw: 130,
  } as any;

  assert.equal(catalogSearchProjectionMatches(certifiedElectric, { powerTo: 160 }), true);
  assert.equal(catalogSearchProjectionMatches(certifiedElectric, { powerTo: 130 }), false);
  assert.equal(catalogSearchProjectionMatches(uncertifiedElectric, { powerTo: 160 }), false);
  assert.equal(catalogSearchProjectionMatches(hybridAboveThreshold, { powerTo: 160 }), false);
});

test("catalog sort directions used by the filter UI reach the search projection", () => {
  const rows = [
    { id: "middle", totalRub: 2_000_000, year: 2023 },
    { id: "new-expensive", totalRub: 3_000_000, year: 2025 },
    { id: "old-cheap", totalRub: 1_000_000, year: 2021 },
  ] as any[];
  assert.deepEqual(catalogSearchProjectionSort([...rows], "totalRubDesc").map((row) => row.id), ["new-expensive", "middle", "old-cheap"]);
  assert.deepEqual(catalogSearchProjectionSort([...rows], "yearAsc").map((row) => row.id), ["old-cheap", "middle", "new-expensive"]);
});

test("a market page does not hide an older source behind one freshly published source", () => {
  const rows = [
    { id: "kcar-new-1", sourceGroup: "kcar_korea_open", updatedAt: "2026-09-17T10:00:00Z" },
    { id: "kcar-new-2", sourceGroup: "kcar_korea_open", updatedAt: "2026-09-17T09:00:00Z" },
    { id: "kcar-new-3", sourceGroup: "kcar_korea_open", updatedAt: "2026-09-17T08:00:00Z" },
    { id: "encar-retained-1", sourceGroup: "encar_korea_direct", updatedAt: "2026-09-14T10:00:00Z" },
    { id: "encar-retained-2", sourceGroup: "encar_korea_direct", updatedAt: "2026-09-14T09:00:00Z" },
  ] as any[];
  catalogSearchProjectionSort(rows, "updatedAt");
  catalogSearchProjectionBalanceSources(rows);
  assert.deepEqual(rows.slice(0, 4).map((row) => row.id), ["kcar-new-1", "encar-retained-1", "kcar-new-2", "encar-retained-2"]);
});

test('prepared brand budget pagination preserves authoritative order and prices across cities',async()=>{
 const cwd=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'brand-budget-parity-'));
 fs.mkdirSync(path.join(directory,'data'));process.chdir(directory);process.env.JSON_STORAGE_DRIVER='local';process.env.CATALOG_GROW_ONLY_MARKETS='';resetJsonStorageForTests();
 try{
  const now=new Date().toISOString();
  const rows=Array.from({length:20},(_,i)=>({
   id:`brand-budget-${i}`,sourceId:'encar_direct',sourceOfferId:`BRAND${i}`,market:'korea',offerType:'fixed',status:'active',make:i>=18?'Kia':'Hyundai',model:i>=18?'K3':'Avante (CN7)',year:2021+i%4,
   sourcePrice:18_000_000+i*100_000,sourceCurrency:'KRW',priceMode:'fixed',totalRub:i>=16?4_500_000:2_000_000+i*30_000,mileageKm:40_000+i*1000,engineCc:1598,powerHp:i>=14&&i<16?180:123,powerDataConfidence:'source_exact',powerDataSource:'synthetic_exact_fixture',fuel:'petrol',transmission:'automatic',drive:'fwd',bodyType:'sedan',
   images:Array.from({length:5},(_,photo)=>({id:`brand-${i}-${photo}`,url:`/api/catalog/images/brand-${i}-${photo}`,objectKey:`catalog/images/korea/brand-${i}-${photo}.jpg`,width:1280,height:960,size:120000,checksum:`brand-${i}-${photo}`,mimeType:'image/jpeg'})),
   calculationStatus:'ready',calculationSnapshot:{customs:{status:'ready'},breakdown:['car','topavto-commission','broker','svh','laboratory','sbkts','epts','rf-delivery','customs'].map(id=>({id,amountRub:1}))},firstSeenAt:now,updatedAt:new Date(Date.now()-i*60000).toISOString(),
   operational:{sourceUrl:`https://www.encar.com/dc/dc_cardetailview.do?carid=BRAND${i}`,photoIdentityVerified:true,semanticEvidence:{fuel:{status:'exact',value:'petrol'},engineCc:{status:'exact',value:1598},powerHp:{status:'exact',value:i>=14&&i<16?180:123}}}
  }));
  await persistCatalogOffers(rows as any);
  const {warmBudgetPriceCaches}=await import('../apps/web/lib/catalog/storage');
  await warmBudgetPriceCaches(['korea']);
  for(const city of [undefined,'Новокузнецк'])for(const sort of [undefined,'updatedAt','totalRub','totalRubDesc']){
   const query={market:'korea',make:'Hyundai',model:'Avante (CN7)',powerTo:160,budgetTo:3_000_000,city,sort,pageSize:6};
   resetCatalogReadCachesForTests();
   await countCatalogOffers({market:query.market,yearFrom:2021});
   const reference=await searchOffersWithoutBudgetIndexForTests({...query,pageSize:48});
   assert.ok(reference.total>6,'fixture must exercise more than one page');
   const seen:string[]=[];
   for(let page=1;page<=Math.ceil(reference.total/6);page++){
    const result=await searchOffers({...query,page});
    assert.equal(result.total,reference.total);
    assert.deepEqual(result.items.map(row=>[row.id,row.totalRub]),reference.items.slice((page-1)*6,page*6).map(row=>[row.id,row.totalRub]));
    assert.ok(result.usedIndexShards.every(p=>/^budget-cards-v\d+\//.test(p)),'visible results must come from prepared card blocks');
    seen.push(...result.items.map(row=>row.id));
   }
   assert.equal(new Set(seen).size,reference.total);
   assert.equal((await countCatalogOffers(query)).total,reference.total);
  }
 }finally{process.chdir(cwd);resetCatalogReadCachesForTests();resetJsonStorageForTests();fs.rmSync(directory,{recursive:true,force:true});}
});
