import {applyJapanDefaultFuel} from './japan-default-fuel';
import {canonicalSourceFuel,namedElectrifiedPowertrainKind} from './powertrain-safety';

export const STEPWGN_OWNER_POWER_HP = 150;
const source='owner_policy:stepwgn_nonhybrid_150:2026-10-25';
const kw=Number((STEPWGN_OWNER_POWER_HP*0.73549875).toFixed(5));
const hybridName=/hybrid|e\s*[: -]?\s*hev|i[ -]?mmd|гибрид|ハイブリッド/i;
/** Owner-requested value, not a manufacturer specification or encyclopedia evidence.
 * Hybrid chassis exclusions: Honda 2022 archived spec (RP5), 2022 factbook (RP8).
 * https://www.honda.co.jp/auto-archive/stepwgn/normal/2022/common/pdf/stepwgn_spec_list.pdf
 * https://www.honda.co.jp/factbook/auto/STEPWGN/220526/4220526-stepwgn.pdf
 */
export function isOwnerStepwgnNonHybrid(offer:Record<string,any>):boolean {
 if(offer.market!=='japan'||!/^honda$/i.test(String(offer.make||'').trim()))return false;
 if(!/^(?:step\s*w(?:a)?g(?:o)?n|степ\s*вагон|ステップワゴン)(?:$|[\s-])/i.test(String(offer.model||'').trim()))return false;
 const raw=offer.operational?.raw||{};
 const fuels=[offer.fuel,raw.sourceFuel,offer.sourceFuel].filter(v=>v!=null&&String(v).trim());
 if(fuels.some(v=>/^(?:H|HE|E)$/i.test(String(v).trim())||['hybrid','electric'].includes(canonicalSourceFuel(v)||'')))return false;
 if(offer.powertrainKind&&!['unknown','combustion'].includes(offer.powertrainKind)||namedElectrifiedPowertrainKind(offer))return false;
 if(hybridName.test([offer.model,offer.trim,offer.sourceTitle,offer.engineType,offer.operational?.sourceTitle].filter(Boolean).join(' ')))return false;
 const chassis=[offer.chassisCode,offer.operational?.chassisCode,offer.operational?.modelCode,raw.chassisCode,offer.frameNumber].filter(Boolean).join(' ');
 if(/(?:^|[^A-Z0-9])RP[58](?:$|[^A-Z0-9])/i.test(chassis))return false;
 if(Number(offer.power30MinKw)>0||offer.power30MinKwByMotor?.some((v:unknown)=>Number(v)>0))return false;
 // An explicitly unknown/conflicting fuel code is not proof of nonhybrid identity.
 if(offer.operational?.fuelDefaultBlocked)return false;
 return !fuels.some(v=>!['P','UNKNOWN'].includes(String(v).trim().toUpperCase())&&!canonicalSourceFuel(v));
}
export function applyJapanOwnerSpecifications<T extends Record<string,any>>(input:T):T {
 const offer=applyJapanDefaultFuel(input);
 if(!isOwnerStepwgnNonHybrid(offer))return offer;
 if(offer.powerHp===150&&offer.powerKw===kw&&offer.powerDataSource===source)return offer;
 const {powerScenario:_oldScenario,...snapshot}=offer.calculationSnapshot||{};
 return {...offer,powerHp:150,powerKw:kw,icePowerKw:kw,utilizationPowerKw:kw,
  powerDataSource:source,powerDataConfidence:'estimated',
  totalRub:null,previousTotalRub:null,priceDeltaRub:null,publicVisibleRub:undefined,
  publicSpecificationVerified:false,calculationStatus:'needs_data',catalogPricingMode:'seller',
  savedCalculationPreview:undefined,deliveredCalculationPreview:undefined,japanDeliveredPreview:undefined,
  calculationSnapshot:{currencyRate:snapshot.currencyRate,sourcePriceRub:snapshot.sourcePriceRub,pricingConfidence:'unavailable'},
  operational:{...offer.operational,ownerPowerOverride:offer.operational?.ownerPowerOverride||{
   value:150,source:'owner_policy',policyDate:'2026-10-25',
   previous:{powerHp:input.powerHp,powerKw:input.powerKw,powerDataSource:input.powerDataSource},
  }},
 } as T;
}

/** Fixed SQL; apply the same owner power before count/pagination. No user text. */
export function stepwgnOwnerSql():string {
 const hybrid='HYBRID|E[ : -]*HEV|I[ -]*MMD|ГИБРИД|ハイブリッド';
 return "(marka_name='HONDA' and model_name regexp '^(STEP[ ]*W(A)?G(O)?N|СТЕП[ ]*ВАГОН|ステップワゴン)($|[ -])'"
  +" and (time is null or time='' or time='P')"
  +` and model_name not regexp '${hybrid}' and (grade is null or grade not regexp '${hybrid}')`
  +" and (kuzov is null or kuzov not regexp '(^|[^A-Z0-9])RP[58]($|[^A-Z0-9])'))";
}
