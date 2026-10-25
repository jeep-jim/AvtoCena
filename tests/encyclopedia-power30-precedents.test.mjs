import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectPower30Precedent as select,precedentModelKeys} from '../scripts/encyclopedia/power30-precedents.mjs';
const offer={fuel:'electric',powerKw:150,drive:'rwd',year:2024};
const fact=(value=70,extra={})=>({modelId:'m',variantId:'v',revision:'r',year:0,constraints:{fuel:'electric',powerKw:150,drive:'rwd',...extra},values:{power30MinKw:value},sources:{power30MinKw:{kind:'official_registry',url:'https://opendata.astra.admin.ch/ivzod/test'}}});
test('closest documented value stays an estimate without mutating the target',()=>{const input=structuredClone(offer),r=select(input,[fact(70),fact(80,{powerKw:165})]);assert.equal(r.estimatedPower30MinKw,70);assert.equal(r.certified,false);assert.equal(r.requiresConfirmation,true);assert.equal(r.power30MinKw,undefined);assert.deepEqual(input,offer);});
test('equally close differing values produce a range, never an arbitrary winner',()=>{const r=select(offer,[fact(70),{...fact(90),variantId:'v2'}]);assert.equal(r.estimatedPower30MinKw,undefined);assert.deepEqual(r.rangeKw,[70,90]);assert.equal(r.references.length,2);});
test('manual and existing values are preserved',()=>{assert.equal(select({...offer,power30MinKw:40},[fact()]).status,'existing_value_preserved');assert.equal(select({...offer,manualEditedAt:'today'},[fact()]).status,'manual_parameters_preserved');});
test('known fuel, drive, engine, generation and chassis conflicts are excluded',()=>{for(const extra of [{fuel:'hybrid'},{drive:'awd'},{powerKw:250}])assert.equal(select(offer,[fact(70,extra)]).status,'no_compatible_documented_precedent');for(const k of ['engineCode','chassisCode','generation'])assert.equal(select({...offer,[k]:'AAA'},[fact(70,{[k]:'BBB'})]).status,'no_compatible_documented_precedent');});
test('undocumented or peak-only candidates never become 30 minute references',()=>{for(const f of [{...fact(),sources:{}},{...fact(),values:{powerKw:70}},{...fact(),sources:{power30MinKw:{kind:'owner_reference',url:'https://example.com'}}}])assert.equal(select(offer,[f]).status,'no_compatible_documented_precedent');});
test('unknown trim produces explicit model-only range',()=>{const r=select({fuel:'electric'},[fact(70),fact(90,{powerKw:200})]);assert.equal(r.method,'same_model_only');assert.deepEqual(r.rangeKw,[70,90]);});
test('hybrid peak field is not compared to motor or ICE output',()=>{const r=select({fuel:'hybrid',powerHp:500,engineCc:1998},[fact(50,{fuel:'hybrid',engineCc:1998,powerKw:100})]);assert.equal(r.estimatedPower30MinKw,50);assert.ok(!r.references[0].matches.includes('powerKw'));});
test('annual precedent more than three years away is excluded',()=>{assert.equal(select(offer,[{...fact(),year:2018}]).status,'no_compatible_documented_precedent');});

test("regional name expansion preserves Dolphin/Seagull distinction",()=>{assert.deepEqual(precedentModelKeys("byd:dolphin").keys,["byd:dolphin"]);assert.ok(precedentModelKeys("byd:seagull").keys.includes("byd:dolphinsurf"));assert.ok(precedentModelKeys("nio:es6").regionalNameEvidence.url.startsWith("https://us.nio.com/"));assert.deepEqual(precedentModelKeys("nio:es7").keys,["nio:es7"]);});

test('a traceable owner confirmed precedent retains its manual provenance',()=>{const f=fact(30);f.sources.power30MinKw={kind:'manual',url:'https://avtocena.com/cars/autocatalog',batchId:'owner-confirmed-test'};const r=select(offer,[f]);assert.equal(r.certified,false);assert.equal(r.references[0].source.kind,'manual');assert.equal(r.estimatedPower30MinKw,30);});

import {selectWithReportedPrecedents} from '../scripts/encyclopedia/power30-precedents.mjs';
test('reported tests fill gaps, preserve provenance, and cannot displace documented ambiguity',()=>{
 const report=fact(80);report.sources.power30MinKw.kind='reported_precedent';
 const r=selectWithReportedPrecedents(offer,[],[report]);
 assert.equal(r.estimatedPower30MinKw,80);assert.equal(r.originalCertificateReviewed,false);assert.equal(r.certified,false);
 assert.deepEqual(selectWithReportedPrecedents(offer,[fact(70),fact(90)],[report]).rangeKw,[70,90]);
 assert.equal(selectWithReportedPrecedents({...offer,drive:'awd'},[],[report]).status,'no_compatible_documented_precedent');
 assert.equal(selectWithReportedPrecedents({...offer,power30MinKw:20},[],[report]).status,'existing_value_preserved');
});
