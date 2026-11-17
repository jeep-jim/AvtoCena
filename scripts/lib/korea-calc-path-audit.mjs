import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
export const CALC_PATH_FILES=['scripts/lib/paid-encar-offer.mjs','apps/web/lib/catalog/adapters.ts','apps/web/lib/catalog/storage.ts','apps/web/lib/catalog/encar-sale-contract.ts','apps/web/lib/catalog/spec-normalization.ts','apps/web/lib/catalog/offer-parameter-draft.ts','apps/web/lib/catalog/customer-parameters.ts','apps/web/lib/catalog/production-month.ts','packages/engine/src/calculation/russiaCustomsV2.ts','packages/engine/src/calculation/russiaCustoms.ts','packages/engine/src/calculation/calculateAvtocena.ts'];
const hash=v=>createHash('sha256').update(v).digest('hex');
const sourceNumber=v=>v===null||v===undefined||v===''?null:n(Number(v));
const n=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12?v:null;
const numeric=['year','productionYear','engineCc','powerHp','powerKw','icePowerKw','motorPeakKw','power30MinKw','utilizationPowerKw','sourcePrice'];
const enums={fuel:['petrol','diesel','lpg','cng','electric','hybrid'],powertrainKind:['combustion','electric','series_hybrid','other_hybrid','unknown'],sourceCurrency:['KRW','CNY','USD','EUR','RUB'],vehicleCategory:['M1','N1','unknown']};
const date=v=>/^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/.test(String(v||''))?String(v):null;
export function technicalFields(offer){return Object.fromEntries([...numeric.map(k=>[k,n(offer?.[k])]),...Object.entries(enums).map(([k,v])=>[k,v.includes(offer?.[k])?offer[k]:null]),['productionDate',date(offer?.productionDate)]]);}
const safeDraft=d=>({...technicalFields({...d,...Object.fromEntries(numeric.map(k=>[k,d[k]!==''&&d[k]!=null?Number(d[k]):undefined])),powertrainKind:d.hybridKind}),productionMonth:n(Number(d.productionMonth))||null,productionDay:n(Number(d.productionDay))||null});
const engineView=result=>({status:['ready','needs_data'].includes(result.status)?result.status:'unknown',productionReferenceBasis:['exact_date','month_midpoint','year_midpoint','new_model_year_scenario'].includes(result.productionReferenceBasis)?result.productionReferenceBasis:null,productionReferenceDate:date(result.productionReferenceDate),...Object.fromEntries(['ageMonths','customsValueRub','customsValueEur','customsClearanceFeeRub','importDutyRub','exciseRub','vatRub','utilizationPowerKw','utilizationCoefficient','utilizationFeeRub','knownCustomsRub','totalCustomsRub'].map(k=>[k,n(result[k])])),missing:(result.missing||[]).filter(k=>/^[a-z0-9_]{1,80}$/.test(k)).slice(0,30)});
/** Caller pins checkout and source snapshot; this also verifies exact source files.
 * Deterministic isolated engine probe, NOT a delivered-price or tariff acceptance. */
