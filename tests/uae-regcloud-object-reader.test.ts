import "./helpers/server-only-hook.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getJsonStorage,ObjectJsonStorage} from '../apps/web/lib/data';
import {openConfiguredUaeRegcloudFiles,UAE_PUBLIC_CONTROL} from '../apps/web/lib/catalog/uae-regcloud-object-reader';

const nativePhoto='https://www.dubicars.com/images/vehicles/kia-sportage.jpg';
const rejectedPhoto='https://unknown.example/images/kia.jpg';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const binary=(v:unknown)=>{const data=Buffer.from(JSON.stringify(v));return {data,size:data.length,checksum:sha(data)};};
const env={
 AVTOCENA_UAE_REGCLOUD_RUNTIME:'1',YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',
 YC_OBJECT_STORAGE_BUCKET:'fixture-owned',YC_OBJECT_STORAGE_PREFIX:'fixture-owned',
 YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture',
};
const gen='gen_1795233600000_uaepin',run='uae-test-fixture',root=`catalog/private-market-stage-v1/uae/${run}/`;
function fixture(t:any){
 const restore=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(restore))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const hash='a'.repeat(64),admitted={seller:1,onRequest:1,retainedDelivered:1};
 const doc={version:1,kind:'uae-public-directory-v1',market:'uae',generationId:gen,
  sourceReceiptSha256:hash,priceReceiptSha256:hash,admitted},directory=binary(doc);
 const good={version:1,kind:'uae-private-runtime-ready-v1',market:'uae',runId:run,generationId:gen,
  sourceReceiptSha256:hash,priceReceiptSha256:hash,retainedDetailReceiptSha256:hash,editorialReceiptSha256:hash,
  publicDirectorySha256:directory.checksum,admitted,legalValidUntil:Date.now()+600000};
 const f={controlMarket:'uae',ready:binarize(good),directory,etag:'opaque',reads:[] as string[],switchAtDirectory:false,previous:null as null|{runId:string;generationId:string;readySha256:string}};
 function binarize(value:unknown){return binary(value);}
 t.mock.method(ObjectJsonStorage.prototype,'readScopedControl',async(key:string)=>{
   f.reads.push(key);assert.equal(key,UAE_PUBLIC_CONTROL);
   return {...binary({version:1,market:f.controlMarket,revision:2,
    active:{runId:run,generationId:gen,readySha256:f.ready.checksum},previous:f.previous}),etag:f.etag};
 });
 t.mock.method(ObjectJsonStorage.prototype,'getBinaryBounded',async(key:string,limit:number)=>{
   f.reads.push(key);
   if(key===root+'READY.json'){assert.equal(limit,32*1024);return f.ready;}
   assert.equal(key,root+'public-directory.json');
   if(f.switchAtDirectory)f.etag='nodechanged';
   return f.directory;
 });
 for(const method of ['writeJson','putBinary','deleteBinary'])t.mock.method(ObjectJsonStorage.prototype,method,()=>{throw Error('forbidden');});
 return {f,good,doc};
}
test('default off and exact UAE signed pointer expose only its own directory',async t=>{
 const {f,doc}=fixture(t);delete process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME;
 assert.equal(await openConfiguredUaeRegcloudFiles(),null);assert.deepEqual(f.reads,[]);
 process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME='1';
 const lease=await openConfiguredUaeRegcloudFiles();
 assert.equal(lease?.generationId,gen);
 assert.deepEqual(await lease?.readPublicDirectory(),doc);
 assert.ok(f.reads.every(k=>k===UAE_PUBLIC_CONTROL||k.startsWith(root)));
});
test('foreign/malformed control, raw source seal and missing retained evidence never open',async t=>{
 const {f,good}=fixture(t);f.controlMarket='china';
 await assert.rejects(openConfiguredUaeRegcloudFiles,/control_scope/);
 f.controlMarket='uae';f.ready=binary({...good,kind:'source-only-ready'});
 await assert.rejects(openConfiguredUaeRegcloudFiles,/ready_scope/);
 f.ready=binary({...good,retainedDetailReceiptSha256:null});
 await assert.rejects(openConfiguredUaeRegcloudFiles,/ready_scope/);
 f.ready=binary({...good,admitted:{seller:0,onRequest:0,retainedDelivered:0}});
 await assert.rejects(openConfiguredUaeRegcloudFiles,/ready_scope/);
});
test('pointer ETag movement or altered directory cannot yield stale or untrusted bytes',async t=>{
 const {f}=fixture(t);
 const handle=await openConfiguredUaeRegcloudFiles();
 f.switchAtDirectory=true;
 await assert.rejects(handle!.readPublicDirectory(),/cut_changed/);
 f.switchAtDirectory=false;
 const again=await openConfiguredUaeRegcloudFiles();
 f.directory=binary({market:'china',generationId:gen});
 await assert.rejects(again!.readPublicDirectory(),/immutable_digest/);
});

