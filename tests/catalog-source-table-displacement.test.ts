import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichOfferWithSourceTableDisplacement as enrich} from '../apps/web/lib/catalog/source-table-displacement';
import {translateSpecificationText as translate} from '../apps/web/lib/catalog/specification-display';
const fixture=():any=>({sourceId:'che168',sourceOfferId:'123',fuel:'diesel',trim:'2.5T',operational:{sourceSpecifications:{sourceId:'che168',sourceOfferId:'123',specificationId:'456',groups:[{name:'发动机',items:[{name:'(mL)',value:'2499'},{name:'(L)',value:'2.5'}]}]}}});
test('listing-bound engine table recovers 2499 cc, not rounded trim displacement',()=>{const before=fixture(),after=enrich(before);assert.equal(after.engineCc,2499);assert.equal(before.engineCc,undefined);assert.equal(after.operational.semanticEvidence.engineCc.status,'exact');});
test('mismatched table, conflicting values, and unrelated millilitre rows cannot populate cc',()=>{const other=fixture();other.operational.sourceSpecifications.sourceOfferId='other';assert.equal(enrich(other).engineCc,undefined);const conflict=fixture();conflict.operational.sourceSpecifications.groups[0].items.push({name:'排量(mL)',value:'1998'});assert.equal(enrich(conflict).engineCc,undefined);const fluid=fixture();fluid.operational.sourceSpecifications.groups[0].name='油箱';assert.equal(enrich(fluid).engineCc,undefined);});
test('marketing litres, electric cars, existing displacement and source conflicts are preserved',()=>{const marketing=fixture();marketing.operational.sourceSpecifications.groups[0].items=[{name:'(L)',value:'2.5'}];assert.equal(enrich(marketing).engineCc,undefined);assert.equal(enrich({...fixture(),fuel:'electric'}).engineCc,undefined);assert.equal(enrich({...fixture(),engineCc:2498}).engineCc,2498);const conflict=fixture();conflict.operational.semanticEvidence={engineCc:{status:'conflict'}};assert.equal(enrich(conflict).engineCc,undefined);});
test('Chinese trim and Korean technical terms translate without dropping values',()=>{assert.equal(translate('两驱 大迈版 长轴'),'Привод на одну ось Комплектация Damai Длинная колёсная база');assert.equal(translate('6挡手动'),'6-ступенчатая МКПП');assert.equal(translate('배기량'),'Рабочий объём');assert.equal(translate('디젤'),'Дизель');assert.match(translate('2.5T 143马力 L4'),/143 л.с./);});

import {enrichOfferWithSourceTableParameters as parameters} from '../apps/web/lib/catalog/source-table-displacement';
test('pickup total mass prefills editable N1 scenario, with existing category preserved',()=>{
 const o=fixture();o.bodyType='Пикап';o.operational.sourceSpecifications.groups.push({name:'基本参数',items:[{name:'最大允许总质量(kg)',value:'3250'}]});
 assert.equal(parameters(o).vehicleCategory,'N1');assert.equal(parameters(o).grossVehicleWeightKg,3250);
 assert.equal(parameters({...o,vehicleCategory:'M1'}).vehicleCategory,'M1');
 assert.equal(parameters({...o,grossVehicleWeightKg:3501}).vehicleCategory,undefined);
 assert.equal(parameters({...o,bodyType:'SUV'}).vehicleCategory,undefined);
 assert.equal(parameters({...o,tnVedCode:'8703'}).vehicleCategory,undefined);
});
test('curb mass, payload, missing mass and mismatched or conflicting totals never infer N1',()=>{
 const o=fixture();o.bodyType='Пикап';o.operational.sourceSpecifications.groups.push({name:'车身',items:[{name:'整备质量(kg)',value:'1800'},{name:'最大载重质量(kg)',value:'485'}]});
 assert.equal(parameters(o).vehicleCategory,undefined);
 const items=o.operational.sourceSpecifications.groups[1].items;items.push({name:'总质量(kg)',value:'3000'},{name:'gross vehicle weight (kg)',value:'3200'});
 assert.equal(parameters(o).vehicleCategory,undefined);
 items.pop();o.operational.sourceSpecifications.sourceOfferId='other';
 assert.equal(parameters(o).vehicleCategory,undefined);
});
