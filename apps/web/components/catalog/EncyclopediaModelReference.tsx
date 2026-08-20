import Link from "next/link";
import {
  compactEncyclopediaNumber,
  encyclopediaGenerationKey,
  encyclopediaSourceLabel,
  encyclopediaVariantTitle,
  encyclopediaYearRange,
  type PublicEncyclopediaVariant,
} from "@/lib/catalog/encyclopedia-public";

function quickFacts(row: PublicEncyclopediaVariant) {
  return [
    row.engineCc ? `${compactEncyclopediaNumber(row.engineCc)} см³` : "",
    row.fuel,
    row.powerHp ? `${compactEncyclopediaNumber(row.powerHp)} л.с.` : "",
    row.transmission,
    row.drive,
  ].filter(Boolean).slice(0, 5);
}

function groupLabel(row: PublicEncyclopediaVariant) {
  if (row.generation && row.facelift) return `${row.generation} · ${row.facelift}`;
  return row.generation || row.facelift || "Поколение уточняется";
}

export function EncyclopediaModelReference({
  variants,
  brandName,
  brandSlug,
  modelName,
  modelSlug,
}: {
  variants: PublicEncyclopediaVariant[];
  brandName: string;
  brandSlug: string;
  modelName: string;
  modelSlug: string;
}) {
  const groups = new Map<string, PublicEncyclopediaVariant[]>();
  for (const row of variants) {
    const key = encyclopediaGenerationKey(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }

  if (!variants.length) {
    return <div className="mt-6 rounded-2xl bg-[var(--ac-surface-2)] p-5 text-sm font-bold text-[var(--ac-muted)]">Подтверждённые модификации этой модели пока дополняются.</div>;
  }

  return <div className="mt-7 space-y-5">
    {[...groups.values()].map((rows) => {
      const first = rows[0];
      const from = rows.map((row) => row.yearFrom).filter((value): value is number => Boolean(value));
      const to = rows.map((row) => row.yearTo).filter((value): value is number => Boolean(value));
      const yearFrom = from.length ? Math.min(...from) : undefined;
      const yearTo = to.length ? Math.max(...to) : undefined;
      return <section key={encyclopediaGenerationKey(first)} className="overflow-hidden rounded-[1.55rem] bg-[var(--ac-surface-2)]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ac-border)] px-4 py-4 md:px-5">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">Поколение / период</div>
            <h3 className="mt-1 text-xl font-black md:text-2xl">{groupLabel(first)}</h3>
            <p className="mt-1 text-xs font-bold text-[var(--ac-muted)]">{encyclopediaYearRange(yearFrom, yearTo)}</p>
          </div>
          <span className="rounded-full bg-[var(--ac-surface-3)] px-3 py-2 text-xs font-black">{rows.length} {rows.length === 1 ? "модификация" : "модификации"}</span>
        </div>
        <div className="grid gap-2 p-3 md:grid-cols-2 md:p-4 xl:grid-cols-3">
          {rows.map((row) => <Link
            key={row.id}
            href={`/cars/brand/${brandSlug}/model/${modelSlug}/modification/${row.slug}`}
            className="group rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-4 transition hover:-translate-y-0.5 hover:border-red-500/45"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-base font-black leading-5">{encyclopediaVariantTitle(row, `${brandName} ${modelName}`)}</div>
              <span className="shrink-0 text-lg font-black text-red-500 transition-transform group-hover:translate-x-0.5">→</span>
            </div>
            <div className="mt-2 text-[10px] font-black uppercase tracking-wide text-emerald-500">{encyclopediaSourceLabel(row)}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {quickFacts(row).map((fact) => <span key={String(fact)} className="rounded-full bg-[var(--ac-surface-2)] px-2.5 py-1.5 text-[11px] font-black text-[var(--ac-text)]">{fact}</span>)}
            </div>
            <div className="mt-3 text-xs font-bold text-[var(--ac-muted)]">Открыть подробные характеристики</div>
          </Link>)}
        </div>
      </section>;
    })}
  </div>;
}
