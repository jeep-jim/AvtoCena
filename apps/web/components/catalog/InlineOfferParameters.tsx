"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Fuel, Zap, Truck } from "lucide-react";
import { validateCustomerParameters } from "../../lib/catalog/customer-parameters";
export type ParameterDraft = Record<string,string>;
const fuels = [["petrol","Бензин"],["diesel","Дизель"],["lpg","Газ LPG"],["cng","Газ CNG"],["electric","Электро"],["hybrid","Гибрид"]];
const names:Record<string,string>={year:"год выпуска",productionMonth:"месяц выпуска",productionDay:"день выпуска",transportToBorderRub:"стоимость доставки до границы",engineCc:"объём двигателя",powerHp:"мощность",power30MinKw:"30-минутную мощность",icePowerKw:"мощность ДВС",grossVehicleWeightKg:"полную разрешённую массу (до 3500 кг)"};
function Field({label,value,change,options=[],min,max,searchQuery}:{label:string;value:string;change:(v:string)=>void;options?:number[];min?:number;max?:number;searchQuery?:string}) {
 const id=useId();
 const [choosing,setChoosing]=useState(false);
 return <div className="text-xs font-semibold">
  <label htmlFor={id}>{label}</label>
  <div className="ac-parameter-input mt-2 flex min-h-11 overflow-hidden rounded-xl bg-[var(--ac-surface)]">
   <input id={id} aria-label={label} type="number" inputMode="decimal" value={value} min={min} max={max} step="any" onFocus={()=>setChoosing(true)} onChange={e=>change(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-base text-[var(--ac-text)] outline-none"/>
   {options.length ? <button type="button" aria-label={`Выбрать: ${label}`} aria-expanded={choosing} aria-controls={`${id}-choices`} onClick={()=>setChoosing(!choosing)} className="min-h-11 min-w-11 shrink-0 px-3"><ChevronDown size={16} aria-hidden/></button> : null}
   {searchQuery ? <a href={`https://yandex.ru/search/?text=${encodeURIComponent(searchQuery)}`} target="_blank" rel="noopener noreferrer" aria-label={`Найти: ${label}`} title="Найти в Яндексе с Алисой. Проверьте источник и модификацию." className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"><img src="/brands/alice.svg" alt="" width={22} height={22}/></a> : null}
  </div>
  {choosing && options.length ? <div id={`${id}-choices`} className="mt-2 grid grid-cols-2 gap-1" aria-label={`Варианты: ${label}`}>
   {options.map(n=><button key={n} type="button" aria-pressed={value===String(n)} onClick={()=>{change(String(n));setChoosing(false);}} className="min-h-11 rounded-lg bg-[var(--ac-surface)] px-2 text-left text-sm">{n.toLocaleString("ru-RU")}</button>)}
  </div> : null}
 </div>;
}
function EngineIcon() {
 return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function Tile({label,value,icon,children,wide=false}:{label:string;value:string;icon:ReactNode;children:ReactNode;wide?:boolean}) {
 const ref=useRef<HTMLDetailsElement>(null);
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!open)return;
  const close=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node) && ref.current)ref.current.open=false;};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape" && ref.current){ref.current.open=false;ref.current.querySelector("summary")?.focus();}};
  document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);
  return ()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};
 },[open]);
 return <div className={`relative min-w-0 ${wide?"col-span-2":""}`} style={{height:50,zIndex:open?60:undefined}}>
  <details ref={ref} onToggle={e=>setOpen(e.currentTarget.open)} className="ac-attached-editor group absolute inset-x-0 top-0 overflow-hidden rounded-2xl bg-[var(--ac-surface-2)]">
   <summary aria-label={`${label}: ${value}`} className="flex h-12 cursor-pointer list-none items-center gap-3 py-2 pl-4 pr-4 text-left [&::-webkit-details-marker]:hidden">
    <span className="shrink-0 text-[var(--ac-muted)]">{icon}</span><span className="min-w-0 flex-1 break-words text-xs font-bold">{value}</span><ChevronDown aria-hidden size={16} className="ml-2 shrink-0 text-[var(--ac-muted)] transition-transform group-open:rotate-180"/>
   </summary>
   <div className="ac-attached-editor-body space-y-3 overflow-y-auto p-4" style={{maxHeight:"min(360px,55dvh)",overscrollBehavior:"contain"}}>{children}</div>
  </details>
 </div>;
}
export function InlineOfferParameters({offerId,initial,price,children,showCommercial=false,isPickup=false,researchContext=""}:{offerId:string;initial:ParameterDraft;price:ReactNode;children:ReactNode;showCommercial?:boolean;isPickup?:boolean;researchContext?:string}) {
 const [draft,setDraft]=useState(initial),[pending,setPending]=useState(false),[error,setError]=useState("");
 const [result,setResult]=useState<{totalRub:number;customs?:{vehicleCategory?:string;tariffCode?:string;productionReferenceDate?:string;productionReferenceBasis?:string;ageBand?:string};warnings?:string[];breakdown?:{id:string;label?:string;title?:string;amountRub:number}[]}|null>(null);
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
 const field=(key:string,label:string,options:number[]=[],min?:number,max?:number,searchQuery?:string)=><Field label={label} value={draft[key]||""} change={v=>change(key,v)} options={options} min={min} max={max} searchQuery={searchQuery}/>;
 return <div className={`ac-inline-parameters ${dirty?"ac-personal-parameters":""}`}>
  {!dirty?price:<div className="ac-offer-price-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-5" aria-live="polite" aria-busy={pending}>
   <p className="text-xs font-bold uppercase tracking-widest">По вашим параметрам</p>
   {result?<p className="mt-2 text-3xl font-black">{Math.round(result.totalRub).toLocaleString("ru-RU")} ₽</p>:<p className="mt-3 text-sm">{pending?"Пересчитываем…":error||"Заполните параметры для расчёта"}</p>}
   {result?<p className="mt-2 text-xs text-[var(--ac-muted)]">Ориентир под ключ. Данные и стоимость требуют подтверждения.</p>:null}
   {result?.customs?.productionReferenceDate ? <p className="mt-2 text-xs text-[var(--ac-muted)]">Дата выпуска в расчёте: {result.customs.productionReferenceDate}{result.customs.productionReferenceBasis !== "exact_date" ? " · условная дата, уточните по документам" : ""}. Тариф: {result.customs.vehicleCategory === "N1" ? `N1 · ТН ВЭД ${result.customs.tariffCode || "8704"}` : result.customs.ageBand === "up_to_3_years" ? "до 3 лет" : result.customs.ageBand === "from_3_to_5_years" ? "3–5 лет" : "старше 5 лет"}.</p> : null}
   <button type="button" className="mt-3 py-2 text-xs underline" onClick={()=>{revision.current++;setDraft(initial);setResult(null);setPending(false);}}>Вернуть исходные данные</button>
  </div>}
  <div className="mt-4 grid grid-cols-2 items-start gap-2.5">
   <Tile label="Дата выпуска" value={draft.year?`${draft.year}${draft.productionMonth?`/${draft.productionMonth.padStart(2,"0")}`:""} г.`:"Дата выпуска"} icon={<CalendarDays size={16}/>}>
    {field("year","Год выпуска",Array.from({length:30},(_,i)=>new Date().getFullYear()-i),1990,new Date().getFullYear()+1)}
    {field("productionDay","День выпуска (если известен)",[],1,31)}
    <label className="block text-xs font-semibold">Месяц выпуска<select aria-label="Месяц выпуска" className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3" value={draft.productionMonth||""} onChange={e=>change("productionMonth",e.target.value)}><option value="">Неизвестен</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{String(i+1).padStart(2,"0")}</option>)}</select></label>
    <label className="block text-xs font-semibold">Дата таможенного расчёта<input aria-label="Дата таможенного расчёта" type="date" value={draft.customsCalculationDate||""} onChange={e=>change("customsCalculationDate",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"/></label>
    <p className="text-xs leading-5 text-[var(--ac-muted)]">Без даты расчёт на сегодня. Для M1: до 3 лет включительно, свыше 3 до 5 включительно, старше 5. Если день неизвестен — 15-е число; если месяц неизвестен — 1 июля.</p>
   </Tile>
   <Tile label="Объём двигателя" value={draft.fuel==="electric"?"Без ДВС":draft.engineCc?`${Number(draft.engineCc).toLocaleString("ru-RU")} см³`:"Указать объём"} icon={<EngineIcon/>}>
    {draft.fuel==="electric"?<p className="text-xs">Для электромобиля объём ДВС не требуется.</p>:field("engineCc","Объём, см³",[660,998,1197,1498,1598,1998,2498,2998],300,10000)}
    {draft.fuel!=="electric" ? <p className="text-xs leading-5 text-[var(--ac-muted)]">Выберите точный объём или введите свой. Например, 1,5 л в названии не заменяет объём в см³ из документов.</p> : null}
   </Tile>
   <Tile label="Топливо" value={fuels.find(([key])=>key===draft.fuel)?.[1]||"Указать топливо"} icon={<Fuel size={16}/>}>
    {fuels.map(([key,label])=><button type="button" key={key} aria-pressed={draft.fuel===key} onClick={()=>change("fuel",key)} className="block min-h-10 w-full rounded-lg px-3 text-left text-xs hover:bg-[var(--ac-surface)]">{label}</button>)}
    {draft.fuel==="hybrid"?<label className="block text-xs">Тип гибрида<select aria-label="Тип гибрида" value={draft.hybridKind||""} onChange={e=>change("hybridKind",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Выберите тип</option><option value="series_hybrid">Последовательный</option><option value="other_hybrid">Другой гибрид</option></select></label>:null}
   </Tile>
   <Tile label="Мощность" value={draft.powerHp?`${draft.powerHp} л.с.`:"Указать мощность"} icon={<Zap size={16}/>}>
    {field("powerHp","Мощность, л.с.",[50,75,90,100,120,140,150,160,180,200,250,300,400,500],1,2500)}
   </Tile>
   {showCommercial ? <Tile wide label="Категория и масса" value={draft.vehicleCategory ? `${draft.vehicleCategory === "N1" ? "N1 · Грузовой" : isPickup ? "M1 · Легковой (Пикап)" : "M1 · Легковой"}${draft.vehicleCategory === "N1" && draft.grossVehicleWeightKg ? ` · ${Number(draft.grossVehicleWeightKg).toLocaleString("ru-RU")} кг` : ""}` : "Категория и масса · указать"} icon={<Truck size={16}/>}>
    <p className="text-xs leading-5 text-[var(--ac-muted)]">Выберите категорию по СБКТС или ЭПТС. N1 — грузовой расчёт по ТН ВЭД 8704. Выбор применяется только к вашему расчёту.</p>
    <label className="block text-xs font-semibold">Категория транспортного средства<select aria-label="Категория транспортного средства" value={draft.vehicleCategory||""} onChange={e=>change("vehicleCategory",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Выберите категорию</option><option value="N1">N1 · Грузовой до 3,5 т</option><option value="M1">{isPickup ? "M1 · Легковой (Пикап)" : "M1 · Легковой"}</option></select></label>
    {draft.vehicleCategory === "N1" ? <>
      {field("grossVehicleWeightKg","Полная разрешённая масса, кг",[2500,2800,3000,3200,3500],1,3500,`${researchContext} ${draft.year} ${draft.engineCc} см³ ${draft.fuel} полная разрешённая максимальная масса GVWR кг технические характеристики`)}
      <p className="text-xs leading-5 text-[var(--ac-muted)]">В списке примеры значений, а не характеристики этого авто. Выберите или введите массу из документов; значок Алисы поможет найти данные вашей модификации.</p>
      {field("transportToBorderRub","Доставка до границы РФ, ₽",[],0,10000000,`${researchContext} доставка автомобиля до границы России стоимость перевозки маршрут`)}
      <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={!draft.transportToBorderRub} onClick={()=>change("transportToBorderRub","")} className="min-h-11 rounded-lg bg-[var(--ac-surface)] px-3 text-xs">По настройкам рынка</button><button type="button" aria-pressed={draft.transportToBorderRub==="0"} onClick={()=>change("transportToBorderRub","0")} className="min-h-11 rounded-lg bg-[var(--ac-surface)] px-3 text-xs">Уже включена в цену · 0 ₽</button></div>
      <p className="text-xs leading-5 text-[var(--ac-muted)]">Или введите сумму из предложения перевозчика. Результат поиска — ориентир, не подтверждённый тариф.</p>
      <p className="text-xs leading-5 text-[var(--ac-muted)]">Доставка входит в таможенную стоимость N1 и заменяет строку логистики в этом расчёте. Пустое поле — расходы рынка; 0 — доставка включена в цену.</p>
      <p className="text-xs leading-5 text-[var(--ac-muted)]">Максимальная масса с людьми и грузом (GVWR). Снаряжённая масса и грузоподъёмность не подходят.</p>
      {draft.fuel === "hybrid" && draft.hybridKind !== "series_hybrid" ? <label className="block text-xs font-semibold">Топливо ДВС гибрида<select aria-label="Топливо ДВС гибрида" value={draft.n1IceFuel||""} onChange={e=>change("n1IceFuel",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Укажите</option><option value="petrol">Бензин</option><option value="diesel">Дизель</option></select></label> : null}
    </> : null}
   </Tile> : null}
   {["electric","hybrid"].includes(draft.fuel) && !(draft.vehicleCategory === "N1" && draft.hybridKind !== "other_hybrid")?<Tile wide label="30-минутная мощность" value={draft.power30MinKw?`${draft.power30MinKw} кВт · 30 минут`:"Указать 30-минутную мощность"} icon={<Zap size={16}/>}>
    {field("power30MinKw","30-минутная мощность, кВт",[],0.1,2000)}{draft.fuel==="hybrid"?field("icePowerKw","Мощность ДВС, кВт",[],0.1,2000):null}
   </Tile>:null}
  </div>
  {result?.breakdown?.length?<details className="ac-offer-breakdown mt-4 rounded-2xl bg-[var(--ac-surface-2)] p-4"><summary className="cursor-pointer pr-4 font-bold">Структура расчёта по вашим параметрам</summary><dl className="mt-3 space-y-2 text-xs">{result.breakdown.map((row,i)=><div key={`${row.id}-${i}`} className="flex justify-between gap-3"><dt>{row.label||row.title||row.id}</dt><dd>{Math.round(row.amountRub).toLocaleString("ru-RU")} ₽</dd></div>)}</dl></details>:null}
  {children}
  <style>{`.ac-inline-parameters input[type="number"]{appearance:textfield;-moz-appearance:textfield}.ac-inline-parameters input[type="number"]::-webkit-inner-spin-button,.ac-inline-parameters input[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}html[data-theme="light"] .ac-inline-parameters input[type="date"],html[data-theme="light"] .ac-inline-parameters select,html[data-theme="light"] .ac-inline-parameters option{color:var(--ac-text)!important;-webkit-text-fill-color:var(--ac-text);background-color:var(--ac-surface);color-scheme:light}.ac-inline-parameters input,.ac-inline-parameters select{border:0;outline:none}.ac-parameter-input:focus-within,.ac-attached-editor select:focus-visible,.ac-attached-editor input[type="date"]:focus-visible{box-shadow:inset 0 0 0 2px var(--ac-muted)}.ac-attached-editor-body{scrollbar-width:thin;scrollbar-color:var(--ac-muted) transparent}.ac-attached-editor-body::-webkit-scrollbar{width:5px}.ac-attached-editor-body::-webkit-scrollbar-track{background:transparent}.ac-attached-editor-body::-webkit-scrollbar-thumb{background:var(--ac-muted);border:0;border-radius:9px}.ac-attached-editor[open]{box-shadow:0 12px 24px rgba(0,0,0,.15)}.ac-attached-editor input{font-size:16px}html[data-theme="light"] body .ac-offer-page .ac-attached-editor,html[data-theme="light"] body .ac-offer-page .ac-specifications-trigger,html[data-theme="light"] body .ac-offer-page .ac-offer-breakdown{border:1px solid var(--ac-border)!important}.ac-personal-parameters .ac-original-calculation{display:none}.ac-inline-parameters select{appearance:none;padding-right:42px;background-repeat:no-repeat;background-size:14px;background-position:right 18px center;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")}`}</style>
 </div>;
}
