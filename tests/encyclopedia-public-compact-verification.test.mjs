import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPublicVariant} from '../scripts/encyclopedia/public-variant-verification.mjs';
const original={id:'original',year:2021,trim:'Launch',power30MinKw:37,icePowerKw:68,drive:'fwd',chassisCode:'MXPH11'};
const representative={...original,id:'representative',trim:'Dynamic'};
const source={id:'model',revision:'r1',variants:[original,representative]};
const record={id:'model',revision:'r1',variants:[representative]};
const check={variantId:'original',year:2021,fields:{power30MinKw:37,icePowerKw:68,drive:'fwd',trim:'Launch'}};
test('a collapsed trim retains exact verified mechanics and original equipment evidence',()=>{
 assert.deepEqual(assertPublicVariant(check,record,source),{grouped:true,privateDescriptions:1});
 assert.throws(()=>assertPublicVariant(check,record),/public_variant_missing/);
});
test('different power, drive, chassis or missing mechanical values cannot stand in for a hidden trim',()=>{
 for(const change of [{power30MinKw:38},{drive:'awd'},{chassisCode:'MXPH15'},{icePowerKw:undefined}])
  assert.throws(()=>assertPublicVariant(check,{...record,variants:[{...representative,...change}]},source),/public_mechanical_group_missing_or_ambiguous/);
});
test('mapping requires the original verified value, same revision and a known unique representative',()=>{
 assert.throws(()=>assertPublicVariant(check,record,{...source,revision:'r2'}),/public_source_revision_mismatch/);
 assert.throws(()=>assertPublicVariant(check,record,{...source,variants:[{...original,power30MinKw:99},representative]}),/verified_source_field_mismatch/);
 assert.throws(()=>assertPublicVariant(check,{...record,variants:[{...representative,id:'invented'}]},source),/public_group_identity_unverified/);
 assert.throws(()=>assertPublicVariant(check,{...record,variants:[representative,representative]},source),/public_mechanical_group_missing_or_ambiguous/);
 assert.throws(()=>assertPublicVariant(check,record,{...source,variants:[representative]}),/verified_source_variant_missing/);
});
test('an exact public variant still checks every supplied field',()=>{
 assert.deepEqual(assertPublicVariant(check,{...record,variants:[original]}),{grouped:false,privateDescriptions:0});
 assert.throws(()=>assertPublicVariant(check,{...record,variants:[{...original,power30MinKw:99}]}),/public_field_mismatch/);
});
