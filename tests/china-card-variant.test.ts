import test from 'node:test';
import assert from 'node:assert/strict';
import {chinaCardVariant,isChinaModelSpecification} from '../apps/web/lib/catalog/china-card-variant';
test('AutoHome model configurations retain seats, engine, fuel and trim in distinct Russian labels',()=>{
 const offer={market:'china',sourceGroup:'autohome_new_china_open'};
 assert.ok(isChinaModelSpecification(offer));
 assert.ok(isChinaModelSpecification({market:'china',catalogEntryKind:'model_variant'}));
 assert.equal(isChinaModelSpecification({market:'china',sourceGroup:'autohome_used_china_open'}),false);
 const a=chinaCardVariant({...offer,trim:'2026款 1.6L 舒适型 2座厢车'});
 const b=chinaCardVariant({...offer,trim:'2026款 1.6L 舒适型 5座厢车'});
 assert.equal(a,'1.6L Комфорт 2 места фургон');assert.equal(b,'1.6L Комфорт 5 мест фургон');assert.notEqual(a,b);
 assert.match(chinaCardVariant({...offer,trim:'2026款 1.6L CNG 豪华型 5座厢车'}),/CNG Люкс 5 мест/);
 assert.equal(chinaCardVariant({market:'china',trim:'2026 1.5L CVT Luxury'}),'1.5L CVT Luxury');
 assert.equal(chinaCardVariant({market:'japan',trim:'2026 something'}),'');
});

test('JAC branded trims and BAW commercial equipment grades stay distinct',()=>{
 for(const variants of [
  ['2026款 2.0CTI 柴油手动劲享型','2026款 2.0CTI 柴油手动劲尚型','2026款 2.0CTI 柴油手动劲锐型'],
  ['2026款 CNG 高级营运 7座','2026款 CNG 中级营运 7座','2026款 CNG 尊享型 7座'],
  ['2026款 增程版 230高级营运旗舰型 7座','2026款 增程版 230旗舰型 7座','2026款 增程版 230尊贵型 7座'],
 ]){
  const labels=variants.map(trim=>chinaCardVariant({market:'china',trim}));
  assert.equal(new Set(labels).size,variants.length);for(const label of labels)assert.doesNotMatch(label,/\p{Script=Han}/u);
 }
});
