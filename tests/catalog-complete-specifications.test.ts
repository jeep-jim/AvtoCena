import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAutohomeSpecificationGroups} from '../apps/web/lib/catalog/autohome-new-exact-source';
import {displaySpecificationGroups,untranslatedSpecificationFields} from '../apps/web/lib/catalog/specification-display';

test('Autohome retains every field of the exact spec, including optional equipment and explicit omissions',()=>{
 const config={result:{paramtypeitems:[{name:'发动机',paramitems:[{name:'排量(mL)',valueitems:[{specid:1,value:'1498'},{specid:2,value:'1998'}]},...Array.from({length:240},(_,i)=>({name:`Feature ${i}`,valueitems:[{specid:1,value:i===0?'-':String(i)}]}))]}]}};
 const option={result:{configtypeitems:[{name:'灯光配置',configitems:[{name:'LED',valueitems:[{specid:1,value:'○',sublist:[{subvalue:'package A'}]}]}]}]}};
 const result=parseAutohomeSpecificationGroups(`var config = ${JSON.stringify(config)}; var option = ${JSON.stringify(option)};`,'1');
 assert.equal(result[0].items.length,241);assert.equal(result[0].items[0].value,'1498');
 assert.equal(result[0].items[1].value,'-');assert.equal(result[1].items[0].value,'○ / package A');
 assert.ok(!JSON.stringify(result).includes('1998'));
});
test('display translates technical labels and deduplicates identical rows without losing conflicting values or mutating originals',()=>{
 const raw=[{name:'发动机',items:[{name:'排量(mL)',value:'1498'},{name:'燃料形式',value:'汽油'}]},{name:'Engine',items:[{name:'排量(mL)',value:'1498'},{name:'排量(mL)',value:'1499'}]}];
 const before=JSON.stringify(raw),view=displaySpecificationGroups(raw);
 assert.equal(view[0].name,'Двигатель');assert.equal(view[0].items[1].value,'Бензин');assert.equal(view[1].items.length,1);assert.equal(view[1].items[0].value,'1499');assert.equal(JSON.stringify(raw),before);
 assert.equal(untranslatedSpecificationFields(raw).length,0);
 assert.equal(untranslatedSpecificationFields([{name:'未知参数',items:[{name:'未知',value:'x'}]}]).length,1);
});
