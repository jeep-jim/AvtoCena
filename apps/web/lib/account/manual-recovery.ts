import {createHash} from 'node:crypto';
import type {AuthUser} from '../auth';
import {appendChunkedDataJson,mutateDataJson,readChunkedDataJson,readDataJson} from '../data';
import {accountPath,normalizeAccountPhone,phoneAccountId,type CustomerAccount} from './auth';
import {normalizeAccountEmail} from './email';
import {canReadRegisteredCustomers,registeredCustomerHref} from './crm-accounts';
import {recordCrmActivity} from '../crm-activity';
import {notifyTeam} from '../crm-notification-store';
import {readCrmUsers} from '../crm-users';
import {isPlatformOwner} from '../platform-access';
import {issueTemporaryPassword} from './temporary-password';

export type RecoveryRequest = {id:string;createdAt:string;phone:string;email:string;accountId?:string;accountName?:string;version?:number;status:'new'|'issuing'|'issued'|'completed'|'rejected';updatedAt?:string;handledBy?:string;reason?:string};
const INDEX='accounts/recovery-requests/index.json';
function requestPath(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Заявка не найдена.');return `accounts/recovery-requests/items/${id}.json`;}
export async function recoveryRequest(id:string){return readDataJson<RecoveryRequest|null>(requestPath(id),null);}
export async function createRecoveryRequest(rawPhone:unknown,rawEmail:unknown){
 const phone=normalizeAccountPhone(rawPhone),email=normalizeAccountEmail(rawEmail);
 const account=await readDataJson<CustomerAccount|null>(accountPath(phoneAccountId(phone)),null);
 // A retry keeps the same request; the contact email is never linked to the account.
 const id=createHash('sha256').update(JSON.stringify([phone,email,Math.floor(Date.now()/900000)])).digest('hex');
 const request=await mutateDataJson<RecoveryRequest|null>(requestPath(id),null,current=>current||{id,createdAt:new Date().toISOString(),phone,email,status:'new',...(account?{accountId:account.id,accountName:account.name,version:account.sessionVersion}:{})});
 if(!request)throw Error('Не удалось сохранить заявку.');
 await appendChunkedDataJson(INDEX,{id,createdAt:request.createdAt,accountId:request.accountId});
 const href=request.accountId?registeredCustomerHref(request.accountId)+'#recovery-requests':'/crm/clients/recovery';
 const eventId='customer_recovery:'+id;
 await recordCrmActivity(null,{id:eventId,createdAt:request.createdAt,type:'customer_recovery_submitted',title:'Запрос на восстановление доступа',entityType:request.accountId?'account':'recovery',entityId:request.accountId||id,entityLabel:request.accountName||phone,text:`${phone} · Почта из заявки: ${email}`,href,visibility:'management'});
 const users=await readCrmUsers();
 await notifyTeam({id:eventId,createdAt:request.createdAt,recipientIds:users.filter(canReadRegisteredCustomers).map(u=>u.id),kind:'recovery',title:'Запрос на восстановление доступа',text:`${request.accountName||phone} · ${phone}`,href});
 return request;
}
export async function recoveryRequests(accountId?:string){
 const refs=await readChunkedDataJson<{id:string;accountId?:string}>(INDEX,[]);
 const ids=[...new Set(refs.filter(r=>!accountId||r.accountId===accountId).map(r=>r.id))];
 const result:RecoveryRequest[]=[];let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<ids.length){const row=await recoveryRequest(ids[cursor++]);if(row)result.push(row);}}));
 return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function issueRequestedPassword(user:AuthUser,requestId:string,accountId:string,reason:string){
 if(!isPlatformOwner(user))throw Error('Недостаточно прав.');
 const row=await recoveryRequest(requestId);
 if(!row||row.accountId!==accountId||row.version===undefined||!['new','issuing','issued'].includes(row.status))throw Error('Заявка недоступна для выдачи пароля.');
 if(reason.trim().length<15||reason.length>500)throw Error('Укажите, как проверена личность владельца номера.');
 // Stable proof makes retries safe even if storing the outcome fails after issuance.
 await recordCrmActivity(user,{id:'recovery_check:'+row.id,type:'customer_manual_recovery_requested',title:'Проверен запрос на восстановление',entityType:'account',entityId:accountId,text:reason,href:registeredCustomerHref(accountId),visibility:'management'});
 await mutateDataJson<RecoveryRequest|null>(requestPath(row.id),null,current=>{if(!current||!['new','issuing','issued'].includes(current.status))throw Error('Статус заявки изменился.');return {...current,status:current.status==='issued'?'issued':'issuing'};});
 let result;
 try{result=await issueTemporaryPassword(accountId,row.version,'manual-request:'+row.id);}catch(error){
  const account=await readDataJson<CustomerAccount|null>(accountPath(accountId),null);
  if(account&&(account.disabled||account.sessionVersion!==row.version&&account.passwordRecoveryProof!=='manual-request:'+row.id||account.passwordRecoveryProof==='manual-request:'+row.id&&(account.passwordTemporaryUsed||Number(account.passwordTemporaryUntil)<=Date.now())))await mutateDataJson<RecoveryRequest|null>(requestPath(row.id),null,current=>current&&['issuing','issued'].includes(current.status)?{...current,status:'rejected',reason:'Данные доступа изменились или временный пароль уже использован либо истёк. Требуется новый запрос.',updatedAt:new Date().toISOString(),handledBy:user.id}:current);
  throw error;
 }
 await mutateDataJson<RecoveryRequest|null>(requestPath(row.id),null,current=>{
  if(!current||!['issuing','issued'].includes(current.status))throw Error('Статус заявки изменился. Обновите страницу.');
  return {...current,status:'issued',reason,handledBy:user.id,updatedAt:new Date().toISOString()};
 });
 await recordCrmActivity(user,{id:'recovery_issued:'+row.id,type:'customer_manual_recovery_issued',title:'Выдан временный пароль по заявке',entityType:'account',entityId:accountId,href:registeredCustomerHref(accountId),visibility:'management'});
 return result;
}
export async function finishRecoveryRequest(user:AuthUser,id:string,status:'completed'|'rejected',reason:string){
 if(!isPlatformOwner(user))throw Error('Недостаточно прав.');
 if(!reason.trim()||reason.length>500)throw Error('Укажите результат рассмотрения.');
 const row=await mutateDataJson<RecoveryRequest|null>(requestPath(id),null,current=>{
  if(!current)throw Error('Заявка не найдена.');
  if(current.status===status)return current;
  if(status==='completed'?current.status!=='issued':current.status!=='new')throw Error('Статус заявки изменился. Обновите страницу.');
  return {...current,status,reason,handledBy:user.id,updatedAt:new Date().toISOString()};
 });
 if(row)await recordCrmActivity(user,{id:'recovery_finished:'+id,type:'customer_recovery_finished',title:status==='completed'?'Отмечена ручная отправка письма':'Запрос восстановления отклонён',entityType:row.accountId?'account':'recovery',entityId:row.accountId||id,text:reason,href:row.accountId?registeredCustomerHref(row.accountId):'/crm/clients/recovery',visibility:'management'});
 return row;
}
