import {randomUUID} from 'node:crypto';
import {isLeadStatus} from '../crm';
import {confirmedCustomerContract} from '../account/access';
import {leadDealerId} from './lead-routing';
import type {AuthUser} from '../auth';
export function applyDealerLeadUpdate(l:any,u:AuthUser,b:any,users:AuthUser[],clients:any[],now:Date){
 if(u.role!=='dealer'||!u.dealerApproved||u.status==='disabled'||!u.companyId||leadDealerId(l)!==u.companyId)throw Error('Заявка недоступна');
 if(!l.platformTerms?.agreementDigest||!l.assignedManagerId||!l.dealerContactResult)throw Error('Сначала назначьте менеджера и сохраните результат общения');
 const owner=u.dealerTeamRole==='owner',note=String(b.note||'').trim().slice(0,2000),status=b.status||l.status;
 if(!isLeadStatus(status))throw Error('Недоступный этап');
 const hasManager=Object.hasOwn(b,'assignedManagerId'),managerId=hasManager?b.assignedManagerId:l.assignedManagerId;
 if(hasManager&&managerId!==l.assignedManagerId&&!owner)throw Error('Назначение доступно владельцу компании');
 if(hasManager&&(b.expectedManagerId||'')!==(l.assignedManagerId||''))throw Error('Ответственный уже изменён. Обновите страницу');
 if(!users.some(x=>x.id===managerId&&x.companyId===u.companyId&&x.status!=='disabled'&&x.dealerApproved===true))throw Error('Выберите сотрудника своей компании');
 const confirmed=confirmedCustomerContract(clients.find(c=>c.id===l.clientId),l.id);
 if(status!==l.status){
 if(['contract_signed','paid','in_progress','delivered','completed'].includes(status)&&!confirmed)throw Error('Сначала подтвердите подписанный договор в кабинете клиента');
 if(confirmed&&['new','assigned','contacted','qualified','selection','offer_sent','negotiation','contract_sent','rejected','duplicate','spam'].includes(status))throw Error('По заявке подтверждён договор. Обратитесь в АвтоЦену');
 if(['rejected','duplicate','spam'].includes(status)&&!note)throw Error('Укажите причину');
 }
 const archive=typeof b.archived==='boolean'&&b.archived!==!!l.archivedAt;
 if(archive&&(!owner||!note))throw Error('Для архива требуется владелец компании и причина');
 return {...l,status,assignedManagerId:managerId,updatedAt:now.toISOString(),...(archive?{archivedAt:b.archived?now.toISOString():'',archiveReason:b.archived?note:'',archivedByUserId:u.id}:{}),...(note?{dealerInternalNotes:[...(l.dealerInternalNotes||[]),{id:randomUUID(),text:note,createdAt:now.toISOString(),createdByUserId:u.id,createdByName:u.displayName}]}:{}),dealerWorkflowHistory:[...(l.dealerWorkflowHistory||[]),{action:'update',status,managerId,note,actorId:u.id,at:now.toISOString()}]};
}
