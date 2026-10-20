import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePower30,power30OfferId,emptyPower30Inputs} from '../apps/web/lib/power30/calculator';
import {power30FromOffer} from '../apps/web/lib/power30/offer';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';
const offer=(patch:Partial<VehicleOffer>={})=>({id:'abc',sourceId:'test',sourceOfferId:'123',make:'Example',model:'EV',year:2024,market:'china',fuel:'electric',powertrainKind:'electric',powerKw:150,powerDataConfidence:'source_exact',operational:{},...patch}) as VehicleOffer;
test('owned listing URLs: readable, legacy and auction IDs; reject SSRF and traversal',()=>{
 for(const [url,id] of [['https://avtocena.com/cars/offer/abc','abc'],['https://www.avtocena.com/cars/offer/model-2024--ajes-stats-123?x=1','ajes-stats-123']])assert.equal(power30OfferId(url),id);
 for(const url of ['https://avtocena.com.evil.test/cars/offer/a','https://avtocena.com@evil.test/cars/offer/a','https://avtocena.com:444/cars/offer/a','file:///cars/offer/a','https://avtocena.com/cars','https://avtocena.com/cars/offer/%2e%2e%2fsecret','https://avtocena.com/cars/offer/%00','https://avtocena.com/cars/offer/a/more',null])assert.throws(()=>power30OfferId(url));
});
test('original heuristic coefficients and optional corrections remain explicit',()=>{
 for(const [kind,peak,kw] of [['BEV','100',75],['PHEV','100',65],['HEV','100',50],['MHEV','5',1],['MHEV','10',4]] as const)assert.equal(estimatePower30({...emptyPower30Inputs,kind,peak}).kw,kw);
 assert.equal(estimatePower30({...emptyPower30Inputs,kind:'BEV',peak:'100',voltage:'400'}).kw,80);
 assert.equal(estimatePower30({...emptyPower30Inputs,kind:'BEV',peak:'100',torque:'1',rpm:'1'}).ratio,.75*.85);
 for(const patch of [{peak:'NaN'},{peak:'-1'},{peak:'2001'},{voltage:'Infinity'},{torque:'-2'},{kind:'ICE'},{kind:'unknown'}])assert.throws(()=>estimatePower30({...emptyPower30Inputs,kind:'BEV',peak:'100',...patch} as any));
});
test('BEV loads peak but not imaginary 30-minute power',()=>{
 const result=power30FromOffer(offer());assert.equal(result.inputs.peak,'150');assert.equal(result.certified,undefined);
 assert.equal(power30FromOffer(offer({powerDataConfidence:'estimated',powerDataSource:'fallback_100'})).inputs.peak,'');
});
test('hybrid combined/ICE peak never fills electric peak; generic hybrid type stays unresolved',()=>{
 const result=power30FromOffer(offer({fuel:'hybrid',powertrainKind:'other_hybrid',icePowerKw:100,powerKw:200}));assert.equal(result.inputs.peak,'');assert.equal(result.inputs.kind,'unknown');
 assert.equal(power30FromOffer(offer({fuel:'petrol',powertrainKind:'combustion'})).inputs.kind,'ICE');
});
test('explicit electric technical rows bind to listing and reject alternatives',()=>{
 const snapshot:any={sourceId:'test',sourceOfferId:'123',groups:[{name:'电动机',items:[{name:'电动机总功率(kW)',value:'120'},{name:'最大功率(kW)',value:'200'}]}]};
 const hybrid=offer({fuel:'phev',powertrainKind:'other_hybrid',operational:{sourceSpecifications:snapshot}});
 assert.equal(power30FromOffer(hybrid).inputs.peak,'120');
 snapshot.sourceOfferId='different';assert.equal(power30FromOffer(hybrid).inputs.peak,'');
 snapshot.sourceOfferId='123';snapshot.groups[0].items.push({name:'电动机总功率(kW)',value:'180'});assert.equal(power30FromOffer(hybrid).inputs.peak,'');
});
test('documented value separate; conflicting total, estimates and UAE not promoted',()=>{
 assert.equal(power30FromOffer(offer({power30MinKw:60,powerDataConfidence:'documented',powerDataSource:'COC:123'})).certified?.kw,60);
 assert.equal(power30FromOffer(offer({power30MinKw:60,power30MinKwByMotor:[40,40]})).certified,undefined);
 assert.equal(power30FromOffer(offer({power30MinKw:60,powerDataConfidence:'estimated',powerDataSource:'estimate'})).certified,undefined);
 const uae=power30FromOffer(offer({market:'uae',power30MinKw:60}));assert.equal(uae.inputs.peak,'');assert.equal(uae.certified,undefined);
});

test('hybrid subtype resolves only from explicit listing-bound energy type',()=>{
 const snapshot:any={sourceId:'test',sourceOfferId:'123',groups:[{name:'基本参数',items:[{name:'能源类型',value:'油电混合'}]}]};
 const hybrid=offer({fuel:'hybrid',powertrainKind:'other_hybrid',operational:{sourceSpecifications:snapshot}});
 assert.equal(power30FromOffer(hybrid).inputs.kind,'HEV');
 snapshot.groups[0].items.push({name:'能源类型',value:'插电式混合动力'});assert.equal(power30FromOffer(hybrid).inputs.kind,'unknown');
});
