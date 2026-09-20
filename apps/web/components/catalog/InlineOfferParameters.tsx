"use client";

import { CitySelector } from "../home/CitySelector";
import { quoteCityDelivery, deliveryDescription } from "../../lib/catalog/city-delivery";
import { ContractPaymentSummary } from "./ContractPaymentSummary";
import type { BusinessPaymentPlan } from "../../../../packages/engine/src/types";
import { recyclingPowerInfo } from "../../lib/catalog/recycling-power";
import { RecyclingPowerLabel, RecyclingPowerExplanation, RecyclingFeeHelp } from "./RecyclingPower";
import priceStyles from "./OfferPricePanel.module.css";
import powerStyles from "./RecyclingPower.module.css";
import editorStyles from "./InlineParameterPanels.module.css";
import { CalculationDateControl } from "./CalculationDateControl";
import { ElectricMotorIcon } from "./ElectricMotorIcon";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Fuel, Zap, Truck } from "lucide-react";
import { validateCustomerParameters } from "../../lib/catalog/customer-parameters";
import { completePowerUnitDraft, powerUnitPatch, hybridResearchQuery } from "../../lib/catalog/power-parameter-draft";
export type ParameterDraft = Record<string,string>;
const fuels = [["petrol","Бензин"],["diesel","Дизель"],["lpg","Газ LPG"],["cng","Газ CNG"],["electric","Электро"],["hybrid","Гибрид"]];
const names:Record<string,string>={year:"год выпуска",productionMonth:"месяц выпуска",productionDay:"день выпуска",transportToBorderRub:"стоимость доставки до границы",engineCc:"объём двигателя",powerHp:"мощность",powerKw:"мощность в кВт",power30MinKw:"30-минутную мощность",icePowerKw:"мощность ДВС",grossVehicleWeightKg:"полную разрешённую массу (до 3500 кг)"};
import { visibleBreakdownNote } from "../../lib/catalog/customs-age-label";
function parameterErrorText(error: unknown, draft: ParameterDraft) {
 const message=error instanceof Error?error.message:"Проверьте параметры";
 const key=message.match(/^Проверьте поле (\w+)$/)?.[1];
 if(!key)return message;
 const tile=({powerHp:"Мощность",powerKw:"Мощность",power30MinKw:"30-минутная мощность",icePowerKw:"30-минутная мощность",year:"Дата выпуска",productionMonth:"Дата выпуска",productionDay:"Дата выпуска",engineCc:"Объём двигателя"} as Record<string,string>)[key];
 const missing=draft[key]==null || String(draft[key]).trim()==="";
 return `${missing?"Для расчёта под ключ заполните":"Проверьте"} ${names[key]||key}${tile?` в поле «${tile}»`:""}.`;
}
function Field({label,caption,value,change,options=[],min,max,searchQuery}:{label:string;caption?:string;value:string;change:(v:string)=>void;options?:number[];min?:number;max?:number;searchQuery?:string}) {
 const id=useId();
 const [choosing,setChoosing]=useState(false);
 return <div className="min-w-0 text-xs font-semibold">
  <label htmlFor={id}>{caption || label}</label>
  <div className="ac-parameter-input mt-2 flex min-h-11 overflow-hidden rounded-xl bg-[var(--ac-surface)]">
   <input id={id} aria-label={label} type="number" inputMode="decimal" value={value} min={min} max={max} step="any" onFocus={()=>setChoosing(true)} onChange={e=>change(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-base text-[var(--ac-text)] outline-none"/>
   {options.length ? <button type="button" aria-label={`Выбрать: ${label}`} aria-expanded={choosing} aria-controls={`${id}-choices`} onClick={()=>setChoosing(!choosing)} className="min-h-11 min-w-11 shrink-0 px-3"><ChevronDown size={16} aria-hidden/></button> : null}
   {searchQuery ? <a href={`https://yandex.ru/search/?text=${encodeURIComponent(searchQuery)}`} target="_blank" rel="noopener noreferrer" aria-label={`Найти: ${label}`} title="Найти в Яндексе с Алисой. Проверьте источник и модификацию." className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"><img src="/brands/alice.svg" alt="" width={22} height={22}/></a> : null}
  </div>
  {choosing && options.length ? <div id={`${id}-choices`} className={editorStyles.presets} aria-label={`Варианты: ${label}`}>
   {options.map(n=><button key={n} type="button" aria-pressed={value===String(n)} onClick={()=>{change(String(n));setChoosing(false);}} className="min-h-11 rounded-lg bg-[var(--ac-surface)] px-2 text-left text-sm">{n.toLocaleString("ru-RU",{useGrouping:!/^Год/i.test(label)})}</button>)}
  </div> : null}
 </div>;
}
function EngineIcon() {
 return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function Tile({label,value,valueNode,warning=false,icon,children,wide=false}:{label:string;value:string;valueNode?:ReactNode;warning?:boolean;icon:ReactNode;children:ReactNode;wide?:boolean}) {
 const ref=useRef<HTMLDetailsElement>(null);
 const id=useId();
 useEffect(()=>{
  // Closing on click preserves the first activation of an outside reset button.
  const close=(event:MouseEvent)=>{if(ref.current?.open && !ref.current.contains(event.target as Node))ref.current.open=false;};
  const escape=(event:KeyboardEvent)=>{
   if(event.key==="Escape" && ref.current?.open){event.preventDefault();ref.current.open=false;ref.current.querySelector("summary")?.focus();}
  };
  document.addEventListener("click",close);document.addEventListener("keydown",escape);
  return ()=>{document.removeEventListener("click",close);document.removeEventListener("keydown",escape);};
 },[]);
 useEffect(()=>{
  const editor=ref.current;
  if(!editor)return;
  let unlock:(()=>void)|undefined;
  const position=()=>{
   const body=editor.querySelector<HTMLElement>(".ac-attached-editor-body");
   if(!body)return;
   const viewport=window.visualViewport;
   const bottom=(viewport?.height ?? window.innerHeight)+(viewport?.offsetTop ?? 0);
   body.style.setProperty("--parameter-available-height",`${Math.max(100,bottom-body.getBoundingClientRect().top-12)}px`);
  };
  const toggle=()=>{
   unlock?.();unlock=undefined;
   if(!editor.open)return;
   if(window.matchMedia("(max-width: 767px)").matches){
    // Bring the attached menu into view before locking the page behind it.
    const panel=editor.querySelector<HTMLElement>("[data-parameter-panel]");
    if(panel && panel.getBoundingClientRect().top>window.innerHeight-180)window.scrollBy({top:panel.getBoundingClientRect().top-window.innerHeight+180,behavior:"instant"});
    const root=document.documentElement,body=document.body;
    const rootOverflow=root.style.overflow,bodyOverflow=body.style.overflow;
    root.style.overflow="hidden";body.style.overflow="hidden";
    const touch=(event:TouchEvent)=>{if(!(event.target instanceof Node) || !editor.contains(event.target))event.preventDefault();};
    document.addEventListener("touchmove",touch,{passive:false});
    unlock=()=>{root.style.overflow=rootOverflow;body.style.overflow=bodyOverflow;document.removeEventListener("touchmove",touch);};
   }
   position();
  };
  editor.addEventListener("toggle",toggle);
  window.visualViewport?.addEventListener("resize",position);
  window.addEventListener("resize",position);
  return ()=>{unlock?.();editor.removeEventListener("toggle",toggle);window.visualViewport?.removeEventListener("resize",position);window.removeEventListener("resize",position);};
 },[]);
 const finish=()=>{if(ref.current){ref.current.open=false;ref.current.querySelector("summary")?.focus({preventScroll:true});}};
 return <div className={`${editorStyles.tile} min-w-0 ${wide?"col-span-2":""}`} data-full-width={wide || undefined}>
  <details ref={ref} data-parameter-editor className={`${editorStyles.editor} ac-attached-editor group rounded-2xl bg-[var(--ac-surface-2)]`}>
   <summary id={`${id}-trigger`} aria-controls={`${id}-panel`} aria-label={`${label}: ${value}`} onClick={event=>{
    event.preventDefault();
    const current=ref.current;
    if(!current)return;
    const next=!current.open;
    if(next){
     const grid=current.closest<HTMLElement>("[data-parameter-editor-grid]");
     grid?.querySelectorAll<HTMLDetailsElement>("details[data-parameter-editor][open]").forEach(other=>{if(other!==current)other.open=false;});
    }
    current.open=next;
   }} className={`flex h-12 cursor-pointer list-none items-center gap-3 py-2 pl-4 pr-4 text-left [&::-webkit-details-marker]:hidden ${valueNode ? powerStyles.powerTile : ""} ${warning ? powerStyles.warningTile : ""}`}>
    <span className="shrink-0 text-[var(--ac-muted)]">{icon}</span><span className="min-w-0 flex-1 break-words text-xs font-bold">{valueNode ?? value}</span><ChevronDown aria-hidden size={16} className="ml-2 shrink-0 text-[var(--ac-muted)] transition-transform group-open:rotate-180"/>
   </summary>
   <div id={`${id}-panel`} data-parameter-panel role="region" aria-labelledby={`${id}-trigger`} className={editorStyles.panel}>
    <div className={`${editorStyles.body} ac-attached-editor-body`}
     onClick={event=>{if((event.target as Element).closest("button[aria-pressed]"))finish();}}
     onChange={event=>{if(event.target instanceof HTMLSelectElement && !event.target.hasAttribute("data-keep-open"))finish();}}
     onKeyDown={event=>{if(event.key==="Enter" && event.target instanceof HTMLInputElement){event.preventDefault();event.target.blur();finish();}}}
    >{children}</div>
   </div>
  </details>
 </div>;
}
export function InlineOfferParameters({deliveryMarket,offerId,initial,price,children,priceBadges,exportWarning,reportedVolume,showCommercial=false,isPickup=false,researchContext="",autoCalculate=false,sourcePriceOnly=false}:{offerId:string;reportedVolume?:number;autoCalculate?:boolean;sourcePriceOnly?:boolean;deliveryMarket?:string;initial:ParameterDraft;price:ReactNode;children:ReactNode;priceBadges?:ReactNode;exportWarning?:string;showCommercial?:boolean;isPickup?:boolean;researchContext?:string}) {
 const originalDraft=completePowerUnitDraft(isPickup?{...initial,vehicleCategory:"N1"}:initial);
 const [draft,setDraft]=useState(()=>originalDraft),[pending,setPending]=useState(false),[error,setError]=useState("");
 const [result,setResult]=useState<{totalRub:number;paymentPlan?:BusinessPaymentPlan;currencyRate?:{sourcePrice:number;currency:string;effectiveRate:number;rateDate:string};customs?:{vehicleCategory?:string;tariffCode?:string;productionReferenceDate?:string;productionReferenceBasis?:string;ageBand?:string};warnings?:string[];breakdown?:{id:string;label?:string;title?:string;note?:string;amountRub:number}[]}|null>(null);
 const revision=useRef(0);
 // Empty optional values equal omitted values, so returning to today restores the original scenario.
 const dirty=Object.keys({...originalDraft,...draft}).some(key=>(draft[key]??"")!==(originalDraft[key]??""));
 function change(key:string,value:string){if(draft[key]===value)return;revision.current++;setResult(null);setError("");setPending(true);setDraft(old=>({...old,...powerUnitPatch(key,value),...(key==="year"?{productionMonth:"",productionDay:""}:{}),...(key==="fuel"?{hybridKind:"",icePowerKw:"",icePowerHp:"",power30MinKw:"",power30MinHp:"",powerKw:""}:{})}));}
 useEffect(()=>{
  if(!dirty && !autoCalculate){setPending(false);setError("");setResult(null);return;}
  const version=revision.current;
  try{validateCustomerParameters(draft);}catch(e){setPending(false);setError(parameterErrorText(e,draft));return;}
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
 },[draft,dirty,offerId,autoCalculate]);
 const deliveryQuote=quoteCityDelivery(draft.deliveryCity,deliveryMarket);
 const showCalculation=dirty || Boolean(result);
 // A seller price is not a stale delivered estimate: keep its explicit label while missing data blocks calculation.
 const keepSellerPrice=sourcePriceOnly && !result;
 const powerInfo = recyclingPowerInfo({powerHp:draft.powerHp,powerKw:draft.powerKw,fuel:draft.fuel,vehicleCategory:draft.vehicleCategory,powertrainKind:draft.fuel==="hybrid"?draft.hybridKind:draft.fuel==="electric"?"electric":"combustion"});
 const powerLabel = draft.powerHp ? `${draft.powerHp} л.с.` : "Указать мощность";
 const pairedPower = Boolean(powerInfo?.borderline);
 const field=(key:string,label:string,options:number[]=[],min?:number,max?:number,searchQuery?:string,caption?:string)=><Field label={label} caption={caption} value={draft[key]||""} change={v=>change(key,v)} options={options} min={min} max={max} searchQuery={searchQuery}/>;
 const hybridQuery=hybridResearchQuery(researchContext,draft.year||"",draft.engineCc||"");
 const hybridHelp=<a href={`https://yandex.ru/search/?text=${encodeURIComponent(hybridQuery)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 text-xs font-semibold underline"><img src="/brands/alice.svg" alt="" width={24} height={24}/>Алиса: найти тип гибрида и мощность по документам</a>;
 const currentYear = new Date().getFullYear();
 const yearOptions = Array.from({length:currentYear-1990+2},(_,i)=>currentYear+1-i);
 return <div className={`ac-inline-parameters ${showCalculation?"ac-personal-parameters":""}`}>
  {!showCalculation || keepSellerPrice?price:<div className="ac-offer-price-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-5" aria-live="polite" aria-busy={pending}>
   <div className={priceStyles.heading}>
    <div className={priceStyles.amountBlock}>
     <p className={priceStyles.title}>{dirty?"По вашим параметрам":"Ориентир под ключ"}</p>
     {result?<p className={priceStyles.amount}>{Math.round(result.totalRub).toLocaleString("ru-RU")} ₽</p>:<p className="mt-3 text-sm">{pending?"Пересчитываем…":error||"Заполните параметры для расчёта"}</p>}
    </div>
    {priceBadges ? <div className={priceStyles.badges}>{priceBadges}</div> : null}
   </div>
   {result?<p className="mt-2 text-xs text-[var(--ac-muted)]">{dirty?"Ориентир под ключ. Данные и стоимость требуют подтверждения.":"Рассчитано автоматически по данным объявления. Данные и стоимость требуют подтверждения."}</p>:null}
   {result?.currencyRate ? <p className="mt-2 text-xs text-[var(--ac-muted)]">Цена продавца: {result.currencyRate.sourcePrice.toLocaleString("ru-RU")} {result.currencyRate.currency}. Курс расчёта: {result.currencyRate.effectiveRate.toLocaleString("ru-RU", {maximumFractionDigits:8})} ₽ на {result.currencyRate.rateDate}.</p> : null}
   {result?.customs?.productionReferenceDate ? <p className="mt-2 text-xs text-[var(--ac-muted)]">Дата выпуска в расчёте: {result.customs.productionReferenceDate}{result.customs.productionReferenceBasis !== "exact_date" ? " · условная дата, уточните по документам" : ""}. Тариф: {result.customs.vehicleCategory === "N1" ? `N1 · ТН ВЭД ${result.customs.tariffCode || "8704"}` : result.customs.ageBand === "up_to_3_years" ? "до 3 лет" : result.customs.ageBand === "from_3_to_5_years" ? "3–5 лет" : "старше 5 лет"}.</p> : null}
   {dirty?<button type="button" className="mt-3 py-2 text-xs underline" onClick={()=>{revision.current++;setDraft({...originalDraft,deliveryCity:draft.deliveryCity||""});setResult(null);setPending(false);}}>Вернуть исходные данные</button>:null}
  </div>}
  {!result && (keepSellerPrice || (!dirty && autoCalculate)) ? <div className="mt-2 text-xs text-[var(--ac-muted)]" data-parameter-calculation-status>
   <p role="status">{pending?"Рассчитываем стоимость под ключ…":error||"Для расчёта под ключ заполните характеристики автомобиля."}</p>
   {keepSellerPrice && dirty ? <button type="button" className="mt-1 py-2 text-xs underline" onClick={()=>{revision.current++;setDraft({...originalDraft,deliveryCity:draft.deliveryCity||""});setResult(null);setPending(false);}}>Вернуть исходные данные</button> : null}
  </div> : null}
  {exportWarning ? <p role="note" className={priceStyles.warning}>{exportWarning} Расчёт использует обычные расходы Японии; возможность и стоимость поставки не подтверждены.</p> : null}
  {reportedVolume ? <p className="mt-2 text-xs text-[var(--ac-muted)]">Объём {reportedVolume} см³ указан в аукционных данных и может быть округлён. Расчёт ориентировочный; точный объём уточняется по документам.</p> : null}
  <div className="mt-4 rounded-2xl bg-[var(--ac-surface-2)] p-4" data-city-delivery>
   <p className="text-sm font-bold">Доставка до вашего города</p>
   <CitySelector value={draft.deliveryCity||""} onChange={city=>change("deliveryCity",city)} />
   <p className="mt-2 text-xs text-[var(--ac-muted)]">{deliveryDescription(deliveryQuote)}</p>
  </div>
  <div data-parameter-editor-grid className={`${editorStyles.grid} mt-4 grid grid-cols-2 items-start gap-2.5`}>
   <Tile label="Дата выпуска" value={draft.year?`${draft.year}${draft.productionMonth?`/${draft.productionMonth.padStart(2,"0")}`:""} г.`:"Дата выпуска"} icon={<CalendarDays size={16}/>}>
    <div className={editorStyles.dateFields} data-parameter-date-fields>
     <label>Год<select aria-label="Год выпуска" value={draft.year||""} onChange={e=>change("year",e.target.value)}><option value="">—</option>{draft.year && !yearOptions.includes(Number(draft.year)) ? <option value={draft.year}>{draft.year}</option> : null}{yearOptions.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
     <label>Месяц<select aria-label="Месяц выпуска" value={draft.productionMonth||""} onChange={e=>change("productionMonth",e.target.value)}><option value="">—</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{String(i+1).padStart(2,"0")}</option>)}</select></label>
     <label>День<input aria-label="День выпуска (если известен)" type="number" inputMode="numeric" min={1} max={31} step={1} placeholder="—" value={draft.productionDay||""} onChange={e=>change("productionDay",e.target.value)}/></label>
     <CalculationDateControl value={draft.customsCalculationDate||""} onChange={value=>change("customsCalculationDate",value)} />
     <span className={editorStyles.dateHint}>{draft.customsCalculationDate ? <button type="button" className={editorStyles.todayButton} aria-label="Считать таможню на сегодня" onClick={()=>change("customsCalculationDate","")}>На сегодня</button> : "По умолчанию"}</span>
    </div>
    <p className={editorStyles.note}>Вверху — выпуск авто по документам. Ниже — дата, на которую считаем его возраст.</p>
    <details className={editorStyles.help}><summary>Как учитывается дата</summary><p>Без даты расчёт на сегодня. Для M1: до 3 лет включительно, свыше 3 до 5 включительно, старше 5. Если день неизвестен — 15-е число; если месяц неизвестен — 1 июля.</p></details>
   </Tile>
   <Tile label="Объём двигателя" value={draft.fuel==="electric"?"Без ДВС":draft.engineCc?`${Number(draft.engineCc).toLocaleString("ru-RU")} см³`:"Указать объём"} icon={<EngineIcon/>}>
    {draft.fuel==="electric"?<p className="text-xs">Для электромобиля объём ДВС не требуется.</p>:field("engineCc","Объём, см³",[660,998,1197,1498,1598,1998,2498,2998],300,10000)}
    {draft.fuel!=="electric" ? <p className={editorStyles.note}>Выберите точный объём или введите свой. Например, 1,5 л в названии не заменяет объём в см³ из документов.</p> : null}
   </Tile>
   <Tile label="Топливо" value={fuels.find(([key])=>key===draft.fuel)?.[1]||"Указать топливо"} icon={<Fuel size={16}/>}>
    <div className={editorStyles.fuelChoices} data-parameter-fuel-choices>
     {fuels.map(([key,label])=><button type="button" key={key} aria-pressed={draft.fuel===key} onClick={()=>change("fuel",key)}>{label}</button>)}
    </div>
    {draft.fuel==="hybrid" ? hybridHelp : null}
    {draft.fuel==="hybrid" && draft.vehicleCategory==="N1"?<label className={editorStyles.hybridField}>Тип гибрида<select aria-label="Тип гибрида" value={draft.hybridKind||""} onChange={e=>change("hybridKind",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Выберите тип</option><option value="series_hybrid">Последовательный — колёса приводит электромотор</option><option value="other_hybrid">Другой — ДВС тоже может приводить колёса</option></select></label>:null}
   </Tile>
   <Tile label="Мощность" value={`${powerLabel}${pairedPower && powerInfo ? ` / ${powerInfo.kwLabel}` : ""}`} valueNode={pairedPower ? <RecyclingPowerLabel hpLabel={powerLabel} info={powerInfo} showKw /> : undefined} warning={pairedPower} icon={<Zap size={16}/>}>
    <div className={editorStyles.twoColumns}>
     {field("powerHp","Мощность, л.с.",[50,75,90,100,120,140,150,160,180,200,250,300,400,500],1,2500)}
     {!["electric","hybrid"].includes(draft.fuel) ? field("powerKw","Мощность, кВт (если известна)",[],0.1,2000,undefined,"Мощность, кВт") : null}
    </div>
    {powerInfo?.borderline ? <details className={editorStyles.help}><summary>Почему повышенный утильсбор?</summary><RecyclingPowerExplanation info={powerInfo} /></details> : null}
    {!["electric","hybrid"].includes(draft.fuel) ? <p className={editorStyles.note}>Если кВт указаны, расчёт использует их без округления до л.с. Л.с. и кВт пересчитываются в обе стороны; пересчитанные значения не заменяют данные документов. Если в источнике только 160 л.с., точные кВт нужно уточнить перед оплатой.</p> : null}
   </Tile>
   {showCommercial ? <Tile wide label={isPickup ? "Полная масса пикапа" : "Категория и масса"} value={isPickup ? (draft.grossVehicleWeightKg ? `Пикап · ${Number(draft.grossVehicleWeightKg).toLocaleString("ru-RU")} кг` : "Полная масса пикапа · указать") : draft.vehicleCategory ? `${draft.vehicleCategory === "N1" ? "N1 · Грузовой" : "M1 · Легковой"}${draft.vehicleCategory === "N1" && draft.grossVehicleWeightKg ? ` · ${Number(draft.grossVehicleWeightKg).toLocaleString("ru-RU")} кг` : ""}` : "Категория и масса · указать"} icon={<Truck size={16}/>}>
    {!isPickup ? <><p className="text-xs leading-5 text-[var(--ac-muted)]">Выберите категорию по СБКТС или ЭПТС.</p>
    <label className="block text-xs font-semibold">Категория транспортного средства<select aria-label="Категория транспортного средства" value={draft.vehicleCategory||""} onChange={e=>change("vehicleCategory",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Выберите категорию</option><option value="N1">N1 · Грузовой до 3,5 т</option><option value="M1">M1 · Легковой</option></select></label></> : <p className="text-xs text-[var(--ac-muted)]">Полную массу берём из характеристик автомобиля. При необходимости её можно уточнить здесь.</p>}
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
   {["electric","hybrid"].includes(draft.fuel) && !(draft.vehicleCategory === "N1" && draft.hybridKind !== "other_hybrid")?<Tile wide label="30-минутная мощность" value={draft.fuel==="hybrid" && !draft.hybridKind?"Гибрид: укажите тип и мощность":draft.power30MinKw?`${draft.power30MinKw} кВт · 30 минут`:"Указать 30-минутную мощность"} icon={<ElectricMotorIcon/>}>
    {hybridHelp}
    {draft.fuel==="hybrid" ? <label className={editorStyles.hybridField}>Тип гибрида<select aria-label="Тип гибрида для расчёта" data-keep-open value={draft.hybridKind||""} onChange={e=>change("hybridKind",e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-[var(--ac-surface)] px-3"><option value="">Укажите по документам автомобиля</option><option value="series_hybrid">Последовательный — колёса приводит электромотор</option><option value="other_hybrid">Другой — ДВС тоже может приводить колёса</option></select></label> : null}
    <p className={editorStyles.note}>30-минутная мощность электромоторов — отдельное значение из СБКТС, ЭПТС или подтверждающих документов. Максимальная мощность из рекламы сюда не подходит. Если моторов несколько, нужна подтверждённая сумма их 30-минутных мощностей.</p>
    <div className={editorStyles.twoColumns}>{field("power30MinKw","30-минутная мощность, кВт",[],0.1,2000,undefined,"30 минут, кВт")}{field("power30MinHp","30-минутная мощность, л.с.",[],0.1,2720,undefined,"30 минут, л.с.")}</div>
    {draft.fuel==="hybrid" ? <><p className={editorStyles.note}>Мощность ДВС — только бензинового или дизельного двигателя, без электромоторов.</p><div className={editorStyles.twoColumns}>{field("icePowerKw","Мощность ДВС, кВт",[],0.1,2000,undefined,"ДВС, кВт")}{field("icePowerHp","Мощность ДВС, л.с.",[],0.1,2720,undefined,"ДВС, л.с.")}</div></> : null}
    <p className={editorStyles.note}>Введите кВт или л.с. — второе поле заполнится автоматически. Когда обязательные поля заполнены, цена пересчитается сама. Ответ Алисы сверяйте с документами именно этой модификации.</p>
   </Tile>:null}
  </div>
  {result?.breakdown?.length?<details className="ac-offer-breakdown mt-4 rounded-2xl bg-[var(--ac-surface-2)] p-4"><summary className="cursor-pointer pr-4 font-bold">{dirty?"Структура расчёта по вашим параметрам":"Структура цены"}</summary><dl className="mt-3 space-y-2 text-xs">{result.breakdown.map((row,i)=>{const note=visibleBreakdownNote(row.note);return <div key={`${row.id}-${i}`} ><div className="flex justify-between gap-3"><dt>{row.label||row.title||row.id}{note ? <p className="mt-1 text-[11px] font-normal text-[var(--ac-muted)]">{note}</p> : null}{/utilization|утил/i.test(`${row.id} ${row.title||row.label||""}`) ? <RecyclingFeeHelp info={powerInfo} /> : null}</dt><dd className="shrink-0 whitespace-nowrap">{Math.round(row.amountRub).toLocaleString("ru-RU")} ₽</dd></div>{i === 0 ? <ContractPaymentSummary plan={result.paymentPlan} embedded /> : null}</div>})}</dl></details>:null}
  {children}
  <style dangerouslySetInnerHTML={{ __html: `.ac-inline-parameters input[type="number"]{appearance:textfield;-moz-appearance:textfield}.ac-inline-parameters input[type="number"]::-webkit-inner-spin-button,.ac-inline-parameters input[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}html[data-theme="light"] .ac-inline-parameters input[type="date"],html[data-theme="light"] .ac-inline-parameters select,html[data-theme="light"] .ac-inline-parameters option{color:var(--ac-text)!important;-webkit-text-fill-color:var(--ac-text);background-color:var(--ac-surface);color-scheme:light}.ac-inline-parameters input,.ac-inline-parameters select{border:0;outline:none}.ac-parameter-input:focus-within,.ac-attached-editor select:focus-visible,.ac-attached-editor input[type="date"]:focus-visible{box-shadow:inset 0 0 0 2px var(--ac-muted)}.ac-attached-editor-body{scrollbar-width:thin;scrollbar-color:var(--ac-muted) transparent}.ac-attached-editor-body::-webkit-scrollbar{width:5px}.ac-attached-editor-body::-webkit-scrollbar-track{background:transparent}.ac-attached-editor-body::-webkit-scrollbar-thumb{background:var(--ac-muted);border:0;border-radius:9px}.ac-attached-editor[open]{box-shadow:0 12px 24px rgba(0,0,0,.15)}.ac-attached-editor input{font-size:16px}html[data-theme="light"] body .ac-offer-page .ac-attached-editor,html[data-theme="light"] body .ac-offer-page .ac-specifications-trigger,html[data-theme="light"] body .ac-offer-page .ac-offer-breakdown{border:1px solid var(--ac-border)!important}.ac-personal-parameters .ac-original-calculation{display:none}.ac-inline-parameters select{appearance:none;padding-right:42px;background-repeat:no-repeat;background-size:14px;background-position:right 18px center;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")}` }} />
 </div>;
}
