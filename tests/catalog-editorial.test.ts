import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {applyCatalogEditorial,cleanEditorialInput,editorialHidden,readCatalogEditorial,resetCatalogEditorialCache,saveCatalogEditorial,withCatalogEditorial,EditorialConflict} from '../apps/web/lib/catalog/editorial';
import {canEditCatalog} from '../apps/web/lib/catalog/editorial-access';
import {searchOffers,countCatalogOffers,readCatalogBrandCounts,readCatalogBrandModelCounts,readCatalogFacets,readHomeCatalogSnapshot,buildCatalogBrandSummary,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {catalogOfferTitle} from '../apps/web/lib/catalog/presentation';
const actor={id:'owner',displayName:'Редактор'};
const photo='/api/site-media/'+'a'.repeat(64);
const input=(changes:Record<string,unknown>={})=>cleanEditorialInput({title:'',photos:null,status:'hidden',reason:'На фото заглушка',version:null,...changes});

test('catalog editing is tenant-scoped, rejects invalid input and never accepts remote photo URLs',()=>{
 const owner:any={...actor,role:'owner',companyId:'dealer_topavto'};
 assert.equal(canEditCatalog(owner),true);
 for(const user of [null,{...owner,role:'manager',permissions:{catalog:true}},{...owner,companyId:'other'},{...owner,status:'disabled'},{...owner,role:'dealer',permissions:{catalog:true}},{...owner,role:'admin',permissions:{catalog:false}}])assert.equal(canEditCatalog(user),false);
 for(const changes of [{title:'a'.repeat(201)},{status:'deleted'},{photos:[]},{photos:['http://127.0.0.1/private']},{photos:['//example.com/x']},{photos:['javascript:alert(1)']},{photos:Array(31).fill(photo)},{version:7}])assert.throws(()=>input(changes));
 assert.deepEqual(input({photos:[photo]}).photos,[photo]);
});

test('manual edits survive publication, hide before pagination and keep counts, facets, homepage and restore consistent',async()=>{
 const storage=getJsonStorage(),oldRead=storage.readJsonWithMeta,oldWrite=storage.writeJson;
 const records=new Map<string,{value:any;etag:string}>();let sequence=0,generationId='editorial-a';
 const base:any={market:'korea',make:'Hyundai',model:'Avante',year:2024,totalRub:1500000,sourceId:'fixture',sourceOfferId:'1',sourcePrice:1000000,sourceCurrency:'RUB',mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'sedan',cardImageUrl:'https://example.com/car.jpg',images:[{url:'https://example.com/car.jpg'}],cardProjectionVersion:3,publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const rows=[{...base,id:'first'},{...base,id:'second',sourceOfferId:'2',model:'Sonata'},{...base,id:'third',sourceOfferId:'3'}];
 const reads:string[]=[];
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);const saved=records.get(key);if(saved)return {found:true,value:structuredClone(saved.value) as T,etag:saved.etag};
  let value:any;
  if(key==='catalog/manifest.json')value={generationId,markets:{korea:{count:rows.length}},updatedAt:base.updatedAt};
  else if(key==='catalog/public/brand-summary.json')value=buildCatalogBrandSummary(generationId,rows);
  else if(key.includes('/projection/')||key.includes('/projection-brand/'))value={generationId,items:rows};
  else if(key.endsWith('/budget-count-v2.json'))value=buildBudgetCountIndex(generationId,rows,new Map(rows.map(r=>[r.id,0])));
  else if(key.includes('/budget-cards-v2/'))value={generationId,items:rows};
  else if(key==='markets/markets.json')value=[{id:'korea',versions:[{id:'fixture',status:'active',securityDepositRub:0}]}];
  return {found:value!==undefined,value:(value??fallback) as T};
 };
 storage.writeJson=async(key,value,condition)=>{
  const saved=records.get(key);
  if((condition?.ifNoneMatch==='*'&&saved)||(condition?.ifMatch&&condition.ifMatch!==saved?.etag))throw new StorageConflictError();
  records.set(key,{value:structuredClone(value),etag:String(++sequence)});
 };
 try{
  resetCatalogEditorialCache();resetCatalogReadCachesForTests();
  const before=await searchOffers({market:'korea',pageSize:1});assert.equal(before.total,3);
  const victim=rows.find(r=>r.id===before.items[0].id)!;
  let saved=await saveCatalogEditorial(victim,input({title:'Проверенный автомобиль',photos:[photo]}),actor,'Hyundai Avante');
  for(const params of [{market:'korea',pageSize:1},{market:'korea',make:'Hyundai',pageSize:1},{market:'korea',yearFrom:2022,pageSize:1},{market:'korea',budgetTo:2000000,pageSize:1}]){
   const result=await searchOffers(params);assert.equal(result.total,2);assert.equal(result.items.length,1);assert.notEqual(result.items[0].id,victim.id);
   const next=await searchOffers({...params,page:2});assert.equal(next.items.length,1);assert.notEqual(next.items[0].id,result.items[0].id);assert.notEqual(next.items[0].id,victim.id);
   assert.equal((await countCatalogOffers(params)).total,2);
  }
  assert.equal((await readCatalogBrandCounts({market:'korea'})).counts.Hyundai,2);
  assert.equal((await readCatalogBrandModelCounts('Hyundai')).models.reduce((s,m)=>s+m.count,0),2);
  assert.deepEqual((await readCatalogFacets({market:'korea',yearFrom:2022})).makes,['Hyundai']);
  const home=await readHomeCatalogSnapshot(2);assert.equal(home.marketCounts.korea,2);assert.equal(home.items.some(r=>r.id===victim.id),false);
  // Source regeneration changes neither editorial status nor images/title.
  generationId='editorial-b';resetCatalogReadCachesForTests();resetCatalogEditorialCache();
  assert.equal((await searchOffers({market:'korea'})).items.some(r=>r.id===victim.id),false);
  await assert.rejects(saveCatalogEditorial(victim,input({version:null}),actor,'Original'),EditorialConflict);
  saved=await saveCatalogEditorial(victim,input({title:saved.title,photos:saved.photos,status:'visible',version:saved.version}),actor,'Original');
  const restored=await searchOffers({market:'korea'});assert.equal(restored.total,3);
  const visible=restored.items.find(r=>r.id===victim.id)!;
  assert.equal(catalogOfferTitle(visible),'Проверенный автомобиль');assert.equal(visible.images[0].url,photo);assert.equal(visible.totalRub,base.totalRub);
  await withCatalogEditorial(async()=>{assert.equal(editorialHidden(victim),false);assert.equal(applyCatalogEditorial({...victim,sourceOfferId:'different'}).cardImageUrl,base.cardImageUrl);});
  // Concurrent changes to the same record cannot silently overwrite each other.
  const attempts=await Promise.allSettled([saveCatalogEditorial(victim,input({version:saved.version}),actor,'Original'),saveCatalogEditorial(victim,input({version:saved.version,status:'archived'}),actor,'Original')]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected'&&r.reason instanceof EditorialConflict).length,1);
  // Other records merge under CAS and retain the earlier edit.
  await saveCatalogEditorial(rows.find(r=>r.id!==victim.id)!,input(),actor,'Another');
  assert.equal(Object.keys((await readCatalogEditorial()).entries).length,2);
  assert.equal(reads.filter(k=>k==='catalog-editorial/current.json').length<25,true,'small moderation index is shared across query/count/facet reads');
 }finally{storage.readJsonWithMeta=oldRead;storage.writeJson=oldWrite;resetCatalogEditorialCache();resetCatalogReadCachesForTests();}
});
