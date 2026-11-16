import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildBudgetCountIndex,splitBudgetReplayIndex,type BudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {buildBudgetSpecificationSource,assertBudgetSupplementObject} from '../apps/web/lib/catalog/budget-source-supplements';
import {budgetCardGroups,assertBudgetSupplementCard} from '../apps/web/lib/catalog/budget-card-reference';
import {enrichBudgetSpecifications} from '../apps/web/lib/catalog/budget-specification-index';
import {compressBudgetSelector,packBudgetSelector,specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec';
import {readCompressedSelector} from '../apps/web/lib/catalog/budget-selector-publication';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {readBudgetSpecificationSource,verifyBudgetSpecificationSource,backfillBudgetSpecificationSelectors,
 searchOffers,countCatalogOffers,readCatalogFacets,resetCatalogReadCachesForTests,warmBudgetPriceCaches,
 prepareCatalogProjectionRows,prepareBudgetSpecificationSourceRows} from '../apps/web/lib/catalog/storage';
import {withCatalogEditorial} from '../apps/web/lib/catalog/editorial';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const generationId='gen_1794665184205_cfd76b47',calculationVersion='a'.repeat(64);
const missingIds=['291f2b7703a3b68aa76253cd','f8b2705e947357c174ba4b55','8ca9a91f7d9653e1fe307d00'];
// Exact reported missing IDs and structural shape; names/prices/media below are
// synthetic fixtures, not assertions about those actual supplier listings.
function unpriced(id:string):any{return {id,market:'uae',make:'Toyota',model:'Corolla',year:2026,trim:'Fixture',
 sourceGroup:'dubicars_uae_exact',sourcePrice:50000,sourceCurrency:'AED',sellerPriceRub:1100000,
 totalRub:null,catalogPricingMode:'seller',calculationStatus:'needs_data',cardProjectionVersion:3,
 calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'AED',sourcePrice:50000,effectiveRate:22},sourcePriceRub:1100000},
 cardImageUrl:'https://example.com/car.jpg',fuel:'petrol',transmission:'automatic',bodyType:'sedan',
 updatedAt:'2026-11-15T12:00:00.000Z',mileageKm:1000};}
function pureFixture(priced=false){
 const rows=['kept',...missingIds].map(unpriced);
 if(priced)for(const row of rows)Object.assign(row,{market:'korea',sourceGroup:undefined,make:'Hyundai',model:'Avante',
  year:new Date().getUTCFullYear()-2,engineCc:1598,powerHp:123,powertrainKind:'combustion',drive:'fwd',
  publicSpecificationVerified:true,calculationStatus:'ready',sourcePrice:undefined,sourceCurrency:undefined,
  catalogPricingMode:undefined,sellerPriceRub:undefined,totalRub:1000000,publicVisibleRub:1000000,
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:1000000,deliveryRub:0,percents:[]}}});
 const raw=buildBudgetCountIndex(generationId,rows.slice(0,1),new Map([['kept',0]]),3);
 const split=priced?splitBudgetReplayIndex(raw):{index:raw,chunks:[]};
 return {rows,index:split.index,chunks:split.chunks,input:{index:split.index,projection:{generationId,items:rows},
  market:rows[0].market,expectedRows:rows.length,prepareRows:(items:any[])=>items,calculationVersion,encyclopediaDigest:null}};
}

test('missing three IDs receive real immutable card objects, with old order and mappings unchanged',()=>{
 const f=pureFixture(),before=JSON.stringify(f.index),plan=buildBudgetSpecificationSource(f.input);
 assert.equal(JSON.stringify(f.index),before);assert.equal(plan.index.sourceRows,4);
 assert.deepEqual(plan.index.otherRows![0],f.index.otherRows![0]);
 assert.deepEqual(plan.descriptor.missingIds,[...missingIds].sort());
 assert.deepEqual(buildBudgetSpecificationSource(f.input),plan,'preflight is deterministic');
 assert.deepEqual(plan.index.pricingChunks,{},'inline replay uses the publisher canonical empty map, not an empty market list');
 assert.equal(plan.descriptor.pricingChunksSha256,hash({}));
 assert.equal(plan.objects.length,1);assert.equal(plan.descriptor.objects[0].kind,'card');
 const rows=[...plan.index.rows,...plan.index.otherRows!],groups=budgetCardGroups(rows,3);
 assert.equal(groups.length,2,'generic block zero and supplemental block zero stay distinct');
 assert.equal(groups[0].path,'budget-cards-v3/0.json');
 const added=groups.find(group=>group.supplement)!;
 assert.equal(added.rows.length,3);assert.equal(added.path,plan.objects[0].path);
 assertBudgetSupplementCard(added,plan.objects[0].value,generationId);
 assertBudgetSupplementObject(plan.descriptor.objects[0],plan.objects[0].value);
 assert.throws(()=>assertBudgetSupplementCard(added,{...plan.objects[0].value,items:[]},generationId),/invalid/);
 assert.throws(()=>assertBudgetSupplementObject(plan.descriptor.objects[0],{...plan.objects[0].value,block:99}),/changed/);
});

