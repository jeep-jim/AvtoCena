'use client';
import type {AjesRequestDiagnostic} from '@/lib/catalog/ajes-request-diagnostic';
import {useEffect,useState} from 'react';
import type {AjesMarketPreview,AjesPreviewMarket,AjesPreviewDiagnostic} from '@/lib/catalog/ajes-market-preview';
export function AjesMarketConnectionSettings({market}:{market:AjesPreviewMarket}){
 const [configured,setConfigured]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<AjesMarketPreview|null>(null);
 const endpoint=`/api/crm/ajes/markets/${market}`;
 const [catalogDiagnostic,setCatalogDiagnostic]=useState<AjesRequestDiagnostic|null>(null);
 const [diagnostic,setDiagnostic]=useState<AjesPreviewDiagnostic|null>(null);
 useEffect(()=>{fetch(endpoint,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const b=await r.json();setConfigured(b.configured===true);setCatalogDiagnostic(b.catalogDiagnostic||null);setDiagnostic(b.diagnostic||null);}).catch(()=>setMessage('Не удалось прочитать подключение'));},[endpoint]);
 async function check(){setBusy(true);setMessage('');setPreview(null);try{const r=await fetch(endpoint,{method:'POST'}),b=await r.json();setDiagnostic(b.diagnostic||null);if(!r.ok)throw Error(b.error);setPreview(b.preview);setMessage(b.preview.received?'Образец получен. Доступ к источнику работает.':'Таблица ответила без записей. Готовность каталога не подтверждена.');}catch(e){setMessage(e instanceof Error?e.message:'Проверка не выполнена');}finally{setBusy(false);}}
 return <section className="my-3 space-y-2 rounded-lg border border-[var(--ac-border)] p-3">
  <p className="font-semibold">AJ System · подключение фида</p>
  <p className="text-sm">{configured===null?'Проверяем настройки…':configured?'Используется сохранённый общий доступ AJ System.':'Настройте общий доступ AJ System в разделе Японии.'}</p>
  <label className="block text-sm">Таблица поставщика<input readOnly value={market} className="mt-1 block w-full rounded border border-[var(--ac-border)] bg-transparent p-2"/></label>
  <p className="text-xs text-[var(--ac-muted)]">Переключатель ниже управляет доступом к каталогу AJ System. Проверка образца не меняет поставщиков. Действующий Китай сохраняется отдельно.</p>
  <a href={`/cars?market=${market}&source=ajes`} target="_blank" rel="noreferrer" className="inline-block rounded border px-3 py-2 text-sm">Открыть каталог</a>
  <button type="button" disabled={busy||configured!==true} onClick={()=>void check()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy?'Проверяем…':'Проверить 5 автомобилей'}</button>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {diagnostic&&<details className="text-sm"><summary className="cursor-pointer underline">Последний запрос · данные для поддержки</summary>
   <p className="mt-2">{diagnostic.requestStarted?'Запрос отправлен; HTTP-статус указан, если ответ получен.':'Запрос остановлен на нашем сайте до отправки поставщику.'}</p>
   <textarea aria-label="Данные запроса для поддержки" readOnly rows={9} className="mt-2 w-full rounded border border-[var(--ac-border)] bg-transparent p-2 text-xs" value={[
    `Рынок: ${diagnostic.market}`,`Начало (UTC): ${diagnostic.startedAt}`,`Завершение (UTC): ${diagnostic.finishedAt}`,
    `Адрес API: ${diagnostic.endpoint}`,`SQL: ${diagnostic.sql}`,`IP посетителя: ${diagnostic.clientIp}`,
    `Запрос начат: ${diagnostic.requestStarted?'да':'нет'}`,`HTTP: ${diagnostic.httpStatus??'ответ не получен'}`,
    `Код поставщика: ${diagnostic.providerCode??'не получен'}`,`Результат проверки: ${diagnostic.outcome}`,
   ].join('\n')}/>
  </details>}
  {catalogDiagnostic&&<details className="text-sm"><summary className="cursor-pointer underline">Последний сбой страницы каталога</summary>
   <p className="mt-2">Реальный запрос каталога, отдельно от проверки пяти автомобилей. Код отказа сам по себе не устанавливает, на чьей стороне ошибка.</p>
   <textarea aria-label="Диагностика страницы каталога" readOnly rows={10} className="mt-2 w-full rounded border border-[var(--ac-border)] bg-transparent p-2 text-xs" value={[
    `Таблица: ${catalogDiagnostic.table}`,`Страница: ${catalogDiagnostic.page}; размер: ${catalogDiagnostic.pageSize}`,`Начало UTC: ${catalogDiagnostic.startedAt}`,`Завершение UTC: ${catalogDiagnostic.finishedAt}`,
    `Адрес API: ${catalogDiagnostic.endpoint}`,`SQL: ${catalogDiagnostic.sql}`,`IP посетителя: ${catalogDiagnostic.clientIp}`,`HTTP: ${catalogDiagnostic.httpStatus??'ответ не получен'}`,`Код ответа: ${catalogDiagnostic.providerCode??'не получен'}`,`Результат: ${catalogDiagnostic.outcome}`,
   ].join('\n')}/>
  </details>}
  {preview&&<details className="text-sm"><summary className="cursor-pointer underline">Образец · {preview.received} записей</summary><p className="mt-2">Получен {new Date(preview.observedAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</p><p className="break-words">Поля ответа: {preview.fields.join(', ')}</p><div className="mt-2 space-y-3">{preview.rows.map((row,i)=><dl key={i} className="rounded border p-2">{Object.entries(row).map(([key,value])=><div key={key} className="break-words"><dt className="inline font-semibold">{key}: </dt><dd className="inline">{value===null||value===''?'Не заполнено':String(value)}</dd></div>)}</dl>)}</div></details>}
 </section>;
}
