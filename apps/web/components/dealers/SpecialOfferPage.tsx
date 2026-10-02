import {ChevronDown} from 'lucide-react';
import {SpecTile,type SpecIconName} from '@/components/catalog/OfferSpecTile';
import {StickyOfferColumn} from '@/components/catalog/StickyOfferColumn';
import {OfferSpecificationsDisclosure} from '@/components/catalog/OfferSpecificationsDisclosure';
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCopyOffer } from "@/lib/offer-copy";
import { getSpecialOffer } from "@/lib/dealers/public-showcase";
import {
  calculateSpecial,
  offerAvailability, offerAvailabilityLabel, offerSectionEnabled,
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
  const c = calculateSpecial(s, o);
  const stock=offerAvailability(o)==="stock";
  const office=stock?s.offices.find(item=>item.id===o.officeId):null;
  const title = specialTitle(o);
  const snapshot = {
    id,
    title,
    price: c.totalRub,
    imageUrl: o.photos[0]?.url,
    year: o.year,
    mileageKm: o.mileageKm,
    market: "dealer",
    marketLabel: `${offerAvailabilityLabel(o)} · ${s.name}`,
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
  const specIcons:Record<string,SpecIconName>={Год:'year',Двигатель:'engine',Мощность:'power',Пробег:'mileage',Топливо:'fuel',КПП:'transmission',Привод:'drive',Кузов:'body',Цвет:'body',Руль:'drive'};
  const groups=[{name:'Характеристики',items:fields.map(([name,value])=>({name,value}))},...(o.equipment?[{name:'Оснащение',items:[{name:'Комплектация',value:o.equipment}]}]:[])];
  return (
    <main
      data-offer-id={id}
      data-offer-share-name={title} data-offer-share-year={o.year} data-offer-share-engine-cc={o.engineCc} data-offer-share-fuel={o.fuel}
      data-offer-price-rub={c.totalRub || undefined}
      data-offer-preview={JSON.stringify({ ...snapshot, totalRub: c.totalRub })}
      className="ac-offer-page ac-page-copy min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"
    >
      <PublicHeader backHref="/" backLabel="На главную" />
      <div className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
        {preview && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3">
            Предпросмотр владельца ·{" "}
            {o.status === "published" && offerSectionEnabled(s,o)
              ? "Автомобиль опубликован"
              : "Автомобиль скрыт от посетителей"}
          </p>
        )}
        <div className="ac-offer-layout grid min-w-0 gap-3 xl:gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,.75fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.6fr)_480px]">
          <div className="min-w-0">
            <header><p className="text-xs font-black uppercase tracking-[.14em] text-[var(--ac-muted)]">{offerAvailabilityLabel(o)} · {s.name}</p><h1 className="mt-2 text-3xl font-black leading-[1.02] tracking-[-.04em] md:text-5xl">{title}</h1></header>
            <div className="mt-5 min-w-0 overflow-hidden">
            <VehicleGallery
              images={o.photos.map((p) => p.url)}
              title={title}
              offerId={id}
              snapshot={snapshot}
            />
            </div>
            <OfferSpecificationsDisclosure groups={groups} title={title} mode="desktop" />
            {!preview&&<OfferDesktopActions position="below" offerId={id} snapshot={snapshot}/>}
          </div>
          <StickyOfferColumn>
          <div className="ac-inline-parameters min-w-0">
            <section className="ac-offer-price-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4">
              <p className="text-sm text-[var(--ac-muted)]">
                {stock ? "Цена автомобиля в наличии" : c.city ? `Стоимость с доставкой до ${c.city}` : "Стоимость автомобиля"}
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
            </section>
            {!preview&&<OfferMobileActions offerId={id} snapshot={snapshot}/>}
            {c.complete && !stock ? <details className="ac-offer-breakdown group mt-4 rounded-[1.35rem] bg-[var(--ac-surface-2)]">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 font-bold [&::-webkit-details-marker]:hidden">Структура цены<ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/></summary>
              <dl className="space-y-3 px-4 pb-4">{c.lines.map(l=><div key={l.id} className="flex justify-between gap-3 text-sm"><dt>{l.title}</dt><dd className="shrink-0 font-bold">{l.amountRub.toLocaleString('ru-RU')} ₽</dd></div>)}</dl>
              <p className="px-4 pb-4 text-xs text-[var(--ac-muted)]">Курс расчёта: 1 $ = {c.rate.toLocaleString('ru-RU')} ₽. {o.customsIncluded?'Таможенные платежи включены в цену автомобиля.':''}</p>
            </details>:!c.complete?<p className="mt-4 text-sm text-[var(--ac-muted)]">Уточним актуальную стоимость и доставку при обращении.</p>:null}
            <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">{stock ? `Автомобиль находится по адресу: ${[office?.city,office?.address].filter(Boolean).join(", ")}. ${o.condition==="used"?"С пробегом":"Новый автомобиль"}. Доставка в другой город согласуется отдельно.` : "Доставка из базового города до вашего города рассчитывается отдельно. Наличие, стоимость и срок подтвердим перед заключением договора."}</p>
            <aside className="ac-offer-detail-stack mt-4 min-w-0">
              <div className="ac-offer-spec-stack space-y-2.5">
                <div className="ac-offer-spec-grid grid min-w-0 grid-cols-2 gap-2.5">{fields.map(([label,value],index)=><SpecTile key={label} label={label} value={value} icon={specIcons[label]} fullWidth={fields.length%2===1&&index===fields.length-1}/>)}</div>
                <OfferSpecificationsDisclosure groups={groups} title={title} mode="mobile"/>
              </div>
              {!preview&&<OfferDesktopActions offerId={id} snapshot={snapshot}/>}
            </aside>
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
          </StickyOfferColumn>
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
