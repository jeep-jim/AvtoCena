import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSearchQuery,researchSearchUrl} from '../search-query.mjs';
test('followup keeps exact car context and URL-encodes user text',()=>{
 const context=initialSearchQuery('Карточка: https://avtocena.com/cars/offer/test . Вопрос: Honda Fit BASIC 2022 GR1. Проверь точную модификацию и приведи источники.');
 assert.equal(context,'Honda Fit BASIC 2022 GR1');
 const url=new URL(researchSearchUrl(context,'фото кузова & двигатель #1'));
 assert.equal(url.origin,'https://yandex.ru');
 assert.equal(url.searchParams.get('text'),'Honda Fit BASIC 2022 GR1. фото кузова & двигатель #1');
 assert.equal(url.hash,'');
 assert.equal([...url.searchParams].length,1);
});
test('invalid and oversized queries are rejected',()=>{
 assert.throws(()=>initialSearchQuery(''),/invalid_message/);
 assert.throws(()=>initialSearchQuery('x'.repeat(2501)),/invalid_message/);
 assert.throws(()=>researchSearchUrl('Honda', 'x'.repeat(2501)),/invalid_message/);
});
