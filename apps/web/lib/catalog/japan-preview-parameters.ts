import { restoreProAuctionsPower, proAuctionsReportedVolume } from "./proauctions-source-parameters";
import { safePublicPricing } from "./safe-public-pricing";
import { confirmedProductionMonth, confirmedProductionDay } from "./production-month";
import { validateCustomerParameters } from "./customer-parameters";
import type { VehicleOffer } from "./types";

// The same editable, reported parameters as the detail calculator. This does
// not promote rounded auction specifications to verified publication data.
export function japanPreviewParameters(input: VehicleOffer) {
  const offer = safePublicPricing(restoreProAuctionsPower(input));
  return validateCustomerParameters({
    year: offer.year, productionMonth: confirmedProductionMonth(offer), productionDay: confirmedProductionDay(offer),
    fuel: offer.fuel, engineCc: offer.engineCc || proAuctionsReportedVolume(offer),
    powerHp: offer.powerHp, powerKw: offer.powerKw, hybridKind: offer.powertrainKind,
    power30MinKw: offer.power30MinKw, icePowerKw: offer.icePowerKw,
    vehicleCategory: /pickup|pick-up|пикап/i.test(String(offer.bodyType || "")) ? "N1" : offer.vehicleCategory === "unknown" ? "" : offer.vehicleCategory,
    grossVehicleWeightKg: offer.grossVehicleWeightKg, n1IceFuel: offer.n1IceFuel, transportToBorderRub: offer.transportToBorderRub,
  });
}
