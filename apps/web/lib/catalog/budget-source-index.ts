import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';

// Immutable selectors cannot change make through a specification overlay.
// Weak ownership follows the bounded index cache. No prices or admission
// decisions are cached here; those still run with the request's current context.
let indexes=new WeakMap<BudgetCountIndex,Promise<{all:BudgetCountRow[];makes:Map<string,BudgetCountRow[]>}>>();
export function resetBudgetSourceIndexes(){indexes=new WeakMap();}
export async function budgetSourceRows(index:BudgetCountIndex,wanted:ReadonlySet<string>|null,key:(make:string)=>string){
 let pending=indexes.get(index);
 if(!pending){
  pending=(async()=>{
   const all:BudgetCountRow[]=[],makes=new Map<string,BudgetCountRow[]>();let count=0;
   for(const part of [index.rows,index.otherRows||[]])for(const row of part){
    all.push(row);const make=key(row[5].make||'');
    let group=makes.get(make);if(!group){group=[];makes.set(make,group);}group.push(row);
    if(++count%256===0)await new Promise<void>(resolve=>setImmediate(resolve));
   }
   return {all,makes};
  })();
  indexes.set(index,pending);
  void pending.catch(()=>{if(indexes.get(index)===pending)indexes.delete(index);});
 }
 const built=await pending;
 // Preserve source order for multiple selections; the usual single-make path
 // examines only that make instead of scanning the whole market per query.
 if(wanted?.size===1)return built.makes.get(wanted.values().next().value!)||[];
 return built.all;
}
