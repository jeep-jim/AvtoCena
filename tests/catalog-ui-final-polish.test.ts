import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFuelFilter } from '../apps/web/lib/catalog/fuel-filter';
import { translateKnownSpecification, readableSpecificationLabel } from '../apps/web/lib/catalog/specification-vocabulary';
import { translateSpecificationText } from '../apps/web/lib/catalog/specification-display';
test('combined electric selection includes both fuels without including unknown or combustion',()=>{
 const fuels=['electric','hybrid','petrol','diesel','unknown',''];
 assert.deepEqual(fuels.filter(f=>matchesFuelFilter(f,'electrified')),['electric','hybrid']);
 assert.deepEqual(fuels.filter(f=>matchesFuelFilter(f,'electric')),['electric']);
 assert.deepEqual(fuels.filter(f=>matchesFuelFilter(f,'hybrid')),['hybrid']);
 assert.equal(fuels.filter(f=>matchesFuelFilter(f,undefined)).length,fuels.length);
});
test('technical vocabulary translates labels and preserves numeric data and model codes',()=>{
 assert.equal(readableSpecificationLabel('(mm)'),null);
 assert.equal(readableSpecificationLabel('(kg)'),null);
 assert.equal(readableSpecificationLabel('(L)'),null);
 assert.equal(readableSpecificationLabel('Максимальная мощность(kW)'),'Максимальная мощность (кВт)');
 assert.equal(readableSpecificationLabel('ABS'),'ABS');
 assert.equal(translateKnownSpecification('Basic Specifications'),'Основные характеристики');
 assert.equal(translateKnownSpecification('Technische Daten'),'Технические данные');
 assert.equal(translateKnownSpecification('車両情報'),'Данные автомобиля');
 assert.equal(translateKnownSpecification('Maximum power (kW)'),'Максимальная мощность, кВт');
 assert.equal(translateKnownSpecification('110 kW / 150 PS'),'110 kW / 150 PS');
 assert.equal(translateKnownSpecification('EA211-DTJ'),'EA211-DTJ');
 assert.equal(translateSpecificationText('通风盘式'),'Вентилируемые дисковые');
 assert.equal(translateSpecificationText('Front wheel drive'),'Передний привод');
});
