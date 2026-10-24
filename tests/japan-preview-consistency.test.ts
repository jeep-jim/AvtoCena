import test from 'node:test';import assert from 'node:assert/strict';
import {applyJapanFactoryFuel} from '../apps/web/lib/encyclopedia/japan-fuel-reference';
import {compactJapanPowerEstimate,japanPowerEstimateLabel,ajesPowerEstimateHp} from '../apps/web/lib/catalog/ajes-power-estimate';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
import {publicOffer} from '../apps/web/lib/catalog/storage';
const raw:any={id:'ajes-stats-example',market:'japan',sourceId:'ajes_japan_feed',make:'RENAULT',model:'TWINGO',year:2017,engineCc:900,images:[],operational:{chassisCode:'AHH4B',semanticEvidence:{engineCc:{status:'exact',value:900,source:'ajes:stats:example:ENG_V',rawValues:['900']}},raw:{sourcePower:'90',sourceFuel:''}}};
test('same factory fuel and reported power reach card DTO and editable preview without becoming exact hp',()=>{
 const offer=applyJapanFactoryFuel(raw);assert.equal(offer.fuel,'petrol');assert.equal(raw.fuel,undefined);assert.equal(offer.powerHp,undefined);
 const dto=publicOffer(offer);assert.equal(japanPowerEstimateLabel(dto),'90 л.с. · предварительно');assert.equal(ajesPowerEstimateHp(dto as any),90);assert.equal((dto as any).operational,undefined);
 assert.equal(japanPreviewParameters(offer).fuel,'petrol');assert.equal(japanPreviewParameters(offer).powerHp,90);
 assert.equal((dto as any).powerHp,undefined);assert.equal(japanPreviewParameters(dto as any).powerHp,90);
});
test('diesel and hybrids are not replaced by a blanket petrol default',()=>{
 const diesel=applyJapanFactoryFuel({...raw,make:'CITROEN',model:'BERLINGO',engineCc:1500,operational:{chassisCode:'K9CYH01',raw:{sourceFuel:''}}});assert.equal(diesel.fuel,'diesel');
 for(const patch of [{fuel:'diesel'},{powertrainKind:'other_hybrid'},{model:'UNKNOWN'},{engineCc:2000},{operational:{chassisCode:'AHH4B',raw:{sourceFuel:'H'}}},{operational:{chassisCode:'AHH4B',semanticEvidence:{fuel:{status:'conflict'}}}}]){const r={...raw,...patch};assert.equal(applyJapanFactoryFuel(r),r);}
});
test('ambiguous reported power stays labelled, bound to offer, and separate from certified power',()=>{
 const offer={...raw,operational:{...raw.operational,raw:{sourcePower:'54,64'}}};const e=compactJapanPowerEstimate(offer);const dto={id:raw.id,market:'japan',japanPowerEstimate:e};assert.equal(japanPowerEstimateLabel(dto),'54 / 64 л.с. · уточнить');assert.equal(ajesPowerEstimateHp(dto as any),54);assert.equal(japanPowerEstimateLabel({...dto,id:'ajes-stats-other'}),'');
 assert.throws(()=>japanPreviewParameters({...offer,fuel:'hybrid',powertrainKind:'other_hybrid'} as any));
});
test('N-BOX and Clipper fuel follows exact chassis, without guessing turbo power',()=>{
 for(const [make,model,chassis] of [['HONDA','N BOX','DBA-JF3'],['HONDA','N-BOX','JF4'],['NISSAN','CLIPPER VAN','HBD-DR17V']]){const v=applyJapanFactoryFuel({...raw,make,model,engineCc:660,operational:{chassisCode:chassis,raw:{sourceFuel:''}}});assert.equal(v.fuel,'petrol');assert.equal(v.powerHp,undefined);}
});
