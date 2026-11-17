import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');const n=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e13?v:null;
export const PRICE_PATH_FILES=['apps/web/lib/catalog/customs-pricing.ts','apps/web/lib/catalog/production-month.ts','apps/web/lib/catalog/korea-customs-value.ts','apps/web/lib/catalog/rates.ts','apps/web/lib/catalog/china-cny-price.ts','apps/web/lib/effective-market-settings.ts','apps/web/lib/catalog/market-logistics.ts','apps/web/lib/catalog/estimated-market-config.ts','packages/engine/src/calculation/calculateAvtocena.ts','packages/engine/src/calculation/russiaCustomsV2.ts'];
const fixedLines=new Set(['car','contract-services','topavto-commission','logistics','broker','svh','laboratory','rf-delivery','customs','utilization-fee','other-fixed','bank-transfer','exchange-reserve']);
const date=v=>/^\d{4}-\d{2}(?:-\d{2})?$/.test(String(v||''))?String(v):null;
const rate=r=>!r?null:{currency:['KRW','CNY','USD','EUR','RUB'].includes(r.currency)?r.currency:null,cbrRate:n(r.cbrRate),nominal:n(r.nominal),effectiveRate:n(r.effectiveRate),rateDate:date(r.rateDate),rateSource:['cbr','cbr_live','moex','legacy_json','fallback_env'].includes(r.rateSource)?r.rateSource:'other',sourcePrice:n(r.sourcePrice),sourcePriceRub:n(r.sourcePriceRub)};
export function summarizeAutomaticPrice(input,result,{authorityFingerprint,fixture=false}={}){
 const s=result?.calculationSnapshot||{},c=s.customs||{},rows=Array.isArray(s.breakdown)?s.breakdown:[];
 const lines=rows.map((r,i)=>({id:fixedLines.has(r.id)?r.id:'configured-'+digest(r.id??i).slice(0,12),amountRub:n(r.amountRub),kind:['car','deposit','commission','logistics','service','customs','other','reserve','adjustment'].includes(r.kind)?r.kind:'other'}));
 const validAmounts=lines.every(x=>x.amountRub!==null),sum=validAmounts?lines.reduce((v,x)=>v+x.amountRub,0):null,total=n(result?.totalRub);
 const rateSnapshot=rate(s.customsCurrencyRate||s.currencyRate),actualRate=rate(s.currencyRate);
 const converted=actualRate&&actualRate.sourcePrice!==null&&actualRate.effectiveRate!==null?Math.round(actualRate.sourcePrice*actualRate.effectiveRate):null;
 const complete=total!==null&&total>0&&c.status==='ready'&&s.priceIncludesAllCustoms===true&&s.priceIncludesUtilizationFee===true;
 const arithmetic={sumBreakdownRub:sum,totalMatchesBreakdown:complete&&sum===total,sourcePriceTimesRateRub:converted,conversionMatches:converted!==null&&converted===n(s.sourcePriceRub)};
 const known=n(c.knownCustomsRub),util=n(c.utilizationFeeRub),customsLine=lines.find(x=>x.id==='customs')?.amountRub??0,utilLine=lines.find(x=>x.id==='utilization-fee')?.amountRub??0;
 const officialFresh=r=>r&&['cbr','cbr_live'].includes(r.rateSource)&&r.rateDate&&Date.now()-Date.parse(r.rateDate)<=4*86400000&&Date.parse(r.rateDate)-Date.now()<=86400000;arithmetic.officialRatesFresh=Boolean(officialFresh(actualRate)&&officialFresh(rateSnapshot)&&officialFresh(rate(s.eurRate)));
 arithmetic.customsLineMatches=known!==null&&known===customsLine;arithmetic.utilizationLineMatches=util!==null&&util===utilLine;
 return{fixture,market:['korea','china'].includes(input.market)?input.market:null,sampleHash:digest([input.sourceId,input.id]),authorityFingerprint,
 source:{price:n(input.sourcePrice),currency:['KRW','CNY','USD','EUR','RUB'].includes(input.sourceCurrency)?input.sourceCurrency:null,year:n(input.year),productionDate:date(input.productionDate),engineCc:n(input.engineCc),powerHp:n(input.powerHp)},
 status:complete?'complete':'blocked',fullPriceAccepted:false,priceChecksPassed:complete&&Object.values(arithmetic).filter(x=>typeof x==='boolean').every(Boolean),totalRub:total,lines,arithmetic,currencyRate:actualRate,customsCurrencyRate:rateSnapshot,eurRate:rate(s.eurRate),
 paymentPlan:Object.fromEntries(['securityDepositRub','commissionRub','contractInitialPaymentRub','remainingAfterInitialRub'].map(k=>[k,n(s.paymentPlan?.[k])])),
 marketCosts:Object.fromEntries(['securityDepositRub','topAvtoCommissionRub','logisticsRub','logisticsUsd','logisticsUsdRateRub','brokerRub','svhRub','laboratoryRub','sbktsRub','eptsRub','rfDeliveryRub','otherFixedExpensesRub','bankTransferPercent','exchangeRateReservePercent'].map(k=>[k,n(s.marketConfig?.[k])])),
 customs:{ageBand:['up_to_3_years','from_3_to_5_years','over_5_years'].includes(c.ageBand)?c.ageBand:null,...Object.fromEntries(['ageMonths','customsValueRub','customsValueEur','customsClearanceFeeRub','importDutyRub','exciseRub','vatRub','knownCustomsRub','utilizationFeeRub','totalCustomsRub','utilizationPowerKw','utilizationCoefficient'].map(k=>[k,n(c[k])]))},
 productionReferenceDate:date(c.productionReferenceDate),productionReferenceBasis:['exact_date','month_midpoint','year_midpoint','new_model_year_scenario'].includes(c.productionReferenceBasis)?c.productionReferenceBasis:null,
 missing:(s.missing||c.missing||[]).map(x=>/^[a-z0-9_]{1,80}$/.test(String(x))?x:'unlisted_reason').slice(0,30),marketConfigDigest:digest(s.marketConfig||null),pricingConfidence:['exact','estimated','unavailable'].includes(s.pricingConfidence)?s.pricingConfidence:null};
}
export async function readAutomaticPriceAuthority(runtimeRoot,market){
 assert.ok(['china','korea'].includes(market),'price_audit_market');const load=f=>import(pathToFileURL(path.join(path.resolve(runtimeRoot),f)).href);
 const[rates,settings,editorial,anchors,index]=await Promise.all([load('apps/web/lib/catalog/rates.ts'),load('apps/web/lib/effective-market-settings.ts'),load('apps/web/lib/catalog/editorial.ts'),load('apps/web/lib/catalog/china-cny-price.ts'),load('apps/web/lib/encyclopedia/calculation-index.ts')]);
 const values={utcDay:new Date().toISOString().slice(0,10),rates:await rates.catalogRateFingerprintInputs(),marketConfig:await settings.getEffectiveMarketVersion(market),editorialDigest:digest(await editorial.readCatalogEditorial()),anchors:market==='china'?await anchors.chinaCnyPriceFingerprint():null,encyclopediaDigest:index.readCalculationIndex()?.digest||null};
 assert.ok(/^[a-f0-9]{64}$/.test(values.encyclopediaDigest||''),'price_audit_knowledge_index_required');
 return{fingerprint:digest(values),values};
}
/** Caller installs a snapshot-replay READ-ONLY fence before factory creation.
 * Guard receipt must attest same captured input bytes across roots, not fake rates/configs.
 * This invokes actual automatic catalog path and retains raw/semantic date evidence. */
