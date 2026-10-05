import {accountCanAccessClient,sharedCustomerDocuments,confirmedCustomerContract} from './access';
import {readDataJson,mutateDataJson,readChunkedDataJson,readRecentChunkedDataJson,appendChunkedDataJson} from '../data';
import type {CustomerAccount} from './auth';
import {hash} from './auth';
import {readCrmUsers} from '../crm-users';
import {leadStatusLabel} from '../crm';
import {readShowcase} from '../dealers/showcase-store';
import {dealerReviewSummary} from '../dealers/review-policy';
import {defaultManagerAvatar} from '../default-avatars';
import {leadDealerId} from '../dealers/lead-routing';
export async function customerLeads(company:string,clientId:string){return (await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>l.clientId===clientId&&!l.archivedAt&&(company==='dealer_topavto'||leadDealerId(l)===company));}
export type ClientLink={clientId:string;companyId:string;verifiedAt:string};
export const linksPath=(id:string)=>`accounts/links/${id}.json`;
export function clientsPath(companyId:string){if(!/^[-a-zA-Z0-9_]{1,100}$/.test(companyId))throw Error('Нет доступа.');return companyId==='dealer_topavto'?'clients/clients.json':`dealers/${companyId}/clients.json`;}
export const threadPath=(company:string,client:string)=>`accounts/messages/${hash(company+':'+client)}.json`;
export async function linkedClient(a:CustomerAccount,key:string){const links=await readDataJson<ClientLink[]>(linksPath(a.id),[]);const link=links.find(l=>hash(l.companyId+':'+l.clientId)===key);if(!link)throw Error('Нет доступа.');const client=(await readChunkedDataJson<any>(clientsPath(link.companyId),[])).find(c=>c.id===link.clientId&&accountCanAccessClient(a.id,c));if(!client)throw Error('Нет доступа.');return {link,client};}
export async function portalData(a:CustomerAccount){const [links,users,allLeads]=await Promise.all([readDataJson<ClientLink[]>(linksPath(a.id),[]),readCrmUsers(),readChunkedDataJson<any>('leads/leads.json',[])]);const result=[];
 for(const link of links.slice(0,30)){const key=hash(link.companyId+':'+link.clientId);let client:any;try{client=(await readChunkedDataJson<any>(clientsPath(link.companyId),[])).find(c=>c.id===link.clientId&&accountCanAccessClient(a.id,c));if(!client)continue;}catch{continue;}
 const leads=allLeads.filter(l=>l.clientId===client.id&&!l.archivedAt&&(link.companyId==='dealer_topavto'||leadDealerId(l)===link.companyId));
 const [allReviews,thread,showcase]=await Promise.all([readChunkedDataJson<any>(`dealers/${link.companyId}/reviews.json`,[]),readRecentChunkedDataJson<any>(threadPath(link.companyId,client.id),100),readShowcase(link.companyId)]);
 const reviews=allReviews.filter(r=>r.userId===a.id&&leads.some(l=>l.id===r.leadId));
 const manager=users.find(u=>u.id===(client.assignedManagerId||leads.find(l=>l.assignedManagerId)?.assignedManagerId)&&u.status!=='disabled');
 const messages=thread.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const avatar=(user:any,messageId?:string)=>user?.avatarUrl?.startsWith('/api/crm/users/')?`/api/account/manager-avatar?client=${key}${messageId?'&message='+encodeURIComponent(messageId):''}&v=${encodeURIComponent(user.avatarUrl.split('?')[1]||'')}`:user?.avatarUrl||defaultManagerAvatar(user?.id||'manager');
 result.push({key,name:client.fio||a.name,companyId:link.companyId,dealer:{name:showcase?.name||'Ваша компания',logo:showcase?.logoLight},reviewSummary:dealerReviewSummary(allReviews,link.companyId),manager:manager?{name:manager.displayName,avatar:avatar(manager)}:null,
 leads:leads.map(l=>({id:l.id,title:l.offerTitle||l.car||'Подбор автомобиля',status:leadStatusLabel(l.status),updatedAt:l.updatedAt||l.createdAt,reviewAvailableAt:confirmedCustomerContract(client,l.id)?.confirmedAt,canReview:!!confirmedCustomerContract(client,l.id)&&!client.portalReviews?.[l.id]&&!reviews.some(r=>r.leadId===l.id)})),
 documents:sharedCustomerDocuments(client).map((d:any)=>({id:d.id,name:d.name,size:d.size,createdAt:d.createdAt})),
 reviews:reviews.map(r=>({id:r.id,rating:r.rating,text:r.text,status:r.status,reply:r.reply?{text:r.reply.text,createdAt:r.reply.createdAt}:null})),
 messages:messages.map(m=>({id:m.id,text:m.text,author:m.author,createdAt:m.createdAt,mine:m.accountId===a.id,avatar:m.accountId?undefined:avatar(users.find(u=>u.status!=='disabled'&&(m.staffId?u.id===m.staffId:u.id===manager?.id&&u.displayName===m.author)),m.id)}))});
 }return result;
}
export async function sendPortalMessage(company:string,client:string,text:unknown,author:string,accountId?:string,staffId?:string){const value=String(text||'').trim();if(!value||value.length>4000)throw Error('Введите сообщение до 4000 символов.');return appendChunkedDataJson(threadPath(company,client),{id:crypto.randomUUID(),text:value,author,accountId,staffId,createdAt:new Date().toISOString()},50);}
