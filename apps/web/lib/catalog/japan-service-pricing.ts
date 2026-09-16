import { customerPriceBreakdown } from './customer-price-breakdown';
import type { VehicleOffer } from './types';

export function japanServiceCostBasis(snapshot: any) {
  if (snapshot?.serviceCostBasis) return snapshot.serviceCostBasis;
  const lines = snapshot?.breakdown;
  if (!Array.isArray(lines) || !lines.some(l => ['laboratory','sbkts','epts'].includes(l.id))) return undefined;
  const sum = (ids:string[]) => lines.filter(l => ids.includes(l.id)).reduce((s,l) => s + Number(l.amountRub),0);
  const laboratoryRub = sum(['laboratory','sbkts','epts']);
  const commissionRub = sum(['topavto-commission']);
  if (![laboratoryRub,commissionRub].every(n => Number.isFinite(n) && n >= 0)) return undefined;
  return {laboratoryRub,commissionRub};
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
  const totalRub = Number(offer.totalRub) + laboratoryRub - basis.laboratoryRub + commissionRub - basis.commissionRub;
  if (!(totalRub > 0)) return frozen as T;
  const breakdown = Array.isArray(snapshot?.breakdown) ? customerPriceBreakdown(snapshot.breakdown, config.securityDepositRub).map((line:any) =>
    line.id === 'laboratory' ? {...line,amountRub:laboratoryRub,includedServices:['laboratory','sbkts','epts']} :
    line.id === 'topavto-commission' ? {...line,amountRub:commissionRub} : line) : undefined;
  return {...frozen,totalRub,
    ...(Number((offer as any).cardProjectionVersion) >= 3 ? {publicVisibleRub:totalRub} : {}),
    calculationSnapshot:{...snapshot,...(breakdown ? {breakdown} : {}),
      serviceCostBasis:{laboratoryRub,commissionRub},serviceBundleVersion:config.serviceBundleVersion,
      businessConfigVersion:config.id,
      marketConfig:{...snapshot?.marketConfig,laboratoryRub,sbktsRub:0,eptsRub:0,
        topAvtoCommissionRub:commissionRub,securityDepositRub:config.securityDepositRub,
        contractInitialPaymentRub:config.contractInitialPaymentRub,serviceBundleVersion:config.serviceBundleVersion}}} as T;
}
