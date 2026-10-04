import {GENERAL_CHAT_ID,CHAT_EMOJI} from './chat-emoji';
import {createHash} from 'node:crypto';
import type {AuthUser} from './auth';
import {isPlatformTeam} from './platform-access';
import {canSeeLead} from './crm-visibility';
import {hasCrmPermission} from './crm-permissions';
import {readCrmUsers} from './crm-users';
import {readDataJson,mutateDataJson,readChunkedDataJson,appendChunkedDataJson,readRecentChunkedDataJson,updateChunkedDataJson} from './data';
import {readNotifications} from './crm-unified-notifications';
import {notifyTeam} from './crm-notification-store';
import {enqueueMessage} from './crm-notifications';
import {leadDealerId} from './dealers/telegram-settings';
export type ChatThread={id:string;kind:'system'|'lead'|'team'|'room';title:string;subtitle:string;avatar?:string;updatedAt:string};
export type ChatMessage={id:string;text:string;createdAt:string;author:string;authorId?:string;mine:boolean;version?:number;editedAt?:string;deleted?:boolean;replyTo?:{id:string;text:string;author:string};forwarded?:{author:string;from:string};status?:string;href?:string;unread?:boolean;reactions?:{emoji:string;count:number;mine:boolean;names:string[]}[]};
type DirectThread={id:string;participants:string[];createdAt:string;updatedAt:string;title?:string;creatorId?:string;version?:number};
const index='crm/chat/threads.json';
const messageFile=(id:string)=>`crm/chat/messages/${id}.json`;
function allowed(user:AuthUser){if(!isPlatformTeam(user))throw Error('chat_forbidden');}
export function directChatId(a:string,b:string){return `team_${createHash('sha256').update(JSON.stringify([a,b].sort())).digest('hex')}`;}
export function chatInput(input:any){const text=typeof input.text==='string'?input.text.trim():'';if(!text||text.length>3000||typeof input.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId))throw Error('invalid_message');return text;}
async function leadFor(user:AuthUser,id:string){const lead=(await readChunkedDataJson<any>('leads/leads.json',[])).find(l=>`lead:${l.id}`===id);if(!lead||!canSeeLead(user,lead))throw Error('chat_forbidden');return lead;}
async function teamFor(user:AuthUser,id:string){
 const users=await readCrmUsers(),active=users.filter(isPlatformTeam);
 if(!active.some(u=>u.id===user.id))throw Error('chat_forbidden');
 if(id===GENERAL_CHAT_ID)return {row:{id,participants:active.map(u=>u.id),title:'Общий чат команды',createdAt:'',updatedAt:''} as DirectThread,users};
 const rows=await readDataJson<DirectThread[]>(index,[]),row=rows.find(t=>t.id===id&&t.participants.includes(user.id));
 if(!row||!/^team_[a-f0-9]{64}$/.test(id)||(!row.title&&!row.participants.every(id=>active.some(u=>u.id===id))))throw Error('chat_forbidden');
 return {row,users};
}
const reactionFile=(id:string)=>`crm/chat/reactions/${createHash('sha256').update(id).digest('hex')}.json`;
type ReactionStore=Record<string,Record<string,string[]>>;
async function withReactions(user:AuthUser,id:string,messages:any[],users:AuthUser[]){
 const data=await readDataJson<ReactionStore>(reactionFile(id),{});
 return messages.map(m=>({...m,reactions:Object.entries(m.deleted?{}:data[m.id]||{}).map(([emoji,ids])=>({emoji,count:ids.length,mine:ids.includes(user.id),names:ids.map(id=>users.find(u=>u.id===id)?.displayName||'Сотрудник')})).filter(r=>r.count)}));
}
function roomMembers(ids:unknown,users:AuthUser[],self:string){
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!users.some(u=>u.id===id&&isPlatformTeam(u))))throw Error('invalid_members');
 return [...new Set([self,...ids])] as string[];
}
function managesRoom(user:AuthUser,row:DirectThread){return !!row.title&&row.id!==GENERAL_CHAT_ID&&(row.creatorId===user.id||user.role==='owner');}
export async function createChatRoom(user:AuthUser,input:any){
 allowed(user);const title=typeof input.title==='string'?input.title.trim():'';
 if(!title||title.length>80)throw Error('invalid_room');chatInput({text:title,operationId:input.operationId});
 const users=await readCrmUsers();if(!users.some(u=>u.id===user.id&&isPlatformTeam(u)))throw Error('chat_forbidden');
 const participants=roomMembers(input.participants,users,user.id),id=directChatId(user.id,`room:${input.operationId}`),now=new Date().toISOString();
 await mutateDataJson<DirectThread[]>(index,[],rows=>{const old=rows.find(t=>t.id===id);if(old){if(old.title!==title||JSON.stringify(old.participants)!==JSON.stringify(participants))throw Error('message_conflict');return rows;}return [...rows,{id,title,creatorId:user.id,participants,version:1,createdAt:now,updatedAt:now}];});return {id};
}
export async function updateChatRoom(user:AuthUser,id:string,input:any){
 allowed(user);const {row,users}=await teamFor(user,id);if(!managesRoom(user,row))throw Error('chat_forbidden');
 const participants=roomMembers(input.participants,users,row.creatorId!);if(!participants.includes(user.id))throw Error('invalid_members');
 await mutateDataJson<DirectThread[]>(index,[],rows=>rows.map(t=>{if(t.id!==id)return t;if(!t.participants.includes(user.id)||!managesRoom(user,t))throw Error('chat_forbidden');if(t.version!==input.version)throw Error('room_conflict');return {...t,participants,version:(t.version||1)+1};}));return chatDetail(user,id);
}
export async function reactToChatMessage(user:AuthUser,id:string,input:any){
 allowed(user);if(!CHAT_EMOJI.includes(input.emoji)||typeof input.active!=='boolean')throw Error('invalid_reaction');
 const detail=await chatDetail(user,id);if(detail.kind==='system'||!detail.messages.some(m=>m.id===input.messageId&&!m.deleted))throw Error('chat_forbidden');
 await mutateDataJson<ReactionStore>(reactionFile(id),{},data=>{const row={...(data[input.messageId]||{})},ids=new Set(row[input.emoji]||[]);if(input.active)ids.add(user.id);else ids.delete(user.id);if(ids.size)row[input.emoji]=[...ids];else delete row[input.emoji];const next={...data};if(Object.keys(row).length)next[input.messageId]=row;else delete next[input.messageId];return next;});return chatDetail(user,id);
}
export async function chatList(user:AuthUser){
 allowed(user);
 const [leads,users,direct,notices]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readCrmUsers(),readDataJson<DirectThread[]>(index,[]),readNotifications(user)]);
 const team=users.filter(u=>isPlatformTeam(u)&&u.id!==user.id).map(u=>({id:u.id,name:u.displayName,avatar:u.avatarUrl}));
 const threads:ChatThread[]=[{id:GENERAL_CHAT_ID,kind:'room',title:'Общий чат команды',subtitle:`Все сотрудники · ${team.length+1}`,updatedAt:''},{id:'notifications',kind:'system',title:'Уведомления',subtitle:`Непрочитанных: ${notices.notifications.filter(n=>n.unread).length}`,updatedAt:notices.notifications[0]?.createdAt||''}];
 const conversations:ChatThread[]=direct.filter(t=>t.participants.includes(user.id)&&(!!t.title||t.participants.every(id=>users.some(u=>u.id===id&&isPlatformTeam(u))))).map(t=>{const other=team.find(u=>t.participants.includes(u.id));return {id:t.id,kind:t.title?'room':'team',title:t.title||other?.name||'Сотрудник',avatar:t.title?undefined:other?.avatar,subtitle:t.title?`Комната · ${t.participants.filter(id=>users.some(u=>u.id===id&&isPlatformTeam(u))).length} участников`:'Команда · личная переписка',updatedAt:t.updatedAt};});
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
  return {id,kind:'lead',title:lead.name||lead.telegramDisplayName||'Клиент',leadId:lead.id,canDiscuss:hasCrmPermission(user,'editLeads'),canSend,messages:await withReactions(user,id,messages.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(m=>({id:m.id,text:m.text,createdAt:m.createdAt,author:m.direction==='in'?'Клиент':m.managerName||'Менеджер',mine:m.direction==='out',status:m.direction==='out'?(queue.find(q=>q.id===m.id)?.status||'saved'):undefined})),await readCrmUsers()),info:[lead.phone,lead.telegram,lead.city,lead.car,lead.requestedDealerName].filter(Boolean).join('\n'),media,href:`/crm/leads?id=${encodeURIComponent(lead.id)}`,reason:canSend?'':!ours?'Переписку с этим клиентом ведёт дилер.':lead.archivedAt?'Заявка в архиве.':!lead.telegramChatId?'Клиент ещё не подключил Telegram к заявке.':'Нет права отправлять сообщения клиенту.'};
 }
 const {row,users}=await teamFor(user,id),other=users.find(u=>u.id!==user.id&&row.participants.includes(u.id));
 const messages=await readRecentChunkedDataJson<any>(messageFile(id),200);
 return {id,kind:row.title?'room':'team',title:row.title||other?.displayName||'Сотрудник',canSend:true,messages:await withReactions(user,id,messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(m=>({id:m.id,createdAt:m.createdAt,author:m.author,authorId:m.userId,mine:m.userId===user.id,version:m.version||0,editedAt:m.editedAt,deleted:!!m.deletedAt,text:m.deletedAt?'Сообщение удалено':m.text,forwarded:m.deletedAt?undefined:m.forwarded,replyTo:m.deletedAt||!m.replyToId?undefined:(()=>{const original=messages.find(x=>x.id===m.replyToId);return {id:m.replyToId,text:original?.deletedAt?'Сообщение удалено':original?.text?.slice(0,300)||'Сообщение недоступно',author:original?.author||'Сотрудник'};})()})),users),info:id===GENERAL_CHAT_ID?'Общая переписка всех действующих сотрудников команды.':row.title?'Переписку видят только участники комнаты. Добавленный сотрудник получает доступ к её истории.':'Личная переписка сотрудников. Клиенты её не видят.',media:[],members:users.filter(u=>row.participants.includes(u.id)&&isPlatformTeam(u)).map(u=>({id:u.id,name:u.displayName,avatar:u.avatarUrl})),canManage:managesRoom(user,row),version:row.version||0,creatorId:row.creatorId};
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
  const {row,users}=await teamFor(user,id);
  if(input.replyToId){const original=(await readRecentChunkedDataJson<any>(messageFile(id),200)).find(m=>m.id===input.replyToId&&!m.deletedAt);if(!original)throw Error('invalid_reply');}
  let forwarded: {author:string;from:string}|undefined;
  if(input.forwardFrom){const source=await chatDetail(user,String(input.forwardFrom.thread)),original=source.messages.find(m=>m.id===input.forwardFrom.messageId);if(!original||original.deleted||source.kind==='system'||original.text!==text)throw Error('chat_forbidden');forwarded={author:original.author,from:source.title};}
  const saved=await appendChunkedDataJson<any>(messageFile(id),{id:messageId,text,createdAt:now,userId:user.id,author:user.displayName,replyToId:input.replyToId||undefined,forwarded,version:0});if(saved.text!==text||saved.replyToId!==(input.replyToId||undefined)||JSON.stringify(saved.forwarded)!==JSON.stringify(forwarded))throw Error('message_conflict');
  await mutateDataJson<DirectThread[]>(index,[],rows=>rows.map(t=>t.id===id?{...t,updatedAt:saved.createdAt>t.updatedAt?saved.createdAt:t.updatedAt}:t));
  await notifyTeam({id:messageId,createdAt:saved.createdAt,recipientIds:row.participants.filter(p=>p!==user.id&&users.some(u=>u.id===p&&isPlatformTeam(u))),kind:'staff',title:`Сообщение от ${user.displayName}`,text:saved.text.slice(0,500),href:`/crm/chat?thread=${encodeURIComponent(id)}`});
 }
 return chatDetail(user,id);
}

