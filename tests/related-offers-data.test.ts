import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
const require=createRequire(import.meta.url);

function offer(id:string,table:'stats'|'korea',model='SPORTAGE'){
  const price=table==='stats'?500000:15000000,currency=table==='stats'?'JPY':'KRW';
  const lot=ajesLot({ID:id,MARKA_NAME:'KIA',MODEL_NAME:model,YEAR:'2023',AUCTION_TYPE:'2',STATUS:table==='stats'?'Sold':'active',FINISH:String(price),TIME:'D',IMAGES:'https://7.tru.ru/imgs/testABC&h=50'},table,false)!;
  return ajesOffer(lot,{currency,sourcePrice:price,effectiveRate:table==='stats'?0.6:0.06,rateSource:'cbr'} as any,new Date().toISOString());
}

async function fixture(){
  const current=offer('current','korea'),same=offer('same','korea'),other=offer('other','korea','K3'),japan=offer('jp','stats');
  const green={...japan,id:'green-10',sourceId:'akebono_green_japan_open',offerType:'fixed',status:'active'};
  const state:any={calls:[],priced:[],dto:[],active:0,peak:0,failJapan:false,failCount:false,staleCount:false,current,same,other,japan,green};
  state.run=async(kind:string,fn:()=>any)=>{state.calls.push(kind);state.active++;state.peak=Math.max(state.peak,state.active);try{await new Promise(resolve=>setTimeout(resolve,1));return fn();}finally{state.active--;}};
  state.supplier=(q:any)=>state.run('supplier:'+q.table+':'+(q.model||'all'),()=>{
    if(q.table==='stats'){if(state.failJapan)throw Error('fixture provider unavailable');return {items:[japan],stale:false};}
    return {items:q.model?[current,same,{...same,id:'legacy',sourceId:'encar_direct'}]:[current,same,other],stale:false};
  });
  state.count=()=>state.run('count',()=>{if(state.failCount)throw Error('count unavailable');return {total:42,stale:state.staleCount,upperBound:false,observedAt:new Date().toISOString()};});
  state.green=()=>state.run('green',()=>({version:1,updatedAt:new Date().toISOString(),items:[green],sourceCount:1}));
  (globalThis as any).__relatedData=state;
  const stubs:Record<string,string>={
    'server-only':'',
    './ajes-public':`export const readAjesPublic=q=>globalThis.__relatedData.supplier(q);`,
    './ajes-catalog':`export const readAjesCountSummary=q=>globalThis.__relatedData.count(q);`,
    './related-model-family':`export const readRelatedModelFamily=async()=>globalThis.__relatedData.run('family',()=> 'SPORTAGE');`,
    './green-corner':`export const readGreenCorner=()=>globalThis.__relatedData.green();export const publicGreenOffer=o=>o;`,
    './green-corner-search':`export const filterGreenCorner=items=>items;`,
    './presentation':`export const presentCatalogOffer=o=>({makeLabel:o.make,modelLabel:o.model,marketLabel:o.market});`,
    './live-business-pricing':`export const applyActiveBusinessPricingBatch=rows=>globalThis.__relatedData.run('price',()=>{globalThis.__relatedData.priced.push(...rows);return rows;});`,
    './storage':`export const searchOffers=async params=>{globalThis.__relatedData.calls.push('local:'+params.market);return {items:[],total:0};};export const publicOffer=row=>{globalThis.__relatedData.dto.push(row.id);return {id:row.id,market:row.market,make:row.make,model:row.model,safeDto:true};};`,
    './editorial':`export const readCatalogEditorial=async()=>({});export const editorialHidden=row=>row.hidden===true;export const applyCatalogEditorial=row=>row;`,
  };
  const built=await build({entryPoints:['apps/web/lib/catalog/related-offers-data.ts'],bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'related-data-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  return {state,read:mod.exports.readRelatedOffers as (current:any,options?:{markets:string[]})=>Promise<any>};
}

test('dealer markets are excluded before source work and retired Korean rows cannot enter returned sections',async()=>{
  const {state,read}=await fixture();
  try{
    const payload=await read(state.current,{markets:['korea']});
    assert.deepEqual(payload.sameModel.map((row:any)=>row.id),['ajes-korea-same']);
    assert.deepEqual(payload.marketRows.map((row:any)=>row.id),['ajes-korea-other']);
    assert.deepEqual(payload.crossMarketGroups,[]);assert.equal(payload.marketTotal,42);assert.equal(payload.partial,false);
    assert.ok(state.calls.every((kind:string)=>kind!=='green'&&!kind.startsWith('supplier:stats')&&!kind.startsWith('local:')));
    assert.deepEqual(state.dto,['ajes-korea-same','ajes-korea-other']);
    assert.ok([...payload.sameModel,...payload.marketRows].every((row:any)=>row.safeDto));
    assert.ok(!JSON.stringify(payload).includes('encar_direct'));
    const before=state.calls.length;await assert.rejects(read(state.current,{markets:['china']}),/related_market_unavailable/);assert.equal(state.calls.length,before);
  }finally{delete (globalThis as any).__relatedData;}
});

test('one failed source preserves independent sections, saved stock and unknown counts without false zero',async()=>{
  const {state,read}=await fixture();
  try{
    state.failJapan=true;state.failCount=true;
    const payload=await read(state.current,{markets:['korea','japan']});
    assert.equal(payload.partial,true);assert.equal(payload.marketTotal,null);
    assert.deepEqual(payload.sameModel.map((row:any)=>row.id),['ajes-korea-same']);
    assert.deepEqual(payload.marketRows.map((row:any)=>row.id),['ajes-korea-other']);
    assert.deepEqual(payload.crossMarketGroups.map((group:any)=>[group.market,group.items.map((row:any)=>row.id)]),[['japan',['green-10']]]);
    state.failCount=false;state.staleCount=true;
    const stale=await read(state.current,{markets:['korea']});assert.equal(stale.marketTotal,null);assert.equal(stale.partial,true);
  }finally{delete (globalThis as any).__relatedData;}
});

test('two full related pipelines share two operation slots and finish without a nested scheduler deadlock',async()=>{
  const {state,read}=await fixture();
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    const pages=await Promise.race([Promise.all([read(state.current,{markets:['korea','japan']}),read(state.current,{markets:['korea','japan']})]),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('full related pipeline deadlock')),500);})]);
    assert.equal(pages.length,2);assert.equal(state.peak,2);
    assert.equal(state.calls.filter((kind:string)=>kind==='count').length,2,'independent visitors do not share a pending result');
    assert.equal(state.calls.filter((kind:string)=>kind==='green').length,2);
    assert.ok(pages.every((page:any)=>page.sameModel.length===1&&page.marketRows.length===1));
  }finally{if(timeout)clearTimeout(timeout);delete (globalThis as any).__relatedData;}
});
