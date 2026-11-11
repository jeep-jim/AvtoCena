import {getCurrentUser} from '@/lib/auth';
import {billingDealer} from '@/lib/dealers/billing/access';
import {readBook} from '@/lib/dealers/billing/store';
import {billingPdf} from '@/lib/dealers/billing/pdf';
export async function GET(request:Request){try{const q=new URL(request.url).searchParams,id=await billingDealer(await getCurrentUser(),q.get('dealer')||undefined),book=await readBook(id),invoice=book.invoices.find(i=>i.id===q.get('invoice'));if(!invoice)return new Response(null,{status:404});return new Response(new Uint8Array(await billingPdf(invoice,book,q.get('type')==='act')),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="avtocena-billing.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:403});}}
