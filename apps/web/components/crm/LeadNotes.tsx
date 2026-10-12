'use client';
import {useState} from 'react';
export function LeadNotes({leadId,clientNotes,vehicleNotes,canEdit}:{leadId:string;clientNotes:string;vehicleNotes:string;canEdit:boolean}){
 const [client,setClient]=useState(clientNotes),[vehicle,setVehicle]=useState(vehicleNotes),[base,setBase]=useState({clientNotes,vehicleNotes}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 return <form className="mb-4 grid gap-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');try{const r=await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}/notes`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({clientNotes:client,vehicleNotes:vehicle,expected:base})});if(!r.ok)throw Error(r.status===409?'Заметки уже изменил коллега. Обновите страницу.':'Не удалось сохранить заметки.');setBase({clientNotes:client,vehicleNotes:vehicle});setMessage('Сохранено');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>
 <label>О клиенте<textarea className="soft-input mt-1 w-full rounded-xl p-3" rows={3} maxLength={4000} readOnly={!canEdit} value={client} onChange={e=>setClient(e.target.value)}/></label>
 <label>Об автомобиле<textarea className="soft-input mt-1 w-full rounded-xl p-3" rows={3} maxLength={4000} readOnly={!canEdit} value={vehicle} onChange={e=>setVehicle(e.target.value)}/></label>
 {canEdit&&<button disabled={busy} className="avto-button rounded-xl p-3">{busy?'Сохраняем…':'Сохранить заметки'}</button>}{message&&<p role="status">{message}</p>}</form>;
}
