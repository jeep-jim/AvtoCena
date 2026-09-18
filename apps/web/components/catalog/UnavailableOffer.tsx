import Link from "next/link";
import { PublicHeader } from "@/components/layout/PublicHeader";
import type { UnavailableOffer as UnavailableOfferRecord } from "@/lib/catalog/offer-availability";

export function UnavailableOffer({ offer, calculationUnavailable = false }: { offer?: UnavailableOfferRecord | null; calculationUnavailable?: boolean }) {
  const title = calculationUnavailable ? "Расчёт временно недоступен"
    : offer?.reason === "sold" ? "Автомобиль продан"
    : offer?.reason === "removed" ? "Объявление снято с продажи" : "Автомобиль сейчас недоступен в каталоге";
  const description = calculationUnavailable
    ? "Сейчас не хватает подтверждённых данных для точной цены. Это не означает, что автомобиль продан."
    : offer?.reason === "sold" || offer?.reason === "removed"
      ? "Источник подтвердил изменение статуса объявления. Подробности можно проверить на его странице."
      : "Объявление больше не входит в актуальную подборку. Автомобиль мог быть продан или снят с продажи; точную причину уточняйте на источнике.";
  const catalogHref = offer?.market ? `/cars?${new URLSearchParams({market: offer.market})}` : "/cars";
  return <><PublicHeader /><main className="mx-auto w-full max-w-3xl px-4 py-14 md:py-24">
    <section className="rounded-3xl bg-[var(--ac-surface)] p-6 md:p-10" aria-labelledby="unavailable-offer-title">
      {offer ? <p className="mb-3 text-sm text-[var(--ac-muted)]">{[offer.make, offer.model].filter(Boolean).join(" ")}</p> : null}
      <h1 id="unavailable-offer-title" className="text-3xl font-black leading-tight text-[var(--ac-text)]">{title}</h1>
      <p className="mt-5 leading-relaxed text-[var(--ac-muted)]">{description}</p>
      {offer?.market === "japan" ? null : offer?.sourceUrl ? <p className="mt-5 text-sm"><a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">Открыть исходное объявление ↗</a></p>
        : <p className="mt-4 text-sm text-[var(--ac-muted)]">Ссылка на исходное объявление не сохранилась.</p>}
      <p className="mt-8 text-[var(--ac-text)]">Посмотрите другие автомобили, которые есть в каталоге.</p>
      <Link href={catalogHref} className="mt-4 inline-flex rounded-2xl bg-[var(--ac-red,#ff3343)] px-6 py-4 font-bold text-white">Перейти в каталог →</Link>
    </section>
  </main></>;
}
