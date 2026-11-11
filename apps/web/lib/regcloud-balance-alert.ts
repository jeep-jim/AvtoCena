import {randomUUID} from 'node:crypto';
import {mutateDataJson,readDataJson} from './data';
import {readCrmUsers} from './crm-users';
import {isPlatformOwner} from './platform-access';
import {notifyTeam} from './crm-notification-store';
import type {RegcloudBalance} from './regcloud-balance-client';
type AlertState={sampledAt:number;episode:string|null;sent:boolean;balance:number};
const path='integrations/regcloud/balance-alert.json';
const empty:AlertState={sampledAt:0,episode:null,sent:false,balance:0};
export async function notifyLowRegcloudBalance(sample:RegcloudBalance){
 if(!Number.isFinite(sample.balance)||!Number.isFinite(sample.sampledAt))return;
 const previous=await readDataJson(path,empty);
 if(previous.sampledAt>=sample.sampledAt&&(previous.sent||!previous.episode))return;
 const episode=randomUUID();
 const state=await mutateDataJson<AlertState>(path,empty,current=>{
  if(current.sampledAt>=sample.sampledAt)return current;
  return {sampledAt:sample.sampledAt,balance:sample.balance,episode:sample.balance<600?(current.episode||episode):null,sent:sample.balance<600&&!!current.episode&&current.sent};
 });
 if(!state.episode||state.sent)return;
 const recipientIds=(await readCrmUsers()).filter(isPlatformOwner).map(u=>u.id);
 if(!recipientIds.length)return;
 await notifyTeam({id:`regcloud_balance_${state.episode}`,kind:'billing',recipientIds,title:'Баланс REG ниже 600 ₽',text:`На облачном счёте осталось ${new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(state.balance)}. Пополните счёт в кабинете REG.`,href:'/crm/site',createdAt:new Date(state.sampledAt).toISOString()});
 await mutateDataJson<AlertState>(path,empty,current=>current.episode===state.episode?{...current,sent:true}:current);
}
