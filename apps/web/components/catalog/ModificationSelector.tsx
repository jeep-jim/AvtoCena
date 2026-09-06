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
  const control = "mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-[#303d50] px-3 py-3 text-sm font-bold text-white disabled:opacity-45";

  return <section id="modification-selector" aria-labelledby="modification-title" className="rounded-2xl bg-[var(--ac-surface-2)] p-4">
    {variant && variant === selectedId && !pending && scenarioRub > 0 ? <div className="mb-4"><p className="text-xs font-bold text-white/65">Расчёт по выбранной модификации</p><p className="mt-2 text-3xl font-black">{scenarioRub.toLocaleString("ru-RU")} ₽</p></div> : null}
    <h2 id="modification-title" className="font-black">Выбрать модификацию</h2>
    <p className="mt-2 text-xs leading-5 text-white/65">В объявлении недостаточно характеристик. Выберите версию для расчёта. Соответствие этому автомобилю нужно подтвердить по документам.</p>
    <fieldset disabled={pending} className="mt-3 min-w-0 space-y-3">
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
      <label className="block text-xs font-bold">Модификация и мощность
        <select className={control} disabled={!engine} value={variant} onChange={event => { setVariant(event.target.value); update(event.target.value); }}>
          <option value="">Выберите модификацию</option>
          {variants.map(option => <option key={option.id} value={option.id}>{option.label} · {option.powerHp} л.с. · {option.market}</option>)}
        </select>
      </label>
      {variant ? <button type="button" className="text-xs underline" onClick={() => { setFuel(""); setEngine(""); setVariant(""); update(""); }}>Сбросить выбор</button> : null}
    </fieldset>
    <p role="status" aria-live="polite" className="mt-3 text-xs text-white/65">{pending ? "Пересчитываем…" : failed ? "Расчёт недоступен: проверьте выбранную версию или попробуйте позже." : selected ? "Расчёт по выбранной вами версии. Характеристики объявления сохранены." : "Итоговая стоимость появится после выбора модификации."}</p>
  </section>;
}
