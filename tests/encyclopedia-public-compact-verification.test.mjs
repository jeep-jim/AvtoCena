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

test('distinct generations and certification identities do not create false ambiguity',()=>{
 const other={...representative,id:'different-approval',astraIdentity:{approval:'OTHER'}};
 assert.deepEqual(assertPublicVariant(check,{...record,variants:[representative,other]},{...source,variants:[original,representative,other]}),{grouped:true,privateDescriptions:1});
 assert.throws(()=>assertPublicVariant(check,{...record,variants:[other]},{...source,variants:[original,representative,other]}),/public_mechanical_group_missing_or_ambiguous/);
});
test('documented presentation aliases preserve original reviewed values',()=>{
 const alias={...representative,drive:'Передний'};
 assert.deepEqual(assertPublicVariant(check,{...record,variants:[alias]},{...source,variants:[original,alias]}),{grouped:true,privateDescriptions:1});
 assert.throws(()=>assertPublicVariant(check,{...record,variants:[{...alias,drive:'Полный'}]},{...source,variants:[original,alias]}),/public_mechanical_group_missing_or_ambiguous/);
});
test('a unique fuller representative is accepted only through the actual presentation grouping',()=>{
 const partial={...original,engineCc:1400,fuel:'hybrid',bodyType:'hatchback',status:'observed'};
 const full={...partial,id:'fuller',transmission:'automatic'};
 const c={variantId:partial.id,year:2021,fields:{bodyType:'hatchback',power30MinKw:37}};
 const s={...source,variants:[partial,full]},r={...record,variants:[full]};
 assert.deepEqual(assertPublicVariant(c,r,s),{grouped:true,privateDescriptions:0});
 for(const extra of [{manualEditedAt:'now'},{status:'verified'}])assert.throws(()=>assertPublicVariant(c,r,{...s,variants:[{...partial,...extra},full]}),/public_mechanical_group_missing_or_ambiguous/);
 const alternative={...full,id:'other',transmission:'manual'};
 assert.throws(()=>assertPublicVariant(c,{...r,variants:[full,alternative]},{...s,variants:[partial,full,alternative]}),/public_mechanical_group_missing_or_ambiguous/);
 assert.throws(()=>assertPublicVariant(c,{...r,variants:[{...full,power30MinKw:38}]},s),/public_mechanical_group_missing_or_ambiguous/);
});
