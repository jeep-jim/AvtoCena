import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';

/** One policy pass per immutable selector, local day and editorial revision.
 * Weak ownership follows the existing bounded selector cache. Prices and query
 * predicates are deliberately not retained here. */
export class BudgetEligibilityCache {
 private entries=new WeakMap<BudgetCountIndex,{context:string;ids:ReadonlySet<string>}>();
 clear(){this.entries=new WeakMap();}
 get(index:BudgetCountIndex,context:string,eligible:(row:BudgetCountRow)=>boolean):ReadonlySet<string>{
  const cached=this.entries.get(index);
  if(cached?.context===context)return cached.ids;
  const ids=new Set<string>();
  for(const rows of [index.rows,index.otherRows||[]])for(const row of rows)if(eligible(row))ids.add(row[5].id);
  this.entries.set(index,{context,ids});
  return ids;
 }
}