export async function createKoreaRowInspector({runtimeRoot,sourcePins,engineContext}){
 const root=path.resolve(runtimeRoot);assert.ok(sourcePins&&CALC_PATH_FILES.every(f=>/^[a-f0-9]{64}$/.test(sourcePins[f]||'')),'audit_engine_source_pins');
 for(const f of CALC_PATH_FILES)assert.equal(hash(await fs.readFile(path.join(root,f))),sourcePins[f],'audit_engine_source_changed');
 assert.ok(engineContext&&Number.isFinite(engineContext.customsValueRub)&&engineContext.customsValueRub>0&&Number.isFinite(engineContext.eurRateRub)&&engineContext.eurRateRub>0&&/^\d{4}-\d{2}-\d{2}$/.test(engineContext.importedAt),'audit_engine_context');
 const runtime=f=>import(pathToFileURL(path.join(root,f)).href);
 const [{normalizePaidEncarOffer},{EncarDirectAdapter},{isEncarNonCashContract},{compactPublicStorageOffer,publicOffer},{offerParameterDraft},{validateCustomerParameters},{confirmedProductionValue},{calculateRussiaCustomsForIndividual}]=await Promise.all([
  runtime('scripts/lib/paid-encar-offer.mjs'),runtime('apps/web/lib/catalog/adapters.ts'),runtime('apps/web/lib/catalog/encar-sale-contract.ts'),runtime('apps/web/lib/catalog/storage.ts'),runtime('apps/web/lib/catalog/offer-parameter-draft.ts'),runtime('apps/web/lib/catalog/customer-parameters.ts'),runtime('apps/web/lib/catalog/production-month.ts'),runtime('packages/engine/src/calculation/russiaCustomsV2.ts')]);
 const adapter=new EncarDirectAdapter();
 return async function inspectRow(data,{id,observedAt}){
  assert.equal(String(data.inner_id),String(id),'audit_row_identity');
  if(data.advertisement_type!=='Продажа'||data.sales_status!=='Доступно'||isEncarNonCashContract(data)||Number(data.price)<=0||data.is_duplicate===true)return {stratum:'unknown',issues:[],technical:{admitted:false}};
  assert.ok(data.currency==='KRW'&&Number.isSafeInteger(Number(data.price)),'audit_currency_price');
  const offer=normalizePaidEncarOffer(data,{id,observedAt,adapter});assert.ok(offer,'audit_normalization_failed');
  // Exact restore behavior: v3 price is already KRW, undo legacy adapter heuristic.
  offer.sourcePrice=Number(data.price);
  const compact=compactPublicStorageOffer(structuredClone(offer)),card=publicOffer(structuredClone(compact));
  const draft=offerParameterDraft(compact,offer),issues=[];
  const rawMonth=date(data.year_month);if(rawMonth&&confirmedProductionValue(compact)?.slice(0,7)!==rawMonth.slice(0,7))issues.push('SOURCE_PRODUCTION_MONTH_NOT_FORWARDED');
  if(rawMonth&&Number(rawMonth.slice(0,4))!==offer.year)issues.push('SOURCE_PRODUCTION_YEAR_DIFFERS_MODEL_YEAR');
  if(Number(data.power_ice_hp)>0&&offer.powertrainKind!=='electric'&&!Number.isFinite(offer.icePowerKw))issues.push('SOURCE_ICE_POWER_PRESENT_NORMALIZED_ABSENT');
  for(const key of ['year','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','sourcePrice'])if(Number.isFinite(offer[key])&&card[key]!==offer[key])issues.push('CARD_'+key.replace(/[A-Z]/g,m=>'_'+m).toUpperCase()+'_CHANGED');
  const result={stratum:enums.powertrainKind.includes(offer.powertrainKind)?offer.powertrainKind:'unknown',issues,technical:{admitted:true,priceMode:'isolated_customs_probe_not_delivered_acceptance',sourcePinsSha256:hash(JSON.stringify(sourcePins)),source:{year:sourceNumber(data.year),productionDate:rawMonth,engineCc:sourceNumber(data.displacement_cc),powerHp:sourceNumber(data.power),icePowerHp:sourceNumber(data.power_ice_hp),electricPeakKw:sourceNumber(data.power_electro_kw),sourcePrice:sourceNumber(data.price),sourceCurrency:'KRW'},normalized:technicalFields(offer),compact:technicalFields(compact),publicCard:technicalFields(card),draft:safeDraft(draft),confirmedProductionDate:date(confirmedProductionValue(compact)),validation:'not_attempted'}};
  let validated;try{validated=validateCustomerParameters(draft);}catch{result.technical.validation='rejected';issues.push('CARD_DRAFT_VALIDATION_REJECTED');return result;}
  result.technical.validation='accepted';result.technical.validated=technicalFields(validated);
  const engineInput={...validated,customsValueRub:engineContext.customsValueRub,eurRateRub:engineContext.eurRateRub,importedAt:new Date(engineContext.importedAt+'T00:00:00Z'),newModelYearScenario:!validated.productionDate,make:offer.make,model:offer.model,bodyType:offer.bodyType,sourceTitle:[offer.sourceTitle,offer.make,offer.model,offer.trim,offer.bodyType].filter(Boolean).join(' · '),tnVedCode:offer.tnVedCode,personalUseEligible:offer.personalUseEligible};
  result.technical.engineInput={...technicalFields(engineInput),customsValueRub:engineContext.customsValueRub,eurRateRub:engineContext.eurRateRub,importedAt:engineContext.importedAt};
  result.technical.engine=engineView(calculateRussiaCustomsForIndividual(engineInput));
  // Diagnostic counterfactual only. Manufacturing month is never persisted and
  // first registration is intentionally not a fallback. Other engine inputs stay identical.
  const manufactureMonth=typeof data.year_month==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(data.year_month)?data.year_month:null;
  const observedTime=Date.parse(observedAt);
  if(manufactureMonth&&Number(manufactureMonth.slice(0,4))>=1900&&Number.isFinite(observedTime)&&Date.parse(manufactureMonth+'-01T00:00:00Z')<=observedTime){
   const scenarioInput={...engineInput,year:Number(manufactureMonth.slice(0,4)),productionDate:manufactureMonth,newModelYearScenario:false};
   const scenario=engineView(calculateRussiaCustomsForIndividual(scenarioInput));
   const baseline=result.technical.engine;
   result.technical.supplierManufactureScenario={diagnosticOnly:true,published:false,productionDate:manufactureMonth,year:scenarioInput.year,engine:scenario,delta:Object.fromEntries(['ageMonths','customsClearanceFeeRub','importDutyRub','exciseRub','vatRub','utilizationFeeRub','knownCustomsRub','totalCustomsRub'].map(k=>[k,typeof scenario[k]==='number'&&typeof baseline[k]==='number'?n(scenario[k]-baseline[k]):null]))};
  }
  return result;
 };
}
