'use client';
import { useEffect, useRef, useState } from 'react';
import { Car, Link2, FileDown } from 'lucide-react';
import { PublicHeader } from '../layout/PublicHeader';
import { VehicleGallery } from '../catalog/VehicleGallery';
import type { OfferCalculationDraft } from '../catalog/OfferCalculationForm';
import {OfferParameterEditors, type ParameterDraft} from '../catalog/InlineOfferParameters';
import {ResearchLink} from '../catalog/VehicleResearchLink';
import {powerUnitPatch,completePowerUnitDraft} from '../../lib/catalog/power-parameter-draft';
import {validateCustomerParameters} from '../../lib/catalog/customer-parameters';
import {SourceDirectory} from './SourceDirectory';
import { CitySelector } from '../home/CitySelector';
import type { SavedCalculationResult } from '../../lib/catalog/saved-offer-calculation';
const markets:Record<string,string>={japan:'Япония',china:'Китай',korea:'Корея',uae:'ОАЭ',europe:'Европа',georgia:'Грузия'};
const currencies=['JPY','CNY','KRW','USD','EUR','AED','GEL'];
const input='mt-1.5 h-12 w-full min-w-0 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 text-base text-[var(--ac-text)] outline-none focus:border-red-500';
const panel='rounded-3xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-5';
const rub=(n:number)=>`${Math.round(n).toLocaleString('ru-RU')} ₽`;
export function AutoCalcPage({initialUrl}:{initialUrl:string}){
 const [url,setUrl]=useState(initialUrl),[title,setTitle]=useState(''),[market,setMarket]=useState(''),[price,setPrice]=useState(''),[currency,setCurrency]=useState(''),[city,setCity]=useState('');
 const [images,setImages]=useState<string[]>([]),[draft,setDraft]=useState<Partial<OfferCalculationDraft>>({}),[notes,setNotes]=useState<string[]>([]),[facts,setFacts]=useState<{label:string;value:string}[]>([]);
 const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[result,setResult]=useState<SavedCalculationResult|null>(null);
 const calculationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [calculatedBody,setCalculatedBody]=useState<any>(null);const revision=useRef(0),controller=useRef<AbortController|null>(null);
 function invalidate(){revision.current++;setResult(null);setCalculatedBody(null);setError('');}
 async function load(link:string){
  controller.current?.abort();const c=new AbortController();controller.current=c;invalidate();setLoading(true);setMessage('Читаем объявление…');
  setTitle('');setMarket('');setPrice('');setCurrency('');setImages([]);setDraft({});setNotes([]);setFacts([]);
  try{const r=await fetch('/api/autocalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'extract',url:link}),signal:c.signal});const data=await r.json();if(!r.ok)throw Error(data.error);if(c.signal.aborted)return;
   setTitle(data.title||'');setMarket(data.market||'');setPrice(data.price||'');setCurrency(currencies.includes(data.currency)?data.currency:'');setImages(data.images||[]);setDraft(completePowerUnitDraft(data.draft||{}));setNotes(data.notes||[]);setFacts(data.facts||[]);setMessage(data.message);
  }catch(e){if(!c.signal.aborted){setError(e instanceof Error?e.message:'Не удалось загрузить');setMessage('Заполните данные самостоятельно — расчёт доступен без загрузки объявления.');}}
  finally{if(!c.signal.aborted)setLoading(false);}
 }
 useEffect(()=>{if(initialUrl)void load(initialUrl);return()=>controller.current?.abort();},[initialUrl]);
 async function calculate(parameters:OfferCalculationDraft){
  if(calculationTimer.current)clearTimeout(calculationTimer.current);
  invalidate();const current=revision.current;setPending(true);
  const body={action:'calculate',url,title,market,price,currency,city,draft:parameters};
  try{const r=await fetch('/api/autocalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);if(current===revision.current){setResult(data);setCalculatedBody(body);}}
  catch(e){if(current===revision.current)setError(e instanceof Error?e.message:'Не удалось рассчитать');}finally{setPending(false);}
 }
 useEffect(()=>{
  if(loading||!title.trim()||!market||!currency||!(Number(price)>0)||!city||!draft.vehicleCategory)return;
  try{validateCustomerParameters(draft);}catch{return;}
  calculationTimer.current=setTimeout(()=>void calculate(draft as OfferCalculationDraft),600);
  return()=>{if(calculationTimer.current)clearTimeout(calculationTimer.current);};
 },[draft,title,market,currency,price,city,loading]);
 async function pdf(){
  if(!calculatedBody)return;setPending(true);setError('');
  const preview=window.open('about:blank','_blank');if(preview){preview.opener=null;preview.document.title='Подготовка PDF';preview.document.body.textContent='Подготавливаем расчёт…';}
  try{const r=await fetch('/api/autocalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...calculatedBody,action:'pdf'})});if(!r.ok)throw Error((await r.json()).error);const link=URL.createObjectURL(await r.blob());if(preview)preview.location.href=link;else window.location.assign(link);setTimeout(()=>URL.revokeObjectURL(link),300000);}
  catch(e){preview?.close();setError(e instanceof Error?e.message:'Не удалось открыть PDF');}finally{setPending(false);}
 }
 const leadText=[title,url,market&&markets[market],price&&`${price} ${currency}`,city,result&&`Расчёт: ${rub(result.totalRub)}`,calculatedBody&&`Параметры: ${JSON.stringify(calculatedBody.draft)}`].filter(Boolean).join('\n');
 return <main className="ac-page-copy ac-offer-page ac-autocalc-page min-h-screen text-[var(--ac-text)]"><PublicHeader backHref="/cars"/><div className="mx-auto max-w-[1480px] px-4 pb-8 pt-7 md:px-8">
 <p className="text-xs font-bold uppercase tracking-widest text-[var(--ac-muted)]">АвтоЦена / Расчёт по ссылке</p><h1 className="mt-2 text-3xl font-black md:text-4xl">{title||'АвтоРасчёт'}</h1>
 <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,1fr)]"><section className="min-w-0 space-y-5"><form className={panel} onSubmit={e=>{e.preventDefault();void load(url);}}><label htmlFor="autocalc-url" className="text-sm font-bold">Ссылка на автомобиль за границей</label><div className="mt-2 flex flex-col gap-3 sm:flex-row"><input id="autocalc-url" type="url" required value={url} onChange={e=>{controller.current?.abort();setLoading(false);setUrl(e.target.value);invalidate();}} placeholder="Вставьте ссылку на объявление" className={`${input} !mt-0 flex-none sm:flex-1`}/><button data-autocalc-primary disabled={loading} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#e32c39] px-6 font-bold text-white disabled:opacity-50"><Link2 size={18}/>{loading?'Загружаем…':'Получить данные'}</button></div><p role="status" className="mt-3 text-sm text-[var(--ac-muted)]">{message||'Вставьте ссылку или заполните данные самостоятельно. Итог появится после заполнения обязательных параметров.'}</p></form>
 <SourceDirectory/>
 {images.length?<VehicleGallery images={images} title={title||'Автомобиль'}/>:<div className="flex min-h-44 flex-col py-8 items-center justify-center gap-4 rounded-[32px] bg-[var(--ac-surface-2)] text-[var(--ac-muted)]"><Car size={76} strokeWidth={1}/><p className="px-6 text-center text-sm">{loading?'Загружаем фотографии…':'Фотографии появятся, если источник предоставит их'}</p></div>}
 <div className={`${panel} mt-5`}><h2 className="text-lg font-bold">Автомобиль из объявления</h2><p className="mt-2 text-sm leading-6 text-[var(--ac-muted)]">Проверьте цену, валюту и характеристики перед расчётом. Данные можно изменить — это ваш самостоятельный расчёт.</p>{url&&/^https:\/\//i.test(url)?<a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block break-all text-sm underline underline-offset-4">Открыть объявление ↗</a>:null}</div>
 <div className="mt-5 flex flex-wrap gap-3"><button type="button" data-autocalc-lead={leadText} className="min-h-14 flex-1 rounded-2xl bg-[#18b64b] px-5 font-bold text-white">Оставить заявку на расчёт</button><button type="button" onClick={pdf} disabled={!result||pending} className="flex min-h-14 items-center gap-2 rounded-2xl bg-amber-500 px-5 font-bold text-black disabled:opacity-40"><FileDown size={20}/>PDF</button></div>
 </section><aside className="min-w-0 space-y-4">
 <div className="rounded-3xl bg-red-500/10 p-5" aria-live="polite"><p className="text-xs font-bold uppercase tracking-widest">Стоимость под ключ</p><p className="mt-2 text-3xl font-black text-[#e32c39]">{result?rub(result.totalRub):'Заполните параметры'}</p><p className="mt-2 text-xs text-[var(--ac-muted)]">{result?'Расчёт по вашим данным. Итоговую стоимость подтвердит менеджер.':'Укажите цену, страну покупки, город и характеристики.'}</p></div>
 <div className={panel}><p className="mb-2 text-sm font-bold">Доставка в ваш город</p><CitySelector value={city} onChange={v=>{setCity(v);invalidate();}} onStoredChange={v=>{setCity(v);invalidate();}} triggerLabel={city || "Выберите город"}/></div>
 {result?<details className={panel}><summary className="cursor-pointer font-bold">Структура цены</summary><dl className="mt-4 space-y-3 text-sm">{result.breakdown.map((row,i)=><div key={i} className="flex justify-between gap-4"><dt className="text-[var(--ac-muted)]">{row.label||row.title||row.id}</dt><dd className="shrink-0 font-bold">{rub(row.amountRub)}</dd></div>)}</dl><p className="mt-4 text-xs text-[var(--ac-muted)]">Курс на {result.rateDate||'дату расчёта'}</p>{result.warnings?.map((w:string,i:number)=><p key={i} className="mt-2 text-xs text-[var(--ac-muted)]">{w}</p>)}</details>:null}
 <div className={panel}><fieldset disabled={loading||pending} onChange={invalidate} className="mb-6 grid grid-cols-2 gap-4"><label className="col-span-2 text-xs font-semibold">Название автомобиля *<input required className={input} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Марка, модель, комплектация" maxLength={180}/></label><label className="text-xs font-semibold">Страна покупки *<select required className={input} value={market} onChange={e=>setMarket(e.target.value)}><option value="">Выберите</option>{Object.entries(markets).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="text-xs font-semibold">Валюта *<select required className={input} value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">Выберите</option>{currencies.map(c=><option key={c}>{c}</option>)}</select></label><label className="col-span-2 text-xs font-semibold">Цена автомобиля в объявлении *<input required type="number" min="0.01" step="any" className={input} value={price} onChange={e=>setPrice(e.target.value)} placeholder="Укажите цену"/></label></fieldset>
 <h2 className="text-lg font-bold">Характеристики для расчёта</h2>
 {notes.map((note,i)=><p key={i} className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">{note}</p>)}
 <fieldset disabled={pending||loading} className="min-w-0"><OfferParameterEditors draft={draft as ParameterDraft} showCommercial researchContext={[title,markets[market]].filter(Boolean).join(' ')} change={(key,value)=>{invalidate();setDraft(old=>({...old,...powerUnitPatch(key,value,old as ParameterDraft),...(key==='year'?{productionMonth:'',productionDay:''}:{}),...(key==='fuel'?{hybridKind:'',icePowerKw:'',icePowerHp:'',power30MinKw:'',power30MinHp:''}:{})}));}}/></fieldset>
 {facts.length?<dl className="mt-3 grid grid-cols-2 gap-2 text-xs">{facts.map((fact,i)=><div key={i} className="rounded-xl bg-[var(--ac-surface)] p-3"><dt className="text-[var(--ac-muted)]">{fact.label}</dt><dd className="mt-1 font-semibold">{fact.value}</dd></div>)}</dl>:null}
 <div className="mt-3"><ResearchLink query={`характеристики двигателя мощность объём тип топлива ${title} ${draft.year||''} ${markets[market]||''}`} label="Уточнить характеристики с ИИ"/></div>
 <button data-autocalc-primary type="button" onClick={()=>calculate(draft as OfferCalculationDraft)} disabled={pending||loading} className="mt-4 min-h-12 w-full rounded-xl bg-[#e32c39] px-4 font-bold text-white disabled:opacity-50">{pending?'Считаем…':'Рассчитать под ключ'}</button>
 {error?<p role="alert" className="mt-3 text-sm text-red-500">{error}</p>:null}
 <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ac-border)] pt-4"><span className="text-xs text-[var(--ac-muted)]">Не уверены в данных?</span><button type="button" data-autocalc-lead={leadText} className="flex min-h-12 items-center gap-2 text-sm font-bold"><img src="/avatars/manager-red.webp" alt="" width={44} height={44} className="h-11 w-11 object-contain"/><span className="underline decoration-red-400 underline-offset-4">Расчёт у менеджера →</span></button></div></div>
 </aside></div></div><style jsx global>{`
 html[data-theme] body main.ac-autocalc-page{background:transparent!important;background-image:none!important}
 html[data-theme] body .ac-autocalc-page input,html[data-theme] body .ac-autocalc-page select{color:var(--ac-text)!important;-webkit-text-fill-color:var(--ac-text)!important}
 html[data-theme][data-theme] body .ac-autocalc-page button[data-autocalc-primary]{color:#fff!important;-webkit-text-fill-color:#fff!important}
 .ac-autocalc-page h1{overflow-wrap:anywhere}

 .ac-autocalc-page input:required:invalid,.ac-autocalc-page select:required:invalid{border-color:rgba(245,158,11,.55)}
 `}</style></main>;
}
