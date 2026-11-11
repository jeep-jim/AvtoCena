import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';

/** Derived metadata only, owned weakly by the immutable selector. Keeping the
 * same rows lets facet/order caches survive the short request-cache expiry.
 * Price-bound queries never use this cache; visible cards are still repriced. */
export class StableBudgetSelectionCache {
 private entries=new WeakMap<BudgetCountIndex,{context:string;scopes:Map<string,Promise<BudgetCountRow[]>>}>();
 clear(){this.entries=new WeakMap();}
 get(index:BudgetCountIndex,context:string,market:string,load:()=>Promise<BudgetCountRow[]>){
  let entry=this.entries.get(index);
  if(!entry||entry.context!==context){entry={context,scopes:new Map()};this.entries.set(index,entry);}
  const found=entry.scopes.get(market);if(found)return found;
  // Only country scopes are admitted by the caller. Also bound this helper so
  // a future caller cannot accumulate arbitrary query combinations per index.
  if(entry.scopes.size>=8)entry.scopes.delete(entry.scopes.keys().next().value!);
  const value=load();entry.scopes.set(market,value);
  const captured=entry;
  void value.catch(()=>{if(captured.scopes.get(market)===value)captured.scopes.delete(market);});
  return value;
 }
}
