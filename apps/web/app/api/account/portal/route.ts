import {canClaimCustomerInvite,confirmedCustomerContract,sharedCustomerDocuments} from '@/lib/account/access';
import {readAccountJson} from '@/lib/account/request';
import {currentAccount,hash,accountRateLimit} from '@/lib/account/auth';
import {customerLeads,linkedClient,portalData,sendPortalMessage,linksPath,clientsPath,type ClientLink} from '@/lib/account/portal';
import {mutateDataJson,readChunkedDataJson,updateChunkedDataJson,appendChunkedDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {normalizeReviewInput} from '@/lib/dealers/review-policy';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){const a=await currentAccount();if(!a)return Response.json({error:'Войдите в кабинет.'},{status:401,headers});return Response.json({clients:await portalData(a)},{headers});}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});const a=await currentAccount();if(!a)return new Response(null,{status:401});
 try{if(!await accountRateLimit('portal:'+a.id,60,300000))return Response.json({error:'Слишком много действий. Повторите позже.'},{status:429});const b=await readAccountJson(request);if(b.action==='claim'){
 const [company,clientId,token]=String(b.invite||'').split('.');if(!/^[a-f0-9]{48}$/.test(token||'')||!/^[-a-zA-Z0-9_]{1,100}$/.test(clientId||''))throw Error('Приглашение недействительно.');
 const path=clientsPath(company);const result=await updateChunkedDataJson<any>(path,clientId,c=>{if(!canClaimCustomerInvite(a.id,c,hash(token)))throw Error('Приглашение недействительно или устарело.');return {...c,portalAccountId:a.id};});if(!result)throw Error('Приглашение недействительно.');
 await mutateDataJson<ClientLink[]>(linksPath(a.id),[],rows=>rows.some(l=>l.clientId===clientId&&l.companyId===company)?rows:[...rows,{companyId:company,clientId,verifiedAt:new Date().toISOString()}]);
 }else{const {link,client}=await linkedClient(a,String(b.key||''));
 if(b.action==='confirm_contract'){
 if(b.confirmed!==true)throw Error('Подтвердите, что этот экземпляр договора подписан вами и дилером');
 const lead=(await customerLeads(link.companyId,client.id)).find(l=>l.id===b.leadId);if(!lead)throw Error('Заявка не найдена');
 const documentId=String(b.documentId||''),at=new Date().toISOString();
 await updateChunkedDataJson<any>(clientsPath(link.companyId),client.id,c=>{const contract=c.portalContracts?.[lead.id];if(c.portalAccountId!==a.id||!contract||contract.revokedAt||contract.documentId!==documentId||!sharedCustomerDocuments(c).some((d:any)=>d.id===documentId))throw Error('Договор недоступен или изменился');return {...c,portalContracts:{...c.portalContracts,[lead.id]:{...contract,customerConfirmedAt:contract.customerConfirmedAt||at,customerConfirmedBy:a.id}}};});
 await updateChunkedDataJson<any>('leads/leads.json',lead.id,l=>{if(l.clientId!==client.id||(l.requestedDealerId||l.dealerId||'dealer_topavto')!==link.companyId)throw Error('Нет доступа');return {...l,status:['paid','in_progress','delivered','completed'].includes(l.status)?l.status:'contract_signed',updatedAt:at};});
 }else if(b.action==='message'){const message=await sendPortalMessage(link.companyId,client.id,b.text,a.name,a.id);return Response.json({ok:true,message:{id:message.id,text:message.text,author:message.author,createdAt:message.createdAt,mine:true}},{headers});}
 else if(b.action==='review'){
 const confirmation=confirmedCustomerContract(client,String(b.leadId));if(!confirmation||client.portalReviews?.[b.leadId])throw Error('Отзыв доступен после подтверждения подписанного договора.');
 const lead=(await customerLeads(link.companyId,client.id)).find(l=>l.id===b.leadId);if(!lead)throw Error('Заявка не найдена.');
 const dealerId=lead.requestedDealerId||lead.dealerId||link.companyId;if(dealerId!==confirmation.dealerId)throw Error('Компания в договоре не совпадает.');
 const input=normalizeReviewInput(b.rating,b.text);const review={id:hash(a.id+':'+lead.id),userId:a.id,dealerId,leadId:lead.id,contractId:confirmation.documentId,rating:input.rating,text:input.text,author:a.name,createdAt:new Date().toISOString(),status:'published'};
 // One immutable review per application, including retries and concurrent tabs.
 await appendChunkedDataJson(`dealers/${encodeURIComponent(dealerId)}/reviews.json`,review);
 await updateChunkedDataJson<any>(clientsPath(link.companyId),client.id,c=>({...c,portalReviews:{...c.portalReviews,[lead.id]:review.id}}));
 return Response.json({ok:true,review:{id:review.id,rating:review.rating,text:review.text,status:review.status,leadId:review.leadId}},{headers});
 }else throw Error('Неизвестное действие.');}
 return Response.json({ok:true},{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить.'},{status:400,headers});}
}
