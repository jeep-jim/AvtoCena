import type {BudgetCountRow} from './budget-count-index';
// Selector/replay tuples are immutable after publication or restoration. Keep
// weak byte counts, not another copy of their often large metadata strings.
let rowSizes=new WeakMap<BudgetCountRow,number>();
export function resetBudgetRowSizes(){rowSizes=new WeakMap();}
export async function budgetRowsBytes(rows:BudgetCountRow[]):Promise<number>{
 let bytes=2+Math.max(0,rows.length-1);
 for(let offset=0;offset<rows.length;offset+=256){
  for(const row of rows.slice(offset,offset+256)){
   let size=rowSizes.get(row);
   if(size===undefined){size=Buffer.byteLength(JSON.stringify(row));rowSizes.set(row,size);}
   bytes+=size;
  }
  if(offset+256<rows.length)await new Promise<void>(resolve=>setImmediate(resolve));
 }
 return bytes;
}
export async function budgetSelectionBytes(value:{rows:BudgetCountRow[];[key:string]:unknown}|null){
 if(!value)return 4;
 return Buffer.byteLength(JSON.stringify({...value,rows:[]}))-2+await budgetRowsBytes(value.rows);
}