export async function changeChatMessage(user:AuthUser,id:string,input:any){
 allowed(user);await teamFor(user,id);
 const deleting=input.action==='delete',text=deleting?'':chatInput(input);
 const result=await updateChunkedDataJson<any>(messageFile(id),String(input.messageId||''),m=>{
  if(m.userId!==user.id)throw Error('chat_forbidden');
  if(m.deletedAt){if(deleting)return m;throw Error('message_conflict');}
  if(!deleting&&m.lastMutation===input.operationId){if(m.text!==text)throw Error('message_conflict');return m;}
  if((m.version||0)!==input.version)throw Error('message_conflict');
  return {...m,text,version:(m.version||0)+1,lastMutation:input.operationId,editedAt:deleting?m.editedAt:new Date().toISOString(),deletedAt:deleting?new Date().toISOString():undefined,forwarded:deleting?undefined:m.forwarded,replyToId:deleting?undefined:m.replyToId};
 });
 if(!result)throw Error('chat_forbidden');return chatDetail(user,id);
}
export async function forwardChatMessage(user:AuthUser,id:string,input:any){
 allowed(user);await teamFor(user,id);
 const source=await chatDetail(user,String(input.sourceThread||'')),message=source.messages.find(m=>m.id===input.messageId);
 if(!message||message.deleted||source.kind==='system')throw Error('chat_forbidden');
 return sendChatMessage(user,id,{text:message.text,operationId:input.operationId,forwardFrom:{thread:source.id,messageId:message.id}});
}
