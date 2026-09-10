"use client";

import { useId, useState } from "react";
import { VehicleResearchLink } from "./VehicleResearchLink";
import type { VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";

export type OfferCalculationDraft = {
  year: string; engineCc: string; powerHp: string; fuel: string;
  hybridKind: string; power30MinKw: string; icePowerKw: string;
  productionMonth?: string; productionDay?: string; customsCalculationDate?: string; transportToBorderRub?: string;
  vehicleCategory?: string; grossVehicleWeightKg?: string; n1IceFuel?: string;
};

// UI contract only: the caller must validate the scenario with the pricing engine.
// It deliberately has no access to the saved offer or catalog storage.
export function OfferCalculationForm({ initial = {}, onCalculate, onManager, onDraftChange, pending = false, error = "", offerId, researchIdentity }: {
  initial?: Partial<OfferCalculationDraft>;
  onCalculate: (draft: OfferCalculationDraft) => void;
  onManager?: () => void;
  onDraftChange?: () => void;
  pending?: boolean;
  error?: string;
  offerId?: string;
  researchIdentity?: VehicleResearchIdentity;
}) {
  const id = useId();
  const [draft, setDraft] = useState<OfferCalculationDraft>({
    year: "", engineCc: "", powerHp: "", fuel: "", hybridKind: "", power30MinKw: "", icePowerKw: "", ...initial
  });
  const field = (key: keyof OfferCalculationDraft, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  const electric = draft.fuel === "electric";
  const hybrid = draft.fuel === "hybrid";
  const control = "ac-calculation-input mt-1.5 block h-12 w-full min-w-0 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 text-sm font-semibold text-[var(--ac-text)] outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/15 disabled:opacity-50";
  const numberField = (key: keyof OfferCalculationDraft, label: string, min: number, max: number, step = 1, required = true) => <label className="min-w-0 text-xs font-semibold text-[var(--ac-muted)]">
    {label}<input className={control} name={key} type="number" inputMode={step === 1 ? "numeric" : "decimal"} min={min} max={max} step={step} required={required} placeholder="Укажите" value={draft[key]||""} onChange={event => field(key, event.target.value)} />
  </label>;

  return <section aria-labelledby={`${id}-title`} className="ac-calculation-form min-w-0 text-[var(--ac-text)]">
    <h2 id={`${id}-title`} className="text-xl font-black tracking-tight">Рассчитать под ключ</h2>
    <p className="mt-1 text-sm leading-5 text-[var(--ac-muted)]">Знаете характеристики? Укажите их для расчёта.</p>
    {researchIdentity ? <VehicleResearchLink offerId={offerId} identity={researchIdentity} /> : null}
    <form className="mt-4" onChange={onDraftChange} onSubmit={event => {
      event.preventDefault();
      onCalculate({ ...draft, engineCc: electric ? "" : draft.engineCc,
        hybridKind: hybrid ? draft.hybridKind : "", icePowerKw: hybrid ? draft.icePowerKw : "",
        power30MinKw: electric || hybrid ? draft.power30MinKw : "" });
    }}>
      <fieldset disabled={pending} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
        {numberField("year", "Год выпуска", 1990, new Date().getFullYear() + 1)}
        {numberField("productionMonth","Месяц выпуска (если известен)",1,12,1,false)}
        {numberField("productionDay","День выпуска (если известен)",1,31,1,false)}
        <label className="min-w-0 text-xs font-semibold text-[var(--ac-muted)]">Дата расчёта (пусто — сегодня)<input type="date" className={control} value={draft.customsCalculationDate||""} onChange={event=>field("customsCalculationDate",event.target.value)}/></label>
        <label className="min-w-0 text-xs font-semibold text-[var(--ac-muted)]">Топливо
          <select required name="fuel" className={control} value={draft.fuel} onChange={event => setDraft(previous => ({ ...previous,
            fuel: event.target.value, engineCc: "", powerHp: "", hybridKind: "", power30MinKw: "", icePowerKw: "" }))}>
            <option value="">Укажите</option>
            <option value="petrol">Бензин</option><option value="diesel">Дизель</option>
            <option value="hybrid">Гибрид</option><option value="electric">Электро</option>
            <option value="lpg">Газ LPG</option><option value="cng">Газ CNG</option>
          </select>
        </label>
        {!electric ? numberField("engineCc", "Объём, см³", 300, 10000) : null}
        {numberField("powerHp", "Мощность, л.с.", 1, 2500, 0.1, draft.vehicleCategory !== "N1")}
        {hybrid ? <label className="min-w-0 text-xs font-semibold text-[var(--ac-muted)]">Тип гибрида
          <select name="hybridKind" required className={control} value={draft.hybridKind} onChange={event => field("hybridKind", event.target.value)}>
            <option value="">Укажите</option><option value="series_hybrid">Последовательный</option><option value="other_hybrid">Другой гибрид</option>
          </select>
        </label> : null}
        {(electric || hybrid) && !(draft.vehicleCategory === "N1" && draft.hybridKind !== "other_hybrid") ? numberField("power30MinKw", "30-мин. мощность, кВт", 0.1, 2000, 0.1) : null}
        {hybrid && !(draft.vehicleCategory === "N1" && draft.hybridKind === "series_hybrid") ? numberField("icePowerKw", "Мощность ДВС, кВт", 0.1, 2000, 0.1) : null}
        <label className="min-w-0 text-xs font-semibold text-[var(--ac-muted)]">Категория по документам
          <select name="vehicleCategory" className={control} value={draft.vehicleCategory||""} onChange={event => field("vehicleCategory",event.target.value)}><option value="">Из объявления</option><option value="M1">M1 · Легковой</option><option value="N1">N1 · Грузовой до 3,5 т</option></select>
        </label>
        {draft.vehicleCategory === "N1" ? <>{numberField("grossVehicleWeightKg","Полная разрешённая масса, кг",1,3500)}{numberField("transportToBorderRub","Доставка до границы, ₽ (пусто — расходы рынка)",0,10000000,1,false)}</> : null}
        {draft.vehicleCategory === "N1" && hybrid && draft.hybridKind !== "series_hybrid" ? <label className="text-xs font-semibold text-[var(--ac-muted)]">Топливо ДВС гибрида<select required className={control} value={draft.n1IceFuel||""} onChange={event=>field("n1IceFuel",event.target.value)}><option value="">Укажите</option><option value="petrol">Бензин</option><option value="diesel">Дизель</option></select></label> : null}
        <button type="submit" className="col-span-2 mt-1 h-12 rounded-xl bg-[#e32c39] px-3 text-sm font-bold text-white transition hover:bg-[#c92430] disabled:opacity-60">{pending ? "Считаем…" : "Рассчитать под ключ"}</button>
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
    </form>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--ac-border)] pt-4 text-sm">
      <span className="text-[var(--ac-muted)]">Не уверены в данных?</span>
      <button type="button" data-offer-action={onManager ? undefined : "lead"} onClick={onManager} className="min-h-10 font-bold text-[var(--ac-text)] underline decoration-red-400 underline-offset-4 hover:text-red-500">Расчёт у менеджера →</button>
    </div>
    <style jsx global>{`
      html[data-theme="light"] .ac-calculation-input{background:#fff!important;border-color:#dce1e8!important}
      .ac-calculation-input:focus{border-color:#e32c39!important}
      @media(max-width:359px){.ac-calculation-form fieldset{grid-template-columns:minmax(0,1fr)}.ac-calculation-form button[type="submit"]{grid-column:1}}
    `}</style>
  </section>;
}
