import { ChevronDown } from "lucide-react";

export function OfferUpdatedStatus({date, time, sourceUrl, sourceName}: {date: string; time: string; sourceUrl?: string; sourceName?: string}) {
  return <details className="ac-offer-updated group min-w-0 rounded-2xl bg-[var(--ac-surface-2)] text-[var(--ac-text)]">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-bold xl:min-h-14 [&::-webkit-details-marker]:hidden">
      <span>Обновлено {date}{time ? `, ${time}` : ""}</span>
      <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <p className="px-4 pb-3 text-xs leading-5 text-[var(--ac-muted)]">Возможность покупки и финальную стоимость подтвердит менеджер.{sourceUrl ? <> <a href={sourceUrl} target={sourceName ? undefined : "_blank"} rel={sourceName ? undefined : "noopener noreferrer"} className="underline">{sourceName ? `Источник: ${sourceName} →` : "Открыть источник ↗"}</a></> : sourceName ? <> Источник: {sourceName}.</> : null}</p>
  </details>;
}
