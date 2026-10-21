import {readChunkedDataJson,appendChunkedDataJson} from '../data';
import {readCrmUsers} from '../crm-users';
import {leadDealerId} from '../dealers/lead-routing';
import {clientsPath,threadPath} from './portal';
import {leadCustomerEvents} from './conversation-events';
import {sendCustomerPush} from './push';
export async function notifyCustomerForLead(lead:any,previous?:any){
 if(!lead.clientId)return;const company=leadDealerId(lead);
 const client=(await readChunkedDataJson<any>(clientsPath(company),[])).find(c=>c.id===lead.clientId&&!c.deletedAt);
 if(!client)return;
 if(previous){const manager=(await readCrmUsers()).find(u=>u.id===lead.assignedManagerId&&u.status!=='disabled');
  for(const message of leadCustomerEvents(lead,previous,manager?.displayName))await appendChunkedDataJson(threadPath(company,client.id),message,50);
 }
 if(client.portalAccountId)await sendCustomerPush(client.portalAccountId,'/account?tab=chat');
}
