"use client";

import {useEffect, useRef, useState} from 'react';
import type {KoreaReport} from '../../lib/catalog/korea-report-types';

export default function KoreaReportPanel({offerId,active}:{offerId:string;active:boolean}) {
 const [report,setReport]=useState<KoreaReport|null>(null);
 const [error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 const requested=useRef(false);
 const [started,setStarted]=useState(active);
 useEffect(()=>{if(active)setStarted(true);},[active]);
 useEffect(()=>{requested.current=false;setReport(null);setError(false);},[offerId]);
 useEffect(()=>{
  if(!started||requested.current)return;
  requested.current=true;setError(false);
  const controller=new AbortController();
  fetch(`/api/catalog/korea-report?id=${encodeURIComponent(offerId)}`,{signal:controller.signal,credentials:'same-origin',cache:'no-store'})
   .then(async response=>{if(!response.ok)throw Error('report');const value=await response.json();if(value.offerId!==offerId||value.version!==1)throw Error('report');setReport(value);})
   .catch(()=>{if(!controller.signal.aborted)setError(true);});
  // Keep a single request while the disclosure is closed/reopened. Abort on navigation.
  return ()=>{controller.abort();requested.current=false;};
 },[offerId,attempt,started]);
 return <section aria-label="История и состояние" className="min-w-0 rounded-2xl border border-[var(--ac-border)] p-4 text-[var(--ac-text)] sm:p-5" data-korea-report-panel>
  <h2 className="text-lg font-bold">История и состояние</h2>
  {!report&&!error?<p role="status" className="mt-3 text-sm text-[var(--ac-muted)]">Загружаем историю и осмотр автомобиля…</p>:null}
  {error?<div className="mt-3 text-sm"><p role="status">Не удалось загрузить отчёт. Попробуйте ещё раз позже.</p><button type="button" className="mt-3 rounded-xl bg-[var(--ac-surface-2)] px-4 py-2 font-bold" onClick={()=>{requested.current=false;setAttempt(x=>x+1);}}>Повторить</button></div>:null}
  {report?<>
   <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Получено {new Date(report.observedAt).toLocaleString('ru-RU')}. Отсутствие сведений не подтверждает отсутствие повреждений. Перед покупкой состояние проверит менеджер.</p>
   {report.sections.map(section=><section key={section.kind} className="mt-4 rounded-xl border border-[var(--ac-border)] p-4">
    <h3 className="text-sm font-bold">{section.title}</h3>
    {section.status!=='available'?<p className="mt-3 text-sm text-[var(--ac-muted)]">{section.status==='unavailable'?'Отчёт временно недоступен.':'Сведения не предоставлены.'}</p>:null}
    {section.rows.length?<dl className="mt-3 divide-y divide-[var(--ac-border)]">{section.rows.map((row,i)=><div key={i} className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 py-3 text-sm"><dt className="min-w-0 text-[var(--ac-muted)]">{row.label}</dt><dd className="min-w-0 break-words font-medium">{row.value}</dd></div>)}</dl>:null}
    {section.description?<p className="mt-3 whitespace-pre-line break-words text-sm leading-6">{section.description}</p>:null}
   </section>)}
  </>:null}
 </section>;
}
