'use client';
import {AjesConnectionSettings} from './AjesConnectionSettings';
import {useEffect,useRef,useState} from 'react';
import {COLLECTION_MARKETS,COLLECTION_SOURCES,COLLECTION_WORKFLOWS,collectionEnabled,type CollectionControls as Controls,type CollectionSwitch} from '@/lib/catalog/collection-controls-schema';
import type {ChinaCatalogStatus} from '@/lib/catalog/china-catalog-status';
const date=(value:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}):'Переключений ещё не было';
export function CollectionControls(){
  const [open,setOpen]=useState(false),[data,setData]=useState<Controls|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [chinaStatus,setChinaStatus]=useState<ChinaCatalogStatus|null>(null),chinaStatusRequest=useRef(0);
  async function loadChinaStatus(){
    const request=++chinaStatusRequest.current;setChinaStatus(null);
    try{
      const r=await fetch('/api/crm/china-catalog-status',{cache:'no-store'}),body=await r.json();
      const valid=r.ok&&body?.status==='ready'&&typeof body.sourceObservedAt==='string'&&Number.isFinite(Date.parse(body.sourceObservedAt))&&Number.isSafeInteger(body.rows)&&body.rows>=0&&typeof body.generationId==='string';
      if(request===chinaStatusRequest.current)setChinaStatus(valid?{status:'ready',sourceObservedAt:body.sourceObservedAt,rows:body.rows,generationId:body.generationId}:{status:'unavailable'});
    }catch{if(request===chinaStatusRequest.current)setChinaStatus({status:'unavailable'});}
  }
  async function load(){void loadChinaStatus();setBusy(true);setError('');try{const r=await fetch('/api/crm/collection-controls',{cache:'no-store'});const body=await r.json();if(!r.ok)throw Error(body.error);setData(body);}catch(e){setError(e instanceof Error?e.message:'Не удалось прочитать настройки');setData(null);}finally{setBusy(false);}}
  useEffect(()=>{if(open)void load();},[open]);
  async function toggle(scope:'market'|'source',id:string,enabled:boolean){
    if(!data||busy)return;setBusy(true);setError('');setNotice('');
    try{const r=await fetch('/api/crm/collection-controls',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,id,enabled,revision:data.revision})});const body=await r.json();if(!r.ok)throw Error(body.error);setData(body);setNotice('Сохранено. Новые задания учтут настройку; уже отправленные запросы могут завершиться.');}
    catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');setData(null);}finally{setBusy(false);}
  }
  const button=(scope:'market'|'source',id:string,value:CollectionSwitch,label:string)=><button type="button" role="switch" aria-checked={value.enabled} aria-label={label} disabled={busy} onClick={()=>void toggle(scope,id,!value.enabled)} className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold disabled:opacity-50 ${value.enabled?'border-emerald-600 text-emerald-700':'border-slate-400 text-slate-600'}`}>{value.enabled?'Включено':'Выключено'}</button>;
  const dates=(value:CollectionSwitch)=><dl className="mt-2 grid gap-1 text-xs text-[var(--ac-muted)]"><div>Последнее включение: {date(value.enabledAt)}</div><div>Последнее выключение: {date(value.disabledAt)}</div></dl>;
  return <details className="mb-5 rounded-xl border border-[var(--ac-border)] p-4" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-bold">Обновление каталога · парсеры и фиды</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm">Управление доступно только владельцу. Выключение останавливает сбор, но не скрывает уже опубликованные автомобили. Для них продолжают действовать сроки актуальности. Включение разрешает следующий плановый запуск, а не запускает сбор немедленно. Исключение — AJ System для Японии: лоты запрашиваются при поиске, и выключение приостанавливает просмотр аукционов.</p>
      <p className="text-sm text-[var(--ac-muted)]">Время указано по Красноярску. Китайские парсеры — резерв: они не включаются автоматически при сбое фида. Работающий сборщик проверяет настройки перед очередной страницей или карточкой; возможна задержка до 5 секунд и завершения текущего запроса. Задания, запущенные до установки этих выключателей, их не учитывают.</p>
      <button type="button" disabled={busy} onClick={()=>void load()} className="text-sm underline disabled:opacity-50">{busy?'Подождите…':'Обновить состояние'}</button>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
      {data&&<div className="grid gap-4 xl:grid-cols-2">{COLLECTION_MARKETS.map(m=><section key={m.id} className="min-w-0 rounded-lg border border-[var(--ac-border)] p-3">
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold">{m.label}</h3>{button('market',m.id,data.markets[m.id],`Обновление рынка ${m.label}`)}</div>
        {!data.markets[m.id].enabled&&<p className="mt-2 text-sm">Сбор всего рынка остановлен. Выбор отдельных источников сохранён.</p>}{dates(data.markets[m.id])}
        {m.id==='china'&&<div className="mt-2 text-xs" aria-live="polite">{chinaStatus?.status==='ready'?<><p>Данные поставщика на: {date(chinaStatus.sourceObservedAt)}</p><p>Автомобилей в каталоге: {chinaStatus.rows.toLocaleString('ru-RU')}</p></>:<p>{chinaStatus===null?'Проверяем дату данных…':'Дата данных недоступна'}</p>}</div>}
        <p className="mt-2 text-xs"><a className="underline" href={`https://github.com/jeep-jim/AvtoCena/actions/workflows/${COLLECTION_WORKFLOWS[m.id]}`} target="_blank" rel="noreferrer">{m.id==='china'?'Запуски и обновление в GitHub':'Открыть ручной запуск в GitHub'}</a>{m.id==='japan'&&<> · <a className="underline" href="https://github.com/jeep-jim/AvtoCena/actions/workflows/catalog-refresh-green.yml" target="_blank" rel="noreferrer">Зелёный угол</a></>}</p>
        {m.id==='japan'&&<AjesConnectionSettings/>}
        <div className="mt-3 divide-y divide-[var(--ac-border)]">{COLLECTION_SOURCES.filter(s=>s.market===m.id).map(s=><div key={s.id} className="py-3">
          <div className="flex items-start justify-between gap-2"><strong className="text-sm">{s.label}</strong>{button('source',s.id,data.sources[s.id],s.label)}</div>
          <p className="mt-1 text-xs">{collectionEnabled(data,s.id)?'Сбор разрешён':data.sources[s.id].enabled?'Остановлен выключателем рынка':'Сбор выключен'}</p>
          {!s.id.startsWith('ajes_')&&!s.defaultEnabled&&!data.sources[s.id].disabledAt&&!data.sources[s.id].enabledAt&&<p className="mt-1 text-xs">Выключен по решению владельца от 10.10.2026.</p>}
          <details className="mt-2 text-sm"><summary className="cursor-pointer underline">Источник, частота и настройки</summary><div className="mt-2 space-y-2"><p>{s.description}</p><a className="break-all underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a><p>{s.frequency}.{!['autohome_used_china_open','autohome_new_china_open'].includes(s.id)&&' Плановое время может сдвигаться.'}</p>{s.id==='che168_feed'&&<p>Резервная проверка — каждые 3 часа. Если данные уже обновлены после последних 21:00, повторный сбор не начинается.</p>}<p>{s.settings}</p>{dates(data.sources[s.id])}<p className="text-xs text-[var(--ac-muted)]">Ограничения безопасности, проверки цены и сроки актуальности сохраняются при включении.</p></div></details>
        </div>)}</div>
      </section>)}</div>}
      {data&&<details className="text-sm"><summary className="cursor-pointer underline">История переключений · последние 200</summary><ul className="mt-2 space-y-2">{data.history.length?data.history.filter(h=>h.scope!=="source"||COLLECTION_SOURCES.some(source=>source.id===h.id)).map(h=><li key={h.revision}>{date(h.at)} · {(h.scope==='market'?COLLECTION_MARKETS:COLLECTION_SOURCES).find(s=>s.id===h.id)?.label||h.id} · {h.enabled?'включено':'выключено'}</li>):<li>Ручных переключений ещё не было.</li>}</ul></details>}
    </div>
  </details>;
}
