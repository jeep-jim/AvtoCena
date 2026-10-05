import {accountCanAccessClient,sharedCustomerDocuments,confirmedCustomerContract} from './access';
import {readDataJson,mutateDataJson,readChunkedDataJson,readRecentChunkedDataJson,appendChunkedDataJson} from '../data';
import type {CustomerAccount} from './auth';
import {hash} from './auth';
import {readCrmUsers} from '../crm-users';
import {leadStatusLabel} from '../crm';
import {leadDealerId} from '../dealers/lead-routing';
export async function customerLeads(company:string,clientId:string){return (await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>l.clientId===clientId&&!l.archivedAt&&(company==='dealer_topavto'||leadDealerId(l)===company));}
export type ClientLink={clientId:string;companyId:string;verifiedAt:string};
export const linksPath=(id:string)=>`accounts/links/${id}.json`;
export function clientsPath(companyId:string){if(!/^[-a-zA-Z0-9_]{1,100}$/.test(companyId))throw Error('Нет доступа.');return companyId==='dealer_topavto'?'clients/clients.json':`dealers/${companyId}/clients.json`;}
export const threadPath=(company:string,client:string)=>`accounts/messages/${hash(company+':'+client)}.json`;
export async function linkedClient(a:CustomerAccount,key:string){const links=await readDataJson<ClientLink[]>(linksPath(a.id),[]);const link=links.find(l=>hash(l.companyId+':'+l.clientId)===key);if(!link)throw Error('Нет доступа.');const client=(await readChunkedDataJson<any>(clientsPath(link.companyId),[])).find(c=>c.id===link.clientId&&accountCanAccessClient(a.id,c));if(!client)throw Error('Нет доступа.');return {link,client};}
export async function portalData(a:CustomerAccount){const links=await readDataJson<ClientLink[]>(linksPath(a.id),[]);const users=await readCrmUsers();const result=[];
 for(const link of links.slice(0,30)){const key=hash(link.companyId+':'+link.clientId);let client:any;try{({client}=await linkedClient(a,key));}catch{continue;}
 const leads=await customerLeads(link.companyId,client.id);
 const reviews=(await readChunkedDataJson<any>(`dealers/${link.companyId}/reviews.json`,[])).filter(r=>r.userId===a.id&&leads.some(l=>l.id===r.leadId));
 const manager=users.find(u=>u.id===(client.assignedManagerId||leads.find(l=>l.assignedManagerId)?.assignedManagerId)&&u.status!=='disabled');
 const messages=(await readRecentChunkedDataJson<any>(threadPath(link.companyId,client.id),100)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 result.push({key,name:client.fio||a.name,companyId:link.companyId,manager:manager?{name:manager.displayName,avatar:manager.avatarUrl}:null,
 leads:leads.map(l=>({id:l.id,title:l.offerTitle||l.car||'Подбор автомобиля',status:leadStatusLabel(l.status),updatedAt:l.updatedAt||l.createdAt,canReview:!!confirmedCustomerContract(client,l.id)&&!client.portalReviews?.[l.id]&&!reviews.some(r=>r.leadId===l.id)})),
 documents:sharedCustomerDocuments(client).map((d:any)=>({id:d.id,name:d.name,size:d.size,createdAt:d.createdAt})),
 reviews:reviews.map(r=>({id:r.id,rating:r.rating,text:r.text,status:r.status})),
 messages:messages.map(m=>({id:m.id,text:m.text,author:m.author,createdAt:m.createdAt,mine:m.accountId===a.id}))});
 }return result;
}
export async function sendPortalMessage(company:string,client:string,text:unknown,author:string,accountId?:string){const value=String(text||'').trim();if(!value||value.length>4000)throw Error('Введите сообщение до 4000 символов.');return appendChunkedDataJson(threadPath(company,client),{id:crypto.randomUUID(),text:value,author,accountId,createdAt:new Date().toISOString()},50);}
