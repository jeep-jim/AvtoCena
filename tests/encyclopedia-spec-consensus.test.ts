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
