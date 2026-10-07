import {mutateDataJson} from '../data';
import {requestCrmDelivery} from '../crm-dispatch';
/** One short polling window shared by concurrent recovery requests; no customer data in dispatch. */
export async function wakeRecoveryWorker(){let wake=false;await mutateDataJson('accounts/recovery-worker.json',{until:0},r=>{wake=r.until<=Date.now();return wake?{until:Date.now()+240000}:r;});if(wake&&await requestCrmDelivery(undefined,undefined,'recover')!=='accepted')await mutateDataJson('accounts/recovery-worker.json',{until:0},()=>({until:Date.now()+30000}));}
