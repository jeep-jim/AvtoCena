import { specificationEvidenceComplete } from "./modification-matching";
import type { VehicleOffer } from "./types";
import { convertToRub } from "./rates";
import { classifySpecificationEvidence } from "./specification-evidence-audit";
import { calculateOfferWithVerifiedSpecifications } from "./customs-pricing";
import { catalogOfferVisibleRub, isJapanAuctionOffer, japanAuctionSoldPriceVerified } from "./public-priority";
import { hasCredibleOfferContent } from "./offer-quality";
import { withoutDeliveredPrice } from "./modification-contract";
import { restoreSavedSourceEvidence } from "./saved-source-recovery";

export async function prepareSellerInventory(input: VehicleOffer, options: { preservePublishedPrice?: boolean } = {}): Promise<VehicleOffer | null> {
  if (isJapanAuctionOffer(input) && !japanAuctionSoldPriceVerified(input)) return null;
  // A published quote is already complete. Its compact record intentionally
  // omits some raw source evidence; replaying it as a new intake row erased
  // valid calculations and specifications during the weekly refresh.
  if (options.preservePublishedPrice && catalogOfferVisibleRub(input) > 0) return structuredClone(input);
  const original = restoreSavedSourceEvidence(structuredClone(input));
  if (specificationEvidenceComplete(original)) {
    const calculated = await calculateOfferWithVerifiedSpecifications(original,true);
    if (catalogOfferVisibleRub(calculated) > 0 && hasCredibleOfferContent(calculated)) {
      delete calculated.catalogPricingMode; delete calculated.sellerPriceRub;
      return calculated;
    }
  }
  const rate = await convertToRub(original.sourcePrice, original.sourceCurrency);
  if (!rate || !["cbr","cbr_live"].includes(rate.rateSource)) return null;
  const date = Date.parse(rate.rateDate);
  if (!Number.isFinite(date) || Math.abs(Date.now()-date)>4*86400000) return null;
  const offer = withoutDeliveredPrice(original);
  delete offer.modificationSelection; delete offer.recoveryQualification;
  if (classifySpecificationEvidence(original,"engineCc").state !== "exact") offer.engineCc = undefined;
  if (classifySpecificationEvidence(original,"powerHp").state !== "exact") {
    offer.powerHp = undefined; offer.powerKw = undefined; offer.icePowerKw = undefined;
    offer.powerDataConfidence = undefined; offer.powerDataSource = undefined;
  }
  if (classifySpecificationEvidence(original,"fuelPowertrain").state !== "exact") {
    offer.fuel = undefined; offer.powertrainKind = "unknown";
  }
  if (classifySpecificationEvidence(original,"certifiedPower").state !== "exact") {
    offer.power30MinKw = undefined; offer.power30MinKwByMotor = undefined;
  }
  offer.utilizationPowerKw = undefined;
  offer.catalogPricingMode = "seller"; offer.sellerPriceRub = Math.round(rate.sourcePriceRub);
  offer.calculationStatus = "needs_data";
  offer.calculationSnapshot = {currencyRate:rate,sourcePriceRub:rate.sourcePriceRub,pricingConfidence:"unavailable"};
  return hasCredibleOfferContent(offer) ? offer : null;
}