test('even a digest-matching directory for another generation cannot be accepted',async t=>{
 const {f,good,doc}=fixture(t);
 f.directory=binary({...doc,generationId:'gen_1795233600001_foreign'});
 f.ready=binary({...good,publicDirectorySha256:f.directory.checksum});
 const handle=await openConfiguredUaeRegcloudFiles();
 await assert.rejects(handle!.readPublicDirectory(),/directory_scope/);
});

test('native UAE projection list/count/filter/facets agree across blocks without redoing seller prices',async t=>{
 const {f,good,doc}=fixture(t);
 const rows=Array.from({length:53},(_,i)=>{
  const seller=i%3!==0,sourcePrice=seller?50000+i:null;
  return {id:'uae-verified-'+i,market:'uae',sourceGroup:'dubicars_uae_exact',make:'Kia',model:'Sportage',
   title:'Kia Sportage',fuel:'petrol',powertrainKind:'combustion',bodyType:'suv',year:i%2?2023:2022,
   cardProjectionVersion:3,calculationStatus:'needs_data',catalogPricingMode:seller?'seller':undefined,
   sourcePrice,sourceCurrency:seller?'AED':undefined,sellerPriceRub:seller?sourcePrice!*22:null,totalRub:null,
   cardImageUrl:i%2?nativePhoto:undefined,
   updatedAt:new Date(Date.UTC(2026,9,4,0,i)).toISOString(),
   ...(seller?{calculationSnapshot:{currencyRate:{currency:'AED',sourcePrice,effectiveRate:22,rateSource:'cbr'}}}:{}),
  };
 });
 const admitted={seller:35,onRequest:18,retainedDelivered:0};
 const details=new Map<string,ReturnType<typeof binary>>();
 const buckets=new Map<string,any[]>();
 for(const r of rows){
   const k=sha(Buffer.from(r.id)).slice(0,2),b=buckets.get(k)||[];
   b.push({...r,sourceId:'dubicars_uae_exact',status:'active',images:r.cardImageUrl?
    [{id:'',objectKey:'',size:0,checksum:'',mimeType:'image/jpeg',url:r.cardImageUrl}]:[]});buckets.set(k,b);
 }
 for(const [shard,items] of buckets)details.set(shard,binary({version:1,market:'uae',generationId:gen,shard,items}));
 const detailShards=Object.fromEntries([...details].map(([label,o])=>[label,{rows:buckets.get(label)!.length,sha256:o.checksum}]));
 const blocks=[rows.slice(0,16),rows.slice(16,35),rows.slice(35)].map((items,ordinal)=>
  binary({version:1,market:'uae',generationId:gen,ordinal,items}));
 f.directory=binary({...doc,admitted,detailShards,blocks:blocks.map((o,i)=>({rows:[16,19,18][i],sha256:o.checksum}))});
 f.ready=binary({...good,admitted,publicDirectorySha256:f.directory.checksum});
 const original=ObjectJsonStorage.prototype.getBinaryBounded;
 t.mock.method(ObjectJsonStorage.prototype,'getBinaryBounded',async function(this:ObjectJsonStorage,path:string,limit:number){
  const detail=path.match(/\/details\/([0-9a-f]{2})\.json$/);
  if(detail){assert.equal(path,`${root}details/${detail[1]}.json`);f.reads.push(path);return details.get(detail[1]);}
  const m=path.match(/\/projection\/(\d+)\.json$/);
  if(m){assert.equal(path,`${root}projection/${m[1]}.json`);assert.equal(limit,4*1024*1024);return blocks[Number(m[1])];}
  return original.call(this,path,limit);
 });
 const {readPreparedUaeSearch,readPreparedUaeDetail,preparedUaeDetailGuard,PreparedUaeCutChanged}=await import('../apps/web/lib/catalog/storage');
 const {protectedPhotoUrl}=await import('../apps/web/lib/catalog/photo-proxy-policy');
 const a=await readPreparedUaeSearch({market:'uae',page:1},{includeFacets:true}),b=await readPreparedUaeSearch({market:'uae',page:2});
 assert.equal(a?.total,53);assert.equal(a?.items.length,24);assert.equal(b?.items.length,24);
 assert.equal(new Set([...a!.items,...b!.items].map(r=>r.id)).size,48);
 assert.equal(a?.facets?.models[0]?.model,'Sportage');
 const counted=await readPreparedUaeSearch({market:'uae',make:'Kia',model:'Sportage',yearFrom:2023},{countOnly:true});
 assert.equal(counted?.total,26);assert.deepEqual(counted?.items,[]);
 const budget=await readPreparedUaeSearch({market:'uae',budgetTo:2000000},{countOnly:true});
 assert.equal(budget?.total,0,'seller equivalents are never landed totals');
 const price=await readPreparedUaeSearch({market:'uae',sort:'totalRub',pageSize:48});
 assert.equal(price?.items[0]?.sellerPriceRub,50001*22);
 assert.equal(price?.items.at(-1)?.sellerPriceRub??null,null);
 await assert.rejects(readPreparedUaeSearch({market:'uae'},{expectedGeneration:'older'}),PreparedUaeCutChanged);
 const check=price!.items[0];
 const detail=await readPreparedUaeDetail(check.id,gen);
 assert.equal(detail?.sellerPriceRub,check.sellerPriceRub);
 assert.equal(check.images[0].url,protectedPhotoUrl(nativePhoto,'uae'));
 assert.equal(detail?.images[0].url,nativePhoto);
 assert.equal(detail?.totalRub??null,null);
 assert.ok(preparedUaeDetailGuard(detail!));
 assert.equal(f.reads.filter(p=>p.includes('/details/')).length,1);
 const {offerCardPath}=await import('../apps/web/lib/catalog/offer-url');
 assert.match(offerCardPath(check),new RegExp('market=uae&preparedCut='+gen));
 // Raw node tests don't inherit Next's React server entry selection.
 const reqModule=createRequire(import.meta.url),react=reqModule('react');
 const server=reqModule('next/dist/compiled/react/cjs/react.react-server.production.js');
 if(!react.cache)t.mock.method(Object.assign(react,{cache:server.cache}),'cache',server.cache);
 const {resolveOfferDisplay}=await import('../apps/web/lib/catalog/offer-display-data');
 const projected=await resolveOfferDisplay(detail!);
 assert.equal(projected.sellerPricing,true);assert.equal(projected.visibleRub,0);
 assert.equal(projected.offer.sellerPriceRub,check.sellerPriceRub);
 assert.equal(projected.raw.images[0].url,protectedPhotoUrl(nativePhoto,'uae'));
 const {withCatalogEditorialSnapshot}=await import('../apps/web/lib/catalog/editorial');
 const overridden=await withCatalogEditorialSnapshot({revision:'foreign-fixture',entries:{
  [detail!.id]:{id:detail!.id,market:'uae',sourceId:detail!.sourceId,sourceOfferId:detail!.sourceOfferId,
    photos:[rejectedPhoto]} as any,
 }},()=>resolveOfferDisplay(detail!));
 assert.equal(overridden.raw.images[0].url,protectedPhotoUrl(nativePhoto,'uae'));
 const {readOfferDetailForPage}=await import('../apps/web/lib/catalog/offer-page-data');
 assert.equal((await readOfferDetailForPage(check.id,true,{market:'uae',preparedCut:gen})).offer?.id,check.id);
 assert.equal((await readOfferDetailForPage(check.id,false,{market:'uae',preparedCut:gen})).unavailable,true);
 const {generateOfferMetadata}=await import('../apps/web/lib/catalog/offer-metadata');
 const metadata=await generateOfferMetadata({params:Promise.resolve({id:check.id}),
  searchParams:Promise.resolve({market:'uae',preparedCut:gen})});
 const og=JSON.stringify(metadata.openGraph);
 assert.ok(og.includes('dubicars.com')||og.includes(encodeURIComponent('https://www.dubicars.com')));
 assert.ok(!og.includes(rejectedPhoto));
 assert.ok(!JSON.stringify(metadata).includes(String(check.sellerPriceRub)));
 const {searchOffers,countCatalogOffers,readCatalogModelNames,readCatalogFacets,readPublicCatalogMarketCounts,
  readCurrentPublicCatalogProjection,readCatalogDirectoryCountRows,resetCatalogReadCachesForTests}=await import('../apps/web/lib/catalog/storage');
 const m=await readCatalogModelNames('Kia','uae');assert.deepEqual(m,[{make:'Kia',model:'Sportage'}]);
 assert.deepEqual((await readCatalogFacets({market:'uae',yearFrom:2023})).models,m);
 const {readCatalogMarketPage}=await import('../apps/web/lib/catalog/market-page');
 assert.deepEqual((await readCatalogMarketPage({market:'uae',page:2})).items,b!.items);
 const oldUae={...rows[1],id:'legacy-uae',make:'OldOnly',model:'Stale'};
 const georgia={...rows[1],id:'neighbor-georgia',market:'georgia',sourceGroup:'myauto_georgia_list',
  make:'Toyota',model:'Camry',cardImageUrl:'https://example.test/ga.jpg'};
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(path:string,fallback:any)=>{
  const value=path==='catalog/manifest.json'?{generationId:'old',markets:{uae:{count:1},georgia:{count:1}}}
   :path.endsWith('/projection/all.json')?{generationId:'old',items:[oldUae,georgia]}
   :path.endsWith('/projection/georgia.json')?{generationId:'old',items:[georgia]}
   :path.endsWith('/projection/uae.json')?{generationId:'old',items:[oldUae]}
   :fallback;
  return {found:value!==fallback,value};
 });
 resetCatalogReadCachesForTests();
 const marketTotals=await readPublicCatalogMarketCounts();
 assert.equal(marketTotals.markets.uae,53);assert.equal(marketTotals.markets.georgia,1);
 const mixed=await searchOffers({market:'uae|georgia',yearFrom:2023,page:2});
 assert.equal(mixed.total,27);assert.ok(mixed.items.every(x=>x.id!=='legacy-uae'));
 assert.equal((await countCatalogOffers({market:'uae|georgia',yearFrom:2023})).total,27);
 const mixedFacets=await readCatalogFacets({market:'any',yearFrom:2023});
 assert.deepEqual(mixedFacets.makes,['Kia','Toyota']);
 assert.deepEqual((await readCurrentPublicCatalogProjection()).rows.map(r=>r.id),['neighbor-georgia']);
 const {readAiCatalogProjection,readAiCatalogManifest,readAiSitemapProjection}=await import('../apps/web/lib/ai-discovery');
 assert.deepEqual((await readAiCatalogProjection()).items.map(r=>r.id),['neighbor-georgia']);
 assert.ok(!('uae' in (await readAiCatalogManifest()).markets));
 assert.deepEqual((await readAiSitemapProjection())?.items.map(r=>r.id),['neighbor-georgia']);
 const newDirectory=await readCatalogDirectoryCountRows();
 assert.ok(newDirectory.some(r=>r.model==='Sportage')&&newDirectory.some(r=>r.model==='Camry')&&!newDirectory.some(r=>r.model==='Stale'));
 const beforeFences=f.reads.length;
 const neighbor=await searchOffers({market:'georgia'});
 assert.deepEqual(neighbor.items.map(r=>r.id),['neighbor-georgia']);assert.equal(f.reads.length,beforeFences);
 delete process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME;
 resetCatalogReadCachesForTests();
 const untouched=await searchOffers({market:'georgia'});
 assert.deepEqual(untouched,neighbor);
 assert.equal((await searchOffers({market:'uae'})).items[0]?.id,'legacy-uae');
 assert.ok((await readAiCatalogProjection()).items.some(r=>r.id==='legacy-uae'));
 assert.equal(f.reads.length,beforeFences,'default OFF does no own storage reads');
 process.env.AVTOCENA_UAE_REGCLOUD_RUNTIME='1';
 const {GET}=await import('../apps/web/app/(public)/api/catalog/search/route');
 const req=(q:string)=>GET(new Request('https://example.test/api/catalog/search?market=uae&'+q));
 const response=await req('marketPage=1&includeFacets=1');
 assert.equal(response.status,200);
 assert.equal((await response.json()).items.length,24);
 const filtered=await req('countOnly=1&yearFrom=2023');
 assert.equal((await filtered.json()).total,26);
 assert.equal((await req('preparedCut=older')).status,409);
 assert.equal((await req('page=0')).status,400);
 assert.equal((await req('source=ajes')).status,422);
 const combined=await GET(new Request('https://example.test/api/catalog/search?market=uae%7Cgeorgia&yearFrom=2023&includeFacets=1&page=2'));
 const combinedBody=await combined.json();
 assert.equal(combined.status,200);assert.deepEqual(combinedBody.facets.makes,['Kia','Toyota']);
 const all=await GET(new Request('https://example.test/api/catalog/search?yearFrom=2023&includeFacets=1&page=2'));
 assert.equal(all.status,200);assert.deepEqual((await all.json()).facets.makes,['Kia','Toyota']);
 // Seal a semantically invalid cover after all positive surfaces were checked.
 const badBlocks=[binary({version:1,market:'uae',generationId:gen,ordinal:0,items:[{...rows[0],cardImageUrl:rejectedPhoto},...rows.slice(1,16)]}),...blocks.slice(1)];
 blocks[0]=badBlocks[0];
 f.directory=binary({...doc,admitted,detailShards,blocks:blocks.map((o,i)=>({rows:[16,19,18][i],sha256:o.checksum}))});
 f.ready=binary({...good,admitted,publicDirectorySha256:f.directory.checksum});
 await assert.rejects(readPreparedUaeSearch({market:'uae'}),/projection_gallery/);
 const label=sha(Buffer.from(check.id)).slice(0,2),patched=buckets.get(label)!.map(item=>item.id!==check.id?item:
  {...item,images:[{...item.images[0],url:rejectedPhoto}]});
 const changedDetail=binary({version:1,market:'uae',generationId:gen,shard:label,items:patched});
 details.set(label,changedDetail);
 f.directory=binary({...doc,admitted,detailShards:{...detailShards,[label]:{...detailShards[label],sha256:changedDetail.checksum}},
  blocks:blocks.map((o,i)=>({rows:[16,19,18][i],sha256:o.checksum}))});
 f.ready=binary({...good,admitted,publicDirectorySha256:f.directory.checksum});
 await assert.rejects(readPreparedUaeDetail(check.id,gen),/detail_gallery/);
});


