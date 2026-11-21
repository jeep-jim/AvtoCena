import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectKoreaNative} from './korean-native-field-audit.mjs';
const d={inner_id:'12345',year:2022,model_year:2022,year_month:'2021-11',first_registration_date:'2022-01-01',
  advertisement_type:'Продажа',sales_status:'Доступно',is_duplicate:false,engine_type:'Бензин',currency:'KRW',price:9000000,displacement_cc:1598,power:160,power_ice_hp:160};
const wrap=(delta={},ext={})=>({inner_id:d.inner_id,data:{...d,...delta},...ext});
test('split localized flag evidence from model year and preserve separate production/registration dates',()=>{
 const r=inspectKoreaNative([wrap(),wrap({year:2021,model_year:2021}),wrap({advertisement_type:'Sale',sales_status:'Available'}),
  wrap({is_duplicate:undefined}),wrap({sales_status:null}),wrap({model_year:2021}),wrap({}, {sales_status:'Sold'})]);
 assert.equal(r.russian_exact_predicate_pass,1);assert.equal(r.english_predicate_pass,1);
 assert.equal(r.model_year_pre_2022,1);assert.equal(r.model_year_conflict,1);
 assert.equal(r.sales_status_null,1);assert.equal(r.is_duplicate_missing,1);assert.equal(r.outer_nested_contract_conflict,1);
 assert.equal(r.manufacture_month,7);assert.equal(r.manufacture_year_differs_from_model_year,5);assert.equal(r.registration_date_distinct,7);
});
test('native cc/ICE/total/EV kW stay distinct, no rounding litre substitute or 30m claims',()=>{
 const r=inspectKoreaNative([wrap(),wrap({engine_type:'Electric',displacement_cc:0,displacement:2.0,power_ice_hp:null,power_electro_kw:80}),
 wrap({engine_type:'Hybrid',power_electro_kw:35}),wrap({power_ice_hp:155})]);
 assert.equal(r.native_cc,3);assert.equal(r.litres_not_exact_cc,1);assert.equal(r.native_total_hp,4);assert.equal(r.native_ice_hp,3);
 assert.equal(r.native_electric_kw_not_certified30m,2);assert.equal(r.electrified_no_v3_certified30m_authority,2);
 assert.equal(r.combustion_total_ice_conflict,1);assert.equal(r.no_automatic_customs_category_weight_or_route_authority_from_v3,4);
});
test('reject unknown lease/other enum without echoing source strings or amount',()=>{
 const r=inspectKoreaNative([wrap({advertisement_type:'fixture-sensitive',lease:{x:1},currency:'USD'}),wrap({inner_id:'99887'})]);
 assert.equal(r.advertisement_type_other,1);assert.equal(r.observed_non_cash_or_lease_marker,1);
 assert.equal(r.inner_identity_unverified,1);assert.equal(r.price_or_currency_unverified,1);assert.ok(!JSON.stringify(r).includes('fixture-sensitive'));
});

test('observed manufacture vs MY2022 is separate from flag gate and numeric mapping limits',()=>{
  const sample=(month,cc,power)=>({inner_id:'12345',data:{inner_id:'12345',year:2022,model_year:2022,year_month:month,
  advertisement_type:'Продажа',sales_status:'Доступно',is_duplicate:null,displacement_cc:cc,power}});
  const m=inspectKoreaNative([sample('2021-11',998,76), sample('2026-12',150,19)],{},'2026-11-21T07:20:00Z');
  assert.equal(m.production_pre_2022_but_model_2022_plus,1);
  assert.equal(m.native_manufacture_month_future_at_archive_observation,1);
  assert.equal(m.model_year_2022_plus,2);
  assert.equal(m.legacy_russian_flags_before_year_gate,2);
  assert.equal(m.russian_exact_predicate_pass,undefined);
  assert.equal(m.mapper_exact_cc_bounds,1);assert.equal(m.mapper_total_hp_bounds,1);
});
