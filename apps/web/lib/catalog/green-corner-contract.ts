export const GREEN_CORNER_SOURCE = "akebono_green_japan_open";
export const GREEN_CORNER_BASE_LOGISTICS_RUB = 45_000;
export type GreenCornerLogistics = { baseRateRub: number; rateDate: string; amountJpy: number };
export function createGreenCornerLogistics(rate: any): GreenCornerLogistics {
  if (rate?.currency !== 'JPY' || !['cbr', 'cbr_live'].includes(rate.rateSource)
    || !Number.isFinite(rate.effectiveRate) || rate.effectiveRate <= 0 || !Number.isFinite(Date.parse(rate.rateDate))) throw Error('green_invalid_logistics_rate');
  return {baseRateRub:rate.effectiveRate, rateDate:rate.rateDate, amountJpy:GREEN_CORNER_BASE_LOGISTICS_RUB / rate.effectiveRate};
}
export function greenCornerLogisticsRub(basis: GreenCornerLogistics | undefined, currentRate: number): number {
  if (!basis || !Number.isFinite(basis.baseRateRub) || basis.baseRateRub <= 0
    || !Number.isFinite(basis.amountJpy) || basis.amountJpy <= 0
    || Math.abs(basis.amountJpy * basis.baseRateRub - GREEN_CORNER_BASE_LOGISTICS_RUB) > 0.01
    || !Number.isFinite(Date.parse(basis.rateDate)) || !Number.isFinite(currentRate) || currentRate <= 0) throw Error('green_missing_logistics_basis');
  return Math.round(basis.amountJpy * currentRate);
}
export function isGreenCornerOffer(offer: any): boolean {
  return offer?.sourceId === GREEN_CORNER_SOURCE && offer?.market === "japan"
    && /^green-\d+$/.test(String(offer?.id || "")) && offer?.offerType === "fixed";
}
