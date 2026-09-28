'use client';
import {useState} from 'react';
import {MapPin,Plus,X} from 'lucide-react';
export function StaffWorkplaces({addresses=[],remote=false}:{addresses?:string[];remote?:boolean}){
 const [rows,setRows]=useState(addresses.length?addresses:['']),[remoteWork,setRemoteWork]=useState(remote);
 return <fieldset className="crm-staff-workplaces md:col-span-2"><legend><MapPin size={17}/>Место работы</legend><input type="hidden" name="workplacesPresent" value="1"/><input type="hidden" name="workAddresses" value={JSON.stringify(rows)}/><p>Добавьте офисы, в которых работает сотрудник. При назначении смены можно выбрать нужный адрес.</p>
 {rows.map((address,i)=><div className="crm-workplace-row" key={i}><label><span>Адрес офиса {i+1}</span><input aria-label={`Адрес офиса ${i+1}`} maxLength={240} value={address} placeholder="Город, улица, дом, офис" onChange={e=>setRows(v=>v.map((r,n)=>n===i?e.target.value:r))}/></label><button type="button" aria-label={`Удалить адрес ${i+1}`} onClick={()=>setRows(v=>v.filter((_,n)=>n!==i))}><X size={18}/></button></div>)}
 <div className="crm-workplace-actions"><button type="button" disabled={rows.length>=10} onClick={()=>setRows(v=>[...v,''])}><Plus size={16}/>Добавить адрес</button><label><input type="checkbox" name="remoteWork" checked={remoteWork} onChange={e=>setRemoteWork(e.target.checked)}/>Удалённый сотрудник</label></div><small>Можно указать и адреса офисов, и возможность работать удалённо.</small></fieldset>;
}
