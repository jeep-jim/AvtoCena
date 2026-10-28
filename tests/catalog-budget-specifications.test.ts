import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBudgetCountIndex,budgetReplayOffer} from '../apps/web/lib/catalog/budget-count-index';
import {enrichBudgetSpecifications} from '../apps/web/lib/catalog/budget-specification-index';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';

test('backfilled specifications preserve identities, unknowns and exact engine/certified-power matching',async()=>{
 const offers:any[]=[
  {id:'petrol',market:'china',make:'Test',model:'Car',fuel:'petrol',engineCc:1598,powerHp:123,totalRub:2000000,drive:'fwd',transmission:'dct'},
  {id:'electric',market:'china',make:'Test',model:'EV',fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:80,totalRub:2000000},
  {id:'unknown',market:'china',make:'Test',model:'Unknown',fuel:'electric',powertrainKind:'electric',powerHp:300,totalRub:null},
 ];
 const source=buildBudgetCountIndex('gen_spec',offers,new Map(offers.map(o=>[o.id,0])),3);
 delete source.specificationFilterVersion;
 for(const row of [...source.rows,...source.otherRows!])for(const key of ['engineCc','utilizationPowerKw','powertrainKind','drive','transmission'])delete (row[5] as any)[key];
 const before=structuredClone(source);
 const rich=await enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers}));
 assert.deepEqual(source,before,'backfill does not mutate source index');
 assert.deepEqual(rich.rows.map(r=>r[5].id),source.rows.map(r=>r[5].id));
 assert.deepEqual(rich.otherRows!.map(r=>r[5].id),source.otherRows!.map(r=>r[5].id));
 for(const query of [{engineTo:2000},{engineFrom:1800},{powerTo:160},{powerFrom:150},{drive:'fwd'},{transmission:'dct'}]){
  const original=offers.filter(o=>catalogSearchProjectionMatches(o,query)).map(o=>o.id).sort();
  const compact=[...rich.rows,...rich.otherRows!].filter(r=>catalogSearchProjectionMatches({...r[5],market:r[0]},query)).map(r=>r[5].id).sort();
  assert.deepEqual(compact,original);
 }
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'future',items:offers})),/generation/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers.slice(1)})),/incomplete/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:[...offers,offers[0]]})),/identity/);
});


