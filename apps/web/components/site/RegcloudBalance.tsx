'use client';
import {useEffect,useState} from 'react';
type Balance={configured:boolean;balance?:number;sampledAt?:number};
const rub=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value);
export function RegcloudBalance(){
 const [data,setData]=useState<Balance|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState(false),[token,setToken]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>,controller:AbortController;
  async function update(){
   if(document.hidden){timer=setTimeout(update,60000);return;}
   controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
   try{const r=await fetch('/api/crm/regcloud-balance',{cache:'no-store',signal:controller.signal});const value=await r.json();if(!r.ok)throw Error();if(!stopped){setData(value);setError('');}}
   catch{if(!stopped)setError('Баланс не обновлён. Проверьте его в кабинете REG.');}
   finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(update,60000);}
  }void update();return()=>{stopped=true;clearTimeout(timer);controller?.abort();};
 },[]);
 async function connect(e:React.FormEvent){e.preventDefault();setSaving(true);setError('');
  try{const r=await fetch('/api/crm/regcloud-balance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token.trim()}),signal:AbortSignal.timeout(15000)});const value=await r.json();if(!r.ok)throw Error();setData(value);setEditing(false);}
  catch{setError('Не удалось подключиться. Проверьте API-ключ REG и повторите.');}
  finally{setToken('');setSaving(false);}
 }
 return <div className="mt-4 border-t border-[var(--ac-border)] pt-4">
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="text-[var(--ac-muted)]">Баланс REG</span><strong data-balance-state={typeof data?.balance==='number'?(data.balance<600?'low':'normal'):undefined} className="ac-regcloud-balance text-lg tabular-nums">{typeof data?.balance==='number'?rub(data.balance):data?.configured===false?'Не подключён':error?'Недоступен':'Загрузка…'}</strong><a href="https://cloud.reg.ru/panel/finance" target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">Пополнить ↗</a><button type="button" className="ml-auto text-xs text-[var(--ac-muted)] underline" onClick={()=>{setEditing(!editing);setToken('');}}>{data?.configured?'Настроить':'Подключить баланс'}</button></div>
  {typeof data?.balance==='number'&&data.balance<600&&<p className="mt-1 text-xs" role="status">Осталось меньше 600 ₽ — пора пополнить счёт.</p>}
  {data?.sampledAt&&<p className="mt-1 text-xs text-[var(--ac-muted)]">{error?'Последние данные':'Обновлено'}: {new Date(data.sampledAt).toLocaleString('ru-RU')}</p>}
  {error&&<p role="status" className="mt-2 text-sm text-amber-500">{error}</p>}
  {editing&&<form onSubmit={connect} className="mt-3 max-w-lg space-y-2"><label className="block text-sm">API-ключ облачного окружения REG<input type="password" autoComplete="off" maxLength={2048} required value={token} onChange={e=>setToken(e.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--ac-border)] bg-[var(--ac-bg)] px-3 py-2"/></label><p className="text-xs text-[var(--ac-muted)]">REG → Настройки → Настройки окружения. Ключ хранится зашифрованным и используется только для чтения баланса.</p><button disabled={saving||!token.trim()} className="rounded-lg bg-[var(--ac-primary)] px-3 py-2 text-sm font-semibold disabled:opacity-50">{saving?'Проверяем…':'Сохранить'}</button></form>}
 </div>;
}
