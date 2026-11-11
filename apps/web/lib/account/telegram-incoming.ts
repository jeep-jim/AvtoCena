import {randomUUID} from 'node:crypto';
import {mutateDataJson} from '../data';
import {isPrivateCrmEvent} from '../crm-incoming-events';
import {handleCustomerAccountBot} from './telegram';
/** Same receipt/lease as the poller. Delivery failures remain retryable. */
export async function handleImmediateAccountUpdate(update:any,token:string){
 if(!isPrivateCrmEvent(update)||!token||!((/^account:phone:[a-f0-9]{40}$/.test(String(update.callback_query?.data||'')))||update.message?.contact||/^\/start(?:@\w+)?\s+account_/.test(String(update.message?.text||''))))return false;
 const path=`telegram/crm-updates/${update.update_id}.json`,lease=randomUUID();let done=false,acquired=false;
 await mutateDataJson(path,{lease:'',until:0,done:false},r=>{done=r.done;acquired=false;if(done||r.until>Date.now())return r;acquired=true;return {...r,lease,until:Date.now()+120000};});
 if(done)return true;if(!acquired)throw Error('update_busy');
 try{const handled=await handleCustomerAccountBot(update,token);if(handled)await mutateDataJson(path,{lease:'',until:0,done:false},r=>{if(r.lease!==lease)throw Error('update_lease_lost');return {...r,done:true,until:0};});return handled;}
 finally{await mutateDataJson(path,{lease:'',until:0,done:false},r=>r.lease===lease?{...r,until:0}:r);}
}
