import test from 'node:test';
import assert from 'node:assert/strict';
import {searchRussianCities} from '../apps/web/lib/location/cities';
import cities from '../apps/web/lib/location/russian-cities.json';
import {quoteCityDelivery} from '../apps/web/lib/catalog/city-delivery';
test('full city directory finds Tver and smaller cities without an external service', () => {
 assert.ok(cities.length > 1100);
 for (const name of ['Тверь', 'Ржев', 'Великий Устюг', 'Гусь-Хрустальный', 'Петропавловск-Камчатский']) assert.ok(searchRussianCities(name).some(x => x.city === name), name);
 assert.equal(searchRussianCities(' г. Тверь ')[0].city, 'Тверь');
 assert.equal(searchRussianCities('орел')[0].city, 'Орёл');
});
test('same-name cities preserve the selected region', () => {
 const rows=searchRussianCities('Киров').filter(x => x.city === 'Киров');
 assert.equal(rows.length, 2); assert.equal(new Set(rows.map(x=>x.value)).size,2);
 assert.ok(rows.every(x => x.value.includes(x.region)));
});
test('every directory entry is discoverable by its full saved value', () => {
 for (const city of cities) assert.ok(searchRussianCities(city.value).some(x=>x.value === city.value), city.value);
});
test('Tver provisional tariff is rounded; unpriced cities remain explicitly unquoted', () => {
 assert.equal(quoteCityDelivery('Тверь','japan').amountRub,205000);
 assert.equal(quoteCityDelivery('Анадырь','japan').status,'needs_quote');
});
