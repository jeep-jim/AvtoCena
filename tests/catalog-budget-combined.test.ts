import {applyDepositToProjection} from "../apps/web/lib/catalog/deposit-cost-projection";
import test from 'node:test';
import {modificationBinding} from '../apps/web/lib/catalog/modification-contract';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {searchOffers,countCatalogOffers,readCatalogFacets,readCatalogBrandCounts,resetCatalogReadCachesForTests,catalogSearchProjectionMatches,prepareCatalogProjectionRows} from '../apps/web/lib/catalog/storage';

test('budget with year and mileage uses only candidate blocks and keeps exact results/counts/facets',async()=>{
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,totalRub:1500000,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=[{...base,id:'match'},{...base,id:'old',year:2020},{...base,id:'mileage',mileageKm:90000},{...base,id:'unknown-mileage',mileageKm:undefined},{...base,id:'expensive',totalRub:4000000,publicVisibleRub:4000000},{...base,id:'diesel',fuel:'diesel'}];
 const unresolved:any={...base,id:'needs-modification',sourcePrice:10000,sourceCurrency:'USD',totalRub:null,publicVisibleRub:undefined,calculationStatus:'needs_modification',recoveryQualification:{status:'selection_required'}};
 unresolved.modificationSelection={version:1,status:'selection_required',binding:modificationBinding(unresolved),options:[{id:'petrol',label:'1.6',market:'korea',fuel:'petrol',powertrainKind:'combustion',engineCc:1598,powerHp:123,powerKw:90.47,evidenceIds:['fixture']}]};
 rows.push(unresolved);
 assert.equal(prepareCatalogProjectionRows(rows).length,rows.length);
 const generationId='combined-budget',index=buildBudgetCountIndex(generationId,rows,new Map(rows.map((row,i)=>[row.id,i])));
 const storage=getJsonStorage(),original=storage.readJsonWithMeta;
 const reads:string[]=[];
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);let value:unknown;
  if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:110000}]}];
  else if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}}};
  else if(key.endsWith('/budget-count-v2.json'))value=index;
  else if(key.includes('/budget-cards-v2/')){const block=Number(key.split('/').at(-1)!.replace('.json',''));value={generationId,items:[rows[block]]};}
  else assert.fail('unexpected large or unrelated storage read: '+key);
  return {found:true,value:value as T};
 };
 try{
  for(const filterVersion of [1,undefined] as const){
   index.filterVersion=filterVersion;
   for(const params of [{budgetTo:1710000,yearFrom:2022},{budgetTo:1710000,yearFrom:2022,mileageTo:50000},{budgetTo:1710000,yearFrom:2022,mileageTo:50000,fuel:'petrol'},{budgetTo:100000,yearFrom:2022,mileageTo:50000}]){
   resetCatalogReadCachesForTests();reads.length=0;
   const expected=rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).map(row=>row.id).sort();
   const [results,count,facets,brands]=await Promise.all([searchOffers(params),countCatalogOffers(params),readCatalogFacets(params),readCatalogBrandCounts(params)]);
   assert.deepEqual(brands.counts,expected.length?{Hyundai:expected.length}:{});
   assert.deepEqual(results.items.map(row=>row.id).sort(),expected);
   assert.equal(count.total,expected.length);assert.equal(results.total,expected.length);
   assert.deepEqual(facets.makes,expected.length?['Hyundai']:[]);
   assert.equal(reads.some(key=>key.includes('projection')),false);
   assert.equal(reads.some(key=>key.endsWith('/1.json')||key.endsWith('/4.json')),false,'old and expensive blocks are never read');
   assert.equal(reads.filter(key=>key.endsWith('/budget-count-v2.json')).length,1,'facets, count and results share the index');
  }
  }
  index.filterVersion=1;resetCatalogReadCachesForTests();reads.length=0;
  const params={budgetTo:1710000,yearFrom:2022,mileageTo:50000};
  const [count,facets,brands]=await Promise.all([countCatalogOffers(params),readCatalogFacets(params),readCatalogBrandCounts(params)]);
   assert.deepEqual(brands.counts,rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).length?{Hyundai:rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).length}:{});
  assert.equal(count.total,2);assert.deepEqual(facets.makes,['Hyundai']);
  assert.equal(reads.some(key=>key.includes('budget-cards-v2')),false,'mileage counts and facets never load card blocks with the compact mileage index');
  for(const params of [{bodyType:'sedan'},{bodyType:'suv'},{fuel:'petrol',transmission:'automatic',drive:'fwd'},{yearFrom:2022,mileageTo:50000}]){
   resetCatalogReadCachesForTests();reads.length=0;
   const expected=rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).map(row=>row.id).sort();
   const [count,facets,brands]=await Promise.all([countCatalogOffers(params),readCatalogFacets(params),readCatalogBrandCounts(params)]);
   assert.deepEqual(brands.counts,rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).length?{Hyundai:rows.map(row=>applyDepositToProjection(row,110000)).filter(row=>catalogSearchProjectionMatches(row,params)).length}:{});
   assert.equal(count.total,expected.length);assert.deepEqual(facets.makes,expected.length?['Hyundai']:[]);
   assert.equal(reads.some(key=>key.includes('budget-cards-v2')),false,'ordinary filter counts never load card blocks');
   const result=await searchOffers(params);
   assert.deepEqual(result.items.map(row=>row.id).sort(),expected);
  }
 }finally{storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});
