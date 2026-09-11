import type { VehicleOffer } from './types';
import { enrichOfferWithSourceTableParameters } from './source-table-displacement';
import { isSellerPricedOffer } from './seller-price-contract';
import { hasModificationSelection, withoutDeliveredPrice } from './modification-contract';
import { enrichOfferForDisplay } from './display-enrichment';
import { normalizeVehicleOfferSpecs } from './spec-normalization';
import { publicOffer } from './storage';
import { catalogOfferVisibleRub } from './public-priority';
import { calculateOfferWithRussiaCustoms } from './customs-pricing';

/** The canonical, non-personalized page calculation shared by HTML, SEO and MCP. */
export async function resolveOfferPresentation(stored: VehicleOffer) {
  const offer = enrichOfferWithSourceTableParameters(structuredClone(stored));
  const sellerPricing = isSellerPricedOffer(offer);
  const selectionRequired = hasModificationSelection(offer);
  const enrichedOffer = selectionRequired || sellerPricing ? offer : await enrichOfferForDisplay(offer);
  const normalizedEnrichedOffer = selectionRequired || sellerPricing ? enrichedOffer : normalizeVehicleOfferSpecs(enrichedOffer);
  const initialVisibleRub = catalogOfferVisibleRub(publicOffer(normalizedEnrichedOffer));
  const pricedOffer = sellerPricing ? normalizedEnrichedOffer
    : selectionRequired ? withoutDeliveredPrice(offer)
    : initialVisibleRub > 0 ? normalizedEnrichedOffer
    : await calculateOfferWithRussiaCustoms(normalizedEnrichedOffer);
  const raw = selectionRequired || sellerPricing ? publicOffer(pricedOffer) : normalizeVehicleOfferSpecs(publicOffer(pricedOffer));
  return { offer, sellerPricing, selectionRequired, enrichedOffer, normalizedEnrichedOffer, pricedOffer, raw };
}
