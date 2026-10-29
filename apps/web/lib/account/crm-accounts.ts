import type {AuthUser} from '../auth';
import {isPlatformTeam} from '../platform-access';
import {hasCrmPermission} from '../crm-permissions';
import {getJsonStorage,readDataJson} from '../data';
import {accountPath,normalizeAccountPhone,phoneAccountId,type CustomerAccount} from './auth';
export function canReadRegisteredCustomers(user:AuthUser|null|undefined){return isPlatformTeam(user)&&hasCrmPermission(user,'viewAll');}
export function registeredCustomerHref(id:string){return /^[a-f0-9]{64}$/.test(id)?`/crm/clients/registered/${id}`:'/crm/clients/registered';}
export async function registeredCustomersPage(phone:string,page:number,sort='newest'){
 if(phone && /^[+\d\s()-]+$/.test(phone) && phone.replace(/\D/g,'').length>=11){let id:string;try{id=phoneAccountId(normalizeAccountPhone(phone));}catch{return {accounts:[],total:0};}const a=await readDataJson<CustomerAccount|null>(accountPath(id),null);return {accounts:a?[a]:[],total:a?1:0};}
 const storage=getJsonStorage();if(!storage.listObjects)throw Error('Список пользователей временно недоступен.');
 const keys=(await storage.listObjects('accounts/users/')).filter(x=>/^accounts\/users\/[a-f0-9]{64}\.json$/.test(x.key)).sort((a,b)=>String(b.lastModified).localeCompare(String(a.lastModified))||a.key.localeCompare(b.key));
 const query=phone.trim().toLocaleLowerCase('ru-RU');
 const selected=keys,accounts:CustomerAccount[]=[];let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<selected.length){const k=selected[cursor++];const a=await readDataJson<CustomerAccount|null>(k.key,null);if(a&&(!query||a.name.toLocaleLowerCase('ru-RU').includes(query)||a.phone.includes(query.replace(/[\s()-]/g,''))))accounts.push(a);}}));
 accounts.sort((a,b)=>(sort==='oldest'?a.createdAt.localeCompare(b.createdAt):sort==='name'?a.name.localeCompare(b.name,'ru'):sort==='phone'?a.phone.localeCompare(b.phone):b.createdAt.localeCompare(a.createdAt))||a.id.localeCompare(b.id));
 return {accounts:accounts.slice((page-1)*40,page*40),total:accounts.length};
}
