import type {AuthUser} from '../auth';
import {readChunkedDataJson} from '../data';
import {leadDealerId} from './lead-routing';
import {hasContactResult} from './lead-workflow';
// Used at the data boundary, not just to hide buttons. Existing customer access is unaffected.
function ready(user:AuthUser|null|undefined,client:any,all:any[]){
 if(user?.role!=='dealer'||user.companyId==='dealer_topavto')return true;
 if(!client||client.companyId!==user.companyId)return false;
 const phone=(v:any)=>String(v||'').replace(/\D/g,'');
 const leads=all.filter(l=>leadDealerId(l)===user.companyId&&(l.clientId===client.id||(phone(client.phone).length>=10&&phone(l.phone)===phone(client.phone))));
 // Manual clients with no platform application retain their existing workflow.
 return !leads.length||leads.some(l=>hasContactResult(l)||!!client.portalContracts?.[l.id]?.confirmedAt);
}
export async function dealerClientReady(user:AuthUser|null|undefined,client:any){return ready(user,client,user?.role==='dealer'?await readChunkedDataJson<any>('leads/leads.json',[]):[]);}
export async function readyDealerClients(user:AuthUser,clients:any[]){const leads=user.role==='dealer'?await readChunkedDataJson<any>('leads/leads.json',[]):[];return clients.filter(c=>ready(user,c,leads));}
