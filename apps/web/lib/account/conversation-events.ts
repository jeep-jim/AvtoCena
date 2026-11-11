import {sharedCustomerDocuments} from './access';
import {leadStatusLabel} from '../crm';
export type CustomerEvent={id:string;text:string;author:string;createdAt:string;system:true;eventKind:string;leadId?:string;documentId?:string};
const event=(id:string,text:string,createdAt:string,eventKind:string,leadId?:string):CustomerEvent=>({id,text,createdAt,eventKind,leadId,author:'Оповещение',system:true});
/** Only customer-visible changes. Internal notes, partner accounting and team discussions never enter this list. */
export function leadCustomerEvents(lead:any,previous:any,managerName?:string):CustomerEvent[]{
 const at=lead.updatedAt||lead.createdAt,title=lead.offerTitle||lead.car||'Заявка',prefix=`lead:${lead.id}:${at}`;
 const result:CustomerEvent[]=[];
 if(previous.status!==lead.status)result.push(event(`${prefix}:status`,`${title}: ${leadStatusLabel(lead.status)}.`,at,'status',lead.id));
 if(previous.assignedManagerId!==lead.assignedManagerId)result.push(event(`${prefix}:manager`,managerName?`${title}: вам назначен менеджер ${managerName}. Напишите ему в этом чате.`:`${title}: менеджер пока не назначен. Компания продолжает работу с вашей заявкой.`,at,'manager',lead.id));
 if(!!previous.archivedAt!==!!lead.archivedAt)result.push(event(`${prefix}:archive`,`${title}: ${lead.archivedAt?'заявка перенесена в архив':'заявка восстановлена'}.`,at,'archive',lead.id));
 return result;
}
/** Read-only projection of existing records: no writes or background scans on opening a chat. */
export function customerConversation(thread:any[],client:any,leads:any[],users:any[]){
 const messages=[...thread];
 for(const lead of leads){
  if(!messages.some(m=>m.system&&m.leadId===lead.id&&m.eventKind==='status'))messages.push(event(`lead:${lead.id}:current-status`,`${lead.offerTitle||lead.car||'Заявка'}: ${leadStatusLabel(lead.status)}.`,lead.updatedAt||lead.createdAt,'status',lead.id));
  const manager=users.find(u=>u.id===(lead.assignedManagerId||client.assignedManagerId)&&u.status!=='disabled');
  if(manager&&!messages.some(m=>m.system&&m.leadId===lead.id&&m.eventKind==='manager'))messages.push(event(`lead:${lead.id}:current-manager:${manager.id}`,`Ваш менеджер по заявке «${lead.offerTitle||lead.car||'Подбор автомобиля'}» — ${manager.displayName}. Вы можете написать ему здесь.`,lead.updatedAt||lead.createdAt,'manager',lead.id));
 }
 for(const doc of sharedCustomerDocuments(client))messages.push({...event(`document:${doc.id}`,`Добавлен документ: ${doc.name}`,doc.createdAt,'document'),documentId:doc.id});
 for(const [leadId,c] of Object.entries(client.portalContracts||{}) as [string,any][]){
  if(c.revokedAt||!leads.some(l=>l.id===leadId)||!sharedCustomerDocuments(client).some((d:any)=>d.id===c.documentId))continue;
  messages.push({...event(`contract:${leadId}:${c.customerConfirmedAt||c.confirmedAt}`,c.requiresCustomerConfirmation&&!c.customerConfirmedAt?'Менеджер отметил договор как подписанный. Проверьте документ и подтвердите его в разделе «Документы».':'Подписанный договор подтверждён.',c.customerConfirmedAt||c.confirmedAt,'contract',leadId),documentId:c.documentId});
 }
 return [...new Map(messages.filter(m=>m.createdAt&&Number.isFinite(Date.parse(m.createdAt))).map(m=>[m.id,m])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
