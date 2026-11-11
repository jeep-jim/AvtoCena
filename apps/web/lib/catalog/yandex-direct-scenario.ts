import { DIRECT_CITY } from './yandex-direct-feed';
import { japanPreviewParameters } from './japan-preview-parameters';
import { getSavedOfferCalculation } from './saved-offer-calculation';
import { validateCustomerParameters } from './customer-parameters';
import { calculateOfferWithCustomerParametersDetailed } from './customs-pricing';
import type { VehicleOffer } from './types';

// Shared by the export and the landing page; never write a manager's calculation.
export async function directOfferScenario(offer: VehicleOffer, savedKnownAbsent = false) {
  const saved = savedKnownAbsent ? null : await getSavedOfferCalculation(offer);
  let parameters;
  try { parameters = saved ? validateCustomerParameters({...saved.draft,deliveryCity:DIRECT_CITY})
    : {...japanPreviewParameters(offer),deliveryCity:DIRECT_CITY}; }
  catch { return null; }
  const result = await calculateOfferWithCustomerParametersDetailed(offer,parameters);
  if (!result.ok || !Number.isFinite(result.calculation.totalRub) || !(Number(result.calculation.totalRub)>0)) return null;
  const date=parameters.productionDate?.split('-') || [];
  const draft = saved ? {...saved.draft,deliveryCity:DIRECT_CITY} : Object.fromEntries(Object.entries({
    year:parameters.year,productionMonth:date[1]?String(Number(date[1])):undefined,productionDay:date[2]?String(Number(date[2])):undefined,fuel:parameters.fuel,
    engineCc:parameters.engineCc,powerHp:parameters.powerHp,powerKw:parameters.powerKw,
    hybridKind:parameters.powertrainKind,power30MinKw:parameters.power30MinKw,icePowerKw:parameters.icePowerKw,
    vehicleCategory:parameters.vehicleCategory,grossVehicleWeightKg:parameters.grossVehicleWeightKg,
    n1IceFuel:parameters.n1IceFuel,transportToBorderRub:parameters.transportToBorderRub,deliveryCity:DIRECT_CITY,
  }).map(([key,value])=>[key,value==null?'':String(value)]));
  return {draft,calculation:result.calculation};
}
