import type {BudgetCountIndex,BudgetCountRow} from './budget-count-index';

// Immutable selectors cannot change make through a specification overlay.
// Weak ownership follows the bounded index cache. No prices or admission
// decisions are cached here; those still run with the request's current context.
let indexes=new WeakMap<BudgetCountIndex,Promise<{all:BudgetCountRow[];makes:Map<string,BudgetCountRow[]>;positions:Map<string,Uint32Array>}>>();
export function resetBudgetSourceIndexes(){indexes=new WeakMap();}
export async function budgetSourceRows(index:BudgetCountIndex,wanted:ReadonlySet<string>|null,key:(make:string)=>string){
 let pending=indexes.get(index);
 if(!pending){
  pending=(async()=>{
   const all:BudgetCountRow[]=[],makes=new Map<string,BudgetCountRow[]>(),offsets=new Map<string,number[]>();let count=0;
   for(const part of [index.rows,index.otherRows||[]])for(const row of part){
    all.push(row);const make=key(row[5].make||'');
    let group=makes.get(make);if(!group){group=[];makes.set(make,group);offsets.set(make,[]);}group.push(row);offsets.get(make)!.push(all.length-1);
    if(++count%256===0)await new Promise<void>(resolve=>setImmediate(resolve));
   }
   return {all,makes,positions:new Map([...offsets].map(([make,values])=>[make,Uint32Array.from(values)]))};
  })();
  indexes.set(index,pending);
  void pending.catch(()=>{if(indexes.get(index)===pending)indexes.delete(index);});
 }
 const built=await pending;
 // Preserve source order for multiple selections; the usual single-make path
 // examines only that make instead of scanning the whole market per query.
 if(wanted?.size===1)return built.makes.get(wanted.values().next().value!)||[];
 if(!wanted||[...built.makes.keys()].every(make=>wanted.has(make)))return built.all;
 // Multiple makes used to scan the whole market. Merge only their prepared
 // offsets in original source order; no prices, filters or membership are cached.
 const groups=[...wanted].map(make=>built.positions.get(make)).filter((v):v is Uint32Array=>Boolean(v));
 const count=groups.reduce((n,group)=>n+group.length,0);
 // A near-full selection is cheaper to pass through the existing matcher than
 // to allocate and sort nearly the entire index again.
 if(count>built.all.length/2)return built.all;
 const positions=new Uint32Array(count);let offset=0;
 for(const group of groups){positions.set(group,offset);offset+=group.length;}
 positions.sort();
 return Array.from(positions,position=>built.all[position]);
}
