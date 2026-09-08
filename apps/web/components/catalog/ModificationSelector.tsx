"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogModificationOption } from "@/lib/catalog/modification-contract";

const fuelLabels: Record<string, string> = { petrol: "Бензин", diesel: "Дизель", lpg: "Газ LPG", cng: "Газ CNG", hybrid: "Гибрид", electric: "Электро" };

export function ModificationSelector({ options, selectedId, scenarioRub = 0, failed = false }: {
  options: CatalogModificationOption[]; selectedId?: string; scenarioRub?: number; failed?: boolean;
}) {
  const selected = options.find(option => option.id === selectedId);
  const [fuel, setFuel] = useState(selected?.fuel || "");
  const [engine, setEngine] = useState(selected ? String(selected.engineCc || 0) : "");
  const [variant, setVariant] = useState(selected?.id || "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const update = (id: string) => {
    const next = new URLSearchParams(search.toString());
    next.delete("powerHp");
    if (id) next.set("modificationId", id); else next.delete("modificationId");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  const fuelOptions = [...new Set(options.map(option => option.fuel))];
  const engineOptions = [...new Set(options.filter(option => option.fuel === fuel).map(option => String(option.engineCc || 0)))];
  const variants = options.filter(option => option.fuel === fuel && String(option.engineCc || 0) === engine);
  const control = "ac-calculation-input mt-1.5 w-full min-w-0 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-3 text-sm font-bold text-[var(--ac-text)] disabled:opacity-45";

  return <section id="modification-selector" aria-labelledby="modification-title" className="min-w-0 text-[var(--ac-text)]">
    {variant && variant === selectedId && !pending && scenarioRub > 0 ? <div className="mb-4"><p className="text-xs font-bold text-[var(--ac-muted)]">Расчёт по вашим данным</p><p className="mt-2 text-3xl font-black">{scenarioRub.toLocaleString("ru-RU")} ₽</p></div> : null}
    <h2 id="modification-title" className="text-xl font-black">Рассчитать под ключ</h2>
    <p className="mt-1 text-sm leading-5 text-[var(--ac-muted)]">Знаете модификацию? Выберите её для расчёта.</p>
    <fieldset disabled={pending} className="mt-4 grid min-w-0 grid-cols-2 gap-3">
      <label className="block text-xs font-bold">Тип топлива
        <select className={control} value={fuel} onChange={event => { setFuel(event.target.value); setEngine(""); setVariant(""); update(""); }}>
          <option value="">Выберите тип топлива</option>
          {fuelOptions.map(value => <option key={value} value={value}>{fuelLabels[value] || value}</option>)}
        </select>
      </label>
      <label className="block text-xs font-bold">Объём двигателя
        <select className={control} disabled={!fuel} value={engine} onChange={event => { setEngine(event.target.value); setVariant(""); update(""); }}>
          <option value="">Выберите двигатель</option>
          {engineOptions.map(value => <option key={value} value={value}>{value === "0" ? "Электромотор" : `${Number(value).toLocaleString("ru-RU")} см³`}</option>)}
        </select>
      </label>
      <label className="col-span-2 block text-xs font-bold">Модификация и мощность
        <select className={control} disabled={!engine} value={variant} onChange={event => { setVariant(event.target.value); update(event.target.value); }}>
          <option value="">Выберите модификацию</option>
          {variants.map(option => <option key={option.id} value={option.id}>{option.label} · {option.powerHp} л.с. · {option.market}</option>)}
        </select>
      </label>
      {variant ? <button type="button" className="text-xs underline" onClick={() => { setFuel(""); setEngine(""); setVariant(""); update(""); }}>Сбросить выбор</button> : null}
    </fieldset>
    <p role="status" aria-live="polite" className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">{pending ? "Пересчитываем…" : failed ? "Не удалось рассчитать. Попробуйте ещё раз или обратитесь к менеджеру." : selected ? "Расчёт по вашим данным. Менеджер подтвердит характеристики и стоимость." : "Цена под ключ появится после выбора."}</p>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ac-border)] pt-3 text-sm"><span className="text-[var(--ac-muted)]">Не уверены?</span><button type="button" data-offer-action="lead" className="min-h-10 font-bold underline decoration-red-400 underline-offset-4">Расчёт у менеджера →</button></div>
  </section>;
}
