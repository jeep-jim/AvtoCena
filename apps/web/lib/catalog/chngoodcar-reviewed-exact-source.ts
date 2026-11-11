import type { VehicleOffer } from "./types";
import {
  ChnGoodCarPaginatedExactAdapter,
  type GoodCarPaginatedExactRawOffer,
} from "./chngoodcar-paginated-exact-source";
import { goodCarManualPriceReviewReason } from "./chngoodcar-price-review";

export class ChnGoodCarReviewedPaginatedExactAdapter extends ChnGoodCarPaginatedExactAdapter {
  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as GoodCarPaginatedExactRawOffer;
    const priceReviewReason = goodCarManualPriceReviewReason(row);
    if (priceReviewReason) return null;
    const offer = super.normalizeOffer(row);
    if (!offer) return null;
    offer.operational = {
      ...(offer.operational || {}),
      exactScope: "ICE_passenger_only_CarsList_paginated_manual_price_review_no_publish_v3",
      semanticEvidence: {
        ...((offer.operational?.semanticEvidence as Record<string, unknown>) || {}),
        priceReviewBoundary: "2020+ rows in the source-defined under-2000 USD band are held for manual verification; the source value is preserved in raw evidence and never replaced",
      },
    };
    return offer;
  }
}

export const chngoodcarChinaReviewedPaginatedExactSource = new ChnGoodCarReviewedPaginatedExactAdapter();
