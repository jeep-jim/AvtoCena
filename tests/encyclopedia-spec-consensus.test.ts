import test from 'node:test';import assert from 'node:assert/strict';
import {applyEncyclopediaCalculation,compileModelFacts,modelKey,checksum} from '../apps/web/lib/encyclopedia/calculation-index';
const row:any={id:'a',year:2025,trim:'Factory long name',status:'verified',sourceUrl:'https://manufacturer.example/spec',fuel:'electric',powertrainKind:'electric',drive:'awd',bodyType:'sedan',powerKw:300,power30MinKw:135};
const offer:any={id:'offer',make:'Test',model:'EV',year:2025,trim:'Local translated name',fuel:'electric',powertrainKind:'electric',drive:'awd',bodyType:'sedan',powerKw:300};
function index(rows:any[]){const models={[modelKey('Test','EV')]:compileModelFacts({id:'m',make:'Test',model:'EV',revision:'r',variants:rows})};return {version:1 as const,createdAt:'now',manifestDigest:'m',digest:checksum(models),models};}
const apply=(o:any,rows:any[])=>applyEncyclopediaCalculation(o,index(rows),{specificationIdentity:true});
test('factory output and known gearbox recover missing volume on the sparse Georgian screenshot card',()=>{
 const fields={fuel:'petrol',powertrainKind:'combustion',engineCc:1999,powerHp:149,icePowerKw:109.59,transmission:'automatic'};
 const d={id:'factory',year:2025,trim:'2.0 automatic',status:'review',...fields,researchEvidence:{batchId:'research-factory',source:{type:'manufacturer',url:'https://manufacturer.example/spec'},checkedIdentity:{make:'Test',model:'EV',year:2025,trim:'2.0 automatic'},fields:Object.keys(fields),values:fields}};
 const o={...offer,fuel:'petrol',powertrainKind:'combustion',powerKw:undefined,powerHp:149,icePowerKw:109.6,transmission:'automatic',bodyType:undefined,drive:undefined};
 assert.equal(apply(o,[d]).engineCc,1999);
 for(const patch of [{transmission:undefined},{transmission:'manual'},{powerHp:150,icePowerKw:110.32},{powerHp:undefined,icePowerKw:undefined},{year:2024}])assert.equal(apply({...o,...patch},[d]).engineCc,undefined);
 assert.equal(apply(o,[{...d,status:'observed',researchEvidence:undefined,markets:['china']}]).engineCc,undefined);
 assert.equal(apply(o,[d,{...d,id:'unknown',engineCc:undefined,researchEvidence:{...d.researchEvidence,fields:['fuel'],values:{fuel:'petrol'}}}]).engineCc,undefined);
 const ambiguous=(value:string,status='ambiguous')=>({...o,sourceId:'autopapa_georgia_open',operational:{semanticEvidence:{engineCc:{status,source:'autopapa_listing_card_engine',rawValues:[value]}}}});
 const resolved=apply(ambiguous('2.0 l'),[d]);assert.equal(resolved.engineCc,1999);
 assert.deepEqual(resolved.operational.semanticEvidence.engineCc.resolvedSourceEvidence.rawValues,['2.0 l']);
 for(const value of ['1.5 l','2-3 l','unknown','2 l'])assert.equal(apply(ambiguous(value),[d]).engineCc,undefined);
 assert.equal(apply(ambiguous('2.0 l','conflict'),[d]).engineCc,undefined);
});
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

test('missing combustion displacement is recovered from annual fuel output and body consensus',()=>{
 const d={...row,fuel:'petrol',powertrainKind:'combustion',engineCc:1999,powerHp:149,powerKw:undefined,icePowerKw:109.59,bodyType:'suv',power30MinKw:undefined};
 const o={...offer,fuel:'petrol',powertrainKind:'combustion',powerKw:undefined,powerHp:149,icePowerKw:109.6,drive:undefined,bodyType:'suv'};
 assert.equal(apply(o,[d]).engineCc,1999);
 assert.equal(apply(o,[d,{...d,id:'other',engineCc:1598}]).engineCc,undefined);
 assert.equal(apply(o,[d,{...d,id:'unknown',engineCc:undefined}]).engineCc,undefined);
 assert.equal(apply({...o,year:2024},[d]).engineCc,undefined);
 assert.equal(apply({...o,powerHp:undefined,icePowerKw:undefined},[d]).engineCc,undefined);
});
test('missing combustion output is recovered from volume and body but not layout alone',()=>{
 const d={...row,fuel:'diesel',powertrainKind:'combustion',engineCc:2151,powerHp:202,powerKw:undefined,bodyType:'minivan',power30MinKw:80};
 const o={...offer,fuel:'diesel',powertrainKind:'combustion',engineCc:2151,powerKw:undefined,drive:undefined,bodyType:'minivan'};
 assert.equal(apply(o,[d]).powerHp,202);
 assert.equal(apply(o,[d]).power30MinKw,undefined);
 assert.equal(apply(o,[d,{...d,id:'other',powerHp:200}]).powerHp,undefined);
 assert.equal(apply(o,[d,{...d,id:'unknown',powerHp:undefined}]).powerHp,undefined);
 assert.equal(apply({...o,engineCc:undefined},[d]).powerHp,undefined);
 const manual={...o,powerDataSource:'customer_input'};assert.equal(apply(manual,[d]),manual);
});
