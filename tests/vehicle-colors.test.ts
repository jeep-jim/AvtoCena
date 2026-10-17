import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hexToHsv,hsvToHex,vehicleColorHex,namedVehicleColor,nearestVehicleColor} from '../apps/web/lib/catalog/vehicle-colors';
test('arbitrary paint colors retain exact HEX through spectrum conversion',()=>{
 for(const hex of ['#123456','#ffffff','#000000','#ff0000','#00ff00','#0000ff','#abcdef']){
  const {h,s,v}=hexToHsv(hex);assert.equal(hsvToHex(h,s,v),hex);
  assert.equal(vehicleColorHex(`Заводской оттенок (${hex})`),hex);
 }
 assert.equal(namedVehicleColor('BLACK')?.[0],'Чёрный');
 assert.equal(nearestVehicleColor('#ffffff'),'Белый');
 assert.equal(vehicleColorHex('Название без кода'),null);
});
