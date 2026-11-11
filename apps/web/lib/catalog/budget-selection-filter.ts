import type {BudgetCountRow} from './budget-count-index';

/** Keep selection order and editorial overlays while allowing other requests
 * to run between bounded batches of synchronous catalog predicates. */
export async function filterBudgetRows(
 rows:BudgetCountRow[], edit:(row:BudgetCountRow)=>BudgetCountRow,
 matches:(row:BudgetCountRow)=>boolean,
):Promise<BudgetCountRow[]>{
 const selected:BudgetCountRow[]=[];
 for(let offset=0;offset<rows.length;offset+=256){
  const end=Math.min(rows.length,offset+256);
  for(let i=offset;i<end;i++){
   const row=edit(rows[i]);
   if(matches(row))selected.push(row);
  }
  if(end<rows.length)await new Promise<void>(resolve=>setImmediate(resolve));
 }
 return selected;
}
