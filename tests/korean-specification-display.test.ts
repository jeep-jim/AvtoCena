import test from 'node:test';
import assert from 'node:assert/strict';
import fields from './fixtures/korean-published-fields.json';
import {translateSpecificationText,displaySpecificationGroups} from '../apps/web/lib/catalog/specification-display';
test('all 100 most frequent untranslated Korean fields from the pinned live audit are readable',()=>{
 for(const text of fields)assert.doesNotMatch(translateSpecificationText(text),/\p{Script=Hangul}/u,text);
});
test('short names do not corrupt longer Korean technical terms or source evidence',()=>{
 assert.equal(translateSpecificationText('전륜구동'),'Передний привод');
 assert.equal(translateSpecificationText('스마트키'),'Смарт-ключ');
 assert.equal(translateSpecificationText('은회색'),'Серебристо-серый');
 const raw=[{name:'차량정보',items:[{name:'변속기',value:'오토'}]}];const before=JSON.stringify(raw);
 assert.equal(displaySpecificationGroups(raw)[0].items[0].value,'Автоматическая');assert.equal(JSON.stringify(raw),before);
});
test('technical notes preserve defects, incomplete mileage and original identifiers',()=>{
 assert.equal(translateSpecificationText('운전석쪽 뒤 도어 파워윈도우 미작동'),'Задний стеклоподъёмник со стороны водителя не работает');
 assert.match(translateSpecificationText('계기판교체이력 있음 43'),/43.*обрезаны/);
 assert.equal(translateSpecificationText('000원'),'000 вон');
 assert.equal(translateSpecificationText('54주7084'),'54주7084');
 assert.equal(translateSpecificationText('명문자동차'),'Myeongmun Auto');
 assert.equal(translateSpecificationText('알수없는자동차'),'알수없는자동차');
 assert.equal(translateSpecificationText('더 뉴 아반떼 7세대 5인승'),'Обновлённый Avante 7-е поколение 5 мест');
});
