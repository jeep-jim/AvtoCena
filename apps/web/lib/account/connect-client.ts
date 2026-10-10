import {isPlatformTeam} from '../platform-access';
import type {AuthUser} from '../auth';
import {hasCrmPermission} from '../crm-permissions';
import {canAccessDocumentClient} from '../document-workspace';
import {accountPath,hash,normalizeAccountPhone,type CustomerAccount} from './auth';
import {registeredClientAccount} from './crm-registration';
import {clientsPath,linksPath,type ClientLink} from './portal';
import {readChunkedDataJson,readDataJson,updateChunkedDataJson,mutateDataJson} from '../data';
export function canConnectCustomer(user:AuthUser,client:any,account:CustomerAccount|null,company:string){
 if(!user||user.status==='disabled'||!account||account.disabled||!client||client.deletedAt||!canAccessDocumentClient(user,client))return false;
 if(user.role==='dealer'){if(user.companyId!==company||user.dealerApproved!==true)return false;}
 else if(!isPlatformTeam(user)||company!=='dealer_topavto'||!hasCrmPermission(user,'editLeads'))return false;
 if(client.portalAccountId&&client.portalAccountId!==account.id)return false;
 try{return normalizeAccountPhone(client.phone)===normalizeAccountPhone(account.phone);}catch{return false;}
}
/** Explicit staff confirmation, revalidated against fresh client/account; registration alone is never authorization. */
export async function connectRegisteredClient(user:AuthUser,company:string,clientId:string,input:{accountId?:string;confirmed?:boolean}){
 if(input.confirmed!==true||!input.accountId)throw Error('Подтвердите личность клиента перед подключением кабинета.');
 const path=clientsPath(company),client=(await readChunkedDataJson<any>(path,[])).find(c=>c.id===clientId);
 if(!client||!canAccessDocumentClient(user,client))throw Error('Нет доступа.');
 const account=await registeredClientAccount(client);
 if(account?.id!==input.accountId||!canConnectCustomer(user,client,account,company))throw Error('Кабинет или данные клиента изменились. Обновите карточку.');
 const fresh=await readDataJson<CustomerAccount|null>(accountPath(account.id),null);
 if(!fresh||fresh.disabled||fresh.sessionVersion!==account.sessionVersion)throw Error('Кабинет изменился. Обновите карточку.');
 const at=new Date().toISOString();
 const saved=await updateChunkedDataJson<any>(path,clientId,c=>{if(!canConnectCustomer(user,c,fresh,company))throw Error('Нет доступа.');return {...c,portalAccountId:fresh.id,portalLinkedAt:c.portalLinkedAt||at,portalLinkedBy:c.portalLinkedBy||user.id};});
 if(!saved)throw Error('Клиент не найден.');
 await mutateDataJson<ClientLink[]>(linksPath(fresh.id),[],rows=>rows.some(l=>l.companyId===company&&l.clientId===clientId)?rows:[...rows,{companyId:company,clientId,verifiedAt:at}]);
 return {key:hash(company+':'+clientId)};
}