test('a previous independently attested UAE cut is used as a whole on transient active failure, never across a different explicit pin',async t=>{
 const {f,good,doc}=fixture(t);
 const previousGen='gen_1795233600000_prior',previousRun='uae-prior-fixture';
 const previousDirectory=binary({...doc,generationId:previousGen});
 const previousReady=binary({...good,generationId:previousGen,runId:previousRun,publicDirectorySha256:previousDirectory.checksum});
 f.previous={generationId:previousGen,runId:previousRun,readySha256:previousReady.checksum};
 t.mock.method(ObjectJsonStorage.prototype,'getBinaryBounded',async(path:string)=>{
  if(path===root+'READY.json')throw Error('object_storage_binary_read_503');
  const previousRoot=`catalog/private-market-stage-v1/uae/${previousRun}/`;
  if(path===previousRoot+'READY.json')return previousReady;
  assert.equal(path,previousRoot+'public-directory.json');
  return previousDirectory;
 });
 const {readPreparedUaeSearch}=await import('../apps/web/lib/catalog/storage');
 const fallback=await readPreparedUaeSearch({market:'uae'},{countOnly:true});
 assert.equal(fallback?.generationId,previousGen);assert.equal(fallback?.total,3);
 assert.equal((await readPreparedUaeSearch({market:'uae'},{countOnly:true,expectedGeneration:previousGen}))?.generationId,previousGen);
 await assert.rejects(readPreparedUaeSearch({market:'uae'},{countOnly:true,expectedGeneration:gen}),/object_storage_binary_read_503/);
});