test('priced missing rows append their own replay chunks without changing existing pricing inputs',()=>{
 const f=pureFixture(true),before=JSON.stringify(f.index),plan=buildBudgetSpecificationSource(f.input);
 assert.equal(JSON.stringify(f.index),before);assert.equal(plan.index.rows.length,4);
 assert.deepEqual(plan.index.rows[0],f.index.rows[0]);
 assert.equal(plan.index.pricingChunks!.korea[0],f.index.pricingChunks!.korea[0]);
 assert.equal(plan.index.pricingChunks!.korea.length,2);
 const replay=plan.objects.find(object=>object.path.includes('/replay/'))!;
 assert.ok(replay);assert.deepEqual(replay.value.entries.map((row:any)=>row[0]),[...missingIds].sort());
 assert.equal(plan.index.pricingChunks!.korea[1],replay.path);
 assert.ok(plan.index.rows.slice(1).every(row=>row[7]===undefined&&row[5].cardPath));
});

test('incomplete/stale projections, duplicated or foreign IDs, Japan and corrupt card paths cannot be admitted',()=>{
 for(const change of [f=>f.input.expectedRows++,f=>f.input.projection.generationId='old',
  f=>f.input.projection.items[1].id='kept',f=>f.input.market='japan',
  f=>f.input.prepareRows=()=>[{...f.rows[0],id:'outside'}],
  f=>f.input.calculationVersion='../other',f=>f.input.encyclopediaDigest='bad'] as Array<(f:any)=>void>){
  const f=pureFixture();change(f);assert.throws(()=>buildBudgetSpecificationSource(f.input),/budget_supplement_/);
 }
 const plan=buildBudgetSpecificationSource(pureFixture().input),row=structuredClone(plan.index.otherRows![1]);
 row[5].cardPath='budget-cards-v3/0.json';assert.throws(()=>budgetCardGroups([row],3),/scope/);
 row[5].cardPath=plan.objects[0].path.replace('/uae/','/korea/');assert.throws(()=>budgetCardGroups([row],3),/scope/);
 const other=buildBudgetSpecificationSource({...pureFixture().input,calculationVersion:'b'.repeat(64)});
 assert.notEqual(other.objects[0].path,plan.objects[0].path,'calculator context isolates objects');
});

test('specification enrichment reads every declared path even when its local block ordinal collides',async()=>{
 const f=pureFixture(),plan=buildBudgetSpecificationSource(f.input),reads:string[]=[];
 const objects=new Map(plan.objects.map(row=>[row.path,row.value]));
 objects.set('budget-cards-v3/0.json',{generationId,items:[f.rows[0]]});
 const rich=await enrichBudgetSpecifications(plan.index,async(_block,path)=>{reads.push(path!);return objects.get(path!);});
 assert.equal(reads.length,2);assert.equal(rich.sourceRows,4);
 assert.deepEqual(rich.otherRows!.map(row=>row[5].id),['kept',...[...missingIds].sort()]);
 assert.deepEqual(rich.otherRows!.map(row=>row[5].cardPath),plan.index.otherRows!.map(row=>row[5].cardPath));
});

test('source preparation fails before writing on oversized rows or an unbounded missing set',()=>{
 const large=pureFixture();large.rows[1].cardImageUrl='x'.repeat(4*1024*1024);
 assert.throws(()=>buildBudgetSpecificationSource(large.input),/capacity/);
 const many=pureFixture();many.input.projection.items=[many.rows[0],...Array.from({length:10001},(_,i)=>unpriced(`missing-${i}`))];
 many.input.expectedRows=many.input.projection.items.length;
 assert.throws(()=>buildBudgetSpecificationSource(many.input),/capacity/);
});

