import { searchOffers } from "./storage";
import type { CatalogSearchParams } from "./types";
import { applyActiveBusinessPricingBatch } from "./live-business-pricing";
import { isRenderablePublicCatalogOffer } from "./offer-quality";
import { DetailReadCache } from "./detail-read-cache";
const MARKET_PAGE_SIZE = 24;
const MARKET_DIVERSITY_WINDOW_PAGES = 8;
const PRIORITY_MAX_RUB = 6_000_000;
const PRIORITY_MAX_POWER_HP = 160;
const PRIORITY_MIN_YEAR = new Date().getFullYear() - 6;
function offerFreshness(offer: any) {
  return Date.parse(String(offer?.auctionDate || offer?.operational?.sourcePublishedAt || offer?.firstSeenAt || offer?.updatedAt || "")) || 0;
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
  // Source-only rubles cannot outrank a completed delivered quote merely
  // because customs and delivery have not been added to them.
  let score = Number(offer?.totalRub) > 0 ? 100_000 : 0;
  if (affordable) score += 1_600;
  if (lowPower) score += 1_600;
  if (recent) score += 800;
  if (affordable && lowPower && recent) score += 3_200;
  if (rub > 0) score += 200;
  return score;
}

export function businessOrder(left: any, right: any) {
  return businessPriority(right) - businessPriority(left)
    || offerFreshness(right) - offerFreshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}
export function sortCatalogRows(rows: any[], sort: string) {
  const sorted = [...rows];
  if (sort === "totalRub") return sorted.sort((left, right) => {
    const a = offerRubValue(left) || Number.POSITIVE_INFINITY;
    const b = offerRubValue(right) || Number.POSITIVE_INFINITY;
    return a - b || businessOrder(left, right);
  });
  if (sort === "totalRubDesc") return sorted.sort((left, right) => {
    const a = offerRubValue(left);
    const b = offerRubValue(right);
    return (b || Number.NEGATIVE_INFINITY) - (a || Number.NEGATIVE_INFINITY) || businessOrder(left, right);
  });
  if (sort === "year") return sorted.sort((left, right) => Number(right?.year || 0) - Number(left?.year || 0) || businessOrder(left, right));
  if (sort === "yearAsc") return sorted.sort((left, right) => Number(left?.year || 0) - Number(right?.year || 0) || businessOrder(left, right));
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

export function balanceBusinessRows(rows: any[]) {
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

async function readDiverseDefaultMarketPage(market: string, page: number) {
  const windowIndex = Math.floor((Math.max(1, page) - 1) / MARKET_DIVERSITY_WINDOW_PAGES);
  const offsetWithinWindow = ((Math.max(1, page) - 1) % MARKET_DIVERSITY_WINDOW_PAGES) * MARKET_PAGE_SIZE;
  const firstResult = await searchOffers({ market, page: windowIndex + 1, pageSize: MARKET_PAGE_SIZE * MARKET_DIVERSITY_WINDOW_PAGES, sort: "updatedAt" }, MARKET_PAGE_SIZE * MARKET_DIVERSITY_WINDOW_PAGES);
  const candidates = balanceBusinessRows((firstResult.items as any[]).filter(isRenderablePublicCatalogOffer));
  return {
    items: candidates.slice(offsetWithinWindow, offsetWithinWindow + MARKET_PAGE_SIZE),
    generationId: firstResult.generationId,
    total: firstResult?.total || 0,
    page: Math.max(1, page),
    pageSize: MARKET_PAGE_SIZE,
  };
}


const pages = new DetailReadCache<any>({maxEntries: 32, maxBytes: 12 * 1024 * 1024, ttlMs: 60_000, concurrency: 4});
export function readCatalogMarketPage(query: CatalogSearchParams) {
  const normalized = {...query, page: Math.max(1, Math.floor(Number(query.page) || 1)), pageSize: MARKET_PAGE_SIZE};
  const key = JSON.stringify(Object.entries(normalized).sort(([a],[b])=>a.localeCompare(b)));
  return pages.get(key, async () => {
    const {market, page, pageSize, sort, ...filters} = normalized;
    const hasFilters = Object.values(filters).some(Boolean);
    const customSort = Boolean(sort && sort !== "updatedAt");
    const result = !hasFilters && !customSort
      ? await readDiverseDefaultMarketPage(String(market), page)
      : await searchOffers(normalized);
    const visible = await applyActiveBusinessPricingBatch(result.items);
    const items = customSort ? sortCatalogRows(visible, String(sort)) : filters.model ? visible.sort(businessOrder) : balanceBusinessRows(visible);
    return {...result, items};
  });
}
