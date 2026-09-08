import type { SourceSpecificationSnapshot } from "../../lib/catalog/source-specifications";

const LABELS: Record<string, string> = {
  "Basic Specifications": "Основные характеристики", "Engine": "Двигатель",
  "Body": "Кузов", "Transmission": "Коробка передач", "Chassis Steering": "Шасси и рулевое управление",
  "Model Name": "Модификация", "Energy Type": "Тип топлива",
  "Displacement (mL)": "Рабочий объём, см³", "Displacement (L)": "Объём, л",
  "Maximum horsepower (Ps)": "Максимальная мощность, л.с.", "Maximum power (kW)": "Максимальная мощность, кВт",
  "Engine Model": "Модель двигателя", "Length (mm)": "Длина, мм", "Width (mm)": "Ширина, мм",
  "Height (mm)": "Высота, мм", "Wheelbase (mm)": "Колёсная база, мм",
};

// Unknown labels and source values are preserved, never guessed or run as HTML.
export function OfferAllSpecifications({ snapshot, groups = snapshot?.groups || [], showHeading = true, sourceUrl }: { snapshot?: SourceSpecificationSnapshot; groups?: SourceSpecificationSnapshot["groups"]; showHeading?: boolean; sourceUrl?: string }) {
  if (!groups.length) return <p className="text-sm text-[var(--ac-muted)]">Источник пока не предоставил характеристики.</p>;
  return <section className="min-w-0 text-[var(--ac-text)]" aria-label="Все характеристики">
    {showHeading ? <h2 className="text-xl font-black">Все характеристики</h2> : null}
    {groups.map((group, groupIndex) => <div key={groupIndex} className="mt-6 min-w-0 first:mt-0">
      <h3 className="text-[13px] font-black uppercase tracking-[0.08em]">{LABELS[group.name] || group.name}</h3>
      <dl className="mt-2 grid min-w-0 gap-x-8 xl:grid-cols-2">
        {group.items.map((item, itemIndex) => <div key={itemIndex} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-[var(--ac-border)] py-2.5 text-[13px] leading-5">
          <dt className="break-words text-[var(--ac-muted)]">{LABELS[item.name] || item.name}</dt>
          <dd className="min-w-0 break-words text-right font-semibold">{item.value.trim() && item.value.trim() !== "-" ? item.value : "Не указано"}</dd>
        </div>)}
      </dl>
    </div>)}
    {sourceUrl && /^https?:\/\//i.test(sourceUrl) ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#ef3340] underline underline-offset-4">Открыть объявление источника ↗</a> : null}
  </section>;
}
