import { withoutRetiredExportCharge } from "./retired-export-charge";
import { catalogPowerSanity } from './power-sanity';
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from './specification-evidence-audit';
import { combustionPowerMismatch } from './combustion-power-consistency';
import { auditedQuoteRejections } from './audited-quote-quarantine';

/** Reuse only a bound, dated CBR conversion; never substitute a delivered quote. */
export function safePublicPricing<T extends Record<string, any>>(input: T): T {
  input = withoutRetiredExportCharge(input);
  const sanity = catalogPowerSanity(input);
  // Compact projections omit raw evidence. Classify complete records before
  // projection, and do not mistake absent projection metadata for a conflict.
  const rejected = new Set(!input.cardProjectionVersion && input.operational ? SPECIFICATION_AUDIT_FIELDS.filter(field =>
    ['ambiguous', 'conflict'].includes(classifySpecificationEvidence(input, field).state)) : []);
  for (const field of auditedQuoteRejections(input)) rejected.add(field);
  const powerRejected = sanity.suspicious || rejected.has('powerHp') || rejected.has('certifiedPower') || combustionPowerMismatch(input);
  if (!powerRejected && !rejected.size) return input;
  const rate = input.calculationSnapshot?.currencyRate;
  const price = Number(input.sourcePrice);
  const effectiveRate = Number(rate?.effectiveRate);
  const date = Date.parse(rate?.rateDate || '');
  const bound = rate && ['cbr', 'cbr_live'].includes(rate.rateSource)
    && rate.currency === input.sourceCurrency
    && Number(rate.sourcePrice) === price
    && Number.isFinite(price) && price > 0
    && Number.isFinite(effectiveRate) && effectiveRate > 0
    // This is the existing historical conversion, not a newly fetched rate.
    // The normal display repricer refreshes it after the card is selected;
    // retain its date instead of dropping inventory before repricing can run.
    && Number.isFinite(date) && date <= Date.now() + 86400000;
  const sellerPriceRub = bound ? Math.round(price * effectiveRate) : undefined;
  return {
    ...input,
    ...(powerRejected ? {powerHp: undefined, powerKw: undefined, icePowerKw: undefined,
      power30MinKw: undefined, power30MinKwByMotor: undefined, utilizationPowerKw: undefined,
      powerDataConfidence: undefined} : {}),
    ...(rejected.has('engineCc') ? {engineCc: undefined} : {}),
    ...(rejected.has('fuelPowertrain') ? {fuel: undefined, powertrainKind: undefined} : {}),
    totalRub: null, previousTotalRub: null, priceDeltaRub: null,
    publicVisibleRub: undefined, publicSpecificationVerified: false,
    modificationSelection: undefined, recoveryQualification: undefined,
    catalogPricingMode: 'seller', sellerPriceRub, calculationStatus: 'needs_data',
    calculationSnapshot: { currencyRate: {...rate}, sourcePriceRub: sellerPriceRub, pricingConfidence: 'unavailable' },
    operational: {...input.operational,
      ...(powerRejected ? {powerSanity: {rejected:true, reason:input.operational?.powerSanity?.reason || (sanity.suspicious ? sanity.reason : 'unverified_power_evidence'), rejectedPowerHp:input.powerHp ?? input.operational?.powerSanity?.rejectedPowerHp ?? null}} : {}),
      semanticEvidence: {...input.operational?.semanticEvidence,
        ...(powerRejected ? {
        powerHp:{status:'conflict',source:'public_power_safety',rawValues:[]},
        powerKw:{status:'conflict',source:'public_power_safety',rawValues:[]}} : {})},
    },
  } as T;
}
