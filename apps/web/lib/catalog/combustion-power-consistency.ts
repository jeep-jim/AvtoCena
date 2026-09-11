import type { VehicleOffer } from './types';

export function combustionPowerMismatch(offer: Partial<VehicleOffer>): boolean {
  if (offer.powertrainKind !== 'combustion' || !(Number(offer.powerHp)>0)) return false;
  const kw=Number(offer.powerHp)*0.73549875;
  return [offer.powerKw,offer.icePowerKw,offer.utilizationPowerKw].some(value=>
    Number(value)>0 && Math.abs(Number(value)-kw)>Math.max(1.5,kw*0.02));
}

/** A corrected ICE rating must replace all derived copies of the old rating. */
export function synchronizeCombustionPower<T extends Partial<VehicleOffer>>(offer: T): T {
  if (offer.powertrainKind !== 'combustion' || !(Number(offer.powerHp) > 0)) return offer;
  const semantic: any = offer.operational?.semanticEvidence || {};
  const corrected = /^(?:encyclopedia_v2:|power-knowledge:|customer_input)/.test(String(offer.powerDataSource || ''));
  const exactHp = ['exact','verified'].includes(semantic.powerHp?.status);
  const exactKw = ['exact','verified','conflict'].includes(semantic.powerKw?.status);
  if (!corrected && !(exactHp && !exactKw)) return offer;
  const kw = Number((Number(offer.powerHp) * 0.73549875).toFixed(5));
  return {...offer, powerKw: kw, icePowerKw: kw, utilizationPowerKw: kw};
}
