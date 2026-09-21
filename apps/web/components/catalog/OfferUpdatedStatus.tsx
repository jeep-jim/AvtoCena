export function OfferUpdatedStatus({date, time, sourceUrl}: {date: string; time: string; sourceUrl?: string}) {
  return <details className="ac-offer-updated group min-w-0 rounded-2xl bg-[var(--ac-surface-2)] text-[var(--ac-text)]">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs font-bold xl:min-h-14 [&::-webkit-details-marker]:hidden">
      <span>Обновлено {date}{time ? `, ${time}` : ""}</span>
      <svg aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </summary>
    <p className="px-4 pb-3 text-xs leading-5 text-[var(--ac-muted)]">Возможность покупки и финальную стоимость подтвердит менеджер.{sourceUrl ? <> <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">Открыть источник ↗</a></> : null}</p>
  </details>;
}
