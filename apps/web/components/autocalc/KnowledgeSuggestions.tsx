'use client';
import {useEffect,useState} from 'react';
import type {KnowledgeChoice,KnowledgeMatches} from '../../lib/autocalc/knowledge';
import {AUTOCALC_MARKETS} from '../../lib/autocalc/sources';
export function KnowledgeSuggestions({title,make,year,market,disabled,onChoose,onPreview}:{title:string;make?:string;year?:string;market:string;disabled:boolean;onChoose:(choice:KnowledgeChoice)=>void;onPreview:(image?:string,label?:string)=>void}){
 const [data,setData]=useState<KnowledgeMatches|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setData(null);setError('');onPreview();if(disabled||title.trim().length<2){setBusy(false);return;}const controller=new AbortController();const timer=setTimeout(async()=>{
  setBusy(true);try{const params=new URLSearchParams({q:title.trim(),...(make?{make}:{}),...(year?{year}:{}),...(market?{market}:{})});const response=await fetch(`/api/autocalc/knowledge?${params}`,{signal:controller.signal});const next=await response.json();if(!response.ok)throw Error(next.error);if(controller.signal.aborted)return;setData(next);onPreview(next.image,next.imageLabel);}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось получить подсказки');}finally{if(!controller.signal.aborted)setBusy(false);}
 },800);return()=>{clearTimeout(timer);controller.abort();};},[title,make,year,market,disabled]);
 if(!title.trim()||title.trim().length<2)return null;
 return <section className="mb-5 rounded-2xl bg-[var(--ac-surface-2)] p-4" aria-label="Подсказки из базы знаний">
 <p className="text-sm font-bold">Из базы знаний АвтоЦены</p>
 {busy?<p role="status" className="mt-2 text-xs text-[var(--ac-muted)]">Ищем модель и подходящие варианты…</p>:null}
 {error?<p className="mt-2 text-xs text-[var(--ac-muted)]">{error}</p>:null}
 {data&&!data.models.length?<p className="mt-2 text-xs text-[var(--ac-muted)]">Совпадений пока нет. Укажите марку, модель и год или заполните характеристики самостоятельно.</p>:null}
 {data&&data.models.length>1?<><p className="mt-2 text-xs text-[var(--ac-muted)]">Есть несколько моделей. Уточните название:</p><div className="mt-2 flex flex-wrap gap-2">{data.models.map(m=><a key={m.id} href={m.href} target="_blank" rel="noopener noreferrer" className="text-sm underline">{m.title}</a>)}</div></>:null}
 {data?.models.length===1&&!data.choices.length?<p className="mt-2 text-xs text-[var(--ac-muted)]">Модель найдена, но для этих года и рынка характеристик пока недостаточно. Их можно указать вручную.</p>:null}
 {!!data?.choices.length?<><p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Выберите подходящий вариант. Это подсказка: проверьте комплектацию и цену. Уже заполненные характеристики сохранятся.</p><div className="mt-3 max-h-80 space-y-3 overflow-auto">{data.choices.map(choice=><article key={`${choice.kind}:${choice.id}`} className="rounded-xl bg-[var(--ac-surface)] p-3 text-xs">
 <p className="font-bold">{choice.title}</p><p className="mt-1 text-[var(--ac-muted)]">{choice.label}</p>
 <p className="mt-2">{[choice.market&&(AUTOCALC_MARKETS as Record<string,string>)[choice.market],choice.draft.year&&`${choice.draft.year} г.`,choice.draft.engineCc&&`${choice.draft.engineCc} см³`,choice.draft.powerHp&&`${choice.draft.powerHp} л.с.`,choice.draft.fuel&&({petrol:'Бензин',diesel:'Дизель',hybrid:'Гибрид',electric:'Электро'} as Record<string,string>)[choice.draft.fuel],choice.price&&`${Number(choice.price).toLocaleString('ru-RU')} ${choice.currency||''}`].filter(Boolean).join(' · ')}</p>
 {choice.date?<p className="mt-1 text-[var(--ac-muted)]">Данные от {choice.date.slice(0,10)}</p>:null}
 <div className="mt-2 flex flex-wrap items-center justify-between gap-3">{choice.sourceUrl?<a href={choice.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Источник ↗</a>:null}<button type="button" onClick={()=>onChoose(choice)} className="min-h-11 rounded-lg border border-[var(--ac-border)] px-3 font-bold">Использовать вариант</button></div>
 </article>)}</div></>:null}
 </section>;
}
