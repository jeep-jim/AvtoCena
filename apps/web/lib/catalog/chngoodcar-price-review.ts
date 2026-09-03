export const GOOD_CAR_MANUAL_PRICE_REVIEW_USD_CEILING = 2000;

export function goodCarManualPriceReviewReason(input: { year?: unknown; sourcePrice?: unknown }) {
  const year = Number(input?.year);
  const sourcePrice = Number(input?.sourcePrice);
  if (!Number.isInteger(year) || !Number.isFinite(sourcePrice) || sourcePrice <= 0) return null;
  if (year >= 2020 && sourcePrice < GOOD_CAR_MANUAL_PRICE_REVIEW_USD_CEILING) {
    return "modern_offer_in_source_under_2000_usd_band" as const;
  }
  return null;
}
