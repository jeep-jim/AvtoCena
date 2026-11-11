import {readShowcase} from '@/lib/dealers/showcase-store';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readDataJson,readChunkedDataJson} from '@/lib/data';
import {billingDealer} from '@/lib/dealers/billing/access';
import {readBook,readBillingConfig,saveBillingConfig,saveSpec,approveExclusion,captureSignedDeal,closePeriods,issueDraftInvoice,recordBankPayment,newOrder,reverseCharge} from '@/lib/dealers/billing/store';
import {BILLING_POLICY,invoiceBalance} from '@/lib/dealers/billing/model';
import {paymentConfiguration,startPayment,checkPayment} from '@/lib/dealers/billing/payments';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){try{const user=await getCurrentUser(),q=new URL(request.url).searchParams;
 if(q.get('all')==='1'){if(!isPlatformOwner(user))throw Error('Нет доступа');const companies=await readDataJson<any[]>('dealers/dealers.json',[]),overview=[];for(const d of companies){const b=await closePeriods(d.id);overview.push({id:d.id,name:d.name,charges:b.charges.map(c=>({car:c.car,contractNumber:c.contractNumber,period:c.period,amountMinor:c.amountMinor,reverses:c.reverses})),invoices:b.invoices.map(i=>({period:i.period,balance:invoiceBalance(b,i)}))});}return Response.json({owner:true,companies:companies.map(d=>({id:d.id,name:d.name})),overview,config:await readBillingConfig()},{headers});}
 const id=await billingDealer(user,q.get('dealer')||undefined);const b=await readBook(id);const errors:string[]=[];for(const s of b.specs.filter(s=>!b.charges.some(c=>c.id===`deal_${s.leadId}`)).slice(0,20)){try{await captureSignedDeal(id,s.leadId);}catch{errors.push(s.leadId);}}const book=await closePeriods(id),config=await readBillingConfig();
 const [leads,clients,companies]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readChunkedDataJson<any>(`dealers/${id}/clients.json`,[]),isPlatformOwner(user)?readDataJson<any[]>('dealers/dealers.json',[]):Promise.resolve([])]);
 const showcase=await readShowcase(id);
 const candidates=leads.filter(l=>leadDealerId(l)===id&&!l.archivedAt&&l.assignedManagerId&&l.dealerContactResult&&l.platformTerms?.agreementVersion===BILLING_POLICY).map(l=>({id:l.id,title:l.offerTitle||l.car||'Автомобиль по заказу',percent:l.platformTerms.percent,suggestedCommission:showcase?.servicePricing?.[l.market as 'japan']?.commission?.priceRub,documents:(clients.find(c=>c.id===l.clientId)?.documents||[]).filter((d:any)=>!d.deletedAt&&!d.purgeToken).map((d:any)=>({id:d.id,name:d.name}))}));
 return Response.json({dealerId:id,owner:isPlatformOwner(user),book,config:isPlatformOwner(user)?config:{tax:config.tax},candidates,companies:companies.map(c=>({id:c.id,name:c.name})),paymentReady:paymentConfiguration().ready,paymentTest:paymentConfiguration().test,errors},{headers});}catch(e){return Response.json({error:e instanceof Error?e.message:'Нет доступа'},{status:403,headers});}}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return Response.json({error:'Нет доступа'},{status:403,headers});try{const user=await getCurrentUser();if(!user)throw Error('Войдите в кабинет');const raw=await request.text();if(raw.length>15000)throw Error('Слишком большой запрос');const b=JSON.parse(raw),owner=isPlatformOwner(user);
 if(b.action==='tax'){if(!owner)throw Error('Только владелец');return Response.json(await saveBillingConfig(b,user.id),{headers});}
 const id=await billingDealer(user,b.dealerId);let result:any={ok:true};
 if(b.action==='spec')await saveSpec(id,b,user.id);
 else if(b.action==='exclusion'){if(!owner)throw Error('Только владелец');await approveExclusion(id,b.leadId,b.version,user.id);}
 else if(b.action==='reverse'){if(!owner)throw Error('Только владелец');await reverseCharge(id,b.chargeId,String(b.reason||''),user.id);}
 else if(b.action==='issue'){if(!owner)throw Error('Только владелец');await issueDraftInvoice(id,b.invoiceId,user.id);}
 else if(b.action==='bank'){if(!owner)throw Error('Только владелец');await recordBankPayment(id,b.invoiceId,b.amount,String(b.reference||''),user.id);}
 else if(b.action==='pay'){if(!paymentConfiguration().ready)throw Error('Онлайн-оплата ещё не подключена');const order=await newOrder(id,b);result={url:await startPayment(id,order.id)};}
 else if(b.action==='check')result={status:await checkPayment(id,String(b.orderId||''))};
 else throw Error('Неизвестное действие');return Response.json(result,{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось выполнить операцию'},{status:400,headers});}}
