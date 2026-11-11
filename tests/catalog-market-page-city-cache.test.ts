import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
const require=createRequire(import.meta.url);

async function fixture(){
 const state={revision:'r1',calls:[] as any[],pricingCalls:0,wait:null as Promise<void>|null};
 const rows=Array.from({length:192},(_,i)=>({id:String(i),market:'china',make:'Kia',model:`Model ${i}`,year:2024,totalRub:2_000_000+i,
  calculationSnapshot:{deliveryPricingBasis:{subtotalRub:2_000_000+i,deliveryRub:120_000,percents:[]}}}));
 (globalThis as any).__cityCacheFixture={
  editorial:async()=>({revision:state.revision}),
  search:async(query:any,limit:number)=>{
   state.calls.push({query:{...query},limit});if(state.wait)await state.wait;
   // Other search branches may use the selected city in their eligibility or ordering.
   const filtered=query.city?rows.map(row=>priceCardForCity(row,query.city).offer):rows;
   return {generationId:'g',total:250,items:filtered,page:query.page,pageSize:query.pageSize};
  },
  price:async(rows:any[])=>{state.pricingCalls++;return rows;},
 };
 const mocks:Record<string,string>={
  storage:'export const searchOffers=(...args)=>globalThis.__cityCacheFixture.search(...args);',
  editorial:'export const readCatalogEditorial=()=>globalThis.__cityCacheFixture.editorial();',
  'live-business-pricing':'export const applyActiveBusinessPricingBatch=rows=>globalThis.__cityCacheFixture.price(rows);',
  'offer-quality':'export const isRenderablePublicCatalogOffer=()=>true;',
 };
 const output=await build({entryPoints:['apps/web/lib/catalog/market-page.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'fixture'};});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));
 }}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
 return {state,read:m.exports.readCatalogMarketPage as (query:any)=>Promise<any>,close:()=>{delete (globalThis as any).__cityCacheFixture;}};
}

test('default category cities share pending and completed selection while cards keep their own delivery replay',async()=>{
 const f=await fixture();let release!:()=>void;f.state.wait=new Promise(resolve=>{release=resolve;});
 const query={market:'china',sort:'updatedAt',page:1};
 const pending=Promise.all([f.read(query),f.read({...query,city:'Новокузнецк'}),f.read({...query,city:'Новосибирск'})]);
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.state.calls.length,1,'same neutral default page must join one in-flight read');
  release();const [normal,novokuznetsk,novosibirsk]=await pending;
  assert.strictEqual(novokuznetsk,normal);assert.strictEqual(novosibirsk,normal);
  assert.equal(f.state.pricingCalls,1);assert.equal(normal.items.length,24);
  assert.equal(f.state.calls[0].limit,192);assert.equal(f.state.calls[0].query.city,undefined);
  const original=structuredClone(normal.items[0]);
  assert.equal(priceCardForCity(original,'Новокузнецк').offer.totalRub,original.totalRub);
  assert.equal(priceCardForCity(original,'Новосибирск').offer.totalRub,original.totalRub+10_000);
  assert.deepEqual(normal.items[0],original,'city replay must not mutate the shared neutral result');
  assert.strictEqual(await f.read({...query,city:'Москва'}),normal);
  assert.equal(f.state.calls.length,1,'a fresh neutral page must be reused across cities');
 }finally{release();await pending;f.close();}
});

test('budget, ordinary filters and every custom sort retain separate city search results',async()=>{
 const f=await fixture();
 try{
  for(const selection of [{budgetTo:4_000_000},{make:'Kia'},{sort:'totalRub'},{sort:'year'}]){
   const before=f.state.calls.length;
   const a=await f.read({market:'china',page:1,city:'Новокузнецк',...selection});
   const b=await f.read({market:'china',page:1,city:'Новосибирск',...selection});
   assert.equal(f.state.calls.length,before+2);
   assert.equal(f.state.calls[before].query.city,'Новокузнецк');assert.equal(f.state.calls[before+1].query.city,'Новосибирск');
   const prices=new Map(a.items.map((row:any)=>[row.id,row.totalRub]));
   for(const row of b.items)assert.equal(row.totalRub,Number(prices.get(row.id))+10_000);
  }
 }finally{f.close();}
});

test('shared default city entries keep the original expiry and editorial revision invalidation',async(t)=>{
 const f=await fixture();let now=1000;t.mock.method(Date,'now',()=>now);
 try{
  const query={market:'china',sort:'updatedAt',page:1};
  await f.read({...query,city:'Новокузнецк'});
  now+=59_999;await f.read({...query,city:'Москва'});assert.equal(f.state.calls.length,1);
  now+=1;await f.read({...query,city:'Новосибирск'});assert.equal(f.state.calls.length,2,'city changes must not prolong the60-second lifetime');
  f.state.revision='r2';await f.read({...query,city:'Москва'});assert.equal(f.state.calls.length,3,'an editorial revision must invalidate all shared cities');
  await f.read({...query,city:'Новокузнецк'});assert.equal(f.state.calls.length,3);
  await f.read({...query,page:2,city:'Новокузнецк'});assert.equal(f.state.calls.length,4,'page identity stays separate');
  await f.read({...query,market:'korea',city:'Новокузнецк'});assert.equal(f.state.calls.length,5,'market identity stays separate');
 }finally{t.mock.restoreAll();f.close();}
});
