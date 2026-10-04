import {createHash} from 'node:crypto';
import type {AuthUser} from './auth';
import {isPlatformTeam} from './platform-access';
import {canSeeLead} from './crm-visibility';
import {hasCrmPermission} from './crm-permissions';
import {readCrmUsers} from './crm-users';
import {readDataJson,mutateDataJson,readChunkedDataJson,appendChunkedDataJson,readRecentChunkedDataJson} from './data';
import {readNotifications} from './crm-unified-notifications';
import {notifyTeam} from './crm-notification-store';
import {enqueueMessage} from './crm-notifications';
import {leadDealerId} from './dealers/telegram-settings';
export type ChatThread={id:string;kind:'system'|'lead'|'team';title:string;subtitle:string;avatar?:string;updatedAt:string};
export type ChatMessage={id:string;text:string;createdAt:string;author:string;mine:boolean;status?:string;href?:string;unread?:boolean};
type DirectThread={id:string;participants:string[];createdAt:string;updatedAt:string};
const index='crm/chat/threads.json';
const messageFile=(id:string)=>`crm/chat/messages/${id}.json`;
function allowed(user:AuthUser){if(!isPlatformTeam(user))throw Error('chat_forbidden');}
export function directChatId(a:string,b:string){return `team_${createHash('sha256').update(JSON.stringify([a,b].sort())).digest('hex')}`;}
export function chatInput(input:any){const text=typeof input.text==='string'?input.text.trim():'';if(!text||text.length>3000||typeof input.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId))throw Error('invalid_message');return text;}
async function leadFor(user:AuthUser,id:string){const lead=(await readChunkedDataJson<any>('leads/leads.json',[])).find(l=>`lead:${l.id}`===id);if(!lead||!canSeeLead(user,lead))throw Error('chat_forbidden');return lead;}
async function teamFor(user:AuthUser,id:string){const rows=await readDataJson<DirectThread[]>(index,[]),row=rows.find(t=>t.id===id&&t.participants.includes(user.id));if(!row||!/^team_[a-f0-9]{64}$/.test(id))throw Error('chat_forbidden');const users=await readCrmUsers();if(!row.participants.every(id=>users.some(u=>u.id===id&&isPlatformTeam(u))))throw Error('chat_forbidden');return {row,users};}
export async function chatList(user:AuthUser){
 allowed(user);
 const [leads,users,direct,notices]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readCrmUsers(),readDataJson<DirectThread[]>(index,[]),readNotifications(user)]);
 const team=users.filter(u=>isPlatformTeam(u)&&u.id!==user.id).map(u=>({id:u.id,name:u.displayName,avatar:u.avatarUrl}));
 const threads:ChatThread[]=[{id:'notifications',kind:'system',title:'Уведомления',subtitle:`Непрочитанных: ${notices.notifications.filter(n=>n.unread).length}`,updatedAt:notices.notifications[0]?.createdAt||''}];
 const conversations:ChatThread[]=direct.filter(t=>t.participants.includes(user.id)&&t.participants.every(id=>users.some(u=>u.id===id&&isPlatformTeam(u)))).map(t=>{const other=team.find(u=>t.participants.includes(u.id));return {id:t.id,kind:'team',title:other?.name||'Сотрудник',avatar:other?.avatar,subtitle:'Команда · личная переписка',updatedAt:t.updatedAt};});
 for(const l of leads.filter(l=>canSeeLead(user,l)&&!l.archivedAt).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).slice(0,200))conversations.push({id:`lead:${l.id}`,kind:'lead',title:l.name||l.telegramDisplayName||'Клиент',subtitle:[leadDealerId(l)!=='dealer_topavto'?l.requestedDealerName||'Дилер':'ТопАвто',l.car||l.offerTitle||'Заявка'].join(' · '),updatedAt:l.updatedAt||l.createdAt||''});
 return {userId:user.id,threads:[...threads,...conversations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))],team};
}
export async function chatDetail(user:AuthUser,id:string){
 allowed(user);
 if(id==='notifications'){const {notifications}=await readNotifications(user);return {id,kind:'system',title:'Уведомления',canSend:false,messages:notifications.slice().reverse().map(n=>({id:n.id,text:`${n.title}\n${n.text}`,createdAt:n.createdAt,author:'Уведомления',mine:false,href:n.href,unread:n.unread})),info:'Системные события, напоминания и уведомления команды.',media:[]};}
 if(id.startsWith('lead:')){
  const lead=await leadFor(user,id);
  const [messages,queue]=await Promise.all([readRecentChunkedDataJson<any>('telegram/crm-messages.json',200,m=>m.leadId===lead.id),readRecentChunkedDataJson<any>('telegram/crm-outbox.json',200,m=>m.leadId===lead.id&&m.audience==='customer')]);
  const ours=leadDealerId(lead)==='dealer_topavto';
  const canSend=ours&&!lead.archivedAt&&!!lead.telegramChatId&&hasCrmPermission(user,'editLeads');
  const offers=lead.selectedOffers?.length?lead.selectedOffers:lead.offerSnapshot?[lead.offerSnapshot]:[];
  const media=offers.filter((o:any)=>typeof o.image==='string'&&(/^(https?:\/\/|\/(?!\/))/.test(o.image))).map((o:any)=>({url:o.image,title:o.title||'Автомобиль'}));
  return {id,kind:'lead',title:lead.name||lead.telegramDisplayName||'Клиент',leadId:lead.id,canDiscuss:hasCrmPermission(user,'editLeads'),canSend,messages:messages.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(m=>({id:m.id,text:m.text,createdAt:m.createdAt,author:m.direction==='in'?'Клиент':m.managerName||'Менеджер',mine:m.direction==='out',status:m.direction==='out'?(queue.find(q=>q.id===m.id)?.status||'saved'):undefined})),info:[lead.phone,lead.telegram,lead.city,lead.car,lead.requestedDealerName].filter(Boolean).join('\n'),media,href:`/crm/leads?id=${encodeURIComponent(lead.id)}`,reason:canSend?'':!ours?'Переписку с этим клиентом ведёт дилер.':lead.archivedAt?'Заявка в архиве.':!lead.telegramChatId?'Клиент ещё не подключил Telegram к заявке.':'Нет права отправлять сообщения клиенту.'};
 }
 const {row,users}=await teamFor(user,id),other=users.find(u=>u.id!==user.id&&row.participants.includes(u.id));
 const messages=await readRecentChunkedDataJson<any>(messageFile(id),200);
 return {id,kind:'team',title:other?.displayName||'Сотрудник',canSend:true,messages:messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(m=>({id:m.id,text:m.text,createdAt:m.createdAt,author:m.author,mine:m.userId===user.id})),info:'Личная переписка сотрудников. Клиенты её не видят.',media:[]};
}
export async function createDirectChat(user:AuthUser,recipientId:string){
 allowed(user);const users=await readCrmUsers();if(recipientId===user.id||!users.some(u=>u.id===recipientId&&isPlatformTeam(u)))throw Error('chat_forbidden');
 const id=directChatId(user.id,recipientId),now=new Date().toISOString();await mutateDataJson<DirectThread[]>(index,[],rows=>rows.some(t=>t.id===id)?rows:[...rows,{id,participants:[user.id,recipientId],createdAt:now,updatedAt:now}]);return {id};
}
export async function sendChatMessage(user:AuthUser,id:string,input:any){
 allowed(user);const text=chatInput(input),now=new Date().toISOString();
 const messageId=`chat_${createHash('sha256').update(JSON.stringify([user.id,id,input.operationId])).digest('hex')}`;
 if(id.startsWith('lead:')){
  const lead=await leadFor(user,id);
  if(lead.archivedAt||!lead.telegramChatId||!hasCrmPermission(user,'editLeads')||leadDealerId(lead)!=='dealer_topavto')throw Error('chat_forbidden');
  // Save the exact body first. Retried requests recover the same queued message, never duplicate it.
  const saved=await appendChunkedDataJson<any>('telegram/crm-messages.json',{id:messageId,leadId:lead.id,direction:'out',text,createdAt:now,managerId:user.id,managerName:user.displayName});
  if(saved.text!==text)throw Error('message_conflict');
  await enqueueMessage({id:messageId,chatId:String(lead.telegramChatId),text:`Менеджер АвтоЦены · ${user.displayName}\n\n${saved.text}`,leadId:lead.id,audience:'customer'});
 }else{
  const {row}=await teamFor(user,id);
  const saved=await appendChunkedDataJson<any>(messageFile(id),{id:messageId,text,createdAt:now,userId:user.id,author:user.displayName});if(saved.text!==text)throw Error('message_conflict');
  await mutateDataJson<DirectThread[]>(index,[],rows=>rows.map(t=>t.id===id?{...t,updatedAt:saved.createdAt>t.updatedAt?saved.createdAt:t.updatedAt}:t));
  await notifyTeam({id:messageId,createdAt:saved.createdAt,recipientIds:row.participants.filter(p=>p!==user.id),kind:'staff',title:`Сообщение от ${user.displayName}`,text:saved.text.slice(0,500),href:`/crm/chat?thread=${encodeURIComponent(id)}`});
 }
 return chatDetail(user,id);
}
