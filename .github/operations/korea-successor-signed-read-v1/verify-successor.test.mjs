import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleCounts,verify} from './verify-successor.mjs';
const d={inner_id:'12345',year:2022,model_year:2022,engine_type:'Gasoline',displacement_cc:1599,power:160,power_ice_hp:150,power_electro_kw:40,
 is_duplicate:false,sales_status:'Available',advertisement_type:'Sale',year_month:'2021-11',photos:['not exported']};
test('report wrapped full-field counts, not raw rows or ids; reject identity mismatch/missing sale evidence',()=>{
 const r=sampleCounts([{inner_id:'12345',data:d},{inner_id:'12346',data:d},
  {inner_id:'12345',data:{...d,is_duplicate:undefined}},{inner_id:'12345',data:{...d,year:2021}}]);
 assert.equal(r.sampleRows,4);assert.equal(r.wrappedAligned,3);assert.equal(r.nestedIdentityConflict,1);
 assert.equal(r.strictEligibleSample,1);assert.equal(r.yearOrSaleConflict,1);assert.equal(r.unconfirmedSaleOrYear,1);
 assert.equal(r.totalHp,3);assert.equal(r.cc,3);assert.equal(r.photos,3);
 assert.ok(!JSON.stringify(r).includes('12345')&&!JSON.stringify(r).includes('not exported'));
});
test('orphan stops before fetching protected bodies and emits no success',async()=>{
 await assert.rejects(verify({head:()=>true,read:()=>assert.fail('protected reads forbidden')}),/encar_latest_orphan/);
});
test('wire mutation and missing body fail closed',async()=>{
 await assert.rejects(verify({head:()=>false,read:()=>Buffer.from(' { } ')}),/encar_sample_exact_wire/);
 await assert.rejects(verify({head:()=>false,read:()=>Buffer.alloc(0)}),/encar_sample_byte_bound/);
});
