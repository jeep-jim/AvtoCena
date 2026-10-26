import {createHash} from 'node:crypto';
import {DetailReadCache} from './detail-read-cache';
import type {BudgetCountRow} from './budget-count-index';
export type BudgetSortContext={generation:string;index:number;revision:string;day:string;city:string;mode:string;pricing:unknown};
/** Cache only positions. Every caller supplies current validated price inputs,
 * selector identity and exact ordered membership; no card/price metadata is retained. */
export class BudgetSortOrderCache{
 private indexes=new WeakMap<object,number>();private nextIndex=0;
 private memberships=new WeakMap<BudgetCountRow[],Promise<string>>();
 private orders:DetailReadCache<Uint32Array|null>;
 constructor(now=Date.now){this.orders=new DetailReadCache({maxEntries:32,maxBytes:32*1024*1024,ttlMs:3600_000,concurrency:4,sizeOf:value=>value?.byteLength||0,shouldCache:value=>value!==null,now});}
 clear(){this.orders.clear();this.indexes=new WeakMap();this.memberships=new WeakMap();this.nextIndex=0;}
 indexKey(index:object){let key=this.indexes.get(index);if(key===undefined){key=++this.nextIndex;this.indexes.set(index,key);}return key;}
 async get(context:BudgetSortContext,rows:BudgetCountRow[],load:()=>Promise<Uint32Array|null>){
  let membership=this.memberships.get(rows);
  if(!membership){membership=(async()=>{
   const hash=createHash('sha256');
   for(let i=0;i<rows.length;i++){hash.update(JSON.stringify(rows[i][5].id));hash.update('\n');if((i+1)%256===0)await new Promise<void>(resolve=>setImmediate(resolve));}
   return hash.digest('hex');
  })();this.memberships.set(rows,membership);}
  const key=createHash('sha256').update(JSON.stringify([context,await membership])).digest('hex');
  return this.orders.get(key,load);
 }
}
