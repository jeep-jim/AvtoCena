import {assertWorkspace} from './crm-workspace-access';
import {dealerClientReady,readyDealerClients} from './dealers/client-workflow';
import {isDealerWorkspace,sameWorkspace,workspacePermission,workspaceCanSee,workspaceHref} from './crm-workspace';
import {workspaceClientsPath} from './document-workspace';
import type {AuthUser} from './auth';
import {isCrmRole} from './auth';
import {canSeeLead} from './crm-visibility';
import {hasCrmPermission} from './crm-permissions';
import {readCrmUsers} from './crm-users';
import {readChunkedDataJson,updateChunkedDataJson} from './data';
import {recordCrmActivity} from './crm-activity';
import {notifyTeam} from './crm-notification-store';
import {discussionMessages,discussionLabel,discussionHref,type DiscussionType,type DiscussionMessage,type DiscussionAttachment,DISCUSSION_REACTIONS} from './crm-discussion';
const file=(user:AuthUser,type:DiscussionType)=>type==='lead'?'leads/leads.json':workspaceClientsPath(user);
const project=(user:AuthUser,type:DiscussionType,entity:any)=>isDealerWorkspace(user)&&type==='lead'?{...entity,internalNotes:entity.dealerInternalNotes||[]}:entity;
async function updateDiscussionEntity(user:AuthUser,type:DiscussionType,id:string,fn:(row:any)=>any){
 return updateChunkedDataJson<any>(file(user,type),id,current=>{
  const next=fn(project(user,type,current));
  return isDealerWorkspace(user)&&type==='lead'?{...current,updatedAt:next.updatedAt,dealerInternalNotes:next.internalNotes}:next;
 }).then(row=>row?project(user,type,row):row);
}

export async function discussionEntity(user:AuthUser,type:DiscussionType,id:string){
 await assertWorkspace(user);
 if(!workspacePermission(user,'chat')||user.status==='disabled'||!['lead','client'].includes(type)||typeof id!=='string'||!id||id.length>180)throw Error('discussion_forbidden');
 const entity=(await readChunkedDataJson<any>(file(user,type),[])).find(e=>e.id===id);
 if(!entity||!workspaceCanSee(user,entity,type)||(type==='client'&&!await dealerClientReady(user,entity)))throw Error('discussion_forbidden');return project(user,type,entity);
}
export async function notifyDiscussion(user:AuthUser,type:DiscussionType,entity:any,note:DiscussionMessage){
 const users=await readCrmUsers();
 const recipientIds=users.filter(u=>u.id!==user.id&&sameWorkspace(user,u)&&workspacePermission(u,'chat')&&workspaceCanSee(u,entity,type)).map(u=>u.id);
 await notifyTeam({...(isDealerWorkspace(user)?{companyId:user.companyId}:{}),id:`comment_${type}_${entity.id}_${note.id}`,createdAt:note.createdAt,entityType:type,entityId:entity.id,recipientIds,kind:'comment',title:`${user.displayName} написал(а) · ${discussionLabel(type,entity)}`,text:note.text.slice(0,500),href:isDealerWorkspace(user)?`${workspaceHref(user,type==='lead'?'leads':'clients')}?id=${encodeURIComponent(entity.id)}`:discussionHref(type,entity.id,note.id)});
}
export async function readDiscussion(user:AuthUser,type:DiscussionType,id:string){
 const entity=await discussionEntity(user,type,id),users=await readCrmUsers();
 return {label:discussionLabel(type,entity),canReply:workspacePermission(user,type==='lead'?'editLeads':'editClients'),userId:user.id,messages:discussionMessages(entity).map(n=>({...n,avatarUrl:users.find(u=>u.id===n.createdByUserId)?.avatarUrl})),noticeIds:discussionMessages(entity).filter(n=>n.createdByUserId!==user.id).map(n=>`comment_${type}_${id}_${n.id}`)};
}
export async function addDiscussionMessage(user:AuthUser,type:DiscussionType,id:string,input:any,attachment?:DiscussionAttachment){
 await discussionEntity(user,type,id);
 if(!workspacePermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
 let text=typeof input.text==='string'?input.text.trim():'';
 let forwarded:DiscussionMessage['forwarded'];
 if(input.forwardFrom){const source=await discussionEntity(user,input.forwardFrom.type,input.forwardFrom.id);const original=discussionMessages(source).find(n=>n.id===input.forwardFrom.messageId);if(!original||original.attachment)throw Error('invalid_message');text=original.text;forwarded={author:original.createdByName||'Сотрудник',label:discussionLabel(input.forwardFrom.type,source)};}
 if(!text||text.length>2000||typeof input.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId))throw Error('invalid_message');
 const note:DiscussionMessage={id:`message-${user.id}-${input.operationId}`,text,createdAt:new Date().toISOString(),createdByUserId:user.id,createdByName:user.displayName,...(attachment?{attachment}:{}),...(forwarded?{forwarded}: {})};
 let added=false;
 const entity=await updateDiscussionEntity(user,type,id,current=>{
  added=false;if(!workspaceCanSee(user,current,type))throw Error('discussion_forbidden');
  const messages=discussionMessages(current),existing=messages.find(n=>n.id===note.id);
  if(existing){if(existing.text!==text||existing.replyTo!==(input.replyTo||undefined))throw Error('message_conflict');return current;}
  if(attachment&&messages.filter(n=>n.attachment).length>=100)throw Error('limit');
  if(input.replyTo){if(typeof input.replyTo!=='string'||!messages.some(n=>n.id===input.replyTo))throw Error('invalid_reply');note.replyTo=input.replyTo;}
  added=true;return {...current,updatedAt:note.createdAt,internalNotes:[...(current.internalNotes||[]),note]};
 });
 if(!entity)throw Error('discussion_forbidden');
 if(added){await recordCrmActivity(user,{type:type==='lead'?'lead_note_added':'client_note_added',title:'Сообщение в обсуждении команды',entityType:type,entityId:id,entityLabel:discussionLabel(type,entity),leadId:type==='lead'?id:undefined,clientId:type==='client'?id:entity.clientId,commentId:note.id,text,href:discussionHref(type,id,note.id)});await notifyDiscussion(user,type,entity,note);}
 return readDiscussion(user,type,id);
}

