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

// Placement is intentionally left to the approved detail-page layout.
// Unknown labels and source values are preserved, never guessed or run as HTML.
export function OfferAllSpecifications({ snapshot }: { snapshot?: SourceSpecificationSnapshot }) {
  if (!snapshot?.groups.length) return null;
  return <section className="min-w-0 text-[var(--ac-text)]" aria-label="Все характеристики">
    <h2 className="text-xl font-black">Все характеристики</h2>
    <p className="mt-1 text-xs text-[var(--ac-muted)]">По данным источника. Указанные параметры уточняются перед покупкой.</p>
    {snapshot.groups.map((group, groupIndex) => <div key={groupIndex} className="mt-6 min-w-0">
      <h3 className="text-base font-bold">{LABELS[group.name] || group.name}</h3>
      <dl className="mt-2 grid min-w-0 gap-x-8 md:grid-cols-2">
        {group.items.map((item, itemIndex) => <div key={itemIndex} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-[var(--ac-border)] py-3 text-sm leading-5">
          <dt className="break-words text-[var(--ac-muted)]">{LABELS[item.name] || item.name}</dt>
          <dd className="min-w-0 break-words font-medium">{item.value.trim() && item.value.trim() !== "-" ? item.value : "Не указано"}</dd>
        </div>)}
      </dl>
    </div>)}
  </section>;
}
