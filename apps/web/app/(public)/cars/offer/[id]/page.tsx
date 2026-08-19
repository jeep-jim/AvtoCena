import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { money } from "@/lib/avtocena";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { FavoriteToggle } from "@/components/catalog/FavoriteToggle";
import { PreliminaryPrice } from "@/components/catalog/PreliminaryPrice";
import { AuctionResultPrice, PriceTrend } from "@/components/catalog/PriceTrend";
import { VehicleGallery } from "@/components/catalog/VehicleGallery";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL, OSAGO_AFFILIATE_URL } from "@/lib/affiliate-links";
import { catalogBrandSlug } from "@/lib/catalog/brands";
import { enrichOfferForDisplay } from "@/lib/catalog/display-enrichment";
import { rankedCatalogImageUrls } from "@/lib/catalog/image-quality";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { catalogPowerDisplay } from "@/lib/catalog/power-display";
import { catalogOfferVisibleRub } from "@/lib/catalog/public-priority";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { normalizeVehicleOfferSpecs } from "@/lib/catalog/spec-normalization";
import { publicOffer, searchOffers } from "@/lib/catalog/storage";

type SpecIconName = "year" | "mileage" | "engine" | "fuel" | "power" | "transmission" | "drive" | "body" | "electricMotor" | "thirtyMinute";

type SpecItem = { label: string; value: string; icon: SpecIconName; info?: string };

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
    electricMotor: <><rect x="3.5" y="6" width="15" height="12" rx="3" /><path d="M18.5 10h2v4h-2M7.5 10h6M7.5 14h4" /><path d="m13 8.6-3.3 4.2h2.2l-.6 3 3.8-4.8h-2.2z" fill="currentColor" stroke="none" /></>,
    thirtyMinute: <><rect x="3.5" y="6" width="12" height="12" rx="2.5" /><path d="M15.5 10h2v4h-2M7.5 9.5h4M7.5 14.5h4" /><circle cx="18" cy="18" r="4" fill="var(--ac-surface, #11141c)" /><path d="M18 15.8V18l1.4 1" /></>,
  };
  return <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[var(--ac-text)] opacity-50" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

function sentence(value: unknown) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toLocaleUpperCase("ru-RU") + text.slice(1) : "";
}

