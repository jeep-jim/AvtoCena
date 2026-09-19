import { customerPriceBreakdown } from './customer-price-breakdown';
import type { VehicleOffer } from './types';

export function japanServiceCostBasis(snapshot: any) {
  if (snapshot?.serviceCostBasis && !Array.isArray(snapshot?.breakdown)) return snapshot.serviceCostBasis;
  const lines = snapshot?.breakdown;
  if (!Array.isArray(lines) || !lines.some(l => ['laboratory','sbkts','epts'].includes(l.id))) return undefined;
  const sum = (ids:string[]) => lines.filter(l => ids.includes(l.id)).reduce((s,l) => s + Number(l.amountRub),0);
  const laboratoryRub = sum(['laboratory','sbkts','epts']);
  const commissionRub = sum(['topavto-commission']);
  if (![laboratoryRub,commissionRub].every(n => Number.isFinite(n) && n >= 0)) return undefined;
  const exchangeReserveRub = sum(["exchange-reserve"]);
  const retiredExportRub = sum(["export"]);
  if (!Number.isFinite(exchangeReserveRub) || exchangeReserveRub < 0) return undefined;
  const vehiclePriceRub = customerPriceBreakdown(lines).filter((line:any) => line.id === "car").reduce((sum:number,line:any) => sum + Number(line.amountRub),0);
  return {laboratoryRub,commissionRub,exchangeReserveRub,retiredExportRub,vehiclePriceRub};
}

/** Update only the owner-authorized service costs. Auction price, historical
 * exchange rate, customs, source evidence and stored catalog remain frozen. */
export function applyJapanServiceCosts<T extends Partial<VehicleOffer>>(offer:T, config:any):T {
  const frozen = {...offer,previousTotalRub:null,priceDeltaRub:null,priceChangedAt:undefined};
  if (!(config?.serviceBundleVersion >= 1) || !(Number(offer.totalRub) > 0)) return frozen as T;
  const snapshot = offer.calculationSnapshot;
  const basis = japanServiceCostBasis(snapshot);
  if (!basis) return frozen as T; // never invent a missing historical cost
  const laboratoryRub = Number(config.laboratoryRub || 0) + Number(config.sbktsRub || 0) + Number(config.eptsRub || 0);
  const commissionRub = Number(config.topAvtoCommissionRub);
  if (![laboratoryRub,commissionRub].every(n => Number.isFinite(n) && n >= 0)) return frozen as T;
  const reservePercent = Math.max(0, Number(config.exchangeRateReservePercent) || 0);
  const vehiclePriceRub = Number(basis.vehiclePriceRub);
  if (reservePercent > 0 && !(vehiclePriceRub > 0)) return frozen as T;
  const exchangeReserveRub = Math.round((vehiclePriceRub || 0) * reservePercent / 100);
  const totalRub = exchangeReserveRub + Number(offer.totalRub) + laboratoryRub - basis.laboratoryRub + commissionRub - basis.commissionRub - Number(basis.exchangeReserveRub || 0) - Number(basis.retiredExportRub || 0);
  if (!(totalRub > 0)) return frozen as T;
  const breakdown = Array.isArray(snapshot?.breakdown) ? customerPriceBreakdown(snapshot.breakdown, config.securityDepositRub).filter((line:any) => line.id !== "exchange-reserve" && line.id !== "export").map((line:any) =>
    line.id === 'laboratory' ? {...line,amountRub:laboratoryRub,includedServices:['laboratory','sbkts','epts']} :
    line.id === 'topavto-commission' ? {...line,amountRub:commissionRub} : line) : undefined;
  if (breakdown && exchangeReserveRub > 0) breakdown.push({id:"exchange-reserve",title:"Резерв на изменение курса",amountRub:exchangeReserveRub,kind:"reserve",amountType:"percent",source:"market_config",note:`${reservePercent}% от стоимости авто`});
  return {...frozen,totalRub,
    ...(Number((offer as any).cardProjectionVersion) >= 3 ? {publicVisibleRub:totalRub} : {}),
    calculationSnapshot:{...snapshot,...(breakdown ? {breakdown} : {}),
      serviceCostBasis:{laboratoryRub,commissionRub,exchangeReserveRub,retiredExportRub:0,vehiclePriceRub},serviceBundleVersion:config.serviceBundleVersion,
      businessConfigVersion:config.id,
      marketConfig:{...snapshot?.marketConfig,exchangeRateReservePercent:reservePercent,laboratoryRub,sbktsRub:0,eptsRub:0,
        topAvtoCommissionRub:commissionRub,securityDepositRub:config.securityDepositRub,
        contractInitialPaymentRub:config.contractInitialPaymentRub,serviceBundleVersion:config.serviceBundleVersion}}} as T;
}
