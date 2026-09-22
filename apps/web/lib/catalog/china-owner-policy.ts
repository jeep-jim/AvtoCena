import type { VehicleOffer } from './types';

export const CHINA_MAX_TOTAL_RUB = 15_000_000;
export const CHINA_MAX_AGE_MONTHS = 72;
export function catalogHardPriceCap(offer?: Partial<VehicleOffer>) {
  return offer?.market === 'china' ? CHINA_MAX_TOTAL_RUB : 15_000_000;
}

export function chinaSourceProductionDate(value: unknown) {
  const match = String(value || '').trim().match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?(?:[ T]00:00:00(?:\.000)?Z?)?$/);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]);
  if (match[3] && new Date(Date.UTC(year, month - 1, Number(match[3]))).getUTCMonth() !== month - 1) return undefined;
  return `${year}-${String(month).padStart(2,'0')}${match[3] ? `-${String(Number(match[3])).padStart(2,'0')}` : ''}`;
}
function monthIndex(value: unknown) {
  const date = chinaSourceProductionDate(value);
  return date ? Number(date.slice(0,4)) * 12 + Number(date.slice(5,7)) - 1 : undefined;
}

/** Inventory age uses the source's date, never a guessed model-year month.
 * Registration is explicitly a fallback for listing selection, not proof of
 * manufacturing date and never a replacement for the customs age evidence.
 */
export function chinaInventoryAgeDecision(offer: Partial<VehicleOffer>, now = new Date()) {
  if (offer.market !== 'china') return { eligible: true, basis: 'other_market' };
  const op: any = offer.operational || {}, raw = op.raw || {};
  const boundDetail = raw.detail && String(offer.sourceOfferId || '') && String(raw.detail.infoid || '') === String(offer.sourceOfferId) ? raw.detail : {};
  const production = op.semanticEvidence?.productionDate;
  const manufactured = monthIndex(production?.status === 'exact' && /manufactur|production|produced/i.test(String(production.source)) ? production.value : undefined)
    ?? monthIndex(boundDetail.manufacturedate || boundDetail.producedate);
  const registered = monthIndex(op.registrationDate || boundDetail.regdate || raw.listing?.regdate);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const dated = manufactured ?? registered;
  if (dated !== undefined) {
    const ageMonths = current - dated;
    return { eligible: ageMonths >= 0 && ageMonths <= CHINA_MAX_AGE_MONTHS, ageMonths,
      basis: manufactured !== undefined ? 'manufacture_month' : 'registration_month' };
  }
  // At the six-year boundary a year alone cannot establish the month.
  const year = Number(offer.year);
  return { eligible: Number.isInteger(year) && year > now.getUTCFullYear() - 6 && year <= now.getUTCFullYear(),
    basis: 'year_only_conservative' };
}

export function che168GlobalPriceAdjustment(offer: Partial<VehicleOffer>, originalCarPriceRub: number) {
  if (offer.market !== 'china' || offer.sourceId !== 'autohome_used_china_open' || offer.sourceCurrency !== 'USD'
    || !Number.isFinite(originalCarPriceRub) || originalCarPriceRub <= 0) return undefined;
  try {
    const url = new URL(String(offer.operational?.sourceUrl || ''));
    if (url.hostname !== 'global.che168.com' || !/^https?:$/.test(url.protocol)) return undefined;
  } catch { return undefined; }
  return { version: 1, policy: 'owner_che168_global_minus_2_percent_20260913', percent: -2,
    originalSourcePrice: offer.sourcePrice, originalSourceCurrency: offer.sourceCurrency,
    originalCarPriceRub, adjustmentRub: -Math.round(originalCarPriceRub * 0.02),
    label: 'Расчётная корректировка АвтоЦены: −2% от цены Global',
    warning: 'Применена расчётная корректировка АвтоЦены −2% от цены Global. Скидка продавцом не подтверждена; итог требует подтверждения. Таможенные платежи рассчитаны от исходной цены.' };
}
