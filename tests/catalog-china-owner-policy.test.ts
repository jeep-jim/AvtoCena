import test from 'node:test';
import assert from 'node:assert/strict';
import { chinaInventoryAgeDecision, che168GlobalPriceAdjustment, catalogHardPriceCap } from '../apps/web/lib/catalog/china-owner-policy';
import { sourceInventoryInScope } from '../apps/web/lib/catalog/source-inventory-scope';
import { selectCatalogPublicationMix } from '../apps/web/lib/catalog/china-source-share';
import { catalogPowerBand } from '../apps/web/lib/catalog/power-mix';
import { calculateAvtocenaFromBusinessConfig } from '../packages/engine/src/calculation/calculateAvtocena';

const now = new Date('2026-09-13T12:00:00Z');
const offer = (extra: any = {}) => ({ market: 'china', year: 2024, sourceId: 'autohome_used_china_open', sourceOfferId: '123',
  sourcePrice: 10000, sourceCurrency: 'USD', operational: {sourceUrl: 'https://global.che168.com/zh/detail/123'}, ...extra }) as any;

test('six-year China boundary uses month; production takes precedence over registration', () => {
  for (const [date, allowed] of [['2020-08', false], ['2020-09', true], ['2020-10', true], ['2026-10', false], ['2020-02-31', false]] as const) {
    assert.equal(chinaInventoryAgeDecision(offer({year:2020,operational:{registrationDate:date}}),now).eligible,allowed,date);
  }
  const row = offer({year:2020,operational:{registrationDate:'2021-01',raw:{detail:{infoid:123,manufacturedate:'2020-08'}}}});
  assert.equal(chinaInventoryAgeDecision(row,now).eligible,false);
  assert.equal(chinaInventoryAgeDecision(row,now).basis,'manufacture_month');
  row.operational.raw.detail.manufacturedate='2020-08-01 00:00:00';
  assert.equal(chinaInventoryAgeDecision(row,now).eligible,false,'timestamp must not fall back to newer registration');
  row.operational.raw.detail.manufacturedate='2020-09-01 00:00:00';
  assert.equal(chinaInventoryAgeDecision(row,now).eligible,true);
  assert.equal(chinaInventoryAgeDecision(offer({year:2019,operational:{registrationDate:'2021.09'}}),now).eligible,true,'old trim year does not discard an age-qualified detail candidate');
  assert.equal(chinaInventoryAgeDecision(offer({year:2020}),now).eligible,false);
  assert.equal(chinaInventoryAgeDecision(offer({year:2021}),now).eligible,true);
  assert.equal(chinaInventoryAgeDecision(offer({market:'japan',year:2010}),now).eligible,true);
});

test('Autohome remains new 2026+ and China price cap does not change other markets', () => {
  assert.equal(sourceInventoryInScope(offer({sourceId:'autohome_new_china_open',year:2025})),false);
  assert.equal(sourceInventoryInScope(offer({sourceId:'autohome_new_china_open',year:2026,mileageKm:1})),false);
  assert.equal(sourceInventoryInScope(offer({sourceId:'autohome_new_china_open',year:2026,mileageKm:0})),true);
  assert.equal(catalogHardPriceCap(offer()),16_000_000);
  assert.equal(catalogHardPriceCap(offer({market:'korea'})),15_000_000);
});

test('owner adjustment preserves source and customs values, subtracts two percent of car only, never compounds', () => {
  const source = offer();
  const original = structuredClone(source);
  const adjustment = che168GlobalPriceAdjustment(source, 800000)!;
  assert.equal(adjustment.adjustmentRub,-16000);
  assert.deepEqual(source,original);
  const input:any = {marketId:'china',marketConfig:{id:'test',version:1,securityDepositRub:160000,topAvtoCommissionRub:90000,logisticsRub:100000},sourcePriceRub:800000,customsRub:400000,utilizationFeeRub:5200};
  const baseline=calculateAvtocenaFromBusinessConfig(input);
  const corrected=calculateAvtocenaFromBusinessConfig({...input,sourcePriceAdjustmentRub:adjustment.adjustmentRub,sourcePriceAdjustmentLabel:adjustment.label});
  assert.equal(baseline.totalRub-corrected.totalRub,16000);
  assert.equal(corrected.breakdown.find(line=>line.id==='car')?.amountRub,784000);
  assert.equal(corrected.breakdown.some(line=>line.id==='manual-adjustment'),false);
  assert.deepEqual(corrected.breakdown.filter(l=>l.kind==='customs'),baseline.breakdown.filter(l=>l.kind==='customs'));
  assert.equal(corrected.breakdown.reduce((sum,line)=>sum+line.amountRub,0),corrected.totalRub);
  assert.deepEqual(che168GlobalPriceAdjustment({...source,calculationSnapshot:{sourcePriceAdjustment:adjustment}},800000),adjustment);
  for(const url of ['https://www.che168.com/dealer/1/123.html','https://global.che168.com.evil.test/123'])
    assert.equal(che168GlobalPriceAdjustment(offer({operational:{sourceUrl:url}}),800000),undefined);
  assert.equal(che168GlobalPriceAdjustment(offer({sourceCurrency:'CNY'}),800000),undefined);
  assert.equal(che168GlobalPriceAdjustment(offer({sourceId:'autohome_new_china_open'}),800000),undefined);
});

test('Global Che168 correction does not change percentage expense base', () => {
  const input:any = {marketId:'china',marketConfig:{id:'test',version:1,percentExpenses:[{id:'insurance',title:'Страхование',percent:1}]},sourcePriceRub:800000};
  const baseline=calculateAvtocenaFromBusinessConfig(input);
  const corrected=calculateAvtocenaFromBusinessConfig({...input,sourcePriceAdjustmentRub:-16000});
  assert.equal(baseline.breakdown.find(line=>line.id==='insurance')?.amountRub,8000);
  assert.equal(corrected.breakdown.find(line=>line.id==='insurance')?.amountRub,8000);
  assert.equal(baseline.totalRub-corrected.totalRub,16000);
});

test('China 80/20 includes unknown seller prices while retaining raw input, and composes with Autohome cap', () => {
  const low = Array.from({length:80},(_,i)=>offer({id:'low'+i,powerHp:150}));
  const unknown = Array.from({length:100},(_,i)=>offer({id:'unknown'+i,catalogPricingMode:'seller'}));
  const auto = Array.from({length:100},(_,i)=>offer({id:'auto'+i,sourceId:'autohome_new_china_open',year:2026,powerHp:100}));
  const input=[...low,...unknown,...auto];
  const selected=selectCatalogPublicationMix(input,true);
  assert.equal(input.length,280);
  assert.ok(selected.rows.filter(r=>catalogPowerBand(r)==='low').length / selected.rows.length >= .8);
  assert.ok(selected.rows.filter(r=>r.sourceId==='autohome_new_china_open').length / selected.rows.length <= .1);
  assert.equal((selected.powerMix.report.china as any).sellerUnknownExempt,0);
  assert.equal(selected.rows.length+selected.powerMix.removed.length+selected.sourceShare.removed.length,input.length);
  assert.equal(selectCatalogPublicationMix(unknown,true).rows.length,0);
});
