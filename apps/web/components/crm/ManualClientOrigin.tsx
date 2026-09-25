import {isManuallyAddedClient} from '@/lib/crm-client-origin';
import {crmDateTime} from '@/lib/crm-time';
export function ManualClientOrigin({client,managers,previous=false}:{client:any;managers:{id:string;displayName:string}[];previous?:boolean}){
 if(!isManuallyAddedClient(client))return null;
 const manager=managers.find(m=>m.id===client.createdByManagerId)?.displayName||client.createdByManagerName||'Менеджер';
 return <span className="crm-manual-client-origin" title={`${manager}${client.createdAt?` · ${crmDateTime(client.createdAt)}`:''}`}><strong>{previous?'Уже был в базе · добавлен вручную':'Добавлен вручную'}</strong><span>{manager}{client.createdAt?` · ${crmDateTime(client.createdAt)}`:''}</span></span>;
}
