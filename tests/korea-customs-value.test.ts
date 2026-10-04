import test from 'node:test';
import assert from 'node:assert/strict';
import {koreaIncludesLogistics} from '../apps/web/lib/catalog/korea-customs-value';
import {repriceOfferWithBusinessConfig} from '../apps/web/lib/catalog/live-business-pricing';
import {calculateRussiaCustomsForIndividual as customs} from '../packages/engine/src/calculation/russiaCustomsV2';
import {CATALOG_MARKET_DEFAULTS} from '../apps/web/lib/catalog/estimated-market-config';
import {compactPricingSnapshot} from '../apps/web/lib/catalog/compact-pricing-snapshot';

test('Korea freight uses customs age boundary, not a frozen list of model years',()=>{
 for(const year of [2024,2025,2026])assert.equal(koreaIncludesLogistics('korea',{year,importedAt:new Date('2026-10-04')}),true);
 assert.equal(koreaIncludesLogistics('korea',{productionDate:'2023-10-04',importedAt:new Date('2026-10-04')}),true);
 assert.equal(koreaIncludesLogistics('korea',{productionDate:'2023-10-04',importedAt:new Date('2026-10-05')}),false);
 assert.equal(koreaIncludesLogistics('korea',{year:2024,importedAt:new Date('2028-10-04')}),false);
 assert.equal(koreaIncludesLogistics('korea',{}),false);
 for(const market of ['china','japan','europe','uae','georgia'])assert.equal(koreaIncludesLogistics(market,{year:2026}),false);
});
function fixture(market:string,productionDate:string):any{
 const input={customsValueRub:914909,eurRateRub:100,productionDate,engineCc:1199,powerHp:137,powertrainKind:'combustion' as const,fuel:'petrol',vehicleCategory:'M1' as const};
 return {id:'trax',market,make:'Chevrolet',model:'Trax',year:Number(productionDate.slice(0,4)),productionDate,engineCc:1199,powerHp:137,fuel:'petrol',powertrainKind:'combustion',totalRub:1645868,calculationStatus:'ready',calculationSnapshot:{customsInput:input,customs:customs(input),sourcePriceRub:914909,currencyRate:{effectiveRate:1,sourcePriceRub:914909},missing:[],priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true}};
}
test('Korea list and detail include logistics once and refresh when its amount changes',()=>{
 const offer=fixture('korea',`${new Date().getUTCFullYear()}-01-01`);
 const config={...CATALOG_MARKET_DEFAULTS.korea,logisticsRub:100181};
 const full=repriceOfferWithBusinessConfig(offer,config);
 const list=repriceOfferWithBusinessConfig({...offer,cardProjectionVersion:3,calculationSnapshot:{...compactPricingSnapshot(offer),currencyRate:offer.calculationSnapshot.currencyRate}},config);
 assert.equal(full.calculationSnapshot.customsInput.customsValueRub,1015090);
 assert.equal(full.calculationSnapshot.customs.importDutyRub,487243);
 assert.equal(full.calculationSnapshot.customsValue.transportIncludedInCustomsValue,true);
 assert.equal(full.totalRub,list.totalRub);
 assert.equal(full.totalRub,full.calculationSnapshot.breakdown.reduce((s:number,r:any)=>s+r.amountRub,0));
 assert.equal(full.calculationSnapshot.breakdown.filter((r:any)=>r.id==='logistics').length,1);
 const changed=repriceOfferWithBusinessConfig(full,{...config,logisticsRub:110181});
 assert.equal(changed.calculationSnapshot.customsInput.customsValueRub,1025090);
 assert.equal(changed.totalRub-full.totalRub,14800);
});
test('older Korean cars and other M1 markets retain vehicle-only customs value',()=>{
 for(const market of ['korea','china','uae','europe','georgia']){
 const offer=fixture(market,`${new Date().getUTCFullYear()-(market==='korea'?4:1)}-01-01`);
 const result=repriceOfferWithBusinessConfig(offer,{...(CATALOG_MARKET_DEFAULTS as any)[market],logisticsRub:100181});
 assert.equal(result.calculationSnapshot.customsInput.customsValueRub,914909,market);
 assert.equal(result.calculationSnapshot.customsValue.transportIncludedInCustomsValue,false);
 }
});
