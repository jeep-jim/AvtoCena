import {notifyTeam} from './crm-notification-store';
import type {AuthUser} from './auth';
import {appendChunkedDataJson,generateId,readChunkedDataJson,readRecentChunkedDataJson} from './data';
import {hasCrmPermission} from './crm-permissions';
import {canSeeLead} from './crm-visibility';
import {readCrmUsers} from './crm-users';
import {leadStatusLabel} from './crm';
export type ActivityPerson={id:string;name:string;avatarUrl?:string};
export type ActivityChange={label:string;before?:string;after?:string};
export type CrmActivity={id:string;createdAt:string;type:string;title:string;actor?:ActivityPerson;target?:ActivityPerson;entityType?:string;entityId?:string;entityLabel?:string;href?:string;clientId?:string;leadId?:string;changes?:ActivityChange[];text?:string;managerId?:string;managerName?:string;assignedManagerId?:string;status?:string;visibility?:'team'|'management';image?:string;currentStatus?:string;summary?:string;};
export const activityPerson=(u:Pick<AuthUser,'id'|'displayName'|'avatarUrl'>):ActivityPerson=>({id:u.id,name:u.displayName,avatarUrl:u.avatarUrl});
export async function recordCrmActivity(actor:AuthUser|null,event:Omit<CrmActivity,'id'|'createdAt'|'actor'>&Partial<Pick<CrmActivity,'id'|'createdAt'>>) {
 const recorded=await appendChunkedDataJson<CrmActivity>('activity/feed.json',{...event,id:event.id||generateId('activity'),createdAt:event.createdAt||new Date().toISOString(),...(actor?{actor:activityPerson(actor)}:{})});
 if(actor&&event.target?.id&&event.target.id!==actor.id&&['client_assigned','staff_updated','staff_created'].includes(event.type))await notifyTeam({recipientIds:[event.target.id],kind:event.type==='client_assigned'?'assignment':'staff',title:event.title,text:`${actor.displayName}${event.entityLabel?` · ${event.entityLabel}`:''}`,href:event.href||(event.clientId?`/crm/clients/${encodeURIComponent(event.clientId)}`:'/crm/managers')});
 return recorded;
}
export function activityChanges(before:Record<string,any>,after:Record<string,any>,fields:Record<string,string>):ActivityChange[]{
 return Object.entries(fields).filter(([key])=>String(before?.[key]??'')!==String(after?.[key]??'')).map(([key,label])=>({label,before:String(before?.[key]??'').slice(0,1000),after:String(after?.[key]??'').slice(0,1000)}));
}
export async function readCrmActivity(user:AuthUser,limit=30,before='') {
 const all=hasCrmPermission(user,'activityAll');
 const [users,leads,clients]=await Promise.all([readCrmUsers(),readChunkedDataJson<any>('leads/leads.json',[]),readChunkedDataJson<any>('clients/clients.json',[])]);
 const leadIds=new Set(leads.filter(x=>canSeeLead(user,x)).map(x=>x.id)),clientIds=new Set(clients.filter(x=>canSeeLead(user,x)).map(x=>x.id));
 const rows=await readRecentChunkedDataJson<CrmActivity>('activity/feed.json',limit,e=>(!before||e.createdAt<before)&&(all||(e.visibility!=='management'&&(!e.type?.startsWith('staff_'))&&(e.leadId?leadIds.has(e.leadId):e.clientId?clientIds.has(e.clientId):e.actor?.id===user.id||e.managerId===user.id))));
 return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map(e=>{
  const author=users.find(u=>u.id===(e.actor?.id||e.managerId)),targetUser=users.find(u=>u.id===(e.target?.id||e.assignedManagerId));
  const actor=author?activityPerson(author):e.actor||(e.managerId?{id:e.managerId,name:e.managerName||'Сотрудник'}:undefined);
  const lead=leads.find(l=>l.id===(e.leadId||(e.entityType==='lead'?e.entityId:''))),client=clients.find(c=>c.id===(e.clientId||(e.entityType==='client'?e.entityId:'')));
  let changes=e.changes||[],title=e.title;
  const statusEvent=/status/.test(e.type)||/статус заявки/i.test(e.title),assignment=/assign/.test(e.type)||/назначен менеджер/i.test(e.title);
  if(statusEvent&&!changes.some(c=>c.label==='Статус')){
   const history=Array.isArray(lead?.statusHistory)?lead.statusHistory:[],index=history.findIndex((h:any)=>h.changedAt===e.createdAt);
   const after=index>=0?history[index].status:e.status;
   if(after)changes=[...changes,{label:'Статус',...(index>0?{before:leadStatusLabel(history[index-1].status)}:{}),after:leadStatusLabel(after)}];
  }
  const status=changes.find(c=>c.label==='Статус'),assigned=changes.find(c=>c.label==='Ответственный');
  const target=assignment?(targetUser?activityPerson(targetUser):e.target):e.entityType==='staff'?e.target:undefined;
  if(statusEvent&&status?.after)title=`${actor?.name||'Сотрудник'} изменил статус ${e.entityType==='client'?'клиента':'заявки'}${status.before?` с «${status.before}»`:''} на «${status.after}»`;
  else if(assignment)title=`${actor?.name||'Сотрудник'} ${target?.name||assigned?.after&&assigned.after!=='Не назначен'?`назначил ${e.entityType==='client'?'клиента':'заявку'}: ${target?.name||assigned?.after}`:`снял назначение ${e.entityType==='client'?'клиента':'заявки'}`}`;
  let href=e.href;
  if(lead)href=`/crm/leads?id=${encodeURIComponent(lead.id)}${lead.archivedAt?'&view=archive':''}#${encodeURIComponent(lead.id)}`;
  else if(e.leadId)href=`/crm/leads?id=${encodeURIComponent(e.leadId)}#${encodeURIComponent(e.leadId)}`;
  else if(e.clientId||e.entityType==='client')href=`/crm/clients/${encodeURIComponent(e.clientId||e.entityId||'')}`;
  if(e.entityType==='document'&&e.clientId&&e.entityId)href=`/crm/clients/${encodeURIComponent(e.clientId)}?document=${encodeURIComponent(e.entityId)}#document-${encodeURIComponent(e.entityId)}`;
  const car=lead?.selectedOffers?.[0];
  const image=e.type==='lead_created'?String(car?.image||lead?.image||lead?.offerImage||''):undefined;
  return {...e,title,actor,target,changes,href,entityLabel:e.entityLabel||[lead?.name,car?.title||lead?.car].filter(Boolean).join(' · ')||client?.fio,image:image&&/^(https?:\/\/|\/(?!\/))/.test(image)?image:undefined,currentStatus:lead?leadStatusLabel(lead.status):undefined,text:e.status&&e.text===e.status?leadStatusLabel(e.status):e.text};
 });
}
