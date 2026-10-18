import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesCountText,exactAjesCount} from '../apps/web/lib/catalog/ajes-count-display';
import {ajesCatalogQuery,ajesQuery,AjesFilterUnavailable} from '../apps/web/lib/catalog/ajes-query';

test('independent counts retain zero, unavailable and stale semantics',()=>{
 const fresh={total:147867,stale:false,observedAt:'2026-10-18T11:00:00Z',upperBound:false};
 assert.equal(ajesCountText(fresh),'147\u00a0867');assert.equal(exactAjesCount(fresh),147867);
 assert.equal(ajesCountText({...fresh,total:0}),'0');
 assert.equal(ajesCountText(null),'Количество уточняется');
 assert.equal(ajesCountText({...fresh,stale:true}),'147\u00a0867 · по последним данным');
 assert.equal(exactAjesCount({...fresh,stale:true}),undefined);
 assert.equal(ajesCountText({...fresh,upperBound:true}),'до 147\u00a0867');
 assert.equal(exactAjesCount({...fresh,upperBound:true}),undefined);
});
test('stock power selection uses numeric nonempty evidence in lists and aggregates',()=>{
 for(const market of ['china','korea'])for(const aggregate of [undefined,'count','models'] as const){
  const q=ajesCatalogQuery({market,powerFrom:'100',powerTo:'160',pageSize:'48'});
  const sql=ajesQuery({...q,aggregate}).sql;
  assert.match(sql,/pw regexp/);assert.match(sql,/pw\+0>=100/);assert.match(sql,/pw\+0<=160/);
 }
 for(const p of [{powerTo:'-1'},{powerFrom:'200',powerTo:'100'},{powerTo:'Infinity'}])assert.throws(()=>ajesQuery(ajesCatalogQuery({market:'china',...p})));
 assert.throws(()=>ajesCatalogQuery({market:'japan',powerTo:'160'}),AjesFilterUnavailable);
 assert.match(ajesQuery(ajesCatalogQuery({market:'china',sort:'mileage',page:'2',pageSize:'48'})).sql,/order by mileage asc, id asc limit 48,48/);
});

test('delivered budget never accepts seller-only or missing specifications',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({budget:'2000000',bodyType:'suv'});
 const seller={market:'china',bodyType:'suv',catalogPricingMode:'seller',totalRub:1000000};
 assert.equal(filter.matches(seller),false);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),true);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:2100000}}),false);
 assert.equal(filter.matches({...seller,bodyType:'',deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({budget:2000000,city:'Неизвестный город'}).matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({hasPrice:'no'}).matches(seller),true);
 assert.throws(()=>ajesResultFilter({budgetFrom:200,budget:100}));
 assert.throws(()=>ajesResultFilter({budget:'NaN'}));
 assert.doesNotThrow(()=>ajesCatalogQuery({market:'china',budget:2000000,bodyType:'suv'}));
});

test('display family resolves source generation names without losing exact selections',async()=>{
 const {resolveAjesModelNames}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const models=['A5 F5','A5 B10','A50','S5 F5','A3','A3 8Y'].map(model=>({model}));
 assert.equal(resolveAjesModelNames('A5',models),'A5 F5|A5 B10');
 assert.equal(resolveAjesModelNames('A5 F5',models),'A5 F5');
 assert.equal(resolveAjesModelNames('A3',models),'A3');
 assert.equal(resolveAjesModelNames('UNKNOWN',models),'UNKNOWN');
 assert.equal(resolveAjesModelNames('A5|S5 F5',models),'A5 F5|A5 B10|S5 F5');
});