test('prepared UAE accepts the exact native paid gallery and bound local paths, no proxy or arbitrary third party',async()=>{
 const {normalizeAutoApiDubicars}=await import('../apps/web/lib/catalog/auto-api-dubicars');
 const {isPreparedUaeGallery,isPreparedUaeGalleryPath}=await import('../apps/web/lib/catalog/dubicars-gallery-policy');
 const rejected=[rejectedPhoto,'https://cdn.dubicars.com/images/test.jpg','https://www.dubicars.com/car.jpg',
 'https://www.dubicars.com/images/lure.svg','https://www.dubicars.com/images/car.jpg?token=fixture',
 'https://someone@www.dubicars.com/images/car.jpg','/api/catalog/photo/signature?url=https://unknown.example/car.jpg',
 'https://private.example/catalog/images/uae/car.jpg','//unknown.example/car.jpg'];
 const mapped=normalizeAutoApiDubicars({inner_id:'329',data:{inner_id:'329',mark:'Kia',model:'Sportage',year:2023,
  url:'https://www.dubicars.com/kia-sportage-329.html',images:[nativePhoto,...rejected,nativePhoto]}},'2026-11-19T00:00:00.000Z');
 assert.deepEqual(mapped?.images.map(image=>image.url),[nativePhoto]);
 assert.ok(isPreparedUaeGallery(mapped?.images));
 assert.ok(rejected.every(photo=>!isPreparedUaeGalleryPath(photo)));
 assert.ok(isPreparedUaeGallery([{url:'/api/site-media/'+'a'.repeat(64)}]));
 const hash='b'.repeat(64),id=hash.slice(0,32);
 assert.ok(isPreparedUaeGallery([{url:`/api/catalog/images/${id}`,id,checksum:hash,objectKey:`catalog/images/uae/${hash}.webp`}]));
 assert.ok(!isPreparedUaeGallery([{url:`/api/catalog/images/${id}`,id,checksum:hash,objectKey:`catalog/images/china/${hash}.webp`}]));
 assert.ok(!isPreparedUaeGallery(Array.from({length:31},()=>({url:nativePhoto}))));
});
