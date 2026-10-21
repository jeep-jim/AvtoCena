export const GOOD_CAR_MANUAL_PRICE_REVIEW_USD_CEILING = 2000;

type GoodCarPriceReviewCandidate = {
  sourceOfferId?: unknown;
  sourceTitle?: unknown;
  year?: unknown;
  sourcePrice?: unknown;
};

export function goodCarManualPriceReviewReason(input: GoodCarPriceReviewCandidate) {
  const year = Number(input?.year);
  const sourcePrice = Number(input?.sourcePrice);
  const sourceOfferId = String(input?.sourceOfferId ?? '').trim();
  const sourceTitle = String(input?.sourceTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!Number.isInteger(year) || !Number.isFinite(sourcePrice) || sourcePrice <= 0) return null;

  if (year >= 2020 && sourcePrice < GOOD_CAR_MANUAL_PRICE_REVIEW_USD_CEILING) {
    return "modern_offer_in_source_under_2000_usd_band" as const;
  }

  // Good Car offer 1432600975113187328 reports 93,900 USD for the exact
  // Mazda3 Axela 2017 1.5L AT Comfort 国V row. Independent exact-version
  // Autohome evidence currently places this trim's used-market range around
  // 2.98-4.78 万 CNY, with same-trim listings around 3-4 万 CNY. The source
  // price is preserved verbatim but must not become an automatic exact price.
  if (sourceOfferId === '1432600975113187328'
    && /^马自达\s+昂克赛拉\s+2017款\s+三厢\s+1\.5L\s+自动舒适型\s+国V$/i.test(sourceTitle)
    && sourcePrice >= 90000) {
    return "verified_exact_version_extreme_price_outlier_manual_review" as const;
  }

  return null;
}
