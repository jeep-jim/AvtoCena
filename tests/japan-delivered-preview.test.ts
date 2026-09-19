import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { japanPreviewParameters } from '../apps/web/lib/catalog/japan-preview-parameters';
import { validateCustomerParameters } from '../apps/web/lib/catalog/customer-parameters';
import { calculateOfferWithCustomerParametersDetailed } from '../apps/web/lib/catalog/customs-pricing';
import { LocalJsonStorage } from '../apps/web/lib/data';
import { resetCatalogRateCache } from '../apps/web/lib/catalog/rates';
import { compactJapanPreviewInput, matchesJapanPreviewInput } from '../apps/web/lib/catalog/japan-preview-inputs';
import { visibleBreakdownNote } from '../apps/web/lib/catalog/customs-age-label';
const fixture=()=>JSON.parse(fs.readFileSync('tests/fixtures/proauctions/published-corolla-cross.json','utf8'));

test('preview equals detail estimate, includes customs and leaves auction evidence unchanged',async()=>{
 const input=fixture(),before=JSON.stringify(input),today=new Date().toISOString();
 const markets=JSON.parse(fs.readFileSync('data/markets/markets.json','utf8'));
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:today,JPY:{cbrRate:54.169,nominal:100,rateDate:today,rateSource:'cbr'},EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:'cbr'},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:'cbr'}}:key==='markets/markets.json'?markets:{}}));
 try {
  const preview=await calculateOfferWithCustomerParametersDetailed(input,japanPreviewParameters(input));
  const cached=compactJapanPreviewInput(input);
  assert.ok(cached.parameters);
  const compact=await calculateOfferWithCustomerParametersDetailed(cached.offer as any,cached.parameters!);
  assert.deepEqual(compact,preview,'compact inputs must preserve the entire calculation, including customs and payment plan');
  assert.ok(!('operational' in cached.offer) && !('images' in cached.offer));
  assert.equal(matchesJapanPreviewInput(cached,input),true);
  assert.equal(matchesJapanPreviewInput(cached,{...input,sourcePrice:input.sourcePrice+1}),false);
  assert.equal(matchesJapanPreviewInput(cached,{...input,updatedAt:'changed'}),false);
  const detail=await calculateOfferWithCustomerParametersDetailed(input,validateCustomerParameters({year:2023,fuel:'petrol',engineCc:1800,powerHp:140,powerKw:103}));
  assert.equal(preview.ok,true);assert.equal(detail.ok,true);
  if(preview.ok&&detail.ok){
   assert.equal(preview.calculation.totalRub,detail.calculation.totalRub);
   assert.ok(preview.calculation.totalRub>1666780);
   assert.equal(preview.calculation.breakdown.reduce((sum:number,row:any)=>sum+row.amountRub,0),preview.calculation.totalRub);
   assert.equal(preview.calculation.paymentPlan?.securityDepositRub,31000);
  }
  assert.equal(JSON.stringify(input),before);assert.equal(input.engineCc,undefined);assert.equal(input.totalRub,null);
 } finally {read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
test('missing or conflicting calculation parameters cannot produce preview inputs',()=>{
 for(const mutate of [(r:any)=>{r.operational.semanticEvidence.engineCc.status='conflict'},(r:any)=>{r.powerHp=undefined;r.powerKw=undefined},(r:any)=>{r.fuel='electric';r.powertrainKind='electric';r.power30MinKw=undefined}]){
  const input=fixture();mutate(input);assert.throws(()=>japanPreviewParameters(input));assert.equal(compactJapanPreviewInput(input).parameters,null);
 }
});
test('tariff age notes are readable Russian for both engine formats',()=>{
 assert.equal(visibleBreakdownNote('over_5_years'),'Старше 5 лет');
 assert.equal(visibleBreakdownNote('from 3 to 5 years'),'От 3 до 5 лет');
 assert.equal(visibleBreakdownNote('up_to_3_years'),'До 3 лет');
 assert.equal(visibleBreakdownNote('По документам'),'По документам');
});