export async function editDiscussionMessage(user:AuthUser,type:DiscussionType,id:string,input:any){
 await discussionEntity(user,type,id);
 if(!workspacePermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
 const text=typeof input.text==='string'?input.text.trim():'';
 if(!text||text.length>2000||typeof input.messageId!=='string'||input.messageId.length>240||typeof input.expectedText!=='string')throw Error('invalid_message');
 let changed=false,previous='',editedAt='';
 const entity=await updateDiscussionEntity(user,type,id,current=>{
  changed=false;
  if(!workspaceCanSee(user,current,type))throw Error('discussion_forbidden');
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

export async function reactDiscussionMessage(user:AuthUser,type:DiscussionType,id:string,input:any){
 await discussionEntity(user,type,id);
 if(!workspacePermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
 if(!DISCUSSION_REACTIONS.includes(input.emoji)||typeof input.active!=='boolean'||typeof input.messageId!=='string')throw Error('invalid_message');
 const entity=await updateDiscussionEntity(user,type,id,current=>{
  if(!workspaceCanSee(user,current,type))throw Error('discussion_forbidden');
  const messages=discussionMessages(current),position=messages.findIndex(n=>n.id===input.messageId);
  if(position<0)throw Error('invalid_message');
  const originals=Array.isArray(current.internalNotes)?current.internalNotes:[];
  const target=originals.filter((n:any)=>typeof n.text==='string')[position];
  const reactions={...messages[position].reactions};
  const people=(reactions[input.emoji]||[]).filter((id:string)=>id!==user.id);
  if(input.active)people.push(user.id);
  if(people.length)reactions[input.emoji]=people;else delete reactions[input.emoji];
  return {...current,internalNotes:originals.map((n:any)=>n===target?{...n,id:messages[position].id,reactions}:n)};
 });
 if(!entity)throw Error('discussion_forbidden');
 return readDiscussion(user,type,id);
}
export async function discussionTargets(user:AuthUser){
 await assertWorkspace(user);
 if(!workspacePermission(user,'chat')||user.status==='disabled')throw Error('discussion_forbidden');
 const rows=await Promise.all((['lead','client'] as const).map(async type=>!workspacePermission(user,type==='lead'?'editLeads':'editClients')?[]:(await (type==='client'?readyDealerClients(user,await readChunkedDataJson<any>(file(user,type),[])):readChunkedDataJson<any>(file(user,type),[]))).filter(e=>!e.archivedAt&&workspaceCanSee(user,e,type)).slice(-200).map(e=>({type,id:e.id,label:discussionLabel(type,e)}))));
 return rows.flat();
}
