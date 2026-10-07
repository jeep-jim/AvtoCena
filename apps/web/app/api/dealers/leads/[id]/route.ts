import {confirmedCustomerContract} from '@/lib/account/access';
import {clientsPath} from '@/lib/account/portal';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readMembership} from '@/lib/dealers/program-store';
import {dealerCommissionPercent} from '@/lib/dealers/program-model';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {dealerLeadView,CONTACT_RESULTS} from '@/lib/dealers/lead-workflow';
import {readCrmUsers} from '@/lib/crm-users';
import {readChunkedDataJson,updateChunkedDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store'},u=await getCurrentUser();if(!u||!u.companyId||!await canManageDealer(u,u.companyId)||!isCalculationOriginAllowed(request))return Response.json({error:'Нет доступа'},{status:403,headers});
 try{const raw=await request.text();if(raw.length>5000)throw Error('Слишком большой запрос');const b=JSON.parse(raw),{id}=await params,m=await readMembership(u.companyId),now=new Date(),users=await readCrmUsers();
 const clients=['stage','contact'].includes(b.action)?await readChunkedDataJson<any>(clientsPath(u.companyId),[]):[];
 const lead=await updateChunkedDataJson<any>('leads/leads.json',id,l=>{
 if(leadDealerId(l)!==u.companyId||l.archivedAt)throw Error('Заявка недоступна');
 if(b.action==='assign'){
 const manager=users.find(x=>x.id===b.managerId&&x.companyId===u.companyId&&x.status!=='disabled'&&x.dealerApproved===true);if(!manager)throw Error('Выберите подтверждённого сотрудника своей компании');
 if((l.assignedManagerId||'')!==(b.expectedManagerId||''))throw Error('Ответственный уже изменён. Обновите страницу');
 if(!l.platformTerms&&(!m.agreement?.approvedAt||dealerCommissionPercent(m,now)===null))throw Error('Сначала подтвердите оферту и активируйте тариф');
 return {...l,assignedManagerId:manager.id,status:l.status==='new'?'assigned':l.status,updatedAt:now.toISOString(),platformTerms:l.platformTerms||{percent:dealerCommissionPercent(m,now),basis:'remuneration',agreementDigest:m.agreement!.digest,at:now.toISOString()},dealerWorkflowHistory:[...(l.dealerWorkflowHistory||[]),{action:'assign',managerId:manager.id,actorId:u.id,at:now.toISOString()}]};
 }
 if(b.action==='contact'){
 if(!l.platformTerms||!l.assignedManagerId)throw Error('Сначала назначьте менеджера');if(!CONTACT_RESULTS.includes(b.result))throw Error('Выберите результат');const note=String(b.note||'').trim().slice(0,2000);if(b.result==='rejected'&&!note)throw Error('Укажите причину отказа');
 if((confirmedCustomerContract(clients.find(c=>c.id===l.clientId),l.id)||['contract_signed','paid','in_progress','delivered','completed'].includes(l.status))&&b.result==='rejected')throw Error('По заявке уже зафиксирован договор. Обратитесь к команде АвтоЦены');
 return {...l,dealerContactResult:b.result,updatedAt:now.toISOString(),status:['new','assigned','contacted'].includes(l.status)?b.result==='rejected'?'rejected':'contacted':l.status,dealerWorkflowHistory:[...(l.dealerWorkflowHistory||[]),{action:'contact',result:b.result,note,actorId:u.id,at:now.toISOString()}]};
 }
 if(b.action==='stage'){
 if(!l.assignedManagerId||!l.dealerContactResult)throw Error('Сначала назначьте менеджера и выберите результат общения');
 if(confirmedCustomerContract(clients.find(c=>c.id===l.clientId),l.id)&&['qualified','selection','offer_sent','negotiation','contract_sent'].includes(b.status))throw Error('Подписанный договор уже подтверждён. Для изменения обратитесь в АвтоЦену');
 const allowed=['qualified','selection','offer_sent','negotiation','contract_sent','paid','in_progress','delivered','completed'];if(!allowed.includes(b.status))throw Error('Недоступный этап');
 if(['paid','in_progress','delivered','completed'].includes(b.status)&&!confirmedCustomerContract(clients.find(c=>c.id===l.clientId),l.id))throw Error('Сначала прикрепите подписанный договор и получите подтверждение клиента в его кабинете');
 return {...l,status:b.status,updatedAt:now.toISOString(),dealerWorkflowHistory:[...(l.dealerWorkflowHistory||[]),{action:'stage',status:b.status,actorId:u.id,at:now.toISOString()}]};
 }throw Error('Неизвестное действие');
 });if(!lead)throw Error('Заявка не найдена');if(b.action==='assign'&&lead.clientId)await updateChunkedDataJson<any>(clientsPath(u.companyId),lead.clientId,c=>c.companyId===u.companyId?{...c,assignedManagerId:lead.assignedManagerId}:c);return Response.json({lead:dealerLeadView(lead,u.companyId)},{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить'},{status:400,headers});}
}
