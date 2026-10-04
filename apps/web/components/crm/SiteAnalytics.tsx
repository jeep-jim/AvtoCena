'use client';
import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {ChevronDown} from 'lucide-react';
import type {AnalyticsReport,AnalyticsRows} from '@/lib/metrika-reports';

function Ranking({title,data,unit}:{title:string;data?:AnalyticsRows;unit:string}){
 const [open,setOpen]=useState(true),id=useId(),panel=useRef<HTMLElement>(null);
 function toggle(){
  const element=panel.current;
  const offset=element?parseFloat(getComputedStyle(element).getPropertyValue('--analytics-top'))||0:0;
  const restore=Boolean(open&&element&&element.getBoundingClientRect().top<offset);
  const target=element?Math.max(0,window.scrollY+element.getBoundingClientRect().top-offset):0;
  setOpen(!open);
  // When collapsing a long report from its pinned heading, keep that report in view.
  if(restore)requestAnimationFrame(()=>window.scrollTo({top:target,behavior:'instant'}));
 }
 return <section ref={panel} className="crm-analytics-report" data-open={open} aria-label={title}>
  <h3 className="crm-analytics-report-heading"><button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}><span>{title}<small>{unit} · первые 30{data?.sampled?' · выборочные данные':''}</small></span><ChevronDown size={20} aria-hidden="true"/></button></h3>
  <div id={id} hidden={!open} className="crm-analytics-report-body">{data?.rows.length?<ol>{data.rows.map((r,i)=><li key={i}><div>{r.path?<a href={r.path} target="_blank" rel="noreferrer" className="underline">{r.label}</a>:r.label}{r.detail&&<small className="block text-[var(--ac-muted)]">{r.detail}</small>}</div><strong className="tabular-nums">{r.count.toLocaleString('ru-RU')}</strong></li>)}</ol>:<p className="py-4 text-sm text-[var(--ac-muted)]">За этот период данных нет.</p>}</div>
 </section>;
}

export function SiteAnalytics(){
 const [days,setDays]=useState(7),[revision,setRevision]=useState(0),[data,setData]=useState<AnalyticsReport|null>(null),[error,setError]=useState(''),[top,setTop]=useState(124);
 useEffect(()=>{
  const header=document.querySelector('.crm-header');
  const measure=()=>setTop(Math.ceil(header?.getBoundingClientRect().height||0)+8);
  measure();const observer=new ResizeObserver(measure);if(header)observer.observe(header);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure)};
 },[]);
 useEffect(()=>{const c=new AbortController();setData(null);setError('');fetch(`/api/crm/analytics?days=${days}`,{signal:c.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(setData).catch(e=>{if(e.name!=='AbortError')setError('Не удалось загрузить аналитику. Попробуйте ещё раз.')});return()=>c.abort()},[days,revision]);
 return <section className="crm-analytics mt-6" aria-label="Аналитика сайта" style={{'--analytics-top':`${top}px`} as CSSProperties}>
  <div className="crm-analytics-summary rounded-2xl border border-[var(--ac-border)] p-4 md:p-6">
   <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Аналитика сайта <span className="text-xs font-normal text-[var(--ac-muted)]">Тестовый раздел</span></h2><p className="mt-2 text-sm text-[var(--ac-muted)]">Яндекс Метрика · учитываются зарегистрированные счётчиком посещения. Посетители показаны без имён и контактов.</p></div><div className="flex gap-2"><select className="soft-input rounded-xl p-2" aria-label="Период аналитики" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={1}>Сегодня</option><option value={7}>7 дней</option><option value={30}>30 дней</option></select><button className="soft-input rounded-xl p-2" onClick={()=>setRevision(x=>x+1)}>Обновить</button></div></header>
   {error?<p role="alert" className="mt-4">{error}</p>:!data?<p role="status" className="mt-4">Загружаем отчёты…</p>:data.status!=='ready'?<p role="status" className="mt-4">{data.message}</p>:<div className="mt-5 grid grid-cols-3 gap-2">{[['Визиты',data.totals!.visits],['Посетители',data.totals!.users],['Просмотры',data.totals!.views]].map(([label,n])=><div key={label} className="min-w-0 rounded-xl bg-[var(--ac-surface-2)] p-2 md:p-3"><span className="text-xs">{label}</span><strong className="block break-words text-lg md:text-xl">{Number(n).toLocaleString('ru-RU')}</strong></div>)}</div>}
  </div>
  {data?.status==='ready'&&<><div className="crm-analytics-reports mt-4 grid items-start gap-4 lg:grid-cols-2"><Ranking title="Страницы и разделы" data={data.pages} unit="Просмотры"/><Ranking title="Города посетителей" data={data.cities} unit="Визиты"/><Ranking title="Источники трафика" data={data.sources} unit="Визиты"/><Ranking title="Автомобили и города просмотра" data={data.cars} unit="Просмотры по автомобилю и городу"/></div><p className="mt-3 text-xs text-[var(--ac-muted)]">Получено {new Date(data.updatedAt).toLocaleString('ru-RU')} · отчёт обновляется не чаще раза в 5 минут.</p></>}
 </section>;
}
