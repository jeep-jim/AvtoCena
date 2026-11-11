import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesBudgetCandidates} from '../apps/web/lib/catalog/ajes-budget-candidates';
import {ajesQuery,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';

const quote=(currency:string,effectiveRate:number)=>({currency,effectiveRate,rateSource:'cbr',rateDate:new Date().toISOString()});
test('Japan/Korea budget narrows only impossible seller prices and keeps all requested conditions',()=>{
 for(const [table,currency,rate] of [['stats','JPY',.51],['korea','KRW',.057]] as const){
  const query:AjesQuery={table,make:'TOYOTA',yearFrom:2022,drive:'fwd',pageSize:24};
  const planned=ajesBudgetCandidates(query,1500000,quote(currency,rate),false);
  assert.equal(planned.sourcePriceTo,Math.ceil(1500001/rate));
  assert.deepEqual({...planned,sourcePriceTo:undefined},{...query,sourcePriceTo:undefined});
  const sql=ajesQuery(planned).sql;assert.match(sql,/finish<=\d+/);assert.match(sql,/marka_name='TOYOTA'/);
  for(let price=1;price<=planned.sourcePriceTo!+3;price+=Math.max(1,Math.floor(planned.sourcePriceTo!/1000))){
   if(Math.round(price*rate)<=1500000)assert.ok(price<=planned.sourcePriceTo!,'a possible affordable seller price must not be excluded');
  }
  assert.equal(query.sourcePriceTo,undefined);
 }
});
test('no narrowing without an applicable fresh official rate or when edited seller prices may qualify',()=>{
 const query:AjesQuery={table:'korea'};const valid=quote('KRW',.057);
 for(const rate of [null,{...valid,rateSource:'cached'}, {...valid,currency:'JPY'}, {...valid,effectiveRate:0},{...valid,effectiveRate:Infinity},{...valid,rateDate:'invalid'},{...valid,rateDate:new Date(Date.now()-5*86400000).toISOString()}])assert.equal(ajesBudgetCandidates(query,1500000,rate,false),query);
 assert.equal(ajesBudgetCandidates(query,1500000,valid,true),query);
 for(const budget of [undefined,-1,NaN,Infinity,1.2])assert.equal(ajesBudgetCandidates(query,budget,valid,false),query);
 for(const query of [{table:'china',sourcePriceTo:30000},{table:'main'},{table:'stats',id:'one'}] as AjesQuery[])assert.equal(ajesBudgetCandidates(query,1500000,quote('JPY',.5),false),query);
});
test('source price predicates remain numeric, bounded and unavailable as raw public query inputs',()=>{
 for(const table of ['stats','korea'] as const)for(const sourcePriceTo of [-1,0,Infinity,1.5,"1 or 1=1"])assert.throws(()=>ajesQuery({table,sourcePriceTo}));
 assert.throws(()=>ajesQuery({table:'stats',budgetTo:1500000}));
});
