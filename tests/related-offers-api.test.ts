import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

async function fixture(){
  const state:any={calls:[],dealer:{markets:['korea'],id:'dealer_test'},detail:{offer:{id:'ajes-korea-current',market:'korea',sourceId:'ajes_korea_feed',offerType:'fixed'},unavailable:false}};
  (globalThis as any).__relatedApi=state;
  const stubs:Record<string,string>={
    '@/lib/catalog/offer-page-data':`export const readOfferDetailForPage=async id=>{const s=globalThis.__relatedApi;s.calls.push(['detail',id]);return s.detail;};`,
    '@/lib/catalog/offer-display-data':`export const resolveOfferDisplay=async stored=>{const s=globalThis.__relatedApi;s.calls.push(['display',stored]);return {raw:{id:stored.id,market:stored.market,make:'Verified make',model:'Verified model'},offer:stored};};`,
    '@/lib/dealers/resolve-browsing-context':`export const resolveDealerBrowsingContext=async(...args)=>{const s=globalThis.__relatedApi;s.calls.push(['dealer',...args]);return s.dealer;};`,
    '@/lib/dealers/showcase-store':`export const validDealerId=id=>/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!id.includes('__');`,
    '@/lib/catalog/runtime-config':`export const PUBLIC_CATALOG_MARKETS=['china','japan','korea','uae','europe','georgia'];`,
    '@/lib/catalog/related-offers-data':`export const readRelatedOffers=async(current,options)=>{const s=globalThis.__relatedApi;s.calls.push(['related',current,options]);return {marketTotal:null,partial:true,marketRows:[{id:'safe-result'}]};};`,
    '@/lib/catalog/related-offers-scheduler':`export const runRelatedOfferOperation=fn=>fn();`,
  };
  const built=await build({entryPoints:['apps/web/app/api/catalog/related/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'related-api-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  return {state,get:(query:string)=>mod.exports.GET(new Request('https://avtocena.com/api/catalog/related?'+query)) as Promise<Response>};
}

test('related API accepts only a validated identity and resolves authoritative display/source context',async()=>{
  const {state,get}=await fixture();
  try{
    const response=await get('id=ajes-korea-current&dealer=dealer_test&preview=1');
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    const calls=state.calls;
    assert.deepEqual(calls.map((row:any)=>row[0]),['dealer','detail','display','related']);
    assert.deepEqual(calls[0],['dealer','dealer_test',true]);
    assert.equal(calls[2][1],state.detail.offer);
    assert.deepEqual(calls[3][1],{id:'ajes-korea-current',market:'korea',make:'Verified make',model:'Verified model',sourceId:'ajes_korea_feed',offerType:'fixed'});
    assert.deepEqual(calls[3][2],{markets:['korea']});
    assert.deepEqual(await response.json(),{marketTotal:null,partial:true,marketRows:[{id:'safe-result'}]});
  }finally{delete (globalThis as any).__relatedApi;}
});

test('invalid and price/specification/dealer parameter injection causes no lookup or provider work',async()=>{
  const {state,get}=await fixture();
  try{
    for(const query of ['', 'id=../private','id=good&id=other','id=special_dealer_private','id=good&market=japan','id=good&powerHp=160','id=good&sourceId=ajes_korea_feed','id=good&dealer=','id=good&dealer=../secret','id=good&preview=1','id=good&dealer=dealer_test&preview=true']){
      const response=await get(query);assert.equal(response.status,400,query);assert.equal(response.headers.get('cache-control'),'private, no-store');
    }
    assert.deepEqual(state.calls,[]);
  }finally{delete (globalThis as any).__relatedApi;}
});

test('inaccessible dealer, excluded market, retired Korea source and unavailable records fail closed',async()=>{
  const {state,get}=await fixture();
  try{
    state.dealer=null;
    assert.equal((await get('id=ajes-korea-current&dealer=dealer_test')).status,404);
    assert.deepEqual(state.calls.map((row:any)=>row[0]),['dealer']);
    state.calls=[];state.dealer={markets:['china']};
    assert.equal((await get('id=ajes-korea-current&dealer=dealer_test')).status,404);
    assert.deepEqual(state.calls.map((row:any)=>row[0]),['dealer','detail']);
    state.calls=[];state.detail.offer.sourceId='encar_direct';
    assert.equal((await get('id=ajes-korea-current')).status,404);
    assert.deepEqual(state.calls.map((row:any)=>row[0]),['detail']);
    state.calls=[];state.detail={offer:null,unavailable:true};
    const unavailable=await get('id=ajes-korea-current');
    assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'related_offers_unavailable'});
    assert.deepEqual(state.calls.map((row:any)=>row[0]),['detail']);
    state.detail={offer:null,unavailable:false};
    assert.equal((await get('id=missing')).status,404);
  }finally{delete (globalThis as any).__relatedApi;}
});