function runtimeFixture(priced=false){
 const f=pureFixture(priced),market=f.input.market,storage=getJsonStorage();
 const prior={read:storage.readJson,meta:storage.readJsonWithMeta,write:storage.writeJson,
  calculation:process.env.AVTOCENA_CALCULATION_VERSION,rate:process.env.CATALOG_LIVE_RATE_DISABLED,fetch:globalThis.fetch};
 process.env.AVTOCENA_CALCULATION_VERSION=calculationVersion;process.env.CATALOG_LIVE_RATE_DISABLED='true';
 globalThis.fetch=async()=>{throw Error('unexpected_network');};
 const prefix=`catalog/generations/${generationId}/indexes/`,stored=new Map<string,any>(),reads:string[]=[],writes:string[]=[];
 const manifest:any={version:2,generationId,markets:Object.fromEntries(['china','korea','uae','europe','georgia','japan'].map(key=>[key,{count:key===market?4:0}]))};
 const wire=compressBudgetSelector(packBudgetSelector(f.index));
 stored.set('catalog/manifest.json',manifest);
 stored.set(prefix+'projection/'+market+'.json',f.input.projection);
 stored.set(prefix+'budget-count-v3.json',f.index);
 stored.set(prefix+'budget-markets-v3/ready.json',{version:3,generationId,markets:{[market]:{
  rows:f.index.rows.length,otherRows:f.index.otherRows!.length,checksum:hash(wire)}}});
 stored.set(prefix+'budget-markets-v3/'+market+'.json',wire);
 stored.set(prefix+'budget-cards-v3/0.json',{generationId,items:[f.rows[0]]});
 for(const chunk of f.chunks)stored.set(prefix+chunk.path,chunk.value);
 stored.set('catalog-editorial/current.json',{revision:'0',entries:{}});
 stored.set('markets/markets.json',[{id:market,versions:[{id:'current',status:'active',securityDepositRub:0}]}]);
 const date=new Date().toISOString();
 stored.set('fees/exchange-rates.json',{updatedAt:date,AED:{cbrRate:22,nominal:1,rateDate:date,rateSource:'cbr'},
  KRW:{cbrRate:6,nominal:100,rateDate:date,rateSource:'cbr'},EUR:{cbrRate:100,nominal:1,rateDate:date,rateSource:'cbr'}});
 storage.readJson=async<T>(key:string,fallback:T)=>{reads.push(key);return structuredClone(stored.has(key)?stored.get(key):fallback);};
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{const value=await storage.readJson(key,fallback);return {value,found:stored.has(key),etag:stored.has(key)?hash(value):undefined};};
 storage.writeJson=async(key,value,condition)=>{
  if(key.includes('budget-source-supplements-v1'))assert.equal(condition?.ifNoneMatch,'*');
  if(key.includes('/budget-markets-v3/')||key.includes('/budget-cards-v3/')||key.endsWith('budget-count-v3.json'))assert.fail('generic object changed');
  writes.push(key);stored.set(key,structuredClone(value));
 };
 const reset=()=>{resetCatalogReadCachesForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();reads.length=0;};reset();
 return {...f,market,manifest,stored,reads,writes,prefix,reset,cleanup(){
  storage.readJson=prior.read;storage.readJsonWithMeta=prior.meta;storage.writeJson=prior.write;globalThis.fetch=prior.fetch;
  for(const [key,value]of [['AVTOCENA_CALCULATION_VERSION',prior.calculation],['CATALOG_LIVE_RATE_DISABLED',prior.rate]])
   if(value===undefined)delete process.env[key!];else process.env[key!]=value;
  reset();
 }};
}

test('real background preparation and fresh verifier preserve missing ordinary rows without generic writes',async()=>{
 const f=runtimeFixture();
 try{
  const planned=await readBudgetSpecificationSource(f.manifest,'uae');
  assert.equal(f.writes.length,0);assert.equal(planned.descriptor.missingIds.length,3);
  await assert.rejects(verifyBudgetSpecificationSource(f.manifest,'uae'),/budget_supplement_object_changed/);
  await backfillBudgetSpecificationSelectors(['uae']);
  assert.deepEqual(await verifyBudgetSpecificationSource(f.manifest,'uae'),planned.descriptor);
  const selectorPrefix=f.prefix+specificationSelectorDirectory(readCalculationIndex()?.digest||null,calculationVersion)+'/';
  const actual=await readCompressedSelector(f.stored.get(selectorPrefix+'ready.json'),'uae',async name=>f.stored.get(selectorPrefix+name+'.json'));
  assert.ok(actual);assert.equal(hash(actual.pricingChunks??null),planned.descriptor.pricingChunksSha256);
  assert.equal(f.writes.filter(path=>path.includes('/cards/uae/')).length,1);
  const written=f.writes.length;
  for(const sort of ['updatedAt','year','totalRub','totalRubDesc']){
   f.reset();
   const result=await searchOffers({market:'uae',make:'Toyota',model:'Corolla',sort,pageSize:10});
   assert.equal(result.total,4,sort);assert.deepEqual(result.items.map(row=>row.id).sort(),['kept',...missingIds].sort(),sort);
   assert.ok(result.items.every(row=>row.engineCc==null&&row.powerHp==null&&row.totalRub==null),'unknown source specifications and delivered totals remain unknown');
   assert.equal(f.reads.some(path=>path.includes('/projection/')),false,'visitor never loads whole projection');
   assert.ok(f.reads.some(path=>path.includes('/cards/uae/')),'visitor reads the real supplement');
   assert.equal((await countCatalogOffers({market:'uae',make:'Toyota',model:'Corolla'})).total,4);
   assert.ok(await readCatalogFacets({market:'uae',make:'Toyota',model:'Corolla'}));
  }
  assert.equal(f.writes.length,written,'visitor and verifier do not write');
  process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);
  await assert.rejects(verifyBudgetSpecificationSource(f.manifest,'uae'),/budget_supplement_object_changed/,'old calculator objects do not satisfy a new context');
  process.env.AVTOCENA_CALCULATION_VERSION=calculationVersion;
  const path=f.prefix+planned.descriptor.objects[0].path;
  f.stored.set(path,{...f.stored.get(path),items:[]});f.reset();
  await assert.rejects(verifyBudgetSpecificationSource(f.manifest,'uae'),/changed/);
 }finally{f.cleanup();}
});

