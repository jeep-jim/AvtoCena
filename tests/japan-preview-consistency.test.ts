import test from 'node:test';import assert from 'node:assert/strict';
import {applyJapanFactoryFuel} from '../apps/web/lib/encyclopedia/japan-fuel-reference';
import {compactJapanPowerEstimate,japanPowerEstimateLabel,ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
import {compactJapanPreviewInput} from '../apps/web/lib/catalog/japan-preview-inputs';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {publicOffer} from '../apps/web/lib/catalog/storage';
const raw:any={id:'ajes-stats-example',market:'japan',sourceId:'ajes_japan_feed',make:'RENAULT',model:'TWINGO',year:2017,engineCc:900,images:[],operational:{chassisCode:'AHH4B',semanticEvidence:{engineCc:{status:'exact',value:900,source:'ajes:stats:example:ENG_V',rawValues:['900']}},raw:{sourcePower:'90',sourceFuel:''}}};
test('Every, Alto and Fielder keep known fields without producing incomplete calculation inputs',()=>{
 for(const [make,model,chassis,cc,power] of [['SUZUKI','EVERY','HBD-DA17V',660,'46,49,64'],['SUZUKI','ALTO','3BA-HA37S',660,'46'],['TOYOTA','COROLLA FIELDER','NZE164G',1500,'103']] as const){
  const input={...raw,make,model,engineCc:cc,operational:{chassisCode:chassis,semanticEvidence:{engineCc:{status:'exact',value:cc,source:'ajes:stats:example:ENG_V',rawValues:[String(cc)]}},raw:{sourcePower:power,sourceFuel:''}}};
  const result=applyJapanFactoryFuel(input);
  assert.equal(result.fuel,'petrol');assert.equal(result.powerHp,undefined);
  assert.throws(()=>japanPreviewParameters(result),/powerHp/);
  assert.equal(compactJapanPreviewInput(result).parameters,null);
  const dto=publicOffer(result);
  assert.equal(dto.id,result.id);assert.equal(dto.fuel,'petrol');assert.equal(dto.engineCc,cc);
  assert.equal(dto.powerHp,undefined);assert.equal(result.operational.raw.sourcePower,power);
 }
 for(const [make,model,chassis] of [['SUZUKI','ALTO','HA97S'],['SUZUKI','EVERY','DA64V'],['TOYOTA','COROLLA FIELDER','NKE165G']]){
  const input={...raw,make,model,engineCc:660,operational:{chassisCode:chassis,raw:{sourceFuel:''}}};assert.equal(applyJapanFactoryFuel(input),input);
 }
});
test('factory fuel reaches card DTO while supplier horsepower remains non-authoritative',()=>{
 const offer=applyJapanFactoryFuel(raw);assert.equal(offer.fuel,'petrol');assert.equal(raw.fuel,undefined);assert.equal(offer.powerHp,undefined);
 const dto=publicOffer(offer);assert.equal(japanPowerEstimateLabel(dto),'');assert.equal(ajesPowerEstimateHp(dto as any),undefined);assert.equal((dto as any).operational,undefined);
 assert.equal(dto.fuel,'petrol');assert.equal(dto.engineCc,900);assert.equal(dto.powerHp,undefined);
 assert.throws(()=>japanPreviewParameters(offer),/powerHp/);
 assert.throws(()=>japanPreviewParameters(dto as any),/powerHp/);
 assert.equal(compactJapanPreviewInput(offer).parameters,null);
});
test('manual horsepower completes calculation input without modifying the source card',()=>{
 const offer=applyJapanFactoryFuel(raw),before=JSON.stringify(offer);
 const parameters=validateCustomerParameters({year:offer.year,fuel:offer.fuel,engineCc:offer.engineCc,powerHp:75});
 assert.equal(parameters.powerHp,75);assert.equal(parameters.powerKw,75*0.73549875);
 assert.equal(parameters.engineCc,900);assert.equal(parameters.fuel,'petrol');
 assert.equal(JSON.stringify(offer),before);assert.equal(offer.powerHp,undefined);
 assert.throws(()=>validateCustomerParameters({year:offer.year,fuel:offer.fuel,engineCc:offer.engineCc}),/powerHp/);
});
test('missing power exemption remains limited to the existing N1 calculation contract',()=>{
 const input={year:2023,fuel:'diesel',engineCc:2200,vehicleCategory:'N1',grossVehicleWeightKg:3200};
 const parameters=validateCustomerParameters(input);
 assert.equal(parameters.vehicleCategory,'N1');assert.equal(parameters.powerHp,undefined);assert.equal(parameters.powerKw,undefined);
 assert.throws(()=>validateCustomerParameters({...input,vehicleCategory:'M1'}),/powerHp/);
 for(const powerHp of [0,-1,2501,'invalid'])assert.throws(()=>validateCustomerParameters({...input,powerHp}),/powerHp/);
});
test('diesel and hybrids are not replaced by a blanket petrol default',()=>{
 const diesel=applyJapanFactoryFuel({...raw,make:'CITROEN',model:'BERLINGO',engineCc:1500,operational:{chassisCode:'K9CYH01',raw:{sourceFuel:''}}});assert.equal(diesel.fuel,'diesel');
 for(const patch of [{fuel:'diesel'},{powertrainKind:'other_hybrid'},{model:'UNKNOWN'},{engineCc:2000},{operational:{chassisCode:'AHH4B',raw:{sourceFuel:'H'}}},{operational:{chassisCode:'AHH4B',semanticEvidence:{fuel:{status:'conflict'}}}}]){const r={...raw,...patch};assert.equal(applyJapanFactoryFuel(r),r);}
});
test('ambiguous supplier power cannot become a preview estimate or certified power',()=>{
 const offer={...raw,operational:{...raw.operational,raw:{sourcePower:'54,64'}}};const e=compactJapanPowerEstimate(offer);const dto={id:raw.id,market:'japan',japanPowerEstimate:e};assert.equal(e,undefined);assert.equal(japanPowerEstimateLabel(dto),'');assert.equal(ajesPowerEstimateHp(dto as any),undefined);assert.equal(japanPowerEstimateLabel({...dto,id:'ajes-stats-other'}),'');
 assert.throws(()=>japanPreviewParameters({...offer,fuel:'hybrid',powertrainKind:'other_hybrid'} as any));
});
test('N-BOX and Clipper fuel follows exact chassis, without guessing turbo power',()=>{
 for(const [make,model,chassis] of [['HONDA','N BOX','DBA-JF3'],['HONDA','N-BOX','JF4'],['NISSAN','CLIPPER VAN','HBD-DR17V']]){const v=applyJapanFactoryFuel({...raw,make,model,engineCc:660,operational:{chassisCode:chassis,raw:{sourceFuel:''}}});assert.equal(v.fuel,'petrol');assert.equal(v.powerHp,undefined);}
});

test('reviewed Nissan and Passat fuel uses exact chassis and volume, not family names',()=>{
 for(const [make,model,chassis,engineCc,fuel] of [['NISSAN','TIIDA','DBA-C11',1500,'petrol'],['NISSAN','MARCH','K13',1200,'petrol'],['VOLKSWAGEN','PASSAT','3BA-3CDPC',1500,'petrol'],['VOLKSWAGEN','PASSAT VARIANT','3DA-3CDFH',2000,'diesel']]){
  const input={...raw,make,model,engineCc,operational:{chassisCode:chassis,raw:{sourceFuel:''}}};
  const result=applyJapanFactoryFuel(input);
  assert.equal(result.fuel,fuel);assert.equal(result.powerHp,undefined);assert.equal(result.power30MinKw,undefined);assert.equal(result.engineCc,engineCc);
  assert.equal(applyJapanFactoryFuel({...input,engineCc:3000}).fuel,undefined);
 }
 for(const [model,chassis,engineCc] of [['TIIDA','NC11',1500],['MARCH','NK13',1200],['NOTE','HE12',1200]]){
  const input={...raw,make:'NISSAN',model,engineCc,operational:{chassisCode:chassis,raw:{sourceFuel:''}}};assert.equal(applyJapanFactoryFuel(input),input);
 }
});

test('a retained Alto price cannot supply missing horsepower to a new calculation',()=>{
 const offer:any={...raw,make:'SUZUKI',model:'ALTO',year:2023,engineCc:660,operational:{chassisCode:'3BA-HA37S',semanticEvidence:{engineCc:{status:'exact',value:660,source:'ajes:stats:example:ENG_V',rawValues:['660']}},raw:{sourcePower:'46',sourceFuel:''}}};
 const priced={...applyJapanFactoryFuel(offer),japanDeliveredPreview:{totalRub:509539,estimated:true}};
 assert.throws(()=>japanPreviewParameters(priced),/powerHp/);
 assert.equal(compactJapanPreviewInput(priced).parameters,null);
 assert.equal(japanPowerEstimateLabel(priced),'');
 const dto=publicOffer(priced);
 assert.equal(japanPowerEstimateLabel(dto),japanPowerEstimateLabel(priced));
 assert.equal((dto as any).japanDeliveredPreview.totalRub,509539);
 assert.equal((dto as any).operational,undefined);
 assert.equal((dto as any).powerHp,undefined);
 assert.equal((dto as any).power30MinKw,undefined);
});
test('full offers never invent power from supplier alternatives or a price',()=>{
 const offer={...raw,operational:{raw:{sourcePower:'49,64'}}};
 assert.equal(japanPowerEstimateLabel(offer),'');
 for(const power of ['', 'unknown','0','2501','46<script>']){
  assert.equal(japanPowerEstimateLabel({...raw,japanDeliveredPreview:{totalRub:500000},operational:{raw:{sourcePower:power}}}), '');
 }
 assert.equal(japanPowerEstimateLabel({...offer,sourceId:'other'}),'');
 assert.equal(japanPowerEstimateLabel({...offer,market:'korea'}),'');
});
