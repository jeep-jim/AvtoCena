'use client';
import {useEffect,useState} from 'react';
export function AjesConnectionSettings(){
 const [configured,setConfigured]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{fetch('/api/crm/ajes/settings',{cache:'no-store'}).then(r=>r.json()).then(b=>setConfigured(b.configured===true)).catch(()=>setMessage('Не удалось проверить подключение'));},[]);
 return <form className="my-3 space-y-2 rounded-lg border p-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');try{const r=await fetch('/api/crm/ajes/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const b=await r.json();if(!r.ok)throw Error(b.error);setConfigured(true);setPassword('');setMessage('Доступ проверен. Включите источник AJ System ниже, чтобы открыть каталог.');}catch(e){setMessage(e instanceof Error?e.message:'Не удалось подключить');}finally{setBusy(false);}}}>
 <p className="font-semibold">AJ System · {configured?'доступ настроен':'подключение'}</p>
 <label className="block text-sm">API-пароль<input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button className="rounded border px-3 py-2 text-sm" disabled={busy}>{busy?'Проверяем…':configured?'Обновить доступ':'Проверить и сохранить'}</button>
 <p className="text-xs">Пароль хранится зашифрованным. Лоты загружаются при поиске и открытии карточки. Выключение источника приостанавливает эти обращения.</p>
 {message&&<p role="status" className="text-sm">{message}</p>}</form>;
}
