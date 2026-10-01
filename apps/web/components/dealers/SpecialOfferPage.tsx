import {dealerProfilePath} from '@/lib/dealers/profile-url';
import { DealerCitySync } from "./DealerCitySync";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCopyOffer } from "@/lib/offer-copy";
import { getSpecialOffer } from "@/lib/dealers/public-showcase";
import {
  calculateSpecial,
  specialTitle,
  specialPath,
} from "@/lib/dealers/showcase-model";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import {
  OfferDesktopActions,
  OfferMobileActions,
  OfferContactActionsStyles,
} from "@/components/catalog/OfferContactActions";
import { OfferCopyButton } from "@/components/catalog/OfferCopyButton";
export async function SpecialOfferPage({
  id,
  previewRequested = false,
}: {
  id: string;
  previewRequested?: boolean;
}) {
  const user = await getCurrentUser();
  const preview = previewRequested && user?.role === "owner";
  const found = await getSpecialOffer(id, preview);
  if (!found) notFound();
  const { showcase: s, offer: o } = found;
  let city = (await cookies()).get("avtocena_city")?.value || "";
  try {
    city = decodeURIComponent(city);
  } catch {}
  const c = calculateSpecial(s, o);
  const title = specialTitle(o);
  const snapshot = {
    id,
    title,
    price: c.totalRub,
    imageUrl: o.photos[0]?.url,
    year: o.year,
    mileageKm: o.mileageKm,
    market: "dealer",
    marketLabel: `Спецпредложение · ${s.name}`,
    href: specialPath(s.dealerId, o.id),
  };
  const fields = [
    ["Год", o.year ? `${o.year} г.` : ""],
    ["Двигатель", o.engineCc ? `${o.engineCc} см³` : ""],
    ["Мощность", o.powerHp ? `${o.powerHp} л.с.` : ""],
    ["Пробег", `${o.mileageKm.toLocaleString("ru-RU")} км`],
    [
      "Топливо",
      {
        petrol: "Бензин",
        diesel: "Дизель",
        electric: "Электро",
        hybrid: "Гибрид",
        series_hybrid: "Последовательный гибрид",
      }[o.fuel],
    ],
    ["КПП", o.transmission],
    ["Привод", o.drive],
    ["Кузов", o.body],
    ["Цвет", o.color],
    ["Руль", o.steering === "left" ? "Левый" : "Правый"],
  ].filter(([, v]) => v);
  return (
    <main
      data-offer-id={id}
      data-offer-share-name={title} data-offer-share-year={o.year} data-offer-share-engine-cc={o.engineCc} data-offer-share-fuel={o.fuel}
      data-offer-price-rub={c.totalRub || undefined}
      data-offer-preview={JSON.stringify({ ...snapshot, totalRub: c.totalRub })}
      className="ac-offer-page ac-page-copy min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"
    >
      <DealerCitySync />
      <PublicHeader backHref="/" backLabel="На главную" />
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6">
        {preview && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3">
            Предпросмотр владельца ·{" "}
            {o.status === "published" && s.specialsEnabled
              ? "Автомобиль опубликован"
              : "Автомобиль скрыт от посетителей"}
          </p>
        )}
        <p className="mb-2 font-bold text-red-500">
          Спецпредложение · {s.name}
        </p>
        <h1 className="mb-5 text-3xl font-black md:text-5xl">{title}</h1>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <VehicleGallery
              images={o.photos.map((p) => p.url)}
              title={title}
              offerId={id}
              snapshot={snapshot}
            />
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fields.map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-3"
                >
                  <dt className="text-xs text-[var(--ac-muted)]">{k}</dt>
                  <dd className="mt-1 font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="ac-inline-parameters min-w-0">
            <section className="ac-offer-price-panel rounded-3xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5">
              <p className="text-sm text-[var(--ac-muted)]">
                {c.city ? `Цена в городе ${c.city}` : "Стоимость автомобиля"}
              </p>
              <p className="ac-price mt-2 text-3xl font-black">
                {c.totalRub === null
                  ? "Цена уточняется"
                  : `${c.totalRub.toLocaleString("ru-RU")} ₽`}
              </p>
              {c.daysFrom && (
                <p className="mt-2 font-bold text-green-500">
                  Доставка {c.daysFrom}–{c.daysTo} дней
                </p>
              )}
              {c.complete ? (
                <>
                  <details className="mt-5" data-ac-preserve-open open>
                    <summary className="cursor-pointer font-bold">
                      Что входит в стоимость
                    </summary>
                    <dl className="mt-3 space-y-3">
                      {c.lines.map((l) => (
                        <div
                          key={l.id}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <dt>{l.title}</dt>
                          <dd className="shrink-0 font-bold">
                            {l.amountRub.toLocaleString("ru-RU")} ₽
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <p className="mt-4 text-xs text-[var(--ac-muted)]">
                    Курс расчёта: 1 $ = {c.rate.toLocaleString("ru-RU")} ₽.{" "}
                    {o.customsIncluded
                      ? "Таможенные платежи включены в цену автомобиля."
                      : ""}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-[var(--ac-muted)]">
                  Уточним актуальную стоимость и доставку в выбранный город при
                  обращении.
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--ac-muted)]">
                Доставка из базового города до вашего города рассчитывается отдельно. Наличие, стоимость и срок подтвердим перед заключением
                договора.
              </p>
            </section>
            {!preview && (
              <>
                <OfferDesktopActions
                  position="below"
                  offerId={id}
                  snapshot={snapshot}
                />
                <OfferMobileActions offerId={id} snapshot={snapshot} />
              </>
            )}
            {canCopyOffer(user) && (
              <OfferCopyButton
                offerId={id}
                title={title}
                mileageKm={o.mileageKm}
                pending={false}
                draft={{
                  year: String(o.year),
                  engineCc: String(o.engineCc),
                  powerHp: String(o.powerHp),
                }}
              />
            )}
            {s.profileEnabled && (
              <Link
                className="mt-5 block rounded-xl border border-[var(--ac-border)] p-4 font-bold"
                href={dealerProfilePath(s)}
              >
                О дилере {s.name} →
              </Link>
            )}
          </div>
        </div>
        {o.description && (
          <section className="mt-8">
            <h2 className="text-2xl font-black">Об автомобиле</h2>
            <p className="mt-3 whitespace-pre-line">{o.description}</p>
          </section>
        )}
        {o.equipment && (
          <section className="mt-8">
            <h2 className="text-2xl font-black">Оснащение</h2>
            <p className="mt-3 whitespace-pre-line">{o.equipment}</p>
          </section>
        )}
      </div>
      <OfferContactActionsStyles />
    </main>
  );
}
