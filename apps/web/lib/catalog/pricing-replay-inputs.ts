import type { VehicleOffer } from "./types";
import { confirmedProductionValue } from "./production-month";

// Older published V2 quotes predate customsInput. Restore only their audited
// production reference and successful customs evidence; incomplete offers stay incomplete.
export function withReplayInputs<T extends Partial<VehicleOffer>>(offer: T): T {
  const snapshot = offer.calculationSnapshot;
  const customs = snapshot?.customs;
  if (!snapshot || snapshot.customsInput || customs?.status !== "ready" || !customs.productionReferenceDate || snapshot.missing?.length || snapshot.priceIncludesAllCustoms === false) return offer;
  const productionDate = confirmedProductionValue(offer) || String(offer.year || customs.productionReferenceDate.slice(0,4));
  return {...offer, calculationSnapshot:{...snapshot,customsInput:{
    customsValueRub:customs.customsValueRub, eurRateRub:snapshot.eurRate?.effectiveRate,
    productionDate, engineCc:offer.engineCc, powerHp:offer.powerHp, powerKw:offer.powerKw,
    icePowerKw:offer.icePowerKw, power30MinKw:offer.power30MinKw, power30MinKwByMotor:offer.power30MinKwByMotor,
    utilizationPowerKw:customs.utilizationPowerKw, powertrainKind:offer.powertrainKind, fuel:offer.fuel,
    vehicleCategory:customs.vehicleCategoryAssumed ? undefined : customs.vehicleCategory,
    bodyType:offer.bodyType,make:offer.make,model:offer.model,tnVedCode:offer.tnVedCode,
    grossVehicleWeightKg:offer.grossVehicleWeightKg,n1IceFuel:offer.n1IceFuel,
    personalUseEligible:offer.personalUseEligible,
  }}} as T;
}

