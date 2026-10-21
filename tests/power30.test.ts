import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePower30,power30OfferId,emptyPower30Inputs,emptyThermalInputs} from '../apps/web/lib/power30/calculator';
import {power30FromOffer} from '../apps/web/lib/power30/offer';
import type {VehicleOffer} from '../apps/web/lib/catalog/types';
const offer=(patch:Partial<VehicleOffer>={})=>({id:'abc',sourceId:'test',sourceOfferId:'123',make:'Example',model:'EV',year:2024,market:'china',fuel:'electric',powertrainKind:'electric',powerKw:150,powerDataConfidence:'source_exact',operational:{},...patch}) as VehicleOffer;
test('owned listing URLs: readable, legacy and auction IDs; reject SSRF and traversal',()=>{
 for(const [url,id] of [['https://avtocena.com/cars/offer/abc','abc'],['https://www.avtocena.com/cars/offer/model-2024--ajes-stats-123?x=1','ajes-stats-123']])assert.equal(power30OfferId(url),id);
 for(const url of ['https://avtocena.com.evil.test/cars/offer/a','https://avtocena.com@evil.test/cars/offer/a','https://avtocena.com:444/cars/offer/a','file:///cars/offer/a','https://avtocena.com/cars','https://avtocena.com/cars/offer/%2e%2e%2fsecret','https://avtocena.com/cars/offer/%00','https://avtocena.com/cars/offer/a/more',null])assert.throws(()=>power30OfferId(url));
});
const physics={efficiency:'90',current:'300',resistance:'0.02',capacity:'20',coolant:'40',initial:'40',limit:'120',controller:'120',usableEnergy:''};
const input={...emptyPower30Inputs,kind:'BEV' as const,peak:'120',voltage:'400'};
test('thermal scenario matches independently integrated heat balance at 30 minutes',()=>{
 const result=estimatePower30(input,physics);assert.equal(result.limiting,'Нагрев за 30 минут');
 let temperature=40;const dt=.01;
 for(let time=0;time<1800;time+=dt)temperature+=(result.kw*1000*(1/.9-1)-(temperature-40)/.02)/20000*dt;
 assert.ok(Math.abs(temperature-120)<.01);assert.ok(Math.abs(result.endTemperature-120)<1e-9);
 assert.ok(estimatePower30(input,{...physics,initial:'80'}).kw<result.kw,'hot start reduces margin');
 assert.ok(estimatePower30(input,{...physics,resistance:'0.01'}).kw>result.kw,'better heat transfer raises sustainable output');
 assert.ok(estimatePower30(input,{...physics,capacity:'100'}).kw>result.kw,'thermal mass raises transient margin');
});
test('electrical/controller/peak caps and battery duration stay separate',()=>{
 const electrical=estimatePower30(input,{...physics,current:'10'});assert.equal(electrical.kw,3.6);
 const controller=estimatePower30(input,{...physics,controller:'5'});assert.equal(controller.kw,5);
 const peak=estimatePower30({...input,peak:'4'},physics);assert.equal(peak.kw,4);
 const energy=estimatePower30(input,{...physics,usableEnergy:'1'});assert.ok(energy.kw>1.8);assert.equal(energy.vehicleKw,1.8);
 const a=estimatePower30(input,physics),b=estimatePower30({...input,torque:'900',rpm:'20000'},physics);assert.equal(a.kw,b.kw,'unpaired maxima never change output');
 assert.equal(estimatePower30({...input,kind:'HEV'},{...physics,usableEnergy:'1'}).energyKw,undefined);
});
test('missing or invalid physical inputs never fabricate a point estimate',()=>{
 assert.throws(()=>estimatePower30(input,emptyThermalInputs),/не хватает/);
 for(const patch of [{efficiency:'100'},{resistance:'0'},{capacity:'NaN'},{initial:'120'},{initial:'30'},{limit:'39'},{current:'-1'}])assert.throws(()=>estimatePower30(input,{...physics,...patch}));
 assert.throws(()=>estimatePower30({...input,kind:'ICE'},physics));
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

test('owner 54 kW is scoped to the exact Q05 listing and never certified',()=>{
 const q=offer({id:'d9781a818d5cc8520fea2bfd',make:'Changan',model:'Q05',year:2026,powerKw:120});
 const result=power30FromOffer(q);assert.equal(result.reported?.kw,54);assert.equal(result.certified,undefined);
 for(const patch of [{id:'another-q05'},{powerKw:158},{year:2025},{powertrainKind:'other_hybrid',fuel:'hybrid'},{market:'uae'}])assert.equal(power30FromOffer({...q,...patch} as VehicleOffer).reported,undefined);
});
