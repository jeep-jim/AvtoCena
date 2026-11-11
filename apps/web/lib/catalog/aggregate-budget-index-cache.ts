import type {BudgetCountIndex} from './budget-count-index';
import {budgetRowsBytes} from './budget-row-size';
import {DetailReadCache} from './detail-read-cache';

/** Directory refreshes must not change the identity of unchanged immutable parts.
 * Keep a bounded aggregate keyed by the ordered part objects, never by prices. */
export class AggregateBudgetIndexCache {
 private identities=new WeakMap<BudgetCountIndex,number>();
 private nextIdentity=0;
 private cache:DetailReadCache<BudgetCountIndex>;
 constructor(now=Date.now,maxBytes=256*1024*1024){
  this.cache=new DetailReadCache({maxEntries:2,maxBytes,ttlMs:3600_000,concurrency:1,now,sizeOf:async value=>
   Buffer.byteLength(JSON.stringify({...value,rows:[],otherRows:[]}))-4
    +await budgetRowsBytes(value.rows)+await budgetRowsBytes(value.otherRows||[])});
 }
 clear(){this.cache.clear();this.identities=new WeakMap();this.nextIdentity=0;}
 async merge(parts:Array<BudgetCountIndex|null>):Promise<BudgetCountIndex|null>{
  const generation=parts[0]?.generationId;
  if(!generation||parts.some(part=>!part||part.bodyFilterVersion!==1||part.generationId!==generation))return null;
  const valid=parts as BudgetCountIndex[];
  const key=JSON.stringify(valid.map(part=>{let id=this.identities.get(part);if(id===undefined){id=++this.nextIdentity;this.identities.set(part,id);}return id;}));
  return this.cache.get(key,async()=>({...valid[0],displayOrderVersion:valid.every(part=>part.displayOrderVersion===1)?1 as const:undefined,
   sourceRows:valid.reduce((n,part)=>n+part.sourceRows,0),rows:valid.flatMap(part=>part.rows),
   otherRows:valid.flatMap(part=>part.otherRows||[]),pricingChunks:Object.assign({},...valid.map(part=>part.pricingChunks||{}))}));
 }
}
