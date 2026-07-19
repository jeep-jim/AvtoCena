import type { ReactNode } from "react";
import Link from "next/link";
import { money } from "@/lib/avtocena";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { OfferLeadForm } from "@/components/catalog/OfferLeadForm";
import { PriceTrend } from "@/components/catalog/PriceTrend";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { catalogBrandSlug } from "@/lib/catalog/brands";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { getOffer, publicOffer, searchOffers } from "@/lib/catalog/storage";

type SpecIconName = "year" | "mileage" | "engine" | "fuel" | "power" | "transmission" | "drive" | "body";

function SpecIcon({ name }: { name: SpecIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<SpecIconName, ReactNode> = {
    year: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17" /><path d="M8 13h3M13.5 13H16M8 16.5h3M13.5 16.5H16" /></>,
    mileage: <><path d="M4 17.5a8.5 8.5 0 1 1 16 0" /><path d="m12 12 4.5-3" /><circle cx="12" cy="12" r="1.3" /><path d="M7 18h10" /></>,
    engine: <><path d="M5 8.5h11.5l2 2v6.5H7l-2-2z" /><path d="M8 8.5V6h5v2.5M19 11h2v4h-2M5 11H3v3h2M9 12h4" /></>,
    fuel: <><path d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4h6A1.5 1.5 0 0 1 15 5.5V20" /><path d="M4 20h13M8 7h5v4H8zM15 8h2l2 2v6.5a1.5 1.5 0 0 0 3 0V9l-2-2" /></>,
    power: <path d="M13.5 2.8 5.8 13h5.1l-.7 8.2L18.3 11h-5.1z" />,
    transmission: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><circle cx="17" cy="19" r="2" /><path d="M7 7v10M17 7v10M7 12h10" /></>,
    drive: <><path d="M8.2 6.5h7.6M12 6.5v11M8.2 17.5h7.6" /><rect x="4.2" y="2.5" width="4" height="7" rx="1.2" transform="rotate(27 6.2 6)" /><rect x="15.8" y="2.5" width="4" height="7" rx="1.2" transform="rotate(27 17.8 6)" /><rect x="4.2" y="14" width="4" height="7" rx="1.2" /><rect x="15.8" y="14" width="4" height="7" rx="1.2" /></>,
    body: <><circle cx="7" cy="17" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M4.5 17H3v-4l2-1 2.5-5h8.5l3 5 2 1v4h-1.5M9.5 17h5" /><path d="M8 9h7" /></>,
  };
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[var(--ac-text)] opacity-50" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

function sentence(value: unknown) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toLocaleUpperCase("ru-RU") + text.slice(1) : "";
}

function driveValue(value: unknown) {
  const normalized = sentence(value);
  if (!normalized || /уточняется|не указан/i.test(normalized)) return "Привод уточняется";
  return /привод/i.test(normalized) ? normalized : `${normalized} привод`;
}

function SpecTile({ label, value, icon }: { label: string; value: string; icon: SpecIconName }) {
  return <div aria-label={`${label}: ${value}`} title={label} className="ac-offer-spec-tile flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3.5"><SpecIcon name={icon} /><span className="min-w-0 break-words text-[13px] font-semibold leading-[1.28] text-[var(--ac-text)] md:text-sm">{value}</span></div>;
}

function safeExternalUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

type BreakdownLine = { id?: string; title: string; amountRub: number };
function priceBreakdown(offer: any): BreakdownLine[] {
  const actual = Array.isArray(offer?.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
      .map((line: any) => ({ id: String(line?.id || line?.title || ""), title: String(line?.title || "Расход"), amountRub: Number(line?.amountRub || 0) }))
      .filter((line: BreakdownLine) => line.amountRub !== 0)
    : [];
  if (actual.length) return actual;
  const total = Number(offer?.totalRub || 0);
  return total ? [{ id: "total", title: "Стоимость автомобиля", amountRub: total }] : [];
}

function OfferPriceBreakdown({ offer }: { offer: any }) {
  const lines = priceBreakdown(offer);
  if (!lines.length) return null;
  return <section className="ac-offer-breakdown min-w-0 rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4"><h2 className="ac-offer-block-title text-lg font-bold tracking-[-0.02em] text-[var(--ac-text)] md:text-xl">Структура цены</h2><div className="ac-offer-breakdown-lines mt-2 border-t border-dotted border-[var(--ac-border)] pt-2">{lines.map((line, index) => <div key={`${line.id || line.title}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-[12px] font-medium md:text-[13px]"><span className="ac-offer-breakdown-label flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]"><span className="min-w-0 truncate">{line.title}</span><span className="ac-offer-dotted-line mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" /></span><span className="ac-offer-breakdown-value whitespace-nowrap font-bold text-[var(--ac-text)]">{money(line.amountRub)} ₽</span></div>)}</div></section>;
}

function MissingOffer() {
  return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white"><PublicHeader backHref="/cars" backLabel="В каталог" /><section className="mx-auto max-w-4xl px-4 py-20 text-center"><h1 className="text-4xl font-black">Предложение не найдено</h1><p className="mt-3 font-bold text-[var(--ac-muted)]">Карточка скрыта, если источник передал неверную цену, фотографию или описание.</p><Link href="/cars" className="avto-button mt-7 inline-block rounded-2xl px-6 py-4 font-black">Открыть каталог</Link></section></main>;
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOffer(id);
  if (!offer || !isCrediblePublicOffer(offer)) return <MissingOffer />;

  const sourceUrl = safeExternalUrl((offer as any)?.operational?.sourceUrl);
  const raw: any = normalizeVehicleOfferSpecs(publicOffer(offer));
  const o = presentCatalogOffer(raw);
  const updatedAt = new Date(o.updatedAt);
  const updatedDate = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleDateString("ru-RU");
  const updatedTime = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleTimeString("ru-RU");
  const similarResult = await searchOffers({ market: raw.market, make: raw.make, budgetTo: raw.totalRub ? Math.round(raw.totalRub * 1.25) : undefined, pageSize: 16, sort: "updatedAt" });
  const similar = similarResult.items.filter((item: any) => item.id !== raw.id && isCrediblePublicOffer(item)).slice(0, 12);
  const snapshot = { id: o.id, title: o.title, price: o.totalRub, totalRub: o.totalRub, previousTotalRub: o.previousTotalRub, priceDeltaRub: o.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice, sourceCurrency: o.sourceCurrency, calculationSnapshot: o.calculationSnapshot, imageUrl: o.images[0], year: o.year, mileageKm: o.mileageKm, marketLabel: o.marketLabel, href: `/cars/offer/${o.id}` };
  const marketHref = `/cars?market=${encodeURIComponent(raw.market || "")}`;
  const makeHref = `/cars/brand/${catalogBrandSlug(raw.make || "")}`;

  const specs = [
    { label: "Год", value: `${o.year} г.`, icon: "year" as const },
    { label: "Пробег", value: o.mileageKm ? `${money(o.mileageKm)} км` : "Пробег уточняется", icon: "mileage" as const },
    { label: "Двигатель", value: o.engineCc ? `${money(o.engineCc)} см³` : o.fuelLabel === "электро" ? "Электромотор" : "Двигатель уточняется", icon: "engine" as const },
    { label: "Топливо", value: sentence(o.fuelLabel) || "Топливо уточняется", icon: "fuel" as const },
    { label: "Мощность", value: o.powerHp ? `${o.powerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "Мощность уточняется", icon: "power" as const },
    { label: "Коробка", value: sentence(o.transmissionLabel) || "Коробка уточняется", icon: "transmission" as const },
    { label: "Привод", value: driveValue(o.driveLabel), icon: "drive" as const },
    { label: "Кузов", value: sentence(o.bodyLabel) || "Кузов уточняется", icon: "body" as const },
  ];

  return <main className="ac-offer-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="relative z-0 mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,.75fr)] xl:items-start 2xl:grid-cols-[minmax(0,1.6fr)_480px]">
        <div className="min-w-0">
          <header className="min-w-0">
            <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)] md:text-xs"><Link href={marketHref} className="transition hover:text-red-500">{o.marketLabel}</Link><span aria-hidden="true">/</span><Link href={makeHref} className="transition hover:text-red-500">{o.makeLabel}</Link>{o.modelLabel && o.modelLabel !== o.makeLabel ? <><span aria-hidden="true">/</span><span className="min-w-0 truncate">{o.modelLabel}</span></> : null}</nav>
            <div className="relative mt-2 min-w-0"><FavoriteToggle offerId={o.id} snapshot={snapshot} inline className="absolute left-0 top-0 h-10 w-10 bg-transparent text-red-500 hover:bg-transparent focus:outline-none focus-visible:outline-none md:-top-1 md:h-12 md:w-12 [&>svg]:h-8 [&>svg]:w-8 md:[&>svg]:h-10 md:[&>svg]:w-10" /><h1 className="min-w-0 break-words indent-[2.7rem] text-3xl font-black leading-[1.02] tracking-[-0.04em] md:indent-[3.35rem] md:text-5xl">{o.title}</h1></div>
          </header>
          <div className="mt-5 min-w-0 overflow-hidden"><VehicleGallery images={o.images} title={o.title} /></div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-[92px] xl:self-start">
          <PriceTrend offer={o} label="Ориентир стоимости" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />
          {o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
          <aside className="ac-offer-detail-stack mt-4 min-w-0">
            <div className="grid min-w-0 grid-cols-2 gap-2.5">{specs.map((spec) => <SpecTile key={spec.label} {...spec} />)}</div>
            <div className="mt-4"><OfferPriceBreakdown offer={o} /></div>
            <div className="ac-offer-status mt-4 rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4"><div className="ac-offer-block-title text-base font-bold text-[var(--ac-text)]">Статус предложения</div><p className="ac-offer-status-copy mt-2 text-xs font-medium leading-5 text-[var(--ac-muted)]">Обновлено {updatedDate}{updatedDate && updatedTime ? ", " : ""}{updatedTime ? sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline visited:text-inherit hover:text-inherit">{updatedTime}</a> : updatedTime : null}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p></div>
            <div className="ac-offer-form mt-4 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-6 [&>form]:!grid-cols-1 [&>form]:!gap-3 [&>form]:!mt-0"><OfferLeadForm offerId={o.id} /></div>
          </aside>
        </div>
      </div>

      <section className="mt-10 md:mt-14"><div className="flex items-end justify-between gap-3"><h2 className="text-[26px] font-black leading-none tracking-[-0.035em] md:text-4xl">Ещё варианты</h2><Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="shrink-0 text-sm font-black md:text-base">Все →</Link></div>{similar.length ? <div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{similar.map((item: any) => <CatalogCard key={item.id} offer={item} compact />)}</div> : <div className="mt-5 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Похожие варианты сейчас обновляются.</div>}</section>
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-spec-tile{background:#20242e!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-spec-tile{background:#e3e7ed!important}
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-price-panel.is-down{background:#0b3021!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-price-panel.is-down{background:#cfe5d8!important}
      @media (max-width:639px){.ac-offer-page .ac-public-header{z-index:1000!important;isolation:isolate!important;background:var(--ac-surface)!important}.ac-offer-page .ac-price-trend-arrow{z-index:0!important}.ac-offer-page .ac-price-trend-popover{z-index:40!important}.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:300px!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}}
    ` }} />
  </main>;
}
