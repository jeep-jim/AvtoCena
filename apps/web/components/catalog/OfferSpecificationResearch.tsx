"use client";
import { useState } from "react";
import { VehicleResearchLink } from "./VehicleResearchLink";
import { OfferManualCalculation } from "./OfferManualCalculation";
import type { OfferCalculationDraft } from "./OfferCalculationForm";
import type { VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";
import { researchLabels, type ResearchCandidate, type ResearchResult } from "../../lib/catalog/specification-research-contract";
const values:Record<string,string>={petrol:"Бензин",diesel:"Дизель",lpg:"Газ LPG",cng:"Газ CNG",electric:"Электро",hybrid:"Гибрид",series_hybrid:"Последовательный гибрид",other_hybrid:"Другой гибрид",fwd:"Передний",rwd:"Задний",awd:"Полный",manual:"Механика",automatic:"Автомат",cvt:"Вариатор",dct:"Робот",sedan:"Седан",hatchback:"Хэтчбек",wagon:"Универсал",suv:"Внедорожник",crossover:"Кроссовер",coupe:"Купе",convertible:"Кабриолет",minivan:"Минивэн",pickup:"Пикап"};
export function OfferSpecificationResearch({offerId,identity,manual=false}:{offerId:string;identity:VehicleResearchIdentity;manual?:boolean}) {
 const [pending,setPending]=useState(false),[result,setResult]=useState<ResearchResult|null>(null),[error,setError]=useState("");
 const [selected,setSelected]=useState<ResearchCandidate|null>(null);
 async function search(){
  setPending(true);setError("");setResult(null);
  try {
   const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/research`,{method:"POST",signal:AbortSignal.timeout(55000)});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"Не удалось выполнить поиск");
   setResult(data);
  }catch(e){setError(e instanceof Error && e.name!=="TimeoutError"?e.message:"Поиск не ответил вовремя. Попробуйте ещё раз.");}
  finally{setPending(false);}
 }
 const initial=selected?Object.fromEntries(selected.fields.filter(f=>["year","fuel","engineCc","powerHp","hybridKind","icePowerKw","power30MinKw"].includes(f.key)).map(f=>[f.key,f.value])) as Partial<OfferCalculationDraft>:undefined;
 return <div className="min-w-0 space-y-3">
  <button type="button" onClick={search} disabled={pending} aria-busy={pending} className="ac-vehicle-research-link flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[1.1rem] px-3 py-3 text-xs font-semibold disabled:opacity-60">
   <img src="/brands/alice.svg" alt="" width={24} height={24}/>{pending?"Ищем характеристики…":"Найти недостающие характеристики"}
  </button>
  <div aria-live="polite">
   {error?<p role="alert" className="text-sm">{error}</p>:null}
   {result?.searchStatus==="not_configured"?<p className="text-sm text-[var(--ac-muted)]">Поиск внутри карточки ещё не подключён. Пока можно открыть поиск отдельно.</p>:null}
   {result?.searchStatus==="unavailable"?<p className="text-sm">Сервис поиска временно недоступен. Попробуйте позже.</p>:null}
   {result?.searchStatus==="empty"?<p className="text-sm">Не удалось найти модификацию с источниками. Характеристики можно уточнить отдельно.</p>:null}
  </div>
  {result?.candidates.map(candidate=><div key={candidate.id} className="rounded-[1.1rem] bg-[var(--ac-surface-2)] p-4 text-sm">
   <p className="font-bold">{candidate.label}</p>
   <p className="mt-2 text-xs text-[var(--ac-muted)]">Предложение поиска. Сверьте модификацию и характеристики с источниками: ответ ИИ может содержать ошибки.</p>
   <dl className="my-3 space-y-2">{candidate.fields.map(field=><div key={field.key} className="flex justify-between gap-3"><dt>{researchLabels[field.key]}</dt><dd className="font-bold text-right">{values[field.value]||field.value}</dd></div>)}</dl>
   <div className="space-y-2">{candidate.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block break-words underline">{source.title} ↗</a>)}</div>
   <button type="button" onClick={()=>setSelected(candidate)} className="mt-4 min-h-12 w-full rounded-[1.1rem] bg-[var(--ac-surface)] px-3 font-bold">Модификация подходит — подставить</button>
  </div>)}
  {selected?<div className="rounded-[1.1rem] bg-[var(--ac-surface-2)] p-4">
   <div className="flex items-center justify-between gap-2"><p className="font-bold">Подставлено в пробную карточку</p><button type="button" className="p-2 text-xs underline" onClick={()=>setSelected(null)}>Сбросить</button></div>
   <dl className="mt-3 space-y-2 text-sm">{selected.fields.filter(f=>["bodyType","drive","transmission"].includes(f.key)).map(f=><div key={f.key} className="flex justify-between gap-3"><dt>{researchLabels[f.key]}</dt><dd>{values[f.value]||f.value}</dd></div>)}</dl>
   <OfferManualCalculation key={JSON.stringify(selected)} offerId={offerId} year={identity.year||0} initial={initial} preview/>
  </div>:manual?<OfferManualCalculation offerId={offerId} year={identity.year||0}/>:null}
  <VehicleResearchLink identity={identity} label="Открыть поиск в отдельной вкладке"/>
 </div>;
}