test('real price preparation consumes new replay/card identities and serves prepared budget pages',async()=>{
 const f=runtimeFixture(true);
 try{
  await backfillBudgetSpecificationSelectors(['korea']);
  const plan=await verifyBudgetSpecificationSource(f.manifest,'korea');
  assert.equal(plan.missingIds.length,3);assert.equal(plan.objects.filter(row=>row.kind==='replay').length,1);
  await warmBudgetPriceCaches(['korea']);
  f.reset();const written=f.writes.length;
  const result=await searchOffers({market:'korea',make:'Hyundai',model:'Avante',budgetTo:3000000,sort:'totalRub',pageSize:10});
  assert.equal(result.total,4);assert.deepEqual(result.items.map(row=>row.id).sort(),['kept',...missingIds].sort());
  assert.equal(f.writes.length,written);
  assert.equal(f.reads.some(path=>path.includes('/projection/')||path.includes('/replay/')||path.includes('/budget-prices-v3/')),false);
  const spec=specificationSelectorDirectory(readCalculationIndex()?.digest||null,calculationVersion);
  assert.equal(f.reads.some(path=>path.startsWith(f.prefix+spec+'/parts/')),false,'prepared hit skips full source selector');
 }finally{f.cleanup();}
});

test('source union is independent of editorial ALS while requests honor hide, specifications and later unhide',async()=>{
 const f=runtimeFixture();
 try{
  const planned=await readBudgetSpecificationSource(f.manifest,'uae');
  const hidden=missingIds[0],edited=missingIds[1];
  const entries:any={
   [hidden]:{id:hidden,market:'uae',status:'hidden'},
   [edited]:{id:edited,market:'uae',status:'visible',specifications:{drive:'awd'}},
  };
  f.stored.set('catalog-editorial/current.json',{revision:'hidden-and-edited',entries});f.reset();
  await withCatalogEditorial(async()=>{
   assert.equal(prepareCatalogProjectionRows(f.rows).length,3,'existing visitor admission still hides the row');
   assert.equal(prepareBudgetSpecificationSourceRows(f.rows).length,4,'source admission retains hidden rows');
   assert.deepEqual((await readBudgetSpecificationSource(f.manifest,'uae')).descriptor,planned.descriptor);
   await backfillBudgetSpecificationSelectors(['uae']);
   assert.deepEqual(await verifyBudgetSpecificationSource(f.manifest,'uae'),planned.descriptor);
  });
  f.reset();
  const visible=await searchOffers({market:'uae',make:'Toyota',model:'Corolla',pageSize:10});
  assert.deepEqual(visible.items.map(row=>row.id).sort(),['kept',...missingIds.filter(id=>id!==hidden)].sort());
  const filtered=await searchOffers({market:'uae',make:'Toyota',model:'Corolla',drive:'awd',pageSize:10});
  assert.deepEqual(filtered.items.map(row=>row.id),[edited]);
  const writes=f.writes.length;
  f.stored.set('catalog-editorial/current.json',{revision:'unhidden',entries:{...entries,[hidden]:{...entries[hidden],status:'visible'}}});f.reset();
  const restored=await searchOffers({market:'uae',make:'Toyota',model:'Corolla',pageSize:10});
  assert.equal(restored.total,4);assert.deepEqual(restored.items.map(row=>row.id).sort(),['kept',...missingIds].sort());
  assert.equal(f.writes.length,writes,'unhide needs no source rebuild or visitor write');
  assert.equal(f.reads.some(path=>path.includes('/projection/')),false,'unhide reads the existing candidate cards');
 }finally{f.cleanup();}
});
