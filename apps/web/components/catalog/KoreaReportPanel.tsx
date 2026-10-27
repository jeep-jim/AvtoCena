"use client";

import {useEffect, useId, useRef, useState} from 'react';
import {ChevronDown, ExternalLink} from 'lucide-react';
import {validKoreaReportLink, type KoreaReportLink, type KoreaSourceReportKind} from '../../lib/catalog/korea-report-types';

function ReportSection({offerId,lot,kind,title}:{offerId:string;lot:string;kind:KoreaSourceReportKind;title:string}) {
 const [open,setOpen] = useState(false), [started,setStarted] = useState(false);
 const [report,setReport] = useState<KoreaReportLink|null>(null);
 const [error,setError] = useState<'missing'|'unavailable'|null>(null);
 const [attempt,setAttempt] = useState(0);
 const requested = useRef(false), contentId = useId();
 useEffect(()=>{
  if (!started || requested.current) return;
  requested.current = true; setError(null);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort('timeout'),25000);
  let mounted = true;
  const p = new URLSearchParams({id:offerId,lot,kind});
  fetch(`/api/catalog/korea-report?${p}`,{signal:controller.signal,credentials:'same-origin',cache:'no-store'})
   .then(async response=>{
    if (response.status===404) {if(mounted)setError('missing'); return;}
    if (!response.ok) throw Error('report');
    const value:unknown = await response.json();
    if (!validKoreaReportLink(value,offerId,lot,kind)) throw Error('report');
    if(mounted)setReport(value);
   })
   .catch(()=>{if(mounted)setError('unavailable');})
   .finally(()=>clearTimeout(timer));
  // Closing the disclosure preserves its single pending request and loaded frame.
  return ()=>{mounted=false;clearTimeout(timer);controller.abort();requested.current=false;};
 },[offerId,lot,kind,attempt,started]);
 return <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-[var(--ac-border)]" data-korea-report-section={kind}>
  <button type="button" aria-expanded={open} aria-controls={contentId} onClick={()=>{setStarted(true);setOpen(value=>!value);}} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-400">
   {title}<ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open?'rotate-180':''}`}/>
  </button>
  <div id={contentId} hidden={!open} className="min-w-0 border-t border-[var(--ac-border)] p-3 sm:p-4">
   {started&&!report&&!error?<p role="status" className="text-sm text-[var(--ac-muted)]">Загружаем отчёт…</p>:null}
   {error?<div className="text-sm"><p role="status">{error==='missing'?'Для этого автомобиля ссылка на отчёт не предоставлена.':'Не удалось загрузить отчёт. Попробуйте ещё раз позже.'}</p><button type="button" className="mt-3 rounded-xl bg-[var(--ac-surface-2)] px-4 py-2 font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-400" onClick={()=>{requested.current=false;setAttempt(value=>value+1);}}>Повторить</button></div>:null}
   {report?<>
    {report.document?.lot===lot&&report.document.kind===kind&&report.document.fields.length>0?<>
     <dl className="divide-y divide-[var(--ac-border)]" data-korea-russian-facts>{report.document.fields.map(field=><div key={field.key} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><dt>{field.label}</dt><dd className="font-semibold">{field.value}</dd></div>)}</dl>
     <p className="my-3 text-xs leading-5 text-[var(--ac-muted)]">Переведены доступные текстовые поля осмотра. Схема повреждений и сведения со сканов пока не расшифрованы. Это не полный отчёт и не подтверждение отсутствия ДТП.</p>
    </>:<p role="status" className="mb-3 text-sm leading-6">{kind==='history'?'Страховые случаи пока не удалось загрузить в русскую форму. Это не означает, что страховых случаев не было.':'Текст осмотра пока недоступен для перевода. Сведения могут быть представлены только сканами.'}</p>}
    <a href={report.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--ac-surface-2)] px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-400">Оригинал отчёта<ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0"/></a>
   </>:null}
  </div>
 </section>;
}
export default function KoreaReportPanel({offerId,lot,active}:{offerId:string;lot:string;active:boolean}) {
 return <section aria-label="История и состояние" className="min-w-0 rounded-2xl border border-[var(--ac-border)] p-4 text-[var(--ac-text)] sm:p-5" data-korea-report-panel data-active={active}>
  <h2 className="text-lg font-bold">История и состояние</h2>
  <p className="mt-2 text-sm leading-6 text-[var(--ac-muted)]">Выберите отчёт. Доступные сведения осмотра показаны на русском. Оригинал можно открыть отдельно.</p>
  <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Отсутствие сведений не подтверждает отсутствие повреждений. Перед покупкой состояние автомобиля нужно проверить.</p>
  <ReportSection key={`${offerId}:${lot}:history`} offerId={offerId} lot={lot} kind="history" title="Страховая история" />
  <ReportSection key={`${offerId}:${lot}:inspection`} offerId={offerId} lot={lot} kind="inspection" title="Осмотр автомобиля" />
 </section>;
}
