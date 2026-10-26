import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';

/** One policy pass per immutable selector, local day and editorial revision.
 * Weak ownership follows the existing bounded selector cache. Prices and query
 * predicates are deliberately not retained here. */
export class BudgetEligibilityCache {
 private entries=new WeakMap<BudgetCountIndex,{context:string;ids:Promise<ReadonlySet<string>>}>();
 clear(){this.entries=new WeakMap();}
 get(index:BudgetCountIndex,context:string,eligible:(row:BudgetCountRow)=>boolean):Promise<ReadonlySet<string>>{
  const cached=this.entries.get(index);
  if(cached?.context===context)return cached.ids;
  const ids=(async()=>{
   const result=new Set<string>();let count=0;
   for(const rows of [index.rows,index.otherRows||[]])for(const row of rows){
    if(eligible(row))result.add(row[5].id);
    if(++count%256===0)await new Promise<void>(resolve=>setImmediate(resolve));
   }
   return result;
  })();
  const entry={context,ids};this.entries.set(index,entry);
  void ids.catch(()=>{if(this.entries.get(index)===entry)this.entries.delete(index);});
  return ids;
 }
}
