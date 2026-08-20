import {
  compactEncyclopediaNumber,
  encyclopediaSourceLabel,
  encyclopediaVariantTitle,
  encyclopediaYearRange,
  type PublicEncyclopediaVariant,
} from "@/lib/catalog/encyclopedia-public";

type SpecificationMode = "full" | "compact";

type SpecificationEntry = {
  label: string;
  value?: string;
};

type SpecificationSection = {
  title: string;
  entries: SpecificationEntry[];
};

function valueNumber(value: number | undefined, unit: string) {
  return value ? `${compactEncyclopediaNumber(value)} ${unit}` : undefined;
}

function humanPowertrain(value?: string) {
  const key = String(value || "").toLowerCase();
  if (!key) return undefined;
  if (key === "electric") return "Электромобиль";
  if (key === "series_hybrid") return "Последовательный гибрид";
  if (key === "other_hybrid") return "Гибрид";
  if (key === "ice") return "ДВС";
  return value;
}

function knownEntries(entries: SpecificationEntry[]) {
  return entries.filter((entry) => Boolean(entry.value));
}

function sectionsFor(row: PublicEncyclopediaVariant, title: string): SpecificationSection[] {
  return [
    {
      title: "Основные данные",
      entries: knownEntries([
        { label: "Название модификации", value: encyclopediaVariantTitle(row, title) },
        { label: "Период выпуска", value: encyclopediaYearRange(row.yearFrom, row.yearTo) },
        { label: "Поколение", value: row.generation },
        { label: "Рестайлинг / обновление", value: row.facelift },
        { label: "Рынок", value: row.market },
        { label: "Тип кузова", value: row.bodyType },
        { label: "Источник", value: encyclopediaSourceLabel(row) },
      ]),
    },
    {
      title: "Двигатель и мощность",
      entries: knownEntries([
        { label: "Тип силовой установки", value: humanPowertrain(row.powertrainKind) },
        { label: "Тип топлива", value: row.fuel },
        { label: "Объём двигателя", value: valueNumber(row.engineCc, "см³") },
        { label: "Мощность", value: valueNumber(row.powerHp, "л.с.") },
        { label: "Мощность", value: valueNumber(row.powerKw, "кВт") },
        { label: "Мощность ДВС", value: valueNumber(row.icePowerKw, "кВт") },
        { label: "Пиковая мощность электромотора", value: valueNumber(row.motorPeakKw, "кВт") },
        { label: "Системная мощность", value: valueNumber(row.systemPowerKw, "кВт") },
        { label: "30-минутная мощность", value: valueNumber(row.power30MinKw, "кВт") },
        { label: "Мощность для утильсбора", value: valueNumber(row.utilizationPowerKw, "кВт") },
      ]),
    },
    {
      title: "Трансмиссия и привод",
      entries: knownEntries([
        { label: "Коробка передач", value: row.transmission },
        { label: "Привод", value: row.drive },
      ]),
    },
  ].filter((section) => section.entries.length);
}

export function VehicleSpecifications({
  row,
  title,
  mode = "full",
}: {
  row: PublicEncyclopediaVariant;
  title: string;
  mode?: SpecificationMode;
}) {
  const sections = sectionsFor(row, title);
  if (!sections.length) {
    return <div className="rounded-2xl bg-[var(--ac-surface-2)] p-5 text-sm font-bold text-[var(--ac-muted)]">Подтверждённые технические характеристики для этой модификации пока дополняются.</div>;
  }

  if (mode === "compact") {
    const entries = sections.flatMap((section) => section.entries).slice(0, 8);
    return <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {entries.map((entry) => <div key={`${entry.label}-${entry.value}`} className="rounded-2xl bg-[var(--ac-surface-2)] p-3">
        <dt className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">{entry.label}</dt>
        <dd className="mt-1 text-sm font-black text-[var(--ac-text)]">{entry.value}</dd>
      </div>)}
    </dl>;
  }

  return <div className="space-y-5">
    {sections.map((section) => <section key={section.title} className="overflow-hidden rounded-[1.4rem] border border-[var(--ac-border)] bg-[var(--ac-surface-2)]">
      <h3 className="border-b border-[var(--ac-border)] px-4 py-3 text-base font-black md:px-5 md:text-lg">{section.title}</h3>
      <dl>
        {section.entries.map((entry, index) => <div key={`${entry.label}-${entry.value}-${index}`} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[minmax(190px,0.42fr)_minmax(0,1fr)] md:gap-5 md:px-5 [&+div]:border-t [&+div]:border-[var(--ac-border)]">
          <dt className="font-bold text-[var(--ac-muted)]">{entry.label}</dt>
          <dd className="font-black text-[var(--ac-text)]">{entry.value}</dd>
        </div>)}
      </dl>
    </section>)}
  </div>;
}
