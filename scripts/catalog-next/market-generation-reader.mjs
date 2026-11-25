/**
 * Read-copy-update (RCU) runtime for immutable market generations.
 * Each request pins exactly one accepted generation; changing the market
 * pointer opens the replacement before retiring the previous SQLite handles.
 *
 * Caller supplies a validated data-only pointer store and an openGeneration()
 * implementation returning {query(...), close()}. No Docker or source fetch.
 * No background timers: refresh occurs on a subsequent request.
 */
import {MARKET_IDS,validateMarketPointer} from './market-data-pointer.mjs';
const ALLOWED=new Set(MARKET_IDS);
const fail=code=>{throw Error('market_reader_'+code)};
const need=(ok,code)=>{if(!ok)fail(code)};
const identity=ref=>ref.generationId+':'+ref.manifestSha256+':'+ref.pricingContextSha256;
export function createMarketGenerationReader({store,openGeneration,clock=Date.now,refreshMs=15000}={}){
  need(store && typeof store.read==='function' && typeof openGeneration==='function','capabilities');
  need(typeof clock==='function' && Number.isSafeInteger(refreshMs)&&refreshMs>=0&&refreshMs<=60000,'clock');
  const markets=new Map();

  async function retiredClose(entry){
    if(!entry || !entry.retired || entry.pins!==0 || !entry.opened)return;
    entry.opened=false;
    const handle=await entry.promise;
    if(handle && typeof handle.close==='function')await handle.close();
  }
  async function load(market,reference,current){
    const id=identity(reference);
    if(current?.id===id)return current;
    const entry={id,reference,pins:0,retired:false,opened:true,promise:null};
    entry.promise=Promise.resolve().then(()=>openGeneration({market,reference}));
    try{
      const handle=await entry.promise;
      need(handle && typeof handle.close==='function','generation_handle');
    }catch(error){
      entry.opened=false;
      throw error;
    }
    return entry;
  }
  async function refresh(market,slot){
    const observation=await store.read(market);
    need(observation && observation.value,'pointer_absent');
    const pointer=validateMarketPointer(market,observation.value);
    need(pointer.active!==null,'not_accepted');
    const next=await load(market,pointer.active,slot.active);
    if(next!==slot.active){
      const previous=slot.active;
      slot.active=next;
      if(previous){previous.retired=true;await retiredClose(previous);}
    }
    return slot.active;
  }
  async function withMarket(market,visitor){
    need(ALLOWED.has(market)&&typeof visitor==='function','request');
    let slot=markets.get(market);
    if(!slot){slot={active:null,expiresAt:-Infinity,refreshing:null};markets.set(market,slot);}
    if(slot.active===null || clock()>=slot.expiresAt){
      if(!slot.refreshing){
        slot.refreshing=refresh(market,slot).then(entry=>{
          slot.expiresAt=clock()+refreshMs;return entry;
        }).finally(()=>{slot.refreshing=null});
      }
      await slot.refreshing;
    }
    const entry=slot.active;
    need(entry&&!entry.retired,'not_ready');
    entry.pins++;
    try{
      const reader=await entry.promise;
      return await visitor({market,generation:entry.reference,reader});
    }finally{
      entry.pins--;
      await retiredClose(entry);
    }
  }
  return Object.freeze({withMarket});
}
