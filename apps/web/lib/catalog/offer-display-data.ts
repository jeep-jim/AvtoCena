import {applyCatalogEditorial,readCatalogEditorial} from './editorial';
import {cache} from 'react';
import {safePublicPricing} from './safe-public-pricing';
import {enrichOfferWithSourceTableParameters} from './source-table-displacement';
import {restoreProAuctionsPower} from './proauctions-source-parameters';
import {applyActiveBusinessPricing} from './live-business-pricing';
import {isSellerPricedOffer} from './seller-price-contract';
import {hasModificationSelection,withoutDeliveredPrice} from './modification-contract';
import {calculateSelectedModification,conditionalModificationRub} from './modification-recovery';
import {enrichOfferForDisplay} from './display-enrichment';
import {normalizeVehicleOfferSpecs} from './spec-normalization';
import {publicOffer} from './storage';
import {catalogOfferVisibleRub} from './public-priority';
import {calculateOfferWithRussiaCustoms,calculateOfferWithUserPowerScenario} from './customs-pricing';
import {readCatalogPowerScenario} from './power-scenario';
import type {VehicleOffer} from './types';

// One request-local calculation feeds the visible page and link metadata.
export const resolveOfferDisplay = cache(async (storedOffer:VehicleOffer,safeRequestedPowerHp=0,modificationId='')=>{
  const editorial=await readCatalogEditorial();
  const safeOffer = safePublicPricing(enrichOfferWithSourceTableParameters(restoreProAuctionsPower(storedOffer)));
  const offer = safeOffer.catalogPricingMode === 'seller' || safeOffer.market === 'china' ? await applyActiveBusinessPricing(safeOffer) : safeOffer;

  const sellerPricing = isSellerPricedOffer(offer);
  const selectionRequired = hasModificationSelection(offer);
  const selectedModification = selectionRequired && modificationId
    ? await calculateSelectedModification(offer, modificationId) : null;
  const enrichedOffer = selectionRequired || sellerPricing ? offer : await enrichOfferForDisplay(offer);
  // Normalize while the trusted immutable identity evidence is still present.
  // publicOffer deliberately removes operational fields; running it first used
  // to erase resolver-backed variants such as UX250h before powertrain safety
  // could correct the stale combustion classification.
  const normalizedEnrichedOffer: any = applyCatalogEditorial(selectionRequired || sellerPricing ? enrichedOffer : normalizeVehicleOfferSpecs(enrichedOffer),editorial);
  const initialPublic: any = publicOffer(normalizedEnrichedOffer);
  const initialVisibleRub = catalogOfferVisibleRub(initialPublic);
  const pricedOffer = sellerPricing ? normalizedEnrichedOffer : selectionRequired ? selectedModification || withoutDeliveredPrice(offer) : safeRequestedPowerHp
    ? await calculateOfferWithUserPowerScenario(normalizedEnrichedOffer as any, safeRequestedPowerHp)
    : initialVisibleRub > 0
      ? normalizedEnrichedOffer
      : await calculateOfferWithRussiaCustoms(normalizedEnrichedOffer as any);
  const raw: any = applyCatalogEditorial(selectionRequired || sellerPricing ? publicOffer(pricedOffer) : normalizeVehicleOfferSpecs(publicOffer(pricedOffer)),editorial);
  const powerScenario = readCatalogPowerScenario(raw);
  const customerScenarioRub = safeRequestedPowerHp
    && !selectionRequired
    && raw.calculationSnapshot?.customs?.status === "ready"
    && raw.calculationSnapshot?.priceIncludesAllCustoms === true
    && powerScenario?.source === "customer_input"
    && Number(raw.totalRub || 0) > 0
      ? Math.round(Number(raw.totalRub))
      : 0;
  const modificationRub = selectedModification ? conditionalModificationRub(selectedModification) : 0;
  const visibleRub = modificationRub || customerScenarioRub || catalogOfferVisibleRub(raw);
  return {offer,sellerPricing,selectionRequired,selectedModification,enrichedOffer,normalizedEnrichedOffer,initialPublic,pricedOffer,raw,visibleRub};
});
