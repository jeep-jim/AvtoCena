import Link from "next/link";
import { readCatalogFacets, readMarketOffers, publicOffer, searchOffers } from "@/lib/catalog/storage";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { CatalogFilters } from "@/components/catalog/CatalogFilters";
import { CurrencyRatesStrip } from "@/components/catalog/CurrencyRatesStrip";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function first(value?: string | string[]) { return Array.isArray(value) ? value[0] : value || ""; }
function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }

const marketOrder = PUBLIC_CATALOG_MARKETS.map((id) => ({ id, label: CATALOG_MARKET_LABELS[id] }));
const OVERVIEW_CARDS = 6;
const MARKET_PAGE_SIZE = 48;
const PRIORITY_MAX_RUB = 6_000_000;
const PRIORITY_MAX_POWER_HP = 160;
const PRIORITY_MIN_YEAR = new Date().getFullYear() - 6;
const SUPPORTED_SORTS = new Set(["updatedAt", "totalRub", "year", "mileage"]);

function requestedSort(value?: string | string[]) {
  const sort = first(value);
  return SUPPORTED_SORTS.has(sort) ? sort : "updatedAt";
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) { const resolved = first(value); if (resolved && key !== "page") query.set(key, resolved); }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return suffix ? `/cars?${suffix}` : "/cars";
}

function paginationItems(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
}

function offerFreshness(offer: any) {
  return Date.parse(String(offer?.auctionDate || offer?.operational?.sourcePublishedAt || offer?.firstSeenAt || offer?.updatedAt || "")) || 0;
}

function isJapanAuctionResult(offer: any) {
  return offer?.market === "japan" && (offer?.catalogKind === "auction_result" || (offer?.offerType === "auction" && offer?.auctionResult === "sold"));
}

function offerRubValue(offer: any) {
  const totalRub = Number(offer?.totalRub || 0);
  if (totalRub > 0) return totalRub;
  const sourcePrice = Number(offer?.sourcePrice || 0);
  if (!sourcePrice) return 0;
  const currency = String(offer?.sourceCurrency || "").toUpperCase();
  if (currency === "RUB") return sourcePrice;
  const rate = offer?.calculationSnapshot?.currencyRate || {};
  const explicit = Number(rate.sourcePriceRub || offer?.calculationSnapshot?.sourcePriceRub || 0);
  if (explicit > 0) return explicit;
  const effectiveRate = Number(rate.effectiveRate || 0);
  return effectiveRate > 0 ? Math.round(sourcePrice * effectiveRate) : 0;
}

function businessPriority(offer: any) {
  const rub = offerRubValue(offer);
  const power = Number(offer?.powerHp || 0);
  const year = Number(offer?.year || 0);
  const affordable = rub > 0 && rub <= PRIORITY_MAX_RUB;
  const lowPower = power > 0 && power <= PRIORITY_MAX_POWER_HP;
  const recent = year >= PRIORITY_MIN_YEAR;
  let score = isJapanAuctionResult(offer) ? 5_000 : 0;
  if (affordable) score += 1_600;
  if (lowPower) score += 800;
  if (recent) score += 800;
  if (affordable && lowPower && recent) score += 3_200;
  if (rub > 0) score += 200;
  return score;
}

