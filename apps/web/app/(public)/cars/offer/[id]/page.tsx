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

function SpecTile({ label, value }: { label: string; value: string }) {
  return <div className="ac-offer-spec-tile min-w-0 rounded-2xl bg-[var(--ac-surface-2)] px-3.5 py-3"><div className="ac-offer-spec-label text-[9px] font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]">{label}</div><div className="ac-offer-spec-value mt-1 min-w-0 break-words text-[13px] font-black leading-tight text-[var(--ac-text)] md:text-sm">{value}</div></div>;
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
    ? offer.calculationSnapshot.breakdown.map((line: any) => ({ id: String(line?.id || line?.title || ""), title: String(line?.title || "Расход"), amountRub: Number(line?.amountRub || 0) })).filter((line: BreakdownLine) => line.amountRub !== 0)
    : [];
  if (actual.length) return actual;
  const total = Number(offer?.totalRub || 0);
  return total ? [{ id: "total", title: "Ориентир под ключ", amountRub: total }] : [];
}

function OfferPriceBreakdown({ offer }: { offer: any }) {
  const lines = priceBreakdown(offer);
  if (!lines.length) return null;
  return <section className="ac-offer-breakdown min-w-0 self-start rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4"><h2 className="ac-offer-block-title text-lg font-black tracking-[-0.025em] text-[var(--ac-text)] md:text-xl">Структура АвтоЦены</h2><div className="ac-offer-breakdown-lines mt-2 border-t border-dotted border-[var(--ac-border)] pt-2">{lines.map((line, index) => <div key={`${line.id || line.title}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-[12px] font-medium md:text-[13px]"><span className="ac-offer-breakdown-label flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]"><span className="min-w-0 truncate">{line.title}</span><span className="ac-offer-dotted-line mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" /></span><span className="ac-offer-breakdown-value whitespace-nowrap font-black text-[var(--ac-text)]">{money(line.amountRub)} ₽</span></div>)}</div></section>;
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

  return <main className="ac-offer-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <div className="grid min-w-0 gap-x-7 gap-y-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(520px,.82fr)] xl:items-start">
        <header className="order-1 min-w-0 xl:col-start-1 xl:row-start-1 xl:self-end">
          <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)] md:text-xs"><Link href={marketHref} className="transition hover:text-red-500">{o.marketLabel}</Link><span aria-hidden="true">/</span><Link href={makeHref} className="transition hover:text-red-500">{o.makeLabel}</Link>{o.modelLabel && o.modelLabel !== o.makeLabel ? <><span aria-hidden="true">/</span><span className="min-w-0 truncate">{o.modelLabel}</span></> : null}</nav>
          <div className="relative mt-2 min-w-0"><FavoriteToggle offerId={o.id} snapshot={snapshot} inline className="absolute left-0 top-0 h-10 w-10 bg-transparent text-red-500 hover:bg-transparent focus:outline-none focus-visible:outline-none md:-top-1 md:h-12 md:w-12 [&>svg]:h-8 [&>svg]:w-8 md:[&>svg]:h-10 md:[&>svg]:w-10" /><h1 className="min-w-0 break-words indent-[2.7rem] text-3xl font-black leading-[1.02] tracking-[-0.04em] md:indent-[3.35rem] md:text-5xl">{o.title}</h1></div>
        </header>
        <div className="order-3 min-w-0 xl:col-start-2 xl:row-start-1 xl:self-end"><PriceTrend offer={o} label="Ориентир стоимости" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />{o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}</div>
        <div className="order-2 min-w-0 overflow-hidden xl:col-start-1 xl:row-start-2"><VehicleGallery images={o.images} title={o.title} /></div>
        <aside className="ac-offer-detail-stack order-4 min-w-0 xl:col-start-2 xl:row-start-2">
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(230px,.95fr)] xl:grid-cols-[minmax(0,1fr)_minmax(215px,.95fr)]"><div className="grid min-w-0 grid-cols-2 gap-2.5"><SpecTile label="Год" value={String(o.year)} /><SpecTile label="Пробег" value={o.mileageKm ? `${money(o.mileageKm)} км` : "не указан продавцом"} /><SpecTile label="Двигатель" value={o.engineCc ? `${o.engineCc} см³` : o.fuelLabel === "электро" ? "электромотор" : "не указан продавцом"} /><SpecTile label="Топливо" value={o.fuelLabel} /><SpecTile label="Мощность" value={o.powerHp ? `${o.powerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "не указана продавцом"} /><SpecTile label="Коробка" value={o.transmissionLabel} /><SpecTile label="Привод" value={o.driveLabel} /><SpecTile label="Кузов" value={o.bodyLabel} /></div><OfferPriceBreakdown offer={o} /></div>
          <div className="ac-offer-status mt-4 rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4"><div className="ac-offer-block-title text-base font-black text-[var(--ac-text)]">Статус предложения</div><p className="ac-offer-status-copy mt-2 text-xs font-medium leading-5 text-[var(--ac-muted)]">Обновлено {updatedDate}{updatedDate && updatedTime ? ", " : ""}{updatedTime ? sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline visited:text-inherit hover:text-inherit">{updatedTime}</a> : updatedTime : null}. Наличие и финальную стоимость под ключ подтвердит менеджер.</p></div>
          <div className="ac-offer-form mt-5 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-6 [&>form]:mt-0"><OfferLeadForm offerId={o.id} /></div>
        </aside>
      </div>
      <section className="mt-10 md:mt-14"><div className="flex items-end justify-between gap-3"><h2 className="text-[26px] font-black leading-none tracking-[-0.035em] md:text-4xl">Ещё варианты</h2><Link href={`/cars?market=${encodeURIComponent(raw.market)}&make=${encodeURIComponent(raw.make)}`} className="shrink-0 text-sm font-black md:text-base">Все →</Link></div>{similar.length ? <div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{similar.map((item: any) => <CatalogCard key={item.id} offer={item} compact />)}</div> : <div className="mt-5 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Похожие варианты сейчас обновляются.</div>}</section>
    </section>
    <style dangerouslySetInnerHTML={{ __html: `@media (max-width:639px){.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:300px!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}}` }} />
  </main>;
}
