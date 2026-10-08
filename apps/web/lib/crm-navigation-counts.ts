import {createHash} from 'node:crypto';
import type {AuthUser} from './auth';
import {hasCrmPermission,type CrmPermission} from './crm-permissions';
import {isPlatformTeam} from './platform-access';
import {readCrmActivity,type CrmActivity} from './crm-activity';
import {readNotifications} from './crm-unified-notifications';
import {listIdeas} from './team-ideas';
import {readDataJson,mutateDataJson} from './data';

export const CRM_SECTIONS=['/crm','/crm/chat','/crm/leads','/crm/clients','/crm/managers','/crm/settings','/crm/dealers','/crm/documents','/crm/site','/crm/reviews','/crm/ideas'] as const;
const gates:Record<string,CrmPermission>={'/crm/chat':'chat','/crm/settings':'settings','/crm/dealers':'dealers','/crm/documents':'documents','/crm/site':'site'};
export function navigationSection(event:Pick<CrmActivity,'type'|'entityType'|'href'>):string{
 if(event.entityType==='document'||event.type.startsWith('document_'))return '/crm/documents';
 if(event.entityType==='review'||event.type.includes('review'))return '/crm/reviews';
 if(event.entityType==='staff'||event.type.startsWith('staff_'))return '/crm/managers';
 if(event.entityType==='dealer'||event.type.startsWith('dealer_'))return '/crm/dealers';
 const path=(event.href||'').split(/[?#]/)[0];
 const match=CRM_SECTIONS.filter(s=>s!=='/crm').find(s=>path===s||path.startsWith(s+'/'));
 if(match)return match;
 if(event.entityType==='account'||event.type.startsWith('customer_')||event.type.startsWith('client_'))return '/crm/clients';
 if(event.type.startsWith('lead_'))return '/crm/leads';
 return '/crm';
}
const receiptKey=(userId:string)=>`crm/navigation-read/${createHash('sha256').update(userId).digest('hex')}.json`;
const cache=new Map<string,{until:number;promise:ReturnType<typeof sources>}>();
async function sources(user:AuthUser){
 const through=new Date().toISOString();
 const [events,notifications,ideas]=await Promise.all([readCrmActivity(user,500),readNotifications(user),listIdeas(user)]);
 return {through,events,notifications:notifications.notifications,ideas};
}
export async function navigationCounts(user:AuthUser){
 if(!isPlatformTeam(user))throw Error('forbidden');
 const key=JSON.stringify([user.id,user.role,user.permissions]);let entry=cache.get(key);
 if(!entry||entry.until<Date.now()){
  if(cache.size>100)cache.clear();entry={until:Date.now()+45000,promise:sources(user)};cache.set(key,entry);
  entry.promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
 }
 const [data,seen]=await Promise.all([entry.promise,readDataJson<Record<string,string>>(receiptKey(user.id),{})]);
 const counts:Record<string,number>={};for(const section of CRM_SECTIONS)if(!gates[section]||hasCrmPermission(user,gates[section]))counts[section]=0;
 const baseline=new Date(Date.now()-30*86400000).toISOString();
 const add=(section:string,at:string)=>{if(section in counts&&at>(seen[section]||baseline)&&at<=data.through)counts[section]++;};
 for(const event of data.events){if(event.actor?.id===user.id)continue;const section=navigationSection(event);add(section,event.createdAt);if(section!=='/crm')add('/crm',event.createdAt);}
 for(const notice of data.notifications)if(notice.unread&&navigationSection({type:'',href:notice.href})==='/crm/chat')add('/crm/chat',notice.createdAt);
 for(const idea of data.ideas){
  if(idea.authorId!==user.id)add('/crm/ideas',idea.createdAt);
  if(idea.updatedAt!==idea.createdAt&&idea.lastActorId!==user.id)add('/crm/ideas',idea.updatedAt);
  for(const comment of idea.comments||[])if(comment.authorId!==user.id)add('/crm/ideas',comment.createdAt);
 }
 return {counts,through:data.through};
}
export async function markNavigationSeen(user:AuthUser,section:string,through:string){
 if(!isPlatformTeam(user)||!CRM_SECTIONS.includes(section as any)||gates[section]&&!hasCrmPermission(user,gates[section]))throw Error('forbidden');
 const at=Date.parse(through);if(!Number.isFinite(at)||at>Date.now()||at<Date.now()-86400000)throw Error('invalid_date');
 const normalized=new Date(at).toISOString();
 await mutateDataJson<Record<string,string>>(receiptKey(user.id),{},rows=>({...rows,[section]:rows[section]>normalized?rows[section]:normalized}));
}
