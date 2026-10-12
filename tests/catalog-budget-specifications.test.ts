import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {enrichBudgetSpecifications} from '../apps/web/lib/catalog/budget-specification-index';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';

test('backfilled specifications preserve identities, unknowns and exact engine/certified-power matching',async()=>{
 const offers:any[]=[
  {id:'petrol',market:'china',make:'Test',model:'Car',fuel:'petrol',engineCc:1598,powerHp:123,totalRub:2000000},
  {id:'electric',market:'china',make:'Test',model:'EV',fuel:'electric',powertrainKind:'electric',powerHp:300,utilizationPowerKw:80,totalRub:2000000},
  {id:'unknown',market:'china',make:'Test',model:'Unknown',fuel:'electric',powertrainKind:'electric',powerHp:300,totalRub:null},
 ];
 const source=buildBudgetCountIndex('gen_spec',offers,new Map(offers.map(o=>[o.id,0])),3);
 delete source.specificationFilterVersion;
 for(const row of [...source.rows,...source.otherRows!])for(const key of ['engineCc','utilizationPowerKw','powertrainKind'])delete (row[5] as any)[key];
 const before=structuredClone(source);
 const rich=await enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers}));
 assert.deepEqual(source,before,'backfill does not mutate source index');
 assert.deepEqual(rich.rows.map(r=>r[5].id),source.rows.map(r=>r[5].id));
 assert.deepEqual(rich.otherRows!.map(r=>r[5].id),source.otherRows!.map(r=>r[5].id));
 for(const query of [{engineTo:2000},{engineFrom:1800},{powerTo:160},{powerFrom:150}]){
  const original=offers.filter(o=>catalogSearchProjectionMatches(o,query)).map(o=>o.id).sort();
  const compact=[...rich.rows,...rich.otherRows!].filter(r=>catalogSearchProjectionMatches({...r[5],market:r[0]},query)).map(r=>r[5].id).sort();
  assert.deepEqual(compact,original);
 }
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'future',items:offers})),/generation/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:offers.slice(1)})),/incomplete/);
 await assert.rejects(enrichBudgetSpecifications(source,async()=>({generationId:'gen_spec',items:[...offers,offers[0]]})),/identity/);
});
