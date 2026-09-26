import {createHash,randomUUID} from 'node:crypto';
import type {AuthUser} from './auth';
import {mutateDataJson,readDataJson,readChunkedDataJson} from './data';
import {canSeeLead} from './crm-visibility';
import {readCrmUsers} from './crm-users';
import {isCrmRole} from './auth';
import {recordCrmActivity} from './crm-activity';
export type CrmReminder={id:string;ownerId:string;entityType:'client'|'lead';entityId:string;entityLabel:string;clientId?:string;text:string;dueAt:string;createdAt:string;doneAt?:string;doneBy?:string;ownerName?:string;canOpen?:boolean;notify?:boolean;};
const key=(userId:string)=>`crm/reminders/${createHash('sha256').update(userId).digest('hex')}.json`;
export async function reminderEntity(user:AuthUser,type:string,id:string){
 if(!['client','lead'].includes(type)||!id||id.length>180)throw Error('invalid_entity');
 const rows=await readChunkedDataJson<any>(type==='client'?'clients/clients.json':'leads/leads.json',[]);
 const entity=rows.find(x=>x.id===id);if(!entity||!canSeeLead(user,entity))throw Error('entity_forbidden');return entity;
}
export async function readReminders(user:AuthUser){
 if(!isCrmRole(user.role)||user.status==='disabled')return [];
 const users=await readCrmUsers();const owners=[...new Set([user.id,...users.filter(u=>isCrmRole(u.role)).map(u=>u.id)])];
 const files:CrmReminder[][]=[];for(let i=0;i<owners.length;i+=4)files.push(...await Promise.all(owners.slice(i,i+4).map(id=>readDataJson<CrmReminder[]>(key(id),[]))));
 const rows=files.flat();if(!rows.length)return [];
 const [clients,leads]=await Promise.all([readChunkedDataJson<any>('clients/clients.json',[]),readChunkedDataJson<any>('leads/leads.json',[])]);
 return rows.map(row=>{const entity=(row.entityType==='client'?clients:leads).find(x=>x.id===row.entityId);return {...row,ownerName:users.find(u=>u.id===row.ownerId)?.displayName||row.ownerName||'Сотрудник',canOpen:Boolean(entity&&canSeeLead(user,entity)),notify:row.ownerId===user.id||entity?.assignedManagerId===user.id};}).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
}
export async function createReminder(user:AuthUser,input:any){
 const entity=await reminderEntity(user,input.entityType,String(input.entityId||''));const text=String(input.text||'').trim().slice(0,1000),date=new Date(input.dueAt);
 if(!text||!Number.isFinite(date.getTime())||date.getTime()<Date.now()-60_000)throw Error('invalid_reminder');
 const row:CrmReminder={id:randomUUID(),ownerId:user.id,ownerName:user.displayName,entityType:input.entityType,entityId:input.entityId,entityLabel:entity.fio||entity.name||entity.car||'Клиент',clientId:input.entityType==='client'?entity.id:entity.clientId,text,dueAt:date.toISOString(),createdAt:new Date().toISOString()};
 await mutateDataJson<CrmReminder[]>(key(user.id),[],rows=>{const retained=rows.filter(r=>!r.doneAt||Date.parse(r.doneAt)>Date.now()-90*86400000);if(retained.filter(r=>!r.doneAt).length>=300)throw Error('reminder_limit');return [...retained,row];});
 await recordCrmActivity(user,{id:`reminder_created_${row.id}`,type:'reminder_created',title:'Добавлено напоминание',entityType:row.entityType,entityId:row.entityId,entityLabel:row.entityLabel,clientId:row.clientId,leadId:row.entityType==='lead'?row.entityId:undefined,text:row.text,changes:[{label:'Срок · Новокузнецк',after:new Date(row.dueAt).toLocaleString('ru-RU',{timeZone:'Asia/Novokuznetsk'})}]});return row;
}
export async function finishReminder(user:AuthUser,id:string){
 const row=(await readReminders(user)).find(r=>r.id===id);if(!row)throw Error('entity_forbidden');
 let completed=false;
 await mutateDataJson<CrmReminder[]>(key(row.ownerId),[],rows=>{completed=false;return rows.map(r=>{if(r.id!==id||r.doneAt)return r;completed=true;return {...r,doneAt:new Date().toISOString(),doneBy:user.id};});});
 if(completed)await recordCrmActivity(user,{id:`reminder_done_${id}`,type:'reminder_done',title:'Напоминание выполнено',entityType:row.entityType,entityId:row.entityId,entityLabel:row.entityLabel,clientId:row.clientId,leadId:row.entityType==='lead'?row.entityId:undefined,text:row.text});
}
