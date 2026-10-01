import type {AuthUser} from './auth';
import {isCrmRole} from './auth';
import {canSeeLead} from './crm-visibility';
import {hasCrmPermission} from './crm-permissions';
import {readCrmUsers} from './crm-users';
import {readChunkedDataJson,updateChunkedDataJson} from './data';
import {recordCrmActivity} from './crm-activity';
import {notifyTeam} from './crm-notification-store';
import {discussionMessages,discussionLabel,discussionHref,type DiscussionType,type DiscussionMessage} from './crm-discussion';
const file=(type:DiscussionType)=>type==='lead'?'leads/leads.json':'clients/clients.json';
export async function discussionEntity(user:AuthUser,type:DiscussionType,id:string){
 if(!isCrmRole(user.role)||user.status==='disabled'||!['lead','client'].includes(type)||typeof id!=='string'||!id||id.length>180)throw Error('discussion_forbidden');
 const entity=(await readChunkedDataJson<any>(file(type),[])).find(e=>e.id===id);
 if(!entity||!canSeeLead(user,entity))throw Error('discussion_forbidden');return entity;
}
export async function notifyDiscussion(user:AuthUser,type:DiscussionType,entity:any,note:DiscussionMessage){
 const users=await readCrmUsers();
 const recipientIds=users.filter(u=>u.id!==user.id&&isCrmRole(u.role)&&canSeeLead(u,entity)&&(!user.companyId||u.companyId===user.companyId)).map(u=>u.id);
 await notifyTeam({id:`comment_${type}_${entity.id}_${note.id}`,createdAt:note.createdAt,entityType:type,entityId:entity.id,recipientIds,kind:'comment',title:`${user.displayName} написал(а) · ${discussionLabel(type,entity)}`,text:note.text.slice(0,500),href:discussionHref(type,entity.id,note.id)});
}
export async function readDiscussion(user:AuthUser,type:DiscussionType,id:string){
 const entity=await discussionEntity(user,type,id),users=await readCrmUsers();
 return {label:discussionLabel(type,entity),canReply:hasCrmPermission(user,type==='lead'?'editLeads':'editClients'),userId:user.id,messages:discussionMessages(entity).map(n=>({...n,avatarUrl:users.find(u=>u.id===n.createdByUserId)?.avatarUrl})),noticeIds:discussionMessages(entity).filter(n=>n.createdByUserId!==user.id).map(n=>`comment_${type}_${id}_${n.id}`)};
}
export async function addDiscussionMessage(user:AuthUser,type:DiscussionType,id:string,input:any){
 await discussionEntity(user,type,id);
 if(!hasCrmPermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
 const text=typeof input.text==='string'?input.text.trim():'';
 if(!text||text.length>2000||typeof input.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId))throw Error('invalid_message');
 const note:DiscussionMessage={id:`message-${user.id}-${input.operationId}`,text,createdAt:new Date().toISOString(),createdByUserId:user.id,createdByName:user.displayName};
 let added=false;
 const entity=await updateChunkedDataJson<any>(file(type),id,current=>{
  added=false;if(!canSeeLead(user,current))throw Error('discussion_forbidden');
  const messages=discussionMessages(current),existing=messages.find(n=>n.id===note.id);
  if(existing){if(existing.text!==text)throw Error('message_conflict');return current;}
  if(input.replyTo){if(typeof input.replyTo!=='string'||!messages.some(n=>n.id===input.replyTo))throw Error('invalid_reply');note.replyTo=input.replyTo;}
  added=true;return {...current,updatedAt:note.createdAt,internalNotes:[...(current.internalNotes||[]),note]};
 });
 if(!entity)throw Error('discussion_forbidden');
 if(added){await recordCrmActivity(user,{type:type==='lead'?'lead_note_added':'client_note_added',title:'Сообщение в обсуждении команды',entityType:type,entityId:id,entityLabel:discussionLabel(type,entity),leadId:type==='lead'?id:undefined,clientId:type==='client'?id:entity.clientId,commentId:note.id,text,href:discussionHref(type,id,note.id)});await notifyDiscussion(user,type,entity,note);}
 return readDiscussion(user,type,id);
}

export async function editDiscussionMessage(user:AuthUser,type:DiscussionType,id:string,input:any){
 await discussionEntity(user,type,id);
 if(!hasCrmPermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
 const text=typeof input.text==='string'?input.text.trim():'';
 if(!text||text.length>2000||typeof input.messageId!=='string'||input.messageId.length>240||typeof input.expectedText!=='string')throw Error('invalid_message');
 let changed=false,previous='',editedAt='';
 const entity=await updateChunkedDataJson<any>(file(type),id,current=>{
  changed=false;
  if(!canSeeLead(user,current))throw Error('discussion_forbidden');
  const notes=discussionMessages(current),position=notes.findIndex(n=>n.id===input.messageId),note=notes[position];
  const originals=Array.isArray(current.internalNotes)?current.internalNotes:[];
  const index=originals.indexOf(originals.filter((n:any)=>typeof n.text==='string')[position]);
  if(!note||note.createdByUserId!==user.id)throw Error('discussion_forbidden');
  if(note.text===text)return current;
  if(note.text!==input.expectedText)throw Error('edit_conflict');
  previous=note.text;editedAt=new Date().toISOString();changed=true;
  return {...current,updatedAt:editedAt,internalNotes:current.internalNotes.map((n:any,i:number)=>i===index?{...n,id:note.id,text,editedAt}:n)};
 });
 if(!entity)throw Error('discussion_forbidden');
 if(changed)await recordCrmActivity(user,{type:type==='lead'?'lead_note_edited':'client_note_edited',title:'Исправлено сообщение в обсуждении команды',entityType:type,entityId:id,entityLabel:discussionLabel(type,entity),leadId:type==='lead'?id:undefined,clientId:type==='client'?id:entity.clientId,commentId:input.messageId,text,changes:[{label:'Сообщение',before:previous,after:text}],href:discussionHref(type,id,input.messageId)});
 return readDiscussion(user,type,id);
}
