import assert from 'node:assert/strict';
import test from 'node:test';
import {readCatalogRouteSourceScope} from '../apps/web/lib/catalog/catalog-route-source-scope';

const base={directMarket:'',directSource:'',renderedMarkets:[],preparedChina:false,omitLegacyChina:false};
const neither={liveChina:false,liveKorea:false,direct:false};

test('local selected result no longer enters unrelated blocked provider checks',async()=>{
 const blocking=new Promise<never>(()=>{}),calls:string[]=[];
 const decide=async (market:string)=>{calls.push(market);return blocking;};
 for(const m of ['georgia','uae','europe'] as const){
  const newResult=await Promise.race([
   readCatalogRouteSourceScope({...base,renderedMarkets:[m],directMarket:m},decide),
   new Promise(resolve=>setTimeout(()=>resolve('still blocked'),15)),
  ]);
  assert.deepEqual(newResult,neither,m);
 }
 assert.deepEqual(calls,[]);
});
test('dedicated China/Korea make one scoped lookup; no neighbor dependency',async()=>{
 for(const m of ['china','korea'] as const){
  const used:[string,string|undefined][]=[];
  const selected=await readCatalogRouteSourceScope({...base,renderedMarkets:[m],directMarket:m,directSource:'ajes'},
   async(m,s)=>{used.push([m,s]);return true;});
  assert.deepEqual(used,[[m,'ajes']]);
  assert.deepEqual(selected,{liveChina:m==='china',liveKorea:m==='korea',direct:true});
 }
});
test('prepared China does not reread AJES; Japan still uses the same live decision exactly once',async()=>{
 assert.deepEqual(await readCatalogRouteSourceScope({...base,preparedChina:true,renderedMarkets:['china'],directMarket:'china'},
  async()=>{assert.fail('prepared China at shared routing');}),neither);
 const used:string[]=[];
 assert.deepEqual(await readCatalogRouteSourceScope({...base,renderedMarkets:['japan'],directMarket:'japan',directSource:'auction'},
  async(m,s)=>{used.push(m+':'+s);return true;}),{...neither,direct:true});
 assert.deepEqual(used,['japan:auction']);
});
test('mixed/aggregate still preserves configured rails and omission; no substitute dealer or Japan provider',async()=>{
 const used:[string,string|undefined][]=[];
 const decide=async(m,s)=>{used.push([m,s]);return true;};
 const ordinary={...base,renderedMarkets:['china','korea','japan','georgia']};
 assert.deepEqual(await readCatalogRouteSourceScope(ordinary,decide),{liveChina:true,liveKorea:true,direct:false});
 assert.deepEqual(used,[['china',undefined],['korea',undefined]]);
 used.length=0;
 assert.deepEqual(await readCatalogRouteSourceScope({...ordinary,omitLegacyChina:true},decide),{liveChina:false,liveKorea:true,direct:false});
 assert.deepEqual(used,[['korea',undefined]]);
 used.length=0;
 assert.deepEqual(await readCatalogRouteSourceScope({...base,renderedMarkets:['georgia']},decide),neither);
 assert.deepEqual(used,[]);
});
