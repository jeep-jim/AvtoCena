import {readChunkedDataJson} from '../data';
import {leadDealerId} from '../dealers/lead-routing';
import {clientsPath} from './portal';
import {sendCustomerPush} from './push';
export async function notifyCustomerForLead(lead:any){if(!lead.clientId)return;const company=leadDealerId(lead);const clients=await readChunkedDataJson<any>(clientsPath(company),[]);const client=clients.find(c=>c.id===lead.clientId);if(client?.portalAccountId)await sendCustomerPush(client.portalAccountId,'/account?tab=applications');}
