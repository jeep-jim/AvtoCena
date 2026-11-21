const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const react=require('react');
if(!react.cache)react.cache=f=>f;
if(!require.extensions['.css'])require.extensions['.css']=()=>{};
const sha='a'.repeat(64);
const generationId='gen_1795239842026_mixhaval';
let activeSnapshot, reads=0, assertions=0, priorLoad=Module._load;
const isNativeOpen=id=>id==='./independent-china-prepared-fixture';
Module._load=function(id,parent,...rest){
 if(isNativeOpen(id)&&parent?.filename.endsWith('/prepared-china-http-fixture.ts')){
  return {openIndependentChinaPrepared:async()=>({snapshot:activeSnapshot,withdrawn:new Map()})};
 }
 return priorLoad.call(this,id,parent,...rest);
};
const native=require('../apps/web/lib/catalog/prepared-china-http-fixture.ts');
Module._load=priorLoad;
const {includeMixedChinaRailCount,readMixedPreparedChinaRail}=require('../apps/web/lib/catalog/mixed-prepared-china-rail.ts');
const {readMarketSection}=require('../apps/web/lib/catalog/market-section-result.ts');
const {summarizeChinaSelectorPart}=require('../apps/web/lib/catalog/prepared-china-streaming-selector.ts');
const {DELIVERY_TARIFF_VERSION}=require('../apps/web/lib/catalog/city-delivery.ts');
const {ObjectJsonStorage,getJsonStorage}=require('../apps/web/lib/data.ts');
const {searchOffers,resetCatalogReadCachesForTests}=require('../apps/web/lib/catalog/storage.ts');
const now=new Date().toISOString();
const row=(market,id,make,model,year,price)=>({
 id,market,make,model,year,cardProjectionVersion:3,cardImageUrl:'https://example.invalid/fixture.png',
 color:'white',status:'active',offerType:'fixed',priceMode:'fixed',firstSeenAt:now,updatedAt:now,inventorySourceDate:now,
 totalRub:market==='china'?price:null, publicVisibleRub:market==='china'?price:undefined,
 sourceGroup:market==='china'?'autohome_used_china_open':'dubicars_uae_open',sourceId:market==='china'?'autohome_used_china_open':'dubicars_uae_open',
 calculationStatus:market==='china'?'ready':'needs_data',catalogPricingMode:market==='china'?'landed':'seller',
 sourcePrice:10000,sourceCurrency:market==='china'?'CNY':'AED',sellerPriceRub:market==='uae'?price:undefined,
 ...(market==='china'?{engineCc:1500,powerHp:150,powertrainKind:'combustion',fuel:'petrol',
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:price,deliveryRub:0,percents:[]}}}:
 {calculationSnapshot:{currencyRate:{currency:'AED',sourcePrice:10000,effectiveRate:price/10000,rateSource:'cbr',
  rateDate:now.slice(0,10),nominal:1,cbrRate:price/10000,sourcePriceRub:price}}}),
});
const chinaRows=[
 row('china','china-one','Haval','Jolion',2023,2_100_000),row('china','china-two','Haval','Jolion',2024,2_050_000),
 row('china','china-old','Haval','Jolion',2021,2_150_000),row('china','china-wrong-brand','Geely','Coolray',2024,2_000_000),
 row('china','china-over','Haval','Jolion',2024,3_200_000),
];
const uaeRows=[row('uae','uae-one','Haval','Jolion',2024,900_000),row('uae','uae-wrong-brand','Toyota','Camry',2024,950_000)];
async function fixture(run){
 const changes={JSON_STORAGE_DRIVER:'local',YC_OBJECT_STORAGE_ENDPOINT:'http://127.0.0.1:7419',
  YC_OBJECT_STORAGE_BUCKET:'fixture-haval',YC_OBJECT_STORAGE_PREFIX:'fixture-haval',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture'};
 const prev=Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]));
 Object.assign(process.env,changes);
 const fetch=globalThis.fetch,strict=globalThis.fetch=async()=>{throw Error('network_forbidden');};
 const storage=getJsonStorage();
 const original=storage.readJsonWithMeta;
 storage.readJsonWithMeta=async(key,fallback)=>{
  if(key==='catalog/manifest.json')return {found:true,value:{generationId,updatedAt:now,markets:{uae:{count:2,chunks:['chunk-0001']}}}};
  if(key==='catalog/public/projection/uae.json'||key.startsWith('catalog/public/projection-brand/uae/'))
   return {found:true,value:{generationId,items:uaeRows}};
  return {found:false,value:fallback};
 };
 try{
  const empty=(async()=>({generationId}));
  return await native.withPreparedChinaHttpFixture({storage:new ObjectJsonStorage(),fetchMock:strict,origin:changes.YC_OBJECT_STORAGE_ENDPOINT,
    bucket:'fixture-haval',prefix:'fixture-haval',indexedModelOnly:true,independentChina:{market:'china',observe:empty}},run);
 }finally{
  resetCatalogReadCachesForTests();
  storage.readJsonWithMeta=original;globalThis.fetch=fetch;
  for(const [k,v] of Object.entries(prev))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
const q={make:'Haval',model:'Jolion',yearFrom:2022,budgetTo:2_500_000,city:'Уссурийск',sort:'totalRub'};
const scope={source:'',stock:'',cut:generationId};
const setup=(wait)=>{reads=assertions=0;activeSnapshot={rows:chinaRows.length,directorySha256:sha,generationId,deliveryTariffVersion:DELIVERY_TARIFF_VERSION,
 streamingSelector:true,chunks:['part-1','part-2'],async readChunk(chunk){
  const values=chunk==='part-1'?chinaRows.slice(0,3):chinaRows.slice(3);
  return {partCount:1,selectors:[summarizeChinaSelectorPart(values)],async load(){reads++;await wait;return {projection:{items:values}};}};
 },async assertCurrent(){assertions++;}};};
test('actual native China compatibility and actual UAE catalog reader use their own Haval rows; mixed result stays independently renderable',async()=>{
 await fixture(async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});setup(waiting);
  const mixed=readMixedPreparedChinaRail(native.readPreparedChinaCompatibility,q,6,scope,2_000);
  const uae=await searchOffers({...q,budgetTo:undefined,city:undefined,market:'uae',page:1,pageSize:6});
  assert.equal(uae.total,1);assert.deepEqual(uae.items.map(r=>r.id),['uae-one']);
  const pending=Symbol();assert.equal(await Promise.race([mixed,Promise.resolve(pending)]),pending);
  release();
  const own=await mixed;
  assert.deepEqual(own.items.map(r=>r.id),['china-two','china-one']);
  assert.deepEqual(own.items.map(r=>r.totalRub),[2_050_000,2_100_000]);
  assert.equal(own.total,2);assert.deepEqual(includeMixedChinaRailCount({total:uae.total,countIncomplete:false},own),{total:3,countIncomplete:false});
  assert.ok(own.items.every(r=>r.preparedChinaSelection.generationId===generationId));assert.equal(reads,2);assert.equal(assertions,1);
 });
});
test('native scanning stops after the one in-flight mock read on deadline; UAE result remains exact',async()=>{
 await fixture(async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});setup(waiting);
  const errors=[];
  const own=readMarketSection(()=>readMixedPreparedChinaRail(native.readPreparedChinaCompatibility,q,6,scope,150),
   {total:0,items:[]},error=>errors.push(error));
  const uae=await searchOffers({market:'uae',make:'Haval',page:1,pageSize:6});
  assert.equal(uae.total,1);
  assert.deepEqual(await own,{total:0,items:[],unavailable:true});
  assert.match(String(errors[0]),/deadline/);assert.equal(reads,1);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);assert.equal(assertions,0);
 });
});