function businessOrder(left: any, right: any) {
  return businessPriority(right) - businessPriority(left)
    || offerFreshness(right) - offerFreshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function sortCatalogRows(rows: any[], sort: string) {
  const sorted = [...rows];
  if (sort === "totalRub") return sorted.sort((left, right) => {
    const a = offerRubValue(left) || Number.POSITIVE_INFINITY;
    const b = offerRubValue(right) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  if (sort === "year") return sorted.sort((left, right) => Number(right?.year || 0) - Number(left?.year || 0) || businessOrder(left, right));
  if (sort === "mileage") return sorted.sort((left, right) => {
    const a = Number(left?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    const b = Number(right?.mileageKm || 0) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  return sorted.sort(businessOrder);
}

function catalogModelGroupKey(offer: any) {
  const make = String(offer?.make || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : `id:${String(offer?.id || "")}`;
}

function balanceBusinessRows(rows: any[]) {
  const sorted = [...rows].sort(businessOrder);
  const groups = new Map<string, any[]>();
  for (const row of sorted) {
    const key = catalogModelGroupKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const balanced: any[] = [];
  for (let depth = 0; balanced.length < sorted.length; depth++) {
    let added = false;
    for (const group of groups.values()) {
      const row = group[depth];
      if (!row) continue;
      balanced.push(row);
      added = true;
    }
    if (!added) break;
  }
  return balanced;
}

function matchesFilters(offer: any, common: any) {
  const make = String(offer.make || "").toLocaleLowerCase("ru-RU");
  const model = String(offer.model || "").toLocaleLowerCase("ru-RU");
  const totalRub = offerRubValue(offer);
  const mileage = Number(offer.mileageKm || 0);
  const engine = Number(offer.engineCc || 0);
  const power = Number(offer.powerHp || 0);
  if (common.make && make !== String(common.make).toLocaleLowerCase("ru-RU")) return false;
  if (common.model && !model.includes(String(common.model).toLocaleLowerCase("ru-RU"))) return false;
  if (common.hasPrice === "yes" && !Number(offer.sourcePrice || totalRub || 0)) return false;
  if (common.hasPrice === "no" && Number(offer.sourcePrice || totalRub || 0)) return false;
  if (common.budgetFrom && (!totalRub || totalRub < common.budgetFrom)) return false;
  if (common.budgetTo && (!totalRub || totalRub > common.budgetTo)) return false;
  if (common.yearFrom && Number(offer.year || 0) < common.yearFrom) return false;
  if (common.yearTo && Number(offer.year || 0) > common.yearTo) return false;
  if (common.mileageFrom && mileage < common.mileageFrom) return false;
  if (common.mileageTo && (!mileage || mileage > common.mileageTo)) return false;
  if (common.engineFrom && engine < common.engineFrom) return false;
  if (common.engineTo && (!engine || engine > common.engineTo)) return false;
  if (common.powerFrom && power < common.powerFrom) return false;
  if (common.powerTo && (!power || power > common.powerTo)) return false;
  if (common.fuel) {
    const kind = String(offer.powertrainKind || "");
    const canonicalFuel = kind === "electric" ? "electric" : ["series_hybrid", "other_hybrid"].includes(kind) ? "hybrid" : String(offer.fuel || "");
    if (canonicalFuel !== common.fuel) return false;
  }
  if (common.transmission && String(offer.transmission || "") !== common.transmission) return false;
  if (common.drive && String(offer.drive || "") !== common.drive) return false;
  if (common.bodyType && String(offer.bodyType || "") !== common.bodyType) return false;
  return true;
}

export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const selectedMarket = first(params.market);
  const selectedSort = requestedSort(params.sort);
  const customSort = selectedSort !== "updatedAt";
  const requestedPage = Math.max(1, Number(first(params.page)) || 1);
  const common = {
    make: first(params.make) || first(params.brand), model: first(params.model), budgetFrom: numeric(params.budgetFrom), budgetTo: numeric(params.budget) || numeric(params.budgetTo), hasPrice: first(params.hasPrice),
    yearFrom: numeric(params.yearFrom), yearTo: numeric(params.yearTo), mileageFrom: numeric(params.mileageFrom), mileageTo: numeric(params.mileageTo), engineFrom: numeric(params.engineFrom), engineTo: numeric(params.engineTo), powerFrom: numeric(params.powerFrom), powerTo: numeric(params.powerTo),
    fuel: first(params.fuel), transmission: first(params.transmission), drive: first(params.drive), bodyType: first(params.bodyType), sort: selectedSort,
  };
  const hasFilters = Boolean(common.make || common.model || common.budgetFrom || common.budgetTo || common.hasPrice
    || common.yearFrom || common.yearTo || common.mileageFrom || common.mileageTo || common.engineFrom || common.engineTo
    || common.powerFrom || common.powerTo || common.fuel || common.transmission || common.drive || common.bodyType);
  const markets = selectedMarket ? marketOrder.filter((item) => item.id === selectedMarket) : marketOrder;
  const [facets, groupedMarkets] = await Promise.all([
    readCatalogFacets({ ...common, market: selectedMarket || undefined }),
    Promise.all(markets.map(async (market) => {
      const pageSize = selectedMarket ? MARKET_PAGE_SIZE : OVERVIEW_CARDS;
      const page = selectedMarket ? requestedPage : 1;

      if (market.id === "japan") {
        const auctionRows = (await readMarketOffers("japan"))
          .filter((offer) => offer.status === "active" && isJapanAuctionResult(offer) && isCrediblePublicOffer(offer))
          .filter((offer) => !hasFilters || matchesFilters(offer, common));
        const orderedRows = customSort ? sortCatalogRows(auctionRows, selectedSort) : auctionRows.sort(businessOrder);
        const start = (page - 1) * pageSize;
        const visible = await applyActiveBusinessPricingBatch(orderedRows.slice(start, start + pageSize));
        const orderedVisible = customSort ? sortCatalogRows(visible, selectedSort) : visible.sort(businessOrder);
        return { ...market, items: orderedVisible.map(publicOffer), total: orderedRows.length, page, pageSize, auctionStatistics: true };
      }

      if (!hasFilters && !customSort) {
        const indexedPageSize = selectedMarket ? pageSize : Math.min(48, Math.max(pageSize * 4, 24));
        const indexed = await searchOffers({ market: market.id, page, pageSize: indexedPageSize, sort: "updatedAt" });
        const candidates = balanceBusinessRows((indexed.items as any[]).filter(isCrediblePublicOffer));
        const visible = await applyActiveBusinessPricingBatch(candidates.slice(0, pageSize));
        return { ...market, items: balanceBusinessRows(visible).map(publicOffer), total: indexed.total, page: indexed.page, pageSize };
      }

      const result = await searchOffers({ ...common, market: market.id, page, pageSize });
      const pageRows = common.model || customSort ? (result.items as any[]) : balanceBusinessRows(result.items as any[]);
      const repriced = await applyActiveBusinessPricingBatch(pageRows);
      const items = customSort ? sortCatalogRows(repriced, selectedSort) : common.model ? repriced.sort(businessOrder) : balanceBusinessRows(repriced);
      return { ...market, items, total: result.total, page: result.page, pageSize: result.pageSize };
    })),
  ]);
  const visibleMarkets = selectedMarket ? groupedMarkets : groupedMarkets.filter((market) => market.total > 0);
  const total = groupedMarkets.reduce((sum, market) => sum + market.total, 0);
  const selectedResult = selectedMarket ? groupedMarkets[0] : undefined;
  const totalPages = selectedResult ? Math.max(1, Math.ceil(selectedResult.total / selectedResult.pageSize)) : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const pages = paginationItems(currentPage, totalPages);
  const initialKeys = ["advanced", "budget", "budgetTo", "budgetFrom", "market", "make", "model", "yearFrom", "yearTo", "hasPrice", "bodyType", "mileageFrom", "mileageTo", "engineFrom", "engineTo", "powerFrom", "powerTo", "fuel", "transmission", "drive", "sort"];
  const initial = Object.fromEntries(initialKeys.map((key) => [key, first(params[key])])) as Record<string, string>;
  const brandNames = facets.makes || [];
  const japanStatisticsSelected = selectedMarket === "japan";

  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#0f172a] text-white">
    <PublicHeader backHref="/" backLabel="На главную" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">
      <div className="max-w-4xl">
        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{japanStatisticsSelected ? "Аукционная статистика Японии" : "Каталог автомобилей"}</h1>
        <p className="mt-3 hidden text-sm font-bold leading-6 text-white/52 md:text-base lg:block">Найдено: {total}</p>
        <div className="lg:hidden"><BrandLogoRail brands={brandNames} resultCount={total} /></div>
      </div>
      <CatalogFilters initial={initial} facets={facets} />
      <div className="hidden lg:block"><BrandLogoRail brands={brandNames} resultCount={total} /></div>
      <CurrencyRatesStrip variant="mobile" className="mt-5 lg:hidden" />
      <div className="mt-8 grid gap-10 md:mt-9 md:gap-12">{visibleMarkets.map((market) => <section key={market.id} className="min-w-0"><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={market.id} className="h-5 w-7 md:h-6 md:w-9" /><span>{market.label}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {market.total}</span></h2>{!selectedMarket ? <Link href={`/cars?market=${market.id}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link> : null}</div>{market.items.length ? selectedMarket ? <div className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{market.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div> : <div className="ac-catalog-market-rail -mr-4 grid grid-flow-col auto-cols-[47%] gap-2.5 overflow-x-auto pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mr-0 md:grid-flow-row md:grid-cols-4 md:auto-cols-auto md:overflow-visible md:pr-0">{market.items.map((offer: any, index: number) => <div key={offer.id} className={index >= 4 ? "md:hidden" : ""}><CatalogCard offer={offer} compact dense /></div>)}</div> : <div className="rounded-[1.5rem] bg-white/[0.04] px-6 py-7 text-sm font-bold text-white/55">{market.id === "japan" ? "Статистика отыгранных лотов ещё загружается." : "Подходящих предложений сейчас нет."}</div>}</section>)}</div>
      {selectedMarket && totalPages > 1 ? <nav className="ac-catalog-pagination ac-hide-scrollbar mt-10 flex flex-nowrap items-center justify-center gap-1 overflow-x-auto whitespace-nowrap px-1" aria-label="Страницы каталога">
        {currentPage > 1 ? <Link href={pageHref(params, currentPage - 1)} className="flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] px-2 text-base font-black" aria-label="Предыдущая страница">←</Link> : null}
        {pages.map((page, index) => <span key={page} className="contents">{index > 0 && page - pages[index - 1] > 1 ? <span className="shrink-0 px-1 text-white/35">…</span> : null}<Link href={pageHref(params, page)} aria-current={page === currentPage ? "page" : undefined} className={`flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl px-2 text-sm font-black ${page === currentPage ? "ac-pagination-current bg-red-500 text-white" : "bg-white/[0.055]"}`} style={page === currentPage ? { color: "#ffffff", WebkitTextFillColor: "#ffffff" } : undefined}>{page}</Link></span>)}
        {currentPage < totalPages ? <Link href={pageHref(params, currentPage + 1)} className="flex h-11 min-w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] px-2 text-base font-black" aria-label="Следующая страница">→</Link> : null}
      </nav> : null}
    </section>
    <style dangerouslySetInnerHTML={{ __html: `
      @media(min-width:1024px){
        .ac-catalog-page .ac-advanced-fields{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:.75rem!important}
        .ac-catalog-page .ac-advanced-fields>div{display:contents!important}
      }
      @media(max-width:767px){
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-card *,.ac-catalog-page .ac-catalog-market-rail,.ac-catalog-page .ac-catalog-market-rail>*{box-shadow:none!important}
        .ac-catalog-page .ac-catalog-card,.ac-catalog-page .ac-catalog-market-rail{filter:none!important}
        .ac-catalog-page .ac-catalog-pagination{justify-content:center!important}
        .ac-catalog-page .ac-pagination-current{color:#fff!important;-webkit-text-fill-color:#fff!important}
      }
    ` }} />
  </main>;
}
