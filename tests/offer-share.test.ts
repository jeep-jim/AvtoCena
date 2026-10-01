import test from 'node:test';
import assert from 'node:assert/strict';
import {offerShareTitle,offerShareUrl,encodeShareDraft,decodeShareDraft} from '../apps/web/lib/catalog/offer-share';
import {offerPath,offerRouteId} from '../apps/web/lib/catalog/offer-url';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('share title identifies the car, year, displacement and actual ruble price',()=>{
 assert.equal(offerShareTitle({title:'Chevrolet Trax Turbo 1.2',year:2024,engineCc:1199,totalRub:1668942}),'Chevrolet Trax Turbo 1.2 — 2024, 1,2 л — 1 668 942 ₽');
 assert.equal(offerShareTitle({title:'Toyota bZ3X',year:2026,fuel:'electric',totalRub:2500000}),'Toyota bZ3X — 2026, электро — 2 500 000 ₽');
 assert.equal(offerShareTitle({title:'Toyota Aqua 2021',year:2021,engineCc:1496}),'Toyota Aqua — 2021, 1,5 л — Цена уточняется');
 assert.doesNotMatch(offerShareTitle({title:'Автомобиль',totalRub:NaN}),/NaN|0 ₽|0,0 л/);
});
test('Korean and Chinese source names do not become encoded slug noise; old IDs still resolve',()=>{
 const offer={id:'f649514e83647d1d84c917e0',make:'Chevrolet',model:'Trax',trim:'터보 1.2 레드라인',market:'korea',year:2024};
 const path=offerPath(offer);assert.match(path,/^\/cars\/offer\/[a-z0-9-]+$/);assert.match(path,/chevrolet-trax/);assert.match(path,/2024--f649514e83647d1d84c917e0$/);assert.equal(offerRouteId(path.split('/').at(-1)!),offer.id);
 assert.equal(offerRouteId('chevrolet-trax-%E1%84%90-2024--'+offer.id),offer.id);
});
test('share URL keeps an explicit calculation and selected modification but strips tracking',()=>{
 const url=offerShareUrl('https://avtocena.com/cars/offer/old--id?calculation=old&direct=novokuznetsk&powerHp=150&modificationId=m1&utm_source=x#photo','/cars/offer/car-2024--id','new');
 assert.equal(url,'https://avtocena.com/cars/offer/car-2024--id?calculation=new&direct=novokuznetsk&powerHp=150&modificationId=m1');
 assert.equal(offerShareUrl('https://avtocena.com/cars/offer/id','https://evil.example/car'),'https://avtocena.com/cars/offer/id');
});
test('metadata uses displayed calculation, archived client version and proxy images',async()=>{
 const state:any={queryCalls:[],offer:{id:'car',make:'Chevrolet',model:'Trax',trim:'Turbo 1.2',market:'korea',year:2024,engineCc:1199,fuel:'petrol',totalRub:1632444},visible:1668942,client:null};
 (globalThis as any).__shareTest=state;
 const mocks:Record<string,string>={
  'shared-offer-scenario':`export const sharedOfferScenario=async()=>globalThis.__shareTest.automatic||null;`,
  'offer-parameter-draft':`export const offerParameterDraft=()=>({});`,
  'offer-page-data':`export const getOfferDetailRecord=async()=>globalThis.__shareTest.offer;`,
  'offer-display-data':`export const resolveOfferDisplay=async(offer,power,modification)=>{globalThis.__shareTest.queryCalls.push([power,modification]);return {offer,raw:offer,pricedOffer:offer,visibleRub:globalThis.__shareTest.visible,sellerPricing:!!globalThis.__shareTest.seller,selectionRequired:false}};`,
  'saved-offer-calculation':`export const getSavedOfferCalculation=async(offer,version)=>version==='11111111-1111-1111-1111-111111111111'?globalThis.__shareTest.client:null;`,
  'yandex-direct-scenario':`export const directOfferScenario=async()=>null;`,
  'image-quality':`export const rankedCatalogImageUrls=()=>['https://source.example/car.jpg'];`,
  'photo-proxy-policy':`export const protectedPhotoUrl=()=>'/api/catalog/photo/test?url=car';`,
  'ai-discovery':`export const absoluteAvtocenaUrl=url=>new URL(url,'https://avtocena.com').toString();`,
  'public-showcase':`export const getSpecialOffer=async()=>null;`,
  'showcase-model':`export const parseSpecialId=()=>null;export const specialTitle=()=>'';export const calculateSpecial=()=>({});`,
 };
 const built=await build({entryPoints:['apps/web/lib/catalog/offer-metadata.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'share-data',setup(b){b.onResolve({filter:/\//},a=>{const key=a.path.split('/').at(-1)!;return mocks[key]?{path:key,namespace:'share-test'}:null});b.onLoad({filter:/.*/,namespace:'share-test'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
 try{
  let result=await m.exports.generateOfferMetadata({params:Promise.resolve({id:'car'})});assert.match(result.title,/1 668 942 ₽/);assert.equal(result.openGraph.title,result.title);assert.match(result.openGraph.images[0].url,/https:\/\/avtocena.com\/api\/catalog\/photo\//);
  assert.doesNotMatch(result.description,/₽|Chevrolet/);
  const shared=await m.exports.generateOfferMetadata({params:Promise.resolve({id:'car'}),searchParams:Promise.resolve({share:'3'})});
  assert.equal(shared.openGraph.title,'Chevrolet Trax Turbo 1.2 — 2024, 1,2 л');assert.doesNotMatch(shared.openGraph.description,/₽/);assert.equal(shared.openGraph.images.length,1);
  assert.equal(shared.twitter.card,'summary_large_image');
  state.seller=true;state.offer.sellerPriceRub=579040;state.automatic={draft:{},calculation:{totalRub:1160164}};
  result=await m.exports.generateOfferMetadata({params:Promise.resolve({id:'car'})});assert.match(result.openGraph.title,/1 160 164 ₽/);assert.doesNotMatch(result.openGraph.title,/579 040/);assert.equal(result.twitter.title,result.openGraph.title);
  state.automatic=null;result=await m.exports.generateOfferMetadata({params:Promise.resolve({id:'car'})});assert.match(result.title,/Цена уточняется/);
  state.seller=false;
  state.client={draft:{year:'2023',engineCc:'1500',deliveryCity:'Новокузнецк'},calculation:{totalRub:1800000}};
  result=await m.exports.generateOfferMetadata({params:Promise.resolve({id:'car'}),searchParams:Promise.resolve({calculation:'11111111-1111-1111-1111-111111111111',powerHp:'150',modificationId:'selected'})});
  assert.match(result.title,/2023, 1,5 л — 1 800 000 ₽/);assert.match(result.description,/Новокузнецк/);assert.match(result.openGraph.url,/calculation=11111111/);assert.deepEqual(state.queryCalls.at(-1),[150,'selected']);
 }finally{delete (globalThis as any).__shareTest;}
});

test('share draft preserves Cyrillic city and vehicle inputs without accepting a client price',()=>{
 const encoded=encodeShareDraft({year:'2015',engineCc:'1496',fuel:'petrol',powerHp:'150',deliveryCity:'Горно-Алтайск',totalRub:'1'});
 assert.deepEqual(decodeShareDraft(encoded),{year:'2015',fuel:'petrol',engineCc:'1496',powerHp:'150',deliveryCity:'Горно-Алтайск'});
 assert.equal(decodeShareDraft('!bad'),null);assert.equal(decodeShareDraft('a'.repeat(2401)),null);
});
