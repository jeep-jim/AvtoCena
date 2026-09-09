"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Fuel, Zap, X } from "lucide-react";
import { validateCustomerParameters } from "../../lib/catalog/customer-parameters";
export type ParameterDraft = Record<string,string>;
const fuels = [["petrol","Бензин"],["diesel","Дизель"],["lpg","Газ LPG"],["cng","Газ CNG"],["electric","Электро"],["hybrid","Гибрид"]];
const names:Record<string,string>={year:"год выпуска",productionMonth:"месяц выпуска",engineCc:"объём двигателя",powerHp:"мощность",power30MinKw:"30-минутную мощность",icePowerKw:"мощность ДВС"};
function Field({label,value,change,options=[],min,max}:{label:string;value:string;change:(v:string)=>void;options?:number[];min?:number;max?:number}) {
 const id=useId();
 return <label className="block text-xs font-semibold">{label}<input aria-label={label} type="number" inputMode="decimal" value={value} min={min} max={max} step="any" list={id} onChange={e=>change(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 text-sm text-[var(--ac-text)]"/><datalist id={id}>{options.map(n=><option key={n} value={n}/>)}</datalist></label>;
}
function EngineIcon() {
 return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function Tile({label,value,icon,children,wide=false}:{label:string;value:string;icon:ReactNode;children:ReactNode;wide?:boolean}) {
 const id=useId(), panel=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false);
 function position() {
  const rect=trigger.current?.getBoundingClientRect(), node=panel.current;
  if(!rect||!node)return;
  const width=Math.min(340,window.innerWidth-32);
  const viewport=window.visualViewport;
  node.style.setProperty("--editor-bottom",`${16+Math.max(0,window.innerHeight-(viewport?.height||window.innerHeight)-(viewport?.offsetTop||0))}px`);
  node.style.setProperty("--editor-mobile-height",`${(viewport?.height||window.innerHeight)*0.65}px`);
  node.style.setProperty("--editor-left",`${Math.max(16,Math.min(rect.left,window.innerWidth-width-16))}px`);
  node.style.setProperty("--editor-top",`${Math.min(rect.bottom+8,Math.max(80,window.innerHeight-340))}px`);
 }
 useEffect(()=>{
  const node=panel.current;
  const sync=()=>setOpen(Boolean(node?.matches(":popover-open")));
  node?.addEventListener("toggle",sync);
  window.addEventListener("resize",position);
  window.visualViewport?.addEventListener("resize",position);
  window.visualViewport?.addEventListener("scroll",position);
  return ()=>{node?.removeEventListener("toggle",sync);window.removeEventListener("resize",position);window.visualViewport?.removeEventListener("resize",position);window.visualViewport?.removeEventListener("scroll",position);};
 },[]);
 return <div className={`min-w-0 rounded-2xl bg-[var(--ac-surface-2)] ${wide?"col-span-2":""}`}>
  <button ref={trigger} type="button" popoverTarget={id} onClick={position} aria-expanded={open} aria-label={`${label}: ${value}`} className="flex min-h-12 w-full items-center gap-3 py-3 pl-4 pr-5 text-left">
   <span className="shrink-0 text-[var(--ac-muted)]">{icon}</span><span className="min-w-0 flex-1 break-words text-xs font-bold">{value}</span><ChevronDown aria-hidden size={16} className={`ml-2 shrink-0 text-[var(--ac-muted)] transition-transform ${open?"rotate-180":""}`}/>
  </button>
  <div ref={panel} id={id} popover="auto" role="dialog" aria-label={label} className="ac-parameter-popover rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4 text-[var(--ac-text)] shadow-2xl">
   <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-bold">{label}</span><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={`Закрыть: ${label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface)]"><X size={18}/></button></div>
   <div className="space-y-3">{children}</div>
  </div>
 </div>;
}
export function InlineOfferParameters({offerId,initial,price,children}:{offerId:string;initial:ParameterDraft;price:ReactNode;children:ReactNode}) {
 const [draft,setDraft]=useState(initial),[pending,setPending]=useState(false),[error,setError]=useState("");
 const [result,setResult]=useState<{totalRub:number;breakdown?:{id:string;label?:string;title?:string;amountRub:number}[]}|null>(null);
 const revision=useRef(0);
 const dirty=JSON.stringify(draft)!==JSON.stringify(initial);
 function change(key:string,value:string){if(draft[key]===value)return;revision.current++;setResult(null);setError("");setPending(true);setDraft(old=>({...old,[key]:value,...(key==="fuel"?{hybridKind:"",icePowerKw:"",power30MinKw:""}:{})}));}
 useEffect(()=>{
  if(!dirty){setPending(false);setError("");setResult(null);return;}
  const version=revision.current;
  try{validateCustomerParameters(draft);}catch(e){setPending(false);const message=e instanceof Error?e.message:"Проверьте параметры";setError(message.replace(/Проверьте поле (\w+)/,(_,key)=>`Укажите корректно ${names[key]||key}`));return;}
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setPending(true);
   try{
    const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/calculate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft),signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||"Не удалось рассчитать");
    if(version===revision.current && !controller.signal.aborted)setResult(data);
   }catch(e){if(!controller.signal.aborted && version===revision.current)setError(e instanceof Error?e.message:"Не удалось рассчитать");}
   finally{if(!controller.signal.aborted && version===revision.current)setPending(false);}
  },600);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[draft,dirty,offerId]);
 const field=(key:string,label:string,options:number[]=[],min?:number,max?:number)=><Field label={label} value={draft[key]||""} change={v=>change(key,v)} options={options} min={min} max={max}/>;
 return <div className={`ac-inline-parameters ${dirty?"ac-personal-parameters":""}`}>
  {!dirty?price:<div className="ac-offer-price-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-5" aria-live="polite" aria-busy={pending}>
   <p className="text-xs font-bold uppercase tracking-widest">По вашим параметрам</p>
   {result?<p className="mt-2 text-3xl font-black">{Math.round(result.totalRub).toLocaleString("ru-RU")} ₽</p>:<p className="mt-3 text-sm">{pending?"Пересчитываем…":error||"Заполните параметры для расчёта"}</p>}
   {result?<p className="mt-2 text-xs text-[var(--ac-muted)]">Ориентир под ключ. Данные и стоимость требуют подтверждения.</p>:null}
   <button type="button" className="mt-3 py-2 text-xs underline" onClick={()=>{revision.current++;setDraft(initial);setResult(null);setPending(false);}}>Вернуть исходные данные</button>
  </div>}
  <div className="mt-4 grid grid-cols-2 items-start gap-2.5">
   <Tile label="Дата выпуска" value={draft.year?`${draft.year}${draft.productionMonth?`/${draft.productionMonth.padStart(2,"0")}`:""} г.`:"Дата выпуска"} icon={<CalendarDays size={16}/>}>
    {field("year","Год выпуска",Array.from({length:30},(_,i)=>new Date().getFullYear()-i),1990,new Date().getFullYear()+1)}
    <label className="block text-xs font-semibold">Месяц выпуска<select aria-label="Месяц выпуска" className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3" value={draft.productionMonth||""} onChange={e=>change("productionMonth",e.target.value)}><option value="">Неизвестен</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{String(i+1).padStart(2,"0")}</option>)}</select></label>
   </Tile>
   <Tile label="Объём двигателя" value={draft.fuel==="electric"?"Без ДВС":draft.engineCc?`${Number(draft.engineCc).toLocaleString("ru-RU")} см³`:"Указать объём"} icon={<EngineIcon/>}>
    {draft.fuel==="electric"?<p className="text-xs">Для электромобиля объём ДВС не требуется.</p>:field("engineCc","Объём, см³",[660,998,1197,1498,1598,1998,2498,2998],300,10000)}
   </Tile>
   <Tile label="Топливо" value={fuels.find(([key])=>key===draft.fuel)?.[1]||"Указать топливо"} icon={<Fuel size={16}/>}>
    {fuels.map(([key,label])=><button type="button" key={key} aria-pressed={draft.fuel===key} onClick={()=>change("fuel",key)} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs hover:bg-[var(--ac-surface)]">{label}</button>)}
    {draft.fuel==="hybrid"?<label className="block text-xs">Тип гибрида<select aria-label="Тип гибрида" value={draft.hybridKind||""} onChange={e=>change("hybridKind",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Выберите тип</option><option value="series_hybrid">Последовательный</option><option value="other_hybrid">Другой гибрид</option></select></label>:null}
   </Tile>
   <Tile label="Мощность" value={draft.powerHp?`${draft.powerHp} л.с.`:"Указать мощность"} icon={<Zap size={16}/>}>
    {field("powerHp","Мощность, л.с.",[50,75,90,100,120,140,150,160,180,200,250,300,400,500],1,2500)}
   </Tile>
   {["electric","hybrid"].includes(draft.fuel)?<Tile wide label="30-минутная мощность" value={draft.power30MinKw?`${draft.power30MinKw} кВт · 30 минут`:"Указать 30-минутную мощность"} icon={<Zap size={16}/>}>
    {field("power30MinKw","30-минутная мощность, кВт",[],0.1,2000)}{draft.fuel==="hybrid"?field("icePowerKw","Мощность ДВС, кВт",[],0.1,2000):null}
   </Tile>:null}
  </div>
  {result?.breakdown?.length?<details className="mt-4 rounded-2xl bg-[var(--ac-surface-2)] p-4"><summary className="cursor-pointer pr-4 font-bold">Структура расчёта по вашим параметрам</summary><dl className="mt-3 space-y-2 text-xs">{result.breakdown.map((row,i)=><div key={`${row.id}-${i}`} className="flex justify-between gap-3"><dt>{row.label||row.title||row.id}</dt><dd>{Math.round(row.amountRub).toLocaleString("ru-RU")} ₽</dd></div>)}</dl></details>:null}
  {children}
  <style>{`.ac-parameter-popover{position:fixed;inset:auto;margin:0;left:var(--editor-left,16px);top:var(--editor-top,80px);width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 100px);overflow:auto;overscroll-behavior:contain}.ac-parameter-popover input{font-size:16px}.ac-parameter-popover::backdrop{background:transparent}@media(max-width:639px){.ac-parameter-popover{left:16px;right:16px;top:auto;bottom:var(--editor-bottom,16px);width:auto;max-height:var(--editor-mobile-height,65dvh);padding-bottom:max(16px,env(safe-area-inset-bottom))}.ac-parameter-popover::backdrop{background:rgba(0,0,0,.25)}}.ac-personal-parameters .ac-original-calculation{display:none}.ac-inline-parameters select,.ac-parameter-popover select{appearance:none;padding-right:42px;background-repeat:no-repeat;background-size:14px;background-position:right 18px center;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")}`}</style>
 </div>;
}
