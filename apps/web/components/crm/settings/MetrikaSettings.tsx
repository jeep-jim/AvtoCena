"use client";
import {useState} from 'react';
type Status={enabled:boolean;counterId:number;lastAcceptedAt:string|null;lastUploadId:string|null;lastError:string|null;pending:number;missingClientId:number;acceptedOrders:number};
export function MetrikaSettings({initial}:{initial:Status}) {
 const [status,setStatus]=useState(initial);const [token,setToken]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 async function save(action:string){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/crm/settings/metrika',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,token})});const data=await response.json();if(!response.ok)throw Error(data.error);setStatus(data);setToken('');setNotice(action==='connect'?'Метрика успешно подключена. Передача включена. Токен сохранён — повторно вводить его не нужно.':'Передача приостановлена.');}catch(e){setError(`Подключение не завершено: ${e instanceof Error?e.message:'ошибка сети'}. Проверьте доступ к счётчику и право metrika:write.`);}finally{setBusy(false);}}
 return <section className="rounded-3xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5 space-y-5">
  <div className={`crm-metrika-status${status.enabled?' is-connected':''}`}>
   <span className="crm-metrika-status-icon" aria-hidden="true">{status.enabled?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 4 4L19 6"/></svg>:'!'}</span>
   <div><p className="font-bold text-lg">{status.enabled?'Метрика подключена':'Метрика не подключена'}</p><p className="text-sm">Счётчик {status.counterId} · {status.enabled?'Передача включена':'Передача выключена'}</p></div>
  </div>
  <p>Менеджер меняет статус заявки, CRM передаёт результат в Метрику. Отправка выполняется фоновым заданием; при ошибке система повторяет попытку.</p>
  <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Статус в CRM</th><th className="p-2">Цель в Метрике</th></tr></thead><tbody><tr><td className="p-2">Квалифицированный лид</td><td className="p-2">Квалифицированный лид</td></tr><tr><td className="p-2">Договор подписан / Оплата получена</td><td className="p-2">Договор / оплата</td></tr><tr><td className="p-2">Спам</td><td className="p-2">Спам</td></tr></tbody></table></div>
  <p className="text-sm">«Спам» выбирайте вручную с причиной. Отказ и отсутствие ответа сами по себе спамом не считаются.</p>
  <p className="text-sm">Для подключения нужен OAuth-токен аккаунта с правом редактирования счётчика и разрешением <code>metrika:write</code>. Цели создадутся автоматически. <a className="underline" href="https://yandex.ru/dev/metrika/ru/intro/quick-start" target="_blank" rel="noopener noreferrer">Инструкция Яндекса</a>.</p>
  <form onSubmit={e=>{e.preventDefault();void save('connect');}} className="flex flex-wrap gap-3"><label className="min-w-0 flex-1">OAuth-токен<input type="password" autoComplete="off" required value={token} onChange={e=>setToken(e.target.value)} className="soft-input mt-2 w-full rounded-xl px-3 py-3" /></label><button disabled={busy} className="self-end rounded-xl bg-red-500 px-5 py-3 font-bold text-white">{busy?'Проверяем…':status.enabled?'Обновить подключение':'Подключить Метрику'}</button></form>
  <div role="status" aria-live="polite" aria-atomic="true">{notice?<p className="crm-metrika-notice">{notice}</p>:null}</div>
  {status.enabled?<button disabled={busy} onClick={()=>void save('disable')} className="underline text-sm">Приостановить передачу</button>:null}
  {error?<p role="alert" className="text-red-500">{error}</p>:null}
  <div className="text-sm space-y-2"><p>Последняя принятая загрузка: {status.lastAcceptedAt?new Date(status.lastAcceptedAt).toLocaleString('ru-RU'):'ещё не отправлялась'}</p><p>Заявок принято API: {status.acceptedOrders}. Ожидают отправки: {status.pending}.</p><p>Без ClientID: {status.missingClientId}. Такие заявки не отправляются: для привязки нужен идентификатор визита.</p>{status.lastError?<p className="text-red-500">Ошибка последней отправки: {status.lastError}</p>:null}<p>Приём файла API не означает, что Яндекс уже сопоставил все заявки с визитами. Результат обработки проверяется в Метрике.</p></div>
 </section>;
}
