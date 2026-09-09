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


test('fresh K Car evidence is not replayed through the obsolete horsepower witness name',async()=>{
 const {inventorySourceEvidence}=await import('../apps/web/lib/catalog/prepare-seller-inventory');
 const semantic=Object.fromEntries(['year','fuel','engineCc','powerHp'].map(field=>[field,{status:field==='engineCc'?'missing':'exact',source:'kcar_exact_detail_rvo'}]));
 const input:any={sourceId:'kcar_korea_open',sourceOfferId:'one',market:'korea',fuel:'petrol',powertrainKind:'combustion',powerHp:150,powerKw:110.3,powerDataConfidence:'source_exact',powerDataSource:'kcar_exact_detail_rvo_hrspow_kw',operational:{detailIdentityVerified:true,fieldIdentityVerified:true,sourceExactFields:['fuel','powerHp'],semanticEvidence:semantic}};
 const before=JSON.stringify(input),result=inventorySourceEvidence(input);
 assert.equal(result.powerHp,150);assert.equal(result.operational.semanticEvidence.engineCc.status,'missing');
 assert.notEqual(result,input);assert.equal(JSON.stringify(input),before);
});

 test('motorhome specifications translate equipment and trim without inventing damaged fields',()=>{
 const raw=[{name:'外观/防盗',items:[{name:'外置淋浴',value:'标配'},{name:'车型',value:'2024款 远征版 2.3T 基础款 4座'},{name:'厂',value:'汽车'},{name:'形式',value:'—'},{name:'材料',value:'—'}]},{name:'车外灯光',items:[{name:'自 应远近光',value:'○'},{name:'刹车辅助(EBA/BAS/BA等)',value:'1'}]}];
 const original=JSON.stringify(raw),view=displaySpecificationGroups(raw);
 assert.equal(untranslatedSpecificationFields(raw).length,0);
 assert.equal(view[0].items[0].name,'Наружный душ');
 assert.match(view[0].items[1].value,/2024 г./);
 assert.match(view[0].items[2].name,/неполное в источнике/);
 assert.equal(view[0].items.length,5);
 assert.equal(view[1].items[1].value,'1');
 assert.equal(JSON.stringify(raw),original);
 });

test('partially damaged Chinese labels are repaired after phrase translation',()=>{
 const rows=[{name:'发动机',items:[{name:'发动机型',value:'—'},{name:'车身 控制(ESC/ESP/DSC等)',value:'1'}]}];
 assert.equal(untranslatedSpecificationFields(rows).length,0);
 assert.equal(displaySpecificationGroups(rows)[0].items[0].name,'Модель двигателя');
});
