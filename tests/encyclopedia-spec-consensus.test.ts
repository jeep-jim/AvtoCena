import test from 'node:test';import assert from 'node:assert/strict';
import {applyEncyclopediaCalculation,compileModelFacts,modelKey,checksum} from '../apps/web/lib/encyclopedia/calculation-index';
const row:any={id:'a',year:2025,trim:'Factory long name',status:'verified',sourceUrl:'https://manufacturer.example/spec',fuel:'electric',powertrainKind:'electric',drive:'awd',bodyType:'sedan',powerKw:300,power30MinKw:135};
const offer:any={id:'offer',make:'Test',model:'EV',year:2025,trim:'Local translated name',fuel:'electric',powertrainKind:'electric',drive:'awd',bodyType:'sedan',powerKw:300};
function index(rows:any[]){const models={[modelKey('Test','EV')]:compileModelFacts({id:'m',make:'Test',model:'EV',revision:'r',variants:rows})};return {version:1 as const,createdAt:'now',manifestDigest:'m',digest:checksum(models),models};}
const apply=(o:any,rows:any[])=>applyEncyclopediaCalculation(o,index(rows),{specificationIdentity:true});
test('complete annual mechanical identity can bridge different trim wording',()=>{assert.equal(apply(offer,[row]).power30MinKw,135);assert.equal(applyEncyclopediaCalculation(offer,index([row])).power30MinKw,135);assert.equal(applyEncyclopediaCalculation(offer,index([row]),{technicalIdentity:true,specificationIdentity:false}),offer);});
test('wrong year and partial mechanical anchors do not transfer',()=>{for(const patch of [{year:2024},{drive:undefined},{bodyType:undefined},{powerKw:undefined},{fuel:'hybrid'},{powerDataSource:'customer_input'}]){const o={...offer,...patch};assert.equal(apply(o,[row]),o);}});
test('conflicting or incomplete compatible versions block thirty minute transfer',()=>{for(const power30MinKw of [140,undefined])assert.equal(apply(offer,[row,{...row,id:'b',power30MinKw}]).power30MinKw,undefined);});
test('existing exact named conflict cannot fall through',()=>{const o={...offer,trim:row.trim,powerKw:250};assert.equal(apply(o,[row]),o);});

test('generic equal trim wording still needs mechanical anchors and unanimity',()=>{const o={...offer,trim:'Comfort'},r={...row,trim:'Comfort'};assert.equal(apply(o,[r]).power30MinKw,135);assert.equal(apply({...o,powerKw:undefined},[r]).power30MinKw,undefined);assert.equal(apply(o,[r,{...r,id:'other',power30MinKw:140}]).power30MinKw,undefined);});

test('missing redundant powertrain kind no longer blocks complete mechanical evidence',()=>{
 const o={...offer,powertrainKind:undefined};const result=apply(o,[row]);
 assert.equal(result.powertrainKind,'electric');assert.equal(result.power30MinKw,135);
 assert.equal(apply(o,[row,{...row,id:'b',power30MinKw:undefined}]).power30MinKw,undefined);
});
test('undocumented donor code permits ordinary shared fields but not certified power',()=>{
 const o={...offer,chassisCode:'SOURCE-CODE',transmission:undefined};
 const result=apply(o,[{...row,transmission:'automatic'}]);
 assert.equal(result.transmission,'automatic');assert.equal(result.power30MinKw,undefined);
 assert.equal(apply(o,[{...row,chassisCode:'CONTRADICTING',transmission:'automatic'}]),o);
});
test('hybrid ICE power compares with ICE and never substitutes system power',()=>{
 const o={...offer,fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1498,powerKw:undefined,icePowerKw:110};
 const d={...row,fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1498,powerKw:undefined,icePowerKw:110};
 assert.equal(apply(o,[d]).power30MinKw,135);
 assert.equal(apply(o,[{...d,icePowerKw:undefined,powerKw:110}]).power30MinKw,undefined);
});

test('missing powertrain does not select between compatible combustion and hybrid candidates',()=>{
 const o={...offer,fuel:'petrol',powertrainKind:undefined,engineCc:1498};
 const d={...row,fuel:'petrol',engineCc:1498,powertrainKind:'combustion',power30MinKw:undefined};
 const result=apply(o,[d,{...d,id:'hybrid',powertrainKind:'other_hybrid',power30MinKw:40}]);
 assert.equal(result.powertrainKind,undefined);assert.equal(result.power30MinKw,undefined);
});
