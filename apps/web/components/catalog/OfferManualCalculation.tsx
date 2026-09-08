"use client";
import { useState } from "react";
import { OfferCalculationForm, type OfferCalculationDraft } from "./OfferCalculationForm";
import type { VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";
export function OfferManualCalculation({offerId,year,researchIdentity}:{offerId:string;year:number;researchIdentity?:VehicleResearchIdentity}) {
  const [pending,setPending]=useState(false), [error,setError]=useState("");
  const [result,setResult]=useState<{totalRub:number}|null>(null);
  async function calculate(draft:OfferCalculationDraft) {
    setPending(true);setError("");setResult(null);
    try {
      const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/calculate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft)});
      const data=await response.json();
      if(!response.ok)throw Error(data.error || "Не удалось рассчитать");
      setResult(data);
    } catch(e) {setError(e instanceof Error?e.message:"Не удалось рассчитать");}
    finally {setPending(false);}
  }
  return <div className="py-3">
    <p className="mb-3 text-sm text-[var(--ac-muted)]">Точных данных для автоматического расчёта недостаточно.</p>
    <OfferCalculationForm initial={{year:String(year)}} researchIdentity={researchIdentity} onCalculate={calculate} onDraftChange={()=>{setResult(null);setError("");}} pending={pending} error={error}/>
    {result ? <div role="status" className="mt-4 border-t border-[var(--ac-border)] pt-4"><p className="text-xs font-bold text-[var(--ac-muted)]">По вашим данным · ориентир под ключ</p><p className="mt-1 text-3xl font-black">{Math.round(result.totalRub).toLocaleString("ru-RU")} ₽</p><p className="mt-2 text-xs text-[var(--ac-muted)]">Характеристики и итоговую стоимость подтвердит менеджер.</p></div>:null}
  </div>;
}
