import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCatalogPowerMix,catalogPowerBand} from '../apps/web/lib/catalog/power-mix';
test('unlimited publication keeps high power with no low-power supply',()=>{
 for(const market of ['china','korea','uae','europe','georgia','japan']){
 const rows=[{market,id:'high',powerHp:600},{market,id:'unknown'},{market,id:'low',powerHp:100}];
 const copy=structuredClone(rows),result=selectCatalogPowerMix(rows as any,{retainedIds:new Set(['low']),minimumCountByMarket:{[market]:1}});
 assert.deepEqual(result.rows,copy);assert.deepEqual(result.removed,[]);assert.deepEqual(rows,copy);
 assert.deepEqual(selectCatalogPowerMix(result.rows).rows,copy);
 assert.equal(selectCatalogPowerMix([rows[0]] as any).rows.length,1);
 }
});
test('unknown and hybrid peak power are never misclassified as certified low power',()=>{
 assert.equal(catalogPowerBand({powerHp:400,powertrainKind:'electric'}),'unknown');
 assert.equal(catalogPowerBand({powerHp:400,powertrainKind:'electric',utilizationPowerKw:100}),'low');
 assert.equal(catalogPowerBand({powertrainKind:'other_hybrid',utilizationPowerKw:150}),'high');
});