test('specification backfill accepts empty markets but rejects a missing populated market',async()=>{
 const {getJsonStorage,StorageConflictError}=await import('../apps/web/lib/data');
 const {backfillBudgetSpecificationSelectors,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const generationId='empty-market-specs';
 const offers:any[]=[{id:'china-one',market:'china',make:'Haval',model:'M6',engineCc:1497,totalRub:2000000}];
 const source=buildBudgetCountIndex(generationId,offers,new Map([['china-one',0]]),3);
 const manifest:any={generationId,markets:{china:{count:1},japan:{count:0}}};
 const values=new Map<string,any>([['catalog/manifest.json',manifest],[`catalog/generations/${generationId}/indexes/budget-count-v3.json`,source],[`catalog/generations/${generationId}/indexes/budget-cards-v3/0.json`,{generationId,items:offers}]]);
 const storage=getJsonStorage(),read=storage.readJson,meta=storage.readJsonWithMeta,write=storage.writeJson;
 const previousVersion=process.env.AVTOCENA_CALCULATION_VERSION;
 process.env.AVTOCENA_CALCULATION_VERSION='a'.repeat(64);
 storage.readJson=async <T>(key:string,fallback:T)=>values.has(key)?values.get(key):fallback;
 storage.readJsonWithMeta=async <T>(key:string,fallback:T)=>({found:values.has(key),value:values.has(key)?values.get(key):fallback});
 storage.writeJson=async(key,value,condition)=>{if(condition?.ifNoneMatch==='*'&&values.has(key))throw new StorageConflictError();values.set(key,value);};
 try{
  resetCatalogReadCachesForTests();
  const ready=await backfillBudgetSpecificationSelectors();
  assert.deepEqual(Object.keys(ready.markets),['china']);
  assert.equal(ready.markets.china.rows+ready.markets.china.otherRows,1);
  assert.equal([...values.keys()].some(key=>/budget-markets-v7\/[^/]+\/japan.json$/.test(key)),false);
  const firstKeys=[...values.keys()].filter(key=>key.includes('/budget-markets-v7/'));
  const firstValues=firstKeys.map(key=>JSON.stringify(values.get(key)));
  process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);resetCatalogReadCachesForTests();
  await backfillBudgetSpecificationSelectors();
  assert.equal([...values.keys()].filter(key=>key.includes('/budget-markets-v7/')).length,firstKeys.length*2,'a new release has its own immutable selector namespace');
  assert.deepEqual(firstKeys.map(key=>JSON.stringify(values.get(key))),firstValues,'previous live selectors remain byte-for-byte unchanged');
  await backfillBudgetSpecificationSelectors();
  manifest.markets.japan.count=1;resetCatalogReadCachesForTests();
  await assert.rejects(backfillBudgetSpecificationSelectors(),/budget_specification_nonempty_market_missing/);
 }finally{storage.readJson=read;storage.readJsonWithMeta=meta;storage.writeJson=write;if(previousVersion===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=previousVersion;resetCatalogReadCachesForTests();}
});


test('derived selectors retain exact identity and enriched drive/transmission for filtering and price replay',async()=>{
 const {applyEncyclopediaCalculation,compileModelFacts,checksum,modelKey}=await import('../apps/web/lib/encyclopedia/calculation-index');
 const variant={id:'v1',year:2023,trim:'40 TDI S tronic',status:'observed',markets:['europe'],fuel:'diesel',powertrainKind:'combustion',engineCc:1968,powerHp:204,powerKw:150,transmission:'dct',drive:'fwd',bodyType:'sedan'};
 const models={[modelKey('Audi','A6')]:compileModelFacts({id:'model',make:'Audi',model:'A6',revision:'r1',variants:[variant]})};
 const encyclopedia={version:1 as const,digest:checksum(models),manifestDigest:'test',createdAt:'2026-10-22',models};
 const raw:any={id:'known-car',market:'korea',make:'Audi',model:'A6',year:2023,trim:variant.trim,fuel:'diesel',totalRub:950000,catalogPricingMode:'seller',sourcePrice:10000,sourceCurrency:'EUR',powerHp:null,engineCc:null};
 const source=buildBudgetCountIndex('exact-replay',[raw],new Map([[raw.id,0]]),3);
 // Existing immutable selectors predate the encyclopedia identity fields.
 delete source.rows[0][5].trim;
 const matched=applyEncyclopediaCalculation(raw,encyclopedia);
 const rich=await enrichBudgetSpecifications(source,async()=>({generationId:'exact-replay',items:[matched]}));
 const metadata=rich.rows[0][5];
 assert.equal(metadata.trim,variant.trim);assert.equal(metadata.drive,'fwd');assert.equal(metadata.transmission,'dct');
 for(const params of [{drive:'fwd'},{transmission:'dct'},{bodyType:'sedan'},{drive:'awd'}]){
  assert.equal(catalogSearchProjectionMatches({...metadata,market:'korea'},params),catalogSearchProjectionMatches(matched,params));
 }
 const replay=budgetReplayOffer(JSON.parse(JSON.stringify(rich.rows[0])));
 assert.equal(replay.engineCc,null,'old price inputs still contain the original missing field');
 const recovered=applyEncyclopediaCalculation(replay,encyclopedia);
 assert.equal(recovered.engineCc,1968);assert.equal(recovered.powerHp,204);
 assert.equal(recovered.encyclopediaCalculation?.indexDigest,encyclopedia.digest);
 assert.equal(raw.engineCc,null);
});


test('prepared populated partitions do not read the whole catalog for explicitly empty Japan',async()=>{
 const {getJsonStorage}=await import('../apps/web/lib/data');
 const {compressedBudgetSelectors,splitPackedBudgetSelectors}=await import('../apps/web/lib/catalog/budget-selector-codec');
 const {backfillBudgetSpecificationSelectors,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const markets=['china','korea','uae','europe','georgia'];
 const generationId='empty-japan-no-global';
 const offers:any[]=markets.map(market=>({id:market,market,make:'Test',model:'Car',engineCc:1600,totalRub:1000000}));
 const index=buildBudgetCountIndex(generationId,offers,new Map(offers.map(o=>[o.id,0])),3);
 const packed=compressedBudgetSelectors(splitPackedBudgetSelectors(index));
 const root=`catalog/generations/${generationId}/indexes/`;
 const values=new Map<string,any>([['catalog/manifest.json',{generationId,markets:{...Object.fromEntries(markets.map(m=>[m,{count:1}])),japan:{count:0}}}],[root+'budget-markets-v3/ready.json',packed.directory],[root+'budget-cards-v3/0.json',{generationId,items:offers}]]);
 for(const [market,part] of packed.parts)values.set(root+`budget-markets-v3/${market}.json`,part);
 const storage=getJsonStorage(),read=storage.readJson,meta=storage.readJsonWithMeta,write=storage.writeJson;
 let fullReads=0;
 const load=(key:string,fallback:any)=>{if(/budget-count-v[123]\.json$/.test(key)){fullReads++;throw Error('unexpected_whole_catalog');}return values.has(key)?values.get(key):fallback;};
 storage.readJson=async(key,fallback)=>load(key,fallback);
 storage.readJsonWithMeta=async(key,fallback)=>({found:values.has(key),value:load(key,fallback)});
 storage.writeJson=async(key,value)=>{values.set(key,value);};
 try{resetCatalogReadCachesForTests();const ready=await backfillBudgetSpecificationSelectors();assert.deepEqual(Object.keys(ready.markets).sort(),markets.sort());assert.equal(fullReads,0);}
 finally{storage.readJson=read;storage.readJsonWithMeta=meta;storage.writeJson=write;resetCatalogReadCachesForTests();}
});
