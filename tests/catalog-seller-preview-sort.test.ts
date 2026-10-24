import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {attachSellerDeliveredPreviews} from '../apps/web/lib/catalog/seller-delivered-preview';
import {sortCatalogRows} from '../apps/web/lib/catalog/market-page';
import {buildBudgetCountIndex,countBudgetIndex} from '../apps/web/lib/catalog/budget-count-index';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';

test('Forester delivered previews reverse seller ordering before pagination without detail or supplier reads',async()=>{
 const storage=getJsonStorage(),original=storage.readJsonWithMeta,reads:string[]=[];
 const today=new Date().toISOString().slice(0,10);
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
  reads.push(key);
  if(key==='fees/exchange-rates.json')return {found:true,value:{rates:[['CNY',12.0557],['EUR',95],['USD',85]].map(([currency,rate])=>({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:today,rateSource:'cbr'}))} as T};
  return {found:false,value:fallback};
 };
 try{
  resetCatalogRateCache();invalidateEffectiveMarketsCache();
  const base:any={market:'china',make:'Subaru',model:'Forester',year:2014,sourceCurrency:'CNY',fuel:'petrol',powertrainKind:'combustion',vehicleCategory:'M1',catalogPricingMode:'seller',totalRub:null,updatedAt:today,cardProjectionVersion:3};
  const input=[{...base,id:'seller-cheap-25',sourcePrice:28800,engineCc:2498,powerHp:171},
   {...base,id:'delivered-cheap-20',sourcePrice:40000,engineCc:1995,powerHp:150},
   {...base,id:'unknown-hybrid',sourcePrice:20000,engineCc:1995,powerHp:145,fuel:'hybrid',powertrainKind:'other_hybrid'}];
  const priced:any[]=await attachSellerDeliveredPreviews(input,{}, {projectionOnly:true});
  assert.ok(priced[0].deliveredCalculationPreview?.totalRub>priced[1].deliveredCalculationPreview?.totalRub);
  assert.ok(priced[1].deliveredCalculationPreview?.totalRub>0);
  assert.equal(priced[2].deliveredCalculationPreview,undefined,'unknown 30-minute power never becomes a quote');
  assert.deepEqual(sortCatalogRows(priced,'totalRub','Новосибирск').map(r=>r.id),['delivered-cheap-20','seller-cheap-25','unknown-hybrid']);
  const index=buildBudgetCountIndex('preview-order',priced);
  assert.equal(index.rows.length,2);assert.ok(index.rows.every(row=>row[4]===false));
  assert.equal(countBudgetIndex(index,{budgetTo:priced[1].deliveredCalculationPreview.totalRub}),1);
  assert.equal(reads.some(key=>/offers|detail|partner-cache|budget-cards/.test(key)),false,'no individual detail scans');
  assert.equal(input[0].totalRub,null,'source facts are unchanged');
 }finally{storage.readJsonWithMeta=original;resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});
