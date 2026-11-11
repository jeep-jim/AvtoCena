import {hasEncyclopediaCalculationEvidence} from '../encyclopedia/calculation-evidence';
/** Owner 20.10.2026: UAE power and displacement are manual-only.
 * Applies to retained full records and compact projections, not just new intake.
 * Saved employee calculations are separate records and remain untouched.
 */
export function applyUaeManualSpecifications<T extends Record<string, any>>(offer:T):T {
 if(offer.market!=='uae'||hasEncyclopediaCalculationEvidence(offer))return offer;
 const rate=offer.calculationSnapshot?.currencyRate;
 const price=Number(offer.sourcePrice), effective=Number(rate?.effectiveRate);
 const bound=rate&&['cbr','cbr_live'].includes(rate.rateSource)&&rate.currency===offer.sourceCurrency
  &&Number(rate.sourcePrice)===price&&Number.isFinite(price)&&price>0&&Number.isFinite(effective)&&effective>0;
 const sellerPriceRub=bound?Math.round(price*effective):undefined;
 const missing={status:'missing',source:'uae_manual_specifications_required'};
 return {...offer,engineCc:undefined,powerHp:undefined,powerKw:undefined,icePowerKw:undefined,
  power30MinKw:undefined,power30MinKwByMotor:undefined,utilizationPowerKw:undefined,
  powerDataConfidence:undefined,powerDataSource:undefined,
  totalRub:null,previousTotalRub:null,priceDeltaRub:null,publicVisibleRub:undefined,
  publicSpecificationVerified:false,modificationSelection:undefined,recoveryQualification:undefined,
  deliveredCalculationPreview:undefined,catalogPricingMode:'seller',sellerPriceRub,calculationStatus:'needs_data',
  calculationSnapshot:{currencyRate:rate,sourcePriceRub:sellerPriceRub,pricingConfidence:'unavailable'},
  ...(offer.operational?{operational:{...offer.operational,sourceDisplacementLabel:undefined,
   semanticEvidence:{...offer.operational.semanticEvidence,engineCc:missing,powerHp:missing,powerKw:missing,certifiedPower:missing}}}:{}),
 } as T;
}
