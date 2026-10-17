import {normalizeRuPhone} from './ru-phone';

type ClientOriginRecord={id?:string;source?:string;creationSource?:string;createdByManagerId?:string;createdByManagerName?:string;createdAt?:string;phone?:string};
export function isManuallyAddedClient(client:ClientOriginRecord|null|undefined):boolean{
 return Boolean(client?.createdByManagerId&&(client.creationSource==='manual'||client.source==='manual'));
}
/** Caller supplies only clients the current CRM user can see. No matching by name or partial phone. */
export function manualClientIndex<T extends ClientOriginRecord>(clients:T[]){
 const byId=new Map<string,T>(),byPhone=new Map<string,T[]>();
 for(const client of clients){if(!isManuallyAddedClient(client))continue;if(client.id)byId.set(client.id,client);const phone=normalizeRuPhone(String(client.phone||''));if(phone)byPhone.set(phone,[...(byPhone.get(phone)||[]),client]);}
 return (lead:{clientId?:string;phone?:string;initialContact?:{phone?:string};createdAt?:string})=>{
  const leadDate=Date.parse(lead.createdAt||'');
  const earlier=(client:T)=>Number.isFinite(leadDate)&&Number.isFinite(Date.parse(client.createdAt||''))&&Date.parse(client.createdAt!)<leadDate;
  const linked=byId.get(lead.clientId||'');if(linked&&earlier(linked))return linked;
  const phone=normalizeRuPhone(String(lead.initialContact?.phone||lead.phone||''));
  const matches=(byPhone.get(phone)||[]).filter(earlier);
  return matches.length===1?matches[0]:null;
 };
}
