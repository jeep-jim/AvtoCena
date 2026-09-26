import type {AuthUser} from './auth';
import {appendChunkedDataJson,generateId,readChunkedDataJson,readRecentChunkedDataJson} from './data';
import {hasCrmPermission} from './crm-permissions';
import {canSeeLead} from './crm-visibility';
import {readCrmUsers} from './crm-users';
import {leadStatusLabel} from './crm';
export type ActivityPerson={id:string;name:string;avatarUrl?:string};
export type ActivityChange={label:string;before?:string;after?:string};
export type CrmActivity={id:string;createdAt:string;type:string;title:string;actor?:ActivityPerson;target?:ActivityPerson;entityType?:string;entityId?:string;entityLabel?:string;href?:string;clientId?:string;leadId?:string;changes?:ActivityChange[];text?:string;managerId?:string;managerName?:string;assignedManagerId?:string;status?:string;visibility?:'team'|'management';};
export const activityPerson=(u:Pick<AuthUser,'id'|'displayName'|'avatarUrl'>):ActivityPerson=>({id:u.id,name:u.displayName,avatarUrl:u.avatarUrl});
export async function recordCrmActivity(actor:AuthUser|null,event:Omit<CrmActivity,'id'|'createdAt'|'actor'>&Partial<Pick<CrmActivity,'id'|'createdAt'>>) {
 return appendChunkedDataJson<CrmActivity>('activity/feed.json',{...event,id:event.id||generateId('activity'),createdAt:event.createdAt||new Date().toISOString(),...(actor?{actor:activityPerson(actor)}:{})});
}
export function activityChanges(before:Record<string,any>,after:Record<string,any>,fields:Record<string,string>):ActivityChange[]{
 return Object.entries(fields).filter(([key])=>String(before?.[key]??'')!==String(after?.[key]??'')).map(([key,label])=>({label,before:String(before?.[key]??'').slice(0,1000),after:String(after?.[key]??'').slice(0,1000)}));
}
export async function readCrmActivity(user:AuthUser,limit=30,before='') {
 const all=hasCrmPermission(user,'activityAll');
 const [users,leads,clients]=await Promise.all([readCrmUsers(),all?Promise.resolve([]):readChunkedDataJson<any>('leads/leads.json',[]),all?Promise.resolve([]):readChunkedDataJson<any>('clients/clients.json',[])]);
 const leadIds=new Set(leads.filter(x=>canSeeLead(user,x)).map(x=>x.id)),clientIds=new Set(clients.filter(x=>canSeeLead(user,x)).map(x=>x.id));
 const rows=await readRecentChunkedDataJson<CrmActivity>('activity/feed.json',limit,e=>(!before||e.createdAt<before)&&(all||(e.visibility!=='management'&&(!e.type?.startsWith('staff_'))&&(e.leadId?leadIds.has(e.leadId):e.clientId?clientIds.has(e.clientId):e.actor?.id===user.id||e.managerId===user.id))));
 return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit).map(e=>{
  const author=users.find(u=>u.id===(e.actor?.id||e.managerId));const target=users.find(u=>u.id===(e.target?.id||e.assignedManagerId));
  return {...e,actor:author?activityPerson(author):e.actor||(e.managerId?{id:e.managerId,name:e.managerName||'Сотрудник'}:undefined),target:target?activityPerson(target):e.target,href:e.href||(e.leadId?`/crm/leads?id=${encodeURIComponent(e.leadId)}`:e.clientId?`/crm/clients/${encodeURIComponent(e.clientId)}`:undefined),text:e.status&&e.text===e.status?leadStatusLabel(e.status):e.text};
 });
}