export async function createAutomaticPriceProbe({runtimeRoot,sourcePins,configContext}){
 const root=path.resolve(runtimeRoot);assert.ok(configContext&&typeof configContext.assertSnapshot==='function'&&/^\d{4}-\d{2}-\d{2}$/.test(configContext.utcDay||''),'price_audit_context');
 for(const file of PRICE_PATH_FILES){assert.match(sourcePins?.[file]||'',/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex'),sourcePins[file],'price_audit_source_changed');}
 const {calculateOfferWithRussiaCustoms}=await import(pathToFileURL(path.join(root,'apps/web/lib/catalog/customs-pricing.ts')).href);let count=0;
 assert.equal(typeof configContext.beginProbe,'function','price_audit_lifecycle_required');
 return async offer=>{
  const operation=configContext.beginProbe();try{
  assert.ok(++count<=Math.min(configContext.maxRows||64,128),'price_audit_sample_limit');assert.equal(new Date().toISOString().slice(0,10),configContext.utcDay,'price_audit_day_changed');
  await configContext.assertSnapshot();const before=await readAutomaticPriceAuthority(root,offer.market);
  assert.equal(before.fingerprint,configContext.expectedAuthorityByMarket?.[offer.market],'price_audit_authority_changed');
  const input=structuredClone(offer),inputDigest=digest(input),result=await calculateOfferWithRussiaCustoms(input);
  assert.equal(digest(offer),inputDigest,'price_audit_input_mutated');const after=await readAutomaticPriceAuthority(root,offer.market);assert.equal(after.fingerprint,before.fingerprint,'price_audit_authority_changed');await configContext.assertSnapshot();
  return operation.complete(summarizeAutomaticPrice(offer,result,{authorityFingerprint:before.fingerprint,fixture:configContext.fixture===true}));
  }catch(error){operation.fail();throw error;}
 };
}
