import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSortLabel,parseCatalogSort} from '../apps/web/lib/catalog/catalog-sort';

test('Japanese price choices name the auction amount and leave other market choices unchanged',()=>{
 assert.equal(catalogSortLabel('totalRub',true),'Дешевле на аукционе');
 assert.equal(catalogSortLabel('totalRubDesc',true),'Дороже на аукционе');
 assert.equal(catalogSortLabel('totalRub'),'Сначала дешевле');
 assert.equal(catalogSortLabel('totalRubDesc'),'Сначала дороже');
 assert.equal(catalogSortLabel('mileage',true),catalogSortLabel('mileage'));
 assert.deepEqual(parseCatalogSort('year,totalRub'),['year','totalRub']);
 assert.equal(parseCatalogSort('totalRub,totalRubDesc'),null);
});