function knownValue(value: unknown) {
  const normalized = sentence(value);
  if (!normalized || /уточняется|не указан|unknown|неизвест/i.test(normalized)) return "";
  // Never leak unresolved Chinese/Japanese/Korean source text into public specs.
  if (/[가-힣\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(normalized)) return "";
  return normalized;
}

function driveValue(value: unknown) {
  const normalized = knownValue(value);
  if (!normalized) return "";
  return /привод/i.test(normalized) ? normalized : `${normalized} привод`;
}

function SpecTile({ label, value, icon, info, fullWidth = false }: SpecItem & { fullWidth?: boolean }) {
  return <div aria-label={`${label}: ${value}`} className="ac-offer-spec-tile relative flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3.5" style={fullWidth ? { gridColumn: "1 / -1" } : undefined}>
    <SpecIcon name={icon} />
    <span className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-[1.28] text-[var(--ac-text)] md:text-sm">{value}</span>
    {info ? <details className="group static z-30 ml-auto shrink-0">
      <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-white/12 bg-white/10 text-xs font-black text-[var(--ac-text)] shadow-[inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-md transition hover:bg-white/15 [&::-webkit-details-marker]:hidden" aria-label={`Что означает ${label}`}>?</summary>
      <div className="ac-spec-info-popover absolute right-0 top-[calc(100%+.5rem)] z-50 w-[min(290px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[var(--ac-surface)] p-4 text-left text-xs font-semibold leading-5 text-[var(--ac-muted)] shadow-2xl">{info}</div>
    </details> : null}
  </div>;
}

function safeExternalUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function similarModelKey(offer: any) {
  const make = String(offer?.make || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : `id:${String(offer?.id || "")}`;
}

function diverseSimilarOffers(rows: any[], current: any, limit = 4, excludedIds = new Set<string>()) {
  const currentKey = similarModelKey(current);
  const seen = new Set<string>(currentKey ? [currentKey] : []);
  const differentModels: any[] = [];
  const repeats: any[] = [];
  for (const row of rows) {
    if (excludedIds.has(String(row?.id || ""))) continue;
    const key = similarModelKey(row);
    if (key && !seen.has(key)) {
      seen.add(key);
      differentModels.push(row);
    } else {
      repeats.push(row);
    }
  }
  return [...differentModels, ...repeats].slice(0, limit);
}

async function SimilarOffers({ current }: { current: any }) {
  let sameModel: any[] = [];
  let otherMarketModels: any[] = [];
  let marketTotal = 0;
  try {
    const [modelResult, marketResult] = await Promise.all([
      searchOffers({ market: current.market, make: current.make, model: current.model, pageSize: 48, sort: "updatedAt" }),
      searchOffers({ market: current.market, pageSize: 48, sort: "updatedAt" }),
    ]);
    const modelRows = modelResult.items.filter((item: any) => item.id !== current.id && isCrediblePublicOffer(item));
    const marketRows = marketResult.items.filter((item: any) => item.id !== current.id && isCrediblePublicOffer(item));
    marketTotal = Math.max(0, Number(marketResult.total || 0));
    sameModel = modelRows.slice(0, 4);
    if (sameModel.length < 4) {
      const selectedIds = new Set([String(current.id), ...sameModel.map((item: any) => String(item.id))]);
      const fillers = diverseSimilarOffers(marketRows, current, 4 - sameModel.length, selectedIds);
      sameModel = [...sameModel, ...fillers];
    }
    const selectedIds = new Set([String(current.id), ...sameModel.map((item: any) => String(item.id))]);
    otherMarketModels = diverseSimilarOffers(marketRows, current, 4, selectedIds);
  } catch (error) {
    console.error("offer_similar_search_failed", error);
  }

  const presented = presentCatalogOffer(current);
  const modelTitle = [presented.makeLabel, presented.modelLabel].filter(Boolean).join(" ");
  const modelParams = new URLSearchParams({ market: String(current.market || ""), make: String(current.make || ""), model: String(current.model || "") });
  const marketParams = new URLSearchParams({ market: String(current.market || "") });
  const marketLabel = String(presented.marketLabel || current.market || "рынка");
  const rail = (rows: any[]) => rows.length ? <div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{rows.map((item: any) => <CatalogCard key={item.id} offer={item} compact />)}</div> : <div className="mt-5 rounded-[1.7rem] bg-white/[0.04] p-6 text-white/55">Подходящие предложения появятся здесь после обновления каталога.</div>;

  return <div className="mt-10 space-y-10 md:mt-14 md:space-y-14">
    <section><div className="flex items-end justify-between gap-3"><h2 className="min-w-0 text-[26px] font-black leading-none tracking-[-0.035em] md:text-4xl">Ещё {modelTitle}</h2><Link href={`/cars?${modelParams}`} className="shrink-0 text-sm font-black md:text-base">Все →</Link></div>{rail(sameModel)}</section>
    <section><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={String(current.market || "")} className="h-5 w-7 md:h-6 md:w-9" /><span>{marketLabel}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {marketTotal}</span></h2><Link href={`/cars?${marketParams}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{rail(otherMarketModels)}</section>
  </div>;
}

function SimilarOffersFallback() {
  return <section className="mt-10 md:mt-14" aria-label="Загружаем похожие предложения"><div className="h-9 w-52 animate-pulse rounded-xl bg-white/[0.08]" /><div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="min-h-64 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />)}</div></section>;
}

type BreakdownLine = { id?: string; title: string; amountRub: number };
function customerBreakdownTitle(id: string, title: string) {
  if (id === "topavto-commission" || /комиссия\s+topavto/i.test(title)) return "Комиссия Автодилера";
  return title;
}

function priceBreakdown(offer: any): BreakdownLine[] {
  const actual = Array.isArray(offer?.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
      .map((line: any) => {
        const id = String(line?.id || line?.title || "");
        const title = customerBreakdownTitle(id, String(line?.title || "Расход"));
        return { id, title, amountRub: Number(line?.amountRub || 0) };
      })
      .filter((line: BreakdownLine) => line.amountRub !== 0)
    : [];
  if (actual.length) return actual;
  const total = Number(offer?.totalRub || 0);
  return total ? [{ id: "total", title: "Стоимость автомобиля", amountRub: total }] : [];
}

function OfferPriceBreakdown({ offer }: { offer: any }) {
  const lines = priceBreakdown(offer);
  if (!lines.length) return null;
  const vehicleLine = lines.find((line) => line.id === "car")
    || lines.find((line) => /цена автомобиля|стоимость автомобиля/i.test(line.title))
    || lines[0];
  const detailLines = lines.filter((line) => line !== vehicleLine);
  return <details className="ac-offer-breakdown group min-w-0 rounded-[1.35rem] bg-[var(--ac-surface-2)]">
    <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="ac-offer-block-title text-lg font-bold tracking-[-0.02em] text-[var(--ac-text)] md:text-xl">Структура цены</h2>
        <svg className="mr-1 shrink-0 transition-transform group-open:rotate-180" width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M5 7L9 11L13 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-[12px] font-medium md:text-[13px]">
        <span className="ac-offer-breakdown-label flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]"><span className="shrink-0">Цена автомобиля</span><span className="ac-offer-dotted-line mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" /></span>
        <span className="ac-offer-breakdown-value whitespace-nowrap font-bold text-[var(--ac-text)]">{money(vehicleLine.amountRub)} ₽</span>
      </div>
    </summary>
    {detailLines.length ? <div className="ac-offer-breakdown-lines border-t border-dotted border-[var(--ac-border)] px-4 pb-3 pt-2">{detailLines.map((line, index) => <div key={`${line.id || line.title}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1.5 text-[12px] font-medium md:text-[13px]"><span className="ac-offer-breakdown-label flex min-w-0 items-baseline gap-2 text-[var(--ac-muted)]"><span className="min-w-0 truncate">{line.title}</span><span className="ac-offer-dotted-line mb-1 min-w-3 flex-1 border-b border-dotted border-[var(--ac-border)]" /></span><span className="ac-offer-breakdown-value whitespace-nowrap font-bold text-[var(--ac-text)]">{money(line.amountRub)} ₽</span></div>)}</div> : null}
    <div className="grid gap-2 px-4 pb-4 pt-1 xl:hidden" aria-label="Финансовые сервисы">
      <a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="relative flex h-12 w-full items-center justify-center rounded-xl bg-[#0d1117] px-10 text-center text-[12px] font-black leading-tight text-white transition-[filter,transform] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.99]" style={{ backgroundColor: "#0d1117", color: "#ffffff", WebkitTextFillColor: "#ffffff" }}>
        <span className="absolute left-4 text-white"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.25" y="5.25" width="17.5" height="13.5" rx="2.75" stroke="currentColor" strokeWidth="1.8" /><path d="M3.8 9.4H20.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M7 14H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span>
        <span className="text-center">Кредитный калькулятор</span>
      </a>
      <a href={OSAGO_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="relative flex h-12 w-full items-center justify-center rounded-xl bg-[#FFD400] px-10 text-center text-[12px] font-black leading-tight text-[#111111] transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD400] active:scale-[.99]" style={{ backgroundColor: "#FFD400", color: "#111111", WebkitTextFillColor: "#111111" }}>
        <span className="absolute left-4 text-[#111111]"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.2 19 6v5.2c0 4.4-2.7 7.6-7 9.6-4.3-2-7-5.2-7-9.6V6l7-2.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="m8.8 12.1 2.1 2.1 4.5-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <span className="text-center">Рассчитать полис ОСАГО</span>
      </a>
    </div>
  </details>;
}

function MissingOffer() {
  return <main className="ac-page-copy min-h-screen bg-[#07080d] text-white"><PublicHeader backHref="/cars" backLabel="В каталог" /><section className="mx-auto max-w-4xl px-4 py-20 text-center"><h1 className="text-4xl font-black">Предложение не найдено</h1><p className="mt-3 font-bold text-[var(--ac-muted)]">Карточка временно недоступна.</p><Link href="/cars" className="avto-button mt-7 inline-block rounded-2xl px-6 py-4 font-black">Открыть каталог</Link></section></main>;
}

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOfferForPage(id);
  if (!offer || !isCrediblePublicOffer(offer)) return <MissingOffer />;

  const enrichedOffer = await enrichOfferForDisplay(offer);
  const sourceUrl = safeExternalUrl((enrichedOffer as any)?.operational?.sourceUrl);
  const raw: any = normalizeVehicleOfferSpecs(publicOffer(enrichedOffer));
  const presented = presentCatalogOffer(raw);
  const exactTotalRub = Number(presented.totalRub || 0);
  const visibleRub = exactTotalRub || catalogOfferVisibleRub(raw);
  const o = {
    ...presented,
    totalRub: visibleRub || null,
    previousTotalRub: exactTotalRub ? presented.previousTotalRub : null,
    priceDeltaRub: exactTotalRub ? presented.priceDeltaRub : null,
    images: rankedCatalogImageUrls(raw),
  };
  const updatedAt = new Date(o.updatedAt);
  const updatedDate = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleDateString("ru-RU");
  const updatedTime = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleTimeString("ru-RU");
  const auctionAt = new Date(o.auctionDate || "");
  const auctionDateLabel = Number.isNaN(auctionAt.getTime()) ? "" : auctionAt.toLocaleDateString("ru-RU");
  const snapshot = { id: o.id, title: o.title, price: o.totalRub, totalRub: o.totalRub, previousTotalRub: o.previousTotalRub, priceDeltaRub: o.priceDeltaRub, priceChangedAt: o.priceChangedAt, sourcePrice: o.sourcePrice, sourceCurrency: o.sourceCurrency, calculationSnapshot: o.calculationSnapshot, imageUrl: o.images[0], year: o.year, mileageKm: o.mileageKm, market: raw.market, marketLabel: o.marketLabel, auctionDate: o.auctionDate, href: `/cars/offer/${o.id}` };
  const marketHref = `/cars?market=${encodeURIComponent(raw.market || "")}`;
  const makeHref = `/cars/brand/${catalogBrandSlug(raw.make || "")}`;
  const powerDisplay = catalogPowerDisplay(raw);
  const preliminaryPricing = String(raw?.calculationStatus || "") === "preliminary_power_pending"
    || raw?.calculationSnapshot?.pricingConfidence === "preliminary";
  const powertrainKind = String(raw.powertrainKind || "").toLowerCase();
  const fuelKind = String(raw.fuel || o.fuelLabel || "").toLowerCase();
  const isElectric = powertrainKind === "electric" || ["electric", "электро", "электромобиль", "bev"].includes(fuelKind);
  const isHybrid = ["series_hybrid", "other_hybrid"].includes(powertrainKind) || /hybrid|гибрид|phev|hev/.test(fuelKind);
  const electrified = isElectric || isHybrid;
  const japanAuction = String(raw.market || "").toLowerCase() === "japan";
  const powerValue = o.powerHp ? `${o.powerHp} л.с.` : o.powerKw ? `${o.powerKw} кВт` : "";
  const mileageKm = Number(o.mileageKm || 0);
  const mileageTile = mileageKm > 0 ? { label: "Пробег", value: `${money(mileageKm)} км`, icon: "mileage" as const } : null;
  const transmissionValue = knownValue(o.transmissionLabel);
  const fuelValue = knownValue(o.fuelLabel);
  const driveLabel = driveValue(o.driveLabel);
  const bodyValue = knownValue(o.bodyLabel);
  const thirtyMinuteInfo = powerDisplay?.estimated
    ? "Для предварительной цены использована доступная расчётная мощность. Точную 30-минутную мощность менеджер подтвердит по документам автомобиля."
    : "Максимальная мощность электромотора, которую автомобиль может поддерживать в течение 30 минут. По этому значению рассчитывается утилизационный сбор.";
  const peakPowerTile = powerValue
    ? { label: "Мощность", value: powerValue, icon: "power" as const }
    : preliminaryPricing && electrified
      ? { label: "Мощность", value: "Мощность уточняется", icon: "power" as const }
      : null;
  const powerTile = powerDisplay && electrified
    ? { label: "30-минутная мощность", value: powerDisplay.thirtyMinuteLabel, icon: "thirtyMinute" as const, info: thirtyMinuteInfo }
    : null;

  const specs = (isElectric ? [
    { label: "Год", value: `${o.year} г.`, icon: "year" as const },
    mileageTile,
    { label: "Силовая установка", value: "Электромотор", icon: "electricMotor" as const },
    transmissionValue ? { label: "Коробка", value: transmissionValue, icon: "transmission" as const } : null,
    peakPowerTile,
    powerTile,
    driveLabel ? { label: "Привод", value: driveLabel, icon: "drive" as const } : null,
    bodyValue ? { label: "Кузов", value: bodyValue, icon: "body" as const } : null,
  ] : [
    { label: "Год", value: `${o.year} г.`, icon: "year" as const },
    mileageTile,
    o.engineCc ? { label: "Двигатель", value: `${money(o.engineCc)} см³`, icon: "engine" as const } : null,
    fuelValue ? { label: "Топливо", value: fuelValue, icon: "fuel" as const } : null,
    peakPowerTile,
    powerTile,
    transmissionValue ? { label: "Коробка", value: transmissionValue, icon: "transmission" as const } : null,
    driveLabel ? { label: "Привод", value: driveLabel, icon: "drive" as const } : null,
    bodyValue ? { label: "Кузов", value: bodyValue, icon: "body" as const } : null,
  ]).filter(Boolean) as SpecItem[];

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
          {japanAuction
            ? <AuctionResultPrice offer={o} label="Завершённый аукцион" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel />
            : preliminaryPricing
            ? <PreliminaryPrice offer={o} label="Предварительно от" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel highlightElectrified={electrified} />
            : <PriceTrend offer={o} label="Ориентир стоимости" priceClassName="text-3xl md:text-4xl" className="ac-offer-price-panel" panel highlightElectrified={electrified} />}
          {!japanAuction && o.priceMode === "auction_start" ? <p className="mt-2 rounded-2xl bg-amber-400/10 p-3 text-sm font-bold text-amber-200">Расчёт сделан от стартовой цены. Финальная стоимость аукциона может измениться.</p> : null}
          <aside className="ac-offer-detail-stack mt-4 min-w-0">
            <div className="ac-offer-spec-grid grid min-w-0 grid-cols-2 gap-2.5" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoFlow: "row" }}>{specs.map((spec, index) => <SpecTile key={spec.label} {...spec} fullWidth={specs.length % 2 === 1 && index === specs.length - 1} />)}</div>
            <div className="mt-4"><OfferPriceBreakdown offer={o} /></div>
            <div className="ac-offer-status mt-4 rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4">
              {japanAuction ? <p className="ac-offer-status-copy text-xs font-bold leading-5 text-[var(--ac-text)] xl:text-[11px] 2xl:text-xs">
                <span className="block whitespace-nowrap">Завершённый лот{auctionDateLabel ? ` · торги ${auctionDateLabel}` : ""}</span>
                <span className="mt-1 block">Цена сохранена как ориентир по результату аукциона.</span>
              </p> : <p className="ac-offer-status-copy text-xs font-bold leading-5 text-[var(--ac-text)] xl:text-[11px] 2xl:text-xs">
                <span className="block whitespace-nowrap">Обновлено {updatedDate}{updatedDate && updatedTime ? ", " : ""}{updatedTime ? sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline visited:text-inherit hover:text-inherit">{updatedTime}</a> : updatedTime : null}</span>
                <span className="mt-1 block xl:whitespace-nowrap">Возможность покупки и финальную стоимость подтвердит менеджер.</span>
              </p>}
            </div>
            <div data-offer-desktop-actions-slot className="hidden xl:block" />
          </aside>
        </div>
      </div>

      <Suspense fallback={<SimilarOffersFallback />}><SimilarOffers current={raw} /></Suspense>
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-spec-tile{background:#11141c!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-spec-tile{background:#e3e7ed!important}
      html body .ac-offer-page .ac-offer-detail-stack>.ac-offer-spec-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-auto-flow:row!important}
      html body .ac-offer-page .ac-offer-detail-stack>.ac-offer-spec-grid>.ac-offer-spec-tile:last-child:nth-child(odd){grid-column:1/-1!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-breakdown,
      html[data-theme="light"] .ac-offer-page .ac-offer-status,
      html[data-theme="light"] .ac-offer-page .ac-offer-form{background:#f8f9fb!important;border:1px solid rgba(30,36,48,.10)!important;box-shadow:0 14px 34px rgba(38,43,57,.10)!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-form .soft-input{background:#e3e7ed!important;border:1px solid #c7ced9!important;color:#171b24!important;box-shadow:none!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-form .soft-input::placeholder{color:#737d8e!important;opacity:1!important}
      html[data-theme="light"] .ac-offer-page .ac-preliminary-notice{background:#fff2cc!important;border-color:#e9c56b!important;color:#704500!important;box-shadow:0 8px 24px rgba(111,75,0,.08)!important}
      html[data-theme="light"] .ac-offer-page .ac-spec-info-popover{background:#fff!important;border-color:rgba(30,36,48,.14)!important;color:#394150!important}
      html:not([data-theme="light"]) .ac-offer-page .ac-offer-price-panel.is-down{background:#0b3021!important}
      html[data-theme="light"] .ac-offer-page .ac-offer-price-panel.is-down{background:#cfe5d8!important}
      @media (max-width:639px){.ac-offer-page .ac-public-header{z-index:1000!important;isolation:isolate!important;background:var(--ac-surface)!important}.ac-offer-page .ac-price-trend-arrow{z-index:0!important}.ac-offer-page .ac-price-trend-popover{z-index:40!important}.ac-offer-page button[aria-label="Открыть фотографии автомобиля"]{height:auto!important;aspect-ratio:4/3!important}.ac-offer-page .ac-vehicle-thumbnails{margin-top:10px!important}.ac-offer-page .ac-offer-spec-tile:nth-child(odd) .ac-spec-info-popover{left:0!important;right:auto!important}.ac-offer-page .ac-offer-spec-tile:nth-child(even) .ac-spec-info-popover{left:auto!important;right:0!important}}
    ` }} />
  </main>;
}
