"use client";

import { FormEvent, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const COMMON_HP = [50, 75, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 250, 300, 350, 400, 500, 600];

export function EditablePowerTile({
  currentHp,
  requiresConfirmation,
  scenarioSource,
  fullWidth = false,
}: {
  currentHp: number;
  requiresConfirmation: boolean;
  scenarioSource?: string | null;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = Math.max(20, Math.min(2500, Math.round(Number(currentHp || 100))));
  const [manual, setManual] = useState(String(current));
  const commonValue = COMMON_HP.includes(current) ? String(current) : "custom";
  const warning = requiresConfirmation;
  const hint = scenarioSource === "fallback_100"
    ? "Мощность не найдена в источнике и Knowledge CORE — временно считаем по 100 л.с. Уточните значение."
    : scenarioSource === "knowledge_reference"
      ? "Использована справочная мощность модели. Для точной цены можно выбрать или ввести мощность конкретного автомобиля."
      : scenarioSource === "source_peak_estimate"
        ? "Источник даёт пиковую/общую мощность, но не все регуляторные данные. Значение можно уточнить вручную."
        : scenarioSource === "customer_input"
? "Цена пересчитана по выбранной вами мощности. Перед оплатой значение нужно подтвердить по документам автомобиля."
: "Мощность можно изменить — цена пересчитается для выбранного сценария.";

  const apply = (value?: number | null) => {
    const params = new URLSearchParams(search.toString());
    if (value && Number.isFinite(value) && value >= 20 && value <= 2500) params.set("powerHp", String(Math.round(value)));
    else params.delete("powerHp");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const options = useMemo(() => COMMON_HP, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(manual);
    if (Number.isFinite(value) && value >= 20 && value <= 2500) apply(value);
  };

  return <div
    aria-label={`Мощность: ${current} л.с.`}
    className={`ac-offer-spec-tile relative min-w-0 rounded-2xl px-3.5 py-3 ${warning ? "border border-amber-400/45 bg-amber-400/[0.10]" : ""}`}
    style={fullWidth ? { gridColumn: "1 / -1" } : undefined}
  >
    <div className="flex min-w-0 items-center gap-2.5">
      <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${warning ? "text-amber-300" : "text-[var(--ac-text)] opacity-50"}`} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 2.8 5.8 13h5.1l-.7 8.2L18.3 11h-5.1z" /></svg>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
<span className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--ac-muted)]">Мощность</span>
{warning ? <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] font-black text-amber-200">уточнить</span> : null}
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
<select
  aria-label="Выбрать мощность в лошадиных силах"
  value={commonValue}
  onChange={(event) => {
    if (event.target.value === "auto") return apply(null);
    if (event.target.value === "custom") return;
    const value = Number(event.target.value);
    setManual(event.target.value);
    apply(value);
  }}
  className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-2.5 py-2 text-[13px] font-bold text-[var(--ac-text)] outline-none focus:border-white/25"
>
  <option value="auto">Авто</option>
  {options.map((value) => <option key={value} value={value}>{value} л.с.</option>)}
  {!COMMON_HP.includes(current) ? <option value="custom">{current} л.с.</option> : <option value="custom">Другая…</option>}
</select>
<form onSubmit={submit} className="flex items-center gap-1.5">
  <input
    type="number"
    min={20}
    max={2500}
    step={1}
    inputMode="numeric"
    value={manual}
    onChange={(event) => setManual(event.target.value)}
    aria-label="Ввести мощность вручную"
    className="w-[76px] rounded-xl border border-white/10 bg-black/20 px-2 py-2 text-center text-[13px] font-black text-[var(--ac-text)] outline-none focus:border-white/25"
  />
  <button type="submit" className="rounded-xl bg-white/10 px-2.5 py-2 text-[11px] font-black text-[var(--ac-text)] hover:bg-white/15">л.с. ↻</button>
</form>
        </div>
        {warning ? <p className="mt-2 text-[10px] font-semibold leading-4 text-amber-100/80">{hint}</p> : <p className="mt-2 text-[10px] font-semibold leading-4 text-[var(--ac-muted)]">Можно изменить мощность и сразу пересчитать цену.</p>}
      </div>
    </div>
  </div>;
}
