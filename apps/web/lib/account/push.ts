import {createHash} from 'node:crypto';
import webpush from 'web-push';
import {readDataJson,mutateDataJson} from '../data';
import {pushKeys} from '../crm-push';
import {validPushSubscription} from '../crm-push-policy';
import {accountPath,type CustomerAccount} from './auth';
import {portalData} from './portal';
const FILE='accounts/push-subscriptions.json';
type Row={id:string;accountId:string;sessionVersion:number;subscription:webpush.PushSubscription;updatedAt:number};
export async function registerCustomerPush(account:CustomerAccount,subscription:webpush.PushSubscription){
 if(!validPushSubscription(subscription))throw Error('Проверьте разрешение уведомлений.');
 const id=createHash('sha256').update(subscription.endpoint).digest('hex');
 await mutateDataJson<Row[]>(FILE,[],rows=>{const valid=rows.filter(row=>row.id!==id&&row.updatedAt>Date.now()-90*86400000);if(valid.filter(r=>r.accountId===account.id).length>=10||valid.length>=2000)throw Error('Достигнут лимит устройств.');return [...valid,{id,accountId:account.id,sessionVersion:account.sessionVersion,subscription,updatedAt:Date.now()}];});
}
export async function removeCustomerPush(accountId:string,endpoint:string){await mutateDataJson<Row[]>(FILE,[],rows=>rows.filter(row=>row.accountId!==accountId||row.subscription.endpoint!==endpoint));}
export async function sendCustomerPush(accountId:string,href:string){
 if(!/^[a-f0-9]{64}$/.test(accountId))return;
 const rows=(await readDataJson<Row[]>(FILE,[])).filter(r=>r.accountId===accountId);
 if(!rows.length)return;
 const keys=await pushKeys();if(!keys)return;
 for(const row of rows){
  const account=await readDataJson<CustomerAccount|null>(accountPath(accountId),null);
  if(!account||account.disabled||account.sessionVersion!==row.sessionVersion||row.updatedAt<Date.now()-90*86400000||!validPushSubscription(row.subscription)){await removeCustomerPush(accountId,row.subscription.endpoint);continue;}
  // Recheck access at delivery; payload never includes message text or documents.
  if(!(await portalData(account)).length)continue;
  if(!(await readDataJson<Row[]>(FILE,[])).some(r=>r.id===row.id&&r.accountId===accountId))continue;
  try{await webpush.sendNotification(row.subscription,JSON.stringify({accountId,title:'АвтоЦена · Новое событие',href:/^\/account(?:\?|$)/.test(href)?href:'/account'}),{TTL:3600,urgency:'high',timeout:5000,vapidDetails:{subject:'https://avtocena.com',...keys}});}catch(error:any){if([404,410].includes(error?.statusCode))await removeCustomerPush(accountId,row.subscription.endpoint);}
 }
}
