import {applyJapanOwnerSpecifications,isOwnerStepwgnNonHybrid} from './japan-owner-specifications';
import {applyUaeManualSpecifications} from './uae-manual-specifications';
import { restoreSourceModelName } from "./source-model-name";
import {isGreenCornerOffer} from "./green-corner-contract";
import { namedElectrifiedPowertrainKind } from "./powertrain-safety";
import { withoutRetiredExportCharge } from "./retired-export-charge";
import { catalogPowerSanity } from './power-sanity';
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from './specification-evidence-audit';
import { combustionPowerMismatch } from './combustion-power-consistency';
import { auditedQuoteRejections } from './audited-quote-quarantine';
import {hasEncyclopediaCalculationEvidence} from '../encyclopedia/calculation-evidence';

/** Reuse only a bound, dated CBR conversion; never substitute a delivered quote. */
export function safePublicPricing<T extends Record<string, any>>(input: T): T {
  input = applyUaeManualSpecifications(restoreSourceModelName(withoutRetiredExportCharge(input)));
  if(input.market==='uae')return input;
  if(isOwnerStepwgnNonHybrid(input))input=applyJapanOwnerSpecifications(input);
  const ownerPower=isOwnerStepwgnNonHybrid(input)&&input.powerHp===150&&input.powerDataSource==='owner_policy:stepwgn_nonhybrid_150:2026-10-25';
  const namedKind = namedElectrifiedPowertrainKind(input);
  const powertrainMismatch = Boolean(namedKind && input.powertrainKind === 'combustion');
  const sanity = catalogPowerSanity(input);
  // Compact projections omit raw evidence. Classify complete records before
  // projection, and do not mistake absent projection metadata for a conflict.
  const rejected = new Set(!input.cardProjectionVersion && input.operational ? SPECIFICATION_AUDIT_FIELDS.filter(field =>
    ['ambiguous', 'conflict'].includes(classifySpecificationEvidence(input, field).state)) : []);
  for (const field of auditedQuoteRejections(input)) rejected.add(field);
  // This narrow owner input is not external evidence. Keep all non-power guards.
  if(ownerPower)rejected.delete('powerHp');
  const powerRejected = sanity.suspicious || rejected.has('powerHp') || rejected.has('certifiedPower') || combustionPowerMismatch(input);
  if (!powerRejected && !rejected.size && !powertrainMismatch) return applyJapanOwnerSpecifications(input);
  // A rejected peak-power observation must not erase independently attested
  // 30-minute power. The attestation must still bind after all rejected power
  // fields are removed; a combined/stale attestation cannot take this path.
  const encyclopediaEvidence = input.operational?.encyclopediaCalculation || input.encyclopediaCalculation;
  const retainCertifiedPower = powerRejected && !powertrainMismatch
    && !rejected.has('engineCc') && !rejected.has('fuelPowertrain')
    && classifySpecificationEvidence(input, 'certifiedPower').state === 'exact'
    && Number(input.power30MinKw) > 0
    && Object.prototype.hasOwnProperty.call(encyclopediaEvidence?.values || {}, 'power30MinKw')
    && hasEncyclopediaCalculationEvidence({...input, powerHp:undefined,
      powerKw:undefined, icePowerKw:undefined, power30MinKwByMotor:undefined,
      utilizationPowerKw:undefined});
  const rate = input.calculationSnapshot?.currencyRate;
  const price = Number(input.sourcePrice);
  const effectiveRate = Number(rate?.effectiveRate);
  const date = Date.parse(rate?.rateDate || '');
  const bound = rate && (['cbr', 'cbr_live'].includes(rate.rateSource) || isGreenCornerOffer(input) && rate.rateSource === 'atb_akebono')
    && rate.currency === input.sourceCurrency
    && Number(rate.sourcePrice) === price
    && Number.isFinite(price) && price > 0
    && Number.isFinite(effectiveRate) && effectiveRate > 0
    // This is the existing historical conversion, not a newly fetched rate.
    // The normal display repricer refreshes it after the card is selected;
    // retain its date instead of dropping inventory before repricing can run.
    && Number.isFinite(date) && date <= Date.now() + 86400000;
  const sellerPriceRub = bound ? Math.round(price * effectiveRate) : undefined;
  return applyJapanOwnerSpecifications({
    ...input,
    ...(powerRejected ? {powerHp: undefined, powerKw: undefined, icePowerKw: undefined,
      power30MinKw: retainCertifiedPower ? input.power30MinKw : undefined,
      power30MinKwByMotor: undefined, utilizationPowerKw: undefined,
      powerDataConfidence: undefined} : {}),
    ...(rejected.has('engineCc') ? {engineCc: undefined} : {}),
    ...(rejected.has('fuelPowertrain') ? {fuel: undefined, powertrainKind: undefined} : {}),
    ...(powertrainMismatch ? {fuel:namedKind === 'electric' ? 'electric' : 'hybrid',powertrainKind:namedKind,icePowerKw:undefined,utilizationPowerKw:undefined,power30MinKw:undefined,power30MinKwByMotor:undefined} : {}),
    totalRub: null, previousTotalRub: null, priceDeltaRub: null,
    publicVisibleRub: undefined, publicSpecificationVerified: false,
    modificationSelection: undefined, recoveryQualification: undefined,
    catalogPricingMode: 'seller', sellerPriceRub, calculationStatus: 'needs_data',
    calculationSnapshot: { currencyRate: {...rate}, sourcePriceRub: sellerPriceRub, pricingConfidence: 'unavailable' },
    operational: {...input.operational,
      ...(rejected.has('fuelPowertrain') && input.fuel && input.fuel!=='unknown' ? {fuelDefaultBlocked:true} : {}),
      ...(powerRejected ? {powerSanity: {rejected:true, reason:input.operational?.powerSanity?.reason || (sanity.suspicious ? sanity.reason : 'unverified_power_evidence'), rejectedPowerHp:input.powerHp ?? input.operational?.powerSanity?.rejectedPowerHp ?? null}} : {}),
      semanticEvidence: {...input.operational?.semanticEvidence,
        ...(powerRejected ? {
        powerHp:{status:'conflict',source:'public_power_safety',rawValues:[]},
        powerKw:{status:'conflict',source:'public_power_safety',rawValues:[]}} : {})},
    },
  } as T);
}
