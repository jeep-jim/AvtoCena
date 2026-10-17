'use client';
import {useEffect,useState} from 'react';
import type {AjesMarketPreview,AjesPreviewMarket} from '@/lib/catalog/ajes-market-preview';
export function AjesMarketConnectionSettings({market}:{market:AjesPreviewMarket}){
 const [configured,setConfigured]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<AjesMarketPreview|null>(null);
 const endpoint=`/api/crm/ajes/markets/${market}`;
 useEffect(()=>{fetch(endpoint,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const b=await r.json();setConfigured(b.configured===true);}).catch(()=>setMessage('Не удалось прочитать подключение'));},[endpoint]);
 async function check(){setBusy(true);setMessage('');setPreview(null);try{const r=await fetch(endpoint,{method:'POST'}),b=await r.json();if(!r.ok)throw Error(b.error);setPreview(b.preview);setMessage(b.preview.received?'Образец получен. Публикация автомобилей ещё не включена.':'Таблица ответила без записей. Готовность каталога не подтверждена.');}catch(e){setMessage(e instanceof Error?e.message:'Проверка не выполнена');}finally{setBusy(false);}}
 return <section className="my-3 space-y-2 rounded-lg border border-[var(--ac-border)] p-3">
  <p className="font-semibold">AJ System · проверка нового фида</p>
  <p className="text-sm">{configured===null?'Проверяем настройки…':configured?'Используется сохранённый общий доступ AJ System.':'Настройте общий доступ AJ System в разделе Японии.'}</p>
  <label className="block text-sm">Таблица поставщика<input readOnly value={market} className="mt-1 block w-full rounded border border-[var(--ac-border)] bg-transparent p-2"/></label>
  <p className="text-xs text-[var(--ac-muted)]">Включите источник ниже и проверьте образец. Эта проверка не добавляет автомобили в каталог и не отключает действующего поставщика. Цены и единицы новых данных ещё требуют проверки.</p>
  <button type="button" disabled={busy||configured!==true} onClick={()=>void check()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">{busy?'Проверяем…':'Проверить 5 автомобилей'}</button>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {preview&&<details className="text-sm"><summary className="cursor-pointer underline">Образец · {preview.received} записей</summary><p className="mt-2">Получен {new Date(preview.observedAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</p><p className="break-words">Поля ответа: {preview.fields.join(', ')}</p><div className="mt-2 space-y-3">{preview.rows.map((row,i)=><dl key={i} className="rounded border p-2">{Object.entries(row).map(([key,value])=><div key={key} className="break-words"><dt className="inline font-semibold">{key}: </dt><dd className="inline">{value===null||value===''?'Не заполнено':String(value)}</dd></div>)}</dl>)}</div></details>}
 </section>;
}
