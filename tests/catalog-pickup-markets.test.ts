import {compressedBudgetSelectors,splitPackedBudgetSelectors} from '../apps/web/lib/catalog/budget-selector-codec';
import {publicationWithdrawn} from '../apps/web/lib/catalog/publication-policy';
import {filterGreenCorner} from '../apps/web/lib/catalog/green-corner-search';
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogBodyType} from '../apps/web/lib/catalog/pickup-body';
import {commercialParameters} from '../apps/web/lib/catalog/commercial-parameters';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {catalogBodyName} from '../apps/web/lib/catalog/presentation';
import {catalogSearchProjectionMatches,backfillBudgetMarketSelectors,backfillBudgetSpecificationSelectors,searchOffers,countCatalogOffers,readCatalogFacets,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {customsVehicleIdentityEvidence} from '../apps/web/lib/catalog/customs-pricing';
import {normalizedCategory} from '../packages/engine/src/calculation/russiaCustomsV2';

const samples=[
 {market:'uae',make:'Toyota',model:'year 2021 Kilometers 35,202 Kms Regional',trim:'Toyota Hilux ADVENTURE'},
 {market:'europe',make:'Volkswagen',model:'Amarok',bodyType:'offroad'},
 {market:'korea',make:'SsangYong',model:'Rexton',trim:'Sports Khan'},
 {market:'georgia',make:'Ford',model:'F-150'},
 {market:'japan',make:'Toyota',model:'Hilux'},
 {market:'china',make:'Great Wall',model:'King Kong Pao',bodyType:'pickup'},
];
test('all markets share pickup matching, display and editable parameters without inventing mass',()=>{
 for(const row of samples){
  assert.equal(catalogBodyType(row),'pickup',row.market);
  assert.equal(catalogSearchProjectionMatches(row as any,{bodyType:'pickup'}),!publicationWithdrawn(row),row.market);
  if(row.market==='japan')assert.equal(filterGreenCorner([{...row,id:'green',year:2022} as any],{bodyType:'pickup'}).length,1);
  assert.equal(catalogSearchProjectionMatches(row as any,{bodyType:'sedan'}),false,row.market);
  assert.equal(catalogBodyName(row.bodyType,row),'Пикап');
  assert.equal(commercialParameters(row).showCommercial,true);
  assert.equal(offerParameterDraft(row as any).grossVehicleWeightKg,'');
 }
 const hilux=samples[0];
 assert.equal(offerParameterDraft(hilux as any).vehicleCategory,'');
 assert.equal(normalizedCategory({...hilux,sourceTitle:customsVehicleIdentityEvidence(hilux,hilux)}).category,'unknown');
 assert.equal(offerParameterDraft({...hilux,vehicleCategory:'M1'} as any).vehicleCategory,'M1');
 assert.equal(offerParameterDraft({...hilux,vehicleCategory:'N1',grossVehicleWeightKg:2910} as any).grossVehicleWeightKg,'2910');
});
test('SUVs, combined source buckets and explicit staff corrections do not become pickups',()=>{
 for(const row of [
  {make:'Toyota',model:'Hilux Surf',bodyType:'offroad'},
  {make:'SsangYong',model:'Rexton',bodyType:'suv'},
  {make:'SsangYong',model:'Musso',bodyType:'suv'},
  {make:'Ford',model:'Maverick',bodyType:'suv'},
  {make:'BMW',model:'X3',bodyType:'SUV/Geländewagen/Pickup'},
  {make:'Toyota',model:'Hilux',editorialSpecifications:{bodyType:'offroad'}},
 ])assert.notEqual(catalogBodyType(row),'pickup',JSON.stringify(row));
});
test('existing compact indexes are upgraded for counts, facets and pages including all-market search',async()=>{
 const generationId='pickups-all-markets';
 const rows=samples.map((row,i)=>({...row,id:'pickup-'+i,year:2022,sourcePrice:10000,sourceCurrency:'USD',totalRub:null,catalogPricingMode:'seller',sellerPriceRub:1000000,cardProjectionVersion:3,cardImageUrl:'https://example.com/car.jpg'}));
 const source=buildBudgetCountIndex(generationId,rows as any,new Map(rows.map(r=>[r.id,0])),3);
 // Reproduce pre-fix metadata: trim is intentionally absent from the compact index.
 delete source.bodyFilterVersion;
 for(const entry of [...source.rows,...source.otherRows!])entry[5].bodyType=rows.find(r=>r.id===entry[5].id)?.bodyType;
 const values=new Map<string,any>([
  ['catalog/manifest.json',{generationId,markets:Object.fromEntries(rows.map(r=>[r.market,{count:1}]))}],
  [`catalog/generations/${generationId}/indexes/budget-count-v3.json`,source],
  [`catalog/generations/${generationId}/indexes/budget-cards-v3/0.json`,{generationId,items:rows}],
 ]);
 const old=compressedBudgetSelectors(splitPackedBudgetSelectors(source));
 for(const [market,part] of old.parts)values.set(`catalog/generations/${generationId}/indexes/budget-markets-v4/${market}.json`,part);
 values.set(`catalog/generations/${generationId}/indexes/budget-markets-v4/ready.json`,old.directory);
 const oldObjects=JSON.stringify([...values].filter(([key])=>key.includes('/budget-markets-v4/')));
 const storage=getJsonStorage(),read=storage.readJson,meta=storage.readJsonWithMeta,write=storage.writeJson;
 storage.readJson=async <T>(key:string,fallback:T)=>values.has(key)?values.get(key):fallback;
 storage.readJsonWithMeta=async <T>(key:string,fallback:T)=>({found:values.has(key),value:values.has(key)?values.get(key):fallback});
 storage.writeJson=async(key,value,condition)=>{if(condition?.ifNoneMatch && values.has(key))throw new StorageConflictError();values.set(key,value);};
 try{
  resetCatalogReadCachesForTests();await backfillBudgetMarketSelectors();await backfillBudgetSpecificationSelectors();
  await backfillBudgetSpecificationSelectors(); // Re-running preparation is safe.
  assert.equal(JSON.stringify([...values].filter(([key])=>key.includes('/budget-markets-v4/'))),oldObjects,'previous release selectors stay immutable');
  for(const market of [undefined,...samples.map(s=>s.market)]){
   const query={bodyType:'pickup',market};
   const [result,count,facets]=await Promise.all([searchOffers(query),countCatalogOffers(query),readCatalogFacets(query)]);
   const expected=market?Number(!publicationWithdrawn({market})):samples.filter(s=>!publicationWithdrawn(s)).length;
   assert.equal(count.total,expected,market||'all');
   assert.equal(result.total,count.total);
   assert.equal(result.items.length,count.total);
   assert.ok(result.items.every(r=>r.bodyType==='pickup'));
   assert.deepEqual(facets.bodyTypes,expected?['pickup']:[]);
  }
 }finally{storage.readJson=read;storage.readJsonWithMeta=meta;storage.writeJson=write;resetCatalogReadCachesForTests();}
});


test('pickup source predicate is present before count and pagination for Japan and Korea',async()=>{
 const {ajesQuery,ajesCatalogQuery}=await import('../apps/web/lib/catalog/ajes-query');
 for(const market of ['japan','korea'])for(const aggregate of [undefined,'count'] as const){
  const query=ajesQuery({...ajesCatalogQuery({market,bodyType:'pickup'}),aggregate});
  assert.match(query.sql,/model_name like '%REXTON%'/);assert.match(query.sql,/model_name like '%HILUX%'/);
  if(!aggregate)assert.ok(query.sql.indexOf("model_name like '%REXTON%'")<query.sql.indexOf('limit'));
  if(market==='korea')assert.match(query.sql,/info like '%pickup%'/);else assert.doesNotMatch(query.sql,/info like/);
 }
 assert.equal(ajesCatalogQuery({market:'japan',bodyType:'pickup|suv'}).pickup,undefined,'never narrow mixed body selection to pickups');
 assert.throws(()=>ajesQuery({pickup:'anything' as any}));
});
