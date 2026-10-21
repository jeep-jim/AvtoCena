import {readDataJson,mutateDataJson} from '../apps/web/lib/data';
import {readBook,captureSignedDeal,closePeriods} from '../apps/web/lib/dealers/billing/store';
import {paymentConfiguration,checkPayment} from '../apps/web/lib/dealers/billing/payments';
// Bounded rotation: one failing company never prevents settlement of others.
async function main(){
 const companies=(await readDataJson<{id:string}[]>('dealers/dealers.json',[])).sort((a,b)=>a.id.localeCompare(b.id));
 const state=await readDataJson<{last:string;cursors?:Record<string,{spec:string;payment:string}>}>('dealers/billing-worker.json',{last:''});
 const ordered=[...companies.filter(c=>c.id>state.last),...companies.filter(c=>c.id<=state.last)].slice(0,20);
 const rotate=<T extends {id:string}>(rows:T[],after:string,limit:number)=>[...rows.filter(r=>r.id>after),...rows.filter(r=>r.id<=after)].slice(0,limit);
 let failures=0;for(const {id} of ordered){let specCursor=state.cursors?.[id]?.spec||'',paymentCursor=state.cursors?.[id]?.payment||'';try{
  const book=await readBook(id);for(const s of rotate(book.specs.filter(s=>!book.charges.some(c=>c.id===`deal_${s.leadId}`)).map(s=>({...s,id:s.leadId})).sort((a,b)=>a.id.localeCompare(b.id)),specCursor,100)){specCursor=s.id;try{await captureSignedDeal(id,s.leadId);}catch{failures++;console.error('billing: accrual needs review',id,s.leadId);}}
  if(paymentConfiguration().ready){for(const o of rotate(book.orders.filter(o=>o.providerId&&(o.status==='pending'||(o.status==='paid'&&!o.appliedAt))).sort((a,b)=>a.id.localeCompare(b.id)),paymentCursor,20)){paymentCursor=o.id;try{await checkPayment(id,o.id);}catch{failures++;console.error('billing: payment needs retry',id,o.id);}}}
  await closePeriods(id);
 }catch{failures++;console.error('billing: company needs retry',id);}
 await mutateDataJson<{last:string;cursors?:Record<string,{spec:string;payment:string}>}>('dealers/billing-worker.json',{last:''},c=>({last:id,cursors:{...c.cursors,[id]:{spec:specCursor,payment:paymentCursor}}}));}
 console.log(JSON.stringify({processed:ordered.length,companies:companies.length,failures,paymentChecks:paymentConfiguration().ready}));if(failures)process.exitCode=1;
}
main().catch(()=>{console.error('billing: worker failed before completing rotation');process.exitCode=1;});
