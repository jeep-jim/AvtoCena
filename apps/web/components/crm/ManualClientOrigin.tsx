import {Plus} from 'lucide-react';
import {isManuallyAddedClient} from '@/lib/crm-client-origin';
import {crmDateTime} from '@/lib/crm-time';
export function ManualClientOrigin({client,managers,previous=false,compact=false}:{client:any;managers:{id:string;displayName:string}[];previous?:boolean;compact?:boolean}){
 if(!isManuallyAddedClient(client))return null;
 const manager=managers.find(m=>m.id===client.createdByManagerId)?.displayName||client.createdByManagerName||'Менеджер';
 const detail=`${manager}${client.createdAt?` · ${crmDateTime(client.createdAt)}`:''}`;
 return <span className={`crm-manual-client-origin${compact?' crm-client-origin-compact':''}`} title={detail}>
  <strong>{compact&&<Plus size={14} aria-hidden="true"/>}{previous?'Уже был в базе · добавлен вручную':'Добавлен вручную'}</strong>
  {!compact&&<span>{detail}</span>}
 </span>;
}
