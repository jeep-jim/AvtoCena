import {completePowerUnitDraft} from './power-parameter-draft';
import type {VehicleOffer} from './types';
import {confirmedProductionMonth,confirmedProductionDay} from './production-month';
import {proAuctionsReportedVolume,proAuctionsHybridDraft} from './proauctions-source-parameters';
import {readCatalogPowerScenario} from './power-scenario';
import {publicCatalogPowerHp} from './power-sanity';
import {recyclingPowerInfo} from './recycling-power';
import {catalogPowerDisplay} from './power-display';
export function offerParameterDraft(offer:VehicleOffer,raw:VehicleOffer=offer):Record<string,string>{
 const sourceHybridDraft=proAuctionsHybridDraft(offer),powerScenario=readCatalogPowerScenario(raw),safePowerHp=publicCatalogPowerHp(raw);
 const draft={vehicleCategory:offer.vehicleCategory === "unknown" ? "" : offer.vehicleCategory||"",grossVehicleWeightKg:String(offer.grossVehicleWeightKg||""),n1IceFuel:offer.n1IceFuel||"",year:String(offer.year||""),productionMonth:confirmedProductionMonth(offer),productionDay:confirmedProductionDay(offer),transportToBorderRub:offer.transportToBorderRub == null ? "" : String(offer.transportToBorderRub),engineCc:String(offer.engineCc||proAuctionsReportedVolume(offer)||""),fuel:sourceHybridDraft.fuel||offer.fuel||"",powerHp:powerScenario?.source==="fallback_100"?"":String(safePowerHp||""),powerKw:powerScenario?"":String(raw.powerKw||recyclingPowerInfo(raw)?.kw||""),hybridKind:["series_hybrid","other_hybrid"].includes(offer.powertrainKind||"")?offer.powertrainKind!:"",power30MinKw:String(catalogPowerDisplay(offer)?.thirtyMinutePowerKw||""),icePowerKw:sourceHybridDraft.icePowerKw||String(offer.icePowerKw||"")};
 if(/pickup|pick-up|пикап/i.test(String(offer.bodyType||'')))draft.vehicleCategory='N1';
 return completePowerUnitDraft(draft);
}
