'use client';
import {videoReviews,withoutVideoLinks} from '@/lib/dealers/video-review';
import {VideoReviews} from './VideoReviews';
import {useSelectedCity} from '@/lib/location/selected-city';
import {useState} from 'react';
import {encodeShareDraft} from '@/lib/catalog/offer-share';
import {DeliveryCityPanel} from '../catalog/DeliveryCityPanel';
import {DealerMap} from './DealerMap';
import {MapPin,ChevronDown} from 'lucide-react';
import {OfferUpdatedStatus} from '@/components/catalog/OfferUpdatedStatus';
import {VerifiedDealerBadge} from './VerifiedDealerBadge';
import {SpecialRail,type SpecialRailItem} from './SpecialRail';
import type {ReactNode} from 'react';
import {StickyOfferColumn} from '@/components/catalog/StickyOfferColumn';
import {OfferSpecificationsDisclosure} from '@/components/catalog/OfferSpecificationsDisclosure';
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import Link from "next/link";
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
import {OfferPdfButton} from "@/components/catalog/OfferPdfButton";
import { OfferCopyButton } from "@/components/catalog/OfferCopyButton";
import type {DealerShowcase,SpecialOffer} from '@/lib/dealers/showcase-model';
export type PublicOfferShowcase=Pick<DealerShowcase,"dealerId"|"citySlug"|"slug"|"name"|"logoLight"|"logoDark"|"profileEnabled"|"specialsEnabled"|"stockEnabled"|"pricing"|"offices"|"updatedAt">;
export function DealerOfferView({id,s,o,initialCity,preview=false,verified=false,canCopy=false,localCitySelection=false,canPdf=false,items=[],markets}:{id:string;initialCity?:string;s:PublicOfferShowcase;o:SpecialOffer;preview?:boolean;verified?:boolean;canCopy?:boolean;localCitySelection?:boolean;canPdf?:boolean;items?:SpecialRailItem[];markets?:ReactNode}) {
  const globalCity=useSelectedCity();
  const privateCity=localCitySelection||initialCity!==undefined;
  const [quoteCity,setQuoteCity]=useState<string|null>(initialCity??null);
  const city=privateCity ? quoteCity??globalCity : globalCity;
  const c = calculateSpecial(s, o, city);
  const stock=offerAvailability(o)==="stock";
  const office=stock?s.offices.find(item=>item.id===o.officeId):s.offices.find(item=>item.id===o.officeId)||s.offices[0];
  const title = specialTitle(o);
  const snapshot = {
    id,
    title,
    price: c.totalRub,
    imageUrl: o.photos[0]?.url,
    year: o.year,
    mileageKm: o.mileageKm,
    market: "dealer",
    dealerId: s.dealerId, dealerName: s.name,
    marketLabel: `${offerAvailabilityLabel(o)} · ${s.name}`,
    href: `${specialPath(s.dealerId, o.id)}?estimate=${encodeShareDraft({deliveryCity:city})}`,
    deliveryCity:city,
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
  const reviews=videoReviews(o.videoUrl,o.equipment,o.description);
  const equipment=withoutVideoLinks(o.equipment);
  const description=withoutVideoLinks(o.description);
  const groups=[{name:'Характеристики',items:fields.map(([name,value])=>({name,value}))},...(equipment?[{name:'Оснащение',items:[{name:'Комплектация',value:equipment}]}]:[])];
  const updated = new Date(o.updatedAt || s.updatedAt);
  const updatedStatus = Number.isFinite(updated.getTime()) ? <OfferUpdatedStatus dealer date={updated.toLocaleDateString("ru-RU",{timeZone:"Asia/Krasnoyarsk"})} time={updated.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Krasnoyarsk"})} sourceUrl={s.profileEnabled?dealerProfilePath(s):undefined} sourceName={s.name}/> : null;
  return (
    <main
      data-offer-id={id}
      data-offer-share-name={title} data-offer-share-year={o.year} data-offer-share-engine-cc={o.engineCc} data-offer-share-fuel={o.fuel}
      data-offer-price-rub={c.totalRub || undefined}
      data-offer-preview={JSON.stringify({ ...snapshot, totalRub: c.totalRub })}
      className="ac-offer-page ac-dealer-offer ac-page-copy min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"
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
            <header><p className="text-xs font-black normal-case tracking-normal text-[var(--ac-muted)]">{offerAvailabilityLabel(o)} · {s.name}</p><h1 className="mt-2 text-3xl font-black leading-[1.02] tracking-[-.04em] md:text-5xl">{title}</h1></header>
            <div className="mt-5 min-w-0 overflow-hidden">
            <VehicleGallery
              images={o.photos.map((p) => p.url)}
              title={title}
              offerId={id}
              snapshot={snapshot}
            />
            </div>

          </div>
          <StickyOfferColumn className="xl:col-start-2 xl:row-start-1 xl:row-span-2">
          <div className="ac-inline-parameters min-w-0" data-share-estimate={encodeShareDraft({deliveryCity:city})}>
            <section className="ac-price-trend-panel ac-offer-price-panel is-down rounded-[1.35rem] p-4">
              <p className="ac-price-trend-label text-[10px] font-black normal-case tracking-normal text-[var(--ac-text)] md:text-[11px]">
                {stock ? "Цена автомобиля в наличии" : c.city ? `Стоимость с доставкой до ${c.city}` : "Стоимость автомобиля"}
              </p>
              <p className="ac-price ac-price--down mt-2 text-3xl font-black">
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

            {c.complete ? <details className="ac-offer-breakdown group mt-4 rounded-[1.35rem] bg-[var(--ac-surface-2)]">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 font-bold [&::-webkit-details-marker]:hidden">Структура цены<ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180"/></summary>
              <dl className="space-y-3 px-4 pb-4">{c.lines.map(l=><div key={l.id} className="flex justify-between gap-3 text-sm"><dt>{l.title}</dt><dd className="shrink-0 font-bold">{l.amountRub.toLocaleString('ru-RU')} ₽</dd></div>)}</dl>
              {!stock&&<p className="px-4 pb-4 text-xs text-[var(--ac-muted)]">Курс расчёта: 1 $ = {c.rate.toLocaleString('ru-RU')} ₽. {o.customsIncluded?'Таможенные платежи включены в цену автомобиля.':''}</p>}
            </details>:!c.complete?<p className="mt-4 text-sm text-[var(--ac-muted)]">Уточним актуальную стоимость и доставку при обращении.</p>:null}
            <OfferMobileActions offerId={id} snapshot={snapshot}/>
            <OfferDesktopActions offerId={id} snapshot={snapshot}/>
            {!stock&&<DeliveryCityPanel value={city} onChange={setQuoteCity} persistSelection={!privateCity} syncStored={false} description={city&&c.complete?`Доставка: ${s.pricing.originCity||'Бишкек'} → ${city}: около ${(c.lines.find(l=>l.id==='delivery')?.amountRub||0).toLocaleString('ru-RU')} ₽. Предварительный тариф, подтвердим перед заказом.`:'Выберите город, чтобы рассчитать доставку до вас.'}/>}
            <div className="mt-3 xl:hidden">{updatedStatus}</div>
            <section className="dealer-offer-identity relative mt-4 rounded-[1.35rem] border border-[var(--ac-border)] bg-[var(--ac-surface)] p-4" aria-label="Дилер объявления">
              {s.profileEnabled&&<Link href={dealerProfilePath(s)} className="absolute inset-0 z-10 rounded-[1.35rem]" aria-label={`Профиль дилера ${s.name}`}/>}
              <div className="flex items-center gap-3">
                <div className="dealer-offer-logo flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--ac-surface-2)]">{s.logoLight||s.logoDark?<><img className="dealer-logo-light h-full w-full object-contain" src={s.logoLight||s.logoDark} alt=""/><img className="dealer-logo-dark h-full w-full object-contain" src={s.logoDark||s.logoLight} alt=""/></>:<span className="text-lg font-black">{s.name.slice(0,2)}</span>}</div>
                <div className="min-w-0"><p className="text-xs text-[var(--ac-muted)]">Дилер объявления</p><div className="mt-1 flex items-center gap-2">{s.profileEnabled?<Link className="text-lg font-black" href={dealerProfilePath(s)}>{s.name}</Link>:<strong className="text-lg">{s.name}</strong>}{verified&&<span className="relative z-20"><VerifiedDealerBadge/></span>}</div>{verified&&<p className="mt-1 text-xs text-[var(--ac-muted)]">Проверенный дилер</p>}</div>
              </div>
              {office&&<div className="relative z-20 mt-4 border-t border-[var(--ac-border)] pt-3"><p className="mb-2 text-xs font-bold text-[var(--ac-muted)]">{stock?'Адрес автомобиля':'Офис дилера'}</p><p className="flex items-start gap-2 text-sm"><MapPin size={17} className="mt-0.5 shrink-0 text-emerald-500"/><span>{[office.city,office.address].filter(Boolean).join(', ')}</span></p><DealerMap offices={[(({phone,...publicOffice})=>publicOffice)(office)]} compact autoLoad/></div>}
            </section>
            <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">{stock ? `Автомобиль находится по адресу: ${[office?.city,office?.address].filter(Boolean).join(", ")}. ${o.condition==="used"?"С пробегом":"Новый автомобиль"}. Доставка в другой город согласуется отдельно.` : "Выберите свой город для расчёта доставки. Стоимость для новых направлений ориентировочная. Наличие, маршрут и срок подтвердим перед заключением договора."}</p>
            {canPdf&&<OfferPdfButton offerId={id} draft={{deliveryCity:city}}/>}
            {canCopy && (
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

          </div>
          </StickyOfferColumn>
          <div className="min-w-0 xl:col-start-1 xl:row-start-2">
            <OfferSpecificationsDisclosure groups={groups} title={title} mode="desktop" defaultOpen headerAside={updatedStatus} />
            <OfferSpecificationsDisclosure groups={groups} title={title} mode="mobile"/>
            <VideoReviews items={reviews}/>
        {description && (
          <section className="mt-8 min-w-0">
            <h2 className="text-2xl font-black">Об автомобиле</h2>
            <p className="mt-3 whitespace-pre-line [overflow-wrap:anywhere]">{description}</p>
          </section>
        )}

          </div>
        </div>
        <div className="mt-10" data-dealer-related><SpecialRail kinds={stock?["stock","order"]:["order","stock"]} heading={`Ещё автомобили · ${s.name}`} items={items.filter(item=>item.id!==o.id)}/>{markets}</div>
      </div>
      <OfferContactActionsStyles />
      <style>{`
        .dealer-verification:hover>span{display:block}
        .dealer-verification:not([open]):not(:hover)>span{display:none}
        .ac-dealer-offer .ac-offer-actions-sidebar{display:grid!important}
        .dealer-offer-logo .dealer-logo-dark{display:none}
        html[data-theme="dark"] .dealer-offer-logo .dealer-logo-light{display:none}
        html[data-theme="dark"] .dealer-offer-logo .dealer-logo-dark{display:block}
        .dealer-offer-identity section{margin-top:12px}
        .dealer-offer-identity iframe{height:170px}
        @media(max-width:1279px){.ac-dealer-offer .ac-offer-actions-sidebar{display:none!important}}
      `}</style>
    </main>
  );
}
