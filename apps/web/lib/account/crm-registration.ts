import {accountPath,phoneAccountId,type CustomerAccount} from './auth';
import {normalizeAccountPhone} from './phone';
import {customerAvatar} from './avatars';
import {readDataJson} from '../data';
/** Registration badge only: matching contact data never grants portal access. */
export async function registeredClientAccount(client:any, read=readDataJson<CustomerAccount|null>) {
 if (!client || client.deletedAt) return null;
 if (client.portalAccountId) {
   if (!/^[a-f0-9]{64}$/.test(client.portalAccountId)) return null;
   const account=await read(accountPath(client.portalAccountId),null);
   return account&&!account.disabled?account:null;
 }
 try {
   const phone=normalizeAccountPhone(client.phone);
   const account=await read(accountPath(phoneAccountId(phone)),null);
   return account&&!account.disabled&&normalizeAccountPhone(account.phone)===phone?account:null;
 } catch {return null;}
}
export async function clientRegistrationAvatars(clients:any[]) {
 const result=new Map<string,string>();let cursor=0;
 // Bounded reads, scoped to visible CRM clients; no full account scan or persistent negative cache.
 await Promise.all(Array.from({length:Math.min(4,clients.length)},async()=>{
   while(cursor<clients.length){const client=clients[cursor++];
     try {const account=await registeredClientAccount(client);if(account)result.set(client.id,account.avatarVersion?`/api/crm/customer-avatar?clientId=${encodeURIComponent(client.id)}&v=${encodeURIComponent(account.avatarVersion)}`:customerAvatar(account.id,account.avatarId));}catch{/* An unavailable badge must not hide the CRM list. */}
   }
 }));return result;
}
