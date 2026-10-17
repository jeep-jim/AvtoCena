'use client';
import Link from 'next/link';
import {useState} from 'react';
import type {RecoveryRequest} from '@/lib/account/manual-recovery';
import {CustomerManualRecovery} from './CustomerManualRecovery';
const labels:Record<RecoveryRequest['status'],string>={new:'Ожидает проверки',issuing:'Выдача пароля не завершена',issued:'Пароль выдан, письмо ещё не отмечено отправленным',completed:'Письмо отправлено вручную',rejected:'Заявка отклонена'};
export function RecoveryRequestCard({request,canManage,showProfile=false}:{request:RecoveryRequest;canManage:boolean;showProfile?:boolean}){
 const [row,setRow]=useState(request),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('');
 async function finish(status:'completed'|'rejected'){if(busy)return;setBusy(true);setError('');try{const r=await fetch(`/api/crm/recovery-requests/${row.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,reason:status==='completed'?'Сотрудник подтвердил ручную отправку письма на адрес из заявки.':reason})}),d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось сохранить результат.');setRow(d.request);}catch(e){setError(e instanceof Error?e.message:'Ошибка соединения.');}finally{setBusy(false);}}
 return <article className="my-3 rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-4">
  <strong>{labels[row.status]}</strong><p className="my-2 text-sm">{new Date(row.createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})} · Красноярск</p>
  <p>{row.accountName||'Обращение в поддержку'} · {row.phone}</p><p className="my-2 break-all">Почта для временного пароля: <strong>{row.email}</strong></p>
  <p className="text-sm text-[var(--ac-muted)]">Адрес указан в заявке и не подтверждает владельца кабинета. Проверьте личность до отправки пароля.</p>
  {!row.accountId&&<p className="my-2">Кабинет по этому телефону не найден. Уточните номер у заявителя.</p>}
  {showProfile&&row.accountId&&<Link className="my-3 inline-block underline" href={`/crm/clients/registered/${row.accountId}#recovery-requests`}>Открыть профиль пользователя →</Link>}
  {canManage&&row.accountId&&['new','issuing','issued'].includes(row.status)&&<CustomerManualRecovery accountId={row.accountId} requestId={row.id} email={row.email} onIssued={()=>setRow({...row,status:'issued'})}/>}
  {canManage&&row.status==='issued'&&<button type="button" className="avto-button mt-3 rounded-xl px-4 py-2" disabled={busy} onClick={()=>{if(window.confirm(`Вы уже отправили письмо на ${row.email}? Эта кнопка только сохраняет отметку и не отправляет письмо.`))void finish('completed');}}>Письмо отправлено вручную</button>}
  {canManage&&row.status==='new'&&<details className="mt-3"><summary className="cursor-pointer">Отклонить заявку</summary><label className="mt-2 block">Причина<input className="soft-input my-2 w-full rounded-xl p-3" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className="rounded-xl border border-[var(--ac-border)] px-4 py-2" disabled={busy||!reason.trim()} onClick={()=>void finish('rejected')}>Отклонить</button></details>}
  {row.reason&&['completed','rejected'].includes(row.status)&&<p className="mt-3 text-sm">{row.reason}</p>}{error&&<p role="alert" className="mt-3 text-red-600">{error}</p>}
 </article>;
}
